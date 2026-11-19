import type {
  AspectMode,
  CameraGuideId,
  DetectDocumentOptions,
  DocumentDetectionResult,
  GuideOrientation,
  Point,
  Quad,
} from '../types/scan';
import {
  A4_RATIO,
  clampPoint,
  createDefaultQuad,
  F4_RATIO,
  ID_CARD_RATIO,
  isConvexQuad,
  LEGAL_RATIO,
  LETTER_RATIO,
} from './perspective';

export interface CameraGuidePreset {
  id: CameraGuideId;
  label: string;
  dimensionsLabel: string;
  shortToLong: number | null;
  defaultOrientation: GuideOrientation;
  fillRatio: number;
  cropAspectMode: AspectMode;
}

export const CAMERA_GUIDE_PRESETS: CameraGuidePreset[] = [
  {
    id: 'a4',
    label: 'A4',
    dimensionsLabel: '210×297',
    shortToLong: A4_RATIO,
    defaultOrientation: 'auto',
    fillRatio: 0.84,
    cropAspectMode: 'auto',
  },
  {
    id: 'f4',
    label: 'F4',
    dimensionsLabel: '215×330',
    shortToLong: F4_RATIO,
    defaultOrientation: 'auto',
    fillRatio: 0.84,
    cropAspectMode: 'f4',
  },
  {
    id: 'letter',
    label: 'Letter',
    dimensionsLabel: '8.5×11',
    shortToLong: LETTER_RATIO,
    defaultOrientation: 'auto',
    fillRatio: 0.84,
    cropAspectMode: 'letter',
  },
  {
    id: 'legal',
    label: 'Legal',
    dimensionsLabel: '8.5×14',
    shortToLong: LEGAL_RATIO,
    defaultOrientation: 'auto',
    fillRatio: 0.84,
    cropAspectMode: 'legal',
  },
  {
    id: 'id-card',
    label: 'ID Card',
    dimensionsLabel: '86×54',
    shortToLong: ID_CARD_RATIO,
    defaultOrientation: 'landscape',
    fillRatio: 0.78,
    cropAspectMode: 'id-card',
  },
  {
    id: 'free',
    label: 'Free',
    dimensionsLabel: 'FULL',
    shortToLong: null,
    defaultOrientation: 'auto',
    fillRatio: 0.92,
    cropAspectMode: 'auto',
  },
];

/**
 * Computes an exact normalized guide quad centered within a frame of (frameWidth x frameHeight)
 * for any supported document preset (A4, F4, Letter, Legal, ID Card, or Free).
 */
export function computeDocumentGuideQuad(
  frameWidth: number,
  frameHeight: number,
  guideId: CameraGuideId = 'a4',
  orientation: GuideOrientation = 'auto',
  fillRatioOverride?: number
): Quad {
  const safeW = Math.max(1, frameWidth);
  const safeH = Math.max(1, frameHeight);
  const preset = CAMERA_GUIDE_PRESETS.find((g) => g.id === guideId) ?? CAMERA_GUIDE_PRESETS[0];

  if (preset.shortToLong === null) {
    return createDefaultQuad(0.04);
  }

  const ratio = Math.max(0.4, Math.min(0.96, fillRatioOverride ?? preset.fillRatio));
  const resolvedOrientation =
    orientation === 'auto'
      ? preset.defaultOrientation === 'auto'
        ? safeH >= safeW
          ? 'portrait'
          : 'landscape'
        : preset.defaultOrientation
      : orientation;

  const targetAspect =
    resolvedOrientation === 'portrait' ? preset.shortToLong : 1 / preset.shortToLong;

  const maxW = safeW * ratio;
  const maxH = safeH * ratio;

  let guideW: number;
  let guideH: number;
  if (maxW / maxH > targetAspect) {
    guideH = maxH;
    guideW = guideH * targetAspect;
  } else {
    guideW = maxW;
    guideH = guideW / targetAspect;
  }

  const halfW = Math.min(0.49, (guideW / safeW) * 0.5);
  const halfH = Math.min(0.49, (guideH / safeH) * 0.5);

  return [
    { x: 0.5 - halfW, y: 0.5 - halfH },
    { x: 0.5 + halfW, y: 0.5 - halfH },
    { x: 0.5 + halfW, y: 0.5 + halfH },
    { x: 0.5 - halfW, y: 0.5 + halfH },
  ];
}

/**
 * Computes a mathematically exact A4 (210:297 portrait, 297:210 landscape) normalized quad
 * centered within a frame of dimensions (frameWidth x frameHeight).
 */
export function computeA4GuideQuad(
  frameWidth: number,
  frameHeight: number,
  fillRatio = 0.84
): Quad {
  return computeDocumentGuideQuad(frameWidth, frameHeight, 'a4', 'auto', fillRatio);
}

/**
 * Exponentially smooths quad corner motion for jitter-free live viewfinder overlays.
 */
export function smoothQuad(prev: Quad | null, next: Quad, alpha = 0.35): Quad {
  if (!prev) {
    return next.map((p) => ({ ...p })) as Quad;
  }
  const a = Math.max(0.05, Math.min(1, alpha));
  const out = prev.map((p, i) => ({
    x: p.x + (next[i].x - p.x) * a,
    y: p.y + (next[i].y - p.y) * a,
  })) as Quad;
  return isConvexQuad(out, 0.04) ? out : (next.map((p) => ({ ...p })) as Quad);
}

/**
 * Orders 4 arbitrary 2D points clockwise starting from top-left: [TL, TR, BR, BL].
 */
export function orderQuadClockwise(pts: [Point, Point, Point, Point]): Quad {
  let cx = 0;
  let cy = 0;
  for (const p of pts) {
    cx += p.x;
    cy += p.y;
  }
  cx *= 0.25;
  cy *= 0.25;

  const sorted = [...pts].sort((a, b) => {
    const angA = Math.atan2(a.y - cy, a.x - cx);
    const angB = Math.atan2(b.y - cy, b.x - cx);
    return angA - angB;
  });

  let tlIdx = 0;
  let bestSum = Infinity;
  for (let i = 0; i < 4; i++) {
    const s = sorted[i].x + sorted[i].y;
    if (s < bestSum) {
      bestSum = s;
      tlIdx = i;
    }
  }

  return [
    sorted[tlIdx],
    sorted[(tlIdx + 1) % 4],
    sorted[(tlIdx + 2) % 4],
    sorted[(tlIdx + 3) % 4],
  ];
}

function morph1D(
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
            if (src[row + k] > best) best = src[row + k];
          }
        } else {
          for (let k = x0 + 1; k <= x1; k++) {
            if (src[row + k] < best) best = src[row + k];
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
            if (src[k * w + x] > best) best = src[k * w + x];
          }
        } else {
          for (let k = y0 + 1; k <= y1; k++) {
            if (src[k * w + x] < best) best = src[k * w + x];
          }
        }
        dst[y * w + x] = best;
      }
    }
  }
}

function gaussian3x3(src: Float32Array, w: number, h: number): Float32Array {
  const dst = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    const ym = y > 0 ? y - 1 : 0;
    const yp = y + 1 < h ? y + 1 : h - 1;
    for (let x = 0; x < w; x++) {
      const xm = x > 0 ? x - 1 : 0;
      const xp = x + 1 < w ? x + 1 : w - 1;
      dst[y * w + x] =
        (src[ym * w + xm] +
          2 * src[ym * w + x] +
          src[ym * w + xp] +
          2 * src[y * w + xm] +
          4 * src[y * w + x] +
          2 * src[y * w + xp] +
          src[yp * w + xm] +
          2 * src[yp * w + x] +
          src[yp * w + xp]) *
        0.0625;
    }
  }
  return dst;
}

function computeSobel(
  src: Float32Array,
  w: number,
  h: number
): { gx: Float32Array; gy: Float32Array } {
  const n = w * h;
  const gx = new Float32Array(n);
  const gy = new Float32Array(n);
  for (let y = 1; y < h - 1; y++) {
    const r0 = (y - 1) * w;
    const r1 = y * w;
    const r2 = (y + 1) * w;
    for (let x = 1; x < w - 1; x++) {
      const idx = r1 + x;
      gx[idx] =
        -src[r0 + x - 1] +
        src[r0 + x + 1] -
        2 * src[r1 + x - 1] +
        2 * src[r1 + x + 1] -
        src[r2 + x - 1] +
        src[r2 + x + 1];
      gy[idx] =
        -src[r0 + x - 1] -
        2 * src[r0 + x] -
        src[r0 + x + 1] +
        src[r2 + x - 1] +
        2 * src[r2 + x] +
        src[r2 + x + 1];
    }
  }
  return { gx, gy };
}

