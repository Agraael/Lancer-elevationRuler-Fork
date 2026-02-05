/* globals
PIXI,
ClipperLib,
foundry,
CONFIG
*/
"use strict";

export const PATCHES = {};
PATCHES.PIXI = {};

/**
 * Calculate the area of this polygon.
 * Same approach as ClipperLib.Clipper.Area.
 * @param {object} options
 * @param {number|undefined} [scalingFactor]  If defined, will scale like with PIXI.Polygon.prototype.toClipperPoints.
 * @returns {number}  Positive rea
 */
function area() {
  return Math.abs(this.signedArea());
}

/**
 * Calculate the centroid of the polygon
 * https://en.wikipedia.org/wiki/Centroid#Of_a_polygon
 * @returns {Point}
 */
function centroid() {
  const pts = [...this.iteratePoints({close: true})];
  const ln = pts.length;
  switch ( ln ) {
    case 0: return undefined;
    case 1: return pts[0]; // Should not happen if close is true
    case 2: return pts[0];
    case 3: return PIXI.Point.midPoint(pts[0], pts[1]);
  }
  const outPoint = new PIXI.Point();
  let area = 0;
  const iter = ln - 1;
  for ( let i = 0; i < iter; i += 1 ) {
    const iPt = pts[i];
    const jPt = pts[i + 1];
    const ijX = (iPt.x + jPt.x);
    area += ijX * (iPt.y - jPt.y); // See signedArea function
    const mult = (iPt.x * jPt.y) - (jPt.x * iPt.y);
    outPoint.x += ijX * mult;
    outPoint.y += (iPt.y + jPt.y) * mult;
  }
  area = -area * 0.5;
  const areaMult = 1 / (6 * area);
  outPoint.x *= areaMult;
  outPoint.y *= areaMult;
  return outPoint;
}

/**
 * Clip a polygon with another.
 * Union, Intersect, diff, x-or
 * @param {PIXI.Polygon} poly   Polygon to clip against this one.
 * @param {object} [options]
 * @param {ClipperLib.ClipType} [options.cliptype]  Type of clipping
 * @return [ClipperLib.Paths[]] Array of Clipper paths
 */
function clipperClip(poly, { cliptype = ClipperLib.ClipType.ctUnion } = {}) {
  const subj = this.toClipperPoints();
  const clip = poly.toClipperPoints();

  const solution = new ClipperLib.Paths();
  const c = new ClipperLib.Clipper();
  c.AddPath(subj, ClipperLib.PolyType.ptSubject, true); // True to be considered closed
  c.AddPath(clip, ClipperLib.PolyType.ptClip, true);
  c.Execute(cliptype, solution);

  return solution;
}

/**
 * Convex hull algorithm.
 * Returns a polygon representing the convex hull of the given points.
 * Excludes collinear points.
 * Runs in O(n log n) time
 * @param {PIXI.Point[]} points
 * @returns {PIXI.Polygon}
 */
function convexHull(points) {
  const ln = points.length;
  if ( ln <= 1 ) return points;

  const newPoints = [...points];
  newPoints.sort(convexHullCmpFn);

  // Andrew's monotone chain algorithm.
  const upperHull = [];
  for ( let i = 0; i < ln; i += 1 ) {
    testHullPoint(upperHull, newPoints[i]);
  }
  upperHull.pop();

  const lowerHull = [];
  for ( let i = ln - 1; i >= 0; i -= 1 ) {
    testHullPoint(lowerHull, newPoints[i]);
  }
  lowerHull.pop();

  if ( upperHull.length === 1
    && lowerHull.length === 1
    && upperHull[0].x === lowerHull[0].x
    && upperHull[0].y === lowerHull[0].y ) return new PIXI.Polygon(upperHull);

  return new PIXI.Polygon(upperHull.concat(lowerHull));
}

/**
 * Comparison function used by convex hull function.
 * @param {Point} a
 * @param {Point} b
 * @returns {boolean}
 */
function convexHullCmpFn(a, b) {
  const dx = a.x - b.x;
  return dx ? dx : a.y - b.y;
}

/**
 * Test whether the polygon is oriented clockwise.
 * Cached property.
 * In v11, this was renamed to isPositive; this provides backward-compatibility.
 * @returns {boolean}
 */
function isClockwise() { return this.isPositive; }

