const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const root=path.resolve(__dirname,'..'),mode=process.env.DOWNLOAD_PROOF_MODE||'recover';
if(!['baseline','recover','persistent','corrupt'].includes(mode))throw Error('Invalid download proof mode');
const out=process.env.DOWNLOAD_PROOF_OUT||path.join(root,'.local-build/character-download/proof');fs.mkdirSync(out,{recursive:true});
const {chromium}=require(require.resolve('playwright',{paths:[root,path.join(process.env.USERPROFILE||process.env.HOME||root,'.cache/codex-runtimes/codex-primary-runtime/dependencies/node')]}));
const report={mode,url:process.env.DOWNLOAD_PROOF_URL||'http://127.0.0.1:5177/terrilives/?stress=0',binaryRequests:[],partsRequests:[],diagnostics:[]};
const fingerprint=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
(async()=>{
 let browser;
 try{
  browser=await chromium.launch({channel:'chrome',headless:false,args:['--mute-audio','--js-flags=--max-old-space-size=1536']});
  const page=await browser.newPage({viewport:{width:402,height:874},deviceScaleFactor:3,reducedMotion:'reduce'});
  await page.addInitScript(()=>localStorage.setItem('terrilives.help-dismissed.v1','1'));
  page.on('pageerror',error=>report.diagnostics.push({type:'pageerror',text:error.stack||String(error)}));
  page.on('console',message=>{if(['error','warning'].includes(message.type()))report.diagnostics.push({type:message.type(),text:message.text(),url:message.location().url});});
  await page.route(/\/assets\/runtime\.normalTriangles-DitPThSI\.bin$/,async route=>{
   report.binaryUrl=route.request().url();report.binaryRequests.push(Date.now());
   if(mode==='persistent'||report.binaryRequests.length===1){
    await route.fulfill({status:503,headers:{'Retry-After':'1'},body:'Injected service unavailable'});return;
   }
   if(mode==='corrupt'){
    const response=await route.fetch(),body=Buffer.from(await response.body());body[0]^=1;
    await route.fulfill({response,body});return;
   }
   await route.continue();
  });
  if(mode==='recover')await page.route(/\/assets\/parts-[^/]+\.json$/,async route=>{
   report.partsUrl??=route.request().url();
   if(route.request().url()===report.partsUrl){
    report.partsRequests.push(Date.now());
    if(report.partsRequests.length===1){await route.fulfill({status:503,headers:{'Retry-After':'1'},body:'Injected service unavailable'});return;}
   }
   await route.continue();
  });
  const start=Date.now();await page.goto(report.url,{waitUntil:'domcontentloaded',timeout:90000});
  await page.waitForFunction(()=>document.querySelector('[data-role="startup-failure"]')||window.__terriStress?.timer.frames>0,null,{timeout:180000});
  report.elapsedMs=Date.now()-start;
  report.failure=await page.evaluate(()=>document.querySelector('[data-role="startup-failure"]')?.textContent??null);
  report.frames=await page.evaluate(()=>window.__terriStress?.timer.frames??0);
  if(mode==='recover'){
   assert.equal(report.failure,null);assert.ok(report.frames>0);
   assert.equal(report.binaryRequests.length,2);
   // Require the failed read to recover while allowing later manifest consumers.
   assert.ok(report.partsRequests.length>=2);
   assert.ok(report.binaryRequests[1]-report.binaryRequests[0]>=990);assert.ok(report.partsRequests[1]-report.partsRequests[0]>=990);
   await page.locator('label[for="speed-0"]').click();
   const bytes=JSON.parse(fs.readFileSync(path.join(root,'docs/evidence/2026-10-22-character-download/household.json'),'utf8'));
   await page.evaluate(async bytes=>{if(!await window.__terriStress.characters.loadBytes(new Uint8Array(bytes)))throw Error('Comparison household refused');},bytes);
   await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))));
   const image=await page.screenshot({path:path.join(out,mode+'.png')});
   report.imageSha256=fingerprint(image);
   report.referenceImageSha256=fingerprint(fs.readFileSync(path.join(root,'docs/evidence/2026-10-22-ios-atlas-storage/phone-dense-reference.png')));
   assert.equal(report.imageSha256,report.referenceImageSha256,'Recovered downloads must preserve the complete scene and UI');
   const unexpected=report.diagnostics.filter(message=>!(message.text.includes('503')&&[report.binaryUrl,report.partsUrl].includes(message.url))&&!message.url?.endsWith('/favicon.ico'));
   assert.deepEqual(unexpected,[],'Only deliberately injected resource diagnostics are expected');
  }else{
   assert.equal(report.frames,0);assert.ok(report.failure);
   assert.match(report.failure,mode==='corrupt'?/Character asset hash differs/:/Character asset could not load: 503/);
   assert.equal(report.binaryRequests.length,mode==='baseline'?1:mode==='persistent'?3:2);
   await page.screenshot({path:path.join(out,mode+'.png')});
  }
  const entry=await page.locator('script[type="module"][src]').first().getAttribute('src'),entryUrl=new URL(entry,report.url).href;
  report.entry={url:entryUrl,sha256:fingerprint(await(await page.request.get(entryUrl)).body())};
  report.status='PASS';
 }catch(error){report.status='FAIL';report.error=String(error);process.exitCode=1;}
 finally{if(browser)await browser.close();report.browserClosed=true;fs.writeFileSync(path.join(out,mode+'.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({mode,status:report.status,error:report.error,requests:report.binaryRequests.length,partsRequests:report.partsRequests.length,browserClosed:true}));}
})();
