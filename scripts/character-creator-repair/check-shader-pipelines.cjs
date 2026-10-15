const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const {pathToFileURL}=require('node:url');
const {chromium}=require('C:/Users/myema/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');

const root=path.resolve(__dirname,'../..');
const output=path.join(root,process.env.SHADER_EVIDENCE_DIR||'docs/evidence/2026-10-13-creator-repair/shader-pipelines');
const sourceFiles=[
 'web/src/render/sprites.ts','web/src/render/sprite-pipelines.ts','web/src/render/sprites.wgsl',
 'web/src/render/instances.ts','web/src/render/architecture-finishes.ts','web/src/render/architecture-atlas.ts','web/src/render/architecture-data.ts',
 'web/src/render/scene-target.ts','web/src/render/scene-pipeline.ts','web/src/render/scene-sampling.ts',
 'web/src/render/character/renderer.ts','web/src/render/character/pipelines.ts','web/src/render/character/mesh.wgsl',
 'web/src/render/character/shared-colourway.ts','web/src/render/character/compositor.ts',
 'web/src/render/character/world-picking.ts','web/src/render/character/preview-fixture.ts',
 'web/src/render/character/subdivision-gpu.ts','web/src/render/character/skin-cage.wgsl',
 'web/src/render/character/subdivide.wgsl','web/src/render/character/surface-normals.wgsl',
];
const sha=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
const hashes=()=>Object.fromEntries(sourceFiles.map(file=>[file,sha(fs.readFileSync(path.join(root,file)))]));
const assert=(value,message)=>{if(!value)throw Error(message);};

