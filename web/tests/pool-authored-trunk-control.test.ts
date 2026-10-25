import {writeFileSync} from 'node:fs';
import {expect,it} from 'vitest';
import control from '../../assets/models/sims/character-creator/pool_activity_stance_v2.json';
import {defaultAppearance} from '../src/character/schema.js';
import {PreparedBody} from '../src/render/character/prepared-body.js';
import {anatomicalHeight} from '../src/render/character/shape.js';
import {PoolEntryCompiler} from '../src/render/character/pool-entry-compiler.js';
import {poolEntrySearchPlan} from '../src/render/character/pool-entry-search-plan.js';
import {poolSkinMatrices,interpolatePoolPose} from '../src/render/character/pool-contact-sample.js';
import {posedCageSurface} from '../src/render/character/geometry-proof.js';
import type {PoolIntervalLimb} from '../src/render/character/pool-contact-evaluator.js';
import {observePool} from '../src/render/character/pool-observer.js';
import type {Vec3} from '../src/render/character/math.js';
import {poolBase,poolRig,poolFixture} from './pool-observer-fixture.js';

it('carries independently authored trunk lean through the actual fixed-leg and both-rail preparation domain',()=>{
  const appearance=defaultAppearance('feminine'),shape={presentation:appearance.presentation,...appearance.body,face:appearance.face};
  const selected=new PreparedBody(poolBase,appearance).select(poolRig,appearance,{wear:'bare',prop:'none',fixture:'none',eyes_closed:false,includeFixture:false,clip:'pool_enter',swimwear:'two_piece'});
  const compiler=new PoolEntryCompiler(poolRig.manifest,shape,anatomicalHeight(poolBase.vertices),[selected.body,selected.extra!],poolFixture);
  const root=control.rootDelta as unknown as Vec3,witness={requestId:control.requestId,root,trunkPitchDegrees:control.trunk.worldPitchDegrees};
  const request=poolEntrySearchPlan(control.phase)[control.requestId],baselineDomain=compiler.prepareLegDomain(control.phase,request),tiltedDomain=compiler.prepareLegDomain(control.phase,request);
  const baseline=compiler.evaluateLegDomain(baselineDomain,root,request);compiler.applyAuthoredTrunkControl(tiltedDomain,control.trunk.worldPitchDegrees);
  const tilted=compiler.evaluateLegDomain(tiltedDomain,root,request),influenceOwnership=[];
  const geometry=selected.body,ids=new Uint32Array(geometry.stencilWeights),weights=new Float32Array(geometry.stencilWeights),bones=poolRig.manifest.bones,spine=bones.findIndex(bone=>bone.name==='spine');
  const descendsFromSpine=(bone:number):boolean=>{for(let current=bone;current>=0;current=bones[current].parent)if(current===spine)return true;return false;};
  const before=posedCageSurface(geometry,baselineDomain.cages[0],poolSkinMatrices(baseline.pose.world,baseline.pose.inverse)),after=posedCageSurface(geometry,tiltedDomain.cages[0],poolSkinMatrices(tilted.pose.world,tilted.pose.inverse));
  for(const part of geometry.description.parts.filter(part=>/^Creator bare (leg|foot) [LR]$/.test(part.name))){
    const vertices=new Set(geometry.indices.subarray(part.start,part.start+part.count)),influences=new Set<number>();
    for(const vertex of vertices){const start=geometry.stencilRanges[vertex*4],count=geometry.stencilRanges[vertex*4+1];
      for(let at=start;at<start+count;at++)for(let slot=0;slot<4;slot++){const cage=ids[at*2]*16;if(weights[at*2+1]*geometry.cage[cage+10+slot]!==0)influences.add(geometry.cage[cage+6+slot]);}
      for(let axis=0;axis<3;axis++)expect(after[vertex*3+axis]).toBe(before[vertex*3+axis]);
    }
    for(const bone of influences){expect(descendsFromSpine(bone)).toBe(false);expect(tilted.pose.world[bone]).toEqual(baseline.pose.world[bone]);}
    influenceOwnership.push({part:part.name,vertices:vertices.size,bones:[...influences].map(bone=>bones[bone].name),unchangedActualWorld:true,unchangedSelectedPoints:true});
  }
  const upright=compiler.compileNodeCandidates(control.phase,{requestId:control.requestId,root}),oldSearch=compiler.searches.get(control.phase);
  const candidates=compiler.compileNodeCandidates(control.phase,witness),search=compiler.searches.get(control.phase);
  const records=candidates.map(candidate=>({basis:candidate.pose.basis,rest:candidate.pose.rest,projection:candidate.projection,knees:candidate.knees,
    contacts:candidate.contacts.map(contact=>({limb:contact.limb,target:contact.target,pole:contact.pole,orientation:contact.orientation,surface:contact.surface,parameter:contact.parameter,roll:contact.roll,elbowBlend:contact.elbowBlend,frame:contact.frame})),
    observation:candidate.observation,supports:candidate.supports,unresolvedViolations:candidate.unresolvedViolations,arithmetic:candidate.arithmetic.map(({geometry,...proof})=>proof)}));
  expect(candidates).toHaveLength(1);const candidate=candidates[0];
  const controls:PoolIntervalLimb[]=candidate.contacts.map(contact=>{
    const state={target:contact.frame?.translation??contact.railFrame?.translation??contact.target,pole:contact.pole,orientation:contact.orientation};
    return {upper:contact.anatomy.upper,lower:contact.anatomy.lower,end:contact.anatomy.end,anchor:contact.frame||contact.railFrame?[0,0,0,1]:contact.anatomy.anchor,
      legFrame:contact.frame?'source-entry-0':undefined,from:state,to:state};
  });
  const sampled=interpolatePoolPose(poolRig.manifest,candidate.pose.rest,candidate.pose.inverse,candidate.pose.basis,candidate.pose.basis,.5,controls);
  const sampledSurfaces=compiler.geometry.map((geometry,index)=>({geometry,points:posedCageSurface(geometry,tiltedDomain.cages[index],sampled)}));
  let maximumSelectedPointDifference=0;
  for(const [index,surface] of sampledSurfaces.entries()){
    const stored=posedCageSurface(surface.geometry,tiltedDomain.cages[index],candidate.skin);
    for(const part of surface.geometry.description.parts)for(let at=part.start;at<part.start+part.count;at++)for(let axis=0;axis<3;axis++){
      const coordinate=surface.geometry.indices[at]*3+axis;maximumSelectedPointDifference=Math.max(maximumSelectedPointDifference,Math.abs(surface.points[coordinate]-stored[coordinate]));
      if(/^Creator bare (leg|foot) [LR]$/.test(part.name))expect(surface.points[coordinate]).toBe(stored[coordinate]);
    }
  }
  const sampling={amount:.5,controls,maximumSkinDifference:Math.max(...sampled.map((value,index)=>Math.abs(value-candidate.skin[index]))),maximumSelectedPointDifference,
    observation:observePool(poolFixture,sampledSurfaces,baselineDomain.source.limbs)};
  if(process.env.POOL_TRUNK_OUTPUT)writeFileSync(process.env.POOL_TRUNK_OUTPUT,JSON.stringify({scope:'One authored independent trunk causal control. Four original contacts and all actual surface/support gates remain authoritative. No physical admission from necessary reach.',control,influenceOwnership,uprightFullObservations:upright.length,oldSearch,search,records,sampling},null,2));
  expect(search?.attempts[0].basis).not.toEqual(oldSearch?.attempts[0].basis);
  const hands=search?.attempts[0].handClosures as Record<string,{reachable:unknown[];trials:unknown[]}>;
  for(const limb of ['handL','handR']){expect(hands[limb]?.reachable.length,limb).toBeGreaterThan(0);expect(hands[limb]?.trials.length,limb).toBeGreaterThan(0);}
},30000);