function buildIntegral(src: Float32Array, w: number, h: number): Float64Array {
  const sw = w + 1;
  const sat = new Float64Array(sw * (h + 1));
  for (let y = 0; y < h; y++) {
    let rowSum = 0;
    const srcRow = y * w;
    const prevRow = y * sw;
    const curRow = (y + 1) * sw;
    for (let x = 0; x < w; x++) {
      rowSum += src[srcRow + x];
      sat[curRow + x + 1] = sat[prevRow + x + 1] + rowSum;
    }
  }
  return sat;
}

function otsuThreshold(values: Float32Array): number {
  const hist = new Uint32Array(256);
  const n = values.length;
  for (let i = 0; i < n; i++) {
    const v = values[i] <= 0 ? 0 : values[i] >= 255 ? 255 : (values[i] + 0.5) | 0;
    hist[v]++;
  }

  let sum = 0;
  for (let t = 0; t < 256; t++) sum += t * hist[t];

  let sumB = 0;
  let wB = 0;
  let maxVar = -1;
  let bestT = 128;

  for (let t = 0; t < 256; t++) {
    wB += hist[t];
    if (wB === 0) continue;
    const wF = n - wB;
    if (wF === 0) break;

    sumB += t * hist[t];
    const mB = sumB / wB;
    const mF = (sum - sumB) / wF;
    const diff = mB - mF;
    const varBetween = wB * wF * diff * diff;
    if (varBetween > maxVar) {
      maxVar = varBetween;
      bestT = t;
    }
  }
  return bestT;
}

function quantile(arr: number[], q: number, fallback: number): number {
  if (arr.length === 0) return fallback;
  const sorted = [...arr].sort((a, b) => a - b);
  const idx = Math.max(0, Math.min(sorted.length - 1, Math.floor(sorted.length * q)));
  return sorted[idx];
}

/** Monotone chain 2D convex hull */
function convexHull(points: Point[]): Point[] {
  if (points.length <= 3) return points;
  const sorted = [...points].sort((a, b) => (a.x === b.x ? a.y - b.y : a.x - b.x));
  const cross = (o: Point, a: Point, b: Point) =>
    (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);

  const lower: Point[] = [];
  for (const p of sorted) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) {
      lower.pop();
    }
    lower.push(p);
  }

  const upper: Point[] = [];
  for (let i = sorted.length - 1; i >= 0; i--) {
    const p = sorted[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) {
      upper.pop();
    }
    upper.push(p);
  }

  lower.pop();
  upper.pop();
  return lower.concat(upper);
}

/**
 * Reduces a convex polygon down to 4 corner vertices by iteratively removing
 * the vertex forming the smallest triangle with its neighbors (Visvalingam-Whyatt).
 */
function reduceHullToQuad(hull: Point[]): [Point, Point, Point, Point] | null {
  if (hull.length < 4) return null;
  const poly = [...hull];

  while (poly.length > 4) {
    let minArea = Infinity;
    let minIdx = 0;
    const n = poly.length;
    for (let i = 0; i < n; i++) {
      const a = poly[(i - 1 + n) % n];
      const b = poly[i];
      const c = poly[(i + 1) % n];
      const area = Math.abs((b.x - a.x) * (c.y - a.y) - (c.x - a.x) * (b.y - a.y));
      if (area < minArea) {
        minArea = area;
        minIdx = i;
      }
    }
    poly.splice(minIdx, 1);
  }

  return [poly[0], poly[1], poly[2], poly[3]];
}

/**
 * Extracts candidate 4-corner quads from an arbitrary binary foreground mask
 * via connected-component BFS labeling + Convex Hull + 4-corner reduction.
 */
function extractQuadsFromBinaryMask(
  mask: Uint8Array,
  w: number,
  h: number,
  visited: Uint8Array,
  queue: Int32Array
): Quad[] {
  const n = w * h;
  visited.fill(0);
  const quads: Quad[] = [];
  const minCompPixels = Math.floor(n * 0.075);
  const maxCompPixels = Math.floor(n * 0.96);

  for (let i = 0; i < n; i++) {
    if (mask[i] === 0 || visited[i] !== 0) continue;

    let head = 0;
    let tail = 0;
    queue[tail++] = i;
    visited[i] = 1;

    const boundaryPts: Point[] = [];
    let compCount = 0;

    while (head < tail) {
      const idx = queue[head++];
      compCount++;
      const x = idx % w;
      const y = (idx - x) / w;

      let isBorder = x === 0 || x === w - 1 || y === 0 || y === h - 1;

      if (x > 0) {
        const ni = idx - 1;
        if (mask[ni] === 0) isBorder = true;
        else if (visited[ni] === 0) {
          visited[ni] = 1;
          queue[tail++] = ni;
        }
      }
      if (x + 1 < w) {
        const ni = idx + 1;
        if (mask[ni] === 0) isBorder = true;
        else if (visited[ni] === 0) {
          visited[ni] = 1;
          queue[tail++] = ni;
        }
      }
      if (y > 0) {
        const ni = idx - w;
        if (mask[ni] === 0) isBorder = true;
        else if (visited[ni] === 0) {
          visited[ni] = 1;
          queue[tail++] = ni;
        }
      }
      if (y + 1 < h) {
        const ni = idx + w;
        if (mask[ni] === 0) isBorder = true;
        else if (visited[ni] === 0) {
          visited[ni] = 1;
          queue[tail++] = ni;
        }
      }

      if (isBorder) {
        boundaryPts.push({ x: x / (w - 1), y: y / (h - 1) });
      }
    }

    if (compCount < minCompPixels || compCount > maxCompPixels || boundaryPts.length < 16) {
      continue;
    }

    const hull = convexHull(boundaryPts);
    const reduced = reduceHullToQuad(hull);
    if (!reduced) continue;
    const ordered = orderQuadClockwise(reduced);
    if (isConvexQuad(ordered, 0.06)) {
      quads.push(ordered);
    }
  }

  return quads;
}

interface DetectorFeatures {
  w: number;
  h: number;
  smoothLum: Float32Array;
  closedLum: Float32Array;
  logLum: Float32Array;
  smoothRg: Float32Array;
  smoothBy: Float32Array;
  valley: Float32Array;
  gxLum: Float32Array;
  gyLum: Float32Array;
  gxRg: Float32Array;
  gyRg: Float32Array;
  gxBy: Float32Array;
  gyBy: Float32Array;
  gxVal: Float32Array;
  gyVal: Float32Array;
  edgeEnergy: Float32Array;
  edgeGx: Float32Array;
  edgeGy: Float32Array;
  clutter: Float32Array;
  softText: Float32Array;
  refEdge: number;
  refValley: number;
}

