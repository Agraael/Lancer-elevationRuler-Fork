/* globals
canvas,
CONFIG,
CONST,
Ray,
*/
"use strict";

import { Point3d } from "./Point3d.js";


/**
 * Using Point3d, extend the Ray class to 3 dimensions.
 * Not all methods are extended to 3d, just desirable ones for Elevation Ruler.
 * @param {Point3d|Point} A
 * @param {Point3d|Point} B
 */
export class Ray3d extends Ray {
  constructor(A, B) {
    if ( !(A instanceof Point3d) ) A = new Point3d(A.x, A.y, A.z);
    if ( !(B instanceof Point3d) ) B = new Point3d(B.x, B.y, B.z);

    super(A, B);

    /**
     * The elevated distance of the ray, z1 - z0
     * @type {number}
     */
    this.dz = B.z - A.z;
  }

  /**
   * Convert a 2d ray to 3d, copying over values.
   * @param {Ray} ray2d
   * @param {object} [options]
   * @param {number} [Az]   Elevation of the A point
   * @param {number} [Bz]   Elevation of the B point
   * @returns {Ray3d}
   */
  static from2d(ray2d, { Az = 0, Bz = 0 } = {}) {
    const r = new this({ x: ray2d.A.x, y: ray2d.A.y, z: Az }, { x: ray2d.B.x, y: ray2d.B.y, z: Bz });
    r._angle = ray2d._angle;

    // TODO: Could copy over distance2 and add in the z distance2, but would need to cache this in Rays.
    return r;
  }

  /**
   * The distance (length) of the Ray in pixels.
   * Computed lazily and cached
   * @override
   * @type {number}
   */
  get distance() {
    return this._distance ?? (this._distance = Math.hypot(this.dx, this.dy, this.dz));
  }

  set distance(value) {
    this._distance = Number(value);
  }

  /**
   * Project the Ray by some proportion of its initial path.
   * @override
   * @param {number} t    Distance along the Ray
   * @returns {Point3d}   Coordinates of the projected distance
   */
  project(t) {
    const pt = super.project(t);
    return new Point3d(pt.x, pt.y, this.A.z + (t * this.dz));
  }

  /*
  * Project the Ray onto the 2d XY canvas surface at the elevation of B.
   * Preserves distance but not A or B location.
   * For gridless, will preserve B location.
   * Done in a manner to allow diagonal distance to be measured.
   *
   * If the movement on the plane is represented by moving from point A to point B,
   *   and you also move 'height' distance orthogonal to the plane, the distance is the
   *   hypotenuse of the triangle formed by A, B, and C, where C is orthogonal to B.
   *   Project by rotating the vertical triangle 90º, then calculate the new point C.
   * For gridded maps, project A such that A <-> projected_A is straight on the grid.
   * @returns {Ray} The new 2d ray
   */
  projectOntoCanvas() {
    if ( this.dz.almostEqual(0) ) return new Ray(this.A.to2d({x: "x", y: "y"}), this.B.to2d({x: "x", y: "y"}));
    if ( this.dx.almostEqual(0) ) return new Ray(this.A.to2d({x: "z", y: "y"}), this.B.to2d({x: "z", y: "y"}));
    if ( this.dy.almostEqual(0) ) return new Ray(this.A.to2d({x: "x", y: "z"}), this.B.to2d({x: "x", y: "z"}));

    switch ( canvas.grid.type ) {
      case CONST.GRID_TYPES.GRIDLESS: return this._projectGridless();
      case CONST.GRID_TYPES.SQUARE: return this._projectSquareGrid();
      case CONST.GRID_TYPES.HEXODDR:
      case CONST.GRID_TYPES.HEXEVENR: return this._projectEast();
      case CONST.GRID_TYPES.HEXODDQ:
      case CONST.GRID_TYPES.HEXEVENQ: return this._projectSouth();
    }

    // Catch-all
    return this._projectGridless();
  }

