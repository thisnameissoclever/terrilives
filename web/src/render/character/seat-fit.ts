import type {Geometry,MeshPart} from './bundle.js';
import {queryConfiguredSurface} from './surface-query.js';
import {SupportSurface} from './support-surface.js';
import {add,boneFrame,inverseAffine,length,multiply,scale,solveLimb,sub,transform,unit,type Vec3} from './math.js';
import {shapePoint,type ShapeParameters} from './shape.js';
import {reachableSegment} from './contact-math.js';

/** The middle sofa cushion is the shared pose; stable places translate it afterward. */
const supportNames:Readonly<Record<string,string>>={seat_armchair:'Seat cushion',seat_reading:'Chair seat cushion',seat_dining:'Seat',
  seat_office:'Seat cushion',seat_ottoman:'Cushion',seat_sofa:'Seat cushion 1',dining:'Seat'};
const cell=.01,contactGap=.005,separation=.0015,calfPenetration=.015;
const position=(matrix:readonly number[]):Vec3=>[matrix[12],matrix[13],matrix[14]];
interface Leg {thigh:number;shin:number;foot:number;upper:number;lower:number}
export interface SeatedPoseFit {readonly pelvis:Vec3;readonly legs:readonly number[][]}
type LegIndices=Pick<Leg,'thigh'|'shin'|'foot'>;
interface CachedFit {
 presentation:ShapeParameters['presentation'];height:number;build:number;shoulders:number|undefined;hips:number|undefined;
 torso:number|undefined;top:number;family:string;inputs:readonly number[];delta:Vec3;legs:readonly number[][];
}
const fits=new WeakMap<Geometry,CachedFit[]>();
const indices=new WeakMap<Geometry,readonly LegIndices[]>();
function legIndices(geometry:Geometry):readonly LegIndices[]{
  let saved=indices.get(geometry);if(saved)return saved;
  const index=(name:string)=>geometry.manifest.bones.findIndex(bone=>bone.name===name);
  saved=['L','R'].map(side=>({thigh:index('thigh.'+side),shin:index('shin.'+side),foot:index('foot.'+side)}));
  indices.set(geometry,saved);return saved;
}
function sameInputs(saved:CachedFit,pose:number[][],source:number[][],rig:number[],range:readonly [number,number],legs:readonly LegIndices[]):boolean{
  let at=0;
  for(let i=0;i<16;i++)if(saved.inputs[at++]!==pose[1][i])return false;
  for(const leg of legs)for(let i=0;i<16;i++)if(saved.inputs[at++]!==pose[leg.thigh][i])return false;
  for(const leg of legs){
    for(let i=0;i<16;i++)if(saved.inputs[at++]!==source[leg.thigh][i])return false;
    for(let i=0;i<16;i++)if(saved.inputs[at++]!==source[leg.shin][i])return false;
    for(let i=0;i<16;i++)if(saved.inputs[at++]!==source[leg.foot][i])return false;
  }
  for(let i=0;i<16;i++)if(saved.inputs[at++]!==rig[i])return false;
  return saved.inputs[at++]===range[0]&&saved.inputs[at]===range[1];
}
function applyFit(pose:number[][],ids:readonly LegIndices[],delta:Vec3,solved:readonly number[][]):void{
  for(let i=0;i<17;i++)for(let axis=0;axis<3;axis++)pose[i][12+axis]+=delta[axis];
  let offset=0;
  for(const leg of ids){
    for(let i=0;i<16;i++)pose[leg.thigh][i]=solved[offset][i];offset++;
    for(let i=0;i<16;i++)pose[leg.shin][i]=solved[offset][i];offset++;
    for(let i=0;i<16;i++)pose[leg.foot][i]=solved[offset][i];offset++;
  }
}

/** Install prepared rig-space contacts while preserving the current upper-body animation. */
export function applySeatedPoseFit(geometry:Geometry,pose:number[][],fit:SeatedPoseFit):void{
  applyFit(pose,legIndices(geometry),sub(fit.pelvis,position(pose[1])),fit.legs);
}

/** Contact preparation owns the cold search and leaves its input pose untouched. */
export function compileSeatedPoseFit(geometry:Geometry,a:ShapeParameters,top:number,family:string,pose:number[][],rest:number[][],
  rig:number[],source:number[][],range:readonly [number,number]):SeatedPoseFit{
  const candidate=pose.map(matrix=>[...matrix]);
  if(!fitSeatedPose(geometry,a,top,family,candidate,rest,rig,source,range))throw new Error('Unknown seated contact family: '+family);
  return {pelvis:position(candidate[1]),legs:legIndices(geometry).flatMap(leg=>[candidate[leg.thigh],candidate[leg.shin],candidate[leg.foot]]).map(matrix=>[...matrix])};
}
function surface(geometry:Geometry,parts:readonly MeshPart[],points:Float32Array):SupportSurface{
  const triangles:[number,number,number][]=[];
  for(const part of parts)for(let at=part.start;at<part.start+part.count;at+=3)triangles.push(Array.from(geometry.indices.slice(at,at+3)) as [number,number,number]);
  const ids=[...new Set(triangles.flat())],remap=new Map(ids.map((id,index)=>[id,index]));
  return new SupportSurface(ids.map(id=>[points[id*3],points[id*3+1],points[id*3+2]]),triangles.map(row=>row.map(id=>remap.get(id)!) as [number,number,number]));
}

