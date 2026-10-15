import fs from 'node:fs';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {initSync, SimHandle} from '../../web/src/wasm/terri_wasm.js';

const binary=fs.readFileSync('web/src/wasm/terri_wasm_bg.wasm');
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const directory='crates/terri-wasm/tests/fixtures/command-memory/';
const queued=fs.readFileSync(directory+'queued-edit-pre-box-v9.sav');
const completed=fs.readFileSync(directory+'completed-edit-pre-box-v9.sav');
assert.equal(hash(queued),'e94ea6d0d9fe955a8f29f76a34edd7c06175bf08dec143c675d740aa36062fe9');
assert.equal(hash(completed),'4f8f0f5c48cf4e20f5e880980d68a2dd76e6e77ccdad4a622514b08d47907878');
initSync({module:binary});
const sim=SimHandle.from_lot();
try {
  assert.equal(sim.load_bytes(queued),true);
  assert.deepEqual(Buffer.from(sim.save_bytes()),queued);
  sim.flush_commands();
  assert.deepEqual(Buffer.from(sim.save_bytes()),completed);
  console.log(JSON.stringify({status:'PASS',wasmSha256:hash(binary),queuedBytes:queued.length,completedBytes:completed.length,queuedSha256:hash(queued),completedSha256:hash(completed)},null,2));
} finally {
  sim.free();
}
