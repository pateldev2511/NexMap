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
import { readPref, removePref, writePref } from '@/lib/prefs';

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

/** One kind of saved work in a document, for the recovery summary. */
export interface WorkPart {
  count: number;
  /** Singular noun; the caller pluralizes. */
  noun: string;
}

const len = (v: unknown): number => (Array.isArray(v) ? v.length : 0);

/**
 * What a document holds, as non-zero counts in reading order. This is THE
 * "meaningful work" rule (#20), shared by the launch recovery check and the
 * recovery prompt: a rack-only or annotation-only project is real work even with
 * zero devices. Defensive (`len`) because a draft can come from an older build.
 */
export function workSummary(doc: NexMapDocument): WorkPart[] {
  const objects = Array.isArray(doc.objects) ? doc.objects : [];
  const byKind = (k: string) => objects.filter((o) => o?.kind === k).length;
  const parts: WorkPart[] = [
    { count: len(doc.devices), noun: 'device' },
    { count: len(doc.links), noun: 'link' },
    { count: len(doc.racks), noun: 'rack' },
    { count: len(doc.rackCables), noun: 'cable' },
    { count: byKind('text'), noun: 'note' },
    { count: byKind('shape'), noun: 'shape' },
    { count: byKind('image'), noun: 'image' },
    { count: len(doc.subnets), noun: 'subnet' },
    { count: len(doc.vlans), noun: 'VLAN' },
    { count: len(doc.invariants) + len(doc.customRules), noun: 'rule' },
  ];
  return parts.filter((p) => p.count > 0);
}

export function hasMeaningfulWork(doc: NexMapDocument | null | undefined): boolean {
  return !!doc && typeof doc === 'object' && workSummary(doc).length > 0;
}

/** "1 rack · 3 notes" — the counts the recovery prompt shows. */
export function describeWork(doc: NexMapDocument): string {
  return workSummary(doc)
    .map((p) => `${p.count} ${p.noun}${p.count === 1 ? '' : 's'}`)
    .join(' · ');
}

/**
 * Which designer a document opened from the launch screen (#23) lands in: the
 * Rack designer when everything in it lives in racks, else the Network designer.
 */
export function designerFor(doc: NexMapDocument): 'network' | 'rack' {
  const onCanvas =
    doc.devices.some((d) => !d.rackId) ||
    doc.links.length > 0 ||
    (doc.objects ?? []).some((o) => o.kind !== 'text' || !o.rackScope);
  return !onCanvas && len(doc.racks) > 0 ? 'rack' : 'network';
}

/** A draft is worth offering for recovery if it has meaningful work. */
export function isRecoverable(draft: DraftRecord | null | undefined): draft is DraftRecord {
  return !!draft && hasMeaningfulWork(draft.doc);
}

/**
 * The newest recoverable draft. Eligibility is tested BEFORE recency: a blank
 * project autosaved after a real one (New, then reload) must not hide it.
 */
export function pickRecoverable(all: readonly DraftRecord[]): DraftRecord | null {
  return (
    all
      .filter(isRecoverable)
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0] ?? null
  );
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
    return {
      ok: false,
      reason: 'unavailable',
      message: 'Autosave unavailable (IndexedDB).',
    };
  }
  return new Promise((resolve) => {
    const failed = (err: DOMException | Error | null | undefined) => {
      const quota = err?.name === 'QuotaExceededError';
      resolve({
        ok: false,
        reason: quota ? 'quota' : 'error',
        message: quota
          ? 'Local storage is full — autosave paused. Export your project to keep it safe.'
          : (err?.message ?? 'Autosave failed.'),
      });
    };
    // transaction()/put() throw synchronously on a closing DB or an uncloneable
    // value; that must report a failed autosave, not leave it "Saving…" forever.
    try {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).put(draft);
      tx.oncomplete = () => resolve({ ok: true });
      tx.onabort = () => failed(tx.error);
    } catch (e) {
      failed(e as Error);
    }
  });
}

function readAll(db: IDBDatabase): Promise<DraftRecord[]> {
  return new Promise((resolve) => {
    try {
      const req = db.transaction(STORE, 'readonly').objectStore(STORE).getAll();
      req.onsuccess = () =>
        resolve(((req.result as DraftRecord[]) ?? []).filter((d) => d && typeof d === 'object'));
      req.onerror = () => resolve([]);
    } catch {
      resolve([]);
    }
  });
}

/** Newest recoverable draft (see pickRecoverable), or null. Crash recovery on launch. */
export async function getLatestDraft(): Promise<DraftRecord | null> {
  let db: IDBDatabase;
  try {
    db = await openDb();
  } catch {
    return null;
  }
  return pickRecoverable(await readAll(db));
}

/** One project's draft (any content), or null. */
export async function getDraft(projectId: string): Promise<DraftRecord | null> {
  let db: IDBDatabase;
  try {
    db = await openDb();
  } catch {
    return null;
  }
  return new Promise((resolve) => {
    try {
      const req = db.transaction(STORE, 'readonly').objectStore(STORE).get(projectId);
      req.onsuccess = () => resolve((req.result as DraftRecord | undefined) ?? null);
      req.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
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
    try {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).delete(projectId);
      tx.oncomplete = () => resolve();
      tx.onabort = () => resolve();
    } catch {
      resolve();
    }
  });
}

/*
 * Unload stash (#53). An IndexedDB write started in `pagehide` may never commit
 * once the page is torn down, so the edit still inside the autosave debounce is
 * also written SYNCHRONOUSLY to localStorage. The next launch folds it back into
 * IndexedDB (absorbStashedDraft) when it's newer than that project's record. If
 * the stash can't be written (storage blocked or full), the caller warns before
 * unload instead of dropping the edit silently.
 */
const STASH_KEY = 'nexmap.pendingDraft';

/** Write a draft synchronously. Returns false if it didn't reach real storage. */
export function stashDraftSync(draft: DraftRecord): boolean {
  let json: string;
  try {
    json = JSON.stringify(draft);
  } catch {
    return false;
  }
  return writePref(STASH_KEY, json);
}

export function readStashedDraft(): DraftRecord | null {
  const raw = readPref(STASH_KEY);
  if (!raw) return null;
  try {
    const d = JSON.parse(raw) as DraftRecord;
    return d &&
      typeof d.projectId === 'string' &&
      typeof d.updatedAt === 'string' &&
      d.doc &&
      typeof d.doc === 'object'
      ? d
      : null;
  } catch {
    return null;
  }
}

export function clearStashedDraft(): void {
  removePref(STASH_KEY);
}

/**
 * Fold a stash left by an unload back into IndexedDB, if it's newer than what
 * IndexedDB has for that project. Cleared once IndexedDB holds the newer copy.
 */
export async function absorbStashedDraft(): Promise<void> {
  const stash = readStashedDraft();
  if (!stash) {
    clearStashedDraft(); // unreadable leftovers
    return;
  }
  const current = await getDraft(stash.projectId);
  if (current && current.updatedAt >= stash.updatedAt) {
    clearStashedDraft();
    return;
  }
  const result = await putDraft(stash);
  if (result.ok) clearStashedDraft();
}
