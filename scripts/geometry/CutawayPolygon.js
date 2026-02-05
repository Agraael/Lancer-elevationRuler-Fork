/* globals
CONFIG,
PIXI
*/
"use strict";

import { GEOMETRY_CONFIG } from "./const.js";

/**
 * A cutaway polygon is a 2d representation of a vertical slice of a shape.
 * That slice is generally a quadrilateral but can be further modified by replacing
 * an edge with a set of points.
 */
class CutawayPolygon extends PIXI.Polygon {
  /** @type {Point3d} */
  start = new GEOMETRY_CONFIG.threeD.Point3d();

  /** @type {Point3d} */
  end = new GEOMETRY_CONFIG.threeD.Point3d();

  /** @type {number} */
  get top() { return this.getBounds().bottom; } // Y values are reversed.

  /** @type {number} */
  get bottom() { return this.getBounds().top; } // Y values are reversed.

  /**
   * Create a new polygon from a series of cutaway points.
   * @param {Point[]} pts
   * @param {Point3d} start
   * @param {Point3d} end
   * @returns {CutawayPolygon}
   */
  static fromCutawayPoints(pts, start, end) {
    const poly = new this(pts);
    poly.start.copyFrom(start);
    poly.end.copyFrom(end);
    return poly;
  }

  /**
   * Create a new polygon from an existing.
   * @param {PIXI.Polygon} poly    Polygon, already converted points
   * @param {Point3d} start
   * @param {Point3d} end
   * @returns {CutawayPolygon} New polygon
   */
  static _copyFromPolygon(poly, start, end) {
    const cutawayPoly = new this(poly.points);
    cutawayPoly.start.copyFrom(start);
    cutawayPoly.end.copyFrom(end);
    return cutawayPoly;
  }

  /**
   * Like _copyFromPolygon but uses the same poly points array instead of copying it.
   * @param {PIXI.Polygon} poly    Polygon, already converted points
   * @param {Point3d} start
   * @param {Point3d} end
   * @returns {CutawayPolygon} Polygon with the poly's points array
   */
  static _convertFromPolygon(poly, start, end) {
    const cutawayPoly = new this();
    cutawayPoly.points = poly.points;
    cutawayPoly.start.copyFrom(start);
    cutawayPoly.end.copyFrom(end);
    return cutawayPoly;
  }

  /**
   * Convert x,y to 3d position
   * @param {Point} {x, y}
   * @returns {RegionMovementWaypoint3d}
   */
  _from2d(pt2d) { return CONFIG.GeometryLib.utils.cutaway.from2d(pt2d, this.start, this.end); }

  /**
   * Convert 3d point to 2d position
   * @param {Point3d} {x, y, z}
   * @returns {PIXI.Point}
   */
  _to2d(pt3d) { return CONFIG.GeometryLib.utils.cutaway.to2d(pt3d, this.start, this.end); }

  /**
   * Insert steps along the top of this cutaway.
   * @param {function} stepsFn
   *   - @param {Point3d} a
   *   - @param {Point3d} b
   *   - @returns {Point3d[]} The cutpoints in 3d space
   */
  insertTopSteps(stepsFn) {
    const isHole = !this.isPositive;
    const pts = this.pixiPoints();
    const TL = pts[0];
    const TR = isHole ? pts[1] : pts[3];
    const TL3d = this._from2d(TL);
    const TR3d = this._from2d(TR);
    const steps = stepsFn(TL3d, TR3d);
    const steps2d = steps.map(step => this._to2d(step));
    if ( isHole ) this.points.slice(2, 0, ...steps2d.flatMap(step => [step.x, step.y]))
    else {
      steps2d.reverse();
      this.points.push(...steps2d.flatMap(step => [step.x, step.y]));
    }
  }

  /**
   * Intersect this cutaway quad based on a 3d segment.
   * @param {Point3d} a       Starting endpoint for the segment
   * @param {Point3d} b       Ending endpoint for the segment
   * @returns {PIXI.Point[]} The intersection points, marked as movingInto true/false.
   */
  intersectSegment3d(a, b) {
    const a2d = this._to2d(a);
    const b2d = this._to2d(b);
    const ixs = this.segmentIntersections(a2d, b2d).map(ix => PIXI.Point.fromObject(ix));
    if ( !ixs.length ) return ixs;

    // Shoelace in case the polygon is not simple. Right now, only b/c of steps.
    let isOutside = !this.contains(a2d.x, a2d.y);
    for ( const ix of ixs ) {
      ix.movingInto = isOutside;
      isOutside = !isOutside;
    }
    return ixs;
  }

  /**
   * Does this cutaway contain the 3d point when converted to 2d?
   * @param {Point3d} a       Point to test
   * @returns {boolean}
   */
  contains3d(a) {
    const a2d = this._to2d(a);
    return this.contains(a2d.x, a2d.y);
  }

