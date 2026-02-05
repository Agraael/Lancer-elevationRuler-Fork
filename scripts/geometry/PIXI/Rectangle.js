/* globals
PIXI
*/
"use strict";

import "../Matrix.js";

export const PATCHES = {};
PATCHES.PIXI = {};

/**
 * Calculate area of rectangle
 * @returns {number}
 */
function area() {
  return this.width * this.height;
}

/**
 * Iterate over the rectangles's {x, y} points in order.
 * @param {object} [options]
 * @param {boolean} [options.close]   If close, include the first point again.
 * @returns {x, y} PIXI.Point
 */
function* iteratePoints({close = true} = {}) {
  const A = new PIXI.Point(this.x, this.y);
  yield A;
  yield new PIXI.Point(this.x + this.width, this.y);
  yield new PIXI.Point(this.x + this.width, this.y + this.height);
  yield new PIXI.Point(this.x, this.y + this.height);
  if ( close ) yield A;
}

/**
 * Iterate over the rectangle's edges in order.
 * (Use close = true to return the last --> first edge.)
 * @param {object} [options]
 * @param {boolean} [close]   If true, return last point --> first point as edge.
 * @returns Return an object { A: PIXI.Point, B: PIXI.Point} for each edge
 * Edges link, such that edge0.B === edge.1.A.
 */
function* iterateEdges({close = true} = {}) {
  const A = new PIXI.Point(this.x, this.y);
  const B = new PIXI.Point(this.x + this.width, this.y);
  yield { A, B };

  const C = new PIXI.Point(this.x + this.width, this.y + this.height);
  yield { A: B, B: C };

  const D = new PIXI.Point(this.x, this.y + this.height);
  yield { A: C, B: D };
  if ( close ) yield { A: D, B: A };
}

/**
 * Does this rectangle overlap something else?
 * @param {PIXI.Rectangle|PIXI.Circle|PIXI.Polygon} shape
 * @returns {boolean}
 */
function overlaps(shape) {
  if ( shape instanceof PIXI.Polygon ) { return this._overlapsPolygon(shape); }
  if ( shape instanceof PIXI.Circle ) { return this._overlapsCircle(shape); }
  if ( shape instanceof PIXI.Rectangle ) { return this._overlapsRectangle(shape); }
  if ( shape.toPolygon) return this._overlapsPolygon(shape.toPolygon());
  console.warn("overlaps|shape not recognized.", shape);
  return false;
}

/**
 * Does this rectangle envelop something else?
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
 * Does this rectangle overlap a circle?
 * @param {PIXI.Circle} circle
 * @return {boolean}
 */
function _overlapsCircle(circle) {
  // https://www.geeksforgeeks.org/check-if-any-point-overlaps-the-given-circle-and-rectangle

  // {xn,yn} is the nearest point on the rectangle to the circle center
  const xn = Math.max(this.left, Math.min(circle.x, this.right));
  const yn = Math.max(this.top, Math.min(circle.y, this.bottom));

  // Find the distance between the nearest point and the center of the circle
  const dx = xn - circle.x;
  const dy = yn - circle.y;
  return (Math.pow(dx, 2) + Math.pow(dy, 2)) <= Math.pow(circle.radius, 2);
}

/**
 * Does this rectangle overlap a polygon?
 * @param {PIXI.Polygon} poly
 * @return {boolean}
 */
function _overlapsPolygon(poly) {
  if ( poly.contains(this.left, this.top)
    || poly.contains(this.right, this.top)
    || poly.contains(this.left, this.bottom)
    || poly.contains(this.right, this.bottom)) return true;

  const pts = poly.iteratePoints({ close: true });
  let a = pts.next().value;
  if ( this.contains(a.x, a.y) ) return true;

  for ( const b of pts ) {
    if ( this.lineSegmentIntersects(a, b) || this.contains(b.x, b.y) ) return true;
    a = b;
  }

  return false;
}

/**
 * Does this rectangle overlap another?
 * @param {PIXI.Rectangle} other
 * @return {boolean}
 */
function _overlapsRectangle(rect) {
  // https://www.geeksforgeeks.org/find-two-rectangles-overlap
  // One rectangle is completely above the other
  if ( this.top > rect.bottom || rect.top > this.bottom ) return false;

  // One rectangle is completely to the left of the other
  if ( this.left > rect.right || rect.left > this.right ) return false;

  return true;
}

/**
 * Does this rectangle envelop another?
 * @param {PIXI.Rectangle} rect
 * @returns {boolean}
 */
