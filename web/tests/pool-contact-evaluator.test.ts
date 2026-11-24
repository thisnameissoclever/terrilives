import {expect,it} from 'vitest';
import {identity,length,sub,transform,type Vec3} from '../src/render/character/math.js';
import {evaluatePoolLimb} from '../src/render/character/pool-contact-evaluator.js';

it('keeps a supported endpoint fixed between two valid keys where joint interpolation loses contact',()=>{
  const target:Vec3=[0,0,0],start:Vec3=[-.5,-.5,0],radians=(degrees:number)=>degrees*Math.PI/180;
  const ordinary:Vec3=[start[0]+Math.cos(radians(105))+Math.cos(radians(-15)),start[1]+Math.sin(radians(105))+Math.sin(radians(-15)),0];
  expect(length(sub(ordinary,target))).toBeCloseTo(.2928932188134524,12);
  for(const t of [0,.001,.125,.5,.875,.999,1]){
    const shoulder:Vec3=[-1+t,-t,0];
    const pose=evaluatePoolLimb({start:shoulder,target,pole:[-.5,1,0],lengths:[1,1],orientation:identity(),anchor:[0,0,0,1],upperReference:identity(),lowerReference:identity()});
    expect(length(sub(pose.joint,shoulder))).toBeCloseTo(1,12);
    expect(length(sub(pose.end,pose.joint))).toBeCloseTo(1,12);
    expect(length(sub(transform(pose.endMatrix,[0,0,0]),target))).toBeLessThan(1e-12);
  }
});

it('uses the actual rigid surface coefficient rather than treating a wrist as its contact patch',()=>{
  const target:Vec3=[.2,.3,.4],orientation=identity(),anchor:[number,number,number,number]=[.025,-.08,.01,1];
  const pose=evaluatePoolLimb({start:[.2,.6,.6],target,pole:[1,0,1],lengths:[.3,.3],orientation,anchor,upperReference:identity(),lowerReference:identity()});
  expect(length(sub(transform(pose.endMatrix,anchor.slice(0,3) as [number,number,number]),target))).toBeLessThan(1e-12);
  expect(length(sub(pose.end,target))).toBeGreaterThan(.08);
});
