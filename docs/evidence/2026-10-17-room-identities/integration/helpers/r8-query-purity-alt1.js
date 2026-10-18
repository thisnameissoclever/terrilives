import init,{SimHandle} from '/src/wasm/terri_wasm.js';
import {SimBridge} from '/src/bridge.ts';
const serial=x=>JSON.stringify(x,(_,v)=>typeof v==='bigint'?String(v):v);
const must=(ok,label)=>{if(!ok)throw Error(label);};
const val=r=>{if(!r.ok)throw Error('Native refusal '+serial(r));return r.value;};
const same=(a,b)=>a.length===b.length&&a.every((v,i)=>v===b[i]);
const digest=async b=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',b)),v=>v.toString(16).padStart(2,'0')).join('');
const snapshot=s=>({tick:s.clockTick(),rows:Array.from(s.choreRows()),history:Array.from(s.choreHistory()),targets:Array.from(s.interactionTargets()),activities:Array.from(s.activities()),placement:s.lastPlacementResult()});
const semantic=r=>({groups:r.groups,rooms:r.rooms,retiredNames:r.retiredNames,duties:r.duties});
function query(s){for(let n=0;n<100;n++){const rows=Array.from(s.choreRows());s.choreHistory();for(let i=0;i<rows.length;i+=5)s.choreLocation(rows[i],rows[i+1]);s.roomSummaries();s.floorGrime();s.surfaceGrime();}}
export async function run(){
  const live=__terriStress.sim,liveBytes=live.saveBytes(),liveTick=live.clockTick();
  const seed=new Uint8Array(await(await fetch('/.scratch/r8-play-dirt.sav')).arrayBuffer()),moduleBytes=new Uint8Array(await(await fetch('/src/wasm/terri_wasm_bg.wasm')).arrayBuffer()),{memory}=await init();
  const report={utc:new Date().toISOString(),moduleSha256:await digest(moduleBytes),seedSha256:await digest(seed),cases:[]};
  must(report.moduleSha256==='6c0562aca59fe17b20000845ebeddb71337859b2b39bd8e212a10ec5ab3154c1','Module identity');
  for(const mode of ['cancel','confirm','dirty-end']){
    const handles=[SimHandle.from_lot(),SimHandle.from_lot()],sims=handles.map(h=>new SimBridge(h,memory));
    try{
      for(const s of sims){must(s.loadBytes(seed),'Seed admission');val(s.beginBuild());}
      const baseline=sims[0].saveBytes();must(same(baseline,sims[1].saveBytes()),'Baseline equality');
      for(const s of sims){const facing=s.objectFacing(7);must(facing!==null,'Facing exists');must(s.placeObject(7,7,5,facing),'Integral tile admission');s.flushCommands();must(s.lastPlacementResult()?.object===7&&s.lastPlacementResult()?.reason===null,'Drained placement receipt');}
      const before=snapshot(sims[0]);query(sims[0]);must(serial(snapshot(sims[0]))===serial(before),'Query changes public observations');
      must(same(sims[0].saveBytes(),baseline)&&same(sims[1].saveBytes(),baseline),'Committed isolation');
      const reviews=sims.map(s=>val(s.prepareBuildCommit()));
      must(serial(semantic(reviews[0]))===serial(semantic(reviews[1])),'Semantic review equality');
      must(reviews[0].token.session!==reviews[1].token.session,'Independent sessions');
      must(reviews[0].token.revision===reviews[1].token.revision&&reviews[0].token.preparation===reviews[1].token.preparation,'Same command/preparation counters');
      const anchors=reviews.map(r=>r.rooms.find(room=>room.anchor!==null).anchor);
      const cells=sims.map((s,i)=>val(s.buildComponentTiles(reviews[i].token,anchors[i])));
      query(sims[0]);for(let i=0;i<sims.length;i++)must(serial(val(sims[i].buildComponentTiles(reviews[i].token,anchors[i])))===serial(cells[i]),'Original own token remains valid');
      let refusalCodes=[],terminalBaseline;
      if(mode==='cancel'){
        for(const s of sims)val(s.cancelBuild());
        for(let i=0;i<sims.length;i++){const r=sims[i].commitBuild(reviews[i].token);must(!r.ok&&r.error.code===11,'Cancel stale token code11');refusalCodes.push(r.error.code);must(sims[i].buildActive()&&!sims[i].buildDirty(),'Cancel active clean');must(same(sims[i].saveBytes(),baseline),'Cancel restores exact baseline');}
        terminalBaseline=baseline;for(const s of sims)val(s.endBuild());
      }else if(mode==='confirm'){
        for(let i=0;i<sims.length;i++){val(sims[i].commitBuild(reviews[i].token));must(sims[i].buildActive()&&!sims[i].buildDirty(),'Adoption active clean');}
        terminalBaseline=sims[0].saveBytes();must(!same(terminalBaseline,baseline),'Adoption changes baseline');must(same(terminalBaseline,sims[1].saveBytes()),'Equal adopted bytes');for(const s of sims)val(s.endBuild());
      }else{
        for(const s of sims){must(s.buildDirty(),'Direct End receives dirty draft');val(s.endBuild());must(!s.buildActive(),'End inactive');must(same(s.saveBytes(),baseline),'Dirty End exact baseline');}
        for(let i=0;i<sims.length;i++){const r=sims[i].commitBuild(reviews[i].token);must(!r.ok&&r.error.code===1,'Ended token NotActive1');refusalCodes.push(r.error.code);}terminalBaseline=baseline;
      }
      for(const s of sims)must(!s.buildActive()&&same(s.saveBytes(),terminalBaseline),'End preserves selected baseline');
      must(serial(snapshot(sims[0]))===serial(snapshot(sims[1])),'Complete public checkpoint equality');
      const tableRows=[];for(const s of sims){const rows=Array.from(s.choreRows());const tables=[];for(let i=0;i<rows.length;i+=5)if(rows[i]===5)tables.push(rows.slice(i,i+5));must(tables.length===1&&tables[0][1]===(mode==='confirm'?0:2)&&tables[0][2]===1,'Expected owner/location');tableRows.push(tables[0]);}
      const beforeTick=sims[0].clockTick();must(sims[1].clockTick()===beforeTick,'Same pre-resume clock');for(const s of sims)s.tick();
      must(sims.every(s=>s.clockTick()===beforeTick+1),'First tick advances');must(same(sims[0].saveBytes(),sims[1].saveBytes()),'Exact first-tick save equality');
      report.cases.push({mode,semanticReviewEqual:true,tokens:reviews.map(r=>r.token),originalOwnTokensValid:true,queryBatches:2,queriesPerBatch:100,committedIsolation:true,refusalCodes,tableRows,firstTick:[beforeTick,sims[0].clockTick()],finalSha256:await digest(sims[0].saveBytes()),exactFinalEquality:true});
    }finally{for(const h of handles)h.free();}
  }
  report.liveUnchanged=live.clockTick()===liveTick&&same(live.saveBytes(),liveBytes);must(report.liveUnchanged,'Live game changed');
  report.limit='Public observations, token validity, committed/adopted saves and first tick were compared. Raw claims, raw draft and unsaved private resources are covered by retained static audit, not newly exposed getters.';
  return serial(report);
}
