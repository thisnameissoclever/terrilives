import {expect,it} from 'vitest';
import {SupportSurface} from '../src/render/character/support-surface.js';
import {SupportSurface as OriginalSupportSurface} from './fixtures/support-surface/original.js';
import type {Vec3} from '../src/render/character/math.js';

it('preserves exact extrema for finite values, empty inventories, signed zero and NaN',()=>{
  const cases:Vec3[][]=[[],[[0,0,0]],[[-0,-0,-0]],[[0,-0,-0],[-0,0,0]],
    [[-1,2,-3],[4,-5,6],[4,2,6]],[[NaN,2,3],[1,NaN,4],[0,5,NaN]],
    [[Infinity,-Infinity,Infinity],[-Infinity,Infinity,-Infinity]]];
  const sparse=new Array<Vec3>(3);sparse[1]=[1,2,3];cases.push(sparse);
  for(const points of cases){
    const actual=new SupportSurface(points,[]),expected=new OriginalSupportSurface(points,[]);
    expect(actual.maximumZ).toBe(expected.maximumZ);expect(actual.bounds).toStrictEqual(expected.bounds);
  }
});

it('constructs a million-point inventory without passing vertices as function arguments',()=>{
  const points:Vec3[]=Array.from({length:1_000_000},()=>[0,0,0]);
  points[1]=[-3,7,-9];points[500_000]=[11,-13,17];points[999_999]=[-0,-0,-0];
  const surface=new SupportSurface(points,[]);
  expect(surface.bounds).toStrictEqual([-3,11,-13,7]);expect(surface.maximumZ).toBe(17);
  expect(surface.height(0,0,'top')).toBeUndefined();
  expect(()=>new OriginalSupportSurface(points,[])).toThrow(RangeError);
});

it('retains all triangle results while reducing a large unused point inventory',()=>{
  const points:Vec3[]=[[0,0,-0],[.2,0,.25],[0,.2,.5],[0,0,2],[.2,0,2.25],[0,.2,2.5]];
  const triangles:[number,number,number][]=[[0,1,2],[3,4,5]];
  const expected=new OriginalSupportSurface(points,triangles),expanded=[...points,...Array.from({length:150_000},()=>[0,0,0] as Vec3)];
  const actual=new SupportSurface(expanded,triangles);
  expect(actual.bounds).toStrictEqual(expected.bounds);expect(actual.maximumZ).toBe(expected.maximumZ);
  for(let x=-.025;x<=.225;x+=.0125)for(let y=-.025;y<=.225;y+=.0125)for(const side of ['top','bottom'] as const)expect(actual.height(x,y,side)).toBe(expected.height(x,y,side));
});
