// Run with the preserved published JavaScript module and its matching WASM binary.
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
const modulePath = resolve(process.argv[2]);
const wasmPath = resolve(process.argv[3]);
const wasmBytes = readFileSync(wasmPath);
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
if (sha(wasmBytes) !== '3dba220ce517712e3483567ccb8aed543264534977357cdf8b59930c7de520c7') throw Error('unexpected published WASM');
const module = await import(pathToFileURL(modulePath).href);
const wasm = await module.default({ module_or_path: wasmBytes });
const out = dirname(fileURLToPath(import.meta.url));
const manifest = {
  sourceCommit: 'b6078ea472c6b596a7aa7491a3d1b0f491fd24c7',
  sourceReceipt: 'docs/evidence/2026-10-19-social-balance/verification.md',
  wasmSha256: sha(wasmBytes), javascriptSha256: sha(readFileSync(modulePath)),
  commandBytes: [4, 34, 35, 1],
  fixtures: [],
};
const sim = module.SimHandle.from_lot();
function capture(name) {
  const bytes = sim.save_bytes();
  if (bytes[8] !== 19 || bytes[9] !== 0) throw Error('producer does not emit nineteen');
  const topics = [...new Uint32Array(wasm.memory.buffer, sim.conversation_topics_ptr(), sim.entity_count())];
  const control = module.SimHandle.from_lot();
  let sourceReaderAccepts;
  try { sourceReaderAccepts = control.load_bytes(bytes); } finally { control.free(); }
  const row = { name, length: bytes.length, sha256: sha(bytes), tick: String(sim.sim_tick()), worldHash: String(sim.world_hash()), fightTopics: topics.filter(t => t >= 24 && t <= 26), sourceReaderAccepts };
  writeFileSync(join(out, name), bytes);
  manifest.fixtures.push(row);
}
try {
  capture('initial.sav');
  const people = [...new Uint32Array(wasm.memory.buffer, sim.ids_ptr(), sim.entity_count())].filter(id => sim.sim_name(id));
  if (people[0] !== 34 || people[1] !== 35 || sim.social_labels()[1] !== 'Fight') throw Error('producer cast changed');
  if (!sim.enqueue_command(new Uint8Array(manifest.commandBytes))) throw Error('published fight order refused');
  let running = false;
  for (let i = 0; i < 500; i++) {
    sim.tick();
    const topics = new Uint32Array(wasm.memory.buffer, sim.conversation_topics_ptr(), sim.entity_count());
    if (topics.some(t => t >= 24 && t <= 26)) { running = true; break; }
  }
  if (!running || sim.sim_tick() !== 49n) throw Error('published running argument changed');
  capture('running-fight.sav');
  writeFileSync(join(out, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
  console.log(JSON.stringify(manifest));
} finally { sim.free(); }