function buildFeatureMaps(
  pixels: Uint8ClampedArray,
  width: number,
  height: number,
  workingMaxDim: number
): DetectorFeatures {
  const maxDim = Math.max(width, height);
  const scale = maxDim > workingMaxDim ? workingMaxDim / maxDim : 1;
  const w = Math.max(24, Math.round(width * scale));
  const h = Math.max(24, Math.round(height * scale));
  const n = w * h;

  const rawLum = new Float32Array(n);
  const rawRg = new Float32Array(n);
  const rawBy = new Float32Array(n);

  for (let y = 0; y < h; y++) {
    const sy = Math.min(height - 1, Math.floor((y + 0.5) / scale));
    const srcRow = sy * width;
    const dstRow = y * w;
    for (let x = 0; x < w; x++) {
      const sx = Math.min(width - 1, Math.floor((x + 0.5) / scale));
      const p = (srcRow + sx) * 4;
      const r = pixels[p];
      const g = pixels[p + 1];
      const b = pixels[p + 2];
      const idx = dstRow + x;
      rawLum[idx] = 0.299 * r + 0.587 * g + 0.114 * b;
      rawRg[idx] = (r - g) * 0.5;
      rawBy[idx] = 0.5 * (r + g) - b;
    }
  }

  // Light 3x3 Gaussian denoise keeps thin 1-3px white-on-white contact seams intact
  const smoothLum = gaussian3x3(rawLum, w, h);
  const smoothRg = gaussian3x3(rawRg, w, h);
  const smoothBy = gaussian3x3(rawBy, w, h);

  // Morphological closing ONLY for text-suppressed masks & Black-Hat contact-seam valley extraction
  const closeRadius = Math.max(2, Math.min(4, Math.round(Math.max(w, h) * 0.011)));
  const bufA = new Float32Array(n);
  const bufB = new Float32Array(n);
  morph1D(rawLum, bufA, w, h, closeRadius, true, true);
  morph1D(bufA, bufB, w, h, closeRadius, false, true);
  morph1D(bufB, bufA, w, h, closeRadius, true, false);
  morph1D(bufA, bufB, w, h, closeRadius, false, false);
  const closedLum = gaussian3x3(bufB, w, h);

  const logLum = new Float32Array(n);
  const valley = new Float32Array(n);
  const scaledRg = new Float32Array(n);
  const scaledBy = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    logLum[i] = Math.log(smoothLum[i] + 16);
    const diff = closedLum[i] - smoothLum[i];
    // Compress valley depth monotonically so thin soft contact shadows register clearly
    valley[i] = diff > 1.5 ? Math.log(1 + diff / 14) : 0;
    scaledRg[i] = smoothRg[i] / 52;
    scaledBy[i] = smoothBy[i] / 52;
  }

  const { gx: gxLum, gy: gyLum } = computeSobel(logLum, w, h);
  const { gx: gxRg, gy: gyRg } = computeSobel(scaledRg, w, h);
  const { gx: gxBy, gy: gyBy } = computeSobel(scaledBy, w, h);
  const { gx: gxVal, gy: gyVal } = computeSobel(valley, w, h);

  const edgeEnergy = new Float32Array(n);
  const edgeGx = new Float32Array(n);
  const edgeGy = new Float32Array(n);
  const energySamples: number[] = [];
  const valleySamples: number[] = [];

  for (let y = 1; y < h - 1; y++) {
    const row = y * w;
    for (let x = 1; x < w - 1; x++) {
      const i = row + x;
      const mLum = Math.hypot(gxLum[i], gyLum[i]);
      const mRg = Math.hypot(gxRg[i], gyRg[i]);
      const mBy = Math.hypot(gxBy[i], gyBy[i]);
      const mChroma = Math.max(mRg, mBy) * 0.85;
      const mVal = Math.hypot(gxVal[i], gyVal[i]) * 0.55;

      // Dominant channel sets the edge normal direction for directed Hough voting
      let bestMag = mLum;
      let dx = gxLum[i];
      let dy = gyLum[i];
      if (mChroma > bestMag) {
        bestMag = mChroma;
        if (mRg >= mBy) {
          dx = gxRg[i];
          dy = gyRg[i];
        } else {
          dx = gxBy[i];
          dy = gyBy[i];
        }
      }
      if (mVal > bestMag) {
        bestMag = mVal;
        dx = gxVal[i];
        dy = gyVal[i];
      }

      const combined = Math.max(mLum, mChroma, mVal) + 0.25 * Math.min(mLum, mChroma + mVal);
      edgeEnergy[i] = combined;
      edgeGx[i] = dx;
      edgeGy[i] = dy;

      if (x >= 3 && x < w - 3 && y >= 3 && y < h - 3 && (x & 1) === 0 && (y & 1) === 0) {
        if (combined > 0.025) energySamples.push(combined);
        if (valley[i] > 0.05) valleySamples.push(valley[i]);
      }
    }
  }

  // Soft-text density map (15x15 window) used strictly for outside-margin text detection
  // in scoreCandidateQuad: single 2px floor grout lines cover <= 0.13, while body paragraphs cover >= 0.28.
  const softStroke = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    softStroke[i] = closedLum[i] - smoothLum[i] > 14 ? 1 : 0;
  }
  const satSoft = buildIntegral(softStroke, w, h);
  const softText = new Float32Array(n);
  const sw = w + 1;
  for (let y = 0; y < h; y++) {
    const row = y * w;
    const sy0 = (y > 7 ? y - 7 : 0) * sw;
    const sy1 = (y + 7 < h ? y + 8 : h) * sw;
    const invSy = 1 / ((y + 7 < h ? y + 7 : h - 1) - (y > 7 ? y - 7 : 0) + 1);
    for (let x = 0; x < w; x++) {
      const sx0 = x > 7 ? x - 7 : 0;
      const sx1 = x + 7 < w ? x + 8 : w;
      softText[row + x] =
        ((satSoft[sy1 + sx1] - satSoft[sy0 + sx1] - satSoft[sy1 + sx0] + satSoft[sy0 + sx0]) *
          invSy) /
        (sx1 - sx0);
    }
  }
  // Dark-ink clutter map (15x15 window): captures printed text/tables (diff > 50)
  // while staying ~0 on soft white-on-white paper contact shadows.
  const inkActive = new Float32Array(n);
  const valleyActive = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const diff = closedLum[i] - smoothLum[i];
    inkActive[i] = diff > 50 ? 1 : 0;
    valleyActive[i] = valley[i] > 0.26 ? 1 : 0;
  }
  const satInk = buildIntegral(inkActive, w, h);
  const satActive = buildIntegral(valleyActive, w, h);
  const clutter = new Float32Array(n);
  for (let y = 0; y < h; y++) {
    const row = y * w;
    const iy0 = (y > 7 ? y - 7 : 0) * sw;
    const iy1 = (y + 7 < h ? y + 8 : h) * sw;
    const invIy = 1 / ((y + 7 < h ? y + 7 : h - 1) - (y > 7 ? y - 7 : 0) + 1);
    const vy0 = (y > 4 ? y - 4 : 0) * sw;
    const vy1 = (y + 4 < h ? y + 5 : h) * sw;
    const invVy = 1 / ((y + 4 < h ? y + 4 : h - 1) - (y > 4 ? y - 4 : 0) + 1);
    for (let x = 0; x < w; x++) {
      const ix0 = x > 7 ? x - 7 : 0;
      const ix1 = x + 7 < w ? x + 8 : w;
      const inkSum =
        satInk[iy1 + ix1] - satInk[iy0 + ix1] - satInk[iy1 + ix0] + satInk[iy0 + ix0];
      const inkDensity = (inkSum * invIy) / (ix1 - ix0);

      const vx0 = x > 4 ? x - 4 : 0;
      const vx1 = x + 4 < w ? x + 5 : w;
      const valSum =
        satActive[vy1 + vx1] - satActive[vy0 + vx1] - satActive[vy1 + vx0] + satActive[vy0 + vx0];
      const valDensity = (valSum * invVy) / (vx1 - vx0);

      clutter[row + x] = Math.min(
        1,
        (inkDensity > 0.13 ? (inkDensity - 0.13) * 4.2 : 0) + (valDensity > 0.34 ? valDensity : 0)
      );
    }
  }

  // Estimate reference contrast from low-clutter perimeter pixels
  const cleanEnergySamples: number[] = [];
  const cleanValleySamples: number[] = [];
  for (let y = 3; y < h - 3; y += 4) {
    const row = y * w;
    for (let x = 3; x < w - 3; x += 4) {
      const i = row + x;
      if (clutter[i] > 0.16) continue;
      if (edgeEnergy[i] > 0.025) cleanEnergySamples.push(edgeEnergy[i]);
      if (valley[i] > 0.04) cleanValleySamples.push(valley[i]);
    }
  }

  const refEdge = Math.max(
    0.09,
    Math.min(0.65, quantile(cleanEnergySamples.length >= 24 ? cleanEnergySamples : energySamples, 0.86, 0.2))
  );
  const refValley = Math.max(
    0.2,
    Math.min(1.0, quantile(cleanValleySamples.length >= 24 ? cleanValleySamples : valleySamples, 0.86, 0.36))
  );

  return {
    w,
    h,
    smoothLum,
    closedLum,
    logLum,
    smoothRg,
    smoothBy,
    valley,
    gxLum,
    gyLum,
    gxRg,
    gyRg,
    gxBy,
    gyBy,
    gxVal,
    gyVal,
    edgeEnergy,
    edgeGx,
    edgeGy,
    clutter,
    softText,
    refEdge,
    refValley,
  };
}

/**
 * Generates foreground masks using multiple complementary cues:
 * global Otsu, adaptive local mean, and center-seeded paper color similarity severed at valley/edge barriers.
 */
