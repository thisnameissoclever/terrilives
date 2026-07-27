// Entry point. The simulation runs in WASM at a fixed 10 Hz, its state
// crosses into JavaScript through the zero-copy bridge, and the renderer
// draws every entity in one instanced call at display refresh rate,
// interpolating between the two most recent ticks.
//
// Everything with any arithmetic in it lives in `frame.ts`, `iso.ts` and
// `instances.ts`, where it can be tested in Node. This file is the wiring
// that cannot be: a device, a canvas, and a requestAnimationFrame loop.

import init, { SimHandle } from './wasm/terri_wasm.js';
import { SimBridge } from './bridge.js';
import { initDevice } from './render/device.js';
import { SpriteRenderer } from './render/sprites.js';
import { FixedStepDriver, buildInstances } from './frame.js';

// 16, not 32. The isometric lot spans (GRID - 1) * 2 * TILE_HALF_WIDTH by
// (GRID - 1) * 2 * TILE_HALF_HEIGHT pixels, so 32 would be 1984 x 992 on a
// 1280 x 720 canvas with the near corner at y = 1072, most of the lot off
// screen. At 16 it is 960 x 480, which leaves room for the origin offset.
//
// Worth knowing because the symptom of getting this wrong looks like a
// broken projection rather than a camera that is simply too zoomed in.
const GRID = 16;

/** [D2]: the simulation's one true rate. Speed controls change how many
 * ticks run per frame, never how long a tick is. */
const TICK_HZ = 10;

/**
 * The most ticks one frame may run before the driver gives up on the
 * backlog. Half a second of simulation, which is enough to ride out a
 * garbage-collection pause and short enough that catching up cannot cost
 * more than the frame that fell behind.
 */
const MAX_TICKS_PER_FRAME = 5;

/** Screen y of world tile (0, 0), the lot's far corner, near the top. */
const ORIGIN_Y = 80;

async function main(): Promise<void> {
  // init() resolves to the instance exports, whose `memory` is the
  // WebAssembly.Memory backing every view the bridge hands out. It is
  // passed in rather than imported: `--target web` has no importable
  // `memory`, see bridge.ts and [L10].
  const wasm = await init();

  const canvas = document.querySelector<HTMLCanvasElement>('#stage');
  if (!canvas) {
    throw new Error('missing #stage canvas');
  }

  const gpu = await initDevice(canvas);
  const renderer = new SpriteRenderer(gpu);

  const sim = new SimBridge(new SimHandle(GRID, GRID), wasm.memory);
  // Both inside the 16 x 16 lot. A smart object outside it is not a
  // cosmetic mistake: `find_path` refuses an unwalkable destination, so
  // the agent would stand still forever with nothing logged anywhere.
  sim.spawnObject(12, 10);
  sim.spawnAgent(2, 3, 25);

  const driver = new FixedStepDriver(TICK_HZ, MAX_TICKS_PER_FRAME);
  const originX = canvas.width / 2;
  let previousFrameMs = performance.now();

  function frame(nowMs: number): void {
    const deltaMs = nowMs - previousFrameMs;
    previousFrameMs = nowMs;

    // The sim advances in whole ticks; alpha is how far this frame sits
    // between the last one that ran and the next one that has not.
    const alpha = driver.advance(deltaMs, () => sim.tick());
    const instances = buildInstances(sim, alpha, originX, ORIGIN_Y, GRID);
    renderer.draw(instances, sim.count);

    requestAnimationFrame(frame);
  }

  requestAnimationFrame(frame);
}

// Surfaced rather than swallowed: initDevice throws a distinct message
// for each way WebGPU can be unavailable, and a blank canvas is otherwise
// indistinguishable between them.
void main().catch((error: unknown) => {
  console.error('terrilives failed to start:', error);
});