/**
 * Test if a segment is enclosed by the polygon.
 * @param {Segment} segment      Segment denoted by A and B points.
 * @param {object} [options]  Options that affect the test
 * @param {number} [options.epsilon]      Tolerance when testing for equality
 * @returns {boolean} True is segment is enclosed by the polygon
 */
function isSegmentEnclosed(segment, { epsilon = 1e-08 } = {}) {
  const { A, B } = segment;
  const aInside = this.contains(A.x, A.y);
  const bInside = this.contains(B.x, B.y);

  // If either point outside, then not enclosed
  if ( !aInside || !bInside ) return false;

  // Could still (a) have an endpoint on an edge or (b) be an edge or (c) cross the polygon edge 2+ times.
  const points = this.points;
  const ln = points.length - 2;
  for ( let i = 0; i < ln; i += 2 ) {
    const edgeA = { x: points[i], y: points[i+1] };
    if ( edgeA.x.almostEqual(A.x, epsilon) && edgeA.y.almostEqual(A.y, epsilon) ) return false;
    if ( edgeA.x.almostEqual(B.x, epsilon) && edgeA.y.almostEqual(B.y, epsilon) ) return false;

    const edgeB = { x: points[i+2], y: points[i+3] };
    if ( edgeB.x.almostEqual(A.x, epsilon) && edgeB.y.almostEqual(A.y, epsilon) ) return false;
    if ( edgeB.x.almostEqual(B.x, epsilon) && edgeB.y.almostEqual(B.y, epsilon) ) return false;

    if ( foundry.utils.lineSegmentIntersects(edgeA, edgeB, A, B) ) return false;
  }

  return true;
}

/**
 * Iterate over the polygon's edges in order.
 * If the polygon is closed, the last two points will be ignored.
 * (Use close = true to return the last --> first edge.)
 * @param {object} [options]
 * @param {boolean} [close]   If true, return last point --> first point as edge.
 * @returns Return an object { A: {x, y}, B: {x, y}} for each edge
 * Edges link, such that edge0.B === edge.1.A.
 */
function* iterateEdges({close = true} = {}) {
  const ln = this.points.length;
  if ( ln < 4 ) return;

  const firstA = new PIXI.Point(this.points[0], this.points[1]);
  let A = firstA;
  for (let i = 2; i < ln; i += 2) {
    const B = new PIXI.Point(this.points[i], this.points[i + 1]);
    yield { A, B };
    A = B;
  }

  if ( close ) {
    const B = firstA;
    yield { A, B };
  }
}

/**
 * Iterate over the polygon's {x, y} points in order.
 * @param {object} [options]
 * @param {boolean} [options.close]   If close, include the first point again.
 * @returns {x, y} PIXI.Point
 */
function* iteratePoints({ close = true } = {}) {
  const ln = this.points.length;
  if ( ln < 2 ) return;

  const num = ln - (this.isClosed ? 2 : 0);
  for (let i = 0; i < num; i += 2) {
    yield new PIXI.Point(this.points[i], this.points[i + 1]);
  }

  if ( close ) yield new PIXI.Point(this.points[0], this.points[1]);
}

/**
 * Test if a line or lines crosses a polygon edge
 * @param {object[]} lines    Array of lines, with A and B PIXI.Points.
 * @returns {boolean}
 */
function linesCross(lines) {
  for ( const edge of this.iterateEdges() ) {
    for ( const line of lines ) {
      if ( CONFIG.GeometryLib.utils.lineSegmentCrosses(edge.A, edge.B, line.A, line.B) ) return true;
    }
  }

  return false;
}

/**
 * Test whether line segment AB intersects this polygon.
 * Equivalent to PIXI.Rectangle.prototype.lineSegmentIntersects.
 * @param {Point} a                       The first endpoint of segment AB
 * @param {Point} b                       The second endpoint of segment AB
 * @param {object} [options]              Options affecting the intersect test.
 * @param {boolean} [options.inside]      If true, a line contained within the rectangle will
 *                                        return true.
 * @returns {boolean} True if intersects.
 */
function lineSegmentIntersects(a, b, { inside = false } = {}) {
  if (this.contains(a.x, a.y) && this.contains(b.x, b.y) ) return inside;
  for ( const edge of this.pixiEdges()  ) {
    if ( foundry.utils.lineSegmentIntersects(a, b, edge.A, edge.B) ) return true;
  }

  return false;
}

