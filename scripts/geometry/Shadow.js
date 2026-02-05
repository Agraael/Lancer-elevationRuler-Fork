/* globals
PIXI,
canvas,
ClipperLib,
Ray,
CONFIG,
foundry
*/
"use strict";

import "./3d/Point3d.js";
import "./ClipperPaths.js";
import "./3d/Plane.js";
import "./Draw.js";
import "./Matrix.js";
import { GEOMETRY_CONFIG } from "./const.js";

/* Testing
api = game.modules.get("tokenvisibility").api
Point3d = api.Point3d
Shadow = api.Shadow
visionSource = _token.vision
shadowPolygonForElevation = api.shadowPolygonForElevation
polygonToRectangle = api.polygonToRectangle
intersectConstrainedShapeWithLOS = api.intersectConstrainedShapeWithLOS

target = _token


let [wall] = canvas.walls.placeables
s0 = Shadow.construct(wall, visionSource, CONFIG.GeometryLib.utils.gridUnitsToPixels(0))
s10 = Shadow.construct(wall, visionSource, CONFIG.GeometryLib.utils.gridUnitsToPixels(10))


s30 = Shadow.construct(wall, visionSource, CONFIG.GeometryLib.utils.gridUnitsToPixels(30))

// Project to bottom surface.
Token losHeight = 30; elevation = 25
surface elevation = 0
wall at 20, 10

// Project to top surface:
token losHeight = 0; elevation = -5
surface elevation = 30

*/

/*
 Looking at a cross-section:
  V----------W----O-----?
  | \ Ø      |    |
Ve|    \     |    |
  |       \  |    |
  |          \    |
  |        We|  \ | <- point O where obj can be seen by V for given elevations
  ----------------•----
  |<-   VO      ->|
 e = height of V (vision object)
 Ø = theta
 W = terrain wall

 Looking from above:
              •
             /| 𝜶 is the angle VT to VT.A
          •/ -|
         /|   |
       /  | S | B
     /    |   |
   / 𝜶  B |   |
 V -------W---• O
 (and mirrored on bottom)
 S = shadow area
 B = bright area

 naming:
 - single upper case: point. e.g. V
 - double upper case: ray/segment. e.g. VT
 - lower case: descriptor. e.g., Ve for elevation of V.

Bottom wall to surface is similar:
 Looking at a cross-section:
  V----------W----O-----?
  | \ I      |    |
Ve| K  \   We|    |
  |       \  |    |
  |          \    |
  |           L  \ | <- point O where obj can be seen by V for given elevations
  ----------------•----
  |<-   VO   |  ->|
             |<- Point where wall would touch the surface

*/

export class ShadowProjection {

  /** @type {Plane} */
  plane;

  /** @type {PointSource} */
  source;

  /** @type {Matrix} */
  _shadowMatrix;

  /** @type {number} */
  _sourceSide;

  /** @type {BigInt} */
  _cacheKey;

  constructor(plane, source) {
    this.plane = plane;
    this.source = source;

    this.updateSourceOrigin(); // Set the cache
  }

  /**
   * 3d origin (center) point for the source.
   * @type {Point3d}
   */
  get sourceOrigin() {
    // Don't cache so that the source origin is always up-to-date with current source location.
    return CONFIG.GeometryLib.threeD.Point3d.fromPointSource(this.source);
  }

  /**
   * Cached planar projection matrix.
   * @type {Matrix}
   */
  get shadowMatrix() {
    if ( this._cacheKey !== this.sourceOrigin.key ) this.updateSourceOrigin();
    return this._shadowMatrix ?? (this._shadowMatrix = this._calculateShadowMatrix());
  }

  /**
   * Determine which side of the plane the source lies. See Plane.prototype.which.Side
   * @type {number}
   */
  get sourceSide() {
    if ( this._cacheKey !== this.sourceOrigin.key ) this.updateSourceOrigin();
    return this._sourceSide ?? (this._sourceSide = this.plane.whichSide(this.sourceOrigin));
  }

  /**
   * Test whether the plane is parallel to the canvas, which allows us to simplify
   * wall shadow calculations.
   * @type {boolean}
   */
  get isCanvasParallel() {
    return this.plane.normal.equals({x: 0, y: 0, z: 1});
  }

  /**
   * Faster calculation of a shadow projection matrix.
   * http://www.it.hiof.no/~borres/j3d/explain/shadow/p-shadow.html
   * @returns {Matrix}
   */
  _calculateShadowMatrix() {
    const P = this.plane.equation;
    const L = this.sourceOrigin;

    const dot = (P.a * L.x) + (P.b * L.y) + (P.c * L.z) + P.d;

    return new CONFIG.GeometryLib.Matrix([
      [dot - (L.x * P.a), -(L.y * P.a), -(L.z * P.a), -1 * P.a],
      [-(L.x * P.b), dot - (L.y * P.b), -(L.z * P.b), -1 * P.b],
      [-(L.x * P.c), -(L.y * P.c), dot - (L.z * P.c), -1 * P.c],
      [-(L.x * P.d), -(L.y * P.d), -(L.z * P.d), dot - P.d]
    ]);
  }

