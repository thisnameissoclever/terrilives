const {chromium}=require('C:/Users/myema/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const out=path.join(__dirname,process.env.NARROW_RUN||'narrow-02');
const gameUrl=process.env.GAME_URL||'http://127.0.0.1:5192';
const bundleDir=path.resolve(process.env.GAME_BUILD_DIR||'.local-build/main-integration-20261014/accepted-web');
(async()=>{
 fs.mkdirSync(out,{recursive:true});if(fs.existsSync(path.join(out,'report.json')))throw Error('Receipt exists');
 const browser=await chromium.launch({channel:'chrome',headless:false,args:['--mute-audio']});
 const report={gameUrl,viewport:{width:390,height:844},errors:[],navigation:[],keyboard:[],checks:[]};let page;
 const check=(name,value)=>{assert.ok(value,name);report.checks.push(name);};
 try{
  page=await browser.newPage({viewport:report.viewport});
  page.on('pageerror',e=>report.errors.push(String(e)));page.on('console',m=>{if(['warning','error'].includes(m.type())&&!m.location().url.endsWith('/favicon.ico'))report.errors.push(m.text());});
  await page.goto(gameUrl+'/?stress=0',{waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>window.__terriStress,null,{timeout:120000});
  await page.locator('#startup-loading').waitFor({state:'detached',timeout:120000});
  if(await page.locator('#help-panel').evaluate(e=>e.open))await page.locator('#close-help').click();
  await page.locator('label[for="speed-0"]').click();
  await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
  const before=await page.evaluate(()=>Array.from(__terriStress.sim.saveBytes()));
  await page.locator('#options-toggle').click();await page.locator('#new-housemate').click();
  const root=page.locator('#character-creator-root');
  const hidden=async()=>await root.getAttribute('data-preview-expanded')==='false';
  await root.locator('[data-page="review"]').click();
  await root.locator('[data-next]:not([disabled])').waitFor({state:'visible',timeout:60000});
  report.hiddenPreviewCanSubmit=true;check('Move in enables with the preview never opened',await hidden());
  report.beforePreview=await root.evaluate(el=>({expanded:el.dataset.previewExpanded,status:el.querySelector('.creator-status').textContent,disabled:el.querySelector('[data-next]').disabled,action:el.querySelector('[data-action]').value}));
  await page.screenshot({path:path.join(out,'01-review-preview-hidden.png')});
  for(const name of ['identity','appearance','personality','needs','interests','household','review']){
   await root.locator(`[data-page="${name}"]`).click();
   report.navigation.push(await root.evaluate((el,name)=>({name,selected:el.querySelector('[data-page][aria-current]').dataset.page,
    navHeight:el.querySelector('.creator-nav').getBoundingClientRect().height,buttonHeight:el.querySelector(`[data-page="${name}"]`).getBoundingClientRect().height,
    viewportOverflow:document.documentElement.scrollWidth>innerWidth}),name));
  }
  check('All seven narrow sections are reachable without page overflow',report.navigation.every(row=>row.selected===row.name&&!row.viewportOverflow&&row.navHeight>=row.buttonHeight));
  await root.locator('[data-page="needs"]').click();
  await page.screenshot({path:path.join(out,'02-needs-controls.png')});
  await root.locator('[data-page="identity"]').click();
  const input=root.locator('[data-field="name"] input[type="text"]');await input.click();
  for(let i=0;i<10;i++){await page.keyboard.press('Tab');report.keyboard.push(await root.evaluate(el=>({inside:el.contains(document.activeElement),tag:document.activeElement.tagName,text:document.activeElement.textContent?.slice(0,60),id:document.activeElement.id})));}
  check('Tab traversal does not reach underlying game controls',report.keyboard.every(row=>row.inside||row.tag==='BODY'));
  await input.fill('Narrow Created');await input.press('Tab');
  await root.locator('[data-page="review"]').click();
  await root.locator('[data-next]:not([disabled])').waitFor({state:'visible',timeout:60000});
  check('Creation draft keeps preview hidden',await hidden());
  check('Unapplied narrow draft leaves household bytes exact',JSON.stringify(before)===JSON.stringify(await page.evaluate(()=>Array.from(__terriStress.sim.saveBytes()))));
  await root.locator('[data-next]').click();await page.locator('#housemate-dialog').waitFor({state:'hidden'});
  await page.waitForFunction(()=>__terriStress.sim.characterAppearances().some(p=>__terriStress.sim.characterSnapshot(p.sim).name==='Narrow Created'));
  report.created=await page.evaluate(()=>{const p=__terriStress.sim.characterAppearances().find(p=>__terriStress.sim.characterSnapshot(p.sim).name==='Narrow Created');return {person:p.sim,count:__terriStress.sim.characterAppearances().length};});
  check('Hidden-preview creator creates the fourth person',report.created.count===4);
  await page.screenshot({path:path.join(out,'03-created-household.png')});
  await page.locator('#edit-housemate').click();await root.locator('[data-page="identity"]').click();
  check('Existing edit preloads the created name',await input.inputValue()==='Narrow Created');
  await input.fill('Narrow Edited');await input.press('Tab');await root.locator('[data-page="review"]').click();
  await root.locator('[data-next]:not([disabled])').waitFor({state:'visible',timeout:60000});
  check('Apply changes enables with edit preview never opened',await hidden()&&await root.locator('[data-next]').textContent()==='Apply changes');
  await page.screenshot({path:path.join(out,'04-edit-review-preview-hidden.png')});
  await root.locator('[data-next]').click();await page.locator('#housemate-dialog').waitFor({state:'hidden'});
  report.edited=await page.evaluate(person=>({person,name:__terriStress.sim.characterSnapshot(person).name,count:__terriStress.sim.characterAppearances().length}),report.created.person);
  check('Hidden-preview edit changes the same native person',report.edited.name==='Narrow Edited'&&report.edited.count===4);
  await page.screenshot({path:path.join(out,'05-edited-household.png')});
  await page.locator('#edit-housemate').click();await page.keyboard.press('Escape');await page.locator('#housemate-dialog').waitFor({state:'hidden'});report.escapeCloses=true;
  check('Escape closes an unapplied existing edit',report.escapeCloses);check('No browser or graphics diagnostics',report.errors.length===0);
  report.bundleFiles=Object.fromEntries(fs.readdirSync(path.join(bundleDir,'assets')).filter(name=>/\.(js|wasm)$/.test(name)).map(name=>[name,crypto.createHash('sha256').update(fs.readFileSync(path.join(bundleDir,'assets',name))).digest('hex')]));
  report.status='PASS';
 }catch(error){report.status='ERROR';report.error=String(error);if(page)await page.screenshot({path:path.join(out,'failure.png')}).catch(()=>{});throw error;}
 finally{await browser.close();report.browserClosed=true;fs.writeFileSync(path.join(out,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));}
})().catch(e=>{console.error(e);process.exitCode=1;});
