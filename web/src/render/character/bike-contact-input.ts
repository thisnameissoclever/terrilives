import type {Geometry,MeshPart} from './bundle.js';
import {queryConfiguredSurface} from './surface-query.js';
import {shapePoint,type ShapeParameters} from './shape.js';
import {add,inverseAffine,length,multiply,sub,transform,type Vec3} from './math.js';
import {configuredJointSetup} from './pose-joints.js';
import {evaluateContactLandmark} from './contact-landmark.js';
import {BIKE_CONTACT_SOLVER_REVISION,type BikeContactInputDataV1,type BikeContactSurface,type BikeDimensions} from './bike-contact-types.js';

const position=(matrix:readonly number[]):Vec3=>[matrix[12],matrix[13],matrix[14]];
export function bikeContactShapeKey(a:ShapeParameters,top:number):string {
  return JSON.stringify([a.presentation,a.height,a.build,a.shoulders??a.build,a.hips??a.build,a.torso??50,top]);
}
export function bikeContactShoeKey(geometry:Geometry):string {
  return JSON.stringify(geometry.description.parts.filter(part=>part.region===6&&/sole/i.test(part.name)).map(part=>[part.name,part.count]));
}
function surface(geometry:Geometry,part:MeshPart,point:(index:number)=>Vec3):BikeContactSurface {
  const ids=[...new Set(geometry.indices.slice(part.start,part.start+part.count))],map=new Map(ids.map((id,index)=>[id,index]));
  const triangles:[number,number,number][]=[];
  for(let at=part.start;at<part.start+part.count;at+=3)triangles.push([map.get(geometry.indices[at])!,map.get(geometry.indices[at+1])!,map.get(geometry.indices[at+2])!]);
  return {points:ids.map(point),triangles};
}

/** Extract only values consumed by the whole-cycle solver, without running that solver. */
export function extractBikeContactInput(geometry:Geometry,a:ShapeParameters,top:number,rest:number[][],pose:number[][],source:number[][],
  dimensions:BikeDimensions,legLengths:[number,number],revisions:BikeContactInputDataV1['revisions'],sourcePhase:number):BikeContactInputDataV1 {
  const bone=(name:string)=>{const id=geometry.manifest.bones.findIndex(b=>b.name===name);if(id<0)throw new Error(`Missing bike bone: ${name}`);return id;};
  const hips=bone('hips'),hip=position(pose[hips]);
  const measured=geometry.description.parts.filter(part=>part.name==='Trouser hip bridge'||part.region===6&&/sole/i.test(part.name));
  const points=queryConfiguredSurface(geometry,measured,a,top),point=(index:number):Vec3=>[points[index*3],points[index*3+1],points[index*3+2]];
  const fixture=geometry.fixtureGeometry??geometry,hipPart=geometry.description.parts.find(part=>part.name==='Trouser hip bridge');
  const saddlePart=fixture.description.parts.find(part=>part.name.endsWith(' Bike saddle'));
  if(!hipPart||!saddlePart)throw new Error('Bike fitting requires the actual hip and saddle surfaces.');
  const hipTransform=multiply(pose[hips],inverseAffine(rest[hips]));
  const hipSurface=surface(geometry,hipPart,index=>sub(transform(hipTransform,point(index)),hip));
  const saddle=surface(fixture,saddlePart,index=>transform(source[fixture.vertices[index*16+6]],
    [fixture.vertices[index*16],fixture.vertices[index*16+1],fixture.vertices[index*16+2]]));
  const sole=(side:'L'|'R')=>{
    const id=bone('foot.'+side),inverse=inverseAffine(rest[id]),ids=new Set<number>();
    for(const part of measured)if(part.region===6)for(let at=part.start;at<part.start+part.count;at++){
      const vertex=geometry.indices[at];if(geometry.vertices[vertex*16+6]===id)ids.add(vertex);
    }
    if(!ids.size)throw new Error('A configured shoe has no sole support geometry.');
    const orientation=[...source[id]];orientation.splice(12,3,0,0,0);
    return {points:[...ids].map(index=>transform(inverse,point(index))),source:orientation};
  };
  const soles:BikeContactInputDataV1['soles']=[sole('L'),sole('R')];
  return {version:1,solverRevision:BIKE_CONTACT_SOLVER_REVISION,sourcePhase,revisions:{...revisions},shapeKey:bikeContactShapeKey(a,top),shoeKey:bikeContactShoeKey(geometry),
    hip,hipSurface,saddle,soles,thighOffsets:[sub(position(pose[bone('thigh.L')]),hip),sub(position(pose[bone('thigh.R')]),hip)],
    legLengths:[...legLengths],dimensions:{...dimensions,axle:[...dimensions.axle]}};
}

/** Use the same sampled rest joints and supported-pelvis alignment as pose evaluation. */
export function prepareBikeContactInput(geometry:Geometry,a:ShapeParameters,top:number,
  revisions:BikeContactInputDataV1['revisions'],frame=0):BikeContactInputDataV1 {
  const bundle=geometry.manifest,clip=bundle.clipMetadata?.exercise,contacts=clip?.contacts;
  if(contacts?.policy!=='exercise'||!contacts.bike)throw new Error('Exercise contact metadata is missing.');
  const {source,rest,inverse,matrices}=configuredJointSetup(bundle,a,'exercise',frame,top),bones=bundle.bones;
  const old=evaluateContactLandmark(bones,contacts.landmarks.pelvis,source,bones.map(bone=>bone.inverseRest),undefined,top);
  const current=evaluateContactLandmark(bones,contacts.landmarks.pelvis,matrices,inverse,a,top),shift:Vec3=[0,0,old[2]-current[2]];
  for(let i=0;i<17;i++)matrices[i].splice(12,3,...add(position(matrices[i]),shift));
  const bone=(name:string)=>{const id=bones.findIndex(bone=>bone.name===name);if(id<0)throw new Error(`Missing bike bone: ${name}`);return id;};
  const boneLength=(id:number)=>length(sub(shapePoint(bones[id].tail,bones[id].name.startsWith('shin')?6:3,a,top),shapePoint(bones[id].head,3,a,top)));
  return extractBikeContactInput(geometry,a,top,rest,matrices,source,contacts.bike,
    [boneLength(bone('thigh.L'))+boneLength(bone('shin.L')),boneLength(bone('thigh.R'))+boneLength(bone('shin.R'))],revisions,frame);
}
