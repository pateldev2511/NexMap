import { useCallback, useEffect, useRef, useState } from 'react';
import { useProjectStore } from '@/store/projectStore';
import { loadDocument } from '@/model/migrate';
import { SCHEMA_VERSION } from '@/model/schema';
import {
  canWriteBack,
  openWithPicker,
  saveDocument,
  type FsFileHandle,
} from './fsaccess';
import { acquireWriter } from './locks';
import {
  deleteDraft,
  getLatestDraft,
  makeDraft,
  putDraft,
  type DraftRecord,
} from './draft';

export type AutosaveStatus = 'idle' | 'saving' | 'saved' | 'error' | 'readonly';

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
  save(): Promise<void>;
  saveAs(): Promise<void>;
  open(): Promise<void>;
  openText(text: string): void;
  recover(): void;
  discardDraft(): void;
}

const AUTOSAVE_DEBOUNCE_MS = 800;

function fmtTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

/**
 * Orchestrates all persistence (eng review M4): debounced IndexedDB autosave gated
 * on the Web Locks writer role, crash recovery on launch, and `.nexmap` save/open
 * with the FS Access write-back path plus download fallback.
 */
export function usePersistence(): Persistence {
  const store = useProjectStore.getState;
  const [status, setStatus] = useState<AutosaveStatus>('idle');
  const [lastSavedAt, setLastSavedAt] = useState<string | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [readOnly, setReadOnly] = useState(false);
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

  const handleRef = useRef<FsFileHandle | null>(null);
  const genRef = useRef(0);
  const readOnlyRef = useRef(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Acquire the writer role; read-only if another tab holds it.
  useEffect(() => {
    const release = acquireWriter((isWriter) => {
      readOnlyRef.current = !isWriter;
      setReadOnly(!isWriter);
      if (!isWriter) setStatus('readonly');
    });
    return release;
  }, []);

  // Check for a recoverable draft once, at launch.
  useEffect(() => {
    let cancelled = false;
    void getLatestDraft().then((draft) => {
      if (!cancelled && draft && (draft.deviceCount > 0 || draft.doc.links.length > 0)) {
        setRecoverable(draft);
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // Debounced autosave on any model change, gated on the writer role.
  useEffect(() => {
    const unsub = useProjectStore.subscribe((s, prev) => {
      if (s.rev === prev.rev) return;
      if (readOnlyRef.current) return;
      if (timerRef.current) clearTimeout(timerRef.current);
      setStatus('saving');
      timerRef.current = setTimeout(async () => {
        genRef.current += 1;
        const draft = makeDraft(
          store().getDocument(),
          genRef.current,
          new Date().toISOString(),
        );
        const result = await putDraft(draft);
        if (result.ok) {
          setStatus('saved');
          setLastSavedAt(draft.updatedAt);
          setError(null);
        } else {
          setStatus('error');
          setError(result.message);
        }
      }, AUTOSAVE_DEBOUNCE_MS);
    });
    return () => {
      unsub();
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [store]);

  const writeFile = useCallback(
    async (forcePicker: boolean) => {
      try {
        const result = await saveDocument(
          store().getDocument(),
          forcePicker ? null : handleRef.current,
        );
        handleRef.current = result.handle;
        setFileName(result.fileName);
        store().markSaved();
        setError(null);
      } catch (e) {
        // User cancelling the picker throws AbortError — not an error to surface.
        if ((e as DOMException)?.name !== 'AbortError') {
          setError((e as Error).message ?? 'Save failed.');
        }
      }
    },
    [store],
  );

  const save = useCallback(
    () => writeFile(!canWriteBack || !handleRef.current),
    [writeFile],
  );
  const saveAs = useCallback(() => writeFile(true), [writeFile]);

  const openText = useCallback(
    (text: string) => {
      const result = loadDocument(text);
      if (result.ok) {
        store().loadDoc(result.doc);
        handleRef.current = null;
        setFileName(null);
        setRecoverable(null);
        noticeIfMigrated(result.migratedFrom);
      } else {
        setError(result.message);
      }
    },
    [store],
  );

  const open = useCallback(async () => {
    try {
      const opened = await openWithPicker();
      if (!opened) return; // caller falls back to a file input
      const result = loadDocument(opened.text);
      if (result.ok) {
        store().loadDoc(result.doc);
        handleRef.current = opened.handle;
        setFileName(opened.fileName);
        setRecoverable(null);
        noticeIfMigrated(result.migratedFrom);
      } else {
        setError(result.message);
      }
    } catch (e) {
      if ((e as DOMException)?.name !== 'AbortError') {
        setError((e as Error).message ?? 'Open failed.');
      }
    }
  }, [store]);

  const recover = useCallback(() => {
    if (recoverable) {
      store().loadDoc(recoverable.doc);
      setRecoverable(null);
    }
  }, [recoverable, store]);

  const discardDraft = useCallback(() => {
    if (recoverable) void deleteDraft(recoverable.projectId);
    setRecoverable(null);
  }, [recoverable]);

  return {
    status,
    lastSavedAt: lastSavedAt ? fmtTime(lastSavedAt) : null,
    fileName,
    readOnly,
    error,
    notice,
    dismissNotice: () => setNotice(null),
    recoverable,
    save,
    saveAs,
    open,
    openText,
    recover,
    discardDraft,
  };
}