  /**
   * Calculate a new point by projecting the elevated point back onto the 2-D surface
   * If the movement on the plane is represented by moving from point A to point B,
   *   and you also move 'height' distance orthogonal to the plane, the distance is the
   *   hypotenuse of the triangle formed by A, B, and C, where C is orthogonal to B.
   *   Project by rotating the vertical triangle 90º, then calculate the new point C.
   *
   * Cx = { height * (By - Ay) / dist(A to B) } + Bx
   * Cy = { height * (Bx - Ax) / dist(A to B) } + By
   */
  _projectGridless() {
    const height = Math.abs(this.dz);
    const distance2d = Math.hypot(this.dx, this.dy);
    const ratio = height / distance2d;

    const A = this.A.to2d();
    const B = this.B.to2d();

    A.x += ratio * this.dy;
    A.y -= ratio * this.dx;

   // Debug: console.log(`Projecting Gridless: A: (${this.A.x},${this.A.y},${this.A.z})->(${A.x}, ${A.y}); B: (${this.B.x}, ${this.B.y}, ${this.B.z})->(${B.x}, ${B.y})`);
    return new Ray(A, B);
  }

  /**
   * Project A and B in a square grid.
   * Move A vertically or horizontally by the total height different
   * If the points are already on a line, don't change B.
   * So if B is to the west or east, set A to the south.
   * Otherwise, set A to the east and B to the south.
   * Represents the 90º rotation of the right triangle from height
   * @returns {Ray}  The new 2d ray.
   */
  _projectSquareGrid() {
    // If the points are already on a line, don't change B.
    // Otherwise, set A to the east and B to the south
    // Represents the 90º rotation of the right triangle from height
    const height = Math.abs(this.dz);

    const A = this.A.to2d();
    const B = this.B.to2d();

    // If points are on vertical line
    // Set A to the east
    // B is either north or south from A
    /*
    A                    A
    |                   /
    |     ==>          /
    |                 /
    |                /
    B---->Height    B--->Height
    */
    if ( this.dx.almostEqual(0) ) A.x += height; // East

    // If points are on horizontal line
    // B is either west or east from A
    // Set A to the south
    /*
               • Height    A
               |              \
               |                \
    A----------B    ==>           B
    */
    else if ( this.dy.almostEqual(0) ) A.y += height; // South

    // Otherwise set B to point south, A pointing east
    else return this._projectEast();

    // Debug: console.log(`Projecting Square: A: (${this.A.x},${this.A.y},${this.A.z})->(${A.x},${A.y}); B: (${this.B.x},${this.B.y},${this.B.z})->(${B.x},${B.y})`);

    return new Ray(A, B);
  }

  /**
   * Set A pointing south; B pointing west
   * @returns {Ray} The new 2d ray
   */
  _projectSouth() {
    const height = Math.abs(this.dz);

    /*                   A
    A                    |
      \   • Height       |  <- Dist
       \  |         ==>  |             ==>    A   <-- Height
        \ |              |                      \
          B              B----• height            \
                                                   B
    */

    // Always measure Euclidean distances; only use gridSpaces later for the projected values.
    const A = this.A.to2d();
    const B = this.B.to2d();
    const gridDistance = PIXI.Point.distanceBetween(A, B);
    A.y = B.y - gridDistance;
    A.x = B.x - height;

    // Debug: console.log(`Projecting South: A: (${this.A.x},${this.A.y},${this.A.z})->(${A.x},${A.y}); B: (${this.B.x},${this.B.y},${this.B.z})->(${B.x},${B.y})`);

    return new Ray(A, B);
  }

  /**
   * Set A pointing east; B pointing south
   * @returns {Ray} The new 2d ray
   */
  _projectEast() {
    const height = Math.abs(this.dz);

    /*                           • Height
    A                            |
      \   • Height               |
       \  |         ==>  A-------B   ==>    A   <-- Height
        \ |                                  \
          B                                   \
                                               B
    */

    // Always measure Euclidean distances; only use gridSpaces later for the projected values.
    const A = this.A.to2d();
    const B = this.B.to2d();
    const gridDistnace = PIXI.Point.distanceBetween(A, B);
    A.x = B.x - gridDistance;
    A.y = B.y - height;

    // Debug: log(`Projecting East: A: (${this.A.x},${this.A.y},${this.A.z})->(${A.x},${A.y}); B: (${this.B.x},${this.B.y},${this.B.z})->(${B.x},${B.y})`);

    return new Ray(A, B);
  }
}
