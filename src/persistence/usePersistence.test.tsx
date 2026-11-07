/**
 * Document lifecycle (#17, #18, #19, #24, #53): the file binding belongs to one
 * document identity, a save marks clean only the revision it wrote, a replace is
 * confirmed after the file validates, a pending autosave is flushed before a
 * swap or unload, and a read-only tab neither writes nor deletes drafts.
 *
 * jsdom has no IndexedDB, so the draft store's IO is mocked (its pure parts are
 * real); the File System Access picker and handles are faked in memory.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { DraftRecord } from './draft';

const h = vi.hoisted(() => {
  const state = {
    picker: (async () => {
      throw new Error('no picker set');
    }) as (opts?: unknown) => Promise<unknown>,
    writer: null as null | ((isWriter: boolean) => void),
  };
  // Present before fsaccess loads, so canWriteBack is true (a Chromium-like browser).
  (globalThis as unknown as { showSaveFilePicker: unknown }).showSaveFilePicker = (o: unknown) =>
    state.picker(o);
  return state;
});

vi.mock('./locks', () => ({
  acquireWriter: (cb: (isWriter: boolean) => void) => {
    h.writer = cb;
    return () => {};
  },
}));

vi.mock('./draft', async (importOriginal) => {
  const real = await importOriginal<typeof import('./draft')>();
  return {
    ...real,
    putDraft: vi.fn(async () => ({ ok: true as const })),
    getLatestDraft: vi.fn(async () => null),
    getDraft: vi.fn(async () => null),
    deleteDraft: vi.fn(async () => {}),
    absorbStashedDraft: vi.fn(async () => {}),
    stashDraftSync: vi.fn(() => true),
    readStashedDraft: vi.fn(() => null),
  };
});

import * as draft from './draft';
import { usePersistence } from './usePersistence';
import { useProjectStore } from '@/store/projectStore';
import { createEmptyDocument, SCHEMA_VERSION } from '@/model/schema';

const NOW = '2026-01-01T00:00:00.000Z';
const s = () => useProjectStore.getState();
const putDraft = vi.mocked(draft.putDraft);

/** In-memory disk: file name → bytes, written on close (like a real writable). */
const disk = new Map<string, string>();
function fakeHandle(name: string, gate?: Promise<void>) {
  return {
    name,
    async createWritable() {
      let buf = '';
      return {
        async write(d: string) {
          buf = d;
        },
        async close() {
          if (gate) await gate;
          disk.set(name, buf);
        },
      };
    },
    async getFile() {
      return new File([disk.get(name) ?? ''], name);
    },
  };
}

function rename(to: string) {
  act(() => s().renameProject(s().projectName, to));
}

function render() {
  const view = renderHook(() => usePersistence());
  act(() => h.writer?.(true));
  return view;
}

function docText(name: string): string {
  const doc = createEmptyDocument(NOW);
  doc.project = { ...doc.project, name };
  return JSON.stringify(doc);
}

beforeEach(() => {
  disk.clear();
  vi.clearAllMocks();
  act(() => {
    s().newProject(NOW);
    s().setReadOnly(false);
  });
});
afterEach(() => {
  vi.useRealTimers();
});

