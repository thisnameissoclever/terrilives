// The activity log's wasm memory, [AL-perf] in
// docs/specs/2026-10-18-activity-log.md, measured without a browser.
//
//   node scripts/activity-log-wasm-memory.mjs [--stress N] [--days D] [--frame F] [--pairs P] [--wasm-dir DIR] [--output FILE]
//
// Each run loads the built wasm package (web/src/wasm unless --wasm-dir
// names another copy, so build it first with wasm-pack) in a fresh Node process, spawns N filler agents as
// `?stress=N` does, and runs D game days, taking the log every F ticks as
// the page takes it once a frame. It records the wasm memory size and the
// log's counts at the end of every game day. Runs alternate between the log
// on and `set_activity_log_enabled(false)`, P pairs in all. The renderer,
// the HUD and the page's other per-frame calls are absent, so a difference
// between the two modes belongs to the simulation's side of the log.

import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = new URL('../', import.meta.url);
const DEFAULT_WASM_DIR = fileURLToPath(new URL('web/src/wasm/', root));
const RECORD_WORDS = 12;
const STORE_RECORDS = 2_000;

function parseArgs(argv) {
  const args = { stress: 100, days: 10, frame: 5, pairs: 3, output: null, child: null, wasmDir: DEFAULT_WASM_DIR };
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    const value = argv[index + 1];
    if (flag === '--child') args.child = value;
    else if (flag === '--output') args.output = value;
    else if (flag === '--wasm-dir') args.wasmDir = value;
    else if (['--stress', '--days', '--frame', '--pairs'].includes(flag)) {
      const number = Number(value);
      if (!Number.isSafeInteger(number) || number < 0) throw new Error(`${flag} needs a whole number`);
      args[flag.slice(2)] = number;
    } else {
      throw new Error(`unknown argument ${flag}`);
    }
    index += 1;
  }
  if (args.days < 1 || args.frame < 1 || args.pairs < 1) throw new Error('days, frame and pairs must be positive');
  return args;
}

/** Filler agents placed as `spawnStressAgents` in web/src/debug/stress-spawn.ts places them. */
function spawnFiller(handle, requested) {
  if (requested === 0) return;
  const width = handle.lot_width();
  const height = handle.lot_height();
  const initial = handle.entity_count();
  const accepted = [];
  for (let cell = 0; cell < width * height && handle.entity_count() - initial < requested; cell += 1) {
    const before = handle.entity_count();
    handle.spawn_agent(cell % width, Math.floor(cell / width), 100);
    if (handle.entity_count() > before) accepted.push(cell);
  }
  if (accepted.length === 0) throw new Error('no cell accepted a filler agent');
  for (let index = 0; handle.entity_count() - initial < requested; index += 1) {
    const cell = accepted[index % accepted.length];
    handle.spawn_agent(cell % width, Math.floor(cell / width), 100);
  }
}

async function child(args, logEnabled) {
  const module = await import(pathToFileURL(join(args.wasmDir, 'terri_wasm.js')).href);
  const bytes = readFileSync(join(args.wasmDir, 'terri_wasm_bg.wasm'));
  const { memory } = await module.default({ module_or_path: bytes });
  const handle = module.SimHandle.from_lot();
  handle.set_activity_log_enabled(logEnabled);
  spawnFiller(handle, args.stress);
  // The shell's store, so the copy costs what the page's drain costs.
  const store = new Uint32Array(STORE_RECORDS * RECORD_WORDS);
  let at = 0;
  let drained = 0;
  let largestFrame = 0;
  const dayTicks = 1_440;
  const samples = [{ day: 0, wasmMemoryBytes: memory.buffer.byteLength, drained, dropped: handle.activity_log_dropped() }];
  for (let day = 1; day <= args.days; day += 1) {
    for (let tick = 1; tick <= dayTicks; tick += 1) {
      handle.tick();
      if (tick % args.frame !== 0 && tick !== dayTicks) continue;
      const count = handle.activity_log_take();
      if (count === 0) continue;
      const view = new Uint32Array(memory.buffer, handle.activity_log_ptr(), count * RECORD_WORDS);
      for (let word = 0; word < view.length; word += 1) {
        store[at] = view[word];
        at = at + 1 === store.length ? 0 : at + 1;
      }
      drained += count;
      largestFrame = Math.max(largestFrame, count);
    }
    samples.push({ day, wasmMemoryBytes: memory.buffer.byteLength, drained, dropped: handle.activity_log_dropped() });
  }
  handle.free();
  return { logEnabled, largestFrame, samples };
}

function runChild(args, logEnabled) {
  const result = spawnSync(process.execPath, [
    fileURLToPath(import.meta.url), '--child', logEnabled ? 'on' : 'off',
    '--stress', String(args.stress), '--days', String(args.days), '--frame', String(args.frame),
    '--wasm-dir', args.wasmDir,
  ], { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
  if (result.status !== 0) throw new Error(`child failed with ${result.status}: ${result.stderr}`);
  return JSON.parse(result.stdout);
}

/** Growth from `from` to the last day, and the day memory last grew. */
function growth(run, from) {
  const first = run.samples.find(sample => sample.day === from);
  const last = run.samples[run.samples.length - 1];
  let lastGrowthDay = 0;
  for (let index = 1; index < run.samples.length; index += 1) {
    if (run.samples[index].wasmMemoryBytes > run.samples[index - 1].wasmMemoryBytes) lastGrowthDay = run.samples[index].day;
  }
  return { bytes: last.wasmMemoryBytes - first.wasmMemoryBytes, lastGrowthDay, finalBytes: last.wasmMemoryBytes };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.child !== null) {
    process.stdout.write(JSON.stringify(await child(args, args.child === 'on')));
    return;
  }
  const runs = [];
  for (let pair = 0; pair < args.pairs; pair += 1) {
    const order = pair % 2 === 0 ? [true, false] : [false, true];
    for (const logEnabled of order) runs.push({ pair, ...runChild(args, logEnabled) });
  }
  // From day 2 the store is full at stress 100 and the simulation's own
  // early growth is past; growth after it must match the disabled runs.
  const from = Math.min(2, args.days);
  const pairs = [...new Set(runs.map(run => run.pair))].map(pair => {
    const on = runs.find(run => run.pair === pair && run.logEnabled);
    const off = runs.find(run => run.pair === pair && !run.logEnabled);
    const onGrowth = growth(on, from);
    const offGrowth = growth(off, from);
    return {
      pair,
      finalDifferenceBytes: onGrowth.finalBytes - offGrowth.finalBytes,
      growthAfterDay: from,
      onGrowthBytes: onGrowth.bytes,
      offGrowthBytes: offGrowth.bytes,
      logGrowthBytes: onGrowth.bytes - offGrowth.bytes,
      onLastGrowthDay: onGrowth.lastGrowthDay,
      offLastGrowthDay: offGrowth.lastGrowthDay,
      largestFrame: on.largestFrame,
      dropped: on.samples[on.samples.length - 1].dropped,
    };
  });
  const report = { generatedAt: new Date().toISOString(), args: { ...args, child: undefined }, pairs, runs };
  const json = `${JSON.stringify(report, null, 2)}\n`;
  if (args.output !== null) writeFileSync(args.output, json, 'utf8');
  process.stdout.write(json);
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
