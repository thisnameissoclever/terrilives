import {expect,it,vi} from 'vitest';
import definition from '../../assets/models/sims/character-creator/pool_activity_motion_v14.json';
import {defaultAppearance} from '../src/character/schema.js';
import {createPoolContactInput} from '../src/render/character/pool-contact-preparation.js';
import {poolV14Fixture} from './pool-v14-fixture.js';
import {compileOwnedPoolCycle,measureRawPoolPhysicalObservation,poolOwnedObservationIdentity,type PoolOwnedCompilationCounters} from '../src/render/character/pool-owned-compilation.js';
import {PoolCycleSource,validatePoolCycleDefinition} from '../src/render/character/pool-cycle-source.js';
import {PreparedBody} from '../src/render/character/prepared-body.js';
import {anatomicalHeight} from '../src/render/character/shape.js';
import type {PoolHierarchy} from '../src/render/character/pool-canonical-pose.js';
import type {PoolFootContactFrame} from '../src/render/character/pool-foot-contact-frame.js';
import type {PoolCycleDiagnostic} from '../src/render/character/pool-cycle-compiler.js';
import {PoolSolidIndex} from '../src/render/character/pool-solid.js';
import {poolSourceSupport} from '../src/render/character/pool-source-policy.js';
import {clonePoolMatrix} from '../src/render/character/pool-matrix-producer.js';
import * as observer from '../src/render/character/pool-observer.js';
import * as arithmetic from '../src/render/character/pool-skin-arithmetic.js';
import * as rail from '../src/render/character/pool-rail-contact-frame.js';
import * as orientedLeg from '../src/render/character/pool-oriented-leg.js';
import * as supportArithmetic from '../src/render/character/pool-support-arithmetic.js';
import * as supportObserver from '../src/render/character/pool-support-observer.js';
import {poolBase,poolRig} from './pool-observer-fixture.js';
import {multiply} from '../src/render/character/math.js';

const phases=vi.hoisted(()=>({value:[0,.01,.05,1]}));
vi.mock('../src/render/character/pool-source-policy.js',async original=>({
 ...await original<typeof import('../src/render/character/pool-source-policy.js')>(),
 poolSourceEvents:()=>phases.value,
}));

const bytes=(view:ArrayBufferView)=>Buffer.from(view.buffer,view.byteOffset,view.byteLength);

async function openingSources(){
 const sourceDefinition:unknown=definition;
 validatePoolCycleDefinition(sourceDefinition);
 const appearance=defaultAppearance('feminine'),input=await createPoolContactInput(appearance);
 const selection=new PreparedBody(poolBase,appearance).select(poolRig,appearance,{wear:'bare',prop:'none',fixture:'none',
  eyes_closed:false,includeFixture:false,clip:'pool_enter',swimwear:'two_piece'});
 const sources={bundle:poolRig.manifest,shape:{presentation:appearance.presentation,...appearance.body,face:appearance.face},
  top:anatomicalHeight(poolBase.vertices),geometry:[selection.body,selection.extra!],fixture:poolV14Fixture};
 return {sourceDefinition,input,sources};
}

function singleObservation(sources:Awaited<ReturnType<typeof openingSources>>,phase:number):PoolCycleDiagnostic {
 const previous=phases.value;phases.value=[phase];let row:PoolCycleDiagnostic|undefined;
 try{
  expect(()=>compileOwnedPoolCycle(sources.input,sources.sources,sources.sourceDefinition,value=>{
   row??=value;throw new Error('Single observation control completed.');
  })).toThrow('Single observation control completed.');
  return row!;
 }finally{phases.value=previous;}
}

it('skips unused legacy hand-gap queries while admitting both actual rail contacts',async()=>{
 const sources=await openingSources(),gap=vi.spyOn(PoolSolidIndex.prototype,'minimumTriangleGap');
 try{
  const row=singleObservation(sources,.05);
  expect(row).toMatchObject({action:'pool_enter',phase:.05,stage:'entry-key',passed:true,supports:expect.arrayContaining([
   expect.objectContaining({limb:'handL',required:true,satisfied:true}),
   expect.objectContaining({limb:'handR',required:true,satisfied:true}),
  ])});
  expect(gap.mock.calls.length).toBe(0);
 }finally{gap.mockRestore();}
});

