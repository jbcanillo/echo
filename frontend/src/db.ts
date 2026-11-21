// Local-only storage for the voice library and generation history (IndexedDB, nothing leaves the device)

export interface SavedVoice {
  id: string;
  name: string;
  blob: Blob;
  createdAt: number;
}

export interface HistoryItem {
  id: string;
  text: string;
  voiceName: string;
  blob: Blob;
  createdAt: number;
}

export interface CustomAvatar {
  /** Which slot it replaces: F = female, M = male */
  gender: 'F' | 'M';
  name: string;
  size: number;
  blob: Blob;
  createdAt: number;
}

type StoreName = 'voices' | 'history' | 'avatars';

const DB_NAME = 'echo';
const MAX_HISTORY = 50;

let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, 2);
      request.onupgradeneeded = () => {
        const db = request.result;
        // Create only what is missing, so upgrading keeps existing voices and history
        const stores: Array<[StoreName, string]> = [['voices', 'id'], ['history', 'id'], ['avatars', 'gender']];
        for (const [name, keyPath] of stores) {
          if (!db.objectStoreNames.contains(name)) db.createObjectStore(name, { keyPath });
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => {
        dbPromise = null;
        reject(request.error);
      };
    });
  }
  return dbPromise;
}

async function run<T>(store: StoreName, mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, mode);
    const request = fn(tx.objectStore(store));
    tx.oncomplete = () => resolve(request.result);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

async function listAll<T extends { createdAt: number }>(store: StoreName): Promise<T[]> {
  const items = await run<T[]>(store, 'readonly', (s) => s.getAll());
  return items.sort((a, b) => b.createdAt - a.createdAt);
}

export const newId = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;

export const listVoices = () => listAll<SavedVoice>('voices');
export const saveVoice = (voice: SavedVoice) => run('voices', 'readwrite', (s) => s.put(voice));
export const deleteVoice = (id: string) => run('voices', 'readwrite', (s) => s.delete(id));

export const listHistory = () => listAll<HistoryItem>('history');
export const deleteHistoryItem = (id: string) => run('history', 'readwrite', (s) => s.delete(id));
export const clearHistory = () => run('history', 'readwrite', (s) => s.clear());

export async function addHistoryItem(item: HistoryItem): Promise<void> {
  await run('history', 'readwrite', (s) => s.put(item));
  // Keep storage bounded: drop the oldest generations beyond the cap
  const all = await listHistory();
  await Promise.all(all.slice(MAX_HISTORY).map((old) => deleteHistoryItem(old.id)));
}

export const getCustomAvatar = (gender: 'F' | 'M') => run<CustomAvatar | undefined>('avatars', 'readonly', (s) => s.get(gender));
export const saveCustomAvatar = (avatar: CustomAvatar) => run('avatars', 'readwrite', (s) => s.put(avatar));
export const deleteCustomAvatar = (gender: 'F' | 'M') => run('avatars', 'readwrite', (s) => s.delete(gender));
