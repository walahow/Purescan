import { useEffect, useState } from 'react';
import {
  CheckCircle2,
  Download,
  FileText,
  Loader2,
  Share2,
  X,
} from 'lucide-react';
import {
  canNativeSharePdf,
  downloadPdf,
  exportPagesToPdf,
  formatBytes,
  QUALITY_CONFIG,
  sanitizeFilename,
  sharePdf,
} from '../pdf/exporter';
import type {
  ExportResult,
  PdfMargin,
  PdfPageSize,
  PdfQuality,
  ScanPage,
} from '../types/scan';
import { CornerTickButton } from './ui/DraftingFrame';

interface ExportModalProps {
  open: boolean;
  pages: ScanPage[];
  defaultTitle: string;
  onClose: () => void;
  onNotify: (kind: 'success' | 'error' | 'info', text: string) => void;
}

export function ExportModal({
  open,
  pages,
  defaultTitle,
  onClose,
  onNotify,
}: ExportModalProps) {
  const [filename, setFilename] = useState(defaultTitle);
  const [pageSize, setPageSize] = useState<PdfPageSize>('a4');
  const [margin, setMargin] = useState<PdfMargin>('small');
  const [quality, setQuality] = useState<PdfQuality>('balanced');

  const [building, setBuilding] = useState(false);
  const [progress, setProgress] = useState<{ current: number; total: number } | null>(null);
  const [result, setResult] = useState<ExportResult | null>(null);
  const [canShare, setCanShare] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setFilename(defaultTitle);
      setResult(null);
      setError(null);
      setProgress(null);
    }
  }, [open, defaultTitle]);

  // Invalidate built PDF if user changes export settings
  useEffect(() => {
    setResult(null);
    setError(null);
  }, [filename, pageSize, margin, quality]);

  if (!open) return null;

  const handleGenerate = async (): Promise<ExportResult | null> => {
    setBuilding(true);
    setError(null);
    setProgress({ current: 1, total: pages.length });
    try {
      const built = await exportPagesToPdf(
        pages,
        { filename, pageSize, margin, quality },
        (current, total) => setProgress({ current, total })
      );
      setResult(built);
      setCanShare(canNativeSharePdf(built.blob, built.filename));
      return built;
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'PDF generation failed.';
      setError(msg);
      return null;
    } finally {
      setBuilding(false);
    }
  };

  const handleDownload = async () => {
    const built = result ?? (await handleGenerate());
    if (!built) return;
    downloadPdf(built.blob, built.filename);
    onNotify('success', `Saved ${built.filename} (${formatBytes(built.byteSize)})`);
  };

  const handleShare = async () => {
    const built = result ?? (await handleGenerate());
    if (!built) return;
    try {
      const status = await sharePdf(built.blob, built.filename);
      if (status === 'shared') {
        onNotify('success', `Shared ${built.filename}`);
      }
    } catch {
      onNotify('error', 'Share failed on this browser — downloading instead.');
      downloadPdf(built.blob, built.filename);
    }
  };

  return (
    <div
      className="fixed inset-0 z-[70] flex items-center justify-center bg-zinc-950/60 backdrop-blur-xs p-4 overflow-y-auto"
      role="dialog"
      aria-modal="true"
      aria-labelledby="export-modal-title"
    >
      <div className="relative w-full max-w-lg bg-white border border-zinc-300 shadow-[12px_12px_0px_0px_rgba(24,24,27,0.22)] my-auto">
        {/* HYDE Brutalist Top Accent Bar */}
        <div className="h-1 w-full bg-zinc-900" />

        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-zinc-200">
          <div className="flex items-center gap-2.5">
            <FileText size={16} className="text-zinc-900" />
            <div>
              <h2
                id="export-modal-title"
                className="font-mono text-xs font-bold uppercase tracking-[0.2em] text-zinc-900"
              >
                EXPORT_PDF_PACKAGE
              </h2>
              <p className="font-mono text-[10px] text-zinc-400">
                {pages.length} {pages.length === 1 ? 'PAGE' : 'PAGES'} · ASSEMBLED ON DEVICE
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close export modal"
            className="h-9 w-9 flex items-center justify-center border border-zinc-200 text-zinc-500 hover:bg-zinc-900 hover:text-white hover:border-zinc-900 transition-colors cursor-pointer"
          >
            <X size={16} />
          </button>
        </div>

        {/* Form Body */}
        <div className="p-6 space-y-5">
          {/* Filename */}
          <div>
            <label
              htmlFor="pdf-filename-input"
              className="block font-mono text-[10px] font-bold uppercase tracking-[0.2em] text-zinc-400 mb-2"
            >
              // FILE_NAME
            </label>
            <div className="flex items-stretch border border-zinc-300 bg-zinc-50 focus-within:border-zinc-900 focus-within:bg-white transition-colors">
              <input
                id="pdf-filename-input"
                type="text"
                value={filename}
                onChange={(e) => setFilename(e.target.value)}
                placeholder="Scan_Document"
                className="flex-1 bg-transparent px-3 h-11 font-mono text-sm text-zinc-900 focus:outline-none min-w-0"
              />
              <span className="flex items-center px-3 border-l border-zinc-200 bg-zinc-100 font-mono text-xs font-bold text-zinc-500">
                .pdf
              </span>
            </div>
            <p className="mt-1 font-mono text-[10px] text-zinc-400 truncate">
              Output: {sanitizeFilename(filename)}
            </p>
          </div>

          {/* Page Size */}
          <div>
            <p className="font-mono text-[10px] font-bold uppercase tracking-[0.2em] text-zinc-400 mb-2">
              // PAGE_SIZE (AUTO ORIENTATION)
            </p>
            <div className="grid grid-cols-3 border border-zinc-200">
              {(
                [
                  { id: 'a4', label: 'A4', sub: 'Standard' },
                  { id: 'letter', label: 'Letter', sub: 'US 8.5×11' },
                  { id: 'fit', label: 'Fit Scan', sub: 'Exact Ratio' },
                ] as const
              ).map((opt, idx) => (
                <button
                  key={opt.id}
                  type="button"
                  onClick={() => setPageSize(opt.id)}
                  className={`py-2.5 px-2 font-mono flex flex-col items-center gap-0.5 transition-colors cursor-pointer ${
                    idx > 0 ? 'border-l border-zinc-200' : ''
                  } ${
                    pageSize === opt.id
                      ? 'bg-zinc-900 text-white'
                      : 'bg-white text-zinc-600 hover:bg-zinc-50'
                  }`}
                >
                  <span className="text-[11px] font-bold uppercase">{opt.label}</span>
                  <span className="text-[9px] opacity-65">{opt.sub}</span>
                </button>
              ))}
            </div>
          </div>

          {/* Margins */}
          <div>
            <p className="font-mono text-[10px] font-bold uppercase tracking-[0.2em] text-zinc-400 mb-2">
              // PAGE_MARGIN
            </p>
            <div className="grid grid-cols-3 border border-zinc-200">
              {(
                [
                  { id: 'none', label: 'None' },
                  { id: 'small', label: 'Clean (6mm)' },
                  { id: 'standard', label: 'Wide (12mm)' },
                ] as const
              ).map((opt, idx) => (
                <button
                  key={opt.id}
                  type="button"
                  onClick={() => setMargin(opt.id)}
                  className={`h-10 px-2 font-mono text-[10px] font-bold uppercase tracking-wider transition-colors cursor-pointer ${
                    idx > 0 ? 'border-l border-zinc-200' : ''
                  } ${
                    margin === opt.id
                      ? 'bg-zinc-900 text-white'
                      : 'bg-white text-zinc-600 hover:bg-zinc-50'
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          {/* Compression Quality */}
          <div>
            <p className="font-mono text-[10px] font-bold uppercase tracking-[0.2em] text-zinc-400 mb-2">
              // IMAGE_QUALITY & SIZE
            </p>
            <div className="grid grid-cols-3 border border-zinc-200">
              {(['small', 'balanced', 'high'] as const).map((q, idx) => (
                <button
                  key={q}
                  type="button"
                  onClick={() => setQuality(q)}
                  className={`py-2.5 px-2 font-mono flex flex-col items-center gap-0.5 transition-colors cursor-pointer ${
                    idx > 0 ? 'border-l border-zinc-200' : ''
                  } ${
                    quality === q
                      ? 'bg-zinc-900 text-white'
                      : 'bg-white text-zinc-600 hover:bg-zinc-50'
                  }`}
                >
                  <span className="text-[11px] font-bold uppercase">{q}</span>
                  <span className="text-[9px] opacity-65">
                    {QUALITY_CONFIG[q].label.split(' ')[1]} {QUALITY_CONFIG[q].label.split(' ')[2]}
                  </span>
                </button>
              ))}
            </div>
          </div>

          {/* Live Progress / Built Result Status Box */}
          {building && progress && (
            <div className="border border-zinc-200 bg-zinc-50 p-3.5 space-y-2">
              <div className="flex items-center justify-between font-mono text-[10px] font-bold uppercase text-zinc-700">
                <span className="flex items-center gap-1.5">
                  <Loader2 size={13} className="animate-spin" />
                  Building PDF Locally...
                </span>
                <span>
                  {progress.current} / {progress.total}
                </span>
              </div>
              <div className="h-1.5 w-full bg-zinc-200 overflow-hidden">
                <div
                  className="h-full bg-zinc-900 transition-all duration-200"
                  style={{ width: `${Math.round((progress.current / progress.total) * 100)}%` }}
                />
              </div>
            </div>
          )}

          {result && !building && (
            <div className="flex items-center justify-between border border-emerald-200 bg-emerald-50 px-3.5 py-3">
              <div className="flex items-center gap-2 min-w-0">
                <CheckCircle2 size={16} className="text-emerald-600 shrink-0" />
                <div className="min-w-0">
                  <p className="font-mono text-[11px] font-bold text-emerald-900 truncate">
                    {result.filename}
                  </p>
                  <p className="font-mono text-[10px] text-emerald-700">
                    {result.pageCount} {result.pageCount === 1 ? 'page' : 'pages'} ·{' '}
                    {formatBytes(result.byteSize)} · READY
                  </p>
                </div>
              </div>
              <span className="font-mono text-[9px] font-bold uppercase tracking-widest text-emerald-700 border border-emerald-300 bg-white px-2 py-0.5 shrink-0">
                PDF OK
              </span>
            </div>
          )}

          {error && (
            <div className="border border-red-200 bg-red-50 px-3.5 py-2.5 font-mono text-xs text-red-700">
              {error}
            </div>
          )}
        </div>

        {/* Footer Actions */}
        <div className="px-6 py-4 bg-zinc-50 border-t border-zinc-200 flex flex-col sm:flex-row gap-2.5">
          <div className="flex-1">
            <CornerTickButton disabled={building} onClick={handleDownload} className="h-12">
              {building ? (
                <>
                  <Loader2 size={15} className="animate-spin" />
                  Building...
                </>
              ) : (
                <>
                  <Download size={15} />
                  Download PDF
                </>
              )}
            </CornerTickButton>
          </div>

          {canShare && (
            <button
              type="button"
              disabled={building}
              onClick={handleShare}
              className="h-12 sm:w-36 rounded-none border border-zinc-900 bg-white text-zinc-900 hover:bg-zinc-900 hover:text-white font-mono text-[11px] font-bold uppercase tracking-widest flex items-center justify-center gap-2 transition-colors disabled:opacity-40 cursor-pointer"
            >
              <Share2 size={15} />
              Share
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
