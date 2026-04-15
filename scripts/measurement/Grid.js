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
import { MovePenalty } from "./MovePenalty.js";

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
    
    const token = canvas.controls.ruler?.token ?? null;
    // Climb is still charged; only the (climb-1) malus is suppressed for immune tokens
    // (flying / Lancer climber / elevation-immunity bonuses — see MovePenalty statics).
    const noClimbMalus = MovePenalty.isClimbingImmune(token);
    // Flying mode ([G] toggle): track cumulative max terrain elevation across steps.
    // Step climb = max(0, maxSoFar - prevEffective). Descents contribute nothing.
    const flyingMode = Settings.FLYING_MODE;
    const manualChange = CONFIG.GeometryLib.utils.pixelsToGridUnits(end.z - start.z);

    // Manual [/] climb applies once, on the last hex actually entered.
    const realStepIndices = [];
    for ( let j = 1, n = path3d.length; j < n; j += 1 ) {
      if ( path3d[j - 1].i !== path3d[j].i || path3d[j - 1].j !== path3d[j].j ) {
        realStepIndices.push(j);
      }
    }
    const lastRealIdx = realStepIndices.length ? realStepIndices.at(-1) : -1;

    let prevPathPt = GridCoordinates3d.fromObject({ ...path3d[0], z: 0 });
    const prevDiagonals = offsetDistanceFn.diagonals;
    const startThtAtPoint = THTElevationAtPoint(prevPathPt, 0, token) ?? 0;
    // In flying mode the token carries its cumulative-max altitude across segments.
    // Seed prevThtElev with max(THT_at_start, token's actual start elevation) so the
    // per-step loop doesn't treat an already-elevated flyer as starting from 0.
    const startElevGrid = CONFIG.GeometryLib.utils.pixelsToGridUnits(start.z);
    let prevThtElev = flyingMode ? Math.max(startThtAtPoint, startElevGrid) : startThtAtPoint;
    let totalClimbMalus = 0;

    // In flying mode, waypoint.elevation carries the cumulative path-max.
    // Ruler stripping only removes the destination's THT top, so any auto-lift
    // ABOVE the destination survives into manualChange and must be subtracted out
    // here to avoid double-counting the per-step cumulative climb.
    let flyingAutoRise = 0;
    if ( flyingMode ) {
      let pathMax = prevThtElev;
      for ( let j = 1, n = path3d.length; j < n; j += 1 ) {
        const e = THTElevationAtPoint(path3d[j], 0, token) ?? 0;
        if ( e > pathMax ) pathMax = e;
      }
      const destThtRaw = THTElevationAtPoint(path3d[path3d.length - 1], 0, token) ?? 0;
      flyingAutoRise = Math.max(0, pathMax - destThtRaw);
    }
    const effectiveManualChange = manualChange - (manualChange >= 0 ? 1 : -1) * Math.min(Math.abs(manualChange), flyingAutoRise);

    for ( let j = 1, n = path3d.length; j < n; j += 1 ) {
      const currPathPt = path3d[j];
      const dist = GridCoordinates3d.gridDistanceBetween(prevPathPt, currPathPt, { altGridDistanceFn, diagonals });
      const offsetDistance = offsetDistanceFn(prevPathPt, currPathPt);
      segment.distance += dist;
      segment.offsetDistance += offsetDistance;

      // Bresenham emits pure-vertical sub-steps for max(H,N)>H. Skip them here:
      // their climb is folded into the next real hex step, and they never cost
      // horizontal or flat penalty (we never re-entered a new 2D cell).
      const sameCell = prevPathPt.i === currPathPt.i && prevPathPt.j === currPathPt.j;
      if ( sameCell ) {
        prevPathPt = currPathPt;
        continue;
      }

      segment.cost += cost(prevPathPt, { ...currPathPt, z: 0 }, offsetDistance);

      const rawCurrThtElev = THTElevationAtPoint(currPathPt, 0, token) ?? 0;
      // In flying mode the effective elevation is cumulative-max (never descends).
      const currThtElev = flyingMode ? Math.max(prevThtElev, rawCurrThtElev) : rawCurrThtElev;
      const thtDelta = currThtElev - prevThtElev;
      const manualDelta = (j === lastRealIdx) ? effectiveManualChange : 0;
      const stepDelta = thtDelta + manualDelta;
      const climb = Math.abs(stepDelta);
      if ( climb > 0 ) {
        const malus = noClimbMalus ? 0 : Math.max(0, climb - 1);
        segment.cost += climb + malus;
        totalClimbMalus += malus;
      }
      prevThtElev = currThtElev;
      prevPathPt = currPathPt;
    }
    segment.diagonals = offsetDistanceFn.diagonals - prevDiagonals;

    // No 2D movement but a manual climb (e.g. user pressed [/] without dragging):
    // the per-hex loop never ran, so charge the climb here.
    if ( lastRealIdx === -1 && manualChange !== 0 ) {
      const climb = Math.abs(manualChange);
      const malus = noClimbMalus ? 0 : Math.max(0, climb - 1);
      segment.cost += climb + malus;
      totalClimbMalus += malus;
    }

    // Same-position guard. Pixel comparison, not grid offsets: when a token
    // center sits on a hex vertex, getOffset can return the same offset for two
    // genuinely different positions and the cost would falsely zero out.
    const sameHex = (Math.abs(start.x - end.x) < 1 && Math.abs(start.y - end.y) < 1);
    if ( sameHex && start.z === end.z ) {
      segment.cost = 0;
      segment.distance = 0;
      segment.offsetDistance = 0;
    }
    segment.manualClimbingMalus = totalClimbMalus;

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
