import fs from 'node:fs';import crypto from 'node:crypto';
import init,{SimHandle} from '../web/src/wasm/terri_wasm.js';
const sha=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
const module=fs.readFileSync('web/src/wasm/terri_wasm_bg.wasm');await init({module_or_path:module});
const original=fs.readFileSync('docs/evidence/2026-10-17-room-identities/published-v15-producer/published-v15-golden-public-100.sav');
if(sha(original)!=='e4d329c36b81dbe109d639bbfbca14760fb29b7dc567ddc7c1b4a647109d7325')throw Error('Original producer control changed');
const h=SimHandle.from_lot(),loaded=SimHandle.from_lot();
try {
  if(!h.load_bytes(original))throw Error('Authentic legacy control refused');
  const edges=Array.from(h.wall_edges()),current=h.save_bytes();
  if(edges.length!==0)throw Error('Historical empty LegacyCells became an edge layout');
  if(current[8]!==16||!loaded.load_bytes(current)||!Buffer.from(current).equals(Buffer.from(loaded.save_bytes())))throw Error('Current roundtrip');
  for(let n=0;n<120;n++){h.tick();loaded.tick();if(!Buffer.from(h.save_bytes()).equals(Buffer.from(loaded.save_bytes())))throw Error('Continuation');}
  const result={passed:true,source:JSON.parse(fs.readFileSync('.local-build/r6-final-native-source.json','utf8')).source_sha256,module_sha256:sha(module),original_sha256:sha(original),input_schema:15,current_schema:16,legacy_edge_projection:edges,current_sha256:sha(current),continuation_updates:120};
  fs.writeFileSync('.local-build/r6-legacy-control-result.json',JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result));
} finally {h.free();loaded.free();}