/** A patch covers connected cells on both horizontal axes after vertical fitting. */
function contactHeight(body:SupportSurface,seat:SupportSurface,dx:number,dy:number):number|null{
  const minX=Math.ceil((Math.max(body.bounds[0]+dx,seat.bounds[0])-cell/2)/cell);
  const maxX=Math.floor((Math.min(body.bounds[1]+dx,seat.bounds[1])-cell/2)/cell);
  const minY=Math.ceil((Math.max(body.bounds[2]+dy,seat.bounds[2])-cell/2)/cell);
  const maxY=Math.floor((Math.min(body.bounds[3]+dy,seat.bounds[3])-cell/2)/cell),rows=maxY-minY+1;
  const gaps:{x:number;y:number;gap:number}[]=[];let dz=-Infinity;
  for(let ix=minX;ix<=maxX;ix++)for(let iy=minY;iy<=maxY;iy++){
    const x=(ix+.5)*cell,y=(iy+.5)*cell,bottom=body.height(x-dx,y-dy,'bottom'),top=seat.height(x,y,'top');
    if(bottom!==undefined&&top!==undefined){const gap=top-bottom;dz=Math.max(dz,gap);gaps.push({x:ix-minX,y:iy-minY,gap});}
  }
  dz+=separation;
  const near=new Set(gaps.filter(sample=>dz-sample.gap>=0&&dz-sample.gap<=contactGap).map(sample=>sample.x*rows+sample.y));
  while(near.size){
    const first=near.values().next().value!,pending=[first];near.delete(first);
    let count=0,xmin=Infinity,xmax=-Infinity,ymin=Infinity,ymax=-Infinity;
    while(pending.length){
      const key=pending.pop()!,x=Math.floor(key/rows),y=key%rows;count++;
      xmin=Math.min(xmin,x);xmax=Math.max(xmax,x);ymin=Math.min(ymin,y);ymax=Math.max(ymax,y);
      for(const next of [key-rows,key+rows,...(y>0?[key-1]:[]),...(y+1<rows?[key+1]:[])])if(near.delete(next))pending.push(next);
    }
    if(count>=8&&xmax>xmin&&ymax>ymin)return dz;
  }
  return null;
}

function projectBounds(bounds:readonly number[],axis:Vec3):[number,number]{
  const values=[bounds[0]*axis[0]+bounds[2]*axis[1],bounds[0]*axis[0]+bounds[3]*axis[1],
    bounds[1]*axis[0]+bounds[2]*axis[1],bounds[1]*axis[0]+bounds[3]*axis[1]];
  return [Math.min(...values),Math.max(...values)];
}
function solveLegs(pose:number[][],source:number[][],legs:readonly Leg[],range:readonly [number,number]):boolean{
  for(const {thigh,shin,foot,upper,lower} of legs){
    const hip=position(pose[thigh]),original=position(source[foot]),start:Vec3=[original[0],source[thigh][13],original[2]],line:Vec3=[0,1,0];
    const reachable=reachableSegment(start,line,hip,upper+lower-.001,range);if(!reachable)return false;
    const ankle=add(start,scale(line,Math.max(reachable[0],Math.min(reachable[1],original[1]-start[1]))));
    if(length(sub(hip,ankle))<=Math.abs(upper-lower)+.000001)return false;
    const knee=solveLimb(hip,ankle,upper,lower,position(source[shin]));
    pose[thigh]=boneFrame(hip,knee,source[thigh]);pose[shin]=boneFrame(knee,ankle,source[shin]);
    pose[foot]=[...source[foot]];pose[foot].splice(12,3,...ankle);
  }
  return true;
}