it.each([
 {phase:.01,limb:'handL',mode:'approach'},
 {phase:.22001,limb:'footL',mode:'release'},
] as const)('refuses an absent named solid during nonrequired $mode',async({phase,limb,mode})=>{
 const sources=await openingSources(),fixture=structuredClone(sources.sources.fixture);
 sources.sources.fixture=fixture;
 const support=poolSourceSupport(fixture,{action:'pool_enter',phase,limb});
 expect(support.required).toBe(false);expect(support.support.mode).toBe(mode);
 support.support.surface='Missing test solid';
 const row=singleObservation(sources,phase);
 expect(row).toMatchObject({action:'pool_enter',phase,stage:'entry-key',passed:false});
 expect(row.error?.cause).toMatchObject({cause:{message:'Pool contact names a missing surface: Missing test solid'}});
});

it('refuses an out-of-range authored top facet during nonrequired foot release',async()=>{
 const sources=await openingSources(),fixture=structuredClone(sources.sources.fixture),phase=.22001;
 sources.sources.fixture=fixture;
 const {required,support}=poolSourceSupport(fixture,{action:'pool_enter',phase,limb:'footL'});
 expect(required).toBe(false);expect(support.mode).toBe('release');
 support.region={kind:'top-face',triangles:[100000]};
 const row=singleObservation(sources,phase);
 expect(row).toMatchObject({action:'pool_enter',phase,stage:'entry-key',passed:false});
 expect(row.error?.cause).toMatchObject({cause:{name:'TypeError',message:expect.stringContaining('map')}});
});

it('refuses a sparse resolved top-face row during nonrequired foot release',async()=>{
 const sources=await openingSources(),fixture=structuredClone(sources.sources.fixture),phase=.22001;
 sources.sources.fixture=fixture;
 const {required,support}=poolSourceSupport(fixture,{action:'pool_enter',phase,limb:'footL'});
 expect(required).toBe(false);expect(support.mode).toBe('release');
 const triangles=[2,3];Reflect.deleteProperty(triangles,1);
 support.region={kind:'top-face',triangles};
 const row=singleObservation(sources,phase);
 expect(row).toMatchObject({action:'pool_enter',phase,stage:'entry-key',passed:false});
 expect(row.error?.cause).toMatchObject({cause:{message:'Pool contact names a sparse top-face row.'}});
});

it('refuses an unknown nonfree limb in the actual owned source observation',async()=>{
 const sources=await openingSources(),fixture=structuredClone(sources.sources.fixture),phase=.05;
 sources.sources.fixture=fixture;
 const row=fixture.clips.pool_enter.samples.find(sample=>sample.phase===phase)!;
 expect(row.limbs.handL.mode).toBe('support');
 Object.assign(row.limbs,{handX:structuredClone(row.limbs.handL)});
 const observation=singleObservation(sources,phase);
 expect(observation).toMatchObject({action:'pool_enter',phase,stage:'entry-key',passed:false});
 expect(observation.error?.cause).toMatchObject({cause:{message:'Pool contact names an unknown limb: handX'}});
});

it('ignores unknown free limb entries with null support references',async()=>{
 const sources=await openingSources(),fixture=structuredClone(sources.sources.fixture),phase=.05;
 sources.sources.fixture=fixture;
 const row=fixture.clips.pool_enter.samples.find(sample=>sample.phase===phase)!;
 Object.assign(row.limbs,{handX:{mode:'free',surface:null,interval:null,region:null}});
 expect(singleObservation(sources,phase)).toMatchObject({action:'pool_enter',phase,stage:'entry-key',passed:true});
});

it('reserves the owned source entry for active rows and returns detached raw interval measurements',async()=>{
 const {sourceDefinition,sources}=await openingSources(),{bundle,shape,top,geometry,fixture}=sources;
 const location={action:'pool_enter',phase:.05};
 expect(()=>observer.observeOwnedPoolPhysicalSource(fixture,[],location)).toThrow('requires the active owned rows');
 const source=new PoolCycleSource(bundle,shape,top,geometry,fixture,sourceDefinition);
 const left=source.entry(.01),right=source.entry(.05),measurement=measureRawPoolPhysicalObservation(source,left,right,.5,{...location,phase:.03});
 expect(Object.keys(measurement).sort()).toEqual(['passed','supports','unresolved']);
 expect(measurement.passed).toBe(true);
 expect(measurement.supports).toHaveLength(4);
 const original=structuredClone(measurement);
 measurement.supports[0].reasons.push('edited diagnostic');
 expect(measureRawPoolPhysicalObservation(source,left,right,.5,{...location,phase:.03})).toEqual(original);
});

