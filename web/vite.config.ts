import { defineConfig } from 'vite';

export default defineConfig({
  // Relative asset URLs, so the build works from any path. GitHub Pages
  // serves a project site from /<repo>/ rather than /, and an absolute
  // base would 404 every asset there while working fine locally, which
  // is the kind of difference that only shows up after deploying.
  base: './',
  server: {
    // Bind every interface, not only localhost, so the dev build is
    // reachable from other machines and phones on the same network at
    // http://<this-machine's-LAN-IP>:5173. Windows will ask once to
    // allow Node through the firewall for private networks; that
    // approval is the machine owner's to give. Note WebGPU on the
    // visiting device still applies: recent Chrome or Edge works,
    // Safari and older Android browsers may not.
    host: true,
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
    // bundle on 4173 - the closer-to-shipping check a phone should be
    // able to reach for the same reason the dev server is.
    host: true,
  },
});
