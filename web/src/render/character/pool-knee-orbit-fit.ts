import {sub,dot,type Vec3} from './math.js';
import {poolSkinMatrices,evaluatePoolPoseProgram} from './pool-contact-sample.js';
import {posedCageSurface} from './geometry-proof.js';
import {PoolSolidIndex,horizontalPatch,projectedTrianglePatch,type Triangle} from './pool-solid.js';
import {derivePoolRailRegion} from './pool-rail-region.js';
import {makePoolPoseProgram,type PoolPoseProgram} from './pool-pose-program.js';
import type {PoolCycleSource,PoolFoot} from './pool-cycle-source.js';
import type {PoolSourceLocation} from './pool-source-policy.js';
import type {PoolSolid} from './pool-contact-types.js';
import {poolPhysicalFixtureKey} from './pool-owned-fixture.js';
import {canonicalPoolValue} from './pool-contact-identity.js';

type Range=[number,number];
type Axis=0|1|2;
type Witness={layer:number;ids:readonly number[];bary:Vec3;axis:Axis;side:number;plane:number};
export interface PoolKneeObstacle {solid:PoolSolid;axis:Axis;side:1|-1}
const selectedTriangles=new WeakMap<PoolCycleSource,Map<PoolFoot,number[][]>>();
function affectedTriangles(source:PoolCycleSource,limb:PoolFoot){
 let byFoot=selectedTriangles.get(source);if(!byFoot){byFoot=new Map();selectedTriangles.set(source,byFoot);}
 const saved=byFoot.get(limb);if(saved)return saved;
 const a=source.anatomy[limb];
 const layers=source.geometry.map((g,gi)=>{
  const cage=source.cages[gi],ci=new Uint32Array(g.stencilWeights),sw=new Float32Array(g.stencilWeights),affected=new Map<number,boolean>(),triangles:number[]=[];
  const moves=(id:number)=>{
   const known=affected.get(id);if(known!==undefined)return known;let yes=false;
   for(let j=g.stencilRanges[id*4],end=j+g.stencilRanges[id*4+1];j<end&&!yes;j++){
    const c=16*ci[j*2];for(let s=0;s<4;s++){
     const bone=cage[c+6+s];if((bone===a.upper||bone===a.lower)&&sw[j*2+1]*cage[c+10+s]!==0){yes=true;break;}
    }
   }
   affected.set(id,yes);return yes;
  };
  for(const p of g.description.parts)for(let k=p.start;k<p.start+p.count;k+=3)
   if(moves(g.indices[k])||moves(g.indices[k+1])||moves(g.indices[k+2]))triangles.push(k);
  return triangles;
 });
 byFoot.set(limb,layers);return layers;
}
const extent=Math.PI/2;
const point=(v:Float32Array,id:number):Vec3=>[v[3*id],v[3*id+1],v[3*id+2]];
export const poolTriangleBarycentric=(p:Vec3,tri:Triangle):Vec3=>{
 const a=sub(tri[1],tri[0]),b=sub(tri[2],tri[0]),s=sub(p,tri[0]),aa=dot(a,a),ab=dot(a,b),bb=dot(b,b),d=aa*bb-ab*ab;
 if(Math.abs(d)<1e-18)return [1,0,0];
 const u=(bb*dot(s,a)-ab*dot(s,b))/d,v=(aa*dot(s,b)-ab*dot(s,a))/d;return [1-u-v,u,v];
};
export function poolAngularHalfPlane(ranges:Range[],A:number,B:number,C:number):Range[]{
 const radius=Math.hypot(A,B);
 if(C>=radius)return ranges;if(C<=-radius||radius<1e-12)return [];
 const mid=Math.atan2(B,A),cut=Math.acos(C/radius),out:Range[]=[];
 for(const [a,b] of ranges)for(const d of [-2*Math.PI,0,2*Math.PI]){
  const lo=Math.max(a,mid+cut+d),hi=Math.min(b,mid+2*Math.PI-cut+d);if(hi>lo)out.push([lo,hi]);
 }
 return out;
}

function prepareRails(source:PoolCycleSource){
 return source.fixture.rails.map((r,i)=>{
  const solid=source.fixture.solids.find(s=>s.id===r.id)!;
  const n=derivePoolRailRegion(source.fixture,r.id,[0,r.points.length-1],i===0?1:-1).edges.length;
  const profile=solid.vertices.length/(n+3),start=solid.triangles.length-n*profile*2;
  const bands=Array.from({length:n},(_,j)=>{
   const v=solid.vertices.slice((j+2)*profile,(j+4)*profile);
   return [Math.min(...v.map(p=>p[1])),Math.max(...v.map(p=>p[1])),Math.min(...v.map(p=>p[2])),Math.max(...v.map(p=>p[2]))];
  });
  return {solid,index:new PoolSolidIndex(solid),axis:0 as Axis,side:i===0?-1:1,
   plane:i===0?solid.bounds[1][0]:solid.bounds[0][0],margin:r.radius/12,bands,faces:undefined as Triangle[]|undefined,ring:(face:number)=>Math.floor((face-start)/(2*profile))};
 });
}
const railInputs=new WeakMap<PoolCycleSource,{key:string;railsKey:string;data:ReturnType<typeof prepareRails>}>();
function retainedRails(source:PoolCycleSource){
 const key=poolPhysicalFixtureKey(source.fixture),railsKey=canonicalPoolValue(source.fixture.rails),saved=railInputs.get(source);
 if(saved&&saved.key===key&&saved.railsKey===railsKey)return saved.data;
 const data=prepareRails(source);railInputs.set(source,{key,railsKey,data});return data;
}

