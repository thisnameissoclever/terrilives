import {expect,it} from 'vitest';
import {defaultAppearance} from '../src/character/schema.js';
import {PreparedBody} from '../src/render/character/prepared-body.js';
import {anatomicalHeight} from '../src/render/character/shape.js';
import {PoolEntryCompiler} from '../src/render/character/pool-entry-compiler.js';
import {poolEntrySearchPlan} from '../src/render/character/pool-entry-search-plan.js';
import {clonePoolMatrix,requirePoolMatrixRepresentation,preparePoolOrientedLeg,requirePoolOrientedLeg,requirePoolOrientedLegReference} from '../src/render/character/pool-matrix-producer.js';
import {solvePoolOrientedFoot,observeConstructedPoolLeg,poolLegFrameDiagnostic} from '../src/render/character/pool-oriented-leg.js';
import {poolKneePolicies,observePoolKneeBranch} from '../src/render/character/pool-knee-branch.js';
import {properPoolRotation} from '../src/render/character/pool-canonical-pose.js';
import {poolAdd,poolMultiply,poolNumber} from '../src/render/character/pool-arithmetic.js';
import {poolBase,poolRig,poolFixture} from './pool-observer-fixture.js';
import literals from './pool-knee-branch-literals.json';
import {writeFileSync} from 'node:fs';
import {orientedPoolLegMath,type OrientedLegInput} from '../src/render/character/pool-oriented-leg-math.js';
import * as tracked from '../src/render/character/pool-matrix-arithmetic.js';
import {translatePoolRoot} from '../src/render/character/pool-canonical-pose.js';
import {poolRootRayIntervals} from '../src/render/character/pool-entry-domain.js';
import {scale} from '../src/render/character/math.js';
import {interpolatePoolHierarchy,interpolatePoolPose,poolSkinMatrices,poolIntervalPreference} from '../src/render/character/pool-contact-sample.js';
import {posedCageSurface} from '../src/render/character/geometry-proof.js';
import {shapeVertices} from '../src/render/character/shape.js';
import {observePool} from '../src/render/character/pool-observer.js';
import {observePoolPatchSupport} from '../src/render/character/pool-support-observer.js';
import {derivePoolSupportArithmetic} from '../src/render/character/pool-support-arithmetic.js';
import {requirePoolFootConstruction} from '../src/render/character/pool-limb-construction-arithmetic.js';

function source(){
  const appearance=defaultAppearance('feminine'),shape={presentation:appearance.presentation,...appearance.body,face:appearance.face};
  const selected=new PreparedBody(poolBase,appearance).select(poolRig,appearance,{wear:'bare',prop:'none',fixture:'none',eyes_closed:false,includeFixture:false,clip:'pool_enter',swimwear:'two_piece'});
  const compiler=new PoolEntryCompiler(poolRig.manifest,shape,anatomicalHeight(poolBase.vertices),[selected.body,selected.extra!],poolFixture),request=poolEntrySearchPlan(.2)[0],domain=compiler.prepareLegDomain(.2,request);
  const pose={...domain.node,basis:domain.node.basis.map(clonePoolMatrix),world:domain.node.world.map(matrix=>[...matrix])};
  return {compiler,domain,pose};
}

it('keeps the published oriented-leg plan and its nested frame values immutable',()=>{
  const {domain,pose}=source(),contact=domain.footContacts[0],{upper,lower,end}=contact.anatomy,frame=contact.frame!,plan=preparePoolOrientedLeg(pose,upper,lower,end,frame),before=JSON.stringify(plan);
  for(const field of ['pole','localAxis','axisInBody'] as const){
    const vector=plan[field] as unknown as number[];try{vector[0]+=.001;}catch{}
  }
  try{(plan as unknown as {flexion:number}).flexion+=1;}catch{}
  expect(JSON.stringify(plan)).toBe(before);expect(()=>requirePoolOrientedLeg(plan,pose,frame,plan.pole)).not.toThrow();
});

