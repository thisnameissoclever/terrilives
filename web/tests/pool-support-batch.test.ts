import {expect,it,vi} from 'vitest';
import {identity,multiply,type Vec3} from '../src/render/character/math.js';
import {posedCageSurface} from '../src/render/character/geometry-proof.js';
import {observePool,observePoolSource} from '../src/render/character/pool-observer.js';
import {preparePoolFootContactFrame} from '../src/render/character/pool-foot-contact-frame.js';
import {solveCertifiedPoolFoot} from '../src/render/character/pool-limb-construction-arithmetic.js';
import * as arithmetic from '../src/render/character/pool-support-arithmetic.js';
import {observePoolPatchSupport,observePoolPatchSupports,type PoolPatchSupportRequest} from '../src/render/character/pool-support-observer.js';
import {poolFootConstructionFixture} from './pool-foot-construction-fixture.js';
import type {PoolSolid,PoolSupport} from '../src/render/character/pool-contact-types.js';

const free:PoolSupport={mode:'free',surface:null,interval:null,region:null};
function prepared(sourceContext=true){
 const entries=Array.from({length:4},()=>poolFootConstructionFixture()),fixture=entries[0].fixture;
 const [low,high]=fixture.ground.bounds;fixture.ground.bounds=[[low[0],low[1],.7],[high[0],high[1],.7]];
 const support=entries[0].support,limbs={handL:free,handR:free,footL:support,footR:free};
 fixture.clips={pool_enter:{playback:'progress',samples:[{phase:.5,travel:.5,limbs,rootRegion:{anchor:'hips',reference:'authored',minimum:[0,0,0],maximum:[0,0,0]}}],intervals:[{start:0,end:1,limbs}]}};
 const constructed=entries.map((entry,index)=>{
  const {geometry,cage,pose}=entry,patch={...entry.patch,part:'Foot '+index};geometry.description.parts[0].name=patch.part;geometry.vertices=cage.slice();
  const frame=preparePoolFootContactFrame(fixture,support,geometry,cage,pose.inverse[3],patch,identity(),[.3+index*.05,.25]);
  solveCertifiedPoolFoot(pose,1,2,3,frame,[0,0,1]);
  const skin=new Float32Array(64);pose.world.forEach((matrix,bone)=>skin.set(multiply(matrix,pose.inverse[bone]),bone*16));
  return {...entry,patch,fixture,frame,surface:{geometry,points:posedCageSurface(geometry,cage,skin)}};
 });
 const surfaces=constructed.map(entry=>entry.surface),observation=sourceContext?observePoolSource(fixture,surfaces,{action:'pool_enter',phase:.5}):observePool(fixture,surfaces);
 const proofs=constructed.map(p=>arithmetic.derivePoolSupportArithmetic(fixture,p.surface,p.cage,p.pose,p.patch,support,p.frame,observation));
 const requests=constructed.map(({patch})=>({patch,support,phase:.5}));return {fixture,constructed,surfaces,observation,proofs,requests};
}
function compare(p:ReturnType<typeof prepared>,requests:PoolPatchSupportRequest[]=p.requests,proofs=p.proofs){
 const singles=requests.map(r=>observePoolPatchSupport(p.fixture,p.surfaces,r.patch,r.support,r.phase,p.observation,proofs));
 const unresolved=arithmetic.poolViolationsBeyondArithmetic(p.observation,proofs);
 const batch=observePoolPatchSupports(p.fixture,p.surfaces,requests,p.observation,proofs);
 expect(batch.supports).toEqual(singles);expect(batch.unresolved).toEqual(unresolved);
 batch.unresolved.forEach((witness,index)=>expect(witness).toBe(unresolved[index]));return batch;
}

it.each(['required','mixed','free','empty-proofs'] as const)('preserves %s single-request admission',kind=>{
 const p=prepared(kind==='required'||kind==='empty-proofs'),requests=p.requests.map((request,index)=>({...request,support:kind==='free'||kind==='mixed'&&index%2?free:request.support})),proofs=kind==='empty-proofs'?[]:p.proofs;
 const actual=compare(p,requests,proofs);
 if(kind!=='empty-proofs'){expect(actual.supports.every(s=>s.satisfied)).toBe(true);expect(actual.unresolved).toEqual([]);}
});

