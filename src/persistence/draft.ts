/**
 * Autosave draft envelope + IndexedDB persistence (eng review DA-E3/E4, DA-P3).
 *
 * A draft is one atomic IndexedDB record per project. IndexedDB `put` is atomic
 * per transaction, so a write either fully lands or aborts leaving the prior good
 * record intact — that is the "write-new-then-swap, never overwrite in place"
 * guarantee (E3) and partial-write safety (E4). On QuotaExceededError the txn
 * aborts and we surface it rather than corrupting state.
 *
 * The envelope construction is pure and unit-tested; the IndexedDB glue is thin
 * and verified in-browser (jsdom has no real IndexedDB).
 */
import type { NexMapDocument } from '@/model/types';

export interface DraftRecord {
  projectId: string;
  name: string;
  generation: number;
  updatedAt: string;
  deviceCount: number;
  doc: NexMapDocument;
}

export function makeDraft(
  doc: NexMapDocument,
  generation: number,
  now: string,
): DraftRecord {
  return {
    projectId: doc.project.id,
    name: doc.project.name,
    generation,
    updatedAt: now,
    deviceCount: doc.devices.length,
    doc,
  };
}

/** A draft is worth offering for recovery if it has content. */
export function isRecoverable(draft: DraftRecord | null): draft is DraftRecord {
  return draft !== null && (draft.deviceCount > 0 || draft.doc.links.length > 0);
}

const DB_NAME = 'nexmap';
const DB_VERSION = 1;
const STORE = 'drafts';

let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB unavailable'));
      return;
    }
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: 'projectId' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('IndexedDB open failed'));
  });
  return dbPromise;
}

export type SaveResult =
  | { ok: true }
  | { ok: false; reason: 'quota' | 'unavailable' | 'error'; message: string };

/** Atomically persist a draft. Old record survives if this write fails. */
export async function putDraft(draft: DraftRecord): Promise<SaveResult> {
  let db: IDBDatabase;
  try {
    db = await openDb();
  } catch {
    return { ok: false, reason: 'unavailable', message: 'Autosave unavailable (IndexedDB).' };
  }
  return new Promise((resolve) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).put(draft);
    tx.oncomplete = () => resolve({ ok: true });
    tx.onabort = () => {
      const err = tx.error;
      const quota = err?.name === 'QuotaExceededError';
      resolve({
        ok: false,
        reason: quota ? 'quota' : 'error',
        message: quota
          ? 'Local storage is full — autosave paused. Export your project to keep it safe.'
          : (err?.message ?? 'Autosave failed.'),
      });
    };
  });
}

/** Most-recently-updated draft, or null. Used for crash recovery on launch. */
export async function getLatestDraft(): Promise<DraftRecord | null> {
  let db: IDBDatabase;
  try {
    db = await openDb();
  } catch {
    return null;
  }
  return new Promise((resolve) => {
    const tx = db.transaction(STORE, 'readonly');
    const req = tx.objectStore(STORE).getAll();
    req.onsuccess = () => {
      const all = (req.result as DraftRecord[]) ?? [];
      all.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
      resolve(all[0] ?? null);
    };
    req.onerror = () => resolve(null);
  });
}

export async function deleteDraft(projectId: string): Promise<void> {
  let db: IDBDatabase;
  try {
    db = await openDb();
  } catch {
    return;
  }
  await new Promise<void>((resolve) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).delete(projectId);
    tx.oncomplete = () => resolve();
    tx.onabort = () => resolve();
  });
}
