import type {Bone,Geometry,MeshPart} from './bundle.js';
import {configuredSurfaceScratch} from './surface-query.js';
import {type ShapeParameters} from './shape.js';
import {type Vec3} from './math.js';

/**
 * Candidate hand contacts on each thigh, as x, y, z triples in `points[side]`,
 * of which the first `counts[side]` are valid. The buffers belong to the
 * geometry and are rewritten by the next call for it.
 */
export interface ThighContactPatches {readonly points:readonly [Float64Array<ArrayBuffer>,Float64Array<ArrayBuffer>];readonly counts:[number,number]}
interface PatchScratch {parts:MeshPart[];sides:[MeshPart|undefined,MeshPart|undefined];patches:ThighContactPatches}
const scratches=new WeakMap<Geometry,PatchScratch>();
const boneRows=new WeakMap<readonly Bone[],readonly [number,number,number,number]>();
const third=1/3;

/**
 * `Math.hypot` is a builtin call that boxes its arguments, so frame code
 * decides comparisons with `Math.sqrt` of the sum of squares where that
 * cannot change the answer. Both agree to within a few units in the last
 * place; a result within this relative margin of a threshold, or a sum of
 * squares outside the range where it neither overflows nor underflows, is
 * decided with `Math.hypot` exactly as before.
 */
const MARGIN=1e-9,SAFE_LOW=1e-200,SAFE_HIGH=1e200;
const safe=(squares:number):boolean=>squares>SAFE_LOW&&squares<SAFE_HIGH;

function patchScratch(geometry:Geometry):PatchScratch {
  let scratch=scratches.get(geometry);if(scratch)return scratch;
  const parts=geometry.description.parts.filter(part=>part.name==='Creator bare leg L'||part.name==='Creator bare leg R');
  const side=(name:'L'|'R')=>geometry.description.parts.find(part=>part.name==='Creator bare leg '+name);
  const sides:[MeshPart|undefined,MeshPart|undefined]=[side('L'),side('R')];
  scratch={parts,sides,patches:{points:[new Float64Array(sides[0]?.count??0),new Float64Array(sides[1]?.count??0)],counts:[0,0]}};
  scratches.set(geometry,scratch);return scratch;
}

/** Rows of thigh.L, shin.L, thigh.R and shin.R; -1 for a missing bone, as `findIndex` gives. */
function thighRows(bones:readonly Bone[]):readonly [number,number,number,number] {
  let rows=boneRows.get(bones);if(rows)return rows;
  const row=(name:string)=>bones.findIndex(bone=>bone.name===name);
  rows=[row('thigh.L'),row('shin.L'),row('thigh.R'),row('shin.R')];boneRows.set(bones,rows);return rows;
}

/**
 * True when a triangle with normal `n` is skipped: degenerate, or facing less
 * than 0.35 upward. Exactly `Math.hypot(n) < 1e-10 || n2 * (1 / Math.hypot(n)) < 0.35`.
 */
export function facesAway(n0:number,n1:number,n2:number):boolean {
  // With every component a number and n2 not above zero, any size gives a ratio of at most zero, or the size test skips it.
  // A NaN component or an n2 of -Infinity makes the original's ratio NaN, which does not skip, so those take the exact path.
  if(n2<=0&&n2>-Infinity&&n0===n0&&n1===n1)return true;
  const squares=n0*n0+n1*n1+n2*n2;
  if(safe(squares)){
    const size=Math.sqrt(squares),ratio=n2/size;
    if(ratio<.35*(1-MARGIN))return true;
    if(ratio>.35*(1+MARGIN)&&size>1e-10*(1+MARGIN))return false;
  }
  const size=Math.hypot(n0,n1,n2);
  return size<1e-10||n2*(1/size)<.35;
}

/**
 * Candidate points lie on the upper surface of the configured, posed thigh:
 * the centers of triangles facing upward, between 15 and 75 percent of the
 * way from hip to knee. Runs every bath frame, so it writes into reused
 * buffers with the same arithmetic the vector helpers performed.
 */
