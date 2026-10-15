import {TILE_HALF_HEIGHT} from '../iso.js';
import manifest from '../../../../assets/models/sims/character-repair/fixture-depth/manifest.json';
import {ATLAS_HEIGHT,ATLAS_PAGE_FILES,ATLAS_WIDTH,SPRITES,SPRITE_ANCHORS,spriteIndex} from '../atlas.js';
import {previewFixtureShaderSource,previewFixturePipelineDescriptor} from './pipelines.js';

const depthFiles=import.meta.glob<string>('../../../../assets/models/sims/character-repair/fixture-depth/*.rgba',{eager:true,query:'?url',import:'default'});
// The reading bundle already turns the authored chair +90 degrees before the preview turn.
const facings=['offlineArmchair','offlineArmchairNE','offlineArmchairNW','offlineArmchairSW'].map(name=>{
  const index=spriteIndex(name),color=SPRITES[index],depth=manifest.sprites.find(row=>row.sprite===index),anchor=SPRITE_ANCHORS[index];
  if(manifest.state!=='complete'||!depth||!anchor||depth.name!==name||color.w!==depth.w||color.h!==depth.h
    ||(color.pixel_density??1)!==depth.pixelDensity)throw new Error('Preview chair color and depth registration differ.');
  return {color,depth,anchor};
});

interface Shared {color:GPUTexture;depth:GPUTexture;pipeline:GPURenderPipeline}
interface Entry {references:number;destroyed:boolean;textures:GPUTexture[];ready?:Promise<Shared>}
interface DeviceState {lost:boolean;entry?:Entry;renderers:Set<PreviewFixtureRenderer>}
interface Lease {shared:Shared;release():void}
const devices=new WeakMap<GPUDevice,DeviceState>();

function destroy(entry:Entry):void {
  if(entry.destroyed)return;
  entry.destroyed=true;for(const texture of entry.textures)texture.destroy();
}
function assertAvailable(state:DeviceState):void {
  if(state.lost)throw new Error('Preview fixture graphics device has been lost.');
}
async function loadShared(device:GPUDevice,state:DeviceState,entry:Entry):Promise<Shared>{
  try{
    const {w,h}=facings[0].color;
    if(facings.some(row=>row.color.w!==w||row.color.h!==h))throw new Error('Preview chair dimensions differ by facing.');
    const make=()=>{const texture=device.createTexture({size:[w,h,facings.length],format:'rgba8unorm',
      usage:GPUTextureUsage.TEXTURE_BINDING|GPUTextureUsage.COPY_DST|GPUTextureUsage.RENDER_ATTACHMENT});entry.textures.push(texture);return texture;};
    const color=make(),depth=make(),module=device.createShaderModule({code:previewFixtureShaderSource});
    const pipeline=device.createRenderPipeline(previewFixturePipelineDescriptor(module));
    for(const page of new Set(facings.map(row=>row.color.page??0))){
      const response=await fetch(`${import.meta.env.BASE_URL}${ATLAS_PAGE_FILES[page]}`);
      if(!response.ok)throw new Error('Preview chair artwork could not load.');
      const bitmap=await createImageBitmap(await response.blob(),{premultiplyAlpha:'none',colorSpaceConversion:'none'});
      try{
        assertAvailable(state);
        if(bitmap.width!==ATLAS_WIDTH||bitmap.height!==ATLAS_HEIGHT)throw new Error('Preview chair atlas dimensions differ.');
        for(const [layer,row] of facings.entries())if((row.color.page??0)===page){
          device.queue.copyExternalImageToTexture({source:bitmap,origin:[row.color.x,row.color.y]},
            {texture:color,origin:[0,0,layer],premultipliedAlpha:false},[w,h]);
        }
      }finally{bitmap.close();}
    }
    for(const pageIndex of new Set(facings.map(row=>row.depth.pageIndex))){
      const page=manifest.pages.find(page=>page.pageIndex===pageIndex);
      const url=page&&Object.entries(depthFiles).find(([name])=>name.endsWith('/'+page.path))?.[1];
      if(!page||!url)throw new Error('Preview chair depth page is missing.');
      const response=await fetch(url);if(!response.ok)throw new Error('Preview chair depth could not load.');
      const data=await response.arrayBuffer();
      if(data.byteLength!==page.width*page.height*4)throw new Error('Preview chair depth length is invalid.');
      const digest=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',data)),byte=>byte.toString(16).padStart(2,'0')).join('');
      if(digest!==page.sha256)throw new Error('Preview chair depth checksum is invalid.');
      assertAvailable(state);
      const bytes=new Uint8Array(data);
      for(const [layer,row] of facings.entries())if(row.depth.pageIndex===pageIndex){
        const crop=new Uint8Array(w*h*4);
        for(let y=0;y<h;y++){
          const start=((row.depth.y+y)*page.width+row.depth.x)*4;
          crop.set(bytes.subarray(start,start+w*4),y*w*4);
        }
        device.queue.writeTexture({texture:depth,origin:[0,0,layer]},crop,{bytesPerRow:w*4},[w,h]);
      }
    }
    assertAvailable(state);return {color,depth,pipeline};
  }catch(error){destroy(entry);throw error;}
}
async function acquire(device:GPUDevice):Promise<Lease>{
  let state=devices.get(device);
  if(!state){
    state={lost:false,renderers:new Set()};devices.set(device,state);const watched=state;
    void device.lost.then(()=>{
      watched.lost=true;for(const renderer of watched.renderers)renderer.destroy();
      if(watched.entry)destroy(watched.entry);
    });
  }
  assertAvailable(state);
  if(!state.entry){state.entry={references:0,destroyed:false,textures:[]};state.entry.ready=loadShared(device,state,state.entry);}
  const entry=state.entry;entry.references++;
  let released=false;
  const release=()=>{if(released)return;released=true;if(--entry.references===0){destroy(entry);if(state.entry===entry)state.entry=undefined;}};
  try{const shared=await entry.ready!;assertAvailable(state);return {shared,release};}catch(error){release();throw error;}
}

