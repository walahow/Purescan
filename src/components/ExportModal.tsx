import { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Download,
  ExternalLink,
  FileText,
  Gauge,
  Loader2,
  Share2,
  Sliders,
  Sparkles,
  X,
} from 'lucide-react';
import {
  canNativeSharePdf,
  downloadPdf,
  exportPagesToPdf,
  formatBytes,
  formatSavingsPercent,
  QUALITY_CONFIG,
  sanitizeFilename,
  sharePdf,
  TARGET_SIZE_PRESETS,
} from '../pdf/exporter';
import type {
  ExportProgress,
  ExportResult,
  PdfBwEncoding,
  PdfCompressionMode,
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

  const [compressionMode, setCompressionMode] = useState<PdfCompressionMode>('preset');
  const [quality, setQuality] = useState<PdfQuality>('balanced');
  const [targetMaxBytes, setTargetMaxBytes] = useState<number>(500 * 1024);
  const [customTargetMode, setCustomTargetMode] = useState(false);
  const [customValue, setCustomValue] = useState('500');
  const [customUnit, setCustomUnit] = useState<'KB' | 'MB'>('KB');
  const [bwEncoding, setBwEncoding] = useState<PdfBwEncoding>('auto');

  const [building, setBuilding] = useState(false);
  const [progress, setProgress] = useState<ExportProgress | null>(null);
  const [result, setResult] = useState<ExportResult | null>(null);
  const [canShare, setCanShare] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const sourceTotalBytes = useMemo(
    () => pages.reduce((acc, p) => acc + p.processedBlob.size, 0),
    [pages]
  );

  const pureBwCount = useMemo(
    () => pages.filter((p) => p.filter === 'pure-bw').length,
    [pages]
  );

  const resolvedTargetBytes = useMemo(() => {
    if (!customTargetMode) return targetMaxBytes;
    const parsed = Number.parseFloat(customValue);
    if (!Number.isFinite(parsed) || parsed <= 0) return 500 * 1024;
    const bytes = customUnit === 'MB' ? parsed * 1024 * 1024 : parsed * 1024;
    return Math.max(32 * 1024, Math.round(bytes));
  }, [customTargetMode, customUnit, customValue, targetMaxBytes]);

  useEffect(() => {
    if (open) {
      setFilename(defaultTitle);
      setResult(null);
      setError(null);
      setProgress(null);
    }
  }, [open, defaultTitle]);

  // Invalidate built PDF if user changes any export setting
  useEffect(() => {
    setResult(null);
    setError(null);
  }, [
    filename,
    pageSize,
    margin,
    compressionMode,
    quality,
    resolvedTargetBytes,
    bwEncoding,
  ]);

  if (!open) return null;

  const runBuild = async (overrideBw?: PdfBwEncoding): Promise<ExportResult | null> => {
    const activeBw = overrideBw ?? bwEncoding;
    setBuilding(true);
    setError(null);
    setProgress({ current: 1, total: pages.length, stage: 'Preparing pages' });
    try {
      const built = await exportPagesToPdf(
        pages,
        {
          filename,
          pageSize,
          margin,
          quality,
          compressionMode,
          targetMaxBytes: compressionMode === 'target-size' ? resolvedTargetBytes : undefined,
          bwEncoding: activeBw,
        },
        (p) => setProgress(p)
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
    const built = result ?? (await runBuild());
    if (!built) return;
    downloadPdf(built.blob, built.filename);
    onNotify('success', `Saved ${built.filename} (${formatBytes(built.byteSize)})`);
  };

  const handleShare = async () => {
    const built = result ?? (await runBuild());
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

  const handleRetryMono = () => {
    setBwEncoding('mono-1bit');
    void runBuild('mono-1bit');
  };

  const handlePreview = () => {
    if (!result) return;
    const url = URL.createObjectURL(result.blob);
    window.open(url, '_blank');
    window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
  };

  const progressPct =
    progress && progress.total > 0
      ? Math.min(100, Math.round((progress.current / progress.total) * 100))
      : 0;

  return (
    <div
      className="fixed inset-0 z-[70] flex items-center justify-center bg-zinc-950/60 backdrop-blur-xs p-3 sm:p-4 overflow-y-auto"
      role="dialog"
      aria-modal="true"
      aria-labelledby="export-modal-title"
    >
      <div className="relative w-full max-w-xl bg-white border border-zinc-300 shadow-[12px_12px_0px_0px_rgba(24,24,27,0.22)] my-auto max-h-[94vh] flex flex-col">
        {/* HYDE Brutalist Top Accent Bar */}
        <div className="h-1 w-full bg-zinc-900 shrink-0" />

        {/* Header */}
        <div className="flex items-center justify-between px-5 sm:px-6 py-3.5 border-b border-zinc-200 shrink-0">
          <div className="flex items-center gap-2.5 min-w-0">
            <FileText size={16} className="text-zinc-900 shrink-0" />
            <div className="min-w-0">
              <h2
                id="export-modal-title"
                className="font-mono text-xs font-bold uppercase tracking-[0.2em] text-zinc-900"
              >
                EXPORT_PDF_PACKAGE
              </h2>
              <p className="font-mono text-[10px] text-zinc-400 truncate">
                {pages.length} {pages.length === 1 ? 'PAGE' : 'PAGES'} · RAW SCANS{' '}
                {formatBytes(sourceTotalBytes)} · 100% ON-DEVICE
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close export modal"
            className="h-9 w-9 flex items-center justify-center border border-zinc-200 text-zinc-500 hover:bg-zinc-900 hover:text-white hover:border-zinc-900 transition-colors cursor-pointer shrink-0"
          >
            <X size={16} />
          </button>
        </div>

        {/* Scrollable Form Body */}
        <div className="p-5 sm:p-6 space-y-4 overflow-y-auto">
          {/* Filename */}
          <div>
            <label
              htmlFor="pdf-filename-input"
              className="block font-mono text-[10px] font-bold uppercase tracking-[0.2em] text-zinc-400 mb-1.5"
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
                className="flex-1 bg-transparent px-3 h-10 font-mono text-sm text-zinc-900 focus:outline-none min-w-0"
              />
              <span className="flex items-center px-3 border-l border-zinc-200 bg-zinc-100 font-mono text-xs font-bold text-zinc-500">
                .pdf
              </span>
            </div>
            <p className="mt-1 font-mono text-[10px] text-zinc-400 truncate">
              Output: {sanitizeFilename(filename)}
            </p>
          </div>

          {/* Page Size & Margins side-by-side on desktop */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
            <div>
              <p className="font-mono text-[10px] font-bold uppercase tracking-[0.2em] text-zinc-400 mb-1.5">
                // PAGE_SIZE
              </p>
              <div className="grid grid-cols-3 border border-zinc-200">
                {(
                  [
                    { id: 'a4', label: 'A4', sub: 'Auto' },
                    { id: 'letter', label: 'Letter', sub: 'US' },
                    { id: 'fit', label: 'Fit', sub: 'Exact' },
                  ] as const
                ).map((opt, idx) => (
                  <button
                    key={opt.id}
                    type="button"
                    onClick={() => setPageSize(opt.id)}
                    className={`py-2 px-1.5 font-mono flex flex-col items-center gap-0.5 transition-colors cursor-pointer ${
                      idx > 0 ? 'border-l border-zinc-200' : ''
                    } ${
                      pageSize === opt.id
                        ? 'bg-zinc-900 text-white'
                        : 'bg-white text-zinc-600 hover:bg-zinc-50'
                    }`}
                  >
                    <span className="text-[10px] font-bold uppercase">{opt.label}</span>
                    <span className="text-[9px] opacity-65">{opt.sub}</span>
                  </button>
                ))}
              </div>
            </div>

            <div>
              <p className="font-mono text-[10px] font-bold uppercase tracking-[0.2em] text-zinc-400 mb-1.5">
                // PAGE_MARGIN
              </p>
              <div className="grid grid-cols-3 border border-zinc-200">
                {(
                  [
                    { id: 'none', label: 'None', sub: '0mm' },
                    { id: 'small', label: 'Clean', sub: '6mm' },
                    { id: 'standard', label: 'Wide', sub: '12mm' },
                  ] as const
                ).map((opt, idx) => (
                  <button
                    key={opt.id}
                    type="button"
                    onClick={() => setMargin(opt.id)}
                    className={`py-2 px-1.5 font-mono flex flex-col items-center gap-0.5 transition-colors cursor-pointer ${
                      idx > 0 ? 'border-l border-zinc-200' : ''
                    } ${
                      margin === opt.id
                        ? 'bg-zinc-900 text-white'
                        : 'bg-white text-zinc-600 hover:bg-zinc-50'
                    }`}
                  >
                    <span className="text-[10px] font-bold uppercase">{opt.label}</span>
                    <span className="text-[9px] opacity-65">{opt.sub}</span>
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Compression Mode Selector */}
          <div className="border border-zinc-200 bg-zinc-50/60 p-3.5 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="font-mono text-[10px] font-bold uppercase tracking-[0.2em] text-zinc-500">
                // PDF_COMPRESSION
              </p>
              <div className="inline-flex border border-zinc-300 bg-white shrink-0">
                <button
                  type="button"
                  onClick={() => setCompressionMode('preset')}
                  className={`px-2.5 py-1.5 font-mono text-[10px] font-bold uppercase tracking-wider flex items-center gap-1 whitespace-nowrap transition-colors cursor-pointer ${
                    compressionMode === 'preset'
                      ? 'bg-zinc-900 text-white'
                      : 'text-zinc-600 hover:bg-zinc-50'
                  }`}
                >
                  <Sliders size={11} className="shrink-0" />
                  Presets
                </button>
                <button
                  type="button"
                  onClick={() => setCompressionMode('target-size')}
                  className={`px-2.5 py-1.5 border-l border-zinc-300 font-mono text-[10px] font-bold uppercase tracking-wider flex items-center gap-1 whitespace-nowrap transition-colors cursor-pointer ${
                    compressionMode === 'target-size'
                      ? 'bg-zinc-900 text-white'
                      : 'text-zinc-600 hover:bg-zinc-50'
                  }`}
                >
                  <Gauge size={11} className="shrink-0" />
                  Target Size
                </button>
              </div>
            </div>

            {compressionMode === 'preset' ? (
              <div className="grid grid-cols-4 border border-zinc-200 bg-white">
                {(['ultra', 'small', 'balanced', 'high'] as const).map((q, idx) => (
                  <button
                    key={q}
                    type="button"
                    onClick={() => setQuality(q)}
                    className={`py-2 px-1 font-mono flex flex-col items-center gap-0.5 transition-colors cursor-pointer ${
                      idx > 0 ? 'border-l border-zinc-200' : ''
                    } ${
                      quality === q
                        ? 'bg-zinc-900 text-white'
                        : 'bg-white text-zinc-600 hover:bg-zinc-50'
                    }`}
                  >
                    <span className="text-[10px] font-bold uppercase">
                      {q === 'small' ? 'Compact' : q}
                    </span>
                    <span className="text-[9px] opacity-65">{QUALITY_CONFIG[q].shortDpi}</span>
                  </button>
                ))}
              </div>
            ) : (
              <div className="space-y-2.5">
                <div className="grid grid-cols-5 border border-zinc-200 bg-white">
                  {TARGET_SIZE_PRESETS.map((preset, idx) => {
                    const active = !customTargetMode && targetMaxBytes === preset.bytes;
                    return (
                      <button
                        key={preset.id}
                        type="button"
                        onClick={() => {
                          setCustomTargetMode(false);
                          setTargetMaxBytes(preset.bytes);
                        }}
                        className={`h-9 px-1 font-mono text-[10px] font-bold uppercase transition-colors cursor-pointer ${
                          idx > 0 ? 'border-l border-zinc-200' : ''
                        } ${
                          active
                            ? 'bg-zinc-900 text-white'
                            : 'bg-white text-zinc-600 hover:bg-zinc-50'
                        }`}
                      >
                        {preset.label}
                      </button>
                    );
                  })}
                  <button
                    type="button"
                    onClick={() => setCustomTargetMode(true)}
                    className={`h-9 px-1 border-l border-zinc-200 font-mono text-[10px] font-bold uppercase transition-colors cursor-pointer ${
                      customTargetMode
                        ? 'bg-zinc-900 text-white'
                        : 'bg-white text-zinc-600 hover:bg-zinc-50'
                    }`}
                  >
                    Custom
                  </button>
                </div>

                {customTargetMode && (
                  <div className="flex items-stretch gap-2">
                    <div className="flex flex-1 items-stretch border border-zinc-300 bg-white focus-within:border-zinc-900">
                      <span className="flex items-center px-2.5 bg-zinc-50 border-r border-zinc-200 font-mono text-[10px] font-bold text-zinc-400">
                        MAX
                      </span>
                      <input
                        type="number"
                        min={customUnit === 'MB' ? 0.05 : 32}
                        step={customUnit === 'MB' ? 0.1 : 50}
                        value={customValue}
                        onChange={(e) => setCustomValue(e.target.value)}
                        aria-label="Custom target PDF size"
                        className="flex-1 px-2.5 h-9 font-mono text-xs text-zinc-900 focus:outline-none min-w-0"
                      />
                    </div>
                    <div className="inline-flex border border-zinc-300 bg-white">
                      {(['KB', 'MB'] as const).map((unit, idx) => (
                        <button
                          key={unit}
                          type="button"
                          onClick={() => setCustomUnit(unit)}
                          className={`px-3 h-9 font-mono text-[10px] font-bold uppercase cursor-pointer ${
                            idx > 0 ? 'border-l border-zinc-300' : ''
                          } ${
                            customUnit === unit
                              ? 'bg-zinc-900 text-white'
                              : 'text-zinc-600 hover:bg-zinc-50'
                          }`}
                        >
                          {unit}
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                <p className="font-mono text-[10px] text-zinc-500">
                  Auto-tunes resolution &amp; quality to stay under{' '}
                  <strong className="text-zinc-800">{formatBytes(resolvedTargetBytes)}</strong>.
                </p>
              </div>
            )}

            {/* 1-Bit Monochrome / B&W Codec Policy */}
            <div className="pt-2 border-t border-zinc-200/80">
              <div className="flex items-center justify-between mb-1.5">
                <p className="font-mono text-[10px] font-bold uppercase tracking-[0.18em] text-zinc-500">
                  // TEXT_BW_CODEC
                </p>
                {pureBwCount > 0 && bwEncoding === 'auto' && (
                  <span className="font-mono text-[9px] font-bold text-emerald-700">
                    {pureBwCount} Pure B&amp;W → 1-Bit Flate
                  </span>
                )}
              </div>
              <div className="grid grid-cols-3 border border-zinc-200 bg-white">
                {(
                  [
                    { id: 'auto', label: 'Auto', sub: '1-Bit for B&W' },
                    { id: 'mono-1bit', label: 'Force 1-Bit', sub: 'Smallest Text' },
                    { id: 'jpeg', label: 'JPEG Only', sub: 'Smooth Gray' },
                  ] as const
                ).map((opt, idx) => (
                  <button
                    key={opt.id}
                    type="button"
                    onClick={() => setBwEncoding(opt.id)}
                    className={`py-1.5 px-1.5 font-mono flex flex-col items-center gap-0.5 transition-colors cursor-pointer ${
                      idx > 0 ? 'border-l border-zinc-200' : ''
                    } ${
                      bwEncoding === opt.id
                        ? 'bg-zinc-900 text-white'
                        : 'bg-white text-zinc-600 hover:bg-zinc-50'
                    }`}
                  >
                    <span className="text-[10px] font-bold uppercase">{opt.label}</span>
                    <span className="text-[9px] opacity-65">{opt.sub}</span>
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Live Progress Box */}
          {building && progress && (
            <div className="border border-zinc-200 bg-zinc-50 p-3.5 space-y-2">
              <div className="flex items-center justify-between font-mono text-[10px] font-bold uppercase text-zinc-700 gap-2">
                <span className="flex items-center gap-1.5 truncate">
                  <Loader2 size={13} className="animate-spin shrink-0" />
                  <span className="truncate">{progress.stage || 'Building PDF locally'}...</span>
                </span>
                <span className="shrink-0">
                  {progress.current} / {progress.total}
                </span>
              </div>
              <div className="h-1.5 w-full bg-zinc-200 overflow-hidden">
                <div
                  className="h-full bg-zinc-900 transition-all duration-200"
                  style={{ width: `${progressPct}%` }}
                />
              </div>
            </div>
          )}

          {/* Built Result & Telemetry Box */}
          {result && !building && (
            <div
              className={`border px-3.5 py-3 space-y-2 ${
                result.targetMet === false
                  ? 'border-amber-300 bg-amber-50'
                  : 'border-emerald-200 bg-emerald-50'
              }`}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="flex items-start gap-2 min-w-0">
                  {result.targetMet === false ? (
                    <AlertTriangle size={16} className="text-amber-600 shrink-0 mt-0.5" />
                  ) : (
                    <CheckCircle2 size={16} className="text-emerald-600 shrink-0 mt-0.5" />
                  )}
                  <div className="min-w-0">
                    <p
                      className={`font-mono text-[11px] font-bold truncate ${
                        result.targetMet === false ? 'text-amber-950' : 'text-emerald-950'
                      }`}
                    >
                      {result.filename}
                    </p>
                    <p
                      className={`font-mono text-[10px] ${
                        result.targetMet === false ? 'text-amber-800' : 'text-emerald-800'
                      }`}
                    >
                      {formatBytes(result.sourceBytes)} →{' '}
                      <strong>{formatBytes(result.byteSize)}</strong> (
                      {formatSavingsPercent(result.sourceBytes, result.byteSize)})
                    </p>
                    <p className="font-mono text-[9px] text-zinc-500 mt-0.5">
                      {result.appliedProfileLabel}
                    </p>
                  </div>
                </div>
                <span
                  className={`font-mono text-[9px] font-bold uppercase tracking-widest border bg-white px-2 py-0.5 shrink-0 ${
                    result.targetMet === false
                      ? 'text-amber-700 border-amber-300'
                      : 'text-emerald-700 border-emerald-300'
                  }`}
                >
                  {result.targetMet === false
                    ? 'OVER CAP'
                    : result.targetMet === true
                      ? 'UNDER CAP'
                      : 'PDF OK'}
                </span>
              </div>

              {result.targetMet === false && (
                <div className="pt-2 border-t border-amber-200/80 flex flex-wrap items-center justify-between gap-2">
                  <p className="font-mono text-[10px] text-amber-900">
                    Smallest color output is {formatBytes(result.byteSize)} (cap{' '}
                    {formatBytes(resolvedTargetBytes)}).
                  </p>
                  {bwEncoding !== 'mono-1bit' && (
                    <button
                      type="button"
                      onClick={handleRetryMono}
                      className="px-2.5 py-1 bg-zinc-900 text-white font-mono text-[10px] font-bold uppercase tracking-wider hover:bg-zinc-800 cursor-pointer flex items-center gap-1"
                    >
                      <Sparkles size={11} />
                      Retry in 1-Bit B&amp;W
                    </button>
                  )}
                </div>
              )}
            </div>
          )}

          {error && (
            <div className="border border-red-200 bg-red-50 px-3.5 py-2.5 font-mono text-xs text-red-700">
              {error}
            </div>
          )}
        </div>

        {/* Footer Actions */}
        <div className="px-5 sm:px-6 py-3.5 bg-zinc-50 border-t border-zinc-200 flex flex-col sm:flex-row gap-2.5 shrink-0">
          {!result ? (
            <button
              type="button"
              disabled={building}
              onClick={() => void runBuild()}
              className="h-11 sm:w-40 rounded-none border border-zinc-300 bg-white text-zinc-800 hover:bg-zinc-900 hover:text-white hover:border-zinc-900 font-mono text-[10px] font-bold uppercase tracking-widest flex items-center justify-center gap-1.5 transition-colors disabled:opacity-40 cursor-pointer"
            >
              <Gauge size={14} />
              Check Size
            </button>
          ) : (
            <button
              type="button"
              disabled={building}
              onClick={handlePreview}
              className="h-11 sm:w-32 rounded-none border border-zinc-300 bg-white text-zinc-800 hover:bg-zinc-900 hover:text-white hover:border-zinc-900 font-mono text-[10px] font-bold uppercase tracking-widest flex items-center justify-center gap-1.5 transition-colors disabled:opacity-40 cursor-pointer"
            >
              <ExternalLink size={14} />
              Preview
            </button>
          )}

          <div className="flex-1">
            <CornerTickButton disabled={building} onClick={handleDownload} className="h-11">
              {building ? (
                <>
                  <Loader2 size={15} className="animate-spin" />
                  Optimizing...
                </>
              ) : (
                <>
                  <Download size={15} />
                  {result ? `Download (${formatBytes(result.byteSize)})` : 'Build & Download PDF'}
                </>
              )}
            </CornerTickButton>
          </div>

          {canShare && (
            <button
              type="button"
              disabled={building}
              onClick={handleShare}
              className="h-11 sm:w-32 rounded-none border border-zinc-900 bg-white text-zinc-900 hover:bg-zinc-900 hover:text-white font-mono text-[11px] font-bold uppercase tracking-widest flex items-center justify-center gap-2 transition-colors disabled:opacity-40 cursor-pointer"
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
