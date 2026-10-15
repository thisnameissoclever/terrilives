const {chromium}=require('C:/Users/myema/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
(async()=>{const out=path.resolve('docs/evidence/2026-10-12-full-character-creator/choice-influences');fs.mkdirSync(out,{recursive:true});const browser=await chromium.launch({channel:'chrome',headless:true}),errors=[];
 try{const page=await browser.newPage({viewport:{width:1440,height:1100}});page.on('pageerror',e=>errors.push(String(e)));await page.goto('http://127.0.0.1:5187/proofs/character-creator.html');await page.waitForFunction(()=>window.creatorHarness,null,{timeout:60000});await page.evaluate(()=>window.creatorHarness.open(0,51));
  const before=await page.evaluate(()=>window.creatorHarness.worldHash());await page.getByRole('button',{name:'Traits',exact:true}).click();
  while(await page.locator('.creator-editor input[type=checkbox]:checked').count()){const id=await page.locator('.creator-editor input[type=checkbox]:checked').first().getAttribute('id');await page.locator('#'+id).uncheck();}
  await page.getByRole('checkbox',{name:/^Television devotee/}).check();
  const route=await page.evaluate(()=>window.creatorHarness.draft.catalog.activities.find(row=>row.tags.includes('television')));assert(route);
  await page.getByRole('button',{name:'Personality',exact:true}).click();await page.locator('summary').filter({hasText:'Activity inclinations'}).click();
  const input=page.getByLabel(route.label+' value',{exact:true});await input.fill('0.5');await input.press('Tab');await page.locator('summary').filter({hasText:'Combined activity influences'}).click();
  const text=await page.locator('.creator-choice-influences').textContent();assert(text.includes('Activity 0.5 × traits 1.5 ≈ 0.75'));assert(text.includes('Television devotee'));assert.equal(await page.evaluate(()=>window.creatorHarness.worldHash()),before);
  await page.waitForFunction(()=>document.querySelector('.creator-status').textContent==='');await page.locator('.creator-editor').evaluate(el=>{el.scrollTop=0;});await page.screenshot({path:path.join(out,'actual-combined-influences.png')});assert.deepEqual(errors,[]);
  fs.writeFileSync(path.join(out,'report.json'),JSON.stringify({route,text,worldUnchanged:true,errors},null,2));console.log(JSON.stringify({route:route.label,combined:.75,worldUnchanged:true,errors}));
 }finally{await browser.close();}})().catch(e=>{console.error(e);process.exitCode=1});

