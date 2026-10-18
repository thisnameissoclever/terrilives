import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import init,{SimHandle} from './p15-a481/web/src/wasm/terri_wasm.js';
const wasm=readFileSync(new URL('./p15-a481/web/src/wasm/terri_wasm_bg.wasm',import.meta.url));
await init({module_or_path:wasm});
const codec=fileURLToPath(new URL('./published-v15-codec.exe',import.meta.url));
const output=new URL('./published-v15-corpus/',import.meta.url);
mkdirSync(output,{recursive:true});
function decode(bytes){
  const result=spawnSync(codec,['inspect'],{input:bytes,maxBuffer:16*1024*1024});
  assert.equal(result.status,0,result.stderr.toString());
  return JSON.parse(result.stdout.toString());
}
function command(op,...args){
  const result=spawnSync(codec,[op,...args.map(String)]);
  assert.equal(result.status,0,result.stderr.toString());return result.stdout;
}
function saveNew(path,bytes){
  try{writeFileSync(path,bytes,{flag:'wx'});}catch(e){if(e.code!=='EEXIST')throw e;assert.deepEqual(readFileSync(path),bytes);}
}
const sim=SimHandle.from_lot_with_seed(42,0);
const candidates=[];const trace=[];let lastState;let updates=0;
const bytesOf=h=>Buffer.from(h.save_bytes());
function equalAll(context){
  const bytes=bytesOf(sim);const hash=sim.world_hash();
  for(const c of candidates){assert.equal(c.shadow.world_hash(),hash,`${context}: ${c.name} hash`);assert.deepEqual(bytesOf(c.shadow),bytes,`${context}: ${c.name} bytes`);}
  return bytes;
}
function enqueue(op,...args){
  const bytes=command(op,...args);
  assert.equal(sim.enqueue_command(bytes),true);
  for(const c of candidates)assert.equal(c.shadow.enqueue_command(bytes),true);
  trace.push({tick:String(sim.sim_tick()),operation:'enqueue',op,args,hex:bytes.toString('hex')});
  equalAll('enqueue');return bytes.toString('hex');
}
function flush(){sim.flush_commands();for(const c of candidates)c.shadow.flush_commands();trace.push({tick:String(sim.sim_tick()),operation:'flush'});equalAll('flush');}
function capture(name,guard,detail={}){
  if(candidates.some(c=>c.name===name))return;
  const bytes=equalAll(`capture ${name}`);const state=decode(bytes);guard(state);
  const shadow=SimHandle.from_lot_with_seed(7,0);
  assert.equal(shadow.load_bytes(bytes),true,`${name}: original load`);
  assert.deepEqual(bytesOf(shadow),bytes,`${name}: original exact resave`);
  assert.equal(shadow.world_hash(),sim.world_hash());
  candidates.push({name,bytes,state,shadow,hash:String(sim.world_hash()),capturedUpdates:updates,
    traceAtCapture:structuredClone(trace),detail});
  console.log(JSON.stringify({captured:name,tick:state.tick,requests:state.requests}));
}
function step(){
  sim.tick();for(const c of candidates)c.shadow.tick();updates++;
  const bytes=equalAll(`tick ${sim.sim_tick()}`);lastState=decode(bytes);return lastState;
}
try{
  lastState=decode(bytesOf(sim));
  const actors=lastState.entities.filter(e=>e.agent).sort((a,b)=>a.sim_id-b.sim_id);
  const A=actors.find(e=>e.name==='Bill');const B=actors.find(e=>e.name==='Tim');assert(A&&B);
  const chat=Array.from(sim.social_labels()).indexOf('Chat');assert(chat>=0);
  const roles={A:{index:A.index,simId:A.sim_id,name:A.name},B:{index:B.index,simId:B.sim_id,name:B.name}};
  const hex=enqueue('talk',A.index,B.index,chat);
  capture('chat-queued',s=>{assert(s.queued.some(c=>c.hex===hex));assert(!s.requests.some(r=>r.initiator===A.sim_id&&r.origin.kind==='player'));},{roles});
  let duplicateAdded=false;let firstOrder;let laterOrder;let firstRequest;let exactCompletion=null;
  for(let bound=0;bound<720;bound++){
    const s=step();
    const request=s.requests.find(r=>r.initiator===A.sim_id&&r.recipient===B.sim_id&&r.origin.kind==='player');
    if(request?.phase==='approaching'&&!candidates.some(c=>c.name==='chat-approaching')){
      capture('chat-approaching',t=>{const r=t.requests.find(r=>r.id===request.id);assert(r.target_owned);assert(t.rendezvous.some(([recipient,initiator])=>recipient===B.index&&initiator===A.index));assert(t.entities.find(e=>e.index===A.index).target?.object===B.index);},{roles,requestId:request.id,orderId:request.origin.order_id});
    }
    if(request?.phase==='waiting'&&request.target_owned&&request.waiting_tile&&!candidates.some(c=>c.name==='chat-waiting-owned')){
      capture('chat-waiting-owned',t=>{const r=t.requests.find(r=>r.id===request.id);assert(r.phase==='waiting'&&r.target_owned&&r.waiting_tile);assert.equal(t.entities.find(e=>e.index===A.index).target,null);assert(!t.rendezvous.some(([recipient,initiator])=>recipient===B.index&&initiator===A.index));},{roles,requestId:request.id,orderId:request.origin.order_id});
    }
    const waitingActor=s.entities.find(e=>e.index===A.index);
    if(request?.phase==='waiting'&&request.target_owned&&request.waiting_tile&&
      waitingActor.path===null&&waitingActor.blocked&&
      waitingActor.position.map(Math.round).every((n,i)=>n===request.waiting_tile[i])&&
      !candidates.some(c=>c.name==='chat-waiting-arrived')){
      capture('chat-waiting-arrived',t=>{const r=t.requests.find(r=>r.id===request.id);const a=t.entities.find(e=>e.index===A.index);const b=t.entities.find(e=>e.index===B.index);assert(a.path===null&&a.blocked);assert.deepEqual(a.position.map(Math.round),r.waiting_tile);assert.equal(a.target,null);assert.equal(b.reserved,false);assert(!t.rendezvous.some(([recipient,initiator])=>recipient===B.index&&initiator===A.index));},{roles,requestId:request.id,orderId:request.origin.order_id,naturalArrival:true});
    }
    if(request?.phase==='talking'&&!duplicateAdded){
      capture('chat-talking',t=>{const r=t.requests.find(r=>r.id===request.id);const actor=t.entities.find(e=>e.index===A.index);assert(r.target_owned);assert(actor.social?.partner===B.index&&actor.social.remaining>0);},{roles,requestId:request.id,orderId:request.origin.order_id});
      firstOrder=request.origin.order_id;firstRequest=request.id;
      enqueue('talk',A.index,B.index,chat);flush();lastState=decode(bytesOf(sim));
      const queue=lastState.queues.find(q=>q.owner===A.index);assert(queue);
      const later=queue.orders.find(o=>o.id!==firstOrder&&o.target===B.index&&o.action===`social:${request.interaction}`);
      assert(later,JSON.stringify({message:'Later exact social order missing',request,queue}));
      laterOrder=later.id;assert.notEqual(laterOrder,firstOrder);
      capture('chat-talking-later-identical',t=>{const q=t.queues.find(q=>q.owner===A.index);assert(q.orders.some(o=>o.id===firstOrder));assert(q.orders.some(o=>o.id===laterOrder));assert(t.requests.some(r=>r.id===firstRequest&&r.phase==='talking'&&r.origin.order_id===firstOrder));},{roles,requestId:firstRequest,firstOrder,laterOrder});
      duplicateAdded=true;
    }
    if(duplicateAdded&&!exactCompletion){
      const current=lastState.queues.find(q=>q.owner===A.index)?.orders??[];
      if(!current.some(o=>o.id===firstOrder)&&current.some(o=>o.id===laterOrder))exactCompletion={tick:lastState.tick,firstOrder,laterOrder};
    }
    if(bound%60===0)console.log(JSON.stringify({progressTick:s.tick,phases:s.requests.map(r=>({id:r.id,phase:r.phase,origin:r.origin})),captured:candidates.map(c=>c.name)}));
    const names=candidates.map(c=>c.name);
    if(names.includes('chat-approaching')&&names.includes('chat-talking-later-identical')&&exactCompletion&&candidates.every(c=>updates-c.capturedUpdates>=120))break;
  }
  assert(candidates.some(c=>c.name==='chat-approaching'),'No naturally approaching player request in bound');
  assert(candidates.some(c=>c.name==='chat-talking-later-identical'),'No talking duplicate-order case in bound');
  assert(exactCompletion,'Original first order did not complete while later order remained');
  for(const c of candidates){
    const replayUpdates=updates-c.capturedUpdates;assert(replayUpdates>=120);
    const receipt={source:'a481d7c7be0708c4523d9a156513b6696aaff6f6',seed:[42,0],schema:15,
      producerWasmSha256:createHash('sha256').update(wasm).digest('hex'),
      file:`${c.name}.sav`,bytes:c.bytes.length,sha256:createHash('sha256').update(c.bytes).digest('hex'),
      tick:c.state.tick,worldHash:c.hash,detail:c.detail,decoded:c.state,
      traceAtCapture:c.traceAtCapture,fullTrace:trace,
      strictOriginalReload:true,exactOriginalResave:true,decodedPayloadRoundtrip:true,
      uninterruptedVsReloaded:{updates:replayUpdates,exactSaveBytes:true,exactWorldHash:true},exactOrderCompletion:exactCompletion};
    saveNew(new URL(`${c.name}.sav`,output),c.bytes);
    writeFileSync(new URL(`${c.name}.json`,output),JSON.stringify(receipt,null,2));
  }
  console.log(JSON.stringify({complete:true,updates,fixtures:candidates.map(c=>({name:c.name,tick:c.state.tick,bytes:c.bytes.length,replayUpdates:updates-c.capturedUpdates})),exactCompletion}));
}finally{for(const c of candidates)c.shadow.free();sim.free();}
