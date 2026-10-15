const {chromium}=require('C:/Users/myema/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const fs=require('node:fs'),path=require('node:path');
(async()=>{const out=path.resolve(process.env.EVIDENCE_DIR||'docs/evidence/2026-10-12-full-character-creator/gpu');fs.mkdirSync(out,{recursive:true});const browser=await chromium.launch({channel:'chrome',headless:true});
 try{const page=await browser.newPage(),errors=[];page.on('pageerror',error=>errors.push(String(error)));
  await page.goto('http://127.0.0.1:5187/proofs/creator-assets.html');await page.waitForFunction(()=>window.creatorStudy||window.creatorStudyError,null,{timeout:60000});
  const report=await page.evaluate(async()=>{
   const {loadCreatorClip}=await import('/src/render/character/creator-assets.ts'),{selectGeometry}=await import('/src/render/character/variants.ts'),{CharacterRenderer}=await import('/src/render/character/renderer.ts');
   const {posedPositions}=await import('/src/render/character/geometry-proof.ts'),{anatomicalHeight}=await import('/src/render/character/shape.ts'),{defaultAppearance}=await import('/src/character/schema.ts');
   const adapter=await navigator.gpu.requestAdapter(),device=await adapter.requestDevice(),samples=[];let actor;
   device.addEventListener('uncapturederror',event=>{throw event.error;});
   try{for(const presentation of ['masculine','feminine'])for(const height of [0,50,100]){
    const appearance=defaultAppearance(presentation);appearance.body={height,build:100-height,shoulders:height,hips:100-height,torso:height};
    appearance.face.cheeks=height;appearance.face.jaw=100-height;const source=await loadCreatorClip('idle'),geometry=selectGeometry(source,appearance,{wear:'clothed',prop:'none',fixture:'none',clip:'idle'});
    actor=new CharacterRenderer(device,geometry,320,320);actor.setCharacterAppearance(appearance);actor.render('idle',0,0);
    const actual=await actor.surfacePositions(),expected=posedPositions(geometry,{presentation,...appearance.body,face:appearance.face},'idle',0,anatomicalHeight(geometry.vertices));
    let maxError=0;for(let i=0;i<actual.length;i++)maxError=Math.max(maxError,Math.abs(actual[i]-expected[i]));
    samples.push({presentation,height,maxError,vertices:actual.length/3});if(maxError>0.00002)throw Error('GPU appearance differs from configured surface: '+JSON.stringify(samples.at(-1)));
    actor.destroy();actor=null;
   }}finally{actor?.destroy();device.destroy();}
   return samples;
  });
  if(errors.length)throw Error(errors.join('\n'));fs.writeFileSync(path.join(out,'surface.json'),JSON.stringify({samples:report,errors},null,2));console.log(JSON.stringify(report));
 }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1});
