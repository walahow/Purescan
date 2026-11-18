import { useCallback, useEffect, useRef, useState } from 'react';
import {
  clearWorkspace,
  defaultDocumentTitle,
  deletePage as dbDeletePage,
  isUsingMemoryFallback,
  loadAllPages,
  loadDocumentMeta,
  saveDocumentMeta,
  saveMultiplePages,
  savePage as dbSavePage,
} from '../db/storage';
import {
  blobToImageData,
  createThumbnailBlob,
  ingestImageBlob,
  MAX_INGEST_DIM,
  rgbaToJpegBlob,
} from '../imaging/ingest';
import { createDefaultQuad } from '../imaging/perspective';
import { processImageInWorker } from '../imaging/workerClient';
import {
  DEFAULT_ADJUSTMENTS,
  type AspectMode,
  type DocumentMeta,
  type FilterAdjustments,
  type FilterPreset,
  type Quad,
  type Rotation,
  type ScanPage,
} from '../types/scan';

export interface PendingDraft {
  /** If editing an existing page, holds its ID; null when adding a new capture */
  existingPageId: string | null;
  originalBlob: Blob;
  originalWidth: number;
  originalHeight: number;
  quad: Quad;
  aspectMode: AspectMode;
  rotation: Rotation;
  filter: FilterPreset;
  adjustments: FilterAdjustments;
}

