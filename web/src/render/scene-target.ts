import {sceneResolveShaderSource,sceneResolvePipelineDescriptor} from './scene-pipeline.js';
import {SCENE_SAMPLE_SCALE,SCENE_COLOR_FORMAT,resolveAnnotationOwner} from './scene-sampling.js';

/** Shared subpixel visibility is resolved before reducing scene color. */
export class SceneTarget {
 readonly color:GPUTexture;
 readonly surface:GPUTexture;
 readonly identity:GPUTexture;
 readonly depth:GPUTexture;
 private annotationTexture:GPUTexture|null=null;
 private annotationOrder:number[]=[];
 private annotationsReady=false;
 readonly width:number;
 readonly height:number;
 private readonly pipeline:GPURenderPipeline;
 private readonly group:GPUBindGroup;
 constructor(private readonly device:GPUDevice,readonly logicalWidth:number,readonly logicalHeight:number,format:GPUTextureFormat){
  this.width=logicalWidth*SCENE_SAMPLE_SCALE;this.height=logicalHeight*SCENE_SAMPLE_SCALE;
  if(this.width>device.limits.maxTextureDimension2D||this.height>device.limits.maxTextureDimension2D)throw new Error('The scene exceeds the graphics device texture size.');
  const make=(format:GPUTextureFormat)=>device.createTexture({size:[this.width,this.height],format,
   usage:GPUTextureUsage.RENDER_ATTACHMENT|GPUTextureUsage.TEXTURE_BINDING|GPUTextureUsage.COPY_SRC});
  this.color=make(SCENE_COLOR_FORMAT);this.surface=make('r32float');this.identity=make('r32uint');this.depth=make('depth24plus');
  const shader=device.createShaderModule({code:sceneResolveShaderSource});
  this.pipeline=device.createRenderPipeline(sceneResolvePipelineDescriptor(shader,format));
  this.group=device.createBindGroup({layout:this.pipeline.getBindGroupLayout(0),entries:[{binding:0,resource:this.color.createView()}]});
 }
 begin(encoder:GPUCommandEncoder):GPURenderPassEncoder{
  this.annotationsReady=false;this.annotationOrder=[];
  return encoder.beginRenderPass({colorAttachments:[
   {view:this.color.createView(),loadOp:'clear',storeOp:'store',clearValue:[.00854,.00854,.01165,1]},
   {view:this.surface.createView(),loadOp:'clear',storeOp:'store',clearValue:[1,0,0,0]},
   {view:this.identity.createView(),loadOp:'clear',storeOp:'store',clearValue:[0,0,0,0]}],
   depthStencilAttachment:{view:this.depth.createView(),depthLoadOp:'clear',depthStoreOp:'store',depthClearValue:1}});
 }
 /** Annotation coverage has its own owner; it cannot replace world depth or identity. */
 beginAnnotations(encoder:GPUCommandEncoder,owners:ArrayLike<number>):GPURenderPassEncoder {
  this.annotationTexture??=this.device.createTexture({size:[this.width,this.height],format:'r32uint',
   usage:GPUTextureUsage.RENDER_ATTACHMENT|GPUTextureUsage.TEXTURE_BINDING|GPUTextureUsage.COPY_SRC});
  this.annotationOrder=Array.from(owners);this.annotationsReady=true;
  if(this.annotationOrder.some(owner=>!Number.isInteger(owner)||owner<=0))throw new Error('Activity annotation requires person ownership.');
  return encoder.beginRenderPass({colorAttachments:[
   {view:this.color.createView(),loadOp:'load',storeOp:'store'},
   {view:this.annotationTexture.createView(),loadOp:'clear',storeOp:'store',clearValue:[0,0,0,0]},
  ]});
 }
 get annotationIdentity():GPUTexture|null{return this.annotationsReady?this.annotationTexture:null;}
 resolve(encoder:GPUCommandEncoder,target:GPUTexture):void{
  const pass=encoder.beginRenderPass({colorAttachments:[{view:target.createView(),loadOp:'clear',storeOp:'store',clearValue:[0,0,0,1]}]});
  pass.setPipeline(this.pipeline);pass.setBindGroup(0,this.group);pass.draw(3);pass.end();
 }
 async pick(x:number,y:number):Promise<number>{
  if(!Number.isInteger(x)||!Number.isInteger(y)||x<0||y<0||x>=this.logicalWidth||y>=this.logicalHeight)return 0;
  const annotation=this.annotationIdentity,order=[...this.annotationOrder];
  const buffer=this.device.createBuffer({size:annotation?1536:1024,usage:GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ});
  try{const encoder=this.device.createCommandEncoder();
   for(const [texture,offset] of [[this.identity,0],[this.surface,512]] as const)
    encoder.copyTextureToBuffer({texture,origin:[x*2,y*2]},{buffer,offset,bytesPerRow:256},[2,2]);
   if(annotation)encoder.copyTextureToBuffer({texture:annotation,origin:[x*2,y*2]},{buffer,offset:1024,bytesPerRow:256},[2,2]);
   this.device.queue.submit([encoder.finish()]);await buffer.mapAsync(GPUMapMode.READ);
   const data=buffer.getMappedRange(),ids=new Uint32Array(data,0,128),depths=new Float32Array(data,512,128);let owner=0,depth=Infinity;
   if(annotation){const annotated=new Uint32Array(data,1024,128),picked=resolveAnnotationOwner([0,1,64,65].map(i=>annotated[i]),order);if(picked)return picked;}
   for(const i of [0,1,64,65])if(ids[i]!==0&&depths[i]<depth){owner=ids[i];depth=depths[i];}
   return owner;
  }finally{buffer.unmap();buffer.destroy();}
 }
 destroy():void{for(const t of [this.color,this.surface,this.identity,this.depth])t.destroy();this.annotationTexture?.destroy();}
}
