/** Forward error of the actual operations; callers cannot supply a physical tolerance. */
export interface PoolNumber {value:number;error:number}
const unit=Number.EPSILON/2;
const scalar=new Float64Array(1),words=new Uint32Array(scalar.buffer);
export function poolUpper(value:number):number {
  if(!Number.isFinite(value))return value;
  if(value<0)throw new Error('Pool error radius must be nonnegative.');
  scalar[0]=value;words[0]=(words[0]+1)>>>0;if(words[0]===0)words[1]++;return scalar[0];
}
export function poolLower(value:number):number {
  if(!Number.isFinite(value)||value<0)throw new Error('Pool lower endpoint must be finite and nonnegative.');
  if(value===0)return 0;
  scalar[0]=value;if(words[0]===0)words[1]--;words[0]=(words[0]-1)>>>0;return scalar[0];
}
const plus=(a:number,b:number)=>poolUpper(a+b),times=(a:number,b:number)=>poolUpper(a*b);
const rounding=(value:number)=>plus(poolUpper(times(Math.abs(value),unit)/(1-unit)),Number.MIN_VALUE);
export const poolNumber=(value:number):PoolNumber=>({value,error:0});
export function poolAdd(a:PoolNumber,b:PoolNumber):PoolNumber {const value=a.value+b.value;return {value,error:plus(plus(a.error,b.error),rounding(value))};}
export function poolSubtract(a:PoolNumber,b:PoolNumber):PoolNumber {return poolAdd(a,{value:-b.value,error:b.error});}
export function poolMultiply(a:PoolNumber,b:PoolNumber):PoolNumber {
  const value=a.value*b.value;return {value,error:plus(plus(plus(times(Math.abs(a.value),b.error),times(Math.abs(b.value),a.error)),times(a.error,b.error)),rounding(value))};
}
export function poolDivide(a:PoolNumber,b:PoolNumber):PoolNumber {
  const value=a.value/b.value,rawDenominator=Math.abs(b.value)-b.error;
  const denominator=rawDenominator>0?Math.max(0,rawDenominator-rounding(rawDenominator)):0;
  return {value,error:denominator>0?plus(poolUpper(plus(a.error,times(Math.abs(value),b.error))/denominator),rounding(value)):Infinity};
}
export function poolFloat32(a:PoolNumber):PoolNumber {const value=Math.fround(a.value);return {value,error:plus(a.error,poolUpper(Math.abs(value-a.value)))};}
