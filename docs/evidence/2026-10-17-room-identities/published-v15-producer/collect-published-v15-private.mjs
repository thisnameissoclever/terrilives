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
const sha=b=>createHash('sha256').update(b).digest('hex');
const decode=b=>{const r=spawnSync(codec,['inspect'],{input:b,maxBuffer:16*1024*1024});assert.equal(r.status,0,r.stderr.toString());return JSON.parse(r.stdout.toString());};
const bytes=h=>Buffer.from(h.save_bytes());
const sim=SimHandle.from_lot_with_seed(42,0);let shadow;let captured;const trace=[];
const command=(op,...args)=>{const c=spawnSync(codec,[op,...args.map(String)]);assert.equal(c.status,0,c.stderr.toString());assert(sim.enqueue_command(c.stdout));trace.push({tick:String(sim.sim_tick()),operation:'enqueue',op,args,hex:c.stdout.toString('hex')});sim.flush_commands();trace.push({tick:String(sim.sim_tick()),operation:'flush'});};
try{
  const initial=decode(bytes(sim));const B=initial.entities.find(e=>e.name==='Bill');const bath=initial.entities.find(e=>e.model==='bathtub');assert(B&&bath);
  const action=Array.from(sim.interaction_labels(bath.index)).indexOf('Take a bath');assert(action>=0);
  command('use-front',B.index,bath.index,action);
  let started=false;
  for(let i=0;i<600;i++){
    const s=decode(bytes(sim));const b=s.entities.find(e=>e.index===B.index);
    if(b.eating?.model==='bathtub'&&b.eating.remaining>0){started=true;break;}
    sim.tick();
  }
  assert(started,'Bath did not start within bound');
  const beforeSpawn=decode(bytes(sim));sim.spawn_agent(11,8,100);
  const afterSpawn=decode(bytes(sim));const A=afterSpawn.entities.find(e=>e.agent&&!beforeSpawn.entities.some(old=>old.index===e.index));assert(A&&A.sim_id!==null,'Public spawn must issue a new person');
  trace.push({tick:String(sim.sim_tick()),operation:'spawn_agent',args:[11,8,100],index:A.index,simId:A.sim_id});
  const spawnControl=SimHandle.from_lot_with_seed(7,0);try{assert(spawnControl.load_bytes(bytes(sim)));assert.deepEqual(bytes(spawnControl),bytes(sim));}finally{spawnControl.free();}
  const chat=Array.from(sim.social_labels()).indexOf('Chat');assert(chat>=0);command('talk',A.index,B.index,chat);
  for(let i=0;i<600;i++){
    const data=bytes(sim);const s=decode(data);const b=s.entities.find(e=>e.index===B.index);
    const r=s.requests.find(r=>r.initiator===A.sim_id&&r.recipient===B.sim_id&&r.origin.kind==='player');
    if(r?.phase==='waiting'&&r.target_owned&&r.waiting_tile&&b.eating?.model==='bathtub'&&b.eating.remaining>0){
      assert.equal(s.entities.find(e=>e.index===A.index).target,null);assert(!s.rendezvous.some(([recipient,initiator])=>recipient===B.index&&initiator===A.index));
      shadow=SimHandle.from_lot_with_seed(7,0);assert(shadow.load_bytes(data));assert.deepEqual(bytes(shadow),data);assert.equal(shadow.world_hash(),sim.world_hash());
      captured={bytes:data,state:s,hash:String(sim.world_hash()),requestId:r.id,recipientActivity:b.eating};break;
    }
    sim.tick();
  }
  assert(captured,'No owned waiting request while recipient takes bath');
  for(let i=0;i<120;i++){sim.tick();shadow.tick();assert.deepEqual(bytes(sim),bytes(shadow));assert.equal(sim.world_hash(),shadow.world_hash());}
  const target=new URL('chat-waiting-private.sav',folder);
  try{writeFileSync(target,captured.bytes,{flag:'wx'});}catch(e){if(e.code!=='EEXIST')throw e;assert.deepEqual(readFileSync(target),captured.bytes);}
  const receipt={source:'a481d7c7be0708c4523d9a156513b6696aaff6f6',schema:15,seed:[42,0],file:'chat-waiting-private.sav',bytes:captured.bytes.length,sha256:sha(captured.bytes),producerWasmSha256:sha(wasm),tick:captured.state.tick,worldHash:captured.hash,decoded:captured.state,traceAtCapture:trace,detail:{roles:{A:{index:A.index,simId:A.sim_id,name:A.name},B:{index:B.index,simId:B.sim_id,name:B.name}},requestId:captured.requestId,recipientActivity:captured.recipientActivity},strictOriginalReload:true,exactOriginalResave:true,decodedPayloadRoundtrip:true,uninterruptedVsReloaded:{updates:120,exactSaveBytes:true,exactWorldHash:true}};
  writeFileSync(new URL('chat-waiting-private.json',folder),JSON.stringify(receipt,null,2));
  console.log(JSON.stringify({complete:true,file:receipt.file,tick:receipt.tick,bytes:receipt.bytes,sha256:receipt.sha256,detail:receipt.detail}));
}finally{shadow?.free();sim.free();}
