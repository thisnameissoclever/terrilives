import {add,sub,dot,cross,scale,length,unit,type Vec3} from './math.js';
import {posedCageSurface} from './geometry-proof.js';
import {evaluatePoolPoseProgram,poolSkinMatrices} from './pool-contact-sample.js';
import {makePoolPoseProgram,type PoolPoseProgram} from './pool-pose-program.js';
import type {PoolCycleSource,PoolFoot} from './pool-cycle-source.js';
import type {PoolSourceLocation} from './pool-source-policy.js';

const at=(m:readonly number[]):Vec3=>[m[12],m[13],m[14]];
type Section={along:number;radius:number};

/** Fit a forward shin inclination to the edge and underside of each higher external tread. */
export function outwardCalfDomain(source:PoolCycleSource){
 const {geometry,neutral}=source,body=geometry[0],points=posedCageSurface(body,source.cages[0],poolSkinMatrices(neutral.world,neutral.inverse));
 const margin=source.fixture.rails[0].radius/6;
 const treads=['crest','outside3','outside2'].map(place=>source.fixture.solids.find(s=>s.id===source.definition.places[place].surface)!);
 const feet=(['footL','footR'] as const).map(l=>{
  const a=source.anatomy[l],ankle=at(neutral.world[a.end]),shin=sub(at(neutral.world[a.lower]),ankle),size=length(shin),axis=scale(shin,1/size);
  const part=body.description.parts.find(p=>p.name==='Creator bare leg '+l.slice(-1))!;
  const sections=new Map<number,Section>(),triangles:Section[][]=[];
  const section=(id:number)=>{
   let q=sections.get(id);if(!q){
    const v=sub([points[3*id],points[3*id+1],points[3*id+2]],ankle),along=dot(axis,v);
    q={along,radius:length(sub(v,scale(axis,along)))};sections.set(id,q);
   }
   return q;
  };
  for(let k=part.start;k<part.start+part.count;k+=3){
   const tri=[section(body.indices[k]),section(body.indices[k+1]),section(body.indices[k+2])];
   if(!tri.every(q=>q.along>size)&&!tri.every(q=>q.along<0))triangles.push(tri);
  }
  return {size,triangles};
 });
 return (i:number,ankle:Vec3):Vec3|undefined=>{
  const {size,triangles}=feet[i];
  const obstacles=treads.filter(s=>s.bounds[1][2]>ankle[2]&&s.bounds[0][2]<ankle[2]+size+margin);
  if(!obstacles.length)return;
  function clears(angle:number){
   const c=Math.cos(angle),s=Math.sin(angle);
   return obstacles.every(rail=>triangles.every(tri=>
    tri.every(v=>ankle[1]+v.along*s-v.radius*c>=rail.bounds[1][1]+margin)||
    tri.every(v=>ankle[2]+v.along*c+v.radius*s<=rail.bounds[0][2]-margin)));
  }
  let lo=0,hi=Math.PI/2;
  if(clears(lo))return;
  if(clears(hi))for(let k=0;k<12;k++){const angle=(lo+hi)/2;if(clears(angle))hi=angle;else lo=angle;}
  return add(ankle,[0,size*Math.sin(hi),size*Math.cos(hi)]);
 };
}

/** Select the existing hinge branch's closest knee position around the fixed ankle/hip chord. */
export function aimOutwardKnee(source:PoolCycleSource,program:PoolPoseProgram,location:PoolSourceLocation,limb:PoolFoot,desired:Vec3){
 const i=limb==='footL'?0:1,a=source.anatomy[limb],world=evaluatePoolPoseProgram(source.bundle,source.neutral.rest,source.neutral.inverse,program,location).world;
 const hip=at(world[a.upper]),ankle=at(world[a.end]),axis=unit(sub(hip,ankle));
 const radial=(p:Vec3)=>{const d=sub(p,ankle);return sub(d,scale(axis,dot(d,axis)));};
 const before=radial(at(world[a.lower])),after=radial(desired);
 if(length(before)*length(after)<1e-10)return program;
 const change=Math.atan2(dot(cross(before,after),axis),dot(before,after));
 const angle=Math.max(-Math.PI/2,Math.min(Math.PI/2,2*Math.atan(program.controls[i].state.kneeOrbit??0)+change));
 return makePoolPoseProgram(program.preferenceBasis,program.controls.map((c,j)=>j===i?{...c,state:{...c.state,kneeOrbit:Math.tan(angle/2)}}:c),program.policy);
}
