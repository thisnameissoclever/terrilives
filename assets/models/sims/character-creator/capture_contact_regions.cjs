const {chromium}=require('C:/Users/myema/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const fs=require('node:fs'),path=require('node:path');
(async()=>{
 const out=path.resolve('docs/evidence/2026-10-12-full-character-creator/contact-regions');fs.mkdirSync(out,{recursive:true});
 const browser=await chromium.launch({channel:'chrome',headless:true}),rows=[],errors=[];
 try{
  const page=await browser.newPage({viewport:{width:1440,height:1100}});page.on('pageerror',e=>errors.push(String(e)));
  await page.goto('http://127.0.0.1:5187/proofs/character-creator.html');await page.waitForFunction(()=>window.creatorHarness||window.creatorHarnessError);
  const cases=[['bath','masculine',{height:0,build:100,shoulders:100,hips:0,torso:100},0],['bath','feminine',null,0],['seated_eat','feminine',null,4],['exercise','masculine',{height:0,build:100,shoulders:100,hips:0,torso:100},0],['exercise','feminine',{height:0,build:0,shoulders:0,hips:0,torso:100},4],['wipe_counter','masculine',{height:0,build:0,shoulders:100,hips:0,torso:0},4]];
  for(let c=0;c<cases.length;c++)for(let facing=0;facing<4;facing++){
   const [action,presentation,body,frame]=cases[c];
   await page.evaluate(async({action,presentation,body,frame,facing})=>{const a=window.creatorHarness.defaultAppearance(presentation);if(body)a.body=body;await window.creatorHarness.drawClip(a,action,frame,facing*Math.PI/2);},{action,presentation,body,frame,facing});
   const file=`${c}-${action}-${facing}.png`;await page.locator('#creator>canvas').first().screenshot({path:path.join(out,file)});rows.push({file,action,presentation,body,frame,facing});
  }
 }finally{await browser.close();fs.writeFileSync(path.join(out,'report.json'),JSON.stringify({rows,errors},null,2));}
 console.log(JSON.stringify({captured:rows.length,errors}));if(errors.length)process.exitCode=1;
})().catch(e=>{console.error(e);process.exitCode=1;});
