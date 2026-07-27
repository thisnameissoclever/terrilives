import { defineConfig } from 'vite';

export default defineConfig({
  server: {
    // Required for SharedArrayBuffer / WASM threads later. Harmless now.
    headers: {
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'require-corp',
    },
  },
});
