/* globals
Region,
Wall
*/
"use strict";

import { MODULE_KEYS } from "./const.js";

// Modify CanvasEdges class to add a quadtree and track adding and removing edges.
// Patches for the CanvasEdges class.
export const PATCHES = {};
PATCHES.CANVAS_EDGES = {};

// ----- Getters ----- //

/**
 * @typedef {object} EdgeElevation
 * @prop {object} a
 *   - @prop {number|null} top      Elevation in grid units
 *   - @prop {number|null} bottom   Elevation in grid units
 * @prop {object} b
 *   - @prop {number|null} top      Elevation in grid units
 *   - @prop {number|null} bottom   Elevation in grid units

/**
 * Get the elevation at the endpoints for this edge.
 * Each edge represents a vertical 2d quadrilateral with potentially different top/bottom for
 * both a and b endpoints. Infinite elevations return null, keeping with Foundry practice for region elevation.
 * If this edge object is a wall, the points will be the Wall Height elevation.
 * If this edge object is a region, the points will be the region top/bottom or plateau / region bottom elevations.
 * @returns {EdgeElevation}
 */
function getElevation() {
  const e = this._elevation ??= { a: { top: null, bottom: null }, b: { top: null, bottom: null }};
  if ( this.object instanceof Wall ) _setWallElevation(this.object, e);
  else if ( this.object instanceof Region ) _setRegionElevation(this.object, this, e);
  return e;
}

/**
 * Elevation for a wall
 * @param {Wall} wall
 * @returns {EdgeElevation}
 */
function _setWallElevation(wall, e) {
  let top = wall.topE;
  let bottom = wall.bottomE;
  if ( !isFinite(top) ) top = null;
  if ( !isFinite(bottom) ) bottom = null;
  const { a, b } = e;
  a.top = top;
  a.bottom = bottom;
  b.top = top;
  b.bottom = bottom;
}

/**
 * Elevation for a region
 * @param {Region} region
 * @param {Edge} edge       Edge for which the elevation is applied; needed for ramps
 */
function _setRegionElevation(region, edge, e) {
  const TM = MODULE_KEYS.TERRAIN_MAPPER;
  let top = region.document.elevation.top;
  if ( TM.ACTIVE && region[TM.ID].isElevated ) {
    if ( region[TM.ID].isRamp ) return _setRampElevation(region, edge, e);
    top = region[TM.ID].plateauElevation;
  }
  const bottom = region.document.elevation.bottom;
  const { a, b } = e;
  a.top = top;
  a.bottom = bottom;
  b.top = top;
  b.bottom = bottom;
}

/**
 * Elevation for a ramp
 * @param {Region} region
 * @param {Edge} edge      One edge of the region's polygon(s)
 */
function _setRampElevation(region, edge, e) {
  // Assumes TM is active.
  const TM = MODULE_KEYS.TERRAIN_MAPPER;
  const bottom = region.document.elevation.bottom;
  const { a, b } = e;
  a.top = region[TM.ID].elevationUponEntry(edge.a);
  a.bottom = bottom;
  b.top = region[TM.ID].elevationUponEntry(edge.b);
  b.bottom = bottom;
}

PATCHES.CANVAS_EDGES.GETTERS = { elevationLibGeometry: getElevation };
