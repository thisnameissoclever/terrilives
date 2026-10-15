const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'C:/Users/myema/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const fs=require('node:fs'),assert=require('node:assert/strict');
const output='docs/evidence/2026-10-12-character-appearance/accepted-followthrough/simulation';fs.mkdirSync(output,{recursive:true});
(async()=>{const browser=await chromium.launch({channel:'chrome',headless:true});const result={cases:[],errors:[]};try{
 const page=await browser.newPage({viewport:{width:1600,height:1100}});page.on('pageerror',e=>result.errors.push(String(e)));
 await page.goto('http://127.0.0.1:5187/proofs/character-appearance.html?baseline');await page.waitForFunction(()=>window.appearanceProof,null,{timeout:60000});
 const primary=await page.evaluate(()=>window.appearanceProof.simulation.worldHash().toString());
 for(const presentation of ['masculine','feminine'])for(const mode of ['walk','read'])for(let facing=0;facing<4;facing++){
  await page.evaluate(({presentation,mode,facing})=>{const p=window.appearanceProof;p.set({...p.value,presentation,hairstyle:presentation==='feminine'?'bob':'curl',height:50,build:50});p.startSimulationStudy(mode,facing*Math.PI/2);},{presentation,mode,facing});
  const initial=await page.evaluate(()=>{const p=window.appearanceProof;return {sample:p.motionStudy.sample(),hash:p.motionStudy.sim.worldHash().toString()};});
  assert.equal(initial.sample.facing,[3,1,4,2][facing]);
  await page.locator('#randomize').click();await page.locator('#undo').click();
  const paused=await page.evaluate(async()=>{const p=window.appearanceProof;await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));return {sample:p.motionStudy.sample(),hash:p.motionStudy.sim.worldHash().toString(),primary:p.simulation.worldHash().toString()};});
  assert.deepEqual(paused.sample,initial.sample);assert.equal(paused.hash,initial.hash);assert.equal(paused.primary,primary);
  if(mode==='read') {
   const position=await page.evaluate(()=>window.appearanceProof.personPosition());
   assert.ok(Math.hypot(position[0]-initial.sample.x,position[1]-initial.sample.y)>.02,'Displayed person position must include the posed hip offset');
  }
  const row={presentation,mode,facing,initial:initial.sample,frames:[]};
  for(let i=0;i<96;i++){
   const sample=await page.evaluate(()=>{const p=window.appearanceProof;p.motionStudy.play(true);p.advanceSimulation(50);p.motionStudy.play(false);return p.motionStudy.sample();});
   if(sample.action!==mode)break;
   if(mode==='read')assert.equal(sample.facing,[3,1,4,2][facing]);
   else assert.ok([1,2,3,4].includes(sample.facing),'Walking must retain a real simulation facing at path corners');
   await page.evaluate(()=>window.appearanceProof.bounds());row.frames.push(sample);
   if(mode==='read')assert.deepEqual([sample.x,sample.y],[initial.sample.x,initial.sample.y]);
   if(i%(mode==='read'?12:2)===0)await page.locator('#preview').screenshot({path:`${output}/${presentation}-${mode}-${facing}-${String(i).padStart(2,'0')}.png`});
  }
  assert.ok(row.frames.length>=4,`Missing ${mode} motion`);
  if(mode==='read')assert.equal(new Set(row.frames.map(frame=>Math.floor(frame.frame))).size,4,'Reading must cover the complete animation');
  else assert.ok(row.frames.some(frame=>frame.x!==initial.sample.x||frame.y!==initial.sample.y),'Walking must use actual movement');
  row.surface=await page.evaluate(()=>window.appearanceProof.surfaceProof());
  await page.locator('#world').screenshot({path:`${output}/${presentation}-${mode}-${facing}-world.png`});
  result.cases.push(row);console.log(`Verified real simulation ${presentation} ${mode} facing ${facing+1}`);
 }
 assert.equal(result.cases.length,16);
 await page.evaluate(()=>window.appearanceProof.startSimulationStudy('read',0));
 const before=await page.locator('#world').screenshot();
 result.benchmarkCamera=await page.evaluate(async()=>{
  const p=window.appearanceProof,{CharacterCompositor}=await import('/src/render/character/compositor.ts');
  const place=CharacterCompositor.prototype.place,rectangles=new Map();
  CharacterCompositor.prototype.place=function(rect,...args){if(this!==p.compositor)rectangles.set(this,[...rect]);return place.call(this,rect,...args);};
  try {
   await p.benchmark(1000);
   const rows=[...rectangles.values()];
   if(rows.length!==6||rows.some(([x,y,w,h])=>x+w<=0||x>=960||y+h<=0||y>=640))throw Error('Benchmark characters are outside the viewport');
   return {rectangles:rows,visible:rows.length};
  }finally{CharacterCompositor.prototype.place=place;}
 });
 assert.deepEqual(await page.locator('#world').screenshot(),before,'Benchmark must restore the simulation camera and character');
 result.gpuErrors=await page.evaluate(()=>window.appearanceProof.errors);
 assert.deepEqual(result.errors,[]);assert.deepEqual(result.gpuErrors,[]);
 fs.writeFileSync(output+'/result.json',JSON.stringify(result,null,2));
}finally{await browser.close();}})().catch(error=>{fs.writeFileSync(output+'/failure.json',JSON.stringify({error:String(error)},null,2));console.error(error);process.exitCode=1;});