/** Steer the configured thigh and shin around the specified ankle goal, preserving foot orientation. */
export function fitPoolKneeOrbit(source:PoolCycleSource,node:PoolPoseProgram,location:PoolSourceLocation,limb:PoolFoot,preferred=0,
 goal:'installed'|'free-goal'='installed',obstacles:readonly PoolKneeObstacle[]=[]){
 if(limb!=='footL'&&limb!=='footR')throw new Error('A knee fit needs a foot.');
 const which=source.anatomy[limb],id=node.controls.findIndex(c=>c.end===which.end);
 const contact=node.policy[limb];
 if(id<0||node.controls[id].legFrame!=='source-entry-0'||node.controls[id].state.attached||
    (goal==='installed'?!contact.required:goal!=='free-goal'||contact.required||!['free','approach'].includes(contact.mode)))
  throw new Error('The knee fit requires its declared '+goal+' ankle.');
 const command=(angle:number)=>{
  const tangent=Math.tan(angle/2);
  if((node.controls[id].state.kneeOrbit??0)===tangent)return node;
  return makePoolPoseProgram(node.preferenceBasis,node.controls.map((c,i)=>i===id?{...c,state:{...c.state,kneeOrbit:tangent}}:c),node.policy);
 };
 const surfaces=(program:PoolPoseProgram)=>{
  const posed=evaluatePoolPoseProgram(source.bundle,source.neutral.rest,source.neutral.inverse,program,location),skin=poolSkinMatrices(posed.world,source.neutral.inverse);
  return source.geometry.map((g,i)=>posedCageSurface(g,source.cages[i],skin));
 };
 const rails=[...retainedRails(source)];
 for(const {solid,axis,side} of obstacles){
  if(!source.fixture.solids.includes(solid)||![0,1,2].includes(axis)||(side!==1&&side!==-1))throw new Error('Invalid finite knee obstacle.');
  const a=(axis+1)%3,b=(axis+2)%3;
  const faces=solid.triangles.map(t=>t.map(id=>{const p=solid.vertices[id];return [p[a],p[b],p[axis]];}) as unknown as Triangle);
  const bands=faces.map(t=>[Math.min(...t.map(p=>p[0])),Math.max(...t.map(p=>p[0])),Math.min(...t.map(p=>p[1])),Math.max(...t.map(p=>p[1]))]);
  rails.push({solid,index:new PoolSolidIndex(solid),axis,side,plane:solid.bounds[side===1?0:1][axis],margin:source.fixture.rails[0].radius/12,bands,faces,ring:f=>f});
 }
 const parts=affectedTriangles(source,limb);
 const witnesses=(mesh:Float32Array[],extra:boolean)=>{
  const out:Witness[]=[],active=rails.map(()=>new Set<number>());
  for(let layer=0;layer<parts.length;layer++){
   const g=source.geometry[layer],m=mesh[layer];
   for(const k of parts[layer]){
    const ids=Array.from(g.indices.subarray(k,k+3));
    for(const [ri,rail] of rails.entries()){
     const box=rail.solid.bounds;
     if([0,1,2].some(j=>ids.every(v=>m[v*3+j]<box[0][j]-rail.margin)||ids.every(v=>m[v*3+j]>box[1][j]+rail.margin)))continue;
     const tri=ids.map(v=>point(m,v)) as unknown as Triangle;
     const hit=rail.index.triangleWitness(tri);
     const touching=tri.filter(v=>{const p=rail.index.clearance(v);if(p.distance>=rail.margin)return false;active[ri].add(rail.ring(p.triangle));return true;});
     if(!hit&&!touching.length&&rail.index.minimumTriangleGap(tri,rail.margin)>=rail.margin)continue;
     if(hit){touching.push(hit.point);active[ri].add(rail.ring(hit.triangle));}
     if(!touching.length)touching.push(...tri);
     for(const p of touching)out.push({layer,ids,bary:poolTriangleBarycentric(p,tri),axis:rail.axis,side:rail.side,plane:rail.side*rail.plane-rail.margin});
    }
   }
  }
  if(extra)for(const [ri,rings] of active.entries()){
   const rail=rails[ri];
   for(const index of rings){
    const b=rail.bands[index];if(!b)continue;
    for(let layer=0;layer<parts.length;layer++){
     const g=source.geometry[layer],m=mesh[layer];
     for(const k of parts[layer]){
      const ids=Array.from(g.indices.subarray(k,k+3));
      const x=(rail.axis+1)%3,y=(rail.axis+2)%3;
      if(ids.every(id=>m[id*3+x]<b[0])||ids.every(id=>m[id*3+x]>b[1])||ids.every(id=>m[id*3+y]<b[2])||ids.every(id=>m[id*3+y]>b[3]))continue;
      const tri=ids.map(id=>point(m,id)) as unknown as Triangle,projected=tri.map(p=>[p[x],p[y],p[rail.axis]]) as unknown as Triangle;
      const face=rail.faces?.[index],area=face&&(face[1][0]-face[0][0])*(face[2][1]-face[0][1])-(face[1][1]-face[0][1])*(face[2][0]-face[0][0]);
      const clipped=face&&area?projectedTrianglePatch(projected,face):horizontalPatch(projected,[[b[0],b[2],-10],[b[1],b[3],10]]);
      for(const p of clipped){
       if(rail.side*p[2]<=rail.side*rail.plane-rail.margin)continue;
       const world:[number,number,number]=[0,0,0];world[x]=p[0];world[y]=p[1];world[rail.axis]=p[2];
       out.push({layer,ids,bary:poolTriangleBarycentric(world,tri),axis:rail.axis,side:rail.side,plane:rail.side*rail.plane-rail.margin});
      }
     }
    }
   }
  }
  return out;
 };
 let angle=Math.max(-extent,Math.min(extent,preferred)),program=command(angle),mesh=surfaces(program),hits=witnesses(mesh,true);
 if(!hits.length)return {program,angle,kneeOrbit:Math.tan(angle/2),allowed:[[angle,angle]] as Range[],clear:true};
 const base=angle===0?mesh:surfaces(command(0)),plus=surfaces(command(extent)),minus=surfaces(command(-extent));
 let allowed:Range[]=[[-extent,extent]];
 for(let pass=0;pass<5;pass++){
  for(const h of hits){
   let U=0,V=0,C=0;
   for(let j=0;j<3;j++){
    const offset=h.ids[j]*3+h.axis,p=plus[h.layer][offset],m=minus[h.layer][offset],c=(p+m)/2,w=h.bary[j];
    U+=w*(base[h.layer][offset]-c);V+=w*(p-m)/2;C+=w*c;
   }
   allowed=poolAngularHalfPlane(allowed,h.side*U,h.side*V,h.plane-h.side*C);if(!allowed.length)break;
  }
  if(!allowed.length)break;
  const candidates=allowed.map(([a,b])=>Math.max(a+Math.min(.015,(b-a)/2),Math.min(b-Math.min(.015,(b-a)/2),preferred)));
  angle=candidates.sort((a,b)=>Math.abs(a-preferred)-Math.abs(b-preferred))[0];
  program=command(angle);mesh=surfaces(program);hits=witnesses(mesh,true);
  if(!hits.length)return {program,angle,kneeOrbit:Math.tan(angle/2),allowed,clear:true};
 }
 return {program,angle,kneeOrbit:Math.tan(angle/2),allowed,clear:false};
}