function _envelopsRectangle(rect) {
  // All 4 points must be contained within.
  const { top, left, right, bottom } = rect;
  return (this.contains(left, top)
       && this.contains(right, top)
       && this.contains(right, bottom)
       && this.contains(left, bottom));
}

/**
 * Does this rectangle envelop a circle?
 * @param {PIXI.Circle} circle
 * @returns {boolean}
 */
function _envelopsCircle(circle) {
  // Center point must be contained.
  if ( !this.contains(circle.x, circle.y) ) return false;

  // Four compass points extending from the circle must be contained.
  const r = circle.radius;
  return (this.contains(circle.x - r, circle.y)   // W
       && this.contains(circle.x + r, circle.y)   // E
       && this.contains(circle.x, circle.y - r)   // N
       && this.contains(circle.x, circle.y + r)); // S
}

/**
 * Does this rectangle envelop a polygon?
 * @param {PIXI.Polygon} poly
 * @returns {boolean}
 */
function _envelopsPolygon(poly) {
  // All points of the polygon must be contained in the circle.
  const iter = poly.iteratePoints({ close: false });
  for ( const pt of iter ) {
    if ( !this.contains(pt.x, pt.y) ) return false;
  }
  return true;
}

/**
 * Move this rectangle by given x,y delta.
 * @param {number} dx
 * @param {number} dy
 * @returns {PIXI.Rectangle} New rectangle.
 */
function translate(dx, dy) {
  return new PIXI.Rectangle(this.x + dx, this.y + dy, this.width, this.height);
}

/**
 * Area that matches clipper measurements, so it can be compared with Clipper Polygon versions.
 * Used to match what Clipper would measure as area, by scaling the points.
 * @param {object} [options]
 * @param {number} [scalingFactor]  Scale like with PIXI.Polygon.prototype.toClipperPoints.
 * @returns {number}  Positive if clockwise. (b/c y-axis is reversed in Foundry)
 */
function scaledArea({scalingFactor = 1} = {}) {
  return this.toPolygon().scaledArea({scalingFactor});
}

/**
 * Returns the viewable of the rectangle that make up the viewable perimeter
 * as seen from an origin.
 * @param {Point} origin                  Location of the viewer, in 2d.
 * @param {object} [options]
 * @param {boolean} [options.outermostOnly]   Return only the outermost two points
 * @returns {Point[]|null}
 */
function viewablePoints(origin, { outermostOnly = true } = {}) {
  const pts = getViewablePoints(this, origin);

  if ( !pts || !outermostOnly ) return pts;

  const ln = pts.length;
  return [pts[0], pts[ln - 1]];
}

/**
 * Helper function to get all the viewable points
 * @param {PIXI.Rectangle} bbox   Bounding box of the shape
 * @param {Point} origin
 * @returns {Point[]|null}
 */
function getViewablePoints(bbox, origin) {
  const zones = PIXI.Rectangle.CS_ZONES;

  switch ( bbox._getZone(origin) ) {
    case zones.INSIDE: return null;
    case zones.TOPLEFT: return [
      { x: bbox.left, y: bbox.bottom },
      { x: bbox.left, y: bbox.top },
      { x: bbox.right, y: bbox.top }
    ];
    case zones.TOPRIGHT: return [
      { x: bbox.left, y: bbox.top },
      { x: bbox.right, y: bbox.top },
      { x: bbox.right, y: bbox.bottom }
    ];
    case zones.BOTTOMLEFT: return [
      { x: bbox.right, y: bbox.bottom },
      { x: bbox.left, y: bbox.bottom },
      { x: bbox.left, y: bbox.top }
    ];
    case zones.BOTTOMRIGHT: return [
      { x: bbox.right, y: bbox.top },
      { x: bbox.right, y: bbox.bottom },
      { x: bbox.left, y: bbox.bottom }
    ];
    case zones.RIGHT: return [{ x: bbox.right, y: bbox.top }, { x: bbox.right, y: bbox.bottom }];
    case zones.LEFT: return [{ x: bbox.left, y: bbox.bottom }, { x: bbox.left, y: bbox.top }];
    case zones.TOP: return [{ x: bbox.left, y: bbox.top }, { x: bbox.right, y: bbox.top }];
    case zones.BOTTOM: return [{ x: bbox.right, y: bbox.bottom }, { x: bbox.left, y: bbox.bottom }];
  }

  return undefined; // Should not happen
}

/**
 * Get the union between this rectangle and another.
 * @param {PIXI.Rectangle} other
 * @returns {PIXI.Rectangle} New, combined rectangle.
 */
