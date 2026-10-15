import type {Geometry} from './bundle.js';
import type {ShapeParameters} from './shape.js';
import {queryConfiguredSurface} from './surface-query.js';
import {add,boneFrame,inverseAffine,length,multiply,solveLimb,sub,transform,type Vec3} from './math.js';
import {reachableSegment} from './contact-math.js';

/** Fit the full-sized sleeper to mattress and pillow, bending knees instead of scaling the body. */
export function fitSleepingPose(geometry:Geometry,a:ShapeParameters,top:number,pose:number[][],rest:number[][],rig:number[],source:number[][]):void {
  const bones=geometry.manifest.bones,index=(name:string)=>{const id=bones.findIndex(bone=>bone.name===name);if(id<0)throw new Error('Missing sleeping bone: '+name);return id;};
  const inverse=rest.map(inverseAffine),worldPose=pose.map((matrix,i)=>i<17?multiply(rig,matrix):source[i]);
  const measured=geometry.description.parts.filter(part=>['Sculpted head','Overshirt body','Trouser hip bridge'].includes(part.name)||[6,8,9].includes(part.region));
  const points=queryConfiguredSurface(geometry,measured,a,top,worldPose,inverse),at=(i:number):Vec3=>[points[i*3],points[i*3+1],points[i*3+2]];
  const fixture=geometry.fixtureGeometry??geometry;
  const fixtureParts=fixture.description.parts.filter(part=>/Creator clip (bed|bunk) (Mattress|Lower mattress|Pillow |Lower pillow|Headboard)/.test(part.name));
  const fixturePoints=queryConfiguredSurface(fixture,fixtureParts,a,top,worldPose,inverse);
  const bounds=(name:string)=>{
    const mesh=name.startsWith('Creator clip ')?fixture:geometry;
    const values=name.startsWith('Creator clip ')?fixturePoints:points;
    const part=mesh.description.parts.find(part=>part.name===name);if(!part)throw new Error('Missing sleeping surface: '+name);
    const ids=[...new Set(mesh.indices.slice(part.start,part.start+part.count))];
    return [0,1,2].map(axis=>[Math.min(...ids.map(i=>values[i*3+axis])),Math.max(...ids.map(i=>values[i*3+axis]))]);
  };
  const prefix=fixture.description.parts.some(part=>part.name==='Creator clip bed Mattress')?'Creator clip bed ':'Creator clip bunk ';
  const mattress=bounds(prefix+(prefix.includes('bunk')?'Lower mattress':'Mattress'));
  const head=bounds('Sculpted head'),shirt=bounds('Overshirt body'),hips=bounds('Trouser hip bridge');
  const pillows=fixture.description.parts.filter(part=>part.name.startsWith(prefix+(prefix.includes('bunk')?'Lower pillow':'Pillow ')));
  if(!pillows.length)throw new Error('Sleeping fixture has no pillow.');
  const headX=(head[0][0]+head[0][1])/2;
  const pillow=pillows.map(part=>bounds(part.name)).sort((a,b)=>Math.abs((a[0][0]+a[0][1])/2-headX)-Math.abs((b[0][0]+b[0][1])/2-headX))[0];
  const delta:[number,number,number]=[(pillow[0][0]+pillow[0][1])/2-headX,(pillow[1][0]+pillow[1][1])/2-(head[1][0]+head[1][1])/2,mattress[2][1]+.003-Math.min(shirt[2][0],hips[2][0])];
  if(prefix.includes(' bed ')){
    const board=bounds(prefix+'Headboard');let rear=-Infinity;
    for(const part of geometry.description.parts)if(part.region===8||part.region===9)for(let i=part.start;i<part.start+part.count;i++){
      const p=at(geometry.indices[i]);
      if(p[2]+delta[2]>=board[2][0]&&p[2]+delta[2]<=board[2][1])rear=Math.max(rear,p[1]);
    }
    if(Number.isFinite(rear))delta[1]=Math.min(delta[1],board[1][0]-.008-rear);
  }
  for(let i=0;i<17;i++)worldPose[i].splice(12,3,...add(worldPose[i].slice(12,15) as unknown as Vec3,delta));
  for(const side of ['L','R']){
    const thigh=index('thigh.'+side),shin=index('shin.'+side),foot=index('foot.'+side);
    const start=worldPose[thigh].slice(12,15) as unknown as Vec3,current=worldPose[foot].slice(12,15) as unknown as Vec3;
    const footIds=new Set<number>();
    for(const part of geometry.description.parts)if(part.region===6)for(let at=part.start;at<part.start+part.count;at++){
      const id=geometry.indices[at];if(geometry.vertices[id*16+6]===foot)footIds.add(id);
    }
    if(!footIds.size)throw new Error('Sleeping foot has no surface.');
    const minY=Math.min(...[...footIds].map(id=>at(id)[1]+delta[1])),minZ=Math.min(...[...footIds].map(id=>at(id)[2]+delta[2]));
    const end:[number,number,number]=[current[0],current[1]+Math.max(0,mattress[1][0]+.02-minY),current[2]+mattress[2][1]+.003-minZ];
    const upper=length(sub(rest[shin].slice(12,15) as unknown as Vec3,rest[thigh].slice(12,15) as unknown as Vec3));
    const lower=length(sub(rest[foot].slice(12,15) as unknown as Vec3,rest[shin].slice(12,15) as unknown as Vec3));
    const minimumY=current[1]+mattress[1][0]+.02-minY;
    const reachable=reachableSegment([end[0],0,end[2]],[0,1,0],start,upper+lower-.001,[minimumY,start[1]-.03]);
    if(!reachable)throw new Error('No supported sleeping foot placement fits the configured leg.');
    end[1]=Math.max(reachable[0],Math.min(reachable[1],end[1]));
    const knee=solveLimb(start,end,upper,lower,add(start,[0,0,1]));
    worldPose[thigh]=boneFrame(start,knee,worldPose[thigh]);worldPose[shin]=boneFrame(knee,end,worldPose[shin]);worldPose[foot].splice(12,3,...end);
  }
  const rigInverse=inverseAffine(rig);for(let i=0;i<17;i++)pose[i]=multiply(rigInverse,worldPose[i]);
}