it('executes whole-body classification once for four required requests',()=>{
 const p=prepared(),spy=vi.spyOn(arithmetic,'poolViolationsBeyondArithmetic');
 try{const result=observePoolPatchSupports(p.fixture,p.surfaces,p.requests,p.observation,p.proofs);expect(result.supports).toHaveLength(4);expect(spy).toHaveBeenCalledTimes(1);}
 finally{spy.mockRestore();}
});

it('executes classification once for all-free requests without accepting a caller verdict',()=>{
 const p=prepared(false),spy=vi.spyOn(arithmetic,'poolViolationsBeyondArithmetic');
 try{
  const requests=p.requests.map(r=>({...r,support:free}));
  const legitimate=observePoolPatchSupports(p.fixture,p.surfaces,requests,p.observation,p.proofs);
  expect(spy).toHaveBeenCalledTimes(1);expect(legitimate.supports.every(s=>s.satisfied)).toBe(true);spy.mockClear();
  // A copied observation cannot borrow the genuine observation's proof authority.
  const observation={...p.observation,violations:[...p.observation.violations]};
  const result=observePoolPatchSupports(p.fixture,p.surfaces,requests,observation,p.proofs);
  expect(spy).toHaveBeenCalledTimes(1);expect(result.unresolved).toEqual(observation.violations);
  expect(result.supports.every(s=>!s.required&&!s.satisfied)).toBe(true);
 }finally{spy.mockRestore();}
});

it('retains lost contact and finite-projection reasons',()=>{
 const lifted=prepared();for(let index=2;index<lifted.surfaces[0].points.length;index+=3)lifted.surfaces[0].points[index]+=.01;
 expect(compare(lifted).supports[0].reasons).toContain('support contact is lost');
 const moved=prepared();for(let index=0;index<moved.surfaces[0].points.length;index+=3)moved.surfaces[0].points[index]+=2;
 expect(compare(moved).supports[0].reasons).toContain('finite patch leaves its support');
});

it('retains unsupported facet-union rejection in a required batch',()=>{
 const p=prepared(false),solid:PoolSolid={id:'concave top',kind:'floor',vertices:[[0,0,.7],[2,0,.7],[1,1,.7],[-1,-.125,.7]],triangles:[[0,1,2],[0,2,3]],bounds:[[-1,-.125,.7],[2,1,.7]]};
 p.surfaces[0].points.set([...solid.vertices[1],...solid.vertices[2],...solid.vertices[3]]);
 for(let vertex=0;vertex<3;vertex++)for(let axis=0;axis<2;axis++)expect(p.surfaces[0].points[vertex*3+axis]).toBe(solid.vertices[vertex+1][axis]);
 p.fixture.solids.push(solid);p.observation=observePool(p.fixture,p.surfaces);
 const requests=p.requests.map((request,index)=>index?request:{...request,support:{mode:'support' as const,surface:solid.id,interval:null,region:{kind:'top-face' as const,triangles:[0,1]}}});
 expect(compare(p,requests).supports[0].reasons).toContain('finite patch support spans an unsupported facet union');
});

it('does not borrow another authentic point row when the consumed row has no violation',()=>{
 const p=prepared(),bound=p.proofs[0].maximumOutputError,first=p.constructed[0],other={geometry:first.geometry,points:first.surface.points.slice()};
 for(let at=2;at<other.points.length;at+=3)other.points[at]+=bound/4;
 const observation=observePoolSource(p.fixture,[first.surface,other,...p.surfaces.slice(1)],{action:'pool_enter',phase:.5});
 const proofs=p.constructed.map(entry=>arithmetic.derivePoolSupportArithmetic(p.fixture,entry.surface,entry.cage,entry.pose,entry.patch,entry.support,entry.frame,observation));
 const result=observePoolPatchSupports(p.fixture,[other,...p.surfaces.slice(1)],p.requests,observation,proofs);
 expect(result.unresolved).toEqual([]);expect(result.supports[0].minimumGap).toBeGreaterThan(0);expect(result.supports[0].minimumGap).toBeLessThan(bound);
 expect(result.supports[0].arithmeticBound).toBe(0);expect(result.supports[0].satisfied).toBe(false);
});

