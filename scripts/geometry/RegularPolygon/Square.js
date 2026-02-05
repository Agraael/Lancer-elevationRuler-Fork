/* globals
PIXI
*/
"use strict";

import "./RegularPolygon.js";
import { GEOMETRY_CONFIG } from "../const.js";

const squareRotations = new Set([45, 135, 225, 315]); // Oriented []
const diagonalRotations = new Set([0, 90, 180, 270]); // Oriented [] turned 45º

/**
 * Square is oriented at 0º rotation like a diamond.
 * Special case when square is rotate 45º or some multiple thereof
 * @param {Point} origin  Center point of the square
 * @param {number} radius Circumscribed circle radius
 * @param {object} options
 * @param {number} [options.rotation]   Rotation in degrees
 * @param {number} [options.width]      Alternative specification when skipping radius
 */
export class Square extends GEOMETRY_CONFIG.RegularPolygons.RegularPolygon {

  constructor(origin, radius, {rotation = 0, width} = {}) {
    if ( !radius && !width ) {
      console.warn("Square should have either radius or width defined.");
      radius = 0;
      width = 0;
    }

    radius ??= Math.sqrt(Math.pow(width, 2) * 2);
    super(origin, radius, { rotation, numSides: 4 });

    this.width = width ?? (this.radius * Math.SQRT1_2);
  }

  /**
   * Calculate the distance of the line segment from the center to the midpoint of a side.
   * @type {number}
   */
  get apothem() { return this.width * 0.5; }

  /**
   * Calculate length of a side of this square.
   * @type {number}
   */
  get sideLength() { return this.apothem * 2; }

  /**
   * Calculate area of this square.
   * @type {number}
   */
  get area() { return Math.pow(this.sideLength, 2); }

  /**
   * Construct a square like a PIXI.Rectangle, where the point is the top left corner.
   */
  static fromTopLeft(point, width) {
    const w1_2 = width * 0.5;
    return new this({x: point.x + w1_2, y: point.y + w1_2}, undefined, { rotation: 45, width });
  }

  /**
   * Construct a square from a token's hitArea.
   * @param {Token} token
   * @return {Hexagon}
   */
  static fromToken(token) {
    const { width, height } = token.hitArea;

    if ( width !== height ) {
      const { x, y } = token.center;
      const w1_2 = width * 0.5;
      const h1_2 = height * 0.5;
      return new PIXI.Rectangle(x - w1_2, y - h1_2, width, height);
    }

    return new this(token.center, undefined, { rotation: 45, width});
  }

  /**
   * Convert to a rectangle
   * Throws error if the shape is rotated.
   * @returns {PIXI.Rectangle|PIXI.Polygon}
   */
  toRectangle() {
    // Not oriented []
    const rotation = this.rotation;
    if ( !squareRotations.has(rotation) ) {
      console.warn(`toRectangle requested but the square's rotation is ${this.rotation}`);
      return this.toPolygon();
    }

    // Oriented []
    const { origin, sideLength, apothem } = this;
    const { x, y } = origin;
    return new PIXI.Rectangle(-apothem + x, -apothem + y, sideLength, sideLength);
  }

  /**
   * Generate the points of the square using the provided configuration.
   * Simpler and more mathematically precise than the default version.
   * @returns {Point[]}
   */
  _generateFixedPoints() {
    // Shape before rotation is [] rotated 45º
    const r = this.radius;

    return [
      new PIXI.Point(r, 0),
      new PIXI.Point(0, r),
      new PIXI.Point(-r, 0),
      new PIXI.Point(0, -r)
    ];
  }

  /**
   * Generate the points that represent this shape as a polygon in Cartesian space.
   * @return {Points[]}
   */
  _generatePoints() {
    const { origin, radius, rotation, apothem } = this;
    const { x, y } = origin;

    // Oriented []
    if ( squareRotations.has(rotation) ) return [
      apothem + x, apothem + y,
      -apothem + x, apothem + y,
      -apothem + x, -apothem + y,
      apothem + x, -apothem + y
    ];

    // Oriented [] turned 45º
    if ( diagonalRotations.has(rotation) ) return [
      radius + x, y,
      x, radius + y,
      -radius + x, y,
      x, -radius + y
    ];

    return super._generatePoints();
  }

  getBounds() {
    // If an edge is on the bounding box, use it as the border
    const { origin, sideLength, apothem, rotation, fixedPoints: fp } = this;
    const { x, y } = origin;

    // Oriented []
    if ( squareRotations.has(rotation) ) return new PIXI.Rectangle(-apothem + x, -apothem + y, sideLength, sideLength);

    // Oriented [] turned 45º
    if ( diagonalRotations.has(rotation) ) return new PIXI.Rectangle(fp[2].x, fp[3].y, sideLength, sideLength);

    return super.getBounds();
  }

  overlaps(other) {
    // Oriented []
    if ( squareRotations.has(this.rotation) ) {
      const rect = this.getBounds();
      return rect.overlaps(other);
    }
    return super.overlaps(other);
  }
}

GEOMETRY_CONFIG.RegularPolygons.Square ??= Square;

