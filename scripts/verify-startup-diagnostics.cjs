const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const root=path.resolve(__dirname,'..'),url=process.env.STARTUP_REPORT_PROOF_URL||'http://127.0.0.1:5177/terrilives/';
const out=process.env.STARTUP_REPORT_PROOF_OUT||path.join(root,'.local-build/startup-diagnostics');fs.mkdirSync(out,{recursive:true});
const {chromium}=require(require.resolve('playwright',{paths:[root,path.join(process.env.USERPROFILE,'.cache/codex-runtimes/codex-primary-runtime/dependencies/node')]}));
const key='terrilives.startup-report.v1',report={url,cases:[]};
const expectedVersion=JSON.parse(fs.readFileSync(path.join(root,'web/package.json'),'utf8')).version;
function within(promise,ms,message){
  let timer;return Promise.race([promise,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error(message)),ms);})])
    .finally(()=>clearTimeout(timer));
}
const stored=page=>page.evaluate(key=>JSON.parse(localStorage.getItem(key)),key);
const ready=page=>page.waitForFunction(key=>JSON.parse(localStorage.getItem(key)||'null')?.attempts.at(-1)?.state==='ready',key,{timeout:120000});
async function routeOneCharacterAsset(page,handler){
  let selected;
  await page.route(/\/assets\/runtime\.normalTriangles-[^/]+\.bin$/,route=>{
    const address=route.request().url();selected??=address;
    return address===selected?handler(route):route.continue();
  });
}
async function proofContext(browser){
  const context=await browser.newContext({viewport:{width:402,height:874},deviceScaleFactor:3});
  await context.addInitScript(()=>{
    window.__reportClipboard={value:null,deny:false};
    Object.defineProperty(navigator,'clipboard',{value:{writeText:async value=>{
      if(window.__reportClipboard.deny)throw new Error('Controlled clipboard refusal');
      window.__reportClipboard.value=value;
    }}});
    if(navigator.gpu){
      const requestAdapter=navigator.gpu.requestAdapter.bind(navigator.gpu);
      navigator.gpu.requestAdapter=async(...args)=>{
        const adapter=await requestAdapter(...args);if(!adapter)return adapter;
        const requestDevice=adapter.requestDevice.bind(adapter);
        adapter.requestDevice=async(...args)=>{const device=await requestDevice(...args);window.__proofDevice=device;return device;};
        return adapter;
      };
    }
  });
  return context;
}
async function checkSharing(page,attempts){
  await page.getByRole('button',{name:'Copy debug details'}).click();
  const copied=await page.evaluate(()=>window.__reportClipboard.value),parsed=JSON.parse(copied);
  assert.equal(parsed.attempts.at(-1).startedAt,attempts.at(-1).startedAt);
  if(attempts.at(-1).error)assert.ok(JSON.stringify(parsed.attempts).includes(attempts.at(-1).error.message.slice(0,80)));
  assert.match(await page.locator('#startup-report-share-status').textContent(),/Copied/);
  const mail=new URL(await page.getByRole('link',{name:'Email Tim'}).getAttribute('href'));
  assert.equal(mail.protocol,'mailto:');assert.equal(mail.pathname,'bugreport@stfuai.com');
  assert.equal(parsed.reportContext.gameVersion,expectedVersion);
  assert.equal(mail.searchParams.get('subject'),'[Bug report] Natural Causes v'+expectedVersion);
  assert.ok(256+encodeURIComponent(mail.href).length<=7500);assert.match(mail.searchParams.get('body'),/Latest logs \(newest first\)/);
  if(parsed.attempts.at(-1).error)assert.ok(mail.searchParams.get('body').includes(parsed.attempts.at(-1).error.message.slice(0,80)));
  await page.evaluate(()=>{window.__reportClipboard.deny=true;});
  await page.getByRole('button',{name:'Copy debug details'}).click();
  assert.match(await page.locator('#startup-report-share-status').textContent(),/blocked/);
  const manual=JSON.parse(await page.locator('#startup-report-manual').inputValue());
  assert.equal(manual.attempts.at(-1).startedAt,parsed.attempts.at(-1).startedAt);
  assert.ok(await page.locator('#startup-report-manual').isVisible());
  await page.evaluate(()=>{window.__reportClipboard.deny=false;});
  await page.getByRole('button',{name:'Copy debug details'}).click();
  await page.evaluate(()=>{window.scrollTo(0,0);const card=document.querySelector('[data-role="startup-failure"]');if(card)card.scrollTop=0;});
  return {subject:mail.searchParams.get('subject'),mailto:mail.href,reservedHandoffCharacters:256+encodeURIComponent(mail.href).length,encodedLinkCharacters:mail.href.length,mailBody:mail.searchParams.get('body'),copyCharacters:copied.length,clipboardTransport:'isolated test double; system clipboard untouched',fallback:true};
}
async function readReport(page,record,label){
  const requests=[],capture=request=>requests.push(new URL(request.url()).pathname);page.on('request',capture);
  try{
    await page.setViewportSize({width:402,height:874});
    await page.goto(new URL('startup-report.html',url).href);
    const shown=JSON.parse(await page.locator('#startup-report-data').textContent());
    assert.equal(shown.attempts.at(-1).startedAt,record.attempts.at(-1).startedAt);
    assert.ok(requests.every(name=>name.endsWith('/startup-report.html')||name.endsWith('/startup-diagnostics-v4.js')),
      'The report must not request game code, simulation or artwork');
    const sharing=await checkSharing(page,record.attempts);
    const downloadEvent=page.waitForEvent('download');await page.getByRole('button',{name:'Download report'}).click();
    const download=await downloadEvent;
    assert.deepEqual(JSON.parse(fs.readFileSync(await download.path(),'utf8')).attempts,JSON.parse(await page.locator('#startup-report-data').textContent()).attempts);
    await page.evaluate(()=>window.scrollTo(0,0));
    await page.screenshot({path:path.join(out,label+'-phone.png')});
    await page.setViewportSize({width:1440,height:900});
    await page.evaluate(()=>window.scrollTo(0,0));
    await page.screenshot({path:path.join(out,label+'-desktop.png')});
    await page.emulateMedia({colorScheme:'light'});
    assert.equal(await page.locator('html').evaluate(element=>getComputedStyle(element).colorScheme),'dark');
    await page.screenshot({path:path.join(out,label+'-system-light-desktop.png')});
    await page.setViewportSize({width:402,height:874});await page.evaluate(()=>window.scrollTo(0,0));
    await page.screenshot({path:path.join(out,label+'-system-light-phone.png')});
    return {requests,sharing,summary:await page.locator('#startup-report-summary').textContent(),download:download.suggestedFilename()};
  }finally{page.off('request',capture);}
}
(async()=>{let browser;
try{
  browser=await chromium.launch({channel:'chrome',headless:false,args:['--mute-audio','--js-flags=--max-old-space-size=1536']});
  {
    const context=await proofContext(browser);
    try{
      const page=await context.newPage();let requests=0;
      await routeOneCharacterAsset(page,async route=>{
        requests++;await route.fulfill({status:503,headers:{'Retry-After':'60','Server':'verification-edge','X-GitHub-Request-Id':'controlled-response-42'},body:'Controlled persistent refusal'});
      });
      await page.goto(url,{waitUntil:'domcontentloaded',timeout:90000});
      await page.locator('[data-role="startup-failure"]').waitFor({timeout:120000});
      assert.equal(requests,1);assert.match(await page.locator('#startup-failure-detail').textContent(),/Character asset could not load: 503/);
      assert.doesNotMatch(await page.locator('#startup-failure-detail').textContent(),/controlled-response-42/);
      const cardSharing=await checkSharing(page,(await stored(page)).attempts);
      await page.screenshot({path:path.join(out,'http-failure-phone.png')});
      await page.setViewportSize({width:1440,height:900});await page.screenshot({path:path.join(out,'http-failure-desktop.png')});
      await page.setViewportSize({width:402,height:874});
      const record=await stored(page),attempt=record.attempts.at(-1);
      assert.equal(attempt.state,'failed');assert.equal(attempt.error.assetFailure.status,503);
      assert.equal(attempt.error.assetFailure.headers.server,'verification-edge');
      assert.equal(attempt.error.assetFailure.headers['x-github-request-id'],'controlled-response-42');
      assert.equal(attempt.error.assetFailure.body,'Controlled persistent refusal');
      assert.ok(await page.getByRole('link',{name:'Startup report'}).isVisible());
      const view=await readReport(page,record,'http-report');
      report.cases.push({name:'controlled persistent HTTP failure',requests,record,view,cardSharing});
    }finally{await context.close();}
  }
  {
    const context=await proofContext(browser);let release=()=>{};
    try{
      const page=await context.newPage(),cdp=await context.newCDPSession(page);
      let reached;const blocked=new Promise(resolve=>{reached=resolve;});
      await routeOneCharacterAsset(page,async route=>{
        reached();await new Promise(resolve=>{release=resolve;});try{await route.abort();}catch{}
      });
      await page.goto(url,{waitUntil:'domcontentloaded',timeout:90000});
      await within(blocked,120000,'The controlled stalled request was not reached');
      await page.waitForFunction(key=>JSON.parse(localStorage.getItem(key)||'null')?.attempts.at(-1)?.phase==='Loading character models',key);
      const record=await stored(page);assert.equal(record.attempts.at(-1).state,'loading');
      const crash=new Promise(resolve=>page.once('crash',resolve));
      void cdp.send('Page.crash').catch(()=>{});
      await within(crash,10000,'The owned renderer did not terminate');
      release();await page.close();
      const view=await readReport(await context.newPage(),record,'interrupted-report');
      assert.match(view.summary,/unfinished/i);
      report.cases.push({name:'controlled renderer termination during loading',record,view});
    }finally{release();await context.close();}
  }
  {
    const context=await proofContext(browser);
    try{
      const page=await context.newPage(),diagnostics=[];page.on('pageerror',error=>diagnostics.push(String(error)));
      await page.goto(url,{waitUntil:'domcontentloaded',timeout:90000});await ready(page);
      if(await page.locator('#help-panel').evaluate(element=>element.open))await page.locator('#close-help').click();
      const clock=await page.locator('#clock-value').textContent();
      await page.waitForFunction(clock=>document.getElementById('clock-value')?.textContent!==clock,clock);
      await page.locator('label[for="speed-0"]').click();
      assert.equal(await page.locator('[data-role="startup-failure"]').count(),0);assert.deepEqual(diagnostics,[]);
      const record=await stored(page);assert.equal(record.attempts.at(-1).state,'ready');
      await page.screenshot({path:path.join(out,'ready-phone.png')});
      report.cases.push({name:'ordinary load and advancing simulation',record,diagnostics});
      report.entry=await page.locator('script[type="module"][src]').first().getAttribute('src');
      report.entrySha256=crypto.createHash('sha256').update(await(await page.request.get(new URL(report.entry,url).href)).body()).digest('hex');
      await page.evaluate(()=>window.__proofDevice.createBuffer({size:4,usage:0}));
      await page.waitForFunction(key=>JSON.parse(localStorage.getItem(key)).attempts.at(-1).error?.source?.operation==='gpu.uncaptured-error',key);
      const validation=(await stored(page)).attempts.at(-1).error;
      assert.match(validation.name,/GPUValidationError/);assert.ok(validation.message.length>0);
      await page.evaluate(()=>{
        console.error('Controlled logged recovery error',new Error('Recovery diagnostic marker'));
        setTimeout(()=>{throw new Error('Controlled runtime exception after first frame',{cause:new Error('Controlled underlying cause')});},0);
      });
      await page.waitForFunction(key=>JSON.parse(localStorage.getItem(key)).attempts.at(-1).error?.message==='Controlled runtime exception after first frame',key);
      const runtime=(await stored(page)).attempts.at(-1);
      assert.equal(runtime.failureStage,'runtime');assert.equal(runtime.error.cause.message,'Controlled underlying cause');
      assert.ok(runtime.errors.some(error=>error.name==='GPUValidationError'));
      assert.ok(runtime.logs.some(row=>row.operation==='console.error'&&row.message.includes('Controlled logged recovery error')));
      await page.locator('#options-toggle').click();
      const bug=page.locator('#report-bug');await bug.scrollIntoViewIfNeeded();
      await bug.evaluate(element=>element.addEventListener('click',event=>event.preventDefault()));
      await bug.click();const optionsMail=new URL(await bug.getAttribute('href'));
      assert.equal(optionsMail.pathname,'bugreport@stfuai.com');assert.ok(256+encodeURIComponent(optionsMail.href).length<=7500);
      assert.equal(optionsMail.searchParams.get('subject'),'[Bug report] Natural Causes v'+expectedVersion);
      assert.ok(optionsMail.searchParams.get('body').includes(runtime.error.message));
      assert.ok(optionsMail.searchParams.get('body').includes('Controlled underlying cause'));
      await page.screenshot({path:path.join(out,'options-report-phone.png')});
      await page.locator('#options-panel').screenshot({path:path.join(out,'options-detail-phone.png')});
      await page.setViewportSize({width:1440,height:900});await bug.scrollIntoViewIfNeeded();
      await bug.focus();
      await page.screenshot({path:path.join(out,'options-report-desktop.png')});
      await page.locator('#options-panel').screenshot({path:path.join(out,'options-detail-desktop.png')});
      report.cases.push({name:'real GPU validation and thrown runtime error after first frame; Options report',validation,runtime,mailto:optionsMail.href,reservedHandoffCharacters:256+encodeURIComponent(optionsMail.href).length,encodedLinkCharacters:optionsMail.href.length,mailBody:optionsMail.searchParams.get('body')});
      const runtimeView=await readReport(page,await stored(page),'runtime-report');
      report.cases.at(-1).view=runtimeView;
    }finally{await context.close();}
  }
  report.status='PASS';
}catch(error){report.status='FAIL';report.error=String(error);process.exitCode=1;}
finally{await browser?.close();report.browserClosed=true;fs.writeFileSync(path.join(out,'verification.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({status:report.status,error:report.error,cases:report.cases.map(row=>row.name),browserClosed:true}));}
})();