function union(other) {
  const xMinMax = Math.minMax(this.left, other.left, this.right, other.right);
  const yMinMax = Math.minMax(this.top, other.top, this.bottom, other.bottom);
  return new PIXI.Rectangle(xMinMax.min, yMinMax.min, xMinMax.max - xMinMax.min, yMinMax.max - yMinMax.min);
}

/**
 * Get the difference between this rectangle and another.
 * If no overlap, will return null
 * @param {PIXI.Rectangle} other
 * @returns {null| {A: PIXI.Rectangle, B: PIXI.Rectangle}}
 *   A: portion of this rectangle
 *   B: portion of other rectangle
 */
function difference(other, recurse = true) {
  if ( this.right < other.x ) return null; // Left
  if ( this.bottom < other.y ) return null; // Top
  if ( this.x > other.right ) return null; // Right
  if ( this.y > other.bottom ) return null; // Bottom

  // Completely equal
  if ( this.x === other.x
    && this.y === other.y
    && this.width === other.width
    && this.height === other.height ) return null;

  // Options:
  // 1. One rectangle contains only 1 corner of the other.
  // 2. One rectangle contains 2 corners of the other.
  // 3. One rectangle contains 4 corners of the other (encompasses the other).

  const Acontained = this.contains(other.x, other.y);
  const Bcontained = this.contains(other.right, other.y);
  const Ccontained = this.contains(other.right, other.bottom);
  const Dcontained = this.contains(other.x, other.bottom);
  const nContained = Acontained + Bcontained + Ccontained + Dcontained;

  if ( nContained === 0 && recurse ) {
    // Other contains this rectangle
    const out = other.difference(this, false); // Set recurse = false to avoid endless loops if there is an error.
    [out.thisDiff, out.otherDiff] = [out.otherDiff, out.thisDiff];
    return out;
  }

  const g = PIXI.Rectangle.gridRectangles(this, other);
  const out = { thisDiff: [], otherDiff: [], g };
  switch ( nContained ) {
    case 1:
      if ( Acontained ) {
        out.thisDiff = [g.topLeft, g.topMiddle, g.centerLeft];
        out.otherDiff = [g.centerRight, g.bottomRight, g.bottomMiddle];
      } else if ( Bcontained ) {
        out.thisDiff = [g.topMiddle, g.topRight, g.centerRight];
        out.otherDiff = [g.centerLeft, g.bottomMiddle, g.bottomLeft];
      } else if ( Ccontained ) {
        out.thisDiff = [g.centerRight, g.bottomRight, g.bottomMiddle];
        out.otherDiff = [g.topLeft, g.topMiddle, g.centerLeft];
      } else if ( Dcontained ) {
        out.thisDiff = [g.centerLeft, g.bottomMiddle, g.bottomLeft];
        out.otherDiff = [g.topMiddle, g.topRight, g.centerRight];
      }
      break;
    case 2:
      if ( Acontained && Bcontained ) {
        out.thisDiff = [g.topLeft, g.topMiddle, g.topRight, g.centerRight, g.centerLeft];
        out.otherDiff = [g.bottomMiddle];
      } else if ( Bcontained && Ccontained ) {
        out.thisDiff = [g.topMiddle, g.topRight, g.centerRight, g.bottomRight, g.bottomMiddle];
        out.otherDiff = [g.centerLeft];
      } else if ( Ccontained && Dcontained ) {
        out.thisDiff = [g.centerRight, g.bottomRight, g.bottomMiddle, g.bottomLeft, g.centerLeft];
        out.otherDiff = [g.topMiddle];
      } else if ( Dcontained && Acontained ) {
        out.thisDiff = [g.topLeft, g.topMiddle, g.bottomMiddle, g.bottomLeft, g.centerLeft];
        out.otherDiff = [g.centerRight];
      }
      break;
    case 3: break; // Shouldn't happen
    case 4:
      // Same as case 0 but for thisDiff.
      out.thisDiff = [
        g.topLeft, g.topMiddle, g.topRight,
        g.centerLeft, g.centerRight,
        g.bottomLeft, g.bottomMiddle, g.bottomRight
      ];
      break;
  }

  out.thisDiff = out.thisDiff.filter(r => r.width > 0 && r.height > 0);
  out.otherDiff = out.otherDiff.filter(r => r.width > 0 && r.height > 0);
  return out;
}

/**
 * Determine the grid coordinates of all combinations of two rectangles.
 * Order of the two rectangles does not matter.
 * @param {PIXI.Rectangle} rect1    First rectangle
 * @param {PIXI.Rectangle} rect2    Second rectangle
 * @returns {object}  Object with 9 rectangles. Some may have zero width or height.
 */