function extractAllMaskCandidates(f: DetectorFeatures, hintQuad?: Quad): Quad[] {
  const { w, h, closedLum, smoothRg, smoothBy, valley, edgeEnergy, clutter } = f;
  const n = w * h;
  const quads: Quad[] = [];
  const mask = new Uint8Array(n);
  const visited = new Uint8Array(n);
  const queue = new Int32Array(n);

  const pushThresholdMask = (thresh: number, invert: boolean) => {
    for (let i = 0; i < n; i++) {
      mask[i] = invert ? (closedLum[i] < thresh ? 1 : 0) : closedLum[i] >= thresh ? 1 : 0;
    }
    quads.push(...extractQuadsFromBinaryMask(mask, w, h, visited, queue));
  };

  // 1. Global Otsu masks (classic dark/colored desk)
  const otsu = otsuThreshold(closedLum);
  pushThresholdMask(otsu, false);
  pushThresholdMask(Math.max(24, otsu * 0.62), false);
  pushThresholdMask(otsu, true);

  // 2. Adaptive local mean mask (survives uneven indoor ceiling light)
  const satClosed = buildIntegral(closedLum, w, h);
  const boxRad = Math.max(10, Math.round(Math.min(w, h) * 0.14));
  const valleyCut = f.refValley * 0.68;
  const sw = w + 1;
  mask.fill(0);
  for (let y = 0; y < h; y++) {
    const row = y * w;
    const y0 = y > boxRad ? y - boxRad : 0;
    const y1 = y + boxRad < h ? y + boxRad + 1 : h;
    const satY0 = y0 * sw;
    const satY1 = y1 * sw;
    const invH = 1 / (y1 - y0);
    for (let x = 0; x < w; x++) {
      const i = row + x;
      if (clutter[i] < 0.28 && valley[i] > valleyCut) continue;
      const x0 = x > boxRad ? x - boxRad : 0;
      const x1 = x + boxRad < w ? x + boxRad + 1 : w;
      const sum = satClosed[satY1 + x1] - satClosed[satY0 + x1] - satClosed[satY1 + x0] + satClosed[satY0 + x0];
      const localAvg = (sum * invH) / (x1 - x0);
      if (closedLum[i] >= localAvg + 4) {
        mask[i] = 1;
      }
    }
  }
  quads.push(...extractQuadsFromBinaryMask(mask, w, h, visited, queue));

  // 3. Center-seeded paper color/tint similarity severed by perimeter barriers
  const seedSamplesLum: number[] = [];
  const seedSamplesRg: number[] = [];
  const seedSamplesBy: number[] = [];
  let cx0 = Math.floor(w * 0.34);
  let cx1 = Math.ceil(w * 0.66);
  let cy0 = Math.floor(h * 0.34);
  let cy1 = Math.ceil(h * 0.66);
  if (hintQuad) {
    const hcx = (hintQuad[0].x + hintQuad[1].x + hintQuad[2].x + hintQuad[3].x) * 0.25;
    const hcy = (hintQuad[0].y + hintQuad[1].y + hintQuad[2].y + hintQuad[3].y) * 0.25;
    cx0 = Math.max(2, Math.floor((hcx - 0.14) * w));
    cx1 = Math.min(w - 2, Math.ceil((hcx + 0.14) * w));
    cy0 = Math.max(2, Math.floor((hcy - 0.14) * h));
    cy1 = Math.min(h - 2, Math.ceil((hcy + 0.14) * h));
  }

  for (let y = cy0; y < cy1; y += 2) {
    const row = y * w;
    for (let x = cx0; x < cx1; x += 2) {
      const i = row + x;
      if (edgeEnergy[i] < f.refEdge * 0.5 && valley[i] < 0.18) {
        seedSamplesLum.push(closedLum[i]);
        seedSamplesRg.push(smoothRg[i]);
        seedSamplesBy.push(smoothBy[i]);
      }
    }
  }

  if (seedSamplesLum.length >= 16) {
    // Illumination-invariant normalized paper chromaticity signature
    const seedRgNorm = seedSamplesRg.map((v, k) => v / (seedSamplesLum[k] + 32));
    const seedByNorm = seedSamplesBy.map((v, k) => v / (seedSamplesLum[k] + 32));
    const pRgNorm = quantile(seedRgNorm, 0.5, 0);
    const pByNorm = quantile(seedByNorm, 0.5, 0);

    // Center-seeded barrier-growing mask: immune to gradual ceiling lighting gradients,
    // stops cleanly at 3x3-dilated paper contact-seam valleys, edges, or floor tint shifts.
    const edgeBarrier = Math.max(0.068, f.refEdge * 0.42);
    const valleyBarrier = Math.max(0.14, f.refValley * 0.42);
    const rawBarrier = new Uint8Array(n);
    const blocked = new Uint8Array(n);
    for (let i = 0; i < n; i++) {
      if (clutter[i] < 0.2 && (valley[i] > valleyBarrier || edgeEnergy[i] > edgeBarrier)) {
        rawBarrier[i] = 1;
      }
      const lum = closedLum[i] + 32;
      const dRg = Math.abs(smoothRg[i] / lum - pRgNorm);
      const dBy = Math.abs(smoothBy[i] / lum - pByNorm);
      if (clutter[i] < 0.2 && dRg + dBy > 0.04) {
        blocked[i] = 1;
      }
    }
    // Dilate edge/valley barrier by 1px to seal sub-pixel corner gaps against flood leak
    for (let y = 1; y < h - 1; y++) {
      const r0 = (y - 1) * w;
      const r1 = y * w;
      const r2 = (y + 1) * w;
      for (let x = 1; x < w - 1; x++) {
        if (
          rawBarrier[r1 + x] ||
          rawBarrier[r1 + x - 1] ||
          rawBarrier[r1 + x + 1] ||
          rawBarrier[r0 + x] ||
          rawBarrier[r2 + x]
        ) {
          blocked[r1 + x] = 1;
        }
      }
    }

    // Flood-fill from a small central seed grid (handles uneven lighting seamlessly)
    const grownMask = new Uint8Array(n);
    const q = new Int32Array(n);
    let qh = 0;
    let qt = 0;
    const scx = Math.floor((cx0 + cx1) * 0.5);
    const scy = Math.floor((cy0 + cy1) * 0.5);
    for (let sy = Math.max(1, scy - 16); sy <= Math.min(h - 2, scy + 16); sy += 8) {
      for (let sx = Math.max(1, scx - 16); sx <= Math.min(w - 2, scx + 16); sx += 8) {
        const si = sy * w + sx;
        if (!blocked[si] && !grownMask[si]) {
          grownMask[si] = 1;
          q[qt++] = si;
        }
      }
    }
    while (qh < qt) {
      const idx = q[qh++];
      const x = idx % w;
      const y = (idx - x) / w;
      if (x > 0) {
        const ni = idx - 1;
        if (!blocked[ni] && !grownMask[ni]) {
          grownMask[ni] = 1;
          q[qt++] = ni;
        }
      }
      if (x + 1 < w) {
        const ni = idx + 1;
        if (!blocked[ni] && !grownMask[ni]) {
          grownMask[ni] = 1;
          q[qt++] = ni;
        }
      }
      if (y > 0) {
        const ni = idx - w;
        if (!blocked[ni] && !grownMask[ni]) {
          grownMask[ni] = 1;
          q[qt++] = ni;
        }
      }
      if (y + 1 < h) {
        const ni = idx + w;
        if (!blocked[ni] && !grownMask[ni]) {
          grownMask[ni] = 1;
          q[qt++] = ni;
        }
      }
    }
    quads.push(...extractQuadsFromBinaryMask(grownMask, w, h, visited, queue));
  }

  return quads;
}

interface HoughLine {
  theta: number; // radians in [0, pi)
  cos: number;
  sin: number;
  rho: number; // pixel distance from origin
  score: number;
}

function intersectLines(a: HoughLine, b: HoughLine): Point | null {
  const det = a.cos * b.sin - a.sin * b.cos;
  if (Math.abs(det) < 0.25) return null; // nearly parallel (< ~14 deg)
  const x = (b.sin * a.rho - a.sin * b.rho) / det;
  const y = (a.cos * b.rho - b.cos * a.rho) / det;
  return { x, y };
}

/**
 * Generates candidate quads using orientation-bucketed directed Hough voting on
 * text-suppressed multi-channel edge + valley energy.
 */
