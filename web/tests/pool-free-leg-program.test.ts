import {expect,it} from 'vitest';
import {defaultAppearance} from '../src/character/schema.js';
import {PreparedBody} from '../src/render/character/prepared-body.js';
import {anatomicalHeight} from '../src/render/character/shape.js';
import {PoolEntryCompiler} from '../src/render/character/pool-entry-compiler.js';
import {poolEntrySearchPlan} from '../src/render/character/pool-entry-search-plan.js';
import {clonePoolMatrix,preparePoolFreeLeg,requirePoolFreeLegPlan} from '../src/render/character/pool-matrix-producer.js';
import {solvePoolFreeLeg,observeConstructedPoolFreeLeg} from '../src/render/character/pool-free-leg.js';
import {requirePoolFootConstruction} from '../src/render/character/pool-limb-construction-arithmetic.js';
import {makePoolPoseProgram} from '../src/render/character/pool-pose-program.js';
import {evaluatePoolPoseProgram,interpolatePoolPoseProgram,poolSkinMatrices,poolIntervalPreference} from '../src/render/character/pool-contact-sample.js';
import {freePoolPolicy} from './pool-policy-fixture.js';
import {poolBase,poolRig,poolFixture} from './pool-observer-fixture.js';
import {add,length,multiply,scale,sub,unit,type Vec3} from '../src/render/character/math.js';

function source(){
  const appearance=defaultAppearance('feminine'),shape={presentation:appearance.presentation,...appearance.body,face:appearance.face};
  const selected=new PreparedBody(poolBase,appearance).select(poolRig,appearance,{wear:'bare',prop:'none',fixture:'none',eyes_closed:false,includeFixture:false,clip:'pool_enter',swimwear:'two_piece'});
  const compiler=new PoolEntryCompiler(poolRig.manifest,shape,anatomicalHeight(poolBase.vertices),[selected.body,selected.extra!],poolFixture),domain=compiler.prepareLegDomain(.2,poolEntrySearchPlan(.2)[0]);
  const pose={...domain.node,basis:domain.node.basis.map(clonePoolMatrix),world:domain.node.world.map(matrix=>[...matrix])},contact=domain.footContacts[0];
  return {pose,contact};
}

it('reconstructs a free source hinge through the same evaluator without acquiring foot contact authority',()=>{
  const input=source(),{contact}=input,{upper,lower,end}=contact.anatomy,preference=input.pose.basis.map(clonePoolMatrix),target=contact.frame!.translation,orientation=contact.frame!.orientation;
  const pose=poolIntervalPreference(input.pose.bundle,input.pose.rest,input.pose.inverse,preference,preference,0,true);
  const plan=solvePoolFreeLeg(pose,upper,lower,end,target,orientation),observation=observeConstructedPoolFreeLeg(pose,plan);
  expect(observation.admitted).toBe(true);expect(observation.mode).toBe('free');expect(observation.maximumMatrixResidual).toBeLessThanOrEqual(observation.maximumReconstructionBound);
  expect(()=>requirePoolFootConstruction(contact.frame!,pose)).toThrow('no matching');
  const node=makePoolPoseProgram(preference,[{upper,lower,end,anchor:[0,0,0,1],legFrame:'source-entry-0',state:{target,pole:plan.pole,orientation}}],freePoolPolicy());
  const key=evaluatePoolPoseProgram(pose.bundle,pose.rest,pose.inverse,node);expect(key.world).toEqual(pose.world);expect(key.basis).toEqual(pose.basis);
  for(const fraction of [0,.5,1])expect(poolSkinMatrices(interpolatePoolPoseProgram(pose.bundle,pose.rest,pose.inverse,node,node,fraction).world,pose.inverse)).toEqual(poolSkinMatrices(pose.world,pose.inverse));
});

it('rejects forged, wrong-owner, changed-goal and stale free-leg producers without exposing private bounds',()=>{
  const {pose,contact}=source(),{upper,lower,end}=contact.anatomy,target=contact.frame!.translation,plan=preparePoolFreeLeg(pose,upper,lower,end,target);
  expect(()=>requirePoolFreeLegPlan({...plan},pose,target)).toThrow('source-goal');expect(()=>requirePoolFreeLegPlan(plan,{...pose},target)).toThrow('source-goal');
  expect(()=>requirePoolFreeLegPlan(plan,pose,[target[0],target[1],target[2]+.001])).toThrow('source-goal');
  const reference=requirePoolFreeLegPlan(plan,pose,target);expect(Object.isFrozen(reference.pole[0])).toBe(true);expect(Object.isFrozen(reference.expectedLower[0])).toBe(true);
  expect(Reflect.set(reference.pole[0],'error',1)).toBe(false);expect(requirePoolFreeLegPlan(plan,pose,target).pole).toEqual(reference.pole);
  pose.world[plan.body][12]+=.001;expect(()=>requirePoolFreeLegPlan(plan,pose,target)).toThrow('source-goal');
});

it('rejects postsolve hierarchy/source mutation and strict unreachable or singular free goals',()=>{
  for(const mutation of ['world','source','plan'] as const){
    const {pose,contact}=source(),{upper,lower,end}=contact.anatomy,plan=solvePoolFreeLeg(pose,upper,lower,end,contact.frame!.translation,contact.frame!.orientation);
    if(mutation==='world')pose.world[plan.body][12]+=.001;
    if(mutation==='source')pose.bundle={...pose.bundle,sourceSha256:'changed'};
    expect(()=>observeConstructedPoolFreeLeg(pose,mutation==='plan'?{...plan}:plan)).toThrow('unchanged');
  }
  for(const distance of ['outside','extension'] as const){
    const {pose,contact}=source(),{upper,lower,end}=contact.anatomy,point=(m:readonly number[]):Vec3=>[m[12],m[13],m[14]],start=point(pose.world[upper]);
    const maximum=length(point(multiply(pose.inverse[upper],pose.rest[lower])))+length(point(multiply(pose.inverse[lower],pose.rest[end])));
    const target=distance==='outside'?add(start,[10,0,0]):add(start,scale(unit(sub(contact.frame!.translation,start)),maximum));
    expect(()=>preparePoolFreeLeg(pose,upper,lower,end,target)).toThrow(/outside|singular|unresolved/);
  }
});
