/* globals
CONFIG,
PIXI
*/
"use strict";

import { GEOMETRY_CONFIG } from "./const.js";

// Basic matrix operations
// May eventually replace with math.js (when installed, call "math" to get functions)
// row-major format, so this works:
// See https://www.modular.com/blog/row-major-vs-column-major-matrices-a-performance-analysis-in-mojo-and-numpy#:~:text=Row%2Dmajor%20and%20column%20major,stored%20in%20contiguous%20memory%20locations.
/*
[
  1, 2, 3
  4, 5, 6  ==> [1, 2, 3, 4, 5, 6, 7, 8, 9]
  7, 8, 9
]


*/
// Improved for speed; uses a flat array to store.
// Keep separate for the moment until tested.

export class MatrixFlat {

  static arrayClass = Array;

  static arrayIsTyped = false;

  /** @type {Array|TypedArray} */
  arr = [];

  /** @type {number} */
  nrow = 0;

  /** @type {number} */
  ncol = 0;

  constructor(arr, nrow, ncol) {
    this.arr = arr;
    this.nrow = nrow ?? 1;
    this.ncol = ncol ?? Math.floor(arr.length / nrow);
  }

  // ----- NOTE: Getters and indexers ---- //

  // Backwards compatibility
  /** @type {number} */
  get dim1() { return this.nrow; }

  // Backwards compatibility
  /** @type {number} */
  get dim2() { return this.ncol; }

  /** @type {number} */
  get length() { return this.arr.length; }

  // Row major, so row 0, col0, col1, ... row 1, col0, col1, ...
  _idx(row, col) { return (row * this.ncol) + col; }

  getIndex(row, col) { return this.arr[this._idx(row, col)]; }

  setIndex(row, col, value) { this.arr[this._idx(row, col)] = value; }

  // ----- NOTE: Iterators ----- //

  /**
   * Iterate over each element of the matrix.
   * Iterate by column, then by row
   */
  [Symbol.iterator]() {
    let index = 0;
    const ln = this.length;
    const dat = this.arr;
    return {
      next() {
        if ( index < ln ) {
          return { value: dat[index++], done: false };
        } else return { done: true };
      }
    };
  }

  /**
   * For each element in the matrix, apply the callback.
   * To modify the element, call setIndex in the callback.
   * @param {function} callback     Function that can take:
   *   - @param {number} element
   *   - @param {number} row
   *   - @param {number} col
   *   - @param {Matrix} this
   */
  forEach(callback) {
    const { nrow, ncol } = this;
    for ( let r = 0; r < nrow; r += 1 ) {
      for ( let c = 0; c < ncol; c += 1 ) callback(this.getIndex(r, c), r, c, this);
    }
  }

  /**
   * Same as forEach but does not use getIndex and does not determine row, col.
   * @param {function} callback     Function that can take:
   *   - @param {number} element
   *   - @param {number} i
   *   - @param {Matrix} this
   */
  _forEach(callback) {
    const ln = this.length;
    for ( let i = 0; i < ln; i += 1 ) callback(this.arr[i], i, this);
  }

  /**
   * Set each element of the matrix in turn to the value returned by the callback.
   * For convenience; can accomplish the same thing using forEach directly.
   * @param {function} callback       See forEach.
   */
  setElements(callback) {
    const setter = (elem, r, c, mat) => mat.setIndex(r, c, callback(elem, r, c, mat));
    this.forEach(setter);
  }

  /**
   * Same as setElements but does not use getIndex and does not determine row, col.
   * @param {function} callback     Function that can take:
   *   - @param {number} element
   *   - @param {number} i
   *   - @param {Matrix} this
   */
  _setElements(callback) {
    const setter = (elem, i, mat) => mat.arr[i] = callback(elem, i, mat);
    this._forEach(setter);
  }

  forEachDiagonal(callback) {
    const ln = Math.min(this.nrow, this.ncol);
    for ( let i = 0; i < ln; i += 1 ) callback(this.getIndex(i, i), i, this);
  }

  setDiagonal(callback) {
    const setter = (elem, i, mat) => mat.setIndex(i, i, callback(elem, i, mat));
    this.forEachDiagonal(setter);
  }

  // ----- NOTE: Construction from arrays ----- //

  /**
   * Create a column from a 2D array, where the outer array stores the rows.
   * e.g.
   * MatrixFlat.from2dArray([
   *   [r0c0, r1c0]
   *   [r1c0, r1c1]
   * @param {Array[Array[]]} arr
   * @returns {Matrix}
   */
  static from2dArray(arr, outMatrix) {
    const nrow = arr.length;
    const ncol = arr[0].length;
    outMatrix ??= new this.empty(nrow, ncol);
    outMatrix.setElements((elem, r, c) => arr[r][c]);
    return outMatrix;
  }

  /**
   * Uses the array provided unless a typed array is required, and then copies it.
   * @param {Array|TypedArray} arr
   * @param {number} rows
   * @param {number} cols
   */
  static fromRowMajorArray(arr, rows, cols) {
    const ln = arr.length;
    if ( rows * cols !== ln ) {
      console.error("Rows or columns incorrectly specified.");
      return undefined;
    }
    return new this(this.arrayIsTyped ? new this.arrayClass(arr) : arr, rows, cols);
  }

  static fromColumnMajorArray(arr, rows, cols) {
    const ln = arr.length;
    if ( rows * cols !== ln ) {
      console.error("Rows or columns incorrectly specified.");
      return undefined;
    }
    const mat = new this.empty(rows, cols);
    mat._setElements((elem, i) => arr[i]);
    return mat;
  }

  // ----- NOTE: Simple matrix construction ----- //

  /**
   * Create an empty matrix.
   * @param {number} rows
   * @param {number} cols
   * @returns {Matrix}
   */
  static empty(rows, cols) { return new this(new this.arrayClass(rows * cols), rows, cols); }

  /**
   * Create a matrix filled with zeroes.
   * @param {number} rows
   * @param {number} cols
   * @param {Matrix} [outMatrix]
   * @returns {Matrix}
   */
  static zeroes(rows, cols, outMatrix) {
    outMatrix ??= this.empty(rows, cols);
    outMatrix.arr.fill(0);
    return outMatrix;
  }

