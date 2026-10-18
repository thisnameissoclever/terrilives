import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import init,{SimHandle} from './p15-a481/web/src/wasm/terri_wasm.js';
const wasm=readFileSync(new URL('./p15-a481/web/src/wasm/terri_wasm_bg.wasm',import.meta.url));
await init({module_or_path:wasm});
const codec=fileURLToPath(new URL('./published-v15-codec.exe',import.meta.url));
const folder=new URL('./published-v15-corpus/',import.meta.url);
const seed=readFileSync(new URL('chat-waiting-arrived.sav',folder));
const sha=b=>createHash('sha256').update(b).digest('hex');
const decode=b=>{const r=spawnSync(codec,['inspect'],{input:b,maxBuffer:16*1024*1024});assert.equal(r.status,0,r.stderr.toString());return JSON.parse(r.stdout.toString());};
const bytes=h=>Buffer.from(h.save_bytes());
const sim=SimHandle.from_lot_with_seed(42,0);let shadow;let captured;const trace=[];
try{
  assert(sim.load_bytes(seed));assert.deepEqual(bytes(sim),seed);
  const initial=decode(seed);const old=initial.requests.find(r=>r.initiator===1&&r.origin.kind==='player');assert(old?.phase==='waiting');
  const actor=initial.entities.find(e=>e.sim_id===1);const recipient=initial.entities.find(e=>e.sim_id===2);assert(actor&&recipient);
  const chat=Array.from(sim.social_labels()).indexOf('Chat');assert(chat>=0);
  const command=spawnSync(codec,['front',String(actor.index),String(recipient.index),String(chat)]);assert.equal(command.status,0,command.stderr.toString());
  assert(sim.enqueue_command(command.stdout));trace.push({tick:String(sim.sim_tick()),operation:'enqueue',op:'front',args:[actor.index,recipient.index,chat],hex:command.stdout.toString('hex')});
  sim.flush_commands();trace.push({tick:String(sim.sim_tick()),operation:'flush'});
  for(let i=0;i<600;i++){
    const b=bytes(sim);const s=decode(b);const r=s.requests.find(r=>r.id===old.id);
    if(r?.phase==='suspended'){
      assert.equal(r.target_owned,false);
      const q=s.queues.find(q=>q.owner===actor.index);assert(q.orders.some(o=>o.id===old.origin.order_id));
      assert(q.orders.some(o=>o.id!==old.origin.order_id&&o.target===recipient.index&&o.action==='social:chat'));
      shadow=SimHandle.from_lot_with_seed(7,0);assert(shadow.load_bytes(b));assert.deepEqual(bytes(shadow),b);assert.equal(shadow.world_hash(),sim.world_hash());
      captured={bytes:b,state:s,hash:String(sim.world_hash()),traceAtCapture:structuredClone(trace)};break;
    }
    sim.tick();trace.push({tick:String(sim.sim_tick()),operation:'tick'});
  }
  assert(captured,'No naturally suspended request within 600 updates');
  for(let i=0;i<120;i++){
    sim.tick();shadow.tick();assert.deepEqual(bytes(sim),bytes(shadow));assert.equal(sim.world_hash(),shadow.world_hash());
  }
  const target=new URL('chat-suspended.sav',folder);
  try{writeFileSync(target,captured.bytes,{flag:'wx'});}catch(e){if(e.code!=='EEXIST')throw e;assert.deepEqual(readFileSync(target),captured.bytes);}
  const receipt={source:'a481d7c7be0708c4523d9a156513b6696aaff6f6',schema:15,file:'chat-suspended.sav',bytes:captured.bytes.length,sha256:sha(captured.bytes),producerWasmSha256:sha(wasm),seedSnapshot:{file:'chat-waiting-arrived.sav',sha256:sha(seed)},tick:captured.state.tick,worldHash:captured.hash,decoded:captured.state,traceAtCapture:captured.traceAtCapture,strictOriginalReload:true,exactOriginalResave:true,decodedPayloadRoundtrip:true,uninterruptedVsReloaded:{updates:120,exactSaveBytes:true,exactWorldHash:true}};
  writeFileSync(new URL('chat-suspended.json',folder),JSON.stringify(receipt,null,2));
  console.log(JSON.stringify({complete:true,file:receipt.file,tick:receipt.tick,bytes:receipt.bytes,sha256:receipt.sha256,requests:captured.state.requests}));
}finally{shadow?.free();sim.free();}
