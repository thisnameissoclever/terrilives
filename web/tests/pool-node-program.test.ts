import {freePoolPolicy} from './pool-policy-fixture.js';
import {expect,it} from 'vitest';
import {identity} from '../src/render/character/math.js';
import {interpolateTransform} from '../src/render/character/motion.js';
import {poolFootConstructionFixture} from './pool-foot-construction-fixture.js';
import {interpolatePoolLimbState} from '../src/render/character/pool-contact-evaluator.js';
import {makePoolPoseProgram,poolIntervalProgramControls} from '../src/render/character/pool-pose-program.js';
import {evaluatePoolPoseProgram,interpolatePoolPoseProgram,poolSkinMatrices} from '../src/render/character/pool-contact-sample.js';

it('selects literal target and pole endpoint data before running the same evaluator',()=>{
  const from={target:[.7,.7,.7] as const,pole:[.7,.7,.7] as const,orientation:identity()},to={target:[.1,.1,.1] as const,pole:[.1,.1,.1] as const,orientation:identity()};
  expect(.7+(.1-.7)).not.toBe(.1);
  const control={upper:1,lower:2,end:3,anchor:[0,0,0,1] as const,from,to};
  expect(interpolatePoolLimbState(control,0)).toBe(from);expect(interpolatePoolLimbState(control,1)).toBe(to);
});

it('preserves identical desired rotations at interior fractions without changing nonconstant interpolation',()=>{
  const orientation=[-1.011101421385517e-6,.8419149335302678,.5396102711195391,0,-.1351131927539884,-.5346622515101919,.8341946427266697,0,.9908301696773273,-.07290762311841724,.11375435529429885,0,0,0,0,1];
  const state={target:[0,0,0] as const,pole:[0,1,0] as const,orientation},control={upper:1,lower:2,end:3,anchor:[0,0,0,1] as const,from:state,to:{...state,orientation:[...orientation]}};
  for(const fraction of [0,Number.EPSILON,.25,.5,.75,1-Number.EPSILON,1])expect(interpolatePoolLimbState(control,fraction).orientation).toEqual(orientation);
  const moving={...control,to:{...state,orientation:identity()}};
  for(const fraction of [.25,.5,.75])expect(interpolatePoolLimbState(moving,fraction).orientation).toEqual(interpolateTransform(orientation,moving.to.orientation,fraction));
});

it('evaluates a synthetic single program identically as node, forced sides and constant interior',()=>{
  const {pose}=poolFootConstructionFixture(),state={target:[.5,.25,.75] as const,pole:[0,0,1] as const,orientation:identity()};
  const node=makePoolPoseProgram(pose.basis,[{upper:1,lower:2,end:3,anchor:[0,0,0,1],state}],freePoolPolicy());
  const key=evaluatePoolPoseProgram(pose.bundle,pose.rest,pose.inverse,node),skin=poolSkinMatrices(key.world,key.inverse);
  for(const fraction of [0,Number.EPSILON,.5,1-Number.EPSILON,1]){
    const actual=interpolatePoolPoseProgram(pose.bundle,pose.rest,pose.inverse,node,node,fraction);
    expect(actual.basis).toEqual(key.basis);expect(actual.world).toEqual(key.world);expect(poolSkinMatrices(actual.world,actual.inverse)).toEqual(skin);
  }
  expect(Object.isFrozen(node.preferenceBasis[0])).toBe(true);expect(Object.isFrozen(node.controls[0].state.orientation)).toBe(true);
  const other=makePoolPoseProgram(pose.basis,[],freePoolPolicy());expect(()=>poolIntervalProgramControls(node,other)).toThrow('incompatible');
});
