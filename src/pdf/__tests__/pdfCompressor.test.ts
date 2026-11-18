import { describe, expect, it } from 'vitest';
import {
  decodePDFRawStream,
  PDFDocument,
  PDFName,
  PDFNumber,
  PDFRawStream,
  StandardFonts,
} from 'pdf-lib';
import {
  buildCompressedFilename,
  compressExistingPdf,
  inspectPdfBytes,
  type PdfImageReencoder,
} from '../pdfCompressor';
import { packRgbaTo1Bit } from '../../imaging/monochrome';

// Minimal valid 16x24 JPEG fixture (used as compact re-encoded output in Node tests)
const TINY_JPG_BYTES = new Uint8Array(
  Buffer.from(
    '/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAMCAgMCAgMDAwMEAwMEBQgFBQQEBQoHBwYIDAoMDAsKCwsNDhIQDQ4RDgsLEBYQERMUFRUVDA8XGBYUGBIUFRT/2wBDAQMEBAUEBQkFBQkUDQsNFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBT/wAARCAAYABADASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwD8qqKKKACiiigD/9k=',
    'base64'
  )
);

/**
 * Deterministic Node-safe reencoder:
 * - For 1-bit mode: runs the real packRgbaTo1Bit encoder.
 * - For JPEG mode: returns a compact JPEG fixture (size scales softly with jpegQuality for solver tests).
 */
function createDeterministicReencoder(onRgbaSeen?: (rgba: Uint8ClampedArray) => void): PdfImageReencoder {
  return {
    async reencodeJpeg(_rawJpeg, srcW, srcH, maxDim, jpegQuality, forceMono1Bit) {
      if (forceMono1Bit) {
        const w = Math.min(srcW, maxDim);
        const h = Math.min(srcH, maxDim);
        const rgba = new Uint8ClampedArray(w * h * 4).fill(255);
        const mono = packRgbaTo1Bit(rgba, w, h, 165);
        return { kind: 'mono-flate', bytes: mono.packedBits, width: mono.width, height: mono.height };
      }
      // Pad benign trailing comment bytes proportional to quality so target-size solver sees monotonic size
      const extraPad = Math.round(jpegQuality * 2000);
      const out = new Uint8Array(TINY_JPG_BYTES.length + extraPad);
      out.set(TINY_JPG_BYTES, 0);
      return { kind: 'jpeg', bytes: out, width: 16, height: 24 };
    },
    async reencodeRgba(rgba, srcW, srcH, maxDim, jpegQuality, forceMono1Bit) {
      onRgbaSeen?.(rgba);
      if (forceMono1Bit) {
        const mono = packRgbaTo1Bit(rgba, srcW, srcH, 165);
        return { kind: 'mono-flate', bytes: mono.packedBits, width: mono.width, height: mono.height };
      }
      const extraPad = Math.round(jpegQuality * 2000);
      const out = new Uint8Array(TINY_JPG_BYTES.length + extraPad);
      out.set(TINY_JPG_BYTES, 0);
      return {
        kind: 'jpeg',
        bytes: out,
        width: Math.min(srcW, maxDim),
        height: Math.min(srcH, maxDim),
      };
    },
  };
}

/**
 * Builds a realistic test PDF with selectable text AND a large noisy Flate RGB image
 * (high entropy so Flate stream is genuinely big, e.g. > 35 KB).
 */
