import type { BattleSaveState } from './battleRecording';

const databaseName = 'aegis-cmo-checkpoints';
const storeName = 'checkpoints';
const current = 'autosave';
let opened: Promise<IDBDatabase> | undefined;

function openDatabase(): Promise<IDBDatabase> {
  if (!opened) {
    opened = new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open(databaseName, 1);
      request.onupgradeneeded = () => request.result.createObjectStore(storeName);
      request.onsuccess = () => {
        const db = request.result;
        db.onversionchange = () => { db.close(); opened = undefined; };
        resolve(db);
      };
      request.onerror = () => reject(request.error ?? new Error('无法打开自动存档库'));
      request.onblocked = () => reject(new Error('其他页面正在使用自动存档库'));
    }).catch((error: unknown) => { opened = undefined; throw error; });
  }
  return opened;
}

export async function writeAutosave(save: BattleSaveState): Promise<void> {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(storeName, 'readwrite');
    transaction.oncomplete = () => resolve();
    transaction.onabort = () => reject(transaction.error ?? new Error('自动存档写入中止'));
    transaction.objectStore(storeName).put(save, current);
  });
}

export async function readAutosave(): Promise<unknown> {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const request = db.transaction(storeName, 'readonly').objectStore(storeName).get(current);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('无法读取自动存档'));
  });
}
