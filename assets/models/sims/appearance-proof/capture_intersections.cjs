const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'C:/Users/myema/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const output=path.resolve('docs/evidence/2026-10-12-character-appearance/intersections');
(async()=>{
 fs.mkdirSync(output,{recursive:true});
 const browser=await chromium.launch({channel:'chrome',headless:true});
 try{
  const page=await browser.newPage({viewport:{width:1600,height:1100}});
  await page.goto('http://127.0.0.1:5187/proofs/character-appearance.html?baseline');
  await page.waitForFunction(()=>window.appearanceProof,null,{timeout:60000});
  const rows=JSON.parse(fs.readFileSync(path.join(output,'sections.json'),'utf8')).sections;
  for(const row of rows){
   await page.evaluate(value=>window.appearanceProof.set(value),row.case.appearance);
   for(let facing=0;facing<4;facing++){
    await page.evaluate(({frame,facing})=>window.appearanceProof.seek('read',frame,facing*Math.PI/2),{frame:row.case.frame,facing});
    await page.locator('#preview').screenshot({path:path.join(output,`${row.label}-${facing}.png`)});
   }
  }
  assert.deepEqual(await page.evaluate(()=>window.appearanceProof.errors),[]);
  fs.writeFileSync(path.join(output,'capture.json'),JSON.stringify({browser:browser.version(),frame:0,facings:4,cases:3,errors:[]},null,2));
 }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
