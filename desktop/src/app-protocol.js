'use strict';

/**
 * Serves the built game from disk under natural-causes://game/.
 *
 * The page needs cross-origin isolation for SharedArrayBuffer, so every
 * response, a 404 included, carries the three isolation headers. The game
 * decompresses its own .gz files, so nothing here ever sends
 * Content-Encoding. Pure apart from reading files: no Electron import, so the
 * tests run under plain Node.
 */

const fs = require('node:fs');
const path = require('node:path');
const { Readable } = require('node:stream');

const SCHEME = 'natural-causes';
const HOST = 'game';
const ORIGIN = `${SCHEME}://${HOST}`;
const START_URL = `${ORIGIN}/index.html`;

/** Privileges registered before the app is ready. The scheme and host are permanent: the origin keys stored preferences. */
const SCHEME_PRIVILEGES = Object.freeze({
  standard: true,
  secure: true,
  supportFetchAPI: true,
  stream: true,
  codeCache: true,
});

const ISOLATION_HEADERS = Object.freeze({
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Embedder-Policy': 'require-corp',
  'Cross-Origin-Resource-Policy': 'same-origin',
});

const CONTENT_TYPES = Object.freeze({
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript',
  '.mjs': 'text/javascript',
  '.css': 'text/css',
  '.wasm': 'application/wasm',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.wav': 'audio/wav',
  '.md': 'text/markdown; charset=utf-8',
});

/** Served as opaque bytes on purpose: the game reads these itself. */
const OPAQUE_EXTENSIONS = Object.freeze(['.bin', '.rgba', '.gz']);
const OPAQUE_TYPE = 'application/octet-stream';

function contentType(filePath) {
  return CONTENT_TYPES[path.extname(filePath).toLowerCase()] ?? OPAQUE_TYPE;
}

/**
 * The file a request names inside `root`, or null when the URL is not a game
 * URL or points outside the bundle. A path ending in `/` names that folder's
 * index.html. Nothing on disk is touched.
 */
function resolveRequestPath(root, requestUrl) {
  let url;
  try {
    url = new URL(requestUrl);
  } catch {
    return null;
  }
  if (url.protocol !== `${SCHEME}:` || url.host !== HOST) return null;
  const raw = url.pathname;
  // A backslash is a separator on Windows; an encoded one must not smuggle one in.
  if (raw.includes('\\') || /%5c/i.test(raw) || /%00/.test(raw)) return null;
  let decoded;
  try {
    decoded = decodeURIComponent(raw);
  } catch {
    return null;
  }
  if (decoded.includes('\0') || decoded.includes('\\')) return null;
  const segments = decoded.split('/');
  if (segments.some((segment) => segment === '..' || segment === '.')) return null;
  if (!decoded.startsWith('/')) return null;
  const relative = decoded.endsWith('/') ? `${decoded}index.html` : decoded;
  const base = path.resolve(root);
  const resolved = path.resolve(base, `.${relative}`);
  const inside = path.relative(base, resolved);
  if (inside === '' || inside.startsWith('..') || path.isAbsolute(inside)) return null;
  return resolved;
}

function notFound() {
  return new Response('Not found', {
    status: 404,
    headers: { ...ISOLATION_HEADERS, 'Content-Type': 'text/plain; charset=utf-8' },
  });
}

/** A web Response for one request: the file streamed from disk, or a 404. */
async function respond(root, requestUrl) {
  let filePath = resolveRequestPath(root, requestUrl);
  if (filePath === null) return notFound();
  try {
    let stats = await fs.promises.stat(filePath);
    if (stats.isDirectory()) {
      filePath = path.join(filePath, 'index.html');
      stats = await fs.promises.stat(filePath);
    }
    if (!stats.isFile()) return notFound();
    const body = Readable.toWeb(fs.createReadStream(filePath));
    return new Response(body, {
      status: 200,
      headers: {
        ...ISOLATION_HEADERS,
        'Content-Type': contentType(filePath),
        'Content-Length': String(stats.size),
      },
    });
  } catch {
    return notFound();
  }
}

/** The handler given to `protocol.handle(SCHEME, ...)`. */
function createProtocolHandler(root) {
  return (request) => respond(root, request.url);
}

module.exports = {
  CONTENT_TYPES,
  HOST,
  ISOLATION_HEADERS,
  OPAQUE_EXTENSIONS,
  ORIGIN,
  SCHEME,
  SCHEME_PRIVILEGES,
  START_URL,
  contentType,
  createProtocolHandler,
  resolveRequestPath,
  respond,
};
