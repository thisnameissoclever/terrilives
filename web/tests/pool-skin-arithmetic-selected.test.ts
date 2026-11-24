import {expect,it} from 'vitest';
import type {Geometry} from '../src/render/character/bundle.js';
import {identity,inverseAffine} from '../src/render/character/math.js';
import {poolSurfaceArithmetic} from '../src/render/character/pool-skin-arithmetic.js';
import {poolAdd as add,poolMultiply as mul,poolNumber as number,poolFloat32 as float32,type PoolNumber} from '../src/render/character/pool-arithmetic.js';

// Retained pre-optimization evaluator: every cage row runs even for selected outputs.
function retainedFullCageEvaluator(geometry:Geometry,cage:Float32Array<ArrayBuffer>,world:readonly number[][],inverse:readonly number[][],selected?:ReadonlySet<number>,worldErrors?:readonly (readonly number[])[]) {
  if(world.some(matrix=>matrix.length!==16||matrix.some(value=>!Number.isFinite(value)))||inverse.some(matrix=>matrix.length!==16||matrix.some(value=>!Number.isFinite(value))))throw new Error('Pool surface arithmetic requires finite matrices.');
  const matrices:PoolNumber[][]=world.map((matrix,bone)=>{
    const output:PoolNumber[]=[];
    for(let column=0;column<4;column++)for(let row=0;row<4;row++){
      let result=number(0);for(let k=0;k<4;k++)result=add(result,mul({value:matrix[k*4+row],error:worldErrors?.[bone]?.[k*4+row]??0},number(inverse[bone][column*4+k])));
      output[column*4+row]=float32(result);
    }
    return output;
  });
  const skinned:PoolNumber[]=Array.from({length:cage.length/16*3},()=>number(0));
  for(let at=0,vertex=0;at<cage.length;at+=16,vertex++)for(let axis=0;axis<3;axis++){
    if(cage[at+15]===10){skinned[vertex*3+axis]=number(cage[at+axis]);continue;}
    for(let influence=0;influence<4;influence++){
      const matrix=matrices[cage[at+6+influence]],weight=number(cage[at+10+influence]);
      const p=add(add(add(mul(matrix[axis],number(cage[at])),mul(matrix[4+axis],number(cage[at+1]))),mul(matrix[8+axis],number(cage[at+2]))),matrix[12+axis]);
      skinned[vertex*3+axis]=float32(add(skinned[vertex*3+axis],mul(weight,p)));
    }
  }
  const ids=new Uint32Array(geometry.stencilWeights),weights=new Float32Array(geometry.stencilWeights),errors=new Float64Array(geometry.description.vertexCount*3),values=new Float32Array(geometry.description.vertexCount*3);
  for(const vertex of selected??Array.from({length:geometry.description.vertexCount},(_,index)=>index))for(let axis=0;axis<3;axis++){
    let result=number(0);const start=geometry.stencilRanges[vertex*4],count=geometry.stencilRanges[vertex*4+1];
    for(let at=start;at<start+count;at++)result=float32(add(result,mul(skinned[ids[at*2]*3+axis],number(weights[at*2+1]))));
    errors[vertex*3+axis]=result.error;
    values[vertex*3+axis]=result.value;
  }
  return {errors,values};
}


