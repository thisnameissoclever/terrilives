const {chromium}=require('C:/Users/myema/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const base='http://127.0.0.1:5187';
const run=process.env.CREATOR_SAVE_RUN||'pass-01';
const out=path.resolve('docs/evidence/2026-10-14-main-integration/creator-save',run);
if(fs.existsSync(out))throw Error('Choose a fresh CREATOR_SAVE_RUN; preserve prior evidence.');
fs.mkdirSync(out,{recursive:true});
const hash=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
const equal=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
// save/skills.rs intentionally stores only non-zero practice. Missing skill
// entries mean unpracticed; compare that documented save representation only.
const savedCharacter=record=>record?{...record,snapshot:{...record.snapshot,skills:record.snapshot.skills.filter(row=>row.practice!==0)}}:record;
const files=['web/src/main.ts','web/src/ui/build-session.ts','web/src/storage/save-worker.ts','web/src/storage/save-header.ts',
 'web/src/ui/persistence-controller.ts','web/src/bridge.ts','web/src/character/draft.ts','web/src/character/fields.ts',
 'web/src/character/schema.ts','web/src/character/validate.ts','web/src/ui/character-creator/view.ts',
 'web/src/ui/character-creator/session.ts','web/src/render/character/prepared-character-load.ts',
 'web/src/wasm/terri_wasm.js','web/src/wasm/terri_wasm_bg.wasm',__filename];
const hashes=()=>Object.fromEntries(files.map(file=>[file,hash(fs.readFileSync(file))]));
const report={checks:[],errors:[],fixtures:[],captures:[],scenarios:[],sourceBefore:hashes()};
fs.copyFileSync(__filename,path.join(out,'verification-script.cjs'));
const write=(name,value)=>fs.writeFileSync(path.join(out,name),JSON.stringify(value,null,2));
const check=(name,condition,evidence)=>{report.checks.push({scenario:currentScenario,name,pass:!!condition,evidence});assert.ok(condition,name);};
let browser,page,currentScenario='overall';

async function snapshot(){return page.evaluate(()=>{
 const s=__terriStress.sim;
 return {tick:s.clockTick(),characters:s.characterAppearances().map(row=>({sim:row.sim,snapshot:s.characterSnapshot(row.sim)})),
  topics:[...s.conversationTopics()],preferences:[...s.conversationPreferences()],owners:[...s.conversationOwners()],
  endLow:[...s.conversationEndLows()],endHigh:[...s.conversationEndHighs()]};
});}
async function bytes(){return page.evaluate(()=>[...__terriStress.sim.saveBytes()]);}
async function disk(name='terri-save-1.bin'){return page.evaluate(async name=>{
 const root=await navigator.storage.getDirectory(),file=await (await root.getFileHandle(name)).getFile();
 return [...new Uint8Array(await file.arrayBuffer())];
},name);}
async function settled(){await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));}
async function options(){if(!await page.locator('#options-panel').isVisible())await page.locator('#options-toggle').click();}
async function save(){
 await options();await page.locator('#save-game').click();
 await page.waitForFunction(()=>document.querySelector('#save-status')?.textContent==='Game saved',null,{timeout:30000});
 await page.waitForFunction(()=>!document.querySelector('#save-game').disabled);
}
async function load(){
 await options();await page.locator('#load-game').click();await page.locator('#confirm-load-game').click();
 await page.waitForFunction(()=>document.querySelector('#save-status')?.textContent==='Saved game loaded'&&!document.querySelector('#load-game').disabled,null,{timeout:60000});
 await settled();
 check('Load confirmation closes after successful adoption',!await page.locator('#load-game-dialog').evaluate(el=>el.open));
}
async function boot(){
 await page.goto(base+'/?stress=0');
 await page.waitForFunction(()=>window.__terriStress,null,{timeout:120000});
 await page.locator('#startup-loading').waitFor({state:'detached',timeout:120000});
 check('Startup reports the seeded saved game loaded',await page.locator('#save-status').textContent()==='Saved game loaded');
 check('Help pauses startup before inspection',await page.locator('#help-panel').evaluate(el=>el.open));
}
async function pauseAndDismissHelp(){
 // Help intentionally keeps the first frame paused. Activate the real label
 // before closing the modal, so no simulation tick slips into comparisons.
 await page.locator('label[for="speed-0"]').evaluate(el=>el.click());
 await page.locator('#close-help').click();await settled();
 check('Pause remains selected after Help closes',await page.locator('#speed-0').isChecked());
}
async function observeCreator(){await page.evaluate(async()=>{
 const url=performance.getEntriesByType('resource').map(row=>row.name).find(url=>/\/ui\/character-creator\/view\.[jt]s(?:\?|$)/.test(url));
 if(!url)throw Error('Creator module URL not observed');
 const {CreatorView}=await import(url),render=CreatorView.prototype.render;
 CreatorView.prototype.render=function(...args){window.creatorSaveView=this;return render.apply(this,args);};
});}
const panel=()=>page.locator('#character-creator-root');
const field=id=>panel().locator(`[data-field=${JSON.stringify(id)}]`);
const nav=name=>panel().locator(`[data-page="${name}"]`).click();
async function group(name){
 const row=panel().locator('details').filter({has:page.locator('summary',{hasText:new RegExp('^'+name+'$')})});
 if(!await row.evaluate(el=>el.open))await row.locator('summary').click();
}
async function ready(){await page.waitForFunction(()=>window.creatorSaveView?.previewReady&&!window.creatorSaveView?.previewError,null,{timeout:60000});}
async function setName(name){await nav('identity');await field('name').locator('input').fill(name);await field('name').locator('input').press('Tab');}
async function setNumber(id,value){await field(id).locator('input[type=number]').fill(String(value));await field(id).locator('input[type=number]').press('Tab');}
async function apply(){
 await nav('review');await ready();await panel().locator('[data-next]').click();
 await page.waitForFunction(()=>!document.querySelector('#housemate-dialog').open,null,{timeout:60000});await settled();
}
async function capture(name){await page.screenshot({path:path.join(out,name)});report.captures.push(name);}

