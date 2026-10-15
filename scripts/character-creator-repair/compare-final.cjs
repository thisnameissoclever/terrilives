const {chromium}=require('C:/Users/myema/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const out=path.resolve('docs/evidence/2026-10-13-creator-repair/comparison');fs.mkdirSync(out,{recursive:true});
(async()=>{
 const browser=await chromium.launch({channel:'chrome',headless:true,args:['--mute-audio']}),records=[],errors=[];
 try{
  for(const [version,url] of [['published','https://thisnameissoclever.github.io/terrilives/'],['before','http://127.0.0.1:5188/'],['repaired','http://127.0.0.1:5187/']]){
   const context=await browser.newContext({viewport:{width:1600,height:1100}});
   try{const page=await context.newPage();page.on('pageerror',e=>errors.push({version,message:e.message}));
    page.on('console',m=>{if(['warning','error'].includes(m.type())&&!m.location().url.endsWith('/favicon.ico'))errors.push({version,message:m.text()});});
    await page.goto(url+'?stress=0',{waitUntil:'domcontentloaded'});
    await page.waitForFunction(()=>window.__terriStress,null,{timeout:120000});
    if(await page.locator('#help-panel').evaluate(e=>e.open))await page.locator('#close-help').click();
    await page.getByText('Pause',{exact:true}).click();
    const frame=()=>page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));await frame();
    await page.locator('#options-toggle').click();if(!(await page.locator('#lighting-mode').innerText()).includes('flat'))await page.locator('#lighting-mode').click();await page.locator('#options-toggle').click();await frame();
    const initial=await page.evaluate(()=>Array.from(__terriStress.sim.saveBytes()));
    // Both inspected source revisions initialize scale to1; use the same actual wheel gesture.
    await page.mouse.move(800,550);await page.mouse.wheel(0,-Math.log(2)/.0012);await frame();
    for(const model of ['toilet','reading_chair','bookshelf','stove']){
     const setup=await page.evaluate(async ({initial,model})=>{const h=__terriStress,s=h.sim;if(!(await (globalThis.__terriStress.characters?.loadBytes ? globalThis.__terriStress.characters.loadBytes(Uint8Array.from(initial)) : s.loadBytes(Uint8Array.from(initial)))))throw Error('Baseline load refused');const ids=Array.from(s.ids()),fixture=ids.find(id=>s.objectModel(id)?.id===model),person=ids.find((id,i)=>s.kinds()[i]===0);if(fixture===undefined||person===undefined)throw Error('Missing baseline entity');const i=ids.indexOf(fixture);return{fixture,person,x:s.positions()[i*2],y:s.positions()[i*2+1],origin:{...h.origin},facing:s.objectFacing(fixture)};},{initial,model});
     await frame();const origin=await page.evaluate(()=>({...__terriStress.origin}));
     const target={x:800-(setup.x-setup.y)*64,y:620-(setup.x+setup.y)*42};
     await page.mouse.move(800,400);await page.mouse.down({button:'middle'});await page.mouse.move(800+target.x-origin.x,400+target.y-origin.y);await page.mouse.up({button:'middle'});await frame();
     const actual=await page.evaluate(()=>({...__terriStress.origin}));assert(Math.abs(actual.x-target.x)<.01&&Math.abs(actual.y-target.y)<.01,'Camera registration');
     const crop={x:450,y:260,width:700,height:640};
     await page.screenshot({path:path.join(out,`${version}-${model}-unused.png`),clip:crop});
     const row={version,url,model,setup,camera:{scale:2,origin:actual,viewport:[1600,1100],crop},light:'flat'};
     if(model!=='stove'){
      row.active=await page.evaluate(({fixture,person,model})=>{const s=__terriStress.sim;if(!s.useObject(person,fixture,0))throw Error('Order rejected');s.flushCommands();for(let tick=0;tick<400;tick++){s.tick();const i=Array.from(s.ids()).indexOf(person);const active=model==='toilet'?s.visualActions()[i]===18&&s.interactionTargets()[i]===fixture:model==='reading_chair'?s.visualActions()[i]===3&&s.readingSeats()[i]===fixture:s.readingStages()[i]===6&&s.readingHomeShelves()[i]===fixture;if(active)return{tick,action:s.visualActions()[i],activity:s.activities()[i],target:fixture};}throw Error('Requested interaction never became active');},{...setup,model});
      await frame();await page.screenshot({path:path.join(out,`${version}-${model}-active.png`),clip:crop});
     }
     records.push(row);fs.writeFileSync(path.join(out,'receipt.json'),JSON.stringify({records,errors},null,2));
    }
   }finally{await context.close();}
  }
  assert.equal(records.length,12);assert.deepEqual(errors,[]);console.log(JSON.stringify({cases:records.length,errors}));
 }finally{await browser.close();fs.writeFileSync(path.join(out,'receipt.json'),JSON.stringify({records,errors},null,2));}
})().catch(error=>{console.error(error);process.exitCode=1;});