/** Published fixture color and registered depth use the actor's scene projection. */
export class PreviewFixtureRenderer {
  private readonly uniform:GPUBuffer;
  private readonly group:GPUBindGroup;
  private readonly data=new Float32Array(12);
  private closed=false;
  private constructor(private readonly device:GPUDevice,private readonly lease:Lease){
    this.uniform=device.createBuffer({size:48,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST});
    try{this.group=device.createBindGroup({layout:lease.shared.pipeline.getBindGroupLayout(0),entries:[
      {binding:0,resource:{buffer:this.uniform}},{binding:1,resource:lease.shared.color.createView({dimension:'2d-array'})},
      {binding:2,resource:lease.shared.depth.createView({dimension:'2d-array'})}]});
    }catch(error){this.uniform.destroy();throw error;}
    devices.get(device)!.renderers.add(this);
  }
  static async create(device:GPUDevice):Promise<PreviewFixtureRenderer>{
    const lease=await acquire(device);
    try{assertAvailable(devices.get(device)!);return new PreviewFixtureRenderer(device,lease);}catch(error){lease.release();throw error;}
  }
  draw(pass:GPURenderPassEncoder,facing:number,placement:{width:number;height:number;scale:number;groundFraction:number}):void {
    if(this.closed)throw new Error('Preview fixture renderer is closed.');
    const layer=((Math.round(facing/(Math.PI/2))%4)+4)%4,{color,anchor}=facings[layer];
    const {width,height,scale,groundFraction}=placement,density=color.pixel_density??1;
    this.data.set([width,height,width*.5,height*groundFraction,color.w/density*scale,color.h/density*scale,anchor[0]*scale,(anchor[1]-TILE_HALF_HEIGHT)*scale,layer,.5,.12,2]);
    this.device.queue.writeBuffer(this.uniform,0,this.data);
    pass.setPipeline(this.lease.shared.pipeline);pass.setBindGroup(0,this.group);pass.draw(6);
  }
  destroy():void {
    if(this.closed)return;this.closed=true;devices.get(this.device)!.renderers.delete(this);this.uniform.destroy();this.lease.release();
  }
}
