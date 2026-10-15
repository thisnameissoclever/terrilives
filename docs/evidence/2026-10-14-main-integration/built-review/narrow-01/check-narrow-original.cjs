const {chromium}=require('C:/Users/myema/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const fs=require('node:fs'),path=require('node:path');
const out=path.join(__dirname,'narrow-01');
(async()=>{
 fs.mkdirSync(out,{recursive:true});if(fs.existsSync(path.join(out,'report.json')))throw Error('Receipt exists');
 const browser=await chromium.launch({channel:'chrome',headless:false,args:['--mute-audio']});
 const report={viewport:{width:390,height:844},errors:[],navigation:[],keyboard:[]};let page;
 try{
  page=await browser.newPage({viewport:report.viewport});
  page.on('pageerror',e=>report.errors.push(String(e)));page.on('console',m=>{if(['warning','error'].includes(m.type())&&!m.location().url.endsWith('/favicon.ico'))report.errors.push(m.text());});
  await page.goto('http://127.0.0.1:5191/?stress=0',{waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>window.__terriStress,null,{timeout:120000});
  await page.locator('#startup-loading').waitFor({state:'detached',timeout:120000});
  if(await page.locator('#help-panel').evaluate(e=>e.open))await page.locator('#close-help').click();
  await page.locator('label[for="speed-0"]').click();
  await page.locator('#options-toggle').click();await page.locator('#new-housemate').click();
  const root=page.locator('#character-creator-root');
  await root.locator('[data-page="review"]').click();
  try{await root.locator('[data-next]:not([disabled])').waitFor({state:'visible',timeout:20000});report.hiddenPreviewCanSubmit=true;}
  catch{report.hiddenPreviewCanSubmit=false;}
  report.beforePreview=await root.evaluate(el=>({expanded:el.dataset.previewExpanded,status:el.querySelector('.creator-status').textContent,disabled:el.querySelector('[data-next]').disabled,action:el.querySelector('[data-action]').value}));
  await page.screenshot({path:path.join(out,'01-review-preview-hidden.png')});
  await root.locator('[data-preview-toggle]').click();
  await root.locator('[data-next]:not([disabled])').waitFor({state:'visible',timeout:60000});
  report.shownPreviewCanSubmit=true;
  for(const name of ['identity','appearance','personality','needs','interests','household','review']){
   await root.locator(`[data-page="${name}"]`).click();
   report.navigation.push(await root.evaluate((el,name)=>({name,selected:el.querySelector('[data-page][aria-current]').dataset.page,
    navHeight:el.querySelector('.creator-nav').getBoundingClientRect().height,buttonHeight:el.querySelector(`[data-page="${name}"]`).getBoundingClientRect().height,
    viewportOverflow:document.documentElement.scrollWidth>innerWidth}),name));
  }
  await root.locator('[data-action]').scrollIntoViewIfNeeded();
  await root.locator('[data-play]').click();
  await page.screenshot({path:path.join(out,'02-preview-controls.png')});
  await root.locator('[data-preview-toggle]').click();await root.locator('[data-page="needs"]').click();
  await page.screenshot({path:path.join(out,'03-needs-controls.png')});
  await root.locator('[data-page="identity"]').click();
  const input=root.locator('[data-field="name"] input[type="text"]');await input.click();
  for(let i=0;i<10;i++){await page.keyboard.press('Tab');report.keyboard.push(await root.evaluate(el=>({inside:el.contains(document.activeElement),tag:document.activeElement.tagName,text:document.activeElement.textContent?.slice(0,60),id:document.activeElement.id})));}
  await page.keyboard.press('Escape');await page.locator('#housemate-dialog').waitFor({state:'hidden'});report.escapeCloses=true;
  report.status=report.hiddenPreviewCanSubmit?'PASS':'FINDING';
 }catch(error){report.status='ERROR';report.error=String(error);if(page)await page.screenshot({path:path.join(out,'failure.png')}).catch(()=>{});throw error;}
 finally{await browser.close();report.browserClosed=true;fs.writeFileSync(path.join(out,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));}
})().catch(e=>{console.error(e);process.exitCode=1;});
