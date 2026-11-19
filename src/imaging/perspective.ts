import type { AspectMode, Point, Quad, Rotation } from '../types/scan';

export const A4_RATIO = 210 / 297; // ~0.70707
export const LETTER_RATIO = 8.5 / 11; // ~0.77273

/** Default slightly-inset quad so corner handles stay away from mobile edge-swipe zones */
export function createDefaultQuad(inset = 0.05): Quad {
  const min = Math.max(0, Math.min(0.25, inset));
  const max = 1 - min;
  return [
    { x: min, y: min },
    { x: max, y: min },
    { x: max, y: max },
    { x: min, y: max },
  ];
}

export function createFullQuad(): Quad {
  return [
    { x: 0, y: 0 },
    { x: 1, y: 0 },
    { x: 1, y: 1 },
    { x: 0, y: 1 },
  ];
}

export function clampPoint(p: Point): Point {
  return {
    x: Math.max(0, Math.min(1, p.x)),
    y: Math.max(0, Math.min(1, p.y)),
  };
}

/**
 * Checks whether the 4 normalized points form a strictly convex, clockwise quad
 * (TL -> TR -> BR -> BL in screen coordinates where +Y points down) with minimum area.
 */
export function isConvexQuad(quad: Quad, minArea = 0.005): boolean {
  let area2 = 0;
  for (let i = 0; i < 4; i++) {
    const a = quad[i];
    const b = quad[(i + 1) % 4];
    const c = quad[(i + 2) % 4];
    const abx = b.x - a.x;
    const aby = b.y - a.y;
    const bcx = c.x - b.x;
    const bcy = c.y - b.y;
    const cross = abx * bcy - aby * bcx;
    // In screen coordinates (+X right, +Y down), clockwise winding gives cross > 0
    if (cross <= 1e-5) return false;
    area2 += a.x * b.y - b.x * a.y;
  }
  return Math.abs(area2) * 0.5 >= minArea;
}

/**
 * Computes destination output dimensions for a warped quad, optionally locking
 * to A4 or Letter proportions while preserving portrait vs landscape orientation.
 */
export function computeTargetSize(
  quad: Quad,
  srcW: number,
  srcH: number,
  aspectMode: AspectMode = 'auto',
  maxDim = 2200
): { width: number; height: number } {
  const [tl, tr, br, bl] = quad.map((p) => ({ x: p.x * srcW, y: p.y * srcH }));

  const widthTop = Math.hypot(tr.x - tl.x, tr.y - tl.y);
  const widthBottom = Math.hypot(br.x - bl.x, br.y - bl.y);
  const heightLeft = Math.hypot(bl.x - tl.x, bl.y - tl.y);
  const heightRight = Math.hypot(br.x - tr.x, br.y - tr.y);

  let outW = Math.max(widthTop, widthBottom, 32);
  let outH = Math.max(heightLeft, heightRight, 32);

  if (aspectMode === 'a4' || aspectMode === 'letter') {
    const shortToLong = aspectMode === 'a4' ? A4_RATIO : LETTER_RATIO;
    if (outH >= outW) {
      // Portrait
      outW = outH * shortToLong;
    } else {
      // Landscape
      outH = outW * shortToLong;
    }
  }

  const longest = Math.max(outW, outH);
  if (longest > maxDim) {
    const scale = maxDim / longest;
    outW *= scale;
    outH *= scale;
  }

  return {
    width: Math.max(32, Math.round(outW)),
    height: Math.max(32, Math.round(outH)),
  };
}

/**
 * Solves an N x N linear system Ax = b using Gaussian elimination with partial pivoting.
 */
