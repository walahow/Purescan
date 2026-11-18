import type { FilterAdjustments, FilterPreset } from '../types/scan';

function clampByte(v: number): number {
  return v <= 0 ? 0 : v >= 255 ? 255 : (v + 0.5) | 0;
}

/**
 * Separable 1D sliding-window extremum (dilation when isMax=true, erosion when isMax=false).
 * Runs on a downscaled illumination grid (~240px max edge), so it finishes in ~1-2 ms.
 */
function morph1DPass(
  src: Float32Array,
  dst: Float32Array,
  w: number,
  h: number,
  radius: number,
  horizontal: boolean,
  isMax: boolean
): void {
  if (horizontal) {
    for (let y = 0; y < h; y++) {
      const row = y * w;
      for (let x = 0; x < w; x++) {
        const x0 = x - radius < 0 ? 0 : x - radius;
        const x1 = x + radius >= w ? w - 1 : x + radius;
        let best = src[row + x0];
        if (isMax) {
          for (let k = x0 + 1; k <= x1; k++) {
            const v = src[row + k];
            if (v > best) best = v;
          }
        } else {
          for (let k = x0 + 1; k <= x1; k++) {
            const v = src[row + k];
            if (v < best) best = v;
          }
        }
        dst[row + x] = best;
      }
    }
  } else {
    for (let y = 0; y < h; y++) {
      const y0 = y - radius < 0 ? 0 : y - radius;
      const y1 = y + radius >= h ? h - 1 : y + radius;
      for (let x = 0; x < w; x++) {
        let best = src[y0 * w + x];
        if (isMax) {
          for (let k = y0 + 1; k <= y1; k++) {
            const v = src[k * w + x];
            if (v > best) best = v;
          }
        } else {
          for (let k = y0 + 1; k <= y1; k++) {
            const v = src[k * w + x];
            if (v < best) best = v;
          }
        }
        dst[y * w + x] = best;
      }
    }
  }
}

/**
 * Separable O(N) sliding-window box blur.
 */
function boxBlur2D(src: Float32Array, tmp: Float32Array, dst: Float32Array, w: number, h: number, radius: number): void {
  // Horizontal
  for (let y = 0; y < h; y++) {
    const row = y * w;
    for (let x = 0; x < w; x++) {
      const x0 = x - radius < 0 ? 0 : x - radius;
      const x1 = x + radius >= w ? w - 1 : x + radius;
      let sum = 0;
      for (let k = x0; k <= x1; k++) sum += src[row + k];
      tmp[row + x] = sum / (x1 - x0 + 1);
    }
  }
  // Vertical
  for (let y = 0; y < h; y++) {
    const y0 = y - radius < 0 ? 0 : y - radius;
    const y1 = y + radius >= h ? h - 1 : y + radius;
    const count = y1 - y0 + 1;
    for (let x = 0; x < w; x++) {
      let sum = 0;
      for (let k = y0; k <= y1; k++) sum += tmp[k * w + x];
      dst[y * w + x] = sum / count;
    }
  }
}

interface BackgroundGrid {
  data: Float32Array;
  w: number;
  h: number;
  scaleX: number;
  scaleY: number;
  floor: number;
}

/**
 * Estimates the smooth local paper illumination surface for a single channel plane
 * using block-max downsampling -> morphological closing (dilate + erode) -> 2-pass blur.
 *
 * Closing removes text strokes and dark ink while snapping sharp shadow boundaries
 * back to their true physical position (preventing dark halos along shadow edges).
 */