  /**
   * Create an identity matrix
   * @param {number} rows
   * @param {number} cols
   * @param {Matrix} [outMatrix]
   * @returns {Matrix}
   */
  static identity(rows, cols, outMatrix) {
    cols ??= rows;
    const mat = this.zeroes(rows, cols, outMatrix);
    mat.setDiagonal(() => 1);
    return mat;
  }

  /**
   * Create a matrix filled with random numbers between 0 and 1.
   * @param {number} rows
   * @param {number} cols
   * @returns {Matrix}
   */
  static random(rows, cols) {
    const mat = new this.empty(rows, cols);
    mat._setElements(() => Math.random());
    return mat;
  }

  /**
   * Create a 1x4 matrix from a point.
   */
  static fromPoint3d(p, { homogenous = true } = {}) {
    const mat = this.empty(1, 3 + homogenous);

    // Only single row, so can process the array directly.
    mat.arr[0] = p.x;
    mat.arr[1] = p.y;
    mat.arr[2] = p.z;
    if ( homogenous ) mat.arr[3] = 1;
    return mat;
  }

  /**
   * Create a 1x3 matrix from a point.
   */
  static fromPoint2d(p, { homogenous = true } = {}) {
    const mat = this.empty(1, 2 + homogenous);

    // Only single row, so can process the array directly.
    mat.arr[0] = p.x;
    mat.arr[1] = p.y;
    if ( homogenous ) mat.arr[2] = 1;
    return mat;
  }

 /**
   * Convert matrix to a PIXI.Point.
   * Any index in the first row can be chosen for x and y.
   * If homogenous is true, the last column [0, col - 1] is assumed to be the divisor.
   * @param {object} [options]    Options to affect how the matrix is interpreted.
   * @param {number} [options.xIndex]       Column for the x variable.
   * @param {number} [options.yIndex]       Column for the y variable.
   * @param {boolean} [options.homogenous]  Whether to convert homogenous coordinates.
   * @param {Point3d} [options.outPoint]    Placeholder for the new Point.
   * @returns {PIXI.Point}
   */
  toPoint2d({ xIndex = 0, yIndex = 1, homogenous = true, outPoint = new PIXI.Point() } = {}) {
    const arr = this.arr;
    outPoint.x = arr[xIndex];
    outPoint.y = arr[yIndex];
    if ( homogenous ) {
      const h = arr[this.ncol - 1];
      outPoint.x /= h;
      outPoint.y /= h;
    }
    return outPoint;
  }

  /**
   * Convert matrix to a Point3d.
   * Any index in the first row can be chosen for x and y and z.
   * If homogenous is true, the last column [0, col - 1] is assumed to be the divisor.
   * @param {object} [options]    Options to affect how the matrix is interpreted.
   * @param {number} [options.xIndex]       Column for the x variable.
   * @param {number} [options.yIndex]       Column for the y variable.
   * @param {number} [options.zIndex]       Column for the z variable.
   * @param {boolean} [options.homogenous]  Whether to convert homogenous coordinates.
   * @param {Point3d} [options.outPoint]    Placeholder for the new Point3d.
   * @returns {PIXI.Point}
   */
  toPoint3d({ xIndex = 0, yIndex = 1, zIndex = 2, homogenous = true, outPoint = new CONFIG.GeometryLib.threeD.Point3d() } = {}) {
    const arr = this.arr;
    outPoint.x = arr[xIndex];
    outPoint.y = arr[yIndex];
    outPoint.z = arr[zIndex];
    if ( homogenous ) {
      const h = this.arr[this.ncol - 1];
      outPoint.x /= h;
      outPoint.y /= h;
      outPoint.z /= h;
    }
    return outPoint;
  }

  /**
   * Copy this matrix to a new matrix object.
   * @param {Matrix} [outMatrix]      The matrix to use as the clone; must have same dimensions.
   * @returns {Matrix}
   */
  clone(outMatrix) {
    outMatrix ??= new this.constructor.empty(this.nrow, this.ncol);
    outMatrix._setElements((elem, i) => this.arr[i]);
    return outMatrix;
  }

  // ----- NOTE: Transformation ----- //


  /**
   * Specifies a viewing frustum in the world coordinate system.
   * See
   * https://registry.khronos.org/OpenGL-Refpages/gl2.1/xhtml/gluPerspective.xml
   * https://gamedev.stackexchange.com/questions/12726/understanding-the-perspective-projection-matrix-in-opengl
   * http://www.opengl-tutorial.org/beginners-tutorials/tutorial-3-matrices/
   * http://www.songho.ca/opengl/gl_projectionmatrix.html
   * https://webglfundamentals.org/webgl/lessons/webgl-3d-perspective.html
   *
   * @param {number} fovRadians     Field of view angle, in radians, in the y direction
   * @param {number} aspect   Aspect ratio that determines fov in the x direction. Ratio of x (width) to y (height).
   * @param {number} zNear    Distance from the viewer to the near clipping plane (always positive)
   * @param {number} zFar     Distance from the viewer to the far clipping plane (always positive)
   * @returns {Matrix} 4x4 Matrix, in row-major format
   */
  static perspective(fovRadians, aspect, zNear, zFar) {
    const f = Math.tan((Math.PI * 0.5) - (0.5 * fovRadians));
    const rangeInv = 1.0 / (zNear - zFar);
    const DIAG0 = f / aspect;
    const DIAG2 = (zNear + zFar) * rangeInv;
    const A = zNear * zFar * rangeInv * 2;
    return this.fromRowMajorArray([
      DIAG0,   0,    0,      0,
      0,       f,    0,      0,
      0,       0,    DIAG2,  -1,
      0,       0,    A,      0
    ], 4, 4);
  }

  static perspectiveDegrees(fovDegrees, aspect, zNear, zFar) {
    return this.perspective(Math.toRadians(fovDegrees), aspect, zNear, zFar);
  }