  /**
   * Create a new shadow matrix, based on the old one,
   * with the plane raised or lowered by a distance in the z direction.
   * @param {number} newZ     The new z value of the plane on which the shadow is projected.
   * @returns {Matrix}
   */
  _changeShadowMatrixByZ(newZ) {
    const plane = this.plane;
    const P = plane.equation;
    const L = this.sourceOrigin;

    const newP0 = plane.point.clone();
    newP0.z = newZ;
    const newPd = -plane.normal.dot(newP0);

    // TODO: If this is getting used a lot, could cache the dotPL and the P.d calcs.
    const dotPL = (P.a * L.x) + (P.b * L.y) + (P.c * L.z);
    const oldDot = dotPL + P.d;
    const newDot = dotPL + newPd;

    const dotDiff = newDot - oldDot;

    const M = this.shadowMatrix.clone();
    M.arr[0][0] += dotDiff;
    M.arr[1][1] += dotDiff;
    M.arr[2][2] += dotDiff;

    M.arr[3][3] = newDot - newPd;

    M.arr[3][0] = -(L.x * newPd);
    M.arr[3][1] = -(L.y * newPd);
    M.arr[3][2] = -(L.z * newPd);

    return M;
  }

  /**
   * Assuming this projection is for a horizontal plane, calculate a new shadow point
   * for a plane that is higher or lower along the z axis.
   * @param {Point3d} pt
   * @param {number} z
   * @returns {Point3d} Shifted point or null if point would be on the other side.
   */
  shiftShadowPointAlongZ(pt, z) {
    const sourceOrigin = this.sourceOrigin;
    const origZ = this.plane.point.z;
    const percentShift = 1 - ((z - origZ) / (sourceOrigin.z - origZ));
    return sourceOrigin.projectToward(pt, percentShift);
  }

  /**
   * Force a reset of the source origin point, used when the source position or elevation changes.
   * Another option is to construct a new ShadowProjection using the plane from this one.
   */
  updateSourceOrigin() {
    this._shadowMatrix = undefined;
    this._sourceSide = undefined;
    this._cacheKey = this.sourceOrigin.key;
  }

  /**
   * Shadow points for a wall where the source is below the plane.
   * (Shadow cast up on the plane)
   * @param {Wall} wall
   * @returns {Point3d[]}
   */
  _shadowPointsFromWallPointsSourceBelowPlane(pts, planeZ, sourceZ) {
    // Turn everything upside down
    pts.A.top.z *= -1;
    pts.B.top.z *= -1;
    pts.A.bottom.z *= -1;
    pts.B.bottom.z *= -1;

    planeZ *= -1;
    sourceZ *= -1;

    return this._shadowPointsFromWallPointsSourceAbovePlane(pts, planeZ, sourceZ);
  }

  /**
   * Shadow points for a wall where the source is above the plane.
   * @param {Wall} wall
   * @returns {Point3d[]}  Empty array if no shadow
   */
  _shadowPointsFromWallPointsSourceAbovePlane(pts, planeZ, sourceZ) {
    // Not currently possible: wall A and B have different Z values
    // TODO: Can we lose these tests?
    if ( pts.A.top.z !== pts.B.top.z ) {
      console.error("_shadowPointsForWallSourceAbove wall top elevations differ.");
    }

    if ( pts.A.bottom.z !== pts.B.bottom.z ) {
      console.error("_shadowPointsForWallSourceAbove wall bottom elevations differ.");
    }

    // No shadow if the top of the wall is below the plane.
    if ( pts.A.top.z <= planeZ ) return [];

    // No shadow if the bottom of the wall is above the source.
    if ( pts.A.bottom.z >= sourceZ ) return [];

    const srcOrigin = this.sourceOrigin;

    const topShadow = { A: new CONFIG.GeometryLib.threeD.Point3d(0, 0, planeZ), B: new CONFIG.GeometryLib.threeD.Point3d(0, 0, planeZ) };
    const bottomShadow = {
      A: new CONFIG.GeometryLib.threeD.Point3d(pts.A.bottom.x, pts.A.bottom.y, planeZ),
      B: new CONFIG.GeometryLib.threeD.Point3d(pts.B.bottom.x, pts.B.bottom.y, planeZ)
    };

    if ( pts.A.top.z >= sourceZ ) {
      // Source is below the top of the wall; shadow is infinite
      // Project the point sufficiently far to cover the canvas
      // Use the closer point
      const dist2 = PIXI.Point.distanceSquaredBetween;
      const [closerPt, furtherPt] = dist2(srcOrigin, pts.A.top) < dist2(srcOrigin, pts.B.top)
        ? ["A", "B"] : ["B", "A"];

      const maxR2 = Math.pow(canvas.dimensions.maxR, 2);
      const ixCloser = srcOrigin.to2d().towardsPointSquared(pts[closerPt].top, maxR2);
      topShadow[closerPt].x = ixCloser.x;
      topShadow[closerPt].y = ixCloser.y;

      // Intersect the line parallel with the wall to get the second shadow point
      const wallDir = pts.B.top.subtract(pts.A.top);
      const ixFurther = foundry.utils.lineLineIntersection(srcOrigin, pts[furtherPt].top, topShadow[closerPt], topShadow[closerPt].add(wallDir));
      topShadow[furtherPt].x = ixFurther.x;
      topShadow[furtherPt].y = ixFurther.y;


    } else {
      // Determine the plane intersection
      this._intersectionWith(pts.A.top, topShadow.A);
      this._intersectionWith(pts.B.top, topShadow.B);
    }


    if ( pts.A.bottom.z > planeZ ) {
      // Wall is above the plane
      this._intersectionWith(pts.A.bottom, bottomShadow.A);
      this._intersectionWith(pts.B.bottom, bottomShadow.B);
    }

    // Force clockwise
    return foundry.utils.orient2dFast(topShadow.B, bottomShadow.B, bottomShadow.A) < 0
      ? [topShadow.B, bottomShadow.B, bottomShadow.A, topShadow.A]
      : [topShadow.A, bottomShadow.A, bottomShadow.B, topShadow.B];
  }

