const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const root=path.resolve(__dirname,'..');
const ts=require(require.resolve('typescript',{paths:[path.join(root,'web')]}));
const {chromium}=require(require.resolve('playwright',{paths:[root,path.join(process.env.USERPROFILE||process.env.HOME||root,'.cache/codex-runtimes/codex-primary-runtime/dependencies/node')]}));
const output=process.env.ATLAS_PROBE_REPORT||path.join(root,'.scratch/ios-resident-memory/sampling.json');
const report={source:'web/src/render/atlas-storage-shader.ts',sha256:crypto.createHash('sha256').update(fs.readFileSync(path.join(root,'web/src/render/atlas-storage-shader.ts'))).digest('hex')};
(async()=>{
 let browser,server;
 try{
  const javascript=ts.transpileModule(fs.readFileSync(path.join(root,report.source),'utf8'),{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText;
  server=require('node:http').createServer((request,response)=>{response.setHeader('Content-Type',request.url.endsWith('.ts')?'text/javascript':'text/html');response.end(request.url.endsWith('.ts')?javascript:'<!doctype html><title>Atlas sampling verification</title>');});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  browser=await chromium.launch({channel:'chrome',headless:false,args:['--mute-audio']});
  const page=await browser.newPage();
  await page.route('**/atlas-sampling-probe',route=>route.fulfill({contentType:'text/html',body:'<!doctype html><title>Atlas sampling verification</title>'}));
  await page.goto(('http://127.0.0.1:'+server.address().port)+'/atlas-sampling-probe');
  report.result=await page.evaluate(async()=>{
   const {atlasStorageShader}=await import('/src/render/atlas-storage-shader.ts');
   const adapter=await navigator.gpu.requestAdapter();if(!adapter)throw Error('No graphics adapter');
   const device=await adapter.requestDevice();device.pushErrorScope('validation');
   const errors=[];device.addEventListener('uncapturederror',event=>errors.push(event.error.message));
   const resources=[];
   try{
    const size=2048,layers=4,virtualLayers=55,tile=8,border=1,physical=2048,perRow=204,slots=41616;
    const logicalPages=[0,1,27,54],blocks=size/tile;
    const positions=[-2,0,.5,.50390625,1,7.25,7.49609375,7.5,7.50390625,7.75,7.99609375,8,8.00390625,8.5,15.5,15.75,16,23.5,23.99609375,24,30.5,31,31.5,32,34,1023.5,1023.99609375,1024,1024.5,2039.5,2040,2047,2047.5,2048,2050];
    const selected=new Set([...Array.from({length:34},(_,i)=>Math.floor(Math.min(size-1,Math.max(0,i-1))/tile)),...positions.map(v=>Math.floor(Math.min(size-.5,Math.max(.5,v))/tile))]);
    const source=new Uint8Array(size*size*layers*4);
    for(let p=0;p<layers;p++)for(let y=0;y<size;y++)for(let x=0;x<size;x++){
     if(p===3||(p===2&&x>9&&x<22&&y>9&&y<22))continue;
     const i=((p*size+y)*size+x)*4;
     source.set([(x*37+y*19+p*71)%256,(x*11+y*47+p*23)%256,(x*53+y*3+p*83)%256,(x*29+y*7+p*31)%256],i);
    }
    const packed=new Uint8Array(physical*physical*2*4),lookup=new Uint32Array(virtualLayers*blocks*blocks);let next=0;
    for(let p=0;p<layers;p++)for(const by of selected)for(const bx of selected){
     const index=logicalPages[p]*blocks*blocks+by*blocks+bx,slot=(next++*7919)%(slots*2);if(p===3)continue;lookup[index]=slot+1;
     const layer=Math.floor(slot/slots),cell=slot%slots,cx=cell%perRow*10,cy=Math.floor(cell/perRow)*10;
     for(let y=-border;y<tile+border;y++)for(let x=-border;x<tile+border;x++){
      const sx=Math.max(0,Math.min(size-1,bx*tile+x)),sy=Math.max(0,Math.min(size-1,by*tile+y));
      packed.set(source.subarray(((p*size+sy)*size+sx)*4,((p*size+sy)*size+sx)*4+4),((layer*physical+cy+y+border)*physical+cx+x+border)*4);
     }
    }
    const texture=(width,height,depth,data)=>{
     const t=device.createTexture({size:[width,height,depth],format:'rgba8unorm',usage:GPUTextureUsage.TEXTURE_BINDING|GPUTextureUsage.COPY_DST});resources.push(t);
     device.queue.writeTexture({texture:t},data,{bytesPerRow:width*4,rowsPerImage:height},[width,height,depth]);return t;
    };
    const dense=texture(size,size,layers,source),sparse=texture(physical,physical,2,packed);
    const probes=[];
    for(let p=0;p<layers;p++)for(let y=-1;y<=32;y++)for(let x=-1;x<=32;x++)probes.push([x,y,logicalPages[p],0]);
    for(let p=0;p<layers;p++)for(const y of positions)for(const x of positions)probes.push([x/size,y/size,logicalPages[p],1]);
    const inputs=new Float32Array(probes.flat());
    const buffer=(bytes,usage)=>{const b=device.createBuffer({size:bytes,usage});resources.push(b);return b;};
    const maps=buffer(lookup.byteLength,GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST);device.queue.writeBuffer(maps,0,lookup);
    const input=buffer(inputs.byteLength,GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST);device.queue.writeBuffer(input,0,inputs);
    const results=buffer(probes.length*32,GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_SRC);
    const read=buffer(probes.length*32,GPUBufferUsage.MAP_READ|GPUBufferUsage.COPY_DST);
    const code=`@group(0) @binding(0) var atlasTexture:texture_2d_array<f32>;
@group(0) @binding(1) var denseTexture:texture_2d_array<f32>;
@group(0) @binding(2) var atlasSampler:sampler;
struct Lookup{entries:array<u32>}; @group(0) @binding(3) var<storage,read> atlasLookup:Lookup;
struct Vectors{entries:array<vec4f>}; @group(0) @binding(4) var<storage,read> probes:Vectors;
@group(0) @binding(5) var<storage,read_write> results:Vectors;
${atlasStorageShader({virtualSize:size,virtualLayers,tileSize:tile,border,tilesPerRow:perRow})}
@compute @workgroup_size(64) fn main(@builtin(global_invocation_id) id:vec3u){
 if(id.x>=arrayLength(&probes.entries)){return;} let p=probes.entries[id.x];let layer=i32(p.z);let denseLayer=select(select(select(0,1,layer==1),2,layer==27),3,layer==54);
 var reference:vec4f;var actual:vec4f;
 if(p.w==0.){
  reference=vec4f(0.);if(all(p.xy>=vec2f(0.))&&all(p.xy<vec2f(${size}.))){reference=textureLoad(denseTexture,vec2i(p.xy),denseLayer,0);}
  actual=atlasLoad(vec2i(p.xy),layer);
 }else{reference=textureSampleLevel(denseTexture,atlasSampler,p.xy,denseLayer,0.);actual=atlasSample(p.xy,layer);}
 results.entries[id.x*2u]=reference;results.entries[id.x*2u+1u]=actual;
}`;
    const module=device.createShaderModule({code}),messages=await module.getCompilationInfo();
    if(messages.messages.some(m=>m.type==='error'))throw Error(JSON.stringify(messages.messages));
    const pipeline=await device.createComputePipelineAsync({layout:'auto',compute:{module,entryPoint:'main'}});
    const bind=device.createBindGroup({layout:pipeline.getBindGroupLayout(0),entries:[
     {binding:0,resource:sparse.createView({dimension:'2d-array'})},{binding:1,resource:dense.createView({dimension:'2d-array'})},
     {binding:2,resource:device.createSampler({magFilter:'linear',minFilter:'linear'})},
     {binding:3,resource:{buffer:maps}},{binding:4,resource:{buffer:input}},{binding:5,resource:{buffer:results}},
    ]});
    const compare=async()=>{
     const encoder=device.createCommandEncoder(),pass=encoder.beginComputePass();pass.setPipeline(pipeline);pass.setBindGroup(0,bind);pass.dispatchWorkgroups(Math.ceil(probes.length/64));pass.end();
     encoder.copyBufferToBuffer(results,0,read,0,probes.length*32);device.queue.submit([encoder.finish()]);await read.mapAsync(GPUMapMode.READ);
     let mismatches=0,maxDifference=0,first;
     try{const values=new Float32Array(read.getMappedRange());for(let i=0;i<probes.length;i++)for(let c=0;c<4;c++){
      const difference=Math.abs(values[i*8+c]-values[i*8+4+c]);maxDifference=Math.max(maxDifference,difference);
      if(difference!==0){mismatches++;first??={probe:probes[i],channel:c,reference:values[i*8+c],actual:values[i*8+4+c]};}
     }}finally{read.unmap();}return {mismatches,maxDifference,first};
    };
    const correct=await compare();
    // Tile zero's right halo is sampled by fractional probes just before x=8.
    packed.fill(255,(1*physical+9)*4,(1*physical+9)*4+4);
    device.queue.writeTexture({texture:sparse},packed,{bytesPerRow:physical*4,rowsPerImage:physical},[physical,physical,2]);
    const corrupt=await compare(),validation=await device.popErrorScope();if(validation)throw Error(validation.message);
    if(errors.length)throw Error(errors.join('\n'));
    return {probes:probes.length,correct,corrupt,adapter:adapter.info};
   }finally{for(const r of resources)r.destroy();device.destroy();}
  });
  assert.equal(report.result.correct.mismatches,0,'Packed sampling must exactly match the dense texture');
  assert.ok(report.result.corrupt.mismatches>0,'The comparison must reject a corrupt halo');
  report.status='PASS';
 }catch(error){report.status='FAIL';report.failure=String(error);process.exitCode=1;}
 finally{if(browser)await browser.close();if(server)await new Promise(resolve=>server.close(resolve));report.browserClosed=true;report.serverClosed=true;fs.mkdirSync(path.dirname(output),{recursive:true});fs.writeFileSync(output,JSON.stringify(report,null,2));console.log(JSON.stringify(report));}
})();
