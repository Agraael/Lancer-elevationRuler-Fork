/* globals
Float16Array,
PIXI
*/

/**
 * Custom PIXI BufferResource for data textures.
 * See https://github.com/pixijs/pixijs/issues/6436
 * @param {Float32Array|Uint8Array|Uint32Array} source - Source buffer
 * @param {object} options - Options
 * @param {number} options.width - Width of the texture
 * @param {number} options.height - Height of the texture
 * @param {string} [opts.internalFormat] WebGL enum format
 * @param {string} [opts.format] 				WebGL enum format
 * @param {string} [opts.type]						WebGL enum type
 */
class CustomBufferResource extends PIXI.BufferResource {
  constructor(source, options = {}) {
    let { internalFormat, format, type } = options;
    super(source, options);
    internalFormat ??= PIXI.GL_FORMATS.RGBA;
    format ??= PIXI.GL_FORMATS.RGBA;
    type ??= PIXI.GL_TYPES.UNSIGNED_BYTE;
    if ( !PIXI.GL_FORMATS[internalFormat] ) throw new Error("CustomResourceBuffer internal format not recognized.");
    if ( !PIXI.GL_FORMATS[format] ) throw new Error("CustomResourceBuffer format not recognized.");
    if ( !PIXI.GL_TYPES[type] ) throw new Error("CustomResourceBuffer type not recognized.");

    this.data = source;
    this.internalFormat = internalFormat;
    this.format = format;
    this.type = type;
  }

  upload(renderer, baseTexture, glTexture) {
    const gl = renderer.gl;

    gl.pixelStorei(
      gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL,
      baseTexture.alphaMode === 1 // PIXI.ALPHA_MODES.UNPACK but `PIXI.ALPHA_MODES` are not exported
    );

    glTexture.width = baseTexture.width;
    glTexture.height = baseTexture.height;

    gl.texImage2D(
      baseTexture.target,
      0,
      gl[this.internalFormat],
      baseTexture.width,
      baseTexture.height,
      0,
      gl[this.format],
      gl[this.type],
      this.data
    );

    return true;
  }
}

/*
const resource = new CustomBufferResource(dataArray, {
  width: 3,
  height: 3,
  internalFormat: 'R32F',
  format: 'RED',
  type: 'FLOAT'
});
*/


// Shamelessly borrowed from https://github.com/dev7355608/perfect-vision/blob/main/scripts/utils/extract-pixels.js

/**
 * @param {WebGL}  gl         The gl instance from the renderer
 * @param {PIXI.Rectangle} frame
 * @param {number} resolution
 * @param {GLenum} [opts.format=renderer.gl.RGBA]           Format of the pixel data
 * @param {GLenum} [opts.type=renderer.gl.UNSIGNED_BYTE]    Data type of the pixel data
 * @param {TypedArray} [opts.pixels]                        Pixel array to use; will be created otherwise
 * @returns {object}
 * - @prop {TypedArray} pixels
 * - @prop {number} x
 * - @prop {number} y
 * - @prop {number} width
 * - @prop {number} height
 */
function readPixels(gl, frame, resolution, { type, format, pixels } = {}) {
  format ??= gl.RGBA;
  type ??= gl.UNSIGNED_BYTE;

  const x = Math.round(frame.left * resolution);
  const y = Math.round(frame.top * resolution);
  const width = Math.round(frame.right * resolution) - x;
  const height = Math.round(frame.bottom * resolution) - y;
  if ( !pixels ) {
    let cl;
    switch ( type ) {
      // WebGL
      case gl.UNSIGNED_BYTE: cl = Uint8Array; break;
      case gl.UNSIGNED_SHORT_5_6_5:
      case gl.UNSIGNED_SHORT_4_4_4_4:
      case gl.UNSIGNED_SHORT_5_5_5_1: cl = Uint16Array; break;
      case gl.FLOAT: cl = Float32Array; break;

      // WebGL2
      case gl.BYTE: cl = Int8Array; break;
      case gl.HALF_FLOAT: cl = Float16Array; break;
      case gl.SHORT: cl = Int16Array; break;
      case gl.UNSIGNED_SHORT: cl = Uint16Array; break;
      case gl.INT: cl = Int32Array; break;
      case gl.UNSIGNED_INT:
      case gl.UNSIGNED_INT_2_10_10_10_REV:
      case gl.UNSIGNED_INT_10F_11F_11F_REV:
      case gl.UNSIGNED_INT_5_9_9_9_REV: cl = Uint32Array; break;

      default: cl = Uint8Array;

    }
    let n;
    switch ( format ) {
      // WebGL
      case gl.ALPHA: n = 1; break;
      case gl.RGB: n = 3; break;
      case gl.RGBA: n = 4; break;

      // WebGL2
      case gl.RED:
      case gl.RED_INTEGER: n = 1; break;
      case gl.RG:
      case gl.RG_INTEGER: n = 2; break;
      case gl.RGB_INTEGER: n = 3; break;
      case gl.RGBA_INTEGER: n = 4; break;

      default: n = 4;
    }
    pixels = new cl(n * width * height);
  }
  gl.readPixels(x, y, width, height, format, type, pixels);
  return { pixels, x, y, width, height};
}