  /**
   * Specifies a perspective matrix.
   * See
   * https://registry.khronos.org/OpenGL-Refpages/gl2.1/xhtml/glFrustum.xml
   *
   * @param {number} left   Coordinate for left vertical clipping plane
   * @param {number} right  Coordinate for right vertical clipping plane
   * @param {number} bottom Coordinate for the bottom horizontal clipping plane
   * @param {number} top    Coordinate for the top horizontal clipping plane
   * @param {number} zNear    Distance from the viewer to the near clipping plane (always positive)
   * @param {number} zFar     Distance from the viewer to the far clipping plane (always positive)
   * @returns {Matrix} 4x4 Matrix, in row-major format
   */
  static frustrum(left, right, bottom, top, zNear, zFar) {
    const A = (right + left) / (right - left);
    const B = (top + bottom) / (top - bottom);
    const C = -((zFar + zNear) / (zFar - zNear));
    const D = -((2 * zFar * zNear) / (zFar - zNear));

    return this.fromRowMajorArray([
      (2 * zNear) / (right - left),  0,                            A,  0,
      0,                             (2 * zNear) / (top - bottom), B,  0,
      0,                             0,                            C,  D,
      0,                             0,                            -1, 0
    ], 4, 4);
  }

  /**
   * Construct a camera matrix given the position of the camera, position of the
   * target the camera is observing, the a vector pointing directly up.
   *
   * See
   * https://webglfundamentals.org/webgl/lessons/webgl-3d-camera.html
   * https://www.scratchapixel.com/lessons/mathematics-physics-for-computer-graphics/lookat-function
   * https://www.geertarien.com/blog/2017/07/30/breakdown-of-the-lookAt-function-in-OpenGL/
   *
   * @param {Point3d} cameraPosition
   * @param {Point3d} target
   * @param {Point3d} up
   * @returns {Matrix} 4x4 matrix
   */
  static lookAt(cameraPosition, targetPosition, up = new CONFIG.GeometryLib.threeD.Point3d(0, -1, 1)) {
    // NOTE: Foundry uses a left-hand coordinate system, with y reversed.

    const zAxis = cameraPosition.subtract(targetPosition); // ZAxis = forward
    if ( zAxis.magnitudeSquared ) zAxis.normalize(zAxis); // Don't normalize if 0, 0, 0

    const xAxis = new CONFIG.GeometryLib.threeD.Point3d(1, 0, 0);
    const yAxis = new CONFIG.GeometryLib.threeD.Point3d(0, 1, 0);
    if ( zAxis.x || zAxis.y ) {
      up.cross(zAxis, xAxis); // XAxis = right
      if ( xAxis.magnitudeSquared() ) xAxis.normalize(xAxis); // Don't normalize if 0, 0, 0
      zAxis.cross(xAxis, yAxis); // YAxis = up

    } else {
      console.warn("lookAt zAxis.x and y are zero.");
      // Camera either directly overhead or directly below
      // Overhead if zAxis.z is positive
      // xAxis = new CONFIG.GeometryLib.threeD.Point3d(1, 0, 0);
      // yAxis = new CONFIG.GeometryLib.threeD.Point3d(0, 1, 0);

    }

    const M = this.fromRowMajorArray([
      xAxis.x, xAxis.y, xAxis.z, 0,
      yAxis.x, yAxis.y, yAxis.z, 0,
      zAxis.x, zAxis.y, zAxis.z, 0,
      cameraPosition.x, cameraPosition.y, cameraPosition.z, 1
    ], 4, 4);

    const Minv = this.fromRowMajorArray([
      xAxis.x, yAxis.x, zAxis.x, 0,
      xAxis.y, yAxis.y, zAxis.y, 0,
      xAxis.z, yAxis.z, zAxis.z, 0,
      -(xAxis.dot(cameraPosition)), -(yAxis.dot(cameraPosition)), -(zAxis.dot(cameraPosition)), 1
    ], 4, 4);

    return { M, Minv };
  }

  /**
   * Rotation matrix for a given angle, rotating around X axis.
   * @param {number} angle          Radians
   * @param {boolean} [d3 = true]    If d3, use a 4-d matrix. Otherwise, 3-d matrix.
   * @returns {Matrix}
   */
  static rotationX(angle, d3 = true, outMatrix) {
    const n = 3 + d3;
    outMatrix = this.identity(n, n, outMatrix);
    if ( !angle ) return outMatrix;

    let c = Math.cos(angle);
    let s = Math.sin(angle);

    // Math.cos(Math.PI / 2) ~ 0 but not quite.
    // Same for Math.sin(Math.PI).
    if ( c.almostEqual(0) ) c = 0;
    if ( s.almostEqual(0) ) s = 0;

    /*
    [1, 0, 0, 0],
    [0, c, s, 0],
    [0, -s, c, 0],
    [0, 0, 0, 1]

    [1, 0, 0],
    [0, c, s],
    [0, -s, c]
    */

    outMatrix.setIndex(1, 1, c);
    outMatrix.setIndex(2, 2, c);
    outMatrix.setIndex(1, 2, s);
    outMatrix.setIndex(2, 1, -s);
    return outMatrix;
  }

  /**
   * Rotation matrix for a given angle, rotating around Y axis.
   * @param {number} angle          Radians
   * @param {boolean} [d3 = true]    If d3, use a 4-d matrix. Otherwise, 3-d matrix.
   * @returns {Matrix}
   */
  static rotationY(angle, d3 = true, outMatrix) {
    const n = 3 + d3;
    outMatrix = this.identity(n, n, outMatrix);
    if ( !angle ) return outMatrix;

    let c = Math.cos(angle);
    let s = Math.sin(angle);

    // Math.cos(Math.PI / 2) ~ 0 but not quite.
    // Same for Math.sin(Math.PI).
    if ( c.almostEqual(0) ) c = 0;
    if ( s.almostEqual(0) ) s = 0;

    /*
    [c, 0, s, 0],
    [0, 1, 0, 0],
    [-s, 0, c, 0],
    [0, 0, 0, 1]

    [c, 0, s],
    [0, 1, 0],
    [-s, 0, c]
    */
    outMatrix.setIndex(0, 0, c);
    outMatrix.setIndex(2, 2, c);
    outMatrix.setIndex(2, 0, -s);
    outMatrix.setIndex(0, 2, s);
    return outMatrix;
  }

