import { describe, expect, it } from 'vitest';
import { identity, inverseAffine, length, multiply, solveLimb, sub, transform } from '../src/render/character/math.js';

describe('character matrix convention', () => {
  it('inverts measured rest matrices that are not perfectly orthonormal', () => {
    const m=identity();m[0]=.9999918937683105;m[4]=.000004;m[12]=-.32;m[14]=.81;
    const product=multiply(inverseAffine(m),m);
    expect(Math.max(...product.map((v,i)=>Math.abs(v-identity()[i])))).toBeLessThan(1e-12);
  });
  it('keeps Blender column-major translation and composition order', () => {
    const translated = identity(); translated[12] = 3; translated[13] = -2;
    const scaled = identity(); scaled[0] = 2;
    expect(transform(multiply(translated, scaled), [4, 1, 7])).toEqual([11, -1, 7]);
    expect(transform(multiply(scaled, translated), [4, 1, 7])).toEqual([14, -1, 7]);
  });
  it('chooses a stable bend plane for a collinear pole without stretching',()=>{
    const knee=solveLimb([0,0,1],[0,0,.01],.5,.5,[0,0,.5]);
    expect(length(sub(knee,[0,0,1]))).toBeCloseTo(.5,12);
    expect(length(sub(knee,[0,0,.01]))).toBeCloseTo(.5,12);
    expect(knee[1]).toBeLessThan(0);
    expect(()=>solveLimb([0,0,1],[0,0,-1],.5,.5,[0,0,.5])).toThrow('Unreachable');
  });
});
