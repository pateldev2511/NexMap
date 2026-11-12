/** #76: IndexedDB read failures are reported, not swallowed as "no draft". */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createEmptyDocument } from '@/model/schema';

const NOW = '2026-01-01T00:00:00.000Z';

type Req = { result?: unknown; error?: unknown; onsuccess?: () => void; onerror?: () => void; onupgradeneeded?: () => void };

/** A fake indexedDB whose open and reads can be told to fail. */
function stubIdb(opts: { openFails?: () => boolean; readFails?: boolean; records?: unknown[] }) {
  const puts: unknown[] = [];
  const db = {
    objectStoreNames: { contains: () => true },
    transaction: () => {
      const tx: { oncomplete?: () => void; onabort?: () => void; error?: unknown; objectStore: () => unknown } = {
        objectStore: () => ({
          getAll: () => settle({ result: opts.records ?? [] }),
          get: () => settle({ result: undefined }),
          put: (d: unknown) => {
            puts.push(d);
            setTimeout(() => tx.oncomplete?.(), 0);
          },
        }),
      };
      return tx;
    },
  };
  function settle(r: Req): Req {
    setTimeout(() => {
      if (opts.readFails) {
        r.error = new Error('read blew up');
        r.onerror?.();
      } else r.onsuccess?.();
    }, 0);
    return r;
  }
  const open = vi.fn(() => {
    const req: Req = {};
    setTimeout(() => {
      if (opts.openFails?.()) {
        req.error = new Error('open blew up');
        req.onerror?.();
      } else {
        req.result = db;
        req.onsuccess?.();
      }
    }, 0);
    return req;
  });
  vi.stubGlobal('indexedDB', { open });
  return { open, puts };
}

beforeEach(() => {
  vi.resetModules(); // fresh module-level db promise per test
  localStorage.clear();
});
afterEach(() => vi.unstubAllGlobals());

describe('draft reads', () => {
  it('a getAll error is ok:false, not an empty list', async () => {
    stubIdb({ readFails: true });
    const d = await import('./draft');
    const r = await d.readLatestDraft();
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).toMatch(/read blew up/);
    expect(await d.getLatestDraft()).toBeNull(); // legacy wrapper unchanged
  });

  it('a healthy empty store is ok:true with null', async () => {
    stubIdb({});
    const d = await import('./draft');
    expect(await d.readLatestDraft()).toEqual({ ok: true, value: null });
    expect(await d.readDraft('p')).toEqual({ ok: true, value: null });
  });

  it('a failed open is not cached: the next read retries and succeeds', async () => {
    let fail = true;
    const { open } = stubIdb({ openFails: () => fail });
    const d = await import('./draft');
    expect((await d.readLatestDraft()).ok).toBe(false);
    fail = false;
    expect(await d.readLatestDraft()).toEqual({ ok: true, value: null });
    expect(open).toHaveBeenCalledTimes(2);
  });

  it('absorbStashedDraft keeps the stash and writes nothing when the read failed', async () => {
    const { puts } = stubIdb({ readFails: true });
    const d = await import('./draft');
    const doc = createEmptyDocument(NOW);
    expect(d.stashDraftSync(d.makeDraft(doc, 1, NOW))).toBe(true);
    await d.absorbStashedDraft();
    expect(puts).toHaveLength(0);
    expect(d.readStashedDraft()).not.toBeNull();
  });

  it('absorbStashedDraft still folds the stash in when the read succeeds', async () => {
    const { puts } = stubIdb({});
    const d = await import('./draft');
    d.stashDraftSync(d.makeDraft(createEmptyDocument(NOW), 1, NOW));
    await d.absorbStashedDraft();
    expect(puts).toHaveLength(1);
    expect(d.readStashedDraft()).toBeNull();
  });
});
