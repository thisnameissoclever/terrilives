import {add,sub,scale,dot,cross,type Vec3} from './math.js';
import type {PoolCycleSource,PoolHand} from './pool-cycle-source.js';
import type {PoolPoseProgram} from './pool-pose-program.js';
import type {PoolLimbState} from './pool-contact-evaluator.js';
import {evaluatePoolPoseProgram,poolSkinMatrices} from './pool-contact-sample.js';
import {posedCageSurface} from './geometry-proof.js';
import {poolWaterBounds} from './pool-water-retarget.js';
import {configuredPoolChainReach} from './pool-entry-domain.js';
import {resolvePoolRailContactFrame} from './pool-rail-contact-frame.js';
import type {NumericBody} from './pool-numeric-recipe.js';
import {PoolTrialRefusal} from './pool-trial-work.js';
import {poolSelectedVertices} from './pool-surface-coefficient.js';
import {projectedTrianglePatch,horizontalPatch,PoolSolidIndex,type Triangle} from './pool-solid.js';
import {fitClimbHand} from './pool-climb-hand.js';

type Range=[number,number];
const pos=(m:readonly number[]):Vec3=>[m[12],m[13],m[14]];


/** Fit a moving set of skin triangles to the liner and the real faces in its path. */
export function preparePoolSurfacePosition(source:PoolCycleSource,program:PoolPoseProgram,origin:Vec3,
 location={action:'pool_paddle',phase:0},pivot=false){
 const pose=evaluatePoolPoseProgram(source.bundle,source.neutral.rest,source.neutral.inverse,program,location);
 const bones=poolSkinMatrices(pose.world,source.neutral.inverse),wet=poolWaterBounds(source.fixture);
 const meshes=source.geometry.map((g,i)=>{
  const parts=pivot?g.description.parts.filter(p=>/upper arm skin|Forearm with elbow|Relaxed palm|Resting thumb|bare torso|Natural neck|Sculpted head/.test(p.name)):g.description.parts;
  const triangles=parts.flatMap(p=>Array.from(g.indices.subarray(p.start,p.start+p.count)));
  return {points:posedCageSurface(g,source.cages[i],bones),ids:pivot?[...new Set(triangles)]:[...poolSelectedVertices(g)],triangles};
 });
 const coping=source.fixture.solids.find(s=>s.id==='Pool stone coping');
 if(!coping)throw new Error('Swim turn needs the actual coping.');
 const min=[wet.low[0],wet.low[1]],max=[wet.high[0],wet.high[1]];
 for(const axis of [0,1]){
  const across=1-axis;
  for(const tri of coping.triangles)for(let j=0;j<3;j++){
   const a=coping.vertices[tri[j]],b=coping.vertices[tri[(j+1)%3]];
   if(a[across]===b[across]||a[across]*b[across]>0)continue;
   const k=-a[across]/(b[across]-a[across]),x=a[axis]+k*(b[axis]-a[axis]);
   if(x>0)max[axis]=Math.min(max[axis],x);else if(x<0)min[axis]=Math.max(min[axis],x);
  }
 }
 const margin=source.fixture.rails[0].radius/8;
 const buckets=new Map<number,number[]>(),faces:Triangle[]=[],cell=.10;
 const cells=(loX:number,hiX:number,loZ:number,hiZ:number)=>{
  const ids:number[]=[];
  for(let x=Math.floor(loX/cell);x<=Math.floor(hiX/cell);x++)for(let z=Math.floor(loZ/cell);z<=Math.floor(hiZ/cell);z++)ids.push((x+64)*128+z+64);
  return ids;
 };
 const box=(v:Triangle)=>[Math.min(...v.map(p=>p[0])),Math.max(...v.map(p=>p[0])),Math.min(...v.map(p=>p[1])),Math.max(...v.map(p=>p[1]))] as const;
 const bounds:(readonly [number,number,number,number])[]=[];
 const depth:(readonly [number,number])[]=[];
 const hardware=source.fixture.solids.filter(s=>pivot?s.id.startsWith('Pool ladder rail'):/ladder|coping|^Pool wall/i.test(s.id));
 const fullDomain=source.definition.version===16&&source.definition.forwardHop?.platformTurn?.loadedSteps?.[0]?.start===64000&&!pivot;
 const indices=fullDomain?hardware.map(s=>new PoolSolidIndex(s)):[];
 for(const solid of hardware)for(const f of solid.triangles){
  const t=f.map(i=>{const p=solid.vertices[i];return [p[0],p[2],p[1]];}) as unknown as Triangle;
  const b=box(t),id=faces.length;faces.push(t);bounds.push(b);
  depth.push([Math.min(t[0][2],t[1][2],t[2][2]),Math.max(t[0][2],t[1][2],t[2][2])]);
  for(const key of cells(...b)){const members=buckets.get(key)??[];members.push(id);buckets.set(key,members);}
 }
 const area=(s:Triangle)=>(s[1][0]-s[0][0])*(s[2][1]-s[0][1])-(s[1][1]-s[0][1])*(s[2][0]-s[0][0]);
 function overlap(body:Triangle,surface:Triangle,b:ReturnType<typeof box>){
  return area(surface)!==0?projectedTrianglePatch(body,surface):
   horizontalPatch(body,[[b[0],b[2],-10],[b[1],b[3],10]]);
 }
 return (wanted:Vec3,angle:number):Vec3=>{
  const c=Math.cos(angle),s=Math.sin(angle),lo=[Infinity,Infinity],hi=[-Infinity,-Infinity];
  const include=(px:number,py:number)=>{
   const x=px-origin[0],y=py-origin[1],p=[c*x-s*y,s*x+c*y];
   for(const axis of [0,1]){lo[axis]=Math.min(lo[axis],p[axis]);hi[axis]=Math.max(hi[axis],p[axis]);}
  };
  for(const {points,ids,triangles} of meshes){
   const top=coping.bounds[1][2]+margin;
   for(const id of ids)if(!fullDomain||points[id*3+2]<=top)include(points[id*3],points[id*3+1]);
   if(fullDomain)for(let k=0;k<triangles.length;k+=3)for(let j=0;j<3;j++){
    const a=3*triangles[k+j],b=3*triangles[k+(j+1)%3],za=points[a+2],zb=points[b+2];
    if((za-top)*(zb-top)>=0)continue;
    const t=(top-za)/(zb-za);include(points[a]+(points[b]-points[a])*t,points[a+1]+(points[b+1]-points[a+1])*t);
   }
  }
  const result=[...wanted];
  for(const axis of [0,1]){
   if(pivot&&axis===0)continue;
   const low=min[axis]-lo[axis]+margin,high=max[axis]-hi[axis]-margin;
   if(low>high)throw new PoolTrialRefusal('The selected swim turn exceeds the basin width.');
   result[axis]=Math.max(low,Math.min(high,result[axis]));
  }
  const low=min[1]-lo[1]+margin,high=fullDomain?max[1]-hi[1]-margin:result[1];
  const outsideSolids=(x:number,y:number)=>{
   for(const {points,ids,triangles} of meshes){
    const placed=new Float64Array(points.length);
    for(const id of ids){
     const i=id*3,dx=points[i]-origin[0],dy=points[i+1]-origin[1],p:Vec3=[x+c*dx-s*dy,y+s*dx+c*dy,points[i+2]];
     placed.set(p,i);
     for(let j=0;j<hardware.length;j++){
      const b=hardware[j].bounds;
      if(p.every((v,k)=>v>=b[0][k]&&v<=b[1][k])&&indices[j].inside(p))return false;
     }
    }
    const at=(j:number):Vec3=>[placed[j*3],placed[j*3+1],placed[j*3+2]];
    for(let k=0;k<triangles.length;k+=3){
     const tri:Triangle=[at(triangles[k]),at(triangles[k+1]),at(triangles[k+2])];
     for(let j=0;j<hardware.length;j++){
      const box=hardware[j].bounds;
      if([0,1,2].some(i=>tri.every(p=>p[i]<box[0][i])||tri.every(p=>p[i]>box[1][i])))continue;
      if(indices[j].triangleWitness(tri))return false;
     }
    }
   }
   return true;
  };
  const centerY=(centerX:number)=>{
  const forbidden:Range[]=[],seen=new Int32Array(faces.length);let serial=0;
  for(const m of meshes){
   const transformed=new Float64Array(m.points.length);
   for(const id of m.ids){const i=id*3,x=m.points[i]-origin[0],y=m.points[i+1]-origin[1];
    transformed[i]=centerX+c*x-s*y;transformed[i+1]=m.points[i+2];transformed[i+2]=s*x+c*y;}
   for(let k=0;k<m.triangles.length;k+=3){
    const v=(j:number):Vec3=>{const at=m.triangles[k+j]*3;return [transformed[at],transformed[at+1],transformed[at+2]];};
    const tri:Triangle=[v(0),v(1),v(2)],b=box(tri);serial++;
    const depthLow=Math.min(tri[0][2],tri[1][2],tri[2][2]),depthHigh=Math.max(tri[0][2],tri[1][2],tri[2][2]);
    for(const key of cells(...b))for(const id of buckets.get(key)??[]){
     if(seen[id]===serial)continue;seen[id]=serial;
     const h=bounds[id];if(b[0]>h[1]||b[1]<h[0]||b[2]>h[3]||b[3]<h[2])continue;
     // Even before clipping, these depth ranges cannot touch anywhere along the permitted translation.
     if(depth[id][1]-depthLow+2*margin<low||depth[id][0]-depthHigh-2*margin>high)continue;
     const a=overlap(tri,faces[id],h),z=overlap(faces[id],tri,b);if(!a.length||!z.length)continue;
     const from=Math.min(...z.map(p=>p[2]))-Math.max(...a.map(p=>p[2]))-margin;
     const to=Math.max(...z.map(p=>p[2]))-Math.min(...a.map(p=>p[2]))+margin;
     if(to>=low&&from<=high)forbidden.push([Math.max(low,from),Math.min(high,to)]);
     if(forbidden.length>=8192){const merged=unite(forbidden);forbidden.length=0;forbidden.push(...merged);}
    }
   }
  }
  let y=result[1];
  const blocked=unite(forbidden);
  if(fullDomain){
   const possible:number[]=[];
   let edge=low;
   for(const [a,b] of blocked){
    if(b<low||a>high)continue;
    const top=Math.min(high,a-margin);if(edge<=top)possible.push(Math.max(edge,Math.min(top,y)));
    edge=Math.max(edge,b+margin);if(edge>high)break;
   }
   if(edge<=high)possible.push(Math.max(edge,Math.min(high,y)));
   return possible.sort((a,b)=>Math.abs(a-y)-Math.abs(b-y)).find(v=>outsideSolids(centerX,v))??null;
  }
  for(const [a,b] of blocked.reverse())if(y>=a&&y<=b)y=a-margin;
  return y>=low?y:null;
  };
  const nominal=centerY(result[0]);
  if(nominal!==null)return [result[0],nominal,result[2]];
  if(!pivot&&source.definition.version===16&&source.definition.forwardHop?.launchFromUnit){
    const ladder=source.fixture.solids.filter(s=>s.id.includes('ladder'));
    const left=min[0]-lo[0]+margin,right=max[0]-hi[0]-margin;
    const lanes=[Math.min(...ladder.map(s=>s.bounds[0][0]))-hi[0]-margin,
      Math.max(...ladder.map(s=>s.bounds[1][0]))-lo[0]+margin].map(x=>Math.max(left,Math.min(right,x)));
    if(source.definition.forwardHop?.platformTurn?.loadedSteps?.[0]?.start===64000)
      lanes.push(...lanes.map(x=>(x+result[0])/2));
    for(const x of lanes.sort((a,b)=>Math.abs(a-result[0])-Math.abs(b-result[0]))){
      const y=centerY(x);if(y!==null)return [x,y,result[2]];
    }
  }
  throw new PoolTrialRefusal('The selected swim turn has no basinward corridor past the ladder.');
 };
}

