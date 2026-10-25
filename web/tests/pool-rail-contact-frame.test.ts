import {beforeAll,expect,it} from 'vitest';
import key from '../../assets/models/sims/character-creator/pool_activity_key_v2.json';
import {defaultAppearance} from '../src/character/schema.js';
import {PreparedBody} from '../src/render/character/prepared-body.js';
import {anatomicalHeight} from '../src/render/character/shape.js';
import {PoolEntryCompiler} from '../src/render/character/pool-entry-compiler.js';
import {poolEntrySearchPlan} from '../src/render/character/pool-entry-search-plan.js';
import {preparePoolRailContactFrame,requirePoolRailContactFrame,requirePoolRailFrameInstance} from '../src/render/character/pool-rail-contact-frame.js';
import type {Vec3} from '../src/render/character/math.js';
import {identity,multiply} from '../src/render/character/math.js';
import type {PreparedPoolPatch} from '../src/render/character/pool-contact-patch.js';
import {poolBase,poolRig,poolFixture} from './pool-observer-fixture.js';

function setup(){
  const appearance=defaultAppearance('feminine'),shape={presentation:appearance.presentation,...appearance.body,face:appearance.face};
  const selected=new PreparedBody(poolBase,appearance).select(poolRig,appearance,{wear:'bare',prop:'none',fixture:'none',eyes_closed:false,includeFixture:false,clip:'pool_enter',swimwear:'two_piece'});
  const compiler=new PoolEntryCompiler(poolRig.manifest,shape,anatomicalHeight(poolBase.vertices),[selected.body,selected.extra!],poolFixture);
  const domain=compiler.prepareLegDomain(key.phase,poolEntrySearchPlan(key.phase)[key.requestId]);
  const candidate=compiler.compileNodeCandidates(key.phase,{requestId:key.requestId,root:key.rootDelta as unknown as Vec3,trunkPitchDegrees:key.trunk.worldPitchDegrees,headSourcePhase:key.head.sourcePhase})[0];
  const contacts=candidate.contacts.filter(contact=>contact.limb.startsWith('hand'));
  return {geometry:selected.body,cage:domain.cages[0],candidate,contacts,supports:domain.source.limbs};
}
let actual:ReturnType<typeof setup>;beforeAll(()=>{actual=setup();});
function frame(index=0){const contact=actual.contacts[index];return preparePoolRailContactFrame(poolFixture,actual.supports[contact.limb],actual.geometry,actual.cage,actual.candidate.pose.inverse[contact.anatomy.end],contact.patch,contact.orientation,contact.parameter!);}

it('constructs exact full-palm extrema and active patch vertices on the actual finite rail edges',()=>{
  for(let index=0;index<2;index++){
    const contact=actual.contacts[index],value=frame(index);expect(value.vertexCount).toBe(610);expect(value.activeVertex).toBe(index===0?33408:34023);
    expect(value.patchVertices).toContain(value.activeVertex);expect(value.edge.from).toBe(index===0?832:839);expect(value.edge.to).toBe(index===0?846:853);
    expect(value.edgeAmount).toBeGreaterThan(0);expect(value.edgeAmount).toBeLessThan(1);expect(value.exactEdgePoint).toHaveLength(3);expect(value.exactTranslation).toHaveLength(3);
    expect(()=>requirePoolRailFrameInstance(value,actual.candidate.pose.inverse[contact.anatomy.end])).not.toThrow();expect(Object.isFrozen(value.orientation)).toBe(true);
  }
});

it('rejects copied or changed targets and a different actual inverse or support descriptor',()=>{
  const contact=actual.contacts[0],value=frame(),inverse=actual.candidate.pose.inverse[contact.anatomy.end];
  expect(()=>requirePoolRailFrameInstance({...value},inverse)).toThrow('construction');
  expect(()=>requirePoolRailFrameInstance({...value,translation:[value.translation[0]+1e-9,value.translation[1],value.translation[2]]},inverse)).toThrow('construction');
  const changed=[...inverse];changed[12]+=.001;expect(()=>requirePoolRailFrameInstance(value,changed)).toThrow('unchanged physical inputs');
  const support=structuredClone(actual.supports[contact.limb]);if(support.region?.kind!=='rail')throw new Error('Fixture requires rail');support.region.parameter=[1,4];
  expect(()=>requirePoolRailContactFrame(value,poolFixture,actual.geometry,actual.cage,contact.patch,inverse,support)).toThrow('unchanged physical inputs');
});

it('rejects non-rigid selected palm influences before constructing contact',()=>{
  const contact=actual.contacts[0],cage=actual.cage.slice(),vertex=contact.patch.vertices[0].id,indices=new Uint32Array(actual.geometry.stencilWeights),weights=new Float32Array(actual.geometry.stencilWeights);
  const start=actual.geometry.stencilRanges[vertex*4],count=actual.geometry.stencilRanges[vertex*4+1];let changed=false;
  for(let at=start;at<start+count&&!changed;at++)for(let slot=0;slot<4;slot++)if(weights[at*2+1]*cage[indices[at*2]*16+10+slot]!==0){cage[indices[at*2]*16+6+slot]=0;changed=true;break;}
  expect(changed).toBe(true);expect(()=>preparePoolRailContactFrame(poolFixture,actual.supports[contact.limb],actual.geometry,cage,actual.candidate.pose.inverse[contact.anatomy.end],contact.patch,contact.orientation,contact.parameter!)).toThrow('rigid complete-palm');
});

