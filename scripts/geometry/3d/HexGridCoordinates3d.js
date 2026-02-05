/* globals
canvas,
CONFIG,
CONST,
game
*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */
"use strict";

import "./RegionMovementWaypoint3d.js";
import "../GridCoordinates.js";
import { GEOMETRY_CONFIG } from "../const.js";
import { roundNearWhole } from "../util.js";
import { getOffsetDistanceFn } from "../grid_distance.js";

/**
 * Cube coordinates in a hexagonal grid. q + r + s = 0.
 * @typedef {object} HexagonalGridCube
 * @property {number} q    The coordinate along the E-W (columns) or SW-NE (rows) axis.
 *                         Equal to the offset column coordinate if column orientation.
 * @property {number} r    The coordinate along the NE-SW (columns) or N-S (rows) axis.
 *                         Equal to the offset row coordinate if row orientation.
 * @property {number} s    The coordinate along the SE-NW axis.
 */

/**
 * 3d Cube coordinates, adding k for elevation unit
 * @typedef {object} HexagonalGridCube3d extends HexagonalGridCube
 * @property {number} k     The coordinate of the elevation
 */

/**
 * A 3d point that can also represent a 4d hex coordinate (q, r, s, k).
 * Links z to the elevation property.
 */
export class HexGridCoordinates3d extends GEOMETRY_CONFIG.threeD.GridCoordinates3d {

  /**
   * Create this point from hex coordinates plus optional elevation.
   * @param {HexagonalGridCube} hexCube
   * @param {number} [elevation]            Elevation in grid units
   * @returns {HexGridCoordinates3d}
   */
  static fromHexCube(hexCube, elevation) {
    const pt = new this();
    return pt.setToHexCube(hexCube, elevation);
  }

  /** @type {number} */
  get q() { return canvas.grid.pointToCube(this).q; }

  /** @type {number} */
  get r() { return canvas.grid.pointToCube(this).r; }

  /** @type {number} */
  get s() { return canvas.grid.pointToCube(this).s; }

  /** @type {number} */
  set q(value) {
    const pt = canvas.grid.cubeToPoint({ q: value, r: this.r });
    this.x = roundNearWhole(pt.x);
    this.y = roundNearWhole(pt.y);
  }

  /** @type {number} */
  set r(value) {
    const pt = canvas.grid.cubeToPoint({ q: this.q, r: value });
    this.x = roundNearWhole(pt.x);
    this.y = roundNearWhole(pt.y);
  }

  /** @type {number} */
  set s(value) {
    // s = 0 - q - r
    // r = 0 - q - s
    this.r = 0 - this.q - value;
  }

  /**
   * Faster than getting q, r, s separately.
   * @type {HexagonalGridCube3d}
   */
  get hexCube() {
    const obj = canvas.grid.pointToCube(this);
    obj.k = this.k;
    return obj;
  }

  /**
   * Set {x, y, z} based on a hex cube. Faster than setting individually.
   * @param {HexagonalGridCube3d}
   * @param {number} [elevation]    Elevation, in grid units
   * @returns {this} For convenience.
   */
  setToHexCube(hexCube, elevation) {
    if ( typeof elevation === "undefined" ) {
      if ( typeof hexCube.z !== "undefined" ) elevation = GEOMETRY_CONFIG.utils.pixelsToGridUnits(hexCube.z);
      else if ( typeof hexCube.k !== "undefined" ) elevation = this.constructor.elevationForUnit(hexCube.k);
      else elevation = 0;
    }
    const { x, y } = canvas.grid.cubeToPoint(hexCube);
    this.x = roundNearWhole(x);
    this.y = roundNearWhole(y);
    this.elevation = elevation;
    return this;
  }

  /**
   * Set x, y, z to center of hex.
   */
  centerToHexCube() {
    const q = Math.round(this.q);
    const r = Math.round(this.r);
    return this.setToHexCube({ q, r }, this.elevation);
  }

  /**
   * Constructs a direct path for a hex grid, accounting for elevation and diagonal elevation.
   * Spreads out the elevation moves over the course of the path.
   * For a hex grid, there is no "double diagonal" to worry about.
   * @param {RegionMovementWaypoint3d} start
   * @param {RegionMovementWaypoint3d} end
   * @param {GridOffset[]} [path2d]             Optional path2d for the start and end waypoints.
   * @returns {HexGridCoordinates3d[]}
   */
  static _directPathHex = directPath3dHex;

  /**
   * Get the function to measure the offset distance for a given distance with given previous diagonals.
   * @param {number} [diagonals=0]
   * @returns {function}
   */
  static getOffsetDistanceFn = getOffsetDistanceFn;

  /**
   * Construct a function to determine the offset cost for this canvas for a single 3d move on a hex grid.
   * For hexes, the diagonal only occurs with an elevation + hex move.
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
        // For hex moves, no diagonal 2d. Just diagonal if both elevating and moving in 2d.
        const isElevationMove = prevOffset.k !== currOffset.k;
        const is2dMove = prevOffset.i !== currOffset.i || prevOffset.j !== currOffset.j;
        const s = isElevationMove ^ is2dMove;
        const d = !s;
        nDiag += d;
        const k = kFn();
        return (s + (k * d)) * canvas.grid.distance;
      };
    } else {
      let k = 1;
      switch ( diagonals ) {
        case D.EQUIDISTANT: k = 1; break;
        case D.EXACT: k = Math.SQRT2; break;
        case D.APPROXIMATE: k = 1.5; break;
        case D.RECTILINEAR: k = 2; break;
      }
      fn = (prevOffset, currOffset) => {
        const isElevationMove = prevOffset.k !== currOffset.k;
        const is2dMove = prevOffset.i !== currOffset.i || prevOffset.j !== currOffset.j;
        const s = isElevationMove ^ is2dMove;
        const d = !s;
        return (s + (k * d)) * canvas.grid.distance;
      };
    }
    Object.defineProperty(fn, "diagonals", {
      get: () => nDiag
    });
    return fn;
  }

}

// ----- NOTE: HexagonalGrid ----- //

/**
 * Constructs a direct path for a hex grid, accounting for elevation and diagonal elevation.
 * Spreads out the elevation moves over the course of the path.
 * For a hex grid, there is no "double diagonal" to worry about.
 * @param {RegionMovementWaypoint3d} start
 * @param {RegionMovementWaypoint3d} end
 * @param {GridOffset[]} [path2d]             Optional path2d for the start and end waypoints.
 * @returns {HexGridCoordinates3d[]}
 */
function directPath3dHex(start, end) {
  start = HexGridCoordinates3d.fromObject(start);
  end = HexGridCoordinates3d.fromObject(end);

  // Apply small offset (1/10th of grid size) to ensure consistent hex selection when centering in corners
  const offset = canvas.grid.size / 10;
  start.x += offset;
  start.y += offset;
  end.x += offset;
  end.y += offset;

  if ( start.offsetsEqual(end) ) return [start, end];
  const points = CONFIG.GeometryLib.utils.bresenhamHexLine3d(start, end);
  const path3d = [start];
  // Convert points to GridCoordinates3d. Start and end repeat; skip.
  for ( let i = 4, n = points.length - 4; i < n; i += 4 ) path3d.push(HexGridCoordinates3d.fromHexCube({
    q: points[i],
    r: points[i + 1],
    s: points[i + 2],
    k: points[i + 3] }));
  path3d.push(end);
  return path3d;
}

GEOMETRY_CONFIG.threeD.HexGridCoordinates3d ??= HexGridCoordinates3d;
