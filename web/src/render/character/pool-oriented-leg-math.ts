import {PoolTrialRefusal} from './pool-trial-work.js';
import {poolAdd as add,poolSubtract as sub,poolMultiply as mul,poolDivide as div,poolNumber as number,type PoolNumber as N} from './pool-arithmetic.js';
import {vector,identity,plus,minus,scale,dot,cross,point,length,multiply,inverse,transform,properRotation,squareRoot,type M,type V} from './pool-matrix-arithmetic.js';

export interface OrientedLegInput {
  upper:number;lower:number;end:number;body:number;
  rest:M[];inverses:M[];basis:M[];world:M[];sourceUpper:M;sourceLower:M;target:V;kneeOrbit?:number;
}
const direction=(matrix:M,value:V):V=>{
  const rotation=[...matrix];rotation.splice(12,3,number(0),number(0),number(0));return transform(rotation,value);
};
function normalize(value:V,label:string):V {const size=length(value);if(size.value<=size.error)throw new Error('Unresolved pool '+label+' direction.');return scale(value,div(number(1),size));}
function orientedFrame(head:V,delta:V,axis:V):M {
  const y=normalize(delta,'leg endpoint'),x=normalize(minus(axis,scale(y,dot(axis,y))),'source bend plane'),z=cross(x,y);
  return [...x,number(0),...y,number(0),...z,number(0),...head,number(1)];
}

/** Oriented source hinge, with the configured rest relation retained in the reach equation. */
export function orientedPoolLegMath(input:OrientedLegInput){
  const {upper,lower,end,body,rest,inverses,basis,world,target}=input;
  const localUpper=multiply(inverses[body],rest[upper]),localLower=multiply(inverses[upper],rest[lower]),localEnd=multiply(inverses[lower],rest[end]);
  const cleanUpper=properRotation(input.sourceUpper),cleanLower=properRotation(input.sourceLower);
  const localAxis=normalize([sub(cleanLower[6],cleanLower[9]),sub(cleanLower[8],cleanLower[2]),sub(cleanLower[1],cleanLower[4])],'source hinge');
  const hingeUpper=direction(localLower,localAxis),axisInBody=direction(multiply(localUpper,cleanUpper),hingeUpper),axisWorld=direction(world[body],axisInBody);
  const a=point(localLower),b=point(localEnd),parallel=scale(localAxis,dot(localAxis,b)),cosinePart=minus(b,parallel),sinePart=cross(localAxis,b);
  const p=plus(a,direction(localLower,parallel)),q=direction(localLower,cosinePart),r=direction(localLower,sinePart),delta=minus(target,point(world[upper]));
  const A=dot(p,q),B=dot(p,r),D=div(sub(sub(dot(delta,delta),dot(p,p)),dot(cosinePart,cosinePart)),number(2)),radius=add(mul(A,A),mul(B,B)),disc=sub(radius,mul(D,D));
  if(radius.value<=radius.error)throw new Error('Pool leg has an unresolved hinge reach equation.');
  if(disc.value+disc.error<0)throw new PoolTrialRefusal('Pool target is outside this oriented hinge reach.');
  if(disc.value<=disc.error)throw new Error('Pool leg is at an unresolved hinge singularity.');
  const root=squareRoot(disc),branches=[1,-1].map(sign=>({
    cosine:div(add(mul(A,D),mul(number(sign),mul(B,root))),radius),
    sine:div(sub(mul(B,D),mul(number(sign),mul(A,root))),radius),branch:sign as 1|-1,
  }));
  const solutions=branches.filter(solution=>solution.sine.value>solution.sine.error);
  if(!solutions.length){
    if(branches.every(s=>s.sine.value+s.sine.error<=0))throw new PoolTrialRefusal('Pool target has no source-oriented positive hinge branch.');
    throw new Error('Pool target has no source-oriented positive hinge branch.');
  }
  const sourceCosine=div(sub(add(add(cleanLower[0],cleanLower[5]),cleanLower[10]),number(1)),number(2));
  solutions.sort((left,right)=>Math.abs(left.cosine.value-sourceCosine.value)-Math.abs(right.cosine.value-sourceCosine.value)||right.branch-left.branch);
  const {cosine:c,sine:s,branch}=solutions[0],oneMinus=sub(number(1),c),joint=identity();
  for(let column=0;column<3;column++)for(let row=0;row<3;row++){
    const skew=row===column?number(0):row===0&&column===1?mul(number(-1),localAxis[2]):row===0&&column===2?localAxis[1]
      :row===1&&column===0?localAxis[2]:row===1&&column===2?mul(number(-1),localAxis[0]):row===2&&column===0?mul(number(-1),localAxis[1]):localAxis[0];
    joint[column*4+row]=add(add(row===column?c:number(0),mul(oneMinus,mul(localAxis[row],localAxis[column]))),mul(s,skew));
  }
  const lowerBasis=properRotation(joint),combined=plus(a,direction(localLower,direction(lowerBasis,b)));
  const localFrame=orientedFrame(vector([0,0,0]),combined,hingeUpper),worldFrame=orientedFrame(point(world[upper]),delta,axisWorld);
  if(input.kneeOrbit!==undefined&&(!Number.isFinite(input.kneeOrbit)||Math.abs(input.kneeOrbit)>1))throw new Error('Invalid pool knee orbit.');
  if(input.kneeOrbit){
    const t=number(input.kneeOrbit),t2=mul(t,t),den=add(number(1),t2),cos=div(sub(number(1),t2),den),sin=div(mul(number(2),t),den);
    // Y follows hip-to-ankle. Turn X and Z about the opposite direction without moving Y or either joint.
    for(let i=0;i<3;i++){
      const x=worldFrame[i],z=worldFrame[8+i];
      worldFrame[i]=add(mul(cos,x),mul(sin,z));worldFrame[8+i]=sub(mul(cos,z),mul(sin,x));
    }
  }
  const desiredUpper=multiply(worldFrame,inverse(localFrame)),parentBody=world[body],parentFrame=multiply(parentBody,localUpper),upperBasis=properRotation(multiply(inverse(parentFrame),desiredUpper));
  const next=basis.map(matrix=>[...matrix]);next[upper]=upperBasis;next[lower]=lowerBasis;
  return {basis:next,upperBasis,lowerBasis,localAxis,axisInBody,axisWorld,cosine:c,sine:s,branch,
    flexion:Math.atan2(s.value,c.value),reachDiscriminant:disc};
}
