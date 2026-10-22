const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const root=path.resolve(__dirname,'..'),label=process.env.UPLOAD_RUN||'comparison-01';
const playwrightModule=process.env.PLAYWRIGHT_MODULE||require.resolve('playwright',{paths:[root,
 path.join(process.env.USERPROFILE||process.env.HOME||root,'.cache/codex-runtimes/codex-primary-runtime/dependencies/node')]});
const {chromium}=require(playwrightModule);
if(!/^[a-z0-9-]+$/.test(label))throw Error('Invalid run label');
const out=path.join(root,'docs/evidence/2026-10-21-ios-startup-memory',label);
const desktop=process.env.UPLOAD_VIEWPORT==='desktop',viewport=desktop?{width:1440,height:900}:{width:393,height:852};
if(fs.existsSync(out))throw Error('Choose a new run label to preserve evidence');
fs.mkdirSync(out,{recursive:true});
const sourceFiles=['web/src/render/sprites.ts','web/src/render/grime-decals.ts','web/src/render/fixture-depth.ts'];
const report={viewport,deviceScaleFactor:desktop?1:3,source:Object.fromEntries(sourceFiles.map(file=>[file,crypto.createHash('sha256').update(fs.readFileSync(path.join(root,file))).digest('hex')])),runs:[]};

async function snapshot(page){return page.evaluate(async()=>{
 const s=window.__terriStress,device=s.graphicsDevice,result={};
 for(const [name,texture]of [['color',s.sceneColorTexture],['surface',s.sceneSurfaceTexture],['identity',s.sceneIdentityTexture]]){
  const bytes=name==='color'?8:4,row=Math.ceil(texture.width*bytes/256)*256;
  const buffer=device.createBuffer({size:row*texture.height,usage:GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ});
  try{const encoder=device.createCommandEncoder();encoder.copyTextureToBuffer({texture},{buffer,bytesPerRow:row},[texture.width,texture.height]);device.queue.submit([encoder.finish()]);await buffer.mapAsync(GPUMapMode.READ);
   const hash=await crypto.subtle.digest('SHA-256',buffer.getMappedRange());result[name]=Array.from(new Uint8Array(hash),n=>n.toString(16).padStart(2,'0')).join('');
  }finally{buffer.unmap();buffer.destroy();}
 }
 return result;
});}

(async()=>{
 const browser=await chromium.launch({channel:'chrome',headless:false,args:['--mute-audio']});
 let fixture;
 try{
  for(const condition of ['without-waits','with-waits']){
   const context=await browser.newContext({viewport,deviceScaleFactor:desktop?1:3,reducedMotion:'reduce'});
   const page=await context.newPage(),run={condition,errors:[],removed:{}};report.runs.push(run);
   try{
    page.on('pageerror',error=>run.errors.push(String(error)));
    page.on('console',message=>{if(['warning','error'].includes(message.type())&&!message.location().url.endsWith('/favicon.ico'))run.errors.push(message.text());});
    if(condition==='without-waits')await page.route(/\/src\/render\/(sprites|grime-decals|fixture-depth)\.ts(?:\?|$)/,async route=>{
     const response=await route.fetch(),source=await response.text(),pattern=/await device\.queue\.onSubmittedWorkDone\(\);/g;
     run.removed[new URL(route.request().url()).pathname]=(source.match(pattern)||[]).length;
     await route.fulfill({response,body:source.replace(pattern,'')});
    });
    await page.addInitScript(()=>{
     localStorage.setItem('terrilives.help-dismissed.v1','1');
     const r=window.__uploads={copies:0,unfenced:0,maxUnfenced:0,fences:0,textures:[]};
     const copy=GPUQueue.prototype.copyExternalImageToTexture;
     GPUQueue.prototype.copyExternalImageToTexture=function(source,...rest){
      const image=source.source;if(image.width===2048&&image.height===2048||image.width===1536&&image.height===1024){r.copies++;r.unfenced++;r.maxUnfenced=Math.max(r.maxUnfenced,r.unfenced);}
      return copy.call(this,source,...rest);
     };
     const fence=GPUQueue.prototype.onSubmittedWorkDone;
     GPUQueue.prototype.onSubmittedWorkDone=async function(){r.fences++;await fence.call(this);r.unfenced=0;};
     const make=GPUDevice.prototype.createTexture;
     GPUDevice.prototype.createTexture=function(d){const s=d.size;r.textures.push({width:s.width??s[0],height:s.height??s[1]??1,layers:s.depthOrArrayLayers??s[2]??1,format:d.format});return make.call(this,d);};
    });
    const started=Date.now();await page.goto(process.env.UPLOAD_URL||'http://127.0.0.1:5174/?stress=0');
    await page.waitForFunction(()=>window.__terriStress,null,{timeout:180000});
    await page.locator('#startup-loading').waitFor({state:'detached',timeout:180000});run.readyMs=Date.now()-started;
    run.uploads=await page.evaluate(()=>structuredClone(window.__uploads));
    await page.evaluate(()=>document.querySelector('#speed-0').click());
    await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
    if(!fixture)fixture=await page.evaluate(()=>Array.from(window.__terriStress.sim.saveBytes()));
    await page.evaluate(async bytes=>{if(!await window.__terriStress.characters.loadBytes(new Uint8Array(bytes)))throw Error('Fixture refused');},fixture);
    await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))));
    run.state=await page.evaluate(()=>({tick:window.__terriStress.sim.clockTick(),save:Array.from(window.__terriStress.sim.saveBytes())}));
    run.state.saveBase64=Buffer.from(run.state.save).toString('base64');
    delete run.state.save;
    run.attachments=await snapshot(page);run.repeatedAttachments=await snapshot(page);
    assert.deepEqual(run.attachments,run.repeatedAttachments,'Paused attachments must be stable');
    run.image=(desktop?'desktop-':'phone-')+report.runs.length+'.png';
    await page.screenshot({path:path.join(out,run.image)});
    assert.equal(run.errors.length,0,'Browser graphics and script diagnostics');
    if(condition==='without-waits'){assert.equal(Object.keys(run.removed).length,3);assert.ok(Object.values(run.removed).every(n=>n===1));assert.ok(run.uploads.maxUnfenced>1,'Baseline must reject the pacing bound');}
    else{assert.equal(run.uploads.maxUnfenced,1);assert.deepEqual(run.state,report.runs[0].state);assert.deepEqual(run.attachments,report.runs[0].attachments);}
   }finally{await context.close();}
  }
  report.status='PASS';console.log(JSON.stringify(report.runs.map(({condition,readyMs,uploads,attachments})=>({condition,readyMs,copies:uploads.copies,maxUnfenced:uploads.maxUnfenced,fences:uploads.fences,attachments}))));
 }catch(error){report.status='FAIL';report.failure=String(error);throw error;}
 finally{await browser.close();report.browserClosed=true;fs.writeFileSync(path.join(out,'report.json'),JSON.stringify(report,null,2));}
})().catch(error=>{console.error(error);process.exitCode=1;});
