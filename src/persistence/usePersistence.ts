import { useCallback, useEffect, useRef, useState } from 'react';
import {
  onBeforeDocumentSwap,
  useProjectStore,
  type ProjectStore,
} from '@/store/projectStore';
import { loadDocument, loadRepairSummary, migrateDocument } from '@/model/migrate';
import { SCHEMA_VERSION } from '@/model/schema';
import { prefsPersistent } from '@/lib/prefs';
import {
  canWriteBack,
  openWithPicker,
  saveDocument,
  type FsFileHandle,
  type OpenedFile,
} from './fsaccess';
import { acquireWriter } from './locks';
import {
  absorbStashedDraft,
  deleteDraft,
  readDraft,
  readLatestDraft,
  makeDraft,
  putDraft,
  readStashedDraft,
  stashDraftSync,
  type DraftRecord,
} from './draft';

export type AutosaveStatus = 'idle' | 'saving' | 'saved' | 'error' | 'readonly';

/**
 * Asked before a different document replaces the open one. Resolves true to go
 * ahead (nothing unsaved, or the user saved / chose to discard), false to keep
 * the open project exactly as it is.
 */
export type ConfirmReplace = () => Promise<boolean>;

/** A file read and ready to open; `handle` only when it came from the native picker. */
export type PickedFile = Pick<OpenedFile, 'text'> & {
  handle: FsFileHandle | null;
  fileName: string | null;
};

export interface Persistence {
  status: AutosaveStatus;
  lastSavedAt: string | null;
  fileName: string | null;
  readOnly: boolean;
  error: string | null;
  /** Informational notice (e.g. an opened file was upgraded to a newer schema). */
  notice: string | null;
  dismissNotice(): void;
  /** Draft found at launch, awaiting the recovery decision. */
  recoverable: DraftRecord | null;
  /** Save to this document's file (or pick one). Resolves whether the document is now saved. */
  save(): Promise<boolean>;
  saveAs(): Promise<boolean>;
  /** Native picker. null when cancelled or failed (the error is surfaced). */
  pickFile(): Promise<PickedFile | null>;
  /**
   * Validate a file and, if it's sound and `confirm` agrees, make it the open
   * document. An invalid file is refused BEFORE anything is asked or replaced.
   */
  openFile(file: PickedFile, confirm?: ConfirmReplace): Promise<boolean>;
  /** openFile for text with no file handle (file-input fallback, first-run open). */
  openText(text: string, confirm?: ConfirmReplace): Promise<boolean>;
  recover(): boolean;
  discardDraft(): void;
  /** Forget the edit still waiting in the autosave debounce (the user chose Discard). */
  dropPendingAutosave(): void;
}

const AUTOSAVE_DEBOUNCE_MS = 800;

/** The resting status once nothing is pending. */
function settled(lastSavedAt: string | null): AutosaveStatus {
  return lastSavedAt ? 'saved' : 'idle';
}

function fmtTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

/** The slice of store state the saved document is built from. */
type DocumentState = Pick<ProjectStore, 'rev' | 'invariantsEnabled' | 'customRules' | 'rulesEnforced'>;

/**
 * Whether a store update changed what gets saved. The diagram bumps `rev`; the
 * declared rules (schema v6/v7) live beside the model and change without a rev
 * bump, so they're compared by reference too — otherwise declaring a rule wasn't
 * autosaved until the next diagram edit.
 */
export function documentChanged(s: DocumentState, prev: DocumentState): boolean {
  return (
    s.rev !== prev.rev ||
    s.invariantsEnabled !== prev.invariantsEnabled ||
    s.customRules !== prev.customRules ||
    s.rulesEnforced !== prev.rulesEnforced
  );
}

/** The file a document is bound to. Bound to ONE identity: New/Open/template drop it. */
interface FileBinding {
  identity: number;
  handle: FsFileHandle | null;
  fileName: string;
}

/**
 * Orchestrates all persistence (eng review M4): debounced IndexedDB autosave gated
 * on the Web Locks writer role, crash recovery on launch, and `.nexmap` save/open
 * with the FS Access write-back path plus download fallback.
 *
 * Document lifecycle (#17, #18, #19, #53): the store's `docIdentity` names the
 * open document and `docRevision` its exact state. The file binding belongs to
 * one identity, so a different document can never write into the previous one's
 * file; a save marks clean only the identity + revision it serialized; a pending
 * autosave is flushed before the document is swapped and on page hide, with a
 * synchronous localStorage stash for the unload case IndexedDB can't guarantee.
 */