it.each(['construction','reference'] as const)('keeps oriented-leg authority private through its %s return',accessor=>{
  const {domain,pose}=source(),contact=domain.footContacts[0],{upper,lower,end}=contact.anatomy,frame=contact.frame!;
  const plan=preparePoolOrientedLeg(pose,upper,lower,end,frame);
  const read=()=>({pole:requirePoolOrientedLeg(plan,pose,frame,plan.pole).pole,expectedLower:requirePoolOrientedLegReference(plan,pose,frame).expectedLower});
  const baseline=JSON.stringify(read()),exposed=(accessor==='construction'?requirePoolOrientedLeg(plan,pose,frame,plan.pole):requirePoolOrientedLegReference(plan,pose,frame)) as unknown as Record<string,unknown>;
  for(const name of ['pole','upper','lower','expectedLower','initialUpper','initialLower']){
    const array=exposed[name];if(!Array.isArray(array))continue;
    for(let index=0;index<array.length;index++){
      const entry=array[index];
      if(typeof entry==='number'){try{array[index]=entry+.001;}catch{}}
      else if(entry&&typeof entry==='object')for(const field of ['value','error'])try{entry[field]+=1;}catch{}
    }
  }
  expect(()=>read()).not.toThrow();expect(JSON.stringify(read())).toBe(baseline);
  expect(exposed).not.toHaveProperty('pose');expect(exposed).not.toHaveProperty('frame');
});

it('does not let an accessor rebase the captured oriented-leg matrix snapshot',()=>{
  const {domain,pose}=source(),contact=domain.footContacts[0],{upper,lower,end}=contact.anatomy,frame=contact.frame!,plan=preparePoolOrientedLeg(pose,upper,lower,end,frame);
  const exposed=requirePoolOrientedLeg(plan,pose,frame,plan.pole) as unknown as {upper?:number[]};
  pose.basis[upper][0]+=.001;
  if(exposed.upper)try{exposed.upper[0]=pose.basis[upper][0];}catch{}
  expect(()=>requirePoolOrientedLeg(plan,pose,frame,plan.pole)).toThrow('producer');
});

it('constructs coupled source hinges and preserves the actual certified foot evaluator',()=>{
  const {domain,pose}=source(),plans=domain.footContacts.map(contact=>({contact,plan:solvePoolOrientedFoot(pose,contact.anatomy.upper,contact.anatomy.lower,contact.anatomy.end,contact.frame!)}));
  for(const {contact,plan} of plans){
    const result=observeConstructedPoolLeg(pose,contact.frame!,plan);expect(result.admitted).toBe(true);expect(result.flexion).toBeGreaterThan(0);
    expect(result.maximumMatrixResidual).toBeLessThanOrEqual(result.maximumReconstructionBound);
    expect(Math.abs(result.localAxis[0])).toBeGreaterThan(.99);
  }
  pose.basis.forEach((matrix,bone)=>{
    if(bone>0)expect(matrix.slice(12,15)).toEqual([0,0,0]);
    const errors=requirePoolMatrixRepresentation(matrix),x=[0,1,2].map(at=>({value:matrix[at],error:errors[at]}));
    let squared=poolNumber(0);for(const value of x)squared=poolAdd(squared,poolMultiply(value,value));
    expect(Math.abs(squared.value-1)).toBeLessThanOrEqual(squared.error);
  });
});