function estimateBackgroundPlane(plane: Uint8Array, width: number, height: number): BackgroundGrid {
  const targetMax = 260;
  const maxDim = Math.max(width, height);
  const scale = Math.max(1, Math.round(maxDim / targetMax));

  const bgW = Math.max(8, Math.ceil(width / scale));
  const bgH = Math.max(8, Math.ceil(height / scale));
  const count = bgW * bgH;

  const down = new Float32Array(count);

  // Block-max downsampling removes thin dark ink strokes right away
  for (let by = 0; by < bgH; by++) {
    const yStart = by * scale;
    const yEnd = Math.min(height, yStart + scale);
    for (let bx = 0; bx < bgW; bx++) {
      const xStart = bx * scale;
      const xEnd = Math.min(width, xStart + scale);
      let maxVal = 0;
      for (let y = yStart; y < yEnd; y++) {
        const row = y * width;
        for (let x = xStart; x < xEnd; x++) {
          const v = plane[row + x];
          if (v > maxVal) maxVal = v;
        }
      }
      down[by * bgW + bx] = maxVal;
    }
  }

  // Tight morphological closing radius: wide enough to eliminate bold headings/tables,
  // tight enough to hug sharp phone shadow contours cleanly.
  const closeRadius = Math.max(2, Math.min(6, Math.round(Math.max(bgW, bgH) * 0.02)));

  // Pad grid by closeRadius*2 with edge-replication BEFORE closing so shadows touching
  // image corners/borders survive dilation in the padding zone and erode back cleanly!
  const pad = closeRadius * 2;
  const padW = bgW + pad * 2;
  const padH = bgH + pad * 2;
  const padCount = padW * padH;

  const padSrc = new Float32Array(padCount);
  for (let py = 0; py < padH; py++) {
    const sy = py < pad ? 0 : py >= pad + bgH ? bgH - 1 : py - pad;
    const srcRow = sy * bgW;
    const dstRow = py * padW;
    for (let px = 0; px < padW; px++) {
      const sx = px < pad ? 0 : px >= pad + bgW ? bgW - 1 : px - pad;
      padSrc[dstRow + px] = down[srcRow + sx];
    }
  }

  const bufA = new Float32Array(padCount);
  const bufB = new Float32Array(padCount);

  // Dilate (H -> V)
  morph1DPass(padSrc, bufA, padW, padH, closeRadius, true, true);
  morph1DPass(bufA, bufB, padW, padH, closeRadius, false, true);

  // Erode (H -> V) — restores true shadow edges including at image corners!
  morph1DPass(bufB, bufA, padW, padH, closeRadius, true, false);
  morph1DPass(bufA, bufB, padW, padH, closeRadius, false, false);

  // Crop back to original bgW x bgH
  const closed = new Float32Array(count);
  for (let y = 0; y < bgH; y++) {
    const srcStart = (y + pad) * padW + pad;
    closed.set(bufB.subarray(srcStart, srcStart + bgW), y * bgW);
  }

  // Gentle 1-pass radius-1 blur smooths discrete grid steps without smearing shadow penumbras
  const blurTmp = new Float32Array(count);
  const smoothed = new Float32Array(count);
  boxBlur2D(closed, blurTmp, smoothed, bgW, bgH, 1);

  // Compute 85th percentile to establish a safe illumination floor
  // (guards very dark solid photos/headers from blowing out into gray noise)
  const sorted = Float32Array.from(smoothed).sort();
  const p85 = sorted[Math.min(count - 1, Math.floor(count * 0.85))];
  const floor = Math.max(26, p85 * 0.2);

  return {
    data: smoothed,
    w: bgW,
    h: bgH,
    scaleX: (bgW - 1) / Math.max(1, width - 1),
    scaleY: (bgH - 1) / Math.max(1, height - 1),
    floor,
  };
}

function sampleBgBilinear(grid: BackgroundGrid, x: number, y: number): number {
  const gx = x * grid.scaleX;
  const gy = y * grid.scaleY;
  const x0 = gx | 0;
  const y0 = gy | 0;
  const x1 = x0 + 1 < grid.w ? x0 + 1 : grid.w - 1;
  const y1 = y0 + 1 < grid.h ? y0 + 1 : grid.h - 1;
  const fx = gx - x0;
  const fy = gy - y0;

  const row0 = y0 * grid.w;
  const row1 = y1 * grid.w;
  const d = grid.data;

  const top = d[row0 + x0] * (1 - fx) + d[row0 + x1] * fx;
  const bot = d[row1 + x0] * (1 - fx) + d[row1 + x1] * fx;
  const val = top * (1 - fy) + bot * fy;
  return val > grid.floor ? val : grid.floor;
}