// This function runs in a fresh browser context for each copied-source case.
async function exercise(){
 const sprite=await import('/src/render/sprite-pipelines.ts');
 const character=await import('/src/render/character/pipelines.ts');
 const resolve=await import('/src/render/scene-pipeline.ts');
 const finishes=await import('/src/render/architecture-finishes.ts');
 const {ARCHITECTURE}=await import('/src/render/architecture-data.ts');
 const adapter=await navigator.gpu.requestAdapter();
 if(!adapter)throw Error('No WebGPU adapter');
 // Match production device limits. Requesting extra limits here would hide a defect.
 const device=await adapter.requestDevice({requiredLimits:{maxTextureDimension2D:adapter.limits.maxTextureDimension2D}});
 const records=[],errors=[];
 device.addEventListener('uncapturederror',event=>errors.push(event.error.message));
 const digest=async value=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value))),n=>n.toString(16).padStart(2,'0')).join('');
 const limits={};for(const key of ['maxSampledTexturesPerShaderStage','maxStorageBuffersPerShaderStage','maxInterStageShaderVariables','maxColorAttachments','maxColorAttachmentBytesPerSample'])limits[key]=device.limits[key];
 async function check(name,code,build,kind='render',bindingEntries=null,expectedRejection=false){
  device.pushErrorScope('validation');
  const record={name,kind,expectedRejection,shaderSha256:await digest(code),bindingEntries};
  try{
   const module=device.createShaderModule({label:name,code});
   const info=await module.getCompilationInfo();
   record.compilation=info.messages.map(({type,message,lineNum,linePos})=>({type,message,lineNum,linePos}));
   const descriptor=build(module);
   record.descriptor=JSON.parse(JSON.stringify(descriptor,(key,value)=>key==='module'?'production-shader-module':key==='layout'&&value!=='auto'?'explicit-production-layout':value));
   // GPUPipelineError rejections are separate from error scopes. Await each one.
   record.pipelineAttempted=true;
   try{
    await(kind==='compute'?device.createComputePipelineAsync(descriptor):device.createRenderPipelineAsync(descriptor));
    record.pipelineCreated=true;
   }catch(error){record.pipelineCreated=false;record.pipelineError={name:error.name,reason:error.reason,message:error.message};}
  }catch(error){record.setupError={name:error.name,message:error.message};}
  finally{const error=await device.popErrorScope();if(error)record.validationError=error.message;}
  const rejected=Boolean(record.setupError||record.validationError||record.compilation?.some(message=>message.type==='error')||record.pipelineCreated===false);
  const rejectedAtTextureLimit=record.compilation?.every(message=>message.type!=='error')&&record.pipelineCreated===false
   &&/sampled textures.*exceeds.*limit/i.test(record.validationError??'');
  record.status=expectedRejection?(rejectedAtTextureLimit?'EXPECTED_REJECTION':'FAIL'):(rejected?'FAIL':'PASS');
  records.push(record);
 }
 try{
  // Derive the source's finite count range by calling its own assembler guard.
  const declaredCounts=[];let assemblyBoundary;
  for(let count=0;count<=device.limits.maxBindingsPerBindGroup;count++){
   try{finishes.architecturePatternShader(count);declaredCounts.push(count);}
   catch(error){assemblyBoundary={count,message:error.message};break;}
  }
  if(!assemblyBoundary)throw Error('Architecture shader count has no finite boundary within the device binding limit');
  const fixedSampledTextures=sprite.spriteBindGroupLayoutEntries(0).filter(entry=>entry.texture&&(entry.visibility&GPUShaderStage.FRAGMENT)).length;
  if(fixedSampledTextures!==finishes.SPRITE_BASE_TEXTURE_COUNT)throw Error('Architecture budget differs from the production sprite layout');
  const supportedCounts=declaredCounts.filter(count=>count+fixedSampledTextures<=device.limits.maxSampledTexturesPerShaderStage);
  const resources=[...new Set(Object.values(ARCHITECTURE.catalogue.patterns).map(pattern=>pattern.resource))];
  const selected=finishes.prepareArchitectureFinishes(Object.keys(ARCHITECTURE.catalogue.finishes),device.limits);
  if(!declaredCounts.includes(0)||!supportedCounts.includes(selected.resources.length))throw Error('The count sweep does not cover the shipped finish catalogue');
  const preparationChecks=[];
  for(const count of declaredCounts){
   const keys=Array.from({length:count},(_,index)=>`pattern.${index}`);
   const catalogue={patterns:Object.fromEntries(keys.map(key=>[key,{role:'wall',period:[1,1],resource:key}])),
    palettes:{plain:{multiply:[1,1,1]}},finishes:Object.fromEntries(keys.map(key=>[key,{patternKey:key,paletteKey:'plain'}])),coverings:{}};
   const resources=Object.fromEntries(keys.map(key=>[key,{url:`${key}.png`,width:1,height:1}]));
   let accepted=true,message;
   try{finishes.prepareArchitectureFinishes(keys,device.limits,catalogue,resources);}catch(error){accepted=false;message=error.message;}
   if(accepted!==supportedCounts.includes(count))throw Error(`Architecture preparation and pipeline texture limit differ at ${count}`);
   preparationChecks.push({count,accepted,message});
  }
  const patternCoverage={declaredCounts,supportedCounts,assemblyBoundary,fixedSampledTextures,deviceLimit:device.limits.maxSampledTexturesPerShaderStage,preparationChecks,
   catalogueResources:resources,allCatalogueFinishSelection:selected.resources,
   basis:'Every source-accepted count is compiled. Counts exceeding the exact fragment layout texture limit must reject. Current catalogue resource counts are included; custom catalogue calls have the same bounded range.'};
  for(const count of declaredCounts){
   const entries=sprite.spriteBindGroupLayoutEntries(count),code=sprite.spriteShaderSource(count);
   for(const variant of ['opaque','lowWall','grime','annotation'])await check(`sprite/${count}/${variant}`,code,module=>{
    const binding=device.createBindGroupLayout({entries});
    const layout=device.createPipelineLayout({bindGroupLayouts:[binding]});
    return sprite.spritePipelineDescriptors(module,layout)[variant];
   },'render',entries,!supportedCounts.includes(count));
  }
  const characterEntries=character.characterBindGroupLayoutEntries();
  for(const scene of [false,true])for(const outline of [false,true])await check(`character/${scene?'scene':'inspection'}/${outline?'outline':'fill'}`,character.characterShaderSource,module=>{
   const binding=device.createBindGroupLayout({entries:characterEntries});
   const layout=device.createPipelineLayout({bindGroupLayouts:[binding]});
   return character.characterPipelineDescriptor(module,layout,outline,scene);
  },'render',characterEntries);
  for(const format of ['bgra8unorm','rgba8unorm'])await check(`scene-resolve/2x/${format}`,resolve.sceneResolveShaderSource,module=>resolve.sceneResolvePipelineDescriptor(module,format));
  await check('character/compositor',character.compositorShaderSource,character.compositorPipelineDescriptor);
  await check('character/preview-fixture',character.previewFixtureShaderSource,character.previewFixturePipelineDescriptor);
  await check('character/world-picking',character.worldPickingShaderSource,character.worldPickingPipelineDescriptor,'compute');
  for(const [name,code] of Object.entries(character.subdivisionShaderSources))await check(`character/subdivision/${name}`,code,character.subdivisionPipelineDescriptor,'compute');
  await device.queue.onSubmittedWorkDone();
  if(records.length!==declaredCounts.length*4+12||records.some(record=>!record.pipelineAttempted))throw Error('The pipeline sweep is incomplete');
  return {status:records.every(record=>record.status!=='FAIL')&&errors.length===0?'PASS':'FAIL',
   adapter:{vendor:adapter.info.vendor,architecture:adapter.info.architecture,device:adapter.info.device,description:adapter.info.description},
   limits,patternCoverage,records,errors};
 }finally{device.destroy();}
}

