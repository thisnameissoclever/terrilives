const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'C:/Users/myema/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const fs=require('node:fs');const path=require('node:path');
async function run(){
 const browser=await chromium.launch({channel:'chrome',headless:true});
 const directory=path.resolve('docs/evidence/2026-10-12-character-appearance');const errors=[];
 try{
  const page=await browser.newPage({viewport:{width:1600,height:1100}});page.on('pageerror',e=>errors.push(String(e)));
  for(const quality of ['original','runtime']){
   await page.goto('http://127.0.0.1:5187/proofs/character-appearance.html?baseline'+(quality==='original'?'&original':''));
   await page.waitForFunction(()=>window.appearanceProof,null,{timeout:60000});
   for(let facing=0;facing<4;facing++){
    await page.locator('#facing').selectOption(String(facing*Math.PI/2));
    await page.locator('#preview').screenshot({path:path.join(directory,`source-${quality}-${facing}.png`)});
   }
   errors.push(...await page.evaluate(()=>window.appearanceProof.errors));
  }
  fs.writeFileSync(path.join(directory,'baseline-captures.json'),JSON.stringify({errors},null,2));
  if(errors.length)throw new Error(errors.join('\n'));
 }finally{await browser.close();}
}
run().catch(e=>{console.error(e);process.exitCode=1;});
