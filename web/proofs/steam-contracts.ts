import {ShowerSteam} from '../src/render/character/shower-steam.js';
import {SceneTarget} from '../src/render/scene-target.js';

/** Exercise the shipped effect and scene attachments on a real graphics device. */
async function verifySteam(){
 const adapter=await navigator.gpu?.requestAdapter();if(!adapter)throw new Error('No graphics adapter.');
 const device=await adapter.requestDevice(),errors:string[]=[];
 device.addEventListener('uncapturederror',event=>errors.push(event.error.message));
 device.pushErrorScope('validation');
 const target=new SceneTarget(device,192,192,'rgba8unorm'),steam=new ShowerSteam(device);
 const fixture=device.createShaderModule({code:`
 struct V {@builtin(position) position:vec4f};
 @vertex fn vertex(@builtin(vertex_index) i:u32)->V {
  let p=array<vec2f,3>(vec2f(-1,-1),vec2f(3,-1),vec2f(-1,3));var out:V;out.position=vec4f(p[i],0,1);return out;
 }
 struct F {@location(0) color:vec4f,@location(1) surface:f32,@location(2) identity:u32,@builtin(frag_depth) depth:f32};
 @fragment fn fragment(in:V)->F {
  let front=in.position.x>=192.;var out:F;
  out.color=select(vec4f(.08,.12,.18,1),vec4f(.5,.1,.04,1),front);
  out.depth=select(.9,.1,front);out.surface=out.depth;out.identity=select(41u,73u,front);return out;
 }
 struct S {@location(0) color:vec4f,@builtin(frag_depth) depth:f32};
 @fragment fn sentinel()->S {var out:S;out.color=vec4f(.125,.5,.25,1);out.depth=.7;return out;}
 `});
 const opaque=device.createRenderPipeline({layout:'auto',vertex:{module:fixture,entryPoint:'vertex'},
  fragment:{module:fixture,entryPoint:'fragment',targets:[{format:'rgba16float'},{format:'r32float'},{format:'r32uint'}]},
  depthStencil:{format:'depth24plus',depthWriteEnabled:true,depthCompare:'less'}});
 const sentinel=device.createRenderPipeline({layout:'auto',vertex:{module:fixture,entryPoint:'vertex'},
  fragment:{module:fixture,entryPoint:'sentinel',targets:[{format:'rgba16float'}]},
  depthStencil:{format:'depth24plus',depthWriteEnabled:false,depthCompare:'less'}});
 const seed=(encoder:GPUCommandEncoder)=>{const pass=target.begin(encoder);pass.setPipeline(opaque);pass.draw(3);pass.end();};
 const add=()=>steam.add([{centre:[0,0,1.10],radii:[.30,.25,.24]},{centre:[0,0,.75],radii:[.30,.25,.20]}],
  96,150,2,.5,.05,.8,[1,1,1],[-.3825,.3825],0);
 const draw=(effect:boolean,witness=false)=>{
  const encoder=device.createCommandEncoder();seed(encoder);if(effect)steam.draw(encoder,target);
  if(witness){const pass=encoder.beginRenderPass({colorAttachments:[{view:target.color.createView(),loadOp:'load',storeOp:'store'}],
   depthStencilAttachment:{view:target.depth.createView(),depthLoadOp:'load',depthStoreOp:'store'}});
   pass.setPipeline(sentinel);pass.draw(3);pass.end();}
  device.queue.submit([encoder.finish()]);
 };
 const read=async(texture:GPUTexture,bytes:number)=>{
  const stride=Math.ceil(texture.width*bytes/256)*256,buffer=device.createBuffer({size:stride*texture.height,usage:GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ});
  try{const encoder=device.createCommandEncoder();encoder.copyTextureToBuffer({texture},{buffer,bytesPerRow:stride},[texture.width,texture.height]);
   device.queue.submit([encoder.finish()]);await buffer.mapAsync(GPUMapMode.READ);
   const mapped=new Uint8Array(buffer.getMappedRange()),result=new Uint8Array(texture.width*texture.height*bytes);
   for(let y=0;y<texture.height;y++)result.set(mapped.subarray(y*stride,y*stride+texture.width*bytes),y*texture.width*bytes);
   return result;
  }finally{buffer.unmap();buffer.destroy();}
 };
 const capture=async()=>{const [color,surface,identity]=await Promise.all([read(target.color,8),read(target.surface,4),read(target.identity,4)]);return {color,surface,identity};};
 const same=(a:Uint8Array,b:Uint8Array)=>a.length===b.length&&a.every((v,i)=>v===b[i]);
 const require=(value:boolean,message:string)=>{if(!value)throw new Error(message);};
 try{
  draw(false);const baseline=await capture();const picks=await Promise.all([target.pick(80,80),target.pick(110,80)]);
  require(picks[0]===41&&picks[1]===73,'Fixture ownership is invalid.');
  steam.begin();add();draw(true);const active=await capture();let exposed=0,foreground=0;
  for(let pixel=0;pixel<target.width*target.height;pixel++){
   const changed=!same(active.color.subarray(pixel*8,pixel*8+8),baseline.color.subarray(pixel*8,pixel*8+8));
   if(changed){if(pixel%target.width<target.width/2)exposed++;else foreground++;}
  }
  require(same(active.identity,baseline.identity),'Steam overwrote scene identity.');
  require(same(active.surface,baseline.surface),'Steam overwrote physical surface depth.');
  require(exposed>0,'Steam did not affect any exposed sample.');
  require(foreground===0,'Steam drew through nearer solid geometry.');
  const activePicks=await Promise.all([target.pick(80,80),target.pick(110,80)]);
  require(activePicks.every((id,index)=>id===picks[index]),'Steam changed actual scene picks.');
  draw(false,true);const cleanWitness=await capture();draw(true,true);const steamWitness=await capture();
  require(same(cleanWitness.color,steamWitness.color),'Steam wrote hardware depth and blocked the farther witness.');
  steam.begin();draw(true);const empty=await capture();require(same(empty.color,baseline.color),'Cleared steam retained a visible field.');
  add();draw(true);const repeated=await capture();require(same(repeated.color,active.color),'Held steam phase changed on repaint.');
  steam.destroy();steam.destroy();draw(true);const disposed=await capture();require(same(disposed.color,baseline.color),'Disposed steam still draws.');
  await device.queue.onSubmittedWorkDone();const validation=await device.popErrorScope();
  require(!validation,validation?.message??'Graphics validation failed.');require(errors.length===0,errors.join('\n'));
  return {status:'PASS',size:[target.width,target.height],exposedSamples:exposed,foregroundChanges:foreground,
   identityBytes:active.identity.length,surfaceBytes:active.surface.length,picks:activePicks,
   hardwareDepthWitness:true,emptyFieldClears:true,heldPhaseStable:true,disposedDrawInert:true};
 }finally{steam.destroy();target.destroy();device.destroy();}
}
verifySteam().then(result=>{document.querySelector('#result')!.textContent=JSON.stringify(result);})
 .catch(error=>{document.querySelector('#result')!.textContent=JSON.stringify({status:'FAIL',error:String(error)});});
