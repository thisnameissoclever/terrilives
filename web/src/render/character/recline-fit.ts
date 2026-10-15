import type {Geometry,MeshPart} from './bundle.js';
import {queryConfiguredSurface} from './surface-query.js';
import {add,boneFrame,inverseAffine,length,multiply,solveLimb,sub,type Vec3} from './math.js';
import type {ShapeParameters} from './shape.js';
import {SupportSurface} from './support-surface.js';
import {CHARACTER_OUTLINE_WIDTH} from './authored-surfaces.js';

const position=(matrix:readonly number[]):Vec3=>[matrix[12],matrix[13],matrix[14]];
const cache=new WeakMap<Geometry,Map<string,number[][]>>();

function surface(geometry:Geometry,parts:MeshPart[],points:Float32Array<ArrayBuffer>):SupportSurface {
  const triangles:[number,number,number][]=[];
  for(const part of parts)for(let at=part.start;at<part.start+part.count;at+=3)triangles.push(Array.from(geometry.indices.slice(at,at+3)) as [number,number,number]);
  const ids=[...new Set(triangles.flat())],map=new Map(ids.map((id,index)=>[id,index]));
  return new SupportSurface(ids.map(id=>[points[id*3],points[id*3+1],points[id*3+2]]),triangles.map(row=>row.map(id=>map.get(id)!) as [number,number,number]));
}

/** Measure a finite surface overlap before placing the unclipped body on its support. */
function supportShift(body:SupportSurface,fixture:SupportSurface,dx=0,dy=0):number {
  const gaps:number[]=[];
  for(let x=Math.max(body.bounds[0]+dx,fixture.bounds[0])+.0025;x<Math.min(body.bounds[1]+dx,fixture.bounds[1]);x+=.005)
    for(let y=Math.max(body.bounds[2]+dy,fixture.bounds[2])+.0025;y<Math.min(body.bounds[3]+dy,fixture.bounds[3]);y+=.005){
      const low=body.height(x-dx,y-dy,'bottom'),high=fixture.height(x,y,'top');
      if(low!==undefined&&high!==undefined)gaps.push(high-low);
    }
  if(gaps.length<8)throw new Error('The recliner has no finite support surface.');
  return Math.max(...gaps)+.0015;
}

