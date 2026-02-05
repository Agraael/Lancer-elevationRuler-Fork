/* globals
PIXI,
ClipperLib,
canvas,
CONFIG
*/
"use strict";

import { GEOMETRY_CONFIG } from "./const.js";
import "./Draw.js";

/**
 * Class to manage ClipperPaths for multiple polygons.
 */
export class ClipperPaths {
  scalingFactor = 1;

  /**
   * @param paths {ClipperLib.Path[]|Set<ClipperLib.Path>|Map<ClipperLib.Path>}
   * @returns {ClipperPaths}
   */
  constructor(paths = [], { scalingFactor = 1 } = {}) {
    this.paths = [...paths]; // Ensure these are arrays
    this.scalingFactor = scalingFactor;
  }

  /**
   * Determine the best way to represent Clipper paths.
   * @param {ClipperLib.Paths}
   * @returns {PIXI.Polygon|PIXI.Rectangle|ClipperPaths} Return a polygon, rectangle,
   *   or ClipperPaths depending on paths.
   */
  static processPaths(paths) {
    if (paths.length > 1) return ClipperPaths(paths);

    return ClipperPaths.polygonToRectangle(paths[0]);
  }

  /**
   * Convert an array of polygons to ClipperPaths
   * @param {PIXI.Polygon[]}
   * @returns {ClipperPaths}
   */
  static fromPolygons(polygons, { scalingFactor = 1 } = {}) {
    const out = new ClipperPaths(polygons.map(p => p.toClipperPoints({scalingFactor})), { scalingFactor });
    return out;
  }

  /**
   * Flatten a path of X, Y to an array
   * @param {ClipperPoints[]} path
   * @returns {number[]}
   */
  static flattenPath(path) {
    const nPts = path.length;
    const res = new Array(nPts * 2);
    for ( let i = 0, j = 0; i < nPts; i += 1, j += 2 ) {
      const pt = path[i];
      res[j] = pt.X;
      res[j + 1] = pt.Y;
    }
    return res;
  }

  /**
   * Check if polygon can be converted to a rectangle
   * @param {PIXI.Polygon} polygon
   * @returns {PIXI.Polygon|PIXI.Rectangle}
   */
  static polygonToRectangle(polygon) {
    const pts = polygon.points;
    if ( (polygon.isClosed && pts.length !== 10)
      || (!polygon.isClosed && pts.length !== 8) ) return polygon;

    // Layout must be clockwise.
    // Layout options:
    // - 0, 1           2, 3          4, 5          6, 7
    // - left,top       right,top     right,bottom  left,bottom
    // - right,top      right,bottom  left,bottom   left,top
    // - right,bottom   left,bottom   left,top      right,top
    // - left,bottom    left,top      right,top     right,bottom

    if ( (pts[0] === pts[2] && pts[4] === pts[6] && pts[3] === pts[5] && pts[7] === pts[1])
      || (pts[1] === pts[3] && pts[5] === pts[7] && pts[2] === pts[4] && pts[6] === pts[0]) ) {

      const leftX = Math.min(pts[0], pts[2], pts[4], pts[6]);
      const rightX = Math.max(pts[0], pts[2], pts[4], pts[6]);
      const topY = Math.min(pts[1], pts[3], pts[5], pts[7]);
      const bottomY = Math.max(pts[1], pts[3], pts[5], pts[7]);

      return new PIXI.Rectangle(leftX, topY, rightX - leftX, bottomY - topY);
    }

    return polygon;
  }

  /**
   * Convert paths to earcut coordinates.
   * See https://github.com/mapbox/earcut
   * @returns {object} Object with vertices, holes, dimensions = 2.
   */
  toEarcutCoordinates() {
    const out = {
      vertices: [],
      holes: [],
      dimensions: 2
    };

    const paths = this.paths;
    const nPaths = paths.length;
    if ( nPaths === 0 ) return out;

    out.vertices = ClipperPaths.flattenPath(paths[0]);
    for ( let i = 1; i < nPaths; i += 1 ) {
      const path = paths[i];
      const isHole = !ClipperLib.Clipper.Orientation(path);
      if ( !isHole ) console.warn("Earcut may fail with multiple outer polygons.");
      const category = isHole ? out.holes : out.vertices;
      category.push(ClipperPaths.flattenPath(path));
    }

    // Concatenate holes and add indices
    const nHoles = out.holes.length;
    if ( nHoles > 0 ) {
      const indices = [];
      let nVertices = out.vertices.length * 0.5;
      for ( let i = 0; i < nHoles; i += 1 ) {
        const hole = out.holes[i];
        const nPts = hole.length * 0.5;
        out.vertices.push(...hole);
        indices.push(nVertices); // Vertices index starts at 0.
        nVertices += nPts;
      }
      out.holes = indices;
    }

    return out;
  }