/**
 * Light edge-aware 3x3 unsharp mask that sharpens text strokes while ignoring
 * flat paper regions (threshold prevents noise amplification on clean white paper).
 */
function applyUnsharpMask(pixels: Uint8ClampedArray, width: number, height: number, amount = 0.25, threshold = 8): void {
  if (width < 3 || height < 3 || amount <= 0) return;
  const copy = new Uint8ClampedArray(pixels);
  const stride = width * 4;

  for (let y = 1; y < height - 1; y++) {
    const row = y * stride;
    for (let x = 1; x < width - 1; x++) {
      const idx = row + x * 4;
      for (let c = 0; c < 3; c++) {
        const center = copy[idx + c];
        const avg =
          (copy[idx - stride - 4 + c] +
            copy[idx - stride + c] +
            copy[idx - stride + 4 + c] +
            copy[idx - 4 + c] +
            copy[idx + 4 + c] +
            copy[idx + stride - 4 + c] +
            copy[idx + stride + c] +
            copy[idx + stride + 4 + c]) *
          0.125;
        const diff = center - avg;
        if (Math.abs(diff) > threshold) {
          pixels[idx + c] = clampByte(center + diff * amount);
        }
      }
    }
  }
}

/**
 * Applies the selected CamScanner-style document enhancement preset to an RGBA buffer.
 * Returns a newly allocated Uint8ClampedArray (does not mutate input).
 */
