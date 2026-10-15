const {chromium}=require('C:/Users/myema/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');

const output=path.resolve('docs/evidence/2026-10-13-creator-repair/gpu-contracts');
const productionFiles=['web/src/render/sprites.ts','web/src/render/sprite-pipelines.ts','web/src/render/sprites.wgsl',
 'web/src/render/scene-target.ts','web/src/render/scene-pipeline.ts','web/src/render/scene-sampling.ts'];
const hashes=()=>Object.fromEntries(productionFiles.map(file=>[file,crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')]));

async function exercise(){
 const {SpriteRenderer}=await import('/src/render/sprites.ts');
 const atlas=await import('/src/render/atlas.ts');
 const {writeInstance,FLOATS_PER_INSTANCE}=await import('/src/render/instances.ts');
 const {fixtureDepthTable,shelfDepthSprite,fixtureDepthSprite}=await import('/src/render/fixture-depth.ts');
 const adapter=await navigator.gpu.requestAdapter();
 if(!adapter)throw Error('No WebGPU adapter');
 const device=await adapter.requestDevice({requiredLimits:{maxTextureDimension2D:adapter.limits.maxTextureDimension2D}});
 const canvas=document.createElement('canvas');canvas.width=160;canvas.height=170;document.body.append(canvas);
 const context=canvas.getContext('webgpu'),format=navigator.gpu.getPreferredCanvasFormat();
 context.configure({device,format,alphaMode:'premultiplied'});
 const gpu={device,context,format},errors=[],checks=[],mutants=[];
 device.addEventListener('uncapturederror',event=>errors.push(event.error.message));
 const linear=v=>v<=.04045?v/12.92:((v+.055)/1.055)**2.4;
 const encoded=v=>v<=.0031308?v*12.92:1.055*v**(1/2.4)-.055;
 const half=n=>{const sign=(n&32768)?-1:1,e=(n>>10)&31,f=n&1023;return sign*(e===0?2**-14*f/1024:e===31?f?NaN:Infinity:2**(e-15)*(1+f/1024));};
 const near=(name,actual,expected,tolerance)=>{
  if(actual.length!==expected.length||actual.some((value,i)=>!Number.isFinite(value)||Math.abs(value-expected[i])>tolerance))
   throw Error(`${name}: actual ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)}, tolerance ${tolerance}`);
 };
 const assert=(value,message)=>{if(!value)throw Error(message);};
 const checked=async(name,fn)=>{const detail=await fn();checks.push({name,status:'PASS',...detail});};
 const originalCreateShaderModule=device.createShaderModule;
 let rootRenderer;
 const liveRenderers=new Set(),baselineModules=[];
 try{
  device.pushErrorScope('validation');
  device.createShaderModule=function(descriptor){const module=originalCreateShaderModule.call(this,descriptor);baselineModules.push(module);return module;};
  try{rootRenderer=await SpriteRenderer.create(gpu);liveRenderers.add(rootRenderer);}
  finally{device.createShaderModule=originalCreateShaderModule;}
  const baselineCompilation=(await Promise.all(baselineModules.map(module=>module.getCompilationInfo()))).flatMap(info=>info.messages.map(message=>({type:message.type,message:message.message})));
  assert(baselineModules.length>0&&!baselineCompilation.some(message=>message.type==='error'),'Baseline shader compilation failed: '+JSON.stringify(baselineCompilation));
  const initialError=await device.popErrorScope();if(initialError)throw Error(initialError.message);
  checks.push({name:'baseline-production-shader-compilation',status:'PASS',modules:baselineModules.length,messages:baselineCompilation});
  const texture=rootRenderer.ownedTextures[0];
  const foreground=atlas.SPRITES.findIndex(s=>s.name==='activityWalking');
  const background=atlas.SPRITES.findIndex(s=>s.name==='activityWait');
  assert(foreground>=0&&background>=0,'Synthetic controls need ordinary activity sprites');
  const sprite=atlas.SPRITES[foreground],density=sprite.pixel_density??1;
  assert(sprite.w===atlas.SPRITES[background].w&&sprite.h===atlas.SPRITES[background].h,'Synthetic sprite dimensions differ');
  const fill=(id,pixel)=>{
   const s=atlas.SPRITES[id],bytes=new Uint8Array(s.w*s.h*4);
   for(let y=0;y<s.h;y++)for(let x=0;x<s.w;x++)bytes.set(pixel(x,y),4*(y*s.w+x));
   device.queue.writeTexture({texture,origin:[s.x,s.y,s.page??0]},bytes,{bytesPerRow:s.w*4},[s.w,s.h]);
   return bytes;
  };
  const rows=(items,scale=1)=>{
   const values=new Float32Array(items.length*FLOATS_PER_INSTANCE);
   items.forEach((item,i)=>{const s=atlas.SPRITES[item.id],d=s.pixel_density??1;
    writeInstance(values,i,item.left+s.w/d*scale/2,item.top+(s.h/d-21)*scale,item.depth??.5,item.id);
    if(item.mask!==undefined)values[i*16+4]=item.mask;
    if(item.mode!==undefined)values[i*16+8]=item.mode;
    if(item.step!==undefined)values[i*16+9]=item.step;
    if(item.surface!==undefined)values[i*16+10]=item.surface;
    if(item.stock!==undefined)values[i*16+11]=item.stock;
   });return values;
  };
  async function readTexture(texture,kind,origin=[0,0],size=[texture.width,texture.height]){
   const bpp=kind==='half'?8:4,pitch=Math.ceil(size[0]*bpp/256)*256;
   const buffer=device.createBuffer({size:pitch*size[1],usage:GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ});
   try{const encoder=device.createCommandEncoder();encoder.copyTextureToBuffer({texture,origin},{buffer,bytesPerRow:pitch},size);
    device.queue.submit([encoder.finish()]);await buffer.mapAsync(GPUMapMode.READ);const view=new DataView(buffer.getMappedRange()),result=[];
    for(let y=0;y<size[1];y++)for(let x=0;x<size[0];x++){
     const offset=y*pitch+x*bpp;
     result.push(kind==='half'?[0,2,4,6].map(c=>half(view.getUint16(offset+c,true))):kind==='float'?view.getFloat32(offset,true):kind==='uint'?view.getUint32(offset,true):[0,1,2,3].map(c=>view.getUint8(offset+c)));
    }return result;
   }finally{buffer.unmap();buffer.destroy();}
  }
  async function draw(renderer,items,scale=1,callback){
   device.pushErrorScope('validation');renderer.draw(rows(items,scale),items.length,scale,[1,1,1,1],0,callback,new Uint32Array(items.map(x=>x.owner??0)));
   await device.queue.onSubmittedWorkDone();const error=await device.popErrorScope();if(error)throw Error(`GPU validation: ${error.message}`);
   const scene=renderer.sceneForPicking;
   return {scene,color:await readTexture(scene.color,'half'),surface:await readTexture(scene.surface,'float'),identity:await readTexture(scene.identity,'uint')};
  }
  const sample=(read,x,y)=>read.color[y*read.scene.width+x];
  const ordinary={id:foreground,left:12.125,top:13.1875,depth:.3,owner:41};
  async function linearFilter(renderer){
   fill(foreground,x=>x%2?[255,255,255,255]:[0,0,0,255]);
   const scale=1.25,result=await draw(renderer,[ordinary],scale),witnesses=[];
   for(const [x,y] of [[39,41],[44,48],[51,57],[65,67]]){
    const source=((x+.5)/2-ordinary.left)*density/scale-.5,lower=Math.floor(source),fraction=source-lower;
    const expected=(lower%2?1:0)*(1-fraction)+((lower+1)%2?1:0)*fraction;
    near('Ordinary linear-light interpolation',sample(result,x,y),[expected,expected,expected,1],.001);
    witnesses.push({pixel:[x,y],expected,actual:sample(result,x,y)});
   }return {witnesses};
  }
  async function transparentRgb(renderer){
   fill(foreground,x=>x%2?[255,0,0,255]:[0,255,255,0]);
   const result=await draw(renderer,[ordinary],1.25),witnesses=[];
   for(let y=40;y<48;y++)for(let x=40;x<48;x++){
    const index=y*result.scene.width+x;if(result.identity[index]!==41)continue;
    near('Transparent RGB must not contaminate red',sample(result,x,y),[1,0,0,1],.001);
    witnesses.push({pixel:[x,y],actual:sample(result,x,y)});
   }assert(witnesses.length>=12,'Transparent-RGB control rendered too few covered samples');return {count:witnesses.length,witnesses:witnesses.slice(0,4)};
  }
  async function coverage(renderer){
   fill(foreground,()=>[255,0,0,64]);fill(background,()=>[0,0,255,255]);
   const back={...ordinary,id:background,depth:.7,owner:19};
   const result=await draw(renderer,[ordinary,back],1.25),x=24,y=24;
   const indices=[0,1,result.scene.width,result.scene.width+1].map(i=>y*2*result.scene.width+x*2+i);
   const expectedIds=[41,19,19,19],actualIds=indices.map(i=>result.identity[i]);
   near('Quarter coverage keeps one foreground sample',actualIds,expectedIds,0);
   near('Depth remains categorical',indices.map(i=>result.surface[i]),[.3,.7,.7,.7],.000001);
   indices.forEach((i,n)=>near('Visibility resolves before color reduction',result.color[i],n===0?[1,0,0,1]:[0,0,1,1],.001));
   const output=device.createTexture({size:[160,170],format,usage:GPUTextureUsage.RENDER_ATTACHMENT|GPUTextureUsage.COPY_SRC});
   try{const encoder=device.createCommandEncoder();result.scene.resolve(encoder,output);device.queue.submit([encoder.finish()]);
     const pixel=(await readTexture(output,'bytes',[x,y],[1,1]))[0],rgba=format.startsWith('bgra')?[pixel[2],pixel[1],pixel[0],pixel[3]]:pixel;
     near('Linear scene resolve',rgba,[Math.round(encoded(.25)*255),0,Math.round(encoded(.75)*255),255],1);
     const picked=await result.scene.pick(x,y);assert(picked===41,`Nearest visible owner pick was ${picked}, expected 41`);
     assert(await result.scene.pick(-1,y)===0,'Outside picking must return no owner');
     return {subpixelIds:actualIds,subpixelDepths:indices.map(i=>result.surface[i]),resolved:rgba,picked};
   }finally{output.destroy();}
  }
  const imageCache=new Map();
  async function imagePixels(page){
   if(!imageCache.has(page)){
    const response=await fetch('/'+atlas.ATLAS_PAGE_FILES[page]);assert(response.ok,'Atlas source load failed');
    const bitmap=await createImageBitmap(await response.blob(),{premultiplyAlpha:'none',colorSpaceConversion:'none'});
    const imageCanvas=new OffscreenCanvas(bitmap.width,bitmap.height),ctx=imageCanvas.getContext('2d',{willReadFrequently:true});ctx.drawImage(bitmap,0,0);bitmap.close();
    imageCache.set(page,ctx.getImageData(0,0,imageCanvas.width,imageCanvas.height).data);
   }return imageCache.get(page);
  }
  async function crop(id){const s=atlas.SPRITES[id],data=await imagePixels(s.page??0);return {s,pixel:(x,y)=>Array.from(data.subarray(((s.y+y)*atlas.ATLAS_WIDTH+s.x+x)*4,((s.y+y)*atlas.ATLAS_WIDTH+s.x+x)*4+4))};}
  const shelfManifest=await(await fetch('/@fs/D:/VIBES/.worktrees/5637/terrilives/assets/models/sims/character-repair/shelf-depth/manifest.json')).json();
  const depthPages=new Map();
  async function depthPixel(rect,x,y){
   if(!depthPages.has(rect.pageIndex)){
    const page=shelfManifest.pages[rect.pageIndex];
    const data=new Uint8Array(await(await fetch('/@fs/D:/VIBES/.worktrees/5637/terrilives/assets/models/sims/character-repair/shelf-depth/'+page.path)).arrayBuffer());
    depthPages.set(rect.pageIndex,{data,width:page.width});
   }const {data,width}=depthPages.get(rect.pageIndex),offset=((rect.y+y)*width+rect.x+x)*4;
   return Array.from(data.subarray(offset,offset+4));
  }
  const decodedDepth=p=>(p[0]*256+p[1])/65535*4-2;
  async function stock(renderer){
   const facing=shelfManifest.facings.SE,id=facing.atlasIndex,profile=atlas.SHELF_PROFILES[id],base=await crop(profile.base);
   const mask=1,pair=profile.rows[mask],high=await crop(pair[0]),low=await crop(pair[1]);
   const scale=1.1375,item={id,left:17.173,top:18.291,depth:.5,owner:73,mode:-9,step:.08,surface:shelfDepthSprite(id,renderer.fixtureDepthBase),stock:mask,mask};
   const result=await draw(renderer,[item],scale),witnesses=[];let maxColorError=0,maxDepthError=0,stockCount=0;
   const d=atlas.SPRITES[id].pixel_density??1;
   const highTrim=atlas.BED_LAYER_TRIMS[pair[0]]??[0,0],lowTrim=atlas.BED_LAYER_TRIMS[pair[1]]??[0,0];
   for(let sy=42;sy<Math.min(result.scene.height,300);sy++)for(let sx=38;sx<Math.min(result.scene.width,250);sx++){
    const x=Math.floor(((sx+.5)/2-item.left)*d/scale),y=Math.floor(((sy+.5)/2-item.top)*d/scale);
    if(x<1||y<1||x>=base.s.w-1||y>=base.s.h-1)continue;
    const b=base.pixel(x,y);if(b[3]!==255)continue;
    const hx=x-highTrim[0]*d,hy=y-highTrim[1]*d,lx=x-lowTrim[0]*d,ly=y-lowTrim[1]*d;
    if(hx<1||hy<1||lx<1||ly<1||hx>=high.s.w-1||hy>=high.s.h-1||lx>=low.s.w-1||ly>=low.s.h-1)continue;
    const hi=high.pixel(hx,hy),lo=low.pixel(lx,ly);if(hi[3]!==255||lo[3]!==255)continue;
    const stockPixel=await depthPixel(facing.slots[0],x,y);if(stockPixel[3]===0)continue;
    const shellPixel=await depthPixel(facing.shell,x,y),sum=Math.max(decodedDepth(shellPixel),decodedDepth(stockPixel));
    if(sum<=decodedDepth(shellPixel)+.03)continue;
    const expected=b.slice(0,3).map((v,c)=>linear(Math.max(0,Math.min(1,v/255+((hi[c]-128)*256+lo[c])/32767))));expected.push(1);
    const index=sy*result.scene.width+sx,actual=result.color[index],depth=.5-sum*.08;
    maxColorError=Math.max(maxColorError,...actual.map((v,c)=>Math.abs(v-expected[c])));maxDepthError=Math.max(maxDepthError,Math.abs(result.surface[index]-depth));stockCount++;
    near('Registered stock color uses the depth texel',actual,expected,.001);
    near('Present stock determines nearest physical depth',[result.surface[index]],[depth],.000001);
    assert(result.identity[index]===73,'Registered shelf owner changed');
    if(witnesses.length<6)witnesses.push({pixel:[sx,sy],source:[x,y],actual,expected,depth:result.surface[index],expectedDepth:depth});
   }
   assert(stockCount>=10,`Registered stock oracle had only ${stockCount} qualifying witnesses`);
   return {facing:'SE',presenceMask:mask,stockCount,maxColorError,maxDepthError,witnesses};
  }
  async function registeredFixture(renderer){
   const id=atlas.SPRITES.findIndex((s,i)=>s.name==='offlineToilet'&&fixtureDepthSprite(i,renderer.fixtureDepthBase)!==null);
   assert(id>=0,'Registered fixture witness missing');
   const source=await crop(id),scale=1.1375,item={id,left:14.173,top:18.291,depth:.5,owner:61,mode:-8,step:.08,surface:fixtureDepthSprite(id,renderer.fixtureDepthBase)};
   const table=fixtureDepthTable(),offset=(item.surface-renderer.fixtureDepthBase)*12;
   const record={x:Math.round(table[offset]*atlas.ATLAS_WIDTH),y:Math.round(table[offset+1]*atlas.ATLAS_HEIGHT),page:table[offset+10]};
   // Companion pages are uploaded independently; copy their known CPU data from their source manifest.
   const manifest=await(await fetch('/@fs/D:/VIBES/.worktrees/5637/terrilives/assets/models/sims/character-repair/fixture-depth/manifest.json')).json();
   const rect=manifest.sprites.find(row=>row.sprite===id),page=manifest.pages[rect.pageIndex];
   const data=new Uint8Array(await(await fetch('/@fs/D:/VIBES/.worktrees/5637/terrilives/assets/models/sims/character-repair/fixture-depth/'+page.path)).arrayBuffer());
   const result=await draw(renderer,[item],scale),d=source.s.pixel_density??1;let count=0;const witnesses=[];
   for(let sy=45;sy<Math.min(result.scene.height,280);sy++)for(let sx=35;sx<Math.min(result.scene.width,250);sx++){
    const x=Math.floor(((sx+.5)/2-item.left)*d/scale),y=Math.floor(((sy+.5)/2-item.top)*d/scale);
    if(x<1||y<1||x>=source.s.w-1||y>=source.s.h-1)continue;
    const expectedPixel=source.pixel(x,y);if(expectedPixel[3]!==255)continue;
    const at=((rect.y+y)*page.width+rect.x+x)*4,depth=.5-decodedDepth(data.subarray(at,at+4))*.08,index=sy*result.scene.width+sx;
    near('Registered fixture color uses the depth texel',result.color[index],[...expectedPixel.slice(0,3).map(v=>linear(v/255)),1],.001);
    near('Registered fixture depth',[result.surface[index]],[depth],.000001);
    count++;if(witnesses.length<4)witnesses.push({pixel:[sx,sy],source:[x,y],color:result.color[index],depth:result.surface[index]});
   }assert(count>100,'Registered fixture oracle needs visible opaque pixels');return {sprite:source.s.name,count,record,witnesses};
  }
  async function lowWall(renderer,suppressRestore=false){
   fill(foreground,()=>[255,0,0,255]);fill(background,()=>[0,0,255,255]);
   const scale=1,back={id:background,left:18,top:18,depth:.8,owner:19},front={id:foreground,left:18,top:18,depth:.2};
   renderer.setStaticGeometry(new Float32Array(),0,rows([front],scale));
   const dummy=device.createBuffer({size:4096,usage:GPUBufferUsage.VERTEX|GPUBufferUsage.COPY_DST});
   const displaced=rows([{...front,left:-500},{...front,left:-500}],scale);device.queue.writeBuffer(dummy,0,displaced);
   let originalSet,passObject,restoreCalls=0;
   try{
    const callback=pass=>{pass.setVertexBuffer(0,dummy);pass.setVertexBuffer(1,dummy);if(suppressRestore){
     passObject=pass;originalSet=pass.setVertexBuffer;pass.setVertexBuffer=function(slot,...args){if(slot===0||slot===1){restoreCalls++;return;}return originalSet.call(this,slot,...args);};
    }};
    const result=await draw(renderer,[back],scale,callback);
    near('Low wall survives a dynamic draw changing both vertex buffers',sample(result,50,50),[1,0,0,1],.001);
    assert(result.identity[50*result.scene.width+50]===19,'Translucent wall must preserve categorical owner');
    return {color:sample(result,50,50),owner:19,restoreCalls};
   }finally{if(passObject)passObject.setVertexBuffer=originalSet;dummy.destroy();renderer.setStaticGeometry(new Float32Array(),0);}
  }
  await checked('ordinary-linear-premultiplied-filter',()=>linearFilter(rootRenderer));
  await checked('transparent-rgb-does-not-bleed',()=>transparentRgb(rootRenderer));
  await checked('quarter-coverage-depth-identity-resolve-pick',()=>coverage(rootRenderer));
  await checked('registered-fixture-same-texel',()=>registeredFixture(rootRenderer));
  await checked('registered-stock-same-texel',()=>stock(rootRenderer));
  await checked('dynamic-draw-restores-low-wall-bindings',()=>lowWall(rootRenderer));
  const variants=[
   {name:'encoded-straight-filter',from:'else{colour=sampleAtlasColor(uv,i32(in.page));}',to:'else{colour=textureSampleLevel(atlasTexture,atlasSampler,uv,i32(in.page),0.0);}',run:linearFilter},
   {name:'transparent-rgb-straight-filter',from:'else{colour=sampleAtlasColor(uv,i32(in.page));}',to:'else{colour=textureSampleLevel(atlasTexture,atlasSampler,uv,i32(in.page),0.0);}',run:transparentRgb},
   {name:'half-alpha-discard',from:'!sceneCovered(visibleAlpha,in.clip.xy)',to:'visibleAlpha < 0.5',run:coverage},
   {name:'registered-fixture-filtered-color',from:'if(registered){colour=textureLoad(atlasTexture,fixturePixel,i32(in.page),0);}',to:'if(registered){colour=sampleAtlasColor(uv,i32(in.page));}',run:registeredFixture},
   {name:'shelf-independently-filtered-color',from:'let point=in.wall.x==SHELF_SURFACE_DEPTH;',to:'let point=false;',run:stock},
   {name:'shelf-ignores-present-stock-depth',from:'sum=max(sum,dot(covered.rg,vec2f(65280.,255.))/65535.*4.-2.);',to:'sum=sum;',run:stock},
  ];
  for(const variant of variants){
   let applied=0,renderer,failure=null;const modules=[];
   device.pushErrorScope('validation');
   try{
    device.createShaderModule=function(descriptor){let code=descriptor.code;
     if(code.includes(variant.from)){assert(code.split(variant.from).length===2,'Mutation anchor is not unique');code=code.replace(variant.from,variant.to);applied++;}
     const shader=originalCreateShaderModule.call(this,{...descriptor,code});modules.push(shader);return shader;
    };
    // Reuse only the immutable atlas texture. All pipelines, groups, tables and targets belong to this instance.
    renderer=new SpriteRenderer(gpu,texture,undefined,[],[]);liveRenderers.add(renderer);
   }finally{device.createShaderModule=originalCreateShaderModule;}
   const compilation=(await Promise.all(modules.map(module=>module.getCompilationInfo()))).flatMap(info=>info.messages.filter(message=>message.type==='error').map(message=>message.message));
   const validation=await device.popErrorScope();
   assert(applied===1,`${variant.name}: mutation did not change exactly one production shader`);
   assert(!validation&&compilation.length===0,`${variant.name}: invalid mutation, compilation ${compilation.join('; ')} validation ${validation?.message}`);
   try{await variant.run(renderer);}catch(error){failure=error.message;}finally{renderer.destroy();liveRenderers.delete(renderer);}
   assert(failure&&!failure.startsWith('GPU validation:'),`${variant.name}: mutation survived or failed GPU validation`);
   mutants.push({name:variant.name,status:'KILLED',compiled:true,from:variant.from,to:variant.to,failure,shaderMethodRestored:device.createShaderModule===originalCreateShaderModule});
  }
  let bindingFailure=null;try{await lowWall(rootRenderer,true);}catch(error){bindingFailure=error.message;}
  assert(bindingFailure&&!bindingFailure.startsWith('GPU validation:'),'Removing vertex restoration must fail the low-wall pixel assertion');
  mutants.push({name:'remove-dynamic-vertex-buffer-restoration',status:'KILLED',compiled:true,failure:bindingFailure,methodRestored:true});
  const pickPrototype=Object.getPrototypeOf(rootRenderer.sceneForPicking),originalPick=pickPrototype.pick;
  const pickSource=originalPick.toString(),comparison=/depths\[i\]\s*<\s*depth/g;
  assert(Array.from(pickSource.matchAll(comparison)).length===1,'Picking mutation needs exactly one nearest-depth comparison');
  let pickFailure=null;
  try{
   // Compile the production method with only its nearest-depth guard removed.
   const mutatedPick=pickSource.replace(/^async\s+pick\s*\(/,'async function(').replace(comparison,'true');
   pickPrototype.pick=(0,eval)('('+mutatedPick+')');
   try{await coverage(rootRenderer);}catch(error){pickFailure=error.message;}
  }finally{pickPrototype.pick=originalPick;}
  assert(pickFailure?.startsWith('Nearest visible owner pick'),'Picking mutation must fail the nearest-owner assertion');
  mutants.push({name:'pick-last-covered-owner-instead-of-nearest',status:'KILLED',compiled:true,failure:pickFailure,methodRestored:pickPrototype.pick===originalPick});
  await checked('restored-linear-filter',()=>linearFilter(rootRenderer));
  await checked('restored-quarter-coverage',()=>coverage(rootRenderer));
  await checked('restored-registered-stock',()=>stock(rootRenderer));
  await checked('restored-low-wall-bindings',()=>lowWall(rootRenderer));
  assert(errors.length===0,`Uncaptured GPU errors: ${errors.join('; ')}`);
  return {status:'PASS',adapter:{vendor:adapter.info.vendor,architecture:adapter.info.architecture,device:adapter.info.device,description:adapter.info.description},checks,mutants,errors,scope:'Production SpriteRenderer factory, constructor, draw, shader, SceneTarget resolve and pick; disposable GPU device, canvas, atlas texture, browser storage; no live source mutations.'};
 }catch(error){return {status:'FAIL',failure:error.stack,checks,mutants,errors};}
 finally{device.createShaderModule=originalCreateShaderModule;for(const renderer of liveRenderers)renderer.destroy();context.unconfigure();canvas.remove();device.destroy();}
}

(async()=>{
 fs.mkdirSync(output,{recursive:true});const before=hashes(),browser=await chromium.launch({channel:'chrome',headless:true});let receipt;
 try{const context=await browser.newContext(),page=await context.newPage();
  // Serve a task-owned blank document. Production Vite module URLs remain untouched.
  await page.route('http://127.0.0.1:5187/gpu-contract-lab',route=>route.fulfill({contentType:'text/html',body:'<!doctype html><title>GPU contract lab</title><body></body>'}));
  await page.goto('http://127.0.0.1:5187/gpu-contract-lab');
  receipt=await page.evaluate(exercise);
  await context.close();
 }finally{await browser.close();}
 const after=hashes();receipt.productionHashesBefore=before;receipt.productionHashesAfter=after;receipt.productionUnchanged=JSON.stringify(before)===JSON.stringify(after);
 receipt.command='node scripts/character-creator-repair/check-scene-contracts.cjs';receipt.exitCode=receipt.status==='PASS'&&receipt.productionUnchanged?0:1;
 fs.writeFileSync(path.join(output,'receipt.json'),JSON.stringify(receipt,null,2)+'\n');
 console.log(JSON.stringify(receipt,null,2));process.exitCode=receipt.exitCode;
})().catch(error=>{console.error(error);process.exitCode=1;});