function fixture(){
 const cage=new Float32Array(8*16);
 for(let vertex=0;vertex<8;vertex++){
  const at=vertex*16;cage.set([vertex/7-.3,(-1)**vertex*(vertex+.125),1/(vertex+3)],at);
  cage.set([vertex%3,(vertex+1)%3,(vertex+2)%3,vertex%3],at+6);
  cage.set([.375,.25,.375,0],at+10);cage[at+15]=vertex===3?10:3;
 }
 const stencils=[[[0,.5],[1,.5]],[[1,.2],[2,.3],[0,.5]],[[3,1],[6,0]],[[4,1/3],[5,2/3]],[[2,.7],[4,.3],[2,0]],[[5,1]]];
 const stencilWeights=new ArrayBuffer(stencils.flat().length*8),ids=new Uint32Array(stencilWeights),weights=new Float32Array(stencilWeights),stencilRanges=new Uint32Array(stencils.length*4);let offset=0;
 stencils.forEach((rows,vertex)=>{stencilRanges[vertex*4]=offset;stencilRanges[vertex*4+1]=rows.length;for(const [id,weight] of rows){ids[offset*2]=id;weights[offset*2+1]=weight;offset++;}});
 const geometry={description:{vertexCount:stencils.length,cageCount:8},stencilRanges,stencilWeights} as unknown as Geometry;
 const world=[identity(),identity(),identity()],rest=[identity(),identity(),identity()];
 for(let bone=0;bone<3;bone++){
  const angle=(bone+1)*Math.PI/7,c=Math.cos(angle),s=Math.sin(angle);
  world[bone][0]=c;world[bone][1]=s;world[bone][4]=-s;world[bone][5]=c;
  world[bone][12]=(bone-1)*.37;world[bone][13]=bone/11;world[bone][14]=bone*1.13;
  rest[bone][12]=bone*.19;rest[bone][14]=bone/9;
 }
 const inverse=rest.map(inverseAffine),worldErrors=world.map((matrix,bone)=>matrix.map((_,axis)=>((axis+bone)%5)*2**-42));
 return {geometry,cage,world,inverse,worldErrors};
}
const bytes=(value:ArrayBufferView)=>new Uint8Array(value.buffer,value.byteOffset,value.byteLength);
const cases=[[],[0],[2],[4,1,0],[5,0,3,2],[0,1,2,3,4,5]];

it.each(cases.flatMap(selection=>[false,true].map(errors=>({selection,errors}))))('preserves selected output and error bits: %j',({selection,errors})=>{
 const p=fixture(),selected=new Set(selection),worldErrors=errors?p.worldErrors:undefined;
 const full=retainedFullCageEvaluator(p.geometry,p.cage,p.world,p.inverse,undefined,worldErrors);
 const old=retainedFullCageEvaluator(p.geometry,p.cage,p.world,p.inverse,selected,worldErrors);
 const actual=poolSurfaceArithmetic(p.geometry,p.cage,p.world,p.inverse,selected,worldErrors);
 expect(bytes(actual.values)).toEqual(bytes(old.values));expect(bytes(actual.errors)).toEqual(bytes(old.errors));
 for(const vertex of selected){
  expect(bytes(actual.values.subarray(vertex*3,vertex*3+3))).toEqual(bytes(full.values.subarray(vertex*3,vertex*3+3)));
  expect(bytes(actual.errors.subarray(vertex*3,vertex*3+3))).toEqual(bytes(full.errors.subarray(vertex*3,vertex*3+3)));
 }
});

it.each([false,true])('preserves the complete evaluator when selected is absent, errors=%s',errors=>{
 const p=fixture(),worldErrors=errors?p.worldErrors:undefined;
 const actual=poolSurfaceArithmetic(p.geometry,p.cage,p.world,p.inverse,undefined,worldErrors),old=retainedFullCageEvaluator(p.geometry,p.cage,p.world,p.inverse,undefined,worldErrors);
 expect(bytes(actual.values)).toEqual(bytes(old.values));expect(bytes(actual.errors)).toEqual(bytes(old.errors));
});

it('does not evaluate arithmetic outside selected stencil dependencies',()=>{
 const p=fixture(),selected=new Set([0,1]);
 const guarded=new Proxy(p.cage,{get(target,key){
  if(typeof key==='string'&&/^\d+$/.test(key)&&Math.floor(Number(key)/16)===7&&[0,1,2,10,11,12,13].includes(Number(key)%16))throw new Error('Unrelated cage row was evaluated');
  return Reflect.get(target,key,target);
 }});
 expect(()=>retainedFullCageEvaluator(p.geometry,guarded,p.world,p.inverse,selected)).toThrow('Unrelated cage row');
 const actual=poolSurfaceArithmetic(p.geometry,guarded,p.world,p.inverse,selected),old=retainedFullCageEvaluator(p.geometry,p.cage,p.world,p.inverse,selected);
 expect(bytes(actual.values)).toEqual(bytes(old.values));expect(bytes(actual.errors)).toEqual(bytes(old.errors));
});

