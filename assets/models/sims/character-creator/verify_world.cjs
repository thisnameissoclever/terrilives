const {chromium}=require('C:/Users/myema/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const fs=require('node:fs'),path=require('node:path');
(async()=>{const out=path.resolve('docs/evidence/2026-10-12-full-character-creator/world');fs.mkdirSync(out,{recursive:true});
 const browser=await chromium.launch({channel:'chrome',headless:true}),errors=[];
 try{const page=await browser.newPage({viewport:{width:1440,height:1100}});page.on('pageerror',e=>errors.push(String(e)));
  await page.goto('http://127.0.0.1:5187/?stress=0');await page.waitForFunction(()=>window.__terriStress,null,{timeout:120000});
  if(await page.locator('#help-panel').evaluate(el=>el.open))await page.locator('#close-help').click();await page.getByText('Pause',{exact:true}).click();
  await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
  const initial=await page.evaluate(()=>window.__terriStress.characters.snapshot());
  await page.evaluate(async()=>{const sim=window.__terriStress.sim,{defaultAppearance}=await import('/src/character/schema.ts');
    const a=defaultAppearance('feminine');a.body={height:0,build:100,shoulders:100,hips:0,torso:100};a.colors.shirt=[163,77,105];
    if(!(await window.__terriStress.characters.edit(9001, 0, {version:1,appearance:a})))throw Error('Appearance edit was not queued.');});
  await page.waitForFunction(()=>window.__terriStress.characters.snapshot().actors.some(a=>a.sim===0&&a.appearance.presentation==='feminine'));
  const configured=await page.evaluate(()=>window.__terriStress.characters.snapshot());
  await page.screenshot({path:path.join(out,'configured-game.png')});
  const picks=await page.evaluate(async()=>{const h=window.__terriStress,{actors,view}=h.characters.snapshot(),results=[];
    for(const actor of actors){const [wx,wy,z]=actor.head,x=(wx-wy)*32*view.scale+view.originX,y=(wx+wy)*21*view.scale+view.originY-z*Math.sqrt(1166)*view.scale;
      let found=null;for(const dy of [10,16,22,28]){for(const dx of [0,-5,5]){const px=Math.floor(x+dx*view.scale),py=Math.floor(y+dy*view.scale);const hit=await h.characters.pick(px,py);if(hit?.kind==='person'&&hit.sim===actor.sim){found={x:px,y:py,hit};break;}}if(found)break;}
      results.push({sim:actor.sim,found});}
    return results;});
  const before=await page.evaluate(()=>window.__terriStress.sim.characterSnapshot(0));
  await page.evaluate(()=>{window.dispatchEvent(new PageTransitionEvent('pagehide',{persisted:true}));window.dispatchEvent(new PageTransitionEvent('pageshow',{persisted:true}));});
  await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
  const resumed=await page.evaluate(()=>({snapshot:window.__terriStress.sim.characterSnapshot(0),scene:window.__terriStress.characters.snapshot()}));
  if(JSON.stringify(before)!==JSON.stringify(resumed.snapshot))throw Error('History restoration changed the person.');
  const report={initial,configured,picks,historyPreserved:true,errors};fs.writeFileSync(path.join(out,'report.json'),JSON.stringify(report,null,2));
  console.log(JSON.stringify({actors:configured.actors.length,picks,historyPreserved:true,errors}));if(errors.length)process.exitCode=1;
 }finally{await browser.close();}})().catch(e=>{console.error(e);process.exitCode=1;});
