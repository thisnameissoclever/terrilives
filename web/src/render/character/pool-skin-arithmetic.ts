import type {Geometry} from './bundle.js';
import {poolAdd as add,poolMultiply as mul,poolNumber as number,poolFloat32 as float32,type PoolNumber} from './pool-arithmetic.js';
import {countPoolOwnedWork,poolOwnedConfiguredIdentity,poolOwnedParts,poolOwnsArithmeticPose} from './pool-owned-compilation.js';

/** Bound the exact skin-matrix, cage skin and exported subdivision operation sequence. */
export function poolSurfaceArithmetic(geometry:Geometry,cage:Float32Array<ArrayBuffer>,world:readonly number[][],inverse:readonly number[][],selected?:ReadonlySet<number>,worldErrors?:readonly (readonly number[])[]) {
  return evaluateSurfaceArithmetic(geometry,cage,world,inverse,selected,worldErrors);
}

const dependencies=new WeakMap<readonly number[],readonly number[]>();

/** The owned plan records the exact stencil rows and their cage dependencies. */
export function poolPartSurfaceArithmetic(geometry:Geometry,cage:Float32Array<ArrayBuffer>,world:readonly number[][],inverse:readonly number[][],
  selected:ReadonlySet<number>|readonly number[],worldErrors?:readonly (readonly number[])[]) {
  const owned=poolOwnsArithmeticPose(geometry,cage,world,inverse),part=owned?poolOwnedParts(geometry)?.find(part=>part.vertices===selected):undefined;
  if(!part)return evaluateSurfaceArithmetic(geometry,cage,world,inverse,selected,worldErrors);
  let required=dependencies.get(part.vertices);
  if(!required){
    const ids=new Uint32Array(geometry.stencilWeights),used=new Set<number>();
    for(const vertex of part.vertices){
      const start=geometry.stencilRanges[vertex*4],count=geometry.stencilRanges[vertex*4+1];
      for(let at=start;at<start+count;at++)used.add(ids[at*2]);
    }
    required=Object.freeze([...used].sort((a,b)=>a-b));dependencies.set(part.vertices,required);
    countPoolOwnedWork(geometry,'dependencyPlans');
  }
  countPoolOwnedWork(geometry,'arithmeticRuns');
  return evaluateSurfaceArithmetic(geometry,cage,world,inverse,selected,worldErrors,required);
}

function evaluateSurfaceArithmetic(geometry:Geometry,cage:Float32Array<ArrayBuffer>,world:readonly number[][],inverse:readonly number[][],selected?:Iterable<number>,
  worldErrors?:readonly (readonly number[])[],plan?:readonly number[]) {
  if(world.some(matrix=>matrix.length!==16||matrix.some(value=>!Number.isFinite(value)))||inverse.some(matrix=>matrix.length!==16||matrix.some(value=>!Number.isFinite(value))))throw new Error('Pool surface arithmetic requires finite matrices.');
  const matrices:PoolNumber[][]=world.map((matrix,bone)=>{
    const output:PoolNumber[]=[];
    for(let column=0;column<4;column++)for(let row=0;row<4;row++){
      let result=number(0);for(let k=0;k<4;k++)result=add(result,mul({value:matrix[k*4+row],error:worldErrors?.[bone]?.[k*4+row]??0},number(inverse[bone][column*4+k])));
      output[column*4+row]=float32(result);
    }
    return output;
  });
  const ids=new Uint32Array(geometry.stencilWeights),weights=new Float32Array(geometry.stencilWeights),required=selected&&!plan?new Set<number>():undefined;
  if(required)for(const vertex of selected!){
    const start=geometry.stencilRanges[vertex*4],count=geometry.stencilRanges[vertex*4+1];
    for(let at=start;at<start+count;at++)required.add(ids[at*2]);
  }
  const skinned:PoolNumber[]=plan?new Array(cage.length/16*3):Array.from({length:cage.length/16*3},()=>number(0));
  for(let row=0;row<(plan?.length??cage.length/16);row++){
    const vertex=plan?.[row]??row,at=vertex*16;
    if(required&&!required.has(vertex)){
      // Every non-fixture influence must still name a real matrix, including zero weights.
      if(cage[at+15]!==10)for(let influence=0;influence<4;influence++)if(!matrices[cage[at+6+influence]])throw new TypeError('Pool surface arithmetic cage references a missing skin matrix.');
      continue;
    }
    for(let axis=0;axis<3;axis++){
      if(cage[at+15]===10){skinned[vertex*3+axis]=number(cage[at+axis]);continue;}
      if(plan)skinned[vertex*3+axis]=number(0);
      for(let influence=0;influence<4;influence++){
        const matrix=matrices[cage[at+6+influence]],weight=number(cage[at+10+influence]);
        const p=add(add(add(mul(matrix[axis],number(cage[at])),mul(matrix[4+axis],number(cage[at+1]))),mul(matrix[8+axis],number(cage[at+2]))),matrix[12+axis]);
        skinned[vertex*3+axis]=float32(add(skinned[vertex*3+axis],mul(weight,p)));
      }
    }
  }
  const errors=new Float64Array(geometry.description.vertexCount*3),values=new Float32Array(geometry.description.vertexCount*3);
  for(const vertex of selected??Array.from({length:geometry.description.vertexCount},(_,index)=>index))for(let axis=0;axis<3;axis++){
    let result=number(0);const start=geometry.stencilRanges[vertex*4],count=geometry.stencilRanges[vertex*4+1];
    for(let at=start;at<start+count;at++)result=float32(add(result,mul(skinned[ids[at*2]*3+axis],number(weights[at*2+1]))));
    errors[vertex*3+axis]=result.error;
    values[vertex*3+axis]=result.value;
  }
  return {errors,values};
}

