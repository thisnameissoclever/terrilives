import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {afterEach,expect,it,vi} from 'vitest';
import {decodeGeometry,geometryBuffers,type Bundle,type Geometry,type MeshDescription} from '../src/render/character/bundle.js';
import {combineClipFamily,prepareClipFamily,type ClipLibrary,type ClipParts} from '../src/render/character/clip-runtime.js';
import {PreparedBody,assertIndependentBodyParts} from '../src/render/character/prepared-body.js';
import {defaultAppearance} from '../src/character/schema.js';
import {selectGeometry,type AppearanceContext} from '../src/render/character/variants.js';
import {PreparedCharacter} from '../src/render/character/prepared-character.js';
import * as shapes from '../src/render/character/shape.js';
import * as variants from '../src/render/character/variants.js';
import {queryConfiguredSurface} from '../src/render/character/surface-query.js';
import {configuredSurface} from '../src/render/character/configured-surface.js';
import {identity} from '../src/render/character/math.js';
import {configuredPoseForProof as configuredPose} from '../src/render/character/pose.js';
import {posedPositions} from '../src/render/character/geometry-proof.js';
import {prepareMopHandVariant,withBodyVariants} from '../src/render/character/body-variants.js';
import {SubdivisionGpu} from '../src/render/character/subdivision-gpu.js';
import {CharacterRenderer} from '../src/render/character/renderer.js';
import {authoredOutline} from '../src/render/character/authored-surfaces.js';
import {selectGeometry as originalSelection} from './fixtures/head-envelope/variants-original.js';
import {createSleepContactInput} from '../src/render/character/sleep-contact-preparation.js';
import {compileSleepContact} from '../src/render/character/sleep-contact-compile.js';
import {requireSleepingCoverContribution} from '../src/render/character/sleep-contact-sample.js';
import {PreparedSleepingCover} from '../src/render/character/prepared-sleeping-cover.js';
import {poolContactAppearanceKey} from '../src/render/character/pool-contact-identity.js';
import * as poolSampling from '../src/render/character/pool-contact-sample.js';
import type {CharacterPreparation} from '../src/render/character/character-preparation-service.js';
import * as sleepingFit from '../src/render/character/sleep-fit.js';
import {CharacterWorld} from '../src/render/character/world.js';
import type {SimBridge} from '../src/bridge.js';
import {createSleepingCoverFromContributions} from '../src/render/character/sleep-cover.js';

const directory=new URL('../../assets/models/sims/character-creator/',import.meta.url);
const manifest=JSON.parse(readFileSync(new URL('export/manifest.json',directory),'utf8')) as Bundle;
const library=JSON.parse(readFileSync(new URL('clips/clips.json',directory),'utf8')) as ClipLibrary;
function readGeometry(description:MeshDescription,folder:string):Geometry {
  const buffers=Object.fromEntries(geometryBuffers.map(key=>[key,Uint8Array.from(readFileSync(new URL(folder+'/'+description[key],directory))).buffer]));
  return decodeGeometry({...manifest,runtime:description},'runtime',buffers as Record<typeof geometryBuffers[number],ArrayBuffer>);
}
const base=readGeometry(manifest.runtime,'export');
const families=Object.keys(library.sources);
const rigs=families.map(family=>{
  const parts=JSON.parse(readFileSync(new URL('clips/'+family+'/parts.json',directory),'utf8')) as ClipParts;
  return {family,parts,extra:parts.geometry?readGeometry(parts.geometry,'clips/'+family):null};
});

it('selects occupied bath water without drawing a second tub or retaining it after bathing',()=>{
  const family=rigs.find(row=>row.family==='bath')!;
  const rig=prepareClipFamily(base,family.extra,family.parts,library,'bath');
  const appearance=defaultAppearance(),body=new PreparedBody(base,appearance);
  const context={wear:'bare' as const,prop:'none',fixture:'none',eyes_closed:false,clip:'bath',includeFixture:false};
  const dry=body.select(rig,appearance,context);
  expect(dry.extra).toBeNull();
  const wet=body.select(rig,appearance,{...context,includeActivityWater:true});
  expect(wet.extra?.description.parts.map(part=>part.name)).toEqual(['Creator clip bath Bath opaque water surface']);
  expect(wet.extra?.description.parts.every(part=>part.region===12)).toBe(true);
  expect(body.select(rig,appearance,{...context,clip:'idle',includeActivityWater:true}).extra).toBeNull();
  expect(body.select(rig,appearance,context).extra).toBeNull();
  expect(wet.body.description.parts.map(part=>part.name)).toEqual(dry.body.description.parts.map(part=>part.name));
});

