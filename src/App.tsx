import React, { useCallback, useEffect, useRef, useState } from 'react';
import { CameraView } from './components/CameraView';
import { CompressPdfView } from './components/CompressPdfView';
import { CropView } from './components/CropView';
import { ExportModal } from './components/ExportModal';
import { FilterView } from './components/FilterView';
import { WorkspaceView } from './components/WorkspaceView';
import { ConfirmDialog } from './components/ui/ConfirmDialog';
import { InteractiveGridBackground } from './components/ui/InteractiveGridBackground';
import { ToastBanner, type ToastMessage } from './components/ui/ToastBanner';
import { TopNavbar, type AppMode } from './components/ui/TopNavbar';
import { usePwaStatus } from './hooks/usePwaInstall';
import { useScanWorkspace, type PendingDraft } from './hooks/useScanWorkspace';
import { generateSampleShadowedDocument } from './imaging/sampleDoc';
import type { AspectMode, FilterPreset, Quad, Rotation, ScanPage } from './types/scan';

type ActiveScreen = 'workspace' | 'camera' | 'crop' | 'filter';

export default function App() {
  const {
    pages,
    meta,
    loading,
    busyLabel,
    storageWarning,
    thumbUrls,
    prepareSingleDraft,
    commitDraft,
    addBatchBlobs,
    deletePage,
    movePage,
    rotatePageQuick,
    applyFilterToAll,
    renameDocument,
    clearAllPages,
    pageToDraft,
  } = useScanWorkspace();

  const { canInstall, isOffline, promptInstall } = usePwaStatus();

  const [appMode, setAppMode] = useState<AppMode>('scanner');
  const [incomingPdf, setIncomingPdf] = useState<File | null>(null);
  const [screen, setScreen] = useState<ActiveScreen>('workspace');
  const [activeDraft, setActiveDraft] = useState<PendingDraft | null>(null);
  const [savingDraft, setSavingDraft] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [clearConfirmOpen, setClearConfirmOpen] = useState(false);
  const [toast, setToast] = useState<ToastMessage | null>(null);

  const nativeCamInputRef = useRef<HTMLInputElement>(null);
  const galleryInputRef = useRef<HTMLInputElement>(null);
  const toastTimerRef = useRef<number | null>(null);

  const notify = useCallback((kind: ToastMessage['kind'], text: string) => {
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    setToast({ id: Date.now(), kind, text });
    toastTimerRef.current = window.setTimeout(() => setToast(null), 4200);
  }, []);

  useEffect(() => {
    return () => {
      if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    };
  }, []);

  // Keyboard Escape handler for modals
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (clearConfirmOpen) setClearConfirmOpen(false);
      else if (exportOpen) setExportOpen(false);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [clearConfirmOpen, exportOpen]);

  const handleIncomingFiles = useCallback(
    async (files: File[]) => {
      const pdfFile = files.find(
        (f) => f.type === 'application/pdf' || f.name.toLowerCase().endsWith('.pdf')
      );
      if (pdfFile) {
        setIncomingPdf(pdfFile);
        setAppMode('compress');
        setScreen('workspace');
        notify('info', `Loaded ${pdfFile.name} in Compress PDF mode.`);
        return;
      }

      const imageFiles = files.filter((f) => !f.type || f.type.startsWith('image/'));
      if (imageFiles.length === 0) {
        notify('error', 'Please select valid image files (JPG, PNG, WebP) or a PDF to compress.');
        return;
      }

      setAppMode('scanner');

      try {
        if (imageFiles.length === 1) {
          const draft = await prepareSingleDraft(imageFiles[0]);
          setActiveDraft(draft);
          setScreen('crop');
        } else {
          const added = await addBatchBlobs(imageFiles, 'pure-color');
          notify(
            'success',
            `Added ${added} pages with Pure Color filter. Tap any page to trim corners or tune.`
          );
        }
      } catch (err) {
        notify('error', err instanceof Error ? err.message : 'Could not decode image file.');
      }
    },
    [addBatchBlobs, notify, prepareSingleDraft]
  );

  const handleNativeCamChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files ? Array.from(e.target.files) : [];
    e.target.value = '';
    if (files.length > 0) void handleIncomingFiles(files);
  };

  const handleGalleryChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files ? Array.from(e.target.files) : [];
    e.target.value = '';
    if (files.length > 0) void handleIncomingFiles(files);
  };

  const handleSingleCameraCapture = async (blob: Blob) => {
    try {
      const draft = await prepareSingleDraft(blob);
      setActiveDraft(draft);
      setScreen('crop');
    } catch (err) {
      setScreen('workspace');
      notify('error', err instanceof Error ? err.message : 'Failed to process captured photo.');
    }
  };

  const handleBatchCameraComplete = async (blobs: Blob[]) => {
    setScreen('workspace');
    if (blobs.length === 0) return;
    try {
      if (blobs.length === 1) {
        const draft = await prepareSingleDraft(blobs[0]);
        setActiveDraft(draft);
        setScreen('crop');
      } else {
        const added = await addBatchBlobs(blobs, 'pure-color');
        notify('success', `Captured ${added} pages with Pure Color. Tap any page to trim.`);
      }
    } catch (err) {
      notify('error', err instanceof Error ? err.message : 'Failed to process captured batch.');
    }
  };

  const handleCropConfirm = (result: { quad: Quad; aspectMode: AspectMode; rotation: Rotation }) => {
    if (!activeDraft) return;
    setActiveDraft({
      ...activeDraft,
      quad: result.quad,
      aspectMode: result.aspectMode,
      rotation: result.rotation,
    });
    setScreen('filter');
  };

  const handleFilterSave = async (updated: PendingDraft) => {
    setSavingDraft(true);
    try {
      const wasEdit = Boolean(updated.existingPageId);
      await commitDraft(updated);
      setActiveDraft(null);
      setScreen('workspace');
      notify('success', wasEdit ? 'Scan page updated.' : 'Page added to document.');
    } catch (err) {
      notify('error', err instanceof Error ? err.message : 'Failed to save scan page.');
    } finally {
      setSavingDraft(false);
    }
  };

  const handleEditPageFilter = (page: ScanPage) => {
    setActiveDraft(pageToDraft(page));
    setScreen('filter');
  };

  const handleEditPageCrop = (page: ScanPage) => {
    setActiveDraft(pageToDraft(page));
    setScreen('crop');
  };

  const handleApplyFilterAll = async (filter: FilterPreset) => {
    try {
      await applyFilterToAll(filter);
      notify('success', `Updated filter across all ${pages.length} pages.`);
    } catch (err) {
      notify('error', err instanceof Error ? err.message : 'Could not update all pages.');
    }
  };

  const handleInstallApp = async () => {
    const accepted = await promptInstall();
    if (accepted) {
      notify('success', 'PureScan installed — ready to use offline anytime!');
    }
  };

  const handleLoadSamplePage = async () => {
    try {
      const variant: 1 | 2 = pages.length % 2 === 0 ? 1 : 2;
      const blob = await generateSampleShadowedDocument(variant);
      const draft = await prepareSingleDraft(blob);
      // Pre-place corners cleanly inside the tilted paper frame for easy manual adjustment
      setActiveDraft(draft);
      setScreen('crop');
    } catch (err) {
      notify('error', err instanceof Error ? err.message : 'Failed to generate sample page.');
    }
  };

  return (
    <div className="relative min-h-screen w-full flex flex-col bg-[#f5f5f7] text-zinc-900 overflow-x-hidden">
      {/* Hidden native camera & gallery file inputs */}
      <input
        ref={nativeCamInputRef}
        type="file"
        accept="image/*"
        capture="environment"
        onChange={handleNativeCamChange}
        className="hidden"
      />
      <input
        ref={galleryInputRef}
        type="file"
        accept="image/*"
        multiple
        onChange={handleGalleryChange}
        className="hidden"
      />

      {/* Signature HYDE Interactive 40x40 Grid Background */}
      <InteractiveGridBackground />

      {/* Top Sticky Frosted Navbar */}
      <TopNavbar
        appMode={appMode}
        onChangeMode={(mode) => {
          setAppMode(mode);
          setScreen('workspace');
        }}
        pageCount={pages.length}
        isOffline={isOffline}
        canInstall={canInstall}
        onInstallApp={handleInstallApp}
        onLoadSamplePage={() => {
          setAppMode('scanner');
          void handleLoadSamplePage();
        }}
        onExportPdf={() => setExportOpen(true)}
      />

      {/* Toast Notifications */}
      <ToastBanner toast={toast} onDismiss={() => setToast(null)} />

      {/* Primary Workspace or Client-Side PDF Compressor */}
      {appMode === 'compress' ? (
        <CompressPdfView
          incomingPdf={incomingPdf}
          onConsumeIncomingPdf={() => setIncomingPdf(null)}
          onNotify={notify}
        />
      ) : (
        <WorkspaceView
          pages={pages}
          thumbUrls={thumbUrls}
          documentTitle={meta.title}
          loading={loading}
          busyLabel={busyLabel}
          storageWarning={storageWarning}
          onRenameDocument={(title) => void renameDocument(title)}
          onOpenCamera={() => setScreen('camera')}
          onTriggerNativeCamera={() => nativeCamInputRef.current?.click()}
          onTriggerGallery={() => galleryInputRef.current?.click()}
          onLoadSamplePage={() => void handleLoadSamplePage()}
          onDropFiles={(files) => void handleIncomingFiles(files)}
          onEditFilter={handleEditPageFilter}
          onEditCrop={handleEditPageCrop}
          onRotatePage={(id) => void rotatePageQuick(id)}
          onMovePage={(id, dir) => void movePage(id, dir)}
          onDeletePage={(id) => {
            void deletePage(id);
            notify('info', 'Page removed.');
          }}
          onApplyFilterAll={(f) => void handleApplyFilterAll(f)}
          onRequestClearAll={() => setClearConfirmOpen(true)}
          onExportPdf={() => setExportOpen(true)}
        />
      )}

      {/* Signature HYDE Dark Telemetry Footer Bar */}
      <footer className="hidden md:flex relative z-20 w-full bg-zinc-900 text-zinc-400 font-mono text-[9px] px-5 py-1.5 justify-between tracking-widest shrink-0">
        <span>ENGINE: PURE_TS_WORKER // ZERO_SERVER_UPLOAD</span>
        <span>
          {isOffline
            ? 'NETWORK: OFFLINE_LOCAL_ACTIVE'
            : `STORAGE: ${storageWarning ? 'MEMORY_SESSION' : 'INDEXEDDB_LOCAL'} · PAGES: ${String(
                pages.length
              ).padStart(2, '0')}`}
        </span>
      </footer>

      {/* Fullscreen Live Camera Screen */}
      {screen === 'camera' && (
        <CameraView
          onSingleCapture={(blob) => void handleSingleCameraCapture(blob)}
          onBatchComplete={(blobs) => void handleBatchCameraComplete(blobs)}
          onFallbackNativeCamera={() => {
            setScreen('workspace');
            window.setTimeout(() => nativeCamInputRef.current?.click(), 50);
          }}
          onFallbackGallery={() => {
            setScreen('workspace');
            window.setTimeout(() => galleryInputRef.current?.click(), 50);
          }}
          onClose={() => setScreen('workspace')}
        />
      )}

      {/* Fullscreen 4-Corner Manual Perspective Crop Screen */}
      {screen === 'crop' && activeDraft && (
        <CropView
          imageBlob={activeDraft.originalBlob}
          initialQuad={activeDraft.quad}
          initialAspect={activeDraft.aspectMode}
          initialRotation={activeDraft.rotation}
          onBack={() => {
            if (activeDraft.existingPageId) {
              setScreen('filter');
            } else {
              setActiveDraft(null);
              setScreen('workspace');
            }
          }}
          onConfirm={handleCropConfirm}
        />
      )}

      {/* Fullscreen Filter & Shadow Removal Studio */}
      {screen === 'filter' && activeDraft && (
        <FilterView
          draft={activeDraft}
          saving={savingDraft}
          onBackToCrop={(updated) => {
            setActiveDraft(updated);
            setScreen('crop');
          }}
          onCancel={() => {
            setActiveDraft(null);
            setScreen('workspace');
          }}
          onSave={(updated) => void handleFilterSave(updated)}
        />
      )}

      {/* PDF Export Modal */}
      <ExportModal
        open={exportOpen}
        pages={pages}
        defaultTitle={meta.title}
        onClose={() => setExportOpen(false)}
        onNotify={notify}
      />

      {/* Confirm Clear All Dialog */}
      <ConfirmDialog
        open={clearConfirmOpen}
        title="CLEAR_ALL_PAGES"
        message={`Remove all ${pages.length} scanned pages and start a fresh document? Make sure you have downloaded your PDF first.`}
        confirmLabel="Clear Workspace"
        destructive
        onCancel={() => setClearConfirmOpen(false)}
        onConfirm={async () => {
          setClearConfirmOpen(false);
          await clearAllPages();
          notify('info', 'Workspace cleared — ready for a new scan.');
        }}
      />
    </div>
  );
}
