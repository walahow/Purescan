import type { DocumentMeta, ScanPage } from '../types/scan';

const DB_NAME = 'purescan-local-db';
const DB_VERSION = 1;
const PAGES_STORE = 'pages';
const META_STORE = 'meta';

let dbPromise: Promise<IDBDatabase> | null = null;
let fallbackMode = false;

// In-memory fallback when browser blocks IndexedDB (e.g., strict private/incognito modes)
const memoryPages = new Map<string, ScanPage>();
let memoryMeta: DocumentMeta = {
  id: 'active',
  title: defaultDocumentTitle(),
  updatedAt: Date.now(),
};

export function defaultDocumentTitle(): string {
  const now = new Date();
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const dd = String(now.getDate()).padStart(2, '0');
  const hh = String(now.getHours()).padStart(2, '0');
  const min = String(now.getMinutes()).padStart(2, '0');
  return `Scan_${yyyy}-${mm}-${dd}_${hh}${min}`;
}

export function isUsingMemoryFallback(): boolean {
  return fallbackMode;
}

function openDB(): Promise<IDBDatabase> {
  if (typeof indexedDB === 'undefined') {
    fallbackMode = true;
    return Promise.reject(new Error('IndexedDB unavailable'));
  }

  if (!dbPromise) {
    dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
      try {
        const req = indexedDB.open(DB_NAME, DB_VERSION);
        req.onupgradeneeded = () => {
          const db = req.result;
          if (!db.objectStoreNames.contains(PAGES_STORE)) {
            const store = db.createObjectStore(PAGES_STORE, { keyPath: 'id' });
            store.createIndex('order', 'order', { unique: false });
          }
          if (!db.objectStoreNames.contains(META_STORE)) {
            db.createObjectStore(META_STORE, { keyPath: 'id' });
          }
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => {
          fallbackMode = true;
          reject(req.error ?? new Error('Failed to open IndexedDB'));
        };
      } catch (err) {
        fallbackMode = true;
        reject(err);
      }
    });
  }

  return dbPromise;
}

function txPromise<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('IndexedDB transaction failed'));
  });
}

function txDone(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error('IndexedDB transaction error'));
    tx.onabort = () => reject(tx.error ?? new Error('IndexedDB transaction aborted'));
  });
}

export async function loadAllPages(): Promise<ScanPage[]> {
  try {
    const db = await openDB();
    const tx = db.transaction(PAGES_STORE, 'readonly');
    const store = tx.objectStore(PAGES_STORE);
    const items = await txPromise<ScanPage[]>(store.getAll());
    return items.sort((a, b) => a.order - b.order);
  } catch {
    fallbackMode = true;
    return Array.from(memoryPages.values()).sort((a, b) => a.order - b.order);
  }
}

export async function savePage(page: ScanPage): Promise<void> {
  memoryPages.set(page.id, page);
  try {
    const db = await openDB();
    const tx = db.transaction(PAGES_STORE, 'readwrite');
    tx.objectStore(PAGES_STORE).put(page);
    await txDone(tx);
  } catch (err) {
    // Detect quota exceeded and rethrow with user-friendly message
    if (err instanceof DOMException && (err.name === 'QuotaExceededError' || err.code === 22)) {
      throw new Error('Device browser storage is full. Export your PDF and clear old scans to free space.');
    }
    fallbackMode = true;
  }
}

export async function saveMultiplePages(pages: ScanPage[]): Promise<void> {
  for (const p of pages) memoryPages.set(p.id, p);
  try {
    const db = await openDB();
    const tx = db.transaction(PAGES_STORE, 'readwrite');
    const store = tx.objectStore(PAGES_STORE);
    for (const p of pages) store.put(p);
    await txDone(tx);
  } catch (err) {
    if (err instanceof DOMException && (err.name === 'QuotaExceededError' || err.code === 22)) {
      throw new Error('Device browser storage is full. Export your PDF and clear old scans to free space.');
    }
    fallbackMode = true;
  }
}

export async function deletePage(id: string): Promise<void> {
  memoryPages.delete(id);
  try {
    const db = await openDB();
    const tx = db.transaction(PAGES_STORE, 'readwrite');
    tx.objectStore(PAGES_STORE).delete(id);
    await txDone(tx);
  } catch {
    fallbackMode = true;
  }
}

export async function clearWorkspace(): Promise<void> {
  memoryPages.clear();
  memoryMeta = {
    id: 'active',
    title: defaultDocumentTitle(),
    updatedAt: Date.now(),
  };
  try {
    const db = await openDB();
    const tx = db.transaction([PAGES_STORE, META_STORE], 'readwrite');
    tx.objectStore(PAGES_STORE).clear();
    tx.objectStore(META_STORE).put(memoryMeta);
    await txDone(tx);
  } catch {
    fallbackMode = true;
  }
}

export async function loadDocumentMeta(): Promise<DocumentMeta> {
  try {
    const db = await openDB();
    const tx = db.transaction(META_STORE, 'readonly');
    const existing = await txPromise<DocumentMeta | undefined>(tx.objectStore(META_STORE).get('active'));
    if (existing) return existing;
    const fresh: DocumentMeta = {
      id: 'active',
      title: defaultDocumentTitle(),
      updatedAt: Date.now(),
    };
    await saveDocumentMeta(fresh);
    return fresh;
  } catch {
    fallbackMode = true;
    return memoryMeta;
  }
}

export async function saveDocumentMeta(meta: DocumentMeta): Promise<void> {
  memoryMeta = meta;
  try {
    const db = await openDB();
    const tx = db.transaction(META_STORE, 'readwrite');
    tx.objectStore(META_STORE).put(meta);
    await txDone(tx);
  } catch {
    fallbackMode = true;
  }
}