/**
 * Get all intersection points for a segment A|B
 * Intersections are sorted from A to B.
 * @param {Point} a   Endpoint A of the segment
 * @param {Point} b   Endpoint B of the segment
 * @param {object} [options]    Optional parameters
 * @param {object[]} [options.edges]  Array of edges for this polygon, from this.iterateEdges.
 * @param {boolean} [options.indices] If true, return the indices for the edges instead of intersections
 * @returns {Point[]} Array of intersections or empty.
 *   If intersections returned, the t of each intersection is the distance along the a|b segment.
 */
function segmentIntersections(a, b, { indices = false } = {}) {
  const edges = this.pixiEdges();
  const ixIndices = [];
  edges.forEach((e, i) => {
    if ( foundry.utils.lineSegmentIntersects(a, b, e.A, e.B) ) ixIndices.push(i);
  });
  if ( indices ) return ixIndices;

  return ixIndices.map(i => {
    const edge = edges[i];
    return foundry.utils.lineLineIntersection(a, b, edge.A, edge.B);
  });
}

/**
 * Get all the points for this polygon between two points on the polygon
 * Points are clockwise from a to b.
 * @param { Point } a
 * @param { Point } b
 * @param {object} [options]    Optional parameters
 * @param {object[]} [options.edges]  Array of edges for this polygon, from this.iterateEdges.
 * @return { Point[]}
 */
function pointsBetween(a, b) {
  const edges = this.pixiEdges();
  const ixIndices = this.segmentIntersections(a, b, { indices: true });

  // A is the closest ix
  // B is the further ix
  // Anything else can be ignored
  let ixA = { t: Number.POSITIVE_INFINITY };
  let ixB = { t: Number.NEGATIVE_INFINITY };
  ixIndices.forEach(ix => {
    if ( ix.t < ixA.t ) ixA = ix;
    if ( ix.t > ixB.t ) ixB = ix;
  });

  // Start at ixA, and get intersection point at start and end
  const out = [];
  const startEdge = edges[ixA];
  const startIx = foundry.utils.lineLineIntersection(startEdge.A, startEdge.B, a, b);
  out.push(startIx);
  if ( !startEdge.B.almostEqual(startIx) ) out.push(startEdge.B);

  const ln = edges.length;
  for ( let i = startIx + 1; i < ln; i += 1 ) out.push(edges[i].B);

  if ( ixB < ixA ) {
    // Must circle around to the starting edge
    for ( let i = 0; i < ixB; i += 1 ) out.push(edges[i].B);
  }

  const endEdge = edges[ixB];
  const endIx = foundry.utils.lineLineIntersection(endEdge.A, endEdge.B, a, b);
  if ( !endEdge.A.almostEqual(endIx) ) out.push(endIx);

  return out;
}

/**
 * Does this polygon overlap something else?
 * @param {PIXI.Rectangle|PIXI.Circle|PIXI.Polygon|RegularPolygon} other
 * @returns {boolean}
 */
function overlaps(other) {
  if ( other instanceof PIXI.Polygon ) { return this._overlapsPolygon(other); }
  if ( other instanceof PIXI.Circle ) { return this._overlapsCircle(other); }
  if ( other instanceof PIXI.Rectangle ) { return other.overlaps(this); }
  if ( other.toPolygon) return this._overlapsPolygon(other.toPolygon());
  console.warn("overlaps|shape not recognized.", other);
  return false;
}

/**
 * Does this polygon envelop something else?
 * This is a one-way test; call other.envelops(this) to test the other direction.
 * @param {PIXI.Rectangle|PIXI.Circle|PIXI.Polygon} shape
 * @returns {boolean}
 */
function envelops(shape) {
  if ( shape instanceof PIXI.Polygon ) { return this._envelopsPolygon(shape); }
  if ( shape instanceof PIXI.Circle ) { return this._envelopsCircle(shape); }
  if ( shape instanceof PIXI.Rectangle ) { return this._envelopsRectangle(shape); }
  if ( shape.toPolygon) return this._envelopsPolygon(shape.toPolygon());
  console.warn("overlaps|shape not recognized.", shape);
  return false;
}

