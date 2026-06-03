/**
 * Multi-tab single-writer via the Web Locks API (eng review DA-E2 — chosen over a
 * racy "prefer read-only" heuristic). Exactly one tab holds the writer lock and
 * may autosave; others go read-only until the holder closes, at which point a
 * waiting tab is promoted automatically (the lock auto-releases on unload).
 *
 * If Web Locks is unavailable (older Safari), we assume single-tab and grant
 * writer — there's no safe way to detect contention without it, and the autosave
 * write itself is still atomic.
 */

interface LockManagerLike {
  request(
    name: string,
    options: { mode?: 'exclusive' | 'shared' },
    cb: (lock: unknown | null) => Promise<void>,
  ): Promise<void>;
}

function lockManager(): LockManagerLike | null {
  const nav = navigator as unknown as { locks?: LockManagerLike };
  return nav.locks ?? null;
}

const LOCK_NAME = 'nexmap-writer';

/**
 * Begin contending for the writer role. Calls `onWriter(true)` once this tab
 * holds the lock, `onWriter(false)` if another tab holds it first. Holds the lock
 * for the tab's lifetime. Returns a function to release early (rarely needed).
 */
export function acquireWriter(onWriter: (isWriter: boolean) => void): () => void {
  const locks = lockManager();
  if (!locks) {
    onWriter(true);
    return () => {};
  }

  let releaseHeld: () => void = () => {};
  let released = false;
  let granted = false;
  const release = () => {
    released = true;
    releaseHeld();
  };

  // If we don't get the lock promptly, another tab holds it → read-only until
  // we're promoted. (Avoids the ifAvailable double-request race, incl. under
  // React StrictMode's mount/unmount/mount in dev.)
  const contendTimer = setTimeout(() => {
    if (!granted && !released) onWriter(false);
  }, 200);

  // Queue an exclusive request. The first/only tab is granted immediately; a
  // second tab waits here and is granted when the holder closes (auto-promotion).
  void locks.request(LOCK_NAME, { mode: 'exclusive' }, async (lock) => {
    clearTimeout(contendTimer);
    if (released || !lock) return;
    granted = true;
    onWriter(true);
    await new Promise<void>((r) => {
      releaseHeld = r;
    });
  });

  return () => {
    clearTimeout(contendTimer);
    release();
  };
}