  /**
   * Construct a shadow from this source cast by the wall onto this plane.
   * @param {Wall} wall
   * @returns {Point3d[]}
   */
  constructShadowPointsForWall(wall) {
    const pts = CONFIG.GeometryLib.threeD.Point3d.fromWall(wall, { finite: true });
    return this._constructShadowPointsForWallPoints(pts);
  }

  /**
   * Construct a shadow from this source cast by the wall points onto this plane
   * @param {object} wallPoints    Set of points from Point3d.fromWall
   * @returns {Point3d[]}
   */
  _constructShadowPointsForWallPoints(wallPoints) {
    if ( this.isCanvasParallel
      && wallPoints.A.top.z === wallPoints.B.top.z
      && wallPoints.A.top.z === wallPoints.B.top.z ) {

      const planeZ = this.plane.point.z;
      const sourceZ = this.sourceOrigin.z;

      return planeZ <= sourceZ
        ? this._shadowPointsFromWallPointsSourceAbovePlane(wallPoints, planeZ, sourceZ)
        : this._shadowPointsFromWallPointsSourceBelowPlane(wallPoints, planeZ, sourceZ);
    }

    return this._shadowPointsForWallPoints(wallPoints);
  }

  /**
   * Construct a shadow from this source cast by a flat object, like a wall,
   * represented by an array of points.
   * @param {Point3d[]} pts
   * @returns {Point3d[]}
   */
  _shadowPointsForPoints(pts) {
    const { plane, sourceSide, sourceOrigin } = this;
    const maxR2 = Math.pow(canvas.dimensions.maxR, 2);
    const ln = pts.length;
    if ( ln < 3 ) return [];

    let shadowPoints = [];
    let prevSide = plane.whichSide(pts[ln - 1]);
    let prevPt = pts[ln - 1];
    for ( const pt of pts ) {
      const ptSide = plane.whichSide(pt);

      if ( !ptSide ) shadowPoints.push(pt);
      else if ( ptSide * prevSide < 0 ) {
        // We switched sides of the plane
        // Locate the intersection of the plane with this and the previous point.
        const ix = plane.lineSegmentIntersection(prevPt, pt);
        shadowPoints.push(ix);
      }

      if ( ptSide * sourceSide > 0 ) {
        const ix = this._intersectionWith(pt);

        // Is the intersection on the correct side of the point?
        // Should be further from the source than the point.
        const dist2Pt = CONFIG.GeometryLib.threeD.Point3d.distanceSquaredBetween(sourceOrigin, pt);
        const dist2Ix = CONFIG.GeometryLib.threeD.Point3d.distanceSquaredBetween(sourceOrigin, ix);

        if ( dist2Pt < dist2Ix ) {
          // We have source --> pt --> ix
          shadowPoints.push(ix); // TODO: Do we need if ( ix ) here?
        } else {
          // We have ix --> source --> plane or source --> ix --> plane
          // Object blocks plane completely; shadow extends infinitely far
          // Get a suitably far point to stand in for infinity
          const tmp = pt.clone(); // Don't change the origin point.

          // Use the sourceOrigin elevation in most cases
          // typical case: wall extends below and above source; we are projecting to
          // a plane below source and so we want to look straight out from source.
          if ( pt.z > sourceOrigin.z ) tmp.z = sourceOrigin.z;
          sourceOrigin.towardsPointSquared(tmp, maxR2, tmp);

          // Use the plane normal to intersect the tmp point with the plane.
          const tmpIx = plane.lineIntersection(tmp, plane.normal);
          shadowPoints.push(tmpIx);
        }
      }

      prevSide = ptSide;
      prevPt = pt;
    }

    // Force clockwise
    if ( shadowPoints.length < 3 ) return [];

    // Round to avoid numeric inconsistencies
    const PLACES = 4;
    shadowPoints.forEach(pt => pt.roundDecimals(PLACES));

    // TODO: Is the forcing clockwise necessary, or is it always the same?
    const orient = foundry.utils.orient2dFast(shadowPoints[0], shadowPoints[1], shadowPoints[2]);
//     if ( orient <= 0 ) console.warn(`_shadowPointsForPoints|orientation ${orient < 0 ? "cw" : orient > 0 ? "ccw" : "0" }`);
    return orient < 0 ? shadowPoints : shadowPoints.reverse();
  }