afterEach(()=>{vi.restoreAllMocks();vi.unstubAllGlobals();});
it('rejects shared part vertices before hidden geometry can change visible normal adjacency',()=>{
  const source={description:{vertexCount:3,parts:[{name:'Visible head',start:0,count:3},{name:'Hidden accessory',start:3,count:3}]},indices:new Uint32Array([0,1,2,2,1,0])} as unknown as Geometry;
  expect(()=>assertIndependentBodyParts(source)).toThrow('Prepared character parts share vertex 2: Visible head and Hidden accessory');
  expect(()=>assertIndependentBodyParts({...source,description:{...source.description,parts:[{name:'One part',start:0,count:6,region:1,outline:true}]}})).not.toThrow();
  expect(()=>assertIndependentBodyParts(base)).not.toThrow();
});
function recordingDevice(){
  vi.stubGlobal('GPUBufferUsage',{STORAGE:128,INDEX:16,COPY_DST:8,COPY_SRC:4,VERTEX:32,UNIFORM:64});
  vi.stubGlobal('GPUShaderStage',{VERTEX:1,FRAGMENT:2,COMPUTE:4});
  const buffers:{size:number;destroyed:number;destroy():void}[]=[],writes:{buffer:GPUBuffer;data:Float32Array}[]=[];
  const counts={pipelines:0,computes:0};let lose!:(info:GPUDeviceLostInfo)=>void;
  const device={lost:new Promise<GPUDeviceLostInfo>(resolve=>{lose=resolve;}),
    queue:{writeBuffer(buffer:GPUBuffer,_offset:number,data:ArrayBufferView){if(buffer.size===272)writes.push({buffer,data:new Float32Array(data.buffer.slice(data.byteOffset,data.byteOffset+data.byteLength))});},submit(){}},
    createBuffer({size}:{size:number}){const buffer={size,destroyed:0,destroy(){this.destroyed++;}};buffers.push(buffer);return buffer;},
    createBindGroupLayout:()=>({}),createPipelineLayout:()=>({}),createShaderModule:()=>({}),createBindGroup:()=>({}),
    createRenderPipeline(descriptor:GPURenderPipelineDescriptor){counts.pipelines++;return {outline:descriptor.vertex.constants?.outline};},
    createComputePipeline(){counts.pipelines++;return {getBindGroupLayout:()=>({})};},
    createCommandEncoder:()=>({beginComputePass(){counts.computes++;return {setPipeline(){},setBindGroup(){},dispatchWorkgroups(){},end(){}};},finish(){return {};}}),
  } as unknown as GPUDevice;
  return {device,buffers,writes,counts,lose:()=>lose({reason:'destroyed',message:'Test complete'} as GPUDeviceLostInfo)};
}

it('installs changed seated contacts even when the sleeping resource is unchanged',()=>{
  const gpu=recordingDevice(),appearance=defaultAppearance(),rig={base,manifest:base.manifest,supplemental:null,family:''};
  const actor=new PreparedCharacter(gpu.device,rig,appearance,{wear:'clothed',prop:'none',fixture:'none',eyes_closed:false,includeFixture:false,clip:'idle'},256,256);
  const first={seat:{key:'first'}},second={seat:{key:'second'}};
  actor.setContacts(first as Parameters<PreparedCharacter['setContacts']>[0]);const mesh=actor.renderer.resources;mesh.lastPoseKey='idle:0';mesh.lastMatrices=new Float32Array(17*16);
  actor.setContacts(second as Parameters<PreparedCharacter['setContacts']>[0]);expect(mesh.seatContact).toBe(second.seat);expect(mesh.lastPoseKey).toBe('');expect(mesh.lastMatrices).toBeNull();
  actor.destroy();
});