/** Fit a real interpolation sample while preserving the preceding node shared with its incoming edge. */
export function fitPoolKneeOrbitEdge(source:PoolCycleSource,left:PoolPoseProgram,fromUnit:number,
 right:ReturnType<typeof fitPoolKneeOrbit>,toUnit:number,unit:number,action:'pool_enter'|'pool_exit_0',limb:PoolFoot){
 if(!(fromUnit<unit&&unit<toUnit))throw new Error('The knee sample must be inside its interval.');
 const clock=source.definition.clockUnits,mid=source.splitSelectedEntry(left,right.program,fromUnit,toUnit,unit,action);
 const id=mid.controls.findIndex(c=>c.end===source.anatomy[limb].end);
 const tangent=mid.controls[id].state.kneeOrbit??0;
 const fitted=fitPoolKneeOrbit(source,mid,{action,phase:unit/clock},limb,2*Math.atan(tangent),mid.policy[limb].required?'installed':'free-goal');
 if(!fitted.clear||Math.abs(fitted.kneeOrbit-tangent)<=1e-12)return right;
 // The interpolator blends half-angle tangents. Solve the right endpoint
 // given the fixed left endpoint and the measured interior tangent.
 const weight=(unit-fromUnit)/(toUnit-fromUnit);
 const end=Math.max(-1,Math.min(1,right.kneeOrbit+(fitted.kneeOrbit-tangent)/weight));
 return fitPoolKneeOrbit(source,right.program,{action,phase:toUnit/clock},limb,2*Math.atan(end),right.program.policy[limb].required?'installed':'free-goal');
}
