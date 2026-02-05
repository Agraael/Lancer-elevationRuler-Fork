/* globals
canvas,
CONFIG,
PIXI
*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */
"use strict";

import "./3d/GridCoordinates3d.js";
import { GEOMETRY_CONFIG } from "./const.js";
import {
  GRID_DIAGONALS,
  gridDistanceBetween,
  alternatingGridDistance,
  getOffsetDistanceFn } from "./grid_distance.js";


// ----- NOTE: Foundry typedefs  ----- //

/**
 * A pair of row and column coordinates of a grid space.
 * @typedef {object} GridOffset
 * @property {number} i    The row coordinate
 * @property {number} j    The column coordinate
 */

/**
 * An offset of a grid space or a point with pixel coordinates.
 * @typedef {GridOffset|Point} GridCoordinates
 */



/**
 * A 2d point that can function as Point|GridOffset. For just a point, use PIXI.Point.
 */
export class GridCoordinates extends PIXI.Point {
  static GRID_DIAGONALS = GRID_DIAGONALS;

  /**
   * Factory function that converts a GridOffset to GridCoordinates.
   * The {x, y} coordinates are centered.
   * @param {GridOffset} offset
   * @returns {GridCoordinates}
   */
  static fromOffset(offset) {
    const pt = new this();
    pt.setOffset(offset);
    return pt;
  }

  /**
   * Factory function that converts a Foundry GridCoordinates.
   * If the object has x,y properties, those are favored over i,j.
   * @param {object}
   * @returns {GridCoordinates}
   */
  static fromObject(obj) {
    const newObj = super.fromObject(obj);
    if ( Object.hasOwn(obj, "i") && !Object.hasOwn(obj, "x") ) newObj.i = obj.i;
    if ( Object.hasOwn(obj, "j") && !Object.hasOwn(obj, "y") ) newObj.j = obj.j;
    return newObj;
  }

  /** @type {number} */
  get i() { return canvas.grid.getOffset({ x: this.x, y: this.y }).i }

  /** @type {number} */
  get j() { return canvas.grid.getOffset({ x: this.x, y: this.y }).j }

  /** @type {number} */
  set i(value) { this.y = canvas.grid.getCenterPoint({ i: value, j: this.j }).y; }

  /** @type {number} */
  set j(value) { this.x = canvas.grid.getCenterPoint({ i: this.i, j: value }).x; }

  /**
   * Faster than getting i and j separately.
   * @type {object}
   */
  get offset() { return canvas.grid.getOffset({ x: this.x, y: this.y }); }

  /**
   * Convert this point to a new one based on its offset.
   * Sets x,y,z to equal the top left for i,j,k
   * @returns {PIXI.Point} New object
   */
  get topLeft() {
    return this.constructor.fromObject(canvas.grid.getTopLeftPoint({ x: this.x, y: this.y }));
  }

  /**
   * Convert this point to a new one based on its offset.
   * Sets x,y,z to equal the center for i,j,k
   * @returns {GridCoordinates3d} New object
   */
  get center() {
    return this.constructor.fromObject(canvas.grid.getCenterPoint({ x: this.x, y: this.y }));
  }

  /**
   * @returns {PIXI.Point}
   */
  toPoint() { return PIXI.Point.fromObject(this); }

  /**
   * Change this point to a specific offset value. The point will be centered.
   * @param {GridOffset} offset
   */
  setOffset(offset) {
    const { x, y } = canvas.grid.getCenterPoint(offset);
    this.x = x;
    this.y = y;
    return this;
  }

  /**
   * Center this point based on its current offset value.
   */
  centerToOffset() { return this.setOffset(this); }

  /**
   * For compatibility with PIXI.Point.
   * @returns {this}
   */
  to2d() { return this; }

  /**
   * Convert to 3d.
   * @returns {GridCoordinates3d}
   */
  to3d() { return CONFIG.GeometryLib.threeD.GridCoordinates3d.fromObject(this); }