it('keeps body work out of first clip entry and shares pose across independent preview views',async()=>{
  const gpu=recordingDevice(),shape=vi.spyOn(shapes,'shapeVertices'),compact=vi.spyOn(variants,'compactGeometry');
  const appearance=defaultAppearance(),rig={base,manifest:base.manifest,supplemental:null,family:''};
  const context:AppearanceContext={wear:'clothed',prop:'none',fixture:'none',eyes_closed:false,includeFixture:false,clip:'idle'};
  const actor=new PreparedCharacter(gpu.device,rig,appearance,context,256,256);actor.addView(128,128);
  const mesh=actor.renderer.resources,bodyCage=mesh.geometry.cage,bodyCompactions=compact.mock.calls.filter(([source])=>source===base).length;
  const bodyShapes=()=>shape.mock.calls.filter(([source])=>source===bodyCage).length;
  expect(bodyShapes()).toBe(1);expect(actor.view(1).resources).toBe(mesh);
  const placement={width:256,height:256,x:128,y:192,scale:1,depth:.5,step:.12,light:[1,1,1] as const};
  const prepare=(action:string)=>{actor.prepareScene(action,0,0,7,placement,{},0);actor.prepareScene(action,0,1,9,{...placement,width:128,height:128,x:64,y:96},{},1);};
  prepare('idle');expect(gpu.counts.computes).toBe(3);
  const cleaning=rigs.find(row=>row.family==='cleaning')!,clip=prepareClipFamily(base,cleaning.extra,cleaning.parts,library,'cleaning');
  actor.select(clip,appearance,{...context,clip:'mop',grip:'mop'});prepare('mop');
  expect(actor.renderer.resources).toBe(mesh);expect(bodyShapes()).toBe(1);
  expect(compact.mock.calls.filter(([source])=>source===base)).toHaveLength(bodyCompactions);
  expect(gpu.counts.pipelines).toBe(7);expect(gpu.counts.computes).toBe(9);
  const edits=structuredClone(appearance);edits.colors.hair=[34,56,78];edits.freckles=true;edits.freckle_density=37;
  actor.select(clip,edits,{...context,clip:'mop',grip:'mop'});prepare('mop');expect(bodyShapes()).toBe(1);expect(gpu.counts.computes).toBe(9);
  const views=gpu.writes.slice(-4).map(write=>[write.data[6],write.data[48],write.data[50]]);
  expect(views).toEqual([[7,256,128],[7,256,128],[9,128,64],[9,128,64]]);
  const order:number[]=[];const pass={setBindGroup(){},setVertexBuffer(){},setIndexBuffer(){},setPipeline(pipeline:{outline:number}){order.push(pipeline.outline);},drawIndexed(){}} as unknown as GPURenderPassEncoder;
  actor.drawScene(pass);expect(order).toEqual([1,1,0,0]);
  actor.destroy();actor.destroy();expect(gpu.buffers.every(buffer=>buffer.destroyed===1)).toBe(true);
  gpu.lose();await gpu.device.lost;await Promise.resolve();expect(gpu.buffers.every(buffer=>buffer.destroyed===1)).toBe(true);
});

