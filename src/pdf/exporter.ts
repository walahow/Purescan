import type { ExportOptions, ExportResult, PdfMargin, PdfPageSize, PdfQuality, ScanPage } from '../types/scan';
import { reencodeForPdf } from '../imaging/ingest';

// Standard PDF points (72 pt = 1 inch)
export const PAGE_DIMENSIONS_PT: Record<Exclude<PdfPageSize, 'fit'>, { width: number; height: number }> = {
  a4: { width: 595.28, height: 841.89 },
  letter: { width: 612, height: 792 },
};

export const MARGIN_PT: Record<PdfMargin, number> = {
  none: 0,
  small: 18,
  standard: 36,
};

export const QUALITY_CONFIG: Record<PdfQuality, { maxDim: number; jpegQuality: number; label: string }> = {
  small: { maxDim: 1400, jpegQuality: 0.68, label: 'Compact (~150 DPI)' },
  balanced: { maxDim: 2000, jpegQuality: 0.82, label: 'Balanced (~200 DPI)' },
  high: { maxDim: 2200, jpegQuality: 0.92, label: 'High (~250 DPI)' },
};

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

export interface JpegPageInput {
  bytes: Uint8Array;
}

/**
 * Pure PDF assembly function using pdf-lib. Embeds raw JPEG byte streams directly
 * (/DCTDecode) without re-decoding pixels, auto-orienting A4/Letter pages to match
 * each scan's portrait or landscape aspect ratio.
 */
export async function buildPdfFromJpegs(
  jpegPages: JpegPageInput[],
  options: Pick<ExportOptions, 'pageSize' | 'margin'> & { title?: string }
): Promise<Uint8Array> {
  if (jpegPages.length === 0) {
    throw new Error('Add at least one page before exporting PDF.');
  }

  const { PDFDocument } = await import('pdf-lib');
  const pdfDoc = await PDFDocument.create();
  pdfDoc.setCreator('PureScan — 100% Client-Side Document Scanner');
  pdfDoc.setProducer('PureScan (pdf-lib)');
  if (options.title) {
    pdfDoc.setTitle(options.title);
  }
  pdfDoc.setCreationDate(new Date());

  const marginPt = MARGIN_PT[options.margin];

  for (const item of jpegPages) {
    const img = await pdfDoc.embedJpg(item.bytes);
    const imgW = img.width;
    const imgH = img.height;
    const isLandscape = imgW > imgH;

    let pageW: number;
    let pageH: number;

    if (options.pageSize === 'fit') {
      // Fit page exactly to scan aspect ratio at ~A4 width scale
      const targetWidth = isLandscape ? 841.89 : 595.28;
      const scale = targetWidth / imgW;
      pageW = targetWidth + marginPt * 2;
      pageH = imgH * scale + marginPt * 2;
    } else {
      const base = PAGE_DIMENSIONS_PT[options.pageSize];
      pageW = isLandscape ? base.height : base.width;
      pageH = isLandscape ? base.width : base.height;
    }

    const page = pdfDoc.addPage([pageW, pageH]);
    const availW = Math.max(10, pageW - marginPt * 2);
    const availH = Math.max(10, pageH - marginPt * 2);

    // Aspect-preserving contain fit centered inside available content area
    const scale = Math.min(availW / imgW, availH / imgH);
    const drawW = imgW * scale;
    const drawH = imgH * scale;
    const x = (pageW - drawW) / 2;
    const y = (pageH - drawH) / 2;

    page.drawImage(img, {
      x,
      y,
      width: drawW,
      height: drawH,
    });
  }

  return pdfDoc.save({ useObjectStreams: true });
}

/**
 * Exports all workspace ScanPages sequentially (one canvas at a time to protect mobile RAM)
 * into a clean downloadable PDF Blob.
 */
export async function exportPagesToPdf(
  pages: ScanPage[],
  options: ExportOptions,
  onProgress?: (current: number, total: number) => void
): Promise<ExportResult> {
  if (pages.length === 0) {
    throw new Error('No pages to export.');
  }

  const qualityCfg = QUALITY_CONFIG[options.quality];
  const ordered = [...pages].sort((a, b) => a.order - b.order);
  const jpegPages: JpegPageInput[] = [];

  for (let i = 0; i < ordered.length; i++) {
    onProgress?.(i + 1, ordered.length);
    const page = ordered[i];
    const bytes = await reencodeForPdf(page.processedBlob, qualityCfg.maxDim, qualityCfg.jpegQuality);
    jpegPages.push({ bytes });
  }

  const filename = sanitizeFilename(options.filename);
  const pdfBytes = await buildPdfFromJpegs(jpegPages, {
    pageSize: options.pageSize,
    margin: options.margin,
    title: filename.replace(/\.pdf$/i, ''),
  });

  const arrayBuffer = pdfBytes.buffer.slice(
    pdfBytes.byteOffset,
    pdfBytes.byteOffset + pdfBytes.byteLength
  ) as ArrayBuffer;
  const blob = new Blob([arrayBuffer], { type: 'application/pdf' });

  return {
    blob,
    filename,
    byteSize: blob.size,
    pageCount: ordered.length,
  };
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