function extractHoughQuads(f: DetectorFeatures): Quad[] {
  const { w, h, edgeEnergy, edgeGx, edgeGy, clutter } = f;

  const magSamples: number[] = [];
  for (let y = 2; y < h - 2; y += 2) {
    const row = y * w;
    for (let x = 2; x < w - 2; x += 2) {
      const idx = row + x;
      const m = edgeEnergy[idx];
      if (m > 0.024) magSamples.push(m);
    }
  }
  if (magSamples.length < 30) return [];

  magSamples.sort((a, b) => a - b);
  // Adaptive threshold works on both harsh flash & soft indoor room light
  const edgeThresh = Math.max(
    0.032,
    Math.min(0.16, magSamples[Math.floor(magSamples.length * 0.3)] ?? 0.05)
  );

  const edgeX: number[] = [];
  const edgeY: number[] = [];
  const edgeAngle: number[] = [];
  const edgeWeight: number[] = [];

  for (let y = 2; y < h - 2; y++) {
    const row = y * w;
    for (let x = 2; x < w - 2; x++) {
      const idx = row + x;
      const m = edgeEnergy[idx];
      if (m < edgeThresh) continue;

      let angle = Math.atan2(edgeGy[idx], edgeGx[idx]);
      if (angle < 0) angle += Math.PI;
      if (angle >= Math.PI) angle -= Math.PI;

      const deg = (angle * 180) / Math.PI;
      let m1 = 0;
      let m2 = 0;
      if (deg < 22.5 || deg >= 157.5) {
        m1 = edgeEnergy[idx - 1];
        m2 = edgeEnergy[idx + 1];
      } else if (deg < 67.5) {
        m1 = edgeEnergy[idx - w - 1];
        m2 = edgeEnergy[idx + w + 1];
      } else if (deg < 112.5) {
        m1 = edgeEnergy[idx - w];
        m2 = edgeEnergy[idx + w];
      } else {
        m1 = edgeEnergy[idx - w + 1];
        m2 = edgeEnergy[idx + w - 1];
      }

      if (m >= m1 && m >= m2) {
        // Strongly damp pixels inside printed text/table blocks so outer paper edges always get Hough slots
        const clutterDamp = 1 / (1 + clutter[idx] * 9.0);
        const normWt = Math.min(2.4, (m / f.refEdge) * 1.4) * clutterDamp;
        if (normWt > 0.05) {
          edgeX.push(x);
          edgeY.push(y);
          edgeAngle.push(angle);
          edgeWeight.push(normWt);
        }
      }
    }
  }

  if (edgeX.length < 30) return [];

  const numTheta = 180;
  const diag = Math.ceil(Math.hypot(w, h));
  const rhoStep = 2;
  const rhoOffset = diag;
  const numRho = Math.ceil((diag * 2) / rhoStep) + 1;
  const acc = new Float32Array(numTheta * numRho);

  const cosTable = new Float32Array(numTheta);
  const sinTable = new Float32Array(numTheta);
  for (let t = 0; t < numTheta; t++) {
    const rad = (t * Math.PI) / 180;
    cosTable[t] = Math.cos(rad);
    sinTable[t] = Math.sin(rad);
  }

  for (let i = 0; i < edgeX.length; i++) {
    const x = edgeX[i];
    const y = edgeY[i];
    const wt = edgeWeight[i];
    const centerT = Math.round((edgeAngle[i] * 180) / Math.PI) % numTheta;

    for (let dt = -7; dt <= 7; dt++) {
      const t = (centerT + dt + numTheta) % numTheta;
      const rho = x * cosTable[t] + y * sinTable[t];
      const rBin = Math.round((rho + rhoOffset) / rhoStep);
      if (rBin >= 0 && rBin < numRho) {
        acc[t * numRho + rBin] += wt;
      }
    }
  }

  const candidates: Array<{ t: number; r: number; score: number }> = [];
  for (let t = 0; t < numTheta; t++) {
    const row = t * numRho;
    const prevRow = ((t - 1 + numTheta) % numTheta) * numRho;
    const nextRow = ((t + 1) % numTheta) * numRho;
    for (let r = 1; r < numRho - 1; r++) {
      const v = acc[row + r];
      if (
        v > 8 &&
        v >= acc[row + r - 1] &&
        v >= acc[row + r + 1] &&
        v >= acc[prevRow + r] &&
        v >= acc[nextRow + r]
      ) {
        candidates.push({ t, r, score: v });
      }
    }
  }
  candidates.sort((a, b) => b.score - a.score);

  // Deduplicate into spatial-quadrant orientation buckets (top/bottom horizontal, left/right vertical)
  // using midpoint separation so tilted echoes of one strong line cannot fill all 5 slots.
  const topLines: HoughLine[] = [];
  const botLines: HoughLine[] = [];
  const leftLines: HoughLine[] = [];
  const rightLines: HoughLine[] = [];
  const minRhoSep = Math.min(w, h) * 0.032;
  const midX = w * 0.5;
  const midY = h * 0.5;

  const tryAddLine = (
    bucket: HoughLine[],
    c: { t: number; r: number; score: number },
    isHoriz: boolean,
    coordAtMid: number,
    limit: number
  ) => {
    if (bucket.length >= limit) return;
    const theta = (c.t * Math.PI) / 180;
    const rho = c.r * rhoStep - rhoOffset;
    for (const existing of bucket) {
      let dTheta = Math.abs(theta - existing.theta);
      if (dTheta > Math.PI * 0.5) dTheta = Math.PI - dTheta;
      const existingMid = isHoriz
        ? Math.abs(existing.sin) > 0.2
          ? (existing.rho - midX * existing.cos) / existing.sin
          : midY
        : Math.abs(existing.cos) > 0.2
          ? (existing.rho - midY * existing.sin) / existing.cos
          : midX;
      if (dTheta < (28 * Math.PI) / 180 && Math.abs(coordAtMid - existingMid) < minRhoSep) {
        return;
      }
    }
    bucket.push({
      theta,
      cos: cosTable[c.t],
      sin: sinTable[c.t],
      rho,
      score: c.score,
    });
  };

  for (const c of candidates) {
    const rho = c.r * rhoStep - rhoOffset;
    const cos = cosTable[c.t];
    const sin = sinTable[c.t];
    const isHorizLine = c.t >= 45 && c.t <= 135;
    if (isHorizLine) {
      const yAtMid = Math.abs(sin) > 0.2 ? (rho - midX * cos) / sin : midY;
      if (yAtMid <= midY) tryAddLine(topLines, c, true, yAtMid, 10);
      else tryAddLine(botLines, c, true, yAtMid, 10);
    } else {
      const xAtMid = Math.abs(cos) > 0.2 ? (rho - midY * sin) / cos : midX;
      if (xAtMid <= midX) tryAddLine(leftLines, c, false, xAtMid, 7);
      else tryAddLine(rightLines, c, false, xAtMid, 7);
    }
    if (
      topLines.length >= 10 &&
      botLines.length >= 10 &&
      leftLines.length >= 7 &&
      rightLines.length >= 7
    ) {
      break;
    }
  }

  const lines = [...topLines, ...botLines, ...leftLines, ...rightLines];
  if (lines.length < 4) return [];

  // Weighted PCA refinement along each line using nearby aligned edge pixels
  const refinedLines: HoughLine[] = lines.map((line) => {
    let sumW = 0;
    let meanX = 0;
    let meanY = 0;
    const pts: Array<{ x: number; y: number; w: number }> = [];
    for (let i = 0; i < edgeX.length; i++) {
      const x = edgeX[i];
      const y = edgeY[i];
      const dist = Math.abs(x * line.cos + y * line.sin - line.rho);
      if (dist > 3.0) continue;
      let dAng = Math.abs(edgeAngle[i] - line.theta);
      if (dAng > Math.PI * 0.5) dAng = Math.PI - dAng;
      if (dAng > 0.28) continue;
      const wt = edgeWeight[i];
      pts.push({ x, y, w: wt });
      sumW += wt;
      meanX += x * wt;
      meanY += y * wt;
    }

    if (pts.length < 8 || sumW <= 0) return line;
    meanX /= sumW;
    meanY /= sumW;

    let sxx = 0;
    let syy = 0;
    let sxy = 0;
    for (const p of pts) {
      const dx = p.x - meanX;
      const dy = p.y - meanY;
      sxx += p.w * dx * dx;
      syy += p.w * dy * dy;
      sxy += p.w * dx * dy;
    }

    const theta = 0.5 * Math.atan2(2 * sxy, sxx - syy) + Math.PI * 0.5;
    const normTheta = ((theta % Math.PI) + Math.PI) % Math.PI;
    const cos = Math.cos(normTheta);
    const sin = Math.sin(normTheta);
    const rho = meanX * cos + meanY * sin;
    return { theta: normTheta, cos, sin, rho, score: line.score };
  });

  const minSep = Math.min(w, h) * 0.17;
  const horizPairs: Array<{ a: HoughLine; b: HoughLine; pairScore: number }> = [];
  const vertPairs: Array<{ a: HoughLine; b: HoughLine; pairScore: number }> = [];
  for (let i = 0; i < refinedLines.length; i++) {
    for (let j = i + 1; j < refinedLines.length; j++) {
      const a = refinedLines[i];
      const b = refinedLines[j];
      const cosAng = Math.abs(a.cos * b.cos + a.sin * b.sin);
      if (cosAng < 0.866) continue;
      const dot = a.cos * b.cos + a.sin * b.sin;
      const sep = dot >= 0 ? Math.abs(a.rho - b.rho) : Math.abs(a.rho + b.rho);
      if (sep >= minSep) {
        const pair = { a, b, pairScore: a.score + b.score };
        if (Math.abs(a.sin) >= Math.abs(a.cos)) horizPairs.push(pair);
        else vertPairs.push(pair);
      }
    }
  }
  horizPairs.sort((u, v) => v.pairScore - u.pairScore);
  vertPairs.sort((u, v) => v.pairScore - u.pairScore);
  const topH = horizPairs.slice(0, 64);
  const topV = vertPairs.slice(0, 32);

  const quads: Quad[] = [];
  for (let i = 0; i < topH.length; i++) {
    for (let j = 0; j < topV.length; j++) {
      const { a: a1, b: a2 } = topH[i];
      const { a: b1, b: b2 } = topV[j];

      const cosCross = Math.abs(a1.cos * b1.cos + a1.sin * b1.sin);
      if (cosCross > 0.707) continue;

      const p1 = intersectLines(a1, b1);
      const p2 = intersectLines(a1, b2);
      const p3 = intersectLines(a2, b2);
      const p4 = intersectLines(a2, b1);
      if (!p1 || !p2 || !p3 || !p4) continue;

      const rawPts = [p1, p2, p3, p4].map((p) => ({
        x: p.x / (w - 1),
        y: p.y / (h - 1),
      }));

      if (rawPts.some((p) => p.x < -0.12 || p.x > 1.12 || p.y < -0.12 || p.y > 1.12)) {
        continue;
      }

      const clamped = rawPts.map(clampPoint) as [Point, Point, Point, Point];
      const ordered = orderQuadClockwise(clamped);
      if (isConvexQuad(ordered, 0.06)) {
        quads.push(ordered);
      }
    }
  }

  return quads;
}

