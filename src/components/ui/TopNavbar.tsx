import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import {
  Download,
  FileArchive,
  ScanLine,
  ShieldCheck,
  WifiOff,
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
}

function HydeDiamondNodeIcon({ open, beatTick }: { open: boolean; beatTick: number }) {
  return (
    <span className="relative inline-flex items-center justify-center">
      {/* Stationary base diamond node icon */}
      <svg
        width="22"
        height="22"
        viewBox="0 0 24 24"
        fill="none"
        aria-hidden="true"
      >
        {/* Horizontal axis ticks */}
        <line
          x1="1"
          y1="12"
          x2="5.5"
          y2="12"
          stroke="currentColor"
          strokeWidth="1.35"
          strokeOpacity="0.55"
        />
        <line
          x1="18.5"
          y1="12"
          x2="23"
          y2="12"
          stroke="currentColor"
          strokeWidth="1.35"
          strokeOpacity="0.55"
        />
        {/* Subtle stepped outer diamond halo */}
        <polygon
          points="12,3 21,12 12,21 3,12"
          fill="currentColor"
          fillOpacity={open ? '0.24' : '0.12'}
        />
        {/* Crisp hollow diamond border */}
        <polygon
          points="12,5.2 18.8,12 12,18.8 5.2,12"
          stroke="currentColor"
          strokeWidth="1.75"
          fill="none"
        />
        {/* Center reticle dot */}
        <polygon
          points="12,10.5 13.5,12 12,13.5 10.5,12"
          fill="currentColor"
        />
      </svg>

      {/* Exploding overlay diamond outline on click */}
      {beatTick > 0 && (
        <svg
          key={beatTick}
          width="22"
          height="22"
          viewBox="0 0 24 24"
          fill="none"
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 animate-diamond-explode"
        >
          <polygon
            points="12,5.2 18.8,12 12,18.8 5.2,12"
            stroke="currentColor"
            strokeWidth="1.75"
            fill="none"
          />
        </svg>
      )}
    </span>
  );
}