const mutations=[
 {name:'duplicate-interstage-location-14',file:'web/src/render/sprites.wgsl',
  from:'@location(0) uv: vec2<f32>,',to:'@location(14) uv: vec2<f32>,',expect:'compilation'},
 {name:'character-recolour-vec3-instead-of-vec4',file:'web/src/render/character/mesh.wgsl',
  from:'recolour(encoded,vec4f(view.fixture.yzw,0.))',to:'recolour(encoded,view.fixture.yzw)',expect:'compilation'},
 {name:'wgsl-comma-let-declaration',file:'web/src/render/character/pipelines.ts',
  from:'let sample=first+vec2i(x,y);let logical=(vec2f(sample)+.5)/ratio;',
  to:'let sample=first+vec2i(x,y),logical=(vec2f(sample)+.5)/ratio;',expect:'compilation'},
 {name:'wrong-integer-color-target',file:'web/src/render/sprite-pipelines.ts',
  from:"{format:'r32float'}, {format:'r32uint'},",to:"{format:'r32uint'}, {format:'r32uint'},",expect:'pipeline'},
 {name:'storage-buffer-declared-as-uniform',file:'web/src/render/character/pipelines.ts',
  from:"{ binding: 1, visibility: GPUShaderStage.VERTEX, buffer: { type: 'read-only-storage' } },",
  to:"{ binding: 1, visibility: GPUShaderStage.VERTEX, buffer: { type: 'uniform' } },",expect:'pipeline'},
];

