/* globals
PIXI,
canvas,
foundry,
TextureLoader,
Ray
*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */
"use strict";

import { extractPixels } from "./extract-pixels.js";
import { roundFastPositive, bresenhamLine, bresenhamLineIterator, trimLineSegmentToPixelRectangle } from "./util.js";
import "./Draw.js";
import "./Matrix.js";
import { GEOMETRY_CONFIG } from "./const.js";


/* Pixel Cache
  Rectangle in local pixel coordinates that contains an array of values ("pixels").
  PixelCache: 1:1 relationship between the local rectangle and the represented shape, except that
    the pixels may be some different resolution. And canvas object may be at any {x,y} position.

  TrimmedPixelCache: 1:1 relationship between the local rectangle and represented shape, except that
    the pixels stored do not include edge pixels with 0 value.

  TilePixelCache: Local rectangle tied to some canvas object (tile) shape. Translations performed
    to move to/from the canvas coordinates and the local.

  Methods to store and retrieve the border for a given alpha threshold.
  Methods to traverse the pixel cache.
*/

/**
 * Represent a rectangular array of local pixels.
 * The underlying rectangle is in local coordinates.
 */
export class PixelCache extends PIXI.Rectangle {
  /** @type {Uint8ClampedArray} */
  pixels = new Uint8ClampedArray(0);

  /** @type {number} */
  maximumPixelValue = 255;

  /** @type {Map<number,PIXI.Rectangle>} */
  #thresholdLocalBoundingBoxes = new Map();

  /** @type {Map<number,PIXI.Rectangle>} */
  #thresholdCanvasBoundingBoxes = new Map();

  /**
   * @typedef {object} PixelCacheScale
   * Properties that relate the local rectangle to the canvas shape.
   * @property {number} x           Translation in x direction
   * @property {number} y           Translation in y direction
   * @property {number} resolution  Ratio of pixels to canvas values.
   */
  scale = {
    resolution: 1,
    x: 0,
    y: 0
  };


  /**
   * Construct the local rectangle based on a provided pixel array.
   * @param {number[]} pixels     Array of pixel values
   * @param {number} pixelWidth   The width of the local rectangle
   * @param {object} [opts]
   * @param {PixelCacheScale} [opts.scale] Values to relate the canvas shape
   */
  constructor(pixels, pixelWidth, opts = {}) {
    const nPixels = pixels.length;
    pixelWidth = roundFastPositive(pixelWidth);
    const pixelHeight = Math.ceil(nPixels / pixelWidth);

    // Define this local rectangle.
    super(0, 0, pixelWidth, pixelHeight);
    this.pixels = pixels;
    if ( opts.scale ) foundry.utils.mergeObject(this.scale, opts.scale);
  }

  // ----- NOTE: Getters and setters ----- //

  /** @type {Matrix} */
  #toLocalTransform;

  get toLocalTransform() {
    return this.#toLocalTransform ?? (this.#toLocalTransform = this._calculateToLocalTransform());
  }

  /** @type {Matrix} */
  #toCanvasTransform;

  get toCanvasTransform() {
    return this.#toCanvasTransform ?? (this.#toCanvasTransform = this.toLocalTransform.invert());
  }

  // ----- NOTE: Transforms ----- //

  /**
   * Reset transforms. Typically used when size or resolution has changed.
   */
  clearTransforms() {
    this.#toLocalTransform = undefined;
    this.#toCanvasTransform = undefined;
    this.#thresholdCanvasBoundingBoxes.clear();
  }

  /**
   * Clear the threshold bounding boxes. Should be rare, if ever, b/c these are local rects
   * based on supposedly unchanging pixels.
   */
  _clearLocalThresholdBoundingBoxes() {
    this.#thresholdCanvasBoundingBoxes.clear();
    this.#thresholdLocalBoundingBoxes.clear();
  }

