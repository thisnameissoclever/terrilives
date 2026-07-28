import { defineConfig } from 'vite';

export default defineConfig({
  server: {
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
});
