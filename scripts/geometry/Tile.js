/* globals
CONFIG
*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */

// Update tile pixel cache and add getter.
// Pixel cache stored at _evPixelCache; getter uses evPixelCache
import "./PixelCache.js";

export const PATCHES = {};
PATCHES.PIXEL_CACHE = {};

// ----- NOTE: Hooks ----- //

/**
 * Hook tile update and erase the terrain if the attachedTerrain flag was updated.
 * A hook event that fires for every Document type after conclusion of an update workflow.
 * Substitute the Document name in the hook event to target a specific Document type, for example "updateActor".
 * This hook fires for all connected clients after the update has been processed.
 *
 * @event updateDocument
 * @category Document
 * @param {Document} document                       The existing Document which was updated
 * @param {object} change                           Differential data that was used to update the document
 * @param {DocumentModificationContext} options     Additional options which modified the update request
 * @param {string} userId                           The ID of the User who triggered the update workflow
 */
function updateTile(tileD, changed, _options, _userId) {
  // Should not be needed: if ( changed.overhead ) document.object._evPixelCache = undefined;
  const cache = tileD.object?._evPixelCache;
  if ( cache ) {
    if ( Object.hasOwn(changed, "x")
      || Object.hasOwn(changed, "y")
      || Object.hasOwn(changed, "width")
      || Object.hasOwn(changed, "height") ) {
      cache._resize();
    }

    if ( Object.hasOwn(changed, "rotation")
      || Object.hasOwn(changed, "texture")
      || (changed.texture
        && (Object.hasOwn(changed.texture, "scaleX")
        || Object.hasOwn(changed.texture, "scaleY"))) ) {

      cache.clearTransforms();
    }
  }
}

PATCHES.PIXEL_CACHE.HOOKS = { updateTile };

// ----- NOTE: Getters ----- //

/**
 * Getter for Tile.mesh._evPixelCache
 */
function evPixelCache() {
  return this._evPixelCache
    || (this._evPixelCache = CONFIG.GeometryLib.TilePixelCache.fromOverheadTileAlpha(this, CONFIG.GeometryLib.pixelCacheResolution ?? 1)); // 1/4 resolution.
}

PATCHES.PIXEL_CACHE.GETTERS = { evPixelCache };
