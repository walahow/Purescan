import { useState, useRef, useEffect } from 'react';
import {
  ArrowUpRight,
  Download,
  FileArchive,
  FileDown,
  Info,
  ScanLine,
  ShieldCheck,
  WifiOff,
  X,
} from 'lucide-react';

export type AppMode = 'scanner' | 'compress';

interface TopNavbarProps {
  appMode: AppMode;
  onChangeMode: (mode: AppMode) => void;
  pageCount: number;
  isOffline: boolean;
  canInstall: boolean;
  onInstallApp: () => void;
  onLoadSamplePage: () => void;
  onExportPdf: () => void;
}

export function TopNavbar({
  appMode,
  onChangeMode,
  pageCount,
  isOffline,
  canInstall,
  onInstallApp,
  onLoadSamplePage,
  onExportPdf,
}: TopNavbarProps) {
  const [infoOpen, setInfoOpen] = useState(false);
  const popoverRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!infoOpen) return;
    const onOutside = (e: MouseEvent) => {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) {
        setInfoOpen(false);
      }
    };
    document.addEventListener('mousedown', onOutside);
    return () => document.removeEventListener('mousedown', onOutside);
  }, [infoOpen]);

  return (
    <nav className="sticky top-0 z-40 w-full border-b border-zinc-200/80 bg-white/85 backdrop-blur-xl pt-safe">
      <div className="mx-auto flex h-14 max-w-7xl items-center justify-between px-3 sm:px-4 md:px-6 gap-2 sm:gap-3">
        {/* Left: Brand Identity (HYDE typography) */}
        <div className="flex items-baseline gap-1.5 min-w-0">
          <span className="text-lg md:text-xl font-extrabold tracking-tight text-zinc-900">
            PURESCAN
          </span>
          <span className="hidden sm:inline text-[10px] font-mono font-light text-zinc-400 tracking-tight whitespace-nowrap">
            DOC.LOCAL
          </span>
        </div>

        {/* Center: Mode Switcher + Client-Side Status Pill */}
        <div className="hidden sm:flex items-center gap-2.5">
          <div className="inline-flex border border-zinc-300 bg-white" role="tablist" aria-label="PureScan tool mode">
            <button
              type="button"
              role="tab"
              aria-selected={appMode === 'scanner'}
              onClick={() => onChangeMode('scanner')}
              className={`h-8 px-3 font-mono text-[10px] font-bold uppercase tracking-wider flex items-center gap-1.5 transition-colors cursor-pointer ${
                appMode === 'scanner'
                  ? 'bg-zinc-900 text-white'
                  : 'text-zinc-600 hover:bg-zinc-50 hover:text-zinc-900'
              }`}
            >
              <ScanLine size={12} />
              Scanner
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={appMode === 'compress'}
              onClick={() => onChangeMode('compress')}
              className={`h-8 px-3 border-l border-zinc-300 font-mono text-[10px] font-bold uppercase tracking-wider flex items-center gap-1.5 transition-colors cursor-pointer ${
                appMode === 'compress'
                  ? 'bg-zinc-900 text-white'
                  : 'text-zinc-600 hover:bg-zinc-50 hover:text-zinc-900'
              }`}
            >
              <FileArchive size={12} />
              Compress PDF
            </button>
          </div>

          <span className="hidden lg:inline-flex items-center gap-1.5 rounded-none border border-emerald-200 bg-emerald-50 px-2.5 py-1 font-mono text-[10px] font-bold uppercase tracking-wider text-emerald-700">
            <span className="h-1.5 w-1.5 bg-emerald-500" />
            100% ON-DEVICE
          </span>
          {isOffline && (
            <span className="hidden md:inline-flex items-center gap-1.5 rounded-none border border-amber-300 bg-amber-50 px-2.5 py-1 font-mono text-[10px] font-bold uppercase tracking-wider text-amber-700">
              <WifiOff size={11} />
              OFFLINE
            </span>
          )}
        </div>

        {/* Right: Actions */}
        <div className="flex items-center gap-2">
          {isOffline && (
            <span
              className="md:hidden inline-flex items-center gap-1 border border-amber-300 bg-amber-50 px-2 h-9 font-mono text-[9px] font-bold text-amber-700"
              title="Working offline"
            >
              <WifiOff size={12} />
            </span>
          )}

          {canInstall && (
            <button
              type="button"
              onClick={onInstallApp}
              className="hidden sm:inline-flex items-center gap-1.5 rounded-none border border-zinc-200 bg-white px-3 h-9 font-mono text-[10px] font-bold uppercase tracking-wider text-zinc-700 hover:bg-zinc-900 hover:text-white hover:border-zinc-900 transition-colors cursor-pointer"
            >
              <Download size={13} />
              Install App
            </button>
          )}

          {/* Privacy / Info Popover */}
          <div className="relative" ref={popoverRef}>
            <button
              type="button"
              onClick={() => setInfoOpen((v) => !v)}
              aria-label="How PureScan works"
              aria-expanded={infoOpen}
              className={`flex items-center justify-center h-9 w-9 rounded-none border transition-colors cursor-pointer ${
                infoOpen
                  ? 'bg-zinc-900 text-white border-zinc-900'
                  : 'bg-white text-zinc-600 border-zinc-200 hover:bg-zinc-900 hover:text-white hover:border-zinc-900'
              }`}
            >
              {infoOpen ? <X size={15} /> : <Info size={15} />}
            </button>

            {infoOpen && (
              <div className="absolute right-0 mt-2 w-72 sm:w-80 rounded-none border border-zinc-200 bg-white p-4 shadow-[8px_8px_0px_0px_rgba(228,228,231,1)] z-50">
                <div className="absolute top-0 left-0 w-full h-1 bg-zinc-900" />
                <div className="flex items-center gap-2 mb-2.5 pt-1">
                  <ShieldCheck size={16} className="text-emerald-600 shrink-0" />
                  <p className="font-mono text-[10px] font-bold uppercase tracking-[0.2em] text-zinc-900">
                    // PRIVATE_LOCAL_SCANNER
                  </p>
                </div>
                <p className="text-xs text-zinc-600 leading-relaxed mb-3">
                  Every photo, crop, shadow-removal filter, and PDF conversion runs directly inside
                  your browser. Nothing is ever uploaded to any server — safe for ID cards, forms,
                  and personal documents.
                </p>
                <div className="space-y-1.5 border-t border-zinc-100 pt-2.5 font-mono text-[10px] text-zinc-500">
                  <div className="flex justify-between">
                    <span>SERVER_UPLOAD</span>
                    <span className="font-bold text-emerald-700">NONE (0 KB)</span>
                  </div>
                  <div className="flex justify-between">
                    <span>LOCAL_STORAGE</span>
                    <span className="font-bold text-zinc-800">INDEXEDDB</span>
                  </div>
                  <div className="flex justify-between">
                    <span>OFFLINE_SUPPORT</span>
                    <span className="font-bold text-zinc-800">PWA READY</span>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setInfoOpen(false);
                    onLoadSamplePage();
                  }}
                  className="mt-3 w-full h-9 rounded-none border border-zinc-200 bg-zinc-50 text-zinc-800 font-mono text-[10px] font-bold uppercase tracking-wider flex items-center justify-center gap-1.5 hover:bg-zinc-900 hover:text-white hover:border-zinc-900 transition-colors cursor-pointer"
                >
                  Load Sample Shadowed Page
                </button>
                {canInstall && (
                  <button
                    type="button"
                    onClick={() => {
                      setInfoOpen(false);
                      onInstallApp();
                    }}
                    className="mt-3 w-full h-9 rounded-none bg-zinc-900 text-white font-mono text-[10px] font-bold uppercase tracking-widest flex items-center justify-center gap-1.5 hover:bg-zinc-800 cursor-pointer"
                  >
                    <Download size={13} />
                    Install to Home Screen
                  </button>
                )}
              </div>
            )}
          </div>

          {/* Primary Export CTA (Scanner Mode) */}
          {appMode === 'scanner' && (
            <button
              type="button"
              onClick={onExportPdf}
              disabled={pageCount === 0}
              className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-none h-9 px-2.5 sm:px-3.5 md:px-4 font-mono text-[10px] sm:text-[11px] font-bold uppercase tracking-wider bg-zinc-900 text-white border border-zinc-900 hover:bg-zinc-800 active:bg-black transition-colors disabled:opacity-35 disabled:cursor-not-allowed cursor-pointer shrink-0"
            >
              <FileDown size={14} className="shrink-0" />
              <span className="whitespace-nowrap">Export PDF</span>
              {pageCount > 0 && (
                <span className="ml-0.5 px-1.5 py-0.5 bg-white/15 text-[10px]">{pageCount}</span>
              )}
              <ArrowUpRight size={12} className="hidden sm:inline opacity-70" />
            </button>
          )}
        </div>
      </div>

      {/* Mobile Compact Mode Switch Strip */}
      <div className="sm:hidden border-t border-zinc-200/80 grid grid-cols-2 bg-white" role="tablist" aria-label="PureScan tool mode">
        <button
          type="button"
          role="tab"
          aria-selected={appMode === 'scanner'}
          onClick={() => onChangeMode('scanner')}
          className={`h-9 font-mono text-[10px] font-bold uppercase tracking-wider flex items-center justify-center gap-1.5 transition-colors cursor-pointer ${
            appMode === 'scanner'
              ? 'bg-zinc-900 text-white'
              : 'text-zinc-600 hover:bg-zinc-50'
          }`}
        >
          <ScanLine size={12} />
          Scanner {pageCount > 0 ? `(${pageCount})` : ''}
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={appMode === 'compress'}
          onClick={() => onChangeMode('compress')}
          className={`h-9 border-l border-zinc-200 font-mono text-[10px] font-bold uppercase tracking-wider flex items-center justify-center gap-1.5 transition-colors cursor-pointer ${
            appMode === 'compress'
              ? 'bg-zinc-900 text-white'
              : 'text-zinc-600 hover:bg-zinc-50'
          }`}
        >
          <FileArchive size={12} />
          Compress PDF
        </button>
      </div>
    </nav>
  );
}