it('prepares Mop hands with the person and reuses them without dispatching inactive hands',async()=>{
  const gpu=recordingDevice(),shape=vi.spyOn(shapes,'shapeVertices'),compact=vi.spyOn(variants,'compactGeometry'),encode=vi.spyOn(SubdivisionGpu.prototype,'encode');
  const appearance=defaultAppearance(),cleaning=rigs.find(row=>row.family==='cleaning')!;
  const cleaningRig=prepareClipFamily(base,cleaning.extra,cleaning.parts,library,'cleaning'),hands=prepareMopHandVariant(cleaningRig);
  const initial=withBodyVariants({base,manifest:base.manifest,supplemental:null,family:''},[hands]),mop=withBodyVariants(cleaningRig,[hands]);
  const context:AppearanceContext={wear:'clothed',prop:'none',fixture:'none',eyes_closed:false,includeFixture:false,clip:'idle'};
  const actor=new PreparedCharacter(gpu.device,initial,appearance,context,256,256);actor.addView(128,128);
  const handShapes=()=>shape.mock.calls.filter(([cage])=>cage===hands.geometry.cage).length;
  const handCompactions=()=>compact.mock.calls.filter(([,parts])=>parts.some(part=>part.name.startsWith('Creator clip cleaning ')&&part.region===4)).length;
  const handBuffers=()=>gpu.buffers.filter(buffer=>buffer.size===hands.geometry.vertices.byteLength).length;
  const handDispatches=()=>encode.mock.contexts.filter(instance=>(instance as SubdivisionGpu).cage.size===hands.geometry.cage.byteLength).length;
  const before={shapes:handShapes(),compactions:handCompactions(),buffers:handBuffers()};expect(before.shapes).toBe(1);
  const placement={width:256,height:256,x:128,y:192,scale:1,depth:.5,step:.12,light:[1,1,1] as const};
  const draw=(action:string)=>{actor.prepareScene(action,0,0,7,placement);actor.prepareScene(action,0,1,9,{...placement,width:128,height:128,x:64,y:96},{},1);};
  draw('idle');expect(handDispatches()).toBe(0);
  for(let entry=0;entry<3;entry++){
    actor.select(mop,appearance,{...context,clip:'mop',grip:'mop'});draw('mop');expect(handDispatches()).toBe(entry+1);
    expect({shapes:handShapes(),compactions:handCompactions(),buffers:handBuffers()}).toEqual(before);
    actor.select(initial,appearance,{...context,clip:'walk'});draw('walk');expect(handDispatches()).toBe(entry+1);
  }
  const edit=structuredClone(appearance);edit.body.height=100;edit.colors.skin=[90,70,50];
  actor.select(initial,edit,{...context,clip:'walk'});draw('walk');expect(handShapes()).toBe(before.shapes+1);
  const fixedShapes=shape.mock.calls.filter(([cage])=>Array.from({length:cage.length/16},(_,i)=>cage[i*16+15]).every(region=>region===7||region>=10)).length;
  actor.select(mop,edit,{...context,clip:'mop',grip:'mop'});draw('mop');
  expect(shape.mock.calls.filter(([cage])=>Array.from({length:cage.length/16},(_,i)=>cage[i*16+15]).every(region=>region===7||region>=10))).toHaveLength(fixedShapes);
  gpu.lose();await gpu.device.lost;await Promise.resolve();expect(gpu.buffers.every(buffer=>buffer.destroyed===1)).toBe(true);
  actor.destroy();expect(gpu.buffers.every(buffer=>buffer.destroyed===1)).toBe(true);
});

it('retains the authored interleaving and material values of hand and prop draws',()=>{
  const gpu=recordingDevice(),appearance=defaultAppearance('feminine'),cleaning=rigs.find(row=>row.family==='cleaning')!;
  const raw=prepareClipFamily(base,cleaning.extra,cleaning.parts,library,'cleaning'),hands=prepareMopHandVariant(raw),rig=withBodyVariants(raw,[hands]);
  const source=combineClipFamily(base,cleaning.extra,cleaning.parts,library,'cleaning');
  const context:AppearanceContext={wear:'clothed',prop:'none',fixture:'none',eyes_closed:false,includeFixture:false,clip:'mop',grip:'mop'};
  const actor=new PreparedCharacter(gpu.device,rig,appearance,context,256,256),body=new PreparedBody(base,appearance);
  const calls=vi.spyOn(CharacterRenderer.prototype,'drawSceneRange').mockImplementation(()=>{});
  const pass={setBindGroup(){},setVertexBuffer(){},setIndexBuffer(){},setPipeline(){},drawIndexed(){}} as unknown as GPURenderPassEncoder;
  for(const [action,clip] of Object.entries(library.clips).filter(([,clip])=>clip.family==='cleaning')){
    const active={...context,clip:action,grip:action==='mop'?'mop' as const:'relaxed' as const};
    const selection=body.select(rig,appearance,active),original=originalSelection(source,appearance,active);
    const expected=original.description.parts.filter(part=>part.name.startsWith('Creator clip cleaning '));
    expect(selection.supplementalDraws.map(draw=>draw.name)).toEqual(expected.map(part=>part.name));
    expect(selection.variants.length).toBe(action==='mop'?1:0);
    for(const draw of selection.supplementalDraws){
      const geometry=draw.owner?.geometry??selection.extra!;
      expect(partVertices(geometry,draw.name)).toBe(partVertices(original,draw.name));
      const part=geometry.description.parts.find(part=>part.name===draw.name)!,index=geometry.vertices[geometry.indices[part.start]*16+14];
      expect(geometry.manifest.materials[index]).toEqual(original.manifest.materials[index]);
    }
    calls.mockClear();actor.select(rig,appearance,active);actor.drawScene(pass);
    for(const phase of ['outline','fill'] as const){
      const actual=calls.mock.calls.flatMap(([,current,range],index)=>current!==phase?[]:(calls.mock.contexts[index] as CharacterRenderer).geometry.description.parts
        .filter(part=>part.start>=range.start&&part.start+part.count<=range.start+range.count).map(part=>part.name));
      expect(actual).toEqual(expected.filter(part=>phase==='fill'||authoredOutline(part.name)).map(part=>part.name));
    }
  }
  actor.destroy();expect(gpu.buffers.every(buffer=>buffer.destroyed===1)).toBe(true);
});

