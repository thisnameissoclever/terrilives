const {chromium}=require('C:/Users/myema/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {interactions,installObserver}=require('./interaction-observer.cjs');
const {camera}=require('./final-game-common.cjs');
const run=process.env.CAPTURE_RUN??'';assert(/^[a-z0-9-]*$/.test(run),'Invalid capture directory');
const out=path.resolve('docs/evidence/2026-10-13-creator-repair/interaction-contracts',run);fs.mkdirSync(out,{recursive:true});
const selected=interactions.filter(s=>!process.env.CASES||process.env.CASES.split(',').includes(s.id));
assert(selected.length>0,'No selected interaction cases');
if(process.env.CASES)assert(process.env.CASES.split(',').every(id=>interactions.some(s=>s.id===id)),'Unknown interaction selection');
(async()=>{
 const browser=await chromium.launch({channel:'chrome',headless:true,args:['--mute-audio']});
 const report={expected:selected.length*4,cases:[],diagnostics:[],failures:[],status:'running'};
 const save=()=>fs.writeFileSync(path.join(out,'receipt.json'),JSON.stringify(report,null,2));
 try{
  const page=await browser.newPage({viewport:{width:1600,height:1100}});
  page.on('pageerror',e=>report.diagnostics.push(e.stack));
  page.on('console',m=>{if(['warning','error'].includes(m.type())&&!m.location().url.endsWith('/favicon.ico'))report.diagnostics.push(m.text());});
  await page.goto('http://127.0.0.1:5187/?stress=0',{waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>window.__terriStress,null,{timeout:120000});
  if(await page.locator('#help-panel').evaluate(e=>e.open))await page.locator('#close-help').click();
  await page.getByText('Pause',{exact:true}).click();
  const frame=async()=>{await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));assert.deepEqual(report.diagnostics,[]);};
  await frame();await page.locator('#options-toggle').click();
  if(!(await page.locator('#lighting-mode').innerText()).includes('flat'))await page.locator('#lighting-mode').click();
  await page.locator('#options-toggle').click();await page.evaluate(installObserver);
  for(const spec of selected)for(const facing of [0,1,2,3]){
   const record={id:spec.id,facing,phases:[],status:'setting up'};report.cases.push(record);save();
   const setup=await page.evaluate(async({spec,facing})=>{
    const s=__terriStress.sim,{default:init,SimHandle}=await import('/src/wasm/terri_wasm.js'),{defaultAppearance}=await import('/src/character/schema.ts');await init();
    const fresh=SimHandle.from_lot();try{if(!(await globalThis.__terriStress.characters.loadBytes(fresh.save_bytes())))throw Error('Fresh household rejected');}finally{fresh.free();}
    const fixture=Array.from(s.ids()).find(id=>s.objectModel(id)?.id===spec.model),person=s.characterAppearances().find(p=>p.sim===(facing%2?2:1));
    if(fixture===undefined||!person)throw Error('Required household identity missing');
    const appearance=defaultAppearance(person.sim===1?'feminine':'masculine');
    appearance.body={height:person.sim===1?0:100,build:person.sim===1?100:0,shoulders:person.sim===1?100:0,hips:person.sim===1?0:100,torso:person.sim===1?100:0};
    (await globalThis.__terriStress.characters.edit(7600+person.sim, person.sim, {version:1,appearance}));s.flushCommands();
    const label=s.interactionLabels(fixture)[spec.interaction]+': '+s.objectName(fixture);
    const matches=[];
    for(const id of Array.from(s.ids()))for(const [index,name]of s.interactionLabels(id).entries())if(name+': '+s.objectName(id)===label)matches.push({id,index});
    if(matches.length!==1||matches[0].id!==fixture||matches[0].index!==spec.interaction)throw Error('Action label is not an exact unique fixture identity: '+JSON.stringify({label,matches}));
    const base=s.saveBytes(),row=Array.from(s.ids()).indexOf(fixture),x=s.positions()[row*2],y=s.positions()[row*2+1],spots=[];
    for(let y=0;y<13;y++)for(let x=0;x<16;x++)spots.push({x,y});spots.sort((a,b)=>Math.hypot(a.x-x,a.y-y)-Math.hypot(b.x-x,b.y-y));
    const attempts=[];
    for(const spot of spots){
     if(!(await globalThis.__terriStress.characters.loadBytes(base)))throw Error('Preflight restore refused');if(s.placementPreview(fixture,spot.x,spot.y,facing).reason!==null)continue;
     s.placeObject(fixture,spot.x,spot.y,facing);s.flushCommands();
     if(s.lastPlacementResult()?.reason!==null||s.objectFacing(fixture)!==facing)throw Error('Placement did not apply');
     const start=Array.from(s.saveBytes());if(!s.useObjectFirst(person.entity,fixture,spec.interaction))throw Error('Order not staged');s.flushCommands();
     let state,entered=false,exited=false,tick=0,firstActive=-1;
     for(;tick<spec.ticks;tick++){s.tick();state=observeRepairInteraction(spec,person.entity,fixture,label);if(state.active){if(!entered)firstActive=tick;entered=true;}else if(entered&&state.released){exited=true;break;}}
     attempts.push({spot,entered,exited,tick,last:state});
     if(entered&&exited){if(!(await globalThis.__terriStress.characters.loadBytes(Uint8Array.from(start))))throw Error('Capture restore refused');return{fixture,person,label,appearance,spot,start,attempts,firstActive};}
     if(attempts.length>=20)break;
    }
    throw Error('No complete interaction in existing tick budget: '+JSON.stringify(attempts));
   },{spec,facing});
   const {start,...info}=setup;record.setup=info;
   await frame();await camera(page,{scale:1.37,originX:800-(setup.spot.x-setup.spot.y)*32*1.37,originY:620-(setup.spot.x+setup.spot.y)*21*1.37});
   const crop={x:500,y:260,width:600,height:620};
   async function capture(phase,state,tick){
    await frame();const scene=await page.evaluate(()=>__terriStress.characters.snapshot()),actor=scene.actors.find(p=>p.entity===setup.person.entity);
    if(phase==='active'){
     assert(state.active);assert(actor,'Active actor not rendered');assert.equal(actor.clip,state.expectedClip);assert.equal(actor.fixture??null,state.expectedFixture);
     const [x,y,z]=actor.head,px=(x-y)*32*scene.view.scale+scene.view.originX,py=(x+y)*21*scene.view.scale+scene.view.originY-z*Math.sqrt(1166)*scene.view.scale;
     assert(px>=crop.x&&px<crop.x+crop.width&&py>=crop.y&&py<crop.y+crop.height,'Active head outside capture');
     const saveFile=`${spec.id}-${facing}-active-${tick}.sav`;
     fs.writeFileSync(path.join(out,saveFile),Buffer.from(await page.evaluate(()=>Array.from(__terriStress.sim.saveBytes()))));state.saveFile=saveFile;
    }
    const file=`${spec.id}-${facing}-${phase}-${tick}.png`;await page.screenshot({path:path.join(out,file),clip:crop});record.phases.push({phase,tick,state,actor,camera:scene.view,file});save();
   }
   await capture('unused',null,0);
   await page.evaluate(({spec,setup})=>{const s=__terriStress.sim;if(!s.useObjectFirst(setup.person.entity,setup.fixture,spec.interaction))throw Error('Capture order not staged');s.flushCommands();},{spec,setup});
   let entered=false,exited=false,activeTicks=0;
   for(let tick=0;tick<spec.ticks;tick++){
    const state=await page.evaluate(({spec,setup})=>{__terriStress.sim.tick();return observeRepairInteraction(spec,setup.person.entity,setup.fixture,setup.label);},{spec,setup});
    if(tick===setup.firstActive-1){assert(!state.active&&state.ownsOrder,'Expected approach boundary missing');await capture('approach',state,tick);}
    if(state.active){if(!entered){assert.equal(tick,setup.firstActive,'Replay entry differs from preflight');entered=true;await capture('entry',state,tick);}activeTicks++;if([1,4,9,19].includes(activeTicks))await capture('active',state,tick);}
    else if(entered&&state.released){await capture('exit',state,tick);exited=true;break;}
   }
   assert(entered&&exited,'Capture did not establish complete phases');assert(record.phases.some(p=>p.phase==='active'),'No active capture');assert(setup.firstActive===0||record.phases.some(p=>p.phase==='approach'),'No approach capture');record.status='CAPTURED';save();console.log(JSON.stringify({id:spec.id,facing,activeTicks,phases:record.phases.length}));
  }
  assert.equal(report.cases.length,report.expected);assert(report.cases.every(r=>r.status==='CAPTURED'));assert.deepEqual(report.diagnostics,[]);report.status='CAPTURED';
 }catch(error){report.status='FAIL';report.failures.push(String(error.stack??error));throw error;}
 finally{await browser.close();save();}
})().catch(error=>{console.error(error);process.exitCode=1;});
