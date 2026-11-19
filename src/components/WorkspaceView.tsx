import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import {
  Camera,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Crop,
  FileDown,
  FileText,
  GripHorizontal,
  ImagePlus,
  Loader2,
  Plus,
  RotateCw,
  ShieldCheck,
  Sparkles,
  Trash2,
  Upload,
  Wand2,
} from 'lucide-react';
import { FILTER_PRESETS, type FilterPreset, type ScanPage } from '../types/scan';
import { CornerTickButton, DraftingFrame } from './ui/DraftingFrame';

interface WorkspaceViewProps {
  pages: ScanPage[];
  thumbUrls: Record<string, string>;
  documentTitle: string;
  loading: boolean;
  busyLabel: string | null;
  rotatingPageIds: Record<string, boolean>;
  filterAllProgress: { current: number; total: number; percent: number } | null;
  storageWarning: boolean;
  onRenameDocument: (title: string) => void;
  onOpenCamera: () => void;
  onTriggerGallery: () => void;
  onLoadSamplePage: () => void;
  onDropFiles: (files: File[]) => void;
  onEditFilter: (page: ScanPage) => void;
  onEditCrop: (page: ScanPage) => void;
  onRotatePage: (id: string) => void;
  onMovePage: (id: string, dir: -1 | 1) => void;
  onReorderPages: (orderedIds: string[]) => void;
  onDeletePage: (id: string) => void;
  onApplyFilterAll: (filter: FilterPreset) => void;
  onRequestClearAll: () => void;
  onExportPdf: () => void;
}

interface PendingPress {
  id: string;
  pointerId: number;
  pointerType: string;
  startX: number;
  startY: number;
  latestX: number;
  latestY: number;
  grabOffsetX: number;
  grabOffsetY: number;
  width: number;
  height: number;
  immediate: boolean;
}

interface ActiveCardDrag {
  id: string;
  pointerId: number;
  clientX: number;
  clientY: number;
  grabOffsetX: number;
  grabOffsetY: number;
  width: number;
  height: number;
  orderedIds: string[];
}