  /**
   * Construct a shadow from this source cast by the wall onto this plane.
   * This helper assume nothing about the plane orientation.
   * @param {object} pts     Result of ShadowProjection.wallPoints()
   * @returns {Point3d[]}
   */
  _shadowPointsForWallPoints(pts) {
    const { plane, sourceSide } = this;

    // Which wall points are on the same side of the plane as the light and thus
    // possibly cast a shadow?
    const sides = {
      A: {
        top: plane.whichSide(pts.A.top),
        bottom: plane.whichSide(pts.A.bottom)
      },
      B: {
        top: plane.whichSide(pts.B.top),
        bottom: plane.whichSide(pts.B.bottom)
      }
    };

    // Move Atop --> Btop --> Bbottom --> Abottom
    const shadowPoints = [];
    const iterPoints = ["A", "B", "B", "A", "A"];
    const iterDir = ["top", "top", "bottom", "bottom", "top"];

    for ( let i = 0, j = 1; i < 4; i += 1, j += 1 ) {
      const side = sides[iterPoints[i]][iterDir[i]];
      const pt = pts[iterPoints[i]][iterDir[i]];
      const nextSide = sides[iterPoints[j]][iterDir[j]];
      const nextPt = pts[iterPoints[j]][iterDir[j]];

      // First check if the current point could be an intersection
      if ( side.almostEqual(0) ) {
        // Point is on the plane, so use it.
        shadowPoints.push(pt);
      } else if ( side * sourceSide < 0 ) {
        // Point is behind the plane, relative to the source.
        // source --> plane --> Atop
      } else {
        // Point is on the side of the plane with the source.
        const ix = this._intersectionWith(pt);
        if ( ix ) {
          // Need to check whether we have source --> Atop --> plane
          // Or we might have Atop --> source --> plane, in which is not a shadow
          shadowPoints.push(ix);
        }
      }

      // Second, check if we need the intersection between this point and next point
      if ( side * nextSide < 0 ) {
        // Pt and nextPt are on different sides of the plane
        // We need to use the intersection
        const ix = plane.lineSegmentIntersection(pt, nextPt);
        if ( ix ) shadowPoints.push(ix);
      }
    }

    // Force clockwise
    if ( shadowPoints.length < 3 ) return [];

    return foundry.utils.orient2dFast(shadowPoints[0], shadowPoints[1], shadowPoints[2]) < 0
      ? shadowPoints : shadowPoints.reverse();
  }

  /**
   * Calculate the intersection point on the plane from the source through v.
   * @param {Point3d} v
   * @returns {Point3d}
   */
  _intersectionWith(v, outPoint = new CONFIG.GeometryLib.threeD.Point3d()) {
    return this.shadowMatrix.multiplyPoint3d(v, outPoint);
  }

  /**
   * Just for testing / debugging
   */
  _calculateIntersectionMatrix(v) {
    const { normal: N, point: P } = this.plane;
    const l = this.sourceOrigin;
    const d = N.dot(P);

    const dotNL = N.dot(l);
    const scaledDotNL = dotNL + d;

    const dotNV = N.dot(v);
    const scaledDotNV = dotNV + d;

    return new CONFIG.GeometryLib.Matrix([[
      -(scaledDotNL * v.x) + (scaledDotNV * l.x),
      -(scaledDotNL * v.y) + (scaledDotNV * l.y),
      -(scaledDotNL * v.z) + (scaledDotNV * l.z),
      dotNV - dotNL
    ]]);
  }

  _calculateIntersectionMatrix2(l0, delta) {
    const { normal: N, point: P } = this.plane;

    const dotNdelta = N.dot(delta);
    if ( dotNdelta.almostEqual(0) ) return null;

    const w = l0.subtract(P);
    const dotNw = N.dot(w);

    /* Point3d version
    const fac = -dotNw / dotNdelta

    return new Point3d(
      l0.x + delta.x * fac,
      l0.y + delta.y * fac,
      l0.z + delta.z * fac
    )
    */
    return new CONFIG.GeometryLib.Matrix([[
      (l0.x * dotNdelta) + (delta.x * -dotNw),
      (l0.y * dotNdelta) + (delta.y * -dotNw),
      (l0.z * dotNdelta) + (delta.z * -dotNw),
      dotNdelta
    ]]);
  }
}

/**
 * Represent a trapezoid "shadow" using a polygon.
 * Walls in Foundry create trapezoids, but other shapes are possible.
 */
export class Shadow extends PIXI.Polygon {
  constructor(...points) {
    super(...points);

    // Round to nearest pixel to avoid some visual artifacts when joining shadows
    this.points = this.points.map(val => Math.round(val));

    if ( !this.isClosed ) {
      const ln = this.points.length;
      this.addPoint({ x: this.points[ln - 2], y: this.points[ln -1] });
    }

  }

  static upV = new GEOMETRY_CONFIG.threeD.Point3d(0, 0, 1);

