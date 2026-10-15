const {chromium}=require('C:/Users/myema/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const fs=require('node:fs'),path=require('node:path');
(async()=>{const out=path.resolve('docs/evidence/2026-10-12-full-character-creator/motion');fs.mkdirSync(out,{recursive:true});const browser=await chromium.launch({channel:'chrome',headless:true}),errors=[];
 try{const context=await browser.newContext({viewport:{width:760,height:930}}),page=await context.newPage();page.on('pageerror',e=>errors.push(String(e)));
  await page.goto('http://127.0.0.1:5187/proofs/character-creator.html');await page.waitForFunction(()=>window.creatorHarness,null,{timeout:60000});
  await page.evaluate(async()=>{window.creatorHarness.close();document.body.style.cssText='margin:0;background:#17191f;color:white;font:18px system-ui';document.body.innerHTML='<h1 id="motion-label">Shared bicycle animation</h1><canvas id="large" width="608" height="800"></canvas><canvas id="small" width="96" height="128"></canvas>';
   const {CreatorPreview}=await import('/src/ui/character-creator/preview.ts'),adapter=await navigator.gpu.requestAdapter(),device=await adapter.requestDevice();
   window.motionStudy={device,preview:new CreatorPreview(device,navigator.gpu.getPreferredCanvasFormat(),document.querySelector('#large'),document.querySelector('#small'))};
  });
  const rows=[];
  for(const presentation of ['masculine','feminine'])for(let facing=0;facing<4;facing++){
   await page.evaluate(async({presentation,facing})=>{const {defaultAppearance}=await import('/src/character/schema.ts'),a=defaultAppearance(presentation);a.body={height:0,build:presentation==='masculine'?100:0,shoulders:presentation==='masculine'?100:0,hips:0,torso:100};window.motionStudy.appearance=a;document.querySelector('#motion-label').textContent=`${presentation}, height 0, build ${a.body.build}, facing ${facing+1}`;await window.motionStudy.preview.draw(a,facing*Math.PI/2,'exercise',0);},{presentation,facing});
   for(let step=0;step<32;step++){await page.evaluate(async({step,facing})=>{const m=window.motionStudy;await m.preview.draw(m.appearance,facing*Math.PI/2,'exercise',step/4);},{step,facing});if(step%8===0)await page.locator('#large').screenshot({path:path.join(out,`${presentation}-${facing}-${step}.png`)});await page.waitForTimeout(60);}
   rows.push({presentation,facing,frames:32,step:.25});
  }
  await page.evaluate(()=>{window.motionStudy.preview.destroy();window.motionStudy.device.destroy();});await context.close();
  fs.writeFileSync(path.join(out,'report.json'),JSON.stringify({rows,errors,sharedAnimation:'exercise',expectedFrames:256},null,2));if(errors.length)throw Error(errors.join('\n'));console.log(JSON.stringify({cycles:rows.length,frames:256,errors}));
 }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1});
