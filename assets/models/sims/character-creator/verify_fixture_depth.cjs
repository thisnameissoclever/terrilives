const {chromium}=require('C:/Users/myema/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
(async()=>{const out=path.resolve(process.env.EVIDENCE_DIR||'docs/evidence/2026-10-12-full-character-creator/fixture-depth-check');fs.mkdirSync(out,{recursive:true});const browser=await chromium.launch({channel:'chrome',headless:true}),rows=[],errors=[];
 try{const page=await browser.newPage({viewport:{width:1440,height:1050}});page.on('pageerror',e=>errors.push(String(e)));
  await page.goto('http://127.0.0.1:5187/src/wasm/terri_wasm.js');const initial=Array.from(fs.readFileSync('docs/evidence/2026-10-12-full-character-creator/fixtures/static-depth/counter-0.sav'));
  await page.evaluate(async bytes=>{const root=await navigator.storage.getDirectory(),file=await root.getFileHandle('terri-save-1.bin',{create:true}),writer=await file.createWritable();await writer.write(Uint8Array.from(bytes));await writer.close();},initial);
  await page.goto('http://127.0.0.1:5187/?stress=0');await page.waitForFunction(()=>window.__terriStress,null,{timeout:120000});if(await page.locator('#help-panel').evaluate(el=>el.open))await page.locator('#close-help').click();await page.getByText('Pause',{exact:true}).click();
  await page.evaluate(async root=>{const prefix='/@fs/'+root.replaceAll('\\','/')+'/assets/models/sims/character-creator/fixture-depth/';window.fixtureDepthStudy={manifest:await(await fetch(prefix+'manifest.json')).json(),bytes:new Uint8Array(await(await fetch(prefix+'surface-depth.rgba')).arrayBuffer()),images:new Map()};},process.cwd());
  for(const model of ['counter','kitchen_sink','stove','dining_table'])for(let facing=0;facing<4;facing++){
   const bytes=Array.from(fs.readFileSync(`docs/evidence/2026-10-12-full-character-creator/fixtures/static-depth/${model}-${facing}.sav`));assert(await page.evaluate(async bytes=>(await window.__terriStress.characters.loadBytes(Uint8Array.from(bytes))),bytes));
   for(const wheel of [-77,-111,188]){
    const anchor=await page.evaluate(()=>{const h=window.__terriStress,v=h.characters.snapshot().view,p=h.sim.positions();return {x:(p[0]-p[1])*32*v.scale+v.originX,y:(p[0]+p[1])*21*v.scale+v.originY-25*v.scale};});await page.mouse.move(anchor.x,anchor.y);await page.mouse.wheel(0,wheel);await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
    const result=await page.evaluate(async()=>{
     const h=window.__terriStress,s=h.sim,v=h.characters.snapshot().view,study=window.fixtureDepthStudy;
     const {SPRITES,ATLAS_PAGE_FILES}=await import('/src/render/atlas.ts'),{spriteDrawOffsetX,spriteDrawOffsetY}=await import('/src/render/sprite-anchors.ts'),{layeredDepth,LAYER_PROP,FLOOR_DEPTH}=await import('/src/render/iso.ts');
     const spriteId=s.sprites()[0],sprite=SPRITES[spriteId],depth=study.manifest.sprites.find(row=>row.sprite===spriteId);if(!depth)throw Error('Missing registered fixture');
     let pixels=study.images.get(spriteId);if(!pixels){const image=await createImageBitmap(await(await fetch('/'+ATLAS_PAGE_FILES[sprite.page??0])).blob());const canvas=new OffscreenCanvas(sprite.w,sprite.h),ctx=canvas.getContext('2d');ctx.drawImage(image,sprite.x,sprite.y,sprite.w,sprite.h,0,0,sprite.w,sprite.h);pixels=ctx.getImageData(0,0,sprite.w,sprite.h).data;image.close();study.images.set(spriteId,pixels);}
     const p=s.positions(),density=sprite.pixel_density??1,w=sprite.w/density,ht=sprite.h/density,left=(p[0]-p[1])*32*v.scale+v.originX+(spriteDrawOffsetX(spriteId)-w/2)*v.scale,top=(p[0]+p[1])*21*v.scale+v.originY+(spriteDrawOffsetY(spriteId)+21-ht)*v.scale;
     const points=[],expected=[],seen=new Set();let edges=0,interiors=0,transparent=0,ambiguousOwnerSamples=0;const ownerErrorBound=8*2**-23*Math.max(v.width,v.height)*density/v.scale;
     const alpha=(x,y)=>x<0||y<0||x>=sprite.w||y>=sprite.h?0:pixels[(y*sprite.w+x)*4+3];
     const base=layeredDepth(p[0],p[1],s.lotWidth(),LAYER_PROP),step=base-layeredDepth(p[0]+1,p[1],s.lotWidth(),LAYER_PROP);
     for(let sy=1;sy<sprite.h-1;sy+=2)for(let sx=1;sx<sprite.w-1;sx+=2){const opaque=alpha(sx,sy)>=128,edge=[[-1,0],[1,0],[0,-1],[0,1]].some(([dx,dy])=>(alpha(sx+dx,sy+dy)>=128)!==opaque);if(!edge&&!(opaque&&sx%17===1&&sy%17===1))continue;
      const x=Math.floor(left+(sx+.5)/density*v.scale),y=Math.floor(top+(sy+.5)/density*v.scale);if(x<0||y<0||x>=v.width||y>=v.height||seen.has(x+','+y))continue;seen.add(x+','+y);
      const tx=Math.floor((x+.5-left)/v.scale*density),ty=Math.floor((y+.5-top)/v.scale*density);if(tx<0||ty<0||tx>=sprite.w||ty>=sprite.h)continue;
      points.push([x,y]);
      const fx=(x+.5-left)/v.scale*density,fy=(y+.5-top)/v.scale*density;
      // Only source-coordinate ties within the propagated f32 arithmetic bound admit two owners.
      // Depth itself retains the same 2e-7 tolerance; no silhouette sample is skipped.
      const xs=[...new Set([Math.floor(fx-ownerErrorBound),Math.floor(fx+ownerErrorBound)])],ys=[...new Set([Math.floor(fy-ownerErrorBound),Math.floor(fy+ownerErrorBound)])],candidates=[];
      for(const ox of xs)for(const oy of ys){if(ox<0||oy<0||ox>=sprite.w||oy>=sprite.h)continue;if(alpha(ox,oy)<128)candidates.push(null);else{const offset=((depth.y-study.manifest.originY+oy)*study.manifest.width+depth.x+ox)*4,sum=(study.bytes[offset]*256+study.bytes[offset+1])/65535*4-2;candidates.push(base-sum*step);}}
      if(candidates.length>1)ambiguousOwnerSamples++;expected.push(candidates);
      if(alpha(tx,ty)<128)transparent++;else if(edge)edges++;else interiors++;
     }
     const device=h.graphicsDevice,input=device.createBuffer({size:points.length*8,usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST}),output=device.createBuffer({size:points.length*4,usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_SRC}),read=device.createBuffer({size:points.length*4,usage:GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ});
     try{device.queue.writeBuffer(input,0,new Uint32Array(points.flat()));const module=device.createShaderModule({code:'@group(0) @binding(0) var image:texture_depth_2d; @group(0) @binding(1) var<storage,read> points:array<vec2u>; @group(0) @binding(2) var<storage,read_write> result:array<f32>; @compute @workgroup_size(64) fn main(@builtin(global_invocation_id) id:vec3u){if(id.x<arrayLength(&points)){result[id.x]=textureLoad(image,vec2i(points[id.x]),0);}}'}),pipeline=device.createComputePipeline({layout:'auto',compute:{module,entryPoint:'main'}}),group=device.createBindGroup({layout:pipeline.getBindGroupLayout(0),entries:[{binding:0,resource:h.sceneDepthTexture.createView()},{binding:1,resource:{buffer:input}},{binding:2,resource:{buffer:output}}]}),encoder=device.createCommandEncoder(),pass=encoder.beginComputePass();pass.setPipeline(pipeline);pass.setBindGroup(0,group);pass.dispatchWorkgroups(Math.ceil(points.length/64));pass.end();encoder.copyBufferToBuffer(output,0,read,0,points.length*4);device.queue.submit([encoder.finish()]);await read.mapAsync(GPUMapMode.READ);const actual=new Float32Array(read.getMappedRange()),failures=[];let maxError=0;
      for(let i=0;i<actual.length;i++){const candidates=expected[i];if(candidates.includes(null)&&Math.abs(actual[i]-FLOOR_DEPTH)<=0.0000002)continue;const error=Math.min(...candidates.filter(value=>value!==null).map(value=>Math.abs(actual[i]-value)));maxError=Math.max(maxError,error);if(error>0.0000002)failures.push({point:points[i],eligibleDepths:candidates,actual:actual[i]});}
      if(failures.length)throw Error('Registered surface depth mismatch '+JSON.stringify({sprite:sprite.name,scale:v.scale,failures:failures.slice(0,6),count:failures.length}));if(!edges||!interiors||!transparent)throw Error('Missing silhouette or interior coverage');return {sprite:sprite.name,scale:v.scale,samples:points.length,edges,interiors,transparent,maxError,ambiguousOwnerSamples,ownerCoordinateErrorBoundTexels:ownerErrorBound};
     }finally{read.unmap();read.destroy();output.destroy();input.destroy();}
    });rows.push({model,facing,...result});
   }
  }assert.equal(rows.length,48);assert.deepEqual(errors,[]);
 }finally{await browser.close();fs.writeFileSync(path.join(out,'report.json'),JSON.stringify({rows,errors,expected:48},null,2));}
 console.log(JSON.stringify({cases:rows.length,samples:rows.reduce((n,row)=>n+row.samples,0),maxError:Math.max(...rows.map(row=>row.maxError)),errors}));
})().catch(error=>{console.error(error);process.exitCode=1});
