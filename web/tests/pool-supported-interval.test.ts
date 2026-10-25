import {expect,it} from 'vitest';
import type {Bundle} from '../src/render/character/bundle.js';
import {identity,inverseAffine,length,multiply,sub,type Vec3} from '../src/render/character/math.js';
import {composeSkeletonPose} from '../src/render/character/pose-joints.js';
import {solvePoolHierarchyLimb} from '../src/render/character/pool-canonical-pose.js';
import {interpolatePoolPose} from '../src/render/character/pool-contact-sample.js';

it('the actual interval evaluator holds its prepared skin patch while root travel and joint angles vary',()=>{
  const bundle={bones:[{name:'root',parent:-1},{name:'upper',parent:0},{name:'lower',parent:1},{name:'end',parent:2}]} as unknown as Bundle;
  const rest=[identity(),identity(),identity(),identity()];rest[2][12]=1;rest[3][12]=2;
  const inverse=rest.map(inverseAffine),target:Vec3=[0,1,0],pole:Vec3=[1,0,0],anchor=[.1,.05,0,1] as const;
  const seed=(x:number)=>{
    const basis=rest.map(()=>identity());basis[0][12]=x;
    const candidate={bundle,rest,inverse,basis,world:composeSkeletonPose(bundle.bones,rest,basis)};
    solvePoolHierarchyLimb(candidate,1,2,3,[target[0]-anchor[0],target[1]-anchor[1],0],pole,identity());
    return candidate.basis;
  };
  const left=seed(-.3),right=seed(.3),endpoint=(skin:Float32Array<ArrayBuffer>):Vec3=>{
    const world=multiply(Array.from(skin.slice(48,64)),rest[3]);
    return [world[0]*anchor[0]+world[4]*anchor[1]+world[12],world[1]*anchor[0]+world[5]*anchor[1]+world[13],world[2]*anchor[0]+world[6]*anchor[1]+world[14]];
  };
  expect(length(sub(endpoint(interpolatePoolPose(bundle,rest,inverse,left,right,.5)),target))).toBeGreaterThan(.01);
  const control={upper:1,lower:2,end:3,anchor,from:{target,pole,orientation:identity()},to:{target,pole,orientation:identity()}};
  for(const fraction of [0,.125,.5,.875,1]){
    const skin=interpolatePoolPose(bundle,rest,inverse,left,right,fraction,[control]);
    expect(length(sub(endpoint(skin),target))).toBeLessThan(2e-7);
  }
});