it('rejects off-axis and twist controls that the old zero-sign predicate admitted',()=>{
  const {domain,pose}=source(),contact=domain.footContacts[0],plan=solvePoolOrientedFoot(pose,contact.anatomy.upper,contact.anatomy.lower,contact.anatomy.end,contact.frame!);
  const lower=contact.anatomy.lower,policy=poolKneePolicies(poolRig.manifest).find(policy=>policy.bone===lower)!;
  for(const matrix of [[0,1,0,0,-1,0,0,0,0,0,1,0,0,0,0,1],[0,0,-1,0,0,1,0,0,1,0,0,0,0,0,0,1]]){
    const basis=pose.basis.map(matrix=>[...matrix]);basis[lower]=matrix;
    expect(observePoolKneeBranch(basis,policy).admissible).toBe(true);
    expect(poolLegFrameDiagnostic(matrix,plan.localAxis).axisMotion).toBeGreaterThan(1);
    pose.basis[lower]=properPoolRotation(matrix);expect(()=>observeConstructedPoolLeg(pose,contact.frame!,plan)).toThrow();
  }
});

it('rejects forged, stale, wrong-owner and changed oriented producers before they can certify a foot',()=>{
  const {domain,pose}=source(),contact=domain.footContacts[0],{upper,lower,end}=contact.anatomy,plan=preparePoolOrientedLeg(pose,upper,lower,end,contact.frame!);
  expect(()=>requirePoolOrientedLeg({...plan},pose,contact.frame!,plan.pole)).toThrow('producer');
  expect(()=>requirePoolOrientedLeg(plan,{...pose},contact.frame!,plan.pole)).toThrow('producer');
  expect(()=>requirePoolOrientedLeg(plan,pose,domain.footContacts[1].frame!,plan.pole)).toThrow('producer');
  expect(()=>requirePoolOrientedLeg(plan,pose,contact.frame!,[plan.pole[0],plan.pole[1],plan.pole[2]+.001])).toThrow('producer');
  pose.basis[upper][0]*=1.01;expect(()=>requirePoolOrientedLeg(plan,pose,contact.frame!,plan.pole)).toThrow('producer');
  expect(()=>preparePoolOrientedLeg(pose,upper,lower,end,contact.frame!)).toThrow('legitimate producer');
});

it('reassesses retained signed-only controls against the complete source axis',()=>{
  const {domain,pose}=source(),contact=domain.footContacts[0],plan=solvePoolOrientedFoot(pose,contact.anatomy.upper,contact.anatomy.lower,contact.anatomy.end,contact.frame!);
  const diagnostics=literals.records.flatMap(record=>domain.footContacts.map(contact=>{
    const reference=pose.bundle.basisActions.pool_enter[0][contact.anatomy.lower],axis=poolLegFrameDiagnostic(reference,plan.localAxis);
    return {phase:record.phase,side:contact.limb,sourceAxisMotion:axis.axisMotion,...poolLegFrameDiagnostic(record.basis[contact.anatomy.lower],plan.localAxis)};
  }));
  for(const result of diagnostics){
    expect(result.axisMotion,JSON.stringify(result)).toBeGreaterThan(result.sourceAxisMotion);
    expect(Math.sign(result.orientedSpin)).toBe(result.phase===.2?-1:1);
  }
  if(process.env.POOL_LEG_FRAME_OUTPUT)writeFileSync(process.env.POOL_LEG_FRAME_OUTPUT,JSON.stringify({scope:'Finite retained matrix diagnostics only. No physical admission.',diagnostics},null,2));
});

function trackedInput():OrientedLegInput {
  const {domain,pose}=source(),{upper,lower,end}=domain.footContacts[0].anatomy,body=pose.bundle.bones[upper].parent;
  const owned=(values:number[])=>values.map((value,index)=>({value,error:requirePoolMatrixRepresentation(values)[index]}));
  const rest=pose.rest.map(owned),basis=pose.basis.map(owned),inverses=rest.map(tracked.inverse),world:tracked.M[]=[];
  for(let bone=0;bone<rest.length;bone++){
    const parent=pose.bundle.bones[bone].parent,local=parent<0?rest[bone]:tracked.multiply(inverses[parent],rest[bone]),animated=tracked.multiply(local,basis[bone]);
    world.push(parent<0?animated:tracked.multiply(world[parent],animated));
  }
  return {upper,lower,end,body,rest,inverses,basis,world,sourceUpper:tracked.matrix(pose.bundle.basisActions.pool_enter[0][upper]),sourceLower:tracked.matrix(pose.bundle.basisActions.pool_enter[0][lower]),target:tracked.vector(domain.footContacts[0].frame!.translation)};
}

