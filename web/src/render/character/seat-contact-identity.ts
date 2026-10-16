import type {Bundle,Geometry} from './bundle.js';
import {canonicalSleepValue,sleepContactAppearance,sleepContactAppearanceKey} from './sleep-contact-identity.js';
import type {SeatAction} from './seat-contact-types.js';
export {canonicalSleepValue as canonicalSeatValue,sleepContactAppearance as seatContactAppearance,sleepContactAppearanceKey as seatContactAppearanceKey};
/** Face controls cannot change the pelvis or legs; admission still owns the full appearance. */
export function seatShapeKey(shape:import('./shape.js').ShapeParameters,top:number):string {return canonicalSleepValue([shape.presentation,shape.height,shape.build,shape.shoulders,shape.hips,shape.torso,top].map(value=>value??null));}

export const SEAT_LOWER_BONES=['root','hips','thigh.L','shin.L','foot.L','thigh.R','shin.R','foot.R'] as const;
const lowerKeys=new WeakMap<Bundle,Map<string,string>>();
/** Only stationary lower tracks may reuse one fit; upper tracks remain fully animated. */
export function stationarySeatLowerKey(bundle:Bundle,action:SeatAction):string {
  let keys=lowerKeys.get(bundle);if(!keys){keys=new Map();lowerKeys.set(bundle,keys);}const saved=keys.get(action);if(saved)return saved;
  const clip=bundle.clipMetadata?.[action],source=bundle.actions[action],basis=bundle.basisActions[action];
  if(!clip||!['seat','seat_book','dining'].includes(clip.contacts.policy)||!clip.contacts.feet||!source?.length||source.length!==basis?.length||clip.rigs.length!==source.length)throw new Error('Invalid stationary seating contract: '+action);
  const ids=SEAT_LOWER_BONES.map(name=>{const id=bundle.bones.findIndex(bone=>bone.name===name);if(id<0)throw new Error('Missing seated bone: '+name);return id;});
  const fixture=bundle.bones.flatMap((_,i)=>i>=17&&clip.fixtureOwners?.[0]?.[i-17]?[i]:[]);
  const sample=(i:number)=>canonicalSleepValue([ids.map(id=>[source[i][id],basis[i][id]]),clip.rigs[i],fixture.map(id=>source[i][id]),clip.fixtureOwners?.[i]??null]);
  const first=sample(0);for(let i=1;i<source.length;i++)if(sample(i)!==first)throw new Error('Seated preparation requires stationary lower tracks: '+action);
  const key=canonicalSleepValue([clip.family,clip.contacts.feet,clip.contacts.landmarks.pelvis,ids.map(id=>bundle.bones[id]),first]);keys.set(action,key);return key;
}
/** Blinking and head selection cannot invalidate a physical pelvis/leg fit. */
export function seatPartKey(geometry:Geometry,family:string):string {
  const fixture=geometry.fixtureGeometry??geometry;
  const parts=(source:Geometry,filter:(part:Geometry['description']['parts'][number])=>boolean)=>source.description.parts.filter(filter).map(part=>[part.name,part.start,part.count,part.region]);
  return canonicalSleepValue([geometry.description.vertexCount,geometry.description.cageCount,geometry.description.coefficientCount,
    parts(geometry,part=>part.name==='Trouser hip bridge'||part.region===3),fixture.description.vertexCount,fixture.description.cageCount,
    parts(fixture,part=>part.region===12&&part.name.startsWith('Creator clip '+family+' ')),
    physicalFingerprint(geometry,part=>part.name==='Trouser hip bridge'||part.region===3),physicalFingerprint(fixture,part=>part.region===12&&part.name.startsWith('Creator clip '+family+' '))]);
}
/** Fingerprint the exact sparse deformation inputs, including subdivision source positions. */
function physicalFingerprint(geometry:Geometry,selected:(part:Geometry['description']['parts'][number])=>boolean):string {
  let hash=2166136261,second=2246822519;const float=new Float32Array(1),bits=new Uint32Array(float.buffer),weights=new Uint32Array(geometry.stencilWeights),seen=new Set<number>(),cages=new Set<number>();
  const word=(value:number)=>{hash=Math.imul(hash^value,16777619);second=Math.imul(second^value,3266489917);};
  const number=(value:number)=>{float[0]=value;word(bits[0]);};
  const cage=(id:number)=>{if(cages.has(id))return;cages.add(id);word(id);for(let j=0;j<16;j++)number(geometry.cage[id*16+j]);};
  for(const part of geometry.description.parts)if(selected(part))for(let at=part.start;at<part.start+part.count;at++){
    const id=geometry.indices[at];word(id);if(seen.has(id))continue;seen.add(id);
    for(let k=0;k<16;k++)number(geometry.vertices[id*16+k]);
    const start=geometry.stencilRanges[id*4],count=geometry.stencilRanges[id*4+1],direct=geometry.stencilRanges[id*4+3];word(count);word(direct);
    for(let k=start;k<start+count;k++){word(weights[k*2]);word(weights[k*2+1]);cage(weights[k*2]);}
    if(direct===1){const directCage=geometry.stencilRanges[id*4+2];word(directCage);cage(directCage);}
  }
  return (hash>>>0).toString(16)+':'+(second>>>0).toString(16);
}
