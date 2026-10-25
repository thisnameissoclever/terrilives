import {expect,it} from 'vitest';
import type {Geometry} from '../src/render/character/bundle.js';
import {preparePoolContactPatch} from '../src/render/character/pool-contact-patch.js';

function fixture(){
  const cage=new Float32Array(48);
  [[0,0,0],[1,0,0],[0,1,0]].forEach((p,i)=>{cage.set(p,i*16);cage[i*16+10]=1;});
  const stencilWeights=new ArrayBuffer(24),indices=new Uint32Array(stencilWeights),weights=new Float32Array(stencilWeights);
  for(let i=0;i<3;i++){indices[i*2]=i;weights[i*2+1]=1;}
  const geometry={cage,stencilRanges:new Uint32Array([0,1,0,0,1,1,1,0,2,1,2,0]),stencilWeights,
    indices:new Uint32Array([0,1,2]),description:{vertexCount:3,cageCount:3,parts:[{name:'Sole',start:0,count:3}]},
    manifest:{bones:[{name:'foot.L'}]}} as unknown as Geometry;
  const rest=[[1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1]];
  return {geometry,cage,rest};
}
it('binds a named finite source patch to exact rigid skin coefficients',()=>{
  const {geometry,cage,rest}=fixture(),patch=preparePoolContactPatch(geometry,cage,rest,'foot.L',{part:'Sole',triangles:[0]});
  expect(patch.part).toBe('Sole');expect(patch.sourceTriangles).toEqual([0]);
  expect(patch.area).toBe(.5);expect(patch.vertices.map(v=>v.coefficient)).toEqual([[0,0,0,1],[1,0,0,1],[0,1,0,1]]);
  expect(Object.isFrozen(patch)).toBe(true);expect(Object.isFrozen(patch.vertices[0].coefficient)).toBe(true);
});
it('refuses missing, duplicate, out-of-part or non-rigid contact triangles',()=>{
  const {geometry,cage,rest}=fixture();
  for(const region of [{part:'Missing',triangles:[0]},{part:'Sole',triangles:[0,0]},{part:'Sole',triangles:[1]}])
    expect(()=>preparePoolContactPatch(geometry,cage,rest,'foot.L',region)).toThrow();
  cage[22]=1;
  expect(()=>preparePoolContactPatch(geometry,cage,rest,'foot.L',{part:'Sole',triangles:[0]})).toThrow('rigid');
});
