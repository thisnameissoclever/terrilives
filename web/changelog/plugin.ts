import { readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Plugin } from 'vite';
import { buildChangelog } from '../../scripts/build-changelog.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const notes = path.join(root, 'docs/changelog');
const presentation = path.join(root, 'web/changelog');

/** The same generated document is served in development and shipped by Pages. */
export function changelogPlugin(): Plugin {
  return {
    name: 'natural-causes-changelog',
    buildStart() {
      for (const folder of [notes, presentation]) {
        this.addWatchFile(folder);
        for (const name of readdirSync(folder)) this.addWatchFile(path.join(folder, name));
      }
    },
    generateBundle() {
      this.emitFile({ type: 'asset', fileName: 'changelog/index.html', source: buildChangelog(root) });
    },
    configureServer(server) {
      server.watcher.add(notes);
      server.watcher.on('all', (_event, filename) => {
        const changed = path.resolve(filename);
        if (changed.startsWith(notes + path.sep) || changed.startsWith(presentation + path.sep)) {
          server.ws.send({ type: 'full-reload' });
        }
      });
      server.middlewares.use((request, response, next) => {
        const pathname = new URL(request.url ?? '/', 'http://localhost').pathname;
        if (pathname === '/changelog') {
          response.writeHead(302, { Location: './changelog/' });
          response.end();
        } else if (pathname === '/changelog/' || pathname === '/changelog/index.html') {
          try {
            const html = buildChangelog(root);
            response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
            response.end(html);
          } catch (error) {
            next(error);
          }
        } else next();
      });
    },
  };
}