  _clearCanvasThresholdBoundingBoxes() { this.#thresholdCanvasBoundingBoxes.clear(); }

  /**
   * Matrix that takes a canvas point and transforms to a local point.
   * @returns {Matrix}
   */
  _calculateToLocalTransform() {
    const mTranslate = CONFIG.GeometryLib.Matrix.translation(-this.scale.x, -this.scale.y)

    // Scale based on resolution.
    const resolution = this.scale.resolution;
    const mRes = CONFIG.GeometryLib.Matrix.scale(resolution, resolution);
    return mTranslate.multiply3x3(mRes);
  }

  // ----- NOTE: Bounding boxes ----- //

  /**
   * Get a local bounding box based on a specific threshold
   * @param {number} [threshold=0.75]   Values lower than this will be ignored around the edges.
   * @returns {PIXI.Rectangle} Rectangle based on local coordinates.
   */
  getThresholdLocalBoundingBox(threshold = 0.75) {
    const map = this.#thresholdLocalBoundingBoxes;
    if ( !map.has(threshold) ) map.set(threshold, this.#calculateLocalBoundingBox(threshold));
    return map.get(threshold);
  }

  /**
   * Get a canvas bounding polygon or box based on a specific threshold.
   * If you require a rectangle, use getThresholdLocalBoundingBox
   * @returns {PIXI.Rectangle|PIXI.Polygon}    Rectangle or polygon in canvas coordinates.
   */
  getThresholdCanvasBoundingBox(threshold = 0.75) {
    const map = this.#thresholdCanvasBoundingBoxes;
    if ( !map.has(threshold) ) map.set(threshold, this.#calculateCanvasBoundingBox(threshold));
    return map.get(threshold);
  }

  /**
   * Calculate a canvas bounding box based on a specific threshold.
   */
  #calculateCanvasBoundingBox(threshold=0.75) {
    const localRect = this.getThresholdLocalBoundingBox(threshold);

    const { left, right, top, bottom } = localRect;
    const TL = this._toCanvasCoordinates(left, top);
    const TR = this._toCanvasCoordinates(right, top);
    const BL = this._toCanvasCoordinates(left, bottom);
    const BR = this._toCanvasCoordinates(right, bottom);

    // Can the box be represented with a rectangle? Points must be horizontal and vertical.
    // Could also be rotated 90º
    if ( (TL.x.almostEqual(BL.x) && TL.y.almostEqual(TR.y))
      || (TL.x.almostEqual(TR.x) && TL.y.almostEqual(BL.y)) ) {
      const xMinMax = Math.minMax(TL.x, TR.x, BL.x, BR.x);
      const yMinMax = Math.minMax(TL.y, TR.y, BL.y, BR.y);
      return new PIXI.Rectangle(xMinMax.min, yMinMax.min, xMinMax.max - xMinMax.min, yMinMax.max - yMinMax.min);
    }

    // Alternatively, represent as polygon, which allows for a tighter contains test.
    return new PIXI.Polygon(TL, TR, BR, BL);
  }


  /**
   * Calculate a bounding box based on a specific threshold.
   * @param {number} [threshold=0.75]   Values lower than this will be ignored around the edges.
   * @returns {PIXI.Rectangle} Rectangle based on local coordinates.
   */
  #calculateLocalBoundingBox(threshold=0.75) {
    // (Faster or equal to the old method that used one double non-breaking loop.)
    threshold = threshold * this.maximumPixelValue;

    // By definition, the local frame uses 0 or positive integers. So we can use -1 as a placeholder value.
    const { left, right, top, bottom } = this;
    let minLeft = -1;
    let maxRight = -1;
    let minTop = -1;
    let maxBottom = -1;

    // Test left side
    for ( let x = left; x <= right; x += 1 ) {
      for ( let y = top; y <= bottom; y += 1 ) {
        const a = this._pixelAtLocal(x, y);
        if ( a > threshold ) {
          minLeft = x;
          break;
        }
      }
      if ( ~minLeft ) break;
    }
    if ( !~minLeft ) return new PIXI.Rectangle();

    // Test right side
    for ( let x = right; x >= left; x -= 1 ) {
      for ( let y = top; y <= bottom; y += 1 ) {
        const a = this._pixelAtLocal(x, y);
        if ( a > threshold ) {
          maxRight = x;
          break;
        }
      }
      if ( ~maxRight ) break;
    }

    // Test top side
    for ( let y = top; y <= bottom; y += 1 ) {
      for ( let x = left; x <= right; x += 1 ) {
        const a = this._pixelAtLocal(x, y);
        if ( a > threshold ) {
          minTop = y;
          break;
        }
      }
      if ( ~minTop ) break;
    }

    // Test bottom side
    for ( let y = bottom; y >= top; y -= 1 ) {
      for ( let x = left; x <= right; x += 1 ) {
        const a = this._pixelAtLocal(x, y);
        if ( a > threshold ) {
          maxBottom = y;
          break;
        }
      }
      if ( ~maxBottom ) break;
    }

    // Pad right/bottom by 1 b/c otherwise they would be inset.
    // Don't Pad all by 1 to ensure that any pixel on the thresholdBounds is under the threshold.
    // minLeft -= 1;
    // minTop -= 1;
    maxRight += 1;
    maxBottom += 1;
    return (new PIXI.Rectangle(minLeft, minTop, maxRight - minLeft, maxBottom - minTop));
  }

  _calculateCanvasBoundingBox(threshold=0.75) {
    return this.#calculateCanvasBoundingBox(threshold);
  }

  // ----- NOTE: Neighbor indexing ----- //

  /**
   * For this rectangular frame of local pixels, step backward or forward in the x and y directions
   * from a current index. Presumes index is row-based, such that:
   * 0 1 2 3
   * 4 5 6 7...
   * @param {number} currIdx
   * @param {number} [xStep = 0]
   * @param {number} [yStep = 0]
   * @returns {number} The new index position
   */
  localPixelStep(currIdx, xStep = 0, yStep = 0) {
    return currIdx + (yStep * this.width) + xStep;
  }

  /**
   * Indices of the 8 neighbors to this local pixel index. Does not
   * @param {number} currIdx
   * @returns {number[]}
   */
  localNeighborIndices(currIdx, trimBorder = true) {
    const arr = [];
    const maxIdx = this.pixels.length - 1;
    for ( let xi = -1; xi < 2; xi += 1 ) {
      for ( let yi = -1; yi < 2; yi += 1 ) {
        if ( !(xi || yi) ) continue;
        const neighborIdx = this.localPixelStep(currIdx, xi, yi);
        if ( trimBorder && !neighborIdx.between(0, maxIdx) ) continue;
        arr.push(neighborIdx);
      }
    }
    return arr;
  }

  /**
   * Retrieve the 8 neighbors to a given index on the local cache.
   * @param {number} currIdx
   * @param {boolean} [trimBorder=true]    If true, exclude the border values
   * @returns {number[]} The values, in column order, skipping the middle value.
   */
  localNeighbors(currIdx, trimBorder = true) {
    return this.localNeighborIndices(currIdx, trimBorder).map(idx => this.pixels[idx]);
  }

  // ----- NOTE: Indexing ----- //

  /**
   * Get a pixel value given local coordinates.
   * @param {number} x    Local x coordinate
   * @param {number} y    Local y coordinate
   * @returns {number|null}  Return null otherwise. Sort will put nulls between -1 and 0.
   */
  _pixelAtLocal(x, y) { return this.pixels[this._indexAtLocal(x, y)] ?? null; }

  /**
   * Get a pixel value given canvas coordinates.
   * @param {number} x    Canvas x coordinate
   * @param {number} y    Canvas y coordinate
   * @returns {number}
   */
  pixelAtCanvas(x, y) { return this.pixels[this._indexAtCanvas(x, y)] ?? null; }

  /**
   * Pixel index for a specific texture location
   * @param {number} x      Local texture x coordinate
   * @param {number} y      Local texture y coordinate
   * @returns {number}
   */
  _indexAtLocal(x, y) {
    const { width, height } = this;
    if ( x < 0 || y < 0 || x >= width || y >= height ) return -1;

    // Use floor to ensure consistency when converting to/from coordinates <--> index.
    return ((~~y) * width) + (~~x);
    // Equivalent: return (roundFastPositive(y) * this.localFrame.width) + roundFastPositive(x);
  }

  /**
   * Calculate local coordinates given a pixel index.
   * Inverse of _indexAtLocal
   * @param {number} i              The index, corresponding to a pixel in the array.
   * @param {PIXI.Point} outPoint   Point to use to store the coordinate
   * @returns {PIXI.Point} The outPoint, for convenience
   */
  _localAtIndex(i, outPoint) {
    outPoint ??= new PIXI.Point();
    const width = this.width;
    const col = i % width;
    const row = ~~(i / width); // Floor the row.
    return outPoint.set(col, row);
  }

  /**
   * Calculate the canvas coordinates for a specific pixel index
   * @param {number} i    The index, corresponding to a pixel in the array.
   * @param {PIXI.Point} outPoint   Point to use to store the coordinate
   * @returns {PIXI.Point} The outPoint, for convenience
   */
  _canvasAtIndex(i, outPoint) {
    outPoint ??= new PIXI.Point();
    const local = this._localAtIndex(i, PIXI.Point._tmp);
    return this._toCanvasCoordinates(local.x, local.y, outPoint);
  }

  /**
   * Pixel index for a specific texture location
   * @param {number} x      Canvas x coordinate
   * @param {number} y      Canvas y coordinate
   * @returns {number}
   */
  _indexAtCanvas(x, y) {
    const local = this._fromCanvasCoordinates(x, y, PIXI.Point_tmp);
    return this._indexAtLocal(local.x, local.y);
  }

  /**
   * Transform canvas coordinates into the local pixel rectangle coordinates.
   * @param {number} x    Canvas x coordinate
   * @param {number} y    Canvas y coordinate
   * @param {PIXI.Point} outPoint   Point to use to store the coordinate
   * @returns {PIXI.Point} The outPoint, for convenience
   */
  _fromCanvasCoordinates(x, y, outPoint) {
    outPoint ??= new PIXI.Point();
    outPoint.set(x, y);
    const local = this.toLocalTransform.multiplyPoint2d(outPoint, outPoint);

    // Avoid common rounding errors, like 19.999999999998.
    local.x = fastFixed(local.x);
    local.y = fastFixed(local.y);
    return local;
  }

  /**
   * Transform local coordinates into canvas coordinates.
   * Inverse of _fromCanvasCoordinates
   * @param {number} x    Local x coordinate
   * @param {number} y    Local y coordinate
   * @param {PIXI.Point} outPoint   Point to use to store the coordinate
   * @returns {PIXI.Point} The outPoint, for convenience
   */
  _toCanvasCoordinates(x, y, outPoint) {
    outPoint ??= new PIXI.Point();
    outPoint.set(x, y);
    const canvas = this.toCanvasTransform.multiplyPoint2d(outPoint, outPoint);

    // Avoid common rounding errors, like 19.999999999998.
    canvas.x = fastFixed(canvas.x);
    canvas.y = fastFixed(canvas.y);
    return canvas;
  }

 /**
   * Test whether the pixel cache contains a specific canvas point.
   * See Tile.prototype.containsPixel
   * @param {number} x    Canvas x-coordinate
   * @param {number} y    Canvas y-coordinate
   * @param {number} [alphaThreshold=0.75]  Value required for the pixel to "count."
   * @returns {boolean}
   */
  containsPixel(x, y, alphaThreshold = 0.75) {
    // First test against the bounding box
    const bounds = this.getThresholdCanvasBoundingBox(alphaThreshold);
    if ( !bounds.contains(x, y) ) return false;

    // Next test a specific pixel
    const value = this.pixelAtCanvas(x, y);
    return value > (alphaThreshold * this.maximumPixelValue);
  }


  // ----- NOTE: Shape conversions to local coordinates

  /**
   * Convert a ray to local texture coordinates
   * @param {Ray}
   * @returns {Ray}
   */
  _rayToLocalCoordinates(ray) {
    return new Ray(
      this._fromCanvasCoordinates(ray.A.x, ray.A.y),
      this._fromCanvasCoordinates(ray.B.x, ray.B.y));
  }

  /**
   * Convert a circle to local texture coordinates
   * @param {PIXI.Circle}
   * @returns {PIXI.Circle}
   */
  _circleToLocalCoordinates(circle) {
    const origin = this._fromCanvasCoordinates(circle.x, circle.y);

    // For radius, use two points of equivalent distance to compare.
    const radius = this._fromCanvasCoordinates(circle.radius, 0, PIXI.Point._tmp2).x
      - this._fromCanvasCoordinates(0, 0, PIXI.Point._tmp3).x;
    return new PIXI.Circle(origin.x, origin.y, radius);
  }

  /**
   * Convert an ellipse to local texture coordinates
   * @param {PIXI.Ellipse}
   * @returns {PIXI.Ellipse}
   */
  _ellipseToLocalCoordinates(ellipse) {
    const origin = this._fromCanvasCoordinates(ellipse.x, ellipse.y, PIXI.Point._tmp);

    // For halfWidth and halfHeight, use two points of equivalent distance to compare.
    const halfWidth = this._fromCanvasCoordinates(ellipse.halfWidth, 0, PIXI.Point._tmp2).x
      - this._fromCanvasCoordinates(0, 0, PIXI.Point._tmp3).x;
    const halfHeight = this._fromCanvasCoordinates(ellipse.halfHeight, 0, PIXI.Point._tmp2).x
      - this._fromCanvasCoordinates(0, 0, PIXI.Point._tmp3).x;
    return new PIXI.Ellipse(origin.x, origin.y, halfWidth, halfHeight);
  }

  /**
   * Convert a rectangle to local texture coordinates
   * @param {PIXI.Rectangle} rect
   * @returns {PIXI.Rectangle}
   */
  _rectangleToLocalCoordinates(rect) {
    const TL = this._fromCanvasCoordinates(rect.left, rect.top, PIXI.Point._tmp2);
    const BR = this._fromCanvasCoordinates(rect.right, rect.bottom, PIXI.Point._tmp3);
    return new PIXI.Rectangle(TL.x, TL.y, BR.x - TL.x, BR.y - TL.y);
  }

  /**
   * Convert a polygon to local texture coordinates
   * @param {PIXI.Polygon}
   * @returns {PIXI.Polygon}
   */
  _polygonToLocalCoordinates(poly) {
    const points = poly.points;
    const ln = points.length;
    const newPoints = Array(ln);
    for ( let i = 0; i < ln; i += 2 ) {
      const x = points[i];
      const y = points[i + 1];
      const local = this._fromCanvasCoordinates(x, y, PIXI.Point._tmp);
      newPoints[i] = local.x;
      newPoints[i + 1] = local.y;
    }
    return new PIXI.Polygon(newPoints);
  }

  /**
   * Convert a shape to local coordinates.
   * @param {PIXI.Rectangle|PIXI.Polygon|PIXI.Circle|PIXI.Ellipse} shape
   * @returns {PIXI.Rectangle|PIXI.Polygon|PIXI.Circle|PIXI.Ellipse}
   */
  _shapeToLocalCoordinates(shape) {
    if ( shape instanceof PIXI.Rectangle ) return this._rectangleToLocalCoordinates(shape);
    else if ( shape instanceof PIXI.Polygon ) return this._polygonToLocalCoordinates(shape);
    else if ( shape instanceof PIXI.Circle ) return this._circleToLocalCoordinates(shape);
    else if ( shape instanceof PIXI.Ellipse ) return this._ellipseToLocalCoordinates(shape);
    else console.error("applyFunctionToShape: shape not recognized.");
  }

  // ----- NOTE: Segment pixel extraction ----- //
  /**
   * Trim a line segment to only the portion that intersects this cache bounds.
   * @param {Point} a     Starting location, in canvas coordinates
   * @param {Point} b     Ending location, in canvas coordinates
   * @param {number} alphaThreshold   Value of threshold, if threshold bounds should be used.
   * @returns {Point[2]|null} Points, in local coordinates.
   */
  _trimCanvasRayToLocalBounds(a, b, alphaThreshold) {
    const aLocal = this._fromCanvasCoordinates(a.x, a.y);
    const bLocal = this._fromCanvasCoordinates(b.x, b.y);
    return this._trimLocalRayToLocalBounds(aLocal, bLocal, alphaThreshold);
  }

  /**
   * Trim a line segment to only the portion that intersects this cache bounds.
   * @param {Point} a     Starting location, in local coordinates
   * @param {Point} b     Ending location, in local coordinates
   * @param {number} alphaThreshold   Value of threshold, if threshold bounds should be used.
   * @returns {Point[2]|null}  Points, in local coordinates
   */
  _trimLocalRayToLocalBounds(a, b, alphaThreshold) {
    const bounds = alphaThreshold ? this.getThresholdLocalBoundingBox(alphaThreshold) : this;
    return trimLineSegmentToPixelRectangle(bounds, a, b);
  }


  // TODO: Combine the extraction functions so there is less repetition of code.

  /**
   * Extract all pixel values for a canvas ray.
   * @param {Point} a   Starting location, in local coordinates
   * @param {Point} b   Ending location, in local coordinates
   * @param {object} [opts]                 Optional parameters
   * @param {number} [opts.alphaThreshold]  Percent between 0 and 1, used to trim the pixel bounds
   * @param {number[]} [opts.localOffsets]  Numbers to add to the local x,y position when pulling the pixel(s)
   * @param {function} [opts.reducerFn]     Function that takes pixel array and reduces to a value or object to return
   * @returns {number[]}    The pixel values
   */
  _extractAllPixelValuesAlongCanvasRay(a, b, { alphaThreshold, localOffsets, reducerFn } = {}) {
    const localBoundsIx = this._trimCanvasRayToLocalBounds(a, b, alphaThreshold);
    if ( !localBoundsIx ) return []; // Ray never intersects the cache bounds.

    const pixels = this._extractAllPixelValuesAlongLocalRay(
      localBoundsIx[0], localBoundsIx[1], localOffsets, reducerFn);
    pixels.forEach(pt => this._toCanvasCoordinates(pt.x, pt.y, pt)); // Inline replacement
    return pixels;
  }

  /**
   * Extract all pixel values for a local ray.
   * It is assumed, without checking, that a and be are within the bounds of the shape.
   * @param {Point} a   Starting location, in local coordinates
   * @param {Point} b   Ending location, in local coordinates
   * @param {number[]} [localOffsets]  Numbers to add to the local x,y position when pulling the pixel(s)
   * @param {function} [reducerFn]     Function that takes pixel array and reduces to a value or object to return
   * @returns {number[]}    The pixel values
   */
  _extractAllPixelValuesAlongLocalRay(a, b, localOffsets, reducerFn) {
    localOffsets ??= [0, 0];
    reducerFn ??= this.constructor.pixelAggregator("first");

    const bresPts = bresenhamLine(a.x, a.y, b.x, b.y);
    const nPts = bresPts.length;
    const pixels = Array(nPts * 0.5);
    for ( let i = 0, j = 0; i < nPts; i += 2, j += 1 ) {
      const pt = new PIXI.Point(bresPts[i], bresPts[i + 1]);
      const pixelsAtPoint = this._pixelsForRelativePointsFromLocal(pt.x, pt.y, localOffsets);
      const currPixel = reducerFn(pixelsAtPoint);
      pt.currPixel = currPixel
      pixels[j] = pt;
    }
    return pixels;
  }

  /**
   * Extract all pixels values along a canvas ray that meet a test function.
   * @param {Point} a   Starting location, in canvas coordinates
   * @param {Point} b   Ending location, in canvas coordinates
   * @param {function} markPixelFn    Function to test pixels: (current pixel, previous pixel); returns true to mark
   * @param {object} [opts]                 Optional parameters
   * @param {number} [opts.alphaThreshold]  Percent between 0 and 1, used to trim the pixel bounds
   * @param {boolean} [opts.skipFirst]      Skip the first pixel if true
   * @param {boolean} [opts.forceLast]      Include the last pixel (at b) even if unmarked
   * @param {number[]} [opts.localOffsets]  Numbers to add to the local x,y position when pulling the pixel(s)
   * @param {function} [opts.reducerFn]     Function that takes pixel array and reduces to a value or object to return
   * @returns {object[]} Array of objects, each of which have:
   *   - {number} x           Canvas coordinates
   *   - {number} y           Canvas coordinates
   *   - {number} currPixel
   *   - {number} prevPixel
   */
  _extractAllMarkedPixelValuesAlongCanvasRay(a, b, markPixelFn,
    { alphaThreshold, skipFirst, forceLast, localOffsets, reducerFn } = {}) {
    const localBoundsIx = this._trimCanvasRayToLocalBounds(a, b, alphaThreshold);
    if ( !localBoundsIx ) return []; // Ray never intersects the cache bounds.

    const pixels = this._extractAllMarkedPixelValuesAlongLocalRay(
      localBoundsIx[0], localBoundsIx[1], markPixelFn, skipFirst, forceLast, localOffsets, reducerFn);
    pixels.forEach(pt => this._toCanvasCoordinates(pt.x, pt.y, pt)); // inline replacement
    return pixels;
  }

  /**
   * Extract all pixel values along a local ray that meet a test function.
   * @param {Point} a   Starting location, in local coordinates
   * @param {Point} b   Ending location, in local coordinates
   * @param {function} markPixelFn    Function to test pixels: (currentPixel, previousPixel); returns true to mark
   * @param {boolean} skipFirst       Skip the first pixel if true
   * @param {boolean} forceLast        Include the last pixel (at b) even if unmarked
   * @param {number[]} [localOffsets]  Numbers to add to the local x,y position when pulling the pixel(s)
   * @param {function} [reducerFn]     Function that takes pixel array and reduces to a value or object to return
   * @returns {PIXI.Point[]} Array of objects, each of which have:
   *   - {number} x           Local coordinates
   *   - {number} y           Local coordinates
   *   - {number} currPixel
   *   - {number} prevPixel
   */
  _extractAllMarkedPixelValuesAlongLocalRay(a, b, markPixelFn, skipFirst, forceLast, localOffsets, reducerFn) {
    skipFirst ??= false;
    forceLast ??= false;
    localOffsets ??= [0, 0];
    reducerFn ??= this.constructor.pixelAggregator("first");

    const bresPts = bresenhamLine(a.x, a.y, b.x, b.y);
    const pixels = [];
    let prevPixel;
    if ( skipFirst ) {
      const x = bresPts.shift();
      const y = bresPts.shift();
      if ( typeof y === "undefined" ) return pixels; // No more pixels!
      const pixelsAtPoint = this._pixelsForRelativePointsFromLocal(x, y, localOffsets);
      prevPixel = reducerFn(pixelsAtPoint);
    }

    const nPts = bresPts.length;
    for ( let i = 0; i < nPts; i += 2 ) {
      const pt = new PIXI.Point(bresPts[i], bresPts[i + 1]);
      const pixelsAtPoint = this._pixelsForRelativePointsFromLocal(pt.x, pt.y, localOffsets);
      const currPixel = reducerFn(pixelsAtPoint);
      if ( markPixelFn(currPixel, prevPixel) ) {
        pt.currPixel = currPixel;
        pt.prevPixel = prevPixel;
        pixels.push(pt);
      }
      prevPixel = currPixel;
    }

    if ( forceLast ) {
      const pt = new PIXI.Point(bresPts.at(-2), bresPts.at(-1));
      pt.currPixel = prevPixel;
      pt.forceLast = forceLast;
      // Add the last pixel regardless.
      pixels.push(pt);
    }

    return pixels;
  }

  /**
   * Convenience function.
   * Extract the first pixel value along a canvas ray that meets a test function.
   * @param {Point} a   Starting location, in canvas coordinates
   * @param {Point} b   Ending location, in canvas coordinates
   * @param {function} markPixelFn    Function to test pixels.
   *   Function takes current pixel, previous pixel
   * @returns {object|null} If pixel found, returns:
   *   - {number} x           Canvas coordinate
   *   - {number} y           Canvas coordinate
   *   - {number} currPixel
   *   - {number} prevPixel
   */
  _extractNextMarkedPixelValueAlongCanvasRay(a, b, markPixelFn,
    { alphaThreshold, skipFirst, forceLast, localOffsets, reducerFn } = {}) {

    const localBoundsIx = this._trimCanvasRayToLocalBounds(a, b, alphaThreshold);
    if ( !localBoundsIx ) return null; // Ray never intersects the cache bounds.

    const pixel = this._extractNextMarkedPixelValueAlongLocalRay(
      localBoundsIx[0], localBoundsIx[1], markPixelFn, skipFirst, forceLast, localOffsets, reducerFn);
    if ( !pixel ) return pixel;
    this._toCanvasCoordinates(pixel.x, pixel.y, pixel); // inline replacement
    return pixel;
  }

  /**
   * Extract the first pixel value along a local ray that meets a test function.
   * @param {Point} a   Starting location, in local coordinates
   * @param {Point} b   Ending location, in local coordinates
   * @param {function} markPixelFn    Function to test pixels.
   *   Function takes current pixel, previous pixel
   * @returns {PIXI.Point|null} If pixel found, returns:
   *   - {number} x         Local coordinate
   *   - {number} y         Local coordinate
   *   - {number} currPixel
   *   - {number} prevPixel
   */
  _extractNextMarkedPixelValueAlongLocalRay(a, b, markPixelFn, skipFirst, forceLast, localOffsets, reducerFn) {
    skipFirst ??= false;
    forceLast ??= false;
    localOffsets ??= [0, 0];
    reducerFn ??= this.constructor.pixelAggregator("first");

    const bresIter = bresenhamLineIterator(a, b);
    let prevPixel;
    let pt; // Needed to recall the last point for forceLast.
    if ( skipFirst ) {
      // Iterate over the first value
      pt = bresIter.next().value;
      if ( !pt ) return null; // No more pixels!
      const pixelsAtPoint = this._pixelsForRelativePointsFromLocal(pt.x, pt.y, localOffsets);
      prevPixel = reducerFn(pixelsAtPoint);
    }

    for ( pt of bresIter ) {
      const pixelsAtPoint = this._pixelsForRelativePointsFromLocal(pt.x, pt.y, localOffsets);
      const currPixel = reducerFn(pixelsAtPoint);
      if ( markPixelFn(currPixel, prevPixel) ) {
        pt.currPixel = currPixel;
        pt.prevPixel = prevPixel;
        return pt;
      }
      prevPixel = currPixel;
    }

    // Might be a repeat but more consistent to always pass a forceLast object when requested.
    // Faster than checking for last in the for loop.
    if ( forceLast ) {
      const out = PIXI.Point.fromObject(b);
      out.currPixel = prevPixel;
      out.forceLast = forceLast;
      return out;
    }
    return null;
  }

  /**
   * For a given location, retrieve a set of pixel values based on x/y differences
   * @param {number} x          The center x coordinate, in local coordinates
   * @param {number} y          The center y coordinate, in local coordinates
   * @param {number[]} offsets  Array of offsets: [x0, y0, x1, y1]
   * @returns {number|undefined[]} Array of pixels
   *   Each pixel is the value at x + x0, y + y0, ...
   */
  _pixelsForRelativePointsFromLocal(x, y, offsets) {
    offsets ??= [0, 0];
    const nOffsets = offsets.length;
    const out = new this.pixels.constructor(nOffsets * 0.5);
    for ( let i = 0, j = 0; i < nOffsets; i += 2, j += 1 ) {
      out[j] = this._pixelAtLocal(x + offsets[i], y + offsets[i + 1]);
    }
    return out;
  }

  /**
   * For a given canvas location, retrieve a set of pixel values based on x/y differences
   * @param {number} x                The center x coordinate, in local coordinates
   * @param {number} y                The center y coordinate, in local coordinates
   * @param {number[]} canvasOffsets  Offset grid to use, in canvas coordinate system. [x0, y0, x1, y1, ...]
   * @param {number[]} [localOffsets] Offset grid to use, in local coordinate system. Calculated if not provided.
   * @returns {number|undefined[]} Array of pixels
   *   Each pixel is the value at x + x0, y + y0, ...
   */
  pixelsForRelativePointsFromCanvas(x, y, canvasOffsets, localOffsets) {
    localOffsets ??= this.convertCanvasOffsetGridToLocal(canvasOffsets);
    const pt = this._fromCanvasCoordinates(x, y, PIXI.Point._tmp);
    return this._pixelsForRelativePointsFromLocal(pt.x, pt.y, localOffsets);
  }

  // ----- NOTE: Aggregators ----- //
    /**
   * Utility method to construct a function that can aggregate pixel array generated from offsets
   * @param {string} type     Type of aggregation to perform
   *   - first: take the first value, which in the case of offsets will be [0,0]
   *   - min: Minimum pixel value, excluding undefined pixels.
   *   - max: Maximum pixel value, excluding undefined pixels
   *   - sum: Add pixels. Returns object with total, numUndefined, numPixels.
   *   - countThreshold: Count pixels greater than a threshold.
   *     Returns object with count, numUndefined, numPixels, threshold.
   * @param {number} [threshold]    Optional pixel value used by "count" methods
   * @returns {function}
   */
  static pixelAggregator(type, threshold = -1) {
    let reducerFn;
    let startValue;
    switch ( type ) {
      case "first": return pixels => pixels[0];
      case "min": {
        reducerFn = (acc, curr) => {
          if ( curr == null ) return acc; // Undefined or null.
          return Math.min(acc, curr);
        };
        break;
      }
      case "max": {
        reducerFn = (acc, curr) => {
          if ( curr == null ) return acc;
          return Math.max(acc, curr);
        };
        break;
      }
      case "average":
      case "sum": {
        startValue = { numNull: 0, numPixels: 0, total: 0 };
        reducerFn = (acc, curr) => {
          acc.numPixels += 1;
          if ( curr == null ) acc.numNull += 1; // Undefined or null.
          else acc.total += curr;
          return acc;
        };

        // Re-zero values in case of rerunning with the same reducer function.
        reducerFn.initialize = () => {
          startValue.numNull = 0;
          startValue.numPixels = 0;
          startValue.total = 0;
        };

        break;
      }

      case "average_eq_threshold":
      case "count_eq_threshold": {
        startValue = { numNull: 0, numPixels: 0, threshold, count: 0 };
        reducerFn = (acc, curr) => {
          acc.numPixels += 1;
          if ( curr == null ) acc.numNull += 1; // Undefined or null.
          else if ( curr === acc.threshold ) acc.count += 1;
          return acc;
        };

        // Re-zero values in case of rerunning with the same reducer function.
        reducerFn.initialize = () => {
          startValue.numNull = 0;
          startValue.numPixels = 0;
          startValue.count = 0;
        };
        break;
      }

      case "average_gt_threshold":
      case "count_gt_threshold": {
        startValue = { numNull: 0, numPixels: 0, threshold, count: 0 };
        reducerFn = (acc, curr) => {
          acc.numPixels += 1;
          if ( curr == null ) acc.numNull += 1; // Undefined or null.
          else if ( curr > acc.threshold ) acc.count += 1;
          return acc;
        };

        // Re-zero values in case of rerunning with the same reducer function.
        reducerFn.initialize = () => {
          startValue.numNull = 0;
          startValue.numPixels = 0;
          startValue.count = 0;
        };

        break;
      }
      case "median_no_null": {
        return pixels => {
          pixels = pixels.filter(x => x != null); // Strip null or undefined (undefined should not occur).
          const nPixels = pixels.length;
          const half = Math.floor(nPixels / 2);
          pixels.sort((a, b) => a - b);
          if ( nPixels % 2 ) return pixels[half];
          else return Math.round((pixels[half - 1] + pixels[half]) / 2);
        };
      }

      case "median_zero_null": {
        return pixels => {
          // Sorting puts undefined at end, null in front. Pixels should never be null.
          const nPixels = pixels.length;
          const half = Math.floor(nPixels / 2);
          pixels.sort((a, b) => a - b);
          if ( nPixels % 2 ) return pixels[half];
          else return Math.round((pixels[half - 1] + pixels[half]) / 2);
        };
      }
    }

    switch ( type ) {
      case "average": reducerFn.finalize = acc => acc.total / acc.numPixels; break; // Treats undefined as 0.
      case "average_eq_threshold":
      case "average_gt_threshold": reducerFn.finalize = acc => acc.count / acc.numPixels; break; // Treats undefined as 0.
    }

    const reducePixels = this.reducePixels;
    const out = pixels => reducePixels(pixels, reducerFn, startValue);
    out.type = type; // For debugging.
    return out;
  }

  /**
   * Version of array.reduce that improves speed and handles some unique cases.
   * @param {number[]} pixels
   * @param {function} reducerFn      Function that takes accumulated values and current value
   *   If startValue is undefined, the first acc will be pixels[0]; the first curr will be pixels[1].
   * @param {object} startValue
   * @returns {object} The object returned by the reducerFn
   */
  static reducePixels(pixels, reducerFn, startValue) {
    const numPixels = pixels.length;
    if ( numPixels < 2 ) return pixels[0];

    if ( reducerFn.initialize ) reducerFn.initialize();
    let acc = startValue;
    let startI = 0;
    if ( typeof startValue === "undefined" ) {
      acc = pixels[0];
      startI = 1;
    }
    for ( let i = startI; i < numPixels; i += 1 ) {
      const curr = pixels[i];
      acc = reducerFn(acc, curr);
    }

    if ( reducerFn.finalize ) acc = reducerFn.finalize(acc);
    return acc;
  }

  // ----- NOTE: Offset shapes ----- //

  /**
   * Construct a set of offsets from a shape center. An offset is an x,y combination
   * that says how far to move from a given pixel.
   * Used to walk a line and aggregate pixels that are covered by that shape.
   */
  static pixelOffsetGrid(shape, skip = 0) {
    if ( shape instanceof PIXI.Rectangle ) return this.rectanglePixelOffsetGrid(shape, skip);
    if ( shape instanceof PIXI.Polygon ) return this.polygonPixelOffsetGrid(shape, skip);
    if ( shape instanceof PIXI.Circle ) return this.shapePixelOffsetGrid(shape, skip);
    console.warn("PixelCache|pixelOffsetGrid|shape not recognized.", shape);
    return this.polygonPixelOffsetGrid(shape.toPolygon(), skip);
  }

  /**
   * For a rectangle, construct an array of pixel offsets from the center of the rectangle.
   * @param {PIXI.Rectangle} rect
   * @returns {number[]}
   */
  static rectanglePixelOffsetGrid(rect, skip = 0) {
    /* Example
    Draw = CONFIG.GeometryLib.Draw
    api = game.modules.get("elevatedvision").api
    PixelCache = api.PixelCache

    rect = new PIXI.Rectangle(100, 200, 275, 300)
    offsets = PixelCache.rectanglePixelOffsetGrid(rect, skip = 10)

    tmpPt = new PIXI.Point;
    center = rect.center;
    for ( let i = 0; i < offsets.length; i += 2 ) {
      tmpPt.copyFrom({ x: offsets[i], y: offsets[i + 1] });
      tmpPt.translate(center.x, center.y, tmpPt);
      Draw.point(tmpPt, { radius: 1 })
      if ( !rect.contains(tmpPt.x, tmpPt.y) )
      log(`Rectangle does not contain {tmpPt.x},${tmpPt.y} (${offsets[i]},${offsets[i+1]})`)
    }
    Draw.shape(rect)

    */

    const width = Math.floor(rect.width);
    const height = Math.floor(rect.height);
    const incr = skip + 1;
    const w_1_2 = Math.floor(width * 0.5);
    const h_1_2 = Math.floor(height * 0.5);
    const xiMax = width - w_1_2;
    const yiMax = height - h_1_2;

    // Handle 0 row and 0 column. Add only if it would have been added by the increment or half increment.
    const addZeroX = ((xiMax - 1) % (Math.ceil(incr * 0.5))) === 0;
    const addZeroY = ((yiMax - 1) % (Math.ceil(incr * 0.5))) === 0;

    // Faster to pre-allocate the array, although the math is hard.
    const startSkip = -3; // -3 to skip outermost edge and next closest pixel. Avoids issues with borders.
    const xMod = Boolean((xiMax - 1) % incr);
    const yMod = Boolean((yiMax - 1) % incr);
    const numX = (xiMax < 2) ? 0 : Math.floor((xiMax + startSkip) / incr) + xMod;
    const numY = (yiMax < 2) ? 0 : Math.floor((yiMax + startSkip) / incr) + yMod;
    const total = (numX * numY * 4 * 2) + (addZeroX * 4 * numY) + (addZeroY * 4 * numX) + 2;
    const offsets = new Array(total);

    // To make skipping pixels work well, set up so it always captures edges and corners
    // and works its way in.
    // And always add the 0,0 point.
    offsets[0] = 0;
    offsets[1] = 0;
    offsets._centerPoint = rect.center; // Helpful when processing pixel values later.
    let j = 2;
    for ( let xi = xiMax + startSkip; xi > 0; xi -= incr ) {
      for ( let yi = yiMax + startSkip; yi > 0; yi -= incr ) {
        // BL quadrant
        offsets[j++] = xi;
        offsets[j++] = yi;

        // BR quadrant
        offsets[j++] = -xi;
        offsets[j++] = yi;

        // TL quadrant
        offsets[j++] = -xi;
        offsets[j++] = -yi;

        // TR quadrant
        offsets[j++] = xi;
        offsets[j++] = -yi;
      }
    }

    // Handle 0 row and 0 column. Add only if it would have been added by the increment or half increment.
    if ( addZeroX ) {
      for ( let yi = yiMax - 3; yi > 0; yi -= incr ) {
        offsets[j++] = 0;
        offsets[j++] = yi;
        offsets[j++] = 0;
        offsets[j++] = -yi;
      }
    }

    if ( addZeroY ) {
      for ( let xi = xiMax - 3; xi > 0; xi -= incr ) {
        offsets[j++] = xi;
        offsets[j++] = 0;
        offsets[j++] = -xi;
        offsets[j++] = 0;
      }
    }

    return offsets;
  }

  // For checking that offsets are not repeated:
  //   s = new Set();
  //   pts = []
  //   for ( let i = 0; i < offsets.length; i += 2 ) {
  //     pt = new PIXI.Point(offsets[i], offsets[i + 1]);
  //     pts.push(pt)
  //     s.add(pt.key)
  //   }

  /**
   * For a polygon, construct an array of pixel offsets from the bounds center.
   * Uses a faster multiple contains test specific to PIXI.Polygon.
   * @param {PIXI.Rectangle} poly
   * @param {number} skip
   * @returns {number[]}
   */
  static polygonPixelOffsetGrid(poly, skip = 0) {
    /* Example
    poly = new PIXI.Polygon({x: 100, y: 100}, {x: 200, y: 100}, {x: 150, y: 300});
    offsets = PixelCache.polygonPixelOffsetGrid(poly, skip = 10)
    tmpPt = new PIXI.Point;
    center = poly.getBounds().center;
    for ( let i = 0; i < offsets.length; i += 2 ) {
      tmpPt.copyFrom({ x: offsets[i], y: offsets[i + 1] });
      tmpPt.translate(center.x, center.y, tmpPt);
      Draw.point(tmpPt, { radius: 1 })
      if ( !poly.contains(tmpPt.x, tmpPt.y) )
      log(`Poly does not contain {tmpPt.x},${tmpPt.y} (${offsets[i]},${offsets[i+1]})`)
    }
    Draw.shape(poly)
    */
    const bounds = poly.getBounds();
    const { x, y } = bounds.center;
    const offsets = this.rectanglePixelOffsetGrid(bounds, skip);
    const nOffsets = offsets.length;
    const testPoints = new Array(offsets.length);
    for ( let i = 0; i < nOffsets; i += 2 ) {
      testPoints[i] = x + offsets[i];
      testPoints[i + 1] = y + offsets[i + 1];
    }
    const isContained = this.polygonMultipleContains(poly, testPoints);
    const polyOffsets = []; // Unclear how many pixels until we test containment.
    polyOffsets._centerPoint = offsets._centerPoint;
    for ( let i = 0, j = 0; i < nOffsets; i += 2 ) {
      if ( isContained[j++] ) polyOffsets.push(offsets[i], offsets[i + 1]);
    }
    return polyOffsets;
  }

  /**
   * Run contains test on a polygon for multiple points.
   * @param {PIXI.Polygon} poly
   * @param {number[]} testPoints     Array of [x0, y0, x1, y1,...] coordinates
   * @returns {number[]} Array of 0 or 1 values
   */
  static polygonMultipleContains(poly, testPoints) {
    // Modification of PIXI.Polygon.prototype.contains
    const nPoints = testPoints.length;
    if ( nPoints < 2 ) return undefined;
    const res = new Uint8Array(nPoints * 0.5); // If we really need speed, could use bit packing
    const r = poly.points.length / 2;
    for ( let n = 0, o = r - 1; n < r; o = n++ ) {
      const a = poly.points[n * 2];
      const h = poly.points[(n * 2) + 1];
      const l = poly.points[o * 2];
      const c = poly.points[(o * 2) + 1];

      for ( let i = 0, j = 0; i < nPoints; i += 2, j += 1 ) {
        const x = testPoints[i];
        const y = testPoints[i + 1];
        ((h > y) != (c > y)) && (x < (((l - a) * ((y - h)) / (c - h)) + a)) && (res[j] = !res[j]);
      }
    }
    return res;
  }

  /**
   * For an arbitrary shape with contains and bounds methods,
   * construct a grid of pixels from the bounds center that are within the shape.
   * @param {object} shape      Shape to test
   * @param {number} [skip=0]   How many pixels to skip when constructing the grid
   * @returns {number[]}
   */
  static shapePixelOffsetGrid(shape, skip = 0) {
    const bounds = shape.getBounds();
    const { x, y } = bounds.center;
    const offsets = this.rectanglePixelOffsetGrid(bounds, skip);
    const nOffsets = offsets.length;
    const shapeOffsets = []; // Unclear how many pixels until we test containment.
    shapeOffsets._centerPoint = offsets._centerPoint;
    for ( let i = 0; i < nOffsets; i += 2 ) {
      const xOffset = offsets[i];
      const yOffset = offsets[i + 1];
      if ( shape.contains(x + xOffset, y + yOffset) ) shapeOffsets.push(xOffset, yOffset);
    }
    return shapeOffsets;
  }

  /**
   * Convert a canvas offset grid to a local one.
   * @param {number[]} canvasOffsets
   * @returns {number[]} localOffsets. May return canvasOffsets if no scaling required.
   */
  convertCanvasOffsetGridToLocal(canvasOffsets) {
    // Determine what one pixel move in the x direction equates to for a local move.
    const canvasOrigin = this._toCanvasCoordinates(0, 0);
    const xShift = this._fromCanvasCoordinates(canvasOrigin.x + 1, canvasOrigin.y);
    const yShift = this._fromCanvasCoordinates(canvasOrigin.x, canvasOrigin.y + 1);
    if ( xShift.equals(new PIXI.Point(1, 0)) && yShift.equals(new PIXI.Point(0, 1)) ) return canvasOffsets;

    const nOffsets = canvasOffsets.length;
    const localOffsets = Array(nOffsets);
    for ( let i = 0; i < nOffsets; i += 2 ) {
      const xOffset = canvasOffsets[i];
      const yOffset = canvasOffsets[i + 1];

      // A shift of 1 pixel in a canvas direction could shift both x and y locally, if rotated.
      localOffsets[i] = (xOffset * xShift.x) + (xOffset * yShift.x);
      localOffsets[i + 1] = (yOffset * xShift.y) + (yOffset * yShift.y);
    }
    return localOffsets;
  }

  // ----- NOTE: Static constructors ----- //
    /**
   * Construct a pixel cache from a texture.
   * Will automatically adjust the resolution of the pixel cache based on the texture resolution.
   * @param {PIXI.Texture} texture      Texture from which to pull pixel data
   * @param {object} [opts]          Options affecting which pixel data is used
   * @param {PIXI.Rectangle} [opts.frame]    Optional rectangle to trim the extraction
   * @param {number} [opts.resolution=1]     At what resolution to pull the pixels
   * @param {number} [opts.x=0]              Move the texture in the x direction by this value
   * @param {number} [opts.y=0]              Move the texture in the y direction by this value
   * @param {number} [opts.channel=0]        Which RGBA channel, where R = 0, A = 3.
   * @param {function} [opts.scalingMethod=PixelCache.nearestNeighborScaling]
   * @param {function} [opts.combineFn]      Function to combine multiple channels of pixel data.
   *   Will be passed the r, g, b, and a channels.
   * @param {TypedArray} [opts.arrayClass]        What array class to use to store the resulting pixel values
   * @returns {PixelCache}
   */
  static fromTexture(texture, opts = {}) {
    const { pixels, x, y, width, height } = extractPixels(canvas.app.renderer, texture, opts.frame);
    const frame = opts.frame ?? new PIXI.Rectangle(x, y, width, height);
    opts.textureResolution = texture.resolution ?? 1;
    return this._fromPixels(pixels, frame, opts);
  }

  /**
   * Build pixel cache from an array of pixels, with specific manipulations.
   * Use scaling to shrink pixels.
   * See PixelCache.fromTexture
   * @param {TypedArray} pixels         Pixels to manipulate
   * @param {PIXI.Rectangle} frame      Frame for which to extract the pixels
   * @param {object} [opts]             See PixelCache.fromTexture
   * @returns {PixelCache}
   */
  static _fromPixels(pixels, frame, opts) {
    const combinedPixels = opts.combineFn ? this.combinePixels(pixels, opts.combineFn, opts.arrayClass) : pixels;

    opts.x ??= 0;
    opts.y ??= 0;
    opts.resolution ??= 1;
    opts.textureResolution ??= 1;
    opts.channel ??= 0;
    opts.scalingMethod ??= this.nearestNeighborScaling;
    const arr = opts.scalingMethod(combinedPixels, frame.width, frame.height, opts.resolution, {
      channel: opts.channel,
      skip: opts.combineFn ? 1 : 4,
      arrayClass: opts.arrayClass });

    opts.scale ??= {};
    opts.scale.x = opts.x + frame.x;
    opts.scale.y = opts.y + frame.y;
    opts.scale.resolution = (opts.resolution * opts.textureResolution);
    return new this(arr, frame.width, opts);
  }

  /**
   * Combine pixels using provided method.
   * @param {number[]} pixels       Array of pixels to consolidate. Assumed 4 channels.
   * @param {function} combineFn    Function to combine multiple channels of pixel data.
   *   Will be passed the r, g, b, and a channels.
   * @param {class TypedArray} [options.arrayClass]        What array class to use to store the resulting pixel values
   */
  static combinePixels(pixels, combineFn, arrayClass = Float32Array) {
    const numPixels = pixels.length;
    if ( numPixels % 4 !== 0 ) {
      console.error("fromTextureChannels requires a texture with 4 channels.");
      return pixels;
    }

    const combinedPixels = new arrayClass(numPixels * 0.25);
    for ( let i = 0, j = 0; i < numPixels; i += 4, j += 1 ) {
      combinedPixels[j] = combineFn(pixels[i], pixels[i + 1], pixels[i + 2], pixels[i + 3]);
    }
    return combinedPixels;
  }

  /**
   * Consider the nearest neighbor when upscaling or downscaling a texture pixel array.
   * Average together.
   * See https://towardsdatascience.com/image-processing-image-scaling-algorithms-ae29aaa6b36c.
   * @param {number[]} pixels   The original texture pixels
   * @param {number} width      Width of the original texture
   * @param {number} height     Height of the original texture
   * @param {number} resolution Amount to grow or shrink the pixel array size.
   * @param {object} [options]  Parameters that affect which pixels are used.
   * @param {number} [options.channel=0]    Which RGBA channel (0–3) should be pulled?
   * @param {number} [options.skip=4]       How many channels to skip.
   * @param {TypedArray}   [options.arrayClass=Uint8Array]  What array class to use to store the resulting pixel values
   * @returns {number[]}
   */
  static nearestNeighborScaling(pixels, width, height, resolution, { channel, skip, arrayClass, arr } = {}) {
    channel ??= 0;
    skip ??= 4;
    arrayClass ??= Uint8Array;

    const invResolution = 1 / resolution;
    const localWidth = Math.round(width * resolution);
    const localHeight = Math.round(height * resolution);
    const N = localWidth * localHeight;

    if ( arr && arr.length !== N ) {
      console.error(`PixelCache.nearestNeighborScaling|Array provided must be length ${N}`);
      arr = undefined;
    }
    arr ??= new arrayClass(N);

    for ( let col = 0; col < localWidth; col += 1 ) {
      for ( let row = 0; row < localHeight; row += 1 ) {
        // Locate the corresponding pixel in the original texture.
        const x_nearest = roundFastPositive(col * invResolution);
        const y_nearest = roundFastPositive(row * invResolution);
        const j = ((y_nearest * width * skip) + (x_nearest * skip)) + channel;

        // Fill in the corresponding local value.
        const i = ((~~row) * localWidth) + (~~col);
        arr[i] = pixels[j];
      }
    }
    return arr;
  }

  /**
   * Consider every pixel in the downscaled image as a box in the original.
   * Average together.
   * See https://towardsdatascience.com/image-processing-image-scaling-algorithms-ae29aaa6b36c.
   * @param {number[]} pixels   The original texture pixels
   * @param {number} width      Width of the original texture
   * @param {number} height     Height of the original texture
   * @param {number} resolution Amount to shrink the pixel array size. Must be less than 1.
   * @param {object} [options]  Parameters that affect which pixels are used.
   * @param {number} [options.channel=0]    Which RGBA channel (0–3) should be pulled?
   * @param {number} [options.skip=4]       How many channels to skip.
   * @param {TypedArray}   [options.arrayClass=Uint8Array]  What array class to use to store the resulting pixel values
   * @returns {number[]}
   */
  static boxDownscaling(pixels, width, height, resolution, { channel, skip, arrayClass, arr } = {}) {
    channel ??= 0;
    skip ??= 4;
    arrayClass ??= Uint8Array;

    const invResolution = 1 / resolution;
    const localWidth = Math.round(width * resolution);
    const localHeight = Math.round(height * resolution);
    const N = localWidth * localHeight;
    if ( arr && arr.length !== N ) {
      console.error(`PixelCache.nearestNeighborScaling|Array provided must be length ${N}`);
      arr = undefined;
    }
    arr ??= new arrayClass(N);

    const boxWidth = Math.ceil(invResolution);
    const boxHeight = Math.ceil(invResolution);

    for ( let col = 0; col < localWidth; col += 1 ) {
      for ( let row = 0; row < localHeight; row += 1 ) {
        // Locate the corresponding pixel in the original texture.
        const x_ = ~~(col * invResolution);
        const y_ = ~~(row * invResolution);

        // Ensure the coordinates are not out-of-bounds.
        const x_end = Math.min(x_ + boxWidth, width - 1) + 1;
        const y_end = Math.min(y_ + boxHeight, height - 1) + 1;

        // Average colors in the box.
        const values = [];
        for ( let x = x_; x < x_end; x += 1 ) {
          for ( let y = y_; y < y_end; y += 1 ) {
            const j = ((y * width * skip) + (x * skip)) + channel;
            values.push(pixels[j]);
          }
        }

        // Fill in the corresponding local value.
        const i = ((~~row) * localWidth) + (~~col);
        const avgPixel = values.reduce((a, b) => a + b, 0) / values.length;
        arr[i] = roundFastPositive(avgPixel);
      }
    }
    return arr;
  }

  /**
   * Draw a representation of this pixel cache on the canvas, where alpha channel is used
   * to represent values. For debugging.
   */
  draw({color = CONFIG.GeometryLib.Draw.COLORS.blue, gammaCorrect = false, local = false, skip = 10, radius = 1 } = {}) {
    const ln = this.pixels.length;
    const coordFn = local ? this._localAtIndex : this._canvasAtIndex;
    const gammaExp = gammaCorrect ? 1 / 2.2 : 1;
    skip += 1; // For incrementing i.
    for ( let i = 0; i < ln; i += skip ) {
      const value = this.pixels[i];
      if ( !value ) continue;
      const alpha = Math.pow(value / this.maximumPixelValue, gammaExp);
      const pt = coordFn.call(this, i, PIXI.Point._tmp);
      CONFIG.GeometryLib.Draw.point(pt, { color, alpha, radius });
    }
  }

  /**
   * For debugging, to test coordinate conversion.
   * Use `pixelAtLocal` or `pixelAtCanvas` to get the value. Unlike `draw`, which iterates from the pixel indices directly.
   */
  drawFromCoords({color = CONFIG.GeometryLib.Draw.COLORS.blue, gammaCorrect = false, skip = 10, radius = 1, local = false } = {}) {
    const gammaExp = gammaCorrect ? 1 / 2.2 : 1;
    const { right, left, top, bottom } = this;
    let coordFn;
    let valueFn;
    if ( local ) {
      coordFn = (localX, localY) => PIXI.Point._tmp.set(localX, localY);
      valueFn = this._pixelAtLocal;
    } else {
      coordFn = (localX, localY) => this._toCanvasCoordinates(localX, localY, PIXI.Point._tmp);
      valueFn = (localX, localY) => {
        const canvasPt = this._toCanvasCoordinates(localX, localY, PIXI.Point._tmp);
        return this.pixelAtCanvas(canvasPt.x, canvasPt.y);
      }
    }

    skip += 1; // For incrementing.
    for ( let localX = left; localX <= right; localX += skip ) {
      for ( let localY = top; localY <= bottom; localY += skip ) {
        const value = valueFn.call(this, localX, localY);
        if ( !value ) continue;
        const alpha = Math.pow(value / 255, gammaExp);
        const pt = coordFn.call(this, localX, localY);
        CONFIG.GeometryLib.Draw.point(pt, { color, alpha, radius });
      }
    }
  }
}

/**
 * Pixel cache that has pixel values === 0 trimmed around the border.
 * See Foundry's TextureLoader.getTextureAlphaData
 * Used to ignore 0-alpha pixels around the border.
 */
export class TrimmedPixelCache extends PixelCache {
  /** @type {PIXI.Rectangle} */
  #fullLocalBounds = new PIXI.Rectangle();