  /**
   * Test if this offset is equal to another
   * @param {GridOffset} other
   * @returns {boolean}
   */
  offsetsEqual(other) {
    return this.i === other.i && this.j === other.j;
  }

  /**
   * Determine the number of diagonals based on two 2d offsets for a square grid.
   * If hexagonal, no diagonals.
   * @param {GridOffset} aOffset
   * @param {GridOffset} bOffset
   * @returns {number}
   */
  static numDiagonal(aOffset, bOffset) {
    if ( canvas.grid.isHexagonal ) return 0;
    let di = Math.abs(aOffset.i - bOffset.i);
    let dj = Math.abs(aOffset.j - bOffset.j);
    return Math.min(di, dj);
  }

  /**
   * Measure the distance between two points accounting for the current grid rules.
   * For square, this accounts for the diagonal rules. For hex, measures in number of hexes.
   * @param {Point} a
   * @param {Point} b
   * @param {function} [altGridDistFn]    Function generated from alternatingGridDistance; used for alternating rules
   * @param {GRID_DIAGONALS} [diagonals]  Diagonal rule to use
   * @returns {number} Distance, in grid units
   */
  static gridDistanceBetween = gridDistanceBetween;

  /**
   * Measure the distance between two offsets accounting for the current grid rules.
   * Uses `gridDistanceBetween`.
   * @param {GridOffset} aOffset
   * @param {GridOffset} bOffset
   * @param {object} [opts]
   * @param {function} [opts.altGridDistFn]    Function generated from alternatingGridDistance; used for alternating rules
   * @param {GRID_DIAGONALS} [opts.diagonals]  Diagonal rule to use
   * @returns {number} Distance, in grid units
   */
  static gridDistanceBetweenOffsets(aOffset, bOffset, opts) {
    return this.gridDistanceBetween(this.fromOffset(aOffset), this.fromOffset(bOffset), opts);
  }

  /**
   * Return a function that can repeatedly measure segments, tracking the alternating diagonals.
   * @param {Point} a
   * @param {Point} b
   * @param {object} [opts]
   * @param {function} [opts.altGridDistFn]    Function generated from alternatingGridDistance; used for alternating rules
   * @param {GRID_DIAGONALS} [opts.diagonals]  Diagonal rule to use
   */
  static alternatingGridDistanceFn = alternatingGridDistance;

  /**
   * Constructs a direct path grid, accounting for elevation and diagonal elevation.
   * @param {Point} start
   * @param {Point} end
   * @returns {GridCoordinates[]}
   */
  static directPath(start, end) {
    const path2d = canvas.grid.getDirectPath([start, end]);
    return path2d.map(pt => this.fromObject(pt));
  }

  /**
   * Measure distance, offset, and cost for a given 2d segment a|b.
   * Uses `gridDistanceBetween`.
   * @param {Point} a                   Start of the segment
   * @param {Point} b                   End of the segment
   * @param {object} [opts]
   * @param {number} [opts.numPrevDiagonal=0]  Number of diagonals thus far
   * @param {GRID_DIAGONALS} [opts.diagonals]  Diagonal rule to use
   * @returns {object}
   *   - @prop {number} distance          gridDistanceBetween for a|b
   *   - @prop {number} offsetDistance    gridDistanceBetweenOffsets for a|b
   *   - @prop {number} numDiagonal       Number of diagonals between the offsets if square or hex elevation
   */
  static gridMeasurementForSegment(a, b, opts) {
    return CONFIG.GeometryLib.threeD.gridMeasurementForSegment(a, b, opts);
  }

  /**
   * Get the function to measure the offset distance for a given distance with given previous diagonals.
   * @param {number} [diagonals=0]
   * @returns {function}
   */
  static getOffsetDistanceFn = getOffsetDistanceFn;

  // Temporary instances for performance.
  static _tmp = new this();
  static _tmp2 = new this();
  static _tmp3 = new this();
}


GEOMETRY_CONFIG.GridCoordinates ??= GridCoordinates;