  /**
   * Convert a flat array with indices of triangles, as in earcut, to ClipperPaths.
   * Each 3 numbers in the indices array correspond to a triangle
   * @param {number[]} vertices
   * @param {number[]} indices
   * @param {number} dimensions     Number of dimensions for the vertices. Z, etc. will be ignored.
   * @returns {ClipperPaths}
   */
  static fromEarcutCoordinates(vertices, indices, dimensions = 2) {
    const cPaths = new this();
    const nIndices = indices.length;
    for ( let i = 0; i < nIndices; ) { // Increment i in the loop
      const path = new Array(3);
      for ( let j = 0; j < 3; j += 1 ) {
        const idx = indices[i] * dimensions;
        const v = { X: vertices[idx], Y: vertices[idx + 1] };
        path[j] = v;
        i += 1;
      }
      cPaths.paths.push(path);
    }
    return cPaths;
  }

  /**
   * Use earcut to triangulate these paths.
   * See https://github.com/mapbox/earcut.
   * @returns {ClipperPaths} Paths constructed from the resulting triangles
   */
  earcut() {
    const coords = this.toEarcutCoordinates();
    const res = PIXI.utils.earcut(coords.vertices, coords.holes, coords.dimensions);
    return ClipperPaths.fromEarcutCoordinates(coords.vertices, res, coords.dimensions);
  }

  /**
   * Calculate the area for this set of paths.
   * Use getter to correspond with PIXI.Polygon.prototype.area and other polygon types.
   * @returns {number}
   */
  get area() {
    return ClipperLib.JS.AreaOfPolygons(this.paths) / Math.pow(this.scalingFactor, 2);
  }

  /**
   * Area that matches clipper measurements, so it can be compared with Clipper Polygon versions.
   * Used to match what Clipper would measure as area, by scaling the points.
   * @param {object} [options]
   * @param {number} [scalingFactor]  Scale like with PIXI.Polygon.prototype.toClipperPoints.
   * @returns {number}  Positive if clockwise. (b/c y-axis is reversed in Foundry)
   */
  scaledArea({scalingFactor = 1} = {}) {
    if ( scalingFactor !== this.scalingFactor ) console.warn("ClipperPaths|scaledArea requested scalingFactor does not match.");
    return this.area;
  }

  /**
   * If the path is single, convert to polygon (or rectangle if possible)
   * @returns {PIXI.Polygon|PIXI.Rectangle|ClipperPaths}
   */
  simplify() {
    if ( this.paths.length > 1 ) return this;
    if ( this.paths.length === 0 ) return new PIXI.Polygon();
    return ClipperPaths.polygonToRectangle(this.toPolygons()[0]);
  }

  /**
   * Convert this to an array of PIXI.Polygons.
   * @returns {PIXI.Polygons[]}
   */
  toPolygons() {
    return this.paths.map(pts => {
      const poly = PIXI.Polygon.fromClipperPoints(pts, {scalingFactor: this.scalingFactor});
      poly.isHole = !ClipperLib.Clipper.Orientation(pts);
      return poly;
    });
  }

  /**
   * Run CleanPolygons on the paths
   * @param {number} cleanDelta   Value, multiplied by scalingFactor, passed to CleanPolygons.
   * @returns {ClipperPaths}  This object.
   */
  clean(cleanDelta = 0.1) {
    ClipperLib.Clipper.CleanPolygons(this.paths, cleanDelta * this.scalingFactor);
    return this;
  }

