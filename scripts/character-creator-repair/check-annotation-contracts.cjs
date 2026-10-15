const {chromium}=require('C:/Users/myema/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');

const output=path.resolve('docs/evidence/2026-10-13-creator-repair/annotation-contracts');
const productionFiles=['web/src/render/sprites.ts','web/src/render/sprite-pipelines.ts','web/src/render/sprites.wgsl',
 'web/src/render/scene-target.ts','web/src/render/scene-pipeline.ts','web/src/render/scene-sampling.ts','web/src/frame.ts'];
const hashes=()=>Object.fromEntries(productionFiles.map(file=>[file,crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')]));

async function exercise(){
 const {SpriteRenderer}=await import('/src/render/sprites.ts');

 const {resolveAnnotationOwner}=await import('/src/render/scene-sampling.ts');
 const {SPRITES}=await import('/src/render/atlas.ts');
 const {writeInstance,FLOATS_PER_INSTANCE}=await import('/src/render/instances.ts');
 const assert=(condition,message)=>{if(!condition)throw Error(message);};
 const near=(name,actual,expected,tolerance=0)=>assert(actual.length===expected.length&&actual.every((v,i)=>Number.isFinite(v)&&Math.abs(v-expected[i])<=tolerance),`${name}: actual ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)}, tolerance ${tolerance}`);
 const exact=(name,actual,expected)=>{
  assert(actual.length===expected.length,`${name}: buffer lengths differ`);
  for(let i=0;i<actual.length;i++)if(actual[i]!==expected[i])throw Error(`${name}: byte ${i} actual ${actual[i]}, expected ${expected[i]}`);
 };
 const half=n=>{const sign=n&32768?-1:1,e=(n>>10)&31,f=n&1023;return sign*(e===0?2**-14*f/1024:e===31?f?NaN:Infinity:2**(e-15)*(1+f/1024));};
 const digest=async bytes=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),n=>n.toString(16).padStart(2,'0')).join('');
 const adapter=await navigator.gpu.requestAdapter();assert(adapter,'No WebGPU adapter');
 const device=await adapter.requestDevice({requiredLimits:{maxTextureDimension2D:adapter.limits.maxTextureDimension2D}});
 const canvas=document.createElement('canvas');canvas.width=64;canvas.height=64;document.body.append(canvas);
 const context=canvas.getContext('webgpu'),format=navigator.gpu.getPreferredCanvasFormat();context.configure({device,format,alphaMode:'premultiplied'});
 const gpu={device,context,format},checks=[],mutants=[],errors=[],renderers=new Set(),originalShader=device.createShaderModule,originalPipeline=device.createRenderPipeline;
 let scenePrototype=null,originalAnnotations,originalPick;
 device.addEventListener('uncapturederror',event=>errors.push(event.error.message));
 let root;
 const check=async(name,fn)=>{const detail=await fn();checks.push({name,status:'PASS',...detail});};
 try{
  const modules=[];device.pushErrorScope('validation');
  device.createShaderModule=function(descriptor){const module=originalShader.call(this,descriptor);modules.push(module);return module;};
  try{root=await SpriteRenderer.create(gpu);renderers.add(root);}finally{device.createShaderModule=originalShader;}
  const messages=(await Promise.all(modules.map(module=>module.getCompilationInfo()))).flatMap(info=>info.messages.map(message=>({type:message.type,message:message.message})));
  const creationError=await device.popErrorScope();assert(!creationError&&!messages.some(message=>message.type==='error'),'Baseline compilation or validation failed: '+JSON.stringify({messages,error:creationError?.message}));
  checks.push({name:'production-shader-compilation',status:'PASS',modules:modules.length,messages});
  const texture=root.ownedTextures[0],ids=['activityWalking','activityWait','activityEat'].map(name=>SPRITES.findIndex(sprite=>sprite.name===name));
  assert(ids.every(id=>id>=0),'Annotation controls require three ordinary activity sprites');
  const [firstId,worldId,lastId]=ids;
  assert(ids.every(id=>SPRITES[id].w===52&&SPRITES[id].h===52&&(SPRITES[id].pixel_density??1)===2),'Annotation controls require the existing 52x52 density-two crops');
  const fill=(id,pixel)=>{const s=SPRITES[id],data=new Uint8Array(s.w*s.h*4);for(let y=0;y<s.h;y++)for(let x=0;x<s.w;x++)data.set(pixel(x,y),4*(y*s.w+x));
   device.queue.writeTexture({texture,origin:[s.x,s.y,s.page??0]},data,{bytesPerRow:s.w*4},[s.w,s.h]);return data;};
  const inside=(x,y)=>x>=8&&x<44&&y>=8&&y<44;
  const firstBytes=fill(firstId,(x,y)=>inside(x,y)?[255,0,0,x<16?64:255]:[0,255,255,0]);
  const worldBytes=fill(worldId,()=>[0,0,255,255]);
  const lastBytes=fill(lastId,(x,y)=>inside(x,y)?[0,255,0,64]:[255,0,255,0]);
  const world={id:worldId,left:8,top:8,depth:.05,owner:19};
  const first={id:firstId,left:8,top:8,depth:.85,owner:41};
  const last={id:lastId,left:8,top:8,depth:.95,owner:83};
  const rows=items=>{const data=new Float32Array(items.length*FLOATS_PER_INSTANCE);items.forEach((item,i)=>{
   const s=SPRITES[item.id],density=s.pixel_density??1;writeInstance(data,i,item.left+s.w/density/2,item.top+s.h/density-21,item.depth,item.id);
  });return data;};
  async function raw(texture,bytesPerPixel){
   const width=texture.width,height=texture.height,pitch=Math.ceil(width*bytesPerPixel/256)*256;
   const buffer=device.createBuffer({size:pitch*height,usage:GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ});
   try{const encoder=device.createCommandEncoder();encoder.copyTextureToBuffer({texture},{buffer,bytesPerRow:pitch},[width,height]);device.queue.submit([encoder.finish()]);
    await buffer.mapAsync(GPUMapMode.READ);const source=new Uint8Array(buffer.getMappedRange()),data=new Uint8Array(width*height*bytesPerPixel);
    for(let y=0;y<height;y++)data.set(source.subarray(y*pitch,y*pitch+width*bytesPerPixel),y*width*bytesPerPixel);return data;
   }finally{buffer.unmap();buffer.destroy();}
  }
  const color=(result,x,y)=>{const offset=(y*result.width+x)*8,view=new DataView(result.color.buffer);return [0,2,4,6].map(i=>half(view.getUint16(offset+i,true)));};
  const tokens=(result,x,y)=>[0,1,result.width,result.width+1].map(offset=>result.annotations[y*2*result.width+x*2+offset]);
  async function draw(renderer,items,range){
   device.pushErrorScope('validation');
   try{renderer.draw(rows(items),items.length,1,[1,1,1,1],0,undefined,new Uint32Array(items.map(item=>item.owner)),range);await device.queue.onSubmittedWorkDone();}
   catch(error){await device.popErrorScope();throw error;}
   const error=await device.popErrorScope();assert(!error,'GPU validation: '+error?.message);
   const scene=renderer.sceneForPicking,annotationTexture=scene.annotationIdentity;
   return {scene,width:scene.width,height:scene.height,color:await raw(scene.color,8),surface:await raw(scene.surface,4),identity:await raw(scene.identity,4),
    annotations:annotationTexture?new Uint32Array((await raw(annotationTexture,4)).buffer):null,annotationTexture};
  }
  const withAnnotation=renderer=>draw(renderer,[world,first],{start:1,count:1});
  async function unobstructed(renderer){
   const alone=await draw(renderer,[first],{start:0,count:1}),nearWall=await withAnnotation(renderer);
   let count=0;
   for(let y=0;y<alone.height;y++)for(let x=0;x<alone.width;x++){
    const sourceX=x-16,sourceY=y-16,alpha=inside(sourceX,sourceY)?sourceX<16?64/255:1:0,rank=[0,2,3,1][(y%2)*2+x%2];
    const expected=alpha>(rank+.5)/4?41:0,index=y*alone.width+x;
    near('Annotation source coverage without wall',[alone.annotations[index]],[expected]);
    near('Near world geometry cannot clip annotation',[nearWall.annotations[index]],[expected]);
    if(expected){near('Annotation color survives near world geometry',color(nearWall,x,y),[1,0,0,1],.001);near('Annotation covered color stays unchanged',color(nearWall,x,y),color(alone,x,y));count++;}
   }
   assert(count===1080,'Annotation oracle must cover 1080 source samples');
   return {coveredSamples:count,nearWorldDepth:world.depth,annotationDepth:first.depth,identitySha256:await digest(new Uint8Array(nearWall.annotations.buffer))};
  }
  async function physicalAttachments(renderer){
   const before=await draw(renderer,[world]),after=await withAnnotation(renderer);
   exact('Annotations preserve physical surface bytes',after.surface,before.surface);
   exact('Annotations preserve physical identity bytes',after.identity,before.identity);
   const index=36*after.width+36;
   near('World identity remains physical',[new Uint32Array(after.identity.buffer)[index]],[19]);
   near('World surface remains physical',[new Float32Array(after.surface.buffer)[index]],[.05],.000001);
   return {surfaceBytes:after.surface.length,identityBytes:after.identity.length,surfaceSha256:await digest(after.surface),identitySha256:await digest(after.identity)};
  }
  async function coverageAndPicking(renderer){
   const result=await withAnnotation(renderer),opaque=tokens(result,18,18),quarter=tokens(result,13,18),padding=tokens(result,9,9);
   near('Opaque annotation coverage',opaque,[41,41,41,41]);near('Quarter annotation coverage',quarter,[41,0,0,0]);near('Transparent annotation padding',padding,[0,0,0,0]);
   near('Quarter covered sample is red',color(result,26,36),[1,0,0,1],.001);near('Quarter uncovered sample keeps blue world',color(result,27,36),[0,0,1,1],.001);
   const coveredPick=await result.scene.pick(18,18),quarterPick=await result.scene.pick(13,18),paddingPick=await result.scene.pick(9,9);
   assert(coveredPick===41,`Covered annotation must pick displayed person: actual ${coveredPick}, expected 41`);
   assert(quarterPick===41,`Quarter annotation must pick displayed person: actual ${quarterPick}, expected 41`);
   assert(paddingPick===19,`Transparent annotation padding must fall through: actual ${paddingPick}, expected 19`);
   assert(await result.scene.pick(50,50)===0,'Empty world must not acquire annotation ownership');
   return {opaque,quarter,padding,coveredPick,quarterPick,paddingPick};
  }
  async function coveredPick(renderer){const result=await withAnnotation(renderer),picked=await result.scene.pick(18,18);assert(picked===41,`Covered annotation must pick displayed person: actual ${picked}, expected 41`);return {picked};}
  async function overlap(renderer){
   const result=await draw(renderer,[world,first,last],{start:1,count:2});
   const mixed=tokens(result,18,18);near('Mixed annotation edge preserves per-sample owners',mixed,[83,41,41,41]);
   const picked=await result.scene.pick(18,18);assert(picked===83,`Latest displayed covered annotation must win: actual ${picked}, expected 83`);
   const opposite=await draw(renderer,[world,{...first,owner:83},{...last,owner:41}],{start:1,count:2});
   near('Draw priority does not sort owner identifiers',tokens(opposite,18,18),[41,83,83,83]);
   const oppositePick=await opposite.scene.pick(18,18);assert(oppositePick===41,`Latest lower-numbered annotation must win: actual ${oppositePick}, expected 41`);
   return {mixed,picked,opposite:tokens(opposite,18,18),oppositePick};
  }
  async function nextFrame(renderer){
   const firstFrame=await withAnnotation(renderer),texture=firstFrame.annotationTexture;
   assert(await firstFrame.scene.pick(18,18)===41,'Annotation precondition missing');
   const secondFrame=await draw(renderer,[world]);assert(secondFrame.annotationTexture===null,'A frame without annotations must hide the annotation texture from picking');
   const picked=await secondFrame.scene.pick(18,18);assert(picked===19,`Next frame must clear semantic annotation picking: actual ${picked}, expected 19`);
   const thirdFrame=await withAnnotation(renderer);assert(thirdFrame.annotationTexture===texture,'Annotation texture must be reused at the same scene size');
   return {nextFramePick:picked,annotationIdentityHidden:true,reusedAllocation:true};
  }
  await draw(root,[world]);scenePrototype=Object.getPrototypeOf(root.sceneForPicking);originalAnnotations=scenePrototype.beginAnnotations;originalPick=scenePrototype.pick;
  await check('annotation-visible-over-near-world',()=>unobstructed(root));
  await check('world-attachments-byte-identical',()=>physicalAttachments(root));
  await check('coverage-and-person-picking',()=>coverageAndPicking(root));
  await check('overlap-priority-at-mixed-edge',()=>overlap(root));
  await check('next-frame-clears-semantic-picking',()=>nextFrame(root));

  async function mutant(name,setup,run,expectedFailure){
   let renderer,failure,restore=()=>{},changed=0;const compiledModules=[];
   device.pushErrorScope('validation');
   try{
    const hooks=setup();restore=hooks.restore;changed=hooks.changed;
    const activeShader=device.createShaderModule;
    device.createShaderModule=function(descriptor){const module=activeShader.call(this,descriptor);compiledModules.push(module);return module;};
    try{renderer=new SpriteRenderer(gpu,texture,undefined,[],[]);renderers.add(renderer);}finally{device.createShaderModule=originalShader;device.createRenderPipeline=originalPipeline;}
    const compilation=(await Promise.all(compiledModules.map(module=>module.getCompilationInfo()))).flatMap(info=>info.messages.filter(message=>message.type==='error').map(message=>message.message));
    const error=await device.popErrorScope();assert(!error&&!compilation.length,`Invalid mutant ${name}: ${error?.message??compilation.join('; ')}`);
    try{await run(renderer);}catch(error){failure=error.message;}
    assert(failure?.startsWith(expectedFailure),`${name} must fail ${expectedFailure}; actual ${failure??'SURVIVED'}`);
    mutants.push({name,status:'KILLED',compiled:true,failure,changed:typeof changed==='function'?changed():changed,restored:false});
   }finally{device.createShaderModule=originalShader;device.createRenderPipeline=originalPipeline;restore();renderer?.destroy();renderers.delete(renderer);}
   mutants[mutants.length-1].restored=device.createShaderModule===originalShader&&device.createRenderPipeline===originalPipeline&&scenePrototype.beginAnnotations===originalAnnotations&&scenePrototype.pick===originalPick;
   assert(mutants[mutants.length-1].restored,name+' did not restore scoped methods');
  }
  await mutant('restore-old-world-depth-test',()=>{
   let changed=0;
   device.createRenderPipeline=function(descriptor){if(descriptor.fragment?.entryPoint==='fsAnnotation'){changed++;return originalPipeline.call(this,{...descriptor,depthStencil:{format:'depth24plus',depthWriteEnabled:false,depthCompare:'less'}});}return originalPipeline.call(this,descriptor);};
   scenePrototype.beginAnnotations=function(encoder,owners){const begin=encoder.beginRenderPass,scene=this;
    encoder.beginRenderPass=function(descriptor){return begin.call(this,{...descriptor,depthStencilAttachment:{view:scene.depth.createView(),depthLoadOp:'load',depthStoreOp:'store'}});};
    try{return originalAnnotations.call(this,encoder,owners);}finally{encoder.beginRenderPass=begin;}
   };
   return {changed:()=>changed,restore:()=>{scenePrototype.beginAnnotations=originalAnnotations;}};
  },unobstructed,'Near world geometry cannot clip annotation');
  await mutant('erase-world-identity-in-annotation-pass',()=>{
   let changed=0;
   scenePrototype.beginAnnotations=function(encoder,owners){const begin=encoder.beginRenderPass,scene=this;
    encoder.beginRenderPass=function(descriptor){const attachments=Array.from(descriptor.colorAttachments);attachments[1]={...attachments[1],view:scene.identity.createView()};changed++;return begin.call(this,{...descriptor,colorAttachments:attachments});};
    try{return originalAnnotations.call(this,encoder,owners);}finally{encoder.beginRenderPass=begin;}
   };
   return {changed:()=>changed,restore:()=>{scenePrototype.beginAnnotations=originalAnnotations;}};
  },physicalAttachments,'Annotations preserve physical identity bytes');
  await mutant('annotation-shader-omits-person-owner',()=>{
   let changed=0;const from='return AnnotationOut(shaded.colour,in.ownership.x);',to='return AnnotationOut(shaded.colour,0u);';
   device.createShaderModule=function(descriptor){assert(descriptor.code.split(from).length===2,'Missing-owner mutation anchor must be unique');changed++;return originalShader.call(this,{...descriptor,code:descriptor.code.replace(from,to)});};
   return {changed:()=>changed,restore:()=>{}};
  },coveredPick,'Covered annotation must pick displayed person');
  await mutant('reverse-displayed-annotation-priority',()=>{
   const source=originalPick.toString(),anchor=/order\s*=\s*\[\.\.\.this\.annotationOrder\]/g;
   assert(Array.from(source.matchAll(anchor)).length===1,'Annotation priority mutation anchor must be unique');
   const altered=source.replace(/^async\s+pick\s*\(/,'async function(').replace(anchor,'order = [...this.annotationOrder].reverse()');
   scenePrototype.pick=new Function('resolveAnnotationOwner',`return (${altered});`)(resolveAnnotationOwner);
   return {changed:1,restore:()=>{scenePrototype.pick=originalPick;}};
  },overlap,'Latest displayed covered annotation must win');

  await check('restored-annotation-visibility',()=>unobstructed(root));
  await check('restored-world-attachments',()=>physicalAttachments(root));
  await check('restored-coverage-and-picking',()=>coverageAndPicking(root));
  await check('restored-overlap-priority',()=>overlap(root));
  await check('restored-next-frame-picking',()=>nextFrame(root));
  await check('annotation-texture-destroyed-on-resize-and-dispose',async()=>{
   const old=root.sceneForPicking.annotationIdentity;assert(old,'Cleanup requires an allocated annotation texture');
   const oldDestroy=old.destroy;let resizedDestroyCalls=0,disposedDestroyCalls=0;
   old.destroy=function(){resizedDestroyCalls++;return oldDestroy.call(this);};
   canvas.width=65;
   const resized=await withAnnotation(root);assert(resizedDestroyCalls===1,`Resize must destroy old annotation texture exactly once: actual ${resizedDestroyCalls}`);
   assert(resized.annotationTexture!==old,'Resize must allocate a correctly sized annotation texture');
   const newTexture=resized.annotationTexture,newDestroy=newTexture.destroy;
   newTexture.destroy=function(){disposedDestroyCalls++;return newDestroy.call(this);};
   root.destroy();renderers.delete(root);assert(disposedDestroyCalls===1,`Renderer disposal must destroy annotation texture exactly once: actual ${disposedDestroyCalls}`);
   return {resizedDestroyCalls,disposedDestroyCalls,newDimensions:[newTexture.width,newTexture.height]};
  });
  await device.queue.onSubmittedWorkDone();assert(errors.length===0,'Uncaptured GPU errors: '+errors.join('; '));
  return {status:'PASS',adapter:{vendor:adapter.info.vendor,architecture:adapter.info.architecture},checks,mutants,errors,
   syntheticInputs:{sprites:ids.map(id=>({id,...SPRITES[id]})),firstSha256:await digest(firstBytes),worldSha256:await digest(worldBytes),lastSha256:await digest(lastBytes),world,first,last},
   scope:'Production SpriteRenderer and SceneTarget on a disposable GPU device; synthetic bytes replace three ordinary activity crops in the owned atlas. No production file mutations or performance measurement.'};
 }catch(error){return {status:'FAIL',failure:error.stack,checks,mutants,errors};}
 finally{device.createShaderModule=originalShader;device.createRenderPipeline=originalPipeline;if(scenePrototype){scenePrototype.beginAnnotations=originalAnnotations;scenePrototype.pick=originalPick;}
  for(const renderer of renderers)renderer.destroy();context.unconfigure();canvas.remove();device.destroy();}
}

(async()=>{
 fs.mkdirSync(output,{recursive:true});const before=hashes(),browser=await chromium.launch({channel:'chrome',headless:true});let receipt;
 try{const context=await browser.newContext(),page=await context.newPage();
  await page.route('http://127.0.0.1:5187/annotation-contract-lab',route=>route.fulfill({contentType:'text/html',body:'<!doctype html><title>Annotation contract lab</title><body></body>'}));
  await page.goto('http://127.0.0.1:5187/annotation-contract-lab');receipt=await page.evaluate(exercise);await context.close();
 }finally{await browser.close();}
 const after=hashes();receipt.productionHashesBefore=before;receipt.productionHashesAfter=after;receipt.productionUnchanged=JSON.stringify(before)===JSON.stringify(after);
 receipt.command='node scripts/character-creator-repair/check-annotation-contracts.cjs';receipt.exitCode=receipt.status==='PASS'&&receipt.productionUnchanged?0:1;
 fs.writeFileSync(path.join(output,'receipt.json'),JSON.stringify(receipt,null,2)+'\n');console.log(JSON.stringify(receipt,null,2));process.exitCode=receipt.exitCode;
})().catch(error=>{console.error(error);process.exitCode=1;});
