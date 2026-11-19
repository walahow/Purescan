import { describe, expect, it } from 'vitest';
import { applyDocumentFilter } from '../filters';
import { DEFAULT_ADJUSTMENTS } from '../../types/scan';

/**
 * Generates a realistic synthetic shadowed document (400 x 560):
 * - Warm indoor lit top-left paper (~RGB 232, 224, 206)
 * - Harsh phone shadow diagonally across bottom-right dropping paper to (~RGB 96, 94, 98)
 * - Black printed text stripes in both lit and shadowed zones
 * - Blue ink stroke & red stamp mark in both lit and shadowed zones
 */
function createSyntheticShadowedDocument(w = 400, h = 560) {
  const buf = new Uint8ClampedArray(w * h * 4);

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      // Smooth-penumbra diagonal shadow: top-left lit (factor 1.0), bottom-right shadowed (factor 0.42)
      const diag = x / w + y / h - 1.05; // < 0 lit, > 0 shadow
      const t = Math.max(0, Math.min(1, (diag + 0.06) / 0.12));
      const smoothShadow = t * t * (3 - 2 * t);
      const light = 1.0 - smoothShadow * 0.58; // 1.0 -> 0.42

      // Base warm paper reflectance
      let r = 232 * light;
      let g = 224 * light;
      let b = 206 * light;

      // Printed black text lines (height 5px every 28px)
      const inMargin = x > 36 && x < w - 36 && y > 40 && y < h - 40;
      const isTextRow = inMargin && y % 28 >= 0 && y % 28 < 5 && (x % 18 < 14);
      if (isTextRow) {
        r = 35 * light;
        g = 35 * light;
        b = 38 * light;
      }

      // Blue ballpoint ink box in lit region (top-left) and shadowed region (bottom-right)
      const isBlueLit = x >= 60 && x <= 110 && y >= 95 && y <= 104;
      const isBlueShadow = x >= 270 && x <= 330 && y >= 435 && y <= 444;
      if (isBlueLit || isBlueShadow) {
        r = 35 * light;
        g = 75 * light;
        b = 200 * light;
      }

      // Red university stamp mark in shadowed region
      const dx = x - 300;
      const dy = y - 370;
      const dist = Math.hypot(dx, dy);
      if (dist >= 16 && dist <= 22) {
        r = 195 * light;
        g = 38 * light;
        b = 42 * light;
      }

      const idx = (y * w + x) * 4;
      buf[idx] = Math.round(r);
      buf[idx + 1] = Math.round(g);
      buf[idx + 2] = Math.round(b);
      buf[idx + 3] = 255;
    }
  }

  return { pixels: buf, width: w, height: h };
}

function meanRgbInBox(buf: Uint8ClampedArray, w: number, x0: number, y0: number, x1: number, y1: number) {
  let sr = 0, sg = 0, sb = 0, n = 0;
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const i = (y * w + x) * 4;
      sr += buf[i];
      sg += buf[i + 1];
      sb += buf[i + 2];
      n++;
    }
  }
  return { r: sr / n, g: sg / n, b: sb / n, lum: (0.299 * sr + 0.587 * sg + 0.114 * sb) / n };
}

