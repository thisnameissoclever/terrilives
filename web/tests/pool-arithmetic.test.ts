import {expect,it} from 'vitest';
import {poolAdd,poolDivide,poolFloat32,poolMultiply,poolNumber,poolUpper} from '../src/render/character/pool-arithmetic.js';
import {poolPatchProjectionContained,poolPatchProjectionStatus} from '../src/render/character/pool-exact-projection.js';
import type {Triangle} from '../src/render/character/pool-solid.js';

it('propagates Float32 conversion loss through actual subsequent operations',()=>{
  const input=poolNumber(1/3),rounded=poolFloat32(input),product=poolMultiply(rounded,poolNumber(3));
  expect(rounded.error).toBeGreaterThanOrEqual(Math.abs(Math.fround(1/3)-1/3));
  expect(Math.abs(product.value-1)).toBeLessThanOrEqual(product.error);
  const divided=poolDivide(poolAdd(product,poolNumber(2)),poolNumber(3));
  expect(Math.abs(divided.value-1)).toBeLessThanOrEqual(divided.error);
  expect(divided.error).toBeLessThan(1e-6);
  expect(poolUpper(1)).toBe(1+Number.EPSILON);
});

it('proves exact finite projection across a shared facet diagonal and rejects a gap',()=>{
  const support=[[[0,0,0],[1,0,0],[1,1,0]],[[0,0,0],[1,1,0],[0,1,0]]] as const;
  const body=[[[.25,.75,0],[.75,.25,0],[.75,.75,0]]] as const;
  expect(poolPatchProjectionContained(body,support)).toBe(true);
  expect(poolPatchProjectionContained([[[.25,.75,0],[1.01,.25,0],[.75,.75,0]]],support)).toBe(false);
  expect(poolPatchProjectionContained(body,[support[0]])).toBe(false);
});

it('refuses overlapping same-side facets whose summed areas happen to equal their hull',()=>{
  const a=[0,0,0] as const,b=[1,0,0] as const,c=[0,1,0] as const,d=[1,1,0] as const;
  expect(poolPatchProjectionContained([[a,c,d]],[[a,b,c],[a,b,d]])).toBe(false);
});

it('covers a sole across several tiled faces without bridging a gap hidden between its vertices',()=>{
  const strip=(x:number,end:number):Triangle[]=>[
    [[x,0,0],[end,0,0],[end,1,0]],[[x,0,0],[end,1,0],[x,1,0]],
  ];
  const sole:Triangle=[[.125,.125,0],[2.875,.125,0],[1.5,.875,0]];
  const centre=strip(1,2),right=strip(2,3);
  expect(poolPatchProjectionContained([sole],[...strip(0,1),...centre,...right])).toBe(true);
  const left=strip(0,1-Number.EPSILON);
  expect(poolPatchProjectionStatus([sole],[...left,...centre,...right,...left])).toBe('unsupported-union');
});

it('rejects concave unions, reversed/degenerate facets and the next coordinate beyond a boundary',()=>{
  const a=[0,0,0] as const,b=[2,0,0] as const,c=[1,1,0] as const,d=[-1,-.1,0] as const;
  expect(poolPatchProjectionStatus([[b,c,d]],[[a,b,c],[a,c,d]])).toBe('unsupported-union');
  const support=[[[0,0,0],[1,0,0],[1,1,0]],[[0,0,0],[1,1,0],[0,1,0]]] as const;
  expect(poolPatchProjectionContained([support[0]],support)).toBe(true);
  expect(poolPatchProjectionContained([[[0,0,0],[1+Number.EPSILON,0,0],[1,1,0]]],support)).toBe(false);
  expect(()=>poolPatchProjectionContained([support[0]],[[support[0][0],support[0][2],support[0][1]]])).toThrow('upward');
  expect(()=>poolPatchProjectionContained([support[0]],[[support[0][0],support[0][0],support[0][1]]])).toThrow('upward');
});
