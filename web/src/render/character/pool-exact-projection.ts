import type {Vec3} from './math.js';
import type {Triangle} from './pool-solid.js';

const scalar=new Float64Array(1),bits=new BigUint64Array(scalar.buffer);
/** Every finite binary64 coordinate is an integer multiple of 2^-1074. */
function dyadic(value:number):bigint {
  if(!Number.isFinite(value))throw new Error('Pool projection coordinates must be finite.');
  scalar[0]=value;const word=bits[0],sign=word>>63n?-1n:1n,exponent=Number((word>>52n)&2047n),fraction=word&((1n<<52n)-1n);
  return sign*(exponent?((1n<<52n)|fraction)<<BigInt(exponent-1):fraction);
}
type Point=readonly [bigint,bigint];
const exact=(point:Vec3):Point=>[dyadic(point[0]),dyadic(point[1])];
const cross=(a:Point,b:Point,c:Point)=>(b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0]);
const equal=(a:Point,b:Point)=>a[0]===b[0]&&a[1]===b[1];
function hull(points:Point[]):Point[] {
  const sorted=points.sort((a,b)=>a[0]<b[0]?-1:a[0]>b[0]?1:a[1]<b[1]?-1:a[1]>b[1]?1:0).filter((p,i,all)=>i===0||!equal(p,all[i-1]));
  const half=(source:Point[])=>{const out:Point[]=[];for(const point of source){while(out.length>1&&cross(out.at(-2)!,out.at(-1)!,point)<=0n)out.pop();out.push(point);}return out;};
  return [...half(sorted).slice(0,-1),...half([...sorted].reverse()).slice(0,-1)];
}
const area=(points:readonly Point[])=>points.reduce((sum,p,i)=>sum+p[0]*points[(i+1)%points.length][1]-p[1]*points[(i+1)%points.length][0],0n);

/** Exact containment in actual facets or an exactly tiled convex pair; no area epsilon. */
export function poolPatchProjectionStatus(body:readonly Triangle[],support:readonly Triangle[]):'contained'|'outside'|'unsupported-union' {
  const faces=support.map(triangle=>triangle.map(exact)),regions:Point[][]=[...faces];
  for(const face of faces)if(cross(face[0],face[1],face[2])<=0n)throw new Error('Pool support projection must face upward.');
  for(let left=0;left<faces.length;left++)for(let right=left+1;right<faces.length;right++){
    const a=faces[left],b=faces[right],shared=a.filter(p=>b.some(q=>equal(p,q)));if(shared.length!==2)continue;
    const thirdA=a.find(p=>!shared.some(q=>equal(p,q)))!,thirdB=b.find(p=>!shared.some(q=>equal(p,q)))!;
    if(cross(shared[0],shared[1],thirdA)*cross(shared[0],shared[1],thirdB)>=0n)continue;
    const convex=hull([...a,...b]);if(area(convex)===area(a)+area(b))regions.push(convex);
  }
  const inside=(p:Point,region:readonly Point[])=>region.every((a,index)=>cross(a,region[(index+1)%region.length],p)>=0n);
  if(body.every(triangle=>regions.some(region=>triangle.map(exact).every(p=>inside(p,region)))))return 'contained';
  if(body.some(triangle=>triangle.map(exact).some(p=>!faces.some(face=>inside(p,face)))))return 'outside';
  return 'unsupported-union';
}
export const poolPatchProjectionContained=(body:readonly Triangle[],support:readonly Triangle[])=>poolPatchProjectionStatus(body,support)==='contained';