function gridRectangles(rect1, rect2) {
  // Order the xs and ys
  const xArr = [rect1.x, rect1.right, rect2.x, rect2.right].sort((a, b) => a - b);
  const yArr = [rect1.y, rect1.bottom, rect2.y, rect2.bottom].sort((a, b) => a - b);

  const [x1, x2, x3, x4] = xArr;
  const [y1, y2, y3, y4] = yArr;

  const w1 = x2 - x1;
  const w2 = x3 - x2;
  const w3 = x4 - x3;

  const h1 = y2 - y1;
  const h2 = y3 - y2;
  const h3 = y4 - y3;

  return {
    topLeft: new PIXI.Rectangle(x1, y1, w1, h1),
    topMiddle: new PIXI.Rectangle(x2, y1, w2, h1),
    topRight: new PIXI.Rectangle(x3, y1, w3, h1),

    centerLeft: new PIXI.Rectangle(x1, y2, w1, h2),
    centerMiddle: new PIXI.Rectangle(x2, y2, w2, h2),
    centerRight: new PIXI.Rectangle(x3, y2, w3, h2),

    bottomLeft: new PIXI.Rectangle(x1, y3, w1, h3),
    bottomMiddle: new PIXI.Rectangle(x2, y3, w2, h3),
    bottomRight: new PIXI.Rectangle(x3, y3, w3, h3)
  };
}

/**
 * Cutaway a line segment start|end that moves through this rectangle.
 * @param {Point3d} a       Starting endpoint for the segment
 * @param {Point3d} b       Ending endpoint for the segment
 * @param {object} [opts]
 * @param {Point3d} [opts.start]              Starting endpoint for the segment
 * @param {Point3d} [opts.end]                Ending endpoint for the segment
 * @param {function} [opts.topElevationFn]    Function to calculate the top elevation for a position
 * @param {function} [opts.bottomElevationFn] Function to calculate the bottom elevation for a position
 * @param {number} [opts.isHole=false]        Treat this shape as a hole; reverse the points of the returned polygon
 * @returns {CutawayPolygon[]}
 */
function cutaway(a, b, opts) { return CONFIG.GeometryLib.CutawayPolygon.cutawayBasicShape(this, a, b, opts); }

/**
 * Rotate this rectangle around its center point.
 * @param {number} rotation               Rotation in degrees
 * @returns {PIXI.Rectangle|PIXI.Polygon} Polygon if the rotation is not multiple of 90º
 */
function rotateAroundCenter(rotation = 0) {
  rotation = normalizeDegrees(rotation);

  // Handle the simple cases where the shape is still a rectangle after rotation.
  if ( rotation === 0 || rotation === 180 ) return this.clone();
  const center = this.center;
  if ( rotation === 90 || rotation === 270 ) {
    const dx1_2 = center.x - this.x;
    const dy1_2 = center.y - this.y;
    return new PIXI.Rectangle(center.x - dy1_2, center.y - dx1_2, this.height, this.width);
  }

  // For all other rotations, translate center to 0,0, rotate, and then invert the translation.
  const tMat = CONFIG.GeometryLib.Matrix.translation(-center.x, -center.y);
  const rMat = CONFIG.GeometryLib.Matrix.rotationZ(Math.toRadians(rotation));
  const M = tMat.multiply3x3(rMat).multiply3x3(tMat.invert);
  const pts = [...this.iteratePoints({ close: true })];
  const tPts = pts.map(pt => M.multiplyPoint2d(pt));
  return new PIXI.Polygon(...tPts);
}

/**
 * Helper to normalize degrees to be between 0º–359º
 * @param {number} degrees
 * @returns {number}
 */
function normalizeDegrees(degrees) {
  const d = degrees % 360;
  return d < 0 ? d + 360 : d;
}


PATCHES.PIXI.STATIC_METHODS = { gridRectangles };

PATCHES.PIXI.GETTERS = { area };

PATCHES.PIXI.METHODS = {
  // Iterators
  iteratePoints,
  iterateEdges,

  // Other methods
  union,
  difference,
  translate,
  viewablePoints,

  // Overlap methods
  overlaps,
  _overlapsCircle,
  _overlapsPolygon,
  _overlapsRectangle,

  // Envelop methods
  envelops,
  _envelopsCircle,
  _envelopsRectangle,
  _envelopsPolygon,

  // Used by Elevation Ruler and Terrain Mapper
  cutaway,
  rotateAroundCenter,

  // Helper methods
  scaledArea
};
