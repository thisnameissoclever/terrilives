const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'C:/Users/myema/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const fs=require('node:fs');const path=require('node:path');
(async()=>{
 const folder=path.resolve('docs/evidence/2026-10-12-full-character-creator/ui');fs.mkdirSync(folder,{recursive:true});
 const browser=await chromium.launch({channel:'chrome',headless:true}),errors=[];
 try{
  const page=await browser.newPage({viewport:{width:1440,height:1100}});page.on('pageerror',error=>errors.push(String(error)));
  await page.goto('http://127.0.0.1:5187/proofs/character-creator.html');
  await page.waitForFunction(()=>window.creatorHarness||window.creatorHarnessError,null,{timeout:60000});
  const startup=await page.evaluate(()=>window.creatorHarnessError);if(startup)throw new Error(startup);
  await page.locator('.creator-portrait').screenshot({path:path.join(folder,'portrait.png')});
  await page.screenshot({path:path.join(folder,'appearance.png')});
  const before=await page.evaluate(()=>({hash:window.creatorHarness.worldHash(),value:window.creatorHarness.value}));
  await page.getByRole('button',{name:'Personality',exact:true}).click();
  await page.screenshot({path:path.join(folder,'personality.png')});
  await page.getByRole('button',{name:'Shyness: protect from randomization'}).click();
  await page.getByRole('button',{name:'Randomize',exact:true}).click();
  const after=await page.evaluate(()=>({hash:window.creatorHarness.worldHash(),value:window.creatorHarness.value}));
  if(before.hash!==after.hash||before.value.behavior.shyness!==after.value.behavior.shyness)throw new Error('Draft isolation or lock failed.');
  await page.getByRole('button',{name:'Undo',exact:true}).click();
  if(JSON.stringify(await page.evaluate(()=>window.creatorHarness.value))!==JSON.stringify(before.value))throw new Error('Undo did not restore draft.');
  await page.getByRole('button',{name:'Cancel',exact:true}).click();
  await page.getByRole('button',{name:'Edit first housemate',exact:true}).click();
  const exact=await page.evaluate(()=>JSON.stringify(window.creatorHarness.value)===JSON.stringify(window.creatorHarness.snapshot(0)));
  if(!exact)throw new Error('Edit preload differs.');
  await page.getByRole('button',{name:'Identity',exact:true}).click();await page.getByLabel('Name',{exact:true}).fill('Edited in creator');
  await page.getByLabel('Name',{exact:true}).press('Tab');await page.getByRole('button',{name:'Review',exact:true}).click();
  await page.getByRole('button',{name:'Apply changes',exact:true}).click();
  await page.waitForFunction(()=>window.creatorHarness.snapshot(0).name==='Edited in creator');
  const roundTrip=await page.evaluate(async ()=>{const before=JSON.stringify(window.creatorHarness.snapshot(0)),saved=window.creatorHarness.save();return (await window.creatorHarness.load(saved))&&JSON.stringify(window.creatorHarness.snapshot(0))===before;});
  if(!roundTrip)throw new Error('UI save/reload differs.');
  errors.push(...await page.evaluate(()=>window.creatorHarness.errors));
  const status=await page.locator('#result').textContent();
  fs.writeFileSync(path.join(folder,'report.json'),JSON.stringify({errors,status,editPreload:exact,roundTrip,randomizationIsolated:before.hash===after.hash},null,2));
  if(errors.length)throw new Error(errors.join('\n'));
  console.log(JSON.stringify({status,roundTrip,errors}));
 }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
