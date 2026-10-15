const {chromium}=require('C:/Users/myema/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const label=process.env.CONTACT_RUN;
if(!label||!/^[a-z0-9-]+$/.test(label))throw Error('Provide a unique CONTACT_RUN label.');
const out=path.resolve('docs/evidence/2026-10-13-creator-repair/bike-contact-compilation',label);
if(fs.existsSync(out))throw Error('Refusing to overwrite runtime evidence.');
fs.mkdirSync(out,{recursive:true});
(async()=>{
 const browser=await chromium.launch({channel:'chrome',headless:false,args:['--mute-audio']}),report={errors:[],checks:[]};let page;
 try{
  page=await browser.newPage({viewport:{width:1600,height:1100}});
  page.on('pageerror',error=>report.errors.push(String(error)));
  page.on('console',message=>{if(['warning','error'].includes(message.type())&&!message.location().url.endsWith('/favicon.ico'))report.errors.push(message.text());});
  await page.goto('http://127.0.0.1:5187/?stress=0');
  await page.waitForFunction(()=>window.__terriStress,null,{timeout:120000});
  // Freeze the simulation before dismissing the initial help dialog.
  await page.evaluate(()=>document.querySelector('#speed-0').click());
  if(await page.locator('#help-panel').evaluate(element=>element.open))await page.locator('#close-help').click();
  const bytes=Array.from(fs.readFileSync('docs/evidence/2026-10-13-creator-repair/prepared-parity/contact-saves/exercise-0.sav'));
  report.load=await page.evaluate(async bytes=>{
   const h=window.__terriStress,before=h.sim.saveBytes();let guarded=false;
   try{h.sim.loadBytes(Uint8Array.from(bytes));}catch(error){guarded=String(error).includes('characters.loadBytes');}
   const after=h.sim.saveBytes();if(!guarded||before.length!==after.length||before.some((value,index)=>after[index]!==value))throw Error('Raw load mutated live state.');
   const start=performance.now();if(!await h.characters.loadBytes(Uint8Array.from(bytes)))throw Error('Active exercise save refused.');
   return {ms:performance.now()-start,readiness:h.characters.readiness(),guarded};
  },bytes);
  await page.waitForFunction(()=>window.__terriStress.characters.snapshot().actors.some(actor=>actor.clip==='exercise'));
  await page.screenshot({path:path.join(out,'exercise-before.png')});
  report.edit=await page.evaluate(async()=>{
   const h=window.__terriStress,person=h.sim.characterAppearances().find(row=>row.entity===36);
   if(!person)throw Error('Missing exercising person.');
   const old=h.sim.characterSnapshot(person.sim),appearance=structuredClone(old.appearance);
   appearance.presentation='feminine';appearance.body={height:0,build:0,shoulders:0,hips:0,torso:100};
   const before=Array.from(h.sim.saveBytes()),tick=h.sim.clockTick(),start=performance.now();let done=false,frames=0,changedDuringPreparation=false;
   const heartbeat=()=>{if(done)return;frames++;const current=h.sim.saveBytes();if(current.length!==before.length||before.some((v,i)=>current[i]!==v))changedDuringPreparation=true;requestAnimationFrame(heartbeat);};
   requestAnimationFrame(heartbeat);
   const accepted=await h.characters.edit(81001,person.sim,{version:1,appearance});done=true;
   if(!accepted)throw Error('Exercise edit refused.');
   const preparationMs=performance.now()-start,prepared=h.characters.readiness();
   h.sim.flushCommands();const result=h.sim.characterResults().find(row=>row.request===81001);
   if(!result||result.reason!==null)throw Error('Exercise edit command rejected '+JSON.stringify(result));
   if(JSON.stringify(h.sim.characterSnapshot(person.sim).appearance)!==JSON.stringify(appearance))throw Error('Appearance edit did not apply exactly.');
   return {person:person.sim,preparationMs,frames,changedDuringPreparation,tickBefore:tick,tickAfter:h.sim.clockTick(),prepared};
  });
  assert.equal(report.edit.changedDuringPreparation,false);
  assert.equal(report.edit.tickBefore,report.edit.tickAfter);
  assert.ok(report.edit.frames>0,'Contact preparation blocked every animation callback.');
  await page.waitForTimeout(350);
  report.afterEdit=await page.evaluate(()=>window.__terriStress.characters.readiness());
  assert.equal(report.afterEdit.service.compilations,report.edit.prepared.service.compilations);
  assert.equal(report.afterEdit.service.inFlight,0);
  await page.screenshot({path:path.join(out,'exercise-after.png')});
  report.cycle=await page.evaluate(async()=>{
   const h=window.__terriStress,before=h.characters.readiness();
   for(let i=0;i<8;i++){h.sim.tick();await new Promise(resolve=>requestAnimationFrame(resolve));}
   return {before,after:h.characters.readiness(),scene:h.characters.snapshot()};
  });
  assert.equal(report.cycle.after.service.compilations,report.cycle.before.service.compilations);
  assert.equal(report.cycle.after.service.inputPreparations,report.cycle.before.service.inputPreparations);
  assert.deepEqual(report.errors,[]);report.pass=true;
 }catch(error){report.pass=false;report.failure=String(error);process.exitCode=1;if(page)await page.screenshot({path:path.join(out,'failure.png')}).catch(()=>{});}
 finally{await browser.close();fs.writeFileSync(path.join(out,'report.json'),JSON.stringify(report,null,2));}
 console.log(JSON.stringify(report));
})().catch(error=>{console.error(error);process.exitCode=1;});
