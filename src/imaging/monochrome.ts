/**
 * Pure TypeScript 1-bit monochrome encoder for PDF Image XObjects
 * (/ColorSpace /DeviceGray, /BitsPerComponent 1).
 *
 * Follows ISO 32000-1 §8.9.3:
 * - Scanlines are packed MSB-first (bit 7 = leftmost pixel in each byte).
 * - Each scanline is padded to a whole byte boundary: rowBytes = ceil(width / 8).
 * - Bit value 1 = white (255), 0 = black (0), matching default /DeviceGray /Decode [0 1].
 * - Trailing padding bits on the right of each row are filled with 1 (white) so Flate
 *   compresses long runs of white paper cleanly.
 */

export interface Mono1BitImage {
  packedBits: Uint8Array;
  width: number;
  height: number;
  rowBytes: number;
  threshold: number;
}

/**
 * Computes an automatic global threshold (0..255) using Otsu's between-class variance
 * method on a luminance buffer. Clamped to [48..224] so mostly-blank or mostly-dark
 * pages never collapse into solid black/white.
 */
export function computeOtsuThreshold(luminance: Uint8Array): number {
  const total = luminance.length;
  if (total === 0) return 165;

  const hist = new Uint32Array(256);
  let sumAll = 0;
  for (let i = 0; i < total; i++) {
    const v = luminance[i];
    hist[v]++;
    sumAll += v;
  }

  let weightBg = 0;
  let sumBg = 0;
  let maxVariance = -1;
  let bestThreshold = 165;

  for (let t = 0; t < 256; t++) {
    weightBg += hist[t];
    if (weightBg === 0) continue;
    const weightFg = total - weightBg;
    if (weightFg === 0) break;

    sumBg += t * hist[t];
    const meanBg = sumBg / weightBg;
    const meanFg = (sumAll - sumBg) / weightFg;
    const diff = meanBg - meanFg;
    const variance = weightBg * weightFg * diff * diff;

    if (variance > maxVariance) {
      maxVariance = variance;
      bestThreshold = t;
    }
  }

  // Bias slightly upward on bright paper documents so thin dark strokes stay crisp
  return Math.max(48, Math.min(224, bestThreshold));
}

/**
 * Converts an RGBA buffer into a PDF-ready byte-aligned 1-bit monochrome bitmap.
 * When `threshold` is omitted, computes an adaptive Otsu threshold automatically.
 */
export function packRgbaTo1Bit(
  pixels: Uint8ClampedArray,
  width: number,
  height: number,
  threshold?: number
): Mono1BitImage {
  if (width <= 0 || height <= 0) {
    throw new Error('Invalid image dimensions for 1-bit packing.');
  }

  const numPixels = width * height;
  const lum = new Uint8Array(numPixels);
  for (let i = 0, p = 0; i < numPixels; i++, p += 4) {
    lum[i] = (0.299 * pixels[p] + 0.587 * pixels[p + 1] + 0.114 * pixels[p + 2] + 0.5) | 0;
  }

  const cutoff = threshold !== undefined ? Math.max(1, Math.min(254, Math.round(threshold))) : computeOtsuThreshold(lum);
  const rowBytes = Math.ceil(width / 8);
  const packedBits = new Uint8Array(rowBytes * height);

  // Pre-fill trailing unused bits at row end with white (1)
  const remainder = width & 7;
  const trailingWhiteMask = remainder === 0 ? 0 : (1 << (8 - remainder)) - 1;

  for (let y = 0; y < height; y++) {
    const srcRow = y * width;
    const dstRow = y * rowBytes;

    let x = 0;
    let byteIdx = dstRow;
    const fullBytes = width >> 3;

    // Fast path for complete 8-pixel groups
    for (let b = 0; b < fullBytes; b++) {
      let byte = 0;
      if (lum[srcRow + x] >= cutoff) byte |= 0x80;
      if (lum[srcRow + x + 1] >= cutoff) byte |= 0x40;
      if (lum[srcRow + x + 2] >= cutoff) byte |= 0x20;
      if (lum[srcRow + x + 3] >= cutoff) byte |= 0x10;
      if (lum[srcRow + x + 4] >= cutoff) byte |= 0x08;
      if (lum[srcRow + x + 5] >= cutoff) byte |= 0x04;
      if (lum[srcRow + x + 6] >= cutoff) byte |= 0x02;
      if (lum[srcRow + x + 7] >= cutoff) byte |= 0x01;
      packedBits[byteIdx++] = byte;
      x += 8;
    }

    // Remainder pixels (< 8) padded with white bits on the right
    if (remainder > 0) {
      let byte = trailingWhiteMask;
      for (let bit = 0; bit < remainder; bit++) {
        if (lum[srcRow + x + bit] >= cutoff) {
          byte |= 0x80 >> bit;
        }
      }
      packedBits[byteIdx] = byte;
    }
  }

  return {
    packedBits,
    width,
    height,
    rowBytes,
    threshold: cutoff,
  };
}
