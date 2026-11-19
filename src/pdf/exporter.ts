import type {
  ExportOptions,
  ExportProgress,
  ExportResult,
  PdfBwEncoding,
  PdfMargin,
  PdfPageSize,
  PdfQuality,
  ScanPage,
} from '../types/scan';
import { encodeBlobAsJpegSafe, encodeBlobAsMono1Bit } from '../imaging/ingest';
import {
  levelToEncodingParams,
  selectRepresentativeIndices,
  solveCompressionLevel,
} from './sizeSolver';

// Standard PDF points (72 pt = 1 inch), portrait orientation (width <= height)
export const PAGE_DIMENSIONS_PT: Record<Exclude<PdfPageSize, 'fit'>, { width: number; height: number }> = {
  a4: { width: 595.28, height: 841.89 },
  f4: { width: 609.45, height: 935.43 }, // 215 x 330 mm
  letter: { width: 612, height: 792 },
  legal: { width: 612, height: 1008 }, // 8.5 x 14 in
  'id-card': { width: 153.07, height: 242.65 }, // 54 x 85.6 mm (CR80 / KTP)
};

export const MARGIN_PT: Record<PdfMargin, number> = {
  none: 0,
  small: 18,
  standard: 36,
};

export interface QualityPresetConfig {
  maxDim: number;
  jpegQuality: number;
  monoMaxDim: number;
  label: string;
  shortDpi: string;
}

export const QUALITY_CONFIG: Record<PdfQuality, QualityPresetConfig> = {
  ultra: {
    maxDim: 1100,
    jpegQuality: 0.56,
    monoMaxDim: 1400,
    label: 'Ultra (~110 DPI)',
    shortDpi: '~110 DPI',
  },
  small: {
    maxDim: 1400,
    jpegQuality: 0.68,
    monoMaxDim: 1650,
    label: 'Compact (~150 DPI)',
    shortDpi: '~150 DPI',
  },
  balanced: {
    maxDim: 2000,
    jpegQuality: 0.80,
    monoMaxDim: 2000,
    label: 'Balanced (~200 DPI)',
    shortDpi: '~200 DPI',
  },
  high: {
    maxDim: 2200,
    jpegQuality: 0.88,
    monoMaxDim: 2200,
    label: 'High (~250 DPI)',
    shortDpi: '~250 DPI',
  },
};

export const TARGET_SIZE_PRESETS = [
  { id: '200kb', label: '200 KB', bytes: 200 * 1024 },
  { id: '500kb', label: '500 KB', bytes: 500 * 1024 },
  { id: '1mb', label: '1 MB', bytes: 1024 * 1024 },
  { id: '2mb', label: '2 MB', bytes: 2 * 1024 * 1024 },
] as const;

