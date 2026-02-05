/* globals
canvas,
CONFIG,
CONST,
game
*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */
"use strict";

import { roundNearWhole } from "../util.js";
import "./RegionMovementWaypoint3d.js";
import "../GridCoordinates.js";
import { GEOMETRY_CONFIG } from "../const.js";
import {
  GRID_DIAGONALS,
  gridDistanceBetween,
  alternatingGridDistance,
  getDirectPath,
  getOffsetDistanceFn } from "../grid_distance.js";


// ----- NOTE: 3d versions of Foundry typedefs ----- //

/**
 * @typedef {object} RegionMovementWaypoint3d
 * @property {number} x            The x-coordinates in pixels (integer).
 * @property {number} y            The y-coordinates in pixels (integer).
 * @property {number} elevation    The elevation in grid units.
 */

/**
 * Row, column, elevation coordinates of a grid space. Follows from GridOffset
 * The vertical assumes the grid cubes are stacked upon one another.
 * @typedef {object} GridOffset3d
 * @property {number} i     The row coordinate
 * @property {number} j     The column coordinate
 * @property {number} k     The elevation, where 0 is at the scene elevation, negative is below the scene.
 *   k * canvas.scene.dimensions.distance === elevation in grid units.
 */

/**
 * An offset of a grid space or a point with pixel coordinates.
 * @typedef {GridOffset3d|Point3d} GridCoordinates3d
 */


/**
 * A 3d point that can function as Point3d|GridOffset3d|RegionMovementWaypoint.
 * Links z to the elevation property.
 */
export class GridCoordinates3d extends GEOMETRY_CONFIG.threeD.RegionMovementWaypoint3d {
  static GRID_DIAGONALS = GRID_DIAGONALS;

  /**
   * Factory function that converts a GridOffset to GridCoordinates.
   * @param {GridOffset} offset
   * @param {number} [elevation]      Override the elevation in offset, if any. In grid units
   * @returns {GridCoordinates3d}
   */
  static fromOffset(offset, elevation) {
    const pt = new this();
    pt.setOffset(offset);
    if ( typeof elevation !== "undefined" ) pt.elevation = elevation;
    return pt;
  }

  /**
   * Factory function to determine the grid square/hex center for the point.
   * @param {Point3d}
   * @returns {GridCoordinate3d}
   */
  static gridCenterForPoint(pt) {
    pt = new this(pt.x, pt.y, pt.z);
    return pt.centerToOffset();
  }

  /**
   * Factory function that converts a Foundry GridCoordinates.
   * If the object has x,y,z,elevation properties, those are favored over i,j,k.
   * @param {object}
   * @returns {GridCoordinates3d}
   */
  static fromObject(obj) {
    const newObj = super.fromObject(obj);
    if ( Object.hasOwn(obj, "i") && !Object.hasOwn(obj, "x") ) newObj.i = obj.i;
    if ( Object.hasOwn(obj, "j") && !Object.hasOwn(obj, "y") ) newObj.j = obj.j;
    if ( Object.hasOwn(obj, "k")
      && !(Object.hasOwn(obj, "z")
        || Object.hasOwn(obj, "elevationZ")
        || Object.hasOwn(obj, "elevation")) ) newObj.k = obj.k;
    return newObj;
  }

  /** @type {number} */
  get i() { return canvas.grid.getOffset({ x: this.x, y: this.y }).i }

  /** @type {number} */
  get j() { return canvas.grid.getOffset({ x: this.x, y: this.y }).j }

  /** @type {number} */
  get k() { return this.constructor.unitElevation(CONFIG.GeometryLib.utils.pixelsToGridUnits(this.z)); }

  /** @type {number} */
  set i(value) { this.y = canvas.grid.getCenterPoint({ i: value, j: this.j }).y; }

  /** @type {number} */
  set j(value) { this.x = canvas.grid.getCenterPoint({ i: this.i, j: value }).x; }

  /** @type {number} */
  set k(value) { this.elevation = this.constructor.elevationForUnit(value); }

  /**
   * Faster than getting i and j separately.
   * @type {object}
   */
  get offset() {
    const o = canvas.grid.getOffset({ x: this.x, y: this.y });
    o.k = this.k;
    return o;
  }

