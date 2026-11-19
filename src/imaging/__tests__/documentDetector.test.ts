import { describe, expect, it } from 'vitest';
import {
  computeA4GuideQuad,
  computeDocumentGuideQuad,
  detectDocumentQuad,
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
});
