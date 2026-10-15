const {chromium}=require('C:/Users/myema/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const fs=require('node:fs'),path=require('node:path');
const duration=Number(process.env.MEASURE_MS||15000),liveStepMs=Number(process.env.LIVE_STEP_MS||0);
const stats=values=>{const sorted=[...values].sort((a,b)=>a-b);return {median:sorted[Math.floor(sorted.length*.5)],p95:sorted[Math.floor(sorted.length*.95)],max:sorted.at(-1)};};
(async()=>{
 const out=path.resolve('docs/evidence/2026-10-12-full-character-creator/performance');fs.mkdirSync(out,{recursive:true});
 const browser=await chromium.launch({channel:'chrome',headless:true}),errors=[];let page;
 try{
  page=await browser.newPage({viewport:{width:2300,height:1200}});page.on('pageerror',e=>errors.push(String(e)));
  await page.goto('http://127.0.0.1:5187/?stress=0');await page.waitForFunction(()=>window.__terriStress,null,{timeout:120000});
  if(await page.locator('#help-panel').evaluate(el=>el.open))await page.locator('#close-help').click();await page.getByText('Pause',{exact:true}).click();
  await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
  const setup=await page.evaluate(async()=>{
   const sim=window.__terriStress.sim,{CharacterDraft}=await import('/src/character/draft.ts'),{default:init,SimHandle}=await import('/src/wasm/terri_wasm.js');await init();
   const fresh=SimHandle.from_lot();try{if(!(await window.__terriStress.characters.loadBytes(fresh.save_bytes())))throw Error('Fresh fixture could not load');}finally{fresh.free();}
   for(let i=0;i<3;i++){const household=sim.characterAppearances().map(row=>({sim_id:row.sim,name:sim.characterSnapshot(row.sim).name}));
    const draft=CharacterDraft.create(500+i,sim.characterCatalog(),household);if(!(await window.__terriStress.characters.create(10000+i, draft.resolve())))throw Error('Create queue refused');sim.flushCommands();
    const result=sim.characterResults().find(result=>result.request===10000+i);if(!result||result.reason!==null)throw Error('Create refused '+JSON.stringify(result));}
   const models=Array.from(sim.ids()).map(entity=>({entity,model:sim.objectModel(entity)})).filter(row=>row.model),people=sim.characterAppearances();
   const targets=['armchair','reading_chair','moving_box','sofa','desk','chair'];
   for(let i=0;i<people.length;i++){const target=models.find(row=>row.model.id===targets[i]);if(!target||!sim.useObject(people[i].entity,target.entity,sim.defaultInteraction(target.entity)))throw Error('Fixture command refused');}
   sim.flushCommands();let state=[];
   for(let tick=0;tick<300;tick++){
    sim.tick();const ids=Array.from(sim.ids()),positions=Array.from(sim.positions()),activities=Array.from(sim.activities()),actions=Array.from(sim.visualActions());
    state=people.map(p=>{const row=ids.indexOf(p.entity);return {sim:p.sim,entity:p.entity,x:positions[row*2],y:positions[row*2+1],activity:activities[row],action:actions[row]};});
    if(state.every(p=>p.activity!==6&&p.x>=0&&p.x<16&&p.y>=0&&p.y<13)&&state.some(p=>p.action===3)&&state.every((p,i)=>state.slice(i+1).every(q=>Math.hypot(p.x-q.x,p.y-q.y)>=1)))return {tick:sim.clockTick(),state,targets};
   }
   throw Error('Fixture predicate failed '+JSON.stringify(state));
  });
  await page.waitForFunction(()=>window.__terriStress.characters.snapshot().actors.length===6);
  const visible=await page.evaluate(async()=>{
   const h=window.__terriStress,{actors,view}=h.characters.snapshot(),found=[];
   for(const actor of actors){const [wx,wy,z]=actor.head,x=(wx-wy)*32*view.scale+view.originX,y=(wx+wy)*21*view.scale+view.originY-z*Math.sqrt(1166)*view.scale;let pixel=null;
    for(const dy of [8,16,24,32,40]){for(const dx of [0,-5,5,-10,10]){const px=Math.floor(x+dx*view.scale),py=Math.floor(y+dy*view.scale);if(px<0||py<0||px>=1700||py>=view.height)continue;const hit=await h.characters.pick(px,py);if(hit?.kind==='person'&&hit.sim===actor.sim){pixel=[px,py];break;}}if(pixel)break;}
    found.push({sim:actor.sim,pixel});}
   return found;
  });
  if(visible.some(person=>!person.pixel))throw Error('Six visible people were not established '+JSON.stringify(visible));
  await page.evaluate(async()=>{
   const h=window.__terriStress,{CreatorPreview}=await import('/src/ui/character-creator/preview.ts');
   const box=document.createElement('section');box.style.cssText='position:fixed;left:1700px;top:30px;background:#17191f;color:white;z-index:3';box.innerHTML='<p>Enlarged creator preview: seated reading</p><canvas width="608" height="800"></canvas><canvas width="96" height="128"></canvas>';document.body.append(box);
   const [large,small]=box.querySelectorAll('canvas'),preview=new CreatorPreview(h.graphicsDevice,navigator.gpu.getPreferredCanvasFormat(),large,small);
   const appearance=h.sim.characterSnapshot(3).appearance;await preview.draw(appearance,0,'read',0);
   window.benchmarkPreview={preview,appearance,box};
  });
  await page.waitForTimeout(2000);await page.screenshot({path:path.join(out,liveStepMs?'six-characters-moving-start.png':'six-characters-preview.png')});
  const report=await page.evaluate(async({duration,liveStepMs})=>{
   const h=window.__terriStress,p=window.benchmarkPreview,start=performance.now(),previewTimes=[],population=[],before=h.characters.snapshot(),tick=h.sim.clockTick();let stopped=false;
   const animate=async()=>{while(!stopped){await new Promise(requestAnimationFrame);const began=performance.now();await p.preview.draw(p.appearance,0,'read',((performance.now()-start)/800)%4);previewTimes.push(performance.now()-began);population.push(h.characters.snapshot().actors.length);}};
   const animation=animate(),tickTimer=liveStepMs?setInterval(()=>h.sim.tick(),liveStepMs):null;let frames;try{frames=await h.measureCharacters(duration);}finally{if(tickTimer!==null)clearInterval(tickTimer);stopped=true;await animation;}
   const scene=h.characters.snapshot(),info=h.graphicsDevice.adapterInfo,heap=performance.memory?{used:performance.memory.usedJSHeapSize,total:performance.memory.totalJSHeapSize}:null;
   p.preview.destroy();p.box.remove();return {frames,previewTimes,population,before,scene,tickStart:tick,tickEnd:h.sim.clockTick(),adapter:info?{vendor:info.vendor,architecture:info.architecture,device:info.device,description:info.description}:null,heap,wasmBytes:h.wasmMemoryBytes};
  },{duration,liveStepMs});
  const result={duration,liveStepMs,setup,visible,...report,cpu:stats(report.frames.cpuMs),completion:stats(report.frames.completionMs),interval:stats(report.frames.intervalMs),preview:stats(report.previewTimes),errors};
  fs.writeFileSync(path.join(out,`game-${duration}${liveStepMs?"-moving":""}.json`),JSON.stringify(result,null,2));
  if(report.population.some(n=>n!==6)||!liveStepMs&&report.tickStart!==report.tickEnd)throw Error('Stable six-person workload changed');
  console.log(JSON.stringify({samples:report.frames.samples,cpu:result.cpu,completion:result.completion,preview:result.preview,actors:report.scene.actors.map(a=>a.clip),errors}));if(errors.length)process.exitCode=1;
 }catch(error){if(page){const state=await page.evaluate(()=>{const h=window.__terriStress;if(!h)return null;const s=h.sim;return {tick:s.clockTick(),scene:h.characters.snapshot(),people:s.characterAppearances().map(p=>({...p,queue:s.actionQueueOf(p.entity)}))};}).catch(e=>({captureError:String(e)}));fs.writeFileSync(path.join(out,'failure.json'),JSON.stringify({error:String(error),state,errors},null,2));await page.screenshot({path:path.join(out,'failure.png')}).catch(()=>{});}throw error;}
 finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1});
