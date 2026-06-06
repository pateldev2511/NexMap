import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App.tsx';
import { installNetGuard } from './lib/netguard';
import './styles/global.css';

// Enforce the local-first promise in production: trap any accidental network egress
// before the app mounts. Dev is left alone so Vite's HMR websocket keeps working.
if (import.meta.env.PROD) {
  installNetGuard(window as unknown as Parameters<typeof installNetGuard>[0]);
}

const rootEl = document.getElementById('root');
if (!rootEl) throw new Error('Root element #root not found');

createRoot(rootEl).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

// Offline support (Phase 7). Register only in production builds — the dev server
// must not be intercepted by a cached app shell.
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {
      /* offline support unavailable — app still works online */
    });
  });
}