export function WorkspaceView({
  pages,
  thumbUrls,
  documentTitle,
  loading,
  busyLabel,
  rotatingPageIds,
  filterAllProgress,
  storageWarning,
  onRenameDocument,
  onOpenCamera,
  onTriggerGallery,
  onLoadSamplePage,
  onDropFiles,
  onEditFilter,
  onEditCrop,
  onRotatePage,
  onMovePage,
  onReorderPages,
  onDeletePage,
  onApplyFilterAll,
  onRequestClearAll,
  onExportPdf,
}: WorkspaceViewProps) {
  const [isDraggingOver, setIsDraggingOver] = useState(false);
  const [batchFilterOpen, setBatchFilterOpen] = useState(false);
  const [activeDrag, setActiveDrag] = useState<ActiveCardDrag | null>(null);

  const fileDragDepthRef = useRef(0);
  const cardRefs = useRef<Map<string, HTMLElement>>(new Map());
  const flipSnapshotRef = useRef<Map<string, DOMRect> | null>(null);
  const targetRectsRef = useRef<{ scrollX: number; scrollY: number; rects: Map<string, DOMRect> }>({
    scrollX: 0,
    scrollY: 0,
    rects: new Map(),
  });
  const pendingPressRef = useRef<PendingPress | null>(null);
  const holdTimerRef = useRef<number | null>(null);
  const activeDragRef = useRef<ActiveCardDrag | null>(null);
  const swapLockUntilRef = useRef<number>(0);

  activeDragRef.current = activeDrag;

  const isFilteringAll = filterAllProgress !== null;

  const captureVisualSnapshot = useCallback(() => {
    const snap = new Map<string, DOMRect>();
    for (const [id, el] of cardRefs.current.entries()) {
      snap.set(id, el.getBoundingClientRect());
    }
    flipSnapshotRef.current = snap;
  }, []);

  const displayedPages = React.useMemo(() => {
    if (!activeDrag) return pages;
    const byId = new Map(pages.map((p) => [p.id, p]));
    const list: ScanPage[] = [];
    for (const id of activeDrag.orderedIds) {
      const p = byId.get(id);
      if (p) {
        list.push(p);
        byId.delete(id);
      }
    }
    for (const rest of byId.values()) {
      list.push(rest);
    }
    return list;
  }, [activeDrag, pages]);

  const orderKey = displayedPages.map((p) => p.id).join('|');

  // FLIP animation when page card order changes (either via drag-and-drop or chevron buttons)
  useLayoutEffect(() => {
    const snap = flipSnapshotRef.current;
    flipSnapshotRef.current = null;

    const cleanElements: HTMLElement[] = [];
    for (const [, el] of cardRefs.current.entries()) {
      el.style.transition = 'none';
      el.style.transform = '';
      cleanElements.push(el);
    }

    // Store clean final slot bounding boxes for accurate pointer hit-testing
    const nextTargets = new Map<string, DOMRect>();
    for (const [id, el] of cardRefs.current.entries()) {
      nextTargets.set(id, el.getBoundingClientRect());
    }
    targetRectsRef.current = {
      scrollX: window.scrollX,
      scrollY: window.scrollY,
      rects: nextTargets,
    };

    if (!snap) return;

    const animatedEls: HTMLElement[] = [];
    const dragId = activeDragRef.current?.id;

    for (const [id, el] of cardRefs.current.entries()) {
      if (id === dragId) continue;
      const prevRect = snap.get(id);
      const targetRect = nextTargets.get(id);
      if (!prevRect || !targetRect) continue;

      const dx = prevRect.left - targetRect.left;
      const dy = prevRect.top - targetRect.top;
      if (Math.abs(dx) > 1 || Math.abs(dy) > 1) {
        el.style.transition = 'none';
        el.style.transform = `translate3d(${dx}px, ${dy}px, 0)`;
        animatedEls.push(el);
      }
    }

    if (animatedEls.length === 0) return;

    // Batch single layout read so initial inverted transforms register before transitioning
    void document.body.offsetHeight;

    for (const el of animatedEls) {
      el.style.transition = 'transform 260ms cubic-bezier(0.22, 1, 0.36, 1)';
      el.style.transform = 'translate3d(0, 0, 0)';
    }

    const timer = window.setTimeout(() => {
      for (const el of cleanElements) {
        el.style.transition = '';
        el.style.transform = '';
      }
    }, 280);

    return () => window.clearTimeout(timer);
  }, [orderKey]);

  const clearHoldTimer = () => {
    if (holdTimerRef.current !== null) {
      window.clearTimeout(holdTimerRef.current);
      holdTimerRef.current = null;
    }
  };

  const startCardDrag = useCallback(
    (press: PendingPress, clientX: number, clientY: number) => {
      if (pages.length < 2 || busyLabel || isFilteringAll) return;
      clearHoldTimer();
      pendingPressRef.current = null;
      if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
        navigator.vibrate(12);
      }
      setActiveDrag({
        id: press.id,
        pointerId: press.pointerId,
        clientX,
        clientY,
        grabOffsetX: press.grabOffsetX,
        grabOffsetY: press.grabOffsetY,
        width: press.width,
        height: press.height,
        orderedIds: pages.map((p) => p.id),
      });
    },
    [busyLabel, isFilteringAll, pages]
  );

  // Global pointer tracking for smooth floating drag & grid swap
  useEffect(() => {
    const onPointerMove = (e: PointerEvent) => {
      const currentDrag = activeDragRef.current;
      if (currentDrag && e.pointerId === currentDrag.pointerId) {
        const now = Date.now();
        let nextOrder: string[] | null = null;

        if (now >= swapLockUntilRef.current) {
          const { scrollX, scrollY, rects } = targetRectsRef.current;
          const scrollDx = window.scrollX - scrollX;
          const scrollDy = window.scrollY - scrollY;

          for (const targetId of currentDrag.orderedIds) {
            if (targetId === currentDrag.id) continue;
            const rawRect = rects.get(targetId);
            if (!rawRect) continue;

            // Adjust static target rect for any page scroll since last layout measurement
            const left = rawRect.left - scrollDx;
            const right = rawRect.right - scrollDx;
            const top = rawRect.top - scrollDy;
            const bottom = rawRect.bottom - scrollDy;

            if (e.clientX >= left && e.clientX <= right && e.clientY >= top && e.clientY <= bottom) {
              const fromIdx = currentDrag.orderedIds.indexOf(currentDrag.id);
              const toIdx = currentDrag.orderedIds.indexOf(targetId);
              if (fromIdx !== -1 && toIdx !== -1 && fromIdx !== toIdx) {
                captureVisualSnapshot();
                const updated = [...currentDrag.orderedIds];
                const [moved] = updated.splice(fromIdx, 1);
                updated.splice(toIdx, 0, moved);
                nextOrder = updated;
                swapLockUntilRef.current = now + 130;
              }
              break;
            }
          }
        }

        setActiveDrag((prev) =>
          prev
            ? {
                ...prev,
                clientX: e.clientX,
                clientY: e.clientY,
                orderedIds: nextOrder ?? prev.orderedIds,
              }
            : null
        );
        return;
      }

      const press = pendingPressRef.current;
      if (press && e.pointerId === press.pointerId) {
        press.latestX = e.clientX;
        press.latestY = e.clientY;
        const dist = Math.hypot(e.clientX - press.startX, e.clientY - press.startY);
        if (press.pointerType === 'mouse' || press.immediate) {
          if (dist > 6) {
            startCardDrag(press, e.clientX, e.clientY);
          }
        } else if (dist > 10) {
          // User is scrolling on touch before hold threshold completes
          clearHoldTimer();
          pendingPressRef.current = null;
        }
      }
    };

    const onPointerEnd = (e: PointerEvent) => {
      const currentDrag = activeDragRef.current;
      if (currentDrag && e.pointerId === currentDrag.pointerId) {
        const originalIds = pages.map((p) => p.id);
        const changed = currentDrag.orderedIds.some((id, idx) => originalIds[idx] !== id);
        setActiveDrag(null);
        if (changed) {
          void onReorderPages(currentDrag.orderedIds);
        }
        return;
      }

      const press = pendingPressRef.current;
      if (press && e.pointerId === press.pointerId) {
        clearHoldTimer();
        pendingPressRef.current = null;
        if (e.type === 'pointerup' && !press.immediate) {
          const clicked = pages.find((p) => p.id === press.id);
          if (clicked) onEditFilter(clicked);
        }
      }
    };

    const onTouchMove = (e: TouchEvent) => {
      if (activeDragRef.current) {
        e.preventDefault();
      }
    };

    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerEnd);
    window.addEventListener('pointercancel', onPointerEnd);
    window.addEventListener('touchmove', onTouchMove, { passive: false });
    return () => {
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerEnd);
      window.removeEventListener('pointercancel', onPointerEnd);
      window.removeEventListener('touchmove', onTouchMove);
      clearHoldTimer();
    };
  }, [captureVisualSnapshot, onEditFilter, onReorderPages, pages, startCardDrag]);

  const handleCardSurfacePointerDown = (
    page: ScanPage,
    immediate: boolean
  ) => (e: React.PointerEvent) => {
    if (e.button !== 0 || busyLabel || isFilteringAll) return;
    if (immediate) e.stopPropagation();

    const cardEl = cardRefs.current.get(page.id);
    if (!cardEl) return;
    const rect = cardEl.getBoundingClientRect();

    const press: PendingPress = {
      id: page.id,
      pointerId: e.pointerId,
      pointerType: e.pointerType,
      startX: e.clientX,
      startY: e.clientY,
      latestX: e.clientX,
      latestY: e.clientY,
      grabOffsetX: e.clientX - rect.left,
      grabOffsetY: e.clientY - rect.top,
      width: rect.width,
      height: rect.height,
      immediate,
    };

    pendingPressRef.current = press;
    clearHoldTimer();

    if (pages.length >= 2) {
      holdTimerRef.current = window.setTimeout(
        () => {
          if (pendingPressRef.current?.id === page.id) {
            startCardDrag(
              pendingPressRef.current,
              pendingPressRef.current.latestX,
              pendingPressRef.current.latestY
            );
          }
        },
        immediate ? 80 : 190
      );
    }
  };

  // External file drag-and-drop handlers (ignore non-file drags)
  const isFileDrag = (e: React.DragEvent) =>
    Array.from(e.dataTransfer.types ?? []).includes('Files');

  const handleDragEnter = (e: React.DragEvent) => {
    if (!isFileDrag(e)) return;
    e.preventDefault();
    fileDragDepthRef.current++;
    setIsDraggingOver(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    if (!isFileDrag(e)) return;
    e.preventDefault();
    fileDragDepthRef.current = Math.max(0, fileDragDepthRef.current - 1);
    if (fileDragDepthRef.current === 0) setIsDraggingOver(false);
  };

  const handleDragOver = (e: React.DragEvent) => {
    if (!isFileDrag(e)) return;
    e.preventDefault();
  };

  const handleDrop = (e: React.DragEvent) => {
    if (!isFileDrag(e)) return;
    e.preventDefault();
    fileDragDepthRef.current = 0;
    setIsDraggingOver(false);
    const files = Array.from(e.dataTransfer.files).filter(
      (f) =>
        f.type.startsWith('image/') ||
        f.type === 'application/pdf' ||
        f.name.toLowerCase().endsWith('.pdf')
    );
    if (files.length > 0) {
      onDropFiles(files);
    }
  };

  const filterCode = (id: FilterPreset) =>
    FILTER_PRESETS.find((p) => p.id === id)?.code ?? id.toUpperCase();

  const draggedPage = activeDrag ? pages.find((p) => p.id === activeDrag.id) : null;
  const draggedIndex = activeDrag
    ? activeDrag.orderedIds.findIndex((id) => id === activeDrag.id)
    : -1;

  return (
    <main
      onDragEnter={handleDragEnter}
      onDragLeave={handleDragLeave}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
      className={`relative z-10 flex-1 w-full pb-28 md:pb-10 ${activeDrag ? 'select-none' : ''}`}
    >
      {/* Full-window drag-and-drop highlight */}
      {isDraggingOver && (
        <div className="fixed inset-4 z-50 border-2 border-dashed border-zinc-900 bg-white/90 backdrop-blur-xs flex flex-col items-center justify-center pointer-events-none">
          <Upload size={40} className="text-zinc-900 mb-3" />
          <p className="font-mono text-xs font-bold uppercase tracking-[0.25em] text-zinc-900">
            [ RELEASE_TO_SCAN_OR_COMPRESS ]
          </p>
        </div>
      )}

      <div className="mx-auto w-full max-w-6xl px-4 md:px-6 pt-6 md:pt-9">
        {/* Private-mode fallback notice */}
        {storageWarning && (
          <div className="mb-5 border border-amber-300 bg-amber-50 px-3.5 py-2.5 font-mono text-[11px] text-amber-800 flex items-center gap-2">
            <span>⚠</span>
            <span>
              IndexedDB storage unavailable (private mode). Export your PDF before closing this tab.
            </span>
          </div>
        )}

        {/* HYDE-Style Document Title Input with Extended Crop Lines */}
        <DraftingFrame className="mb-6">
          <div className="relative flex items-center bg-white border border-zinc-200 md:border-zinc-100 shadow-xs">
            <span className="pl-4 pr-2 font-mono text-xs font-bold text-zinc-400 select-none whitespace-nowrap hidden sm:inline">
              [ DOC ] | &gt;
            </span>
            <input
              type="text"
              value={documentTitle}
              onChange={(e) => onRenameDocument(e.target.value)}
              aria-label="Document filename"
              placeholder="UNTITLED_SCAN"
              className="w-full h-11 bg-transparent px-3 sm:px-1 font-mono text-sm md:text-base font-medium text-zinc-900 focus:outline-none focus:bg-zinc-50/70 transition-colors"
            />
            <span className="pr-4 font-mono text-xs text-zinc-400 select-none">.pdf</span>
          </div>
        </DraftingFrame>

        {/* HYDE Horizontal Rule Divider with Centered Status Count */}
        <div className="flex items-center gap-3 mb-7">
          <div className="h-px flex-1 bg-zinc-200" />
          <span className="text-[10px] md:text-xs font-mono font-medium text-zinc-400 uppercase tracking-widest text-center px-2">
            {loading
              ? 'LOADING_WORKSPACE...'
              : pages.length === 0
                ? 'READY · 0 PAGES'
                : `${String(pages.length).padStart(2, '0')} ${
                    pages.length === 1 ? 'PAGE' : 'PAGES'
                  }`}
          </span>
          <div className="h-px flex-1 bg-zinc-200" />
        </div>

        {/* Busy Processing Banner (only for ingestion / multi-page capture) */}
        {busyLabel && (
          <div className="mb-6 flex items-center justify-center gap-2.5 border border-zinc-900 bg-zinc-900 text-white px-4 py-2.5 font-mono text-[11px] uppercase tracking-widest">
            <Loader2 size={14} className="animate-spin text-white" />
            <span>{busyLabel}</span>
          </div>
        )}

        {/* EMPTY STATE */}
        {!loading && pages.length === 0 ? (
          <div className="mx-auto max-w-2xl py-2 md:py-4">
            <div className="relative bg-white border border-zinc-200 shadow-[10px_10px_0px_0px_rgba(228,228,231,1)] overflow-hidden">
              {/* HYDE Brutalist Top Bar & Corner Ticks */}
              <div className="h-1 w-full bg-zinc-900" />
              <div className="absolute top-1 left-4 w-px h-5 bg-zinc-900" />
              <div className="absolute top-1 right-4 w-px h-5 bg-zinc-900" />

              <div className="p-6 sm:p-9">
                <div className="flex flex-col items-center text-center mb-7">
                  <div className="h-11 w-11 border border-zinc-200 bg-zinc-50 flex items-center justify-center mb-3.5">
                    <FileText size={20} className="text-zinc-900" />
                  </div>
                  <p className="font-mono text-[10px] font-bold uppercase tracking-[0.28em] text-zinc-400 mb-1.5">
                    // DOCUMENT_STUDIO
                  </p>
                  <h1 className="text-xl sm:text-2xl font-extrabold tracking-tight text-zinc-900 mb-2">
                    Capture or import pages.
                  </h1>
                  <p className="text-xs sm:text-sm text-zinc-500 max-w-sm leading-relaxed">
                    Perspective trim, shadow cleanup, and clean PDF export.
                  </p>
                </div>

                {/* Primary Source Selection Cards with HYDE Bayer Dither */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-6">
                  <button
                    type="button"
                    onClick={onOpenCamera}
                    className="group relative overflow-hidden h-28 border border-zinc-300 bg-white text-zinc-900 hover:border-zinc-900 hover:-translate-y-0.5 hover:shadow-[6px_6px_0px_0px_rgba(24,24,27,1)] active:translate-y-0 transition-all flex flex-col items-center justify-center gap-1.5 px-5 cursor-pointer"
                  >
                    <div className="pointer-events-none absolute inset-0 bayer-dither-fade opacity-50 group-hover:opacity-100 transition-opacity duration-300" />
                    <Camera size={22} className="relative z-10 text-zinc-900" />
                    <span className="relative z-10 font-mono text-[11px] font-bold uppercase tracking-[0.18em]">
                      Live Camera
                    </span>
                    <span className="relative z-10 font-mono text-[9px] text-zinc-500 uppercase tracking-wider">
                      Single or Batch
                    </span>
                  </button>

                  <button
                    type="button"
                    onClick={onTriggerGallery}
                    className="group relative overflow-hidden h-28 border border-zinc-300 bg-white text-zinc-900 hover:border-zinc-900 hover:-translate-y-0.5 hover:shadow-[6px_6px_0px_0px_rgba(24,24,27,1)] active:translate-y-0 transition-all flex flex-col items-center justify-center gap-1.5 px-5 cursor-pointer"
                  >
                    <div className="pointer-events-none absolute inset-0 bayer-dither-fade opacity-50 group-hover:opacity-100 transition-opacity duration-300" />
                    <ImagePlus size={22} className="relative z-10 text-zinc-900" />
                    <span className="relative z-10 font-mono text-[11px] font-bold uppercase tracking-[0.18em]">
                      Import Photos
                    </span>
                    <span className="relative z-10 font-mono text-[9px] text-zinc-500 uppercase tracking-wider">
                      Select or Drop Files
                    </span>
                  </button>
                </div>

                {/* 3 Selling Points */}
                <div className="pt-5 pb-1 border-t border-zinc-100 grid grid-cols-3 gap-3 text-center">
                  <div>
                    <Sparkles size={14} className="mx-auto mb-1 text-zinc-900" />
                    <p className="font-mono text-[10px] font-bold uppercase text-zinc-900">
                      Pure Filter
                    </p>
                    <p className="text-[11px] text-zinc-400">Removes shadows</p>
                  </div>
                  <div>
                    <ShieldCheck size={14} className="mx-auto mb-1 text-zinc-900" />
                    <p className="font-mono text-[10px] font-bold uppercase text-zinc-900">
                      100% Local
                    </p>
                    <p className="text-[11px] text-zinc-400">Zero uploads</p>
                  </div>
                  <div>
                    <FileDown size={14} className="mx-auto mb-1 text-zinc-900" />
                    <p className="font-mono text-[10px] font-bold uppercase text-zinc-900">
                      Clean PDF
                    </p>
                    <p className="text-[11px] text-zinc-400">No watermarks</p>
                  </div>
                </div>

                {/* Instant Demo Trigger */}
                <div className="mt-4 pt-4 border-t border-zinc-100 text-center">
                  <button
                    type="button"
                    onClick={onLoadSamplePage}
                    className="font-mono text-[10px] font-bold uppercase tracking-wider text-zinc-500 hover:text-zinc-900 underline decoration-zinc-300 underline-offset-4 transition-colors cursor-pointer"
                  >
                    Try with sample photo →
                  </button>
                </div>
              </div>
            </div>
          </div>
        ) : (
          /* POPULATED WORKSPACE */
          <>
            {/* Workspace Control Strip */}
            <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
              {/* Desktop Add Buttons */}
              <div className="hidden md:flex items-center gap-2.5">
                <button
                  type="button"
                  onClick={onOpenCamera}
                  className="group relative overflow-hidden h-9 px-3.5 bg-white text-zinc-700 border border-zinc-200 hover:bg-zinc-900 hover:text-white hover:border-zinc-900 font-mono text-[10px] font-bold uppercase tracking-wider flex items-center gap-1.5 transition-colors cursor-pointer"
                >
                  <Camera size={13} />
                  Live Camera
                </button>
                <button
                  type="button"
                  onClick={onTriggerGallery}
                  className="group relative overflow-hidden h-9 px-3.5 bg-white text-zinc-700 border border-zinc-200 hover:bg-zinc-900 hover:text-white hover:border-zinc-900 font-mono text-[10px] font-bold uppercase tracking-wider flex items-center gap-1.5 transition-colors cursor-pointer"
                >
                  <ImagePlus size={13} />
                  Import Photos
                </button>
              </div>

              {/* Batch Filter + Clear Controls */}
              <div className="flex items-center gap-2.5 w-full md:w-auto justify-between md:justify-end">
                {/* Apply Filter to All Dropdown */}
                <div className="relative">
                  <button
                    type="button"
                    onClick={() => setBatchFilterOpen((v) => !v)}
                    disabled={Boolean(busyLabel) || isFilteringAll}
                    className={`relative isolate overflow-hidden h-9 px-3.5 border font-mono text-[10px] font-bold uppercase tracking-wider flex items-center justify-center gap-1.5 transition-colors ${
                      isFilteringAll
                        ? 'min-w-[154px] bg-white border-zinc-900 cursor-wait disabled:opacity-100'
                        : 'bg-white text-zinc-700 border-zinc-200 hover:border-zinc-900 hover:text-zinc-900 disabled:opacity-40 cursor-pointer'
                    }`}
                  >
                    {isFilteringAll && (
                      <>
                        <span
                          aria-hidden="true"
                          className="pointer-events-none absolute inset-0 bayer-dither animate-dither-drift opacity-75"
                        />
                        <span
                          aria-hidden="true"
                          style={{ width: `${filterAllProgress.percent}%` }}
                          className="pointer-events-none absolute inset-y-0 left-0 bg-zinc-900 transition-[width] duration-200 ease-out"
                        />
                      </>
                    )}
                    <span
                      className={`relative z-10 flex items-center gap-1.5 ${
                        isFilteringAll ? 'mix-blend-difference text-white' : ''
                      }`}
                    >
                      <Wand2 size={13} />
                      <span>
                        {isFilteringAll
                          ? `Filtering ${filterAllProgress.current}/${filterAllProgress.total}`
                          : 'Filter All Pages'}
                      </span>
                      {!isFilteringAll && <ChevronDown size={13} />}
                    </span>
                  </button>

                  {batchFilterOpen && !isFilteringAll && (
                    <div className="absolute left-0 md:left-auto md:right-0 mt-1.5 w-48 bg-white border border-zinc-200 shadow-[6px_6px_0px_0px_rgba(228,228,231,1)] z-30">
                      {FILTER_PRESETS.map((preset) => (
                        <button
                          key={preset.id}
                          type="button"
                          onClick={() => {
                            setBatchFilterOpen(false);
                            onApplyFilterAll(preset.id);
                          }}
                          className="w-full px-3 py-2.5 text-left font-mono text-[10px] font-bold uppercase tracking-wider text-zinc-700 hover:bg-zinc-900 hover:text-white flex items-center justify-between transition-colors cursor-pointer"
                        >
                          <span>{preset.label}</span>
                          <span className="opacity-50 text-[9px]">{preset.code}</span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>

                <button
                  type="button"
                  onClick={onRequestClearAll}
                  disabled={Boolean(busyLabel) || isFilteringAll}
                  className="h-9 px-3.5 bg-white text-zinc-600 border border-zinc-200 hover:bg-red-600 hover:text-white hover:border-red-600 font-mono text-[10px] font-bold uppercase tracking-wider flex items-center gap-1.5 transition-colors disabled:opacity-40 cursor-pointer"
                >
                  <Trash2 size={13} />
                  Clear All
                </button>
              </div>
            </div>

            {pages.length > 1 && (
              <p className="mb-3 font-mono text-[10px] text-zinc-400 uppercase tracking-wider">
                Hold &amp; drag any page to reorder
              </p>
            )}

            {/* Responsive Page Thumbnail Grid */}
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4 md:gap-5">
              {displayedPages.map((page, index) => {
                const isDraggedPlaceholder = activeDrag?.id === page.id;
                const isRotating = Boolean(rotatingPageIds[page.id]);

                return (
                  <article
                    key={page.id}
                    ref={(el) => {
                      if (el) cardRefs.current.set(page.id, el);
                      else cardRefs.current.delete(page.id);
                    }}
                    className={`group relative flex flex-col ${
                      isDraggedPlaceholder
                        ? 'border-2 border-dashed border-zinc-900/45 bg-zinc-200/40'
                        : 'bg-white border border-zinc-200 hover:border-zinc-900 shadow-xs hover:shadow-[6px_6px_0px_0px_rgba(228,228,231,1)] transition-shadow'
                    }`}
                  >
                    {isDraggedPlaceholder ? (
                      <div className="relative aspect-[3/4] w-full flex flex-col items-center justify-center overflow-hidden">
                        <div className="pointer-events-none absolute inset-0 bayer-dither opacity-80" />
                        <span className="relative z-10 font-mono text-[10px] font-bold uppercase tracking-widest text-zinc-500">
                          {String(index + 1).padStart(2, '0')}
                        </span>
                        <div className="h-10 w-full" />
                      </div>
                    ) : (
                      <>
                        {/* Subtle HYDE Bayer Dither Overlay on Hover */}
                        <div className="pointer-events-none absolute inset-0 bayer-dither-fade opacity-0 group-hover:opacity-75 transition-opacity z-0" />

                        {/* Thumbnail Preview Surface (Click to edit filter; hold/drag to reorder) */}
                        <div
                          role="button"
                          tabIndex={0}
                          aria-label={`Page ${index + 1}. Tap to edit filter, hold and drag to reorder.`}
                          onPointerDown={handleCardSurfacePointerDown(page, false)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter' || e.key === ' ') {
                              e.preventDefault();
                              onEditFilter(page);
                            }
                          }}
                          className="relative z-10 aspect-[3/4] w-full bg-[#f0f0f2] p-3 flex items-center justify-center overflow-hidden cursor-grab active:cursor-grabbing select-none"
                        >
                          {thumbUrls[page.id] ? (
                            <img
                              src={thumbUrls[page.id]}
                              alt={`Scanned page ${index + 1}`}
                              draggable={false}
                              className="max-h-full max-w-full object-contain bg-white shadow-md border border-zinc-200/80 transition-transform duration-300 group-hover:scale-[1.02] pointer-events-none"
                            />
                          ) : (
                            <Loader2 size={20} className="animate-spin text-zinc-400" />
                          )}

                          {/* Top-Left Page Number Badge */}
                          <span className="absolute top-2 left-2 bg-zinc-900 text-white px-2 py-0.5 font-mono text-[10px] font-bold tracking-wider">
                            {String(index + 1).padStart(2, '0')}
                          </span>

                          {/* Top-Center Drag Handle Pill (instant touch drag) */}
                          {pages.length > 1 && (
                            <span
                              onPointerDown={handleCardSurfacePointerDown(page, true)}
                              title="Drag to reorder"
                              className="absolute top-2 left-1/2 -translate-x-1/2 bg-white/90 border border-zinc-200 px-1.5 py-0.5 text-zinc-500 hover:text-zinc-900 hover:border-zinc-900 opacity-75 sm:opacity-0 group-hover:opacity-100 transition-opacity touch-none cursor-grab active:cursor-grabbing"
                            >
                              <GripHorizontal size={12} />
                            </span>
                          )}

                          {/* Top-Right Filter Code Badge */}
                          <span className="absolute top-2 right-2 bg-white/95 border border-zinc-200 text-zinc-700 px-1.5 py-0.5 font-mono text-[9px] font-bold tracking-wider">
                            {filterCode(page.filter)}
                          </span>
                        </div>

                        {/* Page Quick Action Bar */}
                        <div className="relative z-10 border-t border-zinc-200 bg-white grid grid-cols-5 divide-x divide-zinc-100">
                          <button
                            type="button"
                            disabled={index === 0 || Boolean(busyLabel) || isFilteringAll}
                            onClick={() => {
                              captureVisualSnapshot();
                              onMovePage(page.id, -1);
                            }}
                            aria-label={`Move page ${index + 1} earlier`}
                            title="Move earlier"
                            className="h-10 flex items-center justify-center text-zinc-600 hover:bg-zinc-900 hover:text-white disabled:opacity-25 transition-colors cursor-pointer"
                          >
                            <ChevronLeft size={15} />
                          </button>
                          <button
                            type="button"
                            disabled={
                              index === pages.length - 1 || Boolean(busyLabel) || isFilteringAll
                            }
                            onClick={() => {
                              captureVisualSnapshot();
                              onMovePage(page.id, 1);
                            }}
                            aria-label={`Move page ${index + 1} later`}
                            title="Move later"
                            className="h-10 flex items-center justify-center text-zinc-600 hover:bg-zinc-900 hover:text-white disabled:opacity-25 transition-colors cursor-pointer"
                          >
                            <ChevronRight size={15} />
                          </button>
                          <button
                            type="button"
                            disabled={Boolean(busyLabel) || isFilteringAll}
                            onClick={() => onEditCrop(page)}
                            aria-label={`Trim corners on page ${index + 1}`}
                            title="Trim corners"
                            className="h-10 flex items-center justify-center text-zinc-600 hover:bg-zinc-900 hover:text-white disabled:opacity-25 transition-colors cursor-pointer"
                          >
                            <Crop size={14} />
                          </button>
                          <button
                            type="button"
                            disabled={Boolean(busyLabel) || isFilteringAll || isRotating}
                            onClick={() => onRotatePage(page.id)}
                            aria-label={`Rotate page ${index + 1}`}
                            title="Rotate 90°"
                            className={`h-10 flex items-center justify-center transition-colors cursor-pointer ${
                              isRotating
                                ? 'bg-zinc-900 text-white disabled:opacity-100'
                                : 'text-zinc-600 hover:bg-zinc-900 hover:text-white disabled:opacity-25'
                            }`}
                          >
                            <RotateCw
                              size={14}
                              className={isRotating ? 'animate-rotate-beat' : ''}
                            />
                          </button>
                          <button
                            type="button"
                            disabled={Boolean(busyLabel) || isFilteringAll}
                            onClick={() => onDeletePage(page.id)}
                            aria-label={`Delete page ${index + 1}`}
                            title="Delete page"
                            className="h-10 flex items-center justify-center text-zinc-500 hover:bg-red-600 hover:text-white disabled:opacity-25 transition-colors cursor-pointer"
                          >
                            <Trash2 size={14} />
                          </button>
                        </div>
                      </>
                    )}
                  </article>
                );
              })}

              {/* Add Page Tile */}
              <button
                type="button"
                onClick={onTriggerGallery}
                className="group relative overflow-hidden aspect-[3/4] border-2 border-dashed border-zinc-300 bg-white/60 hover:bg-white hover:border-zinc-900 transition-all flex flex-col items-center justify-center gap-2 text-zinc-400 hover:text-zinc-900 cursor-pointer min-h-[210px]"
              >
                <div className="pointer-events-none absolute inset-0 bayer-dither-bottom opacity-0 group-hover:opacity-70 transition-opacity" />
                <Plus size={26} className="relative z-10" />
                <span className="relative z-10 font-mono text-[10px] font-bold uppercase tracking-widest">
                  Add Page
                </span>
                <span className="relative z-10 font-mono text-[9px] text-zinc-400">
                  Import or Drop
                </span>
              </button>
            </div>

            {/* Desktop Bottom Export Bar (only visible once pages are added) */}
            <div className="hidden md:flex mt-8 pt-6 border-t border-zinc-200 items-center justify-between gap-4">
              <div className="font-mono text-xs text-zinc-500">
                <span className="font-bold text-zinc-900">
                  {String(pages.length).padStart(2, '0')} {pages.length === 1 ? 'PAGE' : 'PAGES'}
                </span>{' '}
                · {(documentTitle.trim() || 'UNTITLED_SCAN')}.pdf
              </div>
              <div className="w-64 shrink-0">
                <CornerTickButton onClick={onExportPdf} className="h-12">
                  <FileDown size={15} />
                  Export PDF ({pages.length})
                </CornerTickButton>
              </div>
            </div>
          </>
        )}
      </div>

      {/* Floating Card Preview During Drag-and-Drop */}
      {activeDrag && draggedPage && (
        <div
          aria-hidden="true"
          style={{
            position: 'fixed',
            left: activeDrag.clientX - activeDrag.grabOffsetX,
            top: activeDrag.clientY - activeDrag.grabOffsetY,
            width: activeDrag.width,
            height: activeDrag.height,
            zIndex: 60,
          }}
          className="pointer-events-none bg-white border-2 border-zinc-900 shadow-[14px_14px_0px_0px_rgba(24,24,27,0.28)] scale-[1.04] -rotate-1 flex flex-col"
        >
          <div className="relative aspect-[3/4] w-full bg-[#f0f0f2] p-3 flex items-center justify-center overflow-hidden">
            {thumbUrls[draggedPage.id] && (
              <img
                src={thumbUrls[draggedPage.id]}
                alt=""
                className="max-h-full max-w-full object-contain bg-white shadow-md border border-zinc-200/80"
              />
            )}
            <span className="absolute top-2 left-2 bg-zinc-900 text-white px-2 py-0.5 font-mono text-[10px] font-bold tracking-wider">
              {String(draggedIndex + 1).padStart(2, '0')}
            </span>
            <span className="absolute top-2 right-2 bg-white/95 border border-zinc-200 text-zinc-700 px-1.5 py-0.5 font-mono text-[9px] font-bold tracking-wider">
              {filterCode(draggedPage.filter)}
            </span>
          </div>
          <div className="h-10 border-t border-zinc-200 bg-zinc-50 flex items-center justify-center font-mono text-[9px] font-bold uppercase tracking-widest text-zinc-600">
            MOVING_PAGE
          </div>
        </div>
      )}

      {/* Mobile Sticky Bottom Action Dock */}
      {pages.length > 0 && (
        <div className="md:hidden fixed bottom-0 inset-x-0 z-30 border-t border-zinc-200 bg-white/95 backdrop-blur-lg px-3 pt-2.5 pb-safe">
          <div className="grid grid-cols-3 gap-2">
            <button
              type="button"
              onClick={onOpenCamera}
              className="h-11 border border-zinc-200 bg-white text-zinc-900 active:bg-zinc-100 flex flex-col items-center justify-center gap-0.5 cursor-pointer"
            >
              <Camera size={16} />
              <span className="font-mono text-[9px] font-bold uppercase">Camera</span>
            </button>
            <button
              type="button"
              onClick={onTriggerGallery}
              className="h-11 border border-zinc-200 bg-white text-zinc-900 active:bg-zinc-100 flex flex-col items-center justify-center gap-0.5 cursor-pointer"
            >
              <ImagePlus size={16} />
              <span className="font-mono text-[9px] font-bold uppercase">Import</span>
            </button>
            <button
              type="button"
              onClick={onExportPdf}
              className="h-11 bg-zinc-900 text-white active:bg-black flex flex-col items-center justify-center gap-0.5 cursor-pointer"
            >
              <FileDown size={16} className="text-white" />
              <span className="font-mono text-[9px] font-bold uppercase">
                Export PDF ({pages.length})
              </span>
            </button>
          </div>
        </div>
      )}
    </main>
  );
}
