import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

// Run from the repository root. Optional arguments select a frozen baseline.
const [js = 'web/src/wasm/terri_wasm.js', wasm = 'web/src/wasm/terri_wasm_bg.wasm',
  output = '.tmp/wasm-retention.json'] = process.argv.slice(2);
const require = createRequire(pathToFileURL(resolve('web/package.json')));
const ts = require('typescript');
const source = readFileSync('web/src/debug/stress-spawn.ts', 'utf8');
const compiled = ts.transpileModule(source, { compilerOptions: {
  target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022,
} }).outputText;
const { spawnStressAgents } = await import(`data:text/javascript,${encodeURIComponent(compiled)}`);
const { initSync, SimHandle } = await import(pathToFileURL(resolve(js)).href);
const bytes = readFileSync(wasm);
const sha256 = value => createHash('sha256').update(value).digest('hex');
const { memory } = initSync({ module: bytes });
const expected = [
  [60, '1689968484302009063'], [600, '6672627640496136405'],
  [1140, '10010906560745498215'], [1680, '17615774119548958193'],
];
const handle = SimHandle.from_lot_with_seed(104729, 130363);
const report = {
  scope: 'Simulation ticks and render sync only; WASM capacity, not live allocation or browser/audio memory',
  wasmSha256: sha256(bytes), spawnSourceSha256: sha256(source),
  seed: { low: 104729, high: 130363 }, samples: [], passed: false,
};
try {
  const initial = handle.entity_count();
  spawnStressAgents({ get count() { return handle.entity_count(); },
    spawnAgent(x, y, hunger) { handle.spawn_agent(x, y, hunger); },
  }, handle.lot_width(), handle.lot_height(), 1000);
  assert.equal(handle.entity_count(), initial + 1000);
  assert.equal(handle.entity_count(), 1037);
  report.afterSpawnCapacityBytes = memory.buffer.byteLength;
  for (const [tick, hash] of expected) {
    while (Number(handle.sim_tick()) < tick) handle.tick();
    const beforeObservationCapacityBytes = memory.buffer.byteLength;
    const worldHash = handle.world_hash().toString();
    const saved = handle.save_bytes();
    const sample = { tick, entities: handle.entity_count(), beforeObservationCapacityBytes,
      afterObservationCapacityBytes: memory.buffer.byteLength, worldHash,
      saveBytes: saved.length, saveSha256: sha256(saved) };
    report.samples.push(sample);
    console.log(JSON.stringify(sample));
    assert.equal(worldHash, hash, `world changed at tick ${tick}`);
  }
  report.passed = true;
} finally {
  handle.free();
  report.afterFreeCapacityBytes = memory.buffer.byteLength;
  writeFileSync(output, `${JSON.stringify(report, null, 2)}\n`);
}
