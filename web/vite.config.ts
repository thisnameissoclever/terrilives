import fs from 'node:fs';
import path from 'node:path';
import { defineConfig } from 'vite';

/**
 * Self-signed TLS, when the material exists.
 *
 * WebGPU only exists in secure contexts - https, or localhost - so the
 * dev build that runs perfectly over localhost HTTP renders a void from any
 * other device's plain-HTTP address. The repository has two standing servers:
 *
 *   - `npm run dev` or `npm run dev:lan` (5174): the same live LAN-mode
 *     server, with hot reload.
 *   - `npm run preview` (4173): the built bundle, the closer-to-shipping copy.
 *
 * Both use https when the certificate material exists and http otherwise. The
 * material is deliberately optional and gitignored: a fresh clone works over
 * localhost HTTP, and a private key never enters history. Regenerate with:
 *
 *   openssl req -x509 -newkey rsa:2048 -sha256 -days 825 -nodes \
 *     -keyout web/.cert/key.pem -out web/.cert/cert.pem \
 *     -subj "//CN=terrilives-dev" \
 *     -addext "subjectAltName=DNS:localhost,IP:127.0.0.1,IP:<your LAN IP>"
 *
 * Visiting browsers show a one-time "connection not private" warning
 * for a self-signed certificate; proceeding past it still counts as a
 * secure context, which is all WebGPU asks.
 */
const certDir = path.resolve(__dirname, '.cert');
const https = fs.existsSync(path.join(certDir, 'cert.pem'))
  ? {
      key: fs.readFileSync(path.join(certDir, 'key.pem')),
      cert: fs.readFileSync(path.join(certDir, 'cert.pem')),
    }
  : undefined;

export default defineConfig(({ mode }) => ({
  // Relative asset URLs, so the build works from any path. GitHub Pages
  // serves a project site from /<repo>/ rather than /, and an absolute
  // base would 404 every asset there while working fine locally, which
  // is the kind of difference that only shows up after deploying.
  base: './',
  server: {
    // Bind every interface, not only localhost, so the dev build is
    // reachable from other machines and phones on the same network at
    // port 5174. Windows will ask once to
    // allow Node through the firewall for private networks; that
    // approval is the machine owner's to give. Note WebGPU on the
    // visiting device still applies: recent Chrome or Edge works,
    // Safari and older Android browsers may not.
    host: true,
    // Both package scripts use `lan` mode. TLS is active only when the local
    // certificate files above exist; invoking Vite directly in its default
    // mode remains the plain-localhost fallback.
    https: mode === 'lan' ? https : undefined,
    // Required for SharedArrayBuffer / WASM threads later. Harmless now.
    headers: {
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'require-corp',
    },
    fs: {
      // The sprite atlas lives in the repository's `assets/`, one level
      // above this Vite root, because it is a build artifact of the
      // whole project rather than of the web app. Without this the dev
      // server refuses to serve it and the page loads with no texture.
      allow: ['..'],
    },
  },
  preview: {
    // Same LAN exposure for `npm run preview`, which serves the built
    // bundle on 4173 - and over https when the local cert material
    // exists, because that is the server phones are pointed at and
    // WebGPU does not exist for them on plain http. See the note on
    // `https` above.
    host: true,
    https,
  },
}));