  /**
   * Rotation matrix for a given angle, rotating around Z axis.
   * @param {number} angle
   * @param {boolean} [d3 = true]    If d3, use a 4-d matrix. Otherwise, 3-d matrix.
   * @returns {Matrix}
   */
  static rotationZ(angle, d3 = true, outMatrix) {
    const n = 3 + d3;
    outMatrix = this.identity(n, n, outMatrix);
    if ( !angle ) return outMatrix;

    let c = Math.cos(angle);
    let s = Math.sin(angle);

    // Math.cos(Math.PI / 2) ~ 0 but not quite.
    // Same for Math.sin(Math.PI).
    if ( c.almostEqual(0) ) c = 0;
    if ( s.almostEqual(0) ) s = 0;

    /*
      [c, s, 0, 0],
      [-s, c, 0, 0],
      [0, 0, 1, 0],
      [0, 0, 0, 1]

      [c, s, 0],
      [-s, c, 0],
      [0, 0, 1]
    */
    outMatrix.setIndex(0, 0, c);
    outMatrix.setIndex(1, 1, c);
    outMatrix.setIndex(1, 0, -s);
    outMatrix.setIndex(0, 1, s);
    return outMatrix;
  }

  /**
   * Combine rotation matrixes for x, y, and z.
   * @param {number} angleX   Radians
   * @param {number} angleY   Radians
   * @param {number} angleZ   Radians
   * @param {boolean} [d3 = true]    If d3, use a 4-d matrix. Otherwise, 3-d matrix.
   * @returns {Matrix}
   */
  static rotationXYZ(angleX, angleY, angleZ, d3 = true, outMatrix) {
    outMatrix = angleX ? this.rotationX(angleX, d3, outMatrix) : angleY
      ? this.rotationY(angleY, d3, outMatrix) : angleZ
        ? this.rotationZ(angleZ, d3, outMatrix) : outMatrix.identity();

    const multFn = d3 ? "multiply4x4" : "multiply3x3";
    if ( angleX && angleY ) {
      const rotY = this.rotationY(angleY, d3);
      outMatrix = outMatrix[multFn](rotY); // Cannot pass outMatrix as tmp if it is rot.
    }
    if ( (angleX || angleY) && angleZ ) {
      const rotZ = this.rotationZ(angleZ, d3);
      outMatrix = outMatrix[multFn](rotZ);
    }
    return outMatrix;
  }

  static translation(x = 0, y = 0, z, outMatrix) {
    const n = typeof z === "undefined" ? 3 : 4;
    outMatrix = this.identity(n, n, outMatrix);

    /*
    [1, 0, 0],
    [0, 1, 0],
    [x, y, 1]

    [1, 0, 0, 0],
    [0, 1, 0, 0],
    [0, 0, 1, 0],
    [x, y, z, 1]
    */
    const r = n - 1;
    outMatrix.setIndex(r, 0, x);
    outMatrix.setIndex(r, 1, y);
    outMatrix.setIndex(r, 2, z);
    return outMatrix;
  }

  static scale(x = 1, y = 1, z, outMatrix) {
    const n = typeof z === "undefined" ? 3 : 4;
    outMatrix = this.identity(n, n, outMatrix);
    /*
    [x, 0, 0],
    [0, y, 0],
    [0, 0, 1]

    [x, 0, 0, 0],
    [0, y, 0, 0],
    [0, 0, z, 0],
    [0, 0, 0, 1]
    */
   outMatrix.setIndex(0, 0, x);
   outMatrix.setIndex(1, 1, y);
   if ( typeof z !== "undefined" ) outMatrix.setIndex(2, 2, z);
   return outMatrix;
  }

  /**
   * Construct a 4x4 matrix to rotate by angle around an axis.
   * https://en.wikipedia.org/wiki/Rotation_matrix#Rotation_matrix_from_axis_and_angle
   * @param {number} angle  Angle, in radians
   * @param {Point3d} axis  Axis
   */
  static rotationAngleAxis(angle, axis) {
    axis.normalize(axis);

    let c = Math.cos(angle);
    let s = Math.sin(angle);

    // Math.cos(Math.PI / 2) ~ 0 but not quite.
    // Same for Math.sin(Math.PI).
    if ( c.almostEqual(0) ) c = 0;
    if ( s.almostEqual(0) ) s = 0;

    const cNeg = 1 - c;
    const xy = axis.x * axis.y * cNeg;
    const yz = axis.y * axis.z * cNeg;
    const xz = axis.x * axis.z * cNeg;
    const xs = axis.x * s;
    const ys = axis.y * s;
    const zs = axis.z * s;

    return this.fromRowMajorArray([
      c + (axis.x * axis.x * cNeg), xy - zs, xz + ys, 0,

      xy + zs, c + (axis.y * axis.y * cNeg), yz - xs, 0,

      xz - ys, yz + xs, c + (axis.z * axis.z * cNeg), 0,

      0, 0, 0, 1
    ]);
  }



  // ----- NOTE: Basic math operations ----- //

  /**
   * Test if this matrix is exactly equal to another
   * @param {Matrix} other
   * @returns {boolean}
   */
  equal(other) {
    if ( this.nrow !== other.nrow || this.ncol !== other.ncol ) return false;
    return this.arr.every((elem, i) => elem === other.arr[i]);
  }

  /**
   * Test if this matrix is almost equal to another
   * @param {Matrix} other
   * @param {number} epsilon
   * @returns {boolean}
   */
  almostEqual(other, epsilon = 1e-8) {
    if ( this.nrow !== other.nrow || this.ncol !== other.ncol ) return false;
    return this.arr.every((elem, i) => elem.almostEqual(other.arr[i], epsilon));
  }

  /**
   * "Clean" a matrix by converting near zero and near 1 entries to integers.
   * Often due to floating point approximations
   * Destructive operation in that it affects values in this matrix.
   */
  clean(epsilon = 1e-08) {
    this._setElements(elem => {
      if ( elem.almostEqual(0, epsilon) ) return 0;
      if ( elem.almostEqual(1, epsilon) ) return 1;
      return elem;
    });
  }

  /**
   * See https://stackoverflow.com/questions/4492678/swap-rows-with-columns-transposition-of-a-matrix-in-javascript
   * @param {Matrix} outMatrix  Optional matrix to use for the returned data.
   * @returns {Matrix}
   */
  transpose(outMatrix) {
    outMatrix ??= this.constructor.empty(this.nrow, this.ncol);
    this.forEach((elem, r, c) => {
      if ( r === c ) outMatrix.setIndex(r, c, elem);
      else outMatrix.setIndex(c, r, elem);
    });
    return outMatrix;
  }

