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
import type {
  AspectMode,
  CameraCaptureResult,
  FilterPreset,
  Quad,
  Rotation,
  ScanPage,
} from './types/scan';

type ActiveScreen = 'workspace' | 'camera' | 'crop' | 'filter';

export default function App() {
  const {
    pages,
    meta,
    loading,
    busyLabel,
    rotatingPageIds,
    filterAllProgress,
    storageWarning,
    thumbUrls,
    prepareSingleDraft,
    commitDraft,
    addBatchBlobs,
    deletePage,
    movePage,
    reorderPages,
    rotatePageQuick,
    applyFilterToAll,
    renameDocument,
    clearAllPages,
    pageToDraft,
  } = useScanWorkspace();

  const {
    canInstall,
    isInstalled,
    isOffline,
    needsUpdate,
    updateStatus,
    promptInstall,
    applyUpdate,
    checkForUpdate,
  } = usePwaStatus();

  const [appMode, setAppMode] = useState<AppMode>('scanner');
  const [incomingPdf, setIncomingPdf] = useState<File | null>(null);
  const [screen, setScreen] = useState<ActiveScreen>('workspace');
  const [activeDraft, setActiveDraft] = useState<PendingDraft | null>(null);
  const [savingDraft, setSavingDraft] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [clearConfirmOpen, setClearConfirmOpen] = useState(false);
  const [toast, setToast] = useState<ToastMessage | null>(null);

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
          await addBatchBlobs(imageFiles, 'pure-color');
        }
      } catch (err) {
        notify('error', err instanceof Error ? err.message : 'Could not decode image file.');
      }
    },
    [addBatchBlobs, notify, prepareSingleDraft]
  );

  const handleGalleryChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files ? Array.from(e.target.files) : [];
    e.target.value = '';
    if (files.length > 0) void handleIncomingFiles(files);
  };

  const handleSingleCameraCapture = async (capture: CameraCaptureResult) => {
    try {
      const draft = await prepareSingleDraft(capture.blob, {
        fromCamera: true,
        fallbackQuad: capture.fallbackQuad,
        suggestedAspectMode: capture.suggestedAspectMode,
      });
      setActiveDraft(draft);
      setScreen('crop');
    } catch (err) {
      setScreen('workspace');
      notify('error', err instanceof Error ? err.message : 'Failed to process captured photo.');
    }
  };

  const handleBatchCameraComplete = async (captures: CameraCaptureResult[]) => {
    setScreen('workspace');
    if (captures.length === 0) return;
    try {
      if (captures.length === 1) {
        const draft = await prepareSingleDraft(captures[0].blob, {
          fromCamera: true,
          fallbackQuad: captures[0].fallbackQuad,
          suggestedAspectMode: captures[0].suggestedAspectMode,
        });
        setActiveDraft(draft);
        setScreen('crop');
      } else {
        await addBatchBlobs(captures, 'pure-color');
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
      await commitDraft(updated);
      setActiveDraft(null);
      setScreen('workspace');
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
    } catch (err) {
      notify('error', err instanceof Error ? err.message : 'Could not update all pages.');
    }
  };

  const handleInstallApp = async () => {
    await promptInstall();
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
      {/* Hidden gallery file input */}
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
        isInstalled={isInstalled}
        needsUpdate={needsUpdate}
        updateStatus={updateStatus}
        onInstallApp={handleInstallApp}
        onApplyUpdate={() => void applyUpdate()}
        onCheckUpdate={(silent) => void checkForUpdate(silent)}
        onLoadSamplePage={() => {
          setAppMode('scanner');
          void handleLoadSamplePage();
        }}
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
          rotatingPageIds={rotatingPageIds}
          filterAllProgress={filterAllProgress}
          storageWarning={storageWarning}
          onRenameDocument={(title) => void renameDocument(title)}
          onOpenCamera={() => setScreen('camera')}
          onTriggerGallery={() => galleryInputRef.current?.click()}
          onLoadSamplePage={() => void handleLoadSamplePage()}
          onDropFiles={(files) => void handleIncomingFiles(files)}
          onEditFilter={handleEditPageFilter}
          onEditCrop={handleEditPageCrop}
          onRotatePage={(id) => void rotatePageQuick(id)}
          onMovePage={(id, dir) => void movePage(id, dir)}
          onReorderPages={(ids) => void reorderPages(ids)}
          onDeletePage={(id) => {
            void deletePage(id);
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
          onSingleCapture={(capture) => void handleSingleCameraCapture(capture)}
          onBatchComplete={(captures) => void handleBatchCameraComplete(captures)}
          onFallbackGallery={() => {
            setScreen('workspace');
            window.setTimeout(() => galleryInputRef.current?.click(), 50);
          }}
          onClose={() => setScreen('workspace')}
        />
      )}

      {/* Fullscreen 4-Corner Perspective Crop Screen */}
      {screen === 'crop' && activeDraft && (
        <CropView
          imageBlob={activeDraft.originalBlob}
          initialQuad={activeDraft.quad}
          initialAspect={activeDraft.aspectMode}
          initialRotation={activeDraft.rotation}
          autoDetected={activeDraft.autoDetected}
          sharpness={activeDraft.sharpness}
          fallbackQuad={activeDraft.fallbackQuad}
          onRetake={
            activeDraft.fromCamera
              ? () => {
                  setActiveDraft(null);
                  setScreen('camera');
                }
              : undefined
          }
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
        }}
      />
    </div>
  );
}
