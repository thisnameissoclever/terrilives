const {chromium}=require('C:/Users/myema/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const duration=Number(process.env.MEASURE_MS||15000),liveStepMs=Number(process.env.LIVE_STEP_MS||0);
const normalDriver=process.env.NORMAL_DRIVER==='1',suffix=normalDriver?'-normal-driver':liveStepMs?'-moving':'';
const gameUrl=process.env.GAME_URL??'http://127.0.0.1:5187';
const stats=values=>{if(!values.length||values.some(value=>!Number.isFinite(value)))throw Error('Invalid measurement samples');const sorted=[...values].sort((a,b)=>a-b);return {count:sorted.length,median:sorted[Math.floor(sorted.length*.5)],p95:sorted[Math.floor(sorted.length*.95)],p99:sorted[Math.floor(sorted.length*.99)],max:sorted.at(-1),overBudget:sorted.filter(x=>x>16.6).length,budgetMs:16.6};};
const cadence=values=>{const {overBudget,budgetMs,...distribution}=stats(values);return {...distribution,medianHz:1000/distribution.median};};
const bounded=(promise,ms,label)=>{let timer;return Promise.race([promise,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error(label+' exceeded its liveness limit')),ms);})]).finally(()=>clearTimeout(timer));};
const sourceHashes=()=>{
 const files=fs.readdirSync('web/src/render/character').filter(file=>/\.(ts|wgsl)$/.test(file)).map(file=>'web/src/render/character/'+file);
 files.push('web/src/ui/character-creator/preview.ts','web/src/main.ts','web/src/wasm/terri_wasm_bg.wasm',
  'assets/models/sims/character-creator/export/manifest.json');
 return Object.fromEntries(files.sort().map(file=>[file,crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')]));
};
const textureEstimate=textures=>{
 const bytesPerPixel={r8unorm:1,r8uint:1,r16float:2,rg8unorm:2,rgba8unorm:4,'rgba8unorm-srgb':4,bgra8unorm:4,'bgra8unorm-srgb':4,r32float:4,r32uint:4,depth24plus:4,depth32float:4,rgba16float:8,rg32uint:8,rgba32float:16};
 const rows=textures.map(texture=>{const size=texture.size,w=Array.isArray(size)?size[0]:size.width,h=Array.isArray(size)?size[1]??1:size.height??1,layers=Array.isArray(size)?size[2]??1:size.depthOrArrayLayers??1;
  const bpp=bytesPerPixel[texture.format];if(!bpp)throw Error('Unaccounted texture format '+texture.format);
  let bytes=0;for(let mip=0;mip<texture.mips;mip++)bytes+=Math.max(1,w>>mip)*Math.max(1,h>>mip)*(texture.dimension==='3d'?Math.max(1,layers>>mip):layers)*bpp*texture.samples;
  return {...texture,estimatedBytes:bytes};});
 return {estimatedBytes:rows.reduce((sum,row)=>sum+row.estimatedBytes,0),note:'Explicit allocations only; depth24plus estimated at four bytes per sample. Driver padding, staging, and canvas swapchains are excluded.',textures:rows};
};
(async()=>{
 const label=process.env.RUN_LABEL??'';if(label&&!/^[a-z0-9-]+$/.test(label))throw Error('Invalid measurement label');
 const out=path.resolve(process.env.PERFORMANCE_EVIDENCE_DIR||'docs/evidence/2026-10-13-creator-repair/performance',label);fs.mkdirSync(out,{recursive:true});
 const beforeHashes=sourceHashes();
 const {initSync,SimHandle}=await import('../../web/src/wasm/terri_wasm.js');initSync({module:fs.readFileSync('web/src/wasm/terri_wasm_bg.wasm')});
 const fixture=SimHandle.from_lot();let freshBytes;try{freshBytes=Array.from(fixture.save_bytes());}finally{fixture.free();}
 const browser=await chromium.launch({channel:'chrome',headless:false,args:['--mute-audio']}),errors=[];let page;
 try{
  page=await browser.newPage({viewport:{width:2400,height:1200}});page.on('pageerror',e=>errors.push(String(e)));page.on('console',m=>{if(['error','warning'].includes(m.type())&&!m.location().url.endsWith('/favicon.ico'))errors.push(m.text());});
  await page.addInitScript(()=>{
   const request=GPUAdapter.prototype.requestDevice;
   GPUAdapter.prototype.requestDevice=async function(...args){
    const device=await request.apply(this,args),buffers=new Set(),textures=new Map();
    const cb=device.createBuffer.bind(device),ct=device.createTexture.bind(device);
    device.createBuffer=function(d){const b=cb(d);buffers.add(b);const destroy=b.destroy.bind(b);b.destroy=()=>{buffers.delete(b);destroy();};return b;};
    device.createTexture=function(d){const t=ct(d);textures.set(t,{format:d.format,size:d.size,dimension:d.dimension??'2d',mips:d.mipLevelCount??1,samples:d.sampleCount??1});const destroy=t.destroy.bind(t);t.destroy=()=>{textures.delete(t);destroy();};return t;};
    const programEvents=[];
    for(const name of ['createShaderModule','createRenderPipeline','createComputePipeline']){const create=device[name].bind(device);device[name]=function(...args){programEvents.push({name,time:performance.now()});return create(...args);};}
    window.benchmarkResources={buffers,textures,programEvents};return device;
   };
  });
  const navigationStarted=Date.now();
  await page.goto(gameUrl+'/?stress=0',{waitUntil:'domcontentloaded'});await page.bringToFront();await page.waitForFunction(()=>window.__terriStress,null,{timeout:120000});
  const readyAfterNavigationMs=Date.now()-navigationStarted;
  if(await page.locator('#help-panel').evaluate(el=>el.open))await page.locator('#close-help').click();await page.getByText('Pause',{exact:true}).click();await page.mouse.move(1200,600);
  await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
  await page.evaluate(()=>{window.benchmarkPhases={configurationStarted:performance.now()};window.benchmarkColdFrames=__terriStress.measureCharacters(2000).then(report=>{window.benchmarkPhases.configurationWindowEnded=performance.now();return report;});});
  const setup=await page.evaluate(async bytes=>{
   const harness=window.__terriStress,sim=harness.sim;
   if(!await harness.characters.loadBytes(Uint8Array.from(bytes)))throw Error('Fresh fixture could not load');
   for(let i=0;i<3;i++){
    const draft=harness.characters.createDraft(500+i);if(!await harness.characters.create(10000+i,draft))throw Error('Create queue refused');sim.flushCommands();
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
  },freshBytes);
  await page.waitForFunction(()=>window.__terriStress.characters.snapshot().actors.length===6);
  const visible=await page.evaluate(async()=>{window.benchmarkVisible=async()=>{
   const h=window.__terriStress,{actors,view}=h.characters.snapshot(),found=[];
   for(const actor of actors){const [wx,wy,z]=actor.head,x=(wx-wy)*32*view.scale+view.originX,y=(wx+wy)*21*view.scale+view.originY-z*Math.sqrt(1166)*view.scale;let pixel=null;
    for(const dy of [8,16,24,32,40]){for(const dx of [0,-5,5,-10,10]){const px=Math.floor(x+dx*view.scale),py=Math.floor(y+dy*view.scale);if(px<0||py<0||px>=1700||py>=view.height)continue;const hit=await h.characters.pick(px,py);if(hit?.kind==='person'&&hit.sim===actor.sim){pixel=[px,py];break;}}if(pixel)break;}
    found.push({sim:actor.sim,pixel});}
   return found;};return window.benchmarkVisible();
  });
  if(visible.some(person=>!person.pixel))throw Error('Six visible people were not established '+JSON.stringify(visible));
  await page.evaluate(async()=>{
   window.benchmarkPhases.previewStarted=performance.now();
   const h=window.__terriStress;
   const box=document.createElement('section');box.style.cssText='position:fixed;left:1700px;top:30px;background:#17191f;color:white;z-index:3';box.innerHTML='<p>Enlarged creator preview: seated reading</p><canvas width="608" height="800"></canvas><canvas width="96" height="128"></canvas>';document.body.append(box);
   const [large,small]=box.querySelectorAll('canvas'),{preview,samples}=await h.characters.createPreview(large,small,'read');
   if(!Number.isInteger(samples)||samples<=0)throw Error('Preview sample count is invalid');
   const appearance=h.sim.characterSnapshot(3).appearance;await preview.draw(appearance,0,'read',0);
   window.benchmarkPreview={preview,appearance,box,samples};
   window.benchmarkPhases.previewReady=performance.now();
  });
  await page.evaluate(()=>window.benchmarkColdFrames);
  await page.waitForTimeout(2000);await page.screenshot({path:path.join(out,liveStepMs?'six-characters-moving-start.png':'six-characters-preview.png')});
  const profiler=process.env.CPU_PROFILE?await page.context().newCDPSession(page):null;
  let profileAnchor=null;
  if(profiler){await profiler.send('Profiler.enable');await profiler.send('Profiler.setSamplingInterval',{interval:1000});const before=await page.evaluate(()=>performance.now());await profiler.send('Profiler.start');profileAnchor={beforeStart:before,afterStart:await page.evaluate(()=>performance.now())};}
  const report=await bounded(page.evaluate(async({duration,liveStepMs,normalDriver})=>{
   const h=window.__terriStress,p=window.benchmarkPreview,start=performance.now(),previewTimes=[],pairedFrameMs=[],previewCadenceMs=[],previewFrames=[],population=[],visibility=[],focus=[],before=h.characters.snapshot(),contactBefore=h.characters.readiness(),tick=h.sim.clockTick(),cameraFrames=[],transitions=[],probeMs=[];let stopped=false,previousPreview=0;
   const slot=()=>({entity:0,sim:0,clip:'',sample:0,resourceId:0,bodyCompactions:0,bodyShapeChanges:0,attachmentChanges:0});
   const probe={count:0,hasView:false,originX:0,originY:0,scale:0,width:0,height:0,actors:Array.from({length:6},slot)},previousActors=Array.from({length:6},slot);
   const cameraKeys=['originX','originY','scale','width','height'],actorKeys=['entity','sim','clip','resourceId','bodyCompactions','bodyShapeChanges','attachmentChanges'];
   const observe=()=>{const began=performance.now();h.characters.probeFrame(probe);if(!probe.hasView)throw Error('No measured scene view');population.push(probe.count);
    const prior=cameraFrames.at(-1);if(!prior||cameraKeys.some(key=>prior[key]!==probe[key]))cameraFrames.push({time:began,...Object.fromEntries(cameraKeys.map(key=>[key,probe[key]]))});
    for(let i=0;i<probe.count;i++){const current=probe.actors[i],previous=previousActors[i];if(actorKeys.some(key=>previous[key]!==current[key])){transitions.push({time:began,...current});Object.assign(previous,current);}}
    visibility.push(document.visibilityState);focus.push(document.hasFocus());probeMs.push(performance.now()-began);
   };
   const animate=async()=>{while(!stopped){const rafStamp=await new Promise(requestAnimationFrame);if(stopped)break;const began=performance.now();await p.preview.draw(p.appearance,0,'read',((began-start)/4800*p.samples)%p.samples);const ended=performance.now();previewTimes.push(ended-began);pairedFrameMs.push(ended-rafStamp);if(previousPreview)previewCadenceMs.push(began-previousPreview);previousPreview=began;previewFrames.push({rafStamp,began,ended});observe();}};
   if(normalDriver)document.querySelector('#speed-1').click();
   const animation=animate(),tickTimer=liveStepMs&&!normalDriver?setInterval(()=>h.sim.tick(),liveStepMs):null;let frames;try{frames=await h.measureCharacters(duration);}finally{if(tickTimer!==null)clearInterval(tickTimer);if(normalDriver)document.querySelector('#speed-0').click();stopped=true;await animation;}
   const scene=h.characters.snapshot(),info=h.graphicsDevice.adapterInfo,heap=performance.memory?{used:performance.memory.usedJSHeapSize,total:performance.memory.totalJSHeapSize}:null;
   const tracked=window.benchmarkResources;const allocations={bufferBytes:[...tracked.buffers].reduce((n,b)=>n+b.size,0),bufferCount:tracked.buffers.size,textures:[...tracked.textures.values()]};
   const coldFrames=await window.benchmarkColdFrames;
   const programEvents=tracked.programEvents;
   const contactAfter=h.characters.readiness();p.preview.destroy();p.box.remove();return {allocations,coldFrames,phases:window.benchmarkPhases,measurementStarted:start,measurementEnded:performance.now(),transitions,programEvents,probeMs,contactBefore,contactAfter,frames,previewTimes,pairedFrameMs,previewCadenceMs,previewFrames,population,visibility,focus,cameraFrames,before,scene,devicePixelRatio:window.devicePixelRatio,tickStart:tick,tickEnd:h.sim.clockTick(),adapter:info?{vendor:info.vendor,architecture:info.architecture,device:info.device,description:info.description}:null,heap,wasmBytes:h.wasmMemoryBytes};
  },{duration,liveStepMs,normalDriver}),duration+45000,'Frame measurement');
  if(profiler){const profile=await profiler.send('Profiler.stop');fs.writeFileSync(path.join(out,'moving.cpuprofile'),JSON.stringify(profile.profile));await profiler.detach();}
  fs.writeFileSync(path.join(out,`raw-${duration}${suffix}.json`),JSON.stringify(report,null,2));
  await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
  const visibleAfter=await page.evaluate(()=>window.benchmarkVisible());
  if(report.frames.timingVersion!==2||report.coldFrames.timingVersion!==2)throw Error('The measured build lacks separate execution and latency timestamps');
  const result={gameUrl,viewport:[2400,1200],browserMode:'visible Chrome on desktop GPU',browserVersion:browser.version(),profiling:!!profiler,profileAnchor,duration,liveStepMs,normalDriver,readyAfterNavigationMs,setup,visible,visibleAfter,...report,textureAllocation:textureEstimate(report.allocations.textures),cold:{description:'Two-second configuration window after game startup; separate timestamps establish whether preview initialization overlaps this window',firstPreviewMs:report.phases.previewReady-report.phases.previewStarted,cpu:stats(report.coldFrames.cpuMs),completion:stats(report.coldFrames.completionMs),callbackDelay:stats(report.coldFrames.callbackDelayMs),frameLatency:stats(report.coldFrames.frameLatencyMs),latency:stats(report.coldFrames.latencyMs),interval:cadence(report.coldFrames.intervalMs)},cpu:stats(report.frames.cpuMs),completion:stats(report.frames.completionMs),callbackDelay:stats(report.frames.callbackDelayMs),frameLatency:stats(report.frames.frameLatencyMs),latency:stats(report.frames.latencyMs),interval:cadence(report.frames.intervalMs),probe:stats(report.probeMs),preview:stats(report.previewTimes),pairedFrame:stats(report.pairedFrameMs),previewCadence:cadence(report.previewCadenceMs),errors};
  result.sourceHashesBefore=beforeHashes;result.sourceHashesAfter=sourceHashes();
  fs.writeFileSync(path.join(out,`game-${duration}${suffix}.json`),JSON.stringify(result,null,2));
  if(JSON.stringify(result.sourceHashesBefore)!==JSON.stringify(result.sourceHashesAfter))throw Error('Source changed during measurement');
  for(const state of [report.contactBefore,report.contactAfter])for(const field of ['compilations','inputPreparations','inFlight'])if(!Number.isFinite(state.service[field]))throw Error('Missing preparation diagnostic '+field);
  if(report.contactBefore.service.compilations!==report.contactAfter.service.compilations||report.contactBefore.service.inputPreparations!==report.contactAfter.service.inputPreparations||report.contactBefore.service.inFlight||report.contactAfter.service.inFlight)throw Error('Contact construction occurred during rendering measurement');
  if(report.focus.some(focused=>!focused))throw Error('The measurement window lost focus');
  if(report.cameraFrames.length!==1)throw Error('Camera changed during measurement');
  if(!report.previewTimes.length||report.visibility.some(state=>state!=='visible')||visibleAfter.some(person=>!person.pixel)||report.population.some(n=>n!==6)||!liveStepMs&&!normalDriver&&report.tickStart!==report.tickEnd)throw Error('Stable six-person workload changed');
  console.log(JSON.stringify({samples:report.frames.samples,cpu:result.cpu,callbackDelay:result.callbackDelay,frameLatency:result.frameLatency,completion:result.completion,latency:result.latency,probe:result.probe,preview:result.preview,pairedFrame:result.pairedFrame,previewCadence:result.previewCadence,actors:report.scene.actors.map(a=>a.clip),errors}));if(errors.length)process.exitCode=1;
 }catch(error){if(page){const state=await page.evaluate(()=>{const h=window.__terriStress;if(!h)return null;const s=h.sim;return {tick:s.clockTick(),scene:h.characters.snapshot(),people:s.characterAppearances().map(p=>({...p,queue:s.actionQueueOf(p.entity)}))};}).catch(e=>({captureError:String(e)}));fs.writeFileSync(path.join(out,'failure.json'),JSON.stringify({error:String(error),state,errors},null,2));await page.screenshot({path:path.join(out,'failure.png')}).catch(()=>{});}throw error;}
 finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1});
