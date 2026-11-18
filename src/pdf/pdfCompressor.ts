import type {
  PDFDict,
  PDFDocument,
  PDFName,
  PDFRawStream,
  PDFRef,
} from 'pdf-lib';
import type {
  PdfCompressOptions,
  PdfCompressPreset,
  PdfCompressProgress,
  PdfCompressResult,
  PdfImageSkipSummary,
  PdfInspectionReport,
} from '../types/scan';
import {
  encodeBlobAsJpegSafe,
  encodeBlobAsMono1Bit,
  rgbaToScaledJpegBytes,
  rgbaToScaledMono1Bit,
} from '../imaging/ingest';
import { unapplyPdfPredictor } from './pdfPredictor';
import {
  levelToEncodingParams,
  selectRepresentativeIndices,
  solveCompressionLevel,
} from './sizeSolver';
import { sanitizeFilename } from './exporter';

export const PDF_COMPRESS_PRESETS: Record<
  PdfCompressPreset,
  { maxDim: number; jpegQuality: number; monoMaxDim: number; label: string; shortDpi: string }
> = {
  ultra: {
    maxDim: 1100,
    jpegQuality: 0.54,
    monoMaxDim: 1350,
    label: 'Ultra (~110 DPI)',
    shortDpi: '~110 DPI',
  },
  small: {
    maxDim: 1450,
    jpegQuality: 0.68,
    monoMaxDim: 1650,
    label: 'Compact (~150 DPI)',
    shortDpi: '~150 DPI',
  },
  balanced: {
    maxDim: 1900,
    jpegQuality: 0.80,
    monoMaxDim: 2000,
    label: 'Balanced (~200 DPI)',
    shortDpi: '~200 DPI',
  },
};

export interface ReencodedImagePayload {
  kind: 'jpeg' | 'mono-flate';
  bytes: Uint8Array;
  width: number;
  height: number;
}

/**
 * Pluggable image encoder interface so browser uses Canvas/ImageBitmap while
 * Node unit tests can supply deterministic pure-JS encoders without DOM mocks.
 */
export interface PdfImageReencoder {
  reencodeJpeg: (
    rawJpeg: Uint8Array,
    srcWidth: number,
    srcHeight: number,
    maxDim: number,
    jpegQuality: number,
    forceMono1Bit: boolean
  ) => Promise<ReencodedImagePayload>;
  reencodeRgba: (
    rgba: Uint8ClampedArray,
    srcWidth: number,
    srcHeight: number,
    maxDim: number,
    jpegQuality: number,
    forceMono1Bit: boolean
  ) => Promise<ReencodedImagePayload>;
}

const defaultBrowserReencoder: PdfImageReencoder = {
  async reencodeJpeg(rawJpeg, srcWidth, srcHeight, maxDim, jpegQuality, forceMono1Bit) {
    const safeBuf = rawJpeg.buffer.slice(
      rawJpeg.byteOffset,
      rawJpeg.byteOffset + rawJpeg.byteLength
    ) as ArrayBuffer;
    const blob = new Blob([safeBuf], { type: 'image/jpeg' });

    if (forceMono1Bit) {
      const mono = await encodeBlobAsMono1Bit(blob, maxDim, {
        isAlreadyBw: false,
        needsShadowRemoval: true,
      });
      return {
        kind: 'mono-flate',
        bytes: mono.packedBits,
        width: mono.width,
        height: mono.height,
      };
    }

    const encoded = await encodeBlobAsJpegSafe(
      blob,
      srcWidth,
      srcHeight,
      maxDim,
      jpegQuality,
      0.99 // Always allow trying lower quality against unknown input JPEG quality
    );
    return {
      kind: 'jpeg',
      bytes: encoded.bytes,
      width: encoded.width,
      height: encoded.height,
    };
  },

  async reencodeRgba(rgba, srcWidth, srcHeight, maxDim, jpegQuality, forceMono1Bit) {
    if (forceMono1Bit) {
      const mono = rgbaToScaledMono1Bit(rgba, srcWidth, srcHeight, maxDim);
      return {
        kind: 'mono-flate',
        bytes: mono.packedBits,
        width: mono.width,
        height: mono.height,
      };
    }

    const encoded = await rgbaToScaledJpegBytes(rgba, srcWidth, srcHeight, maxDim, jpegQuality);
    return {
      kind: 'jpeg',
      bytes: encoded.bytes,
      width: encoded.width,
      height: encoded.height,
    };
  },
};