function solveLinearSystem(A: number[][], b: number[]): number[] {
  const n = b.length;
  const M = A.map((row, i) => [...row, b[i]]);

  for (let col = 0; col < n; col++) {
    // Partial pivoting
    let pivotRow = col;
    let maxAbs = Math.abs(M[col][col]);
    for (let r = col + 1; r < n; r++) {
      const val = Math.abs(M[r][col]);
      if (val > maxAbs) {
        maxAbs = val;
        pivotRow = r;
      }
    }

    if (maxAbs < 1e-12) {
      throw new Error('Singular matrix in homography solve — corners may be collinear.');
    }

    if (pivotRow !== col) {
      const tmp = M[col];
      M[col] = M[pivotRow];
      M[pivotRow] = tmp;
    }

    const pivot = M[col][col];
    for (let c = col; c <= n; c++) {
      M[col][c] /= pivot;
    }

    for (let r = 0; r < n; r++) {
      if (r === col) continue;
      const factor = M[r][col];
      if (factor === 0) continue;
      for (let c = col; c <= n; c++) {
        M[r][c] -= factor * M[col][c];
      }
    }
  }

  return M.map((row) => row[n]);
}

/**
 * Computes the 3x3 inverse homography matrix mapping destination pixel (dx, dy)
 * in [0..dstW-1] x [0..dstH-1] to source pixel (sx, sy) inside the quad.
 * Returns [h0, h1, h2, h3, h4, h5, h6, h7, 1].
 */
export function solveHomography(
  srcQuadPx: [Point, Point, Point, Point],
  dstW: number,
  dstH: number
): Float64Array {
  const w = Math.max(1, dstW - 1);
  const h = Math.max(1, dstH - 1);

  const dstCorners: [Point, Point, Point, Point] = [
    { x: 0, y: 0 },
    { x: w, y: 0 },
    { x: w, y: h },
    { x: 0, y: h },
  ];

  const A: number[][] = [];
  const b: number[] = [];

  for (let i = 0; i < 4; i++) {
    const u = dstCorners[i].x;
    const v = dstCorners[i].y;
    const x = srcQuadPx[i].x;
    const y = srcQuadPx[i].y;

    A.push([u, v, 1, 0, 0, 0, -u * x, -v * x]);
    b.push(x);

    A.push([0, 0, 0, u, v, 1, -u * y, -v * y]);
    b.push(y);
  }

  const sol = solveLinearSystem(A, b);
  return new Float64Array([sol[0], sol[1], sol[2], sol[3], sol[4], sol[5], sol[6], sol[7], 1]);
}

/**
 * Maps a normalized point [0..1] in original image coordinates to visually rotated display coordinates.
 */
export function rotatePointCw(p: Point, rotation: Rotation): Point {
  switch (rotation) {
    case 90:
      return { x: 1 - p.y, y: p.x };
    case 180:
      return { x: 1 - p.x, y: 1 - p.y };
    case 270:
      return { x: p.y, y: 1 - p.x };
    default:
      return { x: p.x, y: p.y };
  }
}

/**
 * Inverse of rotatePointCw: maps a normalized point in visually rotated display coordinates
 * back to original unrotated image coordinates.
 */
export function unrotatePointCw(p: Point, rotation: Rotation): Point {
  const inv = ((360 - rotation) % 360) as Rotation;
  return rotatePointCw(p, inv);
}

/**
 * Perspective-warps an RGBA pixel buffer from the normalized 4-corner quad
 * into a rectangular output buffer of size (dstW x dstH).
 *
 * Uses fast bilinear sampling for live previews (highQuality = false) and
 * Catmull-Rom bicubic (4x4) interpolation for crisp text on full-resolution saves.
 */
