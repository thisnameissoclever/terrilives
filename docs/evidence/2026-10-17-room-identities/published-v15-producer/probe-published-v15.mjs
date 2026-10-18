import assert from 'node:assert/strict';
import {readFileSync, writeFileSync, mkdirSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import init, {SimHandle} from './p15-a481/web/src/wasm/terri_wasm.js';
const wasm = readFileSync(new URL('./p15-a481/web/src/wasm/terri_wasm_bg.wasm', import.meta.url));
await init({module_or_path:wasm});
const codec = new URL('./published-v15-codec.exe',import.meta.url);
const codecPath = decodeURIComponent(codec.pathname).replace(/^\/([A-Za-z]:)/,'$1');
function decode(bytes) {
  const result = spawnSync(codecPath,['inspect'],{input:bytes,maxBuffer:16*1024*1024});
  assert.equal(result.status,0,result.stderr.toString());
  return JSON.parse(result.stdout.toString());
}
const golden = spawnSync(codecPath,['use','3','9','0']);
assert.equal(golden.status,0);
assert.deepEqual([...golden.stdout],[1,3,9,0]);
const sim = SimHandle.from_lot_with_seed(42,0);
const loaded = SimHandle.from_lot_with_seed(7,0);
try {
  const bytes = Buffer.from(sim.save_bytes());
  assert.equal(bytes.readUInt16LE(8),15);
  const state = decode(bytes);
  assert.equal(loaded.load_bytes(bytes),true);
  assert.deepEqual(Buffer.from(loaded.save_bytes()),bytes);
  assert.equal(loaded.world_hash(),sim.world_hash());
  const actors = state.entities.filter(e=>e.agent);
  const objects = state.entities.filter(e=>e.model);
  const output = new URL('./published-v15-corpus/',import.meta.url);
  mkdirSync(output,{recursive:true});
  const savePath = new URL('fresh.sav',output);
  try { writeFileSync(savePath,bytes,{flag:'wx'}); }
  catch (error) { if(error.code!=='EEXIST') throw error; assert.deepEqual(readFileSync(savePath),bytes); }
  const startHash = String(sim.world_hash());
  for(let tick=0;tick<120;tick++) {
    sim.tick(); loaded.tick();
    assert.equal(loaded.world_hash(),sim.world_hash(),`original replay hash at ${tick}`);
    assert.deepEqual(Buffer.from(loaded.save_bytes()),Buffer.from(sim.save_bytes()),`original replay bytes at ${tick}`);
  }
  const receipt = {source:'a481d7c7be0708c4523d9a156513b6696aaff6f6',schema:15,seed:[42,0],
    producerWasmSha256:createHash('sha256').update(wasm).digest('hex'),
    bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex'),
    tick:state.tick,worldHash:startHash,requests:state.requests,nextRequestId:state.next_request_id,
    commandGolden:[...golden.stdout],strictOriginalReload:true,exactOriginalResave:true,
    originalReplayTicks:120,originalReplayExact:true,decodedPayloadRoundtrip:true,
    actors,socialLabels:sim.social_labels(),
    objects:objects.map(e=>({index:e.index,model:e.model,position:e.position,
      labels:sim.interaction_labels(e.index),defaultInteraction:sim.default_interaction(e.index)}))};
  writeFileSync(new URL('fresh.json',output),JSON.stringify(receipt,null,2));
  console.log(JSON.stringify({schema:15,bytes:bytes.length,sha256:receipt.sha256,actors,
    socialLabels:receipt.socialLabels,objects:receipt.objects.filter(o=>/toilet|shower|bath|bed|hob|sink/i.test(o.model)),
    exactOriginalReplayTicks:120},null,2));
} finally { loaded.free(); sim.free(); }