  /**
   * Build the parallelogram representing a shadow cast from a wall.
   * Looking top-down with a light or other source object at a given elevation
   * above a wall.
   * This method used by Elevated Vision.
   * TODO: Replace with better version using projection that handles planes.
   * @param {Wall} w
   * @param {LightSource} source
   * @return {Shadow}
   */
  static constructShadow(wall, source, surfaceElevation = 0) {
    /*
     Looking at a cross-section:
      V----------T----O-----?
      | \ Ø      |    |
    Ve|    \     |    |
      |       \  |    |
      |          \    |
      |        Te|  \ | <- point O where obj can be seen by V for given elevations
      ----------------•----
      |<-   VO      ->|
     e = height of V (vision object)
     Ø = theta
     T = terrain wall

     Looking from above:
                  •
                 /| 𝜶 is the angle VT to VT.A
              •/ -|
             /|   |
           /  | S | B
         /    |   |
       / 𝜶  B |   |
     V -------T---• O
     (and mirrored on bottom)
     S = shadow area
     B = bright area

     naming:
     - single upper case: point. e.g. V
     - double upper case: ray/segment. e.g. VT
     - lower case: descriptor. e.g., Ve for elevation of V.

    */

    // Note: elevation should already be in grid pixel units
    let Oe = surfaceElevation;
    let Te = wall.topZ; // TO-DO: allow floating walls to let light through the bottom portion

    // TO-DO: allow this to be modified by terrain elevation
    // let Oe = 0;
    let Ve = source.elevationZ;
    if ( Ve <= Te ) return null; // Vision object blocked completely by wall

    // Need the point of the wall that forms a perpendicular line to the vision object
    const Tix = CONFIG.GeometryLib.utils.perpendicularPoint(wall.edge.a, wall.edge.b, source);
    if ( !Tix ) return null; // Line collinear with vision object
    const VT = new Ray(source, Tix);

    // If any elevation is negative, normalize so that the lowest elevation is 0
    const min_elevation = Math.min(Ve, Oe, Te);
    if ( min_elevation < 0 ) {
      const adder = Math.abs(min_elevation);
      Ve = Ve + adder;
      Oe = Oe + adder;
      Te = Te + adder;
    }

    // Theta is the angle between the 3-D sight line and the sight line in 2-D
    const theta = Math.atan((Ve - Te) / VT.distance); // Theta is in radians
    const TOdist = (Te - Oe) / Math.tan(theta); // Tan wants radians
    const VOdist = VT.distance + TOdist;

    /* Testing
    // Ray extending out V --> T --> O
    api.drawing.drawPoint(source, {color: api.drawing.COLORS.yellow})

    VO = Ray.towardsPoint(source, Tix, VOdist)
    api.drawing.drawPoint(VO.B, {color: api.drawing.COLORS.lightblue})
    */

    // We know the small triangle on each side:
    // V --> T --> wall.edge.a and
    // V --> T --> wall.edge.b
    // We need the larger encompassing triangle:
    // V --> O --> ? (wall.edge.a side and wall.edge.b side)

    // Get the distances between Tix and the wall endpoints.
    const distA = PIXI.Point.distanceBetween(wall.edge.a, Tix);
    const distB = PIXI.Point.distanceBetween(wall.edge.b, Tix);


    /* Testing
    // Ray extending Tix --> Wall.A
    rayTA = new Ray(wall.edge.a, Tix);
    rayTA.distance

    rayTB = new Ray(wall.edge.b, Tix);
    rayTB.distance;
    */

    // Calculate the hypotenuse of the big triangle on each side.
    // That hypotenuse is used to extend a line from V past each endpoint.
    // First get the angle
    const alphaA = Math.atan(distA / VT.distance);
    const alphaB = Math.atan(distB / VT.distance);

    // Now calculate the hypotenuse
    const hypA = VOdist / Math.cos(alphaA);
    const hypB = VOdist / Math.cos(alphaB);

    // Extend a line from V past wall T at each endpoint.
    // Each distance is the hypotenuse ont he side.
    // given angle alpha.
    // Should form the parallelogram with wall T on one parallel side
    const VOa = Ray.towardsPoint(source, wall.edge.a, hypA);
    const VOb = Ray.towardsPoint(source, wall.edge.b, hypB);

    /* Testing
    // Rays extending V --> T.A or T.B --> end of shadow
    api.drawing.drawSegment(VOa, {color: api.drawing.COLORS.green})
    api.drawing.drawSegment(VOb, {color: api.drawing.COLORS.orange})
    api.drawing.drawSegment({A: VOa.B, B: VOb.B}, {color: api.drawing.COLORS.gray})
    */

    const shadow = new this([wall.edge.a, VOa.B, VOb.B, wall.edge.b]);

    /* Testing
    api.drawing.drawShape(shadow)
    */

    // Cache some values
    shadow.wall = wall;
    shadow.source = source;
    shadow.VT = VT;
    shadow.theta = theta;
    shadow.alpha = { A: alphaA, B: alphaB };

    return shadow;
  }

