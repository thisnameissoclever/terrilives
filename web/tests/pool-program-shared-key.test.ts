import {writeFileSync} from 'node:fs';
import {expect,it} from 'vitest';
import key from '../../assets/models/sims/character-creator/pool_activity_key_v2.json';
import {defaultAppearance} from '../src/character/schema.js';
import {PreparedBody} from '../src/render/character/prepared-body.js';
import {anatomicalHeight} from '../src/render/character/shape.js';
import {PoolEntryCompiler} from '../src/render/character/pool-entry-compiler.js';
import {poolEntrySearchPlan} from '../src/render/character/pool-entry-search-plan.js';
import {makePoolPoseProgram,poolIntervalProgramControls} from '../src/render/character/pool-pose-program.js';
import {evaluatePoolPoseProgram,interpolatePoolPoseProgram,poolIntervalPreference,poolSkinMatrices} from '../src/render/character/pool-contact-sample.js';
import {interpolatePoolLimbState} from '../src/render/character/pool-contact-evaluator.js';
import {samplePoolTrack} from '../src/render/character/pool-motion-graph.js';
import {preparePoolFootContactFrame} from '../src/render/character/pool-foot-contact-frame.js';
import {properPoolRotation} from '../src/render/character/pool-canonical-pose.js';
import {solvePoolOrientedFoot} from '../src/render/character/pool-oriented-leg.js';
import {solveCertifiedPoolRail} from '../src/render/character/pool-rail-construction-arithmetic.js';
import {derivePoolSupportArithmetic,poolViolationsBeyondArithmetic} from '../src/render/character/pool-support-arithmetic.js';
import {derivePoolRailArithmetic} from '../src/render/character/pool-rail-support-arithmetic.js';
import {observePoolPatchSupport} from '../src/render/character/pool-support-observer.js';
import {observePoolSource} from '../src/render/character/pool-observer.js';
import {posedCageSurface} from '../src/render/character/geometry-proof.js';
import type {Vec3} from '../src/render/character/math.js';
import {poolBase,poolRig,poolFixture} from './pool-observer-fixture.js';

