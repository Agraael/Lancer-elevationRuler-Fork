/* globals
PIXI,
WeilerAthertonClipper
*/
"use strict";

import { GEOMETRY_CONFIG } from "./const.js";

/* Testing
api = game.modules.get('tokenvisibility').api;
drawing = api.drawing

function rotatePoint(point, angle) {
  return {
    x: (point.x * Math.cos(angle)) - (point.y * Math.sin(angle)),
    y: (point.y * Math.cos(angle)) + (point.x * Math.sin(angle))
  };
}

function translatePoint(point, dx, dy) {
  return {
    x: point.x + dx,
    y: point.y + dy
  };
}

[d] = canvas.drawings.placeables

halfWidth = d.document.shape.width / 2;
halfHeight = d.document.shape.height / 2;
x = d.document.x + halfWidth;
y = d.document.y + halfHeight
rotation = d.document.rotation

e = new Ellipse(x, y, halfWidth, halfHeight, { rotation })
drawing.drawShape(e)

pts = [...e.toPolygon().iteratePoints()]
pts.forEach(pt => api.drawing.drawPoint(pt))

bounds = e.getBounds()
drawing.drawShape(bounds)
*/


/**
 * Ellipse class structured similarly to PIXI.Circle
 * - x, y center
 * - major, minor axes
 * - rotation
 */
export class Ellipse extends PIXI.Ellipse {
  /**
   * Default representation has the major axis horizontal (halfWidth), minor axis vertical (halfHeight)
   *
   * @param {Number}  x       Center of ellipse
   * @param {Number}  y       Center of ellipse
   * @param {Number}  halfWidth   Semi-major axis
   * @param {Number}  halfHeight   Semi-minor axis
   * Optional:
   * @param {Number}  rotation  Amount in degrees the ellipse is rotated
   */
  constructor(x, y, halfWidth, halfHeight, { rotation = 0 } = {}) {
    super(x, y, halfWidth, halfHeight);
    this.rotation = Math.normalizeDegrees(rotation);
    this.radians = Math.toRadians(this.rotation);

    this.major = Math.max(halfWidth, halfHeight);
    this.minor = Math.min(halfWidth, halfHeight);
    this.ratio = halfWidth / halfHeight;
    this.ratioInv = 1 / this.ratio;
  }

  /**
   * Construct an ellipse that mirrors that of a Drawing ellipse
   * @param {Drawing} drawing
   * @returns {Ellipse}
   */
  static fromDrawing(drawing) {
    const { x, y, rotation, shape } = drawing;
    const { width, height } = shape;

    const halfWidth = width * 0.5;
    const halfHeight = height * 0.5;
    const centeredX = x + halfWidth;
    const centeredY = y + halfHeight;

    const out = new this(centeredX, centeredY, halfWidth, halfHeight, { rotation });
    out._drawing = drawing; // For debugging
    return out;
  }

  /**
   * Center of the ellipse
   * @type {Point}
   */
  get center() { return { x: this.x, y: this.y }; }

  /**
   * Area of the ellipse
   * @type {number}
   */
  get area() { return Math.PI * this.width * this.height; }

  /**
   * Area that matches clipper measurements, so it can be compared with Clipper Polygon versions.
   * Used to match what Clipper would measure as area, by scaling the points.
   * @param {object} [options]
   * @param {number} [scalingFactor]  Scale like with PIXI.Polygon.prototype.toClipperPoints.
   * @returns {number}  Positive if clockwise. (b/c y-axis is reversed in Foundry)
   */
  scaledArea({scalingFactor = 1} = {}) {
    return this.toPolygon().scaledArea({scalingFactor});
  }

  /**
   * Shift from cartesian coordinates to the shape space.
   * @param {PIXI.Point} a
   * @param {PIXI.Point} [outPoint] A point-like object to store the result.
   * @returns {PIXI.Point}
   */
  fromCartesianCoords(a, outPoint) {
    outPoint ??= new PIXI.Point();
    a = PIXI.Point.fromObject(a);

    a.translate(-this.x, -this.y, outPoint).rotate(-this.radians, outPoint);
    return outPoint;
  }

  /**
   * Shift to cartesian coordinates from the shape space.
   * @param {Point} a
   * @param {PIXI.Point} [outPoint] A point-like object to store the result.
   * @returns {Point}
   */
  toCartesianCoords(a, outPoint) {
    outPoint ??= new PIXI.Point();
    a = PIXI.Point.fromObject(a);

    a.rotate(this.radians, outPoint).translate(this.x, this.y, outPoint);
    return outPoint;
  }

