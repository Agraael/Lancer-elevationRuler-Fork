/* globals
PIXI,
canvas
*/
"use strict";

import { GEOMETRY_CONFIG } from "../const.js";
import "./RegularPolygon.js";

/**
 * "Column" hexagon with points at W and E
 * If height is greater than width, a row hexagon will be returned; otherwise column or rotated.
 * @param {Number}  width     Distance from left to right, through center.
 * @param {Number}  height    Distance from top to bottom, through center.
 */
export class Hexagon extends GEOMETRY_CONFIG.RegularPolygons.RegularPolygon {
  constructor(origin, radius = 0, { rotation = 0, width = 0, height = 0 } = {}) {
    if ( !(radius || width || height) ) console.error("Hexagon requires radius, width, or height.");

    // For calculating radius, divide width and height in half.
    const w = width * 0.5;
    const h = height * 0.5;

    // Radius is the larger dimension.
    radius = Math.max(radius, w, h);

    // If height is greater than width, rotate 90º to make a row hexagon.
    if ( h > w ) rotation += 90;

    super(origin, radius, {numSides: 6, rotation});

    // Apothem is the smaller dimension.
    if ( height && width ) this._apothem = Math.min(h, w, radius);
    else if ( height ) this._apothem = Math.min(radius, h);
    else if ( width ) this._apothem = Math.min(radius, w);
    else this._apothem =  Math.SQRT3 * this.radius * 0.5;

    this.radius2 = Math.pow(this.radius, 2);
  }

  /**
   * Calculate the distance of the line segment from the center to the midpoint of a side.
   * For column hexagon, this is height / 2
   * For row hexagon, this is width / 2
   * @type {number}
   */
  get apothem() {
    return this._apothem;
  }

  /**
   * Calculate length of a side of this hexagon
   * @type {number}
   */
  get sideLength() {
    return this.radius;
  }

  /**
   * Calculate area of this hexagon
   * @type {number}
   */
  get area() {
    // https://en.wikipedia.org/wiki/Hexagon
    return 1.5 * Math.SQRT3 * this.radius2;
  }

  /**
   * Construct a hexagon from a token's hitArea.
   * @param {Token} token
   * @return {Hexagon}
   */
  static fromToken(token) {
    const { width, height } = token.hitArea;
    return new this(token.center, undefined, { width, height });
  }

  /**
   * Construct a hexagon from top left corner of the grid space
   * @param {Point} point   Top left point
   * @param {object} args   Arguments passed to constructor
   * @returns {Hexagon}
   */
  static fromTopLeft(point, ...args) {
      // Offset from top left to center
    const hx = Math.ceil(canvas.grid.sizeX / 2);
    const hy = Math.ceil(canvas.grid.sizeY / 2);
    return new Hexagon({x: point.x + hx, y: point.y + hy}, ...args);
  }

  /**
   * Generate the points of the hexagon using the provided configuration.
   * Simpler and more mathematically precise than the default version.
   * @returns {Point[]}
   */
  _generateFixedPoints() {
    // Shape before rotation is [] rotated 45º
    const { radius, apothem } = this;
    const r1_2 = radius * 0.5;

    // Points at W and E
    return [
      new PIXI.Point(radius, 0),
      new PIXI.Point(r1_2, apothem),
      new PIXI.Point(-r1_2, apothem),
      new PIXI.Point(-radius, 0),
      new PIXI.Point(-r1_2, -apothem),
      new PIXI.Point(r1_2, -apothem)
    ];
  }

  /**
   * Generate the points that represent this shape as a polygon in Cartesian space.
   * @return {Points[]}
   */
  _generatePoints() {
    const { origin, rotation, radius, apothem } = this;
    const { x, y } = origin;
    const r1_2 = radius * 0.5;

    switch ( rotation ) {
      // Pointy-side E/W
      case 0:
      case 180:
        return [
          radius + x, y ,
          r1_2 + x, apothem + y,
          -r1_2 + x, apothem + y,
          -radius + x, y,
          -r1_2 + x, -apothem + y,
          r1_2 + x, -apothem + y
        ];

      // Pointy-side N/S
      case 90:
      case 270:
        return [
          apothem + x, r1_2 + y,
          x, radius + y,
          -apothem + x, r1_2 + y,
          -apothem + x, -r1_2 + y,
          x, -radius + y,
          apothem + x, -r1_2 + y
        ];
    }

    return super._generatePoints();
  }

  getBounds() {
    // If an edge is on the bounding box, use it as the border
    const { origin, radius, apothem, fixedPoints: fp } = this;
    const { x, y } = origin;

    switch ( this.rotation ) {
      // PIXI.Rectangle(x, y, width, height)
      // pointy-side E/W
      case 0:
      case 180:
        return new PIXI.Rectangle(
          fp[3].x + x,
          fp[4].y + y,
          radius * 2,
          apothem * 2);

      // Pointy-side N/S
      case 90:
      case 270:
        return new PIXI.Rectangle(
          -apothem + x,
          -radius + y,
          apothem * 2,
          radius * 2);
    }

    return super.getBounds();
  }
}

GEOMETRY_CONFIG.RegularPolygons.Hexagon ??= Hexagon;