/**
 * Detect overlaps using brute force
 * @param {PIXI.Polygon} other
 * @returns {boolean}
 */
function _overlapsPolygon(other) {
  const polyBounds = this.getBounds();
  const otherBounds = other.getBounds();

  if ( !polyBounds.overlaps(otherBounds) ) return false;

  const pts1 = this.iteratePoints({ close: true });
  let a = pts1.next().value;
  if ( other.contains(a.x, a.y) ) return true;

  for ( const b of pts1 ) {
    if ( other.contains(b.x, b.y) ) return true;
    const pts2 = other.iteratePoints({ close: true });
    let c = pts2.next().value;
    for ( const d of pts2 ) {
      if ( foundry.utils.lineSegmentIntersects(a, b, c, d) || this.contains(d.x, d.y) ) return true;
      c = d;
    }
    a = b;
  }

  return false;
}


/**
 * Does this polygon overlap a circle?
 * @param {PIXI.Circle} circle
 * @returns {boolean}
 */
function _overlapsCircle(circle) {
  // If the circle center is contained, we are done.
  if ( this.contains(circle) ) return true;

  // If the bounding boxes of the circle and this polygon do not overlap, we are done.
  const polyBounds = this.getBounds();
  if ( !polyBounds.overlaps(circle.getBounds()) ) return false;

  // If the center of the circle is not contained, then the polygon cannot envelope the circle.
  // Therefore, some part of a polygon edge must be within the circle.
  const segments = this.iterateEdges({ close: true });
  for ( const s of segments ) {
    // Get point on the line closest to segment from circle center
    const c = foundry.utils.closestPointToSegment(circle, s.A, s.B);
    if ( circle.contains(c.x, c.y) ) return true;
  }

  return false;
}

/**
 * Does this polygon envelop another?
 * @param {PIXI.Polygon} poly
 * @returns {boolean}
 */
function _envelopsPolygon(poly) {
  // Not terribly efficient (sweepline would be better) but simple in concept.
  // Step 1: Check the bounding box.
  // (Could test both bounds, but it would iterate over the second polygon to create bounds.)
  if ( !this.getBounds().envelops(poly) ) return false;

  // Step 2: All polygon points must be contained.
  const iter = poly.iteratePoints({ close: false });
  for ( const pt of iter ) {
    if ( !this.contains(pt.x, pt.y) ) return false;
  }

  // Step 3: Cannot have intersecting lines.
  const edges = poly.iterateEdges();
  for ( const edge of edges ) {
    if ( this.lineSegmentIntersects(edge.A, edge.B) ) return false;
  }
  return true;
}

/**
 * Does this polygon envelop a rectangle?
 * @param {PIXI.Rectangle} rect
 * @returns {boolean}
 */
function _envelopsRectangle(rect) {
  // Step 1: All 4 points must be contained within.
  const { top, left, right, bottom } = rect;
  if ( !(this.contains(left, top)
       && this.contains(right, top)
       && this.contains(right, bottom)
       && this.contains(left, bottom)) ) return false;

  // Step 2: No intersecting edges.
  const edges = rect.iterateEdges();
  for ( const edge of edges ) {
    if ( this.lineSegmentIntersects(edge.A, edge.B) ) return false;
  }
  return true;
}

/**
 * Does this polygon envelop a circle?
 * @param {PIXI.Rectangle} rect
 * @returns {boolean}
 */
function _envelopsCircle(circle) {
  // Step 1: Center point must be contained.
  if ( !this.contains(circle.x, circle.y) ) return false;

  // Step 2: Circle cannot envelop this polygon.
  if ( circle._envelopsPolygon(this) ) return false;

  // Step 3: No intersecting edges.
  const edges = this.iterateEdges();
  for ( const edge of edges ) {
    const ixs = circle.segmentIntersections(edge.A, edge.B);
    if ( ixs.length ) return false;
  }
  return true;
}

/**
 * Use Clipper to pad (offset) polygon by delta.
 * @param {number} delta           Padding amount
 * @param {object} [options]       Options that affect the padding calculation.
 * @param {number} [miterLimit]    Value of at least 2 used to avoid sharp points.
 * @param {number} [scalingFactor] How to scale the coordinates when translating to/from integers.
 * @returns {PIXI.Polygon}
 */
