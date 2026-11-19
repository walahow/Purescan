import { describe, expect, it } from 'vitest';
import {
  computeA4GuideQuad,
  computeDocumentGuideQuad,
  detectDocumentQuad,
  resolveCapturedQuad,
  smoothQuad,
} from '../documentDetector';
import {
  A4_RATIO,
  createDefaultQuad,
  F4_RATIO,
  ID_CARD_RATIO,
  LEGAL_RATIO,
  LETTER_RATIO,
} from '../perspective';
import type { Point, Quad } from '../../types/scan';

function pointInQuad(x: number, y: number, quad: Quad): boolean {
  for (let i = 0; i < 4; i++) {
    const a = quad[i];
    const b = quad[(i + 1) % 4];
    const cross = (b.x - a.x) * (y - a.y) - (b.y - a.y) * (x - a.x);
    if (cross < 0) return false;
  }
  return true;
}

function renderSyntheticScene(params: {
  w: number;
  h: number;
  docQuadPx: [Point, Point, Point, Point];
  addText?: boolean;
  addDiagonalShadow?: boolean;
  texturedDesk?: boolean;
}): Uint8ClampedArray {
  const { w, h, docQuadPx, addText = true, addDiagonalShadow = false, texturedDesk = false } = params;
  const buf = new Uint8ClampedArray(w * h * 4);

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const inside = pointInQuad(x, y, docQuadPx);
      let r: number;
      let g: number;
      let b: number;

      if (inside) {
        r = 238;
        g = 234;
        b = 224;
        if (addText) {
          const isLine = y % 18 >= 4 && y % 18 <= 7 && x % 14 < 10;
          // Keep margins clean like real printed documents
          const nearCenter =
            x > w * 0.22 && x < w * 0.78 && y > h * 0.2 && y < h * 0.8;
          if (nearCenter && isLine) {
            r = 28;
            g = 28;
            b = 32;
          }
        }
      } else {
        const grain = texturedDesk ? Math.sin(x * 0.35) * 12 + Math.cos(y * 0.12) * 8 : 0;
        r = 78 + grain;
        g = 58 + grain * 0.8;
        b = 44 + grain * 0.6;
      }

      if (addDiagonalShadow) {
        const diag = x / w + y / h - 1.0;
        const t = Math.max(0, Math.min(1, (diag + 0.08) / 0.16));
        const smooth = t * t * (3 - 2 * t);
        const light = 1 - smooth * 0.58;
        r *= light;
        g *= light;
        b *= light;
      }

      const i = (y * w + x) * 4;
      buf[i] = Math.max(0, Math.min(255, Math.round(r)));
      buf[i + 1] = Math.max(0, Math.min(255, Math.round(g)));
      buf[i + 2] = Math.max(0, Math.min(255, Math.round(b)));
      buf[i + 3] = 255;
    }
  }
  return buf;
}

function maxCornerError(detected: Quad, expectedNorm: Quad): number {
  let worst = 0;
  for (let i = 0; i < 4; i++) {
    const err = Math.hypot(detected[i].x - expectedNorm[i].x, detected[i].y - expectedNorm[i].y);
    if (err > worst) worst = err;
  }
  return worst;
}

function signedDistToQuad(x: number, y: number, q: Quad): number {
  let inside = true;
  let minDist = Infinity;
  for (let i = 0; i < 4; i++) {
    const a = q[i];
    const b = q[(i + 1) % 4];
    const ex = b.x - a.x;
    const ey = b.y - a.y;
    const len2 = ex * ex + ey * ey;
    const t = Math.max(0, Math.min(1, ((x - a.x) * ex + (y - a.y) * ey) / len2));
    const px = a.x + t * ex;
    const py = a.y + t * ey;
    const d = Math.hypot(x - px, y - py);
    if (d < minDist) minDist = d;
    if (ex * (y - a.y) - ey * (x - a.x) < 0) inside = false;
  }
  return inside ? -minDist : minDist;
}

function hashNoise(x: number, y: number): number {
  let n = Math.imul(x * 374761393 + y * 668265263, 1274126177);
  n = (n ^ (n >>> 13)) * 1274126177;
  return (((n ^ (n >>> 16)) >>> 0) / 4294967295) * 2 - 1;
}