it('sparse contact queries retain the full evaluator Float32 results at every selected vertex',()=>{
  const appearance=defaultAppearance();appearance.body={height:100,build:0,shoulders:100,hips:0,torso:100};
  const geometry=selectGeometry(base,appearance,{wear:'bare',prop:'none',fixture:'none',eyes_closed:false});
  const parts=geometry.description.parts.filter(part=>part.name==='Creator bare leg L'||part.name==='Creator bare leg R');
  expect(parts.length).toBe(2);
  const shape={presentation:appearance.presentation,...appearance.body,face:appearance.face},pose=base.manifest.bones.map(()=>identity()),inverse=base.manifest.bones.map(()=>identity());
  pose[4][12]=.123456789;pose[4][14]=-.034567891;
  const full=configuredSurface(geometry,shape,shapes.anatomicalHeight(geometry.vertices),pose,inverse);
  const sparse=queryConfiguredSurface(geometry,parts,shape,shapes.anatomicalHeight(geometry.vertices),pose,inverse);
  for(const part of parts)for(let at=part.start;at<part.start+part.count;at++){
    const index=geometry.indices[at]*3;expect(sparse.subarray(index,index+3)).toEqual(full.subarray(index,index+3));
  }
});

it('samples a sleeping cover from the existing shaped cage and still uploads the pending surface',async()=>{
  const gpu=recordingDevice(),shape=vi.spyOn(shapes,'shapeVertices'),appearance=defaultAppearance();
  const bed=rigs.find(row=>row.family==='bed')!,rig=prepareClipFamily(base,bed.extra,bed.parts,library,'bed');
  const context:AppearanceContext={wear:'clothed',prop:'none',fixture:'none',eyes_closed:true,includeFixture:false,clip:'bed_sleep'};
  const actor=new PreparedCharacter(gpu.device,rig,appearance,context,256,256),bodyCage=actor.geometry.cage;
  const bunk=rigs.find(row=>row.family==='bunk')!,input=await createSleepContactInput(appearance);
  const contact=compileSleepContact(input,{bed:rig,bunk:prepareClipFamily(base,bunk.extra,bunk.parts,library,'bunk'),revisions:input.revisions});
  actor.renderer.resources.sleepContact=contact;
  const before=shape.mock.calls.filter(([cage])=>cage===bodyCage).length;
  const actual=actor.renderer.preparedSurface('bed_sleep',0);
  expect(shape.mock.calls.filter(([cage])=>cage===bodyCage)).toHaveLength(before);expect(gpu.counts.computes).toBe(0);
  actor.prepareScene('bed_sleep',0,0,1,{width:256,height:256,x:128,y:192,scale:1,depth:.5,step:.12,light:[1,1,1]});
  expect(gpu.counts.computes).toBe(3);shape.mockRestore();
  const expected=posedPositions(actor.geometry,{presentation:appearance.presentation,...appearance.body,face:appearance.face},'bed_sleep',0,shapes.anatomicalHeight(actor.geometry.vertices));
  expect(actual).toEqual(expected);
  gpu.lose();await gpu.device.lost;await Promise.resolve();expect(gpu.buffers.every(buffer=>buffer.destroyed===1)).toBe(true);
  actor.destroy();expect(gpu.buffers.every(buffer=>buffer.destroyed===1)).toBe(true);
});

