import {readFileSync,writeFileSync} from 'node:fs';
import {expect,it} from 'vitest';
import {defaultAppearance} from '../src/character/schema.js';
import {PreparedBody} from '../src/render/character/prepared-body.js';
import {prepareClipFamily,type ClipLibrary,type ClipParts,type ProductionClip} from '../src/render/character/clip-runtime.js';
import {canonicalPoolPreference,type PoolHierarchy} from '../src/render/character/pool-canonical-pose.js';
import {anatomicalHeight,shapeVertices} from '../src/render/character/shape.js';
import {poolSkinMatrices} from '../src/render/character/pool-contact-sample.js';
import {posedCageSurface} from '../src/render/character/geometry-proof.js';
import {requirePoolMatrixRepresentation} from '../src/render/character/pool-matrix-producer.js';
import {poolUpper} from '../src/render/character/pool-arithmetic.js';
import * as arithmetic from '../src/render/character/pool-matrix-arithmetic.js';
import {poolBase,poolRig,poolLibrary} from './pool-observer-fixture.js';

function metricControls(pose:PoolHierarchy){
  const owned=(matrix:number[])=>matrix.map((value,at)=>({value,error:requirePoolMatrixRepresentation(matrix)[at]}));
  const rest=pose.rest.map(owned),inverse=rest.map(arithmetic.inverse),basis=pose.basis.map(owned),world:arithmetic.M[]=[],metrics=[];
  for(let bone=0;bone<rest.length;bone++){
    const parent=pose.bundle.bones[bone].parent,local=parent<0?rest[bone]:arithmetic.multiply(inverse[parent],rest[bone]),animated=arithmetic.multiply(local,basis[bone]);
    world.push(parent<0?animated:arithmetic.multiply(world[parent],animated));
    expect(world[bone].map(value=>value.value)).toEqual(pose.world[bone]);
    if(parent<0)continue;
    const actual=arithmetic.length(arithmetic.minus(arithmetic.point(world[bone]),arithmetic.point(world[parent]))),configured=arithmetic.length(arithmetic.point(local));
    const bound=poolUpper(actual.error+configured.error);expect(Math.abs(actual.value-configured.value)).toBeLessThanOrEqual(bound);
    metrics.push({bone:pose.bundle.bones[bone].name,actual:actual.value,configured:configured.value,bound});
  }
  return metrics;
}

it.skipIf(!process.env.POOL_V2_SOURCE_CAPSULE)('canonicalizes actual v2 raw inputs with fixed configured metrics despite positive column-scale preference changes',()=>{
  const capsule=JSON.parse(readFileSync(process.env.POOL_V2_SOURCE_CAPSULE!,'utf8')) as {controls:{action:string;index:number;sample:ProductionClip['samples'][number]}[];joinSamples:ProductionClip['samples'][number][]};
  const parts=JSON.parse(readFileSync(new URL('../../assets/models/sims/character-creator/clips/pool/parts.json',import.meta.url),'utf8')) as ClipParts;
  const source0=capsule.controls.find(control=>control.action==='pool_enter'&&control.index===0)!.sample,neutral=capsule.controls.find(control=>control.action==='pool_enter'&&control.index===8)!.sample;
  const source15=capsule.joinSamples[1];
  const appearance=defaultAppearance('feminine'),shape={presentation:appearance.presentation,...appearance.body,face:appearance.face},top=anatomicalHeight(poolBase.vertices);
  const records=[],poses:PoolHierarchy[]=[];
  for(const scaled of [false,true]){
    const library=structuredClone(poolLibrary) as ClipLibrary;
    library.clips.pool_enter.samples=[source0,source15,neutral].map(sample=>({...structuredClone(sample),rig:[1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1],props:{},eyesClosed:false,bookVisible:false}));
    const forearm=poolRig.manifest.bones.findIndex(bone=>bone.name==='forearm.L');
    if(scaled)for(const sample of library.clips.pool_enter.samples.slice(1))for(let column=0;column<3;column++)for(let row=0;row<3;row++)sample.basis[forearm][column*4+row]*=[.9,1.1,1.2][column];
    const manifest=prepareClipFamily(poolBase,null,parts,library,'pool').manifest;
    const rig={...poolRig,manifest,supplemental:{...poolRig.supplemental!,manifest}};
    const selected=new PreparedBody(poolBase,appearance).select(rig,appearance,{wear:'bare',prop:'none',fixture:'none',eyes_closed:false,includeFixture:false,clip:'pool_enter',swimwear:'two_piece'}),geometry=[selected.body,selected.extra!];
    const pose=canonicalPoolPreference(manifest,shape,top,'pool_enter',1.5,geometry),root=manifest.bones.findIndex(bone=>bone.name==='root'),book=manifest.bones.findIndex(bone=>bone.name==='book');
    for(let bone=0;bone<pose.basis.length;bone++){
      expect(requirePoolMatrixRepresentation(pose.basis[bone]).every(Number.isFinite)).toBe(true);
      if(bone!==root)expect(pose.basis[bone].slice(12,15)).toEqual([0,0,0]);
    }
    expect(pose.basis[book]).toEqual([1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1]);
    const metrics=metricControls(pose),skin=poolSkinMatrices(pose.world,pose.inverse);
    for(const mesh of geometry)expect(posedCageSurface(mesh,shapeVertices(mesh.cage,shape,top),skin).every(Number.isFinite)).toBe(true);
    const bad={...selected.body,cage:selected.body.cage.slice()},ids=new Uint32Array(bad.stencilWeights),weights=new Float32Array(bad.stencilWeights);let changed=false;
    for(const part of bad.description.parts){for(let at=part.start;at<part.start+part.count&&!changed;at++){
      const vertex=bad.indices[at],start=bad.stencilRanges[vertex*4],count=bad.stencilRanges[vertex*4+1];
      for(let coefficient=start;coefficient<start+count&&!changed;coefficient++)for(let slot=0;slot<4;slot++)if(weights[coefficient*2+1]*bad.cage[ids[coefficient*2]*16+10+slot]!==0){bad.cage[ids[coefficient*2]*16+6+slot]=book;changed=true;break;}
    }if(changed)break;}
    expect(changed).toBe(true);expect(()=>canonicalPoolPreference(manifest,shape,top,'pool_enter',1.5,[bad,selected.extra!])).toThrow('inactive book');
    records.push({scaled,samplePairActualPhases:[.15,.2],genericFrame:1.5,metrics,rest:pose.rest,basis:pose.basis,world:pose.world,rootTravel:pose.basis[root].slice(12,15),bookGuardRejected:true});poses.push(pose);
  }
  expect(poses[1].rest).toEqual(poses[0].rest);expect(poses[1].inverse).toEqual(poses[0].inverse);
  const preferenceDifference=Math.max(...poses[0].basis.flatMap((matrix,bone)=>matrix.map((value,at)=>Math.abs(value-poses[1].basis[bone][at]))));
  expect(preferenceDifference).toBeGreaterThan(0);
  if(process.env.POOL_V2_CANONICAL_OUTPUT)writeFileSync(process.env.POOL_V2_CANONICAL_OUTPUT,JSON.stringify({scope:'Actual focused v2 source pair through real clip loader/generic sampler/canonical configured geometry. Metric and ownership controls only; no contact, moving trajectory, bound artifact or displayed-path acceptance.',preferenceDifference,records},null,2));
},30000);