describe('file identity (#17)', () => {
  it('Save A → New → Save asks for a new file and leaves A byte-for-byte', async () => {
    const { result } = render();
    rename('Branch office');
    h.picker = vi.fn(async () => fakeHandle('A.nexmap'));
    await act(() => result.current.save());
    const a = disk.get('A.nexmap')!;
    expect(a).toContain('"name": "Branch office"');
    expect(result.current.fileName).toBe('A.nexmap');

    act(() => s().newProject(NOW));
    expect(result.current.fileName).toBeNull(); // the binding left with project A

    // Cancelling the new picker writes nothing anywhere.
    h.picker = vi.fn(async () => {
      throw new DOMException('cancelled', 'AbortError');
    });
    await act(() => result.current.save());
    expect(h.picker).toHaveBeenCalledTimes(1);
    expect(disk.get('A.nexmap')).toBe(a);

    h.picker = vi.fn(async () => fakeHandle('B.nexmap'));
    await act(() => result.current.save());
    expect(disk.get('A.nexmap')).toBe(a);
    expect(disk.get('B.nexmap')).toContain('"name": "Untitled NexMap Project"');
  });

  it('repeated Save within A writes back to A without a picker', async () => {
    const { result } = render();
    h.picker = vi.fn(async () => fakeHandle('A.nexmap'));
    await act(() => result.current.save());
    rename('Second save');
    await act(() => result.current.save());
    expect(h.picker).toHaveBeenCalledTimes(1);
    expect(disk.get('A.nexmap')).toContain('"name": "Second save"');
    expect(s().dirty).toBe(false);
  });

  it('opening a file from the picker binds it; a template or recovery load drops it', async () => {
    const { result } = render();
    await act(async () => {
      await result.current.openFile({ text: docText('Opened'), handle: fakeHandle('O.nexmap') as never, fileName: 'O.nexmap' });
    });
    expect(result.current.fileName).toBe('O.nexmap');
    act(() => s().loadDoc(createEmptyDocument(NOW))); // e.g. a template pick
    expect(result.current.fileName).toBeNull();
  });
});

describe('save completion is tied to identity + revision (#18)', () => {
  it('an edit made while the write is pending stays unsaved', async () => {
    const { result } = render();
    rename('Branch office');
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    h.picker = vi.fn(async () => fakeHandle('A.nexmap', gate));
    let saving!: Promise<boolean>;
    act(() => {
      saving = result.current.save();
    });
    await waitFor(() => expect(h.picker).toHaveBeenCalled());
    rename('Edited during save');
    release();
    let saved = true;
    await act(async () => {
      saved = await saving;
    });
    expect(saved).toBe(false);
    expect(disk.get('A.nexmap')).toContain('"name": "Branch office"');
    expect(s().projectName).toBe('Edited during save');
    expect(s().dirty).toBe(true);
    // The next save writes the later edit and only then is it clean.
    await act(() => result.current.save());
    expect(disk.get('A.nexmap')).toContain('"name": "Edited during save"');
    expect(s().dirty).toBe(false);
  });

  it('overlapping saves run in order, so the newest content lands last', async () => {
    const { result } = render();
    h.picker = vi.fn(async () => fakeHandle('A.nexmap'));
    await act(() => result.current.save());
    rename('one');
    let p1!: Promise<boolean>, p2!: Promise<boolean>;
    act(() => {
      p1 = result.current.save();
    });
    rename('two');
    act(() => {
      p2 = result.current.save();
    });
    await act(async () => {
      await Promise.all([p1, p2]);
    });
    expect(disk.get('A.nexmap')).toContain('"name": "two"');
    expect(s().dirty).toBe(false);
  });

  it('switching projects while the picker is open does not bind the old save to the new project', async () => {
    const { result } = render();
    rename('Project A');
    let pick!: (h: unknown) => void;
    h.picker = vi.fn(() => new Promise((r) => (pick = r)));
    let saving!: Promise<boolean>;
    act(() => {
      saving = result.current.save();
    });
    await waitFor(() => expect(h.picker).toHaveBeenCalled());
    act(() => s().newProject(NOW)); // project B
    rename('Project B');
    pick(fakeHandle('A.nexmap'));
    await act(async () => {
      expect(await saving).toBe(false);
    });
    expect(disk.get('A.nexmap')).toContain('"name": "Project A"'); // what was open when Save began
    expect(result.current.fileName).toBeNull();
    expect(s().dirty).toBe(true); // B is still unsaved
    // B's own save asks for its own file rather than reusing A's.
    h.picker = vi.fn(async () => fakeHandle('B.nexmap'));
    await act(() => result.current.save());
    expect(h.picker).toHaveBeenCalledTimes(1);
    expect(disk.get('A.nexmap')).toContain('"name": "Project A"');
  });
});