  /**
   * @param {number[]} pixels     Array of integer values, trimmed.
   * @param {number} pixelWidth   The width of the trimmed pixel rectangle.
   * @param {object} [opts]
   * @param
   * @param {number} [opts.opts]   Other options passed to PixelCache constructor
   *   pixel width * resolution = canvas width.
   */
  constructor(pixels, pixelWidth, { minX, maxX, minY, maxY, ...opts } = {}) {
    super(pixels, pixelWidth, opts);
    this.#fullLocalBounds.x = -minX;
    this.#fullLocalBounds.y = -minY;
    this.#fullLocalBounds.width = this.width + maxX;
    this.#fullLocalBounds.height = this.height + maxY;
  }


  // ----- NOTE: Static factory method ----- //

  /**
   * From a non-trimmed pixel array, trim the pixels and create a new pixel cache.
   * @param {TypedArray} pixels
   * @param {number} pixelWidth     The width of the pixel rectangle
   * @param {object} [opts]         Options passed to the constructor
   * @returns {TrimmedPixelCache}
   */
  static fromNonTrimmedPixels(pixels, untrimmedLocalWidth, untrimmedLocalHeight, opts = {}) {
    const nPixels = pixels.length;
    untrimmedLocalWidth = roundFastPositive(untrimmedLocalWidth);
    untrimmedLocalHeight ??= nPixels / untrimmedLocalHeight;
    if ( !Number.isInteger(opts.pixelHeight) ) {
      console.warn(`PixelCache untrimmedLocalHeight is non-integer: ${untrimmedLocalHeight}`);
      untrimmedLocalHeight = Math.ceil(untrimmedLocalHeight);
    }
    const { minX, minY, maxX, maxY } = this.minMaxNonZeroPixels(pixels, untrimmedLocalWidth, untrimmedLocalHeight);

    // Create new trimmed buffer
    const trimmedWidth = maxX - minX;
    const trimmedHeight = maxY - minY;
    const trimmedPixels = new pixels.constructor(trimmedWidth * trimmedHeight);
    for ( let i = 0, y = minY; y < maxY; y++ ) {
      for ( let x = minX; x < maxX; x++, i++ ) {
        trimmedPixels[i] = pixels[((untrimmedLocalWidth * y) + x)];
      }
    }
    return new this(trimmedPixels, trimmedWidth, { minX, maxX, minY, maxY, ...opts });
  }