it('shares one actual B program across moving A->B->A endpoints and one-sided observations',()=>{
  const appearance=defaultAppearance('feminine'),shape={presentation:appearance.presentation,...appearance.body,face:appearance.face};
  const selected=new PreparedBody(poolBase,appearance).select(poolRig,appearance,{wear:'bare',prop:'none',fixture:'none',eyes_closed:false,includeFixture:false,clip:'pool_enter',swimwear:'two_piece'});
  const compiler=new PoolEntryCompiler(poolRig.manifest,shape,anatomicalHeight(poolBase.vertices),[selected.body,selected.extra!],poolFixture),domain=compiler.prepareLegDomain(.2,poolEntrySearchPlan(.2)[4]);
  const candidate=compiler.compileNodeCandidates(.2,{requestId:4,root:key.rootDelta as unknown as Vec3,trunkPitchDegrees:45,headSourcePhase:.2})[0],left=candidate.contacts.find(contact=>contact.limb==='footL')!;
  const original=left.frame!,rawFootOrientation=properPoolRotation(candidate.pose.rest[left.anatomy.end]);
  const shifted=preparePoolFootContactFrame(poolFixture,domain.source.limbs.footL,selected.body,domain.cages[0],candidate.pose.inverse[left.anatomy.end],left.patch,rawFootOrientation,[original.translation[0]+.001,original.translation[1]]);
  expect(shifted.orientation).toEqual(original.orientation);
  const a=candidate.program,b=makePoolPoseProgram(a.preferenceBasis,a.controls.map(control=>control.end===left.anatomy.end?{...control,state:{...control.state,target:shifted.translation,orientation:shifted.orientation}}:control),a.policy);
  const nodes=[a,b],track={keys:[{phase:0,pose:0},{phase:.5,pose:1},{phase:1,pose:0}]},storedB=evaluatePoolPoseProgram(poolRig.manifest,candidate.pose.rest,candidate.pose.inverse,b),storedSkin=poolSkinMatrices(storedB.world,storedB.inverse),records=[];
  for(const [side,from,to,amount] of [['left',a,b,1],['right',b,a,0],['left-interior',a,b,.5],['right-interior',b,a,.5],['left-near',a,b,1-Number.EPSILON],['right-near',b,a,Number.EPSILON]] as const){
    const controls=poolIntervalProgramControls(from,to),states=controls.map(control=>interpolatePoolLimbState(control,amount));
    const actual=interpolatePoolPoseProgram(poolRig.manifest,candidate.pose.rest,candidate.pose.inverse,from,to,amount),skin=poolSkinMatrices(actual.world,actual.inverse);
    const surfaces=compiler.geometry.map((geometry,index)=>({geometry,points:posedCageSurface(geometry,domain.cages[index],skin)})),observation=observePoolSource(poolFixture,surfaces,{action:'pool_enter',phase:key.phase});
    const replay=poolIntervalPreference(poolRig.manifest,candidate.pose.rest,candidate.pose.inverse,from.preferenceBasis,to.preferenceBasis,amount,true);
    const leftState=states[controls.findIndex(control=>control.end===left.anatomy.end)];
    const frame=preparePoolFootContactFrame(poolFixture,domain.source.limbs.footL,selected.body,domain.cages[0],candidate.pose.inverse[left.anatomy.end],left.patch,rawFootOrientation,[leftState.target[0],leftState.target[1]]);
    expect(frame.translation).toEqual(leftState.target);
    for(const contact of candidate.contacts){const {upper,lower,end}=contact.anatomy;if(contact.frame)solvePoolOrientedFoot(replay,upper,lower,end,contact===left?frame:contact.frame);else solveCertifiedPoolRail(replay,upper,lower,end,contact.railFrame!,contact.pole,{fixture:poolFixture,geometry:selected.body,cage:domain.cages[0],patch:compiler.anatomy[contact.limb].patch,support:domain.source.limbs[contact.limb]});}
    expect(actual.world).toEqual(replay.world);
    const arithmetic=candidate.contacts.map(contact=>contact.frame?derivePoolSupportArithmetic(poolFixture,surfaces[0],domain.cages[0],replay,contact.patch,domain.source.limbs[contact.limb],contact===left?frame:contact.frame,observation):derivePoolRailArithmetic(poolFixture,surfaces[0],domain.cages[0],replay,compiler.anatomy[contact.limb].patch,domain.source.limbs[contact.limb],contact.railFrame!,observation));
    const supports=candidate.contacts.map(contact=>observePoolPatchSupport(poolFixture,surfaces,contact.patch,domain.source.limbs[contact.limb],.2,observation,arithmetic));
    const maximumSharedSkinDifference=Math.max(...skin.map((value,at)=>Math.abs(value-storedSkin[at])));
    records.push({side,amount,maximumSharedSkinDifference,states,observation,supports,unresolved:poolViolationsBeyondArithmetic(observation,arithmetic),arithmetic:arithmetic.map(({geometry,...proof})=>proof)});
  }
  expect(samplePoolTrack(track,.5).left).toBe(1);expect(samplePoolTrack(track,.5).right).toBe(1);
  if(process.env.POOL_SHARED_PROGRAM_OUTPUT)writeFileSync(process.env.POOL_SHARED_PROGRAM_OUTPUT,JSON.stringify({scope:'Actual two-program same-B endpoint and finite support-coordinate motion control. One-millimetre legal foot-patch shift is a causal evaluator fixture, not a new shipped stance or complete trajectory.',nodes,track,records},null,2));
  for(const record of records){if(record.side==='left'||record.side==='right')expect(record.maximumSharedSkinDifference).toBe(0);expect(record.unresolved).toHaveLength(0);expect(record.supports.every(support=>support.required&&support.satisfied)).toBe(true);}
},30000);
