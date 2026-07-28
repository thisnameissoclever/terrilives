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
import { FrameTimer } from './perf.js';

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

/** Frames of history behind the rolling mean and p95. Four seconds at 60 Hz. */
const FRAME_WINDOW = 240;

/** How often the frame budget is printed, in milliseconds. */
const REPORT_INTERVAL_MS = 2000;

/**
 * What `?stress=N` hangs on `window` so the M0 exit gate can be measured.
 *
 * [L14]: an agent-driven browser tab runs hidden, a hidden tab is never
 * composited, and `requestAnimationFrame` therefore never fires. A harness
 * that loops on rAF in one reports a flawless p95 over zero frames. `step`
 * exists so the measurement can drive the real frame body itself rather than
 * trusting a callback that may not run, and `timer.frames` is what tells the
 * two situations apart. Present only under `?stress=N`, so the shipping page
 * carries no extra surface.
 */
export interface StressHandle {
  readonly timer: FrameTimer;
  readonly entities: number;
  /** Runs one frame's real work, exactly as the rAF callback would. */
  step(): void;
}

declare global {
  var __terriStress: StressHandle | undefined;
}

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
  // See [L17], which cost a misdiagnosis of the renderer.
  //
  // Checked rather than ignored: the id is resolved against the compiled
  // content pack, so renaming the object in content/objects.toml without
  // updating this line would otherwise leave a lot with a hungry agent
  // and nothing to eat, which looks like a simulation bug rather than a
  // content one. main()'s catch below surfaces it.
  if (!sim.spawnObject(12, 10, 'fridge')) {
    throw new Error("content declares no smart object with id 'fridge'");
  }
  sim.spawnAgent(2, 3, 25);

  // ?stress=1000 spawns idle filler entities to exercise the M0 exit
  // criterion: p95 frame time at or under 16.6 ms with 1,000 entities.
  const stress = Number(new URLSearchParams(location.search).get('stress') ?? 0);
  const spawnStartMs = performance.now();
  for (let i = 0; i < stress; i++) {
    // Hunger 100 keeps them idle, so they neither path nor eat and the
    // measurement is of render and bridge throughput rather than of A*.
    //
    // GRID is 16, so `i % GRID` by `floor(i / GRID) % GRID` walks 256
    // distinct tiles and 1,000 entities stack about four deep on each.
    // That is deliberate rather than incidental: it raises overdraw, which
    // makes the test harder on the GPU, not easier.
    sim.spawnAgent(i % GRID, Math.floor(i / GRID) % GRID, 100);
  }
  if (stress > 0) {
    // Startup, not steady state, and it is superlinear: `spawn_agent`
    // calls `sync_render_buffer`, which sorts and clones on every
    // count change, so seeding N entities from JavaScript is O(N^2 log N).
    // Printed separately so it can never be mistaken for frame cost.
    console.log(
      `spawned ${sim.count} entities in ` +
        `${(performance.now() - spawnStartMs).toFixed(1)}ms`,
    );
  }

  const driver = new FixedStepDriver(TICK_HZ, MAX_TICKS_PER_FRAME);
  const originX = canvas.width / 2;
  const timer = new FrameTimer(FRAME_WINDOW);
  let previousFrameMs = performance.now();
  let lastReportMs = performance.now();

  /**
   * One frame's work. `nowMs` is when the frame began, so the sample below
   * covers simulation, bridge reads, instance packing and draw submission -
   * everything inside the 16.6 ms budget and nothing outside it.
   */
  function frame(nowMs: number): void {
    const deltaMs = nowMs - previousFrameMs;
    previousFrameMs = nowMs;

    // The sim advances in whole ticks; alpha is how far this frame sits
    // between the last one that ran and the next one that has not.
    const alpha = driver.advance(deltaMs, () => sim.tick());
    const instances = buildInstances(sim, alpha, originX, ORIGIN_Y, GRID);
    renderer.draw(instances, sim.count);

    timer.sample(performance.now() - nowMs);
    if (nowMs - lastReportMs > REPORT_INTERVAL_MS) {
      lastReportMs = nowMs;
      console.log(`entities ${sim.count}  ${timer.report()}`);
    }
  }

  if (stress > 0) {
    globalThis.__terriStress = {
      timer,
      entities: sim.count,
      step: () => frame(performance.now()),
    };
  }

  function loop(nowMs: number): void {
    frame(nowMs);
    requestAnimationFrame(loop);
  }

  requestAnimationFrame(loop);
}

// Surfaced rather than swallowed: initDevice throws a distinct message
// for each way WebGPU can be unavailable, and a blank canvas is otherwise
// indistinguishable between them.
void main().catch((error: unknown) => {
  console.error('terrilives failed to start:', error);
});
