import {readFileSync} from 'node:fs';
import {afterEach,expect,it,vi} from 'vitest';
import manifest from '../../assets/models/sims/character-repair/fixture-depth/manifest.json';
import {ATLAS_WIDTH,ATLAS_HEIGHT,SPRITES,spriteIndex} from '../src/render/atlas.js';
import {PreviewFixtureRenderer as Renderer} from '../src/render/character/preview-fixture.js';

afterEach(()=>vi.unstubAllGlobals());

function graphics(){
  let lose!:()=>void;
  const textures:{size:unknown;destroyed:number;destroy():void;createView():object}[]=[];
  const buffers:{destroyed:number;destroy():void}[]=[];
  const colorCopies:{source:GPUImageCopyExternalImage;destination:GPUImageCopyTextureTagged;size:GPUExtent3D}[]=[];
  const writes:Float32Array[]=[];
  const depthWrites:Uint8Array[]=[];
  let closed=0;
  vi.stubGlobal('GPUTextureUsage',{TEXTURE_BINDING:4,COPY_DST:2,RENDER_ATTACHMENT:16});
  vi.stubGlobal('GPUBufferUsage',{UNIFORM:64,COPY_DST:8});
  vi.stubGlobal('createImageBitmap',async()=>({width:ATLAS_WIDTH,height:ATLAS_HEIGHT,close(){closed++;}}));
  vi.stubGlobal('fetch',async(url:string)=>{
    if(url.includes('.png'))return new Response(new Uint8Array([1]));
    const page=manifest.pages.find(page=>url.includes(page.path));
    if(!page)throw new Error('Unexpected fixture URL: '+url);
    return new Response(readFileSync(new URL('../../assets/models/sims/character-repair/fixture-depth/'+page.path,import.meta.url)));
  });
  const device={lost:new Promise<void>(resolve=>{lose=resolve;}),
    createTexture({size}:{size:unknown}){const texture={size,destroyed:0,destroy(){this.destroyed++;},createView(){return {};}};textures.push(texture);return texture;},
    createBuffer(){const buffer={destroyed:0,destroy(){this.destroyed++;}};buffers.push(buffer);return buffer;},
    createShaderModule(){return {};},createRenderPipeline(){return {getBindGroupLayout(){return {};}};},createBindGroup(){return {};},
    queue:{copyExternalImageToTexture(source:GPUImageCopyExternalImage,destination:GPUImageCopyTextureTagged,size:GPUExtent3D){colorCopies.push({source,destination,size});},
      writeTexture(_destination:unknown,data:Uint8Array){depthWrites.push(data.slice());},writeBuffer(_buffer:unknown,_offset:number,data:Float32Array){writes.push(data.slice());}}} as unknown as GPUDevice;
  const pass={setPipeline(){},setBindGroup(){},draw(){}} as unknown as GPURenderPassEncoder;
  return {device,pass,textures,buffers,colorCopies,depthWrites,writes,lose,get closed(){return closed;}};
}

it('shares four registered crops and releases them only after the final preview closes',async()=>{
  const gpu=graphics();
  const [first,second]=await Promise.all([Renderer.create(gpu.device),Renderer.create(gpu.device)]);
  expect(gpu.textures.map(texture=>texture.size)).toEqual([[192,240,4],[192,240,4]]);
  // Layer n must copy the atlas record of the nth facing below; reading the origins from the atlas table keeps this check valid when the sprite packer moves the chair.
  const origins=['offlineArmchair','offlineArmchairNE','offlineArmchairNW','offlineArmchairSW'].map(name=>{
    const sprite=SPRITES[spriteIndex(name)];return [sprite.x,sprite.y];
  });
  expect(new Set(origins.map(String)).size).toBe(4);
  expect(gpu.colorCopies.map(copy=>copy.source.origin)).toEqual(origins);
  expect(gpu.colorCopies.map(copy=>copy.destination.origin)).toEqual([[0,0,0],[0,0,1],[0,0,2],[0,0,3]]);
  expect(gpu.closed).toBe(1);
  const depthPage=readFileSync(new URL('../../assets/models/sims/character-repair/fixture-depth/'+manifest.pages[1].path,import.meta.url));
  for(const [index,x] of [960,1536,1152,1344].entries()){
    const crop=gpu.depthWrites[index];expect(crop).toHaveLength(192*240*4);
    expect([...crop.subarray(120*192*4,121*192*4)]).toEqual([...depthPage.subarray(((1184+120)*2048+x)*4,((1184+120)*2048+x+192)*4)]);
  }
  first.destroy();first.destroy();expect(gpu.textures.every(texture=>texture.destroyed===0)).toBe(true);
  second.destroy();expect(gpu.textures.every(texture=>texture.destroyed===1)).toBe(true);
  expect(gpu.buffers.every(buffer=>buffer.destroyed===1)).toBe(true);
});

