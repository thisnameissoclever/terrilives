import {expect,it} from 'vitest';
import {fitDiningGrip} from '../src/render/character/dining-contact.js';
import {add,dot,length,sub,transform,type Vec3} from '../src/render/character/math.js';

it('preserves a reachable authored grip exactly',()=>{
  const wrist:Vec3=[.2,.3,.4],result=fitDiningGrip(wrist,[0,0,0],[.3,.4,.5],.1,.5)!;
  expect(result.wrist).toBe(wrist);expect(transform(result.transform,wrist)).toEqual(wrist);
});

it('rotates the hand and spoon together about the fixed bowl into the arm reach shell',()=>{
  for(const [wrist,bowl,shoulder,inner,outer] of [
    [[0,1,0],[0,0,0],[1,0,0],.1,.6],
    [[1,0,0],[0,0,0],[1.1,0,0],.5,1],
    [[-1,0,0],[0,0,0],[2,0,0],0,1],
    [[2,3,4],[2,2,4],[3,2,4],.1,.6],
  ] as [Vec3,Vec3,Vec3,number,number][]){
    const result=fitDiningGrip(wrist,bowl,shoulder,inner,outer)!;
    expect(result).not.toBeNull();
    const moved=transform(result.transform,wrist),grip=add(wrist,[.02,.07,-.03]),movedGrip=transform(result.transform,grip);
    expect(length(sub(transform(result.transform,bowl),bowl))).toBeLessThan(1e-10);
    expect(length(sub(moved,result.wrist))).toBeLessThan(1e-10);
    expect(length(sub(moved,shoulder))).toBeGreaterThanOrEqual(inner-1e-10);
    expect(length(sub(moved,shoulder))).toBeLessThanOrEqual(outer+1e-10);
    expect(length(sub(movedGrip,moved))).toBeCloseTo(length(sub(grip,wrist)),10);
    expect(length(sub(movedGrip,bowl))).toBeCloseTo(length(sub(grip,bowl)),10);
    const columns=[0,4,8].map(at=>result.rotation.slice(at,at+3) as unknown as Vec3);
    for(let i=0;i<3;i++)for(let j=0;j<3;j++)expect(dot(columns[i],columns[j])).toBeCloseTo(i===j?1:0,10);
  }
});

it('rejects impossible and degenerate reaches without stretching the assembly',()=>{
  expect(fitDiningGrip([0,1,0],[0,0,0],[5,0,0],.1,.5)).toBeNull();
  expect(fitDiningGrip([0,0,0],[0,0,0],[5,0,0],.1,.5)).toBeNull();
  expect(fitDiningGrip([1,0,0],[0,0,0],[0,0,0],.1,.5)).toBeNull();
  expect(fitDiningGrip([.3,0,0],[0,0,0],[0,0,0],.1,.5)?.wrist).toEqual([.3,0,0]);
});
