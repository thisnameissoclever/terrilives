import {expect,it} from 'vitest';
import {identity} from '../src/render/character/math.js';
import {configuredPoolChainReach,poolChainReachable,projectPoolEntryRoot,poolRootRayIntervals} from '../src/render/character/pool-entry-domain.js';

it('admits extension beyond a bent source chord using unchanged configured segments',()=>{
  const rest=Array.from({length:3},identity);rest[1][12]=1;rest[2][12]=1.6;
  const reach=configuredPoolChainReach(rest,0,1,2),sourceChord=1;
  expect(reach.lengths).toEqual([1,.6000000000000001]);
  expect(1.5).toBeGreaterThan(sourceChord);expect(poolChainReachable(reach,[0,0,0],[1.5,0,0])).toBe(true);
  expect(poolChainReachable(reach,[0,0,0],[1.7,0,0])).toBe(false);
  expect(poolChainReachable(reach,[0,0,0],[.2,0,0])).toBe(false);
});

it('chooses real interior root travel on upward, downward and horizontal reach rays',()=>{
  const reach={lengths:[1,.5] as const,minimum:.5,maximum:1.5},constraints=[{limb:'footL',center:[0,0,1] as const,reach}];
  for(const direction of [[0,0,1],[0,0,-1],[0,1,0]] as const){
    const intervals=poolRootRayIntervals(direction,constraints);expect(intervals.length).toBeGreaterThan(0);
    for(const interval of intervals){const amount=(interval.minimum+interval.maximum)/2,root=direction.map(value=>value*amount) as [number,number,number];
      expect(poolChainReachable(reach,root,constraints[0].center)).toBe(true);
    }
  }
  expect(poolRootRayIntervals([0,0,1],constraints)).toHaveLength(2);
  expect(()=>poolRootRayIntervals([0,0,0],constraints)).toThrow('finite direction');
});

it('reports requested/projected root and treats the authored region as a measured preference',()=>{
  const reach={lengths:[1,1] as const,minimum:0,maximum:2},constraints=[{limb:'footL',center:[0,0,0] as const,reach}];
  const narrow={minimum:[-.1,-.1,-.1] as const,maximum:[.1,.1,.1] as const};
  const first=projectPoolEntryRoot([1,0,0],constraints,narrow),wide=projectPoolEntryRoot([1,0,0],constraints,{minimum:[-3,-3,-3],maximum:[3,3,3]});
  expect(first.projected).toEqual([1,0,0]);expect(first.sourceDeviation).toEqual([.9,0,0]);
  expect(wide.projected).toEqual(first.projected);expect(wide.sourceDeviation).toEqual([0,0,0]);
  const projected=projectPoolEntryRoot([3,0,0],constraints,narrow);expect(projected.requested).toEqual([3,0,0]);expect(projected.projected).toEqual([2,0,0]);
  expect(projected.active).toEqual([{limb:'footL',kind:'maximum'}]);
});