describe('replacing a dirty project (#19, #26)', () => {
  it('a cancelled replace keeps the project, its history and its file', async () => {
    const { result } = render();
    h.picker = vi.fn(async () => fakeHandle('A.nexmap'));
    await act(() => result.current.save());
    rename('Mine');
    const confirm = vi.fn(async () => false);
    let ok = true;
    await act(async () => {
      ok = await result.current.openText(docText('Replacement'), confirm);
    });
    expect(ok).toBe(false);
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(s().projectName).toBe('Mine');
    expect(s().canUndo).toBe(true);
    expect(s().dirty).toBe(true);
    expect(result.current.fileName).toBe('A.nexmap');
  });

  it('an invalid file is refused before anything is asked or replaced', async () => {
    const { result } = render();
    rename('Mine');
    const confirm = vi.fn(async () => true);
    const bad = JSON.stringify({ schemaVersion: SCHEMA_VERSION, project: {}, devices: [], links: [] });
    await act(async () => {
      expect(await result.current.openText(bad, confirm)).toBe(false);
    });
    expect(confirm).not.toHaveBeenCalled();
    expect(result.current.error).toMatch(/project\.id/);
    expect(s().projectName).toBe('Mine');
    expect(s().canUndo).toBe(true);
    await act(async () => {
      expect(await result.current.openText('{ nope', confirm)).toBe(false);
    });
    await act(async () => {
      expect(
        await result.current.openText(
          JSON.stringify({ ...createEmptyDocument(NOW), schemaVersion: SCHEMA_VERSION + 1 }),
          confirm,
        ),
      ).toBe(false);
    });
    expect(confirm).not.toHaveBeenCalled();
    expect(s().projectName).toBe('Mine');
  });

  it('inside the debounce window, a cancelled replace keeps the edit and it still autosaves', async () => {
    vi.useFakeTimers();
    const { result } = render();
    rename('Typed just now');
    await act(async () => {
      await result.current.openText(docText('Replacement'), async () => false);
    });
    await act(async () => {
      vi.advanceTimersByTime(1000);
    });
    expect(putDraft).toHaveBeenCalledTimes(1);
    expect(putDraft.mock.calls[0]![0].name).toBe('Typed just now');
  });

  it('Discard drops the pending autosave instead of flushing it', async () => {
    vi.useFakeTimers();
    const { result } = render();
    rename('Discard me');
    await act(async () => {
      await result.current.openText(docText('Replacement'), async () => {
        result.current.dropPendingAutosave();
        return true;
      });
    });
    expect(s().projectName).toBe('Replacement');
    expect(putDraft.mock.calls.map((c) => c[0].name)).not.toContain('Discard me');
  });
});

describe('pending autosave (#53)', () => {
  it('a document swap flushes the outgoing edit, not the incoming project', async () => {
    vi.useFakeTimers();
    render();
    rename('Last edit');
    const projectId = s().getDocument().project.id;
    await act(async () => s().loadDoc(createEmptyDocument(NOW)));
    expect(putDraft).toHaveBeenCalledTimes(1);
    expect(putDraft.mock.calls[0]![0]).toMatchObject({ projectId, name: 'Last edit' });
  });

  it('hiding the page flushes; unload also stashes synchronously', async () => {
    vi.useFakeTimers();
    render();
    rename('Hidden');
    const vis = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
    await act(async () => {
      document.dispatchEvent(new Event('visibilitychange'));
    });
    vis.mockRestore();
    expect(putDraft).toHaveBeenCalledTimes(1);
    expect(putDraft.mock.calls[0]![0].name).toBe('Hidden');

    rename('Reloaded');
    putDraft.mockImplementationOnce(() => new Promise(() => {})); // torn down mid-write
    act(() => {
      window.dispatchEvent(new Event('pagehide'));
    });
    expect(vi.mocked(draft.stashDraftSync)).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'Reloaded' }),
    );
  });

  it('beforeunload warns only when the pending edit cannot be stashed', async () => {
    vi.useFakeTimers();
    render();
    rename('Unsaved');
    const ok = new Event('beforeunload', { cancelable: true });
    await act(async () => {
      window.dispatchEvent(ok);
    });
    expect(ok.defaultPrevented).toBe(false);

    rename('Still unsaved');
    putDraft.mockImplementationOnce(() => new Promise(() => {})); // never commits
    vi.mocked(draft.stashDraftSync).mockReturnValueOnce(false);
    const warn = new Event('beforeunload', { cancelable: true });
    act(() => {
      window.dispatchEvent(warn);
    });
    expect(warn.defaultPrevented).toBe(true);
  });

  it('a failed write is reported and still stashed on unload', async () => {
    vi.useFakeTimers();
    const { result } = render();
    putDraft.mockResolvedValueOnce({ ok: false, reason: 'error', message: 'disk said no' });
    rename('Will fail');
    await act(async () => {
      vi.advanceTimersByTime(1000);
    });
    expect(result.current.status).toBe('error');
    expect(result.current.error).toBe('disk said no');
    act(() => {
      window.dispatchEvent(new Event('pagehide'));
    });
    expect(vi.mocked(draft.stashDraftSync)).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'Will fail' }),
    );
  });
});

