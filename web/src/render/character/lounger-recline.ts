import type {Geometry,MeshPart} from './bundle.js';
import {boneFrame,length,multiply,solveLimb,sub,type Vec3} from './math.js';
import type {ShapeParameters} from './shape.js';
import {queryConfiguredSurface} from './surface-query.js';

// The cushion coordinates match assets/models/outdoor/lounger_layout.py.
const cushionWidth=.58,cushionFoot=-.88,cushionHead=.45,cushionTop=.42;
const hingeY=.42,hingeZ=.33,backLength=.62,backThickness=.09;
const backAngle=40*Math.PI/180,c=Math.cos(backAngle),s=Math.sin(backAngle);
const backStart=hingeY-backThickness*s,backEnd=backStart+backLength*c;
const contactClearance=.004;

const position=(matrix:readonly number[]):Vec3=>[matrix[12],matrix[13],matrix[14]];

function pitchAround(point:Vec3,angle:number):number[] {
  const cos=Math.cos(angle),sin=Math.sin(angle);
  return [1,0,0,0,0,cos,sin,0,0,-sin,cos,0,0,point[1]*(1-cos)+point[2]*sin,point[2]*(1-cos)-point[1]*sin,1];
}

function selectedPoints(geometry:Geometry,parts:readonly MeshPart[],shape:ShapeParameters,top:number,pose:number[][],inverse:number[][]):Vec3[] {
  const points=queryConfiguredSurface(geometry,parts,shape,top,pose,inverse);
  const ids=new Set<number>();
  for(const part of parts)for(let i=part.start;i<part.start+part.count;i++)ids.add(geometry.indices[i]);
  return Array.from(ids,id=>[points[id*3],points[id*3+1],points[id*3+2]]);
}

/** Raise the authored recline over the back cushion and rest both heels on the deck. */
export function fitLoungerRecline(geometry:Geometry,shape:ShapeParameters,top:number,pose:number[][],rest:number[][],inverse:number[][]):void {
  const bones=geometry.manifest.bones,index=(name:string)=>bones.findIndex(bone=>bone.name===name);
  const hip=index('hips'),spine=index('spine'),head=index('head'),hipPosition=position(pose[hip]);
  const lean=pitchAround(hipPosition,backAngle);
  for(let bone=spine;bone<pose.length;bone++){
    let parent=bone;
    while(parent>spine)parent=bones[parent].parent;
    if(parent===spine)pose[bone]=multiply(lean,pose[bone]);
  }
  pose[head]=multiply(pitchAround(position(pose[head]),-.35),pose[head]);

  const torsoParts=geometry.description.parts.filter(part=>!/^Creator bare (leg|foot)/.test(part.name));
  const points=selectedPoints(geometry,torsoParts,shape,top,pose,inverse);
  const garment=geometry.fixtureGeometry;
  const swimwear=shape.presentation==='feminine'?'two_piece':'trunks';
  if(garment){
    const parts=garment.description.parts.filter(part=>part.conditions?.some(condition=>condition.swimwear?.includes(swimwear)));
    points.push(...selectedPoints(garment,parts,shape,top,pose,inverse));
  }

  let best=Infinity,shiftY=0,shiftZ=0;
  for(const seatY of [.30,.28,.32,.26,.34,.24,.36,.38,.40,.42,.44]){
    const travel=seatY-hipPosition[1];
    let deck=-Infinity,back=-Infinity;
    for(const [x,y,z] of points){
      if(Math.abs(x)>cushionWidth/2)continue;
      const at=y+travel;
      if(at>=cushionFoot&&at<=cushionHead)deck=Math.max(deck,cushionTop-z);
      if(at>=backStart&&at<=backEnd)back=Math.max(back,hingeZ+backThickness*c+(at-backStart)*s/c-z);
    }
    const difference=Math.abs(deck-back);
    if(difference<best){best=difference;shiftY=travel;shiftZ=Math.max(deck,back)+contactClearance;}
  }
  if(!Number.isFinite(best))throw new Error('Sunstrip pose has no cushion support.');

  const footParts=geometry.description.parts.filter(part=>/^Creator bare foot [LR]$/.test(part.name));
  const feet=footParts.map(part=>selectedPoints(geometry,[part],shape,top,pose,inverse));
  for(const matrix of pose){matrix[13]+=shiftY;matrix[14]+=shiftZ;}
  for(const side of ['L','R']){
    const thigh=index('thigh.'+side),shin=index('shin.'+side),foot=index('foot.'+side);
    const part=footParts.findIndex(row=>row.name.endsWith(' '+side)),footPoints=feet[part];
    const start=position(pose[thigh]),ankle=position(pose[foot]);
    const minY=Math.min(...footPoints.map(point=>point[1]))+shiftY,minZ=Math.min(...footPoints.map(point=>point[2]))+shiftZ;
    const z=ankle[2]+cushionTop+contactClearance-minZ;
    const upper=length(sub(position(rest[shin]),position(rest[thigh]))),lower=length(sub(position(rest[foot]),position(rest[shin])));
    const reach=upper+lower-.012;
    const extension=Math.sqrt(reach*reach-(ankle[0]-start[0])**2-(z-start[2])**2);
    const end:Vec3=[ankle[0],Math.max(start[1]-extension,ankle[1]+cushionFoot+.018-minY),z];
    const knee=solveLimb(start,end,upper,lower,[start[0],start[1],start[2]+1]);
    pose[thigh]=boneFrame(start,knee,pose[thigh]);
    pose[shin]=boneFrame(knee,end,pose[shin]);
    pose[foot].splice(12,3,...end);
  }
}