export function buildCompressedFilename(originalName: string): string {
  const clean = sanitizeFilename(originalName);
  const stem = clean.replace(/\.pdf$/i, '');
  if (stem.toLowerCase().endsWith('_compressed')) {
    return `${stem}.pdf`;
  }
  return `${stem}_compressed.pdf`;
}

interface CompressibleImageInfo {
  refKey: string;
  codec: 'jpeg' | 'flate' | 'raw';
  width: number;
  height: number;
  channels: 1 | 3;
  bitsPerComponent: number;
  rawBytesLength: number;
  predictor: number;
  predictorColumns: number;
  predictorColors: number;
}

type PdfLibModule = typeof import('pdf-lib');

function resolveSingleFilter(
  dict: PDFDict,
  pdfLib: PdfLibModule
): 'DCTDecode' | 'FlateDecode' | 'None' | 'Unsupported' {
  const { PDFArray, PDFName } = pdfLib;
  const filter = dict.lookup(PDFName.of('Filter'));
  if (!filter) return 'None';

  let nameObj: PDFName | null = null;
  if (filter instanceof PDFName) {
    nameObj = filter;
  } else if (filter instanceof PDFArray && filter.size() === 1) {
    const first = filter.lookup(0);
    if (first instanceof PDFName) nameObj = first;
  }

  if (!nameObj) return 'Unsupported';
  if (nameObj === PDFName.of('DCTDecode')) return 'DCTDecode';
  if (nameObj === PDFName.of('FlateDecode')) return 'FlateDecode';
  return 'Unsupported';
}

function resolveColorChannels(
  dict: PDFDict,
  pdfLib: PdfLibModule
): 1 | 3 | null {
  const { PDFArray, PDFName, PDFNumber, PDFStream } = pdfLib;
  const cs = dict.lookup(PDFName.of('ColorSpace'));
  if (!cs) return null;

  if (cs === PDFName.of('DeviceRGB')) return 3;
  if (cs === PDFName.of('DeviceGray')) return 1;

  if (cs instanceof PDFArray && cs.size() >= 2) {
    const csType = cs.lookup(0);
    if (csType === PDFName.of('ICCBased')) {
      const profile = cs.lookup(1);
      if (profile instanceof PDFStream) {
        const n = profile.dict.lookup(PDFName.of('N'));
        if (n instanceof PDFNumber) {
          const val = n.asNumber();
          if (val === 3) return 3;
          if (val === 1) return 1;
        }
      }
    }
  }

  return null;
}

function hasDefaultDecode(
  dict: PDFDict,
  channels: 1 | 3,
  pdfLib: PdfLibModule
): boolean {
  const { PDFArray, PDFName, PDFNumber } = pdfLib;
  const decode = dict.lookup(PDFName.of('Decode'));
  if (!decode) return true;
  if (!(decode instanceof PDFArray) || decode.size() !== channels * 2) return false;

  for (let i = 0; i < channels; i++) {
    const lo = decode.lookup(i * 2);
    const hi = decode.lookup(i * 2 + 1);
    if (!(lo instanceof PDFNumber) || !(hi instanceof PDFNumber)) return false;
    if (lo.asNumber() !== 0 || hi.asNumber() !== 1) return false;
  }
  return true;
}

function extractPredictorParams(
  dict: PDFDict,
  width: number,
  channels: 1 | 3,
  pdfLib: PdfLibModule
): { predictor: number; columns: number; colors: number } {
  const { PDFArray, PDFDict, PDFName, PDFNumber } = pdfLib;
  let parmsObj = dict.lookup(PDFName.of('DecodeParms'));
  if (parmsObj instanceof PDFArray && parmsObj.size() >= 1) {
    parmsObj = parmsObj.lookup(0);
  }
  if (!(parmsObj instanceof PDFDict)) {
    return { predictor: 1, columns: width, colors: channels };
  }

  const pred = parmsObj.lookup(PDFName.of('Predictor'));
  const cols = parmsObj.lookup(PDFName.of('Columns'));
  const colors = parmsObj.lookup(PDFName.of('Colors'));

  return {
    predictor: pred instanceof PDFNumber ? pred.asNumber() : 1,
    columns: cols instanceof PDFNumber ? cols.asNumber() : width,
    colors: colors instanceof PDFNumber ? colors.asNumber() : channels,
  };
}

