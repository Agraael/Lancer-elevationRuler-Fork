/* globals
canvas,
CONFIG,
foundry,
game,
PIXI
*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */
"use strict";

import { MODULE_ID, FLAGS, OTHER_MODULES, SPEED, MOVEMENT_TYPES } from "../const.js";
import { Settings } from "../settings.js";
import { log, getTokenShape, getAreaFromPositionAndShape } from "../util.js";


function randomColor(brightness) {
    function randomChannel(brightness) {
        var r = 255 - brightness;
        var n = 0 | ((Math.random() * r) + brightness);
        var s = n.toString(16);
        return (s.length == 1) ? '0' + s : s;
    }
    return '#' + randomChannel(brightness) + randomChannel(brightness) + randomChannel(brightness);
}


/**
 * Class that represents a fake token with a cloned actor
 */
class TokenClone {
    /** @type {Actor} */
    actor;

    /** @type {TokenDocument} */
    document;

    /** @type {Token} */
    _original;

    /** @type {boolean} */
    useTerrains = false;

    constructor(token) {
        this.useTerrains = OTHER_MODULES.TERRAIN_MAPPER.ACTIVE
      && canvas.regions.placeables.some(r => r.terrainmapper.hasTerrain);
        this.actor = this.useTerrains ? token.actor.clone() : token.actor;
        this._original = token;
    }

    static fromToken(token) {
        const tClone = new this(token);
        tClone.document = new CONFIG.Token.documentClass(token.document.toObject());
        return tClone;
    }

    duplicate() {
        const newTClone = new this.constructor(this);
        newTClone.document = this.document;
        return newTClone;
    }

    get movementType() {
        const { x, y } = this._original.getCenterPoint(this.document);
        return new PIXI.Point(x, y);
    }

    get center() {
        const { x, y } = this._original.getCenterPoint(this.document);
        return new PIXI.Point(x, y);
    }

    get elevationE() {
        return this.document.elevation;
    }

    /**
   * Clear terrains from the token clone
   */
    clearTerrains() {
        if (!this.useTerrains)
            return;
        const Terrain = CONFIG.terrainmapper.Terrain;
        const tokenTerrains = Terrain.allOnToken(this);
        if (!tokenTerrains.length)
            return;
        Terrain.removeFromTokenLocally(this, tokenTerrains, { refresh: false });
        this.actor._initialize(); // This is slow
    }

}

/**
Class to measure penalty, as percentage of distance, between two points.
Accounts for token movement through terrain.
Type of penalties:
- Moving through other tokens.
- Moving through Terrain Mapper terrain.
- Moving through Drawings. Under drawing elevation is ignored.

Instantiate the class for a given measurement, which then identifies the bounds of potential obstacles.
*/
export class MovePenalty {

    /** @type {Token} */
    moveToken;

    /** @type {Set<Region>} */
    regions = new Set();

    /** @type {Set<Drawing>} */
    drawings = new Set();

    /** @type {Set<Token>} */
    tokens = new Set();

    /** @type {Set<MeasuredTemplate>} */
    templates = new Set();

    /** @type {Set<Region>} */
    pathRegions = new Set();

    /** @type {Set<Drawing>} */
    pathDrawings = new Set();

    /** @type {Set<Token>} */
    pathTokens = new Set();

    /** @type {Set<MeasuredTemplate>} */
    pathTemplates = new Set();

    /** @type {MOVEMENT_TYPES} */
    movementType = MOVEMENT_TYPES.WALK;

    /** @type {object} */
    #localTokenClone;

    /** @type {number} */
    originElevation;

