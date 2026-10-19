// Minimal promise wrapper around IndexedDB (no dependency). One database, two key-value stores:
// "settings" (access key, cached index, preferences) and "layers" (LRU bookkeeping of cached 3D layers).

const DB_NAME = 'binder';
const DB_VERSION = 1;
export type StoreName = 'settings' | 'layers';

let opening: Promise<IDBDatabase> | null = null;

function request<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => {
      resolve(req.result);
    };
    req.onerror = () => {
      reject(req.error ?? new Error('IndexedDB request failed'));
    };
  });
}

function open(): Promise<IDBDatabase> {
  opening ??= new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('settings')) db.createObjectStore('settings');
      if (!db.objectStoreNames.contains('layers')) db.createObjectStore('layers');
    };
    req.onsuccess = () => {
      const db = req.result;
      db.onversionchange = () => {
        db.close();
        opening = null;
      };
      resolve(db);
    };
    req.onerror = () => {
      opening = null;
      reject(req.error ?? new Error('IndexedDB open failed'));
    };
  });
  return opening;
}

async function store(name: StoreName, mode: IDBTransactionMode): Promise<IDBObjectStore> {
  return (await open()).transaction(name, mode).objectStore(name);
}

export async function idbGet<T>(name: StoreName, key: string): Promise<T | undefined> {
  return (await request((await store(name, 'readonly')).get(key))) as T | undefined;
}

export async function idbSet(name: StoreName, key: string, value: unknown): Promise<void> {
  await request((await store(name, 'readwrite')).put(value, key));
}

export async function idbDelete(name: StoreName, key: string): Promise<void> {
  await request((await store(name, 'readwrite')).delete(key));
}

export async function idbEntries<T>(name: StoreName): Promise<[string, T][]> {
  const s = await store(name, 'readonly');
  const [keys, values] = await Promise.all([request(s.getAllKeys()), request(s.getAll())]);
  return keys.map((k, i) => [typeof k === 'string' ? k : JSON.stringify(k), values[i] as T]);
}
