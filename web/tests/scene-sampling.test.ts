import {describe,it,expect} from 'vitest';
import {coveredSubpixels,resolveVisibleOwner,resolveAnnotationOwner,bubbleAnchorY,sceneFramebufferSize} from '../src/render/scene-sampling.js';

describe('shared scene sampling',()=>{
 it('fits the complete twice-resolution framebuffer on large displays',()=>{
  expect(sceneFramebufferSize(5000,2000,2,8192)).toEqual([4096,1638]);
  expect(sceneFramebufferSize(2300,1200,1,16384)).toEqual([2300,1200]);
 });
 it('retains a quarter-covered edge without claiming its other samples',()=>{
  expect(coveredSubpixels(.25)).toEqual([true,false,false,false]);
  expect(coveredSubpixels(0)).toEqual([false,false,false,false]);
  expect(coveredSubpixels(1)).toEqual([true,true,true,true]);
 });
 it('picks a visible owner and never averages categorical identities',()=>{
  expect(resolveVisibleOwner([0,42,7,42],[1,.3,.7,.3])).toBe(42);
  expect(resolveVisibleOwner([0,0,0,0],[1,1,1,1])).toBe(0);
  expect(resolveVisibleOwner([7,42,0,0],[.3,.3,1,1])).toBe(7);
 });
 it('places the visible bubble bottom four logical pixels above the head at any scale',()=>{
  for(const scale of [.75,1,2.5]){
   const anchor=bubbleAnchorY(100,scale,21,26,25);
   const visibleBottom=anchor+(21-26+25)*scale;
   expect(visibleBottom).toBeCloseTo(100-4*scale);
  }
 });
 it('picks the last displayed annotation before world depth, including one covered sample',()=>{
  expect(resolveAnnotationOwner([0,0,42,0],[42])).toBe(42);
  expect(resolveAnnotationOwner([42,42,7,0],[42,7])).toBe(7);
  expect(resolveAnnotationOwner([7,42,42,0],[7,42])).toBe(42);
  expect(resolveAnnotationOwner([0,0,0,0],[42])).toBe(0);
  expect(()=>resolveAnnotationOwner([99],[42])).toThrow('no displayed owner');
 });
});