function generateId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `pg_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

async function renderPageOutputs(params: {
  originalBlob: Blob;
  quad: Quad;
  aspectMode: AspectMode;
  rotation: Rotation;
  filter: FilterPreset;
  adjustments: FilterAdjustments;
}): Promise<{ processedBlob: Blob; processedWidth: number; processedHeight: number; thumbnailBlob: Blob }> {
  const src = await blobToImageData(params.originalBlob);
  const out = await processImageInWorker({
    pixels: src.pixels,
    width: src.width,
    height: src.height,
    quad: params.quad,
    aspectMode: params.aspectMode,
    rotation: params.rotation,
    filter: params.filter,
    adjustments: params.adjustments,
    maxOutputDim: MAX_INGEST_DIM,
  });

  const processedBlob = await rgbaToJpegBlob(out.pixels, out.width, out.height, 0.88);
  const thumbnailBlob = await createThumbnailBlob(processedBlob);
  return {
    processedBlob,
    processedWidth: out.width,
    processedHeight: out.height,
    thumbnailBlob,
  };
}

export function useScanWorkspace() {
  const [pages, setPages] = useState<ScanPage[]>([]);
  const [meta, setMeta] = useState<DocumentMeta>({
    id: 'active',
    title: defaultDocumentTitle(),
    updatedAt: Date.now(),
  });
  const [loading, setLoading] = useState(true);
  const [busyLabel, setBusyLabel] = useState<string | null>(null);
  const [storageWarning, setStorageWarning] = useState(false);

  // Thumbnail object URLs managed cleanly to avoid memory leaks
  const [thumbUrls, setThumbUrls] = useState<Record<string, string>>({});
  const thumbCacheRef = useRef<Map<string, { blob: Blob; url: string }>>(new Map());

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const [loadedPages, loadedMeta] = await Promise.all([loadAllPages(), loadDocumentMeta()]);
        if (!active) return;
        setPages(loadedPages);
        setMeta(loadedMeta);
        setStorageWarning(isUsingMemoryFallback());
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  // Keep object URLs synchronized with current page thumbnail Blobs
  useEffect(() => {
    const cache = thumbCacheRef.current;
    const currentIds = new Set(pages.map((p) => p.id));

    // Revoke removed pages
    for (const [id, entry] of cache.entries()) {
      if (!currentIds.has(id)) {
        URL.revokeObjectURL(entry.url);
        cache.delete(id);
      }
    }

    const nextMap: Record<string, string> = {};
    for (const page of pages) {
      const existing = cache.get(page.id);
      if (existing && existing.blob === page.thumbnailBlob) {
        nextMap[page.id] = existing.url;
      } else {
        if (existing) URL.revokeObjectURL(existing.url);
        const url = URL.createObjectURL(page.thumbnailBlob);
        cache.set(page.id, { blob: page.thumbnailBlob, url });
        nextMap[page.id] = url;
      }
    }
    setThumbUrls(nextMap);
  }, [pages]);

  // Revoke everything on unmount
  useEffect(() => {
    const cache = thumbCacheRef.current;
    return () => {
      for (const entry of cache.values()) {
        URL.revokeObjectURL(entry.url);
      }
      cache.clear();
    };
  }, []);

  const prepareSingleDraft = useCallback(async (fileOrBlob: Blob): Promise<PendingDraft> => {
    setBusyLabel('Preparing photo...');
    try {
      const ingested = await ingestImageBlob(fileOrBlob, MAX_INGEST_DIM, 0.92);
      return {
        existingPageId: null,
        originalBlob: ingested.blob,
        originalWidth: ingested.width,
        originalHeight: ingested.height,
        quad: createDefaultQuad(0.05),
        aspectMode: 'auto',
        rotation: 0,
        filter: 'pure-color',
        adjustments: { ...DEFAULT_ADJUSTMENTS },
      };
    } finally {
      setBusyLabel(null);
    }
  }, []);

  const commitDraft = useCallback(
    async (draft: PendingDraft): Promise<ScanPage> => {
      setBusyLabel('Rendering full-resolution scan...');
      try {
        const rendered = await renderPageOutputs({
          originalBlob: draft.originalBlob,
          quad: draft.quad,
          aspectMode: draft.aspectMode,
          rotation: draft.rotation,
          filter: draft.filter,
          adjustments: draft.adjustments,
        });

        let savedPage: ScanPage;
        if (draft.existingPageId) {
          const existing = pages.find((p) => p.id === draft.existingPageId);
          savedPage = {
            id: draft.existingPageId,
            order: existing ? existing.order : pages.length,
            createdAt: existing ? existing.createdAt : Date.now(),
            originalBlob: draft.originalBlob,
            originalWidth: draft.originalWidth,
            originalHeight: draft.originalHeight,
            quad: draft.quad,
            aspectMode: draft.aspectMode,
            rotation: draft.rotation,
            filter: draft.filter,
            adjustments: draft.adjustments,
            ...rendered,
          };
          await dbSavePage(savedPage);
          setPages((prev) =>
            prev.map((p) => (p.id === savedPage.id ? savedPage : p)).sort((a, b) => a.order - b.order)
          );
        } else {
          const maxOrder = pages.reduce((m, p) => Math.max(m, p.order), -1);
          savedPage = {
            id: generateId(),
            order: maxOrder + 1,
            createdAt: Date.now(),
            originalBlob: draft.originalBlob,
            originalWidth: draft.originalWidth,
            originalHeight: draft.originalHeight,
            quad: draft.quad,
            aspectMode: draft.aspectMode,
            rotation: draft.rotation,
            filter: draft.filter,
            adjustments: draft.adjustments,
            ...rendered,
          };
          await dbSavePage(savedPage);
          setPages((prev) => [...prev, savedPage].sort((a, b) => a.order - b.order));
        }
        setStorageWarning(isUsingMemoryFallback());
        return savedPage;
      } finally {
        setBusyLabel(null);
      }
    },
    [pages]
  );

  /**
   * Batch imports/adds multiple photos directly into the workspace (auto-processed with Pure Color
   * and slight default quad, ready for quick per-page trim or instant PDF export).
   */
  const addBatchBlobs = useCallback(
    async (blobs: Blob[], defaultFilter: FilterPreset = 'pure-color'): Promise<number> => {
      if (blobs.length === 0) return 0;
      const newPages: ScanPage[] = [];
      let nextOrder = pages.reduce((m, p) => Math.max(m, p.order), -1) + 1;

      try {
        for (let i = 0; i < blobs.length; i++) {
          setBusyLabel(`Processing page ${i + 1} of ${blobs.length}...`);
          const ingested = await ingestImageBlob(blobs[i], MAX_INGEST_DIM, 0.92);
          const quad = createDefaultQuad(0.02);
          const adjustments = { ...DEFAULT_ADJUSTMENTS };
          const rendered = await renderPageOutputs({
            originalBlob: ingested.blob,
            quad,
            aspectMode: 'auto',
            rotation: 0,
            filter: defaultFilter,
            adjustments,
          });

          const page: ScanPage = {
            id: generateId(),
            order: nextOrder++,
            createdAt: Date.now(),
            originalBlob: ingested.blob,
            originalWidth: ingested.width,
            originalHeight: ingested.height,
            quad,
            aspectMode: 'auto',
            rotation: 0,
            filter: defaultFilter,
            adjustments,
            ...rendered,
          };
          await dbSavePage(page);
          newPages.push(page);
        }

        setPages((prev) => [...prev, ...newPages].sort((a, b) => a.order - b.order));
        setStorageWarning(isUsingMemoryFallback());
        return newPages.length;
      } finally {
        setBusyLabel(null);
      }
    },
    [pages]
  );

  const deletePage = useCallback(async (id: string) => {
    await dbDeletePage(id);
    setPages((prev) => {
      const remaining = prev.filter((p) => p.id !== id).map((p, idx) => ({ ...p, order: idx }));
      void saveMultiplePages(remaining);
      return remaining;
    });
  }, []);

  const movePage = useCallback(
    async (id: string, direction: -1 | 1) => {
      const idx = pages.findIndex((p) => p.id === id);
      const targetIdx = idx + direction;
      if (idx < 0 || targetIdx < 0 || targetIdx >= pages.length) return;

      const copy = [...pages];
      const [moved] = copy.splice(idx, 1);
      copy.splice(targetIdx, 0, moved);
      const reindexed = copy.map((p, i) => ({ ...p, order: i }));
      setPages(reindexed);
      await saveMultiplePages(reindexed);
    },
    [pages]
  );

  const rotatePageQuick = useCallback(
    async (id: string) => {
      const page = pages.find((p) => p.id === id);
      if (!page) return;
      const nextRot = (((page.rotation + 90) % 360) as Rotation);
      setBusyLabel('Rotating page...');
      try {
        const rendered = await renderPageOutputs({
          originalBlob: page.originalBlob,
          quad: page.quad,
          aspectMode: page.aspectMode,
          rotation: nextRot,
          filter: page.filter,
          adjustments: page.adjustments,
        });
        const updated: ScanPage = { ...page, rotation: nextRot, ...rendered };
        await dbSavePage(updated);
        setPages((prev) => prev.map((p) => (p.id === id ? updated : p)));
      } finally {
        setBusyLabel(null);
      }
    },
    [pages]
  );

  const applyFilterToAll = useCallback(
    async (filter: FilterPreset) => {
      if (pages.length === 0) return;
      const updatedList: ScanPage[] = [];
      try {
        for (let i = 0; i < pages.length; i++) {
          const p = pages[i];
          setBusyLabel(`Applying filter (${i + 1}/${pages.length})...`);
          const rendered = await renderPageOutputs({
            originalBlob: p.originalBlob,
            quad: p.quad,
            aspectMode: p.aspectMode,
            rotation: p.rotation,
            filter,
            adjustments: p.adjustments,
          });
          const updated: ScanPage = { ...p, filter, ...rendered };
          await dbSavePage(updated);
          updatedList.push(updated);
        }
        setPages(updatedList.sort((a, b) => a.order - b.order));
      } finally {
        setBusyLabel(null);
      }
    },
    [pages]
  );

  const renameDocument = useCallback(async (title: string) => {
    const nextMeta: DocumentMeta = {
      id: 'active',
      title,
      updatedAt: Date.now(),
    };
    setMeta(nextMeta);
    await saveDocumentMeta(nextMeta);
  }, []);

  const clearAllPages = useCallback(async () => {
    await clearWorkspace();
    const freshMeta: DocumentMeta = {
      id: 'active',
      title: defaultDocumentTitle(),
      updatedAt: Date.now(),
    };
    setPages([]);
    setMeta(freshMeta);
  }, []);

  const pageToDraft = useCallback((page: ScanPage): PendingDraft => {
    return {
      existingPageId: page.id,
      originalBlob: page.originalBlob,
      originalWidth: page.originalWidth,
      originalHeight: page.originalHeight,
      quad: page.quad.map((pt) => ({ ...pt })) as Quad,
      aspectMode: page.aspectMode,
      rotation: page.rotation,
      filter: page.filter,
      adjustments: { ...page.adjustments },
    };
  }, []);

  return {
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
  };
}
