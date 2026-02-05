/* globals
CONFIG,
foundry
*/
"use strict";

const VERSION = "0.3.20";

// Foundry utils
import { GEOMETRY_CONFIG } from "./const.js";
import { registerFoundryUtilsMethods } from "./util.js";

// Regular Polygons
import "./RegularPolygon/RegularPolygon.js";
import "./RegularPolygon/EquilateralTriangle.js";
import "./RegularPolygon/Square.js";
import "./RegularPolygon/Hexagon.js";
import "./RegularPolygon/RegularStar.js";

// Centered Polygons
import "./CenteredPolygon/CenteredPolygonBase.js";
import "./CenteredPolygon/CenteredPolygon.js";
import "./CenteredPolygon/CenteredRectangle.js";

// Holed Shapes
import "./ShapeHoled.js";

// 3d
import "./3d/Plane.js";
import "./3d/Point3d.js";
import "./3d/Ray3d.js";

// Draw
import "./Draw.js";

// Ellipse
import "./Ellipse.js";

// Matrix
import "./Matrix.js";
import "./MatrixFlat.js";

// Shadow
import "./Shadow.js";

// ClipperPaths
import "./ClipperPaths.js";

// Graph
import "./Graph.js";

// Benchmark
import "./Benchmark.js";

// Patcher
import { Patcher } from "../Patcher.js";

// PIXI
import { PATCHES as PATCHES_Circle } from "./PIXI/Circle.js";
import { PATCHES as PATCHES_Point } from "./PIXI/Point.js";
import { PATCHES as PATCHES_Polygon } from "./PIXI/Polygon.js";
import { PATCHES as PATCHES_Rectangle } from "./PIXI/Rectangle.js";

// Elevation
import { PATCHES as PATCHES_ELEVATION } from "./elevation.js";

// Constrained Token Border and Edges
import { PATCHES as PATCHES_Token } from "./Token.js";
import { PATCHES as PATCHES_CanvasEdges } from "./CanvasEdges.js";
import { PATCHES as PATCHES_ConstrainedTokenBorder } from "./ConstrainedTokenBorder.js";
import { PATCHES as PATCHES_Edge } from "./Edge.js";

// PixelCache
import "./PixelCache.js";
import { PATCHES as PATCHES_Tile } from "./Tile.js";

// Grid measurement
import "./GridCoordinates.js";
import "./3d/GridCoordinates3d.js";
import "./3d/RegionMovementWaypoint3d.js";
import "./3d/HexGridCoordinates3d.js";

// Cutaway
import "./CutawayPolygon.js";

const PATCHES = {
  "PIXI.Circle": PATCHES_Circle,
  "PIXI.Point": PATCHES_Point,
  "PIXI.Polygon": PATCHES_Polygon,
  "PIXI.Rectangle": PATCHES_Rectangle,

  // PixelCache
  "Tile": PATCHES_Tile,

  // Elevation patches.
  "foundry.canvas.sources.BaseEffectSource": PATCHES_ELEVATION.PointSource,
  "foundry.canvas.sources.PointVisionSource": PATCHES_ELEVATION.VisionSource,
  "PlaceableObject": PATCHES_ELEVATION.PlaceableObject,
  "Wall": PATCHES_ELEVATION.Wall,

  // Elevation and Constrained Token patches
  "Token": foundry.utils.mergeObject(PATCHES_ELEVATION.Token, PATCHES_Token),
  "foundry.canvas.edges.CanvasEdges": PATCHES_CanvasEdges,
  "foundry.canvas.edges.Edge": PATCHES_Edge,
  "ConstrainedTokenBorder": PATCHES_ConstrainedTokenBorder
}

export function registerGeometry() {
  CONFIG.GeometryLib ??= {};
  CONFIG.GeometryLib.registered ??= new Set();
  const currentVersion = CONFIG.GeometryLib.version;
  if ( currentVersion && !foundry.utils.isNewerVersion(VERSION, currentVersion) ) return;
  registerFoundryUtilsMethods();
  registerGeometryLibConstants();
  foundry.utils.mergeObject(CONFIG.GeometryLib, GEOMETRY_CONFIG);
  registerGeometryLibPatches();
  CONFIG.GeometryLib.version = VERSION;
}

export function registerGeometryLibConstants() {
  CONFIG.GeometryLib ??= {};
  CONFIG.GeometryLib.proneStatusId = "prone";
  CONFIG.GeometryLib.proneMultiplier = 0.33;
  CONFIG.GeometryLib.visionHeightMultiplier = 1;
  CONFIG.GeometryLib.pixelCacheResolution = 1;
}

export function registerGeometryLibPatches() {
  // If older PATCHER is present, deregister it and remove it.
  if ( CONFIG.GeometryLib.PATCHER ) deRegister();

  // Create a new Patcher object and register the patches.
  CONFIG.GeometryLib.PATCHER = new Patcher();
  CONFIG.GeometryLib.PATCHER.addPatchesFromRegistrationObject(PATCHES);
  CONFIG.GeometryLib.PATCHER.registerGroup("PIXI");
  CONFIG.GeometryLib.PATCHER.registerGroup("CONSTRAINED_TOKEN_BORDER");
  CONFIG.GeometryLib.PATCHER.registerGroup("CANVAS_EDGES");
  CONFIG.GeometryLib.PATCHER.registerGroup("PIXEL_CACHE");
  CONFIG.GeometryLib.PATCHER.registerGroup("ELEVATION");
}

function deRegister() {
  CONFIG.GeometryLib.registered?.clear();
  CONFIG.GeometryLib.PATCHER.deregisterGroup("ELEVATION");
  CONFIG.GeometryLib.PATCHER.deregisterGroup("PIXI");
  CONFIG.GeometryLib.PATCHER.deregisterGroup("PIXEL_CACHE");
  CONFIG.GeometryLib.PATCHER.deregisterGroup("CANVAS_EDGES");
  CONFIG.GeometryLib.PATCHER.deregisterGroup("CONSTRAINED_TOKEN_BORDER");
}
