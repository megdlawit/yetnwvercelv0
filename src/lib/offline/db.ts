/**
 * offline/db — a small promise-based IndexedDB wrapper.
 *
 * Replaces the old localStorage-based caches (~5-10MB hard cap, and a quota
 * overflow just gets silently swallowed by a try/catch) with IndexedDB,
 * which comfortably holds the full routing graph, POI data, and floor plan
 * images for many buildings.
 *
 * Usage:
 *   await idbSet('buildings', 'all', payload);
 *   const payload = await idbGet('buildings', 'all');
 */

const DB_NAME = 'ethi-route-offline';
const DB_VERSION = 1;

export const STORES = {
  buildings: 'buildings',
  pois: 'pois',
  meta: 'meta',
} as const;

export type StoreName = (typeof STORES)[keyof typeof STORES];

let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;

  dbPromise = new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB not available'));
      return;
    }
    const req = indexedDB.open(DB_NAME, DB_VERSION);

    req.onupgradeneeded = () => {
      const db = req.result;
      Object.values(STORES).forEach(name => {
        if (!db.objectStoreNames.contains(name)) {
          db.createObjectStore(name);
        }
      });
    };

    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });

  return dbPromise;
}

export async function idbGet<T>(store: StoreName, key: string): Promise<T | null> {
  try {
    const db = await openDb();
    return await new Promise<T | null>((resolve, reject) => {
      const tx = db.transaction(store, 'readonly');
      const req = tx.objectStore(store).get(key);
      req.onsuccess = () => resolve((req.result as T) ?? null);
      req.onerror = () => reject(req.error);
    });
  } catch (e) {
    console.warn(`idbGet(${store}, ${key}) failed`, e);
    return null;
  }
}

export async function idbSet<T>(store: StoreName, key: string, value: T): Promise<boolean> {
  try {
    const db = await openDb();
    return await new Promise<boolean>((resolve, reject) => {
      const tx = db.transaction(store, 'readwrite');
      tx.objectStore(store).put(value, key);
      tx.oncomplete = () => resolve(true);
      tx.onerror = () => reject(tx.error);
    });
  } catch (e) {
    console.warn(`idbSet(${store}, ${key}) failed`, e);
    return false;
  }
}

export async function idbDelete(store: StoreName, key: string): Promise<void> {
  try {
    const db = await openDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(store, 'readwrite');
      tx.objectStore(store).delete(key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch (e) {
    console.warn(`idbDelete(${store}, ${key}) failed`, e);
  }
}

/**
 * One-time migration: if an old localStorage cache entry exists and
 * IndexedDB doesn't have it yet, copy it over so returning users don't
 * lose their offline cache during the upgrade.
 */
export async function migrateFromLocalStorage<T>(
  localStorageKey: string,
  store: StoreName,
  idbKey: string
): Promise<void> {
  try {
    const existing = await idbGet<T>(store, idbKey);
    if (existing) return; // already migrated
    const raw = localStorage.getItem(localStorageKey);
    if (!raw) return;
    const parsed = JSON.parse(raw) as T;
    await idbSet(store, idbKey, parsed);
    localStorage.removeItem(localStorageKey);
  } catch (e) {
    console.warn('localStorage → IndexedDB migration failed', e);
  }
}
