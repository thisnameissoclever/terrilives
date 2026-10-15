const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'C:/Users/myema/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const fs=require('node:fs');const path=require('node:path');
(async()=>{
 const directory=path.resolve('docs/evidence/2026-10-12-full-character-creator/clip-candidates');fs.mkdirSync(directory,{recursive:true});
 const library=JSON.parse(fs.readFileSync('assets/models/sims/character-creator/clips/clips.json','utf8'));
 const browser=await chromium.launch({channel:'chrome',headless:true}),rows=[],errors=[];
 try{
  const page=await browser.newPage({viewport:{width:1440,height:1100}});page.on('pageerror',error=>errors.push(String(error)));
  await page.goto('http://127.0.0.1:5187/proofs/character-creator.html');await page.waitForFunction(()=>window.creatorHarness||window.creatorHarnessError);
  const startup=await page.evaluate(()=>window.creatorHarnessError);if(startup)throw new Error(startup);
  for(const action of Object.keys(library.clips))for(let facing=0;facing<4;facing++){
   try{
    await page.evaluate(async({action,facing})=>window.creatorHarness.drawClip(window.creatorHarness.defaultAppearance('feminine'),action,.5,facing*Math.PI/2),{action,facing});
    await page.locator('#creator>canvas').first().screenshot({path:path.join(directory,`${action}-${facing}.png`)});rows.push({action,facing,pass:true});
   }catch(error){rows.push({action,facing,pass:false,error:String(error)});}
  }
  errors.push(...await page.evaluate(()=>window.creatorHarness.errors));
 }finally{await browser.close();fs.writeFileSync(path.join(directory,'report.json'),JSON.stringify({rows,errors},null,2));}
 console.log(JSON.stringify({captured:rows.filter(row=>row.pass).length,failures:rows.filter(row=>!row.pass),errors}));
 if(errors.length||rows.some(row=>!row.pass))process.exitCode=1;
})().catch(error=>{console.error(error);process.exitCode=1;});