function pad(delta, { miterLimit = 2, scalingFactor = 1 } = {}) {
  if ( miterLimit < 2) {
    console.warn("miterLimit for PIXI.Polygon.prototype.offset must be ≥ 2.");
    miterLimit = 2;
  }

  const solution = new ClipperLib.Paths();
  const c = new ClipperLib.ClipperOffset(miterLimit);
  c.AddPath(this.toClipperPoints({scalingFactor}), ClipperLib.JoinType.jtMiter, ClipperLib.EndType.etClosedPolygon);
  c.Execute(solution, delta);
  return PIXI.Polygon.fromClipperPoints(solution.length ? solution[0] : [], {scalingFactor});
}

/**
 * Scaled area of a polygon.
 * Used to match what Clipper would measure as area, by scaling the points.
 * @param {object} [options]
 * @param {number} [scalingFactor]  Scale like with PIXI.Polygon.prototype.toClipperPoints.
 * @returns {number}  Positive if clockwise. (b/c y-axis is reversed in Foundry)
 */
function scaledArea({ scalingFactor = 1 } = {}) {
  return signedArea.call(this, { scalingFactor });
}

/**
 * Signed area of polygon
 * Similar approach to ClipperLib.Clipper.Area.
 * @param {object} [options]
 * @param {number|undefined} [scalingFactor]  If defined, will scale like with PIXI.Polygon.prototype.toClipperPoints.
 * @returns {number}  Positive if clockwise. (b/c y-axis is reversed in Foundry)
 */
function signedArea({ scalingFactor } = {}) {
  const pts = [...this.iteratePoints({close: true})];

  if ( scalingFactor ) pts.forEach(pt => {
    pt.x = Math.round(pt.x * scalingFactor);
    pt.y = Math.round(pt.y * scalingFactor);
  });

  const ln = pts.length;
  if ( ln < 4 ) return 0; // Incl. closing point, should have 4

  // (first + second) * (first - second)
  // ...
  // (last + first) * (last - first)

  let area = 0;
  const iter = ln - 1;
  for ( let i = 0; i < iter; i += 1 ) {
    const iPt = pts[i];
    const jPt = pts[i + 1];
    area += (iPt.x + jPt.x) * (iPt.y - jPt.y);
  }

  if ( scalingFactor ) area /= Math.pow(scalingFactor, 2);

  return -area * 0.5;
}


/**
 * Test the point against existing hull points.
 * @parma {PIXI.Point[]} hull
 * @param {PIXI.Point} point
*/
function testHullPoint(hull, p) {
  while ( hull.length >= 2 ) {
    const q = hull[hull.length - 1];
    const r = hull[hull.length - 2];
    // TO-DO: Isn't this a version of orient2d? Replace?
    if ( (q.x - r.x) * (p.y - r.y) >= (q.y - r.y) * (p.x - r.x) ) hull.pop();
    else break;
  }
  hull.push(p);
}

/**
 * Translate, shifting this polygon in the x and y direction.
 * @param {Number} dx  Movement in the x direction.
 * @param {Number} dy  Movement in the y direction.
 * @return {PIXI.Polygon} New PIXI.Polygon
 */
function translate(dx, dy) {
  const pts = [];
  const ln = this.points.length;
  for (let i = 0; i < ln; i += 2) {
    pts.push(this.points[i] + dx, this.points[i + 1] + dy);
  }
  const out = new this.constructor(pts);
  out._isPositive = this._isPositive;
  if ( this.bounds ) out.bounds = out.getBounds(); // Bounds will have changed due to translate

  return out;
}

/**
 * Helper for viewablePoints to slice an array in a circle if the end is before the start.
 * https://stackoverflow.com/questions/57138153/slice-from-beginning-if-array-ended-javascript
 * @param {Array} arr       Array to slice
 * @param {number} start    Starting index
 * @param {number} end      Ending index. Can be less than start.
 * @returns {Array}
 */
function wrapslice(arr, start, end) {
  return end < start
    ? arr.slice(start).concat(arr.slice(0, end))
    : arr.slice(start, end);
}

/**
 * Helper function for viewablePoints.
 * Test if an angle is maximum compared to some other angle
 * @param {PIXI.Point} pt
 * @param {PIXI.Point} origin
 * @param {PIXI.Point} center
 * @param {number} angle
 * @param {number} maxAngle
 * @returns {boolean}
 */