export function applyDocumentFilter(
  src: Uint8ClampedArray,
  width: number,
  height: number,
  preset: FilterPreset,
  adjustments: FilterAdjustments
): Uint8ClampedArray {
  const numPixels = width * height;
  const out = new Uint8ClampedArray(numPixels * 4);

  const strength = Math.max(0, Math.min(1, adjustments.shadowStrength / 100));
  const brightShift = adjustments.brightness * 1.4; // -70..+70
  const contrastFactor = Math.pow((adjustments.contrast + 100) / 100, 1.35);

  // ── 1. ORIGINAL (no shadow removal, optional brightness/contrast only) ──
  if (preset === 'original') {
    if (adjustments.brightness === 0 && adjustments.contrast === 0) {
      out.set(src);
      return out;
    }
    for (let i = 0; i < numPixels * 4; i += 4) {
      out[i] = clampByte((src[i] - 128) * contrastFactor + 128 + brightShift);
      out[i + 1] = clampByte((src[i + 1] - 128) * contrastFactor + 128 + brightShift);
      out[i + 2] = clampByte((src[i + 2] - 128) * contrastFactor + 128 + brightShift);
      out[i + 3] = 255;
    }
    return out;
  }

  // ── 2. PURE COLOR (Per-channel shadow removal + white paper snap + vivid ink) ──
  if (preset === 'pure-color') {
    const rPlane = new Uint8Array(numPixels);
    const gPlane = new Uint8Array(numPixels);
    const bPlane = new Uint8Array(numPixels);

    for (let i = 0, p = 0; i < numPixels; i++, p += 4) {
      rPlane[i] = src[p];
      gPlane[i] = src[p + 1];
      bPlane[i] = src[p + 2];
    }

    const bgR = estimateBackgroundPlane(rPlane, width, height);
    const bgG = estimateBackgroundPlane(gPlane, width, height);
    const bgB = estimateBackgroundPlane(bPlane, width, height);

    // White/black stretch bounds — paper near 232+ snaps cleanly to 255
    const blackPt = 24;
    const whitePt = 232;
    const invRange = 255 / (whitePt - blackPt);
    const satBoost = 1.16;

    for (let y = 0; y < height; y++) {
      const rowStart = y * width;
      for (let x = 0; x < width; x++) {
        const i = rowStart + x;
        const p = i * 4;

        const r0 = rPlane[i];
        const g0 = gPlane[i];
        const b0 = bPlane[i];

        // Illumination division per channel removes shadows AND yellow lamp cast
        const nr = (r0 / sampleBgBilinear(bgR, x, y)) * 255;
        const ng = (g0 / sampleBgBilinear(bgG, x, y)) * 255;
        const nb = (b0 / sampleBgBilinear(bgB, x, y)) * 255;

        let r = r0 + (nr - r0) * strength;
        let g = g0 + (ng - g0) * strength;
        let b = b0 + (nb - b0) * strength;

        // Levels stretch to brighten paper to pure white & deepen ink
        r = (r - blackPt) * invRange;
        g = (g - blackPt) * invRange;
        b = (b - blackPt) * invRange;

        // User brightness & contrast
        r = (r - 128) * contrastFactor + 128 + brightShift;
        g = (g - 128) * contrastFactor + 128 + brightShift;
        b = (b - 128) * contrastFactor + 128 + brightShift;

        // Subtle saturation boost so colored pens/stamps pop (fades out near pure white)
        const lum = 0.299 * r + 0.587 * g + 0.114 * b;
        if (lum < 245) {
          r = lum + (r - lum) * satBoost;
          g = lum + (g - lum) * satBoost;
          b = lum + (b - lum) * satBoost;
        }

        out[p] = clampByte(r);
        out[p + 1] = clampByte(g);
        out[p + 2] = clampByte(b);
        out[p + 3] = 255;
      }
    }

    applyUnsharpMask(out, width, height, 0.28, 7);
    return out;
  }

  // ── 3 & 4. PURE B&W & GRAYSCALE (Single luminance plane -> 3x faster!) ──
  const lumPlane = new Uint8Array(numPixels);
  for (let i = 0, p = 0; i < numPixels; i++, p += 4) {
    lumPlane[i] = (0.299 * src[p] + 0.587 * src[p + 1] + 0.114 * src[p + 2] + 0.5) | 0;
  }

  const bgLum = estimateBackgroundPlane(lumPlane, width, height);

  if (preset === 'pure-bw') {
    // Soft-threshold ramp: snaps paper (>= hi) to pure 255 and ink (<= lo) to crisp 0
    // while keeping letter edges anti-aliased and readable
    const center = 176 - brightShift * 0.7;
    const halfWidth = Math.max(18, 44 / contrastFactor);
    const lo = center - halfWidth;
    const hi = center + halfWidth;
    const invSpan = 1 / (hi - lo);

    for (let y = 0; y < height; y++) {
      const rowStart = y * width;
      for (let x = 0; x < width; x++) {
        const i = rowStart + x;
        const p = i * 4;
        const l0 = lumPlane[i];
        const norm = (l0 / sampleBgBilinear(bgLum, x, y)) * 255;
        const clean = l0 + (norm - l0) * strength;

        let t = (clean - lo) * invSpan;
        if (t <= 0) t = 0;
        else if (t >= 1) t = 1;
        else {
          // Smoothstep S-curve keeps text edges razor-sharp without jagged 1-bit aliasing
          t = t * t * (3 - 2 * t);
        }

        const v = (t * 255 + 0.5) | 0;
        out[p] = v;
        out[p + 1] = v;
        out[p + 2] = v;
        out[p + 3] = 255;
      }
    }

    applyUnsharpMask(out, width, height, 0.22, 10);
    return out;
  }

  // preset === 'grayscale'
  const blackPt = 18;
  const whitePt = 236;
  const invRange = 255 / (whitePt - blackPt);

  for (let y = 0; y < height; y++) {
    const rowStart = y * width;
    for (let x = 0; x < width; x++) {
      const i = rowStart + x;
      const p = i * 4;
      const l0 = lumPlane[i];
      const norm = (l0 / sampleBgBilinear(bgLum, x, y)) * 255;
      let v = l0 + (norm - l0) * strength;
      v = (v - blackPt) * invRange;
      v = (v - 128) * contrastFactor + 128 + brightShift;
      const byte = clampByte(v);
      out[p] = byte;
      out[p + 1] = byte;
      out[p + 2] = byte;
      out[p + 3] = 255;
    }
  }

  return out;
}