  add(other, outMatrix) {
    if ( this.nrow !== other.nrow || this.ncol !== other.ncol ) {
      console.error("Matrices cannot be added.");
      return undefined;
    }
    outMatrix ??= this.constructor.empty(this.nrow, this.ncol);
    outMatrix._setElements((elem, i) => this.arr[i] + other.arr[i]);
    return outMatrix;
  }

  subtract(other, outMatrix) {
    if ( this.nrow !== other.nrow || this.ncol !== other.ncol ) {
      console.error("Matrices cannot be subtracted.");
      return undefined;
    }
    outMatrix ??= this.constructor.empty(this.nrow, this.ncol);
    outMatrix._setElements((elem, i) => this.arr[i] - other.arr[i]);
    return outMatrix;
  }

  // ----- NOTE: Multiplication ----- //

  /**
   * Multiply this and another matrix. this • other.
   * @param {Matrix} other
   * @param {Matrix} [outMatrix]    Must have this.nrow and other.ncol; cannot be this or other.
   * @returns {Matrix}
   */
  multiply(other, outMatrix) {
    let A = this;
    let B = other;

    const rowsA = A.nrow;
    const colsA = A.ncol;
    const rowsB = B.nrow;
    const colsB = B.ncol;

    outMatrix = this.constructor.zeroes(rowsA, colsB, outMatrix)

    if ( colsA !== rowsB || outMatrix.nrow !== rowsA || outMatrix.ncol !== colsB ) {
      console.error("Matrices cannot be multiplied.");
      return undefined;
    }

    // Cannot have the outMatrix reference A or B, because the outMatrix values get modified in the loop.
    if ( A === outMatrix ) A = A.clone();
    if ( B === outMatrix ) B = B.clone();

    for ( let x = 0; x < rowsA; x += 1 ) {
      for ( let y = 0; y < colsB; y += 1 ) {
        for ( let z = 0; z < colsA; z += 1 ) {
          const value = outMatrix.getIndex(x, y) + (this.getIndex(x, z) * other.getIndex(z, y));
          outMatrix.setIndex(x, y, value);
        }
      }
    }
    return outMatrix;
  }

  /**
   * Faster 1x3 multiplication
   * @param {Matrix} other    A 1x3 matrix, like Matrix.prototype.fromPoint2d
   * @returns Matrix
   */
  multiply1x3(other, outMatrix) {
    outMatrix ??= this.constructor.empty(1, 3);

    // For speed, assume _idx is (col * this.nrow) + row
    // Array organized col0, row0, row1, row2, ... col1, row0, row1, ...
    const a00 = other.arr[0]; // aRC
    const a01 = other.arr[1];
    const a02 = other.arr[2];

    const a10 = other.arr[3];
    const a11 = other.arr[4];
    const a12 = other.arr[5];

    const a20 = other.arr[6];
    const a21 = other.arr[7];
    const a22 = other.arr[8];

    const b00 = this.arr[0];
    const b01 = this.arr[1];
    const b02 = this.arr[2];

    outMatrix.arr[0] = a00 * b00 + a10 * b01 + a20 * b02;
    outMatrix.arr[1] = a01 * b00 + a11 * b01 + a21 * b02;
    outMatrix.arr[2] = a02 * b00 + a12 * b01 + a22 * b02;

    return outMatrix;
  }

  /**
   * Faster 1x4 multiplication
   * Foundry bench puts this at ~ 75% of multiply.
   * @param {Matrix} other    A 1x4 matrix, like Matrix.prototype.fromPoint3d
   * @returns Matrix
   */
  multiply1x4(other, outMatrix) {
    outMatrix ??= this.constructor.empty(1, 4);

    // For speed, assume _idx is (col * this.nrow) + row
    // Array organized col0, row0, row1, row2, ... col1, row0, row1, ...
    const a00 = other.arr[0]; // aRC
    const a01 = other.arr[1];
    const a02 = other.arr[2];
    const a03 = other.arr[3];

    const a10 = other.arr[4];
    const a11 = other.arr[5];
    const a12 = other.arr[6];
    const a13 = other.arr[7];

    const a20 = other.arr[8];
    const a21 = other.arr[9];
    const a22 = other.arr[10];
    const a23 = other.arr[11];

    const a30 = other.arr[12];
    const a31 = other.arr[13];
    const a32 = other.arr[14];
    const a33 = other.arr[15];

    const b00 = this.arr[0];
    const b01 = this.arr[1];
    const b02 = this.arr[2];
    const b03 = this.arr[3];

    outMatrix.arr[0] = a00 * b00 + a10 * b01 + a20 * b02 + a30 * b03;
    outMatrix.arr[1] = a01 * b00 + a11 * b01 + a21 * b02 + a31 * b03;
    outMatrix.arr[2] = a02 * b00 + a12 * b01 + a22 * b02 + a32 * b03;
    outMatrix.arr[3] = a03 * b00 + a13 * b01 + a23 * b02 + a33 * b03;

    return outMatrix;
  }

  /**
   * Multiply a Point2d by this matrix and output a different Point3d.
   * For speed, the input is not checked against the matrix for correct dimensionality.
   * Foundry bench puts this at ~ 68% of multiply.
   * @param {Point3d} point    The point to multiply
   * @param {Point3d} outPoint Optional point in which to store the result.
   * @returns {Point3d}
   */
  multiplyPoint2d(point, outPoint = new PIXI.Point()) {
    // For speed, assume _idx is (col * this.nrow) + row
    // Array organized col0, row0, row1, row2, ... col1, row0, row1, ...
    const a00 = this.arr[0]; // aRC
    const a01 = this.arr[1];
    const a02 = this.arr[2];

    const a10 = this.arr[3];
    const a11 = this.arr[4];
    const a12 = this.arr[5];

    const a20 = this.arr[6];
    const a21 = this.arr[7];
    const a22 = this.arr[8];

    const b00 = point.x;
    const b01 = point.y;
    const b02 = 1;

    outPoint.x = a00 * b00 + a10 * b01 + a20 * b02;
    outPoint.y = a01 * b00 + a11 * b01 + a21 * b02;
    const w = a02 * b00 + a12 * b01 + a22 * b02;

    outPoint.x /= w;
    outPoint.y /= w;

    return outPoint;
  }

