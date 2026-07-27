// Entry point. Task 1 only proves the WASM boundary is reachable from the
// browser; the fixed-timestep driver and renderer arrive in later tasks.

import init, { smoke_value } from './wasm/terri_wasm.js';

async function main(): Promise<void> {
  await init();

  const canvas = document.querySelector<HTMLCanvasElement>('#stage');
  if (!canvas) {
    throw new Error('missing #stage canvas');
  }

  console.log('smoke_value from wasm:', smoke_value());
}

void main();
