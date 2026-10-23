import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Plugin } from 'vite';
import { buildPlayerGuide, renderQuickHelp } from '../../scripts/build-player-guide.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const source = path.join(root, 'docs/player');

/** Publish and preview the same generated guide and short in-game Help. */
export function playerGuidePlugin(): Plugin {
  let cached: Map<string, string | Uint8Array> | undefined;
  return {
    name: 'natural-causes-player-guide',
    transformIndexHtml(html) { return html.replace('<!-- PLAYER_HELP -->', renderQuickHelp(root)); },
    generateBundle() {
      for (const [fileName, content] of buildPlayerGuide(root)) this.emitFile({ type: 'asset', fileName, source: content });
    },
    configureServer(server) {
      server.watcher.add([source, path.join(root, 'web/guide'), path.join(root, 'web/changelog')]);
      server.watcher.on('all', (_event, filename) => {
        if ([source, path.join(root, 'web/guide'), path.join(root, 'web/changelog')].some((folder) => path.resolve(filename).startsWith(folder + path.sep))) {
          cached = undefined;
          server.ws.send({ type: 'full-reload', path: path.resolve(filename) === path.join(source, 'quick-help.md') ? '/' : '/guide/*' });
        }
      });
      server.middlewares.use((request, response, next) => {
        const pathname = new URL(request.url ?? '/', 'http://localhost').pathname;
        if (pathname === '/guide') { response.writeHead(302, { Location: './guide/' }); response.end(); return; }
        if (!pathname.startsWith('/guide/')) { next(); return; }
        try {
          cached ??= buildPlayerGuide(root);
          const key = pathname.slice(1) + (pathname.endsWith('/') ? 'index.html' : '');
          const content = cached.get(key);
          if (content === undefined) { response.writeHead(404); response.end('This guide page is unavailable.'); return; }
          const type = key.endsWith('.html') ? 'text/html; charset=utf-8' : key.endsWith('.json') ? 'application/json' : key.endsWith('.png') ? 'image/png' : key.endsWith('.webp') ? 'image/webp' : 'application/octet-stream';
          response.writeHead(200, { 'Content-Type': type }); response.end(content);
        } catch (error) { next(error); }
      });
    },
  };
}
