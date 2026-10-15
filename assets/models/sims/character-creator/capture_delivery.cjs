const {chromium}=require('C:/Users/myema/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const fs=require('node:fs'),path=require('node:path');
(async()=>{const out=path.resolve('docs/evidence/2026-10-12-full-character-creator/delivery');fs.mkdirSync(out,{recursive:true});const browser=await chromium.launch({channel:'chrome',headless:true}),errors=[];
 try{const page=await browser.newPage({viewport:{width:1440,height:1100}});page.on('pageerror',error=>errors.push(String(error)));
  await page.goto('http://127.0.0.1:5187/?stress=0');await page.waitForFunction(()=>window.__terriStress,null,{timeout:120000});if(await page.locator('#help-panel').evaluate(el=>el.open))await page.locator('#close-help').click();await page.getByText('Pause',{exact:true}).click();await page.locator('#options-toggle').click();await page.locator('#new-housemate').click();
  await page.locator('[data-field="appearance.presentation"] select').selectOption({label:'Feminine'});await page.getByRole('button',{name:'Reset appearance to preset',exact:true}).click();
  for(const [label,value] of [['Height value','75'],['Build value','35']]){await page.getByLabel(label,{exact:true}).fill(value);await page.getByLabel(label,{exact:true}).press('Tab');}
  await page.getByRole('button',{name:'Identity',exact:true}).click();await page.getByLabel('Name',{exact:true}).fill('Mira');await page.getByLabel('Name',{exact:true}).press('Tab');await page.getByRole('button',{name:'Appearance',exact:true}).click();await page.waitForFunction(()=>document.querySelector('.creator-status').textContent==='');
  await page.screenshot({path:path.join(out,'creator.png')});
  await page.evaluate(async()=>{const rendererUrl=performance.getEntriesByType('resource').map(entry=>entry.name).find(url=>new URL(url).pathname==='/src/render/character/renderer.ts');if(!rendererUrl)throw Error('Application renderer module was not observed');const {CharacterRenderer}=await import(rendererUrl),original=CharacterRenderer.prototype.render;window.previewDraws=[];window.restorePreviewProbe=()=>{CharacterRenderer.prototype.render=original;};CharacterRenderer.prototype.render=function(...args){const result=original.apply(this,args);window.previewDraws.push({width:this.width,height:this.height,facing:args[2],uniformFacing:this.data[4]});return result;};});
  const facingProof=[];
  for(let facing=0;facing<4;facing++){
    await page.evaluate(()=>{window.previewDraws=[];});
    await page.getByRole('button',{name:facing?'Turn':'Next frame',exact:true}).click();
    await page.waitForFunction(()=>window.previewDraws.filter(row=>(row.width===608&&row.height===800)||(row.width===96&&row.height===128)).length>=2);
    await page.waitForFunction(()=>document.querySelector('.creator-status').textContent==='');
    await page.locator('.creator-portrait').screenshot({path:path.join(out,`feminine-${facing}.png`)});
    const raw=await page.evaluate(()=>window.previewDraws),rows=raw.filter(row=>(row.width===608&&row.height===800)||(row.width===96&&row.height===128));
    facingProof.push({facing,expectedAngle:facing*Math.PI/2,rows,raw});
    fs.writeFileSync(path.join(out,'facing-sync.json'),JSON.stringify(facingProof,null,2));
    if(rows.length!==2||rows[0].width!==608||rows[1].width!==96||rows.some(row=>row.facing!==facing*Math.PI/2||row.uniformFacing!==Math.fround(facing*Math.PI/2)))throw Error(`Incorrect observed preview pair for facing ${facing}`);
  }
  if(facingProof.length!==4)throw Error('Missing four-facing observations');
  await page.evaluate(()=>window.restorePreviewProbe());
  await page.getByRole('button',{name:'Personality',exact:true}).click();await page.waitForFunction(()=>document.querySelector('.creator-status').textContent==='');await page.screenshot({path:path.join(out,'personality.png')});
  await page.locator('.creator-world-sample canvas').evaluate(el=>{el.style.cssText='width:384px;height:512px;image-rendering:pixelated;position:fixed;left:10px;top:10px;z-index:99';});await page.locator('.creator-world-sample canvas').screenshot({path:path.join(out,'game-size-back-right-detail.png')});
  await page.getByRole('button',{name:'Cancel',exact:true}).click();if(errors.length)throw Error(errors.join('\n'));
  fs.writeFileSync(path.join(out,'report.json'),JSON.stringify({source:'Actual main-game creator UI',appearance:{presentation:'feminine',height:75,build:35,shoulders:50,hips:50,torso:50,hairstyle:'bob'},facings:4,errors},null,2));
 }finally{await browser.close();}console.log(JSON.stringify({facings:4,errors}));
})().catch(error=>{console.error(error);process.exitCode=1});
