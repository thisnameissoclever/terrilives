import {beforeAll,expect,it} from 'vitest';
import baseline from './pool-rail-anatomical-baseline.json';
import {defaultAppearance} from '../src/character/schema.js';
import {PreparedBody} from '../src/render/character/prepared-body.js';
import {anatomicalHeight,shapeVertices} from '../src/render/character/shape.js';
import {PoolEntryCompiler} from '../src/render/character/pool-entry-compiler.js';
import {canonicalPoolPreference} from '../src/render/character/pool-canonical-pose.js';
import {preparePoolRailGeometry,resolvePoolRailContactFrame,bindPoolRailGeometry,requirePoolRailFrameInstance,requirePoolRailGeometryPair} from '../src/render/character/pool-rail-contact-frame.js';
import {resolvePoolLimbState} from '../src/render/character/pool-contact-evaluator.js';
import {poolSourceRecord} from '../src/render/character/pool-source-policy.js';
import {multiply} from '../src/render/character/math.js';
import type {PoolLimb} from '../src/render/character/pool-contact-types.js';
import {poolBase,poolRig,poolFixture} from './pool-observer-fixture.js';

function setup(){
  const appearance=defaultAppearance('feminine'),shape={presentation:appearance.presentation,...appearance.body,face:appearance.face},top=anatomicalHeight(poolBase.vertices);
  const selected=new PreparedBody(poolBase,appearance).select(poolRig,appearance,{wear:'bare',prop:'none',fixture:'none',eyes_closed:false,includeFixture:false,clip:'pool_enter',swimwear:'two_piece'});
  const geometry=[selected.body,selected.extra!],compiler=new PoolEntryCompiler(poolRig.manifest,shape,top,geometry,poolFixture),pose=canonicalPoolPreference(poolRig.manifest,shape,top,'pool_enter',0,geometry);
  return {geometry:selected.body,cage:shapeVertices(selected.body.cage,shape,top),anatomy:compiler.anatomy,pose};
}
let actual:ReturnType<typeof setup>;beforeAll(()=>{actual=setup();});
const yaw=[-1,0,0,0,0,-1,0,0,0,0,1,0,0,0,0,1];
function input(limb:'handL'|'handR',turned=false){
  const fixture=structuredClone(poolFixture),sample=fixture.clips.pool_enter.samples.find(s=>s.phase===.3)!;
  if(turned)[sample.limbs.handL,sample.limbs.handR]=[sample.limbs.handR,sample.limbs.handL];
  const a=actual.anatomy[limb],support=poolSourceRecord(fixture,{action:'pool_enter',phase:.3}).limbs[limb],saved=baseline.records.find(r=>r.limb===limb)!;
  const raw=turned?multiply(yaw,saved.rawOrientation):saved.rawOrientation,location={action:'pool_enter',phase:.3,limb};
  const geometry=preparePoolRailGeometry(fixture,support,actual.geometry,actual.cage,actual.pose.inverse[a.end],a.patch);
  return {fixture,support,a,raw,location,geometry,frame:resolvePoolRailContactFrame(geometry,raw,saved.parameter,undefined,location)};
}

it('preserves every original same-rail frame field against the retained pre-change producer',()=>{
  expect(baseline.producerSha256).toBe('f247766ed7f4cbd8ac27cfb1f09539c2fae8e81b6206669363e4218945bd37b0');
  for(const limb of ['handL','handR'] as const)expect(input(limb).frame).toEqual(baseline.records.find(r=>r.limb===limb)!.frame);
});

it.each(['handL','handR'] as const)('constructs and binds the actual turned %s on its opposite physical rail',limb=>{
  const x=input(limb,true),expectedRail=limb==='handL'?'Pool ladder rail 2':'Pool ladder rail 1';
  expect(x.frame.surface).toBe(expectedRail);expect(x.frame.side).toBe(limb==='handL'?-1:1);expect(x.frame.bone).toBe(x.a.end);
  expect(x.frame.part).toBe(limb==='handL'?'Relaxed palm':'Relaxed palm.001');expect(x.frame.patchVertices).toContain(x.frame.activeVertex);
  requirePoolRailFrameInstance(x.frame,actual.pose.inverse[x.a.end]);
  const copy=structuredClone(x.geometry);bindPoolRailGeometry(copy,x.fixture,x.support,actual.geometry,actual.cage,actual.pose.inverse[x.a.end],x.a.patch,x.location);
  const state={target:x.frame.translation,pole:actual.pose.world[x.a.lower].slice(12,15) as [number,number,number],orientation:x.frame.orientation,attached:{source:x.location,geometry:copy,parameter:3,rawOrientation:x.raw,activeVertex:x.frame.activeVertex}};
  const control={upper:x.a.upper,lower:x.a.lower,end:x.a.end,anchor:[0,0,0,1] as const,from:state,to:state};
  expect(resolvePoolLimbState(control,.5,{action:'pool_enter',phase:.3}).railFrame).toEqual(x.frame);
  expect(()=>resolvePoolLimbState({...control,end:actual.anatomy[limb==='handL'?'handR':'handL'].end},.5)).toThrow('anatomical owner');
  expect(()=>requirePoolRailGeometryPair(input(limb).geometry,x.geometry)).toThrow('incompatible physical ownership');
});