it('retains cover buffers through first sleep, changed occupancy, reentry and actor replacement',async()=>{
  const gpu=recordingDevice(),appearance=defaultAppearance(),bed=rigs.find(row=>row.family==='bed')!,bunk=rigs.find(row=>row.family==='bunk')!;
  const rig=prepareClipFamily(base,bed.extra,bed.parts,library,'bed'),input=await createSleepContactInput(appearance);
  const contact=compileSleepContact(input,{bed:rig,bunk:prepareClipFamily(base,bunk.extra,bunk.parts,library,'bunk'),revisions:input.revisions});
  const context:AppearanceContext={wear:'clothed',prop:'none',fixture:'none',eyes_closed:true,includeFixture:false,clip:'bed_sleep'};
  const cover=new PreparedSleepingCover(gpu.device,{...base,manifest:rig.manifest},false,256,256),actor=new PreparedCharacter(gpu.device,rig,appearance,context,256,256);
  actor.addView(128,128);actor.renderer.resources.sleepContact=contact;actor.setCoverResource(cover);
  const buffers=gpu.buffers.length,topology=cover.geometry.indices,cage=cover.geometry.cage,vertex=cover.renderer.resources.vertex;
  const fit=vi.spyOn(sleepingFit,'fitSleepingPose').mockImplementation(()=>{throw new Error('Rendering reconstructed a sleeping fit');});
  const left=requireSleepingCoverContribution(contact,'bed_sleep',0),right=requireSleepingCoverContribution(contact,'bed_sleep',-.77);
  const placement={width:256,height:256,x:128,y:192,scale:1,depth:.5,step:.12,light:[1,1,1] as const};
  for(const contributions of [[left],[left,right],[right],[left]]){
    cover.update(contributions);actor.prepareScene('bed_sleep',12.5,0,7,placement);actor.prepareScene('bed_sleep',12.5,0,7,placement,{},1);
    expect(gpu.buffers).toHaveLength(buffers);expect(cover.geometry.indices).toBe(topology);expect(cover.geometry.cage).toBe(cage);expect(cover.renderer.resources.vertex).toBe(vertex);
    const rebuilt=createSleepingCoverFromContributions(actor.geometry,contributions,false);
    expect(cover.renderer.resources.deformed).toEqual(shapes.shapeVertices(rebuilt.cage,cover.renderer.resources.shape,cover.renderer.resources.top));
    actor.setCoverResource(null);actor.setCoverResource(cover);
  }
  expect(fit).not.toHaveBeenCalled();const updates=cover.metrics.updates;cover.update([left]);expect(cover.metrics.updates).toBe(updates);
  const color=structuredClone(appearance);color.colors.shirt=[1,2,3];actor.select(rig,color,context);expect(cover.renderer.resources.vertex).toBe(vertex);
  actor.destroy();expect((vertex as unknown as {destroyed:number}).destroyed).toBe(0);cover.destroy();expect(gpu.buffers.every(buffer=>buffer.destroyed===1)).toBe(true);
  gpu.lose();await gpu.device.lost;await Promise.resolve();expect(gpu.buffers.every(buffer=>buffer.destroyed===1)).toBe(true);
});

it('leaves a shared sleeping cover showing the appearance of the last selection, also when selections repeat unchanged',()=>{
  const gpu=recordingDevice(),bed=rigs.find(row=>row.family==='bed')!,rig=prepareClipFamily(base,bed.extra,bed.parts,library,'bed');
  const first=defaultAppearance(),second=structuredClone(first);second.colors.shirt=[9,8,7];
  const context:AppearanceContext={wear:'clothed',prop:'none',fixture:'none',eyes_closed:true,includeFixture:false,clip:'bed_sleep'};
  const cover=new PreparedSleepingCover(gpu.device,{...base,manifest:rig.manifest},false,256,256);
  const one=new PreparedCharacter(gpu.device,rig,first,context,256,256),two=new PreparedCharacter(gpu.device,rig,second,context,256,256);
  one.setCoverResource(cover);two.setCoverResource(cover);
  const applied:unknown[]=[],set=cover.renderer.setCharacterAppearance.bind(cover.renderer);
  vi.spyOn(cover.renderer,'setCharacterAppearance').mockImplementation(appearance=>{applied.push(appearance);set(appearance);});
  // The first frame selects each actor in full; later frames repeat the same arguments, which return early.
  one.select(rig,first,context);two.select(rig,second,context);expect(applied.at(-1)).toBe(second);
  two.select(rig,second,context);one.select(rig,first,context);expect(applied.at(-1)).toBe(first);
  one.select(rig,first,context);two.select(rig,second,context);expect(applied.at(-1)).toBe(second);
  one.destroy();two.destroy();cover.destroy();
});

