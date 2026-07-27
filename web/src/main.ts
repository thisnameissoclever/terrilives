// Entry point. This only proves the WASM boundary is reachable from the
// browser; the zero-copy views arrive in Task 9, the renderer in Tasks 10
// and 11, and the fixed-timestep driver in Task 12.

import init, { SimHandle } from './wasm/terri_wasm.js';

async function main(): Promise<void> {
  await init();

  const canvas = document.querySelector<HTMLCanvasElement>('#stage');
  if (!canvas) {
    throw new Error('missing #stage canvas');
  }

  const sim = new SimHandle(32, 32);
  sim.spawn_object(18, 14);
  sim.spawn_agent(1, 1, 30);
  sim.tick();

  console.log('entities across the boundary:', sim.entity_count());
}

void main();