  /**
   * Convert this point to a new one based on its offset.
   * Sets x,y,z to equal the top left for i,j,k
   * @returns {GridCoordinates3d} New object
   */
  get topLeft() {
    const tl = this.constructor.fromObject(canvas.grid.getTopLeftPoint({ x: this.x, y: this.y }));
    tl.z = CONFIG.GeometryLib.utils.gridUnitsToPixels(this.constructor.elevationForUnit(this.k));
    return tl;
  }

  /**
   * Convert this point to a new one based on its offset.
   * Sets x,y,z to equal the center for i,j,k
   * @returns {GridCoordinates3d} New object
   */
  get center() {
    const center = this.constructor.fromObject(canvas.grid.getCenterPoint({ x: this.x, y: this.y }));
    center.z = CONFIG.GeometryLib.utils.gridUnitsToPixels(this.constructor.elevationForUnit(this.k));
    return center;
  }

  /**
   * Convert this point to a RegionMovementWaypoint.
   * @returns {RegionMovementWaypoint3d}
   */
  toWaypoint() { return CONFIG.GeometryLib.threeD.RegionMovementWaypoint3d.fromObject(this); }

  /**
   * Change this point to a specific offset value.
   * Faster than setting each {i, j, k} separately.
   * @param {GridOffset} offset
   */
  setOffset(offset) {
    const { x, y } = canvas.grid.getCenterPoint(offset);
    this.x = roundNearWhole(x);
    this.y = roundNearWhole(y);
    this.elevation = roundNearWhole(this.constructor.elevationForUnit(offset.k || 0));
    return this;
  }

  /**
   * Change this point to a specific offset value in the 2d axes. Do not modify elevation.
   * Faster than setting each {i, j} separately.
   * @param {GridOffset} offset
   */
  setOffset2d(offset) {
    const { x, y } = canvas.grid.getCenterPoint(offset);
    this.x = roundNearWhole(x);
    this.y = roundNearWhole(y);
    return this;
  }

  /**
   * Center this point based on its current offset value.
   */
  centerToOffset() { return this.setOffset(this); }

  /**
   * Conversion to 2d.
   * @returns {GridCoordinates}
   */
  to2d() { return CONFIG.GeometryLib.GridCoordinates.fromObject(this); }

  /**
   * @returns {this}
   */
  to3d() { return this; }

  /**
   * Test if this offset is equal to another.
   * @param {GridOffset} other
   * @returns {boolean}
   */
  offsetsEqual(other) {
    return this.i === other.i && this.j === other.j && this.k === other.k;
  }

  /**
   * Test if this offset is equal to another in 2d (i,j).
   * @param {GridOffset} other
   * @returns {boolean}
   */
  offsetsEqual2d(other) {
    return this.i === other.i && this.j === other.j;
  }

  /**
   * Determine the number of diagonals based on two offsets.
   * If hexagonal, only elevation diagonals count.
   * @param {GridOffset} aOffset
   * @param {GridOffset} bOffset
   * @returns {number}
   */
  static numDiagonal(aOffset, bOffset) {
    if ( canvas.grid.isHexagonal ) return Math.abs(aOffset.k - bOffset.k);
    let di = Math.abs(aOffset.i - bOffset.i);
    let dj = Math.abs(aOffset.j - bOffset.j);
    let dk = Math.abs(aOffset.k - bOffset.k);
    const midAxis = di.between(dj, dk) ? di
      : dj.between(di, dk) ? dj : dk;
    return midAxis;
  }

  /**
   * Calculate the unit elevation for a given set of coordinates.
   * @param {number} elevation    Elevation in grid units
   * @returns {number} Elevation in number of grid steps.
   */
  static unitElevation(elevation) { return Math.round(elevation / canvas.scene.dimensions.distance); }

  /**
   * Calculate the grid unit elevation from unit elevation.
   * Inverse of `unitElevation`.
   * @param {number} k            Unit elevation
   * @returns {number} Elevation in grid units
   */
  static elevationForUnit(k) { return roundNearWhole(k * canvas.scene.dimensions.distance); }

  /**
   * Measure the distance between two points accounting for the current grid rules.
   * For square, this accounts for the diagonal rules. For hex, measures in number of hexes.
   * @param {Point3d} a
   * @param {Point3d} b
   * @param {function} [altGridDistFn]    Function generated from alternatingGridDistance; used for alternating rules
   * @param {GRID_DIAGONALS} [diagonals]  Diagonal rule to use
   * @returns {number} Distance, in grid units
   */
  static gridDistanceBetween = gridDistanceBetween;