async function buildPdfWithNoisyFlateImageAndText(opts?: {
  withPngUpPredictor?: boolean;
  withSmask?: boolean;
}): Promise<{ bytes: Uint8Array; expectedFirstPixel: [number, number, number] }> {
  const pdfDoc = await PDFDocument.create();
  pdfDoc.setTitle('Original Secret Title');
  pdfDoc.setAuthor('Latif Test');

  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const page = pdfDoc.addPage([595, 842]);
  page.drawText('SELECTABLE_TEXT_MARKER_UNIMED_2026', { x: 40, y: 780, size: 14, font });

  const w = 128;
  const h = 128;
  const rawRgb = new Uint8Array(w * h * 3);
  // Deterministic pseudo-random pattern so Flate doesn't collapse it to 200 bytes
  let seed = 1337;
  for (let i = 0; i < rawRgb.length; i++) {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    rawRgb[i] = (seed >>> 16) & 0xff;
  }
  const expectedFirstPixel: [number, number, number] = [rawRgb[0], rawRgb[1], rawRgb[2]];

  let streamBytes: Uint8Array = rawRgb;
  let decodeParms: Record<string, number> | undefined;

  if (opts?.withPngUpPredictor) {
    // Encode with PNG Filter Type 2 (Up)
    const rowBytes = w * 3;
    const filtered = new Uint8Array(h * (rowBytes + 1));
    for (let y = 0; y < h; y++) {
      filtered[y * (rowBytes + 1)] = 2; // Up filter
      for (let x = 0; x < rowBytes; x++) {
        const cur = rawRgb[y * rowBytes + x];
        const up = y > 0 ? rawRgb[(y - 1) * rowBytes + x] : 0;
        filtered[y * (rowBytes + 1) + 1 + x] = (cur - up) & 0xff;
      }
    }
    streamBytes = filtered;
    decodeParms = { Predictor: 12, Colors: 3, BitsPerComponent: 8, Columns: w };
  }

  let smaskRef;
  if (opts?.withSmask) {
    const alpha = new Uint8Array(w * h).fill(200);
    const smaskStream = pdfDoc.context.flateStream(alpha, {
      Type: 'XObject',
      Subtype: 'Image',
      Width: w,
      Height: h,
      ColorSpace: 'DeviceGray',
      BitsPerComponent: 8,
    });
    smaskRef = pdfDoc.context.register(smaskStream);
  }

  const imgStream = pdfDoc.context.flateStream(streamBytes, {
    Type: 'XObject',
    Subtype: 'Image',
    Width: w,
    Height: h,
    ColorSpace: 'DeviceRGB',
    BitsPerComponent: 8,
    ...(decodeParms ? { DecodeParms: decodeParms } : {}),
    ...(smaskRef ? { SMask: smaskRef } : {}),
  });
  const imgRef = pdfDoc.context.register(imgStream);
  page.node.newXObject('Im0', imgRef);

  const bytes = await pdfDoc.save({ useObjectStreams: false });
  return { bytes, expectedFirstPixel };
}

