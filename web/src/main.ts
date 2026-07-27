// Entry point. This proves the WASM boundary is reachable from the browser
// and that state crosses it through the zero-copy bridge; the renderer
// arrives in Tasks 10 and 11, and the fixed-timestep driver in Task 12.

import init, { SimHandle } from './wasm/terri_wasm.js';
import { SimBridge } from './bridge.js';

async function main(): Promise<void> {
  // init() resolves to the instance exports, whose `memory` is the
  // WebAssembly.Memory backing every view the bridge hands out.
  const wasm = await init();

  const canvas = document.querySelector<HTMLCanvasElement>('#stage');
  if (!canvas) {
    throw new Error('missing #stage canvas');
  }

  const sim = new SimBridge(new SimHandle(32, 32), wasm.memory);
  sim.spawnObject(18, 14);
  sim.spawnAgent(1, 1, 30);
  sim.tick();

  console.log('entities across the boundary:', sim.count);
  console.log('first position:', sim.positions()[0], sim.positions()[1]);
}

void main();