  /**
   * Measure the distance between two offsets accounting for the current grid rules.
   * Uses `gridDistanceBetween`.
   * @param {GridOffset3d} aOffset
   * @param {GridOffset3d} bOffset
   * @param {function} [altGridDistFn]    Function generated from alternatingGridDistance; used for alternating rules
   * @param {GRID_DIAGONALS} [diagonals]  Diagonal rule to use
   * @returns {number} Distance, in grid units
   */
  static gridDistanceBetweenOffsets(aOffset, bOffset, opts) {
    return this.gridDistanceBetween(this.fromOffset(aOffset), this.fromOffset(bOffset), opts);
  }

  /**
   * Measure distance, offset, and cost for a given segment a|b.
   * Uses `gridDistanceBetween`.
   * @param {Point3d} a                   Start of the segment
   * @param {Point3d} b                   End of the segment
   * @param {object} [opts]
   * @param {number} [opts.numPrevDiagonal=0]   Number of diagonals thus far
   * @param {GRID_DIAGONALS} [opts.diagonals]   Diagonal rule to use
   * @returns {object}
   *   - @prop {number} distance          gridDistanceBetween for a|b
   *   - @prop {number} offsetDistance    gridDistanceBetweenOffsets for a|b
   *   - @prop {number} numDiagonal       Number of diagonals between the offsets if square or hex elevation
   */
  static gridMeasurementForSegment(a, b, { numPrevDiagonal = 0, diagonals }) {
    // Simpler version of Elevation Ruler's _measurePath function.
    diagonals ??= canvas.grid.diagonals;
    a = this.fromObject(a);
    b = this.fromObject(b);
    const altGridDistanceFn = this.alternatingGridDistanceFn();
    const offsetDistanceFn = this.getOffsetDistanceFn(numPrevDiagonal);
    const path3d = this.directPath(a, b);
    let distance = 0;
    let offsetDistance = 0;
    let prevPathPt = path3d[0];
    for ( let i = 1, n = path3d.length; i < n; i += 1 ) {
      const currPathPt = path3d[i];
      distance += this.gridDistanceBetween(prevPathPt, currPathPt, { altGridDistanceFn, diagonals })
      offsetDistance += offsetDistanceFn(prevPathPt, currPathPt);
      prevPathPt = currPathPt;
    }
    return { distance, offsetDistance, numDiagonal: offsetDistanceFn.diagonals };
  }

  static gridMeasurementForSegment2(a, b, { numPrevDiagonal = 0, diagonals }) {
    // Simpler version of Elevation Ruler's _measurePath function.
    diagonals ??= canvas.grid.diagonals;
    a = this.fromObject(a);
    b = this.fromObject(b);
    const altGridDistanceFn = this.alternatingGridDistanceFn();
    const offsetDistanceFn = this.getOffsetDistanceFn(numPrevDiagonal);
    const distance = this.gridDistanceBetween(a, b, { altGridDistanceFn, diagonals })
    const offsetDistance = offsetDistanceFn(a, b);
    return { distance, offsetDistance, numDiagonal: offsetDistanceFn.diagonals };
  }

  /**
   * Get the function to measure the offset distance for a given distance with given previous diagonals.
   * @param {number} [diagonals=0]
   * @returns {function}
   */
  static getOffsetDistanceFn = getOffsetDistanceFn;

  /**
   * Return a function that can repeatedly measure segments, tracking the alternating diagonals.
   */
  static alternatingGridDistanceFn = alternatingGridDistance;

  /**
   * Constructs a direct path grid, accounting for elevation and diagonal elevation.
   * @param {RegionMovementWaypoint3d} start
   * @param {RegionMovementWaypoint3d} end
   * @returns {GridCoordinates3d[]}
   */
  static directPath = getDirectPath

  static _directPathSquare = directPath3dSquare;

  static _directPathGridless = directPathGridless;

