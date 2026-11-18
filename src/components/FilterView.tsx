import { useEffect, useRef, useState } from 'react';
import {
  ArrowLeft,
  Check,
  Crop,
  Eye,
  Loader2,
  RotateCcw,
  RotateCw,
  SlidersHorizontal,
  Sparkles,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import { blobToImageData, PREVIEW_MAX_DIM } from '../imaging/ingest';
import { processImageInWorker } from '../imaging/workerClient';
import {
  DEFAULT_ADJUSTMENTS,
  FILTER_PRESETS,
  type FilterAdjustments,
  type FilterPreset,
  type Rotation,
} from '../types/scan';
import type { PendingDraft } from '../hooks/useScanWorkspace';
import { CornerTickButton } from './ui/DraftingFrame';

interface FilterViewProps {
  draft: PendingDraft;
  saving: boolean;
  onBackToCrop: (updated: PendingDraft) => void;
  onCancel: () => void;
  onSave: (updated: PendingDraft) => void;
}

export function FilterView({
  draft,
  saving,
  onBackToCrop,
  onCancel,
  onSave,
}: FilterViewProps) {
  const [filter, setFilter] = useState<FilterPreset>(draft.filter);
  const [adjustments, setAdjustments] = useState<FilterAdjustments>({ ...draft.adjustments });
  const [rotation, setRotation] = useState<Rotation>(draft.rotation);
  const [tuneOpen, setTuneOpen] = useState(false);
  const [comparingOriginal, setComparingOriginal] = useState(false);
  const [zoomed, setZoomed] = useState(false);
  const [rendering, setRendering] = useState(true);
  const [previewDims, setPreviewDims] = useState<{ w: number; h: number } | null>(null);

  const srcBufferRef = useRef<{ pixels: Uint8ClampedArray; width: number; height: number } | null>(null);
  const filteredImageRef = useRef<ImageData | null>(null);
  const originalWarpedRef = useRef<{ rot: Rotation; data: ImageData } | null>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const renderTokenRef = useRef(0);
  const [srcReadyToken, setSrcReadyToken] = useState(0);

  // Decode source image once at preview resolution (~1000px) for fast live updates
  useEffect(() => {
    let active = true;
    setRendering(true);
    originalWarpedRef.current = null;
    (async () => {
      try {
        const img = await blobToImageData(draft.originalBlob, PREVIEW_MAX_DIM + 200);
        if (!active) return;
        srcBufferRef.current = img;
        setSrcReadyToken((t) => t + 1);
      } catch {
        if (active) setRendering(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [draft.originalBlob]);

  const paintImageData = (data: ImageData) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.width = data.width;
    canvas.height = data.height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.putImageData(data, 0, 0);
  };

  // Run worker preview whenever preset, sliders, or rotation changes
  useEffect(() => {
    const src = srcBufferRef.current;
    if (!src) return;

    const myToken = ++renderTokenRef.current;
    setRendering(true);

    const timer = window.setTimeout(async () => {
      try {
        const res = await processImageInWorker({
          pixels: src.pixels,
          width: src.width,
          height: src.height,
          quad: draft.quad,
          aspectMode: draft.aspectMode,
          rotation,
          filter,
          adjustments,
          maxOutputDim: PREVIEW_MAX_DIM,
        });

        if (myToken !== renderTokenRef.current) return;

        const safeBytes = new Uint8ClampedArray(
          res.pixels.buffer as ArrayBuffer,
          res.pixels.byteOffset,
          res.pixels.byteLength
        );
        const imgData = new ImageData(safeBytes, res.width, res.height);
        filteredImageRef.current = imgData;
        setPreviewDims({ w: res.width, h: res.height });

        if (!comparingOriginal) {
          paintImageData(imgData);
        }

        // Precompute warped original (same rotation) in background for instant Hold-to-Compare
        if (!originalWarpedRef.current || originalWarpedRef.current.rot !== rotation) {
          const origRes = await processImageInWorker({
            pixels: src.pixels,
            width: src.width,
            height: src.height,
            quad: draft.quad,
            aspectMode: draft.aspectMode,
            rotation,
            filter: 'original',
            adjustments: { shadowStrength: 0, contrast: 0, brightness: 0 },
            maxOutputDim: PREVIEW_MAX_DIM,
          });
          if (myToken === renderTokenRef.current) {
            const origBytes = new Uint8ClampedArray(
              origRes.pixels.buffer as ArrayBuffer,
              origRes.pixels.byteOffset,
              origRes.pixels.byteLength
            );
            originalWarpedRef.current = {
              rot: rotation,
              data: new ImageData(origBytes, origRes.width, origRes.height),
            };
          }
        }
      } finally {
        if (myToken === renderTokenRef.current) {
          setRendering(false);
        }
      }
    }, 35);

    return () => clearTimeout(timer);
  }, [
    srcReadyToken,
    draft.quad,
    draft.aspectMode,
    filter,
    adjustments,
    rotation,
    comparingOriginal,
  ]);

  // Swap canvas immediately during Hold-to-Compare
  useEffect(() => {
    if (comparingOriginal && originalWarpedRef.current?.data) {
      paintImageData(originalWarpedRef.current.data);
    } else if (!comparingOriginal && filteredImageRef.current) {
      paintImageData(filteredImageRef.current);
    }
  }, [comparingOriginal]);

  const buildUpdatedDraft = (): PendingDraft => ({
    ...draft,
    filter,
    adjustments,
    rotation,
  });

  const handleSave = () => {
    onSave(buildUpdatedDraft());
  };

  const handleReCrop = () => {
    onBackToCrop(buildUpdatedDraft());
  };

  const activePresetMeta = FILTER_PRESETS.find((p) => p.id === filter);

  return (
    <div className="fixed inset-0 z-40 flex flex-col bg-[#f5f5f7] text-zinc-900">
      {/* Top Bar */}
      <header className="h-14 shrink-0 border-b border-zinc-200 bg-white/90 backdrop-blur-md px-4 flex items-center justify-between pt-safe z-20">
        <button
          type="button"
          onClick={draft.existingPageId ? onCancel : handleReCrop}
          className="flex items-center gap-1.5 h-9 px-2.5 font-mono text-[11px] font-bold uppercase tracking-wider text-zinc-600 hover:text-zinc-900 cursor-pointer"
        >
          <ArrowLeft size={15} />
          {draft.existingPageId ? 'Workspace' : 'Crop'}
        </button>

        <div className="flex items-center gap-2">
          <Sparkles size={14} className="text-[#2eb846]" />
          <span className="font-mono text-[11px] font-bold uppercase tracking-[0.2em] text-zinc-900">
            ENHANCE_SCAN
          </span>
        </div>

        <button
          type="button"
          disabled={saving}
          onClick={handleSave}
          className="md:hidden h-9 px-3.5 bg-zinc-900 text-white font-mono text-[11px] font-bold uppercase tracking-wider flex items-center gap-1.5 disabled:opacity-40 cursor-pointer"
        >
          {saving ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
          Save
        </button>
        <div className="hidden md:block w-16" />
      </header>

      {/* Main Split Studio */}
      <div className="flex-1 flex flex-col md:flex-row min-h-0 overflow-hidden">
        {/* LEFT: HYDE Document Paper Stage */}
        <div className="flex-1 flex flex-col min-h-0 bg-[#f0f0f2]">
          {/* Stage Sub-Toolbar (matches HYDE DocumentCanvas.tsx) */}
          <div className="h-11 shrink-0 border-b border-zinc-200 bg-white/85 backdrop-blur-md px-3 sm:px-4 flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <button
                type="button"
                onPointerDown={() => setComparingOriginal(true)}
                onPointerUp={() => setComparingOriginal(false)}
                onPointerLeave={() => setComparingOriginal(false)}
                onPointerCancel={() => setComparingOriginal(false)}
                className={`h-8 px-2.5 border font-mono text-[10px] font-bold uppercase tracking-wider flex items-center gap-1.5 select-none transition-colors cursor-pointer ${
                  comparingOriginal
                    ? 'bg-zinc-900 text-white border-zinc-900'
                    : 'bg-zinc-50 text-zinc-700 border-zinc-200 hover:bg-zinc-100'
                }`}
              >
                <Eye size={13} />
                {comparingOriginal ? 'Viewing Original' : 'Hold to Compare'}
              </button>

              {rendering && (
                <span className="inline-flex items-center gap-1.5 font-mono text-[10px] text-zinc-500">
                  <Loader2 size={12} className="animate-spin" />
                  <span className="hidden sm:inline">FILTERING...</span>
                </span>
              )}
            </div>

            <div className="flex items-center gap-2">
              {previewDims && (
                <span className="hidden sm:inline font-mono text-[10px] text-zinc-400">
                  {draft.aspectMode.toUpperCase()} · {rotation}°
                </span>
              )}
              <button
                type="button"
                onClick={() => setZoomed((z) => !z)}
                aria-label={zoomed ? 'Zoom out to fit' : 'Zoom in to inspect text'}
                className="h-8 px-2 border border-zinc-200 bg-zinc-50 hover:bg-white font-mono text-[10px] text-zinc-700 flex items-center gap-1 cursor-pointer"
              >
                {zoomed ? <ZoomOut size={14} /> : <ZoomIn size={14} />}
                <span className="hidden sm:inline">{zoomed ? 'Fit' : '150%'}</span>
              </button>
            </div>
          </div>

          {/* Paper Canvas Preview Area */}
          <div className="flex-1 overflow-auto flex items-center justify-center p-4 md:p-8">
            <div className="relative bg-white shadow-xl border border-zinc-200/80 transition-all">
              <canvas
                ref={canvasRef}
                className={`block ${
                  zoomed
                    ? 'max-w-none w-[140vw] sm:w-[900px] h-auto'
                    : 'max-w-full max-h-[calc(100vh-310px)] md:max-h-[calc(100vh-180px)] w-auto h-auto object-contain'
                }`}
              />
              {comparingOriginal && (
                <span className="absolute top-3 left-3 bg-zinc-900/90 text-white px-2.5 py-1 font-mono text-[10px] font-bold uppercase tracking-widest">
                  ORIGINAL (UNFILTERED)
                </span>
              )}
            </div>
          </div>
        </div>

        {/* RIGHT (Desktop) / BOTTOM (Mobile): Filter Inspector Panel */}
        <aside className="w-full md:w-[370px] lg:w-[400px] shrink-0 border-t md:border-t-0 md:border-l border-zinc-200 bg-white flex flex-col max-h-[46vh] md:max-h-none">
          <div className="flex-1 overflow-y-auto p-4 md:p-6 space-y-5">
            {/* Presets Grid (HYDE segmented selector style) */}
            <div>
              <div className="flex items-center justify-between mb-2.5">
                <p className="font-mono text-[10px] font-bold uppercase tracking-[0.22em] text-zinc-400">
                  // PURE_FILTER_PRESET
                </p>
                <span className="font-mono text-[10px] font-bold text-[#2eb846]">
                  {activePresetMeta?.code}
                </span>
              </div>

              <div className="grid grid-cols-4 md:grid-cols-2 border border-zinc-200">
                {FILTER_PRESETS.map((preset, idx) => {
                  const active = filter === preset.id;
                  return (
                    <button
                      key={preset.id}
                      type="button"
                      onClick={() => setFilter(preset.id)}
                      className={`py-2.5 px-2 md:py-3 md:px-3 text-center md:text-left transition-colors flex flex-col items-center md:items-start gap-0.5 cursor-pointer ${
                        idx % 2 === 1 ? 'md:border-l border-zinc-200' : ''
                      } ${idx >= 2 ? 'md:border-t border-zinc-200' : ''} ${
                        idx > 0 ? 'border-l md:border-l-0 border-zinc-200' : ''
                      } ${
                        active
                          ? 'bg-zinc-900 text-white'
                          : 'bg-white text-zinc-600 hover:bg-zinc-50 hover:text-zinc-900'
                      }`}
                    >
                      <span className="flex items-center gap-1.5 font-mono text-[10px] md:text-[11px] font-bold uppercase tracking-wider">
                        <span
                          className={`hidden md:inline-block w-1.5 h-1.5 ${
                            active ? 'bg-[#2eb846]' : 'bg-zinc-300'
                          }`}
                        />
                        {preset.label}
                      </span>
                      <span
                        className={`hidden md:block text-[10px] leading-snug ${
                          active ? 'text-zinc-300' : 'text-zinc-400'
                        }`}
                      >
                        {preset.description}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Utility Action Row + Mobile Sliders Toggle */}
            <div className="grid grid-cols-3 gap-2">
              <button
                type="button"
                onClick={handleReCrop}
                className="h-10 border border-zinc-200 bg-white hover:bg-zinc-900 hover:text-white hover:border-zinc-900 font-mono text-[10px] font-bold uppercase tracking-wider flex items-center justify-center gap-1.5 transition-colors cursor-pointer"
              >
                <Crop size={13} />
                Re-Crop
              </button>
              <button
                type="button"
                onClick={() => setRotation(((rotation + 90) % 360) as Rotation)}
                className="h-10 border border-zinc-200 bg-white hover:bg-zinc-900 hover:text-white hover:border-zinc-900 font-mono text-[10px] font-bold uppercase tracking-wider flex items-center justify-center gap-1.5 transition-colors cursor-pointer"
              >
                <RotateCw size={13} />
                Rotate
              </button>
              <button
                type="button"
                onClick={() => setTuneOpen((v) => !v)}
                className={`h-10 md:hidden border font-mono text-[10px] font-bold uppercase tracking-wider flex items-center justify-center gap-1.5 transition-colors cursor-pointer ${
                  tuneOpen
                    ? 'bg-zinc-900 text-white border-zinc-900'
                    : 'border-zinc-200 bg-white text-zinc-700'
                }`}
              >
                <SlidersHorizontal size={13} />
                Tune
              </button>
              <button
                type="button"
                onClick={() => setAdjustments({ ...DEFAULT_ADJUSTMENTS })}
                className="hidden md:flex h-10 border border-zinc-200 bg-white hover:bg-zinc-900 hover:text-white hover:border-zinc-900 font-mono text-[10px] font-bold uppercase tracking-wider items-center justify-center gap-1.5 transition-colors cursor-pointer"
              >
                <RotateCcw size={13} />
                Reset
              </button>
            </div>

            {/* Sliders Section (Always open on desktop, toggleable on mobile) */}
            <div className={`${tuneOpen ? 'block' : 'hidden md:block'} space-y-4 border-t border-zinc-100 pt-4`}>
              <div className="flex items-center justify-between">
                <p className="font-mono text-[10px] font-bold uppercase tracking-[0.22em] text-zinc-400">
                  // FINE_TUNING
                </p>
                <button
                  type="button"
                  onClick={() => setAdjustments({ ...DEFAULT_ADJUSTMENTS })}
                  className="md:hidden font-mono text-[10px] text-zinc-500 underline underline-offset-2 cursor-pointer"
                >
                  Reset
                </button>
              </div>

              {/* Shadow Removal Strength */}
              <div className={filter === 'original' ? 'opacity-40 pointer-events-none' : ''}>
                <div className="flex justify-between font-mono text-[10px] uppercase tracking-wider mb-1.5">
                  <span className="text-zinc-600 font-semibold">Shadow Removal</span>
                  <span className="text-zinc-900 font-bold">{adjustments.shadowStrength}%</span>
                </div>
                <input
                  type="range"
                  min={0}
                  max={100}
                  value={adjustments.shadowStrength}
                  onChange={(e) =>
                    setAdjustments((a) => ({ ...a, shadowStrength: Number(e.target.value) }))
                  }
                  className="hyde-slider"
                />
              </div>

              {/* Contrast */}
              <div>
                <div className="flex justify-between font-mono text-[10px] uppercase tracking-wider mb-1.5">
                  <span className="text-zinc-600 font-semibold">Contrast</span>
                  <span className="text-zinc-900 font-bold">
                    {adjustments.contrast > 0 ? `+${adjustments.contrast}` : adjustments.contrast}
                  </span>
                </div>
                <input
                  type="range"
                  min={-50}
                  max={50}
                  value={adjustments.contrast}
                  onChange={(e) =>
                    setAdjustments((a) => ({ ...a, contrast: Number(e.target.value) }))
                  }
                  className="hyde-slider"
                />
              </div>

              {/* Brightness */}
              <div>
                <div className="flex justify-between font-mono text-[10px] uppercase tracking-wider mb-1.5">
                  <span className="text-zinc-600 font-semibold">Brightness</span>
                  <span className="text-zinc-900 font-bold">
                    {adjustments.brightness > 0
                      ? `+${adjustments.brightness}`
                      : adjustments.brightness}
                  </span>
                </div>
                <input
                  type="range"
                  min={-50}
                  max={50}
                  value={adjustments.brightness}
                  onChange={(e) =>
                    setAdjustments((a) => ({ ...a, brightness: Number(e.target.value) }))
                  }
                  className="hyde-slider"
                />
              </div>
            </div>
          </div>

          {/* Desktop Sticky Bottom CTA */}
          <div className="hidden md:block p-6 bg-zinc-50/70 border-t border-zinc-200 shrink-0">
            <CornerTickButton disabled={saving} onClick={handleSave} className="h-13">
              {saving ? (
                <>
                  <Loader2 size={15} className="animate-spin" />
                  Rendering Full-Res...
                </>
              ) : (
                <>
                  <Check size={15} strokeWidth={2.5} />
                  {draft.existingPageId ? 'Update Scan Page' : 'Add Page to Document'}
                </>
              )}
            </CornerTickButton>
          </div>
        </aside>
      </div>
    </div>
  );
}
