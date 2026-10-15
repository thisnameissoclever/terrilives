const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'C:/Users/myema/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const fs=require('node:fs');const path=require('node:path');
(async()=>{const browser=await chromium.launch({channel:'chrome',headless:true});try{
 const page=await browser.newPage({viewport:{width:1600,height:1100}});
 await page.goto('http://127.0.0.1:5187/proofs/character-appearance.html?baseline');await page.waitForFunction(()=>window.appearanceProof,null,{timeout:60000});
 const folder=path.resolve('docs/evidence/2026-10-12-character-appearance');fs.mkdirSync(folder,{recursive:true});
 await page.evaluate(()=>window.appearanceProof.set({...window.appearanceProof.value,presentation:'feminine',hairstyle:'bob',height:50,build:50}));
 for(let facing=0;facing<4;facing++){await page.locator('#facing').selectOption(String(facing*Math.PI/2));await page.locator('#preview').screenshot({path:path.join(folder,`bob-${facing}.png`)});}
 console.log(JSON.stringify(await page.evaluate(()=>window.appearanceProof.errors)));
}finally{await browser.close();}})().catch(e=>{console.error(e);process.exitCode=1;});
