const {chromium}=require('C:/Users/myema/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),assert=require('node:assert/strict');
const label=process.env.PARITY_LABEL||'baseline';
if(!/^[a-z0-9-]+$/.test(label))throw Error('Invalid parity label');
const url=process.env.PARITY_URL||'http://127.0.0.1:5192';
const root=path.resolve('docs/evidence/2026-10-13-creator-repair');
const out=path.join(root,'prepared-parity',label);
const hash=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
const walk=directory=>fs.readdirSync(directory,{withFileTypes:true}).flatMap(entry=>entry.isDirectory()?walk(path.join(directory,entry.name)):[path.join(directory,entry.name)]);
const sourceRoot=path.resolve(process.env.PARITY_SOURCE??(url.endsWith(':5192')?'.scratch/prepared-character-baseline/web':'web'));
const sourceHashes=()=>Object.fromEntries([...walk(path.join(sourceRoot,'src/render/character')),path.join(sourceRoot,'src/main.ts'),path.join(sourceRoot,'src/wasm/terri_wasm_bg.wasm')].sort().map(file=>[path.relative(sourceRoot,file).replaceAll('\\','/'),hash(fs.readFileSync(file))]));
const all=[...walk(path.join(root,'interaction-contracts')),...walk(path.join(root,'final-game-review')),
 path.join(root,'reviewer-game','bed-arc.sav'),path.resolve('web/tests/fixtures/owned-reading-dropped.sav')].filter(file=>file.endsWith('.sav')).sort();
const files=process.env.PARITY_CONTACT_ONLY?walk(path.join(root,'prepared-parity','contact-saves')).filter(file=>file.endsWith('.sav')).sort():all;
const cases=files.map(file=>({file:path.relative(process.cwd(),file).replaceAll('\\','/'),sha256:hash(fs.readFileSync(file))}));
const filtered=process.env.PARITY_MATCH?cases.filter(item=>item.file.includes(process.env.PARITY_MATCH)):cases;
const selected=process.env.PARITY_LIMIT?filtered.slice(0,Number(process.env.PARITY_LIMIT)):filtered;
const frame=page=>page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
const reference=process.env.PARITY_REFERENCE?JSON.parse(fs.readFileSync(process.env.PARITY_REFERENCE,'utf8')):null;
const fitFile=process.env.PARITY_DIAGNOSTIC_FIT;
const diagnosticFit=fitFile?JSON.parse(fs.readFileSync(fitFile,'utf8'),(_key,value)=>value&&typeof value==='object'&&value.negativeZero===true?-0:value):null;
const canonicalReference=process.env.PARITY_RESTORE_REFERENCE?JSON.parse(fs.readFileSync(process.env.PARITY_RESTORE_REFERENCE,'utf8')):null;

async function attachments(page,raw=false){return page.evaluate(async raw=>{
 const h=window.__terriStress,d=h.graphicsDevice,results={};
 let colorBytes=null;const rawAttachments={};
 for(const [name,texture,bpp] of [['color',h.sceneColorTexture,8],['surface',h.sceneSurfaceTexture,4],['identity',h.sceneIdentityTexture,4],['annotation',h.sceneAnnotationIdentityTexture,4]]){
  if(!texture){results[name]=null;continue;}
  const width=texture.width,height=texture.height,row=Math.ceil(width*bpp/256)*256;
  const buffer=d.createBuffer({size:row*height,usage:GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ});
  try{
   const encoder=d.createCommandEncoder();encoder.copyTextureToBuffer({texture},{buffer,bytesPerRow:row},[width,height]);d.queue.submit([encoder.finish()]);
   await buffer.mapAsync(GPUMapMode.READ);
   const bytes=new Uint8Array(buffer.getMappedRange());
   const packed=new Uint8Array(width*height*bpp);for(let y=0;y<height;y++)packed.set(bytes.subarray(y*row,y*row+width*bpp),y*width*bpp);
   const digest=await crypto.subtle.digest('SHA-256',packed);
   results[name]={width,height,sha256:[...new Uint8Array(digest)].map(n=>n.toString(16).padStart(2,'0')).join('')};
   if(raw){const compressed=[...new Uint8Array(await new Response(new Blob([packed]).stream().pipeThrough(new CompressionStream('gzip'))).arrayBuffer())];if(name==='color')colorBytes=compressed;else rawAttachments[name]=compressed;}
  }finally{buffer.unmap();buffer.destroy();}
 }
 return {attachments:results,scene:h.characters.snapshot(),tick:h.sim.clockTick(),colorBytes,rawAttachments};
},raw);}

(async()=>{
 if(fs.existsSync(path.join(out,'receipt.json')))throw Error('Preserve the existing receipt; choose a new PARITY_LABEL');
 fs.mkdirSync(out,{recursive:true});
 const browser=await chromium.launch({channel:'chrome',headless:true,args:['--mute-audio']}),rows=[],errors=[],serviceUrls=[];
 const report={label,url,diagnosticOnly:!!diagnosticFit,diagnosticFitSource:fitFile??null,sourceRoot,sourceBefore:sourceHashes(),viewport:[1600,1100],scale:1.37,light:'flat',expected:selected.length,rows,errors};
 const save=()=>fs.writeFileSync(path.join(out,'receipt.json'),JSON.stringify(report,null,2));
 try{
  const page=await browser.newPage({viewport:{width:1600,height:1100}});
  page.on('response',response=>{if(response.url().includes('/src/render/character/character-preparation-service.ts'))serviceUrls.push(response.url());});
  page.on('pageerror',error=>errors.push(error.stack||String(error)));
  page.on('console',message=>{if(['error','warning'].includes(message.type())&&!message.location().url.endsWith('/favicon.ico'))errors.push(message.text());});
  await page.goto(url+'/?stress=0',{waitUntil:'domcontentloaded'});await page.waitForFunction(()=>window.__terriStress,null,{timeout:120000});
  if(diagnosticFit){
   assert(canonicalReference,'A diagnostic injection requires an exact restoration reference');assert(serviceUrls.length,'Actual contact service module was not observed');
   await page.evaluate(async({url,fit})=>{const {CharacterPreparationService}=await import(url),original=CharacterPreparationService.prototype.require;window.__parityFitCalls=0;
    CharacterPreparationService.prototype.require=function(owner,appearance){const artifact=original.call(this,owner,appearance);
     if(appearance.presentation==='masculine'&&Object.values(appearance.body).every(value=>value===50)&&appearance.footwear==='loafers'&&appearance.bottoms==='trousers'){window.__parityFitCalls++;return {...artifact,bike:{...artifact.bike,fit}};}return artifact;};
    window.__parityRestoreFit=()=>{CharacterPreparationService.prototype.require=original;};
   },{url:serviceUrls.at(-1),fit:diagnosticFit.fit??diagnosticFit});
  }
  // Select pause while first-run help still suspends the initial zero accumulator.
  await page.evaluate(()=>document.querySelector('#speed-0').click());
  if(await page.locator('#help-panel').evaluate(element=>element.open))await page.locator('#close-help').click();
  await page.locator('#options-toggle').click();if(!(await page.locator('#lighting-mode').innerText()).includes('flat'))await page.locator('#lighting-mode').click();await page.locator('#options-toggle').click();
  await page.mouse.move(800,100);await page.mouse.wheel(0,-Math.log(1.37)/.0012);await frame(page);
  const origin=await page.evaluate(()=>({...__terriStress.origin}));
  await page.mouse.move(800,400);await page.mouse.down({button:'middle'});await page.mouse.move(800+800-origin.x,400+180-origin.y);await page.mouse.up({button:'middle'});await page.mouse.move(800,50);await frame(page);
  for(let index=0;index<selected.length;index++){
   const item=selected[index];report.current=item;save();
   await page.evaluate(async bytes=>{const h=__terriStress,accepted=h.characters.loadBytes?await h.characters.loadBytes(Uint8Array.from(bytes)):h.sim.loadBytes(Uint8Array.from(bytes));if(!accepted)throw Error('State refused');},[...fs.readFileSync(item.file)]);
   // Wall visibility continues its 200 ms transition while the household is paused.
   await page.waitForTimeout(250);await frame(page);
   const actual=await attachments(page,!!process.env.PARITY_RAW);
   if(actual.colorBytes)fs.writeFileSync(path.join(out,String(index).padStart(3,'0')+'-color.rgba16f.gz'),Buffer.from(actual.colorBytes));delete actual.colorBytes;
   for(const [name,bytes] of Object.entries(actual.rawAttachments))fs.writeFileSync(path.join(out,String(index).padStart(3,'0')+'-'+name+'.bin.gz'),Buffer.from(bytes));delete actual.rawAttachments;
   assert(Math.abs(actual.scene.view.scale-1.37)<.00001);assert(Math.abs(actual.scene.view.originX-800)<.01);assert(Math.abs(actual.scene.view.originY-180)<.01);
   if(index===0){
    await frame(page);const repeated=await attachments(page,!!process.env.PARITY_RAW);
    if(repeated.colorBytes)fs.writeFileSync(path.join(out,'repeated-color.rgba16f.gz'),Buffer.from(repeated.colorBytes));delete repeated.colorBytes;
    for(const [name,bytes] of Object.entries(repeated.rawAttachments))fs.writeFileSync(path.join(out,'repeated-'+name+'.bin.gz'),Buffer.from(bytes));delete repeated.rawAttachments;
    report.stability={first:actual,repeated};save();
    assert.deepEqual(repeated.attachments,actual.attachments,'Paused reference must be stable');
   }
   const filename=String(index).padStart(3,'0')+'-'+path.basename(item.file,'.sav')+'.png';
   await page.screenshot({path:path.join(out,filename)});
   const expected=reference?.rows.find(row=>row.file===item.file);
   if(reference){assert(expected,'Reference case missing');assert.equal(expected.sha256,item.sha256,'Input bytes changed');}
   const matches=reference?JSON.stringify(expected.attachments)===JSON.stringify(actual.attachments):null;
   rows.push({...item,...actual,screenshot:filename,matches});save();
   if(index%20===0)console.log(JSON.stringify({captured:rows.length,expected:selected.length,mismatches:rows.filter(row=>row.matches===false).length}));
  }
  assert.equal(errors.length,0,JSON.stringify(errors));assert.equal(rows.length,selected.length);
  if(diagnosticFit){
   report.diagnosticFitCalls=await page.evaluate(()=>{window.__parityRestoreFit();return window.__parityFitCalls;});assert(report.diagnosticFitCalls>0,'Fit injection was not consumed');
   const last=selected.at(-1);await page.evaluate(async bytes=>{if(!await __terriStress.characters.loadBytes(Uint8Array.from(bytes)))throw Error('Restoration state refused');},[...fs.readFileSync(last.file)]);
   await page.waitForTimeout(250);await frame(page);const restored=await attachments(page);delete restored.colorBytes;delete restored.rawAttachments;
   const expected=canonicalReference.rows.find(row=>row.file===last.file);assert(expected,'Canonical restoration case missing');
   report.restoration={...restored,file:last.file,matches:JSON.stringify(restored.attachments)===JSON.stringify(expected.attachments)};
   assert.deepEqual(restored.attachments,expected.attachments,'Canonical source method did not restore exact attachments');
   await page.screenshot({path:path.join(out,'canonical-restored.png')});
  }
  report.sourceAfter=sourceHashes();assert.deepEqual(report.sourceAfter,report.sourceBefore,'Renderer source changed during capture');
  report.status=rows.some(row=>row.matches===false)?'FAIL':'PASS';
  if(report.status==='FAIL')process.exitCode=1;
 }catch(error){report.status='FAIL';report.failure=String(error);throw error;}
 finally{save();await browser.close();}
 console.log(JSON.stringify({status:report.status,cases:rows.length,mismatches:rows.filter(row=>row.matches===false).length,errors}));
})().catch(error=>{console.error(error);process.exitCode=1;});