  /**
   * Determine the min/max pixel coordinates for an array of pixels.
   * Meaning, the first and last coordinates of non-zero pixels.
   * See Foundry's TextureLoader.getTextureAlphaData.
   * @param {TypedArray} pixels     Array of pixels to trim
   * @param {number} width          Width of the pixel rectangle
   * @param {number} height         Heigh of the pixel rectangle
   * @returns { minX, minY, maxX, maxY }
   */
  static minMaxNonZeroPixels(pixels, width, height) {
    let minX = width;
    let minY = height;
    let maxX = 0;
    let maxY = 0;
    for ( let i = 3, y = 0; y < height; y++ ) {
      for ( let x = 0; x < width; x++, i += 4 ) {
        const alpha = pixels[i];
        if ( alpha === 0 ) continue;
        if ( x < minX ) minX = x;
        if ( x >= maxX ) maxX = x + 1;
        if ( y < minY ) minY = y;
        if ( y >= maxY ) maxY = y + 1;
      }
    }

    // Special case when the whole texture is alpha 0
    if ( minX > maxX ) minX = minY = maxX = maxY = 0;
    return { minX, minY, maxX, maxY };
  }

  // ----- NOTE: Transformations ----- //

  /**
   * Matrix that takes a canvas point and transforms to a local point.
   * @returns {Matrix}
   */
  _calculateToLocalTransform() {
    // Translate to account for the trimmed border.
    const mTranslate = CONFIG.GeometryLib.Matrix.translation(this.#fullLocalBounds.x, this.#fullLocalBounds.y);
    return super._calculateToLocalTransform().multiply3x3(mTranslate);

    //const mTranslate = CONFIG.GeometryLib.Matrix.translation(this.#fullLocalBounds.x, this.#fullLocalBounds.y);
    //return mTranslate.multiply3x3(super._calculateToLocalTransform());
  }

  /**
   * Get a pixel value given local coordinates.
   * @param {number} x    Local x coordinate
   * @param {number} y    Local y coordinate
   * @returns {number|null}  Return null otherwise. Sort will put nulls between -1 and 0.
   *   If the {x,y} falls within the trimmed border, returns 0.
   */
  _pixelAtLocal(x, y) {
    if ( this.#fullLocalBounds.contains(x, y) && !this.contains(x, y) ) return 0;
    return super._pixelAtLocal(x, y);
  }

  /**
   * Get a pixel value given canvas coordinates.
   * @param {number} x    Canvas x coordinate
   * @param {number} y    Canvas y coordinate
   * @returns {number|null}
   */
  pixelAtCanvas(x, y) {
    const idx = this._indexAtCanvas(x, y);
    if ( idx ) return this.pixels[idx];

    const localPt = this._fromCanvasCoordinates(x, y, PIXI.Point._tmp);
    if ( this.#fullLocalBounds.contains(localPt.x, localPt.y) ) return 0;
    return null;
  }
}


/**
 * Pixel cache specific to a tile texture.
 * Adds additional handling for tile rotation, scaling, converting from a tile cache.
 */
export class TilePixelCache extends TrimmedPixelCache {
  /** @type {Tile} */
  tile;

  /**
   * @param {Tile} [options.tile]   Tile for which this cache applies
                                    If provided, scale will be updated
   * @inherits
   */
  constructor(pixels, width, opts = {}) {
    super(pixels, width, opts);
    this.tile = opts.tile;
  }

  // ----- NOTE: Tile data getters ----- //

  /** @type {numeric} */
  get scaleX() { return this.tile.document.texture.scaleX; }

  /** @type {numeric} */
  get scaleY() { return this.tile.document.texture.scaleY; }

  /** @type {numeric} */
  get rotation() { return Math.toRadians(this.tile.document.rotation); }

  /** @type {numeric} */
  get rotationDegrees() { return this.tile.document.rotation; }

  /** @type {numeric} */
  get proportionalWidth() { return this.tile.document.width / this.tile.texture.width; }

  /** @type {numeric} */
  get proportionalHeight() { return this.tile.document.height / this.tile.texture.height; }

  /** @type {numeric} */
  get textureWidth() { return this.tile.texture.width; }

  /** @type {numeric} */
  get textureHeight() { return this.tile.texture.height; }

  /** @type {numeric} */
  get tileX() { return this.tile.document.x; }

  /** @type {numeric} */
  get tileY() { return this.tile.document.y; }

  /** @type {numeric} */
  get tileWidth() { return this.tile.document.width; }

  /** @type {numeric} */
  get tileHeight() { return this.tile.document.height; }

  /**
   * For backwards compatibility only.
   */
  _resize() { this.clearTransforms(); }

  /**
   * Transform canvas coordinates into the local pixel rectangle coordinates.
   * @inherits
   */
  _calculateToLocalTransform() {
    // 1. Clear the rotation
    // Translate so the center is 0,0
    const { x, y, width, height } = this.tile.document;
    const mCenterTranslate = CONFIG.GeometryLib.Matrix.translation(-(width * 0.5) - x, -(height * 0.5) - y);

    // Rotate around the Z axis
    // (The center must be 0,0 for this to work properly.)
    const rotation = -this.rotation;
    const mRot = CONFIG.GeometryLib.Matrix.rotationZ(rotation, false);

    // 2. Clear the scale
    // (The center must be 0,0 for this to work properly.)
    const { scaleX, scaleY } = this;
    const mScale = CONFIG.GeometryLib.Matrix.scale(1 / scaleX, 1 / scaleY);

    // 3. Clear the width/height
    // Translate so top corner is 0,0
    const { textureWidth, textureHeight, proportionalWidth, proportionalHeight } = this;
    const currWidth = textureWidth * proportionalWidth;
    const currHeight = textureHeight * proportionalHeight;
    const mCornerTranslate = CONFIG.GeometryLib.Matrix.translation(currWidth * 0.5, currHeight * 0.5);

    // Scale the canvas width/height back to texture width/height, if not 1:1.
    // (Must have top left corner at 0,0 for this to work properly.)
    const mProportion = CONFIG.GeometryLib.Matrix.scale(1 / proportionalWidth, 1 / proportionalHeight);

    // 4. Scale based on resolution of the underlying pixel data
    const mRes = super._calculateToLocalTransform();

    // Combine the matrices.
    return mCenterTranslate
      .multiply3x3(mRot)
      .multiply3x3(mScale)
      .multiply3x3(mCornerTranslate)
      .multiply3x3(mProportion)
      .multiply3x3(mRes);
  }

  /**
   * Convert a tile's alpha channel to a pixel cache.
   * At the moment mostly for debugging, b/c overhead tiles have an existing array that
   * can be used.
   * @param {Tile} tile     Tile to pull a texture from
   * @param {object} opts   Options passed to `fromTexture` method
   * @returns {TilePixelCache}
   */
  static fromTileAlpha(tile, opts = {}) {
    const texture = tile.texture;
    opts.tile = tile;
    opts.channel ??= 3;
    return this.fromTexture(texture, opts);
  }

  /**
   * Convert an overhead tile's alpha channel to a pixel cache.
   * Relies on already-cached overhead tile pixel data.
   * @param {Tile} tile     Tile to pull a texture from
   * @param {object} opts   Options passed to `fromTexture` method
   * @returns {TilePixelCache}
   */
  static fromOverheadTileAlpha(tile, resolution = 1) {
    // See TextureLoader.getTextureAlphaData.
    const textureData = TextureLoader.getTextureAlphaData(tile.texture, resolution);
    const { minX, maxX, minY, maxY, data } = textureData;
    const pixelWidth = maxX - minX;
    return new this(data, pixelWidth, { tile, minX, maxX, minY, maxY, scale: { resolution } });
  }

  /**
   * Convert a circle to local texture coordinates, taking into account scaling.
   * @returns {PIXI.Circle|PIXI.Polygon}
   */
  _circleToLocalCoordinates(_circle) {
    console.error("_circleToLocalCoordinates: Not yet implemented for tiles.");
  }

  /**
   * Convert an ellipse to local texture coordinates, taking into account scaling.
   * @returns {PIXI.Ellipse|PIXI.Polygon}
   */
  _ellipseToLocalCoordinates(_ellipse) {
    console.error("_circleToLocalCoordinates: Not yet implemented for tiles.");
  }


  /**
   * Convert a rectangle to local texture coordinates, taking into account scaling.
   * @returns {PIXI.Rectangle|PIXI.Polygon}
   * @inherits
   */
  _rectangleToLocalCoordinates(rect) {
    switch ( this.rotationDegrees ) {
      case 0:
      case 360: return super._rectangleToLocalCoordinates(rect);
      case 90:
      case 180:
      case 270: {
        // Rotation will change the TL and BR points; adjust accordingly.
        const { left, right, top, bottom } = rect;
        const TL = this._fromCanvasCoordinates(left, top, PIXI.Point._tmp);
        const TR = this._fromCanvasCoordinates(right, top, PIXI.Point._tmp2);
        const BR = this._fromCanvasCoordinates(right, bottom, PIXI.Point._tmp3);
        const BL = this._fromCanvasCoordinates(left, bottom);
        const localX = Math.minMax(TL.x, TR.x, BR.x, BL.x);
        const localY = Math.minMax(TL.y, TR.y, BR.y, BL.y);
        return new PIXI.Rectangle(localX.min, localY.min, localX.max - localX.min, localY.max - localY.min);
      }
      default: {
        // Rotation would form a rotated rectangle-Use polygon instead.
        const { left, right, top, bottom } = rect;
        const poly = new PIXI.Polygon([left, top, right, top, right, bottom, left, bottom]);
        return this._polygonToLocalCoordinates(poly);
      }
    }
  }
}

/**
 * Store a point, a t value, and the underlying coordinate system
 */
export class Marker {
  /** @type {PIXI.Point} */
  #point;

  /** @type {number} */
  t = -1;

  /** @type {object} */
  range = {
    start: new PIXI.Point(),  /** @type {PIXI.Point} */
    end: new PIXI.Point()       /** @type {PIXI.Point} */
  };

  /** @type {object} */
  options = {};

  /** @type {Marker} */
  next;

  constructor(t, start, end, opts = {}) {
    this.t = t;
    this.options = opts;
    this.range.start.copyFrom(start);
    this.range.end.copyFrom(end);
  }

  /** @type {PIXI.Point} */
  get point() { return this.#point ?? (this.#point = this.pointAtT(this.t)); }

  /**
   * Given a t position, project the location given this marker's range.
   * @param {number} t
   * @returns {PIXI.Point}
   */
  pointAtT(t) { return this.range.start.projectToward(this.range.end, t); }

  /**
   * Build a new marker and link it as the next marker to this one.
   * If this marker has a next marker, insert in-between.
   * Will insert at later spot as necessary
   * @param {number} t      Must be greater than or equal to this t.
   * @param {object} opts   Will be combined with this marker options.
   * @returns {Marker}
   */
  addSubsequentMarker(t, opts) {
    if ( this.t === t ) { return this; }

    // Insert further down the line if necessary.
    if ( this.next && this.next.t < t ) return this.next.addSubsequentMarker(t, opts);

    // Merge the options with this marker's options and create a new marker.
    if ( t < this.t ) console.error("Marker asked to create a next marker with a previous t value.");
    const next = new this.constructor(t, this.range.start, this.range.end, { ...this.options, ...opts });

    // Insert at the correct position.
    if ( this.next ) next.next = this.next;
    this.next = next;
    return next;
  }

  /**
   * Like addSubsequentMarker but does not merge options and performs less checks.
   * Assumes it should be the very next item and does not check for existing next object.
   */
  _addSubsequentMarkerFast(t, opts) {
    const next = new this.constructor(t, this.range.start, this.range.end, opts);
    this.next = next;
    return next;
  }
}

/**
 * Class used by #markPixelsForLocalCoords to store relevant data for the pixel point.
 */
export class PixelMarker extends Marker {

  static calculateOptsFn(cache, coords ) {
    const width = cache.localFrame.width;
    return i => {
      const localX = coords[i];
      const localY = coords[i+1];
      const idx = (localY * width) + localX;
      const currPixel = cache.pixels[idx];
      return { localX, localY, currPixel };
    };
  }
}

// ----- NOTE: Helper functions ----- //

/**
 * Fix a number to 8 decimal places
 * @param {number} x    Number to fix
 * @returns {number}
 */
const POW10_8 = Math.pow(10, 8);
function fastFixed(x) { return Math.round(x * POW10_8) / POW10_8; }


GEOMETRY_CONFIG.PixelCache ??= PixelCache;
GEOMETRY_CONFIG.TrimmedPixelCache ??= TrimmedPixelCache;
GEOMETRY_CONFIG.TilePixelCache ??= TilePixelCache;
GEOMETRY_CONFIG.Marker ??= Marker;
GEOMETRY_CONFIG.PixelMarker ??= PixelMarker;