it('keeps zero-weight stencil dependencies and all arithmetic inside consumed cage rows',()=>{
 const p=fixture(),reads=new Set<number>(),selected=new Set([2]);
 const watched=new Proxy(p.cage,{get(target,key){
  if(typeof key==='string'&&/^\d+$/.test(key)&&[0,1,2,10,11,12,13].includes(Number(key)%16))reads.add(Math.floor(Number(key)/16));
  return Reflect.get(target,key,target);
 }});
 const actual=poolSurfaceArithmetic(p.geometry,watched,p.world,p.inverse,selected,p.worldErrors),old=retainedFullCageEvaluator(p.geometry,p.cage,p.world,p.inverse,selected,p.worldErrors);
 expect(reads.has(3)).toBe(true);expect(reads.has(6)).toBe(true);expect(reads.has(7)).toBe(false);
 expect(bytes(actual.values)).toEqual(bytes(old.values));expect(bytes(actual.errors)).toEqual(bytes(old.errors));
});

it('derives current dependencies after selected set and stencil changes',()=>{
 const p=fixture(),selected=new Set([0]);poolSurfaceArithmetic(p.geometry,p.cage,p.world,p.inverse,selected);
 selected.clear();selected.add(4);new Uint32Array(p.geometry.stencilWeights)[p.geometry.stencilRanges[4*4]*2]=3;
 p.worldErrors[1][12]*=4;
 const actual=poolSurfaceArithmetic(p.geometry,p.cage,p.world,p.inverse,selected,p.worldErrors),old=retainedFullCageEvaluator(p.geometry,p.cage,p.world,p.inverse,selected,p.worldErrors);
 expect(bytes(actual.values)).toEqual(bytes(old.values));expect(bytes(actual.errors)).toEqual(bytes(old.errors));
});

it.each(['world','inverse'] as const)('keeps malformed %s validation even for an empty selection',field=>{
 const p=fixture();p[field][1][3]=NaN;
 expect(()=>poolSurfaceArithmetic(p.geometry,p.cage,p.world,p.inverse,new Set())).toThrow('finite matrices');
 expect(()=>retainedFullCageEvaluator(p.geometry,p.cage,p.world,p.inverse,new Set())).toThrow('finite matrices');
});

it.each([.25,NaN,-1,3,Infinity])('rejects missing skin owner %s in an unselected cage row',bone=>{
 const p=fixture();p.cage[7*16+6]=bone;
 expect(()=>retainedFullCageEvaluator(p.geometry,p.cage,p.world,p.inverse,new Set([0]))).toThrow();
 expect(()=>poolSurfaceArithmetic(p.geometry,p.cage,p.world,p.inverse,new Set([0]))).toThrow();
});

it('retains unselected zero-weight influence ownership checks and the fixed-fixture exception',()=>{
 const p=fixture();p.cage[7*16+9]=42;expect(p.cage[7*16+13]).toBe(0);
 expect(()=>retainedFullCageEvaluator(p.geometry,p.cage,p.world,p.inverse,new Set())).toThrow();
 expect(()=>poolSurfaceArithmetic(p.geometry,p.cage,p.world,p.inverse,new Set())).toThrow();
 p.cage[7*16+15]=10;
 const actual=poolSurfaceArithmetic(p.geometry,p.cage,p.world,p.inverse,new Set()),old=retainedFullCageEvaluator(p.geometry,p.cage,p.world,p.inverse,new Set());
 expect(bytes(actual.values)).toEqual(bytes(old.values));expect(bytes(actual.errors)).toEqual(bytes(old.errors));
});
