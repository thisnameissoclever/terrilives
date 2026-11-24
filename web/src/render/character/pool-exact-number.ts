/** Exact dyadic arithmetic for finite authored coordinates and homogeneous skin coefficients. */
export interface PoolDyadic {readonly numerator:bigint;readonly exponent:number}
export interface PoolRatio {readonly numerator:PoolDyadic;readonly denominator:PoolDyadic}
const scalar=new Float64Array(1),bits=new BigUint64Array(scalar.buffer);
export function poolExact(value:number):PoolDyadic {
  if(!Number.isFinite(value))throw new Error('Pool exact arithmetic requires finite inputs.');
  if(value===0)return {numerator:0n,exponent:0};
  scalar[0]=value;const word=bits[0],sign=word>>63n?-1n:1n,exponent=Number((word>>52n)&2047n),fraction=word&((1n<<52n)-1n);
  return {numerator:sign*(exponent?((1n<<52n)|fraction):fraction),exponent:exponent?exponent-1075:-1074};
}
export function poolExactAdd(a:PoolDyadic,b:PoolDyadic):PoolDyadic {
  if(a.numerator===0n)return b;if(b.numerator===0n)return a;
  const exponent=Math.min(a.exponent,b.exponent);
  return {numerator:(a.numerator<<BigInt(a.exponent-exponent))+(b.numerator<<BigInt(b.exponent-exponent)),exponent};
}
export function poolExactSubtract(a:PoolDyadic,b:PoolDyadic):PoolDyadic {return poolExactAdd(a,{numerator:-b.numerator,exponent:b.exponent});}
export function poolExactMultiply(a:PoolDyadic,b:PoolDyadic):PoolDyadic {return a.numerator===0n||b.numerator===0n?{numerator:0n,exponent:0}:{numerator:a.numerator*b.numerator,exponent:a.exponent+b.exponent};}
export const poolExactCompare=(a:PoolDyadic,b:PoolDyadic)=>Math.sign(Number(poolExactSubtract(a,b).numerator));
export function poolRatioCompare(a:PoolRatio,b:PoolRatio):number {
  if(a.denominator.numerator<=0||b.denominator.numerator<=0)throw new Error('Pool contact ratio needs positive homogeneous weights.');
  return poolExactCompare(poolExactMultiply(a.numerator,b.denominator),poolExactMultiply(b.numerator,a.denominator));
}
function ratioParts(ratio:PoolRatio){
  const negative=ratio.numerator.numerator<0n,n=negative?-ratio.numerator.numerator:ratio.numerator.numerator,d=ratio.denominator.numerator;
  if(d<=0n)throw new Error('Pool contact ratio needs a positive denominator.');
  const exponent=ratio.numerator.exponent-ratio.denominator.exponent;
  let power=n===0n?0:n.toString(2).length-d.toString(2).length+exponent;
  if(n!==0n&&poolExactCompare({numerator:n,exponent},{numerator:d,exponent:power})<0)power--;
  const shift=52-power+exponent,left=shift>=0?n<<BigInt(shift):n,right=shift>=0?d:d<<BigInt(-shift);
  return {negative,n,power,left,right};
}
/** Round a rational target once, with an exact numerator/remainder tie decision. */
export function poolRatioNumber(ratio:PoolRatio):number {
  const {negative,n,power,left,right}=ratioParts(ratio);if(n===0n)return 0;
  let quotient=left/right;const remainder=left%right;
  if(remainder*2n>right||remainder*2n===right&&(quotient&1n)!==0n)quotient++;
  const value=Number(quotient)*2**(power-52);
  if(!Number.isFinite(value)||value===0)throw new Error('Pool contact target is outside its supported numeric range.');
  return negative?-value:value;
}
export function poolRatioUpper(ratio:PoolRatio):number {
  const {negative,n,power,left,right}=ratioParts(ratio);if(negative)throw new Error('Pool error radius must be nonnegative.');if(n===0n)return 0;
  const quotient=left/right+(left%right?1n:0n),value=Number(quotient)*2**(power-52);
  if(!Number.isFinite(value)||value===0)throw new Error('Pool numeric error is outside its supported range.');return value;
}
export function poolRatioRoundingError(ratio:PoolRatio,value:number):number {
  const difference=poolExactSubtract(ratio.numerator,poolExactMultiply(poolExact(value),ratio.denominator));
  return poolRatioUpper({numerator:{...difference,numerator:difference.numerator<0n?-difference.numerator:difference.numerator},denominator:ratio.denominator});
}