it('rejects wrong anatomical labels, missing or duplicate palms, and real opposite-bone influences',()=>{
  const x=input('handL',true),a=x.a,other=actual.anatomy.handR;
  const prepare=(geometry=actual.geometry,patch=a.patch,cage=actual.cage)=>preparePoolRailGeometry(x.fixture,x.support,geometry,cage,actual.pose.inverse[a.end],patch);
  expect(()=>prepare(actual.geometry,{...a.patch,bone:0})).toThrow('different hand');
  expect(()=>prepare(actual.geometry,{...a.patch,bone:other.end})).toThrow('complete selected palm');
  expect(()=>prepare(actual.geometry,{...a.patch,part:other.patch.part})).toThrow('complete selected palm');
  const without={...actual.geometry,description:{...actual.geometry.description,parts:actual.geometry.description.parts.filter(p=>p.name!==a.patch.part)}};
  expect(()=>prepare(without)).toThrow('complete selected palm');
  const part=actual.geometry.description.parts.find(p=>p.name===a.patch.part)!;
  expect(()=>prepare({...actual.geometry,description:{...actual.geometry.description,parts:[...actual.geometry.description.parts,part]}})).toThrow('complete selected palm');
  const cage=actual.cage.slice(),ids=new Uint32Array(actual.geometry.stencilWeights),weights=new Float32Array(actual.geometry.stencilWeights),vertex=a.patch.vertices[0].id,start=actual.geometry.stencilRanges[vertex*4],count=actual.geometry.stencilRanges[vertex*4+1];let changed=false;
  for(let at=start;at<start+count&&!changed;at++)for(let slot=0;slot<4;slot++)if(weights[at*2+1]*cage[ids[at*2]*16+10+slot]!==0){cage[ids[at*2]*16+6+slot]=other.end;changed=true;break;}
  expect(changed).toBe(true);expect(()=>prepare(actual.geometry,a.patch,cage)).toThrow('rigid complete-palm');expect(input('handL',true).frame).toEqual(x.frame);
});

it('rejects wrong source limbs even when two authentic support records have equal values',()=>{
  const x=input('handL',true),sample=x.fixture.clips.pool_enter.samples.find(s=>s.phase===.3)!;sample.limbs.handR=structuredClone(sample.limbs.handL);
  const wrong={...x.location,limb:'handR' as PoolLimb};
  expect(()=>resolvePoolRailContactFrame(x.geometry,x.raw,3,undefined,wrong)).toThrow('observation source context');
  const copy=structuredClone(x.geometry);
  expect(()=>bindPoolRailGeometry(copy,x.fixture,x.support,actual.geometry,actual.cage,actual.pose.inverse[x.a.end],x.a.patch,wrong)).toThrow('anatomical owner');
  expect(()=>resolvePoolRailContactFrame(copy,x.raw,3)).toThrow('no bound');
  expect(input('handL',true).frame).toEqual(x.frame);
});

it('retains same-phase rail/region, serialized coefficient, and later mesh/revision guards',()=>{
  for(const field of ['surface','region'] as const){const x=input('handL',true),row=x.fixture.clips.pool_enter.samples.find(s=>s.phase===.3)!.limbs.handL;if(field==='surface')row.surface='Pool ladder rail 1';else row.region={kind:'rail',parameter:[1,4]};expect(()=>resolvePoolRailContactFrame(x.geometry,x.raw,3,undefined,x.location)).toThrow('observation source context');}
  const x=input('handL',true),copy=structuredClone(x.geometry);(copy.coefficients[0][0] as {numerator:string}).numerator='999';
  expect(()=>bindPoolRailGeometry(copy,x.fixture,x.support,actual.geometry,actual.cage,actual.pose.inverse[x.a.end],x.a.patch,x.location)).toThrow('actual physical geometry');
  for(const field of ['mesh','revision'] as const){const x=input('handL',true);if(field==='mesh')(x.fixture.solids.find(s=>s.id===x.frame.surface)!.vertices[0] as unknown as number[])[1]+=.001;else x.fixture.revisions.model+='changed';expect(()=>requirePoolRailFrameInstance(x.frame,actual.pose.inverse[x.a.end])).toThrow('unchanged physical inputs');}
  expect(input('handL',true).frame).toEqual(x.frame);
});

it('retains the validated hand identity if a later rig edit changes its bone role',()=>{
  const x=input('handL',true),geometry={...actual.geometry,manifest:{...actual.geometry.manifest,bones:actual.geometry.manifest.bones.map(b=>({...b}))}};
  const owned=preparePoolRailGeometry(x.fixture,x.support,geometry,actual.cage,actual.pose.inverse[x.a.end],x.a.patch);
  geometry.manifest.bones[x.a.end].name='hand.R';
  expect(()=>resolvePoolRailContactFrame(owned,x.raw,3,undefined,{...x.location,limb:'handR'})).toThrow('observation source context');
  const frame=resolvePoolRailContactFrame(owned,x.raw,3,undefined,x.location);
  expect(()=>requirePoolRailFrameInstance(frame,actual.pose.inverse[x.a.end])).toThrow('unchanged physical inputs');
  expect(input('handL',true).frame).toEqual(x.frame);
});