function quadArea(q: Quad): number {
  let area2 = 0;
  for (let i = 0; i < 4; i++) {
    const a = q[i];
    const b = q[(i + 1) % 4];
    area2 += a.x * b.y - b.x * a.y;
  }
  return Math.abs(area2) * 0.5;
}

function minMaxAnglesDeg(q: Quad, w: number, h: number): { minDeg: number; maxDeg: number } {
  const pts = q.map((p) => ({ x: p.x * w, y: p.y * h }));
  let minDeg = 180;
  let maxDeg = 0;
  for (let i = 0; i < 4; i++) {
    const prev = pts[(i + 3) % 4];
    const curr = pts[i];
    const next = pts[(i + 1) % 4];
    const v1x = prev.x - curr.x;
    const v1y = prev.y - curr.y;
    const v2x = next.x - curr.x;
    const v2y = next.y - curr.y;
    const denom = Math.hypot(v1x, v1y) * Math.hypot(v2x, v2y);
    if (denom < 1e-6) return { minDeg: 0, maxDeg: 180 };
    const cos = Math.max(-1, Math.min(1, (v1x * v2x + v1y * v2y) / denom));
    const deg = (Math.acos(cos) * 180) / Math.PI;
    if (deg < minDeg) minDeg = deg;
    if (deg > maxDeg) maxDeg = deg;
  }
  return { minDeg, maxDeg };
}

/**
 * Samples combined gradient + valley energy along a point's normal window (+-searchRad px).
 */
function samplePointEdgeResponse(
  sx: number,
  sy: number,
  nx: number,
  ny: number,
  searchRad: number,
  f: DetectorFeatures
): { posGrad: number; negGrad: number; valleyPeak: number; chromaGrad: number } {
  const { w, h, gxLum, gyLum, gxRg, gyRg, gxBy, gyBy, valley } = f;
  let posGrad = 0;
  let negGrad = 0;
  let valleyPeak = 0;
  let chromaGrad = 0;

  for (let off = -searchRad; off <= searchRad; off++) {
    const px = Math.max(1, Math.min(w - 2, Math.round(sx + nx * off)));
    const py = Math.max(1, Math.min(h - 2, Math.round(sy + ny * off)));
    const idx = py * w + px;

    const pLum = gxLum[idx] * nx + gyLum[idx] * ny;
    if (pLum > posGrad) posGrad = pLum;
    if (-pLum > negGrad) negGrad = -pLum;

    const cRg = Math.abs(gxRg[idx] * nx + gyRg[idx] * ny);
    const cBy = Math.abs(gxBy[idx] * nx + gyBy[idx] * ny);
    const cMax = Math.max(cRg, cBy);
    if (cMax > chromaGrad) chromaGrad = cMax;

    const v = valley[idx];
    if (v > valleyPeak) valleyPeak = v;
  }

  return { posGrad, negGrad, valleyPeak, chromaGrad };
}

function quadSimilarityBonus(a: Quad, b: Quad): number {
  let err = 0;
  for (let i = 0; i < 4; i++) {
    err += Math.hypot(a[i].x - b[i].x, a[i].y - b[i].y);
  }
  const avgErr = err * 0.25;
  return avgErr < 0.08 ? (1 - avgErr / 0.08) * 0.035 : 0;
}

/**
 * Evaluates how strongly a candidate quad's 4 borders match a physical document sheet:
 * - Multi-channel (log-luminance + chroma + contact-seam valley) alignment normalized to frame contrast
 * - Grout-line continuation penalty (rejects floor tile seams extending straight past corners)
 * - Interior-vs-exterior strip contrast (distinguishes outer paper edge from inner printed tables)
 * - Smooth border polarity consistency
 */