(async()=>{
 browser=await chromium.launch({channel:'chrome',headless:false,args:['--mute-audio']});report.browser=browser.version();
 try{
  const scenarios=[
   {id:'main-v9-migration',fixture:'main-social-active'},
   {id:'local-v9-migration',fixture:'local-character-0'},
   {id:'creator-save',fixture:'main-social-active',creator:true},
   {id:'build-load-cancel',fixture:'main-social-active',build:true},
  ];
  for(const scenario of scenarios){
   currentScenario=scenario.id;
   const {fixture}=scenario,result={id:scenario.id,fixture,status:'RUNNING'};
   const context=await browser.newContext({viewport:{width:1440,height:1000},deviceScaleFactor:1,reducedMotion:'no-preference'});
   try{
    page=await context.newPage();
    page.on('pageerror',error=>report.errors.push({scenario:scenario.id,fixture,error:String(error)}));
    page.on('console',message=>{if(['warning','error'].includes(message.type())&&!message.location().url.endsWith('/favicon.ico'))report.errors.push({scenario:scenario.id,fixture,type:message.type(),text:message.text()});});
    await page.addInitScript(()=>localStorage.removeItem('terrilives.help-dismissed.v1'));
    await page.route('**/creator-save-seed',route=>route.fulfill({contentType:'text/html',headers:{'Cross-Origin-Opener-Policy':'same-origin','Cross-Origin-Embedder-Policy':'require-corp'},body:'<!doctype html><title>Isolated save fixture</title><p>Preparing isolated storage.</p>'}));
    await page.goto(base+'/creator-save-seed');
    const original=[...fs.readFileSync(`crates/terri-wasm/tests/fixtures/schema-v9/${fixture}.sav`)];
    const expected=await page.evaluate(async original=>{
     const root=await navigator.storage.getDirectory(),file=await root.getFileHandle('terri-save-1.bin',{create:true}),writer=await file.createWritable();
     await writer.write(Uint8Array.from(original));await writer.close();
     const {default:init,SimHandle}=await import('/src/wasm/terri_wasm.js'),{SimBridge}=await import('/src/bridge.ts'),wasm=await init();
     const handle=SimHandle.from_lot(),s=new SimBridge(handle,wasm.memory);
     try{
      if(!s.loadBytes(Uint8Array.from(original)))throw Error('Fixture refused by isolated native decoder');
      return {tick:s.clockTick(),characters:s.characterAppearances().map(row=>({sim:row.sim,snapshot:s.characterSnapshot(row.sim)})),
       topics:[...s.conversationTopics()],preferences:[...s.conversationPreferences()],owners:[...s.conversationOwners()],
       endLow:[...s.conversationEndLows()],endHigh:[...s.conversationEndHighs()]};
     }finally{handle.free();}
    },original);
    write(scenario.id+'-expected.json',expected);
    check(fixture+': fixture is schema 9',original[8]===9&&original[9]===0);
    if(fixture==='main-social-active')check('Authentic main fixture has an active conversation topic',expected.topics.some(topic=>topic!==0&&topic!==0xffffffff),expected.topics);
    await boot();const startup=await snapshot();
    check(fixture+': actual startup preserves native appearance and social state',equal(startup,expected));
    await pauseAndDismissHelp();await load();
    check(fixture+': explicit disk Load preserves native appearance and social state',equal(await snapshot(),expected));
    await capture(scenario.id+'-loaded.png');
    const liveBeforeSave=await bytes();await save();const stored=await disk(),backup=await disk('terri-save-1.v9-backup.bin');
    check(fixture+': disk Save writes schema 10',stored[8]===10&&stored[9]===0);
    check(fixture+': disk Save preserves exact live bytes',equal(stored,liveBeforeSave));
    check(fixture+': V9 recovery backup is byte exact',equal(backup,original));
    const savedSnapshot=await snapshot();await boot();
    check(fixture+': V10 browser reload preserves exact character and social state',equal(await snapshot(),savedSnapshot));
    check(fixture+': browser reload leaves V9 backup untouched',equal(await disk('terri-save-1.v9-backup.bin'),original));
    report.fixtures.push({scenario:scenario.id,fixture,originalSha256:hash(Buffer.from(original)),savedSha256:hash(Buffer.from(stored)),backupSha256:hash(Buffer.from(backup)),expected});

    if(scenario.creator){
     await pauseAndDismissHelp();await observeCreator();
     await options();await page.locator('#new-housemate').click();await ready();
     check('Actual creator opens on Walking',await panel().locator('[data-action]').inputValue()==='walk');
     await nav('review');await panel().locator('[data-reset]').click();await ready();
     await setName('Migration Test');await nav('appearance');await group('Body');await setNumber('appearance.body.height',67);
     await nav('needs');await panel().locator('[data-reset]').click();
     const categoryValues=await panel().locator('[data-field^="activity-category:"] input[type=number]').evaluateAll(nodes=>nodes.map(node=>Number(node.value)));
     const preferences=panel().locator('details[data-group="Activity preferences"]');
     check('Needs Reset presents ten 1.0x Activity preferences',categoryValues.length===10&&categoryValues.every(value=>value===1)&&await preferences.locator('summary').filter({hasText:/^Activity preferences$/}).count()===1,categoryValues);
     check('Activity preferences disclosure starts open',await preferences.evaluate(el=>el.open));
     await preferences.locator('summary').click();await nav('appearance');await nav('needs');
     check('Activity preferences disclosure retains a deliberate collapse',!await preferences.evaluate(el=>el.open));
     await preferences.locator('summary').click();
     await ready();await capture('activity-preferences-reset.png');
     await nav('interests');await group('Skills');
     await field(JSON.stringify(['skill','reading'])).locator('select').selectOption({label:'Level 1'});
     const draft=await page.evaluate(()=>window.creatorSaveView.session.draft.value);await apply();
     const created=(await snapshot()).characters.find(row=>row.snapshot.name==='Migration Test');
     check('Creator Move in applies the requested character',!!created&&equal(created.snapshot,draft));
     report.created=created;await capture('creator-applied.png');
     const createdTick=(await snapshot()).tick;
     await save();const createdDisk=await disk();await boot();
     const reloadedState=await snapshot(),createdReloaded=reloadedState.characters.find(row=>row.sim===created.sim),createdReloadedBytes=await bytes();
     write('created-reload-comparison.json',{created,createdReloaded,createdTick,reloadedTick:reloadedState.tick,createdDisk,createdReloadedBytes});
     check('Created character reload preserves the exact saved bytes and tick',equal(createdDisk,createdReloadedBytes)&&createdTick===reloadedState.tick);
     check('Created character survives actual disk Save and browser reload',equal(savedCharacter(createdReloaded),savedCharacter(created)),{zeroPracticeEntriesOmittedBySave:true});
     const reading=createdReloaded.snapshot.skills.find(row=>row.id==='reading');
     check('Nonzero reading practice survives without normalization',!!reading&&reading.practice!==0&&reading.practice===created.snapshot.skills.find(row=>row.id==='reading').practice,reading);
     await pauseAndDismissHelp();await observeCreator();
     await page.locator('#household-roster-members').getByRole('button',{name:'Migration Test',exact:true}).click();await settled();
     await page.locator('#edit-housemate').click();await ready();
     check('Edit reopens the exact saved created person',equal(await page.evaluate(()=>window.creatorSaveView.session.draft.value),createdReloaded.snapshot));
     await setName('Edited Migration');await nav('needs');await group('Advanced need rates');await setNumber('behavior.drain.0',125);
     const editedDraft=await page.evaluate(()=>window.creatorSaveView.session.draft.value);await apply();
     const edited=(await snapshot()).characters.find(row=>row.sim===created.sim);
     check('Creator Apply commits name and need changes exactly',equal(edited.snapshot,editedDraft));
     await save();const editedDisk=await disk();await boot();
     check('Edited character survives actual disk Save and browser reload',equal((await snapshot()).characters.find(row=>row.sim===created.sim),edited));
     check('Repeated saves retain the original V9 recovery bytes',equal(await disk('terri-save-1.v9-backup.bin'),original));
     report.creatorSave={createdDiskSha256:hash(Buffer.from(createdDisk)),editedDiskSha256:hash(Buffer.from(editedDisk)),edited};
    }
    if(scenario.build){
     const loadedDisk=await disk();
     await pauseAndDismissHelp();await observeCreator();
     await page.locator('#household-roster-members').getByRole('button',{name:expected.characters[0].snapshot.name,exact:true}).click();await settled();
     await page.locator('#edit-housemate').click();await ready();await setName('Unsaved baseline');await apply();
     const unsavedBeforeBuild=await bytes();
     check('Build begins with live state different from the disk save',!equal(unsavedBeforeBuild,loadedDisk));
     await page.locator('#build-toggle').click();
     check('Build mode is active before Load',await page.locator('#build-toggle').getAttribute('aria-pressed')==='true');
     const moved=await page.evaluate(()=>{
      const s=__terriStress.sim,ids=[...s.ids()],kinds=[...s.kinds()],positions=[...s.positions()];
      for(let row=0;row<ids.length;row++)if(kinds[row]===1){
       const id=ids[row],facing=s.objectFacing(id);
       for(let y=0;y<13;y++)for(let x=0;x<16;x++){
        if(x===positions[row*2]&&y===positions[row*2+1])continue;
        if(s.placementPreview(id,x,y,facing).reason!==null)continue;
        s.placeObject(id,x,y,facing);s.flushCommands();
        if(s.lastPlacementResult()?.reason!==null)throw Error('Preview-approved placement refused');
        return {id,from:[positions[row*2],positions[row*2+1]],to:[x,y],facing};
       }
      }
      throw Error('No bounded legal pending placement available');
     });
     check('Pending Build placement changes live bytes',!equal(await bytes(),unsavedBeforeBuild),moved);
     await load();check('Actual Load replaces the pending Build world with disk state',equal(await bytes(),loadedDisk));
     await page.locator('#build-batch-cancel').click();await settled();
     check('Build Cancel retains the newly loaded world instead of the old baseline',equal(await bytes(),loadedDisk));
     await capture('build-load-cancel.png');
     await page.locator('#builder-exit').click();await settled();
     check('Exit Build restores play controls',await page.locator('body').getAttribute('data-building')==='false'&&
      !await page.locator('#builder-controls').isVisible()&&await page.locator('#build-toggle').isVisible());
     check('Leaving Build retains the newly loaded world',equal(await bytes(),loadedDisk));
     report.buildLoad={loadedDiskSha256:hash(Buffer.from(loadedDisk)),unsavedBaselineSha256:hash(Buffer.from(unsavedBeforeBuild)),moved};
    }
    result.status='PASS';
   }catch(error){result.status='FAIL';result.failure=String(error);await page.screenshot({path:path.join(out,scenario.id+'-failure.png')}).catch(()=>{});}
   finally{
    await context.close();page=null;result.contextClosed=true;
    result.checks=report.checks.filter(check=>check.scenario===scenario.id);result.errors=report.errors.filter(error=>error.scenario===scenario.id);
    report.scenarios.push(result);write(scenario.id+'-report.json',result);console.log(JSON.stringify({scenario:scenario.id,status:result.status,checks:result.checks.length}));
   }
  }
  currentScenario='overall';
  check('Every independently reported scenario passed',report.scenarios.every(scenario=>scenario.status==='PASS'));
  check('No browser or graphics diagnostics',report.errors.length===0,report.errors);
  report.sourceAfter=hashes();check('Relevant runtime sources remained unchanged during the proof',equal(report.sourceBefore,report.sourceAfter));
  report.status='PASS';console.log(JSON.stringify({status:report.status,checks:report.checks.length,captures:report.captures}));
 }catch(error){report.status='FAIL';report.failure=String(error);if(page)await page.screenshot({path:path.join(out,'failure.png')}).catch(()=>{});throw error;}
 finally{await browser.close();report.browserClosed=true;report.sourceAfter=hashes();write('report.json',report);}
})().catch(error=>{console.error(error);process.exitCode=1;});
