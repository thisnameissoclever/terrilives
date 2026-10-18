import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import init,{SimHandle} from './p15-a481/web/src/wasm/terri_wasm.js';
const wasm=readFileSync(new URL('./p15-a481/web/src/wasm/terri_wasm_bg.wasm',import.meta.url));
await init({module_or_path:wasm});
const sim=new SimHandle(24,24);const shadow=new SimHandle(24,24);
const bytes=h=>Buffer.from(h.save_bytes());
const sha=b=>createHash('sha256').update(b).digest('hex');
const codec=fileURLToPath(new URL('./published-v15-codec.exe',import.meta.url));
const decode=b=>{const r=spawnSync(codec,['inspect'],{input:b,maxBuffer:16*1024*1024});assert.equal(r.status,0,r.stderr.toString());return JSON.parse(r.stdout.toString());};
try{
  assert(sim.spawn_object(18,14,'fridge'));
  for(let i=0;i<8;i++)sim.spawn_agent(1+i,1,30+i*5);
  const initial=bytes(sim);const initialState=decode(initial);
  assert.equal(initialState.entities.filter(e=>e.agent).length,8);
  for(let i=0;i<100;i++)sim.tick();
  const saved=bytes(sim);const state=decode(saved);
  const accepted=shadow.load_bytes(saved);
  const exactResave=accepted&&bytes(shadow).equals(saved);
  const receipt={source:'a481d7c7be0708c4523d9a156513b6696aaff6f6',producerWasmSha256:sha(wasm),recipe:{width:24,height:24,fridge:[18,14],agents:Array.from({length:8},(_,i)=>[1+i,1,30+i*5]),ticks:100},initialHash:sha(initial),worldHash:String(sim.world_hash()),bytes:saved.length,sha256:sha(saved),originalReload:accepted,exactResave,initialDecoded:initialState,decoded:state,scope:'Original public SimHandle spawn_object may carry components absent from native raw world.spawn; compare before attributing any difference.'};
  writeFileSync(new URL('./published-v15-golden-public-100.sav',import.meta.url),saved,{flag:'wx'});
  writeFileSync(new URL('./published-v15-golden-public-100.json',import.meta.url),JSON.stringify(receipt,null,2));
  console.log(JSON.stringify({worldHash:receipt.worldHash,bytes:receipt.bytes,sha256:receipt.sha256,originalReload:accepted,exactResave,agents:state.entities.filter(e=>e.agent).map(e=>({index:e.index,id:e.sim_id,position:e.position,needs:e.needs}))}));
}finally{sim.free();shadow.free();}
