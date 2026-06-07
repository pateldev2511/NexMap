import { useEffect, useState } from 'react';

/**
 * "A new version is available — reload" toast. The service worker can fetch a
 * newer build in the background while the app is open; without a nudge, the user
 * sits on a stale shell until a hard refresh. main.tsx dispatches the
 * `nexmap:update-available` event when an updated worker installs.
 */
export function UpdateToast() {
  const [show, setShow] = useState(false);

  useEffect(() => {
    const onUpdate = () => setShow(true);
    window.addEventListener('nexmap:update-available', onUpdate);
    return () => window.removeEventListener('nexmap:update-available', onUpdate);
  }, []);

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
      <span>A new version of NexMap is available.</span>
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
      <button
        onClick={() => setShow(false)}
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