function scoreCandidateQuad(
  quad: Quad,
  f: DetectorFeatures,
  hintQuad?: Quad
): number {
  const { w, h, logLum, closedLum, smoothRg, smoothBy, valley, clutter, refEdge, refValley } = f;

  const area = quadArea(quad);
  if (area < 0.07 || area > 0.96) return 0;

  const { minDeg, maxDeg } = minMaxAnglesDeg(quad, w, h);
  if (minDeg < 45 || maxDeg > 135) return 0;

  const pxPts = quad.map((p) => ({ x: p.x * (w - 1), y: p.y * (h - 1) }));
  const topLen = Math.hypot(pxPts[1].x - pxPts[0].x, pxPts[1].y - pxPts[0].y);
  const botLen = Math.hypot(pxPts[2].x - pxPts[3].x, pxPts[2].y - pxPts[3].y);
  const leftLen = Math.hypot(pxPts[3].x - pxPts[0].x, pxPts[3].y - pxPts[0].y);
  const rightLen = Math.hypot(pxPts[2].x - pxPts[1].x, pxPts[2].y - pxPts[1].y);

  const avgW = (topLen + botLen) * 0.5;
  const avgH = (leftLen + rightLen) * 0.5;
  if (avgW < 20 || avgH < 20) return 0;
  const aspect = avgW / avgH;
  if (aspect < 0.35 || aspect > 2.8) return 0;

  const wBalance = Math.min(topLen, botLen) / Math.max(1, Math.max(topLen, botLen));
  const hBalance = Math.min(leftLen, rightLen) / Math.max(1, Math.max(leftLen, rightLen));
  if (wBalance < 0.45 || hBalance < 0.45) return 0;

  const SAMPLES = 16;
  const edgeStrengths: number[] = [];
  const edgePolarities: number[] = [];
  const edgeCoverages: number[] = [];
  const edgeContinuations: number[] = [];
  const stripContrasts: number[] = [];

  const gradHitThresh = Math.max(0.055, refEdge * 0.28);
  const valleyHitThresh = Math.max(0.14, refValley * 0.36);

  for (let e = 0; e < 4; e++) {
    const a = pxPts[e];
    const b = pxPts[(e + 1) % 4];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len = Math.hypot(dx, dy);
    if (len < 14) return 0;

    // Inward unit normal for clockwise quad in +Y down coordinates: (-dy, dx) / len
    const nx = -dy / len;
    const ny = dx / len;

    let posHits = 0;
    let negHits = 0;
    let combinedHits = 0;
    let sampleStrSum = 0;
    let valleySum = 0;
    let posSum = 0;
    let negSum = 0;
    let validSamples = 0;
    let lumDiffSum = 0;
    let absStripDeltaSum = 0;
    let cleanStripSamples = 0;
    let outsideInkHits = 0;
    let outsideSoftHits = 0;
    let insideTextHits = 0;

    const normScale = Math.max(0.14, refEdge * 0.85);
    const valScale = Math.max(0.24, refValley * 0.9);

    for (let s = 0; s < SAMPLES; s++) {
      const t = 0.07 + (0.86 * s) / (SAMPLES - 1);
      const sx = a.x + dx * t;
      const sy = a.y + dy * t;

      if (sx < 2.2 || sx > w - 3.2 || sy < 2.2 || sy > h - 3.2) {
        continue;
      }
      validSamples++;

      const cIdx = Math.round(sy) * w + Math.round(sx);
      const edgeDamp = 1 / (1 + clutter[cIdx] * 5.0);

      const resp = samplePointEdgeResponse(sx, sy, nx, ny, 3, f);
      const pg = resp.posGrad * edgeDamp;
      const ng = resp.negGrad * edgeDamp;
      const cg = resp.chromaGrad * edgeDamp;
      const vp = resp.valleyPeak * edgeDamp;

      posSum += pg;
      negSum += ng;
      valleySum += vp;

      // Clamp per-sample strength to [0..1] so a partial high-contrast inner table line
      // cannot outscore a 100%-continuous subtle outer paper border.
      const sLum = Math.min(1, Math.max(pg, ng) / normScale);
      const sChr = Math.min(1, cg / normScale);
      const sVal = Math.min(1, vp / valScale);
      sampleStrSum += Math.max(sLum, sChr * 0.92, sVal * 0.88, Math.min(1, 0.55 * sLum + 0.55 * sVal));

      if (pg > gradHitThresh) posHits++;
      if (ng > gradHitThresh) negHits++;
      if (
        pg > gradHitThresh ||
        ng > gradHitThresh ||
        cg > gradHitThresh * 0.9 ||
        vp > valleyHitThresh
      ) {
        combinedHits++;
      }

      // Compare 6px inside vs 6px outside using closedLum + low-ink pixels
      const ix = Math.max(0, Math.min(w - 1, Math.round(sx + nx * 6)));
      const iy = Math.max(0, Math.min(h - 1, Math.round(sy + ny * 6)));
      const ox = Math.max(0, Math.min(w - 1, Math.round(sx - nx * 6)));
      const oy = Math.max(0, Math.min(h - 1, Math.round(sy - ny * 6)));
      const iIdx = iy * w + ix;
      const oIdx = oy * w + ox;
      lumDiffSum += logLum[iIdx] - logLum[oIdx];

      // Flag edges whose +6px interior sits on printed text (characteristic of text-column alignment)
      if (f.softText[iIdx] > 0.11 || clutter[iIdx] > 0.1) {
        insideTextHits++;
      }

      // Check 10px & 18px outside for printed text clutter (stay >=6px inside frame to avoid edge artifacts)
      const ox2 = Math.round(sx - nx * 10);
      const oy2 = Math.round(sy - ny * 10);
      const ox3 = Math.round(sx - nx * 18);
      const oy3 = Math.round(sy - ny * 18);
      const oIdx2 = ox2 >= 6 && ox2 < w - 6 && oy2 >= 6 && oy2 < h - 6 ? oy2 * w + ox2 : -1;
      const oIdx3 = ox3 >= 6 && ox3 < w - 6 && oy3 >= 6 && oy3 < h - 6 ? oy3 * w + ox3 : -1;
      const hasHardInk =
        (oIdx2 >= 0 && clutter[oIdx2] > 0.16 && f.smoothLum[oIdx2] >= f.smoothLum[iIdx] * 0.52) ||
        (oIdx3 >= 0 && clutter[oIdx3] > 0.2 && f.smoothLum[oIdx3] >= f.smoothLum[iIdx] * 0.52);
      const hasSoftText =
        (oIdx2 >= 0 && f.softText[oIdx2] > 0.28) || (oIdx3 >= 0 && f.softText[oIdx3] > 0.3);
      if (hasHardInk) outsideInkHits++;
      if (hasSoftText) outsideSoftHits++;

      if (valley[iIdx] < 0.22 && valley[oIdx] < 0.22) {
        cleanStripSamples++;
        const dLum = Math.abs(closedLum[iIdx] - closedLum[oIdx]) / 24;
        const dChroma =
          (Math.abs(smoothRg[iIdx] - smoothRg[oIdx]) +
            Math.abs(smoothBy[iIdx] - smoothBy[oIdx])) /
          8;
        absStripDeltaSum += Math.min(1.5, dLum + dChroma);
      }
    }

    if (validSamples < 5) {
      edgeStrengths.push(0.06);
      edgePolarities.push(0);
      edgeCoverages.push(0.12);
      edgeContinuations.push(0);
      stripContrasts.push(0.05);
      continue;
    }

    const avgPos = posSum / validSamples;
    const avgNeg = negSum / validSamples;
    const avgValley = valleySum / validSamples;
    const avgStep = lumDiffSum / validSamples;
    const avgStrip =
      cleanStripSamples > 0 ? Math.min(1, absStripDeltaSum / cleanStripSamples) : 0;

    const isPositivePolarity =
      avgPos + Math.max(0, avgStep) * 0.4 >= avgNeg + Math.max(0, -avgStep) * 0.4;
    const dominantLumGrad = isPositivePolarity ? avgPos : avgNeg;
    const dominantLumHits = isPositivePolarity ? posHits : negHits;

    // Only penalize outside text/ink when inside-outside contrast isn't an unmistakable dark-desk boundary (avgStrip < 0.72);
    // soft outside-text check is gated tighter (avgStrip < 0.3) so textured desks/floors never false-trigger.
    const effectiveOutHits =
      avgStrip < 0.3 ? Math.max(outsideInkHits, outsideSoftHits) : outsideInkHits;
    const outsideInkRatio = effectiveOutHits / validSamples;
    const insideTextRatio = insideTextHits / validSamples;
    // Penalize lines riding the left/right alignment edge of a text column inside white paper
    const textMarginPenalty = avgStrip < 0.22 && insideTextRatio > 0.25 ? 1 - 0.35 * insideTextRatio : 1.0;
    const rawEdgeStr =
      (sampleStrSum / validSamples) * (1 - 0.55 * outsideInkRatio) * textMarginPenalty;

    // Measure collinear continuation past both corners: only relevant when inside-vs-outside
    // background contrast is low-to-moderate (e.g. white tile grout grid).
    // High-contrast paper-vs-desk borders (avgStrip >= 0.38) are never tile grout.
    let contRatio = 0;
    if (avgStrip < 0.38) {
      let extHits = 0;
      let extTotal = 0;
      const extOffsets = [-0.2, -0.13, -0.07, 1.07, 1.13, 1.2];
      const extValThresh = Math.max(0.28, avgValley * 0.5);
      const extGradThresh = Math.max(0.15, dominantLumGrad * 0.5);
      for (const et of extOffsets) {
        const ex = a.x + dx * et;
        const ey = a.y + dy * et;
        if (ex < 2.5 || ex > w - 3.5 || ey < 2.5 || ey > h - 3.5) continue;
        extTotal++;
        const extResp = samplePointEdgeResponse(ex, ey, nx, ny, 3, f);
        if (
          extResp.valleyPeak > extValThresh ||
          extResp.posGrad > extGradThresh ||
          extResp.negGrad > extGradThresh
        ) {
          extHits++;
        }
      }
      contRatio = extTotal >= 2 ? extHits / extTotal : 0;
    }

    // Also blend dominant polarity coverage with combined multi-channel coverage
    const polCov = dominantLumHits / validSamples;
    const combCov = combinedHits / validSamples;
    const blendedCov = Math.max(polCov, combCov * 0.92);

    const contPenalty = contRatio > 0.35 && avgStrip < 0.16 ? 0.85 : 0.72;
    edgeStrengths.push(rawEdgeStr * (1 - contPenalty * contRatio));
    edgePolarities.push(dominantLumGrad > 0.04 ? (isPositivePolarity ? 1 : -1) : 0);
    edgeCoverages.push(blendedCov * (1 - 0.5 * contRatio) * (1 - 0.45 * outsideInkRatio));
    edgeContinuations.push(contRatio);
    stripContrasts.push(avgStrip);
  }

  // Reject tile grids / grout squares where borders continue straight past >= 3 corners
  const highContEdges = edgeContinuations.filter((c) => c >= 0.45).length;
  const meanCont =
    (edgeContinuations[0] + edgeContinuations[1] + edgeContinuations[2] + edgeContinuations[3]) *
    0.25;
  const meanStripContrast =
    (stripContrasts[0] + stripContrasts[1] + stripContrasts[2] + stripContrasts[3]) * 0.25;
  if (highContEdges >= 3 || meanCont > 0.55 || (highContEdges >= 2 && meanStripContrast < 0.24)) {
    return 0.14;
  }

  // Smooth polarity multiplier (softened so 1 glare/reflection edge doesn't kill a real page)
  let polarityFactor = 1.0;
  const nonZeroPol = edgePolarities.filter((p) => p !== 0);
  if (nonZeroPol.length >= 3) {
    const sumPol = Math.abs(nonZeroPol.reduce((acc, v) => acc + v, 0));
    if (sumPol < nonZeroPol.length - 0.5) {
      const meanStrip =
        (stripContrasts[0] + stripContrasts[1] + stripContrasts[2] + stripContrasts[3]) * 0.25;
      // If strong valley/chroma/strip contrast exists (e.g. white-on-white), apply mild penalty
      polarityFactor = meanStrip > 0.22 || sumPol >= 1.5 ? 0.78 : 0.52;
    }
  }

  const meanStrength =
    (edgeStrengths[0] + edgeStrengths[1] + edgeStrengths[2] + edgeStrengths[3]) * 0.25;
  const minCoverage = Math.min(...edgeCoverages);
  const meanCoverage =
    (edgeCoverages[0] + edgeCoverages[1] + edgeCoverages[2] + edgeCoverages[3]) * 0.25;

  if (minCoverage < 0.24 || (minCoverage < 0.3 && meanCoverage < 0.45)) {
    return 0.12;
  }

  // Reject interior printed-table frames when all 4 edges have nearly identical white paper on both sides
  // and very weak strip contrast while lacking a perimeter contact difference
  const minStripContrast = Math.min(...stripContrasts);
  const stripBonus = meanStripContrast * 0.11 + minStripContrast * 0.09;
  const angleScore = Math.max(0, 1 - (90 - minDeg) / 45);
  const balanceScore = (wBalance + hBalance) * 0.5;
  const areaPrior = area >= 0.14 && area <= 0.9 ? 1.0 : 0.88;
  const hintBonus = hintQuad ? quadSimilarityBonus(quad, hintQuad) : 0;

  const rawScore =
    (meanStrength * 0.36 +
      meanCoverage * 0.27 +
      minCoverage * 0.13 +
      angleScore * 0.05 +
      balanceScore * 0.05 +
      stripBonus) *
      areaPrior *
      polarityFactor +
    hintBonus;

  return Math.max(0, Math.min(1, rawScore));
}