it('rejects a changed rail plane and a source patch that omits the whole-palm active vertex',()=>{
  const contact=actual.contacts[0],fixture=structuredClone(poolFixture),rail=fixture.solids.find(solid=>solid.id===contact.surface)!;(rail.vertices[0] as unknown as number[])[0]+=.1;
  expect(()=>preparePoolRailContactFrame(fixture,actual.supports[contact.limb],actual.geometry,actual.cage,actual.candidate.pose.inverse[contact.anatomy.end],contact.patch,contact.orientation,contact.parameter!)).toThrow();
  const patch={...contact.patch,vertices:contact.patch.vertices.filter(vertex=>vertex.id!==33408)};
  expect(()=>preparePoolRailContactFrame(poolFixture,actual.supports[contact.limb],actual.geometry,actual.cage,actual.candidate.pose.inverse[contact.anatomy.end],patch,contact.orientation,contact.parameter!)).toThrow('source fan');
});

it('rejects a coherent changed orientation whose complete-palm extremum leaves the original patch',()=>{
  const contact=actual.contacts[0],reversed=multiply([-1,0,0,0,0,-1,0,0,0,0,1,0,0,0,0,1],contact.orientation);
  expect(()=>preparePoolRailContactFrame(poolFixture,actual.supports[contact.limb],actual.geometry,actual.cage,actual.candidate.pose.inverse[contact.anatomy.end],contact.patch,reversed,contact.parameter!)).toThrow('extremum is outside');
});

it('binds cage/stencil bytes and the actual rail geometry after construction',()=>{
  const contact=actual.contacts[0],fixture=structuredClone(poolFixture),cage=actual.cage.slice(),inverse=actual.candidate.pose.inverse[contact.anatomy.end];
  const value=preparePoolRailContactFrame(fixture,actual.supports[contact.limb],actual.geometry,cage,inverse,contact.patch,contact.orientation,contact.parameter!);
  cage[0]+=.01;expect(()=>requirePoolRailFrameInstance(value,inverse)).toThrow('coefficients changed');cage[0]=actual.cage[0];
  (fixture.solids.find(solid=>solid.id===contact.surface)!.vertices[832] as unknown as number[])[1]+=.001;expect(()=>requirePoolRailFrameInstance(value,inverse)).toThrow('unchanged physical inputs');
});

it.each(['cage','indices','ranges','weights'].flatMap(field=>['mutation','replacement'].map(mode=>({field,mode}))))('rechecks rail $field bytes after $mode',({field,mode})=>{
  const contact=actual.contacts[0],geometry={...actual.geometry,indices:actual.geometry.indices.slice(),stencilRanges:actual.geometry.stencilRanges.slice(),stencilWeights:actual.geometry.stencilWeights.slice(0)},inverse=actual.candidate.pose.inverse[contact.anatomy.end];let cage=actual.cage.slice();
  const frame=preparePoolRailContactFrame(poolFixture,actual.supports[contact.limb],geometry,cage,inverse,contact.patch,contact.orientation,contact.parameter!);
  const guard=()=>requirePoolRailContactFrame(frame,poolFixture,geometry,cage,contact.patch,inverse,actual.supports[contact.limb]);expect(guard).not.toThrow();
  if(mode==='replacement'){
    if(field==='cage')cage=cage.slice();else if(field==='indices')geometry.indices=geometry.indices.slice();else if(field==='ranges')geometry.stencilRanges=geometry.stencilRanges.slice();else geometry.stencilWeights=geometry.stencilWeights.slice(0);
  }
  const value=field==='cage'?cage:field==='indices'?geometry.indices:field==='ranges'?geometry.stencilRanges:new Uint8Array(geometry.stencilWeights),view=new Uint8Array(value.buffer,value.byteOffset,value.byteLength);view[view.length-1]^=0x80;
  expect(guard).toThrow(field==='cage'&&mode==='replacement'?'unchanged physical inputs':'physical coefficients changed');
});

it('keeps the plane offset divided by each actual positive weight when selecting a non-unit extremum',()=>{
  // This synthetic coefficient control proves the generic h/w term, not body acceptance.
  const cage=new Float32Array(48),stencilWeights=new ArrayBuffer(24),ids=new Uint32Array(stencilWeights),weights=new Float32Array(stencilWeights);
  const positions=[[0,0,0],[.1,0,0],[.2,.1,0]],multipliers=[1,2,1],ranges=new Uint32Array(12);
  positions.forEach((position,index)=>{cage.set(position,index*16);cage[index*16+6]=6;cage[index*16+10]=1;ids[index*2]=index;weights[index*2+1]=multipliers[index];ranges[index*4]=index;ranges[index*4+1]=1;});
  const geometry={...actual.geometry,indices:new Uint32Array([0,1,2]),stencilRanges:ranges,stencilWeights,
    description:{...actual.geometry.description,vertexCount:3,parts:[{...actual.geometry.description.parts.find(part=>part.name==='Relaxed palm')!,start:0,count:3}]}};
  const patch:PreparedPoolPatch={part:'Relaxed palm',bone:6,sourceTriangles:[0],vertices:positions.map((_,index)=>({id:index,coefficient:[cage[index*16]*multipliers[index],cage[index*16+1]*multipliers[index],0,multipliers[index]]})),triangles:[[0,1,2]],area:.005};
  const value=preparePoolRailContactFrame(poolFixture,actual.supports.handL,geometry,cage,identity(),patch,identity(),actual.contacts[0].parameter!);
  expect(value.activeVertex).toBe(1);expect(value.translation[0]).toBe(value.planeX/2-cage[16]);
});
