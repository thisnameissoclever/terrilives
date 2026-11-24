import {expect,it} from 'vitest';
import type {Geometry} from '../src/render/character/bundle.js';
import {rigidPoolSurfaceCoefficient} from '../src/render/character/pool-surface-coefficient.js';

function fixture(foreign=false){
  const cage=new Float32Array(32);
  cage.set([1,2,3],0);cage[6]=0;cage[10]=1;
  cage.set([4,5,6],16);cage[22]=foreign?1:0;cage[26]=1;
  const stencils=new ArrayBuffer(16),ids=new Uint32Array(stencils),weights=new Float32Array(stencils);
  ids[0]=0;weights[1]=.25;ids[2]=1;weights[3]=.75;
  const geometry={cage,stencilRanges:new Uint32Array([0,2,0,0,1,1,1,0]),stencilWeights:stencils,indices:new Uint32Array([0,0,0]),
    description:{cageCount:2,vertexCount:2,parts:[{name:'Selected skin',start:0,count:3}]}} as Geometry;
  const inverse=[1,0,0,0,0,1,0,0,0,0,1,0,-1,-2,-3,1];
  return {geometry,cage,inverse};
}

it('derives the rigid surface anchor after subdivision and configured inverse rest',()=>{
  const {geometry,cage,inverse}=fixture();
  expect(rigidPoolSurfaceCoefficient(geometry,cage,inverse,0,0)).toEqual([2.25,2.25,2.25,1]);
});
it('refuses a contact patch whose effective cage stencil also follows another bone',()=>{
  const {geometry,cage,inverse}=fixture(true);
  expect(rigidPoolSurfaceCoefficient(geometry,cage,inverse,0,0)).toBeNull();
});
it('refuses an unused vertex retained in the shared buffers',()=>{
  const {geometry,cage,inverse}=fixture();
  expect(()=>rigidPoolSurfaceCoefficient(geometry,cage,inverse,0,1)).toThrow('selected');
});
