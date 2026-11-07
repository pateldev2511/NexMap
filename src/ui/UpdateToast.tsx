import { useEffect, useState } from 'react';

/**
 * Service-worker status toast. Two messages, both dispatched by main.tsx:
 *  - `nexmap:update-available` — a newer build installed while the app is open;
 *    without a nudge the user sits on the old build until the next reload.
 *  - `nexmap:offline-ready` — the first visit finished caching the whole app, so
 *    from now on NexMap opens and works without a connection. Shown once, then fades.
 */
export function UpdateToast() {
  const [show, setShow] = useState<'update' | 'offline' | null>(null);

  useEffect(() => {
    const onUpdate = () => setShow('update');
    const onOffline = () => setShow((s) => s ?? 'offline');
    window.addEventListener('nexmap:update-available', onUpdate);
    window.addEventListener('nexmap:offline-ready', onOffline);
    return () => {
      window.removeEventListener('nexmap:update-available', onUpdate);
      window.removeEventListener('nexmap:offline-ready', onOffline);
    };
  }, []);

  useEffect(() => {
    if (show !== 'offline') return;
    const t = window.setTimeout(() => setShow(null), 6000);
    return () => window.clearTimeout(t);
  }, [show]);

  if (!show) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      style={{
        position: 'fixed',
        bottom: 16,
        left: '50%',
        transform: 'translateX(-50%)',
        zIndex: 60,
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        background: 'var(--chrome-bg)',
        border: '1px solid var(--chrome-border)',
        borderRadius: 10,
        boxShadow: '0 4px 20px rgba(0,0,0,0.18)',
        padding: '10px 12px 10px 16px',
        fontSize: 13,
        color: 'var(--chrome-fg)',
      }}
    >
      <span>
        {show === 'update'
          ? 'A new version of NexMap is available.'
          : 'NexMap is ready to work offline.'}
      </span>
      {show === 'update' && (
        <button
          onClick={() => window.location.reload()}
          style={{
            border: 'none',
            background: 'var(--accent)',
            color: '#fff',
            borderRadius: 7,
            padding: '6px 12px',
            fontWeight: 600,
            cursor: 'pointer',
          }}
        >
          Reload
        </button>
      )}
      <button
        onClick={() => setShow(null)}
        aria-label="Dismiss"
        style={{
          border: 'none',
          background: 'transparent',
          color: 'var(--chrome-fg-muted)',
          cursor: 'pointer',
          fontSize: 16,
          lineHeight: 1,
          padding: '0 4px',
        }}
      >
        ×
      </button>
    </div>
  );
}
