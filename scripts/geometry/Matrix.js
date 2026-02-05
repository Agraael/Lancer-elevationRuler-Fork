/* globals
CONFIG,
PIXI
*/
"use strict";

import { GEOMETRY_CONFIG } from "./const.js";
import "./3d/Point3d.js";

// Basic matrix operations
// May eventually replace with math.js (when installed, call "math" to get functions)
// Row-major format


export class Matrix {
  constructor(arr) {
    this.arr = arr;
  }

  get nrow() { return this.arr.length; }

  get ncol() { return this.arr[0].length; }

  /**
   * First dimension length of the array
   * @type {number}
   */
  get dim1() {
    return this.arr.length;
  }

  /**
   * Second dimension length of the array
   * @type {number}
   */
  get dim2() {
    return this.arr[0].length;
  }

  /**
   * Get an element of the matrix.
   * @param {number} row
   * @param {number} col
   * @returns {number}
   */
  getIndex(row, col) { return this.arr[row][col]; }

  /**
   * Set an element of the matrix
   * @param {number} row
   * @param {number} col
   * @param {number} value
   */
  setIndex(row, col, value) { this.arr[row][col] = value; }

  /**
   * Iterate over each element of the matrix.
   * Iterate by row, then column.
   */
  [Symbol.iterator]() {
    let r = 0;
    let c = 0;
    const { nrow, ncol } = this;
    const ln = nrow * ncol;
    return {
      next() {
        if ( (r * c) < ln ) {
          const value = this.arr[r++][c];
          if ( r >= nrow ) {
            r = 0;
            c += 1;
          }
          return { value, done: false };
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
      const rArr = this.arr[r];
      for ( let c = 0; c < ncol; c += 1 ) callback(rArr[c], r, c, this);
    }
  }

  /**
   * Set each element of the matrix in turn to the value returned by the callback.
   * For convenience; can accomplish the same thing using forEach directly.
   * @param {function} callback       See forEach.
   */
  setElements(callback) {
    const setter = (elem, r, c) => this[r][c] = callback(elem, r, c, this);
    this.forEach(setter);
  }

  /**
   * Confirm that length of each sub-array is equal.
   * @param {Array[]} arr   Array of arrays.
   * @returns {boolean}
   */
  static verify(arr) {
    if ( !(arr instanceof Array) || arr.length === 0 ) return false;

    const innerLength = arr[0].length;
    return arr.every(elem => elem instanceof Array && elem.length === innerLength);
  }

  /**
   * Create matrix of given dimensions from a flat array.
   * Flat array arranged reading across. So (row0,col0), (row0,col1), ... (row1,col0), (row1,col1)
   * @param {number[]} arr    Flat array of numbers.
   * @param {number} rows
   * @param {number} cols
   * @return {Matrix}
   */
  static fromFlatArray(arr, rows, cols) {
    const ln = arr.length;
    if ( rows * cols !== ln ) {
      console.error("Rows or columns incorrectly specified.");
      return undefined;
    }

    const out = new Array(rows);
    for ( let r = 0; r < rows; r += 1 ) {
      const arrR = new Array(cols);
      out[r] = arrR;
      const i = r * cols;
      for ( let c = 0; c < cols; c += 1 ) {
        arrR[c] = arr[i + c];
      }
    }
    return new this(out);
  }

  toRowMajorArray() { return this.arr.flat(); }

  toColMajorArray() {
    const nRow = this.dim1;
    const nCol = this.dim2;
    const flatArr = Array(nRow * nCol);
    for ( let c = 0; c < nCol; c += 1 ) {
      const cIdx = c * nRow;
      for ( let r = 0; r < nRow; r += 1 ) {
        flatArr[cIdx + r] = this.arr[r][c];
      }
    }
    return flatArr;
  }

  toGLSLArray() {
    // See https://austinmorlan.com/posts/opengl_matrices/
    // Technically: this.transpose().toColMajorArray().
    // But that is the same as this.toRowMajorArray().
    return this.toRowMajorArray();
  }

  /**
   * Create an empty matrix.
   * @param {number} rows
   * @param {number} cols
   * @returns {Matrix}
   */
  static empty(rows, cols) {
    const out = new Array(rows);
    for ( let r = 0; r < rows; r += 1 ) out[r] = new Array(cols);
    return new this(out);
  }

  /**
   * Create a matrix filled with zeroes.
   * @param {number} rows
   * @param {number} cols
   * @returns {Matrix}
   */
  static zeroes(rows, cols) {
    const out = new Array(rows);
    for ( let r = 0; r < rows; r += 1 ) out[r] = (new Array(cols)).fill(0);
    return new this(out);
  }

  /**
   * Fill this matrix with zeroes.
   * @returns {this}
   */
  zero() { this.setElements(() => 0); return this; }

  /**
   * Create an identity matrix
   * @param {number} rows
   * @param {number} cols
   * @returns {Matrix}
   */
  static identity(rows, cols) {
    const mat = Matrix.zeroes(rows, cols);
    const iMax = Math.min(rows, cols);
    for ( let i = 0; i < iMax; i += 1 ) {
      mat.arr[i][i] = 1;
    }
    return mat;
  }

  /**
   * Reset this matrix to an identity matrix
   * @returns {this}
   */
  identity() { this.setElements((elem, r, c) => r === c ? 1 : 0); return this; }

  /**
   * Create a matrix filled with random numbers between 0 and 1.
   * @param {number} rows
   * @param {number} cols
   * @returns {Matrix}
   */
  static random(rows, cols) {
    const mat = this.empty(rows, cols);
    for ( let r = 0; r < rows; r += 1 ) {
      for ( let c = 0; c < cols; c += 1 ) mat.arr[r][c] = Math.random();
    }
    return mat;
  }

  static fromPoint3d(p, { homogenous = true } = {}) {
    const arr = homogenous ? [p.x, p.y, p.z, 1] : [p.x, p.y, p.z];
    return new Matrix([arr]);
  }

  static fromPoint2d(p, { homogenous = true } = {}) {
    const arr = homogenous ? [p.x, p.y, 1] : [p.x, p.y];
    return new Matrix([arr]);
  }

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
    return new Matrix([
      [DIAG0,   0,    0,      0],
      [0,       f,    0,      0],
      [0,       0,    DIAG2,  -1],
      [0,       0,    A,      0]
    ]);
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
    return new Matrix([
      [(2 * zNear) / (right - left),  0,                            A,  0],
      [0,                             (2 * zNear) / (top - bottom), B,  0],
      [0,                             0,                            C,  D],
      [0,                             0,                            -1, 0]
    ]);
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

    const M = new Matrix([
      [xAxis.x, xAxis.y, xAxis.z, 0],
      [yAxis.x, yAxis.y, yAxis.z, 0],
      [zAxis.x, zAxis.y, zAxis.z, 0],
      [cameraPosition.x, cameraPosition.y, cameraPosition.z, 1]
    ]);

    const Minv = new Matrix([
      [xAxis.x, yAxis.x, zAxis.x, 0],
      [xAxis.y, yAxis.y, zAxis.y, 0],
      [xAxis.z, yAxis.z, zAxis.z, 0],
      [-(xAxis.dot(cameraPosition)), -(yAxis.dot(cameraPosition)), -(zAxis.dot(cameraPosition)), 1]
    ]);

    return { M, Minv };
  }

  /**
   * Rotation matrix for a given angle, rotating around X axis.
   * @param {number} angle          Radians
   * @param {boolean} [d3 = true]    If d3, use a 4-d matrix. Otherwise, 3-d matrix.
   * @returns {Matrix}
   */
  static rotationX(angle, d3 = true) {
    if ( !angle ) return d3 ? Matrix.identity(4, 4) : Matrix.identity(3, 3);

    let c = Math.cos(angle);
    let s = Math.sin(angle);

    // Math.cos(Math.PI / 2) ~ 0 but not quite.
    // Same for Math.sin(Math.PI).
    if ( c.almostEqual(0) ) c = 0;
    if ( s.almostEqual(0) ) s = 0;

    const rotX = d3
    ? [
      [1, 0, 0, 0],
      [0, c, s, 0],
      [0, -s, c, 0],
      [0, 0, 0, 1]
    ]
      : [
      [1, 0, 0],
      [0, c, s],
      [0, -s, c]
    ] ;

    return new Matrix(rotX);
  }

  /**
   * Rotation matrix for a given angle, rotating around Y axis.
   * @param {number} angle          Radians
   * @param {boolean} [d3 = true]    If d3, use a 4-d matrix. Otherwise, 3-d matrix.
   * @returns {Matrix}
   */
  static rotationY(angle, d3 = true) {
    if ( !angle ) return d3 ? Matrix.identity(4, 4) : Matrix.identity(3, 3);

    let c = Math.cos(angle);
    let s = Math.sin(angle);

    // Math.cos(Math.PI / 2) ~ 0 but not quite.
    // Same for Math.sin(Math.PI).
    if ( c.almostEqual(0) ) c = 0;
    if ( s.almostEqual(0) ) s = 0;

    const rotY = d3
    ? [
      [c, 0, s, 0],
      [0, 1, 0, 0],
      [-s, 0, c, 0],
      [0, 0, 0, 1]
    ]
      : [
      [c, 0, s],
      [0, 1, 0],
      [-s, 0, c]
    ];

    return new Matrix(rotY);
  }

  /**
   * Rotation matrix for a given angle, rotating around Z axis.
   * @param {number} angle
   * @param {boolean} [d3 = true]    If d3, use a 4-d matrix. Otherwise, 3-d matrix.
   * @returns {Matrix}
   */
  static rotationZ(angle, d3 = true) {
    if ( !angle ) return d3 ? Matrix.identity(4, 4) : Matrix.identity(3, 3);

    let c = Math.cos(angle);
    let s = Math.sin(angle);

    // Math.cos(Math.PI / 2) ~ 0 but not quite.
    // Same for Math.sin(Math.PI).
    if ( c.almostEqual(0) ) c = 0;
    if ( s.almostEqual(0) ) s = 0;

    const rotZ = d3
    ? [
      [c, s, 0, 0],
      [-s, c, 0, 0],
      [0, 0, 1, 0],
      [0, 0, 0, 1]
    ]
      : [
      [c, s, 0],
      [-s, c, 0],
      [0, 0, 1]
    ];

    return new Matrix(rotZ);
  }

  /**
   * Combine rotation matrixes for x, y, and z.
   * @param {number} angleX   Radians
   * @param {number} angleY   Radians
   * @param {number} angleZ   Radians
   * @param {boolean} [d3 = true]    If d3, use a 4-d matrix. Otherwise, 3-d matrix.
   * @returns {Matrix}
   */
  static rotationXYZ(angleX, angleY, angleZ, d3 = true) {
    let rot = angleX ? Matrix.rotationX(angleX, d3) : angleY
      ? Matrix.rotationY(angleY, d3) : angleZ
        ? Matrix.rotationZ(angleZ, d3) : d3
        ? Matrix.identity(4, 4) : Matrix.identity(3, 3);

    const multFn = d3 ? "multiply4x4" : "multiply3x3";

    if ( angleX && angleY ) {
      const rotY = Matrix.rotationY(angleY, d3);
      rot = rot[multFn](rotY);
    }

    if ( (angleX || angleY) && angleZ ) {
      const rotZ = Matrix.rotationZ(angleZ, d3);
      rot = rot[multFn](rotZ);
    }

    return rot;
  }

  static translation(x = 0, y = 0, z) {
    const t = typeof z === "undefined"
    ? [
      [1, 0, 0],
      [0, 1, 0],
      [x, y, 1]]
      : [
        [1, 0, 0, 0],
        [0, 1, 0, 0],
        [0, 0, 1, 0],
        [x, y, z, 1]];

    return new Matrix(t);
  }

  static scale(x = 1, y = 1, z) {
    const t = typeof z === "undefined"
    ? [
      [x, 0, 0],
      [0, y, 0],
      [0, 0, 1]]
      : [
        [x, 0, 0, 0],
        [0, y, 0, 0],
        [0, 0, z, 0],
        [0, 0, 0, 1]];

    return new Matrix(t);
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

    return new Matrix([
      [c + (axis.x * axis.x * cNeg), xy - zs, xz + ys, 0],

      [xy + zs, c + (axis.y * axis.y * cNeg), yz - xs, 0],

      [xz - ys, yz + xs, c + (axis.z * axis.z * cNeg), 0],

      [0, 0, 0, 1]
    ]);
  }

  /**
   * Copy this matrix to a new matrix object
   * @returns {Matrix}
   */
  clone() {
    // See https://jsbench.me/gflbviyw69/1
    const { dim1, arr } = this;
    const newMat = Array(dim1);
    for ( let i = 0; i < dim1; i += 1 ) {
      newMat[i] = arr[i].slice();
    }
    return new Matrix(newMat);
  }

  /**
   * Test if this matrix is exactly equal to another
   * @param {Matrix} other
   * @returns {boolean}
   */
  equal(other) {
    const d1 = this.dim1;
    const d2 = this.dim2;
    if ( d1 !== other.dim1 || d2 !== other.dim2 ) return false;

    for ( let i = 0; i < d1; i += 1 ) {
      for ( let j = 0; j < d2; j += 1 ) {
        if ( this.arr[i][j] !== other.arr[i][j] ) return false;
      }
    }

    return true;
  }

  /**
   * Test if this matrix is almost equal to another
   * @param {Matrix} other
   * @param {number} epsilon
   * @returns {boolean}
   */
  almostEqual(other, epsilon = 1e-8) {
    const d1 = this.dim1;
    const d2 = this.dim2;
    if ( d1 !== other.dim1 || d2 !== other.dim2 ) return false;

    for ( let i = 0; i < d1; i += 1 ) {
      for ( let j = 0; j < d2; j += 1 ) {
        if ( !this.arr[i][j].almostEqual(other.arr[i][j], epsilon) ) return false;
      }
    }

    return true;
  }

  /**
   * "Clean" a matrix by converting near zero and near 1 entries to integers.
   * Often due to floating point approximations
   * Destructive operation in that it affects values in this matrix.
   */
  clean(epsilon = 1e-08) {
    const d1 = this.dim1;
    const d2 = this.dim2;
    for ( let i = 0; i < d1; i += 1 ) {
      for ( let j = 0; j < d2; j += 1 ) {
        if ( this.arr[i][j].almostEqual(0, epsilon) ) this.arr[i][j] = 0;
        else if ( this.arr[i][j].almostEqual(1, epsilon) ) this.arr[i][j] = 1;
      }
    }
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
    const row = this.arr[0];

    outPoint.x = row[xIndex];
    outPoint.y = row[yIndex];

    if ( homogenous ) {
      const h = row[this.dim2 - 1];
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
    const row = this.arr[0];

    outPoint.x = row[xIndex];
    outPoint.y = row[yIndex];
    outPoint.z = row[zIndex];

    if ( homogenous ) {
      const h = row[this.dim2 - 1];
      outPoint.x /= h;
      outPoint.y /= h;
      outPoint.z /= h;
    }

    return outPoint;
  }

  /**
   * Copy the data from this matrix to another
   * @param {Matrix} outMatrix    Other matrix to use (newly created by default)
   * @returns Matrix
   */
  copyTo(outMatrix = Matrix.empty(this.dim1, this.dim2)) {
    const dim1 = this.dim1;
    const dim2 = this.dim2;
    for ( let i = 0; i < dim1; i += 1 ) {
      for ( let j = 0; j < dim2; j += 1 ) {
        outMatrix.arr[i][j] = this.arr[i][j];
      }
    }
    return outMatrix;
  }

  /**
   * See https://stackoverflow.com/questions/4492678/swap-rows-with-columns-transposition-of-a-matrix-in-javascript
   * @param {Matrix} outMatrix  Optional matrix to use for the returned data.
   * @returns {Matrix}
   */
  transpose(outMatrix = Matrix.empty(this.dim1, this.dim2)) {
    const arr = this.arr;
    outMatrix.arr = Object.keys(arr[0]).map(function(c) {
      return arr.map(function(r) { return r[c]; });
    });
    return outMatrix;
  }

  add(other, outMatrix = Matrix.empty(other.dim1, other.dim2)) {
    const d1 = this.dim1;
    const d2 = this.dim2;

    if ( d1 !== other.dim1 || d2 !== other.dim2 ) {
      console.error("Matrices cannot be added.");
      return undefined;
    }

    for ( let i = 0; i < d1; i += 1 ) {
      for ( let j = 0; j < d2; j += 1 ) {
        outMatrix.arr[i][j] = this.arr[i][j] + other.arr[i][j];
      }
    }
    return outMatrix;
  }

  subtract(other, outMatrix = Matrix.empty(other.dim1, other.dim2)) {
    const d1 = this.dim1;
    const d2 = this.dim2;

    if ( d1 !== other.dim1 || d2 !== other.dim2 ) {
      console.error("Matrices cannot be added.");
      return undefined;
    }

    for ( let i = 0; i < d1; i += 1 ) {
      for ( let j = 0; j < d2; j += 1 ) {
        outMatrix.arr[i][j] = this.arr[i][j] - other.arr[i][j];
      }
    }
    return outMatrix;
  }

  /**
   * Multiply this and another matrix. this • other.
   * @param {Matrix} other
   * @returns {Matrix}
   */
  multiply(other) {
    // A is this matrix; B is other matrix
    const rowsA = this.dim1;
    const colsA = this.dim2;
    const rowsB = other.dim1;
    const colsB = other.dim2;

    if ( colsA !== rowsB ) {
      console.error("Matrices cannot be multiplied.");
      return undefined;
    }

    const multiplication = Matrix.zeroes(rowsA, colsB);
    for ( let x = 0; x < rowsA; x += 1 ) {
      for ( let y = 0; y < colsB; y += 1 ) {
        for ( let z = 0; z < colsA; z += 1 ) {
          multiplication.arr[x][y] = multiplication.arr[x][y] + (this.arr[x][z] * other.arr[z][y]);
        }
      }
    }
    return multiplication;
  }

  /**
   * Faster 1x3 multiplication
   * @param {Matrix} other    A 1x3 matrix, like Matrix.prototype.fromPoint2d
   * @returns Matrix
   */
  multiply1x3(other, outMatrix = Matrix.empty(1, 3)) {
    const a0 = other.arr[0];
    const a1 = other.arr[1];
    const a2 = other.arr[2];

    const a00 = a0[0];
    const a01 = a0[1];
    const a02 = a0[2];
    const a10 = a1[0];
    const a11 = a1[1];
    const a12 = a1[2];
    const a20 = a2[0];
    const a21 = a2[1];
    const a22 = a2[2];

    const b0 = this.arr[0];
    const b00 = b0[0];
    const b01 = b0[1];
    const b02 = b0[2];

    outMatrix.arr[0][0] = a00 * b00 + a10 * b01 + a20 * b02;
    outMatrix.arr[0][1] = a01 * b00 + a11 * b01 + a21 * b02;
    outMatrix.arr[0][2] = a02 * b00 + a12 * b01 + a22 * b02;

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
    const a0 = this.arr[0];
    const a1 = this.arr[1];
    const a2 = this.arr[2];

    const a00 = a0[0];
    const a01 = a0[1];
    const a02 = a0[2];
    const a10 = a1[0];
    const a11 = a1[1];
    const a12 = a1[2];
    const a20 = a2[0];
    const a21 = a2[1];
    const a22 = a2[2];

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
   * Faster 1x4 multiplication
   * Foundry bench puts this at ~ 75% of multiply.
   * @param {Matrix} other    A 1x4 matrix, like Matrix.prototype.fromPoint3d
   * @returns Matrix
   */
  multiply1x4(other, outMatrix = Matrix.empty(1, 4)) {
    const a0 = other.arr[0];
    const a1 = other.arr[1];
    const a2 = other.arr[2];
    const a3 = other.arr[3];

    const a00 = a0[0];
    const a01 = a0[1];
    const a02 = a0[2];
    const a03 = a0[3];
    const a10 = a1[0];
    const a11 = a1[1];
    const a12 = a1[2];
    const a13 = a1[3];
    const a20 = a2[0];
    const a21 = a2[1];
    const a22 = a2[2];
    const a23 = a2[3];
    const a30 = a3[0];
    const a31 = a3[1];
    const a32 = a3[2];
    const a33 = a3[3];

    const b0 = this.arr[0];
    const b00 = b0[0];
    const b01 = b0[1];
    const b02 = b0[2];
    const b03 = b0[3];

    outMatrix.arr[0][0] = a00 * b00 + a10 * b01 + a20 * b02 + a30 * b03;
    outMatrix.arr[0][1] = a01 * b00 + a11 * b01 + a21 * b02 + a31 * b03;
    outMatrix.arr[0][2] = a02 * b00 + a12 * b01 + a22 * b02 + a32 * b03;
    outMatrix.arr[0][3] = a03 * b00 + a13 * b01 + a23 * b02 + a33 * b03;

    return outMatrix;
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
    const a0 = this.arr[0];
    const a1 = this.arr[1];
    const a2 = this.arr[2];
    const a3 = this.arr[3];

    const a00 = a0[0];
    const a01 = a0[1];
    const a02 = a0[2];
    const a03 = a0[3];
    const a10 = a1[0];
    const a11 = a1[1];
    const a12 = a1[2];
    const a13 = a1[3];
    const a20 = a2[0];
    const a21 = a2[1];
    const a22 = a2[2];
    const a23 = a2[3];
    const a30 = a3[0];
    const a31 = a3[1];
    const a32 = a3[2];
    const a33 = a3[3];

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
  multiply2x2(other, outMatrix = Matrix.empty(2, 2)) {
    const a0 = this.arr[0];
    const a1 = this.arr[1];

    const a00 = a0[0];
    const a01 = a0[1];
    const a10 = a1[0];
    const a11 = a1[1];

    const b0 = other.arr[0];
    const b1 = other.arr[1];

    const b00 = b0[0];
    const b01 = b0[1];
    const b10 = b1[0];
    const b11 = b1[1];

    const m1 = (a00 + a11) * (b00 + b11);
    const m2 = (a10 + a11) * b00;
    const m3 = a00 * (b01 - b11);
    const m4 = a11 * (b10 - b00);
    const m5 = (a00 + a01) * b11;
    const m6 = (a10 - a00) * (b00 + b01);
    const m7 = (a01 - a11) * (b10 + b11);

    // Row 0
    outMatrix.arr[0][0] = m1 + m4 - m5 + m7;
    outMatrix.arr[0][1] = m3 + m5;

    // Row 1
    outMatrix.arr[1][0] = m2 + m4;
    outMatrix.arr[1][1] = m1 - m2 + m3 + m6;

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
  multiply3x3(other, outMatrix = Matrix.empty(3, 3)) {
    const a0 = this.arr[0];
    const a1 = this.arr[1];
    const a2 = this.arr[2];

    const a00 = a0[0];
    const a01 = a0[1];
    const a02 = a0[2];
    const a10 = a1[0];
    const a11 = a1[1];
    const a12 = a1[2];
    const a20 = a2[0];
    const a21 = a2[1];
    const a22 = a2[2];

    const b0 = other.arr[0];
    const b1 = other.arr[1];
    const b2 = other.arr[2];

    const b00 = b0[0];
    const b01 = b0[1];
    const b02 = b0[2];
    const b10 = b1[0];
    const b11 = b1[1];
    const b12 = b1[2];
    const b20 = b2[0];
    const b21 = b2[1];
    const b22 = b2[2];

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
    outMatrix.arr[0][0] = m6 + m14 + m19;
    outMatrix.arr[0][1] = m1 + m4 + m5 + m6 + m12 + m14 + m15;
    outMatrix.arr[0][2] = m6 + m7 + m9 + m10 + m14 + m16 + m18;

    // Row 1
    outMatrix.arr[1][0] = m2 + m3 + m4 + m6 + m14 + m16 + m17;
    outMatrix.arr[1][1] = m2 + m4 + m5 + m6 + m20;
    outMatrix.arr[1][2] = m14 + m16 + m17 + m18 + m21;

    // Row 2
    outMatrix.arr[2][0] = m6 + m7 + m8 + m11 + m12 + m13 + m14;
    outMatrix.arr[2][1] = m12 + m13 + m14 + m15 + m22;
    outMatrix.arr[2][2] = m6 + m7 + m8 + m9 + m23;

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
  multiply4x4(other, outMatrix = Matrix.empty(4, 4)) {
    const a0 = this.arr[0];
    const a1 = this.arr[1];
    const a2 = this.arr[2];
    const a3 = this.arr[3];

    const a00 = a0[0];
    const a01 = a0[1];
    const a02 = a0[2];
    const a03 = a0[3];
    const a10 = a1[0];
    const a11 = a1[1];
    const a12 = a1[2];
    const a13 = a1[3];
    const a20 = a2[0];
    const a21 = a2[1];
    const a22 = a2[2];
    const a23 = a2[3];
    const a30 = a3[0];
    const a31 = a3[1];
    const a32 = a3[2];
    const a33 = a3[3];

    const b0 = other.arr[0];
    const b1 = other.arr[1];
    const b2 = other.arr[2];
    const b3 = other.arr[3];

    const b00 = b0[0];
    const b01 = b0[1];
    const b02 = b0[2];
    const b03 = b0[3];
    const b10 = b1[0];
    const b11 = b1[1];
    const b12 = b1[2];
    const b13 = b1[3];
    const b20 = b2[0];
    const b21 = b2[1];
    const b22 = b2[2];
    const b23 = b2[3];
    const b30 = b3[0];
    const b31 = b3[1];
    const b32 = b3[2];
    const b33 = b3[3];

    // Row 0
    outMatrix.arr[0][0] = (a00 * b00) + (a01 * b10) + (a02 * b20) + (a03 * b30);
    outMatrix.arr[0][1] = (a00 * b01) + (a01 * b11) + (a02 * b21) + (a03 * b31);
    outMatrix.arr[0][2] = (a00 * b02) + (a01 * b12) + (a02 * b22) + (a03 * b32);
    outMatrix.arr[0][3] = (a00 * b03) + (a01 * b13) + (a02 * b23) + (a03 * b33);

    // Row 1
    outMatrix.arr[1][0] = (a10 * b00) + (a11 * b10) + (a12 * b20) + (a13 * b30);
    outMatrix.arr[1][1] = (a10 * b01) + (a11 * b11) + (a12 * b21) + (a13 * b31);
    outMatrix.arr[1][2] = (a10 * b02) + (a11 * b12) + (a12 * b22) + (a13 * b32);
    outMatrix.arr[1][3] = (a10 * b03) + (a11 * b13) + (a12 * b23) + (a13 * b33);

    // Row 2
    outMatrix.arr[2][0] = (a20 * b00) + (a21 * b10) + (a22 * b20) + (a23 * b30);
    outMatrix.arr[2][1] = (a20 * b01) + (a21 * b11) + (a22 * b21) + (a23 * b31);
    outMatrix.arr[2][2] = (a20 * b02) + (a21 * b12) + (a22 * b22) + (a23 * b32);
    outMatrix.arr[2][3] = (a20 * b03) + (a21 * b13) + (a22 * b23) + (a23 * b33);

    // Row 3
    outMatrix.arr[3][0] = (a30 * b00) + (a31 * b10) + (a32 * b20) + (a33 * b30);
    outMatrix.arr[3][1] = (a30 * b01) + (a31 * b11) + (a32 * b21) + (a33 * b31);
    outMatrix.arr[3][2] = (a30 * b02) + (a31 * b12) + (a32 * b22) + (a33 * b32);
    outMatrix.arr[3][3] = (a30 * b03) + (a31 * b13) + (a32 * b23) + (a33 * b33);

    return outMatrix;
  }

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
  invert(outMatrix = Matrix.empty(this.dim1, this.dim2)) {
    if ( this.dim1 < 2 || this.dim1 !== this.dim2 ) {
      console.error("Cannot use invert on a non-square matrix.");
      return undefined;
    }

    const n = this.dim1;
    const x = Array.fromRange(n);
    const y = Array.fromRange(n);
    const k = {};
    let det = this.optimizedNDet(n, this.arr, x, y, k);
    if ( !det ) throw new Error("Matrix is not invertible");

    det = 1 / det;

    // Fix for 2 x 2 matrices
    if ( n === 2 ) {
      outMatrix.arr[0][0] = det * this.arr[1][1];
      outMatrix.arr[0][1] = det * -this.arr[0][1];
      outMatrix.arr[1][0] = det * -this.arr[1][0];
      outMatrix.arr[1][1] = det * this.arr[0][0];
    } else {

      for ( let iy = 0; iy < n; iy += 1 ) {
        for ( let ix = 0; ix < n; ix += 1 ) {
          const plus = (ix + iy) % 2 === 0 ? 1 : -1;
          const xf = x.filter(e => e !== ix);
          const yf = y.filter(e => e !== iy);
          const der = this.optimizedNDet(n - 1, this.arr, yf, xf, k);
          outMatrix.arr[iy][ix] = det * plus * der;
        }
      }
    }

    return outMatrix;
  }

  /**
   * Return the determinant of this matrix;
   */
  determinant() {
    if ( this.dim1 < 2 || this.dim1 !== this.dim2 ) {
      console.error("Cannot calculate determinant of non-square matrix.");
      return undefined;
    }
    const n = this.dim1;
    const x = Array.fromRange(n);
    const y = Array.fromRange(n);
    const k = {};
    return this.optimizedNDet(n, this.arr, x, y, k);
  }

  /**
   * Calculate the determinant, recursively.
   * @param {number} n        Matrix rows or columns
   * @param {number[][]} m    Matrix
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
          d += m[iy][ix] * plus * der;
          plus *= -1;
        }
        k[mk] = d;

      } else {
        const a = m[y[0]][x[0]];
        const b = m[y[0]][x[1]];
        const c = m[y[1]][x[0]];
        const d = m[y[1]][x[1]];
        k[mk] = (a * d) - (b * c);
      }
    }
    return k[mk];
  }

  /**
   * Print this matrix to the console.
   */
  print() { console.table(this.arr); }
}

GEOMETRY_CONFIG.Matrix ??= Matrix;