  /**
   * Intersect this shadow against a polygon and return a new shadow.
   * Copy relevant data from this shadow.
   * Used primarily by ElevatedVision to intersect against the sweep.
   */
  intersectPolygon(poly) {
    // Cannot rely on the super.intersectPolygon because we need to retrieve all the holes.
    const solution = this.clipperClip(poly, { cliptype: ClipperLib.ClipType.ctIntersection });

    return solution.map(pts => {
      const polyIx = PIXI.Polygon.fromClipperPoints(pts);
      const model = new this.constructor();
      Object.assign(model, polyIx);

      model.wall = this.wall;
      model.source = this.source;
      model.VT = this.VT;
      model.theta = this.theta;
      model.alpha = this.alpha;

      return model;
    });
  }

  /**
   * Construct a shadow using the following assumptions
   * - Origin is above the shadow surface
   * - Points A and B represent the top of the wall
   * - Wall has infinite bottom height, extending to A and B
   * - Wall A to bottom and B to bottom are orthogonal to coordinate plane
   * - Wall is 2d
   * - Surface plane can be oriented in various ways.
   * @param {Point3d} A   Top point of the wall
   * @param {Point3d} B   Top point of the wall. AB are parallel to XY plane.
   * @param {Point3d} origin      Viewer location.
   * @param {Plane} surfacePlane  Plane onto which to project shadow.
   * @returns {Point3d[]|null} Null if shadow not formed.
   *   Infinite shadows truncated to canvas maxR.
   */
  static complexSurfaceOriginAbove(A, B, origin, surfacePlane) {
    const upV = Shadow.upV;

    // Debugging
    // Direction of the surfacePlane in relation to the origin.
    const ixOrigin = surfacePlane.lineIntersection(origin, upV);
    if ( ixOrigin.z.almostEqual(origin.z) ) {
      console.warn("complexSurfaceOriginAbove origin is on the plane");
      return null;
    } else if ( origin.z < ixOrigin.z ) {
      console.warn("complexSurfaceOriginAbove origin is below the plane");
      return null;
    }

    // Truncate wall to be above the surface
    // Where does the (infinite) wall cross the surface?
    const ixAB = surfacePlane.lineSegmentIntersection(A, B);
    if ( ixAB ) {
      // Truncate wall to be above the surface
      // Can use the intersection point: will create a triangle shadow.
      // (Think flagpole shadow.)
      if ( A.z < ixAB.z ) {
        const newA = new CONFIG.GeometryLib.threeD.Point3d();
        const t = B.projectToAxisValue(A, 0, "z", newA);
        if ( !t || t < 0 || t > 1 ) return null; // Wall portion completely behind surface.
        if ( newA.almostEqual(B) ) return null;
        A = newA;
      } else if ( B.z < ixAB.z ) {
        const newB = new CONFIG.GeometryLib.threeD.Point3d();
        const t = A.projectToAxisValue(B, 0, "z", newB);
        if ( !t || t < 0 || t > 1 ) return null; // Wall portion completely behind surface.
        if ( newB.almostEqual(A) ) return null;
        B = newB;
      }

    } else if ( A.z < surfacePlane.point.z ) return null; // Does not cross the surface. Reject if endpoint is on the wrong side.

    // Intersection points of origin --> wall endpoint --> surface
    const ixOriginA = wallPointSurfaceIntersection(A, origin, surfacePlane);
    const ixOriginB = wallPointSurfaceIntersection(B, origin, surfacePlane);

    // Debugging
    if ( !ixOriginA || !ixOriginB ) {
      console.warn("complexSurfaceOriginAbove ixOriginA or ixOriginB is null");
      return null;
    }

    // If the intersection point is above the origin, then the surface is twisted
    // such that the surface is between the origin and the wall at that point.
    if ( !ixOriginA || !ixOriginB || ixOriginA.z > origin.z || ixOriginB.z > origin.z ) return null;

    // Find the intersection points of the wall with the surfacePlane
    const ixWallA = surfacePlane.lineIntersection(A, upV);

    // Unlikely, but possible?
    // if ( !ixWallA ) return null;

    const ixWallB = surfacePlane.lineIntersection(B, upV);

    // Unlikely, but possible?
    // if ( !ixWallB ) return null;

    // Debugging
    if ( !ixWallA || !ixWallB ) {
      console.warn("complexSurfaceOriginAbove ixWallA or ixWallB is null");
      return null;
    }

    // Surface intersection must be below the origin
    if ( origin.z < ixOriginA.z ) {
      console.warn("complexSurfaceOriginAbove origin.z < ixOriginA.z");
      return null;
    }

    if ( origin.z < ixOriginA.z ) {
      console.warn("complexSurfaceOriginAbove origin.z < ixOriginA.z");
      return null;
    }

    const pts = [
      ixWallA,
      ixOriginA,
      ixOriginA,
      ixWallB
    ];

    const out = new Shadow(pts);
    out._points3d = pts;
    return out;
  }