describe('Phase B: Client-Side Existing PDF Compressor', () => {
  it('builds clean _compressed.pdf output filenames', () => {
    expect(buildCompressedFilename('Laporan Akhir.pdf')).toBe('Laporan_Akhir_compressed.pdf');
    expect(buildCompressedFilename('doc_compressed.pdf')).toBe('doc_compressed.pdf');
  });

  it('inspects and compresses embedded Flate RGB images while preserving selectable text', async () => {
    const { bytes } = await buildPdfWithNoisyFlateImageAndText();
    const report = await inspectPdfBytes(bytes, 'sample.pdf');

    expect(report.pageCount).toBe(1);
    expect(report.totalImages).toBe(1);
    expect(report.compressibleImages).toBe(1);
    expect(report.imageSharePercent).toBeGreaterThan(70);

    const compressed = await compressExistingPdf(
      bytes,
      'sample.pdf',
      {
        compressionMode: 'preset',
        preset: 'small',
        forceMono1Bit: false,
        stripMetadata: true,
      },
      undefined,
      { reencoder: createDeterministicReencoder() }
    );

    expect(compressed.alreadyOptimal).toBe(false);
    expect(compressed.recompressedImages).toBe(1);
    expect(compressed.compressedBytes).toBeLessThan(compressed.originalBytes * 0.25);

    // Reload compressed PDF and verify text content stream & metadata strip
    const outBytes = new Uint8Array(await compressed.blob.arrayBuffer());
    const reloaded = await PDFDocument.load(outBytes);
    expect(reloaded.getPageCount()).toBe(1);
    expect(reloaded.getTitle()).toBe('');
    expect(reloaded.getAuthor()).toBe('');

    // Verify selectable text marker survived verbatim inside page content stream
    // (pdf-lib encodes StandardFont text as uppercase hex strings: <53454C...> Tj)
    const markerAscii = 'SELECTABLE_TEXT_MARKER_UNIMED_2026';
    const markerHex = Buffer.from(markerAscii, 'ascii').toString('hex').toUpperCase();
    let foundTextMarker = false;
    for (const [, obj] of reloaded.context.enumerateIndirectObjects()) {
      if (!(obj instanceof PDFRawStream)) continue;
      const subtype = obj.dict.lookup(PDFName.of('Subtype'));
      if (subtype === PDFName.of('Image')) continue;
      try {
        const text = Buffer.from(decodePDFRawStream(obj).decode()).toString('latin1');
        if (text.includes(markerAscii) || text.toUpperCase().includes(markerHex)) {
          foundTextMarker = true;
          break;
        }
      } catch {
        // Not a text/flate stream
      }
    }
    expect(foundTextMarker).toBe(true);
  });

  it('supports target-size mode on existing PDFs and reports targetMet accurately', async () => {
    const { bytes } = await buildPdfWithNoisyFlateImageAndText();

    const hitTarget = await compressExistingPdf(
      bytes,
      'target.pdf',
      {
        compressionMode: 'target-size',
        preset: 'balanced',
        targetMaxBytes: 35 * 1024,
        forceMono1Bit: false,
        stripMetadata: false,
      },
      undefined,
      { reencoder: createDeterministicReencoder() }
    );
    expect(hitTarget.targetMet).toBe(true);
    expect(hitTarget.compressedBytes).toBeLessThanOrEqual(35 * 1024);
  });

  it('decodes PNG-predicted Flate image XObjects pixel-accurately before recompression', async () => {
    const { bytes, expectedFirstPixel } = await buildPdfWithNoisyFlateImageAndText({
      withPngUpPredictor: true,
    });

    let seenFirstPixel: [number, number, number] | null = null;
    const compressed = await compressExistingPdf(
      bytes,
      'predicted.pdf',
      {
        compressionMode: 'preset',
        preset: 'balanced',
        forceMono1Bit: false,
        stripMetadata: false,
      },
      undefined,
      {
        reencoder: createDeterministicReencoder((rgba) => {
          seenFirstPixel = [rgba[0], rgba[1], rgba[2]];
        }),
      }
    );

    expect(compressed.recompressedImages).toBe(1);
    expect(seenFirstPixel).toEqual(expectedFirstPixel);
  });

  it('protects images with /SMask transparency from corruption', async () => {
    const { bytes } = await buildPdfWithNoisyFlateImageAndText({ withSmask: true });
    const report = await inspectPdfBytes(bytes, 'transparent.pdf');

    expect(report.totalImages).toBe(2); // parent image + smask image
    expect(report.compressibleImages).toBe(0);
    expect(report.skipReasons.transparency).toBe(2);
  });

  it('supports converting embedded PDF images to 1-bit monochrome Flate streams', async () => {
    const { bytes } = await buildPdfWithNoisyFlateImageAndText();
    const compressed = await compressExistingPdf(
      bytes,
      'bw_target.pdf',
      {
        compressionMode: 'preset',
        preset: 'small',
        forceMono1Bit: true,
        stripMetadata: false,
      },
      undefined,
      { reencoder: createDeterministicReencoder() }
    );

    expect(compressed.recompressedImages).toBe(1);
    expect(compressed.compressedBytes).toBeLessThan(compressed.originalBytes * 0.25);

    const reloaded = await PDFDocument.load(new Uint8Array(await compressed.blob.arrayBuffer()));
    let found1Bit = false;
    for (const [, obj] of reloaded.context.enumerateIndirectObjects()) {
      if (!(obj instanceof PDFRawStream)) continue;
      if (obj.dict.lookup(PDFName.of('Subtype')) !== PDFName.of('Image')) continue;
      const bpc = obj.dict.lookup(PDFName.of('BitsPerComponent'));
      if (bpc instanceof PDFNumber && bpc.asNumber() === 1) {
        found1Bit = true;
      }
    }
    expect(found1Bit).toBe(true);
  });

  it('triggers the never-bloat guard when a PDF is already minimal', async () => {
    const doc = await PDFDocument.create();
    const page = doc.addPage([595, 842]);
    page.drawText('Already tiny text-only PDF');
    const tinyBytes = await doc.save({ useObjectStreams: true });

    const res = await compressExistingPdf(
      tinyBytes,
      'tiny.pdf',
      {
        compressionMode: 'preset',
        preset: 'ultra',
        forceMono1Bit: false,
        stripMetadata: false,
      },
      undefined,
      { reencoder: createDeterministicReencoder() }
    );

    expect(res.alreadyOptimal).toBe(true);
    expect(res.compressedBytes).toBe(tinyBytes.byteLength);
  });

  it('rejects invalid PDF bytes with a friendly user-facing message', async () => {
    const garbage = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]);
    await expect(inspectPdfBytes(garbage, 'broken.pdf')).rejects.toThrow(/valid, uncorrupted/i);
  });
});