it('prepares only live sleeping fixtures and releases their retained cover when removed',()=>{
  const gpu=recordingDevice(),bed=rigs.find(row=>row.family==='bed')!,bunk=rigs.find(row=>row.family==='bunk')!;
  const covers=new Map<number,PreparedSleepingCover>(),geometries=new Map([
    ['bed_sleep',prepareClipFamily(base,bed.extra,bed.parts,library,'bed')],['bunk_sleep',prepareClipFamily(base,bunk.extra,bunk.parts,library,'bunk')],
  ]);
  const world=Object.assign(Object.create(CharacterWorld.prototype),{device:gpu.device,geometries,covers,fixtureRevision:-1}) as CharacterWorld;
  let revision=1,ids=[1,2,3,4],kinds=[0,1,1,1];const models=new Map([[2,'double_bed'],[3,'bed'],[4,'chair']]);
  const source={lotRevision:()=>revision,ids:()=>Uint32Array.from(ids),kinds:()=>Uint8Array.from(kinds),objectModel:(id:number)=>({id:models.get(id)})} as unknown as SimBridge;
  world.prepareFixtures(source);expect([...covers.keys()]).toEqual([2,3]);const count=gpu.buffers.length,bedCover=covers.get(2)!,bunkCover=covers.get(3)!;
  const bedVertex=bedCover.renderer.resources.vertex as unknown as {destroyed:number};
  revision++;world.prepareFixtures(source);expect(gpu.buffers).toHaveLength(count);expect(covers.get(2)).toBe(bedCover);
  ids=[1,3,4];kinds=[0,1,1];revision++;world.prepareFixtures(source);expect(covers.has(2)).toBe(false);expect(covers.get(3)).toBe(bunkCover);
  expect(bedVertex.destroyed).toBe(1);bunkCover.destroy();expect(gpu.buffers.every(buffer=>buffer.destroyed===1)).toBe(true);
});
function partVertices(geometry:Geometry,name:string):string {
  const part=geometry.description.parts.find(part=>part.name===name)!;
  const values=new Float32Array(part.count*16);
  for(let at=0;at<part.count;at++){const id=geometry.indices[part.start+at];values.set(geometry.vertices.subarray(id*16,id*16+16),at*16);}
  return createHash('sha256').update(new Uint8Array(values.buffer)).digest('hex');
}

it.each(rigs)('retains the prepared body and exact selected $family surfaces',({family,parts,extra})=>{
  const appearance=defaultAppearance(),body=new PreparedBody(base,appearance),vertices=body.geometry.vertices,cage=body.geometry.cage;
    const rig=prepareClipFamily(base,extra,parts,library,family),original=combineClipFamily(base,extra,parts,library,family);
    expect(rig.base).toBe(base);
    for(const [action,clip] of Object.entries(library.clips).filter(([,clip])=>clip.family===family)){
      const context:AppearanceContext={wear:['bath','shower'].includes(action)?'bare':'clothed',prop:clip.samples[0].bookVisible?'book':'none',fixture:'none',eyes_closed:clip.samples[0].eyesClosed,clip:action,grip:action==='mop'?'mop':'relaxed',includeFixture:false};
      const selected=body.select(rig,appearance,context),expected=selectGeometry(original,appearance,context);
      expect(selected.body.vertices).toBe(vertices);expect(selected.body.cage).toBe(cage);
      const actual=[selected.body,...selected.extra?[selected.extra]:[]];
      expect(actual.flatMap(geometry=>geometry.description.parts.map(part=>part.name))).toEqual(expected.description.parts.map(part=>part.name));
      for(const geometry of actual)for(const part of geometry.description.parts)expect(partVertices(geometry,part.name),action+': '+part.name).toEqual(partVertices(expected,part.name));
    }
});