  /**
   * Construct shadow using strong assumptions about the set-up.
   * - Origin is above the shadow surface.
   * - Shadow surface assumed parallel to XY plane, such that it does not intersect AB or CD.
   * - Shadow surface elevation is at surfacePlane.point.z.
   * - Points A and B represent the top of the wall.
   * - Points C and D represent the bottom of the wall.
   * - AC is orthogonal to the XY plane, as is BD. AC and BD are parallel as are AB and CD.
   *   (Wall is a 2d rectangle on a plane, not a parallelogram.)
   * @param {Point3d} A   Top point of the wall
   * @param {Point3d} B   Top point of the wall. AB are parallel to XY plane.
   * @param {Point3d} C   Bottom point of the wall.
   * @param {Point3d} D   Bottom point of the wall. CD are parallel to XY plane. AC and BD are parallel.
   * @param {Point3d} origin      Viewer location.
   * @param {Plane} surfacePlane  Plane onto which to project shadow.
   * @returns {Shadow|null} Null if shadow not formed or if shadow would be equivalent to LOS
   *  because it is infinite and starts at the wall-surface intersection.
   */
  static simpleSurfaceOriginAbove(A, B, C, D, origin, surfacePlane) {
    const surfaceElevation = surfacePlane.point.z;
    if ( origin.z <= surfaceElevation ) {
      console.error("simpleSurfaceOriginAbove given origin below the surface plane.");
      return null;
    }

    if ( origin.z <= C.z ) return null; // Viewer is below the wall bottom.

    // Because the surfacePlane is parallel to XY, we can infer the intersection of the wall.
    const ixAC = new CONFIG.GeometryLib.threeD.Point3d(A.x, A.y, surfacePlane.point.z);
    const ixBD = new CONFIG.GeometryLib.threeD.Point3d(B.x, B.y, surfacePlane.point.z);

    const ixOriginA = wallPointSurfaceIntersection(A, origin, surfacePlane);
    const ixOriginB = wallPointSurfaceIntersection(B, origin, surfacePlane);

    // Debugging
    if ( !ixOriginA || !ixOriginB ) {
      console.warn("simpleSurfaceOriginAbove ixOriginA or ixOriginB is null");
      return null;
    }

    let ixOriginC;
    if ( C.z <= ixAC.z ) {
      // Wall bottom at C is below the surface, so shadow extends from wall --> surface intersection
      ixOriginC = ixAC;
    } else {
      // Established above that viewer is above the wall bottom.
      // Find origin --> C --> surface
      ixOriginC = surfacePlane.lineSegmentIntersection(origin, C);
    }

    let ixOriginD;
    if ( D.z <= ixBD.z ) {
      // Wall bottom at C is below the surface, so shadow extends from wall --> surface intersection
      ixOriginD = ixBD;
    } else {
      // Established above that viewer is above the wall bottom.
      // Find origin --> C --> surface
      ixOriginD = surfacePlane.lineSegmentIntersection(origin, D);
    }

    // Debugging
    if ( !ixOriginA || !ixOriginB ) {
      console.warn("simpleSurfaceOriginAbove ixOriginC or ixOriginBDis null");
      return null;
    }

    return new Shadow([
      ixOriginC,
      ixOriginA,
      ixOriginB,
      ixOriginD
    ]);
  }

  /**
   * Construct shadow using strong assumptions about the set-up.
   * - Origin is below the shadow surface.
   * - Shadow surface assumed nearly parallel to XY plane, such that it does not intersect AB or CD.
   * - Points A and B represent the top of the wall.
   * - Points C and D represent the bottom of the wall.
   * - AC is orthogonal to the XY plane, as is BD. AC and BD are parallel as are AB and CD.
   *   (Wall is a 2d rectangle on a plane, not a parallelogram.)
   * @param {Point3d} A   Top point of the wall
   * @param {Point3d} B   Top point of the wall. AB are parallel to XY plane.
   * @param {Point3d} C   Bottom point of the wall.
   * @param {Point3d} D   Bottom point of the wall. CD are parallel to XY plane. AC and BD are parallel.
   * @param {Point3d} origin      Viewer location.
   * @param {Plane} surfacePlane  Plane onto which to project shadow.
   * @returns {Shadow|null} Null if shadow not formed or if shadow would be equivalent to LOS
   *  because it is infinite and starts at the wall-surface intersection.
   */
  static simpleSurfaceOriginBelow(A, B, C, D, origin, surfacePlane) {
    // Turn everything upside down.
    A.z *= -1;
    B.z *= -1;
    C.z *= -1;
    D.z *= -1;
    origin.z *= -1;
    surfacePlane.point.z *= -1;

    const shadow = Shadow.simpleSurfaceOriginAbove(A, B, C, D, origin, surfacePlane);

    // Turn everything right-side up, just in case they are used elsewhere.
    A.z *= -1;
    B.z *= -1;
    C.z *= -1;
    D.z *= -1;
    origin.z *= -1;
    surfacePlane.point.z *= -1;

    return shadow;
  }