describe('read-only second tab (#24)', () => {
  function draftOf(name: string, projectId: string, updatedAt: string): DraftRecord {
    const doc = createEmptyDocument(NOW);
    doc.project = { ...doc.project, id: projectId, name };
    doc.racks.push({ id: 'r', name: 'MDF', ruHeight: 42 });
    return draft.makeDraft(doc, 1, updatedAt);
  }

  it('gates autosave and draft deletion, then takes over with the newer draft', async () => {
    vi.mocked(draft.getLatestDraft).mockResolvedValueOnce(
      draftOf('From tab one', 'p1', '2026-01-01T00:00:00.000Z'),
    );
    const { result } = renderHook(() => usePersistence());
    act(() => h.writer?.(false));
    expect(result.current.readOnly).toBe(true);
    expect(result.current.status).toBe('readonly');
    await waitFor(() => expect(result.current.recoverable).not.toBeNull());

    act(() => result.current.discardDraft());
    expect(draft.deleteDraft).not.toHaveBeenCalled();
    expect(result.current.recoverable).not.toBeNull();

    act(() => {
      expect(result.current.recover()).toBe(true);
    });
    expect(s().projectName).toBe('From tab one');
    expect(putDraft).not.toHaveBeenCalled();

    // Tab one kept working after this tab opened; then it closed.
    vi.mocked(draft.getDraft).mockResolvedValueOnce(
      draftOf('Edited later in tab one', 'p1', '2026-01-02T00:00:00.000Z'),
    );
    act(() => h.writer?.(true));
    await waitFor(() => expect(s().projectName).toBe('Edited later in tab one'));
    expect(result.current.readOnly).toBe(false);
    expect(result.current.status).not.toBe('readonly');
    expect(result.current.notice).toMatch(/latest autosave/);
  });

  it('keeps its document when the stored draft is not newer', async () => {
    const { result } = renderHook(() => usePersistence());
    act(() => h.writer?.(false));
    rename('Local view');
    vi.mocked(draft.getDraft).mockResolvedValueOnce(
      draftOf('Old', s().getDocument().project.id, '2000-01-01T00:00:00.000Z'),
    );
    act(() => h.writer?.(true));
    await waitFor(() => expect(result.current.status).not.toBe('readonly'));
    expect(s().projectName).toBe('Local view');
  });
});

describe('recovery', () => {
  it('a draft from an older schema is migrated on recover', async () => {
    const old = {
      ...createEmptyDocument(NOW),
      schemaVersion: 5,
      racks: [{ id: 'r', name: 'R', ruHeight: 42 }],
    } as unknown as DraftRecord['doc'];
    delete (old as unknown as Record<string, unknown>).invariants;
    delete (old as unknown as Record<string, unknown>).customRules;
    vi.mocked(draft.getLatestDraft).mockResolvedValueOnce(draft.makeDraft(old, 1, NOW));
    const { result } = render();
    await waitFor(() => expect(result.current.recoverable).not.toBeNull());
    act(() => {
      expect(result.current.recover()).toBe(true);
    });
    expect(s().getDocument().schemaVersion).toBe(SCHEMA_VERSION);
    expect(s().racksAll()).toHaveLength(1);
  });
});
