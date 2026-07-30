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
import { FixedStepDriver, buildInstances, instanceCount } from './frame.js';
import { TILE_HALF_HEIGHT, TILE_HALF_WIDTH } from './render/iso.js';
import { buildStaticInstances } from './render/tiles.js';
import { FrameTimer } from './perf.js';
import { NeedsPanel, buildNeedBars } from './ui/needs-panel.js';
import { buildTimeControls } from './ui/time-controls.js';
import { attachPointerInput } from './input.js';
import { KIND_AGENT } from './render/instances.js';

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
 * The speed the page opens at: real time. Not paused, because a game that
 * starts frozen looks broken rather than paused.
 */
const START_SPEED = 1;

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
  /**
   * Runs one frame's real work, exactly as the rAF callback would.
   *
   * `nowMs` defaults to `performance.now()`, which is what a **timing**
   * harness wants: the M0 exit gate measures how long a real frame takes, so
   * it must not fabricate the clock.
   *
   * A **behaviour** harness has the opposite need and the default actively
   * defeats it. `frame` derives its elapsed time from the gap between
   * successive `nowMs` values, so stepping in a tight loop passes deltas of
   * roughly zero, the fixed-step accumulator never fills, and the simulation
   * advances almost no ticks - while `timer.frames` climbs and the harness
   * reports hundreds of frames of nothing. That is [L14]'s failure with the
   * numbers moving instead of frozen, which is the harder version to spot,
   * and it is what the first run of Task 8's play session did before this
   * parameter existed.
   *
   * So: pass a monotonically increasing `nowMs` when you need the simulation
   * to actually run, and omit it when you need to know what a frame costs.
   */
  step(nowMs?: number): void;
  /**
   * The live bridge, and the camera offsets the projection was built with.
   *
   * Exposed for the same reason `step` is. [L14] is not only about frame
   * timing: in an agent-driven browser the tab does not composite, so
   * nothing that waits on a rendered frame can be verified at all - and a
   * click is exactly such a thing, because the command it enqueues is only
   * applied by a tick, and ticks come from the frame loop. Without this,
   * verifying that a click selects a sim means asking a person to look at a
   * picture, which is what [L17] cost a session to.
   *
   * `origin` is here rather than recomputed by the harness because a second
   * copy of the camera arithmetic is a harness that can agree with itself
   * while disagreeing with the game - it would compute a click position from
   * one camera and the renderer would draw from another, and the test would
   * fail for a reason that is not in the code under test.
   *
   * Present only under `?stress=N`, so the shipping page carries no extra
   * surface. It is a read-only view plus the command methods the player
   * already has through the mouse; it is not a back door into the world,
   * because [D-2] means there is no such thing - everything still goes
   * through a serialised command.
   */
  readonly sim: SimBridge;
  readonly origin: { readonly x: number; readonly y: number };
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

  // **Select it immediately, because an unselected sim makes the whole HUD
  // invisible.**
  //
  // Selection lives in the simulation ([D-5]) and started out empty, which
  // meant the page opened with the need panel `hidden` and nothing on screen
  // to say why. The first report from someone opening it cold was "it does not
  // show the need bars or allow any control" - and every part of it worked.
  // The bars were built and hidden, and selecting meant finding a 38 x 78
  // sprite somewhere on a 1280 x 720 canvas with nothing marking it as
  // clickable.
  //
  // That is not a rendering bug or an input bug; it is the game withholding
  // its only readout until the player guesses. With one sim in the household
  // there is no ambiguity about who to select, so selecting it is strictly
  // better than making the player find it - and it is what The Sims does with
  // a single-sim household too.
  //
  // It goes through a command like every other selection rather than reaching
  // into the world, so a replay of this session reproduces it ([D-2]). It
  // applies on the first tick, which is before the first frame the player can
  // see.
  //
  // Read out of the render buffer rather than remembered from `spawnAgent`,
  // because a raw entity index is the simulation's to hand out: `ids()` is the
  // row-to-entity mapping and `kinds()` says which rows are agents. This runs
  // BEFORE any filler is spawned below, so the single agent row here is the
  // sim the player is meant to be watching rather than whichever filler
  // happens to sort first.
  const ids = sim.ids();
  const kinds = sim.kinds();
  for (let row = 0; row < sim.count; row++) {
    if (kinds[row] === KIND_AGENT) {
      sim.select(ids[row]);
      break;
    }
  }

  // ?stress=1000 spawns idle filler entities to exercise the M0 exit
  // criterion: p95 frame time at or under 16.6 ms with 1,000 entities.
  //
  // The parameter's PRESENCE is what installs the harness handle, and the
  // number only says how much filler to add - so `?stress=0` means "give me
  // the harness on the world the player actually gets". That distinction was
  // added during Task 8's play session, where filler sims turned out to
  // contend for object reservations with the real one; measuring input
  // latency needs a lot with exactly one sim in it, and before this the only
  // way to get the harness was to add a second sim to the world being
  // measured.
  const stressParam = new URLSearchParams(location.search).get('stress');
  const stress = Number(stressParam ?? 0);
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
  driver.setSpeed(START_SPEED);

  // The two readouts. Both render simulation state and own nothing
  // ([D-5]): the bars' labels, the seven levels, the selection and the
  // refresh interval all come from the simulation, and the only thing
  // either panel remembers is when it last read.
  //
  // Absent elements are thrown on rather than skipped. A page whose
  // markup no longer matches this file would otherwise run with no bars
  // and no speed buttons, which reads as an unimplemented feature rather
  // than as a broken page - the same confusion [L17] cost a session to
  // diagnose from a rendered picture.
  const needsRoot = document.querySelector<HTMLElement>('#needs-panel');
  const speedRoot = document.querySelector<HTMLElement>('#time-controls');
  if (!needsRoot || !speedRoot) {
    throw new Error('missing #needs-panel or #time-controls');
  }
  const needsPanel = new NeedsPanel(
    needsRoot,
    buildNeedBars(document, needsRoot, sim.needNames()),
    sim.needBarRefreshMs(),
    sim.needMax(),
  );
  buildTimeControls(document, speedRoot, START_SPEED, (ticksPerFrame) => {
    // Both halves, in one place so neither can be forgotten.
    //
    // The command is what a replay and Layer 2 multiplayer would carry
    // ([D-2]), even though the simulation applies nothing for it today;
    // the driver call is what actually changes the speed. [D2]: it
    // multiplies how many steps run per frame and never how long a step
    // is.
    sim.setSpeed(ticksPerFrame);
    driver.setSpeed(ticksPerFrame);
  });

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
  // Clicks, last of the wiring because it needs the camera offsets above.
  // Left click selects a sim or directs the selected one at an object;
  // right click hands it back to its own judgement. Every one of those is
  // a serialised command ([D-2]) - nothing here reaches into the world.
  attachPointerInput(canvas, sim, originX, originY);

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
    // The selection comes from the simulation every frame rather than being
    // remembered here ([D-5]), so the ring cannot disagree with what the need
    // panel is showing.
    const selected = sim.selectedIndex();
    const instances = buildInstances(sim, alpha, originX, originY, depthScale, selected);
    renderer.draw(instances, instanceCount(sim, selected));

    // Inside the sample below rather than outside it, deliberately: the
    // panel is work the frame does, and a periodic cost measured outside
    // the budget is a budget that does not describe the frame ([L19]).
    // On five frames in six this is two comparisons and a return.
    needsPanel.update(nowMs, sim);

    timer.sample(performance.now() - nowMs);
    if (nowMs - lastReportMs > REPORT_INTERVAL_MS) {
      lastReportMs = nowMs;
      console.log(`entities ${sim.count}  ${timer.report()}`);
    }
  }

  if (stressParam !== null) {
    globalThis.__terriStress = {
      timer,
      entities: sim.count,
      step: (nowMs = performance.now()) => frame(nowMs),
      sim,
      origin: { x: originX, y: originY },
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
