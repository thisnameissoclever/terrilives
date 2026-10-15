const {chromium}=require('C:/Users/myema/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const fs=require('node:fs'),path=require('node:path');
(async()=>{
 const out=path.resolve('docs/evidence/2026-10-13-creator-repair/integration');fs.mkdirSync(out,{recursive:true});
 const browser=await chromium.launch({channel:'chrome',headless:true}),errors=[],browserNotices=[];
 try{const page=await browser.newPage({viewport:{width:1440,height:1000}});
  page.on('pageerror',e=>{errors.push(String(e));console.log(String(e));});
  page.on('console',message=>{if(['error','warning'].includes(message.type())){if(message.location().url==='http://127.0.0.1:5187/favicon.ico'){browserNotices.push('Browser requested an absent favicon; no game resource failed.');return;}errors.push(message.text()+JSON.stringify(message.location()));console.log(message.text().slice(0,3000),message.location());}});
  page.on('response',response=>{if(response.status()>=400)console.log('HTTP',response.status(),response.url());});
  await page.goto('http://127.0.0.1:5187/?stress=0');
  await page.waitForFunction(()=>window.__terriStress||document.querySelector('#startup-error'),null,{timeout:120000});
  if(await page.locator('#help-panel').evaluate(el=>el.open))await page.locator('#close-help').click();
  await page.getByText('Pause',{exact:true}).click();
  await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
  await page.screenshot({path:path.join(out,'world.png')});
  const result=await page.evaluate(()=>window.__terriStress?.characters.snapshot());
  fs.writeFileSync(path.join(out,'smoke.json'),JSON.stringify({result,errors,browserNotices},null,2));
  if(errors.length)throw Error('Graphics or page errors recorded');
  console.log(JSON.stringify({actors:result.actors.length,errors}));
 }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
