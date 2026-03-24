/* globals
canvas,
CONFIG,
game
*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */
"use strict";

import { Settings } from "../settings.js";
import { log } from "../util.js";
import { THTElevationAtPoint } from "../terrain_elevation.js";

/**
 * Modify Grid classes to measure in 3d.
 * Trigger is a 3d point.
 */

export const PATCHES_GridlessGrid = {};
export const PATCHES_SquareGrid = {};
export const PATCHES_HexagonalGrid = {};

PATCHES_GridlessGrid.BASIC = {};
PATCHES_SquareGrid.BASIC = {};
PATCHES_HexagonalGrid.BASIC = {};


/**
 * Wrap GridlessGrid#getDirectPath
 * Returns the sequence of grid offsets of a shortest, direct path passing through the given waypoints.
 * @param {RegionMovementWaypoint3d|GridCoordinates3d[]} waypoints    The waypoints the path must pass through
 * @returns {GridCoordinates|GridCoordinates3d[]}                 The sequence of grid offsets of a shortest, direct path
 * @abstract
 */
function getDirectPathGridless(wrapped, waypoints) {
  const GridCoordinates = CONFIG.GeometryLib.GridCoordinates;
  const offsets2d = wrapped(waypoints);
  if ( !(waypoints[0] instanceof CONFIG.GeometryLib.threeD.Point3d) ) return offsets2d.map(o => GridCoordinates.fromOffset(o));

  // 1-to-1 relationship between the waypoints and the offsets2d for gridless.
  const GridCoordinates3d = CONFIG.GeometryLib.threeD.GridCoordinates3d;
  return offsets2d.map((offset2d, idx) => {
    const offset3d = GridCoordinates3d.fromOffset(offset2d);
    const waypoint = GridCoordinates3d.fromObject(waypoints[idx]);
    offset3d.k = GridCoordinates3d.unitElevation(waypoint.elevation);
    return offset3d;
  });
}

/**
 * Wrap HexagonalGrid#getDirectPath and SquareGrid#getDirectPath
 * Returns the sequence of grid offsets of a shortest, direct path passing through the given waypoints.
 * @param {Point3d[]} waypoints            The waypoints the path must pass through
 * @returns {GridCoordinates|GridCoordinates3d[]}                 The sequence of grid offsets of a shortest, direct path
 * @abstract
 */
function getDirectPathGridded(wrapped, waypoints) {
  const { HexGridCoordinates3d, GridCoordinates3d, Point3d } = CONFIG.GeometryLib.threeD;
  const GridCoordinates = CONFIG.GeometryLib.GridCoordinates;
  if ( !(waypoints[0] instanceof Point3d) ) return wrapped(waypoints).map(o => GridCoordinates.fromObject(o));

  let prevWaypoint = GridCoordinates3d.fromObject(waypoints[0]);
  const path3d = [];
  const path3dFn = canvas.grid.isHexagonal ? HexGridCoordinates3d._directPathHex : GridCoordinates3d._directPathSquare;
  log(`getDirectPathGridded|${waypoints.length} waypoints`);
  for ( let i = 1, n = waypoints.length; i < n; i += 1 ) {
    const currWaypoint = GridCoordinates3d.fromObject(waypoints[i]);
    log(`getDirectPathGridded|Path from ${prevWaypoint.x},${prevWaypoint.y},${prevWaypoint.z} to ${currWaypoint.x},${currWaypoint.y},${currWaypoint.z}`);
    const segments3d = path3dFn(prevWaypoint, currWaypoint);
    log(`getDirectPathGridded|Adding ${segments3d.length} segments`, segments3d);
    path3d.push(...segments3d);
    prevWaypoint = currWaypoint;
  }
  return path3d;
}


/**
 * Measure a path for a gridded scene. Handles hex and square grids.
 * @param {GridMeasurePathWaypoint[]} waypoints           The waypoints the path must pass through
 * @param {object} options                                Additional measurement options
 * @param {GridMeasurePathCostFunction} [options.cost]    The function that returns the cost
 *   for a given move between grid spaces (default is the distance travelled)
 * @param {GridMeasurePathResult} result    The measurement result that the measurements need to be written to
 */
