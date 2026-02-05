/* globals
PIXI
*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */
"use strict";

import "./ClipperPaths.js";
import { GEOMETRY_CONFIG } from "./const.js";

/**
 * Class that holds an array of PIXI shapes (PIXI.Polygon, PIXI.Circle, etc.)
 * If the shape is a hole, it has the "isHole" property added.
 * The class handles certain polygon and other shape methods, such as `contains`.
 * Does not handle "double-donut" holes. In otherwords, holes are assumed to not have
 * any non-holed shape contained within.
 */
export class ShapeHoled {

  /**
   * @typedef {PIXI.Polygon|PIXI.Rectangle|PIXI.Circle|PIXI.Ellipse} Shape
   * @property {boolean} [isHole]     Optional property that if true, indicates it is a hole.
   */

  /** @type {Shape[]} */
  shapes = [];

  /** @type {Shape[]} */
  holes = [];

  /** @type {PIXI.Rectangle} */
  #bounds;

  /**
   * @param {Shape[]} shapes     Array of PIXI shapes that make up this shape.
   *   Any shape with property `isHole` will be considered a hole.
   * @param {object} [opts]
   * @param {Shape[]} [holes]    Array of shapes that should be holes. Will be marked as `isHole`.
   *   (So duplicate these shapes if you are not using them as holes elsewhere.)
   */
  constructor(shapes = [], { holes } = {}) {
    if ( holes ) holes.forEach(idx => shapes[idx].isHole = true);
    shapes.forEach(s => {
      const arr = s.isHole ? this.holes : this.shapes;
      arr.push(s);
    });
  }

  /** @type {PIXI.Rectangle} */
  get bounds() { return this.#bounds || (this.#bounds = this.getBounds()); }

  /**
   * Add a shape. If it has the `isHole` property, add as hole.
   * @param {Shape}
   */
  add(shape) {
    if ( shape.isHole ) return this.addHole(shape);
    this.shapes.push(shape);
    this.#bounds = undefined;
  }

  /**
   * Add a hole
   * @param {Shape}
   */
  addHole(shape) {
    shape.isHole = true;
    this.holes.push(shape);
    this.#bounds = undefined;
  }

  /**
   * Draw this shape with given graphics.
   * @param {PIXI.Graphics} graphics
   */
  draw(graphics) {
    this.shapes.forEach(s => graphics.drawShape(s));
    graphics.beginHole();
    this.holes.forEach(h => graphics.drawShape(h));
    graphics.endHole();
  }

  /**
   * If any non-holed shape contains this point, and no holed shape
   * contains the point, return true.
   * @param {number} x      X coordinate of the point to test
   * @param {number} y      Y coordinate of the point to test
   * @returns {boolean}
   */
  contains(x, y) {
    if ( !this.shapes.some(s => s.contains(x, y)) ) return false;
    return this.holes.every(h => !h.contains(x, y));
  }

  /**
   * Get the bounds of this shape.
   * Combines the bounds of all shapes within.
   * @returns {PIXI.Rectangle}
   */
  getBounds() {
    const shapes = [...this.shapes, ...this.holes];
    if ( !shapes.length ) {
      console.warn("ShapeHoled|getBounds cannot find any shapes.");
      return new PIXI.Rectangle();
    }
    let bounds = shapes[0].getBounds();
    const ln = shapes.length;
    for ( let i = 1; i < ln; i += 1 ) {
      const b2 = shapes[i].getBounds();
      bounds = bounds.union(b2);
    }
    return bounds;
  }

  /**
   * Convert to clipper paths.
   * Any non-polygons will be converted to polygons.
   * @returns {ClipperPaths}
   */
  toClipperPaths() {
    this.holes.forEach(h => {
      if ( h.isClockwise ) h.reverseOrientation();
    });

    const polygons = [...this.shapes, ...this.holes].map(s => s.toPolygon())
    return CONFIG.GeometryLib.ClipperPaths.fromPolygons(polygons);
  }

  /**
   * Convert from clipper paths.
   * @param {ClipperPaths} clipperPaths
   * @returns {PolygonHoled}
   */
  fromClipperPaths(clipperPaths) { return new this.constructor(clipperPaths.toPolygons()); }

  /**
   * Clean the shapes, combining where possible.
   * Will force non-polygons to be polygons.
   * @returns {PolygonHoled}  New object, after running the shapes through Clipper.
   */
  clean() {
    const c = this.toClipperPaths();
    c.clean();
    return this.fromClipperPaths(c);
  }

  /**
   * Simplify if possible, returning individual shapes if they do not overlap holes.
   * @param {boolean} [modifySelf=false]  If true, modify this object.
   * @returns {(PolygonHoled|Shape)[]} Array of shapes or PolygonHoled
   */
  simplify(modifySelf = false) {
    // If any shapes are completely contained in another, remove.
    const { holes, shapes } = this;
    let filteredShapes = shapes.filter(s1 => !shapes.some(s2 => s2.envelops(s1)));
    let filteredHoles = holes.filter(h1 => !holes.some(h2 => h2.envelops(h1)));

    // If a hole "eats" a shape by encompassing it, remove the shape.
    filteredShapes = filteredShapes.filter(s => !filteredHoles.some(h => h.envelops(s)));

    // If a hole is outside all shapes, remove the hole.
    // (Technically, should probably have only holes that are encompassed by shapes. Would require clean.)
    filteredHoles = filteredHoles.filter(h => filteredShapes.some(s => s.overlaps(h)));

    // Update this object if required.
    if ( modifySelf ) {
      this.shapes.length = 0;
      this.holes.length = 0;
      this.shapes.push(...filteredShapes);
      this.holes.push(...filteredHoles);
      this.#bounds = undefined;
    }

    // If no holes, just return the array of shapes.
    if ( !this.holes.length ) return filteredShapes;

    // Determine if any shapes are not interacting with a hole, and pull those out separately.
    const standaloneShapes = [];
    const remainingShapes = [];
    for ( const s of filteredShapes ) {
      const arr = filteredHoles.some(h => s.overlaps(h)) ? remainingShapes : standaloneShapes;
      arr.push(s);
    }

    return [new this.constructor([...remainingShapes, ...filteredHoles]), ...standaloneShapes];
  }

  /**
   * Test if this shape overlaps another.
   * If any of the subshapes overlap, and no hole encompasses, then true.
   * (This may return false where 2+ polygons together overlap the other shape.)
   * @param {PIXI.Polygon|PIXI.Circle|PIXI.Rectangle} other
   * @returns {boolean}
   */
  overlaps(other) {
    if ( !this.shapes.some(s => s.overlaps(other)) ) return false;
    return !this.holes.some(h => h.encompasses(other));
  }


  /**
   * Test if this shape encompasses another.
   * If any of the subshapes encompass, and no hole overlaps, then it encompasses.
   * (This may return false where 2+ polygons together encompass the other shape.)
   * @param {PIXI.Polygon|PIXI.Circle|PIXI.Rectangle}
   * @returns {boolean}
   */
  envelops(other) {
    if ( !this.shapes.some(s => s.envelops(other)) ) return false;
    return !this.holes.some(h => h.overlaps(other));
  }
}

GEOMETRY_CONFIG.ShapeHoled ??= ShapeHoled;

