import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App.tsx';
import { UpdateToast } from './ui/UpdateToast';
import { ErrorBoundary } from './ui/shell/ErrorBoundary';
import { installNetGuard } from './lib/netguard';
import { installInputDebugLogger } from './input/debugLog';
import './styles/global.css';

// Enforce the local-first promise in production: trap any accidental network egress
// before the app mounts. Dev is left alone so Vite's HMR websocket keeps working.
if (import.meta.env.PROD) {
  installNetGuard(window as unknown as Parameters<typeof installNetGuard>[0]);
}

// Dev-only input recorder (?debug=input) — captures real-device wheel/pointer
// traces for src/input/__fixtures__/ (fixture-provenance rule). Never in prod.
if (import.meta.env.DEV) {
  installInputDebugLogger();
}

const rootEl = document.getElementById('root');
if (!rootEl) throw new Error('Root element #root not found');

createRoot(rootEl).render(
  <StrictMode>
    <ErrorBoundary label="NexMap" viewport>
      <App />
    </ErrorBoundary>
    {/* Beside App, not inside it: worker status can arrive on any screen. */}
    <UpdateToast />
  </StrictMode>,
);

// Offline support (Phase 7). Register only in production builds — the dev server
// must not be intercepted by a cached app shell.
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  // A page loaded without a controlling worker is a first visit (or storage was
  // cleared): once the worker has precached the build, say that offline use is ready.
  const firstVisit = !navigator.serviceWorker.controller;
  navigator.serviceWorker.addEventListener('message', (e: MessageEvent<{ type?: string }>) => {
    if (firstVisit && e.data?.type === 'nexmap:offline-ready') {
      window.dispatchEvent(new CustomEvent('nexmap:offline-ready'));
    }
  });
  window.addEventListener('load', () => {
    navigator.serviceWorker
      .register('/sw.js')
      .then((reg) => {
        // When an updated worker installs while a previous one already controls
        // the page, surface a "new version available" prompt (see UpdateToast).
        reg.addEventListener('updatefound', () => {
          const next = reg.installing;
          if (!next) return;
          next.addEventListener('statechange', () => {
            if (next.state === 'installed' && navigator.serviceWorker.controller) {
              window.dispatchEvent(new CustomEvent('nexmap:update-available'));
            }
          });
        });
      })
      .catch(() => {
        /* offline support unavailable — app still works online */
      });
  });
}