/**
 * Nudges each of the 4 edges (+-6px) along its normal onto the unclosed multi-channel
 * gradient + valley peak, then re-intersects adjacent lines for tight corner placement.
 */
function refineQuadEdges(quad: Quad, f: DetectorFeatures): Quad {
  const { w, h } = f;
  const pxPts = quad.map((p) => ({ x: p.x * (w - 1), y: p.y * (h - 1) }));
  const refinedLines: Array<{ nx: number; ny: number; d: number }> = [];

  for (let e = 0; e < 4; e++) {
    const a = pxPts[e];
    const b = pxPts[(e + 1) % 4];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len = Math.hypot(dx, dy);
    if (len < 8) return quad;
    const nx = -dy / len;
    const ny = dx / len;
    const baseD = a.x * nx + a.y * ny;

    let bestOff = 0;
    let bestScore = -1;
    for (let off = -6; off <= 6; off++) {
      let sum = 0;
      let count = 0;
      for (let s = 0; s < 22; s++) {
        const t = 0.09 + (0.82 * s) / 21;
        const sx = a.x + dx * t + nx * off;
        const sy = a.y + dy * t + ny * off;
        if (sx < 1.5 || sx > w - 2.5 || sy < 1.5 || sy > h - 2.5) continue;
        const idx = Math.round(sy) * w + Math.round(sx);
        const gLum = Math.abs(f.gxLum[idx] * nx + f.gyLum[idx] * ny) / f.refEdge;
        const gChr =
          Math.max(
            Math.abs(f.gxRg[idx] * nx + f.gyRg[idx] * ny),
            Math.abs(f.gxBy[idx] * nx + f.gyBy[idx] * ny)
          ) / f.refEdge;
        const val = f.valley[idx] / f.refValley;
        sum += Math.max(gLum, gChr * 0.9, val * 0.92);
        count++;
      }
      const avg = count > 0 ? sum / count : 0;
      const weighted = avg - Math.abs(off) * 0.012;
      if (weighted > bestScore) {
        bestScore = weighted;
        bestOff = off;
      }
    }

    refinedLines.push({ nx, ny, d: baseD + bestOff });
  }

  const corners: Point[] = [];
  for (let e = 0; e < 4; e++) {
    const l1 = refinedLines[(e + 3) % 4];
    const l2 = refinedLines[e];
    const det = l1.nx * l2.ny - l1.ny * l2.nx;
    if (Math.abs(det) < 0.2) return quad;
    const x = (l2.ny * l1.d - l1.ny * l2.d) / det;
    const y = (l1.nx * l2.d - l2.nx * l1.d) / det;
    corners.push(clampPoint({ x: x / (w - 1), y: y / (h - 1) }));
  }

  const candidate = corners as Quad;
  return isConvexQuad(candidate, 0.06) ? candidate : quad;
}

/**
 * Pure-TS automatic document boundary detector.
 *
 * Designed for both dark-desk and difficult indoor white-on-white scenes:
 * - Preserves 1-3px paper contact seams via unclosed luminance+chroma gradients & Black-Hat valleys
 * - Suppresses interior text blocks when voting in orientation-bucketed Hough space
 * - Combines Otsu, adaptive local mean, and valley-severed paper similarity masks
 * - Penalizes floor tile grout lines that continue collinearly past candidate corners
 */
export function detectDocumentQuad(
  pixels: Uint8ClampedArray,
  width: number,
  height: number,
  fallbackOrOptions?: Quad | DetectDocumentOptions
): DocumentDetectionResult {
  const opts: DetectDocumentOptions = Array.isArray(fallbackOrOptions)
    ? { fallbackQuad: fallbackOrOptions }
    : (fallbackOrOptions ?? {});

  const safeFallback = opts.fallbackQuad
    ? (opts.fallbackQuad.map((p) => ({ ...p })) as Quad)
    : createDefaultQuad(0.05);

  if (width < 32 || height < 32) {
    return { quad: safeFallback, confidence: 0, detected: false };
  }

  const workingMaxDim = Math.max(160, Math.min(560, opts.workingMaxDim ?? 360));
  const features = buildFeatureMaps(pixels, width, height, workingMaxDim);

  const candidates: Quad[] = [
    ...extractAllMaskCandidates(features, opts.hintQuad ?? opts.fallbackQuad),
    ...extractHoughQuads(features),
  ];

  let bestQuad: Quad | null = null;
  let bestScore = 0;

  for (const cand of candidates) {
    const score = scoreCandidateQuad(cand, features, opts.hintQuad);
    if (score > bestScore) {
      bestScore = score;
      bestQuad = cand;
    }
  }

  if (!bestQuad || bestScore < 0.34) {
    return {
      quad: safeFallback,
      confidence: bestScore,
      detected: false,
    };
  }

  const refined = refineQuadEdges(bestQuad, features);

  // Micro-inset (~1.2% toward centroid) prevents 1-2px contact seam / floor hairlines
  // from bleeding onto the flattened page border due to sub-pixel edge rounding.
  let cx = 0;
  let cy = 0;
  for (const p of refined) {
    cx += p.x;
    cy += p.y;
  }
  cx *= 0.25;
  cy *= 0.25;
  const insetQuad = refined.map((p) =>
    clampPoint({
      x: p.x + (cx - p.x) * 0.012,
      y: p.y + (cy - p.y) * 0.012,
    })
  ) as Quad;

  return {
    quad: isConvexQuad(insetQuad, 0.06) ? insetQuad : refined,
    confidence: bestScore,
    detected: true,
  };
}