    /**
   * @param {Token} moveToken               The token doing the movement
   */
    constructor(moveToken) {
        this.moveToken = moveToken;
        this.originElevation = moveToken.elevationZ;
        this.movementType = moveToken.movementType;
        const tokenMultiplier = this.constructor.tokenMultiplier;
        const terrainAPI = this.constructor.terrainAPI;

        // Only regions with terrains; tokens if that setting is enabled; drawings if enabled.
        if (tokenMultiplier !== 1)
            canvas.tokens.placeables.forEach(t => this.tokens.add(t));
        if (terrainAPI)
            canvas.regions.placeables.forEach(r => {
                if (r.terrainmapper.hasTerrain)
                    this.regions.add(r);
            });
        canvas.drawings.placeables.forEach(d => {
            const penalty = d.document.getFlag(MODULE_ID, FLAGS.MOVEMENT_PENALTY) ?? 1;
            const useFlatPenalty = d.document.getFlag(MODULE_ID, FLAGS.MOVEMENT_PENALTY_FLAT);
            if ((!useFlatPenalty && penalty !== 1) || (useFlatPenalty && penalty !== 0))
                this.drawings.add(d);
        });
        canvas.templates.placeables.forEach(t => {
            const penalty = t.document.getFlag(MODULE_ID, FLAGS.MOVEMENT_PENALTY) ?? 1;
            const useFlatPenalty = t.document.getFlag(MODULE_ID, FLAGS.MOVEMENT_PENALTY_FLAT);
            if ((!useFlatPenalty && penalty !== 1) || (useFlatPenalty && penalty !== 0))
                this.templates.add(t);
        });
        this.tokens.delete(moveToken);

        // Remove certain hidden tokens.
        // Note this is done only at beginning, but the MoveInstance only intended to last through a ruler measure.
        this.tokens = this.tokens.filter(t => !(t.document.hidden
      || t.actor.statuses.intersects(CONFIG[MODULE_ID].pathfindingIgnoreStatuses)));

        // Initially set the path sets to the full set of placeables.
        this.tokens.forEach(t => this.pathTokens.add(t));
        this.drawings.forEach(d => this.pathDrawings.add(d));
        this.regions.forEach(r => this.pathRegions.add(r));
        this.templates.forEach(t => this.pathTemplates.add(t));

        // Set up a token clone without any terrains to use in estimating movement.
        this.#localTokenClone = TokenClone.fromToken(this.moveToken);
        this.#localTokenClone.clearTerrains();
    }

    /**
   * Limit the placeables to test to a given path.
   * @param {GridCoordinates3d[]} [path]      The path that will be tested
   */
    restrictToPath(path = []) {
        this.pathTokens.clear();
        this.pathDrawings.clear();
        this.pathRegions.clear();
        this.pathTemplates.clear();

        // Locate all the regions/drawings/tokens/templates along the path, testing using 2d bounds.
        for (let i = 1, n = path.length; i < n; i += 1) {
            const a = path[i - 1].center;
            const b = path[i].center;
            this.tokens.forEach(t => {
                if (t.constrainedTokenBorder.lineSegmentIntersects(a, b, { inside: true }))
                    this.pathTokens.add(t);
            });
            this.drawings.forEach(d => {
                if (d.bounds.lineSegmentIntersects(a, b, { inside: true }))
                    this.pathDrawings.add(d);
            });
            this.regions.forEach(r => {
                if (r.bounds.lineSegmentIntersects(a, b, { inside: true }))
                    this.pathRegions.add(r);
            });
            this.templates.forEach(t => {
                if (t.bounds.lineSegmentIntersects(a, b, { inside: true }))
                    this.pathTemplates.add(t);
            });
        }
    }

    // ----- NOTE: Region move penalties ----- //

    /**
   * Token speed without any region terrains. Cached.
   * @type @{number}
   */
    #baseTokenSpeed = 0;