  /**
   * Execute a Clipper.clipType combination using the polygon as the subject.
   * @param {PIXI.Polygon} polygon          Subject for the clip
   * @param {ClipperLib.ClipType} clipType  ctIntersection: 0, ctUnion: 1, ctDifference: 2, ctXor: 3
   * @param {object} [options]              Options passed to ClipperLib.Clipper().Execute
   * @param {number} [subjFillType]         Fill type for the subject. Defaults to pftEvenOdd.
   * @param {number} [clipFillType]         Fill type for the clip. Defaults to pftEvenOdd.
   * @returns {ClipperPaths} New ClipperPaths object
   */
  _clipperClip(polygon, type, {
    subjFillType = ClipperLib.PolyFillType.pftEvenOdd,
    clipFillType = ClipperLib.PolyFillType.pftEvenOdd } = {}) {

    const c = new ClipperLib.Clipper();
    const solution = new ClipperPaths();
    solution.scalingFactor = this.scalingFactor;

    c.AddPath(polygon.toClipperPoints({ scalingFactor: this.scalingFactor }), ClipperLib.PolyType.ptSubject, true);
    c.AddPaths(this.paths, ClipperLib.PolyType.ptClip, true);
    c.Execute(type, solution.paths, subjFillType, clipFillType);

    return solution;
  }



  /**
   * Intersect this set of paths with a polygon as subject.
   * @param {PIXI.Polygon}
   * @returns {ClipperPaths}
   */
  intersectPolygon(polygon) {
    return this._clipperClip(polygon, ClipperLib.ClipType.ctIntersection);
  }

  /**
   * Add a set of paths to this one
   * @param {ClipperPaths} other
   * @returns {ClipperPaths}
   */
  add(other) {
    if ( !other.paths.length ) return this;
    this.paths.push(...other.paths);
    return this;
  }

  /**
   * Intersect this set of paths against another, taking the other as subject.
   * @param {ClipperPaths} other
   * @returns {ClipperPaths}
   */
  intersectPaths(other) {
    const type = ClipperLib.ClipType.ctIntersection;
    const subjFillType = ClipperLib.PolyFillType.pftEvenOdd;
    const clipFillType = ClipperLib.PolyFillType.pftEvenOdd;

    const c = new ClipperLib.Clipper();
    const solution = new ClipperPaths();
    solution.scalingFactor = this.scalingFactor;

    c.AddPaths(other.paths, ClipperLib.PolyType.ptSubject, true);
    c.AddPaths(this.paths, ClipperLib.PolyType.ptClip, true);
    c.Execute(type, solution.paths, subjFillType, clipFillType);

    return solution;
  }

  /**
   * Using other as a subject, take the difference of this ClipperPaths.
   * @param {ClipperPaths} other
   * @returns {ClipperPaths}
   */
  diffPaths(other) {
    const type = ClipperLib.ClipType.ctDifference;
    const subjFillType = ClipperLib.PolyFillType.pftEvenOdd;
    const clipFillType = ClipperLib.PolyFillType.pftEvenOdd;

    const c = new ClipperLib.Clipper();
    const solution = new ClipperPaths();
    solution.scalingFactor = this.scalingFactor;

    c.AddPaths(other.paths, ClipperLib.PolyType.ptSubject, true);
    c.AddPaths(this.paths, ClipperLib.PolyType.ptClip, true);
    c.Execute(type, solution.paths, subjFillType, clipFillType);

    return solution;
  }

  /**
   * Using a polygon as a subject, take the difference of this ClipperPaths.
   * @param {PIXI.Polygon} polygon
   * @returns {ClipperPaths}
   */
  diffPolygon(polygon) {
    return this._clipperClip(polygon, ClipperLib.ClipType.ctDifference);
  }

  /**
   * Union the paths.
   * @returns {ClipperPaths}
   */
  union() {
    if ( this.paths.length === 1 ) return this;
    const c = new ClipperLib.Clipper();
    const union = new ClipperPaths();
    union.scalingFactor = this.scalingFactor;
    c.AddPaths(this.paths, ClipperLib.PolyType.ptSubject, true);
    c.Execute(ClipperLib.ClipType.ctUnion,
      union.paths,
      ClipperLib.PolyFillType.pftNonZero,
      ClipperLib.PolyFillType.pftNonZero
      );
    return union;
  }

