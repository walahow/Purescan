/**
 * Pure TypeScript decoder for PDF Flate/LZW image stream predictors
 * (ISO 32000-1 §7.4.4.4: TIFF Predictor 2 and PNG Predictors 10..15).
 *
 * pdf-lib's `decodePDFRawStream` inflates zlib/LZW bytes but does not reverse
 * predictor filtering; this module handles predictor reconstruction cleanly
 * and returns `null` for unsupported/corrupt configurations so callers can
 * safely skip the image instead of corrupting it.
 */

export interface PdfPredictorParams {
  predictor: number;
  columns: number;
  rows: number;
  colors: number;
  bitsPerComponent: number;
}

function paethPredictor(a: number, b: number, c: number): number {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  if (pb <= pc) return b;
  return c;
}

/**
 * Reverses TIFF-2 or PNG (10..15) prediction on an inflated 8-bit image buffer.
 * Returns raw interleaved pixel bytes (`rows * columns * colors`), or `null` if unsupported.
 */
export function unapplyPdfPredictor(
  data: Uint8Array,
  params: PdfPredictorParams
): Uint8Array | null {
  const { predictor, columns, rows, colors, bitsPerComponent } = params;

  if (columns <= 0 || rows <= 0 || (colors !== 1 && colors !== 3)) {
    return null;
  }
  if (bitsPerComponent !== 8) {
    return null;
  }

  const rowBytes = columns * colors;
  const expectedRawLen = rowBytes * rows;

  // Predictor 1 = No prediction
  if (predictor === 1) {
    if (data.byteLength < expectedRawLen) return null;
    return data.byteLength === expectedRawLen ? data : data.subarray(0, expectedRawLen);
  }

  // Predictor 2 = TIFF horizontal differencing (8-bit)
  if (predictor === 2) {
    if (data.byteLength < expectedRawLen) return null;
    const out = new Uint8Array(expectedRawLen);
    for (let y = 0; y < rows; y++) {
      const rowOffset = y * rowBytes;
      for (let x = 0; x < rowBytes; x++) {
        const left = x >= colors ? out[rowOffset + x - colors] : 0;
        out[rowOffset + x] = (data[rowOffset + x] + left) & 0xff;
      }
    }
    return out;
  }

  // Predictors 10..15 = PNG scanline filtering (1 filter-type byte prefix per row)
  if (predictor >= 10 && predictor <= 15) {
    const srcRowStride = rowBytes + 1;
    if (data.byteLength < srcRowStride * rows) return null;

    const out = new Uint8Array(expectedRawLen);
    for (let y = 0; y < rows; y++) {
      const srcStart = y * srcRowStride;
      const filterType = data[srcStart];
      const dstStart = y * rowBytes;
      const prevRowStart = dstStart - rowBytes;

      if (filterType === 0) {
        // None
        out.set(data.subarray(srcStart + 1, srcStart + 1 + rowBytes), dstStart);
      } else if (filterType === 1) {
        // Sub
        for (let x = 0; x < rowBytes; x++) {
          const left = x >= colors ? out[dstStart + x - colors] : 0;
          out[dstStart + x] = (data[srcStart + 1 + x] + left) & 0xff;
        }
      } else if (filterType === 2) {
        // Up
        for (let x = 0; x < rowBytes; x++) {
          const up = y > 0 ? out[prevRowStart + x] : 0;
          out[dstStart + x] = (data[srcStart + 1 + x] + up) & 0xff;
        }
      } else if (filterType === 3) {
        // Average
        for (let x = 0; x < rowBytes; x++) {
          const left = x >= colors ? out[dstStart + x - colors] : 0;
          const up = y > 0 ? out[prevRowStart + x] : 0;
          out[dstStart + x] = (data[srcStart + 1 + x] + ((left + up) >> 1)) & 0xff;
        }
      } else if (filterType === 4) {
        // Paeth
        for (let x = 0; x < rowBytes; x++) {
          const left = x >= colors ? out[dstStart + x - colors] : 0;
          const up = y > 0 ? out[prevRowStart + x] : 0;
          const upLeft = y > 0 && x >= colors ? out[prevRowStart + x - colors] : 0;
          out[dstStart + x] = (data[srcStart + 1 + x] + paethPredictor(left, up, upLeft)) & 0xff;
        }
      } else {
        // Unknown PNG filter byte
        return null;
      }
    }
    return out;
  }

  return null;
}
