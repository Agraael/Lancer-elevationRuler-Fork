/* globals
PIXI
*/
"use strict";

export const PATCHES = {};
PATCHES.PIXI = {};

/**
 * Calculate the angle of a point in relation to a circle.
 * This is the angle of a line from the circle center to the point.
 * Reverse of PIXI.Circle.prototype.pointAtAngle.
 * @param {Point} point
 * @returns {number} Angle in radians.
 */
function angleAtPoint(point) {
  return Math.atan2(point.y - this.y, point.x - this.x);
}

/**
 * Determine the area of this circle
 * @returns {number}
 */
function area() {
  return Math.pow(this.radius, 2) * Math.PI;
}

/**
 * Move this circle by given x,y delta
 * @param {number} dx
 * @param {number} dy
 * @returns {PIXI.Circle} New circle
 */
function translate(dx, dy) {
  return new PIXI.Circle(this.x + dx, this.y + dy, this.radius);
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
 * Does this circle overlap something else?
 * @param {PIXI.Rectangle|PIXI.Circle|PIXI.Polygon|PIXI.Ellipse} other
 * @returns {boolean}
 */
function overlaps(other) {
  if ( other instanceof PIXI.Circle ) return this._overlapsCircle(other);
  if ( other instanceof PIXI.Polygon ) return other._overlapsCircle(this);
  if ( other instanceof PIXI.Rectangle ) return other._overlapsCircle(this);
  if ( other.toPolygon) return other.toPolygon()._overlapsCircle(this);
  console.warn("overlaps|shape not recognized.", other);
  return false;
}

/**
 * Does this circle envelop (completely enclose) something else?
 * This is a one-way test; call other.envelops(this) to test the other direction.
 * @param {PIXI.Rectangle|PIXI.Circle|PIXI.Polygon|PIXI.Ellipse} other
 * @returns {boolean}
 */
function envelops(other) {
  if ( other instanceof PIXI.Polygon ) return this._envelopsPolygon(other);
  if ( other instanceof PIXI.Circle ) return this._envelopsCircle(other);
  if ( other instanceof PIXI.Rectangle ) return this._envelopsRectangle(other);
  if ( other.toPolygon ) return this._envelopsPolygon(other.toPolygon());
  console.warn("envelops|shape not recognized.", other);
  return false;
}

/**
 * Detect overlap between this circle and another.
 * @param {PIXI.Circle} other
 * @returns {boolean}
 */
function _overlapsCircle(circle) {
  // Test distance between the two centers.
  // See https://www.geeksforgeeks.org/check-two-given-circles-touch-intersect/#
  const dist2 = PIXI.Point.distanceSquaredBetween(this, circle);
  const r1 = this.radius;
  const r2 = circle.radius;

  // Test for overlap using the radii.
  // if ( dist <= Math.pow(r1 - r2, 2) return true; // This (1) inside circle (2).
  // if ( dist <= Math.pow(r2 - r1, 2) ) return true; // Circle (2) inside this (1).
  // if ( dist < Math.pow(r1 + r2, 2) ) return true; // Circles intersect one another.
  // if ( dist === Math.pow(r1 + r2, 2) ) return true; // Circles touch.

  // Combine the above tests.
  if ( dist2 <= Math.pow(Math.abs(r1 - r2), 2) ) return true;
  if ( dist2 <= Math.pow(r1 + r2, 2) ) return true;
  return false;
}

/**
 * Detect whether this circle envelops another.
 * @param {PIXI.Circle} other
 * @returns {boolean}
 */
function _envelopsCircle(circle) {
  // Test distance between the two centers.
  // See https://www.geeksforgeeks.org/check-two-given-circles-touch-intersect/#
  const dist2 = PIXI.Point.distanceSquaredBetween(this, circle);
  const r1 = this.radius;
  const r2 = circle.radius;
  return (dist2 <= Math.pow(r1 - r2, 2));
}

/**
 * Detect whether this circle envelops a rectangle.
 * @param {PIXI.Rectangle} rect
 * @returns {boolean}
 */
function _envelopsRectangle(rect) {
  // All 4 points of the rectangle must be contained by the circle.
  const { top, left, right, bottom } = rect;
  return (this.contains(left, top)
      && this.contains(right, top)
      && this.contains(right, bottom)
      && this.contains(left, bottom));
}

/**
 * Detect whether this circle envelops a polygon.
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
 * Test whether line segment AB intersects this circle.
 * Equivalent to PIXI.Rectangle.prototype.lineSegmentIntersects.
 * @param {Point} a                       The first endpoint of segment AB
 * @param {Point} b                       The second endpoint of segment AB
 * @param {object} [options]              Options affecting the intersect test.
 * @param {boolean} [options.inside]      If true, a line contained within the circle will
 *                                        return true.
 * @returns {boolean} True if intersects.
 */
function lineSegmentIntersects(a, b, { inside = false } = {}) {
  const aContained = this.contains(a.x, a.y);
  const bContained = this.contains(b.x, b.y);
  if ( aContained && bContained ) return inside;
  return aContained || bContained;
}

/**
 * Cutaway a line segment start|end that moves through this circle.
 * Assumes a cylinder, not a sphere.
 * @param {Point3d} start     Starting endpoint for the segment
 * @param {Point3d} end       Ending endpoint for the segment
 * @param {object} [opts]
 * @param {number} [opts.top=1e06]        Top (elevation in pixel units) of the polygon
 * @param {number} [opts.bottom=-1e06]    Bottom (elevation in pixel units) of the polygon
 * @param {number} [opts.isHole=false]    Treat this shape as a hole; reverse the points of the returned polygon
 * @returns {CutawayPolygon[]}
 */
function cutaway(a, b, opts) { return CONFIG.GeometryLib.CutawayPolygon.cutawayBasicShape(this, a, b, opts); }

PATCHES.PIXI.GETTERS = { area };

PATCHES.PIXI.METHODS = {
  angleAtPoint,
  translate,
  scaledArea,
  lineSegmentIntersects,

  // Overlap methods
  overlaps,
  _overlapsCircle,

  // Envelop methods
  envelops,
  _envelopsCircle,
  _envelopsRectangle,
  _envelopsPolygon,

  cutaway
};