  /**
   * Multiply a Point3d by this matrix and output a different Point3d.
   * For speed, the input is not checked against the matrix for correct dimensionality.
   * Foundry bench puts this at ~ 68% of multiply.
   * @param {Point3d} point    The point to multiply
   * @param {Point3d} outPoint Optional point in which to store the result.
   * @returns {Point3d}
   */
  multiplyPoint3d(point, outPoint = new CONFIG.GeometryLib.threeD.Point3d()) {

    // For speed, assume _idx is (col * this.nrow) + row
    // Array organized col0, row0, row1, row2, ... col1, row0, row1, ...
    const a00 = this.arr[0]; // aRC
    const a01 = this.arr[1];
    const a02 = this.arr[2];
    const a03 = this.arr[3];

    const a10 = this.arr[4];
    const a11 = this.arr[5];
    const a12 = this.arr[6];
    const a13 = this.arr[7];

    const a20 = this.arr[8];
    const a21 = this.arr[9];
    const a22 = this.arr[10];
    const a23 = this.arr[11];

    const a30 = this.arr[12];
    const a31 = this.arr[13];
    const a32 = this.arr[14];
    const a33 = this.arr[15];

    const b00 = point.x;
    const b01 = point.y;
    const b02 = point.z;
    const b03 = 1;

    outPoint.x = a00 * b00 + a10 * b01 + a20 * b02 + a30 * b03;
    outPoint.y = a01 * b00 + a11 * b01 + a21 * b02 + a31 * b03;
    outPoint.z = a02 * b00 + a12 * b01 + a22 * b02 + a32 * b03;
    const w = a03 * b00 + a13 * b01 + a23 * b02 + a33 * b03;

    outPoint.x /= w;
    outPoint.y /= w;
    outPoint.z /= w;

    return outPoint;
  }

  /**
   * Faster 2x2 multiplication
   * Strassen's algorithm
   * JSBench.me: ~ 30% slower to multiply, versus this multiply2x2
   * https://jsbench.me/qql9d8m0eg/1
   * @param {Matrix} other
   * @returns {Matrix}
   */
  multiply2x2(other, outMatrix) {
    outMatrix ??= this.constructor.empty(2, 2);

    // For speed, assume _idx is (col * this.nrow) + row
    // Array organized col0, row0, row1, row2, ... col1, row0, row1, ...
    const a00 = this.arr[0]; // aRC
    const a01 = this.arr[1];

    const a10 = this.arr[2];
    const a11 = this.arr[3];

    const b00 = other.arr[0]; // aRC
    const b01 = other.arr[1];

    const b10 = other.arr[2];
    const b11 = other.arr[3];

    const m1 = (a00 + a11) * (b00 + b11);
    const m2 = (a10 + a11) * b00;
    const m3 = a00 * (b01 - b11);
    const m4 = a11 * (b10 - b00);
    const m5 = (a00 + a01) * b11;
    const m6 = (a10 - a00) * (b00 + b01);
    const m7 = (a01 - a11) * (b10 + b11);

    // Row 0
    outMatrix.arr[0] = m1 + m4 - m5 + m7;
    outMatrix.arr[1] = m3 + m5;

    // Row 1
    outMatrix.arr[2] = m2 + m4;
    outMatrix.arr[3] = m1 - m2 + m3 + m6;

    return outMatrix;
  }

  /**
   * Faster 3x3 multiplication
   * Laderman's.
   * https://www.ams.org/journals/bull/1976-82-01/S0002-9904-1976-13988-2/S0002-9904-1976-13988-2.pdf
   * JSBench suggests 50% to use normal multiply
   * https://jsbench.me/c8l9d973rm/1
   * @param {Matrix} other
   * @returns {Matrix}
   */
  multiply3x3(other, outMatrix) {
    outMatrix = this.constructor.empty(3, 3);

    // For speed, assume _idx is (col * this.nrow) + row
    // Array organized col0, row0, row1, row2, ... col1, row0, row1, ...
    const a00 = this.arr[0]; // aRC
    const a01 = this.arr[1];
    const a02 = this.arr[2];

    const a10 = this.arr[3];
    const a11 = this.arr[4];
    const a12 = this.arr[5];

    const a20 = this.arr[6];
    const a21 = this.arr[7];
    const a22 = this.arr[8];

    // For speed, assume _idx is (col * this.nrow) + row
    // Array organized col0, row0, row1, row2, ... col1, row0, row1, ...
    const b00 = other.arr[0]; // aRC
    const b01 = other.arr[1];
    const b02 = other.arr[2];

    const b10 = other.arr[3];
    const b11 = other.arr[4];
    const b12 = other.arr[5];

    const b20 = other.arr[6];
    const b21 = other.arr[7];
    const b22 = other.arr[8];

    const m1 = (a00 + a01 + a02 - a10 - a11 - a21 - a22) * b11;
    const m2 = (a00 - a10) * (b11 - b01);
    const m3 = a11 * (b01 - b00 + b10 - b11 - b12 - b20 + b22);
    const m4 = (a10 - a00 + a11) * (b00 - b01 + b11);
    const m5 = (a10 + a11) * (b01 - b00);
    const m6 = a00 * b00;
    const m7 = (a20 - a00 + a21) * (b00 - b02 + b12);
    const m8 = (a20 - a00) * (b02 - b12);
    const m9 = (a20 + a21) * (b02 - b00);
    const m10 = (a00 + a01 + a02 - a11 - a12 - a20 - a21) * b12;
    const m11 = a21 * (b02 - b00 + b10 - b11 - b12 - b20 + b21);
    const m12 = ( a21 - a02 + a22) * (b11 + b20 - b21);
    const m13 = (a02 - a22) * (b11 - b21);
    const m14 = a02 * b20;
    const m15 = (a21 + a22) * (b21 - b20);
    const m16 = (a11 - a02 + a12) * (b12 + b20 - b22);
    const m17 = (a02 - a12) * (b12 - b22);
    const m18 = (a11 + a12) * (b22 - b20);
    const m19 = a01 * b10;
    const m20 = a12 * b21;
    const m21 = a10 * b02;
    const m22 = a20 * b01;
    const m23 = a22 * b22;

    // Row 0
    outMatrix.arr[0] = m6 + m14 + m19;
    outMatrix.arr[1] = m1 + m4 + m5 + m6 + m12 + m14 + m15;
    outMatrix.arr[2] = m6 + m7 + m9 + m10 + m14 + m16 + m18;

    // Row 1
    outMatrix.arr[4] = m2 + m3 + m4 + m6 + m14 + m16 + m17;
    outMatrix.arr[5] = m2 + m4 + m5 + m6 + m20;
    outMatrix.arr[6] = m14 + m16 + m17 + m18 + m21;

    // Row 2
    outMatrix.arr[7] = m6 + m7 + m8 + m11 + m12 + m13 + m14;
    outMatrix.arr[8] = m12 + m13 + m14 + m15 + m22;
    outMatrix.arr[9] = m6 + m7 + m8 + m9 + m23;

    return outMatrix;
  }