/** Keep a full-size recliner inside the end arms and bend the knees to supported heels. */
export function fitRecliningPose(geometry:Geometry,a:ShapeParameters,top:number,pose:number[][],rest:number[][],rig:number[],source:number[][]):void {
  const key=JSON.stringify([a,top]);let entries=cache.get(geometry);
  if(!entries){entries=new Map();cache.set(geometry,entries);}const saved=entries.get(key);
  if(saved){for(let i=0;i<17;i++)pose[i]=[...saved[i]];return;}
  const bones=geometry.manifest.bones,index=(name:string)=>{const id=bones.findIndex(bone=>bone.name===name);if(id<0)throw new Error('Missing reclining bone: '+name);return id;};
  const inverse=rest.map(inverseAffine),world=pose.map((matrix,i)=>i<17?multiply(rig,matrix):source[i]);
  const measured=geometry.description.parts.filter(part=>[1,8,9].includes(part.region)||['Overshirt body','Trouser hip bridge'].includes(part.name)||part.region===6&&/sole/i.test(part.name));
  const points=queryConfiguredSurface(geometry,measured,a,top,world,inverse),fixture=geometry.fixtureGeometry??geometry;
  const supports=fixture.description.parts.filter(part=>/^Creator clip recline (Seat cushion |Arm right|Arm left)/.test(part.name));
  const fixturePoints=queryConfiguredSurface(fixture,supports,a,top,world,inverse);
  const fixtureSurface=(suffix:string)=>{
    const parts=fixture.description.parts.filter(part=>part.name.startsWith('Creator clip recline '+suffix));
    if(!parts.length)throw new Error('Missing reclining support: '+suffix);
    return surface(fixture,parts,fixturePoints);
  };
  const seat=fixtureSurface('Seat cushion '),headArm=fixtureSurface('Arm right'),footArm=fixtureSurface('Arm left');
  const headParts=geometry.description.parts.filter(part=>[1,8,9].includes(part.region));
  const headIds=new Set<number>();let rear=-Infinity;
  for(const part of headParts)for(let at=part.start;at<part.start+part.count;at++){
    const id=geometry.indices[at];headIds.add(id);rear=Math.max(rear,points[id*3+1]);
  }
  // The visible hair stays inside the actual end arm, including its outline shell.
  const clearance=CHARACTER_OUTLINE_WIDTH+.002;
  const dy=Math.min(0,headArm.bounds[3]-clearance-rear);
  const torso=surface(geometry,geometry.description.parts.filter(part=>['Overshirt body','Trouser hip bridge'].includes(part.name)),points);
  const dz=supportShift(torso,seat,0,dy),delta:Vec3=[0,dy,dz];
  for(let i=0;i<17;i++)world[i].splice(12,3,...add(position(world[i]),delta));
  // Turn at the neck rather than moving a wide torso through the back cushions.
  const head=index('head'),pivot=position(world[head]);
  const fitsHead=(angle:number)=>{
    const c=Math.cos(angle),s=Math.sin(angle);
    for(const id of headIds){const x=pivot[0]+c*(points[id*3]-pivot[0])+s*(points[id*3+2]+dz-pivot[2]);
      if(x<headArm.bounds[0]+clearance||x>headArm.bounds[1]-clearance)return false;
    }
    return true;
  };
  let angle=0;
  if(!fitsHead(0)){
    let found=false;
    for(let degree=1;degree<=60;degree++)if(fitsHead(degree*Math.PI/180)){
      let low=(degree-1)*Math.PI/180,high=degree*Math.PI/180;
      for(let i=0;i<16;i++){const middle=(low+high)/2;if(fitsHead(middle))high=middle;else low=middle;}
      angle=high;found=true;break;
    }
    if(!found)throw new Error('The configured head cannot recline inside the sofa side.');
  }
  const c=Math.cos(angle),s=Math.sin(angle);
  const turn=[c,0,-s,0,0,1,0,0,s,0,c,0,pivot[0]-c*pivot[0]-s*pivot[2],0,pivot[2]+s*pivot[0]-c*pivot[2],1];
  world[head]=multiply(turn,world[head]);
  for(const side of ['L','R']){
    const thigh=index('thigh.'+side),shin=index('shin.'+side),foot=index('foot.'+side);
    const soleParts=geometry.description.parts.filter(part=>part.region===6&&/sole/i.test(part.name)&&geometry.vertices[geometry.indices[part.start]*16+6]===foot);
    if(!soleParts.length)throw new Error('Reclining foot has no sole geometry.');
    const sole=surface(geometry,soleParts,points),old=position(multiply(rig,pose[foot]));
    const soleCenter=(sole.bounds[2]+sole.bounds[3])/2,armCenter=(footArm.bounds[2]+footArm.bounds[3])/2;
    const footY=armCenter-soleCenter,footZ=supportShift(sole,footArm,0,footY);
    const end=add(old,[0,footY,footZ]),start=position(world[thigh]);
    const upper=length(sub(position(rest[shin]),position(rest[thigh]))),lower=length(sub(position(rest[foot]),position(rest[shin])));
    const knee=solveLimb(start,end,upper,lower,add(start,[0,0,1]));
    world[thigh]=boneFrame(start,knee,world[thigh]);world[shin]=boneFrame(knee,end,world[shin]);
    world[foot].splice(12,3,...end);
  }
  const rigInverse=inverseAffine(rig);for(let i=0;i<17;i++)pose[i]=multiply(rigInverse,world[i]);
  if(entries.size>=32)entries.delete(entries.keys().next().value!);entries.set(key,pose.slice(0,17).map(matrix=>[...matrix]));
}