/**
 * Extract a rectangular block of pixels from the texture (without unpremultiplying).
 * See https://developer.mozilla.org/en-US/docs/Web/API/WebGLRenderingContext/readPixels
 * @param {PIXI.Renderer} renderer                          The renderer
 * @param {PIXI.Texture|PIXI.RenderTexture|null} [texture]  The texture the pixels are extracted from;
 *                                                          otherwise extract from the renderer
 * @param {object} [opts]
 * @param {PIXI.Rectangle} [opts.frame]                     The rectangle the pixels are extracted from;
 *                                                          otherwise extracted from the renderTexture
 * @param {GLenum} [opts.format=renderer.gl.RGBA]           Format of the pixel data
 * @param {GLenum} [opts.type=renderer.gl.UNSIGNED_BYTE]    Data type of the pixel data
 * @param {TypedArray} [opts.pixels]                        Pixel array to use; will be created otherwise
 * @returns {{pixels: TypedArray, width: number, height: number}} The extracted pixel data.
 */
export function extractPixelsAdvanced(renderer, texture, { frame, format, type, pixels } = {}) {
  const baseTexture = texture?.baseTexture;
  if (texture
    && (!baseTexture || !baseTexture.valid || baseTexture.parentTextureArray)) throw new Error("Texture is invalid");

  const gl = renderer.gl;
  format ??= gl.RGBA;
  type ??= gl.UNSIGNED_BYTE;

  if (!texture) {
    renderer.renderTexture.bind(null);
    return readPixels(gl, frame ?? renderer.screen, renderer.resolution, { format, type, pixels });
  } else if (texture instanceof PIXI.RenderTexture) {
    renderer.renderTexture.bind(texture);
    return readPixels(gl, frame ?? texture.frame, baseTexture.resolution, { format, type, pixels });
  } else {
    renderer.texture.bind(texture);
    const framebuffer = gl.createFramebuffer();
    try {
      gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
      gl.framebufferTexture2D(
        gl.FRAMEBUFFER,
        gl.COLOR_ATTACHMENT0,
        gl.TEXTURE_2D,
        baseTexture._glTextures[renderer.CONTEXT_UID]?.texture,
        0
      );

      if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) {
        throw new Error("Failed to extract pixels from texture");
      }

      return readPixels(gl, frame ?? texture.frame, baseTexture.resolution, { format, type, pixels });
    } finally {
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.deleteFramebuffer(framebuffer);
    }
  }
}

/**
 * Extract a rectangular block of pixels from the texture (without unpremultiplying).
 * @param {PIXI.Renderer} renderer - The renderer.
 * @param {PIXI.Texture|PIXI.RenderTexture|null} [texture] - The texture the pixels are extracted from;
 *                                                            otherwise extract from the renderer.
 * @param {PIXI.Rectangle} [frame] - The rectangle the pixels are extracted from.
 * @returns {{pixels: Uint8Array, width: number, height: number}} The extracted pixel data.
 */
export function extractPixels(renderer, texture, frame) {
  const baseTexture = texture?.baseTexture;

  if (texture && (!baseTexture || !baseTexture.valid || baseTexture.parentTextureArray)) {
    throw new Error("Texture is invalid");
  }

  const gl = renderer.gl;
  const readPixels = (frame, resolution) => {
    const x = Math.round(frame.left * resolution);
    const y = Math.round(frame.top * resolution);
    const width = Math.round(frame.right * resolution) - x;
    const height = Math.round(frame.bottom * resolution) - y;
    const pixels = new Uint8Array(4 * width * height);

    gl.readPixels(x, y, width, height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
    return { pixels, x, y, width, height };
  };

  if (!texture) {
    renderer.renderTexture.bind(null);
    return readPixels(frame ?? renderer.screen, renderer.resolution);

  } else if (texture instanceof PIXI.RenderTexture) {
    renderer.renderTexture.bind(texture);
    return readPixels(frame ?? texture.frame, baseTexture.resolution);

  } else {
    renderer.texture.bind(texture);

    const framebuffer = gl.createFramebuffer();

    try {
      gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
      gl.framebufferTexture2D(
        gl.FRAMEBUFFER,
        gl.COLOR_ATTACHMENT0,
        gl.TEXTURE_2D,
        baseTexture._glTextures[renderer.CONTEXT_UID]?.texture,
        0
      );

      if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) {
        throw new Error("Failed to extract pixels from texture");
      }

      return readPixels(frame ?? texture.frame, baseTexture.resolution);
    } finally {
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.deleteFramebuffer(framebuffer);
    }
  }
}

/**
 * Unpremultiply the pixel data.
 * @param {Uint8Array} pixels
 */
export function unpremultiplyPixels(pixels) {
  const n = pixels.length;
  for (let i = 0; i < n; i += 4) {
    const alpha = pixels[i + 3];
    if (alpha === 0) {
      const a = 255 / alpha;
      pixels[i] = Math.min((pixels[i] * a) + 0.5, 255);
      pixels[i + 1] = Math.min((pixels[i + 1] * a) + 0.5, 255);
      pixels[i + 2] = Math.min((pixels[i + 2] * a) + 0.5, 255);
    }
  }
}

/**
 * Create a canvas element containing the pixel data.
 * @param {Uint8Array} pixels
 * @param {number} width
 * @param {number} height
 * @returns {HTMLCanvasElement}
 */
export function pixelsToCanvas(pixels, width, height) {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;

  const context = canvas.getContext("2d");
  const imageData = context.getImageData(0, 0, width, height);
  imageData.data.set(pixels);
  context.putImageData(imageData, 0, 0);

  return canvas;
}

/**
 * Asynchronously convert a canvas element to base64.
 * @param {HTMLCanvasElement} canvas
 * @param {string} [type="image/png"]
 * @param {number} [quality]
 * @returns {Promise<string>} The base64 string of the canvas.
 */
export async function canvasToBase64(canvas, type, quality) {
  return new Promise((resolve, reject) => {
    canvas.toBlob(blob => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    }, type, quality);
  });
}
