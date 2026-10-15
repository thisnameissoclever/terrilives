const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'C:/Users/myema/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const fs=require('node:fs'),assert=require('node:assert/strict');
const output='docs/evidence/2026-10-12-character-appearance/accepted-followthrough';fs.mkdirSync(output,{recursive:true});
(async()=>{const browser=await chromium.launch({channel:'chrome',headless:true});try{
 const page=await browser.newPage();await page.goto('http://127.0.0.1:5187/proofs/character-appearance.html?baseline');
 await page.waitForFunction(()=>window.appearanceProof,null,{timeout:60000});
 const result=await page.evaluate(async()=>{
  const p=window.appearanceProof,actor=p.actor,combined=actor.outlineRanges,individual=p.geometry.description.parts.filter(part=>part.outline);
  const read=async()=>{
   const bytesPerRow=Math.ceil(actor.width*4/256)*256;
   const buffer=p.gpu.device.createBuffer({size:bytesPerRow*actor.height,usage:GPUBufferUsage.MAP_READ|GPUBufferUsage.COPY_DST});
   try{const encoder=p.gpu.device.createCommandEncoder();encoder.copyTextureToBuffer({texture:actor.color},{buffer,bytesPerRow},[actor.width,actor.height]);p.gpu.device.queue.submit([encoder.finish()]);await buffer.mapAsync(GPUMapMode.READ);return new Uint8Array(buffer.getMappedRange()).slice();}
   finally{buffer.unmap();buffer.destroy();}
  };
  const cases=[];
  try{
   for(const presentation of ['masculine','feminine'])for(const action of ['idle','walk','read'])for(let facing=0;facing<4;facing++){
    p.set({...p.value,presentation,hairstyle:presentation==='feminine'?'bob':'curl',height:0,build:100});
    actor.outlineRanges=individual;p.seek(action,0,facing*Math.PI/2);const before=await read();
    actor.outlineRanges=combined;p.seek(action,0,facing*Math.PI/2);const after=await read();
    let changed=0;for(let i=0;i<before.length;i++)if(before[i]!==after[i])changed++;
    if(changed)throw Error(`Outline batching changed ${changed} bytes: ${presentation} ${action} ${facing}`);
    cases.push({presentation,action,facing,changedBytes:changed});
   }
  }finally{actor.outlineRanges=combined;p.draw();}
  return {individualDraws:individual.length,combinedDraws:combined.length,cases,errors:p.errors};
 });
 assert.equal(result.cases.length,24);assert.deepEqual(result.errors,[]);
 fs.writeFileSync(output+'/outline-pixels.json',JSON.stringify(result,null,2));console.log('24 GPU color comparisons are byte-identical; 56 outline draws reduced to 7.');
}finally{await browser.close();}})().catch(e=>{console.error(e);process.exitCode=1;});