it('transports the complete frame under common facing and translation without a world-axis fallback',()=>{
  const input=trackedInput(),before=orientedPoolLegMath(input),angle=.83,c=Math.cos(angle),s=Math.sin(angle);
  const rigid=tracked.properRotation(tracked.matrix([c,s,0,0,-s,c,0,0,0,0,1,0,0,0,0,1]));rigid.splice(12,3,...tracked.vector([2.1,-3.7,.26]));
  const after=orientedPoolLegMath({...input,world:input.world.map(world=>tracked.multiply(rigid,world)),target:tracked.transform(rigid,input.target)});
  for(const key of ['upperBasis','lowerBasis'] as const)for(let at=0;at<16;at++)expect(Math.abs(before[key][at].value-after[key][at].value)).toBeLessThanOrEqual(before[key][at].error+after[key][at].error);
  expect(after.branch).toBe(before.branch);
});

it('keeps the oriented branch through the retained downward-outward scalar crossing pair',()=>{
  const {compiler}=source(),request=poolEntrySearchPlan(.2)[4],domain=compiler.prepareLegDomain(.2,request),interval=poolRootRayIntervals(request.direction,domain.constraints)[0],results=[];
  for(const fraction of [.4375,.5]){
    const pose={...domain.node,basis:domain.node.basis.map(clonePoolMatrix),world:domain.node.world.map(matrix=>[...matrix])};
    translatePoolRoot(pose,scale(request.direction,interval.minimum+(interval.maximum-interval.minimum)*fraction));
    results.push(domain.footContacts.map(contact=>{
      const plan=solvePoolOrientedFoot(pose,contact.anatomy.upper,contact.anatomy.lower,contact.anatomy.end,contact.frame!);
      return observeConstructedPoolLeg(pose,contact.frame!,plan);
    }));
  }
  for(let side=0;side<2;side++){expect(results[0][side].branch).toBe(results[1][side].branch);expect(results[0][side].flexion).toBeGreaterThan(0);expect(results[1][side].flexion).toBeGreaterThan(0);}
});

it('diagnoses unresolved source axes and true straight-link singularities explicitly',()=>{
  const input=trackedInput();expect(()=>orientedPoolLegMath({...input,sourceLower:tracked.identity()})).toThrow('source hinge');
  const origin=tracked.identity(),one=tracked.identity(),two=tracked.identity();one[13]=poolNumber(1);two[13]=poolNumber(2);
  const lower=tracked.matrix([1,0,0,0,0,0,1,0,0,-1,0,0,0,0,0,1]);
  const minimal={upper:1,lower:2,end:3,body:0,rest:[origin,origin,one,two],inverses:[origin,origin,tracked.inverse(one),tracked.inverse(two)],basis:[origin,origin,origin,origin],world:[origin,origin,one,two],sourceUpper:origin,sourceLower:lower};
  expect(()=>orientedPoolLegMath({...minimal,target:tracked.vector([0,2,0])})).toThrow('hinge singularity');
  expect(()=>orientedPoolLegMath({...minimal,target:tracked.vector([0,3,0])})).toThrow('outside this oriented hinge reach');
});

