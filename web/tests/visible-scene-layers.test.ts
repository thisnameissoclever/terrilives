import { expect,it } from 'vitest';
import { packVisibleSceneLayers } from '../src/render/visible-scene-layers.js';

it('packs independent one-body and two-body scenes without changing their roles',()=>{
  const table=packVisibleSceneLayers(8,{6:[0,1,-1,2],7:[3,4,5,2]});
  expect([...table.slice(24,28)]).toEqual([1,2,0,3]);
  expect([...table.slice(28,32)]).toEqual([4,5,6,3]);
  expect([...table.slice(0,24)]).toEqual(new Array(24).fill(0));
});

it('rejects invalid counts, scene indices and missing required owners',()=>{
  for(const count of [-1,1.5,NaN])expect(()=>packVisibleSceneLayers(count,{})).toThrow();
  for(const layers of [{8:[0,1,-1,2]},{6:[-1,1,-1,2]},{6:[0,1,-1,-1]},
    {6:[0,8,-1,2]},{6:[0,1.5,-1,2]}]){
    expect(()=>packVisibleSceneLayers(8,layers as never)).toThrow(/range/);
  }
});