it('checks the arriving foot at its literal approach key after a free swing',async()=>{
 const {sourceDefinition,sources}=await openingSources(),{bundle,shape,top,geometry,fixture}=sources;
 const source=new PoolCycleSource(bundle,shape,top,geometry,fixture,sourceDefinition);
 const location={action:'pool_enter',phase:.1095},arrival=source.entry(location.phase);
 const foot=source.anatomy.footL.end;
 const turn=[-1,0,0,0,0,-1,0,0,0,0,1,0,0,0,0,1];
 const swing={...arrival,controls:arrival.controls.map(control=>control.end===foot
   ? {...control,state:{...control.state,orientation:multiply(turn,control.state.orientation)}} : control)};
 const atKey=measureRawPoolPhysicalObservation(source,arrival,arrival,0,location);
 expect(atKey.passed).toBe(true);
 expect(measureRawPoolPhysicalObservation(source,swing,arrival,1,location)).toEqual(atKey);
 expect(()=>measureRawPoolPhysicalObservation(source,swing,arrival,.5,location)).toThrow('changing free-foot orientation');
});

it('matches raw topology, exact rail coefficients and arithmetic for the maintained opening poses',async()=>{
 const {sourceDefinition,input,sources}=await openingSources();
 const rawObserve=observer.observePoolSource,partArithmetic=arithmetic.poolPartSurfaceArithmetic,rawRail=rail.preparePoolRailGeometry;
 const ownedObserve=observer.observeOwnedPoolPhysicalSource;
 const reports:{actual:observer.PoolObservation;expected:observer.PoolObservation;scope:()=>object|undefined}[]=[];
 const outputMatches:boolean[]=[],coefficientMatches:boolean[]=[],diagnosticPhases:number[]=[];
 let counters:PoolOwnedCompilationCounters|undefined;
 const observe=vi.spyOn(observer,'observeOwnedPoolPhysicalSource').mockImplementation((fixture,rows,location)=>{
  const actual=ownedObserve(fixture,rows,location),detached=structuredClone({fixture,rows});
  const expected=rawObserve(detached.fixture,detached.rows,location);
  reports.push({actual,expected,scope:()=>poolOwnedObservationIdentity(fixture,actual)});
  return actual;
 });
 const selected=vi.spyOn(arithmetic,'poolPartSurfaceArithmetic').mockImplementation((geometry,cage,world,inverse,vertices,errors)=>{
  const actual=partArithmetic(geometry,cage,world,inverse,vertices,errors);
  const expected=arithmetic.poolSurfaceArithmetic(geometry,cage,world,inverse,new Set(vertices),errors);
  outputMatches.push(bytes(actual.values).equals(bytes(expected.values))&&bytes(actual.errors).equals(bytes(expected.errors)));
  return actual;
 });
 const prepareRail=vi.spyOn(rail,'preparePoolRailGeometry').mockImplementation((fixture,support,geometry,cage,inverse,patch)=>{
  const actual=rawRail(fixture,support,geometry,cage,inverse,patch),detached=structuredClone({fixture,support,geometry,cage,inverse,patch});
  const expected=rawRail(detached.fixture,detached.support,detached.geometry,detached.cage,detached.inverse,detached.patch);
  coefficientMatches.push(JSON.stringify(actual.coefficients)===JSON.stringify(expected.coefficients));
  return actual;
 });
 try{
  expect(()=>compileOwnedPoolCycle(input,sources,sourceDefinition,row=>{
   if(row.passed){
    diagnosticPhases.push(row.phase);
    row.world![0][0]=42;row.basis![0][0]=42;row.skin![0]=42;
    row.program!.preferenceBasis[0][0]=42;
    (row.raw as unknown[]).push({part:'edited diagnostic'});
   }
   if(row.phase>=.05)throw new Error('Opening observation controls completed.');
  },summary=>{counters=summary;})).toThrow('Opening observation controls completed.');
  expect(diagnosticPhases).toEqual([0,.01,.05]);
  expect(reports).toHaveLength(3);
  for(const {actual,expected,scope} of reports){
   expect(expected.contacts).toHaveLength(4);
   expect(actual).toEqual({...expected,contacts:[]});
   expect(scope()).toBeUndefined();
  }
  expect(outputMatches.length).toBeGreaterThan(3);
  expect(outputMatches.every(Boolean)).toBe(true);
  expect(coefficientMatches).toEqual([true,true]);
  expect(counters?.topologyTriangles).toBeGreaterThan(0);
  expect(counters?.dependencyPlans).toBeLessThan(counters?.arithmeticRuns??0);
 }finally{prepareRail.mockRestore();selected.mockRestore();observe.mockRestore();}
});

