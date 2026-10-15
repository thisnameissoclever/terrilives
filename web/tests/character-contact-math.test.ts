import {expect,it} from 'vitest';
import {fitAssembly,reachableSegment} from '../src/render/character/contact-math.js';
import {length,sub} from '../src/render/character/math.js';
it('intersects the shaft segment analytically without changing its length',()=>{
  expect(reachableSegment([0,0,0],[0,0,2],[0,0,1],.25,[0,1])).toEqual([.375,.625]);
  expect(reachableSegment([0,0,0],[0,0,2],[2,0,1],.25,[0,1])).toBeNull();
});
it('moves one rigid assembly to satisfy both hands and its allowed region',()=>{
  const spheres=[{center:[-.1,0,0] as const,radius:.25},{center:[.1,0,0] as const,radius:.25}];
  const point=fitAssembly([0,.5,0],[-1,-1,-1],[1,1,1],spheres);
  expect(point).not.toBeNull();
  for(const sphere of spheres)expect(length(sub(point!,sphere.center))).toBeLessThanOrEqual(sphere.radius+1e-7);
  expect(point![1]).toBeGreaterThan(.22);
  expect(fitAssembly([0,0,0],[0,0,0],[.1,.1,.1],[{center:[5,0,0],radius:.1}])).toBeNull();
});

it('recognizes a narrow feasible top-shelf reach without relaxing its bounds',()=>{
  const spheres=[{center:[-.0899246727,-.1627279406,.3843571712] as const,radius:.3867355032},
    {center:[-.0123999998,0,-.5008566410] as const,radius:.5212085372},
    {center:[.0123999998,0,-.5008566410] as const,radius:.5212085372}];
  const witness=[-.0463574091,-.0934424893,.0074554663] as const;
  for(const sphere of spheres)expect(length(sub(witness,sphere.center))).toBeLessThan(sphere.radius);
  const result=fitAssembly([0,0,0],[-.15,-.16,-.15],[.15,.10,.05],spheres);
  expect(result).not.toBeNull();
  for(const sphere of spheres)expect(length(sub(result!,sphere.center))).toBeLessThanOrEqual(sphere.radius+1e-7);
});

it('finds known feasible intersections including flat boxes and tangent spheres',()=>{
  let seed=219;
  const random=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/0x100000000;};
  for(let sample=0;sample<300;sample++){
    const witness=[random()-.5,random()-.5,random()-.5] as const;
    const min=witness.map((value,i)=>value-(sample%3===i?0:random())) as [number,number,number];
    const max=witness.map((value,i)=>value+(sample%3===i?0:random())) as [number,number,number];
    const spheres=Array.from({length:1+sample%4},()=>{const center=[random()*2-1,random()*2-1,random()*2-1] as const;return {center,radius:length(sub(center,witness))+random()*.05};});
    const preferred=[random()*4-2,random()*4-2,random()*4-2] as const,result=fitAssembly(preferred,min,max,spheres);
    expect(result).not.toBeNull();
    for(const sphere of spheres)expect(length(sub(result!,sphere.center))).toBeLessThanOrEqual(sphere.radius+1e-7);
    expect(length(sub(result!,preferred))).toBeLessThanOrEqual(length(sub(witness,preferred))+1e-7);
  }
  expect(fitAssembly([0,2,0],[-3,-3,-3],[3,3,3],[{center:[0,0,0],radius:1},{center:[2,0,0],radius:1}])).toEqual([1,0,0]);
});