export function thighContactPatches(geometry:Geometry,appearance:ShapeParameters,top:number,pose:number[][],inverse:number[][]):ThighContactPatches {
  const scratch=patchScratch(geometry),{patches}=scratch;
  const surface=configuredSurfaceScratch(geometry,scratch.parts,appearance,top,pose,inverse),indices=geometry.indices,rows=thighRows(geometry.manifest.bones);
  for(let side=0;side<2;side++){
    const part=scratch.sides[side];
    if(!part)throw new Error('Bath contact requires the configured bare thigh surface.');
    const hip=pose[rows[side*2]],knee=pose[rows[side*2+1]];
    const hx=hip[12],hy=hip[13],hz=hip[14],ax=knee[12]-hx,ay=knee[13]-hy,az=knee[14]-hz,square=ax*ax+ay*ay+az*az;
    const points=patches.points[side];let count=0;
    for(let at=part.start;at<part.start+part.count;at+=3){
      const a=indices[at]*3,b=indices[at+1]*3,c=indices[at+2]*3;
      const a0=surface[a],a1=surface[a+1],a2=surface[a+2];
      const u0=surface[b]-a0,u1=surface[b+1]-a1,u2=surface[b+2]-a2,v0=surface[c]-a0,v1=surface[c+1]-a1,v2=surface[c+2]-a2;
      if(facesAway(u1*v2-u2*v1,u2*v0-u0*v2,u0*v1-u1*v0))continue;
      const x=(a0+surface[b]+surface[c])*third,y=(a1+surface[b+1]+surface[c+1])*third,z=(a2+surface[b+2]+surface[c+2])*third;
      const fraction=((x-hx)*ax+(y-hy)*ay+(z-hz)*az)/square;
      if(fraction>=.15&&fraction<=.75){points[count*3]=x;points[count*3+1]=y;points[count*3+2]=z;count++;}
    }
    if(!count)throw new Error('No upper-thigh surface is available for the resting hand.');
    patches.counts[side]=count;
  }
  return patches;
}

/** Exactly `!(reach >= high || reach <= low)` for `reach = Math.hypot(d)`. */
export function withinReach(d0:number,d1:number,d2:number,low:number,high:number):boolean {
  const squares=d0*d0+d1*d1+d2*d2;
  if(safe(squares)){
    const reach=Math.sqrt(squares);
    if(reach>low*(1+MARGIN)&&reach<high*(1-MARGIN))return true;
    if(reach>high*(1+MARGIN)||reach<low*(1-MARGIN))return false;
  }
  const reach=Math.hypot(d0,d1,d2);
  return !(reach>=high||reach<=low);
}

const approximate={scores:new Float64Array(0)};
/**
 * The candidate nearest `preferred` that the arm can reach without full
 * extension or folding; null when none can. Among equally near candidates
 * the first wins. Distances use `Math.hypot` only for candidates that could
 * be nearest, so the choice is the one a `Math.hypot` comparison of every
 * candidate makes.
 */
export function nearestReachableContact(points:Float64Array<ArrayBuffer>,count:number,preferred:Vec3,offset:Vec3,shoulder:Vec3,upper:number,lower:number):Vec3|null {
  // Sized to the buffer's capacity, so a later call with more candidates for this thigh does not grow it again.
  if(approximate.scores.length<count)approximate.scores=new Float64Array(points.length/3);
  const scores=approximate.scores,high=upper+lower-.001,low=Math.abs(upper-lower)+.001;
  // Pass 1: reachable candidates keep an approximate distance; NaN marks the rest, and Infinity one only Math.hypot can rank.
  let nearest=Infinity;
  for(let i=0;i<count;i++){
    const x=points[i*3],y=points[i*3+1],z=points[i*3+2];
    if(!withinReach(x-offset[0]-shoulder[0],y-offset[1]-shoulder[1],z-offset[2]-shoulder[2],low,high)){scores[i]=NaN;continue;}
    const d0=x-preferred[0],d1=y-preferred[1],d2=z-preferred[2],squares=d0*d0+d1*d1+d2*d2;
    const score=safe(squares)?Math.sqrt(squares):Infinity;scores[i]=score;if(score<nearest)nearest=score;
  }
  // Pass 2: the exact comparison over every candidate whose distance can equal the nearest.
  const limit=nearest*(1+MARGIN);
  let best=-1,distance=Infinity;
  for(let i=0;i<count;i++){
    const approximateScore=scores[i];if(!(approximateScore<=limit)&&approximateScore!==Infinity)continue;
    const score=Math.hypot(points[i*3]-preferred[0],points[i*3+1]-preferred[1],points[i*3+2]-preferred[2]);if(score<distance){distance=score;best=i;}
  }
  return best<0?null:[points[best*3],points[best*3+1],points[best*3+2]];
}