  toCircleCoords(a, outPoint) {
    outPoint ??= new PIXI.Point();

    outPoint.x = a.x * this.ratioInv;
    outPoint.y = a.y;
    return outPoint;
  }

  fromCircleCoords(a, outPoint) {
    outPoint ??= new PIXI.Point();

    outPoint.x = a.x * this.ratio;
    outPoint.y = a.y;

    return outPoint;
  }

  _toCircle() { return new PIXI.Circle(0, 0, this.height); }

  /**
   * Bounding box of the ellipse
   * @return {PIXI.Rectangle}
   */
  getBounds() {
    // Bounds rectangle measured from top left corner. x, y, width, height
    switch ( this.rotation ) {
      case 0:
      case 180:
        return new PIXI.Rectangle(this.x - this.width, this.y - this.height, this.width * 2, this.height * 2);

      case 90:
      case 270:
        return new PIXI.Rectangle(this.x - this.height, this.y - this.width, this.height * 2, this.width * 2);
    }

    // Default to bounding box of the radius circle
    return new PIXI.Rectangle(this.x - this.major, this.y - this.major, this.major * 2, this.major * 2);
  }

  /**
   * Test whether the ellipse contains a given point {x,y}.
   * @param {number} x
   * @param {number} y
   * @return {Boolean}
   */
  contains(x, y) {
    const { width, height } = this;
    if ( width <= 0 || height <= 0 ) return false;

    // Move point to Ellipse-space
    const pt = new PIXI.Point(x, y);
    this.fromCartesianCoords(pt, pt);

    // Reject if x is outside the bounds
    if ( pt.x < -width
      || pt.x > width
      || pt.y < -height
      || pt.y > height ) return false;

    // Just like PIXI.Ellipse.prototype.contains but we are already at 0, 0
    // Normalize the coords to an ellipse
    let normx = (pt.x / width);
    let normy = (pt.y / height);
    normx *= normx;
    normy *= normy;

    return (normx + normy <= 1);
  }

  /**
   * Determine if the point is on or nearly on this polygon.
   * @param {Point} point     Point to test
   * @param {number} epsilon  Tolerated margin of error
   * @returns {boolean}       Is the point on the circle within the allowed tolerance?
   */
  pointIsOn(point, epsilon = 1e-08) {
    const { width, height } = this;
    if ( width <= 0 || height <= 0 ) return false;

    // Move point to Ellipse-space
    const pt = PIXI.Point.fromObject(point);
    this.fromCartesianCoords(pt, pt);

    // Reject if x is outside the bounds
    if ( pt.x < -width
      || pt.x > width
      || pt.y < -height
      || pt.y > height ) return false;

    // Just like PIXI.Ellipse.prototype.contains but we are already at 0, 0
    // Normalize the coords to an ellipse
    let normx = (pt.x / width);
    let normy = (pt.y / height);
    normx *= normx;
    normy *= normy;
    return (normx + normy).almostEqual(1, epsilon);
  }


  /**
   * Convert to a polygon
   * @return {PIXI.Polygon}
   */
  toPolygon({ density } = {}) {
    // Default to the larger radius for density
    density ??= PIXI.Circle.approximateVertexDensity(this.major);

    // Translate to a circle to get the circle polygon
    const cirPoly = this._toCircle().toPolygon({ density });

    // Translate back to ellipse coordinates
    const cirPts = cirPoly.points;
    const ln = cirPts.length;
    const pts = Array(ln);
    for ( let i = 0; i < ln; i += 2 ) {
      const cirPt = new PIXI.Point(cirPts[i], cirPts[i + 1]);
      const ePt = new PIXI.Point();

      this.fromCircleCoords(cirPt, ePt);
      this.toCartesianCoords(ePt, ePt);

      pts[i] = ePt.x;
      pts[i+1] = ePt.y;
    }

    cirPoly.points = pts;
    return cirPoly;
  }

