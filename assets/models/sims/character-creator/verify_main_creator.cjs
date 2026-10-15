const {chromium}=require('C:/Users/myema/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const fs=require('node:fs');
(async()=>{
 const browser=await chromium.launch({channel:'chrome',headless:true}),errors=[];
 try{
  const page=await browser.newPage({viewport:{width:1440,height:1100}});page.on('pageerror',e=>errors.push(String(e)));
  await page.goto('http://127.0.0.1:5187/?stress=0');await page.waitForFunction(()=>!!window.__terriStress,null,{timeout:120000});
  if(await page.locator('#help-panel').evaluate(el=>el.open))await page.locator('#close-help').click();
  await page.getByText('Pause',{exact:true}).click();
  await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
  const before=await page.evaluate(()=>({world:window.__terriStress.sim.worldHash().toString(),appearance:window.__terriStress.sim.appearanceHash().toString()}));
  await page.locator('#options-toggle').click();await page.locator('#new-housemate').click();
  await page.waitForFunction(()=>document.querySelector('.creator-status')?.textContent==='');
  await page.screenshot({path:'docs/evidence/2026-10-12-full-character-creator/ui/main-creator.png'});
  await page.getByRole('button',{name:'Cancel',exact:true}).click();
  await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
  const after=await page.evaluate(()=>({world:window.__terriStress.sim.worldHash().toString(),appearance:window.__terriStress.sim.appearanceHash().toString()}));
  if(JSON.stringify(before)!==JSON.stringify(after))throw Error('Cancelled creator changed saved state.');
  await page.locator('#household-roster-members button').first().click();
  await page.waitForFunction(()=>window.__terriStress.sim.selectedIndex()!==null);
  const expected=await page.evaluate(()=>{const sim=window.__terriStress.sim;return sim.characterSnapshot(sim.simIdOf(sim.selectedIndex()));});
  await page.locator('#edit-housemate').click();await page.waitForFunction(()=>document.querySelector('.creator-status')?.textContent==='');
  await page.getByRole('button',{name:'Identity',exact:true}).click();
  if(await page.getByLabel('Name',{exact:true}).inputValue()!==expected.name)throw Error('Edit name preload differs.');
  await page.getByRole('button',{name:'Review',exact:true}).click();
  const fieldCount=await page.locator('.creator-review dt').count();if(fieldCount<50)throw Error('Review did not expose the full character.');
  await page.getByRole('button',{name:'Cancel',exact:true}).click();
  const unchanged=await page.evaluate(expected=>{const sim=window.__terriStress.sim;return JSON.stringify(sim.characterSnapshot(sim.simIdOf(sim.selectedIndex())))===JSON.stringify(expected);},expected);
  if(!unchanged)throw Error('Edit preload or cancellation changed the character.');
  const report={errors,cancelPreserved:true,editPreload:true,reviewFields:fieldCount};fs.writeFileSync('docs/evidence/2026-10-12-full-character-creator/ui/main-report.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report));if(errors.length)process.exitCode=1;
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
