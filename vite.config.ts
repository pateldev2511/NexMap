/// <reference types="vitest/config" />
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath, URL } from 'node:url';
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
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

// Fill the service worker's precache list with every file this build emits, so one
// online visit makes the whole app (lazy chunks included) available offline. Writing
// the list into sw.js also changes its bytes on every deploy, which is what makes the
// browser install the new worker. Fails the build if public/sw.js loses its marker.
export const PRECACHE_MARKER = 'const PRECACHE = [];';
export function swPrecachePlugin(): Plugin {
  let outDir = 'dist';
  let files: string[] = [];
  return {
    name: 'nexmap-sw-precache',
    apply: 'build',
    configResolved(config) {
      outDir = config.build.outDir;
    },
    generateBundle(_, bundle) {
      files = Object.keys(bundle).filter((f) => f !== 'index.html' && !f.endsWith('.map'));
    },
    closeBundle() {
      const publicFiles = readdirSync('public').filter((f) => f !== 'sw.js' && !f.startsWith('_'));
      const list = [...files, ...publicFiles].map((f) => `/${f}`).sort();
      const swPath = `${outDir}/sw.js`;
      const sw = readFileSync(swPath, 'utf8');
      if (!sw.includes(PRECACHE_MARKER)) throw new Error(`${swPath}: precache marker missing`);
      writeFileSync(
        swPath,
        sw.replace(PRECACHE_MARKER, `const PRECACHE = ${JSON.stringify(list)};`),
      );
    },
  };
}

const pkg = JSON.parse(readFileSync('package.json', 'utf8')) as { version: string };

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), cspPlugin(), swPrecachePlugin()],
  // One version source: new documents and the launch screen read package.json.
  define: { __APP_VERSION__: JSON.stringify(pkg.version) },
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: './src/test/setup.ts',
    // Unit tests live under src/. The e2e/ Playwright specs run separately
    // (`npm run e2e`) and must not be picked up by Vitest.
    include: ['src/**/*.{test,spec}.{ts,tsx}'],
  },
});
