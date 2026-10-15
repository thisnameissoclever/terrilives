import fs from 'node:fs';
import init, { SimHandle } from './wasm-local-v9/wasm/terri_wasm.js';
const wasm = fs.readFileSync(new URL('./wasm-local-v9/wasm/terri_wasm_bg.wasm',import.meta.url));
await init({ module_or_path: wasm });
const path = 'crates/terri-wasm/tests/fixtures/schema-v9'; fs.mkdirSync(path,{recursive:true});
const sim=SimHandle.from_lot();
try {
 for(const tick of [0,400,1200]) {
  while(sim.sim_tick()<BigInt(tick)) sim.tick();
  const bytes=sim.save_bytes();
  if(new DataView(bytes.buffer,bytes.byteOffset).getUint16(8,true)!==9) throw new Error('Expected local V9');
  fs.writeFileSync(`${path}/local-character-${tick}.sav`,bytes);
  console.log(tick,bytes.length,String(sim.world_hash()));
 }
} finally {sim.free();}
