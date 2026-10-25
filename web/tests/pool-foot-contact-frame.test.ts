import {expect,it} from 'vitest';
import type {Geometry} from '../src/render/character/bundle.js';
import type {PreparedPoolPatch} from '../src/render/character/pool-contact-patch.js';
import type {PoolFixtureV1,PoolSupport} from '../src/render/character/pool-contact-types.js';
import {identity} from '../src/render/character/math.js';
import {preparePoolFootContactFrame,requirePoolFootContactFrame} from '../src/render/character/pool-foot-contact-frame.js';
import {poolExact,poolRatioNumber,poolRatioRoundingError,poolExactCompare,poolExactMultiply} from '../src/render/character/pool-exact-number.js';

function inputs(){
  const cage=new Float32Array(64),stencils=new ArrayBuffer(32),ids=new Uint32Array(stencils),weights=new Float32Array(stencils);
  [[0,0,0],[.25,0,0],[0,.25,0],[.25,.25,.1]].forEach((p,index)=>{cage.set(p,index*16);cage[index*16+10]=1;ids[index*2]=index;weights[index*2+1]=1;});
  const geometry={indices:new Uint32Array([0,1,2,1,3,2]),stencilWeights:stencils,stencilRanges:new Uint32Array([0,1,0,0,1,1,1,0,2,1,2,0,3,1,3,0]),
    description:{vertexCount:4,parts:[{name:'Synthetic whole foot',start:0,count:6}]}} as unknown as Geometry;
  const patch={part:'Synthetic whole foot',bone:0,vertices:[{id:0},{id:1},{id:2}]} as unknown as PreparedPoolPatch;
  const fixture={ground:{id:'ground',bounds:[[0,0,.5],[1,1,.5]]},solids:[],revisions:{}} as unknown as PoolFixtureV1;
  const support:PoolSupport={mode:'support',surface:'ground',region:{kind:'top-face'},interval:[0,1]};
  return {geometry,cage,patch,fixture,support};
}

it('constructs full-foot nonpenetration and a specific unchanged-patch tangent vertex exactly',()=>{
  const {geometry,cage,patch,fixture,support}=inputs(),inverse=identity();
  const frame=preparePoolFootContactFrame(fixture,support,geometry,cage,inverse,patch,identity(),[.25,.25]);
  expect(frame.translation).toEqual([.25,.25,.5]);expect(frame.translationError).toEqual([0,0,0]);
  expect(frame.patchVertices).toContain(frame.activeVertex);expect(Object.isFrozen(frame.translation)).toBe(true);
  expect(()=>requirePoolFootContactFrame(frame,fixture,geometry,cage,patch)).not.toThrow();
  expect(()=>requirePoolFootContactFrame({...frame},fixture,geometry,cage,patch)).toThrow('certificate');
});

it('requires a unique certified part rather than choosing the first same-named record',()=>{
  const {geometry,cage,patch,fixture,support}=inputs();geometry.description.parts.push({...geometry.description.parts[0]});
  expect(()=>preparePoolFootContactFrame(fixture,support,geometry,cage,identity(),patch,identity(),[.25,.25])).toThrow('unique selected');
});

it('rejects an outside-patch vertex that determines the real supporting plane',()=>{
  const {geometry,cage,patch,fixture,support}=inputs();cage[3*16+2]=-.01;
  expect(()=>preparePoolFootContactFrame(fixture,support,geometry,cage,identity(),patch,identity(),[.25,.25])).toThrow('outside the unchanged required patch');
});

it('preserves actual positive homogeneous weights and refuses mixed-bone or stale ownership',()=>{
  const {geometry,cage,patch,fixture,support}=inputs();for(let at=0;at<cage.length;at+=16)cage[at+10]=.75;
  const frame=preparePoolFootContactFrame(fixture,support,geometry,cage,identity(),patch,identity(),[.25,.25]);
  expect(frame.translation[2]).toBeCloseTo(2/3,15);expect(frame.translationError[2]).toBeGreaterThan(0);
  expect(()=>requirePoolFootContactFrame(frame,{...fixture},geometry,cage,patch)).toThrow();
  cage[6]=1;expect(()=>preparePoolFootContactFrame(fixture,support,geometry,cage,identity(),patch,identity(),[.25,.25])).toThrow('rigid');
});

it('rounds rational contact targets with an exact error and rejects nonfinite inputs',()=>{
  const ratio={numerator:poolExact(1),denominator:poolExact(3)},value=poolRatioNumber(ratio);
  expect(value).toBe(1/3);expect(poolRatioRoundingError(ratio,value)).toBeGreaterThan(0);
  expect(poolExactCompare(poolExactMultiply(poolExact(1.5),poolExact(2)),poolExact(3))).toBe(0);
  expect(()=>poolExact(NaN)).toThrow('finite');expect(()=>poolExact(Infinity)).toThrow('finite');
});

it.each(['cage','indices','ranges','weights'].flatMap(field=>['mutation','replacement'].map(mode=>({field,mode}))))('rechecks required-foot $field bytes after $mode',({field,mode})=>{
  const p=inputs(),frame=preparePoolFootContactFrame(p.fixture,p.support,p.geometry,p.cage,identity(),p.patch,identity(),[.25,.25]);let cage=p.cage;
  const guard=()=>requirePoolFootContactFrame(frame,p.fixture,p.geometry,cage,p.patch);expect(guard).not.toThrow();
  if(mode==='replacement'){
    if(field==='cage')cage=cage.slice();else if(field==='indices')p.geometry.indices=p.geometry.indices.slice();else if(field==='ranges')p.geometry.stencilRanges=p.geometry.stencilRanges.slice();else p.geometry.stencilWeights=p.geometry.stencilWeights.slice(0);
  }
  const value=field==='cage'?cage:field==='indices'?p.geometry.indices:field==='ranges'?p.geometry.stencilRanges:new Uint8Array(p.geometry.stencilWeights),view=new Uint8Array(value.buffer,value.byteOffset,value.byteLength);view[view.length-1]^=0x80;
  expect(guard).toThrow(field==='cage'&&mode==='replacement'?'does not own':'changed physical coefficients');
});