function testMaxCWAngle(pt, origin, center, angle, maxAngle) {
  if ( angle < maxAngle ) return false;
  if ( foundry.utils.orient2dFast(origin, center, pt) > 0 ) return false; // CCW

  // If the angles are equal, pick the closest point.
  const dist2Between = PIXI.Point.distanceSquaredBetween;
  if ( angle === maxAngle ) return dist2Between(origin, pt) < dist2Between(origin, pt);
  return true;
}

function testMaxCCWAngle(pt, origin, center, angle, maxAngle) {
  if ( angle < maxAngle ) return false;
  if ( foundry.utils.orient2dFast(origin, center, pt) < 0 ) return false; // CW

  // If the angles are equal, pick the closest point.
  const dist2Between = PIXI.Point.distanceSquaredBetween;
  if ( angle === maxAngle ) return dist2Between(origin, pt) < dist2Between(origin, pt);
  return true;
}

/**
 * Returns the points of the polygon that make up the viewable perimeter
 * as seen from an origin.
 * @param {Point} origin                  Location of the viewer, in 2d.
 * @param {object} [options]
 * @param {boolean} [options.returnKeys]      Return index of viewable points instead of points
 * @param {boolean} [options.outermostOnly]   Return only the outermost two points
 * @returns {Point[]|number[]}
 */
function viewablePoints(origin, { returnKeys = false, outermostOnly = false } = {}) {

  // Viewable point is a line from origin to the point that does not intersect the polygon
  // the outermost key points are the most ccw and cw of the key points.
  // Get the most clockwise and counterclockwise from the origin point that do not intersect.
  // Store point keys in a set; for each edge, remove if origin --> point intersects the edge.
  // Remainder in set are viewable points.
  // It is possible that if the polygon is not simple, one or more points that are on the
  // viewable side

  const pts = [...this.iteratePoints({ close: false })];

  // Handle degenerate polygons.
  // Also, if the polygon contains this origin, use all points of the polygon.
  // Technically possible for the polygon to be complex and have some points blocked but not relevant
  // for Foundry use cases.
  const nPoints = pts.length;
  if ( nPoints < 3 || this.contains(origin.x, origin.y) ) {
    // Test if we have a single line segment collinear to the origin; keep the closest point.
    if ( nPoints === 2 && !foundry.utils.orient2dFast(origin, pts[0], pts[1]) ) {
      if ( PIXI.Point.distanceSquaredBetween(origin, pts[0]) < PIXI.Point.distanceSquaredBetween(origin, pts[1]) ) pts.pop();
      else pts.shift();
    }

    if ( returnKeys ) return Array.fromRange(pts.length);
    return pts;
  }
  // Find the points with the largest angle from center --> origin --> pt.
  // These form the viewing triangle between origin and polygon.
  // Widest points on either side of the polygon must be viewable.
  // A point not viewable on one side of polygon center would be blocked by a point with a
  // larger angle. Thus the point with the largest angle must be viewable.
  // If two points have the same angle, pick the closer. (Edge is collinear with origin.)
  // Only pick points after segregating into cw/ccw.

  const center = this.center;
  let cwPt;
  let ccwPt;
  let cwIdx = -1;
  let ccwIdx = -1;
  let maxCWAngle = Number.NEGATIVE_INFINITY;
  let maxCCWAngle = Number.NEGATIVE_INFINITY;

  for ( let i = 0; i < nPoints; i += 1 ) {
    const pt = pts[i];
    const angle = PIXI.Point.angleBetween(center, origin, pt);
    if ( testMaxCWAngle(pt, origin, center, angle, maxCWAngle) ) {
      cwPt = pt;
      maxCWAngle = angle;
      cwIdx = i;
    }
    if ( testMaxCCWAngle(pt, origin, center, angle, maxCCWAngle) ) {
      ccwPt = pt;
      maxCCWAngle = angle;
      ccwIdx = i;
    }
  }

  // Given the starting max angles, should not happen.
  if ( !cwPt ) cwPt = ccwPt;
  if ( !ccwPt ) ccwPt = cwPt;

  // Should have defined both by now.
  if ( !cwPt ) {
    console.warn("viewablePoints|Points not found", this);
    return [];
  }

  if ( cwPt.equals(ccwPt) ) return returnKeys ? [cwIdx] : [cwPt];

  if ( outermostOnly ) {
    if ( returnKeys ) return [cwIdx, ccwIdx];
    return [cwPt, ccwPt];
  }

  if ( returnKeys ) {
    // Sequentially number the indices, from cwIdx to ccwIdx. Make sure to wrap counting if needed.
    const ln = pts.length;
    const indices = [];
    for ( let i = 0; i < ln; i += 1 ) {
      const j = (cwIdx + i) % ln;
      indices.push(j);
      if ( j === ccwIdx ) break;
    }
    return indices;
  }

  // Viewable will always be from cwIdx to ccwIdx, not inclusive, b/c that is forward half for origin --> center.
  return wrapslice(pts, cwIdx, ccwIdx + 1);
}