/** Jointly fit the supported pelvis and both floor-planted legs against the actual furniture. */
export function fitSeatedPose(geometry:Geometry,a:ShapeParameters,top:number,family:string,pose:number[][],rest:number[][],
  rig:number[],source:number[][],range:readonly [number,number]):boolean{
  const support=supportNames[family];if(!support)return false;
  const bones=geometry.manifest.bones,legIds=legIndices(geometry);
  let entries=fits.get(geometry);if(!entries){entries=[];fits.set(geometry,entries);}
  for(const saved of entries){
    if(saved.presentation!==a.presentation||saved.height!==a.height||saved.build!==a.build||saved.shoulders!==a.shoulders
      ||saved.hips!==a.hips||saved.torso!==a.torso||saved.top!==top||saved.family!==family)continue;
    if(sameInputs(saved,pose,source,rig,range,legIds)){applyFit(pose,legIds,saved.delta,saved.legs);return true;}
  }
  const inverse=rest.map(inverseAffine),world=pose.map((matrix,i)=>i<17?multiply(rig,matrix):source[i]);
  const pelvisParts=geometry.description.parts.filter(part=>part.name==='Trouser hip bridge');
  const legParts=geometry.description.parts.filter(part=>part.region===3),fixture=geometry.fixtureGeometry??geometry;
  // The original proof chair remains in the body bundle but is not this clip's physical fixture.
  const fixtureParts=fixture.description.parts.filter(part=>part.region===12&&part.name.startsWith('Creator clip '+family+' '));
  const seatParts=fixtureParts.filter(part=>part.name==='Creator clip '+family+' '+support);
  if(!pelvisParts.length||!seatParts.length)throw new Error('Seated support geometry is missing: '+family);
  const body=surface(geometry,pelvisParts,queryConfiguredSurface(geometry,pelvisParts,a,top,world,inverse));
  const fixedPoints=queryConfiguredSurface(fixture,fixtureParts,a,top,world,inverse),seat=surface(fixture,seatParts,fixedPoints);
  const solids=fixtureParts.map(part=>surface(fixture,[part],fixedPoints));
  const calves=new Set<number>();
  for(const part of legParts)for(let at=part.start;at<part.start+part.count;at++){
    const id=geometry.indices[at],offset=id*16;let weight=0;
    for(let k=0;k<4;k++)if(bones[geometry.vertices[offset+6+k]].name.startsWith('shin.'))weight+=geometry.vertices[offset+10+k];
    if(weight>.8)calves.add(id);
  }
  if(!calves.size)throw new Error('Seating requires its actual calf surfaces.');
  const legs:Leg[]=legIds.map(ids=>({...ids,upper:length(sub(shapePoint(bones[ids.thigh].tail,3,a,top),shapePoint(bones[ids.thigh].head,3,a,top))),
    lower:length(sub(shapePoint(bones[ids.shin].tail,6,a,top),shapePoint(bones[ids.shin].head,3,a,top)))}));
  const forward=unit([-rig[4],-rig[5],0]),lateral:Vec3=[-forward[1],forward[0],0];
  const bodySide=projectBounds(body.bounds,lateral),seatSide=projectBounds(seat.bounds,lateral);
  const side=(seatSide[0]+seatSide[1]-bodySide[0]-bodySide[1])/2;
  const bodyFront=projectBounds(body.bounds,forward),seatFront=projectBounds(seat.bounds,forward);
  const min=seatFront[0]-bodyFront[1],max=seatFront[1]-bodyFront[0];
  const candidates=[Math.max(min,Math.min(max,0))];
  for(let step=1;step<=Math.ceil(Math.max(Math.abs(min),Math.abs(max))/cell);step++)for(const direction of [1,-1]){
    const value=direction*step*cell;if(value>=min&&value<=max)candidates.push(value);
  }
  const inverseRig=inverseAffine(rig);
  for(const distance of candidates){
    const horizontal=add(scale(forward,distance),scale(lateral,side));
    const dz=contactHeight(body,seat,horizontal[0],horizontal[1]);if(dz===null)continue;
    const delta=sub(transform(inverseRig,[horizontal[0],horizontal[1],dz]),transform(inverseRig,[0,0,0]));
    const candidate=pose.map((matrix,i)=>i<17?[...matrix]:matrix);
    for(let i=0;i<17;i++)candidate[i].splice(12,3,...add(position(candidate[i]),delta));
    if(!solveLegs(candidate,source,legs,range))continue;
    const points=queryConfiguredSurface(geometry,legParts,a,top,candidate.map((matrix,i)=>i<17?multiply(rig,matrix):source[i]),inverse);
    let clear=true;
    for(const id of calves){const x=points[id*3],y=points[id*3+1],z=points[id*3+2];
      for(const solid of solids){const bottom=solid.height(x,y,'bottom'),top=solid.height(x,y,'top');
        if(bottom!==undefined&&top!==undefined&&z>bottom+calfPenetration&&z<top-calfPenetration){clear=false;break;}
      }
      if(!clear)break;
    }
    if(!clear)continue;
    const solved=legIds.flatMap(leg=>[candidate[leg.thigh],candidate[leg.shin],candidate[leg.foot]]);
    const inputs=[pose[1],...legIds.map(leg=>pose[leg.thigh]),...legIds.flatMap(leg=>[source[leg.thigh],source[leg.shin],source[leg.foot]]),rig,range].flat();
    if(entries.length>=64)entries.shift();
    entries.push({presentation:a.presentation,height:a.height,build:a.build,shoulders:a.shoulders,hips:a.hips,torso:a.torso,
      top,family,inputs,delta,legs:solved.map(matrix=>[...matrix])});
    applyFit(pose,legIds,delta,solved);return true;
  }
  throw new Error('No supported seated pose clears the actual furniture: '+family);
}
