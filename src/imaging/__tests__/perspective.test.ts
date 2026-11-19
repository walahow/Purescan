import { describe, expect, it } from 'vitest';
import {
  A4_RATIO,
  computeTargetSize,
  createDefaultQuad,
  createFullQuad,
  isConvexQuad,
  rotateImageBuffer,
  solveHomography,
  warpPerspective,
} from '../perspective';
import type { Quad } from '../../types/scan';

describe('perspective geometry & homography warp', () => {
  it('validates strictly convex clockwise quads and rejects invalid/bow-tie quads', () => {
    expect(isConvexQuad(createDefaultQuad())).toBe(true);
    expect(isConvexQuad(createFullQuad())).toBe(true);

    // Tilted trapezoid (still convex & clockwise)
    const trapezoid: Quad = [
      { x: 0.2, y: 0.1 },
      { x: 0.8, y: 0.15 },
      { x: 0.92, y: 0.9 },
      { x: 0.08, y: 0.88 },
    ];
    expect(isConvexQuad(trapezoid)).toBe(true);

    // Self-intersecting bow-tie (swapped BR and BL)
    const bowtie: Quad = [
      { x: 0.1, y: 0.1 },
      { x: 0.9, y: 0.1 },
      { x: 0.1, y: 0.9 },
      { x: 0.9, y: 0.9 },
    ];
    expect(isConvexQuad(bowtie)).toBe(false);

    // Concave quad (TL pushed past diagonal)
    const concave: Quad = [
      { x: 0.7, y: 0.7 },
      { x: 0.9, y: 0.1 },
      { x: 0.9, y: 0.9 },
      { x: 0.1, y: 0.9 },
    ];
    expect(isConvexQuad(concave)).toBe(false);

    // Collapsed near-zero area quad
    const tiny: Quad = [
      { x: 0.5, y: 0.5 },
      { x: 0.51, y: 0.5 },
      { x: 0.51, y: 0.51 },
      { x: 0.5, y: 0.51 },
    ];
    expect(isConvexQuad(tiny)).toBe(false);
  });

  it('computes target output sizes with A4 lock and maxDim capping', () => {
    const quad = createFullQuad();
    const autoSize = computeTargetSize(quad, 3000, 4000, 'auto', 2200);
    expect(autoSize.height).toBe(2200);
    expect(autoSize.width).toBe(1650);

    const a4Portrait = computeTargetSize(quad, 1000, 1500, 'a4', 2200);
    expect(a4Portrait.height).toBe(1500);
    expect(a4Portrait.width).toBeCloseTo(1500 * A4_RATIO, 0);

    const a4Landscape = computeTargetSize(quad, 1600, 1000, 'a4', 2200);
    expect(a4Landscape.width).toBe(1600);
    expect(a4Landscape.height).toBeCloseTo(1600 * A4_RATIO, 0);
  });

  it('solves exact inverse homography mapping destination corners back to source quad', () => {
    const srcQuadPx: Quad = [
      { x: 40, y: 20 },
      { x: 260, y: 50 },
      { x: 290, y: 380 },
      { x: 15, y: 350 },
    ];
    const dstW = 200;
    const dstH = 300;
    const H = solveHomography(srcQuadPx, dstW, dstH);

    const testMap = (u: number, v: number) => {
      const w = H[6] * u + H[7] * v + H[8];
      return {
        x: (H[0] * u + H[1] * v + H[2]) / w,
        y: (H[3] * u + H[4] * v + H[5]) / w,
      };
    };

    const tl = testMap(0, 0);
    const tr = testMap(dstW - 1, 0);
    const br = testMap(dstW - 1, dstH - 1);
    const bl = testMap(0, dstH - 1);

    expect(tl.x).toBeCloseTo(40, 4);
    expect(tl.y).toBeCloseTo(20, 4);
    expect(tr.x).toBeCloseTo(260, 4);
    expect(tr.y).toBeCloseTo(50, 4);
    expect(br.x).toBeCloseTo(290, 4);
    expect(br.y).toBeCloseTo(380, 4);
    expect(bl.x).toBeCloseTo(15, 4);
    expect(bl.y).toBeCloseTo(350, 4);
  });

  it('warps a skewed synthetic colored marker sheet accurately into a flat rectangle', () => {
    // Source 100x100 image: dark gray background, white sheet inside [20..80, 10..90]
    // with distinct colored quadrant squares at its 4 inner corners
    const srcW = 100;
    const srcH = 100;
    const src = new Uint8ClampedArray(srcW * srcH * 4);
    const setPx = (x: number, y: number, r: number, g: number, b: number) => {
      const i = (y * srcW + x) * 4;
      src[i] = r;
      src[i + 1] = g;
      src[i + 2] = b;
      src[i + 3] = 255;
    };

    for (let y = 0; y < srcH; y++) {
      for (let x = 0; x < srcW; x++) {
        setPx(x, y, 40, 40, 40);
      }
    }

    // Paint inner white rectangle with 4 distinct corner patches
    for (let y = 10; y <= 90; y++) {
      for (let x = 20; x <= 80; x++) {
        if (x < 35 && y < 25) setPx(x, y, 240, 20, 20); // TL red
        else if (x > 65 && y < 25) setPx(x, y, 20, 240, 20); // TR green
        else if (x > 65 && y > 75) setPx(x, y, 20, 20, 240); // BR blue
        else if (x < 35 && y > 75) setPx(x, y, 240, 240, 20); // BL yellow
        else setPx(x, y, 250, 250, 250);
      }
    }

    const quad: Quad = [
      { x: 20 / 99, y: 10 / 99 },
      { x: 80 / 99, y: 10 / 99 },
      { x: 80 / 99, y: 90 / 99 },
      { x: 20 / 99, y: 90 / 99 },
    ];

    const dstW = 60;
    const dstH = 80;
    const warped = warpPerspective(src, srcW, srcH, quad, dstW, dstH);
    const warpedHq = warpPerspective(src, srcW, srcH, quad, dstW, dstH, true);

    const sample = (x: number, y: number, buf = warped) => {
      const i = (y * dstW + x) * 4;
      return [buf[i], buf[i + 1], buf[i + 2]];
    };

    // Corners should match the 4 distinct colors cleanly (bilinear + Catmull-Rom)
    for (const buf of [warped, warpedHq]) {
      expect(sample(4, 4, buf)[0]).toBeGreaterThan(220); // Red TL
      expect(sample(4, 4, buf)[1]).toBeLessThan(40);
      expect(sample(dstW - 5, 4, buf)[1]).toBeGreaterThan(220); // Green TR
      expect(sample(dstW - 5, dstH - 5, buf)[2]).toBeGreaterThan(220); // Blue BR
      expect(sample(4, dstH - 5, buf)[0]).toBeGreaterThan(220); // Yellow BL
      expect(sample(4, dstH - 5, buf)[1]).toBeGreaterThan(220);
      // Center should be clean white paper
      const center = sample(30, 40, buf);
      expect(center[0]).toBeGreaterThan(240);
      expect(center[1]).toBeGreaterThan(240);
      expect(center[2]).toBeGreaterThan(240);
    }
  });

  it('rotates RGBA buffers accurately for 90, 180, and 270 degrees', () => {
    // 2x3 image with distinct pixel R values 10..60
    const src = new Uint8ClampedArray([
      10, 0, 0, 255, 20, 0, 0, 255,
      30, 0, 0, 255, 40, 0, 0, 255,
      50, 0, 0, 255, 60, 0, 0, 255,
    ]);

    const r90 = rotateImageBuffer(src, 2, 3, 90);
    expect(r90.width).toBe(3);
    expect(r90.height).toBe(2);
    // Row 0 of 90deg CW should be [50, 30, 10], Row 1 should be [60, 40, 20]
    expect([r90.pixels[0], r90.pixels[4], r90.pixels[8]]).toEqual([50, 30, 10]);
    expect([r90.pixels[12], r90.pixels[16], r90.pixels[20]]).toEqual([60, 40, 20]);

    const r180 = rotateImageBuffer(src, 2, 3, 180);
    expect(r180.width).toBe(2);
    expect(r180.height).toBe(3);
    expect(r180.pixels[0]).toBe(60);
    expect(r180.pixels[20]).toBe(10);

    const r270 = rotateImageBuffer(src, 2, 3, 270);
    expect(r270.width).toBe(3);
    expect(r270.height).toBe(2);
    // Row 0 of 270deg CW should be [20, 40, 60]
    expect([r270.pixels[0], r270.pixels[4], r270.pixels[8]]).toEqual([20, 40, 60]);
  });
});
