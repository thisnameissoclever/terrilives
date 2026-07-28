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
import { TILE_HALF_HEIGHT, TILE_HALF_WIDTH } from './render/iso.js';
import { buildStaticInstances } from './render/tiles.js';
import { FrameTimer } from './perf.js';

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

/**
 * Where the sim starts, in tiles. Open living space, a few tiles from the
 * kitchen and well clear of the bathroom wall at x = 16.
 *
 * The hunger is low enough to give it something to do the moment the page
 * loads, which is what makes the opening seconds worth watching.
 */
const START_TILE = { x: 8, y: 6, hunger: 25 };

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
  // Awaited: the atlas is a PNG and decoding it is asynchronous, so the
  // renderer is only usable once its texture is on the GPU. Constructing
  // it synchronously and uploading later would let the first frames
  // sample an empty texture, which is a black room that fixes itself -
  // the hardest kind of glitch to reproduce.
  const renderer = await SpriteRenderer.create(gpu);

  // The lot, its walls and all eight authored objects come out of
  // content/lot.toml through the compiled pack. Nothing here names a
  // size, a coordinate or an object id, deliberately: a hardcoded room is
  // a second copy of content that nothing keeps in sync, and until this
  // task that copy was what the page actually ran - a 16 x 16 room with
  // one fridge, none of it authored anywhere.
  //
  // `handle` is kept alongside the bridge because the lot's dimensions
  // are simulation state rather than a memory view, and the bridge's job
  // is the zero-copy views.
  const handle = SimHandle.from_lot();
  const sim = new SimBridge(handle, wasm.memory);
  const lotWidth = handle.lot_width();
  const lotHeight = handle.lot_height();
  // Checked rather than assumed. An empty lot is not a crash: it renders
  // a blank canvas with a lone sim wandering it, which reads as a broken
  // renderer rather than as missing content ([L17] is what that costs to
  // diagnose). main()'s catch below surfaces it instead.
  if (sim.count === 0) {
    throw new Error('the compiled lot placed no objects');
  }
  sim.spawnAgent(START_TILE.x, START_TILE.y, START_TILE.hunger);

  // ?stress=1000 spawns idle filler entities to exercise the M0 exit
  // criterion: p95 frame time at or under 16.6 ms with 1,000 entities.
  const stress = Number(new URLSearchParams(location.search).get('stress') ?? 0);
  const spawnStartMs = performance.now();
  for (let i = 0; i < stress; i++) {
    // Hunger 100 starts them satisfied, so they neither path nor eat at
    // first and the measurement is of render and bridge throughput. It
    // stops being true within seconds: every need decays from M1a
    // onwards, and selection now runs one A* per candidate object per
    // idle agent per tick, so a long stress run measures pathing too.
    // Say which you are reading.
    //
    // This walks every tile of the lot in turn, so entities stack
    // several deep on each. That is deliberate rather than incidental:
    // it raises overdraw, which makes the test harder on the GPU, not
    // easier.
    sim.spawnAgent(i % lotWidth, Math.floor(i / lotWidth) % lotHeight, 100);
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

  // Centre the lot's screen-space bounding box on the canvas, derived
  // from the lot rather than hand-tuned. `screenX` spans
  // -(h - 1) to (w - 1) tile half-widths and `screenY` spans 0 to
  // (w - 1) + (h - 1) tile half-heights, so the two offsets below put the
  // middle of each range in the middle of the canvas. For the shipped
  // 24 x 18 lot that is originX 544, originY 40, and the diamond fits
  // 1280 x 720 exactly.
  //
  // Doing this by hand is how the lot ends up half off screen, which
  // looks like a broken projection rather than a badly placed camera.
  const originX =
    canvas.width / 2 - ((lotWidth - lotHeight) * TILE_HALF_WIDTH) / 2;
  const originY =
    (canvas.height - (lotWidth + lotHeight - 2) * TILE_HALF_HEIGHT) / 2;

  // `worldDepth` divides by (gridSize - 1) * 2, so this has to be at
  // least (w - 1) + (h - 1) for the far corner to keep a depth inside
  // [0, 1]; taking the larger side guarantees it for any lot, since
  // 2 * max(w, h) >= w + h. A depth outside the range does not sort
  // wrong, it clips the entity away entirely.
  const depthScale = Math.max(lotWidth, lotHeight);

  // The floor and the walls, built once. They are static for the whole
  // session, so they are uploaded here and never touched again rather
  // than being rebuilt inside `frame` sixty times a second; see
  // `tiles.ts` and [V11] for what an unexamined per-frame rebuild costs.
  //
  // The wall tiles come from the simulation's own `TileGrid`, not from
  // the content pack, so what is drawn is what `find_path` refuses to
  // walk through. A sim detouring to the doorway is then legible instead
  // of looking like an AI fault.
  const lot = { width: lotWidth, height: lotHeight, walls: sim.wallTiles() };
  const staticGeometry = buildStaticInstances(lot, originX, originY, depthScale);
  renderer.setStaticGeometry(staticGeometry.instances, staticGeometry.count);

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
    const instances = buildInstances(sim, alpha, originX, originY, depthScale);
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
