const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),crypto=require('node:crypto'),zlib=require('node:zlib');
const root=path.resolve(__dirname,'..'),mode=process.env.ATLAS_STARTUP_MODE;
if(!['dense-reference','dense-budget','packed-budget'].includes(mode))throw Error('Choose dense-reference, dense-budget or packed-budget');
const desktop=process.env.ATLAS_STARTUP_VIEWPORT==='desktop';
const directory=process.env.ATLAS_STARTUP_OUT||path.join(root,'.scratch/ios-resident-memory/startup',desktop?'desktop':'phone');
fs.mkdirSync(directory,{recursive:true});
const report={mode,url:process.env.ATLAS_STARTUP_URL||(mode==='packed-budget'?'http://127.0.0.1:5176/?stress=0':'https://thisnameissoclever.github.io/terrilives/?stress=0'),viewport:desktop?{width:1440,height:900}:{width:402,height:874},deviceScaleFactor:desktop?1:3,errors:[],budgetBytes:mode==='dense-reference'?null:1024**3};
const {chromium}=require(require.resolve('playwright',{paths:[root,path.join(process.env.USERPROFILE||process.env.HOME||root,'.cache/codex-runtimes/codex-primary-runtime/dependencies/node')]}));
(async()=>{
 const browser=await chromium.launch({channel:'chrome',headless:false,args:['--mute-audio','--js-flags=--max-old-space-size=1536']});
 let context;
 try{
  context=await browser.newContext({viewport:report.viewport,deviceScaleFactor:report.deviceScaleFactor,reducedMotion:'reduce'});const page=await context.newPage();
  page.on('pageerror',error=>report.errors.push(error.stack||String(error)));page.on('crash',()=>report.crashed=true);
  page.on('console',message=>{if(['error','warning'].includes(message.type())&&!message.location().url.endsWith('/favicon.ico'))report.errors.push(message.text());});
  await page.addInitScript(({budget})=>{
   localStorage.setItem('terrilives.help-dismissed.v1','1');
   const state=window.__atlasBudget={live:0,peak:0,textures:[],buffers:[],denials:[]},owned=new WeakMap();
   const bytesPerPixel={rgba8unorm:4,'rgba8unorm-srgb':4,bgra8unorm:4,'bgra8unorm-srgb':4,rgba16float:8,r16float:2,rg16float:4,r32float:4,r32uint:4,depth24plus:4,depth32float:4,r8unorm:1,r8uint:1};
   const reserve=(bytes,descriptor)=>{if(budget&&state.live+bytes>budget){const error=new Error('Controlled graphics storage budget exceeded');state.denials.push({bytes,live:state.live,descriptor,stack:error.stack});throw error;}};
   state.frameErrors=[];window.addEventListener('error',event=>state.frameErrors.push(event.message));
   const record=(resource,bytes)=>{owned.set(resource,{bytes,released:false});state.live+=bytes;state.peak=Math.max(state.peak,state.live);return resource;};
   for(const [type,prototype]of [['textures',GPUTexture.prototype],['buffers',GPUBuffer.prototype]]){
    const destroy=prototype.destroy;prototype.destroy=function(){const value=owned.get(this);if(value&&!value.released){state.live-=value.bytes;value.released=true;}return destroy.call(this);};
   }
   const texture=GPUDevice.prototype.createTexture;
   GPUDevice.prototype.createTexture=function(d){const s=d.size,w=s.width??s[0],h=s.height??s[1]??1,l=s.depthOrArrayLayers??s[2]??1;
    if(!(d.format in bytesPerPixel))throw Error('Unmeasured texture format '+d.format);
    let pixels=0;for(let m=0;m<(d.mipLevelCount??1);m++)pixels+=Math.max(1,w>>m)*Math.max(1,h>>m)*l;
    const bytes=pixels*bytesPerPixel[d.format]*(d.sampleCount??1),row={width:w,height:h,layers:l,format:d.format,bytes};reserve(bytes,row);state.textures.push(row);return record(texture.call(this,d),bytes);};
   const buffer=GPUDevice.prototype.createBuffer;GPUDevice.prototype.createBuffer=function(d){reserve(d.size,{buffer:d.label??'',size:d.size});state.buffers.push({bytes:d.size,label:d.label??''});return record(buffer.call(this,d),d.size);};
  },{budget:report.budgetBytes});
  const start=Date.now();await page.goto(report.url,{waitUntil:'domcontentloaded',timeout:90000});
  await page.waitForFunction(()=>document.querySelector('[data-role="startup-failure"]')||window.__terriStress?.timer.frames>0||(window.__atlasBudget.denials.length&&window.__atlasBudget.frameErrors.some(message=>message.includes('Controlled graphics storage budget exceeded'))),null,{timeout:180000});
  report.startupMs=Date.now()-start;report.startup=await page.evaluate(()=>({allocations:window.__atlasBudget,failure:document.querySelector('[data-role="startup-failure"]')?.textContent,completedFrames:window.__terriStress?.timer.frames??0}));
  if(mode==='dense-budget'){
   assert.equal(report.startup.completedFrames,0,'The old loader must fail before its first complete frame');
   assert.ok(report.errors.some(error=>error.includes('Controlled graphics storage budget exceeded')),'The essential frame allocation must propagate its budget failure');
   assert.ok(report.startup.allocations.denials.length);
   report.sceneAvailable=await page.evaluate(()=>{try{return Boolean(window.__terriStress.sceneColorTexture);}catch{return false;}});
   assert.equal(report.sceneAvailable,false);await page.screenshot({path:path.join(directory,mode+'.png')});
  }else{
   assert.equal(report.startup.failure,undefined);assert.ok(report.startup.completedFrames>0);assert.equal(report.startup.allocations.denials.length,0);assert.equal(report.errors.length,0);
   await page.locator('label[for="speed-0"]').click();
   const fixture=path.join(directory,'household.json');
   if(mode==='dense-reference')fs.writeFileSync(fixture,JSON.stringify(await page.evaluate(()=>Array.from(window.__terriStress.sim.saveBytes()))));
   const bytes=JSON.parse(fs.readFileSync(fixture,'utf8'));
   await page.evaluate(async bytes=>{if(!await window.__terriStress.characters.loadBytes(new Uint8Array(bytes)))throw Error('Saved household refused');},bytes);
   await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))));
   report.tick=await page.evaluate(()=>window.__terriStress.sim.clockTick());
   const captures=async(save)=>{
    const hashes={};
    for(const name of ['color','surface','identity']){
     const capture=await page.evaluate(async name=>{
      const s=window.__terriStress,device=s.graphicsDevice,texture=s[{color:'sceneColorTexture',surface:'sceneSurfaceTexture',identity:'sceneIdentityTexture'}[name]];
      const row=Math.ceil(texture.width*(name==='color'?8:4)/256)*256,buffer=device.createBuffer({size:row*texture.height,usage:GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ});
      try{const encoder=device.createCommandEncoder();encoder.copyTextureToBuffer({texture},{buffer,bytesPerRow:row},[texture.width,texture.height]);device.queue.submit([encoder.finish()]);await buffer.mapAsync(GPUMapMode.READ);
       const data=new Uint8Array(buffer.getMappedRange());if(name==='identity'&&!data.some(value=>value!==0))throw Error('Scene has no rendered identities');
       const digest=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',data)),v=>v.toString(16).padStart(2,'0')).join('');
       // Transfer a compact byte stream through Playwright without a video or trace.
       const stream=new Blob([data]).stream().pipeThrough(new CompressionStream('gzip')),packed=new Uint8Array(await new Response(stream).arrayBuffer());
       let binary='';for(let at=0;at<packed.length;at+=32768)binary+=String.fromCharCode(...packed.subarray(at,at+32768));
       return {width:texture.width,height:texture.height,row,sha256:digest,gzip:btoa(binary)};
      }finally{buffer.unmap();buffer.destroy();}
     },name);
     assert.equal(capture.width,report.viewport.width*report.deviceScaleFactor*2);assert.equal(capture.height,report.viewport.height*report.deviceScaleFactor*2);
     const data=Buffer.from(capture.gzip,'base64');delete capture.gzip;
     assert.equal(crypto.createHash('sha256').update(zlib.gunzipSync(data)).digest('hex'),capture.sha256);
     if(save)fs.writeFileSync(path.join(directory,mode+'-'+name+'.bin.gz'),data);hashes[name]=capture;
    }return hashes;
   };
   await page.evaluate(()=>window.__terriStress.graphicsDevice.queue.onSubmittedWorkDone());
   report.attachments=await captures(true);assert.deepEqual(await captures(false),report.attachments,'Paused render attachments must remain stable');
   await page.screenshot({path:path.join(directory,mode+'.png')});
   if(mode==='packed-budget'){
    const reference=JSON.parse(fs.readFileSync(path.join(directory,'dense-reference.json'),'utf8'));
    assert.equal(report.tick,reference.tick);assert.deepEqual(report.attachments,reference.attachments,'Packed artwork must preserve scene color, depth and picking');
    assert.ok(report.startup.allocations.peak<=report.budgetBytes);
   }
  }
  if(mode!=='dense-budget'){assert.equal(report.errors.length,0,'Rendering must remain free of graphics and script diagnostics');assert.equal(report.crashed,undefined);}
  const entry=await page.locator('script[type="module"][src]').first().getAttribute('src');
  if(entry){const url=new URL(entry,report.url).href;report.entry={url,sha256:crypto.createHash('sha256').update(await(await context.request.get(url)).body()).digest('hex')};}
  report.status='PASS';
 }catch(error){report.status='FAIL';report.failure=String(error);process.exitCode=1;}
 finally{if(context)await context.close();await browser.close();report.browserClosed=true;fs.writeFileSync(path.join(directory,mode+'.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({mode,status:report.status,failure:report.failure,startupMs:report.startupMs,peakMiB:report.startup?.allocations.peak/1048576,denials:report.startup?.allocations.denials.length,browserClosed:report.browserClosed}));}
})();