  /**
   * Union the paths, using a positive fill.
   * This version uses a positive fill type so any overlap is filled.
   * @returns {ClipperPaths}
   */
  combine() {
    if ( this.paths.length === 1 ) return this;

    const c = new ClipperLib.Clipper();
    const combined = new ClipperPaths();
    combined.scalingFactor = this.scalingFactor;

    c.AddPaths(this.paths, ClipperLib.PolyType.ptSubject, true);

    // To avoid the checkerboard issue, use a positive fill type so any overlap is filled.
    c.Execute(ClipperLib.ClipType.ctUnion,
      combined.paths,
      ClipperLib.PolyFillType.pftPositive,
      ClipperLib.PolyFillType.pftPositive);

    return combined;
  }

  /**
   * Join paths into a single ClipperPaths object
   * @param {ClipperPaths[]} pathsArr
   * @returns {ClipperPaths}
   */
  static joinPaths(pathsArr) {
    const ln = pathsArr.length;
    if ( !ln ) return undefined;

    const firstPath = pathsArr[0];
    if ( ln === 1 ) return firstPath;

    const cPaths = new ClipperPaths(firstPath.paths);
    cPaths.scalingFactor = firstPath.scalingFactor;

    for ( let i = 1; i < ln; i += 1 ) {
      const obj = pathsArr[i];
      if ( cPaths.scalingFactor !== obj.scalingFactor ) console.warn("ClipperPaths|combinePaths scalingFactor not equal.");

      cPaths.paths.push(...obj.paths);
    }
    return cPaths;
  }

  /**
   * Combine 2+ ClipperPaths objects using a union with a positive fill.
   * @param {ClipperPaths[]} pathsArr
   * @returns {ClipperPaths}
   */
  static combinePaths(pathsArr) {
    const cPaths = this.joinPaths(pathsArr);
    if ( !cPaths ) return undefined;
    return cPaths.combine();
  }

  /**
   * Execute a Clipper.clipType combination.
   * @param {ClipperPaths} subject          Subject for the clip
   * @param {ClipperPaths} clip             What to clip
   * @param {ClipperLib.ClipType} clipType  ctIntersection: 0, ctUnion: 1, ctDifference: 2, ctXor: 3
   * @param {object} [options]              Options passed to ClipperLib.Clipper().Execute
   * @param {number} [subjFillType]         Fill type for the subject. Defaults to pftEvenOdd.
   * @param {number} [clipFillType]         Fill type for the clip. Defaults to pftEvenOdd.
   * @returns {ClipperPaths} New ClipperPaths object
   */
  static clip(subject, clip, {
    clipType = ClipperLib.ClipType.ctUnion,
    subjFillType = ClipperLib.PolyFillType.pftEvenOdd,
    clipFillType = ClipperLib.PolyFillType.pftEvenOdd } = {}) {

    const c = new ClipperLib.Clipper();
    const solution = new this();
    solution.scalingFactor = subject.scalingFactor;
    c.AddPaths(subject.paths, ClipperLib.PolyType.ptSubject, true);
    c.AddPaths(clip.paths, ClipperLib.PolyType.ptClip, true);
    c.Execute(clipType, solution.paths, subjFillType, clipFillType);
    return solution;
  }

  /**
   * Draw the clipper paths, to the extent possible
   */
  draw({ graphics = canvas.controls.debug, color = CONFIG.GeometryLib.Draw.COLORS.black, width = 1, fill, fillAlpha = 1 } = {}) {
    if ( !fill ) fill = color;
    const polys = this.toPolygons();

    // Sort so holes are last.
    polys.sort((a, b) => a.isHole - b.isHole);
    if ( !polys.length || polys[0].isHole ) return; // All the polys are holes.

    graphics.beginFill(fill, fillAlpha);
    for ( const poly of polys ) {
      if ( poly.isHole ) graphics.beginHole();
      graphics.lineStyle(width, color).drawShape(poly);
      if ( poly.isHole ) graphics.endHole();
    }
    graphics.endFill();
  }
}

GEOMETRY_CONFIG.ClipperPaths ??= ClipperPaths;