export function warpPerspective(
  src: Uint8ClampedArray,
  srcW: number,
  srcH: number,
  quad: Quad,
  dstW: number,
  dstH: number,
  highQuality = false
): Uint8ClampedArray {
  const maxSrcX = Math.max(0, srcW - 1);
  const maxSrcY = Math.max(0, srcH - 1);

  const srcQuadPx: [Point, Point, Point, Point] = [
    { x: quad[0].x * maxSrcX, y: quad[0].y * maxSrcY },
    { x: quad[1].x * maxSrcX, y: quad[1].y * maxSrcY },
    { x: quad[2].x * maxSrcX, y: quad[2].y * maxSrcY },
    { x: quad[3].x * maxSrcX, y: quad[3].y * maxSrcY },
  ];

  const H = solveHomography(srcQuadPx, dstW, dstH);
  const h0 = H[0], h1 = H[1], h2 = H[2];
  const h3 = H[3], h4 = H[4], h5 = H[5];
  const h6 = H[6], h7 = H[7];

  const dst = new Uint8ClampedArray(dstW * dstH * 4);
  const srcStride = srcW * 4;

  if (!highQuality) {
    let dstIdx = 0;
    for (let dy = 0; dy < dstH; dy++) {
      let numX = h1 * dy + h2;
      let numY = h4 * dy + h5;
      let den = h7 * dy + 1;

      for (let dx = 0; dx < dstW; dx++) {
        const invDen = 1 / den;
        let sx = numX * invDen;
        let sy = numY * invDen;

        if (sx < 0) sx = 0;
        else if (sx > maxSrcX) sx = maxSrcX;
        if (sy < 0) sy = 0;
        else if (sy > maxSrcY) sy = maxSrcY;

        const x0 = sx | 0;
        const y0 = sy | 0;
        const x1 = x0 < maxSrcX ? x0 + 1 : maxSrcX;
        const y1 = y0 < maxSrcY ? y0 + 1 : maxSrcY;

        const fx = sx - x0;
        const fy = sy - y0;
        const ifx = 1 - fx;
        const ify = 1 - fy;

        const w00 = ifx * ify;
        const w10 = fx * ify;
        const w01 = ifx * fy;
        const w11 = fx * fy;

        const row0 = y0 * srcStride;
        const row1 = y1 * srcStride;
        const i00 = row0 + x0 * 4;
        const i10 = row0 + x1 * 4;
        const i01 = row1 + x0 * 4;
        const i11 = row1 + x1 * 4;

        dst[dstIdx] = src[i00] * w00 + src[i10] * w10 + src[i01] * w01 + src[i11] * w11 + 0.5;
        dst[dstIdx + 1] =
          src[i00 + 1] * w00 + src[i10 + 1] * w10 + src[i01 + 1] * w01 + src[i11 + 1] * w11 + 0.5;
        dst[dstIdx + 2] =
          src[i00 + 2] * w00 + src[i10 + 2] * w10 + src[i01 + 2] * w01 + src[i11 + 2] * w11 + 0.5;
        dst[dstIdx + 3] = 255;

        dstIdx += 4;
        numX += h0;
        numY += h3;
        den += h6;
      }
    }

    return dst;
  }

  // High-quality Catmull-Rom bicubic (4x4 taps) for sharp text strokes on full-res save
  let dstIdx = 0;
  for (let dy = 0; dy < dstH; dy++) {
    let numX = h1 * dy + h2;
    let numY = h4 * dy + h5;
    let den = h7 * dy + 1;

    for (let dx = 0; dx < dstW; dx++) {
      const invDen = 1 / den;
      let sx = numX * invDen;
      let sy = numY * invDen;

      if (sx < 0) sx = 0;
      else if (sx > maxSrcX) sx = maxSrcX;
      if (sy < 0) sy = 0;
      else if (sy > maxSrcY) sy = maxSrcY;

      const ix = sx | 0;
      const iy = sy | 0;
      const fx = sx - ix;
      const fy = sy - iy;

      const fx2 = fx * fx;
      const fx3 = fx2 * fx;
      const wx0 = -0.5 * fx + fx2 - 0.5 * fx3;
      const wx1 = 1 - 2.5 * fx2 + 1.5 * fx3;
      const wx2 = 0.5 * fx + 2 * fx2 - 1.5 * fx3;
      const wx3 = -0.5 * fx2 + 0.5 * fx3;

      const fy2 = fy * fy;
      const fy3 = fy2 * fy;
      const wy0 = -0.5 * fy + fy2 - 0.5 * fy3;
      const wy1 = 1 - 2.5 * fy2 + 1.5 * fy3;
      const wy2 = 0.5 * fy + 2 * fy2 - 1.5 * fy3;
      const wy3 = -0.5 * fy2 + 0.5 * fy3;

      const x0 = ix > 0 ? ix - 1 : 0;
      const x1 = ix;
      const x2 = ix + 1 <= maxSrcX ? ix + 1 : maxSrcX;
      const x3 = ix + 2 <= maxSrcX ? ix + 2 : maxSrcX;

      const y0 = iy > 0 ? iy - 1 : 0;
      const y1 = iy;
      const y2 = iy + 1 <= maxSrcY ? iy + 1 : maxSrcY;
      const y3 = iy + 2 <= maxSrcY ? iy + 2 : maxSrcY;

      const r0 = y0 * srcStride;
      const r1 = y1 * srcStride;
      const r2 = y2 * srcStride;
      const r3 = y3 * srcStride;

      const ox0 = x0 * 4;
      const ox1 = x1 * 4;
      const ox2 = x2 * 4;
      const ox3 = x3 * 4;

      for (let c = 0; c < 3; c++) {
        const v0 =
          src[r0 + ox0 + c] * wx0 +
          src[r0 + ox1 + c] * wx1 +
          src[r0 + ox2 + c] * wx2 +
          src[r0 + ox3 + c] * wx3;
        const v1 =
          src[r1 + ox0 + c] * wx0 +
          src[r1 + ox1 + c] * wx1 +
          src[r1 + ox2 + c] * wx2 +
          src[r1 + ox3 + c] * wx3;
        const v2 =
          src[r2 + ox0 + c] * wx0 +
          src[r2 + ox1 + c] * wx1 +
          src[r2 + ox2 + c] * wx2 +
          src[r2 + ox3 + c] * wx3;
        const v3 =
          src[r3 + ox0 + c] * wx0 +
          src[r3 + ox1 + c] * wx1 +
          src[r3 + ox2 + c] * wx2 +
          src[r3 + ox3 + c] * wx3;

        const val = v0 * wy0 + v1 * wy1 + v2 * wy2 + v3 * wy3;
        dst[dstIdx + c] = val <= 0 ? 0 : val >= 255 ? 255 : (val + 0.5) | 0;
      }
      dst[dstIdx + 3] = 255;

      dstIdx += 4;
      numX += h0;
      numY += h3;
      den += h6;
    }
  }

  return dst;
}