function _measurePath(wrapped, waypoints, { cost }, result) {
  if ( !(waypoints[0] instanceof CONFIG.GeometryLib.threeD.Point3d) ) return wrapped(waypoints, { cost }, result);
  const GridCoordinates3d = CONFIG.GeometryLib.threeD.GridCoordinates3d;
  initializeResultObject(result);
  result.waypoints.forEach(waypoint => initializeResultObject(waypoint));
  result.segments.forEach(segment => initializeResultObject(segment));

  // For each waypoint, project from 3d if the waypoint is a 3d class.
  // The projected point can be used to determine distance but not movement cost
  // because the passed coordinates will be incorrect.
  // Movement cost requires knowing the 3d positions.
  // Cannot combine the projected waypoints to measure all at once, b/c they would be misaligned.
  // Copy the waypoint so it can be manipulated.
  let start = waypoints[0];

 
  cost ??= (prevOffset, currOffset, offsetDistance) => offsetDistance;
  const offsetDistanceFn = GridCoordinates3d.getOffsetDistanceFn(0); // Diagonals = 0.
  const altGridDistanceFn = GridCoordinates3d.alternatingGridDistanceFn();
  let diagonals = canvas.grid.diagonals ?? game.settings.get("core", "gridDiagonals");
  const D = GridCoordinates3d.GRID_DIAGONALS;
  if ( diagonals === D.EXACT && Settings.get(Settings.KEYS.MEASURING.EUCLIDEAN_GRID_DISTANCE) ) diagonals = D.EUCLIDEAN;
  for ( let i = 1, n = waypoints.length; i < n; i += 1 ) {
    const end = waypoints[i];
    
    const path3d = canvas.grid.getDirectPath([start, end]);

    const segment = result.segments[i - 1];
    segment.spaces = path3d.length - 1;
    segment._calculatedPath = path3d; // Store the actual path used for calculations
    
    const isFlying = !!canvas.controls.ruler.token?.actor?.statuses.has("flying");
    let verticalCost = 0;
    {
      const dz = Math.abs(end.z - start.z);
      const manualElev = CONFIG.GeometryLib.utils.pixelsToGridUnits(dz);
      if ( isFlying ) {
        // Flying: each elevation unit costs 1 (no malus). Total = H + N.
        // Bresenham gives max(H, N) per-step. verticalCost = min(H, N) to compensate.
        const path2d = canvas.grid.getDirectPath([
          { ...canvas.grid.getCenterPoint(canvas.grid.getOffset(start)), z: 0 },
          { ...canvas.grid.getCenterPoint(canvas.grid.getOffset(end)), z: 0 }
        ]);
        const hDist = Math.max(0, path2d.length - 1);
        verticalCost = Math.min(hDist, manualElev);
      } else {
        verticalCost = manualElev;
      }
    }

    let prevPathPt = GridCoordinates3d.fromObject({ ...path3d[0], z: 0 }); // Path points are GridCoordinates3d.
    const prevDiagonals = offsetDistanceFn.diagonals;
    for ( let j = 1, n = path3d.length; j < n; j += 1 ) {
      const currPathPt = path3d[j];
      const dist = GridCoordinates3d.gridDistanceBetween(prevPathPt, currPathPt, { altGridDistanceFn, diagonals });
      const offsetDistance = offsetDistanceFn(prevPathPt, currPathPt);
      segment.distance += dist;
      segment.offsetDistance += offsetDistance;
      segment.cost += cost(prevPathPt, { ...currPathPt, z: 0 }, offsetDistance);
      prevPathPt = currPathPt;
    }
    segment.diagonals = offsetDistanceFn.diagonals - prevDiagonals;

    // Same hex, no movement: force cost to 0 (Foundry may produce a phantom 1).
    const startOffset = canvas.grid.getOffset(start);
    const endOffset = canvas.grid.getOffset(end);
    const sameHex = startOffset.i === endOffset.i && startOffset.j === endOffset.j;
    if ( sameHex && verticalCost === 0 && start.z === end.z ) {
      segment.cost = 0;
      segment.distance = 0;
      segment.offsetDistance = 0;
    }

    // Adjust verticalCost when both manual [/] and THT terrain elevation exist.
    if ( verticalCost > 0 ) {
      const thtStart = THTElevationAtPoint(start) ?? 0;
      const thtEnd = THTElevationAtPoint(end) ?? 0;
      const thtChange = thtEnd - thtStart;
      const manualChange = CONFIG.GeometryLib.utils.pixelsToGridUnits(end.z - start.z);
      const manualElev = Math.abs(manualChange);

      // Track manual climbing malus for label display (first elevation unit is free).
      let manualMalus = isFlying ? 0 : Math.max(0, manualElev - 1);

      if ( thtChange !== 0 ) {
        const absTht = Math.abs(thtChange);
        const absManual = Math.abs(manualChange);
        const sameDir = Math.sign(thtChange) === Math.sign(manualChange);

        // MovePenalty charge: with malus N+(N-1), or without malus just N.
        const malusFn = (n) => isFlying ? n : n + Math.max(0, n - 1);

        if ( sameDir ) {
          // Same direction: bridge the double "first unit" discount (normal only).
          if ( !isFlying ) {
            verticalCost += 1;
            manualMalus += 1; // Bridge malus: both manual + THT share one "first unit free"
          }
        } else {
          // Opposite directions: manual cancels some THT.
          const cancelled = Math.min(absTht, absManual);
          const remaining = absTht - cancelled;
          verticalCost -= cancelled + (malusFn(absTht) - malusFn(remaining));
        }
      }

      // Pure vertical movement (same hex): remove phantom horizontal from bresenham.
      if ( sameHex ) segment.cost -= 1;
      segment.manualClimbingMalus = manualMalus;
    }
    segment.cost += verticalCost;

    // Accumulate the waypoint totals
    const resultStartWaypoint = result.waypoints[i - 1];
    const resultEndWaypoint = result.waypoints[i];
    resultEndWaypoint.distance = resultStartWaypoint.distance + segment.distance;
    resultEndWaypoint.cost = resultStartWaypoint.cost + segment.cost;
    resultEndWaypoint.spaces = resultStartWaypoint.spaces + segment.spaces;
    resultEndWaypoint.diagonals = resultStartWaypoint.diagonals + segment.diagonals;
    resultEndWaypoint.offsetDistance = resultStartWaypoint.offsetDistance + segment.offsetDistance;

    // Accumulate the result totals
    result.distance += resultEndWaypoint.distance;
    result.cost += resultEndWaypoint.cost;
    result.spaces += resultEndWaypoint.spaces;
    result.diagonals += resultEndWaypoint.diagonals;
    result.offsetDistance += resultEndWaypoint.offsetDistance;

    // Iterate to next segment.
    start = end;
  }


  return result;
}

// ----- NOTE: Patches ----- //

PATCHES_GridlessGrid.BASIC.WRAPS = { getDirectPath: getDirectPathGridless };
PATCHES_SquareGrid.BASIC.WRAPS = { getDirectPath: getDirectPathGridded };
PATCHES_HexagonalGrid.BASIC.WRAPS = { getDirectPath: getDirectPathGridded };

PATCHES_GridlessGrid.BASIC.MIXES = { _measurePath };
PATCHES_SquareGrid.BASIC.MIXES = { _measurePath };
PATCHES_HexagonalGrid.BASIC.MIXES = { _measurePath };

// ----- NOTE: Helper functions ----- //

/**
 * Define certain parameters required in the result object.
 */
function initializeResultObject(obj) {
  obj.distance ??= 0;
  obj.spaces ??= 0;
  obj.cost ??= 0;
  obj.diagonals ??= 0;
  obj.offsetDistance ??= 0;
}