it.each(rigs)('preserves exact configured poses and contact diagnostics for every $family clip',({family,parts,extra})=>{
  const rig=prepareClipFamily(base,extra,parts,library,family),source=combineClipFamily(base,extra,parts,library,family);
  for(const presentation of ['masculine','feminine'] as const){
    const appearance=defaultAppearance(presentation);
    appearance.body={height:100,build:0,shoulders:100,hips:0,torso:100};
    const body=new PreparedBody(base,appearance),shape={presentation,...appearance.body,face:appearance.face};
    for(const [action,clip] of Object.entries(library.clips).filter(([,clip])=>clip.family===family)){
      const context:AppearanceContext={wear:['bath','shower'].includes(action)?'bare':'clothed',prop:clip.samples[0].bookVisible?'book':'none',fixture:'none',eyes_closed:clip.samples[0].eyesClosed,clip:action,grip:action==='mop'?'mop':'relaxed',includeFixture:false};
      const actual=body.select(rig,appearance,context).body,expected=selectGeometry(source,appearance,context),top=shapes.anatomicalHeight(expected.vertices);
      expect(shapes.anatomicalHeight(actual.vertices)).toBe(top);
      for(const frame of [...new Set([0,(clip.samples.length-1)/2,clip.samples.length-1])]){
        const expectedAudit={contacts:[],assemblies:{}},actualAudit={contacts:[],assemblies:{}};
        expect(configuredPose(actual.manifest,shape,action,frame,top,actualAudit,actual),action+': '+frame)
          .toEqual(configuredPose(expected.manifest,shape,action,frame,top,expectedAudit,expected));
        expect(actualAudit).toEqual(expectedAudit);
      }
    }
  }
});


it('binds pool contacts on idle entry and physical edits using the actual selected body and garments',()=>{
  const gpu=recordingDevice(),appearance=defaultAppearance(),rig={base,manifest:base.manifest,supplemental:null,family:''};
  const idle:AppearanceContext={wear:'clothed',prop:'none',fixture:'none',eyes_closed:false,includeFixture:false,clip:'idle'};
  const actor=new PreparedCharacter(gpu.device,rig,appearance,idle,256,256);
  const family=rigs.find(row=>row.family==='pool')!,pool=prepareClipFamily(base,family.extra,family.parts,library,'pool');
  const context:AppearanceContext={...idle,wear:'bare',clip:'pool_enter',swimwear:'trunks'};
  const bind=vi.spyOn(poolSampling,'bindPoolContacts').mockImplementation(()=>{}),artifact={key:'pool-test',appearanceKey:poolContactAppearanceKey(appearance)} as CharacterPreparation['pool'];
  try{
    actor.setContacts({pool:artifact} as CharacterPreparation);expect(bind).not.toHaveBeenCalled();
    actor.select(pool,appearance,context);
    const mesh=actor.renderer.resources,call=bind.mock.calls[0];
    expect(call[0]).toBe(artifact);expect(call[1]).toBe(actor.geometry);expect(call[2]).toBe(mesh.shape);expect(call[3]).toBe(mesh.top);
    expect(call[4]).toHaveLength(1);expect(call[4][0].description.parts.some(part=>/trunks/i.test(part.name))).toBe(true);expect(Object.isFrozen(call[5])).toBe(true);
    actor.select(pool,appearance,context);expect(bind).toHaveBeenCalledTimes(1);
    const edited=structuredClone(appearance);edited.body.height=99;
    actor.select(pool,edited,context);expect(bind).toHaveBeenCalledTimes(1);
    actor.setContacts({pool:{key:'pool-edited',appearanceKey:poolContactAppearanceKey(edited)}} as CharacterPreparation);
    expect(bind).toHaveBeenCalledTimes(2);expect(bind.mock.calls[1][2].height).toBe(99);
    const next={key:'pool-replacement',appearanceKey:poolContactAppearanceKey(edited)} as CharacterPreparation['pool'];mesh.lastPoseKey='pool_enter:0';mesh.lastMatrices=new Float32Array(272);
    actor.setContacts({pool:next} as CharacterPreparation);expect(bind).toHaveBeenCalledTimes(3);expect(mesh.poolContact).toBe(next);expect(mesh.lastPoseKey).toBe('');expect(mesh.lastMatrices).toBeNull();
    actor.select(rig,edited,idle);actor.select(pool,edited,context);expect(bind).toHaveBeenCalledTimes(3);
  }finally{actor.destroy();}
});
