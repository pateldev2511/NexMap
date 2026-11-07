import { cpSync, mkdtempSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo, Socket } from 'node:net';
import { tmpdir } from 'node:os';
import { extname, join } from 'node:path';

/**
 * A stand-in for the production host (Cloudflare Workers static assets) serving a
 * private copy of the real `dist/` build, so a test can deploy a new build, break a
 * file or take the host down without touching the shared build. Like the real host
 * it answers an unknown path with index.html and status 200 (SPA fallback), which is
 * exactly the response the service worker must never cache as a script.
 */
const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webm': 'video/webm',
  '.woff2': 'font/woff2',
  '.webmanifest': 'application/manifest+json',
};

export interface Host {
  url: string;
  /** Answer this path with a 500 until cleared. */
  fail(path: string | null): void;
  /** Ship a new build: renames the main bundle and rewrites the page and worker. */
  deploy(): { oldBundle: string; newBundle: string };
  /** Take the host down (connections refused), or bring it back on the same port. */
  stop(): Promise<void>;
  start(): Promise<void>;
  dispose(): Promise<void>;
}

export async function startHost(): Promise<Host> {
  const root = mkdtempSync(join(tmpdir(), 'nexmap-host-'));
  cpSync('dist', root, { recursive: true });
  let failing: string | null = null;
  let server: Server | null = null;
  const sockets = new Set<Socket>();
  let port = 0;

  const listen = () =>
    new Promise<void>((resolve) => {
      server = createServer((req, res) => {
        const path = decodeURIComponent(new URL(req.url ?? '/', 'http://x').pathname);
        if (path === failing) {
          res.writeHead(500).end('boom');
          return;
        }
        let file = join(root, path === '/' ? 'index.html' : path);
        let body: Buffer;
        try {
          body = readFileSync(file);
        } catch {
          file = join(root, 'index.html');
          body = readFileSync(file);
        }
        res.writeHead(200, {
          'content-type': TYPES[extname(file)] ?? 'application/octet-stream',
          'cache-control': 'no-cache',
        });
        res.end(body);
      });
      server.on('connection', (s) => {
        sockets.add(s);
        s.on('close', () => sockets.delete(s));
      });
      server.listen(port, '127.0.0.1', () => {
        port = (server!.address() as AddressInfo).port;
        resolve();
      });
    });

  const stop = () =>
    new Promise<void>((resolve) => {
      if (!server) return resolve();
      for (const s of sockets) s.destroy();
      server.close(() => resolve());
      server = null;
    });

  await listen();
  return {
    url: `http://localhost:${port}`,
    fail: (p) => (failing = p),
    deploy() {
      const assets = join(root, 'assets');
      const oldBundle = readdirSync(assets).find((f) => /^index-.*\.js$/.test(f))!;
      const newBundle = oldBundle.replace(/^index-/, 'index-next');
      renameSync(join(assets, oldBundle), join(assets, newBundle));
      for (const f of ['index.html', 'sw.js']) {
        const p = join(root, f);
        writeFileSync(p, readFileSync(p, 'utf8').replaceAll(oldBundle, newBundle));
      }
      return { oldBundle: `/assets/${oldBundle}`, newBundle: `/assets/${newBundle}` };
    },
    stop,
    start: listen,
    async dispose() {
      await stop();
      rmSync(root, { recursive: true, force: true });
    },
  };
}