    get baseTokenSpeed() {
        return this.#baseTokenSpeed
      || (this.#baseTokenSpeed = SPEED.tokenSpeed(this.#localTokenClone, this.movementType) || 1);
    }

    /**
   * Token speed of the movement token as is. Cached.
   * @type {number}
   */
    #moveTokenSpeed = 0;

    get moveTokenSpeed() {
        return this.#moveTokenSpeed
      || (this.#moveTokenSpeed = SPEED.tokenSpeed(this.moveToken, this.movementType) || 1);
    }

    _regionPenaltyMap = new Map();

    /**
   * Get the move speed for 1+ regions
   * @param {Region[]} regions
   * @returns {number} The move speed of the move token when in the region(s).
   */
    moveSpeedWithinRegions(regions) {
    // Confirm Terrain Mapper is active; otherwise return the current token speed
        const Terrain = CONFIG.terrainmapper?.Terrain;
        if (!Terrain)
            return this.moveTokenSpeed;

        // If no terrains in the regions, return the current token speed without regions.
        const terrains = regions.flatMap(region => [...region.terrainmapper.terrains]);
        if (!terrains.length)
            return this.baseTokenSpeed;

        // If these regions already encountered, return the cached token speed.
        const key = regions.map(region => region.id).join("|");
        if (this._regionPenaltyMap.has(key))
            return this._regionPenaltyMap.get(key);

        // Duplicate the token clone and add the region terrain(s).
        const tClone = this.#localTokenClone.duplicate();
        Terrain.addToTokenLocally(tClone, [...terrains.values()], { refresh: false });
        if (game.system.id === "dnd5e"
      && OTHER_MODULES.DAE.ACTIVE
      && !foundry.utils.isNewerVersion(game.system.version, "4"))
            tClone.actor.prepareData(); // Slower; fails in v4.
        else
            tClone.actor.applyActiveEffects(); // Does not work for DAE (at least in dnd5e v3).

        // Determine the speed of the token clone and cache for future reference.
        const speed = SPEED.tokenSpeed(tClone, this.movementType);
        this._regionPenaltyMap.set(key, speed);
        return speed || 1;
    }

    // ----- NOTE: Getters ------ //

    /** @type {boolean} */
    get anyPotentialObstacles() {
        return this.pathTokens.size || this.pathRegions.size || this.pathDrawings.size || this.pathTemplates.size;
    }

    #penaltyCache = new Map();

    clearPenaltyCache() {
        this.#penaltyCache.clear();
    }


    // ----- NOTE: Primary methods ----- //

    /**
   * Determine movement distance, offset, cost, for a segment.
   * @param {GridCoordinates3d} a         Exact starting position
   * @param {GridCoordinates3d} b           Exact ending position
   * @param {boolean} forceGridPenalty          Use the force grid penalty setting
   * @returns {object}
   *  - @prop {number} distance
   *  - @prop {number} offsetDistance
   *  - @prop {number} cost
   *  - @prop {number} numDiagonals
   */
    measureSegment(a, b, { numPrevDiagonal = 0, forceGridPenalty, diagonals } = {}) {
        const GridCoordinates3d = CONFIG.GeometryLib.threeD.GridCoordinates3d;
        if (!(a instanceof GridCoordinates3d))
            a = GridCoordinates3d.fromObject(a);
        if (!(b instanceof GridCoordinates3d))
            b = GridCoordinates3d.fromObject(b);
        const D = GridCoordinates3d.GRID_DIAGONALS;
        diagonals ??= canvas.grid.diagonals ?? game.settings.get("core", "gridDiagonals");
        if (diagonals === D.EXACT
      && Settings.get(Settings.KEYS.MEASURING.EUCLIDEAN_GRID_DISTANCE))
            diagonals = D.EUCLIDEAN;
        const res = GridCoordinates3d.gridMeasurementForSegment(a, b, { numPrevDiagonal, diagonals });
        this.restrictToPath([a, b]);
        res.cost = this.movementCostForSegment(a, b, res.offsetDistance, forceGridPenalty);
        return res;
    }

    /**
   * Determine the movement cost for a segment.
   * @param {GridCoordinates3d} startCoords     Exact starting position
   * @param {GridCoordinates3d} endCoords       Exact ending position
   * @param {number} costFreeDistance           Measured distance of the segment (may be offset distance)
   * @param {number} [segmentIndex]             Index of the segment in ruler._segmentOffsetCache
   * @returns {number} The costFreeDistance + cost, in grid units.
   */
    movementCostForSegment(startCoords, endCoords, costFreeDistance = 0, forceGridPenalty, segmentIndex) {
        if (startCoords.almostEqual(endCoords))
            return costFreeDistance;

        forceGridPenalty ??= Settings.get(Settings.KEYS.MEASURING.FORCE_GRID_PENALTIES);
        forceGridPenalty &&= !canvas.grid.isGridless;
        if (CONFIG[MODULE_ID].debug) {
            console.groupCollapsed("movementCostForSegment");
            log(`${startCoords.x},${startCoords.y},${startCoords.z} -> ${endCoords.x},${endCoords.y},${endCoords.z}`);
        }

        // Did we already test this segment?
        const startKey = forceGridPenalty ? startCoords.center.key : startCoords.key;
        const endKey = forceGridPenalty ? endCoords.center.key : endCoords.key;
        const key = `${startKey}|${endKey}`;
        if (this.#penaltyCache.has(key)) {
            const res = this.#penaltyCache.get(key);
            log(`Using key ${key}: ${res}`);
            if (CONFIG[MODULE_ID].debug)
                console.groupEnd("movementCostForSegment");
            return res;
        }

        const t0 = performance.now();
        let res = costFreeDistance;
        if (forceGridPenalty) {
            // Cost is assigned to each grid square/hex
            const isOneStep = Math.abs(endCoords.i - startCoords.i) < 2
        && Math.abs(endCoords.j - startCoords.j) < 2
        && Math.abs(endCoords.k - startCoords.k) < 2;
            if (isOneStep) {
                let baseCost = this.movementCostForGridSpace(startCoords, endCoords, costFreeDistance);
                if (!canvas.controls.ruler.token?.actor?.statuses.has("flying")) {
                    // Add penalty for terrain elevation change
                    const startTerrainElev = this.getTerrainElevationAt(startCoords);
                    const endTerrainElev = this.getTerrainElevationAt(endCoords);
                    if (startTerrainElev !== null && endTerrainElev !== null) {
                        const elevationChange = Math.abs(endTerrainElev - startTerrainElev);
                        baseCost += Math.floor(elevationChange);
                    }
                }

                if (CONFIG[MODULE_ID].debug)
                    console.groupEnd("movementCostForSegment");
                return baseCost;
            }

            // Unlikely scenario where endCoords are more than 1 step away from startCoords.
            let totalCost = 0;
            const path = canvas.grid.getDirectPath([startCoords, endCoords]);


            const offsetDistanceFn = CONFIG.GeometryLib.threeD.GridCoordinates3d.getOffsetDistanceFn();
            let prevOffset = path[0];
            let prevTerrainElevation = this.getTerrainElevationAt(prevOffset);

            for (let i = 1, n = path.length; i < n; i += 1) {
                // Update the index before processing this step

                const currOffset = path[i];
                const offsetDist = offsetDistanceFn(prevOffset, currOffset);

                // Get terrain elevation at current position
                const currTerrainElevation = this.getTerrainElevationAt(currOffset);

                // Calculate base cost for the grid space
                let stepCost = this.movementCostForGridSpace(prevOffset, currOffset, offsetDist) - offsetDist;

                if (!canvas.controls.ruler.token?.actor?.statuses.has("flying")) {
                    // Add penalty for terrain elevation change
                    if (prevTerrainElevation !== null && currTerrainElevation !== null) {
                        const elevationChange = Math.abs(currTerrainElevation - prevTerrainElevation);
                        stepCost += Math.floor(elevationChange);
                    }
                }

                totalCost += stepCost;
                prevOffset = currOffset;
                prevTerrainElevation = currTerrainElevation;
            }

            res = totalCost + costFreeDistance;
        } else {
            // Cost is proportional to the distance of the segment covered by each penalty-imposing token,region,drawing.
            const multiplier = this.proportionalCostForSegment(startCoords, endCoords);
            res = costFreeDistance * multiplier;
        }
        this.#penaltyCache.set(key, res);
        const t1 = performance.now();
        log(`Found cost ${res} in ${Math.round(t1 - t0)} ms`);
        if (CONFIG[MODULE_ID].debug)
            console.groupEnd("movementCostForSegment");
        return res;
    }


    /**
   * Determine the movement cost when in a specific grid space.
   * Typically used with Settings.KEYS.FORCE_GRID_PENALTIES.
   * @param {GridCoordinates3d} coords     Exact starting position
   * @param {number} costFreeDistance           Measured distance of the step
   * @param {GridCoordinates3d} [startCoords]  Optional start coordinates for accurate path calculation
   * @param {GridCoordinates3d} [endCoords]    Optional end coordinates for accurate path calculation
   * @returns {number} The additional cost, in grid units, plus the costFreeDistance.
   */
    movementCostForGridSpace(prevCoords, coords, costFreeDistance = 0) {
    // Determine what regions, tokens, drawings overlap the center point.
        const centerPt = coords.center;

        // Did we already test this coordinate?
        const key = centerPt.key;
        if (this.#penaltyCache.has(key)) {
            const { flatPenalty, gridMult } = this.#penaltyCache.get(key);
            return (flatPenalty + (gridMult * costFreeDistance));
        }

        const regions = [...this.regions].filter(r => r.testPoint(centerPt, centerPt.elevation));
        const tokens = [...this.tokens].filter(t => t.constrainedTokenBorder.contains(centerPt.x, centerPt.y)
      && centerPt.elevation.between(t.bottomE, t.topE));
        const drawings = [...this.drawings].filter(d => d.bounds.contains(centerPt.x, centerPt.y)
      && d.elevationE <= centerPt.elevation);

        // Check for Terrain Height Tools terrains - check all spaces occupied by token
        const thtTerrains = this._getTerrainHeightToolsAtTokenShape(prevCoords, coords);

        // Track all speed multipliers and flat penalties for the grid space.
        let flatPenalty = 0;
        let currentMultiplier = 1;
        let startingSpeed = this.baseTokenSpeed;

        // Drawings
        drawings.forEach(d => {
            const penalty = d.document.getFlag(MODULE_ID, FLAGS.MOVEMENT_PENALTY);
            if (d.document.getFlag(MODULE_ID, FLAGS.MOVEMENT_PENALTY_FLAT))
                flatPenalty += penalty;
            else
                currentMultiplier *= penalty;
        });

        // Templates (difficult terrain) - same approach as _getTerrainHeightToolsAtTokenShape
        const templates = this._getTemplatesAtTokenShape(prevCoords, coords);
        templates.forEach(t => {
            const penalty = t.document.getFlag(MODULE_ID, FLAGS.MOVEMENT_PENALTY);
            if (t.document.getFlag(MODULE_ID, FLAGS.MOVEMENT_PENALTY_FLAT))
                flatPenalty += penalty;
            else
                currentMultiplier *= penalty;
        });

        const tokenElevation = canvas.controls.ruler.token?.elevationE;
        // Terrain Height Tools terrains - add movement penalty
        thtTerrains.forEach(({ terrain, type }) => {
            if (type.movementPenalty > 0 && tokenElevation >= terrain.elevation && tokenElevation <= terrain.height) {
                flatPenalty += type.movementPenalty;
            }
        });

        // Tokens
        const tokenMultiplier = this.constructor.tokenMultiplier;
        const useTokenFlat = this.constructor.useFlatTokenMultiplier;
        if (useTokenFlat)
            flatPenalty += (tokenMultiplier * tokens.length); // Default to 0.
        else
            currentMultiplier *= (tokens.length ? (tokenMultiplier * tokens.length) : 1); // Default to 1.

        // Regions
        const testRegions = this.constructor.terrainAPI && regions.length;
        let speed = startingSpeed;
        if (testRegions) {
            // Add on all the current terrains from the token but use the non-terrain token as baseline.
            startingSpeed = this.baseTokenSpeed;
            speed = this.moveSpeedWithinRegions(regions);
        }
        currentMultiplier ||= 1; // Don't let it divide by 0.
        const speedInGrid = (speed / currentMultiplier);
        const gridMult = startingSpeed / speedInGrid; // If currentMultiplier > 1, gridMult should be > 1.
        const res = (flatPenalty + (gridMult * costFreeDistance));
        this.#penaltyCache.set(key, { flatPenalty, gridMult });
        return res;

    /* Example
      Token has speed 30 and moves 10 grid units.
      Assume speed is halved plus a +5 flat penalty.
      30 / 15 = 2 * 10 = 20 grid units + 5 penalty.
      So instead of moving 10 units, it is as though the token moved 25.
    */
    }


    /**
   * Determine the movement penalties along a start|end segment.
   * By default, the penalty is apportioned based on the exact intersections of the penalty
   * region to the segment. If `forceGridPenalty=true`, then the penalty is assigned per grid space.
   *
   * @param {GridCoordinates3d} startCoords     Exact starting position
   * @param {GridCoordinates3d} endCoords       Exact ending position
   * @returns {number} The number used to multiply the move speed along the segment.
   */
    proportionalCostForSegment(startCoords, endCoords) {
    // Intersections for each region, token, drawing.
        const cutawayIxs = this._cutawayIntersections(startCoords, endCoords);
        if (!cutawayIxs.length)
            return 1;
        return this._penaltiesForIntersections(startCoords, endCoords, cutawayIxs);
    }

    // ----- NOTE: Secondary methods ----- //

    /**
   * @typedef {PIXI.Point} CutawayIntersection
   * @prop {CutawayShape} shape   Shape that is intersected
   * @prop {boolean} movingInto   From start --> end, are we moving into the shape?
   * @prop {number} moveMultiplier
   */

    /**
   * Get all the cutaways for tokens, regions, drawings for a given start|end segment.
   * Associate each cutaway with its underlying object.
   * @param {Point3d} start
   * @param {Point3d} end
   * @returns {CutawayIntersection[]} Polygon with an associated object.
   */
    _cutawayIntersections(start, end) {
        const cutawayIxs = [];
        if (this.constructor.terrainAPI) {
            for (const region of this.pathRegions) {
                const ixs = region.terrainmapper._cutawayIntersections(start, end);
                ixs.forEach(ix => ix.region = region);
                cutawayIxs.push(...ixs);
            }
        }
        for (const token of this.pathTokens) {
            const ixs = this.constructor.tokenCutawayIntersections(start, end, token);
            ixs.forEach(ix => ix.token = token);
            cutawayIxs.push(...ixs);
        }
        for (const drawing of this.pathDrawings) {
            const ixs = this.constructor.drawingCutawayIntersections(start, end, drawing);
            ixs.forEach(ix => ix.drawing = drawing);
            cutawayIxs.push(...ixs);
        }
        return cutawayIxs;
    }

    /**
   * Determine movement penalties along a start|end segment for a given array of intersections.
   * @param {Point3d} start
   * @param {Point3d} end
   * @param {CutawayIntersection[]} cutawayIxs
   * @returns {number} The penalty multiplier for the given start --> end
   */
    _penaltiesForIntersections(start, end, cutawayIxs) {
        if (!cutawayIxs.length)
            return 1;

        // Tokens
        const tokenMultiplier = this.constructor.tokenMultiplier;
        const useTokenFlat = this.constructor.useFlatTokenMultiplier;

        // Regions
        const testRegions = this.constructor.terrainAPI && this.pathRegions;
        let startingSpeed = this.baseTokenSpeed;

        // Traverse each intersection, determining the speed multiplier from starting speed
        // and calculating total time and distance. x meters / y meters/second = x/y seconds
        const { to2d, convertToDistance } = CONFIG.GeometryLib.utils.cutaway;
        let totalUnmodifiedDistance = 0;
        let totalTime = 0;
        let currentMultiplier = 1;
        let currentFlat = 0;
        const start2d = convertToDistance(to2d(start, start, end));
        const end2d = convertToDistance(to2d(end, start, end));
        let ix = start2d;
        cutawayIxs = cutawayIxs.map(ix => convertToDistance(shallowCopyCutawayIntersection(ix))); // Avoid modifying the originals.
        cutawayIxs.push(end2d);
        cutawayIxs.sort((a, b) => a.x - b.x);

        // Add terrains currently on the token but keep the speed based on the non-terrain token.
        let currRegions = [];
        if (testRegions) {
            const regions = [...this.regions].filter(r => r.testPoint(this.moveToken.center, this.moveToken.elevationE));
            currRegions = new Set(regions);
        }

        const addRegionFn = region => currRegions.add(region);
        const removeRegionFn = region => currRegions.delete(region);

        // For debugging, track the iterative steps.
        const calcSteps = [];
        for (const nextIx of cutawayIxs) {
            // Must invert the multiplier to apply them as penalties. So a 2x penalty is 1/2 times speed.
            const multFn = ix.movingInto ? x => 1 / x : x => x;
            const addFn = ix.movingInto ? x => x : x => -x;
            const regionFn = ix.movingInto ? addRegionFn : removeRegionFn;

            // Add in the penalties or multipliers at the current position.
            if (ix.token) {
                if (useTokenFlat)
                    currentFlat += addFn(tokenMultiplier);
                else
                    currentMultiplier *= multFn(tokenMultiplier);
            }
            if (ix.drawing) {
                const penalty = ix.drawing.document.getFlag(MODULE_ID, FLAGS.MOVEMENT_PENALTY);
                if (ix.drawing.document.getFlag(MODULE_ID, FLAGS.MOVEMENT_PENALTY_FLAT))
                    currentFlat += addFn(penalty);
                else
                    currentMultiplier *= multFn(penalty);
            }
            if (testRegions && ix.region)
                regionFn(ix.region);

            // Process all intersections at this same point (e.g., multiple regions with same border).
            if (ix.almostEqual(nextIx)) {
                ix = nextIx;
                continue;
            }

            // Now we have ix --> nextIx where effects due to ix have been processed.
            const calcStep = { ix, nextIx, currRegions: [...currRegions] };
            calcSteps.push(calcStep);
            calcStep.flat = currentFlat;
            calcStep.multiplier = currentMultiplier;
            calcStep.dist = CONFIG.GeometryLib.utils.pixelsToGridUnits(PIXI.Point.distanceBetween(ix, nextIx));
            totalUnmodifiedDistance += calcStep.dist;

            const currSpeed = (testRegions && currRegions.size)
                ? this.moveSpeedWithinRegions([...currRegions]) : startingSpeed;
            calcStep.tokenSpeed = (currSpeed * calcStep.multiplier);

            // Flat adds extra distance to the grid square. Diagonal is longer, so will have larger penalty.
            calcStep.dist += (calcStep.dist * currentFlat / canvas.grid.distance);
            totalTime += (calcStep.dist / calcStep.tokenSpeed);
            ix = nextIx;
        }

        /* Debug
    console.debug(`_penaltiesForIntersections|${start.x},${start.y},${start.z}
      -> ${end.x},${end.y},${end.z}`, calcSteps, cutawayIxs);
    */

        // Determine the ratio compared to a set speed
        const totalDefaultTime = totalUnmodifiedDistance / startingSpeed;
        const avgMultiplier = (totalDefaultTime / totalTime) || 0;
        return 1 / avgMultiplier;
    }

    // ----- NOTE: Helper methods ----- //

    /**
   * Get the terrain elevation at a specific grid position
   * Only considers terrains that block movement
   * @param {GridCoordinates3d} coords   Grid coordinates
   * @returns {number|null} The top elevation of terrain at this position, or null if no terrain
   */
    getTerrainElevationAt(coords) {
        const tht = this.constructor.terrainHeightToolsAPI;
        if (!tht)
            return null;

        const centerPt = coords.center;
        const terrains = this.constructor.getTerrainHeightToolsAt(centerPt);
        if (terrains.length === 0)
            return 0;

        // Return the highest terrain top (elevation + height) only for terrains that block movement
        return terrains.reduce((max, { terrain, type }) => {
            // Only consider terrain if it blocks movement
            if (type.blockMovement) {
                return Math.max(max, terrain.elevation + terrain.height);
            }
            return max;
        }, 0);
    }

    // ----- NOTE: Static getters ----- //

    /** @type {number} */
    static get tokenMultiplier() {
        return Settings.get(Settings.KEYS.MEASURING.TOKEN_MULTIPLIER);
    }

    /** @type {boolean} */
    static get useFlatTokenMultiplier() {
        return Settings.get(Settings.KEYS.MEASURING.TOKEN_MULTIPLIER_FLAT);
    }

    /** @type {object|undefined} */
    static get terrainAPI() {
        return OTHER_MODULES.TERRAIN_MAPPER.API;
    }

    /** @type {object|undefined} */
    static get terrainHeightToolsAPI() {
        return OTHER_MODULES.TERRAIN_HEIGHT_TOOLS.API;
    }

    // ----- NOTE: Static methods ----- //
    /**
   * Get all Terrain Height Tools terrains for all spaces occupied by the moving token
   * @param {GridCoordinates3d} coords     Grid coordinates of the token's center
   * @param {GridCoordinates3d} [startCoords]  Optional start coordinates for accurate path calculation
   * @param {GridCoordinates3d} [endCoords]    Optional end coordinates for accurate path calculation
   * @returns {Array} Array of unique terrain types with their penalties
   */
    _getTerrainHeightToolsAtTokenShape(prevCoords, coords) {
        const token = canvas.controls.ruler?.token;
        if (!token) {
            // Fallback to center point if no token
            return this.constructor.getTerrainHeightToolsAt(coords.center);
        }

        // Get grid position from center point
        const centerPt = coords.center;
        const gridPos = canvas.grid.getOffset({ x: centerPt.x, y: centerPt.y });

        // Get token shape area
        const tokenShape = getTokenShape(token);
        const area = getAreaFromPositionAndShape({ x: gridPos.j, y: gridPos.i }, tokenShape);

        // Collect all terrains from all spaces in the token shape
        const allTerrains = [];

        for (const space of area) {
            const spaceCenterPixel = canvas.grid.getCenterPoint({ j: space.x, i: space.y });
            const terrains = this.constructor.getTerrainHeightToolsAt(spaceCenterPixel);
            allTerrains.push(...terrains);
        }

        // Remove duplicates (keep unique terrains)
        const uniqueTerrains = [];
        const seen = new Set();
        for (const terrain of allTerrains) {
            const key = terrain.type.id;
            if (!seen.has(key)) {
                seen.add(key);
                uniqueTerrains.push(terrain);
            }
        }
        return uniqueTerrains;
    }

    /**
   * Get all templates (difficult terrain zones) covering the token's grid spaces at coords.
   * Mirrors _getTerrainHeightToolsAtTokenShape: uses coords + token shape to check all occupied hexes.
   * @param {GridCoordinates3d} prevCoords
   * @param {GridCoordinates3d} coords
   * @returns {MeasuredTemplate[]}
   */
    _getTemplatesAtTokenShape(_prevCoords, coords) {
        if (!this.templates.size)
            return [];
        const token = canvas.controls.ruler?.token;

        // Get the center pixel of the destination grid space
        const centerPt = coords.center;

        let spacesToCheck;
        if (!token) {
            spacesToCheck = [centerPt];
        } else {
            // Same as _getTerrainHeightToolsAtTokenShape: get all grid cells token occupies
            const gridPos = canvas.grid.getOffset({ x: centerPt.x, y: centerPt.y });
            const tokenShape = getTokenShape(token);
            const area = getAreaFromPositionAndShape({ x: gridPos.j, y: gridPos.i }, tokenShape);
            spacesToCheck = area.map(space => canvas.grid.getCenterPoint({ j: space.x, i: space.y }));
        }

        // Use Foundry's exact _getGridHighlightPositions algorithm:
        // try 9 sample points per cell (center ± 0.5) to handle boundary precision
        const matched = new Set();
        for (const pt of spacesToCheck) {
            for (const t of this.templates) {
                if (!t.shape)
                    continue;
                const ox = t.document.x;
                const oy = t.document.y;
                const cx = pt.x;
                const cy = pt.y;
                // Origin cell is always covered
                let covered = Math.max(Math.abs(cx - ox), Math.abs(cy - oy)) < 1;
                if (!covered) {
                    outer: for (let dx = -0.5; dx <= 0.5; dx += 0.5) {
                        for (let dy = -0.5; dy <= 0.5; dy += 0.5) {
                            if (t.shape.contains(cx - ox + dx, cy - oy + dy)) {
                                covered = true;
                                break outer;
                            }
                        }
                    }
                }
                if (covered)
                    matched.add(t);
            }
        }
        return [...matched];
    }

    /**
   * Get all Terrain Height Tools terrains at a specific point
   * @param {Point} point     The point to check (with x, y, elevation properties)
   * @returns {Array} Array of terrain types with their penalties
   */
    static getTerrainHeightToolsAt(point) {
        if (!Settings.get(Settings.KEYS.TERRAIN_HEIGHT_TOOLS))
            return [];
        const tht = OTHER_MODULES.TERRAIN_HEIGHT_TOOLS;
        if (!tht.ACTIVE || !tht.API)
            return [];

        // Convert pixel coordinates to grid coordinates
        // getOffset returns { i: row, j: col }
        const gridPos = canvas.grid.getOffset({ x: point.x, y: point.y });

        // Get terrain data at this grid cell using THT API
        // getCell expects (x=col, y=row) so we pass (j, i)
        const cellData = tht.API.getCell(gridPos.j, gridPos.i);
        if (!cellData || !cellData.length)
            return [];

        // Get all terrain type configurations
        const terrainTypes = tht.getTerrainTypes?.() || [];
        if (!terrainTypes.length)
            return [];

        //const pointElevation = point.elevation ?? point.z ?? 0;
        const pointElevation = 0;
        const terrains = [];

        // Check each terrain in the cell
        for (const terrain of cellData) {
            // Check if point is within the terrain's elevation range
            //for now we ignore elevation
            if ( /*pointElevation >= terrain.elevation &&*/ pointElevation <= (terrain.elevation + terrain.height)) {
                // Find the terrain type configuration
                const terrainType = terrainTypes.find(t => t.id === terrain.terrainTypeId);
                if (terrainType) {
                    // Return both terrain (with actual elevation and height) and type (with configuration)
                    terrains.push({ terrain, type: terrainType });
                }
            }
        }

        return terrains;
    }
    /**
   * Construct a polygon in cutaway space for a given drawing, based on a line segment.
   * Drawing assumed to be infinite in z direction up, stopping at the drawing elevation.
   * @param {Point3d} start     The beginning endpoint for the 3d segment start|end
   * @param {Point3d} end       The ending point for the 3d segment start|end
   * @param {Drawing} drawing
   * @returns {PIXI.Polygon[]}
   */
    static drawingCutawayIntersections(start, end, drawing) {
        const MAX_ELEV = 1e06;
        const bottomZ = drawing.elevationZ;
        const bottomElevationFn = _pt => bottomZ;
        const topElevationFn = _pt => MAX_ELEV;
        const centeredShape = CONFIG.GeometryLib.utils.centeredPolygonFromDrawing(drawing);

        // Multiple cutaways are possible for polygons.
        // Use the full drawing shape b/c we need to test for actual intersections with the shape.
        // Can get by extending the start and end points to the canvas edge.
        const dist = -canvas.dimensions.maxR;
        const a = start.towardsPoint(end, dist);
        const b = end.towardsPoint(start, dist);
        const cutaways = centeredShape.cutaway(a, b, { start, end, bottomElevationFn, topElevationFn });
        return cutaways.flatMap(cutaway => {
            const ixs = cutaway.intersectSegment3d(start, end);
            if (cutaway.contains3d(start)) {
                const pt = cutaway._to2d(start);
                pt.movingInto = true;
                ixs.push(pt);
            }
            return ixs;
        });
    }

    /**
   * Construct a polygon in cutaway space for a given token, based on a line segment.
   * Token bottom assumed to be elevation and token top to be the token height.
   * @param {Point3d} start   The beginning endpoint for the 3d segment start|end
   * @param {Point3d} end     The ending point for the 3d segment start|end
   * @param {Token} token
   * @returns {PIXI.Polygon[]} Null if no intersection
   */
    static tokenCutawayIntersections(start, end, token) {
        const bottomElevationFn = () => token.bottomZ;
        const topElevationFn = () => token.topZ;

        // Multiple cutaways are possible if the token is constrained (e.g., inset edge).
        // Use the full token shape b/c we need to test for actual intersections with the shape.
        // Can get by extending the start and end points to the canvas edge.
        const dist = -canvas.dimensions.maxR;
        const a = start.towardsPoint(end, dist);
        const b = end.towardsPoint(start, dist);
        const cutaways = token.constrainedTokenBorder.cutaway(a, b, { start, end, bottomElevationFn, topElevationFn });
        return cutaways.flatMap(cutaway => {
            const ixs = cutaway.intersectSegment3d(start, end);
            if (cutaway.contains3d(start)) {
                const pt = cutaway._to2d(start);
                pt.movingInto = true;
                ixs.push(pt);
            }
            return ixs;
        });
    }
}

/**
 * Duplicate pertinent parts of a CutawayIntersection.
 * @param {CutawayIntersection} ix
 * @returns {CutawayIntersection}
 */
function shallowCopyCutawayIntersection(ix) {
    const newIx = new ix.constructor();
    Object.getOwnPropertyNames(ix).forEach(key => newIx[key] = ix[key]);
    return newIx;
}

/**
 * A function that returns the cost for a given move between grid/gridless spaces.
 * In square and hexagonal grids the grid spaces are always adjacent unless teleported.
 * The distance is 0 if and only if teleported. The function is never called with the same offsets.
 * @callback GridMeasurePathCostFunction
 * @param {GridOffset} from    The offset that is moved from.
 * @param {GridOffset} to      The offset that is moved to.
 * @param {number} distance    The distance between the grid spaces, or 0 if teleported.
 * @returns {number}           The cost of the move between the grid spaces.
 */
