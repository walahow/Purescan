import { describe, expect, it } from 'vitest';
import { computeSharpnessScore } from '../sharpness';

function createCrispTextPattern(w = 300, h = 400): Uint8ClampedArray {
  const buf = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      // Crisp white paper with sharp black text-like bars & grid lines
      const inDoc = x > 25 && x < w - 25 && y > 30 && y < h - 30;
      const isText = inDoc && y % 16 >= 0 && y % 16 < 3 && (x % 12 < 8);
      const v = isText ? 22 : 240;
      const i = (y * w + x) * 4;
      buf[i] = v;
      buf[i + 1] = v;
      buf[i + 2] = v;
      buf[i + 3] = 255;
    }
  }
  return buf;
}

function boxBlurRgba(src: Uint8ClampedArray, w: number, h: number, radius: number): Uint8ClampedArray {
  const dst = new Uint8ClampedArray(src.length);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let sr = 0;
      let sg = 0;
      let sb = 0;
      let count = 0;
      for (let dy = -radius; dy <= radius; dy++) {
        const py = Math.max(0, Math.min(h - 1, y + dy));
        for (let dx = -radius; dx <= radius; dx++) {
          const px = Math.max(0, Math.min(w - 1, x + dx));
          const i = (py * w + px) * 4;
          sr += src[i];
          sg += src[i + 1];
          sb += src[i + 2];
          count++;
        }
      }
      const o = (y * w + x) * 4;
      dst[o] = Math.round(sr / count);
      dst[o + 1] = Math.round(sg / count);
      dst[o + 2] = Math.round(sb / count);
      dst[o + 3] = 255;
    }
  }
  return dst;
}

describe('computeSharpnessScore', () => {
  it('scores crisp document text as sharp and heavily blurred image as blurry', () => {
    const w = 300;
    const h = 400;
    const sharp = createCrispTextPattern(w, h);
    const soft = boxBlurRgba(sharp, w, h, 2);
    const blurry = boxBlurRgba(soft, w, h, 3);

    const sharpReport = computeSharpnessScore(sharp, w, h);
    const softReport = computeSharpnessScore(soft, w, h);
    const blurryReport = computeSharpnessScore(blurry, w, h);

    expect(sharpReport.status).toBe('sharp');
    expect(sharpReport.score).toBeGreaterThan(softReport.score * 2);
    expect(softReport.score).toBeGreaterThan(blurryReport.score);
    expect(blurryReport.status).toBe('blurry');
  });

  it('remains consistent across dim vs bright lighting', () => {
    const w = 240;
    const h = 320;
    const bright = createCrispTextPattern(w, h);
    const dim = new Uint8ClampedArray(bright.length);
    for (let i = 0; i < bright.length; i += 4) {
      dim[i] = Math.round(bright[i] * 0.45);
      dim[i + 1] = Math.round(bright[i + 1] * 0.45);
      dim[i + 2] = Math.round(bright[i + 2] * 0.45);
      dim[i + 3] = 255;
    }

    const dimReport = computeSharpnessScore(dim, w, h);
    expect(dimReport.status).toBe('sharp');
  });

  it('reports blank/uniform frames as blurry', () => {
    const w = 160;
    const h = 160;
    const blank = new Uint8ClampedArray(w * h * 4).fill(210);
    for (let i = 3; i < blank.length; i += 4) blank[i] = 255;

    const report = computeSharpnessScore(blank, w, h);
    expect(report.score).toBe(0);
    expect(report.status).toBe('blurry');
  });
});
