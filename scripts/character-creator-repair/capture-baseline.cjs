const {chromium}=require('C:/Users/myema/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const fs=require('node:fs'),path=require('node:path');
(async()=>{
 const out=path.resolve('docs/evidence/2026-10-13-creator-repair/before');fs.mkdirSync(out,{recursive:true});
 const browser=await chromium.launch({channel:'chrome',headless:true}),records=[];
 try{
  for(const [version,url] of [['candidate','http://127.0.0.1:5188/'],['published','https://thisnameissoclever.github.io/terrilives/']]){
   const context=await browser.newContext({viewport:{width:1600,height:1100}});
   try{const page=await context.newPage();page.on('pageerror',e=>console.log(version,String(e)));await page.goto(url+'?stress=0');await page.waitForFunction(()=>window.__terriStress,null,{timeout:120000}).catch(async error=>{await page.screenshot({path:path.join(out,version+'-startup-failure.png')});fs.writeFileSync(path.join(out,version+'-startup-failure.txt'),await page.locator('body').innerText());throw error;});
    if(await page.locator('#help-panel').evaluate(el=>el.open))await page.locator('#close-help').click();
    await page.getByText('Pause',{exact:true}).click();
    await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
    const initial=await page.evaluate(()=>Array.from(window.__terriStress.sim.saveBytes()));
    for(const model of ['toilet','reading_chair','bookshelf']){
     const setup=await page.evaluate(async ({model,initial})=>{const s=window.__terriStress.sim;if(!(await (globalThis.__terriStress.characters?.loadBytes ? globalThis.__terriStress.characters.loadBytes(Uint8Array.from(initial)) : s.loadBytes(Uint8Array.from(initial)))))throw Error('Baseline load failed');
      const ids=Array.from(s.ids()),fixture=ids.find(id=>s.objectModel(id)?.id===model),person=ids.find((id,i)=>s.kinds()[i]===0);
      if(fixture===undefined||person===undefined)throw Error('Missing baseline entity '+model);
      return{fixture,person,labels:s.interactionLabels(ids.indexOf(fixture)),positions:Array.from(s.positions()),tick:s.tickCount};},{model,initial});
     await page.screenshot({path:path.join(out,`${version}-${model}-unused.png`)});
     const result=await page.evaluate(({fixture,person})=>{const s=window.__terriStress.sim;if(!s.useObject(person,fixture,0))throw Error('Order refused');s.flushCommands();
      let tick=0;for(;tick<400;tick++){s.tick();const row=Array.from(s.ids()).indexOf(person);if(s.visualActions()[row]!==0&&s.visualActions()[row]!==5)break;}
      const row=Array.from(s.ids()).indexOf(person);return{steps:tick,action:s.visualActions()[row],activity:s.activities()[row]};},setup);
     await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
     await page.screenshot({path:path.join(out,`${version}-${model}-active.png`)});records.push({version,model,setup,result});
    }
   }finally{await context.close();}
  }
 }finally{await browser.close();fs.writeFileSync(path.join(out,'capture.json'),JSON.stringify(records,null,2));}
 console.log(JSON.stringify({captured:records.length}));
})().catch(error=>{console.error(error);process.exitCode=1;});