/** Reassociate the same rigid skin equation, with every coefficient operation bounded. */
export function poolRigidSurfaceReference(geometry:Geometry,cage:Float32Array<ArrayBuffer>,world:readonly number[],inverse:readonly number[],bone:number,vertex:number):PoolNumber[] {
  const owner=poolOwnedConfiguredIdentity(geometry,cage,inverse,bone);
  let byVertex:Map<number,PoolNumber[]>|undefined;
  if(owner){
    let byBone=rigidCoefficients.get(geometry);
    if(!byBone){byBone=new Map();rigidCoefficients.set(geometry,byBone);}
    byVertex=byBone.get(bone);
    if(!byVertex){byVertex=new Map();byBone.set(bone,byVertex);}
  }
  let coefficients=byVertex?.get(vertex);
  if(!coefficients){
    coefficients=rigidReferenceCoefficients(geometry,cage,inverse,bone,vertex);
    if(byVertex){byVertex.set(vertex,coefficients);countPoolOwnedWork(geometry,'roundedCoefficientBuilds');}
  }
  return [0,1,2].map(axis=>add(add(add(mul(number(world[axis]),coefficients[0]),mul(number(world[4+axis]),coefficients[1])),mul(number(world[8+axis]),coefficients[2])),mul(number(world[12+axis]),coefficients[3])));
}

const rigidCoefficients=new WeakMap<Geometry,Map<number,Map<number,PoolNumber[]>>>();
function rigidReferenceCoefficients(geometry:Geometry,cage:Float32Array<ArrayBuffer>,inverse:readonly number[],bone:number,vertex:number):PoolNumber[] {
  const ids=new Uint32Array(geometry.stencilWeights),weights=new Float32Array(geometry.stencilWeights),coefficients=Array.from({length:4},()=>number(0));
  const start=geometry.stencilRanges[vertex*4],count=geometry.stencilRanges[vertex*4+1];
  for(let at=start;at<start+count;at++){
    const source=ids[at*2]*16,position=[0,1,2].map(axis=>add(add(add(mul(number(inverse[axis]),number(cage[source])),mul(number(inverse[4+axis]),number(cage[source+1]))),mul(number(inverse[8+axis]),number(cage[source+2]))),number(inverse[12+axis])));
    for(let slot=0;slot<4;slot++){
      const weight=mul(number(weights[at*2+1]),number(cage[source+10+slot]));if(weight.value===0)continue;
      if(cage[source+6+slot]!==bone)throw new Error('Arithmetic support reference requires rigid end-bone ownership.');
      for(let axis=0;axis<3;axis++)coefficients[axis]=add(coefficients[axis],mul(weight,position[axis]));
      coefficients[3]=add(coefficients[3],weight);
    }
  }
  return coefficients;
}