(async()=>{
 fs.mkdirSync(output,{recursive:true});
 const before=hashes();
 const work=fs.mkdtempSync(path.join(root,'.scratch/creator-repair-validation/shader-pipelines-'));
 const copiedSource=path.join(work,'web/src');
 fs.mkdirSync(path.dirname(copiedSource),{recursive:true});
 // No junctions below src: fault injection can never reach production bytes.
 fs.cpSync(path.join(root,'web/src'),copiedSource,{recursive:true,dereference:true});
 for(const file of sourceFiles){assert(sha(fs.readFileSync(path.join(work,file)))===before[file],`Copied source changed during freeze: ${file}`);}
 assert(!fs.lstatSync(copiedSource).isSymbolicLink(),'Copied web/src must be a directory');
 const {createServer}=await import(pathToFileURL(path.join(root,'web/node_modules/vite/dist/node/index.js')).href);
 const server=await createServer({configFile:false,root:path.join(work,'web'),publicDir:false,logLevel:'error',
  server:{host:'127.0.0.1',port:0,strictPort:true,watch:null,fs:{allow:[work]}},
  cacheDir:path.join(work,'.vite')});
 let browser,receipt={command:'node scripts/character-creator-repair/check-shader-pipelines.cjs',harnessSha256:sha(fs.readFileSync(__filename)),frozenAt:new Date().toISOString(),
  productionHashesBefore:before,isolatedSource:work,mutants:[],scope:'Compilation and pipeline validation only. No atlas images, character geometry, game state, pixels or visual acceptance.'};
 try{
  await server.listen();const address=server.httpServer.address();const origin=`http://127.0.0.1:${address.port}`;
  browser=await chromium.launch({channel:'chrome',headless:true});
  async function run(name){
   server.moduleGraph.invalidateAll();
   const context=await browser.newContext(),page=await context.newPage();
   const requests=[];
   page.on('request',request=>requests.push(new URL(request.url()).pathname));
   try{
    await page.route(`${origin}/shader-pipeline-lab`,route=>route.fulfill({contentType:'text/html',body:'<!doctype html><title>Shader pipeline preflight</title><body></body>'}));
    await page.goto(`${origin}/shader-pipeline-lab`);
    const result=await page.evaluate(exercise);
    result.requestedPaths=[...new Set(requests)].sort();
    result.assetRequests=result.requestedPaths.filter(url=>/\.(png|jpg|webp|rgba|bin|r16f|r8)$/.test(url));
    assert(result.assetRequests.length===0,'Preflight unexpectedly requested geometry or atlas assets');
    fs.writeFileSync(path.join(output,`${name}.json`),JSON.stringify(result,null,2)+'\n');
    return result;
   }finally{await context.close();}
  }
  const baseline=await run('baseline');
  receipt.baseline={status:baseline.status,records:baseline.records.length,passed:baseline.records.filter(row=>row.status==='PASS').length,
   expectedRejections:baseline.records.filter(row=>row.status==='EXPECTED_REJECTION').length,patternCoverage:baseline.patternCoverage,adapter:baseline.adapter};
  assert(baseline.status==='PASS','Production pipeline preflight failed; inspect baseline.json');
  console.log(`PASS baseline: ${receipt.baseline.passed} pipelines, ${receipt.baseline.expectedRejections} device-limit rejections`);
  for(const mutation of mutations){
   const file=path.join(work,mutation.file),original=fs.readFileSync(file,'utf8');
   assert(original.split(mutation.from).length===2,`Mutation anchor is not unique: ${mutation.name}`);
   const changed=original.replace(mutation.from,mutation.to);
   let result;
   try{fs.writeFileSync(file,changed);result=await run(mutation.name);}
   finally{fs.writeFileSync(file,original);}
   const failures=result.records.filter(record=>record.status==='FAIL');
   const compilationFailure=failures.some(record=>record.compilation?.some(message=>message.type==='error'));
   const pipelineFailure=failures.some(record=>record.pipelineCreated===false&&record.pipelineError&&record.compilation?.every(message=>message.type!=='error'));
   assert(result.status==='FAIL'&&failures.length>0,`Mutant survived: ${mutation.name}`);
   assert(mutation.expect==='compilation'?compilationFailure:pipelineFailure,`Mutant failed at the wrong boundary: ${mutation.name}`);
   const detail={...mutation,status:'KILLED',sourceBefore:sha(original),sourceMutated:sha(changed),sourceRestored:sha(fs.readFileSync(file)),
    failedPipelines:failures.map(record=>record.name),compilationFailure,pipelineFailure};
   assert(detail.sourceBefore===detail.sourceRestored,`Isolated source restore failed: ${mutation.name}`);
   receipt.mutants.push(detail);console.log(`KILLED ${mutation.name}: ${failures.length} pipeline variants`);
  }
  const restored=await run('restored');
  const signatures=result=>result.records.map(({name,shaderSha256,descriptor,bindingEntries,status})=>({name,shaderSha256,descriptor,bindingEntries,status}));
  assert(restored.status==='PASS','Restored production preflight failed');
  assert(JSON.stringify(signatures(restored))===JSON.stringify(signatures(baseline)),'Restored shader/layout/descriptor signatures differ');
  receipt.restored={status:'PASS',identicalSignatures:true};receipt.status='PASS';
 }catch(error){receipt.status='FAIL';receipt.failure=error.stack;}
 finally{
  if(browser)await browser.close();await server.close();
  receipt.productionHashesAfter=hashes();
  receipt.productionUnchanged=JSON.stringify(receipt.productionHashesBefore)===JSON.stringify(receipt.productionHashesAfter);
  receipt.exitCode=receipt.status==='PASS'&&receipt.productionUnchanged?0:1;
  fs.writeFileSync(path.join(output,'receipt.json'),JSON.stringify(receipt,null,2)+'\n');
 }
 console.log(JSON.stringify({status:receipt.status,productionUnchanged:receipt.productionUnchanged,
  killedMutants:receipt.mutants.length,exitCode:receipt.exitCode,receipt:path.join(output,'receipt.json'),failure:receipt.failure},null,2));
 process.exitCode=receipt.exitCode;
})().catch(error=>{console.error(error);process.exitCode=1;});