it('preserves the constructed frame and foot premise through actual fractional supported evaluation',()=>{
  const {compiler}=source(),request=poolEntrySearchPlan(.2)[4],domain=compiler.prepareLegDomain(.2,request),interval=poolRootRayIntervals(request.direction,domain.constraints)[0];
  const nodes=[.4375,.5].map(fraction=>{
    const pose={...domain.node,basis:domain.node.basis.map(clonePoolMatrix),world:domain.node.world.map(matrix=>[...matrix])};
    translatePoolRoot(pose,scale(request.direction,interval.maximum*fraction));
    const plans=domain.footContacts.map(contact=>solvePoolOrientedFoot(pose,contact.anatomy.upper,contact.anatomy.lower,contact.anatomy.end,contact.frame!));
    return {pose,plans};
  });
  const controls=domain.footContacts.map((contact,index)=>{
    const endpoint=(node:typeof nodes[number])=>({target:contact.frame!.translation,pole:node.plans[index].pole,orientation:contact.frame!.orientation});
    return {...contact.anatomy,legFrame:'source-entry-0' as const,anchor:[0,0,0,1] as const,from:endpoint(nodes[0]),to:endpoint(nodes[1])};
  });
  const records=[0,.5,1].map(amount=>{
    const {pose}=nodes[0],evaluated=interpolatePoolHierarchy(pose.bundle,pose.rest,pose.inverse,nodes[0].pose.basis,nodes[1].pose.basis,amount,controls);
    const skin=interpolatePoolPose(pose.bundle,pose.rest,pose.inverse,nodes[0].pose.basis,nodes[1].pose.basis,amount,controls);
    expect(skin).toEqual(poolSkinMatrices(evaluated.world,pose.inverse));
    const replay=poolIntervalPreference(pose.bundle,pose.rest,pose.inverse,nodes[0].pose.basis,nodes[1].pose.basis,amount,true);
    const constructed=domain.footContacts.map(contact=>{
      const plan=solvePoolOrientedFoot(replay,contact.anatomy.upper,contact.anatomy.lower,contact.anatomy.end,contact.frame!);
      return observeConstructedPoolLeg(replay,contact.frame!,plan);
    });
    expect(replay.basis).toEqual(evaluated.basis);expect(replay.world).toEqual(evaluated.world);
    expect(poolSkinMatrices(replay.world,replay.inverse)).toEqual(skin);
    const surfaces=compiler.geometry.map(geometry=>({geometry,points:posedCageSurface(geometry,shapeVertices(geometry.cage,compiler.shape,compiler.top),skin)}));
    const observation=observePool(poolFixture,surfaces,domain.source.limbs);
    const frames=domain.footContacts.map((contact,index)=>({limb:contact.limb,...poolLegFrameDiagnostic(evaluated.basis[contact.anatomy.lower],nodes[0].plans[index].localAxis),
      target:contact.frame!.translation,actual:evaluated.world[contact.anatomy.end].slice(12,15)}));
    const proofs=domain.footContacts.map(contact=>requirePoolFootConstruction(contact.frame!,replay));
    for(const proof of proofs)expect(proof.worldError.every(Number.isFinite)).toBe(true);
    const arithmetic=domain.footContacts.map(contact=>derivePoolSupportArithmetic(poolFixture,surfaces[0],domain.cages[0],replay,contact.patch,domain.source.limbs[contact.limb],contact.frame!,observation));
    const supports=domain.footContacts.map(contact=>observePoolPatchSupport(poolFixture,surfaces,contact.patch,domain.source.limbs[contact.limb],.2,observation,arithmetic));
    expect(observation.coverage.allSelectedVertices).toBe(true);expect(observation.coverage.allSelectedTriangles).toBe(true);
    return {amount,frames,constructed,arithmetic:arithmetic.map(proof=>({part:proof.part,maximumOutputError:proof.maximumOutputError,actualMinimumGap:proof.actualMinimumGap,contactEstablished:proof.contactEstablished})),constructionBounds:proofs.map(proof=>proof.worldError),supports,observation,basis:evaluated.basis};
  });
  if(process.env.POOL_LEG_INTERVAL_OUTPUT)writeFileSync(process.env.POOL_LEG_INTERVAL_OUTPUT,JSON.stringify({scope:'Three finite supported-evaluator observations. Instrumentation/parity checks only; frame, arithmetic, clearance and support admission remain separate.',controls,records},null,2));
},30000);