/**
 * Rotates an RGBA image buffer clockwise by 0, 90, 180, or 270 degrees.
 */
export function rotateImageBuffer(
  src: Uint8ClampedArray,
  width: number,
  height: number,
  rotation: Rotation
): { pixels: Uint8ClampedArray; width: number; height: number } {
  if (rotation === 0) {
    return { pixels: src, width, height };
  }

  if (rotation === 180) {
    const out = new Uint8ClampedArray(src.length);
    const total = width * height;
    for (let i = 0; i < total; i++) {
      const s = i * 4;
      const d = (total - 1 - i) * 4;
      out[d] = src[s];
      out[d + 1] = src[s + 1];
      out[d + 2] = src[s + 2];
      out[d + 3] = 255;
    }
    return { pixels: out, width, height };
  }

  const outW = height;
  const outH = width;
  const out = new Uint8ClampedArray(outW * outH * 4);

  if (rotation === 90) {
    for (let y = 0; y < height; y++) {
      const dstX = height - 1 - y;
      const rowOffset = y * width;
      for (let x = 0; x < width; x++) {
        const s = (rowOffset + x) * 4;
        const d = (x * outW + dstX) * 4;
        out[d] = src[s];
        out[d + 1] = src[s + 1];
        out[d + 2] = src[s + 2];
        out[d + 3] = 255;
      }
    }
    return { pixels: out, width: outW, height: outH };
  }

  // rotation === 270 (90 deg counter-clockwise)
  for (let y = 0; y < height; y++) {
    const rowOffset = y * width;
    for (let x = 0; x < width; x++) {
      const dstY = width - 1 - x;
      const s = (rowOffset + x) * 4;
      const d = (dstY * outW + y) * 4;
      out[d] = src[s];
      out[d + 1] = src[s + 1];
      out[d + 2] = src[s + 2];
      out[d + 3] = 255;
    }
  }
  return { pixels: out, width: outW, height: outH };
}
