const fs=require('node:fs');
const path=require('node:path');
const assert=require('node:assert/strict');
const {pathToFileURL}=require('node:url');
const {chromium}=require('C:/Users/myema/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const out=__dirname,base='http://127.0.0.1:5193';
const report={checks:[],errors:[],captures:[],status:'RUNNING',widths:[]};
const check=(name,value)=>{assert.ok(value,name);report.checks.push(name);};
(async()=>{
 let server,browser,page;
 try{
  const vite=await import(pathToFileURL(path.resolve('web/node_modules/vite/dist/node/index.js')).href);
  server=await vite.preview({configFile:false,root:path.resolve('web'),base:'./',build:{outDir:path.resolve('.local-build/merge-20261015/web-container')},preview:{host:'127.0.0.1',port:5193,strictPort:true}});
  browser=await chromium.launch({channel:'chrome',headless:false,args:['--mute-audio']});
  const context=await browser.newContext({viewport:{width:1440,height:1000}});
  await context.addInitScript(()=>{
   localStorage.setItem('terrilives.help-dismissed.v1','1');let harness;
   Object.defineProperty(window,'__terriStress',{configurable:true,get:()=>harness,set:v=>{harness=v;document.querySelector('#speed-0').click();}});
  });
  page=await context.newPage();
  page.on('pageerror',error=>report.errors.push(String(error)));
  page.on('console',m=>{if(['error','warning'].includes(m.type())&&!m.location().url.endsWith('/favicon.ico'))report.errors.push(m.text());});
  await page.goto(base+'/?stress=0');
  await page.waitForFunction(()=>window.__terriStress,null,{timeout:120000});
  await page.locator('#startup-loading').waitFor({state:'detached',timeout:120000});
  if(await page.locator('#help-panel').evaluate(n=>n.open))await page.locator('#close-help').click();
  report.fixture=await page.evaluate(async()=>{
   const h=__terriStress,s=h.sim,c=s.characterCatalog().traits.find(t=>t.kind==='condition');
   const b=new ArrayBuffer(4),v=new DataView(b);v.setFloat32(0,.73123455,true);
   const traits=[{id:c.id,state:v.getUint32(0,true)}];
   if(!await h.characters.edit(74125,0,{version:1,traits}))throw Error('Condition fixture refused');
   s.flushCommands();if(s.characterResults().some(r=>r.request===74125&&r.reason!==null))throw Error('Condition edit failed');
   const person=s.characterAppearances().find(p=>p.sim===0);s.select(person.entity);
   return {condition:c.id,snapshot:s.characterSnapshot(0)};
  });
  await page.locator('#edit-housemate').click();
  const root=page.locator('#character-creator-root');
  const nav=name=>root.locator(`[data-page="${name}"]`).click();
  const field=id=>root.locator(`[data-field=${JSON.stringify(id)}]`);
  const capture=async name=>{await root.screenshot({path:path.join(out,name+'.png')});report.captures.push(name+'.png');};
  await nav('personality');
  const conditions=root.locator('details').filter({has:page.locator('summary',{hasText:/^Conditions$/})});
  if(!await conditions.evaluate(n=>n.open))await conditions.locator('summary').click();
  const row=field(JSON.stringify(['severity',report.fixture.condition]));
  const number=row.locator('input[type=number]'),lock=row.locator('.creator-lock');
  check('Saved severity is displayed as 73.1235',await number.inputValue()==='73.1235');
  for(const width of [1440,761,320]){
   await page.setViewportSize({width,height:1000});
   for(const state of ['Lock','Locked']){
    if(await lock.textContent()!==state)await lock.click();
    await row.scrollIntoViewIfNeeded();
    const metrics=await row.evaluate(row=>{
     const input=row.querySelector('input[type=number]'),style=getComputedStyle(input),canvas=document.createElement('canvas'),ctx=canvas.getContext('2d');ctx.font=style.font;
     const text=ctx.measureText(input.value).width,available=input.clientWidth-parseFloat(style.paddingLeft)-parseFloat(style.paddingRight);
     const nodes=[input,row.querySelector('.creator-unit'),row.querySelector('input[type=range]'),...row.querySelectorAll(':scope>button')];
     const rects=nodes.map(n=>n.getBoundingClientRect());let collisions=0;
     for(let a=0;a<rects.length;a++)for(let b=a+1;b<rects.length;b++)if(Math.min(rects[a].right,rects[b].right)-Math.max(rects[a].left,rects[b].left)>.5&&Math.min(rects[a].bottom,rects[b].bottom)-Math.max(rects[a].top,rects[b].top)>.5)collisions++;
     const editor=row.closest('.creator-editor');
     return {width:innerWidth,value:input.value,text,available,collisions,buttons:[...row.querySelectorAll(':scope>button')].map(n=>({text:n.textContent,clipped:n.scrollWidth>n.clientWidth+1})),editorOverflow:editor.scrollWidth>editor.clientWidth+1,documentOverflow:document.documentElement.scrollWidth>innerWidth};
    });
    report.widths.push({...metrics,state});
    check(`${width}/${state}: full value fits`,metrics.value==='73.1235'&&metrics.available>metrics.text+16);
    check(`${width}/${state}: controls separate and labels fit`,metrics.collisions===0&&metrics.buttons.every(b=>!b.clipped)&&!metrics.editorOverflow&&!metrics.documentOverflow);
    await capture(`width-${width}-${state.toLowerCase()}`);
   }
  }
  for(const name of ['identity','appearance','personality','needs','interests','household','review']){
   await nav(name);check(`320px ${name} navigation works`,await root.locator(`[data-page="${name}"]`).getAttribute('aria-current')==='step');
  }
  await capture('narrow-review');
  await nav('needs');await capture('narrow-needs');
  await page.setViewportSize({width:1440,height:1000});await nav('identity');
  await field('name').locator('input[type=text]').fill('Independent Width Review');await field('name').locator('input[type=text]').press('Tab');
  await nav('review');
  const personality=root.locator('details').filter({has:page.locator('summary',{hasText:/^Personality$/})});
  if(!await personality.evaluate(n=>n.open))await personality.locator('summary').click();
  check('Review retains full saved percentage',await root.locator('.creator-review').allTextContents().then(v=>v.join(' ').includes('73.1235%')));
  await capture('desktop-review');
  await root.locator('[data-next]').waitFor({state:'visible'});
  await page.waitForFunction(()=>!document.querySelector('#character-creator-root [data-next]').disabled,null,{timeout:120000});
  await root.locator('[data-next]').click();await page.waitForFunction(()=>!document.querySelector('#housemate-dialog').open,null,{timeout:120000});
  report.after=await page.evaluate(()=>__terriStress.sim.characterSnapshot(0));
  assert.deepStrictEqual(report.after,{...report.fixture.snapshot,name:'Independent Width Review'});report.checks.push('Apply changes edits name and preserves complete saved character including exact condition bits');
  await page.locator('#edit-housemate').click();await nav('personality');
  const reopenedConditions=root.locator('details').filter({has:page.locator('summary',{hasText:/^Conditions$/})});
  if(!await reopenedConditions.evaluate(n=>n.open))await reopenedConditions.locator('summary').click();
  check('Reopened edited character retains complete percentage',await number.inputValue()==='73.1235');await row.scrollIntoViewIfNeeded();await capture('reopened-condition');
  check('No browser or graphics warnings/errors',report.errors.length===0);
  report.loadedStyles=await page.evaluate(()=>performance.getEntriesByType('resource').map(r=>r.name).filter(n=>n.includes('/assets/')&&n.endsWith('.css')));
  const style=fs.readdirSync('.local-build/merge-20261015/web-container/assets').find(n=>/^index-.*\.css$/.test(n));
  check('Actual browser loaded final container build stylesheet',report.loadedStyles.some(n=>n.endsWith('/'+style)));
  report.status='PASS';
 }catch(error){report.status='FAIL';report.failure=String(error);if(page)await page.screenshot({path:path.join(out,'failure.png')}).catch(()=>{});process.exitCode=1;}
 finally{
  if(browser){await browser.close();report.browserClosed=true;}
  if(server){await new Promise((resolve,reject)=>server.httpServer.close(e=>e?reject(e):resolve()));report.ownedPreviewClosed=true;}
  fs.writeFileSync(path.join(out,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({status:report.status,checks:report.checks.length,errors:report.errors,browserClosed:report.browserClosed,ownedPreviewClosed:report.ownedPreviewClosed,failure:report.failure}));
 }
})();
