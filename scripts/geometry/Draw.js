// Drawing tools for debugging.

/* globals
canvas,
foundry,
PIXI,
CONFIG
*/

"use strict";

import { GEOMETRY_CONFIG } from "./const.js";

// Draw class for drawing shapes; primarily for debugging

export class Draw {
  /**
   * @param {PIXI.Graphics} g   Graphics container used for drawings. Defaults to canvas debug.
   */
  constructor(g = canvas.controls.debug) {
    this.g = g;
  }

  // ----- Static properties ----- //
  static COLORS = {
    orange: 0xFFA500,
    lightorange: 0xFFD580,
    yellow: 0xFFFF00,
    lightyellow: 0xFFFFE0,
    greenyellow: 0xADFF2F,
    green: 0x00FF00,
    lightgreen: 0x90EE90,
    blue: 0x0000FF,
    lightblue: 0xADD8E6,
    red: 0xFF0000,
    lightred: 0xFFCCCB,
    gray: 0x808080,
    black: 0x000000,
    white: 0xFFFFFF
  };

  // ----- Static methods for backwards compatibility and ease-of-use ----- //
  static point(...args) {
    const d = new this();
    d.point(...args);
  }

  static polygonPoints(...args) {
    const d = new this();
    d.polygonPoints(...args);
  }

  static segment(...args) {
    const d = new this();
    d.segment(...args);
  }

  static connectPoints(...args) {
    const d = new this();
    d.connectPoints(...args);
  }

  static shape(...args) {
    const d = new this();
    d.shape(...args);
  }

  static labelPoint(...args) {
    const d = new this();
    d.labelPoint(...args);
  }

  static removeLabel(...args) {
    const d = new this();
    d.removeLabel(...args);
  }

  static clearLabels() {
    const d = new this();
    d.clearLabels();
  }

  static clearDrawings() {
    const d = new this();
    d.clearDrawings();
  }

  // ----- Methods ----- //
  /**
   * Draw a point on the canvas.
   * @param {Point} p
   * Optional:
   * @param {Hex}     color   Hex code for the color to use.
   * @param {Number}  alpha   Transparency level.
   * @param {Number}  radius  Radius of the point in pixels.
   */
  point(p, { color = Draw.COLORS.red, alpha = 1, radius = 5 } = {}) {
    this.g
      .beginFill(color, alpha)
      .drawCircle(p.x, p.y, radius)
      .endFill();
  }

  /**
   * Draw the points of a polygon
   * @param {PIXI.Polygon} poly
   * @param {object} drawingOptions    Options to pass to the drawing method.
   */
  polygonPoints(poly, drawingOptions) {
    for ( const pt of poly.iteratePoints() ) { this.point(pt, drawingOptions); }
  }

  /**
   * Draw a segment defined by A|B endpoints.
   * @param {Segment} s   Object with A and B {x, y} points.
   * Optional:
   * @param {Hex}     color   Hex code for the color to use.
   * @param {Number}  alpha   Transparency level.
   * @param {Number}  width   Width of the line in pixels.
   */
  segment(s, { color = Draw.COLORS.blue, alpha = 1, width = 1 } = {}) {
    // Handle Wall, Edge, other
    const A = s.edge?.a ?? s.a ?? s.A;
    const B = s.edge?.b ?? s.b ?? s.B;
    this.g.lineStyle(width, color, alpha)
      .moveTo(A.x, A.y)
      .lineTo(B.x, B.y);
  }

  /**
   * Draw a set of segments defined by points in order, connecting one point to the next.
   * @param {Point[]} points    Array of {x, y} objects.
   * @param {object} [drawingOptions]     Options to pass to the drawing method.
   */
  connectPoints(points, drawingOptions) {
    let prevPt = points.at(-1);
    const nPts = points.length;
    for ( let i = 0; i < nPts; i += 1 ) {
      const currPt = points[i];
      this.segment({A: prevPt, B: currPt}, drawingOptions);
      prevPt = currPt;
    }
  }

  /**
   * Draw a PIXI shape. Optionally fill the shape.
   * @param {PIXI.Polygon} poly
   * @param {object} [options]
   * Optional:
   * @param {hex}     [color=COLORS.black]    Hex code for the color to use.
   * @param {number}  [width=1]               Width of the line in pixels.
   * @param {hex|null}[fill=null]             Color of the fill, if any.
   * @param {number}  [fillAlpha=1]           Alpha of the fill, if any.
   */
  shape(shape, { color = Draw.COLORS.black, width = 1, fill = null, fillAlpha = 1 } = {}) {
    if ( fill ) this.g.beginFill(fill, fillAlpha);
    this.g.lineStyle(width, color).drawShape(shape);
    if ( fill ) this.g.endFill();
  }

  /**
   * Create a text label at a specified position on the canvas.
   * Tracks location so that only one piece of text is at any given x,y position.
   * @param {Point}   p     Location of the start of the text.
   * @param {String}  text  Text to draw.
   * @returns {PIXI.Text}
   */
  labelPoint(p, text, opts = {}) {
    this.g.polygonText ??= new PIXI.Container();
    const polygonText = this.g.polygonText;

    // Update existing label if it exists at or very near Poly endpoint
    const idx = polygonText.children.findIndex(c => p.x.almostEqual(c.position.x) && p.y.almostEqual(c.position.y));
    if (idx !== -1) { this.g.polygonText.removeChildAt(idx); }

    const style = foundry.utils.mergeObject(CONFIG.canvasTextStyle, opts);
    const t = polygonText.addChild(new PIXI.Text(String(text), style));
    t.position.set(p.x, p.y);
    return t;
  }

  /**
   * Remove the text label at a specified position on the canvas.
   * @param {Point}   p     Location of the start of the text.
   * @returns {PIXI.Text|undefined} The removed text or undefined if none found.
   */
  removeLabel(p) {
    this.g.polygonText ??= new PIXI.Container();
    const polygonText = this.g.polygonText;
    // Remove existing label if it exists at or very near Poly endpoint
    const idx = polygonText.children.findIndex(c => p.x.almostEqual(c.position.x) && p.y.almostEqual(c.position.y));
    if ( ~idx ) return this.g.polygonText.removeChildAt(idx);
    return undefined;
  }

  /**
   * Clear all labels created by labelPoint.
   */
  clearLabels() {
    this.g.polygonText?.removeChildren();
  }

  /**
   * Clear all drawings, such as those created by drawPoint, drawSegment, or drawPolygon.
   */
  clearDrawings() {
    this.g.clear();
  }
}

GEOMETRY_CONFIG.Draw ??= Draw;

