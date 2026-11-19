import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ArrowLeft,
  ArrowRight,
  Maximize2,
  RotateCcw,
  RotateCw,
  Scan,
} from 'lucide-react';
import {
  clampPoint,
  createDefaultQuad,
  createFullQuad,
  isConvexQuad,
} from '../imaging/perspective';
import type { AspectMode, Point, Quad, Rotation } from '../types/scan';
import { CornerTickButton } from './ui/DraftingFrame';

interface CropViewProps {
  imageBlob: Blob;
  initialQuad: Quad;
  initialAspect: AspectMode;
  initialRotation: Rotation;
  onBack: () => void;
  onConfirm: (result: { quad: Quad; aspectMode: AspectMode; rotation: Rotation }) => void;
}

interface ImageLayout {
  offsetX: number;
  offsetY: number;
  drawW: number;
  drawH: number;
  stageW: number;
  stageH: number;
}

type DragTarget =
  | { kind: 'corner'; index: 0 | 1 | 2 | 3 }
  | { kind: 'edge'; edgeIndex: 0 | 1 | 2 | 3; startPointer: Point; startQuad: Quad };

const CORNER_LABELS = ['TL', 'TR', 'BR', 'BL'] as const;
const LOUPE_SIZE = 128;
const LOUPE_ZOOM = 2.6;