  /**
   * Faster 4x4 multiplication
   * https://jsbench.me/bpl9dgtem6/1
   * regular looped multiply is 60% slower.
   * FYI, this could be faster but appears to be modular arithmetic:
   * https://www.nature.com/articles/s41586-022-05172-4.pdf
   * @param {Matrix} other
   * @returns {Matrix}
   */
  multiply4x4(other, outMatrix) {
    outMatrix ??= this.constructor.empty(4, 4);

    // For speed, assume _idx is (col * this.nrow) + row
    // Array organized col0, row0, row1, row2, ... col1, row0, row1, ...
    const a00 = this.arr[0]; // aRC
    const a01 = this.arr[1];
    const a02 = this.arr[2];
    const a03 = this.arr[3];

    const a10 = this.arr[4];
    const a11 = this.arr[5];
    const a12 = this.arr[6];
    const a13 = this.arr[7];

    const a20 = this.arr[8];
    const a21 = this.arr[9];
    const a22 = this.arr[10];
    const a23 = this.arr[11];

    const a30 = this.arr[12];
    const a31 = this.arr[13];
    const a32 = this.arr[14];
    const a33 = this.arr[15];

    // For speed, assume _idx is (col * this.nrow) + row
    // Array organized col0, row0, row1, row2, ... col1, row0, row1, ...
    const b00 = other.arr[0]; // aRC
    const b01 = other.arr[1];
    const b02 = other.arr[2];
    const b03 = other.arr[3];

    const b10 = other.arr[4];
    const b11 = other.arr[5];
    const b12 = other.arr[6];
    const b13 = other.arr[7];

    const b20 = other.arr[8];
    const b21 = other.arr[9];
    const b22 = other.arr[10];
    const b23 = other.arr[11];

    const b30 = other.arr[12];
    const b31 = other.arr[13];
    const b32 = other.arr[14];
    const b33 = other.arr[15];

    // Row 0
    outMatrix.arr[0] = (a00 * b00) + (a01 * b10) + (a02 * b20) + (a03 * b30);
    outMatrix.arr[1] = (a00 * b01) + (a01 * b11) + (a02 * b21) + (a03 * b31);
    outMatrix.arr[2] = (a00 * b02) + (a01 * b12) + (a02 * b22) + (a03 * b32);
    outMatrix.arr[3] = (a00 * b03) + (a01 * b13) + (a02 * b23) + (a03 * b33);

    // Row 1
    outMatrix.arr[4] = (a10 * b00) + (a11 * b10) + (a12 * b20) + (a13 * b30);
    outMatrix.arr[5] = (a10 * b01) + (a11 * b11) + (a12 * b21) + (a13 * b31);
    outMatrix.arr[6] = (a10 * b02) + (a11 * b12) + (a12 * b22) + (a13 * b32);
    outMatrix.arr[7] = (a10 * b03) + (a11 * b13) + (a12 * b23) + (a13 * b33);

    // Row 2
    outMatrix.arr[8] = (a20 * b00) + (a21 * b10) + (a22 * b20) + (a23 * b30);
    outMatrix.arr[9] = (a20 * b01) + (a21 * b11) + (a22 * b21) + (a23 * b31);
    outMatrix.arr[10] = (a20 * b02) + (a21 * b12) + (a22 * b22) + (a23 * b32);
    outMatrix.arr[11] = (a20 * b03) + (a21 * b13) + (a22 * b23) + (a23 * b33);

    // Row 3
    outMatrix.arr[12] = (a30 * b00) + (a31 * b10) + (a32 * b20) + (a33 * b30);
    outMatrix.arr[13] = (a30 * b01) + (a31 * b11) + (a32 * b21) + (a33 * b31);
    outMatrix.arr[14] = (a30 * b02) + (a31 * b12) + (a32 * b22) + (a33 * b32);
    outMatrix.arr[15] = (a30 * b03) + (a31 * b13) + (a32 * b23) + (a33 * b33);


    return outMatrix;
  }

  // ----- NOTE: Inversion ----- //

  /**
   * Invert a matrix.
   * https://stackoverflow.com/questions/1148309/inverting-a-4x4-matrix
   * https://github.com/willnode/N-Matrix-Programmer
   * https://github.com/willnode/matrix-inversion/blob/main/javascript/index.js
   * @param {Matrix} outMatrix
   * @returns {Matrix}
   * Testing:
     m = new Matrix([[1, 2], [3, 4]])
     m = new Matrix([[1, 4, 5], [3, 2, 4], [3, 1, 3]])
     m = new Matrix([[1,4,5,6], [3,2,4,5], [3,1,3,4], [13,14,15,16]])
     i = m.multiply(m.invert())
     i.almostEqual(Matrix.identity(m.dim1,m.dim2))
   *
   */
  invert(outMatrix) {
    outMatrix ??= this.constructor.empty(this.nrow, this.ncol);

    if ( this.nrow < 2 || this.nrow !== this.ncol ) {
      console.error("Cannot use invert on a non-square matrix.");
      return undefined;
    }

    const n = this.nrow;
    const x = Array.fromRange(n);
    const y = Array.fromRange(n);
    const k = {};
    let det = this.optimizedNDet(n, this, x, y, k);
    if ( !det ) throw new Error("Matrix is not invertible");

    det = 1 / det;

    // Fix for 2 x 2 matrices
    if ( n === 2 ) {
      outMatrix.arr[0] = det * this.arr[3]; // Row 0, col 0 = row 1, col 1
      outMatrix.arr[1] = det * -this.arr[1]; // Row 0, col 1 = row 0, col 1
      outMatrix.arr[2] = det * -this.arr[2]; // Row 1, col 0 = row 1, col 0
      outMatrix.arr[3] = det * this.arr[0]; // Row 1, col 1 = row 0, col 0
    } else {
      for ( let iy = 0; iy < n; iy += 1 ) {
        for ( let ix = 0; ix < n; ix += 1 ) {
          const plus = (ix + iy) % 2 === 0 ? 1 : -1;
          const xf = x.filter(e => e !== ix);
          const yf = y.filter(e => e !== iy);
          const der = this.optimizedNDet(n - 1, this, yf, xf, k);
          outMatrix.setIndex(iy, ix, det * plus * der);
        }
      }
    }

    return outMatrix;
  }

