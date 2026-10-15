import fs from 'node:fs';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {initSync,SimHandle} from '../../web/src/wasm/terri_wasm.js';

const binary=fs.readFileSync('web/src/wasm/terri_wasm_bg.wasm'),wasm=initSync({module:binary});
const source='docs/evidence/2026-10-13-creator-repair/final-game-review/dining-before-cooking.sav';
const input=fs.readFileSync(source),out='docs/evidence/2026-10-13-creator-repair/prepared-parity/contact-saves';
fs.mkdirSync(out,{recursive:true});
const rows=[];
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const varint=value=>{const bytes=[];do{const byte=value%128;value=Math.floor(value/128);bytes.push(byte|(value?128:0));}while(value);return bytes;};
for(const action of ['mop','exercise']){
 const sim=SimHandle.from_lot();
 try{
  assert.equal(sim.load_bytes(input),true);
  const column=pointer=>new Uint32Array(wasm.memory.buffer,pointer,sim.entity_count());
  const ids=[...column(sim.ids_ptr())],person=ids.find(id=>sim.sim_id_of(id)===(action==='mop'?1:2));
  assert.notEqual(person,undefined);
  if(action==='mop'){
   const grime=[...new Uint32Array(wasm.memory.buffer,sim.floor_grime_ptr(),sim.floor_grime_len())];let target;
   for(let i=0;i<grime.length;i+=2)if(grime[i+1]>0){const candidate=[...sim.floor_chore_at(grime[i]%sim.lot_width(),Math.floor(grime[i]/sim.lot_width()))];if(candidate.length===2&&candidate[0]===1){target=candidate;break;}}
   assert(target,'No dirty floor in the retained household');assert(sim.clean_chore(person,target[0],target[1],true));
  }else{
   const fixture=ids.find(id=>sim.objectModelId(id)==='moving_box');assert.notEqual(fixture,undefined);
   assert(sim.enqueue_command(Uint8Array.from([1,...varint(person),...varint(fixture),...varint(sim.default_interaction(fixture))])));
  }
  sim.flush_commands();let active=0,saved=0;
  for(let step=0;step<600&&saved<4;step++){
   sim.tick();const row=[...column(sim.ids_ptr())].indexOf(person);
   if(column(sim.visual_actions_ptr())[row]!== (action==='mop'?14:6))continue;
   if(active++%2)continue;
   const file=`${action}-${saved}.sav`,bytes=sim.save_bytes();fs.writeFileSync(out+'/'+file,bytes);
   rows.push({action,file,person,tick:Number(sim.sim_tick()),progress:column(sim.chore_progress_ptr())[row],sha256:hash(bytes)});saved++;
  }
  assert.equal(saved,4,action+' did not supply four active phases');
 }finally{sim.free();}
}
fs.writeFileSync(out+'/receipt.json',JSON.stringify({source,sourceSha256:hash(input),wasmSha256:hash(binary),rows},null,2));
console.log(JSON.stringify({saved:rows.length,actions:[...new Set(rows.map(row=>row.action))]}));