  /**
   * Return 1+ quad cutaways for a given PIXI shape.
   * @param {PIXI.Polygon|PIXI.Rectangle|PIXI.Circle|PIXI.Ellipse} shape
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
  static cutawayBasicShape(shape, a, b, opts = {}) {
    if ( !shape.lineSegmentIntersects(a, b, { inside: true }) ) return [];
    opts.start ??= a;
    opts.end ??= b;

    const ixs = shape.segmentIntersections(a, b);
    if ( ixs.length === 0 ) return [this.quadCutaway(a, b, opts)];
    if ( ixs.length === 1 ) {
      const ix0 = CONFIG.GeometryLib.threeD.Point3d.fromObject(ixs[0]);
      ix0.t0 = ixs[0].t0;
      const a2 = a.to2d();
      const b2 = b.to2d();

      // Intersects only at start point.
      if ( ix0.t0.almostEqual(0) ) {
        const bInside = shape.contains(b.x, b.y);
        if ( bInside ) return [this.quadCutaway(a, b, opts)];

        // A is the end. Back up one to construct proper polygon and return.
        const newA = a2.towardsPoint(b2, -1);
        return [this.quadCutaway(newA, a, opts)];
      }

      // Intersects only at end point.
      if ( ix0.t0.almostEqual(1) ) {
        const aInside = shape.contains(a.x, a.y);
        if ( aInside ) return [this.quadCutaway(a, b, opts)];

        // B is at end. Move one step further from the end to construct proper polygon and return.
        const newB = b2.towardsPoint(a2, -1);
        return [this.quadCutaway(b, newB, opts)];
      }

      // Intersects somewhere along the segment.
      if ( shape.contains(a.x, a.y) ) return [this.quadCutaway(a, ix0, opts)];
      else return [this.quadCutaway(ix0, b, opts)];
    }

    // Handle 2+ intersections with a polygon shape.
    // More than 2 are possible if the polygon is not simple. May go in and out of it.
    ixs.sort((a, b) => a.t0 - b.t0);
    if ( !ixs.at(-1).t0.almostEqual(1) ) ixs.push(b);
    if ( ixs[0].t0.almostEqual(0) ) ixs.shift();

    // Shoelace: move in and out of the polygon, constructing a quad for every "in"
    // Go from a --> ix --> ... --> ix --> b unless last ix is at b.
    const quads = [];
    let prevIx = a;
    let isInside = shape.contains(prevIx.x, prevIx.y);
    for ( const ix of ixs ) {
      if ( isInside ) quads.push(this.quadCutaway(prevIx, ix, opts));
      isInside = !isInside;
      prevIx = ix;
    }
    return quads;
  }

  /**
   * Construct a single vertical quadrangle based on a line moving through a 3d polygon.
   * @param {Point3d} a               Starting cutaway point for the segment
   * @param {Point3d} b               Ending cutaway point for the segment
   * @param {object} [opts]
   * @param {Point3d} [opts.start]              Starting endpoint for the segment
   * @param {Point3d} [opts.end]                Ending endpoint for the segment
   * @param {function} [opts.topElevationFn]    Function to calculate the top elevation for a position
   * @param {function} [opts.bottomElevationFn] Function to calculate the bottom elevation for a position
   * @param {boolean} [opts.isHole=false]       Is this polygon a hole? If so, reverse points and use max/min elevations.
   * @returns {CutawayPolygon}
   */
  static quadCutaway(a, b, { start, end, topElevationFn, bottomElevationFn, isHole = false } = {}) {
    const to2d = CONFIG.GeometryLib.utils.cutaway.to2d;
    start ??= a;
    end ??= b;
    topElevationFn ??= () => 1e06;
    bottomElevationFn ??= () => -1e06;

    // Retrieve the pixel elevation for the a and b points. Holes should extend very high and very low so they cut everything.
    let topA, topB, bottomA, bottomB;
    topA = topB = 1e06;
    bottomA = bottomB = -1e06;
    if ( !isHole ) {
      if ( topElevationFn ) {
        topA = topElevationFn(a);
        topB = topElevationFn(b);
      }
      if ( bottomElevationFn ) {
        bottomA = bottomElevationFn(a);
        bottomB = bottomElevationFn(b);
      }
    }
    const a2d = to2d(a, start, end);
    const b2d = to2d(b, start, end);
    const TL = { x: a2d.x, y: topA };
    const TR = { x: b2d.x, y: topB };
    const BL = { x: a2d.x, y: bottomA };
    const BR = { x: b2d.x, y: bottomB };

    // _isPositive is y-down clockwise. For Foundry canvas, this is CCW.
    return isHole ? this.fromCutawayPoints([TL, TR, BR, BL], start, end) : this.fromCutawayPoints([TL, BL, BR, TR], start, end);
  }

  /**
   * Draw at 0,0.
   * Flip y so it faces up.
   * Change the elevation dimension to match.
   * Set min elevation to one grid unit below the scene.
   */
  draw(opts = {}) {
    const Draw = CONFIG.GeometryLib.Draw;
    const { convertToDistance, convertToElevation } = CONFIG.GeometryLib.utils.cutaway;
    opts.color ??= Draw.COLORS.red;
    opts.fill ??= Draw.COLORS.red;
    opts.fillAlpha ??= 0.3;
    const invertedPolyPoints = [];
    const pts = this.pixiPoints({ close: false });

    // Locate the minimum point that is above an arbitrarily low value so we don't draw excessively large polys.
    const LOWEST = CONFIG.GeometryLib.utils.gridUnitsToPixels(-100);
    const HIGHEST = CONFIG.GeometryLib.utils.gridUnitsToPixels(100);
    for ( let i = 0, n = pts.length; i < n; i += 1 ) {
      const { x, y } = pts[i];
      const pt = { x, y: -Math.clamp(y, LOWEST, HIGHEST) } // Arbitrary cutoff for low elevations.

      // Convert to smaller values for displaying.
      convertToDistance(pt);
      convertToElevation(pt);
      invertedPolyPoints.push(pt);
    }
    const invertedPoly = new PIXI.Polygon(...invertedPolyPoints);
    Draw.shape(invertedPoly, opts);
  }
}

GEOMETRY_CONFIG.CutawayPolygon = CutawayPolygon;