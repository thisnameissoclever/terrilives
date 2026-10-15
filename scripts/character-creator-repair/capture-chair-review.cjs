const {chromium}=require('C:/Users/myema/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'../..'),label=process.env.CHAIR_VISUAL_RUN||'visual-01';
if(!/^[a-z0-9-]+$/.test(label))throw Error('Invalid run label');
const out=path.join(root,'docs/evidence/2026-10-14-visual-review',label);
if(fs.existsSync(out))throw Error('Choose a new label; preserve existing captures');fs.mkdirSync(out,{recursive:true});
const digest=data=>crypto.createHash('sha256').update(data).digest('hex');
const hashes=()=>Object.fromEntries(['web/src/render/character/preview-fixture.ts','web/src/ui/character-creator/preview.ts','web/src/ui/character-creator/view.ts','web/src/render/character/pipelines.ts','web/src/render/character/renderer.ts','web/src/render/character/prepared-character.ts','web/index.html'].map(file=>[file,digest(fs.readFileSync(path.join(root,file)))]));
const report={sourceBefore:hashes(),cases:[],errors:[],blindMapping:{'set-a':'old-anchor','set-b':'current'}};
(async()=>{
 const browser=await chromium.launch({channel:'chrome',headless:false,args:['--mute-audio']});let page;
 try{
  page=await browser.newPage({viewport:{width:1440,height:1000}});report.browser=browser.version();
  page.on('pageerror',e=>report.errors.push(String(e)));page.on('console',m=>{if(['warning','error'].includes(m.type())&&!m.location().url.endsWith('/favicon.ico'))report.errors.push(m.text());});
  await page.goto('http://127.0.0.1:5187/?stress=0');await page.waitForFunction(()=>window.__terriStress,null,{timeout:120000});
  await page.locator('#speed-0').evaluate(el=>el.click());if(await page.locator('#help-panel').evaluate(el=>el.open))await page.locator('#close-help').click();
  await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
  report.originalSave=await page.evaluate(()=>Array.from(__terriStress.sim.saveBytes()));
  report.module=await page.evaluate(async()=>{
   const url=performance.getEntriesByType('resource').map(r=>r.name).find(url=>/\/ui\/character-creator\/view\.[jt]s(?:\?|$)/.test(url));if(!url)throw Error('Creator module not observed');
   const {CreatorView}=await import(url),render=CreatorView.prototype.render;
   CreatorView.prototype.render=function(...args){window.chairReviewView=this;return render.apply(this,args);};return url;
  });
  await page.locator('#options-toggle').click();await page.locator('#new-housemate').click();
  const panel=page.locator('#character-creator-root'),field=id=>panel.locator(`[data-field=${JSON.stringify(id)}]`);
  const ready=()=>page.waitForFunction(()=>window.chairReviewView?.previewReady&&!window.chairReviewView?.previewInFlight,null,{timeout:60000});
  const group=async name=>{const item=panel.locator('details').filter({has:page.locator('summary',{hasText:new RegExp('^'+name+'$')})});if(!await item.evaluate(el=>el.open))await item.locator('summary').click();};
  await ready();if(await panel.locator('[data-play]').textContent()==='Pause')await panel.locator('[data-play]').click();
  await panel.locator('[data-action]').selectOption('read');await ready();
  report.fixtureModule=await page.evaluate(async()=>{
   const url=performance.getEntriesByType('resource').map(r=>r.name).find(url=>/\/render\/character\/preview-fixture\.[jt]s(?:\?|$)/.test(url));if(!url)throw Error('Fixture module not observed');
   const {PreviewFixtureRenderer}=await import(url),draw=PreviewFixtureRenderer.prototype.draw;
   window.chairFault=false;window.chairWrites=[];
   PreviewFixtureRenderer.prototype.draw=function(pass,facing,placement){
    const queue=this.device.queue,write=queue.writeBuffer;
    queue.writeBuffer=function(buffer,offset,data,...rest){
     if(!(data instanceof Float32Array)||data.length!==12)throw Error('Unexpected fixture uniform');
     const copy=data.slice();if(window.chairFault)copy[7]+=21*placement.scale;
     window.chairWrites.push({facing,placement:{...placement},original:Array.from(data),submitted:Array.from(copy),fault:window.chairFault});
     return write.call(this,buffer,offset,copy,...rest);
    };try{return draw.call(this,pass,facing,placement);}finally{queue.writeBuffer=write;}
   };window.restoreChairReview=()=>{PreviewFixtureRenderer.prototype.draw=draw;};return url;
  });
  await panel.locator('[data-page="appearance"]').click();await group('Body');
  const capture=async name=>{await ready();await page.evaluate(async()=>{const v=window.chairReviewView;v.frame=0;await v.preview.draw(v.session.draft.value.appearance,v.facing*Math.PI/2,'read',0);});
   const file=name+'.png',png=await panel.locator('.creator-preview').screenshot({path:path.join(out,file)});
   const state=await page.evaluate(()=>({appearance:window.chairReviewView.session.draft.value.appearance,facing:window.chairReviewView.facing,frame:0,writes:window.chairWrites.splice(0)}));
   assert.ok(state.writes.length>=2,'Actual fixture draws must be observed');report.cases.push({file,sha256:digest(png),...state});return digest(png);};
  for(const gender of ['Male','Female']){
   await field('appearance.presentation').locator('select').selectOption({label:gender});await panel.getByRole('button',{name:'Reset appearance to preset',exact:true}).click();
   if(gender==='Male'){await group('Style');await field('appearance.hairstyle').locator('select').selectOption({label:'Bald'});}
   await group('Body');
   for(const value of [50,0,100]){
    for(const key of ['height','build','shoulders','hips','torso']){const input=field('appearance.body.'+key).locator('input[type=number]');await input.fill(String(value));await input.press('Tab');}
    await ready();
    const current=[];
    for(let facing=0;facing<4;facing++){assert.equal(await page.evaluate(()=>window.chairReviewView.facing),facing);current.push(await capture(gender==='Male'&&value===50?'set-b-'+facing:gender.toLowerCase()+'-'+value+'-'+facing));await panel.locator('[data-turn]').click();await ready();}
    if(gender==='Male'&&value===50){
     await page.evaluate(()=>window.chairFault=true);
     for(let facing=0;facing<4;facing++){const changed=await capture('set-a-'+facing);assert.notEqual(changed,current[facing],'Known offset must change visible output');await panel.locator('[data-turn]').click();await ready();}
     await page.evaluate(()=>window.chairFault=false);const restored=await capture('restored');assert.equal(restored,current[0],'Restoration must reproduce identical displayed preview');
     await panel.screenshot({path:path.join(out,'creator-reading.png')});
    }
   }
  }
  report.finalSave=await page.evaluate(()=>Array.from(__terriStress.sim.saveBytes()));assert.deepEqual(report.finalSave,report.originalSave);
  await page.evaluate(()=>window.restoreChairReview());await panel.locator('[data-cancel]').click();
  report.sourceAfter=hashes();assert.deepEqual(report.sourceAfter,report.sourceBefore);assert.deepEqual(report.errors,[]);
  report.status='PASS';console.log(JSON.stringify({status:report.status,cases:report.cases.length,errors:report.errors}));
 }catch(error){report.status='FAIL';report.failure=String(error);if(page)await page.screenshot({path:path.join(out,'failure.png')}).catch(()=>{});throw error;}
 finally{await browser.close();report.browserClosed=true;fs.writeFileSync(path.join(out,'report.json'),JSON.stringify(report,null,2));}
})().catch(error=>{console.error(error);process.exitCode=1;});
