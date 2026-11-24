import {expect,it} from 'vitest';
import type {PoolSolid} from '../src/render/character/pool-contact-types.js';
import type {PoolSurfaceInput} from '../src/render/character/pool-observer.js';
import {poolFootOverlapsTread} from '../src/render/character/pool-tread-footprint.js';

const tread:PoolSolid={id:'outside3',kind:'solid',bounds:[[0,0,0],[1,1,1]],
  vertices:[[0,0,1],[1,0,1],[1,1,1],[0,1,1]],triangles:[[0,1,2],[0,2,3]]};
function foot(points:number[]):PoolSurfaceInput{
  return {points:Float32Array.from(points),geometry:{description:{parts:[{name:'foot',start:0,count:3}]},
    indices:new Uint32Array([0,1,2])}} as PoolSurfaceInput;
}
it('distinguishes a below-plane swing outside the tread from actual projected overlap',()=>{
  expect(poolFootOverlapsTread(foot([.5,1.2,.8,.6,1.3,.9,.4,1.4,.7]),'foot',tread,[0,1])).toBe(false);
  expect(poolFootOverlapsTread(foot([.5,.8,.8,.6,1.3,.9,.4,1.4,.7]),'foot',tread,[0,1])).toBe(true);
});
it('keeps a vertical foot triangle touching the finite top boundary in the clearance check',()=>{
  expect(poolFootOverlapsTread(foot([.5,1,.8,.5,1,1.1,.6,1,.8]),'foot',tread,[0,1])).toBe(true);
});
it('rejects an unrelated part or invalid top face',()=>{
  const geometry=foot([.5,1.2,.8,.6,1.3,.9,.4,1.4,.7]);
  expect(()=>poolFootOverlapsTread(geometry,'other',tread,[0,1])).toThrow('full selected foot');
  expect(()=>poolFootOverlapsTread(geometry,'foot',tread,[99])).toThrow('Invalid finite tread');
});