/**
 * Get elements of an array by a list of indices
 * https://stackoverflow.com/questions/43708721/how-to-select-elements-from-an-array-based-on-the-indices-of-another-array-in-ja
 * @param {Array} arr       Array with elements to select
 * @param {number[]} indices   Indices to choose from arr. Indices not in arr will be undefined.
 * @returns {Array}
 */
export function elementsByIndex(arr, indices) {
  return indices.map(aIndex => arr[aIndex]);
}

/**
 * "Clean" this polygon and return a new one:
 * 1. No repeated points, including nearly equal points.
 * 2. No collinear points
 * 3. No closed point
 * 4. Clockwise orientation
 * @returns {PIXI.Polygon}    This polygon
 */
function clean({epsilon = 1e-8, epsilonCollinear = 1e-12} = {}) {
  if ( this.points.length < 6 ) return this;

  const pts = this.iteratePoints({close: true});
  let prev = pts.next().value;
  let curr = pts.next().value;
  const cleanPoints = [prev.x, prev.y];
  for ( const next of pts ) {
    if ( curr.almostEqual(prev, epsilon) ) {
      curr = next;
      continue;
    }
    if ( foundry.utils.orient2dFast(prev, curr, next).almostEqual(0, epsilonCollinear) ) {
      curr = next;
      continue;
    }
    cleanPoints.push(curr.x, curr.y);
    prev = curr;
    curr = next;
  }

  // Check for and remove closing point.
  const ln = cleanPoints.length;
  if ( cleanPoints[0] === cleanPoints[ln - 2]
    && cleanPoints[1] === cleanPoints[ln - 1] ) {

    cleanPoints.pop();
    cleanPoints.pop();
  }

  // Set the points and reset clockwise
  this.points = cleanPoints;
  this._isPositive = undefined;
  if ( !this.isClockwise ) this.reverseOrientation();
  return this;
}

/**
 * Key the polygon by using JSON.stringify on the points.
 * To ensure polygons are the same even if the starting vertex is rotated,
 * find the minimum point as the start.
 */
function key() {
  const points = [...this.points];
  const ln = this.isClosed ? points.length - 2 : points.length;
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let minIndex = -1;
  for ( let i = 0; i < ln; i += 2 ) {
    const x = points[i];
    const y = points[i + 1];
    if ( (x < minX || x === minX) && y < minY ) {
      minIndex = i;
      minX = x;
      minY = y;
    }
  }
  const startPoints = points.splice(minIndex);
  startPoints.push(...points);
  return JSON.stringify(startPoints);
}

/**
 * Test for equality between two polygons.
 * 1. Same points
 * 2. In any order, but orientation counts.
 * @param {PIXI.Polygon} other
 * @returns {boolean}
 */
function equals(other) {
  if ( this.points.length !== other.points.length ) return false;
  if ( this.isClockwise ^ other.isClockwise ) return false;

  const thisPoints = this.iteratePoints({close: false});
  const otherPoints = [...other.iteratePoints({close: false})];

  // Find the matching point
  const startPoint = thisPoints.next().value;
  const startIdx = otherPoints.findIndex(pt => pt.equals(startPoint));
  if ( !~startIdx ) return false;

  // Test each point sequentially from each array
  let k = startIdx + 1; // +1 b/c already tested startPoint.
  const nPoints = otherPoints.length;
  for ( const thisPoint of thisPoints ) {
    k = k % nPoints;
    if ( !thisPoint.equals(otherPoints[k]) ) return false;
    k += 1;
  }

  return true;
}

