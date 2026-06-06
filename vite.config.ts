/// <reference types="vitest/config" />
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath, URL } from 'node:url';
import { cspString } from './src/lib/csp';

// Inject the strict CSP <meta> into the PRODUCTION index.html only. The dev server is
// left uncapped so Vite's HMR websocket and React-refresh preamble keep working. This
// is the declarative half of NexMap's local-first guarantee (see src/lib/csp.ts); the
// runtime tripwire in src/lib/netguard.ts is the behavioural half.
function cspPlugin(): Plugin {
  return {
    name: 'nexmap-csp',
    apply: 'build',
    transformIndexHtml() {
      return [
        {
          tag: 'meta',
          attrs: { 'http-equiv': 'Content-Security-Policy', content: cspString() },
          injectTo: 'head-prepend',
        },
      ];
    },
  };
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), cspPlugin()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: './src/test/setup.ts',
  },
});
