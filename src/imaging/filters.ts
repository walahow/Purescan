import type { FilterAdjustments, FilterPreset } from '../types/scan';

function clampByte(v: number): number {
  return v <= 0 ? 0 : v >= 255 ? 255 : (v + 0.5) | 0;
}

/**
 * Separable 1D sliding-window extremum (dilation when isMax=true, erosion when isMax=false).
 * Runs on a downscaled illumination grid (~260px max edge), finishing in ~1-2 ms.
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
 * Separable sliding-window box blur.
 */
function boxBlur2D(
  src: Float32Array,
  tmp: Float32Array,
  dst: Float32Array,
  w: number,
  h: number,
  radius: number
): void {
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
 * using block-max downsampling -> border-replicated morphological closing (dilate + erode) -> blur.
 */
function estimateBackgroundPlane(
  plane: Uint8Array,
  width: number,
  height: number,
  closeScaleFactor = 0.02,
  blurPasses = 1
): BackgroundGrid {
  const targetMax = 260;
  const maxDim = Math.max(width, height);
  const scale = Math.max(1, Math.round(maxDim / targetMax));

  const bgW = Math.max(8, Math.ceil(width / scale));
  const bgH = Math.max(8, Math.ceil(height / scale));
  const count = bgW * bgH;

  const down = new Float32Array(count);

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

  const closeRadius = Math.max(
    2,
    Math.min(8, Math.round(Math.max(bgW, bgH) * closeScaleFactor))
  );

  // Pad grid by closeRadius*2 with edge-replication BEFORE closing so shadows touching
  // image corners/borders survive dilation in the padding zone and erode back cleanly.
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

  morph1DPass(padSrc, bufA, padW, padH, closeRadius, true, true);
  morph1DPass(bufA, bufB, padW, padH, closeRadius, false, true);
  morph1DPass(bufB, bufA, padW, padH, closeRadius, true, false);
  morph1DPass(bufA, bufB, padW, padH, closeRadius, false, false);

  const closed = new Float32Array(count);
  for (let y = 0; y < bgH; y++) {
    const srcStart = (y + pad) * padW + pad;
    closed.set(bufB.subarray(srcStart, srcStart + bgW), y * bgW);
  }

  const blurTmp = new Float32Array(count);
  let current = closed;
  for (let p = 0; p < blurPasses; p++) {
    const next = new Float32Array(count);
    boxBlur2D(current, blurTmp, next, bgW, bgH, 1);
    current = next;
  }

  const sorted = Float32Array.from(current).sort();
  const p85 = sorted[Math.min(count - 1, Math.floor(count * 0.85))];
  const floor = Math.max(26, p85 * 0.2);

  return {
    data: current,
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

interface LocalToneGrid {
  black: Float32Array;
  white: Float32Array;
  gw: number;
  gh: number;
  scaleX: number;
  scaleY: number;
}

/**
 * Computes an 8x8 tile-interpolated local black/white tone map (CLAHE-style)
 * so faded ink in one corner and dense headings in another both get crisp contrast.
 */
function computeLocalToneGrid(
  normLum: Float32Array,
  width: number,
  height: number
): LocalToneGrid {
  const gw = 8;
  const gh = 8;
  const rawBlack = new Float32Array(gw * gh);
  const rawWhite = new Float32Array(gw * gh);
  const hist = new Uint32Array(64);

  for (let gy = 0; gy < gh; gy++) {
    const y0 = Math.floor((gy * height) / gh);
    const y1 = Math.max(y0 + 1, Math.floor(((gy + 1) * height) / gh));
    const stepY = Math.max(1, Math.floor((y1 - y0) / 22));

    for (let gx = 0; gx < gw; gx++) {
      const x0 = Math.floor((gx * width) / gw);
      const x1 = Math.max(x0 + 1, Math.floor(((gx + 1) * width) / gw));
      const stepX = Math.max(1, Math.floor((x1 - x0) / 22));

      hist.fill(0);
      let count = 0;
      for (let y = y0; y < y1; y += stepY) {
        const row = y * width;
        for (let x = x0; x < x1; x += stepX) {
          const v = normLum[row + x];
          const b = v <= 0 ? 0 : v >= 255 ? 63 : (v >> 2) & 63;
          hist[b]++;
          count++;
        }
      }

      const idx = gy * gw + gx;
      if (count === 0) {
        rawBlack[idx] = 28;
        rawWhite[idx] = 232;
        continue;
      }

      const target8 = Math.floor(count * 0.08);
      const target82 = Math.floor(count * 0.82);
      let acc = 0;
      let p8 = 28;
      let p82 = 232;
      let found8 = false;

      for (let b = 0; b < 64; b++) {
        acc += hist[b];
        if (!found8 && acc >= target8) {
          p8 = b * 4 + 2;
          found8 = true;
        }
        if (acc >= target82) {
          p82 = b * 4 + 2;
          break;
        }
      }

      const wht = Math.max(204, Math.min(244, p82));
      // Only tighten black point when tile actually has ink contrast; avoids speckling blank margins
      const blk = wht - p8 > 64 ? Math.max(18, Math.min(54, p8 * 0.55 + 12)) : 28;

      rawBlack[idx] = blk;
      rawWhite[idx] = wht;
    }
  }

  // Smooth 8x8 tile boundaries once to eliminate any visible block transitions
  const black = new Float32Array(gw * gh);
  const white = new Float32Array(gw * gh);
  for (let gy = 0; gy < gh; gy++) {
    for (let gx = 0; gx < gw; gx++) {
      let sb = 0;
      let sw = 0;
      let wt = 0;
      for (let dy = -1; dy <= 1; dy++) {
        const ny = Math.max(0, Math.min(gh - 1, gy + dy));
        for (let dx = -1; dx <= 1; dx++) {
          const nx = Math.max(0, Math.min(gw - 1, gx + dx));
          const w = dx === 0 && dy === 0 ? 4 : 1;
          sb += rawBlack[ny * gw + nx] * w;
          sw += rawWhite[ny * gw + nx] * w;
          wt += w;
        }
      }
      const i = gy * gw + gx;
      black[i] = sb / wt;
      white[i] = sw / wt;
    }
  }

  return {
    black,
    white,
    gw,
    gh,
    scaleX: (gw - 1) / Math.max(1, width - 1),
    scaleY: (gh - 1) / Math.max(1, height - 1),
  };
}

/**
 * Dual-radius edge-aware text & stroke clarity sharpening.
 * Combines 3x3 fine edge sharpening (radius 1) with 5x1+1x5 stroke micro-contrast (radius 2),
 * while gating flat white paper regions so backgrounds stay spotless.
 */
function applyDualRadiusSharpen(
  pixels: Uint8ClampedArray,
  width: number,
  height: number,
  fineAmount = 0.35,
  strokeAmount = 0.16,
  threshold = 7
): void {
  if (width < 5 || height < 5 || (fineAmount <= 0 && strokeAmount <= 0)) return;

  const copy = new Uint8ClampedArray(pixels);
  const stride = width * 4;

  // Compute separable 5-tap radius-2 smoothed buffer if strokeAmount > 0
  let blur2: Uint8ClampedArray | null = null;
  if (strokeAmount > 0) {
    const tmp = new Uint8ClampedArray(copy.length);
    blur2 = new Uint8ClampedArray(copy.length);

    // Horizontal [1, 2, 2, 2, 1] / 8
    for (let y = 0; y < height; y++) {
      const row = y * stride;
      for (let x = 0; x < width; x++) {
        const xm2 = (x > 1 ? x - 2 : 0) * 4;
        const xm1 = (x > 0 ? x - 1 : 0) * 4;
        const x0 = x * 4;
        const xp1 = (x + 1 < width ? x + 1 : width - 1) * 4;
        const xp2 = (x + 2 < width ? x + 2 : width - 1) * 4;
        for (let c = 0; c < 3; c++) {
          tmp[row + x0 + c] =
            (copy[row + xm2 + c] +
              2 * copy[row + xm1 + c] +
              2 * copy[row + x0 + c] +
              2 * copy[row + xp1 + c] +
              copy[row + xp2 + c] +
              4) >>
            3;
        }
      }
    }

    // Vertical [1, 2, 2, 2, 1] / 8
    for (let y = 0; y < height; y++) {
      const ym2 = (y > 1 ? y - 2 : 0) * stride;
      const ym1 = (y > 0 ? y - 1 : 0) * stride;
      const y0 = y * stride;
      const yp1 = (y + 1 < height ? y + 1 : height - 1) * stride;
      const yp2 = (y + 2 < height ? y + 2 : height - 1) * stride;
      for (let x = 0; x < width; x++) {
        const ox = x * 4;
        for (let c = 0; c < 3; c++) {
          blur2[y0 + ox + c] =
            (tmp[ym2 + ox + c] +
              2 * tmp[ym1 + ox + c] +
              2 * tmp[y0 + ox + c] +
              2 * tmp[yp1 + ox + c] +
              tmp[yp2 + ox + c] +
              4) >>
            3;
        }
      }
    }
  }

  for (let y = 1; y < height - 1; y++) {
    const row = y * stride;
    for (let x = 1; x < width - 1; x++) {
      const idx = row + x * 4;
      for (let c = 0; c < 3; c++) {
        const center = copy[idx + c];
        if (center > 248) continue; // Protect spotless pure-white paper

        const avg3 =
          (copy[idx - stride - 4 + c] +
            copy[idx - stride + c] +
            copy[idx - stride + 4 + c] +
            copy[idx - 4 + c] +
            copy[idx + 4 + c] +
            copy[idx + stride - 4 + c] +
            copy[idx + stride + c] +
            copy[idx + stride + 4 + c]) *
          0.125;

        let delta = 0;
        const d1 = center - avg3;
        if (Math.abs(d1) > threshold) {
          delta += d1 * fineAmount;
        }

        if (blur2) {
          const d2 = center - blur2[idx + c];
          if (Math.abs(d2) > threshold + 2) {
            delta += d2 * strokeAmount;
          }
        }

        if (delta !== 0) {
          pixels[idx + c] = clampByte(center + delta);
        }
      }
    }
  }
}

/**
 * Estimates gentle paper white-balance ratios from bright background surface regions
 * for the No Shadow ("Tanpa Bayangan") filter.
 */
function estimatePaperWhiteBalance(
  rPlane: Uint8Array,
  gPlane: Uint8Array,
  bPlane: Uint8Array,
  lumPlane: Uint8Array
): { scaleR: number; scaleG: number; scaleB: number } {
  const n = lumPlane.length;
  const step = Math.max(1, Math.floor(n / 6000));
  const samples: Array<{ lum: number; i: number }> = [];
  for (let i = 0; i < n; i += step) {
    samples.push({ lum: lumPlane[i], i });
  }
  samples.sort((a, b) => a.lum - b.lum);

  const start = Math.floor(samples.length * 0.78);
  const end = Math.max(start + 1, Math.floor(samples.length * 0.96));
  let sr = 0;
  let sg = 0;
  let sb = 0;
  let count = 0;
  for (let k = start; k < end; k++) {
    const idx = samples[k].i;
    sr += rPlane[idx];
    sg += gPlane[idx];
    sb += bPlane[idx];
    count++;
  }

  const mr = sr / Math.max(1, count);
  const mg = sg / Math.max(1, count);
  const mb = sb / Math.max(1, count);
  const target = Math.max(mr, mg, mb, 120);

  const clampScale = (v: number) => Math.max(0.84, Math.min(1.22, v));
  return {
    scaleR: 1 + (clampScale(target / Math.max(40, mr)) - 1) * 0.62,
    scaleG: 1 + (clampScale(target / Math.max(40, mg)) - 1) * 0.62,
    scaleB: 1 + (clampScale(target / Math.max(40, mb)) - 1) * 0.62,
  };
}

/**
 * Applies the selected CamScanner-grade document enhancement preset to an RGBA buffer.
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

  // ── 2. MAGIC COLOR ("Ajaib" — pure-color): Pure white paper + CLAHE ink punch + vivid colors ──
  if (preset === 'pure-color') {
    const rPlane = new Uint8Array(numPixels);
    const gPlane = new Uint8Array(numPixels);
    const bPlane = new Uint8Array(numPixels);

    for (let i = 0, p = 0; i < numPixels; i++, p += 4) {
      rPlane[i] = src[p];
      gPlane[i] = src[p + 1];
      bPlane[i] = src[p + 2];
    }

    const bgR = estimateBackgroundPlane(rPlane, width, height, 0.02, 1);
    const bgG = estimateBackgroundPlane(gPlane, width, height, 0.02, 1);
    const bgB = estimateBackgroundPlane(bPlane, width, height, 0.02, 1);

    const normR = new Float32Array(numPixels);
    const normG = new Float32Array(numPixels);
    const normB = new Float32Array(numPixels);
    const normLum = new Float32Array(numPixels);

    for (let y = 0; y < height; y++) {
      const rowStart = y * width;
      for (let x = 0; x < width; x++) {
        const i = rowStart + x;
        const r0 = rPlane[i];
        const g0 = gPlane[i];
        const b0 = bPlane[i];

        const dr = (r0 / sampleBgBilinear(bgR, x, y)) * 255;
        const dg = (g0 / sampleBgBilinear(bgG, x, y)) * 255;
        const db = (b0 / sampleBgBilinear(bgB, x, y)) * 255;

        const r = r0 + (dr - r0) * strength;
        const g = g0 + (dg - g0) * strength;
        const b = b0 + (db - b0) * strength;

        normR[i] = r;
        normG[i] = g;
        normB[i] = b;
        normLum[i] = 0.299 * r + 0.587 * g + 0.114 * b;
      }
    }

    const tone = computeLocalToneGrid(normLum, width, height);

    for (let y = 0; y < height; y++) {
      const gy = y * tone.scaleY;
      const gy0 = Math.min(tone.gh - 1, gy | 0);
      const gy1 = Math.min(tone.gh - 1, gy0 + 1);
      const fy = gy - gy0;
      const rowStart = y * width;

      for (let x = 0; x < width; x++) {
        const gx = x * tone.scaleX;
        const gx0 = Math.min(tone.gw - 1, gx | 0);
        const gx1 = Math.min(tone.gw - 1, gx0 + 1);
        const fx = gx - gx0;

        const t00 = gy0 * tone.gw + gx0;
        const t10 = gy0 * tone.gw + gx1;
        const t01 = gy1 * tone.gw + gx0;
        const t11 = gy1 * tone.gw + gx1;

        const w00 = (1 - fx) * (1 - fy);
        const w10 = fx * (1 - fy);
        const w01 = (1 - fx) * fy;
        const w11 = fx * fy;

        const blk =
          tone.black[t00] * w00 +
          tone.black[t10] * w10 +
          tone.black[t01] * w01 +
          tone.black[t11] * w11;
        const wht =
          tone.white[t00] * w00 +
          tone.white[t10] * w10 +
          tone.white[t01] * w01 +
          tone.white[t11] * w11;
        const invRange = 255 / Math.max(96, wht - blk);

        const i = rowStart + x;
        const p = i * 4;

        let r = (normR[i] - blk) * invRange;
        let g = (normG[i] - blk) * invRange;
        let b = (normB[i] - blk) * invRange;

        // Crisp Magic Color push: user adjustments + subtle ink darkening below 150
        r = (r - 128) * contrastFactor + 128 + brightShift;
        g = (g - 128) * contrastFactor + 128 + brightShift;
        b = (b - 128) * contrastFactor + 128 + brightShift;

        const lum = 0.299 * r + 0.587 * g + 0.114 * b;
        const maxC = r > g ? (r > b ? r : b) : g > b ? g : b;
        const minC = r < g ? (r < b ? r : b) : g < b ? g : b;
        const chroma = maxC - minC;

        // Color-selective saturation boost: keep neutral text crisp & dark, make ink/stamps pop
        if (lum < 245) {
          const chromaBlend = chroma <= 12 ? 0 : chroma >= 32 ? 1 : (chroma - 12) / 20;
          const satBoost = 1 + 0.34 * chromaBlend;
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

    applyDualRadiusSharpen(out, width, height, 0.42, 0.20, 6);
    return out;
  }

  // ── 3. NO SHADOW ("Tanpa Bayangan"): Neutralizes shadows & color cast while keeping natural tones & photos ──
  if (preset === 'no-shadow') {
    const rPlane = new Uint8Array(numPixels);
    const gPlane = new Uint8Array(numPixels);
    const bPlane = new Uint8Array(numPixels);
    const lumPlane = new Uint8Array(numPixels);

    for (let i = 0, p = 0; i < numPixels; i++, p += 4) {
      const r = src[p];
      const g = src[p + 1];
      const b = src[p + 2];
      rPlane[i] = r;
      gPlane[i] = g;
      bPlane[i] = b;
      lumPlane[i] = (0.299 * r + 0.587 * g + 0.114 * b + 0.5) | 0;
    }

    // Per-channel closing removes cool/warm shadow color casts cleanly without clipping natural midtones
    const bgR = estimateBackgroundPlane(rPlane, width, height, 0.022, 1);
    const bgG = estimateBackgroundPlane(gPlane, width, height, 0.022, 1);
    const bgB = estimateBackgroundPlane(bPlane, width, height, 0.022, 1);
    const bgLum = estimateBackgroundPlane(lumPlane, width, height, 0.024, 1);
    const wb = estimatePaperWhiteBalance(rPlane, gPlane, bPlane, lumPlane);

    const blackPt = 10;
    const whitePt = 238;
    const invRange = 255 / (whitePt - blackPt);

    for (let y = 0; y < height; y++) {
      const rowStart = y * width;
      for (let x = 0; x < width; x++) {
        const i = rowStart + x;
        const p = i * 4;

        const r0 = rPlane[i];
        const g0 = gPlane[i];
        const b0 = bPlane[i];

        const lumGain = Math.min(4.5, 246 / sampleBgBilinear(bgLum, x, y));
        const chanR = Math.min(4.5 * 246, (r0 / sampleBgBilinear(bgR, x, y)) * 246);
        const chanG = Math.min(4.5 * 246, (g0 / sampleBgBilinear(bgG, x, y)) * 246);
        const chanB = Math.min(4.5 * 246, (b0 / sampleBgBilinear(bgB, x, y)) * 246);

        const nr = chanR * 0.78 + r0 * lumGain * wb.scaleR * 0.22;
        const ng = chanG * 0.78 + g0 * lumGain * wb.scaleG * 0.22;
        const nb = chanB * 0.78 + b0 * lumGain * wb.scaleB * 0.22;

        let r = r0 + (nr - r0) * strength;
        let g = g0 + (ng - g0) * strength;
        let b = b0 + (nb - b0) * strength;

        r = (r - blackPt) * invRange;
        g = (g - blackPt) * invRange;
        b = (b - blackPt) * invRange;

        r = (r - 128) * contrastFactor + 128 + brightShift;
        g = (g - 128) * contrastFactor + 128 + brightShift;
        b = (b - 128) * contrastFactor + 128 + brightShift;

        const lum = 0.299 * r + 0.587 * g + 0.114 * b;
        if (lum < 246) {
          const sat = 1.07;
          r = lum + (r - lum) * sat;
          g = lum + (g - lum) * sat;
          b = lum + (b - lum) * sat;
        }

        out[p] = clampByte(r);
        out[p + 1] = clampByte(g);
        out[p + 2] = clampByte(b);
        out[p + 3] = 255;
      }
    }

    applyDualRadiusSharpen(out, width, height, 0.30, 0.12, 8);
    return out;
  }

  // ── 4 & 5. PURE B&W & GRAYSCALE (Single luminance plane -> fast & sharp) ──
  const lumPlane = new Uint8Array(numPixels);
  for (let i = 0, p = 0; i < numPixels; i++, p += 4) {
    lumPlane[i] = (0.299 * src[p] + 0.587 * src[p + 1] + 0.114 * src[p + 2] + 0.5) | 0;
  }

  const bgLum = estimateBackgroundPlane(lumPlane, width, height, 0.02, 1);

  if (preset === 'pure-bw') {
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
          t = t * t * (3 - 2 * t);
        }

        const v = (t * 255 + 0.5) | 0;
        out[p] = v;
        out[p + 1] = v;
        out[p + 2] = v;
        out[p + 3] = 255;
      }
    }

    applyDualRadiusSharpen(out, width, height, 0.34, 0.14, 9);
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

  applyDualRadiusSharpen(out, width, height, 0.28, 0.10, 8);
  return out;
}
