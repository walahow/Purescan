import { describe, expect, it } from 'vitest';
import { computeOtsuThreshold, packRgbaTo1Bit } from '../monochrome';

function makeRgbaFromLuma(luma: number[]): Uint8ClampedArray {
  const out = new Uint8ClampedArray(luma.length * 4);
  for (let i = 0; i < luma.length; i++) {
    out[i * 4] = luma[i];
    out[i * 4 + 1] = luma[i];
    out[i * 4 + 2] = luma[i];
    out[i * 4 + 3] = 255;
  }
  return out;
}

describe('1-bit monochrome PDF encoder', () => {
  it('packs 8 pixels MSB-first with 1=white and 0=black', () => {
    // Pattern: B, W, B, B, W, W, W, B => 01001110 = 0x4E
    const pixels = makeRgbaFromLuma([0, 255, 10, 20, 240, 255, 200, 0]);
    const res = packRgbaTo1Bit(pixels, 8, 1, 128);

    expect(res.rowBytes).toBe(1);
    expect(res.packedBits.length).toBe(1);
    expect(res.packedBits[0]).toBe(0b01001110);
  });

  it('byte-aligns every scanline and pads trailing right bits with white (1) when width % 8 !== 0', () => {
    // 10 pixels wide x 2 rows => rowBytes = ceil(10 / 8) = 2 bytes per row, 4 bytes total
    // Row 0: 8 black pixels, then [black, white] => byte0 = 0x00, byte1 = 0b01_111111 = 0x7F
    // Row 1: 8 white pixels, then [white, black] => byte0 = 0xFF, byte1 = 0b10_111111 = 0xBF
    const row0 = [0, 0, 0, 0, 0, 0, 0, 0, 0, 255];
    const row1 = [255, 255, 255, 255, 255, 255, 255, 255, 255, 0];
    const pixels = makeRgbaFromLuma([...row0, ...row1]);
    const res = packRgbaTo1Bit(pixels, 10, 2, 128);

    expect(res.rowBytes).toBe(2);
    expect(res.packedBits.length).toBe(4);
    expect(res.packedBits[0]).toBe(0x00);
    expect(res.packedBits[1]).toBe(0b01111111);
    expect(res.packedBits[2]).toBe(0xff);
    expect(res.packedBits[3]).toBe(0b10111111);
  });

  it('handles odd edge widths (1, 7, 9, 13) with exact byte stride', () => {
    for (const w of [1, 7, 8, 9, 13, 17]) {
      const h = 5;
      const pixels = new Uint8ClampedArray(w * h * 4).fill(255);
      const res = packRgbaTo1Bit(pixels, w, h, 165);
      expect(res.rowBytes).toBe(Math.ceil(w / 8));
      expect(res.packedBits.length).toBe(Math.ceil(w / 8) * h);
      // All white image => every byte must be 0xFF
      for (const byte of res.packedBits) {
        expect(byte).toBe(0xff);
      }
    }
  });

  it('computes a sensible Otsu threshold separating dark ink from bright paper', () => {
    // 85% white paper (~240), 15% dark ink (~35)
    const lum = new Uint8Array(1000);
    for (let i = 0; i < 150; i++) lum[i] = 35;
    for (let i = 150; i < 1000; i++) lum[i] = 240;

    const t = computeOtsuThreshold(lum);
    expect(t).toBeGreaterThanOrEqual(35);
    expect(t).toBeLessThan(240);
  });
});