export function CropView({
  imageBlob,
  initialQuad,
  initialAspect,
  initialRotation,
  onBack,
  onConfirm,
}: CropViewProps) {
  const [quad, setQuad] = useState<Quad>(() => initialQuad.map((p) => ({ ...p })) as Quad);
  const [aspectMode, setAspectMode] = useState<AspectMode>(initialAspect);
  const [rotation, setRotation] = useState<Rotation>(initialRotation);
  const [activeDrag, setActiveDrag] = useState<DragTarget | null>(null);
  const [rotatePulse, setRotatePulse] = useState(false);
  const [imgEl, setImgEl] = useState<HTMLImageElement | null>(null);
  const [layout, setLayout] = useState<ImageLayout | null>(null);

  const stageRef = useRef<HTMLDivElement>(null);
  const loupeCanvasRef = useRef<HTMLCanvasElement>(null);

  // Decode image Blob for display & magnifier loupe sampling
  useEffect(() => {
    const url = URL.createObjectURL(imageBlob);
    const img = new Image();
    img.onload = () => setImgEl(img);
    img.src = url;
    return () => {
      URL.revokeObjectURL(url);
    };
  }, [imageBlob]);

  // Keep fitted image rectangle synchronized with stage container size
  const recalcLayout = useCallback(() => {
    if (!stageRef.current || !imgEl) return;
    const rect = stageRef.current.getBoundingClientRect();
    const pad = window.innerWidth < 640 ? 28 : 44;
    const availW = Math.max(80, rect.width - pad * 2);
    const availH = Math.max(80, rect.height - pad * 2);
    const scale = Math.min(availW / imgEl.naturalWidth, availH / imgEl.naturalHeight);
    const drawW = imgEl.naturalWidth * scale;
    const drawH = imgEl.naturalHeight * scale;
    setLayout({
      offsetX: (rect.width - drawW) / 2,
      offsetY: (rect.height - drawH) / 2,
      drawW,
      drawH,
      stageW: rect.width,
      stageH: rect.height,
    });
  }, [imgEl]);

  useEffect(() => {
    recalcLayout();
    const ro = new ResizeObserver(recalcLayout);
    if (stageRef.current) ro.observe(stageRef.current);
    window.addEventListener('resize', recalcLayout);
    return () => {
      ro.disconnect();
      window.removeEventListener('resize', recalcLayout);
    };
  }, [recalcLayout]);

  // Render crisp zoomed pixels into circular magnifier loupe while dragging a corner
  useEffect(() => {
    if (!activeDrag || activeDrag.kind !== 'corner' || !imgEl || !loupeCanvasRef.current) return;
    const canvas = loupeCanvasRef.current;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = LOUPE_SIZE * dpr;
    canvas.height = LOUPE_SIZE * dpr;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const pt = quad[activeDrag.index];
    const srcX = pt.x * imgEl.naturalWidth;
    const srcY = pt.y * imgEl.naturalHeight;

    // Sample window size in source pixels
    const sampleSpan = Math.min(imgEl.naturalWidth, imgEl.naturalHeight) / (LOUPE_ZOOM * 2.2);
    const half = sampleSpan / 2;

    ctx.save();
    ctx.scale(dpr, dpr);
    ctx.fillStyle = '#18181b';
    ctx.fillRect(0, 0, LOUPE_SIZE, LOUPE_SIZE);
    ctx.drawImage(
      imgEl,
      srcX - half,
      srcY - half,
      sampleSpan,
      sampleSpan,
      0,
      0,
      LOUPE_SIZE,
      LOUPE_SIZE
    );

    // Draw zoomed quad corner edges inside loupe
    const prevPt = quad[(activeDrag.index + 3) % 4];
    const nextPt = quad[(activeDrag.index + 1) % 4];
    const toLoupe = (target: Point) => ({
      x: LOUPE_SIZE / 2 + ((target.x * imgEl.naturalWidth - srcX) / sampleSpan) * LOUPE_SIZE,
      y: LOUPE_SIZE / 2 + ((target.y * imgEl.naturalHeight - srcY) / sampleSpan) * LOUPE_SIZE,
    });
    const lpPrev = toLoupe(prevPt);
    const lpNext = toLoupe(nextPt);

    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(lpPrev.x, lpPrev.y);
    ctx.lineTo(LOUPE_SIZE / 2, LOUPE_SIZE / 2);
    ctx.lineTo(lpNext.x, lpNext.y);
    ctx.stroke();

    // Precision crosshair at center
    const mid = LOUPE_SIZE / 2;
    ctx.strokeStyle = 'rgba(255,255,255,0.9)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(mid - 16, mid);
    ctx.lineTo(mid - 4, mid);
    ctx.moveTo(mid + 4, mid);
    ctx.lineTo(mid + 16, mid);
    ctx.moveTo(mid, mid - 16);
    ctx.lineTo(mid, mid - 4);
    ctx.moveTo(mid, mid + 4);
    ctx.lineTo(mid, mid + 16);
    ctx.stroke();

    ctx.fillStyle = '#ffffff';
    ctx.fillRect(mid - 2, mid - 2, 4, 4);
    ctx.restore();
  }, [activeDrag, imgEl, quad]);

  const clientToNormalized = useCallback(
    (clientX: number, clientY: number): Point | null => {
      if (!stageRef.current || !layout) return null;
      const rect = stageRef.current.getBoundingClientRect();
      const x = (clientX - rect.left - layout.offsetX) / layout.drawW;
      const y = (clientY - rect.top - layout.offsetY) / layout.drawH;
      return clampPoint({ x, y });
    },
    [layout]
  );

  const handleCornerDown = (index: 0 | 1 | 2 | 3) => (e: React.PointerEvent) => {
    e.stopPropagation();
    e.preventDefault();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    setActiveDrag({ kind: 'corner', index });
  };

  const handleEdgeDown = (edgeIndex: 0 | 1 | 2 | 3) => (e: React.PointerEvent) => {
    e.stopPropagation();
    e.preventDefault();
    const norm = clientToNormalized(e.clientX, e.clientY);
    if (!norm) return;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    setActiveDrag({
      kind: 'edge',
      edgeIndex,
      startPointer: norm,
      startQuad: quad.map((p) => ({ ...p })) as Quad,
    });
  };

  const handleStagePointerMove = (e: React.PointerEvent) => {
    if (!activeDrag) return;
    e.preventDefault();
    const norm = clientToNormalized(e.clientX, e.clientY);
    if (!norm) return;

    if (activeDrag.kind === 'corner') {
      setQuad((prev) => {
        const next = prev.map((p, i) => (i === activeDrag.index ? norm : p)) as Quad;
        return isConvexQuad(next) ? next : prev;
      });
    } else {
      const dx = norm.x - activeDrag.startPointer.x;
      const dy = norm.y - activeDrag.startPointer.y;
      const a = activeDrag.edgeIndex;
      const b = ((activeDrag.edgeIndex + 1) % 4) as 0 | 1 | 2 | 3;

      setQuad((prev) => {
        const next = activeDrag.startQuad.map((p, i) =>
          i === a || i === b ? clampPoint({ x: p.x + dx, y: p.y + dy }) : { ...p }
        ) as Quad;
        return isConvexQuad(next) ? next : prev;
      });
    }
  };

  const handlePointerUp = () => {
    setActiveDrag(null);
  };

  // Position magnifier loupe in opposite top corner so user's finger never covers it
  const activeCornerPoint =
    activeDrag && activeDrag.kind === 'corner' ? quad[activeDrag.index] : null;
  const loupeOnRight = activeCornerPoint ? activeCornerPoint.x < 0.5 : true;

  const toStagePx = (p: Point) => {
    if (!layout) return { x: 0, y: 0 };
    return {
      x: layout.offsetX + p.x * layout.drawW,
      y: layout.offsetY + p.y * layout.drawH,
    };
  };

  const stagePts = layout ? quad.map(toStagePx) : [];
  const edgeMidpoints =
    stagePts.length === 4
      ? [0, 1, 2, 3].map((i) => {
          const a = stagePts[i];
          const b = stagePts[(i + 1) % 4];
          return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
        })
      : [];

  const handleConfirm = () => {
    onConfirm({ quad, aspectMode, rotation });
  };

  return (
    <div className="fixed inset-0 z-40 flex flex-col bg-[#f5f5f7] text-zinc-900">
      {/* Top Compact Header */}
      <header className="h-14 shrink-0 border-b border-zinc-200 bg-white/90 backdrop-blur-md px-4 flex items-center justify-between pt-safe z-20">
        <button
          type="button"
          onClick={onBack}
          className="flex items-center gap-1.5 h-9 px-2.5 font-mono text-[11px] font-bold uppercase tracking-wider text-zinc-600 hover:text-zinc-900 transition-colors cursor-pointer"
        >
          <ArrowLeft size={15} />
          Back
        </button>

        <div className="flex items-center gap-2">
          <Scan size={15} className="text-zinc-900" />
          <span className="font-mono text-[11px] font-bold uppercase tracking-[0.2em] text-zinc-900">
            TRIM_CORNERS
          </span>
        </div>

        <button
          type="button"
          onClick={handleConfirm}
          className="md:hidden h-9 px-3.5 bg-zinc-900 text-white font-mono text-[11px] font-bold uppercase tracking-wider flex items-center gap-1.5 cursor-pointer"
        >
          Next
          <ArrowRight size={14} />
        </button>
        <div className="hidden md:block w-16" />
      </header>

      {/* Main Split Body (HYDE Document Studio layout) */}
      <div className="flex-1 flex flex-col md:flex-row min-h-0 overflow-hidden">
        {/* LEFT: Dark Matte Interactive Perspective Stage */}
        <div
          ref={stageRef}
          onPointerMove={handleStagePointerMove}
          onPointerUp={handlePointerUp}
          onPointerCancel={handlePointerUp}
          className="relative flex-1 bg-[#141417] overflow-hidden select-none touch-none"
        >
          {imgEl && layout && (
            <>
              <img
                src={imgEl.src}
                alt="Document to trim"
                draggable={false}
                style={{
                  position: 'absolute',
                  left: layout.offsetX,
                  top: layout.offsetY,
                  width: layout.drawW,
                  height: layout.drawH,
                }}
                className="pointer-events-none select-none"
              />

              {/* SVG Dimmed Outside Mask + Crisp Quad Border */}
              <svg
                width={layout.stageW}
                height={layout.stageH}
                className="pointer-events-none absolute inset-0"
              >
                <defs>
                  <mask id="crop-quad-cutout">
                    <rect width={layout.stageW} height={layout.stageH} fill="white" />
                    <polygon
                      points={stagePts.map((p) => `${p.x},${p.y}`).join(' ')}
                      fill="black"
                    />
                  </mask>
                </defs>

                {/* Dim area outside selected quad */}
                <rect
                  x={layout.offsetX}
                  y={layout.offsetY}
                  width={layout.drawW}
                  height={layout.drawH}
                  fill="rgba(9, 9, 11, 0.58)"
                  mask="url(#crop-quad-cutout)"
                />

                {/* Subtle inner rule-of-thirds guide lines */}
                {[1 / 3, 2 / 3].map((t) => {
                  const topX = stagePts[0].x + (stagePts[1].x - stagePts[0].x) * t;
                  const topY = stagePts[0].y + (stagePts[1].y - stagePts[0].y) * t;
                  const botX = stagePts[3].x + (stagePts[2].x - stagePts[3].x) * t;
                  const botY = stagePts[3].y + (stagePts[2].y - stagePts[3].y) * t;

                  const leftX = stagePts[0].x + (stagePts[3].x - stagePts[0].x) * t;
                  const leftY = stagePts[0].y + (stagePts[3].y - stagePts[0].y) * t;
                  const rightX = stagePts[1].x + (stagePts[2].x - stagePts[1].x) * t;
                  const rightY = stagePts[1].y + (stagePts[2].y - stagePts[1].y) * t;
                  return (
                    <g key={t} stroke="rgba(255,255,255,0.22)" strokeWidth="1" strokeDasharray="4 4">
                      <line x1={topX} y1={topY} x2={botX} y2={botY} />
                      <line x1={leftX} y1={leftY} x2={rightX} y2={rightY} />
                    </g>
                  );
                })}

                {/* Outer crisp perimeter line */}
                <polygon
                  points={stagePts.map((p) => `${p.x},${p.y}`).join(' ')}
                  fill="none"
                  stroke="#ffffff"
                  strokeWidth="2.5"
                />
              </svg>

              {/* Edge Midpoint Handles (shift whole edge at once) */}
              {edgeMidpoints.map((mp, idx) => (
                <div
                  key={`edge-${idx}`}
                  onPointerDown={handleEdgeDown(idx as 0 | 1 | 2 | 3)}
                  style={{
                    left: mp.x,
                    top: mp.y,
                  }}
                  aria-label={`Drag edge ${idx + 1}`}
                  className="absolute -translate-x-1/2 -translate-y-1/2 w-10 h-10 flex items-center justify-center cursor-move touch-none z-10"
                >
                  <div className="w-3.5 h-3.5 bg-white border-2 border-zinc-900 shadow-md rotate-45" />
                </div>
              ))}

              {/* 4 Corner Handles (large 48px touch target for thumbs) */}
              {stagePts.map((pt, idx) => {
                const isDraggingThis = activeDrag?.kind === 'corner' && activeDrag.index === idx;
                return (
                  <div
                    key={CORNER_LABELS[idx]}
                    onPointerDown={handleCornerDown(idx as 0 | 1 | 2 | 3)}
                    style={{ left: pt.x, top: pt.y }}
                    role="slider"
                    aria-label={`Corner ${CORNER_LABELS[idx]}`}
                    tabIndex={0}
                    className="absolute -translate-x-1/2 -translate-y-1/2 w-12 h-12 flex items-center justify-center cursor-grab active:cursor-grabbing touch-none z-20"
                  >
                    <div
                      className={`w-7 h-7 rounded-full border-[2.5px] transition-transform flex items-center justify-center shadow-lg ${
                        isDraggingThis
                          ? 'scale-125 bg-zinc-900 border-white'
                          : 'bg-white/95 border-zinc-900'
                      }`}
                    >
                      <span
                        className={`w-1.5 h-1.5 rounded-full ${
                          isDraggingThis ? 'bg-white' : 'bg-zinc-900'
                        }`}
                      />
                    </div>
                  </div>
                );
              })}

              {/* Precision Zoomed Magnifier Loupe (auto-positioned opposite active thumb) */}
              {activeDrag?.kind === 'corner' && (
                <div
                  className={`pointer-events-none absolute top-4 z-30 border-2 border-white shadow-2xl bg-zinc-900 ${
                    loupeOnRight ? 'right-4' : 'left-4'
                  }`}
                  style={{ width: LOUPE_SIZE, height: LOUPE_SIZE }}
                >
                  <canvas
                    ref={loupeCanvasRef}
                    style={{ width: LOUPE_SIZE, height: LOUPE_SIZE }}
                    className="block"
                  />
                  <span className="absolute bottom-1 right-1 bg-zinc-950/85 px-1.5 py-0.5 font-mono text-[9px] font-bold text-white">
                    {CORNER_LABELS[activeDrag.index]} · 2.6×
                  </span>
                </div>
              )}
            </>
          )}

          {/* Subtle Hint Badge */}
          {!activeDrag && (
            <div className="pointer-events-none absolute bottom-3 left-1/2 -translate-x-1/2 bg-zinc-950/80 border border-zinc-800 px-3 py-1 font-mono text-[10px] uppercase tracking-wider text-zinc-300 whitespace-nowrap">
              Drag corners or edges to align page borders
            </div>
          )}
        </div>

        {/* RIGHT (Desktop) / BOTTOM (Mobile): HYDE Inspector Controls */}
        <aside className="w-full md:w-[340px] lg:w-[370px] shrink-0 border-t md:border-t-0 md:border-l border-zinc-200 bg-white flex flex-col">
          <div className="p-4 md:p-6 space-y-5 flex-1 overflow-y-auto">
            {/* Aspect Ratio Lock */}
            <div>
              <p className="font-mono text-[10px] font-bold uppercase tracking-[0.22em] text-zinc-400 mb-2.5">
                // OUTPUT_PROPORTION
              </p>
              <div className="grid grid-cols-3 border border-zinc-200">
                {(
                  [
                    { id: 'auto', label: 'Auto', sub: 'Natural' },
                    { id: 'a4', label: 'A4', sub: '210×297' },
                    { id: 'letter', label: 'Letter', sub: '8.5×11' },
                  ] as const
                ).map((opt, idx) => (
                  <button
                    key={opt.id}
                    type="button"
                    onClick={() => setAspectMode(opt.id)}
                    className={`py-2.5 px-2 font-mono transition-colors flex flex-col items-center gap-0.5 cursor-pointer ${
                      idx > 0 ? 'border-l border-zinc-200' : ''
                    } ${
                      aspectMode === opt.id
                        ? 'bg-zinc-900 text-white'
                        : 'bg-white text-zinc-600 hover:bg-zinc-50'
                    }`}
                  >
                    <span className="text-[11px] font-bold uppercase tracking-wider">{opt.label}</span>
                    <span
                      className={`text-[9px] ${
                        aspectMode === opt.id ? 'text-zinc-400' : 'text-zinc-400'
                      }`}
                    >
                      {opt.sub}
                    </span>
                  </button>
                ))}
              </div>
            </div>

            {/* Quick Corner Helpers */}
            <div>
              <p className="font-mono text-[10px] font-bold uppercase tracking-[0.22em] text-zinc-400 mb-2.5 hidden md:block">
                // QUICK_ACTIONS
              </p>
              <div className="grid grid-cols-3 gap-2">
                <button
                  type="button"
                  onClick={() => setQuad(createFullQuad())}
                  className="h-10 px-2 border border-zinc-200 bg-white hover:bg-zinc-900 hover:text-white hover:border-zinc-900 font-mono text-[10px] font-bold uppercase tracking-wider flex items-center justify-center gap-1.5 transition-colors cursor-pointer"
                >
                  <Maximize2 size={13} />
                  Full
                </button>
                <button
                  type="button"
                  onClick={() => setQuad(createDefaultQuad(0.05))}
                  className="h-10 px-2 border border-zinc-200 bg-white hover:bg-zinc-900 hover:text-white hover:border-zinc-900 font-mono text-[10px] font-bold uppercase tracking-wider flex items-center justify-center gap-1.5 transition-colors cursor-pointer"
                >
                  <RotateCcw size={13} />
                  Reset
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setRotation(((rotation + 90) % 360) as Rotation);
                    setRotatePulse(true);
                    window.setTimeout(() => setRotatePulse(false), 450);
                  }}
                  className={`h-10 px-2 border font-mono text-[10px] font-bold uppercase tracking-wider flex items-center justify-center gap-1.5 transition-colors cursor-pointer ${
                    rotatePulse
                      ? 'bg-zinc-900 text-white border-zinc-900'
                      : 'border-zinc-200 bg-white hover:bg-zinc-900 hover:text-white hover:border-zinc-900'
                  }`}
                >
                  <RotateCw size={13} className={rotatePulse ? 'animate-rotate-beat' : ''} />
                  {rotation}°
                </button>
              </div>
            </div>

            <p className="hidden md:block text-xs text-zinc-500 leading-relaxed border-t border-zinc-100 pt-4">
              Place each corner handle on the 4 corners of your page. Use{' '}
              <strong className="text-zinc-800">A4</strong> for tilted shots.
            </p>
          </div>

          {/* Desktop Primary Next CTA */}
          <div className="hidden md:block p-6 bg-zinc-50/70 border-t border-zinc-200 shrink-0">
            <CornerTickButton onClick={handleConfirm} className="h-13">
              Flatten & Filter
              <ArrowRight size={15} />
            </CornerTickButton>
          </div>
        </aside>
      </div>
    </div>
  );
}