export function usePersistence(): Persistence {
  const store = useProjectStore.getState;
  const readOnly = useProjectStore((s) => s.readOnly);
  const [status, setStatus] = useState<AutosaveStatus>('idle');
  const [lastSavedAt, setLastSavedAt] = useState<string | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [recoverable, setRecoverable] = useState<DraftRecord | null>(null);

  /** Inform the user when an opened file was upgraded to a newer schema (forward-only). */
  function noticeIfMigrated(migratedFrom: number | undefined) {
    if (migratedFrom == null) return;
    setNotice(
      `Upgraded this file from schema v${migratedFrom} to v${SCHEMA_VERSION}. ` +
        `Older NexMap builds won't open it once you save — keep a copy of the original if you need it.`,
    );
  }

  /**
   * Tell the user what a load had to repair (a removed outside image, a limited
   * rack height…). Without this the repair is silent and the next autosave makes
   * it permanent. `join` keeps the notice the same load just raised (upgraded, took over).
   */
  function noticeRepairs(
    result: { warnings?: string[]; repairs?: number },
    verb: string,
    join: boolean,
  ) {
    const summary = loadRepairSummary(result, verb);
    if (summary) setNotice((prev) => (join && prev ? `${summary} ${prev}` : summary));
  }

  const fileRef = useRef<FileBinding | null>(null);
  const genRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** The document identity whose edit is waiting in the debounce, if any. */
  const pendingRef = useRef<{ identity: number } | null>(null);
  /** The newest draft whose IndexedDB write hasn't been confirmed (in flight or failed). */
  const unconfirmedRef = useRef<DraftRecord | null>(null);
  const lastSavedRef = useRef<string | null>(null);
  /**
   * The saved state this tab's document was taken from — the draft's updatedAt
   * when recovered, else when it was loaded. On takeover (#24) a newer draft of
   * the same project means the other tab kept working.
   */
  const baselineRef = useRef<string>(new Date().toISOString());
  /** A document change arrived while read-only (it couldn't be autosaved). */
  const skippedRef = useRef(false);
  const recoverableRef = useRef<DraftRecord | null>(null);
  recoverableRef.current = recoverable;
  const saveChainRef = useRef<Promise<unknown>>(Promise.resolve());

  /** Write a draft to IndexedDB, tracking it as unconfirmed until it lands. */
  const writeDraft = useCallback(async (draft: DraftRecord) => {
    unconfirmedRef.current = draft;
    const result = await putDraft(draft);
    if (result.ok && unconfirmedRef.current === draft) unconfirmedRef.current = null;
    if (pendingRef.current) return; // a newer edit is queued — still "Saving…"
    if (result.ok) {
      lastSavedRef.current = draft.updatedAt;
      setLastSavedAt(draft.updatedAt);
      setStatus(store().readOnly ? 'readonly' : 'saved');
      setError(null);
    } else {
      setStatus('error');
      setError(result.message);
    }
  }, [store]);

  /**
   * Serialize the pending edit NOW (synchronously — the caller may be about to
   * swap the document or unload) and start its write.
   */
  const flushPending = useCallback(() => {
    const pending = pendingRef.current;
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = null;
    pendingRef.current = null;
    if (!pending || store().docIdentity !== pending.identity) return;
    genRef.current += 1;
    const draft = makeDraft(store().getDocument(), genRef.current, new Date().toISOString());
    void writeDraft(draft);
  }, [store, writeDraft]);

  const schedule = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    pendingRef.current = { identity: store().docIdentity };
    setStatus('saving');
    timerRef.current = setTimeout(flushPending, AUTOSAVE_DEBOUNCE_MS);
  }, [flushPending, store]);

  const dropPendingAutosave = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = null;
    pendingRef.current = null;
    setStatus(store().readOnly ? 'readonly' : settled(lastSavedRef.current));
  }, [store]);

  /** Bind the just-loaded document to its file (or to none). */
  const bindFile = useCallback(
    (handle: FsFileHandle | null, name: string | null) => {
      if (name) {
        fileRef.current = { identity: store().docIdentity, handle, fileName: name };
        setFileName(name);
      } else {
        fileRef.current = null;
        setFileName(null);
      }
    },
    [store],
  );

  /**
   * Takeover (#24): this tab just became the writer. It couldn't edit while
   * read-only, so the latest autosave of the same project (the other tab kept
   * working) is adopted; a change made here anyway is autosaved instead.
   */
  const takeOver = useCallback(async () => {
    setStatus(settled(lastSavedRef.current));
    if (skippedRef.current) {
      skippedRef.current = false;
      schedule();
      return;
    }
    // Still deciding on recovery: offer the newest draft, not the one seen at launch.
    if (recoverableRef.current) {
      const read = await readLatestDraft();
      if (read.ok && read.value) setRecoverable(read.value);
      return;
    }
    const s = store();
    const identity = s.docIdentity;
    const projectId = s.getDocument().project.id;
    const stash = readStashedDraft();
    const storedRead = await readDraft(projectId);
    if (!storedRead.ok) return; // can't tell what the other tab saved — change nothing
    const stored = storedRead.value;
    const latest =
      stash?.projectId === projectId && (!stored || stash.updatedAt > stored.updatedAt)
        ? stash
        : stored;
    if (!latest || latest.updatedAt <= baselineRef.current) return;
    if (store().docIdentity !== identity || store().readOnly) return; // moved on meanwhile
    const result = migrateDocument(latest.doc);
    if (!result.ok) return;
    const binding = fileRef.current;
    store().loadDoc(result.doc);
    baselineRef.current = latest.updatedAt;
    if (binding?.identity === identity) bindFile(binding.handle, binding.fileName);
    setNotice('You can edit in this tab now. It has the latest autosave from the other tab.');
    noticeRepairs(result, 'Loaded', true);
    // noticeRepairs only calls a state setter.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bindFile, schedule, store]);

  // Acquire the writer role; read-only if another tab holds it.
  useEffect(() => {
    const release = acquireWriter((isWriter) => {
      const wasReadOnly = store().readOnly;
      store().setReadOnly(!isWriter);
      if (!isWriter) {
        // Nothing this tab does from here on may be written over the writer's draft.
        if (timerRef.current) clearTimeout(timerRef.current);
        timerRef.current = null;
        pendingRef.current = null;
        setStatus('readonly');
      } else if (wasReadOnly) {
        void takeOver();
      }
    });
    return release;
  }, [store, takeOver]);

  // Check for a recoverable draft once, at launch (after folding in any unload stash).
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      await absorbStashedDraft();
      const read = await readLatestDraft();
      if (cancelled) return;
      if (!read.ok) {
        setNotice(
          "Couldn't read autosaved drafts in this browser — if you had unsaved work, reload to try again.",
        );
      } else if (read.value) {
        setRecoverable(read.value);
      }
    })();
    if (!prefsPersistent()) {
      setNotice(
        "This browser is blocking site storage, so settings won't be remembered and " +
          'autosave may be off. Save a .nexmap file to keep your work.',
      );
    }
    return () => {
      cancelled = true;
    };
  }, []);

  // Debounced autosave on any document change, gated on the writer role.
  useEffect(() => {
    const unsub = useProjectStore.subscribe((s, prev) => {
      const swapped = s.docIdentity !== prev.docIdentity;
      if (swapped) {
        // A different document: its file binding (if any) is set by whoever loaded
        // it, right after loadDoc — never inherited from the previous document.
        if (fileRef.current && fileRef.current.identity !== s.docIdentity) {
          fileRef.current = null;
          setFileName(null);
        }
        baselineRef.current = new Date().toISOString();
      }
      if (!documentChanged(s, prev)) return;
      if (s.readOnly) {
        if (!swapped) skippedRef.current = true;
        return;
      }
      schedule();
    });
    // The outgoing document's pending edit is serialized before the swap.
    const unswap = onBeforeDocumentSwap(flushPending);
    return () => {
      unsub();
      unswap();
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [flushPending, schedule]);

  // Page lifecycle (#53): flush a pending edit when the page is hidden or unloads.
  useEffect(() => {
    /** The newest edit not yet confirmed in IndexedDB, flushing a pending one first. */
    const unconfirmed = (): DraftRecord | null => {
      if (pendingRef.current) flushPending();
      return unconfirmedRef.current;
    };
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') flushPending();
    };
    const onPageHide = () => {
      const draft = unconfirmed();
      if (draft) stashDraftSync(draft);
    };
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      const draft = unconfirmed();
      // The IndexedDB write may not finish before teardown; the sync stash is the
      // safety net. If even that fails, ask before leaving instead of losing it.
      if (draft && !stashDraftSync(draft)) {
        e.preventDefault();
        e.returnValue = '';
      }
    };
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('pagehide', onPageHide);
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('pagehide', onPageHide);
      window.removeEventListener('beforeunload', onBeforeUnload);
    };
  }, [flushPending]);

  const writeFile = useCallback(
    (forcePicker: boolean): Promise<boolean> => {
      const run = async (): Promise<boolean> => {
        // Capture exactly what this save writes: which document, at which revision.
        const s = store();
        const identity = s.docIdentity;
        const revision = s.docRevision;
        const doc = s.getDocument();
        const bound = fileRef.current?.identity === identity ? fileRef.current : null;
        const handle = !forcePicker && canWriteBack && bound?.handle ? bound.handle : null;
        try {
          const result = await saveDocument(doc, handle);
          if (store().docIdentity !== identity) {
            // The project changed while the picker or write was pending: the file
            // holds the project that was open when Save began. Don't bind it to,
            // or mark clean, the one open now.
            setNotice(`Saved “${doc.project.name}” to ${result.fileName}.`);
            return false;
          }
          fileRef.current = { identity, handle: result.handle, fileName: result.fileName };
          setFileName(result.fileName);
          setError(null);
          // Edits made while the write was pending keep the document dirty.
          return store().markSaved({ identity, revision });
        } catch (e) {
          // User cancelling the picker throws AbortError — not an error to surface.
          if ((e as DOMException)?.name !== 'AbortError') {
            setError((e as Error).message ?? 'Save failed.');
          }
          return false;
        }
      };
      // Saves run one at a time, in order, so an older write can't land last.
      const next = saveChainRef.current.then(run, run);
      saveChainRef.current = next.catch(() => undefined);
      return next;
    },
    [store],
  );

  const save = useCallback(() => writeFile(false), [writeFile]);
  const saveAs = useCallback(() => writeFile(true), [writeFile]);

  const pickFile = useCallback(async (): Promise<PickedFile | null> => {
    try {
      return await openWithPicker();
    } catch (e) {
      if ((e as DOMException)?.name !== 'AbortError') {
        setError((e as Error).message ?? 'Open failed.');
      }
      return null;
    }
  }, []);

  const openFile = useCallback(
    async (file: PickedFile, confirm?: ConfirmReplace): Promise<boolean> => {
      if (store().readOnly) return false;
      // Validate first: a bad file is refused without asking or touching anything.
      const result = loadDocument(file.text);
      if (!result.ok) {
        setError(result.message);
        return false;
      }
      if (confirm && !(await confirm())) return false;
      store().loadDoc(result.doc);
      bindFile(file.handle, file.handle ? file.fileName : null);
      setRecoverable(null);
      setError(null);
      noticeIfMigrated(result.migratedFrom);
      noticeRepairs(result, 'Opened', result.migratedFrom != null);
      return true;
    },
    // noticeIfMigrated only calls a state setter.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [bindFile, store],
  );

  const openText = useCallback(
    (text: string, confirm?: ConfirmReplace) =>
      openFile({ text, handle: null, fileName: null }, confirm),
    [openFile],
  );

  const recover = useCallback((): boolean => {
    if (!recoverable) return false;
    // Drafts can predate the current schema too: migrate + validate like a file.
    const result = migrateDocument(recoverable.doc);
    if (!result.ok) {
      setError(`This draft can't be recovered — ${result.message}`);
      return false;
    }
    store().loadDoc(result.doc);
    baselineRef.current = recoverable.updatedAt;
    setRecoverable(null);
    noticeRepairs(result, 'Recovered', false);
    return true;
    // noticeRepairs only calls a state setter.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recoverable, store]);

  const discardDraft = useCallback(() => {
    // The draft belongs to the tab that's writing it; a read-only tab can't delete it.
    if (store().readOnly) {
      setNotice('This project is open in another tab. Close it to discard the draft here.');
      return;
    }
    if (recoverable) void deleteDraft(recoverable.projectId);
    setRecoverable(null);
  }, [recoverable, store]);

  return {
    status: readOnly ? 'readonly' : status,
    lastSavedAt: lastSavedAt ? fmtTime(lastSavedAt) : null,
    fileName,
    readOnly,
    error,
    notice,
    dismissNotice: () => setNotice(null),
    recoverable,
    save,
    saveAs,
    pickFile,
    openFile,
    openText,
    recover,
    discardDraft,
    dropPendingAutosave,
  };
}