function renderIndoorWhiteFloorScene(opts: {
  w: number;
  h: number;
  docQuadNorm: Quad | null;
  floorRgb: [number, number, number];
  paperRgb: [number, number, number];
  seamStrength: number;
  groutGrid?: { spacing: number; angleDeg: number; color: [number, number, number] };
  innerTable?: boolean;
  diagonalShadow?: boolean;
}): Uint8ClampedArray {
  const { w, h, docQuadNorm, floorRgb, paperRgb, seamStrength, groutGrid, innerTable, diagonalShadow } = opts;
  const docPx = docQuadNorm
    ? (docQuadNorm.map((p) => ({ x: p.x * (w - 1), y: p.y * (h - 1) })) as Quad)
    : null;

  const buf = new Float32Array(w * h * 3);
  const rad = groutGrid ? (groutGrid.angleDeg * Math.PI) / 180 : 0;
  const cosA = Math.cos(rad);
  const sinA = Math.sin(rad);

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const light = 0.88 + 0.16 * (x / w) - 0.08 * (y / h);
      let r = floorRgb[0];
      let g = floorRgb[1];
      let b = floorRgb[2];

      if (groutGrid) {
        const rx = x * cosA - y * sinA;
        const ry = x * sinA + y * cosA;
        const gx = Math.abs(((rx % groutGrid.spacing) + groutGrid.spacing) % groutGrid.spacing);
        const gy = Math.abs(((ry % groutGrid.spacing) + groutGrid.spacing) % groutGrid.spacing);
        const dg = Math.min(gx, groutGrid.spacing - gx, gy, groutGrid.spacing - gy);
        if (dg < 1.3) {
          const blend = Math.max(0, Math.min(1, 1 - dg / 1.3));
          r = r * (1 - blend) + groutGrid.color[0] * blend;
          g = g * (1 - blend) + groutGrid.color[1] * blend;
          b = b * (1 - blend) + groutGrid.color[2] * blend;
        }
      }

      if (docPx) {
        const sd = signedDistToQuad(x, y, docPx);
        if (sd <= 0) {
          r = paperRgb[0];
          g = paperRgb[1];
          b = paperRgb[2];
          const nx = x / w;
          const ny = y / h;
          if (nx > 0.24 && nx < 0.76 && ny > 0.22 && ny < 0.78) {
            if (y % 16 >= 4 && y % 16 <= 6 && x % 11 < 7) {
              r = 45;
              g = 46;
              b = 50;
            }
          }
          if (innerTable) {
            const tx0 = w * 0.26, tx1 = w * 0.74, ty0 = h * 0.28, ty1 = h * 0.68;
            const onBox =
              (x >= tx0 && x <= tx1 && (Math.abs(y - ty0) < 1.3 || Math.abs(y - ty1) < 1.3)) ||
              (y >= ty0 && y <= ty1 && (Math.abs(x - tx0) < 1.3 || Math.abs(x - tx1) < 1.3));
            if (onBox) {
              r = 35;
              g = 35;
              b = 38;
            }
          }
          if (sd > -1.2) {
            const edgeDim = 1 - seamStrength * 0.35 * (1 + sd / 1.2);
            r *= edgeDim;
            g *= edgeDim;
            b *= edgeDim;
          }
        } else if (sd < 3.2) {
          const shadow = 1 - seamStrength * Math.exp(-(sd * sd) / 2.2);
          r *= shadow;
          g *= shadow;
          b *= shadow;
        }
      }

      const noise = hashNoise(x, y) * 3.5;
      let diagLight = 1.0;
      if (diagonalShadow) {
        const d = x / w + y / h - 1.0;
        const t = Math.max(0, Math.min(1, (d + 0.08) / 0.16));
        diagLight = 1 - t * t * (3 - 2 * t) * 0.52;
      }
      const idx = (y * w + x) * 3;
      buf[idx] = r * light * diagLight + noise;
      buf[idx + 1] = g * light * diagLight + noise;
      buf[idx + 2] = b * light * diagLight + noise;
    }
  }

  const out = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let r = 0, g = 0, b = 0, wtSum = 0;
      for (let dy = -1; dy <= 1; dy++) {
        const yy = Math.max(0, Math.min(h - 1, y + dy));
        for (let dx = -1; dx <= 1; dx++) {
          const xx = Math.max(0, Math.min(w - 1, x + dx));
          const wt = dx === 0 && dy === 0 ? 4 : dx === 0 || dy === 0 ? 2 : 1;
          const si = (yy * w + xx) * 3;
          r += buf[si] * wt;
          g += buf[si + 1] * wt;
          b += buf[si + 2] * wt;
          wtSum += wt;
        }
      }
      const di = (y * w + x) * 4;
      out[di] = Math.max(0, Math.min(255, Math.round(r / wtSum)));
      out[di + 1] = Math.max(0, Math.min(255, Math.round(g / wtSum)));
      out[di + 2] = Math.max(0, Math.min(255, Math.round(b / wtSum)));
      out[di + 3] = 255;
    }
  }
  return out;
}