it('authenticates a replaced caller surface wrapper on the next batch',()=>{
 const p=prepared();expect(compare(p).supports[0].satisfied).toBe(true);
 p.surfaces[0].geometry={...p.surfaces[0].geometry};
 const result=compare(p);expect(result.supports[0].arithmeticBound).toBe(0);expect(result.supports[0].satisfied).toBe(false);
});

it('keeps multiple unrelated-solid witnesses in their original order',()=>{
 const p=prepared(),vertices:Vec3[]=[[.4,.3,.69],[.45,.3,.69],[.45,.4,.69],[.4,.4,.69],[.4,.3,.75],[.45,.3,.75],[.45,.4,.75],[.4,.4,.75]];
 const solid:PoolSolid={id:'unrelated obstruction',kind:'solid',vertices,bounds:[[.4,.3,.69],[.45,.4,.75]],triangles:[[0,2,1],[0,3,2],[4,5,6],[4,6,7],[0,1,5],[0,5,4],[1,2,6],[1,6,5],[2,3,7],[2,7,6],[3,0,4],[3,4,7]]};
 p.fixture.solids.push(solid);p.observation=observePoolSource(p.fixture,p.surfaces,{action:'pool_enter',phase:.5});
 const result=compare(p);expect(result.unresolved.filter(w=>w.surface===solid.id).length).toBeGreaterThan(1);
 expect(result.supports.every(s=>s.reasons.includes('selected body intersects a fixture solid'))).toBe(true);
});

it.each(['points','cage','indices','ranges','weights','fixture','part','rig'] as const)('rechecks %s between batches after proof derivation',kind=>{
 const p=prepared();expect(compare(p).supports.every(s=>s.satisfied)).toBe(true);const first=p.constructed[0];
 if(kind==='points')first.surface.points[2]+=.01;
 if(kind==='cage')first.cage[0]+=.01;
 if(kind==='indices')first.geometry.indices[0]=3;
 if(kind==='ranges')first.geometry.stencilRanges[1]=0;
 if(kind==='weights')new Float32Array(first.geometry.stencilWeights)[1]=.5;
 if(kind==='fixture')expect(Reflect.set(p.fixture.ground.bounds[1],0,p.fixture.ground.bounds[1][0]+.1)).toBe(true);
 if(kind==='part')first.geometry.description.parts[0].count-=3;
 if(kind==='rig')first.geometry.manifest.sourceSha256='changed-owner';
 let rejected=false;try{rejected=compare(p).supports[0].arithmeticBound===0;}catch{rejected=true;}
 expect(rejected).toBe(true);
 expect(arithmetic.poolSupportArithmeticBound(p.proofs[0],first.patch.part,first.support.surface!,first.geometry,p.observation,undefined,first.surface)).toBe(0);
});

it('keeps witness identity and exact values authenticated on every new batch',()=>{
 const p=prepared(),witness=p.observation.violations[0];expect(witness).toBeDefined();expect(compare(p).unresolved).toEqual([]);
 p.observation.violations[0]={...witness};expect(compare(p).unresolved).toContain(p.observation.violations[0]);
 p.observation.violations[0]=witness;expect(compare(p).unresolved).toEqual([]);
 const clearance=witness.signedClearance;witness.signedClearance/=2;expect(compare(p).unresolved).toContain(witness);
 witness.signedClearance=clearance;expect(compare(p).unresolved).toEqual([]);
});

it('rejects a different source phase through batch and single wrappers',()=>{
 const p=prepared(),request={...p.requests[0],phase:.6};
 expect(()=>observePoolPatchSupports(p.fixture,p.surfaces,[request],p.observation,p.proofs)).toThrow('phase differs');
 expect(()=>observePoolPatchSupport(p.fixture,p.surfaces,request.patch,request.support,request.phase,p.observation,p.proofs)).toThrow('phase differs');
});
