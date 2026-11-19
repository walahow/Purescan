import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Download,
  ExternalLink,
  FileArchive,
  FileText,
  Gauge,
  Loader2,
  RefreshCw,
  Share2,
  ShieldCheck,
  Sliders,
  Sparkles,
  Type,
  Upload,
} from 'lucide-react';
import {
  canNativeSharePdf,
  downloadPdf,
  formatBytes,
  formatSavingsPercent,
  sharePdf,
  TARGET_SIZE_PRESETS,
} from '../pdf/exporter';
import {
  compressExistingPdf,
  inspectPdfBytes,
  PDF_COMPRESS_PRESETS,
} from '../pdf/pdfCompressor';
import { generateSampleShadowedDocument } from '../imaging/sampleDoc';
import type {
  PdfCompressionMode,
  PdfCompressPreset,
  PdfCompressProgress,
  PdfCompressResult,
  PdfInspectionReport,
} from '../types/scan';
import { CornerTickButton, DraftingFrame } from './ui/DraftingFrame';

interface CompressPdfViewProps {
  incomingPdf: File | null;
  onConsumeIncomingPdf: () => void;
  onNotify: (kind: 'success' | 'error' | 'info', text: string) => void;
}

export function CompressPdfView({
  incomingPdf,
  onConsumeIncomingPdf,
  onNotify,
}: CompressPdfViewProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const dragDepthRef = useRef(0);

  const [isDragging, setIsDragging] = useState(false);
  const [pdfBytes, setPdfBytes] = useState<Uint8Array | null>(null);
  const [inspection, setInspection] = useState<PdfInspectionReport | null>(null);
  const [inspecting, setInspecting] = useState(false);
  const [inspectError, setInspectError] = useState<string | null>(null);

  const [compressionMode, setCompressionMode] = useState<PdfCompressionMode>('preset');
  const [preset, setPreset] = useState<PdfCompressPreset>('small');
  const [targetMaxBytes, setTargetMaxBytes] = useState<number>(500 * 1024);
  const [customTargetMode, setCustomTargetMode] = useState(false);
  const [customValue, setCustomValue] = useState('500');
  const [customUnit, setCustomUnit] = useState<'KB' | 'MB'>('KB');
  const [forceMono1Bit, setForceMono1Bit] = useState(false);
  const [stripMetadata, setStripMetadata] = useState(true);

  const [compressing, setCompressing] = useState(false);
  const [progress, setProgress] = useState<PdfCompressProgress | null>(null);
  const [result, setResult] = useState<PdfCompressResult | null>(null);
  const [canShare, setCanShare] = useState(false);
  const [compressError, setCompressError] = useState<string | null>(null);
  const [generatingSample, setGeneratingSample] = useState(false);

  const resolvedTargetBytes = useMemo(() => {
    if (!customTargetMode) return targetMaxBytes;
    const parsed = Number.parseFloat(customValue);
    if (!Number.isFinite(parsed) || parsed <= 0) return 500 * 1024;
    const bytes = customUnit === 'MB' ? parsed * 1024 * 1024 : parsed * 1024;
    return Math.max(32 * 1024, Math.round(bytes));
  }, [customTargetMode, customUnit, customValue, targetMaxBytes]);

  const loadPdfFromBytes = async (bytes: Uint8Array, name: string) => {
    setInspecting(true);
    setInspectError(null);
    setCompressError(null);
    setResult(null);
    try {
      const report = await inspectPdfBytes(bytes, name);
      setPdfBytes(bytes);
      setInspection(report);
    } catch (err) {
      setPdfBytes(null);
      setInspection(null);
      setInspectError(err instanceof Error ? err.message : 'Failed to inspect PDF file.');
    } finally {
      setInspecting(false);
    }
  };

  const loadPdfFile = async (file: File) => {
    const isPdf =
      file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf');
    if (!isPdf) {
      onNotify('error', 'Please select a valid .pdf file.');
      return;
    }
    const buf = await file.arrayBuffer();
    await loadPdfFromBytes(new Uint8Array(buf), file.name);
  };

  // Pick up PDFs dropped anywhere onto the app window
  useEffect(() => {
    if (!incomingPdf) return;
    const file = incomingPdf;
    onConsumeIncomingPdf();
    void loadPdfFile(file);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [incomingPdf]);

  // Clear previous result whenever compression settings change
  useEffect(() => {
    setResult(null);
    setCompressError(null);
  }, [compressionMode, preset, resolvedTargetBytes, forceMono1Bit, stripMetadata]);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (file) void loadPdfFile(file);
  };

  const handleGenerateSamplePdf = async () => {
    setGeneratingSample(true);
    setInspectError(null);
    try {
      const [{ PDFDocument, StandardFonts, rgb }, blob1, blob2] = await Promise.all([
        import('pdf-lib'),
        generateSampleShadowedDocument(1),
        generateSampleShadowedDocument(2),
      ]);

      const doc = await PDFDocument.create();
      doc.setTitle('Sample_Report_With_Photos');
      doc.setAuthor('PureScan Demo');
      const font = await doc.embedFont(StandardFonts.HelveticaBold);
      const bodyFont = await doc.embedFont(StandardFonts.Helvetica);

      const blobs = [blob1, blob2];
      for (let i = 0; i < blobs.length; i++) {
        const jpgBytes = new Uint8Array(await blobs[i].arrayBuffer());
        const img = await doc.embedJpg(jpgBytes);
        const page = doc.addPage([595.28, 841.89]);
        page.drawText(`PURESCAN COMPRESSION DEMO — PAGE 0${i + 1}`, {
          x: 42,
          y: 798,
          size: 13,
          font,
          color: rgb(0.1, 0.1, 0.12),
        });
        page.drawText(
          'This header text stays 100% selectable after in-place client-side image compression.',
          {
            x: 42,
            y: 780,
            size: 9.5,
            font: bodyFont,
            color: rgb(0.35, 0.35, 0.4),
          }
        );
        const scale = Math.min(510 / img.width, 710 / img.height);
        const drawW = img.width * scale;
        const drawH = img.height * scale;
        page.drawImage(img, {
          x: (595.28 - drawW) / 2,
          y: 44 + (710 - drawH) / 2,
          width: drawW,
          height: drawH,
        });
      }

      const sampleBytes = await doc.save({ useObjectStreams: false });
      await loadPdfFromBytes(sampleBytes, 'Sample_Report_With_Photos.pdf');
    } catch (err) {
      setInspectError(err instanceof Error ? err.message : 'Could not build sample PDF.');
    } finally {
      setGeneratingSample(false);
    }
  };

  const runCompression = async (overrideMono?: boolean): Promise<PdfCompressResult | null> => {
    if (!pdfBytes || !inspection) return null;
    const activeMono = overrideMono ?? forceMono1Bit;
    setCompressing(true);
    setCompressError(null);
    setProgress({
      current: 1,
      total: Math.max(1, inspection.compressibleImages),
      stage: 'Preparing PDF',
    });

    try {
      const res = await compressExistingPdf(
        pdfBytes,
        inspection.filename,
        {
          compressionMode,
          preset,
          targetMaxBytes: compressionMode === 'target-size' ? resolvedTargetBytes : undefined,
          forceMono1Bit: activeMono,
          stripMetadata,
        },
        (p) => setProgress(p)
      );
      setResult(res);
      setCanShare(canNativeSharePdf(res.blob, res.filename));
      return res;
    } catch (err) {
      setCompressError(err instanceof Error ? err.message : 'PDF compression failed.');
      return null;
    } finally {
      setCompressing(false);
    }
  };

  const handleDownload = async () => {
    const built = result ?? (await runCompression());
    if (!built) return;
    downloadPdf(built.blob, built.filename);
  };

  const handleShare = async () => {
    const built = result ?? (await runCompression());
    if (!built) return;
    try {
      await sharePdf(built.blob, built.filename);
    } catch {
      onNotify('error', 'Share unavailable on this browser — downloading instead.');
      downloadPdf(built.blob, built.filename);
    }
  };

  const handlePreviewTab = () => {
    if (!result) return;
    const url = URL.createObjectURL(result.blob);
    window.open(url, '_blank');
    window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
  };

  const handleReset = () => {
    setPdfBytes(null);
    setInspection(null);
    setResult(null);
    setInspectError(null);
    setCompressError(null);
    setProgress(null);
  };

  const handleDragEnter = (e: React.DragEvent) => {
    e.preventDefault();
    dragDepthRef.current++;
    setIsDragging(true);
  };
  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);
    if (dragDepthRef.current === 0) setIsDragging(false);
  };
  const handleDragOver = (e: React.DragEvent) => e.preventDefault();
  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    dragDepthRef.current = 0;
    setIsDragging(false);
    const pdfFile = Array.from(e.dataTransfer.files).find(
      (f) => f.type === 'application/pdf' || f.name.toLowerCase().endsWith('.pdf')
    );
    if (pdfFile) {
      void loadPdfFile(pdfFile);
    } else {
      onNotify('error', 'Drop a .pdf file here to compress it.');
    }
  };

  const progressPct =
    progress && progress.total > 0
      ? Math.min(100, Math.round((progress.current / progress.total) * 100))
      : 0;

  return (
    <main
      onDragEnter={handleDragEnter}
      onDragLeave={handleDragLeave}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
      className="relative z-10 flex-1 w-full pb-16 md:pb-8"
    >
      <input
        ref={fileInputRef}
        type="file"
        accept="application/pdf,.pdf"
        onChange={handleFileChange}
        className="hidden"
      />

      {isDragging && (
        <div className="fixed inset-4 z-50 border-2 border-dashed border-zinc-900 bg-white/90 backdrop-blur-xs flex flex-col items-center justify-center pointer-events-none">
          <Upload size={40} className="text-zinc-900 mb-3" />
          <p className="font-mono text-xs font-bold uppercase tracking-[0.25em] text-zinc-900">
            [ RELEASE_TO_COMPRESS_PDF ]
          </p>
        </div>
      )}

      <div className="mx-auto w-full max-w-2xl px-4 md:px-6 pt-7 md:pt-10">
        {/* Section Rule */}
        <div className="flex items-center gap-3 mb-7">
          <div className="h-px flex-1 bg-zinc-200" />
          <span className="text-[10px] md:text-xs font-mono font-medium text-zinc-400 uppercase tracking-widest text-center px-2">
            PDF_COMPRESSOR
          </span>
          <div className="h-px flex-1 bg-zinc-200" />
        </div>

        {/* EMPTY / UPLOAD STATE */}
        {!inspection ? (
          <DraftingFrame>
            <div className="relative bg-white border border-zinc-200 shadow-[10px_10px_0px_0px_rgba(228,228,231,1)] overflow-hidden">
              <div className="h-1 w-full bg-zinc-900" />
              <div className="absolute top-1 left-4 w-px h-5 bg-zinc-900" />
              <div className="absolute top-1 right-4 w-px h-5 bg-zinc-900" />

              <div className="p-6 sm:p-9">
                <div className="flex flex-col items-center text-center mb-7">
                  <div className="h-11 w-11 border border-zinc-200 bg-zinc-50 flex items-center justify-center mb-3.5">
                    <FileArchive size={20} className="text-zinc-900" />
                  </div>
                  <p className="font-mono text-[10px] font-bold uppercase tracking-[0.28em] text-zinc-400 mb-1.5">
                    // IN_PLACE_XOBJECT_ENGINE
                  </p>
                  <h1 className="text-xl sm:text-2xl font-extrabold tracking-tight text-zinc-900 mb-2">
                    Compress existing PDFs.
                  </h1>
                  <p className="text-xs sm:text-sm text-zinc-500 max-w-sm leading-relaxed">
                    Shrink embedded images while keeping selectable text and vectors intact.
                  </p>
                </div>

                {/* Primary Dropzone Button with HYDE Bayer Dither */}
                <button
                  type="button"
                  disabled={inspecting || generatingSample}
                  onClick={() => fileInputRef.current?.click()}
                  className="group relative overflow-hidden w-full border-2 border-dashed border-zinc-300 bg-zinc-50/70 hover:border-zinc-900 hover:bg-white py-9 px-5 flex flex-col items-center justify-center gap-2.5 transition-colors cursor-pointer disabled:opacity-50"
                >
                  <div className="pointer-events-none absolute inset-0 bayer-dither-fade opacity-35 group-hover:opacity-80 transition-opacity duration-300" />
                  {inspecting ? (
                    <>
                      <Loader2 size={24} className="relative z-10 animate-spin text-zinc-900" />
                      <span className="relative z-10 font-mono text-xs font-bold uppercase tracking-widest text-zinc-900">
                        Inspecting PDF structure...
                      </span>
                    </>
                  ) : (
                    <>
                      <div className="relative z-10 h-10 w-10 bg-zinc-900 text-white flex items-center justify-center">
                        <Upload size={18} className="text-white" />
                      </div>
                      <span className="relative z-10 font-mono text-xs font-bold uppercase tracking-[0.18em] text-zinc-900">
                        Select or Drop .PDF File
                      </span>
                      <span className="relative z-10 font-mono text-[10px] text-zinc-400">
                        On-device · Never uploaded
                      </span>
                    </>
                  )}
                </button>

                {inspectError && (
                  <div className="mt-4 border border-red-200 bg-red-50 px-3.5 py-2.5 font-mono text-xs text-red-700">
                    {inspectError}
                  </div>
                )}

                {/* Selling Points */}
                <div className="mt-6 pt-5 border-t border-zinc-100 grid grid-cols-3 gap-3 text-center">
                  <div>
                    <Type size={14} className="mx-auto mb-1 text-zinc-900" />
                    <p className="font-mono text-[10px] font-bold uppercase text-zinc-900">
                      Text Preserved
                    </p>
                    <p className="text-[11px] text-zinc-400">Selectable &amp; sharp</p>
                  </div>
                  <div>
                    <Gauge size={14} className="mx-auto mb-1 text-zinc-900" />
                    <p className="font-mono text-[10px] font-bold uppercase text-zinc-900">
                      Target Size
                    </p>
                    <p className="text-[11px] text-zinc-400">Fit 200 KB–2 MB</p>
                  </div>
                  <div>
                    <ShieldCheck size={14} className="mx-auto mb-1 text-zinc-900" />
                    <p className="font-mono text-[10px] font-bold uppercase text-zinc-900">
                      Zero Upload
                    </p>
                    <p className="text-[11px] text-zinc-400">Works offline</p>
                  </div>
                </div>

                {/* 1-Click Sample Generator */}
                <div className="mt-5 pt-4 border-t border-zinc-100 text-center">
                  <button
                    type="button"
                    disabled={generatingSample || inspecting}
                    onClick={() => void handleGenerateSamplePdf()}
                    className="font-mono text-[10px] font-bold uppercase tracking-wider text-zinc-500 hover:text-zinc-900 underline decoration-zinc-300 underline-offset-4 transition-colors cursor-pointer disabled:opacity-40"
                  >
                    {generatingSample
                      ? 'Building sample PDF...'
                      : 'Generate sample 2-page PDF →'}
                  </button>
                </div>
              </div>
            </div>
          </DraftingFrame>
        ) : (
          /* LOADED PDF STUDIO */
          <div className="bg-white border border-zinc-200 shadow-[10px_10px_0px_0px_rgba(228,228,231,1)]">
            <div className="h-1 w-full bg-zinc-900" />

            {/* Loaded File Header */}
            <div className="px-5 sm:px-6 py-4 border-b border-zinc-200 flex items-center justify-between gap-3">
              <div className="flex items-center gap-2.5 min-w-0">
                <FileText size={18} className="text-zinc-900 shrink-0" />
                <div className="min-w-0">
                  <p className="font-mono text-xs font-bold text-zinc-900 truncate">
                    {inspection.filename}
                  </p>
                  <p className="font-mono text-[10px] text-zinc-400">
                    {inspection.pageCount} {inspection.pageCount === 1 ? 'PAGE' : 'PAGES'} ·{' '}
                    {formatBytes(inspection.totalBytes)} ORIGINAL
                  </p>
                </div>
              </div>
              <button
                type="button"
                disabled={compressing}
                onClick={handleReset}
                className="h-8 px-2.5 border border-zinc-200 bg-white text-zinc-600 hover:bg-zinc-900 hover:text-white hover:border-zinc-900 font-mono text-[10px] font-bold uppercase tracking-wider flex items-center gap-1.5 transition-colors cursor-pointer shrink-0 disabled:opacity-40"
              >
                <RefreshCw size={12} />
                Change PDF
              </button>
            </div>

            <div className="p-5 sm:p-6 space-y-5">
              {/* Upfront Structure Breakdown */}
              <div className="border border-zinc-200 bg-zinc-50/70 p-3.5 space-y-2.5">
                <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 font-mono text-[10px]">
                  <span className="font-bold uppercase tracking-[0.18em] text-zinc-500">
                    // STRUCTURE_DIAGNOSTIC
                  </span>
                  <span className="font-bold text-zinc-800 whitespace-nowrap">
                    {inspection.imageSharePercent}% COMPRESSIBLE IMAGES
                  </span>
                </div>

                {/* Visual Payload Bar */}
                <div className="h-2 w-full bg-zinc-200 overflow-hidden flex">
                  <div
                    className="h-full bg-zinc-900 transition-all"
                    style={{ width: `${inspection.imageSharePercent}%` }}
                  />
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 font-mono text-[10px]">
                  <div className="bg-white border border-zinc-200 px-2.5 py-1.5">
                    <span className="block text-[9px] text-zinc-400 uppercase">Compressible</span>
                    <span className="font-bold text-zinc-900">
                      {inspection.compressibleImages} img ·{' '}
                      {formatBytes(inspection.compressibleBytes)}
                    </span>
                  </div>
                  <div className="bg-white border border-zinc-200 px-2.5 py-1.5">
                    <span className="block text-[9px] text-zinc-400 uppercase">Protected/Skip</span>
                    <span className="font-bold text-zinc-700">
                      {inspection.skippedImages} img
                    </span>
                  </div>
                  <div className="bg-white border border-zinc-200 px-2.5 py-1.5 col-span-2 sm:col-span-1">
                    <span className="block text-[9px] text-zinc-400 uppercase">Text &amp; Vectors</span>
                    <span className="font-bold text-zinc-900">100% Preserved</span>
                  </div>
                </div>

                {(inspection.compressibleImages === 0 || inspection.imageSharePercent < 15) && (
                  <div className="border border-amber-200 bg-amber-50 px-3 py-2 font-mono text-[10px] text-amber-900 flex items-start gap-2">
                    <AlertTriangle size={14} className="text-amber-600 shrink-0 mt-0.5" />
                    <span>
                      {inspection.compressibleImages === 0
                        ? 'No replaceable raster images found (this PDF is mostly text, vector art, fonts, or transparent/1-bit graphics). Only structural stream packing & metadata cleanup will apply.'
                        : `Only ${inspection.imageSharePercent}% of this PDF is compressible images. In-place compression keeps all text selectable, so maximum reduction is limited by embedded fonts/vectors.`}
                    </span>
                  </div>
                )}
              </div>

              {/* Compression Controls */}
              <div className="border border-zinc-200 bg-zinc-50/40 p-3.5 space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="font-mono text-[10px] font-bold uppercase tracking-[0.2em] text-zinc-500">
                    // COMPRESSION_MODE
                  </p>
                  <div className="inline-flex border border-zinc-300 bg-white shrink-0">
                    <button
                      type="button"
                      onClick={() => setCompressionMode('preset')}
                      className={`px-2.5 py-1.5 font-mono text-[10px] font-bold uppercase tracking-wider flex items-center gap-1 whitespace-nowrap cursor-pointer ${
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
                      className={`px-2.5 py-1.5 border-l border-zinc-300 font-mono text-[10px] font-bold uppercase tracking-wider flex items-center gap-1 whitespace-nowrap cursor-pointer ${
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
                  <div className="grid grid-cols-3 border border-zinc-200 bg-white">
                    {(['ultra', 'small', 'balanced'] as const).map((p, idx) => (
                      <button
                        key={p}
                        type="button"
                        onClick={() => setPreset(p)}
                        className={`py-2.5 px-2 font-mono flex flex-col items-center gap-0.5 transition-colors cursor-pointer ${
                          idx > 0 ? 'border-l border-zinc-200' : ''
                        } ${
                          preset === p
                            ? 'bg-zinc-900 text-white'
                            : 'bg-white text-zinc-600 hover:bg-zinc-50'
                        }`}
                      >
                        <span className="text-[11px] font-bold uppercase">
                          {p === 'small' ? 'Compact' : p}
                        </span>
                        <span className="text-[9px] opacity-65">
                          {PDF_COMPRESS_PRESETS[p].shortDpi}
                        </span>
                      </button>
                    ))}
                  </div>
                ) : (
                  <div className="space-y-2.5">
                    <div className="grid grid-cols-5 border border-zinc-200 bg-white">
                      {TARGET_SIZE_PRESETS.map((t, idx) => {
                        const active = !customTargetMode && targetMaxBytes === t.bytes;
                        return (
                          <button
                            key={t.id}
                            type="button"
                            onClick={() => {
                              setCustomTargetMode(false);
                              setTargetMaxBytes(t.bytes);
                            }}
                            className={`h-9 px-1 font-mono text-[10px] font-bold uppercase cursor-pointer ${
                              idx > 0 ? 'border-l border-zinc-200' : ''
                            } ${
                              active
                                ? 'bg-zinc-900 text-white'
                                : 'bg-white text-zinc-600 hover:bg-zinc-50'
                            }`}
                          >
                            {t.label}
                          </button>
                        );
                      })}
                      <button
                        type="button"
                        onClick={() => setCustomTargetMode(true)}
                        className={`h-9 px-1 border-l border-zinc-200 font-mono text-[10px] font-bold uppercase cursor-pointer ${
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
                            aria-label="Custom compressed PDF target size"
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
                  </div>
                )}

                {/* Options Checkboxes */}
                <div className="pt-2 border-t border-zinc-200/80 grid grid-cols-1 sm:grid-cols-2 gap-2">
                  <label className="flex items-center gap-2 border border-zinc-200 bg-white px-3 py-2 cursor-pointer hover:border-zinc-400 transition-colors">
                    <input
                      type="checkbox"
                      checked={forceMono1Bit}
                      onChange={(e) => setForceMono1Bit(e.target.checked)}
                      className="accent-zinc-900 h-3.5 w-3.5"
                    />
                    <span className="font-mono text-[10px] font-bold uppercase text-zinc-700">
                      1-Bit B&amp;W Images (Text Docs)
                    </span>
                  </label>
                  <label className="flex items-center gap-2 border border-zinc-200 bg-white px-3 py-2 cursor-pointer hover:border-zinc-400 transition-colors">
                    <input
                      type="checkbox"
                      checked={stripMetadata}
                      onChange={(e) => setStripMetadata(e.target.checked)}
                      className="accent-zinc-900 h-3.5 w-3.5"
                    />
                    <span className="font-mono text-[10px] font-bold uppercase text-zinc-700">
                      Strip PDF Metadata
                    </span>
                  </label>
                </div>
              </div>

              {/* Progress Bar */}
              {compressing && progress && (
                <div className="border border-zinc-200 bg-zinc-50 p-3.5 space-y-2">
                  <div className="flex items-center justify-between font-mono text-[10px] font-bold uppercase text-zinc-700 gap-2">
                    <span className="flex items-center gap-1.5 truncate">
                      <Loader2 size={13} className="animate-spin shrink-0" />
                      <span className="truncate">{progress.stage}...</span>
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

              {/* Result Box */}
              {result && !compressing && (
                <div
                  className={`border p-4 space-y-2.5 ${
                    result.targetMet === false
                      ? 'border-amber-300 bg-amber-50'
                      : 'border-zinc-900 bg-zinc-50'
                  }`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-start gap-2.5 min-w-0">
                      {result.targetMet === false ? (
                        <AlertTriangle size={18} className="text-amber-600 shrink-0 mt-0.5" />
                      ) : (
                        <CheckCircle2 size={18} className="text-zinc-900 shrink-0 mt-0.5" />
                      )}
                      <div className="min-w-0">
                        <p className="font-mono text-xs font-bold text-zinc-900 truncate">
                          {result.filename}
                        </p>
                        <p className="font-mono text-xs text-zinc-800 mt-0.5">
                          {formatBytes(result.originalBytes)} →{' '}
                          <strong>{formatBytes(result.compressedBytes)}</strong>{' '}
                          <span className="font-bold text-zinc-900">
                            ({formatSavingsPercent(result.originalBytes, result.compressedBytes)})
                          </span>
                        </p>
                        <p className="font-mono text-[10px] text-zinc-500 mt-1">
                          {result.appliedProfileLabel} · {result.recompressedImages} recompressed
                          {result.skippedImages > 0 ? ` · ${result.skippedImages} protected` : ''}
                        </p>
                      </div>
                    </div>

                    <div className="flex flex-col items-end gap-1 shrink-0">
                      <span
                        className={`font-mono text-[9px] font-bold uppercase tracking-widest border bg-white px-2 py-0.5 ${
                          result.alreadyOptimal
                            ? 'text-zinc-700 border-zinc-300'
                            : result.targetMet === false
                              ? 'text-amber-700 border-amber-300'
                              : 'text-zinc-900 border-zinc-900'
                        }`}
                      >
                        {result.alreadyOptimal
                          ? 'ALREADY OPTIMAL'
                          : result.targetMet === false
                            ? 'OVER CAP'
                            : result.targetMet === true
                              ? 'UNDER CAP'
                              : 'COMPRESSED'}
                      </span>
                      <span className="font-mono text-[9px] font-bold text-zinc-700">
                        TEXT PRESERVED
                      </span>
                    </div>
                  </div>

                  {result.targetMet === false && !forceMono1Bit && inspection.compressibleImages > 0 && (
                    <div className="pt-2 border-t border-amber-200 flex flex-wrap items-center justify-between gap-2">
                      <span className="font-mono text-[10px] text-amber-900">
                        Could not reach {formatBytes(resolvedTargetBytes)} in color.
                      </span>
                      <button
                        type="button"
                        onClick={() => {
                          setForceMono1Bit(true);
                          void runCompression(true);
                        }}
                        className="px-2.5 py-1 bg-zinc-900 text-white font-mono text-[10px] font-bold uppercase tracking-wider hover:bg-zinc-800 cursor-pointer flex items-center gap-1"
                      >
                        <Sparkles size={11} />
                        Retry 1-Bit B&amp;W
                      </button>
                    </div>
                  )}
                </div>
              )}

              {compressError && (
                <div className="border border-red-200 bg-red-50 px-3.5 py-2.5 font-mono text-xs text-red-700">
                  {compressError}
                </div>
              )}

              {/* Actions */}
              <div className="flex flex-col sm:flex-row gap-2.5 pt-1">
                {!result ? (
                  <div className="flex-1">
                    <CornerTickButton
                      disabled={compressing}
                      onClick={() => void runCompression()}
                      className="h-12"
                    >
                      {compressing ? (
                        <>
                          <Loader2 size={15} className="animate-spin" />
                          Compressing...
                        </>
                      ) : (
                        <>
                          <FileArchive size={15} />
                          Compress PDF
                        </>
                      )}
                    </CornerTickButton>
                  </div>
                ) : (
                  <>
                    <div className="flex-1">
                      <CornerTickButton onClick={handleDownload} className="h-12">
                        <Download size={15} />
                        Download ({formatBytes(result.compressedBytes)})
                      </CornerTickButton>
                    </div>
                    <button
                      type="button"
                      onClick={handlePreviewTab}
                      className="h-12 sm:w-32 rounded-none border border-zinc-300 bg-white text-zinc-800 hover:bg-zinc-900 hover:text-white hover:border-zinc-900 font-mono text-[10px] font-bold uppercase tracking-widest flex items-center justify-center gap-1.5 transition-colors cursor-pointer"
                    >
                      <ExternalLink size={14} />
                      Preview
                    </button>
                    {canShare && (
                      <button
                        type="button"
                        onClick={handleShare}
                        className="h-12 sm:w-28 rounded-none border border-zinc-900 bg-white text-zinc-900 hover:bg-zinc-900 hover:text-white font-mono text-[10px] font-bold uppercase tracking-widest flex items-center justify-center gap-1.5 transition-colors cursor-pointer"
                      >
                        <Share2 size={14} />
                        Share
                      </button>
                    )}
                  </>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </main>
  );
}