export function TopNavbar({
  appMode,
  onChangeMode,
  pageCount,
  isOffline,
  canInstall,
  onInstallApp,
  onLoadSamplePage,
}: TopNavbarProps) {
  const [infoOpen, setInfoOpen] = useState(false);
  const [beatTick, setBeatTick] = useState(0);
  const [shiftX, setShiftX] = useState(0);
  const popoverWrapperRef = useRef<HTMLDivElement>(null);
  const popoverPanelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!infoOpen) return;
    const onOutside = (e: MouseEvent) => {
      if (popoverWrapperRef.current && !popoverWrapperRef.current.contains(e.target as Node)) {
        setInfoOpen(false);
      }
    };
    const onEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setInfoOpen(false);
    };
    document.addEventListener('mousedown', onOutside);
    window.addEventListener('keydown', onEscape);
    return () => {
      document.removeEventListener('mousedown', onOutside);
      window.removeEventListener('keydown', onEscape);
    };
  }, [infoOpen]);

  useLayoutEffect(() => {
    if (!infoOpen) {
      setShiftX(0);
      return;
    }

    const updatePosition = () => {
      const trigger = popoverWrapperRef.current;
      const panel = popoverPanelRef.current;
      if (!trigger || !panel) return;
      const triggerRect = trigger.getBoundingClientRect();
      const panelWidth = panel.offsetWidth;
      const center = triggerRect.left + triggerRect.width / 2;
      const margin = 12;
      const rawLeft = center - panelWidth / 2;
      const rawRight = center + panelWidth / 2;

      let nextShift = 0;
      if (rawRight > window.innerWidth - margin) {
        nextShift = window.innerWidth - margin - rawRight;
      } else if (rawLeft < margin) {
        nextShift = margin - rawLeft;
      }
      setShiftX(Math.round(nextShift));
    };

    updatePosition();
    window.addEventListener('resize', updatePosition);
    return () => window.removeEventListener('resize', updatePosition);
  }, [infoOpen]);

  return (
    <nav className="sticky top-0 z-40 w-full border-b border-zinc-200/80 bg-white/85 backdrop-blur-xl pt-safe">
      <div className="mx-auto flex md:grid md:grid-cols-3 h-14 max-w-5xl items-center justify-between px-4 md:px-6 gap-3">
        {/* Left: Brand Identity */}
        <div className="flex items-baseline gap-1.5 min-w-0">
          <span className="text-lg md:text-xl font-extrabold tracking-tight text-zinc-900">
            PURESCAN
          </span>
          <span className="hidden sm:inline text-[10px] font-mono font-light text-zinc-400 tracking-tight whitespace-nowrap">
            DOC.STUDIO
          </span>
        </div>

        {/* Center: Mode Switcher */}
        <div className="hidden sm:flex items-center justify-center">
          <div
            className="inline-flex border border-zinc-300 bg-white"
            role="tablist"
            aria-label="PureScan tool mode"
          >
            <button
              type="button"
              role="tab"
              aria-selected={appMode === 'scanner'}
              onClick={() => onChangeMode('scanner')}
              className={`h-8 px-3.5 font-mono text-[10px] font-bold uppercase tracking-wider flex items-center gap-1.5 transition-colors cursor-pointer ${
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
              className={`h-8 px-3.5 border-l border-zinc-300 font-mono text-[10px] font-bold uppercase tracking-wider flex items-center gap-1.5 transition-colors cursor-pointer ${
                appMode === 'compress'
                  ? 'bg-zinc-900 text-white'
                  : 'text-zinc-600 hover:bg-zinc-50 hover:text-zinc-900'
              }`}
            >
              <FileArchive size={12} />
              Compress PDF
            </button>
          </div>
        </div>

        {/* Right: Actions */}
        <div className="flex items-center justify-end gap-2">
          {isOffline && (
            <span
              className="inline-flex items-center gap-1.5 rounded-none border border-zinc-300 bg-zinc-100 px-2.5 h-9 font-mono text-[9px] font-bold uppercase tracking-wider text-zinc-800"
              title="Working offline"
            >
              <WifiOff size={12} />
              <span className="hidden md:inline">OFFLINE</span>
            </span>
          )}

          {/* Privacy / Info Node Popover */}
          <div className="relative" ref={popoverWrapperRef}>
            <button
              type="button"
              onClick={() => {
                setInfoOpen((v) => !v);
                setBeatTick((t) => t + 1);
              }}
              aria-label="How PureScan works"
              aria-expanded={infoOpen}
              className={`flex items-center justify-center h-9 w-9 rounded-none border transition-colors cursor-pointer ${
                infoOpen
                  ? 'bg-zinc-900 text-white border-zinc-900'
                  : 'bg-white text-zinc-800 border-zinc-200 hover:bg-zinc-900 hover:text-white hover:border-zinc-900'
              }`}
            >
              <HydeDiamondNodeIcon open={infoOpen} beatTick={beatTick} />
            </button>

            {infoOpen && (
              <div
                ref={popoverPanelRef}
                style={{ transform: `translateX(calc(-50% + ${shiftX}px))` }}
                className="absolute left-1/2 top-full mt-2.5 w-64 rounded-none border border-zinc-300 bg-white p-4 shadow-[8px_8px_0px_0px_rgba(24,24,27,0.16)] z-50"
              >
                {/* Connector diamond locked directly beneath the button center */}
                <span
                  aria-hidden="true"
                  style={{ left: `calc(50% - ${shiftX}px)` }}
                  className="pointer-events-none absolute -top-1.5 -translate-x-1/2 h-2.5 w-2.5 rotate-45 bg-zinc-900 border-t border-l border-zinc-900"
                />
                <div className="absolute top-0 left-0 w-full h-1 bg-zinc-900" />
                <div className="flex items-center gap-2 mb-2.5 pt-1">
                  <ShieldCheck size={15} className="text-zinc-900 shrink-0" />
                  <p className="font-mono text-[10px] font-bold uppercase tracking-[0.2em] text-zinc-900">
                    // ON_DEVICE_STUDIO
                  </p>
                </div>
                <p className="text-xs text-zinc-600 leading-relaxed mb-3.5">
                  All cropping, shadow removal, and PDF building run directly in your browser with
                  zero server uploads.
                </p>
                <div className="space-y-1.5 border-t border-zinc-100 pt-2.5 font-mono text-[10px] text-zinc-500">
                  <div className="flex justify-between">
                    <span>SERVER_UPLOAD</span>
                    <span className="font-bold text-zinc-900">NONE (0 KB)</span>
                  </div>
                  <div className="flex justify-between">
                    <span>STORAGE</span>
                    <span className="font-bold text-zinc-900">INDEXEDDB</span>
                  </div>
                  <div className="flex justify-between">
                    <span>OFFLINE</span>
                    <span className="font-bold text-zinc-900">PWA READY</span>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setInfoOpen(false);
                    onLoadSamplePage();
                  }}
                  className="mt-3.5 w-full h-9 rounded-none border border-zinc-200 bg-zinc-50 text-zinc-900 font-mono text-[10px] font-bold uppercase tracking-wider flex items-center justify-center gap-1.5 hover:bg-zinc-900 hover:text-white hover:border-zinc-900 transition-colors cursor-pointer"
                >
                  Load Sample Page
                </button>
                {canInstall && (
                  <button
                    type="button"
                    onClick={() => {
                      setInfoOpen(false);
                      onInstallApp();
                    }}
                    className="mt-2.5 w-full h-9 rounded-none bg-zinc-900 text-white font-mono text-[10px] font-bold uppercase tracking-widest flex items-center justify-center gap-1.5 hover:bg-zinc-800 cursor-pointer"
                  >
                    <Download size={13} />
                    Install App
                  </button>
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Mobile Compact Mode Switch Strip */}
      <div
        className="sm:hidden border-t border-zinc-200/80 grid grid-cols-2 bg-white"
        role="tablist"
        aria-label="PureScan tool mode"
      >
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
