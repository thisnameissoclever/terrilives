import {expect,it} from 'vitest';
import {solveLimb} from '../src/render/character/math.js';
import {solve,vector} from '../src/render/character/pool-matrix-arithmetic.js';
import {poolNumber} from '../src/render/character/pool-arithmetic.js';

it.each([
  {upper:1,lower:1,distance:2-Number.EPSILON},
  {upper:1,lower:.5,distance:.5+Number.EPSILON/2},
])('rejects a rounded-pass unresolved exact reach boundary %o',({upper,lower,distance})=>{
  const start=[0,0,0] as const,end=[distance,0,0] as const,pole=[0,1,0] as const;
  expect(()=>solveLimb(start,end,upper,lower,pole)).not.toThrow();
  expect(()=>solve(vector(start),vector(end),{value:upper,error:1e-12},poolNumber(lower),vector(pole))).toThrow('reach domain');
});

it.each([
  {upper:1,lower:1,distance:1.999},
  {upper:1,lower:.5,distance:.501},
  {upper:1,lower:1,distance:1},
])('preserves interior two-link evaluation parity %o',({upper,lower,distance})=>{
  const start=[0,0,0] as const,end=[distance,0,0] as const,pole=[0,1,0] as const;
  const actual=solveLimb(start,end,upper,lower,pole),bounded=solve(vector(start),vector(end),poolNumber(upper),poolNumber(lower),vector(pole));
  expect(bounded.map(value=>value.value)).toEqual(actual);
  expect(bounded.every(value=>Number.isFinite(value.error)&&value.error>=0)).toBe(true);
});

it.each([0,.5,1.5,2,2.1])('refuses exact folding or extension boundaries and their exterior, distance=%s',distance=>{
  const lower=distance<=.5||distance===1.5?.5:1;
  expect(()=>solve(vector([0,0,0]),vector([distance,0,0]),poolNumber(1),poolNumber(lower),vector([0,1,0]))).toThrow('reach domain');
});