it('requires the active replay even for an independently constructed foot on the same dataset',async()=>{
 const {sourceDefinition,input,sources}=await openingSources();
 const solve=orientedLeg.solvePoolOrientedFoot,derive=supportArithmetic.derivePoolSupportArithmetic;
 const alternate=new WeakMap<PoolFootContactFrame,PoolHierarchy>(),refusals:(string|undefined)[]=[];
 const capture=vi.spyOn(orientedLeg,'solvePoolOrientedFoot').mockImplementation((pose,upper,lower,end,frame)=>{
  const other={...pose,basis:pose.basis.map(clonePoolMatrix),world:pose.world.map(matrix=>[...matrix])};
  solve(other,upper,lower,end,frame);
  alternate.set(frame,other);
  return solve(pose,upper,lower,end,frame);
 });
 const inspect=vi.spyOn(supportArithmetic,'derivePoolSupportArithmetic').mockImplementation((fixture,surface,cage,pose,patch,support,frame,observation)=>{
  const proof=derive(fixture,surface,cage,pose,patch,support,frame,observation);
  if(!refusals.length&&frame&&observation){
   const other=alternate.get(frame)!;
   const path=new Set<number>();
   for(let bone=frame.bone;bone>=0;bone=pose.bundle.bones[bone].parent)path.add(bone);
   other.world=pose.world.map((matrix,bone)=>path.has(bone)?other.world[bone]:[...matrix]);
   for(const candidate of [other,{...other,inverse:other.inverse.map(matrix=>[...matrix])},{...other,bundle:structuredClone(other.bundle)}]){
    let message:string|undefined;
    try{derive(fixture,surface,cage,candidate,patch,support,frame,observation);}
    catch(error){message=(error as Error).message;}
    refusals.push(message);
   }
  }
  return proof;
 });
 try{
  expect(()=>compileOwnedPoolCycle(input,sources,sourceDefinition,()=>{throw new Error('Active replay control completed.');})).toThrow('Active replay control completed.');
  expect(refusals).toEqual(Array(3).fill('Pool arithmetic requires its actual sealed replay pose and configured inputs.'));
 }finally{inspect.mockRestore();capture.mockRestore();}
});

it('seals live witness scalars, geometry and violation membership before patch admission',async()=>{
 const {sourceDefinition,input,sources}=await openingSources(),admit=supportObserver.observePoolPatchSupports;
 const attempted:boolean[]=[],bounds:number[]=[];
 const inspect=vi.spyOn(supportObserver,'observePoolPatchSupports').mockImplementation((fixture,surfaces,requests,observation,proofs)=>{
  if(!attempted.length){
   expect(poolOwnedObservationIdentity(fixture,observation)).toBeDefined();
   const list=observation.violations,witness=list.find(row=>row.point!==null)!;
   expect(witness.signedClearance).toBeLessThan(0);
   const proof=proofs?.find(row=>row.part===witness.part&&row.surface===witness.surface)!;
   const row=surfaces.find(surface=>surface.geometry===proof.geometry)!;
   const bound=(value:typeof witness,points:Float32Array<ArrayBuffer>)=>supportArithmetic.poolSupportArithmeticBound(
    proof,witness.part!,witness.surface,row.geometry,observation,value,{geometry:row.geometry,points});
   bounds.push(bound(witness,row.points),bound({...witness,signedClearance:0},row.points),bound(witness,row.points.slice()));
   const index=list.indexOf(witness),clearance=witness.signedClearance,point=witness.point!,coordinate=point[0];
   attempted.push(Reflect.set(witness,'signedClearance',0),Reflect.set(point,0,coordinate+1),
    Reflect.set(list,index,{...witness}),Reflect.set(observation,'violations',[]));
   if(attempted[0])Reflect.set(witness,'signedClearance',clearance);
   if(attempted[1])Reflect.set(point,0,coordinate);
   if(attempted[2])Reflect.set(list,index,witness);
   if(attempted[3])Reflect.set(observation,'violations',list);
   expect(observation.violations[index]).toBe(witness);
  }
  return admit(fixture,surfaces,requests,observation,proofs);
 });
 try{
  expect(()=>compileOwnedPoolCycle(input,sources,sourceDefinition,()=>{throw new Error('Live witness control completed.');})).toThrow('Live witness control completed.');
  expect(attempted).toEqual([false,false,false,false]);
  expect(bounds[0]).toBeGreaterThan(0);expect(bounds.slice(1)).toEqual([0,0]);
 }finally{inspect.mockRestore();}
});
