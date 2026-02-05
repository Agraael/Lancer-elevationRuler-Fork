/* globals
foundry
*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */

import { ConstrainedTokenBorder } from "./ConstrainedTokenBorder.js";


// Patches for the Token class
export const PATCHES = {};
PATCHES.CONSTRAINED_TOKEN_BORDER = {};

// ----- NOTE: Getters ----- //

/**
 * New getter: Token.prototype.constrainedTokenBorder
 * Determine the constrained border shape for this token.
 * @returns {ConstrainedTokenShape|PIXI.Rectangle}
 */
function constrainedTokenBorder() { return ConstrainedTokenBorder.get(this).constrainedBorder(); }

/**
 * New getter: Token.prototype.isConstrainedTokenBorder
 * Determine whether the border is currently constrained for this token.
 * I.e., the token overlaps a wall.
 * @returns {boolean}
 */
function isConstrainedTokenBorder() { return !ConstrainedTokenBorder.get(this)._unrestricted; }

/**
 * New getter: Token.prototype.tokenBorder
 * Determine the correct border shape for this token. Utilize the cached token shape.
 * @returns {PIXI.Polygon|PIXI.Rectangle}
 */
function tokenBorder() { return this.getShape().translate(this.document.x, this.document.y); }

/**
 * New getter: Token.prototype.tokenShape
 * Cache the token shape.
 * @type {PIXI.Polygon|PIXI.Rectangle}
 */
function tokenShape() {
  const msg = "libGeometry|Token#tokenShape is deprecated. "
    + "If you need the shape of a Token, use Token#shape/getShape instead.";
  foundry.utils.logCompatibilityWarning(msg, {since: 12, until: 14, once: true});
  return this.shape;
}

PATCHES.CONSTRAINED_TOKEN_BORDER.GETTERS = {
  constrainedTokenBorder,
  tokenBorder,
  tokenShape,
  isConstrainedTokenBorder
};
