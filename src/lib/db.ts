// IndexedDB 轻量封装（无第三方依赖，全部本地，无任何网络请求）
const DB_NAME = 'bend-system-db';
const DB_VERSION = 1;

export type StoreName = 'parts' | 'settings' | 'meta';

let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('parts')) db.createObjectStore('parts', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('settings')) db.createObjectStore('settings', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('meta')) db.createObjectStore('meta', { keyPath: 'key' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

function tx<T>(store: StoreName, mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return openDb().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const t = db.transaction(store, mode);
        const req = fn(t.objectStore(store));
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      }),
  );
}

export const idb = {
  async getAll<T>(store: StoreName): Promise<T[]> {
    return tx(store, 'readonly', (s) => s.getAll() as IDBRequest<T[]>);
  },
  async get<T>(store: StoreName, key: string): Promise<T | undefined> {
    return tx(store, 'readonly', (s) => s.get(key) as IDBRequest<T | undefined>);
  },
  async put<T>(store: StoreName, value: T): Promise<IDBValidKey> {
    return tx(store, 'readwrite', (s) => s.put(value));
  },
  async bulkPut<T>(store: StoreName, values: T[]): Promise<void> {
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const t = db.transaction(store, 'readwrite');
      const s = t.objectStore(store);
      values.forEach((v) => s.put(v));
      t.oncomplete = () => resolve();
      t.onerror = () => reject(t.error);
    });
  },
  async delete(store: StoreName, key: string): Promise<void> {
    await tx(store, 'readwrite', (s) => s.delete(key));
  },
  async clear(store: StoreName): Promise<void> {
    await tx(store, 'readwrite', (s) => s.clear());
  },
  /** 估算整个库占用字节数（navigator.storage 不可用时回退到 JSON 长度） */
  async estimateBytes(): Promise<{ bytes: number; quota: number | null }> {
    try {
      const nav = navigator as Navigator & { storage?: { estimate?: () => Promise<{ usage: number; quota: number }> } };
      if (nav.storage?.estimate) {
        const e = await nav.storage.estimate();
        return { bytes: e.usage ?? 0, quota: e.quota ?? null };
      }
    } catch { /* 回退 */ }
    const [parts, settings] = await Promise.all([idb.getAll('parts'), idb.getAll('settings')]);
    const bytes = new Blob([JSON.stringify({ parts, settings })]).size;
    return { bytes, quota: null };
  },
};