function scanPdfImages(
  pdfDoc: PDFDocument,
  pdfLib: PdfLibModule,
  minRawBytes = 4096,
  minDimPx = 64
): {
  totalImages: number;
  candidates: CompressibleImageInfo[];
  skipReasons: PdfImageSkipSummary;
} {
  const { PDFBool, PDFName, PDFNumber, PDFRawStream, PDFRef } = pdfLib;
  const entries = pdfDoc.context.enumerateIndirectObjects();

  // Pass 1: Protect every XObject referenced as an /SMask or /Mask
  const protectedMaskRefs = new Set<string>();
  for (const [, obj] of entries) {
    if (!(obj instanceof PDFRawStream)) continue;
    if (obj.dict.lookup(PDFName.of('Subtype')) !== PDFName.of('Image')) continue;

    const smaskRef = obj.dict.get(PDFName.of('SMask'));
    if (smaskRef instanceof PDFRef) protectedMaskRefs.add(smaskRef.toString());
    const maskRef = obj.dict.get(PDFName.of('Mask'));
    if (maskRef instanceof PDFRef) protectedMaskRefs.add(maskRef.toString());
  }

  // Pass 2: Classify every Image XObject
  let totalImages = 0;
  const candidates: CompressibleImageInfo[] = [];
  const skipReasons: PdfImageSkipSummary = {
    transparency: 0,
    alreadyCompactOrSmall: 0,
    unsupportedCodec: 0,
  };

  for (const [ref, obj] of entries) {
    if (!(obj instanceof PDFRawStream)) continue;
    if (obj.dict.lookup(PDFName.of('Subtype')) !== PDFName.of('Image')) continue;

    totalImages++;
    const refKey = ref.toString();
    const dict = obj.dict;

    const isImageMask = dict.lookup(PDFName.of('ImageMask')) === PDFBool.True;
    const hasAlphaMask = dict.has(PDFName.of('SMask')) || dict.has(PDFName.of('Mask'));
    if (protectedMaskRefs.has(refKey) || isImageMask || hasAlphaMask) {
      skipReasons.transparency++;
      continue;
    }

    const wObj = dict.lookup(PDFName.of('Width'));
    const hObj = dict.lookup(PDFName.of('Height'));
    const width = wObj instanceof PDFNumber ? wObj.asNumber() : 0;
    const height = hObj instanceof PDFNumber ? hObj.asNumber() : 0;
    const rawBytesLength = obj.contents.byteLength;

    const bpcObj = dict.lookup(PDFName.of('BitsPerComponent'));
    const bpc = bpcObj instanceof PDFNumber ? bpcObj.asNumber() : 8;

    const filter = resolveSingleFilter(dict, pdfLib);
    if (bpc === 1 || width < minDimPx || height < minDimPx || rawBytesLength < minRawBytes) {
      skipReasons.alreadyCompactOrSmall++;
      continue;
    }

    if (filter === 'Unsupported') {
      skipReasons.unsupportedCodec++;
      continue;
    }

    const channels = resolveColorChannels(dict, pdfLib);
    if (!channels || !hasDefaultDecode(dict, channels, pdfLib)) {
      skipReasons.unsupportedCodec++;
      continue;
    }

    if (filter === 'DCTDecode') {
      candidates.push({
        refKey,
        codec: 'jpeg',
        width,
        height,
        channels,
        bitsPerComponent: bpc,
        rawBytesLength,
        predictor: 1,
        predictorColumns: width,
        predictorColors: channels,
      });
      continue;
    }

    // FlateDecode or unfiltered raw: require 8-bit depth and supported predictor
    if (bpc !== 8) {
      skipReasons.unsupportedCodec++;
      continue;
    }

    const pred = extractPredictorParams(dict, width, channels, pdfLib);
    const predictorSupported =
      pred.predictor === 1 ||
      pred.predictor === 2 ||
      (pred.predictor >= 10 && pred.predictor <= 15);
    if (!predictorSupported || pred.columns !== width || pred.colors !== channels) {
      skipReasons.unsupportedCodec++;
      continue;
    }

    candidates.push({
      refKey,
      codec: filter === 'FlateDecode' ? 'flate' : 'raw',
      width,
      height,
      channels,
      bitsPerComponent: bpc,
      rawBytesLength,
      predictor: pred.predictor,
      predictorColumns: pred.columns,
      predictorColors: pred.colors,
    });
  }

  return { totalImages, candidates, skipReasons };
}