  /**
   * Construct a function to determine the offset cost for this canvas for a single 3d move on a square grid.
   * @param {number} numDiagonals
   * @returns {function}
   *   - @param {GridCoordinates3d} prevOffset
   *   - @param {GridCoordinates3d} currOffset
   *   - @returns {number}
   */
  static _singleOffsetDistanceFn(numDiagonals = 0) {
    const diagonals = canvas.grid.diagonals ?? game.settings.get("core", "gridDiagonals");
    const D = CONST.GRID_DIAGONALS;
    let nDiag = numDiagonals;
    let fn;
    if ( diagonals === D.ALTERNATING_1 || diagonals === D.ALTERNATING_2 ) {
      const kFn = diagonals === D.ALTERNATING_2
        ? () => nDiag & 1 ? 2 : 1
        : () => nDiag & 1 ? 1 : 2;
      fn = (prevOffset, currOffset) => {
        const isElevationMove = prevOffset.k !== currOffset.k;
        const isStraight2dMove = (prevOffset.i === currOffset.i) ^ (prevOffset.j === currOffset.j);
        const isDiagonal2dMove = (prevOffset.i !== currOffset.i) && (prevOffset.j !== currOffset.j);
        const s = isStraight2dMove ^ isElevationMove;
        const d1 = (isDiagonal2dMove && !isElevationMove) || (isStraight2dMove && isElevationMove);
        const d2 = isDiagonal2dMove && isElevationMove;
        if ( d1 || d2 ) nDiag++;
        const k = kFn();
        return (s + (k * d1) + (k * d2)) * canvas.grid.distance;
      };
    } else {
      let k = 1;
      let k2 = 1;
      switch ( diagonals ) {
        case D.EQUIDISTANT: k = 1; k2 = 1; break;
        case D.EXACT: k = Math.SQRT2; k2 = Math.SQRT3; break;
        case D.APPROXIMATE: k = 1.5; k2 = 1.75; break;
        case D.RECTILINEAR: k = 2; k2 = 3; break;
      }
      fn = (prevOffset, currOffset) => {
        // Straight if moving horizontal, vertical, or elevation. (straight or elevation)
        // Diagonal if moving *only* H + V, H + E, or V + E. (straight + elevation or diagonal2d)
        // Diagonal2 if moving H, V, and E. (diagonal2d + elevation)
        const isElevationMove = prevOffset.k !== currOffset.k;
        const isStraight2dMove = (prevOffset.i === currOffset.i) ^ (prevOffset.j === currOffset.j);
        const isDiagonal2dMove = (prevOffset.i !== currOffset.i) && (prevOffset.j !== currOffset.j);
        const s = isStraight2dMove ^ isElevationMove;
        const d1 = (isDiagonal2dMove && !isElevationMove) || (isStraight2dMove && isElevationMove);
        const d2 = isDiagonal2dMove && isElevationMove;
        return (s + (k * d1) + (k2 * d2)) * canvas.grid.distance;
      };
    }
    Object.defineProperty(fn, "diagonals", {
      get: () => nDiag
    });
    return fn;
  }

  // Temporary instances for performance.
  static _tmp = new this();
  static _tmp2 = new this();
  static _tmp3 = new this();
}

// ----- NOTE: GridlessGrid ----- //

/**
 * Constructs a direct path for a gridless scene.
 * @param {RegionMovementWaypoint3d} start
 * @returns {GridCoordinates3d[]}                 The sequence of grid offsets of a shortest, direct path
 * @abstract
 */
function directPathGridless(start, end) {
  // Simply the start and end, in GridCoordinates.
  start = GridCoordinates3d.fromObject(start);
  end = GridCoordinates3d.fromObject(end);

  // Center, although should be unnecessary in gridless.
  return [start.center, end.center];
}

// ----- NOTE: SquareGrid ----- //

/**
 * Constructs a direct path for a square grid, accounting for elevation and diagonal elevation.
 * @param {RegionMovementWaypoint3d} start
 * @param {RegionMovementWaypoint3d} end
 * @param {GridOffset[]} [path2d]             Optional path2d for the start and end waypoints.
 * @returns {GridCoordinates3d[]}
 */
function directPath3dSquare(start, end) {
  start = GridCoordinates3d.fromObject(start);
  end = GridCoordinates3d.fromObject(end);
  if ( start.offsetsEqual(end) ) return [start, end];
  const points = CONFIG.GeometryLib.utils.bresenhamLine3d(start.i, start.j, start.k, end.i, end.j, end.k);
  const path3d = [start];
  // Convert points to GridCoordinates3d. Start and end repeat; skip.
  for ( let i = 3, n = points.length - 3; i < n; i += 3 ) path3d.push(GridCoordinates3d.fromOffset({
    i: points[i],
    j: points[i + 1],
    k: points[i + 2] }));
  path3d.push(end);
  return path3d;
}




GEOMETRY_CONFIG.threeD.GridCoordinates3d ??= GridCoordinates3d;
