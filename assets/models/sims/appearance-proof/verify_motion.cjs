const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'C:/Users/myema/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const fs=require('node:fs');const path=require('node:path');const assert=require('node:assert/strict');
const output=path.resolve('docs/evidence/2026-10-12-character-appearance');fs.mkdirSync(output,{recursive:true});
(async()=>{const browser=await chromium.launch({channel:'chrome',headless:true});const result={errors:[]};try{
 result.sourceHashes=Object.fromEntries([...fs.readdirSync('web/src/render/character').filter(name=>/\.(ts|wgsl)$/.test(name)).map(name=>'web/src/render/character/'+name),'web/proofs/character-appearance.ts','web/src/render/sprites.ts','assets/models/sims/appearance-proof/export-v2/manifest.json'].map(file=>[file,require('node:crypto').createHash('sha256').update(fs.readFileSync(file)).digest('hex')]));
 const page=await browser.newPage({viewport:{width:1600,height:1100}});page.on('pageerror',e=>result.errors.push(String(e)));page.on('console',m=>{if(m.type()==='info'&&m.text().startsWith('Motion'))console.log(m.text());});
 await page.goto('http://127.0.0.1:5187/proofs/character-appearance.html?baseline');await page.waitForFunction(()=>window.appearanceProof,null,{timeout:60000});
 if(!process.argv.includes('--quick')) result.motion=await page.evaluate(async()=>{
  const proof=window.appearanceProof,base=proof.value,rows=[];
  const studies={walk:Array.from({length:16},(_,i)=>i/2),read:Array.from({length:8},(_,i)=>i/2),standing_read:[0],sit_down:[0,3,6,9,12,15,18,21,24],stand_up:[0,3,6,9,12,15,18,21,24]};
  for(const presentation of ['masculine','feminine'])for(const height of [0,50,100])for(const build of [0,50,100]){
   proof.set({...base,presentation,height,build,hairstyle:presentation==='feminine'?'bob':'curl'});let samples=0;
   for(let facing=0;facing<4;facing++)for(const [action,frames] of Object.entries(studies))for(const frame of frames){
    proof.seek(action,frame,facing*Math.PI/2);await proof.bounds();samples++;
   }
   proof.seek('sit_down',12);const surface=await proof.surfaceProof();
   rows.push({presentation,height,build,samples,surface});console.info(`Motion ${presentation} ${height}/${build}: ${samples} frames`);
  }
  return rows;
 });
 await page.locator('#baseline').click();
 result.seeking=await page.evaluate(()=>{const p=window.appearanceProof,rows=[];for(const action of ['idle','walk','read','sit_down','stand_up']){p.seek(action,.25);if(Math.abs(p.frame-.25)>1e-9)throw Error('Frame seeking differs for '+action);rows.push({action,frame:p.frame});}return rows;});
 result.picking=await page.evaluate(async()=>{
  const p=window.appearanceProof;p.seek('read',0);const rect=p.compositor.placementData;const points=[];
  for(let y=Math.ceil(rect[1]);y<rect[1]+rect[3];y+=5)for(let x=Math.ceil(rect[0]);x<rect[0]+rect[2];x+=5){const id=await p.worldPicker.pick(x,y);if(id)points.push({x,y,id});}
  const wall=document.querySelector('#wall');wall.checked=true;wall.dispatchEvent(new Event('change'));
  let hiddenActors=0,visibleActors=0,fixtures=0;
  for(const point of points){const id=await p.worldPicker.pick(point.x,point.y);if(point.id===1){if(id===0)hiddenActors++;else if(id===1)visibleActors++;else throw Error('Actor ownership changed');}else fixtures++;}
  wall.checked=false;wall.dispatchEvent(new Event('change'));
  if(!hiddenActors||!visibleActors||!fixtures)throw Error(`World picking did not cover occlusion/identity: ${hiddenActors}/${visibleActors}/${fixtures}`);
  return {testedPixels:points.length,hiddenActors,visibleActors,fixtures,personPosition:p.personPosition()};
 });
 result.cleanup=await page.evaluate(async()=>{
  const p=window.appearanceProof,device=p.gpu.device;
  const {CharacterRenderer}=await import('/src/render/character/renderer.ts');
  const {CharacterCompositor}=await import('/src/render/character/compositor.ts');
  const {CharacterWorldPicker}=await import('/src/render/character/world-picking.ts');
  const originalBuffer=device.createBuffer,originalTexture=device.createTexture,live=new Set();let created=0;
  const track=resource=>{created++;live.add(resource);const destroy=resource.destroy.bind(resource);resource.destroy=()=>{live.delete(resource);destroy();};return resource;};
  device.createBuffer=function(desc){return track(originalBuffer.call(this,desc));};device.createTexture=function(desc){return track(originalTexture.call(this,desc));};
  try{for(let i=0;i<8;i++){const renderer=new CharacterRenderer(device,p.geometry,128,168);renderer.setAppearance(p.value);renderer.render('read',i%4);const compositor=new CharacterCompositor(device,p.gpu.format,renderer);compositor.place([0,0,128,168],[960,640],[3,3],16);const picker=new CharacterWorldPicker(device,renderer,compositor,()=>p.scene.depthForPicking);await picker.pick(64,84);await device.queue.onSubmittedWorkDone();picker.destroy();compositor.destroy();renderer.destroy();if(live.size)throw Error(`Owned GPU resources remain: ${live.size}`);}return {cycles:8,created,remaining:live.size};}
  finally{device.createBuffer=originalBuffer;device.createTexture=originalTexture;for(const resource of live)resource.destroy();}
 });
 if(!process.argv.includes('--quick')) for(const presentation of ['masculine','feminine']){
  await page.evaluate(presentation=>{const p=window.appearanceProof;p.set({...p.value,presentation,hairstyle:presentation==='feminine'?'bob':'curl',height:50,build:50});},presentation);
  for(const action of ['walk','read','sit_down','stand_up']){
   const frames=action==='walk'?Array.from({length:16},(_,i)=>i/2):action==='read'?Array.from({length:16},(_,i)=>i/4):Array.from({length:25},(_,i)=>i);
   for(let i=0;i<frames.length;i++){await page.evaluate(({action,frame})=>window.appearanceProof.seek(action,frame),{action,frame:frames[i]});await page.locator('#preview').screenshot({path:path.join(output,`${presentation}-${action}-${String(i).padStart(2,'0')}.png`)});}
  }
 }
 result.gpuErrors=await page.evaluate(()=>window.appearanceProof.errors);assert.equal(result.gpuErrors.length,0);assert.equal(result.errors.length,0);
 fs.writeFileSync(path.join(output,process.argv.includes('--quick')?'motion-quick.json':'motion-browser.json'),JSON.stringify(result,null,2));console.log(JSON.stringify({samples:result.motion?.reduce((s,r)=>s+r.samples,0)??0,picking:result.picking,cleanup:result.cleanup}));
}catch(e){result.failure=String(e);fs.writeFileSync(path.join(output,'motion-failure.json'),JSON.stringify(result,null,2));throw e;}finally{await browser.close();}})().catch(e=>{console.error(e);process.exitCode=1;});
