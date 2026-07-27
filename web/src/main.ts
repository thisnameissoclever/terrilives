// Entry point. State crosses the WASM boundary through the zero-copy
// bridge and is drawn by the instanced sprite pipeline in a single draw
// call per frame.
//
// The projection and the frame pacing below are deliberate placeholders:
// Task 11 replaces the world-to-screen mapping with the isometric one,
// and Task 12 replaces the raw requestAnimationFrame tick with the
// fixed-timestep driver and interpolation. They exist now so the GPU path
// is exercised end to end rather than merely constructed, which is the
// only way to find out whether it renders.

import init, { SimHandle } from './wasm/terri_wasm.js';
import { SimBridge } from './bridge.js';
import { initDevice } from './render/device.js';
import { SpriteRenderer } from './render/sprites.js';
import { FLOATS_PER_INSTANCE, writeInstance } from './render/instances.js';

const GRID = 32;
const PIXELS_PER_TILE = 20;

async function main(): Promise<void> {
  // init() resolves to the instance exports, whose `memory` is the
  // WebAssembly.Memory backing every view the bridge hands out.
  const wasm = await init();

  const canvas = document.querySelector<HTMLCanvasElement>('#stage');
  if (!canvas) {
    throw new Error('missing #stage canvas');
  }

  const gpu = await initDevice(canvas);
  const renderer = new SpriteRenderer(gpu);

  const sim = new SimBridge(new SimHandle(GRID, GRID), wasm.memory);
  sim.spawnObject(18, 14);
  sim.spawnAgent(1, 1, 30);

  console.log('entities across the boundary:', sim.count);

  // Allocated once, reused every frame. Per [D11] the render path holds
  // typed arrays and never per-entity objects.
  const instances = new Float32Array(sim.count * FLOATS_PER_INSTANCE);
  const maxSum = Math.max(1, (GRID - 1) * 2);

  function frame(): void {
    sim.tick();

    // Views are rebuilt every frame on purpose; see bridge.ts on why
    // caching any of buffer, pointer or length is the same bug.
    const positions = sim.positions();
    const kinds = sim.kinds();
    const count = sim.count;

    for (let i = 0; i < count; i++) {
      const wx = positions[i * 2];
      const wy = positions[i * 2 + 1];
      writeInstance(
        instances,
        i,
        wx * PIXELS_PER_TILE + 40,
        wy * PIXELS_PER_TILE + 40,
        (wx + wy) / maxSum,
        kinds[i],
      );
    }

    renderer.draw(instances, count);
    requestAnimationFrame(frame);
  }

  requestAnimationFrame(frame);
}

void main();
