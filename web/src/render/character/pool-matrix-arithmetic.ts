import {poolAdd as add,poolSubtract as sub,poolMultiply as mul,poolDivide as div,poolNumber as number,poolUpper,poolLower,type PoolNumber as N} from './pool-arithmetic.js';
import {poolExact,poolExactCompare,poolExactMultiply} from './pool-exact-number.js';
import type {Vec3} from './math.js';

export type V=readonly [N,N,N];export type M=N[];
export const vector=(v:Vec3):V=>v.map(number) as unknown as V;
export const matrix=(values:readonly number[]):M=>values.map(number);
const zero=()=>number(0),one=()=>number(1);
export const identity=():M=>[one(),zero(),zero(),zero(),zero(),one(),zero(),zero(),zero(),zero(),one(),zero(),zero(),zero(),zero(),one()];
export const plus=(a:V,b:V):V=>a.map((v,i)=>add(v,b[i])) as unknown as V;
export const minus=(a:V,b:V):V=>a.map((v,i)=>sub(v,b[i])) as unknown as V;
export const scale=(a:V,s:N):V=>a.map(v=>mul(v,s)) as unknown as V;
export const dot=(a:V,b:V)=>add(add(mul(a[0],b[0]),mul(a[1],b[1])),mul(a[2],b[2]));
export const cross=(a:V,b:V):V=>[sub(mul(a[1],b[2]),mul(a[2],b[1])),sub(mul(a[2],b[0]),mul(a[0],b[2])),sub(mul(a[0],b[1]),mul(a[1],b[0]))];
export const point=(m:M):V=>[m[12],m[13],m[14]];
const nextDown=(value:number)=>value===0?-Number.MIN_VALUE:value>0?poolLower(value):-poolUpper(-value);

/** Check square-root brackets exactly, without assuming a library error tolerance. */
export function squareRoot(a:N):N {
  if(a.value<0||!Number.isFinite(a.value)||!Number.isFinite(a.error))throw new Error('Unresolved pool construction square root.');
  const low=Math.max(0,nextDown(a.value-a.error)),high=poolUpper(a.value+a.error),value=Math.sqrt(a.value);
  const lower=Math.max(0,nextDown(Math.sqrt(low))),upper=poolUpper(Math.sqrt(high));
  if(poolExactCompare(poolExactMultiply(poolExact(lower),poolExact(lower)),poolExact(low))>0
      ||poolExactCompare(poolExactMultiply(poolExact(upper),poolExact(upper)),poolExact(high))<0)throw new Error('Pool construction square-root bracket did not contain its exact input.');
  return {value,error:poolUpper(Math.max(value-lower,upper-value))};
}
export function length(a:V):N {
  const reference=squareRoot(dot(a,a)),value=Math.hypot(...a.map(v=>v.value));
  if(Math.abs(value-reference.value)>reference.error)throw new Error('Pool vector norm is outside its independently derived arithmetic bracket.');
  // Both the actual primitive and the exact norm lie in the checked interval.
  return {value,error:poolUpper(2*reference.error)};
}
export const unit=(a:V):V=>{const size=length(a);if(size.value<1e-10)throw new Error('Degenerate pool construction axis.');return scale(a,div(one(),size));};
export function multiply(a:M,b:M):M {
  const out=Array.from({length:16},zero);
  for(let column=0;column<4;column++)for(let row=0;row<4;row++)for(let k=0;k<4;k++)out[column*4+row]=add(out[column*4+row],mul(a[k*4+row],b[column*4+k]));return out;
}
export function transform(m:M,p:V):V {return [0,1,2].map(row=>add(add(add(mul(m[row],p[0]),mul(m[4+row],p[1])),mul(m[8+row],p[2])),m[12+row])) as unknown as V;}
export function inverse(m:M):M {
  const [a,b,c,d,e,f,g,h,i]=[m[0],m[4],m[8],m[1],m[5],m[9],m[2],m[6],m[10]];
  const det=add(sub(mul(a,sub(mul(e,i),mul(f,h))),mul(b,sub(mul(d,i),mul(f,g)))),mul(c,sub(mul(d,h),mul(e,g))));
  if(Math.abs(det.value)<=det.error)throw new Error('Pool construction inverse remains numerically singular.');
  const rows=[sub(mul(e,i),mul(f,h)),sub(mul(c,h),mul(b,i)),sub(mul(b,f),mul(c,e)),sub(mul(f,g),mul(d,i)),sub(mul(a,i),mul(c,g)),
    sub(mul(c,d),mul(a,f)),sub(mul(d,h),mul(e,g)),sub(mul(b,g),mul(a,h)),sub(mul(a,e),mul(b,d))];
  const out=identity();for(let row=0;row<3;row++)for(let col=0;col<3;col++)out[col*4+row]=div(rows[row*3+col],det);
  out.splice(12,3,...transform(out,scale(point(m),number(-1))));return out;
}
export function boneFrame(head:V,tail:V,reference:M):M {
  const y=unit(minus(tail,head)),ref:V=[reference[0],reference[1],reference[2]];
  let x=minus(ref,scale(y,dot(ref,y)));
  if(length(x).value<1e-6)x=cross(y,Math.abs(y[2].value)<.8?vector([0,0,1]):vector([0,1,0]));
  x=unit(x);const z=cross(x,y);return [...x,zero(),...y,zero(),...z,zero(),...head,one()];
}
export function properRotation(m:M):M {
  const a:V=[m[0],m[1],m[2]],b:V=[m[4],m[5],m[6]],y=unit(b),x=unit(minus(a,scale(y,dot(a,y)))),z=cross(x,y);
  return [...x,zero(),...y,zero(),...z,zero(),zero(),zero(),zero(),one()];
}
export function solve(start:V,end:V,upper:N,lower:N,pole:V):V {
  const delta=minus(end,start),distance=length(delta);
  // Strict triangle inequalities hold for every exact value enclosed by these bounds.
  const lengths=[distance,upper,lower],margins=[sub(add(upper,lower),distance),sub(add(distance,lower),upper),sub(add(distance,upper),lower)];
  if(lengths.some(value=>!Number.isFinite(value.value)||!Number.isFinite(value.error)||value.error<0||value.value<=value.error)
      ||margins.some(value=>!Number.isFinite(value.value)||!Number.isFinite(value.error)||value.value<=value.error))throw new Error('Pool two-link reach domain is outside or unresolved.');
  const axis=scale(delta,div(one(),distance)),raw=minus(pole,start);
  let projected=minus(raw,scale(axis,dot(raw,axis)));
  if(length(projected).value<1e-8){const reference=Math.abs(axis[1].value)<.95?vector([0,-1,0]):vector([1,0,0]);projected=minus(reference,scale(axis,dot(reference,axis)));}
  const perpendicular=unit(projected),along=div(add(sub(mul(upper,upper),mul(lower,lower)),mul(distance,distance)),mul(number(2),distance));
  const squared=sub(mul(upper,upper),mul(along,along)),height=squareRoot(squared);
  return plus(plus(start,scale(axis,along)),scale(perpendicular,height));
}