export function sanitizeFilename(raw: string): string {
  const cleaned = raw
    .trim()
    .replace(/[<>:"/\\|?*\u0000-\u001F]/g, '_')
    .replace(/\s+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^\.+/, '');
  const base = cleaned || 'PureScan_Document';
  return base.toLowerCase().endsWith('.pdf') ? base : `${base}.pdf`;
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

export function formatSavingsPercent(originalBytes: number, compressedBytes: number): string {
  if (originalBytes <= 0) return '0%';
  const pct = ((originalBytes - compressedBytes) / originalBytes) * 100;
  if (pct <= 0.05) return '0%';
  return `−${pct.toFixed(pct >= 10 ? 0 : 1)}%`;
}

export interface JpegPageInput {
  bytes: Uint8Array;
}

export type EncodedPdfPage =
  | { kind: 'jpeg'; bytes: Uint8Array }
  | { kind: 'mono-flate'; packedBits: Uint8Array; width: number; height: number };

function computePageLayout(
  imgW: number,
  imgH: number,
  pageSize: PdfPageSize,
  marginPt: number
): { pageW: number; pageH: number; x: number; y: number; drawW: number; drawH: number } {
  const isLandscape = imgW > imgH;
  let pageW: number;
  let pageH: number;

  if (pageSize === 'fit') {
    const targetWidth = isLandscape ? 841.89 : 595.28;
    const scaleRatio = targetWidth / imgW;
    pageW = targetWidth + marginPt * 2;
    pageH = imgH * scaleRatio + marginPt * 2;
  } else {
    const base = PAGE_DIMENSIONS_PT[pageSize];
    pageW = isLandscape ? base.height : base.width;
    pageH = isLandscape ? base.width : base.height;
  }

  const availW = Math.max(10, pageW - marginPt * 2);
  const availH = Math.max(10, pageH - marginPt * 2);
  const fitScale = Math.min(availW / imgW, availH / imgH);
  const drawW = imgW * fitScale;
  const drawH = imgH * fitScale;
  const x = (pageW - drawW) / 2;
  const y = (pageH - drawH) / 2;

  return { pageW, pageH, x, y, drawW, drawH };
}

/**
 * Pure PDF assembly supporting mixed JPEG (/DCTDecode) and 1-bit monochrome
 * (/DeviceGray, /BitsPerComponent 1, /FlateDecode) pages inside a single PDF.
 */
export async function buildPdfFromEncodedPages(
  encodedPages: EncodedPdfPage[],
  options: Pick<ExportOptions, 'pageSize' | 'margin'> & { title?: string }
): Promise<Uint8Array> {
  if (encodedPages.length === 0) {
    throw new Error('Add at least one page before exporting PDF.');
  }

  const {
    PDFDocument,
    pushGraphicsState,
    popGraphicsState,
    translate,
    scale,
    drawObject,
  } = await import('pdf-lib');

  const pdfDoc = await PDFDocument.create();
  pdfDoc.setCreator('PureScan — 100% Client-Side Document Scanner');
  pdfDoc.setProducer('PureScan (pdf-lib)');
  if (options.title) {
    pdfDoc.setTitle(options.title);
  }
  pdfDoc.setCreationDate(new Date());

  const marginPt = MARGIN_PT[options.margin];

  for (const item of encodedPages) {
    if (item.kind === 'jpeg') {
      const img = await pdfDoc.embedJpg(item.bytes);
      const layout = computePageLayout(img.width, img.height, options.pageSize, marginPt);
      const page = pdfDoc.addPage([layout.pageW, layout.pageH]);
      page.drawImage(img, {
        x: layout.x,
        y: layout.y,
        width: layout.drawW,
        height: layout.drawH,
      });
    } else {
      const layout = computePageLayout(item.width, item.height, options.pageSize, marginPt);
      const page = pdfDoc.addPage([layout.pageW, layout.pageH]);

      const xObjStream = pdfDoc.context.flateStream(item.packedBits, {
        Type: 'XObject',
        Subtype: 'Image',
        Width: item.width,
        Height: item.height,
        ColorSpace: 'DeviceGray',
        BitsPerComponent: 1,
      });
      const xObjRef = pdfDoc.context.register(xObjStream);
      const xObjKey = page.node.newXObject('Image', xObjRef);

      page.pushOperators(
        pushGraphicsState(),
        translate(layout.x, layout.y),
        scale(layout.drawW, layout.drawH),
        drawObject(xObjKey),
        popGraphicsState()
      );
    }
  }

  return pdfDoc.save({ useObjectStreams: true });
}

/**
 * Backwards-compatible wrapper that assembles JPEG-only pages into a PDF.
 */
export async function buildPdfFromJpegs(
  jpegPages: JpegPageInput[],
  options: Pick<ExportOptions, 'pageSize' | 'margin'> & { title?: string }
): Promise<Uint8Array> {
  return buildPdfFromEncodedPages(
    jpegPages.map((p) => ({ kind: 'jpeg' as const, bytes: p.bytes })),
    options
  );
}

function shouldUseMono1Bit(page: ScanPage, bwEncoding: PdfBwEncoding): boolean {
  if (bwEncoding === 'mono-1bit') return true;
  if (bwEncoding === 'jpeg') return false;
  return page.filter === 'pure-bw';
}

async function encodeSinglePage(
  page: ScanPage,
  useMono: boolean,
  maxDim: number,
  jpegQuality: number,
  monoMaxDim: number
): Promise<EncodedPdfPage> {
  if (useMono) {
    const mono = await encodeBlobAsMono1Bit(page.processedBlob, monoMaxDim, {
      isAlreadyBw: page.filter === 'pure-bw',
      needsShadowRemoval: page.filter === 'original',
    });
    return {
      kind: 'mono-flate',
      packedBits: mono.packedBits,
      width: mono.width,
      height: mono.height,
    };
  }

  const jpg = await encodeBlobAsJpegSafe(
    page.processedBlob,
    page.processedWidth,
    page.processedHeight,
    maxDim,
    jpegQuality
  );
  return { kind: 'jpeg', bytes: jpg.bytes };
}

function describeProfile(
  jpegMaxDim: number,
  jpegQuality: number,
  monoMaxDim: number,
  monoCount: number,
  jpegCount: number
): string {
  const parts: string[] = [];
  if (jpegCount > 0) {
    parts.push(`${jpegCount}× JPEG (${jpegMaxDim}px · Q${Math.round(jpegQuality * 100)})`);
  }
  if (monoCount > 0) {
    parts.push(`${monoCount}× 1-Bit B&W (${monoMaxDim}px)`);
  }
  return parts.join(' + ');
}

/**
 * Exports all workspace ScanPages sequentially (one canvas at a time to protect mobile RAM)
 * using either a fixed Quality Preset or Target File Size solver, with optional 1-bit B&W Flate encoding.
 */
export async function exportPagesToPdf(
  pages: ScanPage[],
  options: ExportOptions,
  onProgress?: (progress: ExportProgress) => void
): Promise<ExportResult> {
  if (pages.length === 0) {
    throw new Error('No pages to export.');
  }

  const ordered = [...pages].sort((a, b) => a.order - b.order);
  const sourceBytes = ordered.reduce((sum, p) => sum + p.processedBlob.size, 0);
  const filename = sanitizeFilename(options.filename);
  const docTitle = filename.replace(/\.pdf$/i, '');

  const pageUsesMono = ordered.map((p) => shouldUseMono1Bit(p, options.bwEncoding));
  const monoPageCount = pageUsesMono.filter(Boolean).length;
  const jpegPageCount = ordered.length - monoPageCount;

  // ── Mode 1: Fixed Quality Preset ──
  if (options.compressionMode !== 'target-size') {
    const cfg = QUALITY_CONFIG[options.quality];
    const encodedPages: EncodedPdfPage[] = [];

    for (let i = 0; i < ordered.length; i++) {
      onProgress?.({
        current: i + 1,
        total: ordered.length,
        stage: pageUsesMono[i] ? 'Packing 1-bit B&W page' : 'Encoding page',
      });
      encodedPages.push(
        await encodeSinglePage(
          ordered[i],
          pageUsesMono[i],
          cfg.maxDim,
          cfg.jpegQuality,
          cfg.monoMaxDim
        )
      );
    }

    onProgress?.({ current: ordered.length, total: ordered.length, stage: 'Assembling PDF' });
    const pdfBytes = await buildPdfFromEncodedPages(encodedPages, {
      pageSize: options.pageSize,
      margin: options.margin,
      title: docTitle,
    });

    const blob = toPdfBlob(pdfBytes);
    return {
      blob,
      filename,
      byteSize: blob.size,
      sourceBytes,
      pageCount: ordered.length,
      monoPageCount,
      jpegPageCount,
      appliedProfileLabel: describeProfile(
        cfg.maxDim,
        cfg.jpegQuality,
        cfg.monoMaxDim,
        monoPageCount,
        jpegPageCount
      ),
    };
  }

  // ── Mode 2: Target File Size Solver ──
  const targetMaxBytes = Math.max(32 * 1024, Math.round(options.targetMaxBytes ?? 500 * 1024));
  const monoIndices: number[] = [];
  const jpegIndices: number[] = [];
  for (let i = 0; i < ordered.length; i++) {
    if (pageUsesMono[i]) monoIndices.push(i);
    else jpegIndices.push(i);
  }

  // Case 2a: All pages are 1-bit monochrome — step DPI down only as needed to fit target
  if (jpegIndices.length === 0) {
    const monoDpiLadder = [2000, 1650, 1400, 1150, 950, 780];
    let bestPdf: Uint8Array | null = null;
    let bestMonoDim = monoDpiLadder[monoDpiLadder.length - 1];

    for (let step = 0; step < monoDpiLadder.length; step++) {
      const dim = monoDpiLadder[step];
      const encoded: EncodedPdfPage[] = [];
      for (let i = 0; i < ordered.length; i++) {
        onProgress?.({
          current: i + 1,
          total: ordered.length,
          stage: `Fitting 1-bit B&W (${dim}px)`,
        });
        encoded.push(await encodeSinglePage(ordered[i], true, dim, 0.8, dim));
      }
      const candidate = await buildPdfFromEncodedPages(encoded, {
        pageSize: options.pageSize,
        margin: options.margin,
        title: docTitle,
      });
      bestPdf = candidate;
      bestMonoDim = dim;
      if (candidate.byteLength <= targetMaxBytes) {
        break;
      }
    }

    const finalPdf = bestPdf!;
    const blob = toPdfBlob(finalPdf);
    return {
      blob,
      filename,
      byteSize: blob.size,
      sourceBytes,
      pageCount: ordered.length,
      monoPageCount,
      jpegPageCount: 0,
      targetMet: blob.size <= targetMaxBytes,
      appliedProfileLabel: describeProfile(0, 0, bestMonoDim, monoPageCount, 0),
    };
  }

  // Case 2b: Mixed or JPEG-only pages
  // 1. Encode any 1-bit mono pages first and measure their exact deflated PDF footprint
  let monoMaxDim = 1800;
  const encodedMonoMap = new Map<number, EncodedPdfPage>();
  let monoFootprintBytes = 0;

  if (monoIndices.length > 0) {
    const monoStepDims = [1800, 1400, 1100, 900];
    const monoBudgetCap = targetMaxBytes * Math.max(0.25, monoIndices.length / ordered.length);

    for (const dim of monoStepDims) {
      encodedMonoMap.clear();
      const tempMonoPages: EncodedPdfPage[] = [];
      for (let idx = 0; idx < monoIndices.length; idx++) {
        const pageIdx = monoIndices[idx];
        onProgress?.({
          current: idx + 1,
          total: ordered.length,
          stage: `Packing 1-bit pages (${dim}px)`,
        });
        const enc = await encodeSinglePage(ordered[pageIdx], true, dim, 0.8, dim);
        encodedMonoMap.set(pageIdx, enc);
        tempMonoPages.push(enc);
      }
      const monoOnlyPdf = await buildPdfFromEncodedPages(tempMonoPages, {
        pageSize: options.pageSize,
        margin: options.margin,
      });
      monoFootprintBytes = monoOnlyPdf.byteLength;
      monoMaxDim = dim;
      if (monoFootprintBytes <= monoBudgetCap) break;
    }
  }

  // 2. Solve optimal JPEG level via bounded binary search on representative pages
  const pdfOverheadBytes = 3200 + ordered.length * 650;
  const jpegBudgetBytes = Math.max(
    16 * 1024,
    targetMaxBytes - monoFootprintBytes - pdfOverheadBytes
  );

  const jpegWeights = jpegIndices.map((idx) => ordered[idx].processedBlob.size);
  const sample = selectRepresentativeIndices(jpegWeights, 3);
  const jpegSourceTotal = jpegWeights.reduce((s, w) => s + w, 0);
  const ratioGuess = jpegSourceTotal > 0 ? jpegBudgetBytes / jpegSourceTotal : 0.7;
  const initialLevel =
    ratioGuess >= 1 ? 92 : ratioGuess >= 0.55 ? 70 : ratioGuess >= 0.3 ? 45 : 22;

  let probeStep = 0;
  const solved = await solveCompressionLevel({
    targetBytes: jpegBudgetBytes,
    initialLevel,
    maxIterations: 5,
    measureBytesAtLevel: async (level) => {
      probeStep++;
      const params = levelToEncodingParams(level);
      let sampleBytes = 0;
      for (let s = 0; s < sample.indices.length; s++) {
        const pageIdx = jpegIndices[sample.indices[s]];
        onProgress?.({
          current: Math.min(ordered.length, s + 1),
          total: ordered.length,
          stage: `Estimating target size (Pass ${probeStep})`,
        });
        const enc = await encodeBlobAsJpegSafe(
          ordered[pageIdx].processedBlob,
          ordered[pageIdx].processedWidth,
          ordered[pageIdx].processedHeight,
          params.maxDim,
          params.jpegQuality
        );
        sampleBytes += enc.bytes.byteLength;
      }
      return Math.round(sampleBytes * sample.scaleFactor);
    },
  });

  // 3. Full encode at chosen level + up to 2 corrective passes if final assembled PDF overshoots
  const buildAtLevel = async (level: number, stageLabel: string) => {
    const params = levelToEncodingParams(level);
    const allPages: EncodedPdfPage[] = [];
    for (let i = 0; i < ordered.length; i++) {
      onProgress?.({
        current: i + 1,
        total: ordered.length,
        stage: stageLabel,
      });
      const cachedMono = encodedMonoMap.get(i);
      if (cachedMono) {
        allPages.push(cachedMono);
      } else {
        allPages.push(
          await encodeSinglePage(ordered[i], false, params.maxDim, params.jpegQuality, monoMaxDim)
        );
      }
    }
    const pdfBytes = await buildPdfFromEncodedPages(allPages, {
      pageSize: options.pageSize,
      margin: options.margin,
      title: docTitle,
    });
    return { pdfBytes, params };
  };

  let activeLevel = solved.level;
  let built = await buildAtLevel(activeLevel, 'Encoding final PDF');

  // Corrective step if sampling slightly underestimated total PDF size
  for (let retry = 0; retry < 2 && built.pdfBytes.byteLength > targetMaxBytes && activeLevel > 0; retry++) {
    const overshootRatio = (built.pdfBytes.byteLength - targetMaxBytes) / targetMaxBytes;
    const drop = Math.max(8, Math.round(overshootRatio * 55));
    activeLevel = retry === 1 ? 0 : Math.max(0, activeLevel - drop);
    built = await buildAtLevel(activeLevel, `Tightening to fit target`);
  }

  const blob = toPdfBlob(built.pdfBytes);
  return {
    blob,
    filename,
    byteSize: blob.size,
    sourceBytes,
    pageCount: ordered.length,
    monoPageCount,
    jpegPageCount,
    targetMet: blob.size <= targetMaxBytes,
    appliedProfileLabel: describeProfile(
      built.params.maxDim,
      built.params.jpegQuality,
      monoMaxDim,
      monoPageCount,
      jpegPageCount
    ),
  };
}

function toPdfBlob(pdfBytes: Uint8Array): Blob {
  const arrayBuffer = pdfBytes.buffer.slice(
    pdfBytes.byteOffset,
    pdfBytes.byteOffset + pdfBytes.byteLength
  ) as ArrayBuffer;
  return new Blob([arrayBuffer], { type: 'application/pdf' });
}

export function downloadPdf(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = sanitizeFilename(filename);
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  // Delay revoke slightly for iOS Safari / mobile browsers to begin download cleanly
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

export function canNativeSharePdf(blob: Blob, filename: string): boolean {
  if (typeof navigator === 'undefined' || typeof navigator.share !== 'function' || typeof File === 'undefined') {
    return false;
  }
  if (typeof navigator.canShare !== 'function') {
    return false;
  }
  try {
    const file = new File([blob], sanitizeFilename(filename), { type: 'application/pdf' });
    return navigator.canShare({ files: [file] });
  } catch {
    return false;
  }
}

export async function sharePdf(blob: Blob, filename: string): Promise<'shared' | 'cancelled'> {
  const safeName = sanitizeFilename(filename);
  const file = new File([blob], safeName, { type: 'application/pdf' });
  try {
    await navigator.share({
      title: safeName.replace(/\.pdf$/i, ''),
      files: [file],
    });
    return 'shared';
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      return 'cancelled';
    }
    throw err;
  }
}