  /**
   * Construct shadow using strong assumptions about the set-up.
   * Shadow will be projected onto a surface parallel to XY plane at provided elevation.
   * @param {Wall} wall                 Wall placeable, with bottomZ and topZ properties.
   * @param {Point3d} origin            Viewer location in 3d space.
   * @param {number} surfaceElevation   Elevation of the surface onto which to project shadow.
   * @returns {Shadow|null}
   */
  static constructFromWall(wall, origin, surfaceElevation = 0) {
    const wallPoints = CONFIG.GeometryLib.threeD.Point3d.fromWall(wall, { finite: true });
    return Shadow.constructFromPoints3d(
      wallPoints.A.top,
      wallPoints.B.top,
      wallPoints.A.bottom,
      wallPoints.B.bottom,
      origin,
      surfaceElevation);
  }

  /**
   * Construct shadows from four 3d points, representing a wall.
   * @param {Point3d} A                 Top point of the wall
   * @param {Point3d} B                 Top point of the wall. AB are parallel to XY plane.
   * @param {Point3d} C                 Bottom point of the wall.
   * @param {Point3d} D                 Bottom point of the wall. CD are parallel to XY plane.
   *                                    AC and BD are parallel.
   * @param {Point3d} origin            Viewer location in 3d space.
   * @param {Plane}   surfaceElevation  Elevation of the surface onto which to project shadow.
   */
  static constructFromPoints3d(A, B, C, D, origin, surfaceElevation) {
    // If the viewer elevation equals the surface elevation, no shadows to be seen.
    if ( origin.z.almostEqual(surfaceElevation) ) return null;

    const topZ = A.z;
    const bottomZ = C.z;

    // Run simple tests to avoid further computation

    // Viewer and the surface elevation both above the wall, so no shadow
    if ( origin.z >= topZ && surfaceElevation >= topZ

      // Viewer and the surface elevation both below the wall, so no shadow
      || origin.z <= bottomZ && surfaceElevation <= bottomZ

      // Projecting downward from source; if below bottom of wall, no shadow.
      || origin.z >= surfaceElevation && origin.z <= bottomZ

      // Projecting upward from source; if above bottom of wall, no shadow.
      || origin.z <= surfaceElevation && origin.z >= topZ ) return null;

    const surfacePlane = new CONFIG.GeometryLib.threeD.Plane(new CONFIG.GeometryLib.threeD.Point3d(0, 0, surfaceElevation), Shadow.upV);
    return origin.z > surfaceElevation
      ? Shadow.simpleSurfaceOriginAbove(A, B, C, D, origin, surfacePlane)
      : Shadow.simpleSurfaceOriginBelow(A, B, C, D, origin, surfacePlane);
  }

  /**
   * Draw a shadow shape on canvas. Used for debugging.
   * Optional:
   * @param {HexString} color   Color of outline shape
   * @param {number} width      Width of outline shape
   * @param {HexString} fill    Color used to fill the shape
   * @param {number} fillAlpha      Alpha transparency between 0 and 1
   */
  draw({ color = CONFIG.GeometryLib.Draw.COLORS.gray, width = 1, fill = CONFIG.GeometryLib.Draw.COLORS.gray, fillAlpha = .5 } = {} ) {
    CONFIG.GeometryLib.Draw.shape(this, { color, width, fill, fillAlpha });
  }

  /**
   * Given a boundary polygon and an array of Shadows (holes), combine using Clipper.
   * @param {PIXI.Polygon} boundary   Polygon, such as an los polygon
   * @param {Shadow[]} shadows        Array of Shadows
   * @param {object} [options]    Options that vary Clipper results.
   * @param {number} [options.scalingFactor]  Scaling used for more precise clipper integers
   * @param {number} [options.cleanDelta]     Passed to ClipperLib.Clipper.CleanPolygons.
   * @returns {ClipperPaths|PIXI.Polygon} Array of Clipper paths representing the resulting combination.
   */
  static combinePolygonWithShadows(boundary, shadows, { scalingFactor = 1, cleanDelta = 0.1 } = {}) {
    if ( shadows instanceof PIXI.Polygon ) shadows = [shadows];

    if ( !shadows.length ) return boundary;

    const shadowPaths = CONFIG.GeometryLib.ClipperPaths.fromPolygons(shadows, { scalingFactor });

    // Make all the shadow paths orient the same direction
    shadowPaths.paths.forEach(path => {
      if ( !ClipperLib.Clipper.Orientation(path) ) path.reverse();
    });

    const combinedShadowPaths = shadowPaths.combine();
    combinedShadowPaths.clean(cleanDelta);

    const out = combinedShadowPaths.diffPolygon(boundary);
    out.clean(cleanDelta);
    return out;
  }
}

/**
 *
 */
function wallPointSurfaceIntersection(A, origin, surfacePlane) {
  // Viewer is above top of the wall, so find origin --> A --> surface
  if ( origin.z > A.z ) return surfacePlane.lineSegmentIntersection(origin, A);

  // Viewer is below top of the wall, so find far point to use
  const maxR2 = Math.pow(canvas.dimensions.maxR, 2);
  const rA = Ray.towardsPointSquared(origin, A, maxR2);
  const pA = new CONFIG.GeometryLib.threeD.Point3d(rA.B.x, rA.B.y, origin.z);
  return surfacePlane.lineIntersection(pA, Shadow.upV);
}

GEOMETRY_CONFIG.Shadow ??= Shadow;
GEOMETRY_CONFIG.ShadowProjection ??= ShadowProjection;