  /**
   * Get all the intersection points for a segment A|B
   * Intersections must be sorted from A to B
   * @param {Point} a
   * @param {Point} b
   * @returns {Point[]}
   */
  segmentIntersections(a, b) {
    // Translate to a circle.
    const cir = this._toCircle();

    // Move to ellipse coordinates and then to circle coordinates.
    a = this.toCircleCoords(this.fromCartesianCoords(a));
    b = this.toCircleCoords(this.fromCartesianCoords(b));

    // Get the intersection points and convert back to cartesian coords.
    // Add t0 to indicate distance from a, to match other segmentIntersection functions.
    const dist2 = PIXI.Point.distanceSquaredBetween(a, b);
    return cir.segmentIntersections(a, b).map(ix => {
      const newIx = this.toCartesianCoords(this.fromCircleCoords(ix));
      newIx.t0 =  Math.sqrt(PIXI.Point.distanceSquaredBetween(a, ix) / dist2);
      return newIx;
    });
  }

  /**
   * Does the segment a|b intersect this ellipse?
   * @param {Point} a
   * @param {Point} b
   * @returns {boolean} True if intersection occurs
   */
  lineSegmentIntersects(a, b) {
    // Translate to a circle.
    const cir = this._toCircle();

    // Move to ellipse coordinates and then to circle coordinates.
    a = this.toCircleCoords(this.fromCartesianCoords(a));
    b = this.toCircleCoords(this.fromCartesianCoords(b));

    // Test for intersection on the circle.
    return cir.lineSegmentIntersects(a, b);
  }

  /**
   * Get all the points for a polygon approximation of a circle between two points on the circle.
   * Points are clockwise from a to b.
   * @param { Point } a
   * @param { Point } b
   * @return { Point[]}
   */
  pointsBetween(a, b, { density } = {}) {
    // Default to the larger radius for density
    density ??= PIXI.Circle.approximateVertexDensity(this.major);

    // Translate to a circle
    const cir = this._toCircle();

    // Move to ellipse coordinates and then to circle coordinates
    a = this.toCircleCoords(this.fromCartesianCoords(a));
    b = this.toCircleCoords(this.fromCartesianCoords(b));

    // Get the points and translate back to cartesian coordinates
    const pts = cir.pointsBetween(a, b, { density });
    return pts.map(pt => this.toCartesianCoords(this.fromCircleCoords(pt)));
  }

  /**
   * Intersect this shape with a PIXI.Polygon.
   * Use WeilerAtherton to perform precise intersect.
   * @param {PIXI.Polygon} polygon      A PIXI.Polygon
   * @param {object} [options]          Options which configure how the intersection is computed
   * @param {number} [options.density]              The number of points which defines the density of approximation
   * @param {number} [options.clipType]             The clipper clip type
   * @param {string} [options.weilerAtherton=true]  Use the Weiler-Atherton algorithm. Otherwise, use Clipper.
   * @returns {PIXI.Polygon|null}       The intersected polygon or null if no solution was present
   */
  intersectPolygon(polygon, { density, clipType, weilerAtherton=true, ...options } = {}) {
    if ( !this.major || !this.minor ) return new PIXI.Polygon([]);

    // Default to the larger radius for density
    density ??= PIXI.Circle.approximateVertexDensity(this.major);
    clipType ??= WeilerAthertonClipper.CLIP_TYPES.INTERSECT;

    // Use Weiler-Atherton for efficient intersection or union.
    if ( weilerAtherton && polygon._isPositive ) {
      const res = WeilerAthertonClipper.combine(polygon, this, { clipType, density, ...options });
      if ( !res.length ) return new PIXI.Polygon([]);
      return res[0];
    }

    // Otherwise, use Clipper polygon intersection.
    const approx = this.toPolygon({ density });
    return polygon.intersectPolygon(approx, options);
  }

  /**
   * Return a quadrangle cutaway for this ellipse
   * @param {Point3d} a       Starting endpoint for the segment
   * @param {Point3d} b       Ending endpoint for the segment
   * @param {object} [opts]
   * @param {Point3d} [opts.start]              Starting endpoint for the segment
   * @param {Point3d} [opts.end]                Ending endpoint for the segment
   * @param {function} [opts.topElevationFn]    Function to calculate the top elevation for a position
   * @param {function} [opts.bottomElevationFn] Function to calculate the bottom elevation for a position
   * @param {function} [opts.cutPointsFn]       Function that returns the steps along the a|b segment top
   * @param {number} [opts.isHole=false]        Treat this shape as a hole; reverse the points of the returned polygon
   * @returns {PIXI.Polygon[]}
   */
  cutaway(a, b, opts) { return CONFIG.GeometryLib.CutawayPolygon.cutawayBasicShape(this, a, b, opts); }
}

GEOMETRY_CONFIG.Ellipse ??= Ellipse;