function unite(ranges:Range[]):Range[]{
 const out:Range[]=[];
 for(const [a,b] of ranges.sort((l,r)=>l[0]-r[0])){
  if(!out.length||a>out[out.length-1][1])out.push([a,b]);
  else out[out.length-1][1]=Math.max(out[out.length-1][1],b);
 }
 return out;
}

/** Increase upper-body pitch only when the configured palms cannot reach from the planted stance. */
export function supportedClimbBody(source:PoolCycleSource,intent:NumericBody,yaw:number,phase:number,
 required:readonly PoolHand[],previous:Partial<Record<PoolHand,PoolLimbState['attached']>>){
 const initial=source.climbBody(intent,yaw);
 function grips(pose:typeof initial){
  const result:Partial<Record<PoolHand,PoolLimbState>>={};
  for(const limb of required){
   const grip=source.climbGrip(limb,phase,pose,previous[limb]);
   result[limb]=source.definition.version===16&&source.definition.forwardHop?.launchFromUnit?
    fitClimbHand(source,limb,pos(pose.world[source.anatomy[limb].upper]),grip,source.definition.hand.insideBranch):grip;
  }
  return result;
 }
 try{return {pose:initial,grips:grips(initial)};}catch(error){if(!(error instanceof PoolTrialRefusal))throw error;}
 if(required.some(l=>!previous[l]))throw new PoolTrialRefusal('Climb acquisition needs another supported stance at '+phase);
 const axis:Vec3=[Math.cos(yaw),Math.sin(yaw),0],pivot=pos(initial.world[source.bundle.bones.findIndex(b=>b.name==='spine')]);
 const maximum=(82-intent.trunkPitch)*Math.PI/180;
 let common:Range[]=[[0,maximum]];
 for(const limb of required){
  const g=previous[limb]!,a=source.anatomy[limb],joint=pos(initial.world[a.upper]),r=sub(joint,pivot);
  const origin=add(pivot,scale(axis,dot(axis,r))),u=sub(joint,origin),v=cross(axis,u);
  const reach=configuredPoolChainReach(source.neutral.rest,a.upper,a.lower,a.end),ranges:Range[]=[];
  const frame=resolvePoolRailContactFrame(g.geometry,g.rawOrientation,g.parameter,g.activeVertex,g.source);
  const coef=g.geometry.coefficients[g.geometry.vertices.indexOf(g.activeVertex)][3],w=Number(coef.numerator)*2**coef.exponent;
  const at=(edge:Vec3)=>add(frame.translation,scale(sub(edge,frame.targetPoint),1/w));
  for(const e of g.geometry.edges){
   if(e.edge.toParameter<=source.definition.hand.insideBranch[0]||e.edge.fromParameter>=source.definition.hand.insideBranch[1])continue;
   const l=at(e.from),h=at(e.to),d=sub(h,l),nearest=Math.max(0,Math.min(1,dot(sub(joint,l),d)/dot(d,d)));
   for(const wrist of [l,add(l,scale(d,nearest)),h]){
    const x=sub(wrist,origin),A=dot(u,x),B=dot(v,x),rho=Math.hypot(A,B);
    if(!rho)continue;
    const limit=(dot(u,u)+dot(x,x)-reach.maximum*reach.maximum)/(2*rho);
    if(limit>=1)continue;
    const wide=Math.acos(Math.max(-1,limit)),centre=Math.atan2(B,A);
    for(const shift of [-2*Math.PI,0,2*Math.PI]){
     const lo=Math.max(0,centre+shift-wide),hi=Math.min(maximum,centre+shift+wide);
     if(hi>lo)ranges.push([lo,hi]);
    }
   }
  }
  const allowed=unite(ranges);
  common=unite(common.flatMap(([a,b])=>allowed.flatMap(([c,d])=>Math.max(a,c)<Math.min(b,d)?[[Math.max(a,c),Math.min(b,d)] as Range]:[])));
 }
 if(!common.length)throw new PoolTrialRefusal('Both held palms have no measured common torso angle at '+phase);
 const [lo,hi]=common[0],angle=lo+(hi-lo)/8;
 const pose=source.climbBody({...intent,trunkPitch:intent.trunkPitch+angle*180/Math.PI},yaw);
 return {pose,grips:grips(pose)};
}