/**
 * Cutaway a line segment start|end that moves through this polygon.
 * Depending on the line and the polygon, could have multiple quads.
 * @param {Point3d} a     Starting endpoint for the segment
 * @param {Point3d} b       Ending endpoint for the segment
 * @param {object} [opts]
 * @param {Point3d} [opts.start]              Starting endpoint for the segment
 * @param {Point3d} [opts.end]                Ending endpoint for the segment
 * @param {number} [opts.top=1e06]        Top (elevation in pixel units) of the polygon
 * @param {number} [opts.bottom=-1e06]    Bottom (elevation in pixel units) of the polygon
 * @returns {CutawayPolygon[]}
 */
function cutaway(a, b, opts = {}) {
  return CONFIG.GeometryLib.CutawayPolygon.cutawayBasicShape(this, a, b, { isHole: !this.isPositive, ...opts }); // Avoid setting the isHole parameter in opts; will get overriden if set in opts.
}

/**
 * Get the points of this polygon.
 * Use a proxy to monitor changes to the points array.
 * Note this does not include the first point.
 * @param {boolean} [options.close]   If close, include the first point again.
 * @returns {PIXI.Point[]}
 */
function pixiPoints({ close = true } = {}) {
  if ( !this._pixiPoints ) {
    if ( !this._pixiPointsProxy ) {
      // See https://stackoverflow.com/questions/5100376/how-to-watch-for-array-changes
      // We cannot access the constructor, so do it the hard way.
      this._pixiPointsProxy = true;
      const selfPoly = this;
      this.points = new Proxy(this.points, {
        deleteProperty: (target, property) => {
          delete target[property];
          selfPoly._pixiPoints = undefined;
          selfPoly._pixiEdges = undefined;
          return true;
        },
        set: (target, property, value, receiver) => {
          target[property] = value;
          selfPoly._pixiPoints = undefined;
          selfPoly._pixiEdges = undefined;
          return true;
        }
      });
    }
    this._pixiPoints = [...this.iteratePoints({ close: true })];
  }
  return close ? this._pixiPoints : this._pixiPoints.slice(0, -1);
}

/**
 * Get the edges of this polygon.
 * Use a proxy to monitor changes to the points array.
 * Includes the closing edge.
 * @returns {object[{A, B}]}
 *   - @prop {PIXI.Point} A
 *   - @prop {PIXI.Point} B
 */
function pixiEdges({ close = true } = {}) {
  if ( !this._pixiEdges ) {
    if ( !this._pixiPointsProxy ) {
      // See https://stackoverflow.com/questions/5100376/how-to-watch-for-array-changes
      // We cannot access the constructor, so do it the hard way.
      this._pixiPointsProxy = true;
      const selfPoly = this;
      this.points = new Proxy(this.points, {
        deleteProperty: (target, property) => {
          delete target[property];
          selfPoly._pixiPoints = undefined;
          selfPoly._pixiEdges = undefined;
          return true;
        },
        set: (target, property, value, receiver) => {
          target[property] = value;
          selfPoly._pixiPoints = undefined;
          selfPoly._pixiEdges = undefined;
          return true;
        }
      });
    }
    this._pixiEdges = [...this.iterateEdges({ close: true })];
  }
  return close ? this._pixiEdges : this._pixiEdges.slice(0, -1);
}


PATCHES.PIXI.GETTERS = {
  area,
  center: centroid,
  isClockwise,
  key
};

PATCHES.PIXI.METHODS = {
  // Iterators
  iterateEdges,
  iteratePoints,

  // Cached
  pixiPoints,
  pixiEdges,

  // Other methods
  toPolygon: function() { return this; },
  clean,
  clipperClip,
  equals,
  isSegmentEnclosed,
  linesCross,
  lineSegmentIntersects,
  pad,
  segmentIntersections,
  pointsBetween,
  translate,
  viewablePoints,

  // Overlap methods
  overlaps,
  _overlapsPolygon,
  _overlapsCircle,

  // Envelop methods
  envelops,
  _envelopsCircle,
  _envelopsRectangle,
  _envelopsPolygon,

  // 2d cutaway
  cutaway,

  // Helper/internal methods
  scaledArea
};

PATCHES.PIXI.STATIC_METHODS = {
  convexHull
};

