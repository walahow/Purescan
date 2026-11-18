import React, { useRef, useState } from 'react';
import {
  Camera,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Crop,
  FileDown,
  FileText,
  ImagePlus,
  Loader2,
  Plus,
  RotateCw,
  ShieldCheck,
  Smartphone,
  Sparkles,
  Trash2,
  Upload,
  Wand2,
} from 'lucide-react';
import { FILTER_PRESETS, type FilterPreset, type ScanPage } from '../types/scan';
import { DraftingFrame } from './ui/DraftingFrame';

interface WorkspaceViewProps {
  pages: ScanPage[];
  thumbUrls: Record<string, string>;
  documentTitle: string;
  loading: boolean;
  busyLabel: string | null;
  storageWarning: boolean;
  onRenameDocument: (title: string) => void;
  onOpenCamera: () => void;
  onTriggerNativeCamera: () => void;
  onTriggerGallery: () => void;
  onLoadSamplePage: () => void;
  onDropFiles: (files: File[]) => void;
  onEditFilter: (page: ScanPage) => void;
  onEditCrop: (page: ScanPage) => void;
  onRotatePage: (id: string) => void;
  onMovePage: (id: string, dir: -1 | 1) => void;
  onDeletePage: (id: string) => void;
  onApplyFilterAll: (filter: FilterPreset) => void;
  onRequestClearAll: () => void;
  onExportPdf: () => void;
}

