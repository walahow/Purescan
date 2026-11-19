import type { DocumentDetectionResult, Point, Quad } from '../types/scan';
import { A4_RATIO, clampPoint, createDefaultQuad, isConvexQuad } from './perspective';

/**
 * Computes a mathematically exact A4 (210:297 portrait, 297:210 landscape) normalized quad
 * centered within a frame of dimensions (frameWidth x frameHeight).
 */
export function computeA4GuideQuad(
  frameWidth: number,
  frameHeight: number,
  fillRatio = 0.84
): Quad {
  const safeW = Math.max(1, frameWidth);
  const safeH = Math.max(1, frameHeight);
  const ratio = Math.max(0.4, Math.min(0.96, fillRatio));

  const targetAspect = safeH >= safeW ? A4_RATIO : 1 / A4_RATIO;
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
  // Centroid
  let cx = 0;
  let cy = 0;
  for (const p of pts) {
    cx += p.x;
    cy += p.y;
  }
  cx *= 0.25;
  cy *= 0.25;

  // Sort clockwise in screen coordinates (+X right, +Y down)
  const sorted = [...pts].sort((a, b) => {
    const angA = Math.atan2(a.y - cy, a.x - cx);
    const angB = Math.atan2(b.y - cy, b.x - cx);
    return angA - angB;
  });

  // Rotate array so top-left (smallest x + y) is index 0
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
 * Extracts foreground component boundary candidates for a given binary mask
 * using BFS labeling + Convex Hull + 4-corner reduction.
 */
function extractMaskQuads(
  lum: Float32Array,
  w: number,
  h: number,
  threshold: number,
  invert = false
): Quad[] {
  const n = w * h;
  const mask = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    mask[i] = invert ? (lum[i] < threshold ? 1 : 0) : lum[i] >= threshold ? 1 : 0;
  }

  const visited = new Uint8Array(n);
  const queue = new Int32Array(n);
  const quads: Quad[] = [];
  const minCompPixels = Math.floor(n * 0.09);
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

      // 4-neighbor BFS
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
    if (isConvexQuad(ordered, 0.08)) {
      quads.push(ordered);
    }
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
 * Generates candidate quads by finding dominant straight edges via gradient-directed
 * Hough transform on log-luminance Sobel edges and intersecting near-orthogonal line pairs.
 */
function extractHoughQuads(
  gx: Float32Array,
  gy: Float32Array,
  mag: Float32Array,
  w: number,
  h: number
): Quad[] {
  const magSamples: number[] = [];
  for (let y = 2; y < h - 2; y++) {
    const row = y * w;
    for (let x = 2; x < w - 2; x++) {
      const m = mag[row + x];
      if (m > 0.08) magSamples.push(m);
    }
  }
  if (magSamples.length < 30) return [];

  magSamples.sort((a, b) => a - b);
  const edgeThresh = Math.max(
    0.16,
    magSamples[Math.floor(magSamples.length * 0.68)] ?? 0.25
  );

  // Non-maximum suppression along quantized gradient direction
  const edgeX: number[] = [];
  const edgeY: number[] = [];
  const edgeAngle: number[] = [];
  const edgeWeight: number[] = [];

  for (let y = 2; y < h - 2; y++) {
    const row = y * w;
    for (let x = 2; x < w - 2; x++) {
      const idx = row + x;
      const m = mag[idx];
      if (m < edgeThresh) continue;

      const ax = gx[idx];
      const ay = gy[idx];
      let angle = Math.atan2(ay, ax); // normal angle
      if (angle < 0) angle += Math.PI;
      if (angle >= Math.PI) angle -= Math.PI;

      // Quantize to 4 directions (0, 45, 90, 135 deg)
      const deg = (angle * 180) / Math.PI;
      let m1 = 0;
      let m2 = 0;
      if (deg < 22.5 || deg >= 157.5) {
        m1 = mag[idx - 1];
        m2 = mag[idx + 1];
      } else if (deg < 67.5) {
        m1 = mag[idx - w - 1];
        m2 = mag[idx + w + 1];
      } else if (deg < 112.5) {
        m1 = mag[idx - w];
        m2 = mag[idx + w];
      } else {
        m1 = mag[idx - w + 1];
        m2 = mag[idx + w - 1];
      }

      if (m >= m1 && m >= m2) {
        edgeX.push(x);
        edgeY.push(y);
        edgeAngle.push(angle);
        edgeWeight.push(Math.min(m, 2.5));
      }
    }
  }

  if (edgeX.length < 30) return [];

  // Coarse-to-directed Hough accumulator: 180 theta bins x rho bins (2px step)
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

    // Vote only within +-10 degrees of gradient normal
    for (let dt = -10; dt <= 10; dt++) {
      const t = (centerT + dt + numTheta) % numTheta;
      const rho = x * cosTable[t] + y * sinTable[t];
      const rBin = Math.round((rho + rhoOffset) / rhoStep);
      if (rBin >= 0 && rBin < numRho) {
        acc[t * numRho + rBin] += wt;
      }
    }
  }

  // Pick top local maxima lines with NMS
  const candidates: Array<{ t: number; r: number; score: number }> = [];
  for (let t = 0; t < numTheta; t++) {
    const row = t * numRho;
    for (let r = 1; r < numRho - 1; r++) {
      const v = acc[row + r];
      if (v > 10 && v >= acc[row + r - 1] && v >= acc[row + r + 1]) {
        candidates.push({ t, r, score: v });
      }
    }
  }
  candidates.sort((a, b) => b.score - a.score);

  const lines: HoughLine[] = [];
  for (const c of candidates) {
    const theta = (c.t * Math.PI) / 180;
    const rho = c.r * rhoStep - rhoOffset;
    let duplicate = false;
    for (const existing of lines) {
      let dTheta = Math.abs(theta - existing.theta);
      if (dTheta > Math.PI * 0.5) dTheta = Math.PI - dTheta;
      // If opposite orientation near pi wrap, flip rho sign check
      const sameDir = Math.abs(theta - existing.theta) < Math.PI * 0.5;
      const dRho = sameDir ? Math.abs(rho - existing.rho) : Math.abs(rho + existing.rho);
      if (dTheta < (10 * Math.PI) / 180 && dRho < Math.min(w, h) * 0.08) {
        duplicate = true;
        break;
      }
    }
    if (!duplicate) {
      lines.push({
        theta,
        cos: cosTable[c.t],
        sin: sinTable[c.t],
        rho,
        score: c.score,
      });
      if (lines.length >= 12) break;
    }
  }

  if (lines.length < 4) return [];

  // Refine each line using weighted orthogonal regression on nearby aligned edge pixels
  const refinedLines: HoughLine[] = lines.map((line) => {
    let sumW = 0;
    let meanX = 0;
    let meanY = 0;
    const pts: Array<{ x: number; y: number; w: number }> = [];
    for (let i = 0; i < edgeX.length; i++) {
      const x = edgeX[i];
      const y = edgeY[i];
      const dist = Math.abs(x * line.cos + y * line.sin - line.rho);
      if (dist > 3.5) continue;
      let dAng = Math.abs(edgeAngle[i] - line.theta);
      if (dAng > Math.PI * 0.5) dAng = Math.PI - dAng;
      if (dAng > 0.35) continue;
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

    // Normal direction minimizes variance: eigenvector of smallest eigenvalue
    const theta = 0.5 * Math.atan2(2 * sxy, sxx - syy) + Math.PI * 0.5;
    const normTheta = ((theta % Math.PI) + Math.PI) % Math.PI;
    const cos = Math.cos(normTheta);
    const sin = Math.sin(normTheta);
    const rho = meanX * cos + meanY * sin;
    return { theta: normTheta, cos, sin, rho, score: line.score };
  });

  // Form candidate quads from pairs of roughly-parallel lines intersected with orthogonal pairs
  const minSep = Math.min(w, h) * 0.18;
  const parallelPairs: Array<[HoughLine, HoughLine]> = [];
  for (let i = 0; i < refinedLines.length; i++) {
    for (let j = i + 1; j < refinedLines.length; j++) {
      const a = refinedLines[i];
      const b = refinedLines[j];
      const cosAng = Math.abs(a.cos * b.cos + a.sin * b.sin);
      // Within ~30 deg of parallel
      if (cosAng < 0.866) continue;
      const dot = a.cos * b.cos + a.sin * b.sin;
      const sep = dot >= 0 ? Math.abs(a.rho - b.rho) : Math.abs(a.rho + b.rho);
      if (sep >= minSep) {
        parallelPairs.push([a, b]);
      }
    }
  }

  const quads: Quad[] = [];
  for (let i = 0; i < parallelPairs.length; i++) {
    for (let j = i + 1; j < parallelPairs.length; j++) {
      const [a1, a2] = parallelPairs[i];
      const [b1, b2] = parallelPairs[j];

      // Ensure pairs are roughly perpendicular (45..135 deg)
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

      // Reject intersections far outside frame bounds
      if (rawPts.some((p) => p.x < -0.12 || p.x > 1.12 || p.y < -0.12 || p.y > 1.12)) {
        continue;
      }

      const clamped = rawPts.map(clampPoint) as [Point, Point, Point, Point];
      const ordered = orderQuadClockwise(clamped);
      if (isConvexQuad(ordered, 0.08)) {
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
 * Evaluates how strongly a candidate quad's 4 borders align with real physical
 * intensity edges in the log-luminance gradient field.
 */
function scoreCandidateQuad(
  quad: Quad,
  gx: Float32Array,
  gy: Float32Array,
  logLum: Float32Array,
  w: number,
  h: number
): number {
  const area = quadArea(quad);
  if (area < 0.08 || area > 0.96) return 0;

  const { minDeg, maxDeg } = minMaxAnglesDeg(quad, w, h);
  if (minDeg < 45 || maxDeg > 135) return 0;

  const pxPts = quad.map((p) => ({ x: p.x * (w - 1), y: p.y * (h - 1) }));
  const topLen = Math.hypot(pxPts[1].x - pxPts[0].x, pxPts[1].y - pxPts[0].y);
  const botLen = Math.hypot(pxPts[2].x - pxPts[3].x, pxPts[2].y - pxPts[3].y);
  const leftLen = Math.hypot(pxPts[3].x - pxPts[0].x, pxPts[3].y - pxPts[0].y);
  const rightLen = Math.hypot(pxPts[2].x - pxPts[1].x, pxPts[2].y - pxPts[1].y);

  const avgW = (topLen + botLen) * 0.5;
  const avgH = (leftLen + rightLen) * 0.5;
  if (avgW < 18 || avgH < 18) return 0;
  const aspect = avgW / avgH;
  if (aspect < 0.35 || aspect > 2.8) return 0;

  // Penalize severely skewed opposing sides
  const wBalance = Math.min(topLen, botLen) / Math.max(1, Math.max(topLen, botLen));
  const hBalance = Math.min(leftLen, rightLen) / Math.max(1, Math.max(leftLen, rightLen));
  if (wBalance < 0.45 || hBalance < 0.45) return 0;

  const SAMPLES = 24;
  const edgeStrengths: number[] = [];
  const edgePolarities: number[] = [];
  const edgeCoverages: number[] = [];

  for (let e = 0; e < 4; e++) {
    const a = pxPts[e];
    const b = pxPts[(e + 1) % 4];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len = Math.hypot(dx, dy);
    if (len < 12) return 0;

    // Inward unit normal for clockwise quad in +Y down coordinates: (-dy, dx) / len
    const nx = -dy / len;
    const ny = dx / len;

    let posHits = 0;
    let negHits = 0;
    let posSum = 0;
    let negSum = 0;
    let validSamples = 0;
    let lumDiffSum = 0;

    for (let s = 0; s < SAMPLES; s++) {
      // Sample along [0.08 .. 0.92] to avoid corner rounding artifacts
      const t = 0.08 + (0.84 * s) / (SAMPLES - 1);
      const sx = a.x + dx * t;
      const sy = a.y + dy * t;

      // Skip samples hugging the outer frame edge (since frame border itself isn't a paper edge)
      if (sx < 2.2 || sx > w - 3.2 || sy < 2.2 || sy > h - 3.2) {
        continue;
      }
      validSamples++;

      // Search +-3px along edge normal for strongest aligned gradient
      let bestPos = 0;
      let bestNeg = 0;
      for (let off = -3; off <= 3; off++) {
        const px = Math.max(1, Math.min(w - 2, Math.round(sx + nx * off)));
        const py = Math.max(1, Math.min(h - 2, Math.round(sy + ny * off)));
        const idx = py * w + px;
        const proj = gx[idx] * nx + gy[idx] * ny;
        if (proj > bestPos) bestPos = proj;
        if (-proj > bestNeg) bestNeg = -proj;
      }

      posSum += bestPos;
      negSum += bestNeg;
      if (bestPos > 0.22) posHits++;
      if (bestNeg > 0.22) negHits++;

      // Inside vs outside log-luminance step across +-4px
      const ix = Math.max(0, Math.min(w - 1, Math.round(sx + nx * 4)));
      const iy = Math.max(0, Math.min(h - 1, Math.round(sy + ny * 4)));
      const ox = Math.max(0, Math.min(w - 1, Math.round(sx - nx * 4)));
      const oy = Math.max(0, Math.min(h - 1, Math.round(sy - ny * 4)));
      lumDiffSum += logLum[iy * w + ix] - logLum[oy * w + ox];
    }

    if (validSamples < 6) {
      // Edge lies almost entirely along image boundary — weak independent edge evidence
      edgeStrengths.push(0.18);
      edgePolarities.push(0);
      edgeCoverages.push(0.25);
      continue;
    }

    const avgPos = posSum / validSamples;
    const avgNeg = negSum / validSamples;
    const avgStep = lumDiffSum / validSamples;

    // Combine gradient projection and inside-outside step polarity
    const isPositivePolarity = avgPos + Math.max(0, avgStep) * 0.4 >= avgNeg + Math.max(0, -avgStep) * 0.4;
    const dominantGrad = isPositivePolarity ? avgPos : avgNeg;
    const dominantHits = isPositivePolarity ? posHits : negHits;

    edgeStrengths.push(Math.min(1, dominantGrad / 1.05));
    edgePolarities.push(isPositivePolarity ? 1 : -1);
    edgeCoverages.push(dominantHits / validSamples);
  }

  // Enforce consistent border polarity across detected non-boundary edges
  const nonZeroPol = edgePolarities.filter((p) => p !== 0);
  if (nonZeroPol.length >= 3) {
    const sumPol = nonZeroPol.reduce((acc, v) => acc + v, 0);
    if (Math.abs(sumPol) < nonZeroPol.length - 0.5) {
      // Mixed inside/outside polarity (e.g. half desk, half interior line) -> heavy penalty
      return 0.08;
    }
  }

  const meanStrength =
    (edgeStrengths[0] + edgeStrengths[1] + edgeStrengths[2] + edgeStrengths[3]) * 0.25;
  const minCoverage = Math.min(...edgeCoverages);
  const meanCoverage =
    (edgeCoverages[0] + edgeCoverages[1] + edgeCoverages[2] + edgeCoverages[3]) * 0.25;

  // Reject candidates where any side has almost no edge support
  if (minCoverage < 0.16 && meanCoverage < 0.42) {
    return 0.12;
  }

  // Geometry prior: favor crisp rectangular angles & realistic document coverage
  const angleScore = Math.max(0, 1 - (90 - minDeg) / 45);
  const balanceScore = (wBalance + hBalance) * 0.5;
  const areaPrior = area >= 0.15 && area <= 0.9 ? 1.0 : 0.85;

  const rawScore =
    (meanStrength * 0.44 + meanCoverage * 0.32 + minCoverage * 0.14 + angleScore * 0.05 + balanceScore * 0.05) *
    areaPrior;

  return Math.max(0, Math.min(1, rawScore));
}

/**
 * Nudges each of the 4 edges slightly (+-3px) along its normal to lock onto the exact
 * peak gradient ridge, then re-intersects adjacent lines for tight corner placement.
 */
function refineQuadEdges(
  quad: Quad,
  gx: Float32Array,
  gy: Float32Array,
  w: number,
  h: number
): Quad {
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
    for (let off = -3; off <= 3; off++) {
      let sum = 0;
      let count = 0;
      for (let s = 0; s < 20; s++) {
        const t = 0.1 + (0.8 * s) / 19;
        const sx = a.x + dx * t + nx * off;
        const sy = a.y + dy * t + ny * off;
        if (sx < 1.5 || sx > w - 2.5 || sy < 1.5 || sy > h - 2.5) continue;
        const idx = Math.round(sy) * w + Math.round(sx);
        sum += Math.abs(gx[idx] * nx + gy[idx] * ny);
        count++;
      }
      const avg = count > 0 ? sum / count : 0;
      // Slight tie-breaker favoring 0 offset so already-aligned edges don't drift
      const weighted = avg - Math.abs(off) * 0.015;
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
 * Suppresses interior printed text via morphological closing, uses shadow-invariant
 * log-luminance gradients + dual contour & Hough candidate generation, and falls back
 * safely to fallbackQuad (or 5% inset) when confidence is low.
 */
export function detectDocumentQuad(
  pixels: Uint8ClampedArray,
  width: number,
  height: number,
  fallbackQuad?: Quad
): DocumentDetectionResult {
  const safeFallback = fallbackQuad
    ? (fallbackQuad.map((p) => ({ ...p })) as Quad)
    : createDefaultQuad(0.05);

  if (width < 32 || height < 32) {
    return { quad: safeFallback, confidence: 0, detected: false };
  }

  // Downscale to <= 280px working resolution for ~10-20 ms mobile execution
  const targetMax = 280;
  const maxDim = Math.max(width, height);
  const scale = maxDim > targetMax ? targetMax / maxDim : 1;
  const w = Math.max(24, Math.round(width * scale));
  const h = Math.max(24, Math.round(height * scale));
  const n = w * h;

  const rawLum = new Float32Array(n);
  for (let y = 0; y < h; y++) {
    const sy = Math.min(height - 1, Math.floor((y + 0.5) / scale));
    const srcRow = sy * width;
    const dstRow = y * w;
    for (let x = 0; x < w; x++) {
      const sx = Math.min(width - 1, Math.floor((x + 0.5) / scale));
      const p = (srcRow + sx) * 4;
      rawLum[dstRow + x] = 0.299 * pixels[p] + 0.587 * pixels[p + 1] + 0.114 * pixels[p + 2];
    }
  }

  // Morphological closing (dilate -> erode) removes dark ink strokes & table borders inside paper
  const closeRadius = Math.max(2, Math.min(4, Math.round(Math.max(w, h) * 0.013)));
  const bufA = new Float32Array(n);
  const bufB = new Float32Array(n);
  morph1D(rawLum, bufA, w, h, closeRadius, true, true);
  morph1D(bufA, bufB, w, h, closeRadius, false, true);
  morph1D(bufB, bufA, w, h, closeRadius, true, false);
  morph1D(bufA, bufB, w, h, closeRadius, false, false);

  const closed = gaussian3x3(bufB, w, h);

  // Log-luminance converts multiplicative shadows into additive shifts so borders in shadow remain crisp
  const logLum = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    logLum[i] = Math.log(closed[i] + 16);
  }

  // Compute Sobel gradients on log-luminance
  const gx = new Float32Array(n);
  const gy = new Float32Array(n);
  const mag = new Float32Array(n);
  for (let y = 1; y < h - 1; y++) {
    const r0 = (y - 1) * w;
    const r1 = y * w;
    const r2 = (y + 1) * w;
    for (let x = 1; x < w - 1; x++) {
      const idx = r1 + x;
      const sx =
        -logLum[r0 + x - 1] +
        logLum[r0 + x + 1] -
        2 * logLum[r1 + x - 1] +
        2 * logLum[r1 + x + 1] -
        logLum[r2 + x - 1] +
        logLum[r2 + x + 1];
      const sy =
        -logLum[r0 + x - 1] -
        2 * logLum[r0 + x] -
        logLum[r0 + x + 1] +
        logLum[r2 + x - 1] +
        2 * logLum[r2 + x] +
        logLum[r2 + x + 1];
      gx[idx] = sx;
      gy[idx] = sy;
      mag[idx] = Math.hypot(sx, sy);
    }
  }

  // Generate candidate quads from both foreground contour extraction and Hough line intersections
  const otsu = otsuThreshold(closed);
  const candidates: Quad[] = [
    ...extractMaskQuads(closed, w, h, otsu, false),
    ...extractMaskQuads(closed, w, h, Math.max(24, otsu * 0.62), false),
    ...extractMaskQuads(closed, w, h, otsu, true),
    ...extractHoughQuads(gx, gy, mag, w, h),
  ];

  let bestQuad: Quad | null = null;
  let bestScore = 0;

  for (const cand of candidates) {
    const score = scoreCandidateQuad(cand, gx, gy, logLum, w, h);
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

  const refined = refineQuadEdges(bestQuad, gx, gy, w, h);

  // Micro-inset (~0.45% toward centroid) prevents 1-2px desk background hairlines
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
      x: p.x + (cx - p.x) * 0.015,
      y: p.y + (cy - p.y) * 0.015,
    })
  ) as Quad;

  return {
    quad: isConvexQuad(insetQuad, 0.06) ? insetQuad : refined,
    confidence: bestScore,
    detected: true,
  };
}