describe('document shadow-removal & pure filters', () => {
  const doc = createSyntheticShadowedDocument();

  it('pure-color removes harsh diagonal shadow, neutralizes warm paper tint, and preserves ink colors', () => {
    const out = applyDocumentFilter(doc.pixels, doc.width, doc.height, 'pure-color', DEFAULT_ADJUSTMENTS);

    // Check paper brightness in lit zone vs heavily shadowed zone
    const rawLitPaper = meanRgbInBox(doc.pixels, doc.width, 60, 62, 100, 74);
    const rawShadowPaper = meanRgbInBox(doc.pixels, doc.width, 280, 480, 340, 496);
    expect(rawLitPaper.lum - rawShadowPaper.lum).toBeGreaterThan(100); // Confirm severe input shadow

    const cleanLitPaper = meanRgbInBox(out, doc.width, 60, 62, 100, 74);
    const cleanShadowPaper = meanRgbInBox(out, doc.width, 280, 480, 340, 496);

    // Both lit and shadowed paper should become bright clean white!
    expect(cleanLitPaper.lum).toBeGreaterThan(235);
    expect(cleanShadowPaper.lum).toBeGreaterThan(220);
    // Shadow gap must shrink drastically (from >100 down to <20)
    expect(Math.abs(cleanLitPaper.lum - cleanShadowPaper.lum)).toBeLessThan(20);
    // Warm yellow cast neutralized (R and B nearly equal on white paper)
    expect(Math.abs(cleanLitPaper.r - cleanLitPaper.b)).toBeLessThan(8);

    // Black text in shadowed zone must remain crisp and dark (x=272..282 -> x%18 in [2..12], solid glyph)
    const shadowText = meanRgbInBox(out, doc.width, 272, 448, 282, 452);
    expect(shadowText.lum).toBeLessThan(65);

    // Blue pen in shadowed zone must keep strong blue dominance
    const shadowBlue = meanRgbInBox(out, doc.width, 275, 437, 325, 442);
    expect(shadowBlue.b - shadowBlue.r).toBeGreaterThan(100);

    // Red stamp in shadowed zone must keep strong red dominance
    const shadowRed = meanRgbInBox(out, doc.width, 298, 350, 302, 353);
    expect(shadowRed.r - shadowRed.b).toBeGreaterThan(90);
  });

  it('no-shadow (Tanpa Bayangan) removes harsh diagonal shadow while preserving natural midtones and colors', () => {
    const out = applyDocumentFilter(doc.pixels, doc.width, doc.height, 'no-shadow', DEFAULT_ADJUSTMENTS);

    const cleanLitPaper = meanRgbInBox(out, doc.width, 60, 62, 100, 74);
    const cleanShadowPaper = meanRgbInBox(out, doc.width, 280, 480, 340, 496);

    expect(cleanLitPaper.lum).toBeGreaterThan(230);
    expect(cleanShadowPaper.lum).toBeGreaterThan(215);
    expect(Math.abs(cleanLitPaper.lum - cleanShadowPaper.lum)).toBeLessThan(22);

    const shadowText = meanRgbInBox(out, doc.width, 272, 448, 282, 452);
    expect(shadowText.lum).toBeLessThan(75);

    const shadowBlue = meanRgbInBox(out, doc.width, 275, 437, 325, 442);
    expect(shadowBlue.b - shadowBlue.r).toBeGreaterThan(80);

    const shadowRed = meanRgbInBox(out, doc.width, 298, 350, 302, 353);
    expect(shadowRed.r - shadowRed.b).toBeGreaterThan(75);
  });

  it('pure-bw outputs pure grayscale with clean white paper and crisp black text in both zones', () => {
    const out = applyDocumentFilter(doc.pixels, doc.width, doc.height, 'pure-bw', DEFAULT_ADJUSTMENTS);

    // Verify exact grayscale invariant
    for (let i = 0; i < out.length; i += 400) {
      expect(out[i]).toBe(out[i + 1]);
      expect(out[i + 1]).toBe(out[i + 2]);
      expect(out[i + 3]).toBe(255);
    }

    const litPaper = meanRgbInBox(out, doc.width, 60, 62, 100, 74);
    const shadowPaper = meanRgbInBox(out, doc.width, 280, 480, 340, 496);
    // Sample strictly inside solid ink glyphs (x%18 in [2..12] < 14)
    const litText = meanRgbInBox(out, doc.width, 56, 56, 66, 60);
    const shadowText = meanRgbInBox(out, doc.width, 272, 448, 282, 452);

    expect(litPaper.lum).toBeGreaterThan(248);
    expect(shadowPaper.lum).toBeGreaterThan(240);
    expect(litText.lum).toBeLessThan(20);
    expect(shadowText.lum).toBeLessThan(20);
  });

  it('grayscale removes shadow cleanly while remaining grayscale', () => {
    const out = applyDocumentFilter(doc.pixels, doc.width, doc.height, 'grayscale', DEFAULT_ADJUSTMENTS);
    const shadowPaper = meanRgbInBox(out, doc.width, 280, 480, 340, 496);
    expect(shadowPaper.lum).toBeGreaterThan(220);
    expect(out[0]).toBe(out[1]);
    expect(out[1]).toBe(out[2]);
  });

  it('original returns untouched copy when brightness and contrast are 0', () => {
    const out = applyDocumentFilter(doc.pixels, doc.width, doc.height, 'original', {
      shadowStrength: 100,
      contrast: 0,
      brightness: 0,
    });
    expect(out).not.toBe(doc.pixels);
    expect(out[0]).toBe(doc.pixels[0]);
    expect(out[out.length - 4]).toBe(doc.pixels[doc.pixels.length - 4]);
  });
});
