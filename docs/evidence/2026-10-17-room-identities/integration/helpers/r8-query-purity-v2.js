import init,{SimHandle} from '/src/wasm/terri_wasm.js';
import {SimBridge} from '/src/bridge.ts';
const same=(a,b)=>a.length===b.length&&a.every((v,i)=>v===b[i]);
const must=(ok,label)=>{if(!ok)throw Error(label);};
const value=r=>{must(r.ok,'Native operation refused '+JSON.stringify(r));return r.value;};
const digest=async b=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',b)),v=>v.toString(16).padStart(2,'0')).join('');
function projection(sim){return {tick:sim.clockTick(),placement:sim.lastPlacementResult(),targets:Array.from(sim.interactionTargets()),activities:Array.from(sim.activities())};}
function query(sim,count){for(let n=0;n<count;n++){const rows=sim.choreRows();sim.choreHistory();for(let i=0;i<rows.length;i+=5)sim.choreLocation(rows[i],rows[i+1]);sim.roomSummaries();sim.floorGrime();sim.surfaceGrime();}}
export async function run(){
  const live=window.__terriStress.sim,liveBytes=live.saveBytes(),liveTick=live.clockTick();
  const seed=new Uint8Array(await(await fetch('/.scratch/r8-play-dirt.sav')).arrayBuffer()),{memory}=await init(),report={module:'6c0562aca59fe17b20000845ebeddb71337859b2b39bd8e212a10ec5ab3154c1',seed:await digest(seed),cases:[]};
  for(const mode of ['cancel','confirm']){
    const handles=[SimHandle.from_lot(),SimHandle.from_lot()],sims=handles.map(h=>new SimBridge(h,memory));
    try{
      for(const sim of sims){must(sim.loadBytes(seed),'Seed load');value(sim.beginBuild());}
      const baseline=sims[0].saveBytes();must(same(baseline,sims[1].saveBytes()),'Initial baseline equality');
      for(const sim of sims){must(sim.placeObject(7,7,5,sim.objectFacing(7)),'Move queue');sim.flushCommands();must(sim.lastPlacementResult()?.reason===null,'Move refusal');}
      const before=projection(sims[0]);query(sims[0],100);must(JSON.stringify(projection(sims[0]))===JSON.stringify(before),'Query changes runtime observations');
      must(same(sims[0].saveBytes(),baseline)&&same(sims[1].saveBytes(),baseline),'Draft committed equality');
      const reviews=sims.map(sim=>value(sim.prepareBuildCommit()));query(sims[0],100);
      must(JSON.stringify(reviews[0].token,(_,v)=>typeof v==='bigint'?String(v):v)===JSON.stringify(reviews[1].token,(_,v)=>typeof v==='bigint'?String(v):v),'Same preparation identity');
      let stale=null;
      if(mode==='cancel'){
        for(const sim of sims)value(sim.cancelBuild());
        const results=sims.map((sim,i)=>sim.commitBuild(reviews[i].token));must(results.every(r=>!r.ok),'Canceled tokens refused');stale=results;
        must(same(sims[0].saveBytes(),baseline)&&same(sims[1].saveBytes(),baseline),'Cancel exact baseline');
      }else for(let i=0;i<sims.length;i++)value(sims[i].commitBuild(reviews[i].token));
      must(same(sims[0].saveBytes(),sims[1].saveBytes()),'Post adoption/cancel byte equality');
      for(const sim of sims)value(sim.endBuild());
      const rows=Array.from(sims[0].choreRows()),table=[];for(let i=0;i<rows.length;i+=5)if(rows[i]===5)table.push(rows.slice(i,i+5));
      must(table.length===1&&table[0][1]===(mode==='confirm'?0:2)&&table[0][2]===1,'Expected table owner and location');
      must(same(sims[0].saveBytes(),sims[1].saveBytes()),'End bytes equal');
      const beforeTick=sims[0].clockTick();for(const sim of sims)sim.tick();
      must(same(sims[0].saveBytes(),sims[1].saveBytes()),'First resumed tick equality');
      report.cases.push({mode,queryPasses:200,projectionUnchanged:true,baselineEqual:true,table,staleTokensRefused:stale?true:null,firstTick:[beforeTick,sims[0].clockTick()],finalSha256:await digest(sims[0].saveBytes()),exactFinalEquality:true});
    }finally{for(const h of handles)h.free();}
  }
  report.liveUnchanged=live.clockTick()===liveTick&&same(live.saveBytes(),liveBytes);must(report.liveUnchanged,'Live game changed');
  report.limit='Existing interaction targets/activity/refusal getters and exact saved bytes were compared. Raw claims and unexported fields are covered by static audit, not a new public getter.';
  return report;
}