export function WorkspaceView({
  pages,
  thumbUrls,
  documentTitle,
  loading,
  busyLabel,
  storageWarning,
  onRenameDocument,
  onOpenCamera,
  onTriggerNativeCamera,
  onTriggerGallery,
  onLoadSamplePage,
  onDropFiles,
  onEditFilter,
  onEditCrop,
  onRotatePage,
  onMovePage,
  onDeletePage,
  onApplyFilterAll,
  onRequestClearAll,
  onExportPdf,
}: WorkspaceViewProps) {
  const [isDraggingOver, setIsDraggingOver] = useState(false);
  const [batchFilterOpen, setBatchFilterOpen] = useState(false);
  const dragDepthRef = useRef(0);

  const handleDragEnter = (e: React.DragEvent) => {
    e.preventDefault();
    dragDepthRef.current++;
    setIsDraggingOver(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);
    if (dragDepthRef.current === 0) setIsDraggingOver(false);
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    dragDepthRef.current = 0;
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

  return (
    <main
      onDragEnter={handleDragEnter}
      onDragLeave={handleDragLeave}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
      className="relative z-10 flex-1 w-full pb-24 md:pb-6"
    >
      {/* Full-window drag-and-drop highlight */}
      {isDraggingOver && (
        <div className="fixed inset-4 z-50 border-2 border-dashed border-zinc-900 bg-white/90 backdrop-blur-xs flex flex-col items-center justify-center pointer-events-none">
          <Upload size={40} className="text-zinc-900 mb-3" />
          <p className="font-mono text-xs font-bold uppercase tracking-[0.25em] text-zinc-900">
            [ RELEASE_TO_SCAN_PHOTOS_OR_COMPRESS_PDF ]
          </p>
        </div>
      )}

      <div className="mx-auto w-full max-w-6xl px-4 md:px-6 pt-5 md:pt-7">
        {/* Private-mode fallback notice */}
        {storageWarning && (
          <div className="mb-4 border border-amber-300 bg-amber-50 px-3.5 py-2.5 font-mono text-[11px] text-amber-800 flex items-center gap-2">
            <span>⚠</span>
            <span>
              Browser blocked IndexedDB storage (private mode). Your pages work normally, but export
              your PDF before closing this tab.
            </span>
          </div>
        )}

        {/* HYDE-Style Document Title Input with Extended Crop Lines */}
        <DraftingFrame className="mb-5">
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
        <div className="flex items-center gap-3 mb-5">
          <div className="h-px flex-1 bg-zinc-200" />
          <span className="text-[10px] md:text-xs font-mono font-medium text-zinc-400 uppercase tracking-widest text-center px-2">
            {loading
              ? 'LOADING_WORKSPACE...'
              : pages.length === 0
                ? 'READY_TO_SCAN · 0 PAGES'
                : `${String(pages.length).padStart(2, '0')} ${
                    pages.length === 1 ? 'PAGE' : 'PAGES'
                  } READY FOR PDF`}
          </span>
          <div className="h-px flex-1 bg-zinc-200" />
        </div>

        {/* Busy Processing Banner */}
        {busyLabel && (
          <div className="mb-5 flex items-center justify-center gap-2.5 border border-zinc-900 bg-zinc-900 text-white px-4 py-2.5 font-mono text-[11px] uppercase tracking-widest">
            <Loader2 size={14} className="animate-spin text-[#8ee069]" />
            <span>{busyLabel}</span>
          </div>
        )}

        {/* EMPTY STATE */}
        {!loading && pages.length === 0 ? (
          <div className="mx-auto max-w-2xl">
            <div className="relative bg-white border border-zinc-200 shadow-[10px_10px_0px_0px_rgba(228,228,231,1)] overflow-hidden">
              {/* HYDE Brutalist Top Bar & Corner Ticks */}
              <div className="h-1 w-full bg-zinc-900" />
              <div className="absolute top-1 left-4 w-px h-5 bg-zinc-900" />
              <div className="absolute top-1 right-4 w-px h-5 bg-zinc-900" />

              <div className="p-5 sm:p-6 md:p-7">
                <div className="flex flex-col items-center text-center mb-5">
                  <div className="h-11 w-11 border border-zinc-200 bg-zinc-50 flex items-center justify-center mb-2.5">
                    <FileText size={20} className="text-zinc-900" />
                  </div>
                  <p className="font-mono text-[10px] font-bold uppercase tracking-[0.28em] text-zinc-400 mb-1">
                    // ZERO_ADS · CLIENT_SIDE_SCANNER
                  </p>
                  <h1 className="text-xl sm:text-2xl font-extrabold tracking-tight text-zinc-900 mb-1">
                    Scan documents cleanly, privately.
                  </h1>
                  <p className="text-xs sm:text-sm text-zinc-500 max-w-md leading-relaxed">
                    Capture pages, trim perspective corners, remove harsh shadows with Pure Filter,
                    and export crisp multi-page PDFs on your device.
                  </p>
                </div>

                {/* Primary Capture Actions */}
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5 mb-4">
                  <button
                    type="button"
                    onClick={onOpenCamera}
                    className="group h-22 border border-zinc-900 bg-zinc-900 text-white hover:bg-zinc-800 active:bg-black transition-all flex flex-col items-center justify-center gap-1 px-4 cursor-pointer"
                  >
                    <Camera size={20} className="text-[#8ee069]" />
                    <span className="font-mono text-[11px] font-bold uppercase tracking-wider">
                      Live Camera
                    </span>
                    <span className="font-mono text-[9px] text-zinc-400 uppercase">
                      Single or Batch
                    </span>
                  </button>

                  <button
                    type="button"
                    onClick={onTriggerNativeCamera}
                    className="group h-22 border border-zinc-200 bg-white text-zinc-900 hover:bg-zinc-900 hover:text-white hover:border-zinc-900 transition-all flex flex-col items-center justify-center gap-1 px-4 cursor-pointer"
                  >
                    <Smartphone size={20} className="text-zinc-700 group-hover:text-white" />
                    <span className="font-mono text-[11px] font-bold uppercase tracking-wider">
                      Native Camera
                    </span>
                    <span className="font-mono text-[9px] text-zinc-400 group-hover:text-zinc-300 uppercase">
                      Phone HDR Lens
                    </span>
                  </button>

                  <button
                    type="button"
                    onClick={onTriggerGallery}
                    className="group h-22 border border-zinc-200 bg-white text-zinc-900 hover:bg-zinc-900 hover:text-white hover:border-zinc-900 transition-all flex flex-col items-center justify-center gap-1 px-4 cursor-pointer"
                  >
                    <ImagePlus size={20} className="text-zinc-700 group-hover:text-white" />
                    <span className="font-mono text-[11px] font-bold uppercase tracking-wider">
                      Import Photos
                    </span>
                    <span className="font-mono text-[9px] text-zinc-400 group-hover:text-zinc-300 uppercase">
                      Multi-Select / Drop
                    </span>
                  </button>
                </div>

                {/* Desktop Drop Hint */}
                <div
                  onClick={onTriggerGallery}
                  className="hidden sm:flex border border-dashed border-zinc-300 bg-zinc-50/70 hover:border-zinc-500 hover:bg-zinc-50 py-2.5 px-4 items-center justify-center gap-2 cursor-pointer transition-colors"
                >
                  <Upload size={13} className="text-zinc-400" />
                  <span className="font-mono text-[10px] font-bold uppercase tracking-[0.2em] text-zinc-500">
                    [ OR DRAG & DROP DOCUMENT PHOTOS ANYWHERE ]
                  </span>
                </div>

                {/* Trust Highlights */}
                <div className="mt-4 pt-3.5 border-t border-zinc-100 grid grid-cols-3 gap-3 text-center">
                  <div>
                    <Sparkles size={14} className="mx-auto mb-0.5 text-[#2eb846]" />
                    <p className="font-mono text-[10px] font-bold uppercase text-zinc-800">
                      Pure Filter
                    </p>
                    <p className="text-[11px] text-zinc-400">Removes shadows</p>
                  </div>
                  <div>
                    <ShieldCheck size={14} className="mx-auto mb-0.5 text-zinc-800" />
                    <p className="font-mono text-[10px] font-bold uppercase text-zinc-800">
                      100% Local
                    </p>
                    <p className="text-[11px] text-zinc-400">Zero uploads</p>
                  </div>
                  <div>
                    <FileDown size={14} className="mx-auto mb-0.5 text-zinc-800" />
                    <p className="font-mono text-[10px] font-bold uppercase text-zinc-800">
                      Clean PDF
                    </p>
                    <p className="text-[11px] text-zinc-400">No watermarks</p>
                  </div>
                </div>

                {/* Instant Demo Trigger for First-Time Users */}
                <div className="mt-3.5 pt-3 border-t border-zinc-100 text-center">
                  <button
                    type="button"
                    onClick={onLoadSamplePage}
                    className="font-mono text-[10px] font-bold uppercase tracking-wider text-zinc-500 hover:text-zinc-900 underline decoration-zinc-300 underline-offset-4 transition-colors cursor-pointer"
                  >
                    No paper nearby? Try with a shadowed sample photo →
                  </button>
                </div>
              </div>
            </div>
          </div>
        ) : (
          /* POPULATED WORKSPACE */
          <>
            {/* Workspace Control Strip */}
            <div className="mb-5 flex flex-wrap items-center justify-between gap-2.5">
              {/* Desktop Add Buttons */}
              <div className="hidden md:flex items-center gap-2">
                <button
                  type="button"
                  onClick={onOpenCamera}
                  className="h-9 px-3.5 bg-zinc-900 text-white border border-zinc-900 hover:bg-zinc-800 font-mono text-[10px] font-bold uppercase tracking-wider flex items-center gap-1.5 cursor-pointer"
                >
                  <Camera size={13} className="text-[#8ee069]" />
                  Live Camera
                </button>
                <button
                  type="button"
                  onClick={onTriggerNativeCamera}
                  className="h-9 px-3 bg-white text-zinc-700 border border-zinc-200 hover:bg-zinc-900 hover:text-white hover:border-zinc-900 font-mono text-[10px] font-bold uppercase tracking-wider flex items-center gap-1.5 transition-colors cursor-pointer"
                >
                  <Smartphone size={13} />
                  Native Cam
                </button>
                <button
                  type="button"
                  onClick={onTriggerGallery}
                  className="h-9 px-3 bg-white text-zinc-700 border border-zinc-200 hover:bg-zinc-900 hover:text-white hover:border-zinc-900 font-mono text-[10px] font-bold uppercase tracking-wider flex items-center gap-1.5 transition-colors cursor-pointer"
                >
                  <ImagePlus size={13} />
                  Import Photos
                </button>
              </div>

              {/* Batch Filter + Clear Controls */}
              <div className="flex items-center gap-2 w-full md:w-auto justify-between md:justify-end">
                {/* Apply Filter to All Dropdown */}
                <div className="relative">
                  <button
                    type="button"
                    onClick={() => setBatchFilterOpen((v) => !v)}
                    disabled={Boolean(busyLabel)}
                    className="h-9 px-3 bg-white text-zinc-700 border border-zinc-200 hover:border-zinc-900 hover:text-zinc-900 font-mono text-[10px] font-bold uppercase tracking-wider flex items-center gap-1.5 transition-colors disabled:opacity-40 cursor-pointer"
                  >
                    <Wand2 size={13} />
                    Filter All Pages
                    <ChevronDown size={13} />
                  </button>

                  {batchFilterOpen && (
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
                  disabled={Boolean(busyLabel)}
                  className="h-9 px-3 bg-white text-red-600 border border-zinc-200 hover:bg-red-600 hover:text-white hover:border-red-600 font-mono text-[10px] font-bold uppercase tracking-wider flex items-center gap-1.5 transition-colors disabled:opacity-40 cursor-pointer"
                >
                  <Trash2 size={13} />
                  Clear All
                </button>
              </div>
            </div>

            {/* Responsive Page Thumbnail Grid */}
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4 md:gap-5">
              {pages.map((page, index) => (
                <article
                  key={page.id}
                  className="group relative bg-white border border-zinc-200 hover:border-zinc-900 shadow-xs hover:shadow-[6px_6px_0px_0px_rgba(228,228,231,1)] transition-all flex flex-col"
                >
                  {/* Subtle HYDE Bayer Dither Overlay on Hover */}
                  <div className="pointer-events-none absolute inset-0 bayer-dither opacity-0 group-hover:opacity-60 transition-opacity z-0" />

                  {/* Thumbnail Preview Surface (Click to edit filter/enhance) */}
                  <button
                    type="button"
                    onClick={() => onEditFilter(page)}
                    className="relative z-10 aspect-[3/4] w-full bg-[#f0f0f2] p-3 flex items-center justify-center overflow-hidden cursor-pointer"
                  >
                    {thumbUrls[page.id] ? (
                      <img
                        src={thumbUrls[page.id]}
                        alt={`Scanned page ${index + 1}`}
                        className="max-h-full max-w-full object-contain bg-white shadow-md border border-zinc-200/80 transition-transform duration-300 group-hover:scale-[1.02]"
                      />
                    ) : (
                      <Loader2 size={20} className="animate-spin text-zinc-400" />
                    )}

                    {/* Top-Left Page Number Badge */}
                    <span className="absolute top-2 left-2 bg-zinc-900 text-white px-2 py-0.5 font-mono text-[10px] font-bold tracking-wider">
                      {String(index + 1).padStart(2, '0')}
                    </span>

                    {/* Top-Right Filter Code Badge */}
                    <span className="absolute top-2 right-2 bg-white/95 border border-zinc-200 text-zinc-700 px-1.5 py-0.5 font-mono text-[9px] font-bold tracking-wider">
                      {filterCode(page.filter)}
                    </span>
                  </button>

                  {/* Page Quick Action Bar */}
                  <div className="relative z-10 border-t border-zinc-200 bg-white grid grid-cols-5 divide-x divide-zinc-100">
                    <button
                      type="button"
                      disabled={index === 0 || Boolean(busyLabel)}
                      onClick={() => onMovePage(page.id, -1)}
                      aria-label={`Move page ${index + 1} earlier`}
                      title="Move earlier"
                      className="h-10 flex items-center justify-center text-zinc-600 hover:bg-zinc-900 hover:text-white disabled:opacity-25 transition-colors cursor-pointer"
                    >
                      <ChevronLeft size={15} />
                    </button>
                    <button
                      type="button"
                      disabled={index === pages.length - 1 || Boolean(busyLabel)}
                      onClick={() => onMovePage(page.id, 1)}
                      aria-label={`Move page ${index + 1} later`}
                      title="Move later"
                      className="h-10 flex items-center justify-center text-zinc-600 hover:bg-zinc-900 hover:text-white disabled:opacity-25 transition-colors cursor-pointer"
                    >
                      <ChevronRight size={15} />
                    </button>
                    <button
                      type="button"
                      disabled={Boolean(busyLabel)}
                      onClick={() => onEditCrop(page)}
                      aria-label={`Trim corners on page ${index + 1}`}
                      title="Trim corners"
                      className="h-10 flex items-center justify-center text-zinc-600 hover:bg-zinc-900 hover:text-white disabled:opacity-25 transition-colors cursor-pointer"
                    >
                      <Crop size={14} />
                    </button>
                    <button
                      type="button"
                      disabled={Boolean(busyLabel)}
                      onClick={() => onRotatePage(page.id)}
                      aria-label={`Rotate page ${index + 1}`}
                      title="Rotate 90°"
                      className="h-10 flex items-center justify-center text-zinc-600 hover:bg-zinc-900 hover:text-white disabled:opacity-25 transition-colors cursor-pointer"
                    >
                      <RotateCw size={14} />
                    </button>
                    <button
                      type="button"
                      disabled={Boolean(busyLabel)}
                      onClick={() => onDeletePage(page.id)}
                      aria-label={`Delete page ${index + 1}`}
                      title="Delete page"
                      className="h-10 flex items-center justify-center text-zinc-500 hover:bg-red-600 hover:text-white disabled:opacity-25 transition-colors cursor-pointer"
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                </article>
              ))}

              {/* Add Page Tile */}
              <button
                type="button"
                onClick={onTriggerGallery}
                className="aspect-[3/4] border-2 border-dashed border-zinc-300 bg-white/60 hover:bg-white hover:border-zinc-900 transition-all flex flex-col items-center justify-center gap-2 text-zinc-400 hover:text-zinc-900 cursor-pointer min-h-[210px]"
              >
                <Plus size={26} />
                <span className="font-mono text-[10px] font-bold uppercase tracking-widest">
                  Add Page
                </span>
                <span className="font-mono text-[9px] text-zinc-400">Import or Drop</span>
              </button>
            </div>
          </>
        )}
      </div>

      {/* Mobile Sticky Bottom Action Dock */}
      {pages.length > 0 && (
        <div className="md:hidden fixed bottom-0 inset-x-0 z-30 border-t border-zinc-200 bg-white/95 backdrop-blur-lg px-3 pt-2.5 pb-safe">
          <div className="grid grid-cols-4 gap-2">
            <button
              type="button"
              onClick={onOpenCamera}
              className="h-11 border border-zinc-200 bg-white text-zinc-800 active:bg-zinc-100 flex flex-col items-center justify-center gap-0.5 cursor-pointer"
            >
              <Camera size={16} />
              <span className="font-mono text-[9px] font-bold uppercase">Camera</span>
            </button>
            <button
              type="button"
              onClick={onTriggerNativeCamera}
              className="h-11 border border-zinc-200 bg-white text-zinc-800 active:bg-zinc-100 flex flex-col items-center justify-center gap-0.5 cursor-pointer"
            >
              <Smartphone size={16} />
              <span className="font-mono text-[9px] font-bold uppercase">Native</span>
            </button>
            <button
              type="button"
              onClick={onTriggerGallery}
              className="h-11 border border-zinc-200 bg-white text-zinc-800 active:bg-zinc-100 flex flex-col items-center justify-center gap-0.5 cursor-pointer"
            >
              <ImagePlus size={16} />
              <span className="font-mono text-[9px] font-bold uppercase">Import</span>
            </button>
            <button
              type="button"
              onClick={onExportPdf}
              className="h-11 bg-zinc-900 text-white active:bg-black flex flex-col items-center justify-center gap-0.5 cursor-pointer"
            >
              <FileDown size={16} className="text-[#8ee069]" />
              <span className="font-mono text-[9px] font-bold uppercase">PDF ({pages.length})</span>
            </button>
          </div>
        </div>
      )}
    </main>
  );
}
