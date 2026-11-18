import { describe, expect, it } from 'vitest';
import { unapplyPdfPredictor } from '../pdfPredictor';

function paeth(a: number, b: number, c: number): number {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  if (pb <= pc) return b;
  return c;
}

function encodePngRows(
  raw: Uint8Array,
  columns: number,
  rows: number,
  colors: number,
  filterPerRow: number[]
): Uint8Array {
  const rowBytes = columns * colors;
  const out = new Uint8Array(rows * (rowBytes + 1));

  for (let y = 0; y < rows; y++) {
    const f = filterPerRow[y];
    const srcStart = y * rowBytes;
    const prevStart = srcStart - rowBytes;
    const dstStart = y * (rowBytes + 1);
    out[dstStart] = f;

    for (let x = 0; x < rowBytes; x++) {
      const cur = raw[srcStart + x];
      const left = x >= colors ? raw[srcStart + x - colors] : 0;
      const up = y > 0 ? raw[prevStart + x] : 0;
      const upLeft = y > 0 && x >= colors ? raw[prevStart + x - colors] : 0;

      let pred = 0;
      if (f === 1) pred = left;
      else if (f === 2) pred = up;
      else if (f === 3) pred = (left + up) >> 1;
      else if (f === 4) pred = paeth(left, up, upLeft);

      out[dstStart + 1 + x] = (cur - pred) & 0xff;
    }
  }
  return out;
}

describe('PDF Flate predictor decoder', () => {
  it('passes through predictor 1 unchanged', () => {
    const raw = new Uint8Array([10, 20, 30, 40, 50, 60]);
    const decoded = unapplyPdfPredictor(raw, {
      predictor: 1,
      columns: 2,
      rows: 1,
      colors: 3,
      bitsPerComponent: 8,
    });
    expect(decoded).toEqual(raw);
  });

  it('decodes TIFF predictor 2 (horizontal differencing) accurately for RGB', () => {
    // 3 pixels RGB: (10,20,30), (25,50,10), (255,0,128)
    const raw = new Uint8Array([10, 20, 30, 25, 50, 10, 255, 0, 128]);
    const diffed = new Uint8Array(raw.length);
    for (let x = 0; x < raw.length; x++) {
      const left = x >= 3 ? raw[x - 3] : 0;
      diffed[x] = (raw[x] - left) & 0xff;
    }

    const decoded = unapplyPdfPredictor(diffed, {
      predictor: 2,
      columns: 3,
      rows: 1,
      colors: 3,
      bitsPerComponent: 8,
    });
    expect(decoded).toEqual(raw);
  });

  it('round-trips all 5 PNG filter types (None, Sub, Up, Average, Paeth) on RGB & Grayscale', () => {
    const cols = 4;
    const rows = 5;
    const colors = 3;
    const raw = new Uint8Array(cols * rows * colors);
    for (let i = 0; i < raw.length; i++) {
      raw[i] = (i * 37 + 19) & 0xff;
    }

    const encoded = encodePngRows(raw, cols, rows, colors, [0, 1, 2, 3, 4]);
    const decoded = unapplyPdfPredictor(encoded, {
      predictor: 15,
      columns: cols,
      rows,
      colors,
      bitsPerComponent: 8,
    });

    expect(decoded).toEqual(raw);
  });

  it('returns null cleanly for unsupported predictors, non-8-bit depths, or truncated buffers', () => {
    const small = new Uint8Array([0, 1, 2]);
    expect(
      unapplyPdfPredictor(small, {
        predictor: 12,
        columns: 4,
        rows: 4,
        colors: 3,
        bitsPerComponent: 8,
      })
    ).toBeNull();

    expect(
      unapplyPdfPredictor(new Uint8Array(100), {
        predictor: 99,
        columns: 4,
        rows: 4,
        colors: 3,
        bitsPerComponent: 8,
      })
    ).toBeNull();

    expect(
      unapplyPdfPredictor(new Uint8Array(100), {
        predictor: 15,
        columns: 4,
        rows: 4,
        colors: 3,
        bitsPerComponent: 4,
      })
    ).toBeNull();
  });
});
