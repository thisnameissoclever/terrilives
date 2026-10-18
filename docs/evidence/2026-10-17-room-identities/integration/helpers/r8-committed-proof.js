import init,{SimHandle} from '/src/wasm/terri_wasm.js';
import {SimBridge} from '/src/bridge.ts';
const digest=async bytes=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),b=>b.toString(16).padStart(2,'0')).join('');
const same=(a,b)=>a.length===b.length&&a.every((v,i)=>v===b[i]);
export async function prove() {
  const live=window.__terriStress.sim,before=live.saveBytes(),tick=live.clockTick();
  const original=new Uint8Array(await (await fetch('/.scratch/r8-play-dirt.sav')).arrayBuffer());
  const {memory}=await init(),h=SimHandle.from_lot();
  try {
    const other=new SimBridge(h,memory);
    if(!other.loadBytes(original))throw Error('Original seed refused');
    const canonical=other.saveBytes();
    if(!other.loadBytes(before))throw Error('Committed bytes refused');
    const rows=Array.from(other.choreRows()),duties=[];
    for(let i=0;i<rows.length;i+=5)if(rows[i]===5)duties.push({kind:rows[i],target:rows[i+1],owner:rows[i+2],dirt:rows[i+3],location:other.choreLocation(rows[i],rows[i+1])});
    const ids=Array.from(other.ids()),index=ids.indexOf(7),positions=other.positions();
    const report={utc:new Date().toISOString(),tick,seedSha256:await digest(original),committedSha256:await digest(before),canonicalSeedSha256:await digest(canonical),exactSeed:same(before,original),exactCanonicalSeed:same(before,canonical),strictCurrentLoad:true,exactResave:same(other.saveBytes(),before),duties,table:{id:7,position:Array.from(positions.slice(index*2,index*2+2)),dirt:other.surfaceGrime()[index]},liveUnchanged:same(before,live.saveBytes())&&live.clockTick()===tick,buildActive:live.buildActive(),buildDirty:live.buildDirty()};
    (window.__r8CommittedProof??=[]).push(report);return report;
  }finally {h.free();}
}