describe('documentDetector', () => {
  it('computes exact A4 210:297 guide proportions in portrait and landscape frames', () => {
    const portrait = computeA4GuideQuad(1080, 1440, 0.84);
    const pw = (portrait[1].x - portrait[0].x) * 1080;
    const ph = (portrait[3].y - portrait[0].y) * 1440;
    expect(pw / ph).toBeCloseTo(A4_RATIO, 3);

    const landscape = computeA4GuideQuad(1920, 1080, 0.84);
    const lw = (landscape[1].x - landscape[0].x) * 1920;
    const lh = (landscape[3].y - landscape[0].y) * 1080;
    expect(lh / lw).toBeCloseTo(A4_RATIO, 3);
  });

  it('computes F4, Letter, Legal, ID Card (horizontal default), and Free guide quads accurately', () => {
    const fw = 1080;
    const fh = 1440;

    const measure = (q: Quad) => ({
      w: (q[1].x - q[0].x) * fw,
      h: (q[3].y - q[0].y) * fh,
    });

    const f4 = measure(computeDocumentGuideQuad(fw, fh, 'f4', 'auto'));
    expect(f4.w / f4.h).toBeCloseTo(F4_RATIO, 3);

    const letter = measure(computeDocumentGuideQuad(fw, fh, 'letter', 'auto'));
    expect(letter.w / letter.h).toBeCloseTo(LETTER_RATIO, 3);

    const legal = measure(computeDocumentGuideQuad(fw, fh, 'legal', 'auto'));
    expect(legal.w / legal.h).toBeCloseTo(LEGAL_RATIO, 3);

    // ID Card defaults to landscape even in portrait camera frames
    const idLandscape = measure(computeDocumentGuideQuad(fw, fh, 'id-card', 'auto'));
    expect(idLandscape.w).toBeGreaterThan(idLandscape.h);
    expect(idLandscape.h / idLandscape.w).toBeCloseTo(ID_CARD_RATIO, 3);

    // Flipping orientation to portrait swaps to vertical ID card ratio
    const idPortrait = measure(computeDocumentGuideQuad(fw, fh, 'id-card', 'portrait'));
    expect(idPortrait.h).toBeGreaterThan(idPortrait.w);
    expect(idPortrait.w / idPortrait.h).toBeCloseTo(ID_CARD_RATIO, 3);

    // Free returns subtle 4% inset full-frame guide
    const free = computeDocumentGuideQuad(fw, fh, 'free', 'auto');
    expect(free).toEqual(createDefaultQuad(0.04));
  });

  it('detects an axis-aligned paper sheet on a desk within 3% corner error', () => {
    const w = 360;
    const h = 480;
    const expected: Quad = [
      { x: 0.14, y: 0.12 },
      { x: 0.86, y: 0.12 },
      { x: 0.86, y: 0.88 },
      { x: 0.14, y: 0.88 },
    ];
    const docPx = expected.map((p) => ({ x: p.x * (w - 1), y: p.y * (h - 1) })) as Quad;
    const pixels = renderSyntheticScene({ w, h, docQuadPx: docPx, addText: true, texturedDesk: true });

    const res = detectDocumentQuad(pixels, w, h);
    expect(res.detected).toBe(true);
    expect(maxCornerError(res.quad, expected)).toBeLessThan(0.035);
  });

  it('detects a perspective-tilted trapezoid sheet accurately', () => {
    const w = 420;
    const h = 560;
    const expected: Quad = [
      { x: 0.21, y: 0.13 },
      { x: 0.83, y: 0.17 },
      { x: 0.91, y: 0.86 },
      { x: 0.11, y: 0.82 },
    ];
    const docPx = expected.map((p) => ({ x: p.x * (w - 1), y: p.y * (h - 1) })) as Quad;
    const pixels = renderSyntheticScene({ w, h, docQuadPx: docPx, addText: true, texturedDesk: true });

    const res = detectDocumentQuad(pixels, w, h);
    expect(res.detected).toBe(true);
    expect(maxCornerError(res.quad, expected)).toBeLessThan(0.045);
  });

  it('detects full tilted sheet even under a harsh diagonal phone shadow', () => {
    const w = 420;
    const h = 550;
    const expected: Quad = [
      { x: 0.14, y: 0.11 },
      { x: 0.85, y: 0.08 },
      { x: 0.88, y: 0.89 },
      { x: 0.16, y: 0.92 },
    ];
    const docPx = expected.map((p) => ({ x: p.x * (w - 1), y: p.y * (h - 1) })) as Quad;
    const pixels = renderSyntheticScene({
      w,
      h,
      docQuadPx: docPx,
      addText: true,
      addDiagonalShadow: true,
      texturedDesk: true,
    });

    const res = detectDocumentQuad(pixels, w, h);
    expect(res.detected).toBe(true);
    expect(maxCornerError(res.quad, expected)).toBeLessThan(0.055);
  });

  it('falls back gracefully to provided fallbackQuad on a blank uniform image', () => {
    const w = 200;
    const h = 260;
    const blank = new Uint8ClampedArray(w * h * 4).fill(200);
    for (let i = 3; i < blank.length; i += 4) blank[i] = 255;

    const fallback = createDefaultQuad(0.08);
    const res = detectDocumentQuad(blank, w, h, fallback);
    expect(res.detected).toBe(false);
    expect(res.quad).toEqual(fallback);
  });

  it('detects white paper on a white seamless floor with subtle tint and uneven indoor light', () => {
    const w = 400;
    const h = 533;
    const expected: Quad = [
      { x: 0.16, y: 0.12 },
      { x: 0.85, y: 0.15 },
      { x: 0.88, y: 0.87 },
      { x: 0.13, y: 0.84 },
    ];
    const pixels = renderIndoorWhiteFloorScene({
      w,
      h,
      docQuadNorm: expected,
      floorRgb: [224, 221, 213],
      paperRgb: [228, 230, 234],
      seamStrength: 0.24,
    });

    const res = detectDocumentQuad(pixels, w, h, { workingMaxDim: 400 });
    expect(res.detected).toBe(true);
    expect(maxCornerError(res.quad, expected)).toBeLessThan(0.035);
  });

  it('detects white paper on a white floor even with zero tint difference (contact seam only)', () => {
    const w = 400;
    const h = 533;
    const expected: Quad = [
      { x: 0.15, y: 0.13 },
      { x: 0.84, y: 0.11 },
      { x: 0.87, y: 0.88 },
      { x: 0.14, y: 0.86 },
    ];
    const pixels = renderIndoorWhiteFloorScene({
      w,
      h,
      docQuadNorm: expected,
      floorRgb: [226, 226, 226],
      paperRgb: [228, 228, 229],
      seamStrength: 0.28,
    });

    const res = detectDocumentQuad(pixels, w, h, { workingMaxDim: 400 });
    expect(res.detected).toBe(true);
    expect(maxCornerError(res.quad, expected)).toBeLessThan(0.035);
  });

  it('detects white paper on a white ceramic tile floor without snapping onto dark grout lines', () => {
    const w = 400;
    const h = 533;
    const expected: Quad = [
      { x: 0.17, y: 0.14 },
      { x: 0.84, y: 0.17 },
      { x: 0.86, y: 0.86 },
      { x: 0.15, y: 0.83 },
    ];
    const pixels = renderIndoorWhiteFloorScene({
      w,
      h,
      docQuadNorm: expected,
      floorRgb: [224, 222, 216],
      paperRgb: [229, 230, 233],
      seamStrength: 0.24,
      groutGrid: { spacing: 112, angleDeg: 3.5, color: [148, 145, 138] },
    });

    const res = detectDocumentQuad(pixels, w, h, { workingMaxDim: 400 });
    expect(res.detected).toBe(true);
    expect(maxCornerError(res.quad, expected)).toBeLessThan(0.04);
  });

  it('prefers outer white-floor paper perimeter over bold interior printed table borders', () => {
    const w = 400;
    const h = 533;
    const expected: Quad = [
      { x: 0.14, y: 0.12 },
      { x: 0.86, y: 0.13 },
      { x: 0.85, y: 0.88 },
      { x: 0.15, y: 0.87 },
    ];
    const pixels = renderIndoorWhiteFloorScene({
      w,
      h,
      docQuadNorm: expected,
      floorRgb: [222, 219, 211],
      paperRgb: [228, 229, 233],
      seamStrength: 0.25,
      innerTable: true,
    });

    const res = detectDocumentQuad(pixels, w, h, { workingMaxDim: 400 });
    expect(res.detected).toBe(true);
    expect(maxCornerError(res.quad, expected)).toBeLessThan(0.035);
  });

  it('rejects empty white ceramic tile grout grids when no document is present', () => {
    const w = 400;
    const h = 533;
    const pixels = renderIndoorWhiteFloorScene({
      w,
      h,
      docQuadNorm: null,
      floorRgb: [224, 222, 216],
      paperRgb: [229, 230, 233],
      seamStrength: 0,
      groutGrid: { spacing: 112, angleDeg: 2.0, color: [148, 145, 138] },
    });

    const fallback = createDefaultQuad(0.06);
    const res = detectDocumentQuad(pixels, w, h, { fallbackQuad: fallback, workingMaxDim: 400 });
    expect(res.detected).toBe(false);
    expect(res.quad).toEqual(fallback);
  });

  it('detects white paper on a white floor even under a diagonal indoor shadow', () => {
    const w = 400;
    const h = 533;
    const expected: Quad = [
      { x: 0.15, y: 0.12 },
      { x: 0.84, y: 0.15 },
      { x: 0.88, y: 0.87 },
      { x: 0.14, y: 0.85 },
    ];
    const pixels = renderIndoorWhiteFloorScene({
      w,
      h,
      docQuadNorm: expected,
      floorRgb: [224, 221, 214],
      paperRgb: [229, 230, 233],
      seamStrength: 0.24,
      diagonalShadow: true,
    });

    const res = detectDocumentQuad(pixels, w, h, { workingMaxDim: 400 });
    expect(res.detected).toBe(true);
    expect(maxCornerError(res.quad, expected)).toBeLessThan(0.04);
  });

  it('resolveCapturedQuad preserves locked previewQuad when still detection misses or drifts far', () => {
    const w = 240;
    const h = 320;
    const blank = new Uint8ClampedArray(w * h * 4).fill(210);
    for (let i = 3; i < blank.length; i += 4) blank[i] = 255;

    const previewQuad: Quad = [
      { x: 0.12, y: 0.14 },
      { x: 0.88, y: 0.13 },
      { x: 0.90, y: 0.88 },
      { x: 0.10, y: 0.86 },
    ];
    const resolvedMiss = resolveCapturedQuad(blank, w, h, {
      previewQuad,
      fallbackQuad: createDefaultQuad(0.05),
    });
    expect(resolvedMiss.detected).toBe(true);
    expect(resolvedMiss.quad).toEqual(previewQuad);

    // Drifted still detection (>4.5% away) also preserves the previewQuad the user approved
    const farDoc: Quad = [
      { x: 0.30, y: 0.30 },
      { x: 0.72, y: 0.30 },
      { x: 0.72, y: 0.72 },
      { x: 0.30, y: 0.72 },
    ];
    const farPixels = renderIndoorWhiteFloorScene({
      w: 360,
      h: 480,
      docQuadNorm: farDoc,
      floorRgb: [224, 222, 216],
      paperRgb: [229, 230, 233],
      seamStrength: 0.25,
    });
    const resolvedDrift = resolveCapturedQuad(farPixels, 360, 480, {
      previewQuad,
      workingMaxDim: 400,
    });
    expect(resolvedDrift.quad).toEqual(previewQuad);
  });

  it('resolveCapturedQuad tracks small still-frame motion around previewQuad and smoothQuad snaps on page turns', () => {
    const w = 360;
    const h = 480;
    const actualDoc: Quad = [
      { x: 0.14, y: 0.12 },
      { x: 0.86, y: 0.13 },
      { x: 0.88, y: 0.87 },
      { x: 0.13, y: 0.86 },
    ];
    const slightPreviewShift: Quad = actualDoc.map((p) => ({
      x: p.x + 0.015,
      y: p.y - 0.01,
    })) as Quad;

    const pixels = renderIndoorWhiteFloorScene({
      w,
      h,
      docQuadNorm: actualDoc,
      floorRgb: [224, 222, 216],
      paperRgb: [229, 230, 233],
      seamStrength: 0.26,
      innerTable: true,
    });
    const res = resolveCapturedQuad(pixels, w, h, {
      previewQuad: slightPreviewShift,
      workingMaxDim: 400,
    });
    expect(res.detected).toBe(true);
    expect(maxCornerError(res.quad, actualDoc)).toBeLessThan(0.03);

    // smoothQuad interpolates small jitter, but snaps on sharp page shifts (> 12%)
    const smallNext = actualDoc.map((p) => ({ x: p.x + 0.02, y: p.y })) as Quad;
    const smoothed = smoothQuad(actualDoc, smallNext, 0.5);
    expect(smoothed[0].x).toBeCloseTo(actualDoc[0].x + 0.01, 4);

    const jumpedNext: Quad = [
      { x: 0.35, y: 0.25 },
      { x: 0.80, y: 0.25 },
      { x: 0.80, y: 0.75 },
      { x: 0.35, y: 0.75 },
    ];
    expect(smoothQuad(actualDoc, jumpedNext, 0.5)).toEqual(jumpedNext);
  });
});