it('keeps each quarter turn on the source chair origin at both preview scales',async()=>{
  const gpu=graphics(),fixture=await Renderer.create(gpu.device);
  for(const scale of [1,3])for(let turn=0;turn<4;turn++)fixture.draw(gpu.pass,turn*Math.PI/2,{width:96*scale,height:128*scale,scale,groundFraction:.75});
  expect(gpu.writes).toHaveLength(8);
  const camera=JSON.parse(readFileSync(new URL('../../assets/models/living/owner-review-pending/armchair/candidate-03/proof.json',import.meta.url),'utf8'));
  const bundle=JSON.parse(readFileSync(new URL('../../assets/models/sims/character-creator/export/manifest.json',import.meta.url),'utf8'));
  const vertices=new Float32Array(Uint8Array.from(readFileSync(new URL('../../assets/models/sims/character-creator/export/'+bundle.runtime.vertices,import.meta.url))).buffer);
  const indices=new Uint32Array(Uint8Array.from(readFileSync(new URL('../../assets/models/sims/character-creator/export/'+bundle.runtime.indices,import.meta.url))).buffer);
  const ids=new Set<number>();
  for(const part of bundle.runtime.parts)if(part.region===10)for(let i=part.start;i<part.start+part.count;i++)ids.add(indices[i]);
  expect(ids.size).toBe(1520);
  const origin=camera.origin_pixels.map((n:number)=>n/camera.source_density),unit=camera.logical_canvas[1]/camera.ortho_scale;
  for(const [index,data] of gpu.writes.entries()){
    const scale=index<4?1:3;
    expect([...data.subarray(0,6)]).toEqual([96*scale,128*scale,48*scale,96*scale,96*scale,120*scale]);
    const angle=(index%4)*Math.PI/2,c=Math.cos(angle),sn=Math.sin(angle);
    for(const id of ids){
      const v=vertices.subarray(id*16,id*16+3),point=[c*v[0]-sn*v[1],sn*v[0]+c*v[1],v[2]];
      const x=origin[0]+point.reduce((sum,value,i)=>sum+value*camera.camera_matrix[i][0]*unit,0);
      const y=origin[1]-point.reduce((sum,value,i)=>sum+value*camera.camera_matrix[i][1]*unit,0);
      expect(Math.abs(x*scale-data[6]-32*(point[0]+point[1])*scale)).toBeLessThan(1e-4);
      expect(Math.abs(y*scale-data[7]-(21*(point[0]-point[1])-Math.sqrt(1166)*point[2])*scale)).toBeLessThan(1e-4);
    }
    expect(data[8]).toBe(index%4);expect(data[9]).toBe(.5);expect(data[10]).toBeCloseTo(.12);expect(data[11]).toBe(2);
  }
  fixture.destroy();
});

it('rejects lost devices and releases pending resources before recovering on a new device',async()=>{
  const gpu=graphics();
  let resume!:(value:ImageBitmap)=>void;
  vi.stubGlobal('createImageBitmap',()=>new Promise<ImageBitmap>(resolve=>{resume=resolve;}));
  const pending=Renderer.create(gpu.device);
  const rejected=expect(pending).rejects.toThrow('lost');
  await vi.waitFor(()=>expect(resume).toBeTypeOf('function'));
  gpu.lose();await Promise.resolve();
  resume({width:ATLAS_WIDTH,height:ATLAS_HEIGHT,close(){}} as ImageBitmap);
  await rejected;
  expect(gpu.textures.every(texture=>texture.destroyed===1)).toBe(true);
  expect(gpu.colorCopies).toHaveLength(0);
  await expect(Renderer.create(gpu.device)).rejects.toThrow('lost');
  const replacement=graphics(),recovered=await Renderer.create(replacement.device);
  expect(replacement.colorCopies).toHaveLength(4);recovered.destroy();
});

it('destroys a failed upload and permits a later successful attempt on the same device',async()=>{
  const gpu=graphics(),fetchPage=globalThis.fetch;
  vi.stubGlobal('fetch',async(url:string)=>url.includes('.rgba')?new Response(new Uint8Array([0])):fetchPage(url));
  await expect(Renderer.create(gpu.device)).rejects.toThrow('length');
  expect(gpu.textures.every(texture=>texture.destroyed===1)).toBe(true);
  vi.stubGlobal('fetch',fetchPage);
  const retried=await Renderer.create(gpu.device);
  expect(gpu.textures.filter(texture=>texture.destroyed===0)).toHaveLength(2);retried.destroy();
});