  /**
   * Return the determinant of this matrix;
   */
  determinant() {
    if ( this.nrow < 2 || this.nrow !== this.ncol ) {
      console.error("Cannot calculate determinant of non-square matrix.");
      return undefined;
    }
    const n = this.nrow;
    const x = Array.fromRange(n);
    const y = Array.fromRange(n);
    const k = {};
    return this.optimizedNDet(n, this, x, y, k);
  }

  /**
   * Calculate the determinant, recursively.
   * @param {number} n        Matrix rows or columns
   * @param {Matrix} m        Matrix
   * @param {number[]} x
   * @param {number[]} y
   * @param {{string: number}} k
   * @returns {number}
   */
  optimizedNDet(n, m, x, y, k) {
    const mk = x.join("") + y.join("");
    if ( !k[mk] ) {
      if ( n > 2 ) {
        let d = 0;
        let plus = 1;
        for ( let i = 0; i < n; i += 1 ) {
          const ix = x[i];
          const iy = y[0];
          const xf = x.filter(e => e !== ix);
          const yf = y.filter(e => e !== iy);
          const der = this.optimizedNDet(n - 1, m, xf, yf, k);
          d += m.getIndex(iy, ix) * plus * der;
          plus *= -1;
        }
        k[mk] = d;

      } else {
        const a = m.getIndex(y[0], x[0]);
        const b = m.getIndex(y[0], x[1]);
        const c = m.getIndex(y[1], x[0]);
        const d = m.getIndex(y[1], x[1]);
        k[mk] = (a * d) - (b * c);
      }
    }
    return k[mk];
  }

  // ----- NOTE: Debugging ----- //

  print() {
    // console.table prints arrays of arrays nicely.
    const out = new Array(this.nrow);
    for ( let r = 0; r < this.nrow; r += 1 ) out[r] = new Array(this.ncol);
    for ( let r = 0; r < this.nrow; r += 1 ) {
      const arrR = out[r];
      for ( let c = 0; c < this.ncol; c += 1 ) arrR[c] = this.getIndex(r, c);
    }
    console.table(out);
  }

  toString() { return `Matrix<${this.nrow},${this.ncol}>`}
}

// For backwards compatibility.
MatrixFlat.fromFlatArray = MatrixFlat.fromFlatArrayByColumns;
MatrixFlat.prototype.copyTo = MatrixFlat.prototype.clone;

GEOMETRY_CONFIG.MatrixFlat ??= MatrixFlat;


// Example typed class
/*
class MatrixTyped extends MatrixFlat {
  static arrayClass = Float32Array;

  static arrayIsTyped = true;

}
*/

/* Tests
Matrix = CONFIG.GeometryLib.Matrix
MatrixFlat = CONFIG.GeometryLib.MatrixFlat
QBenchmarkLoop = CONFIG.GeometryLib.bench.QBenchmarkLoop


MatrixFlat.zeroes(4, 10).arr.every(elem => elem === 0);
resIdentity = [
  1, 0, 0, 0,
  0, 1, 0, 0,
  0, 0, 1, 0,
  0, 0, 0, 1
];
MatrixFlat.identity(4, 4).arr.every((elem, idx) => elem === resIdentity[idx]);

arr = Array.fromRange(16);
resSum = arr.map(elem => elem + elem)
m = new MatrixFlat(arr, 4, 4);
m.add(m).arr.every((elem, idx) => elem === resSum[idx])

resDiff = arr.map(elem => elem - elem)
m = new MatrixFlat(arr, 4, 4);
m.subtract(m).arr.every((elem, idx) => elem === resDiff[idx])

resMult = [
56, 62, 68, 74,
152, 174, 196, 218,
248, 286, 324, 362,
344, 398, 452, 506 ];
m = new MatrixFlat(arr, 4, 4);
m.multiply(m).arr.every((elem, idx) => elem === resMult[idx])
m.multiply4x4(m).arr.every((elem, idx) => elem === resMult[idx])
m.invert() // Should fail not invertible

invertibleArr = [
  1, 2, -1,
  2, 1, 2,
  -1, 2, 1
]
resInv = [
  3/16, 1/4, -5/16,
  1/4, 0, 1/4,
  -5/16, 1/4, 3/16
]

m = new MatrixFlat(invertibleArr, 3, 3);
m.invert().arr.every((elem, idx) => elem === resInv[idx])


m = Matrix.fromFlatArray(arr, 4, 4)
m2 = new MatrixFlat(arr, 4, 4)
m3 = MatrixTyped.fromRowMajorArray(arr, 4, 4)



N = 10000
await QBenchmarkLoop(N, m, "multiply", m)
await QBenchmarkLoop(N, m2, "multiply", m2)
await QBenchmarkLoop(N, m3, "multiply", m3)

await QBenchmarkLoop(N, m, "multiply4x4", m)
await QBenchmarkLoop(N, m2, "multiply4x4", m2)
await QBenchmarkLoop(N, m3, "multiply4x4", m3)

await QBenchmarkLoop(N, m, "add", m)
await QBenchmarkLoop(N, m2, "add", m2)
await QBenchmarkLoop(N, m3, "add", m3)


N = 10000
m = Matrix.fromFlatArray(invertibleArr, 3, 3)
m2 = new MatrixFlat(invertibleArr, 3, 3)
m3 = MatrixTyped.fromRowMajorArray(invertibleArr, 3, 3)
await QBenchmarkLoop(N, m, "invert")
await QBenchmarkLoop(N, m2, "invert")
await QBenchmarkLoop(N, m3, "invert")


await foundry.utils.benchmark(m.invert.bind(m), N, undefined)
await foundry.utils.benchmark(m2.invert.bind(m2), N, undefined)
await foundry.utils.benchmark(m3.invert.bind(m3), N, undefined)

*/