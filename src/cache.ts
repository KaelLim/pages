/**
 * IndexedDB cache for rendered PDF pages.
 * Persists across sessions so re-opening a previously viewed PDF
 * doesn't re-render every page.
 *
 * Key schema: `${pdfUrl}::${pageNum}::${renderScale}`
 * Value: data URL string (WebP or PNG)
 */

const DB_NAME = 'pdfviewer-cache';
const STORE = 'pages';
const DB_VERSION = 1;
// Evict entries older than this to keep storage bounded.
const MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

interface CacheEntry {
  key: string;
  dataUrl: string;
  timestamp: number;
}

let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        const store = db.createObjectStore(STORE, { keyPath: 'key' });
        store.createIndex('timestamp', 'timestamp');
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

export function buildCacheKey(pdfUrl: string, pageNum: number, scale: number): string {
  return `${pdfUrl}::${pageNum}::${scale}`;
}

export async function getCachedPage(key: string): Promise<string | null> {
  try {
    const db = await openDb();
    return await new Promise<string | null>((resolve) => {
      const tx = db.transaction(STORE, 'readonly');
      const req = tx.objectStore(STORE).get(key);
      req.onsuccess = () => {
        const entry = req.result as CacheEntry | undefined;
        resolve(entry ? entry.dataUrl : null);
      };
      req.onerror = () => resolve(null);
    });
  } catch {
    return null;
  }
}

export async function setCachedPage(key: string, dataUrl: string): Promise<void> {
  try {
    const db = await openDb();
    await new Promise<void>((resolve) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).put({ key, dataUrl, timestamp: Date.now() } as CacheEntry);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    });
  } catch {
    // Storage quota / private mode — silently skip
  }
}

/** Evict entries older than MAX_AGE_MS. Run once at startup. */
export async function evictStaleCache(): Promise<void> {
  try {
    const db = await openDb();
    const cutoff = Date.now() - MAX_AGE_MS;
    await new Promise<void>((resolve) => {
      const tx = db.transaction(STORE, 'readwrite');
      const store = tx.objectStore(STORE);
      const range = IDBKeyRange.upperBound(cutoff);
      const req = store.index('timestamp').openCursor(range);
      req.onsuccess = () => {
        const cursor = req.result;
        if (cursor) {
          cursor.delete();
          cursor.continue();
        }
      };
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    });
  } catch { /* non-fatal */ }
}