function interleavedToRgba(
  raw: Uint8Array,
  width: number,
  height: number,
  channels: 1 | 3
): Uint8ClampedArray | null {
  const pixelCount = width * height;
  if (raw.byteLength < pixelCount * channels) return null;

  const rgba = new Uint8ClampedArray(pixelCount * 4);
  if (channels === 3) {
    for (let i = 0, s = 0, d = 0; i < pixelCount; i++, s += 3, d += 4) {
      rgba[d] = raw[s];
      rgba[d + 1] = raw[s + 1];
      rgba[d + 2] = raw[s + 2];
      rgba[d + 3] = 255;
    }
  } else {
    for (let i = 0, d = 0; i < pixelCount; i++, d += 4) {
      const v = raw[i];
      rgba[d] = v;
      rgba[d + 1] = v;
      rgba[d + 2] = v;
      rgba[d + 3] = 255;
    }
  }
  return rgba;
}

async function loadPdfStrict(bytes: Uint8Array, pdfLib: PdfLibModule) {
  try {
    return await pdfLib.PDFDocument.load(bytes, {
      ignoreEncryption: false,
      updateMetadata: false,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : '';
    if (/encrypt/i.test(msg)) {
      throw new Error(
        'This PDF is password-protected or encrypted. Unlock it first before compressing on-device.'
      );
    }
    throw new Error('Could not read PDF file — make sure it is a valid, uncorrupted .pdf document.');
  }
}

/**
 * Inspects an existing PDF completely on-device to report page count, byte size,
 * and how much of the file consists of safely compressible embedded images.
 */
export async function inspectPdfBytes(
  bytes: Uint8Array,
  filename = 'document.pdf',
  thresholds?: { minRawBytes?: number; minDimPx?: number }
): Promise<PdfInspectionReport> {
  const pdfLib = await import('pdf-lib');
  const pdfDoc = await loadPdfStrict(bytes, pdfLib);

  const { totalImages, candidates, skipReasons } = scanPdfImages(
    pdfDoc,
    pdfLib,
    thresholds?.minRawBytes,
    thresholds?.minDimPx
  );

  const compressibleBytes = candidates.reduce((acc, c) => acc + c.rawBytesLength, 0);
  const skippedImages = totalImages - candidates.length;
  const imageSharePercent =
    bytes.byteLength > 0
      ? Math.min(100, Math.round((compressibleBytes / bytes.byteLength) * 100))
      : 0;

  return {
    filename,
    pageCount: pdfDoc.getPageCount(),
    totalBytes: bytes.byteLength,
    totalImages,
    compressibleImages: candidates.length,
    compressibleBytes,
    skippedImages,
    skipReasons,
    imageSharePercent,
  };
}

function decodeCandidateStream(
  stream: PDFRawStream,
  info: CompressibleImageInfo,
  pdfLib: PdfLibModule
): { kind: 'jpeg'; rawJpeg: Uint8Array } | { kind: 'rgba'; rgba: Uint8ClampedArray } | null {
  if (info.codec === 'jpeg') {
    return { kind: 'jpeg', rawJpeg: stream.contents };
  }

  let inflated: Uint8Array;
  if (info.codec === 'flate') {
    try {
      inflated = pdfLib.decodePDFRawStream(stream).decode();
    } catch {
      return null;
    }
  } else {
    inflated = stream.contents;
  }

  const rawPixels = unapplyPdfPredictor(inflated, {
    predictor: info.predictor,
    columns: info.predictorColumns,
    rows: info.height,
    colors: info.predictorColors,
    bitsPerComponent: info.bitsPerComponent,
  });
  if (!rawPixels) return null;

  const rgba = interleavedToRgba(rawPixels, info.width, info.height, info.channels);
  if (!rgba) return null;
  return { kind: 'rgba', rgba };
}

function buildReplacementStream(
  pdfDoc: PDFDocument,
  payload: ReencodedImagePayload
) {
  if (payload.kind === 'mono-flate') {
    return pdfDoc.context.flateStream(payload.bytes, {
      Type: 'XObject',
      Subtype: 'Image',
      Width: payload.width,
      Height: payload.height,
      ColorSpace: 'DeviceGray',
      BitsPerComponent: 1,
    });
  }

  return pdfDoc.context.stream(payload.bytes, {
    Type: 'XObject',
    Subtype: 'Image',
    Width: payload.width,
    Height: payload.height,
    ColorSpace: 'DeviceRGB',
    BitsPerComponent: 8,
    Filter: 'DCTDecode',
  });
}

function stripPdfMetadata(pdfDoc: PDFDocument, pdfLib: PdfLibModule) {
  pdfDoc.setTitle('');
  pdfDoc.setAuthor('');
  pdfDoc.setSubject('');
  pdfDoc.setKeywords([]);
  pdfDoc.setCreator('');
  pdfDoc.setProducer('');
  pdfDoc.catalog.delete(pdfLib.PDFName.of('Metadata'));
}

/**
 * Compresses an existing PDF 100% client-side by recompressing eligible embedded
 * Image XObjects in place while preserving selectable text, fonts, links, and vectors.
 */
export async function compressExistingPdf(
  bytes: Uint8Array,
  originalFilename: string,
  options: PdfCompressOptions,
  onProgress?: (progress: PdfCompressProgress) => void,
  internals?: {
    reencoder?: PdfImageReencoder;
    minRawBytes?: number;
    minDimPx?: number;
  }
): Promise<PdfCompressResult> {
  const pdfLib = await import('pdf-lib');
  const reencoder = internals?.reencoder ?? defaultBrowserReencoder;
  const minRawBytes = internals?.minRawBytes ?? 4096;
  const minDimPx = internals?.minDimPx ?? 64;

  const outFilename = buildCompressedFilename(originalFilename);

  // Inspect initial structure cleanly once
  const probeDoc = await loadPdfStrict(bytes, pdfLib);
  const pageCount = probeDoc.getPageCount();
  const { totalImages, candidates } = scanPdfImages(probeDoc, pdfLib, minRawBytes, minDimPx);
  const skippedImages = totalImages - candidates.length;

  // Map refKey -> stream on probeDoc for fast sampling in target-size mode
  const probeStreamMap = new Map<string, PDFRawStream>();
  for (const [ref, obj] of probeDoc.context.enumerateIndirectObjects()) {
    if (obj instanceof pdfLib.PDFRawStream) {
      probeStreamMap.set(ref.toString(), obj);
    }
  }

  const runFullPass = async (
    maxDim: number,
    jpegQuality: number,
    forceMono1Bit: boolean,
    stageLabel: string
  ): Promise<{ pdfBytes: Uint8Array; recompressedCount: number }> => {
    const workDoc = await loadPdfStrict(bytes, pdfLib);
    const refMap = new Map<string, { ref: PDFRef; stream: PDFRawStream }>();
    for (const [ref, obj] of workDoc.context.enumerateIndirectObjects()) {
      if (obj instanceof pdfLib.PDFRawStream) {
        refMap.set(ref.toString(), { ref, stream: obj });
      }
    }

    let recompressedCount = 0;

    for (let i = 0; i < candidates.length; i++) {
      const info = candidates[i];
      onProgress?.({
        current: i + 1,
        total: Math.max(1, candidates.length),
        stage: stageLabel,
      });

      const entry = refMap.get(info.refKey);
      if (!entry) continue;

      const decoded = decodeCandidateStream(entry.stream, info, pdfLib);
      if (!decoded) continue;

      let payload: ReencodedImagePayload;
      try {
        payload =
          decoded.kind === 'jpeg'
            ? await reencoder.reencodeJpeg(
                decoded.rawJpeg,
                info.width,
                info.height,
                maxDim,
                jpegQuality,
                forceMono1Bit
              )
            : await reencoder.reencodeRgba(
                decoded.rgba,
                info.width,
                info.height,
                maxDim,
                jpegQuality,
                forceMono1Bit
              );
      } catch {
        // Safely skip any individual image the browser decoder refuses
        continue;
      }

      const candidateStream = buildReplacementStream(workDoc, payload);
      // Never-bloat per-image guard: only swap if strictly smaller
      if (candidateStream.contents.byteLength < info.rawBytesLength) {
        workDoc.context.assign(entry.ref, candidateStream);
        recompressedCount++;
      }
    }

    if (options.stripMetadata) {
      stripPdfMetadata(workDoc, pdfLib);
    }

    onProgress?.({
      current: Math.max(1, candidates.length),
      total: Math.max(1, candidates.length),
      stage: 'Packing PDF streams',
    });

    const pdfBytes = await workDoc.save({ useObjectStreams: true, addDefaultPage: false });
    return { pdfBytes, recompressedCount };
  };

  let finalPdfBytes: Uint8Array;
  let recompressedImages = 0;
  let targetMet: boolean | undefined;
  let appliedProfileLabel: string;

  // No compressible images: still run structural object-stream + optional metadata pass
  if (candidates.length === 0) {
    const pass = await runFullPass(1900, 0.8, false, 'Optimizing PDF structure');
    finalPdfBytes = pass.pdfBytes;
    recompressedImages = 0;
    appliedProfileLabel = options.stripMetadata
      ? 'Object streams + metadata strip'
      : 'Object streams only (no replaceable images)';
    if (options.compressionMode === 'target-size' && options.targetMaxBytes) {
      targetMet = Math.min(finalPdfBytes.byteLength, bytes.byteLength) <= options.targetMaxBytes;
    }
  } else if (options.compressionMode !== 'target-size') {
    // ── Preset Mode ──
    const presetCfg = PDF_COMPRESS_PRESETS[options.preset];
    const effectiveMaxDim = options.forceMono1Bit ? presetCfg.monoMaxDim : presetCfg.maxDim;
    const pass = await runFullPass(
      effectiveMaxDim,
      presetCfg.jpegQuality,
      options.forceMono1Bit,
      options.forceMono1Bit ? 'Packing 1-bit B&W images' : 'Recompressing images'
    );
    finalPdfBytes = pass.pdfBytes;
    recompressedImages = pass.recompressedCount;
    appliedProfileLabel = options.forceMono1Bit
      ? `1-Bit B&W · ${effectiveMaxDim}px`
      : `${presetCfg.label} · ${presetCfg.maxDim}px · Q${Math.round(presetCfg.jpegQuality * 100)}`;
  } else {
    // ── Target File Size Mode ──
    const targetMaxBytes = Math.max(32 * 1024, Math.round(options.targetMaxBytes ?? 500 * 1024));
    const totalImageBytes = candidates.reduce((s, c) => s + c.rawBytesLength, 0);
    const fixedFloorBytes = Math.max(0, bytes.byteLength - totalImageBytes);
    const imageBudgetBytes = Math.max(16 * 1024, targetMaxBytes - fixedFloorBytes - 3072);

    if (options.forceMono1Bit) {
      const monoLadder = [1800, 1450, 1150, 900, 720];
      let chosenDim = monoLadder[monoLadder.length - 1];
      let bestPass = { pdfBytes: bytes, recompressedCount: 0 };

      for (const dim of monoLadder) {
        bestPass = await runFullPass(dim, 0.75, true, `Fitting 1-bit B&W (${dim}px)`);
        chosenDim = dim;
        if (bestPass.pdfBytes.byteLength <= targetMaxBytes) break;
      }

      finalPdfBytes = bestPass.pdfBytes;
      recompressedImages = bestPass.recompressedCount;
      targetMet = Math.min(finalPdfBytes.byteLength, bytes.byteLength) <= targetMaxBytes;
      appliedProfileLabel = `1-Bit B&W · ${chosenDim}px`;
    } else {
      const weights = candidates.map((c) => c.rawBytesLength);
      const sample = selectRepresentativeIndices(weights, 3);
      const ratioGuess = totalImageBytes > 0 ? imageBudgetBytes / totalImageBytes : 0.6;
      const initialLevel =
        ratioGuess >= 1 ? 85 : ratioGuess >= 0.55 ? 65 : ratioGuess >= 0.3 ? 40 : 20;

      let probeCount = 0;
      const solved = await solveCompressionLevel({
        targetBytes: imageBudgetBytes,
        initialLevel,
        maxIterations: 5,
        measureBytesAtLevel: async (level) => {
          probeCount++;
          const params = levelToEncodingParams(level);
          let sampleBytes = 0;

          for (let s = 0; s < sample.indices.length; s++) {
            const info = candidates[sample.indices[s]];
            onProgress?.({
              current: Math.min(candidates.length, s + 1),
              total: candidates.length,
              stage: `Estimating target size (Pass ${probeCount})`,
            });
            const stream = probeStreamMap.get(info.refKey);
            if (!stream) {
              sampleBytes += info.rawBytesLength;
              continue;
            }
            const decoded = decodeCandidateStream(stream, info, pdfLib);
            if (!decoded) {
              sampleBytes += info.rawBytesLength;
              continue;
            }
            try {
              const payload =
                decoded.kind === 'jpeg'
                  ? await reencoder.reencodeJpeg(
                      decoded.rawJpeg,
                      info.width,
                      info.height,
                      params.maxDim,
                      params.jpegQuality,
                      false
                    )
                  : await reencoder.reencodeRgba(
                      decoded.rgba,
                      info.width,
                      info.height,
                      params.maxDim,
                      params.jpegQuality,
                      false
                    );
              sampleBytes += Math.min(payload.bytes.byteLength, info.rawBytesLength);
            } catch {
              sampleBytes += info.rawBytesLength;
            }
          }
          return Math.round(sampleBytes * sample.scaleFactor);
        },
      });

      let activeLevel = solved.level;
      let activeParams = levelToEncodingParams(activeLevel);
      let pass = await runFullPass(
        activeParams.maxDim,
        activeParams.jpegQuality,
        false,
        'Compressing images'
      );

      for (let retry = 0; retry < 2 && pass.pdfBytes.byteLength > targetMaxBytes && activeLevel > 0; retry++) {
        const overshoot = (pass.pdfBytes.byteLength - targetMaxBytes) / targetMaxBytes;
        const drop = Math.max(8, Math.round(overshoot * 55));
        activeLevel = retry === 1 ? 0 : Math.max(0, activeLevel - drop);
        activeParams = levelToEncodingParams(activeLevel);
        pass = await runFullPass(
          activeParams.maxDim,
          activeParams.jpegQuality,
          false,
          'Tightening to fit target'
        );
      }

      finalPdfBytes = pass.pdfBytes;
      recompressedImages = pass.recompressedCount;
      targetMet = Math.min(finalPdfBytes.byteLength, bytes.byteLength) <= targetMaxBytes;
      appliedProfileLabel = `${activeParams.maxDim}px · Q${Math.round(activeParams.jpegQuality * 100)}`;
    }
  }

  // Global never-bloat guard: never return a file larger than the original
  const alreadyOptimal = finalPdfBytes.byteLength >= bytes.byteLength;
  const outputBytes = alreadyOptimal ? bytes : finalPdfBytes;
  const outBuf = outputBytes.buffer.slice(
    outputBytes.byteOffset,
    outputBytes.byteOffset + outputBytes.byteLength
  ) as ArrayBuffer;
  const blob = new Blob([outBuf], { type: 'application/pdf' });

  return {
    blob,
    filename: outFilename,
    originalBytes: bytes.byteLength,
    compressedBytes: blob.size,
    pageCount,
    recompressedImages: alreadyOptimal ? 0 : recompressedImages,
    skippedImages,
    alreadyOptimal,
    targetMet,
    appliedProfileLabel: alreadyOptimal ? 'Original kept (already optimal)' : appliedProfileLabel,
  };
}
