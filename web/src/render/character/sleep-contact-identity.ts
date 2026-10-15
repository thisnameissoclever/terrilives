import {defaultAppearance,validateAppearance,type CharacterAppearanceV1} from '../../character/schema.js';
import type {Geometry,Bundle} from './bundle.js';
import type {ShapeParameters} from './shape.js';
import type {SleepAction} from './sleep-contact-types.js';

export function canonicalSleepValue(value:unknown):string {
  if(typeof value==='number'){if(!Number.isFinite(value))throw new Error('Sleep contact values must be finite.');return Object.is(value,-0)?'-0':String(value);}
  if(typeof value==='string'||typeof value==='boolean'||value===null)return JSON.stringify(value);
  if(Array.isArray(value))return '['+Array.from(value,canonicalSleepValue).join(',')+']';
  if(!value||typeof value!=='object')throw new Error('Invalid sleep contact value.');
  const row=value as Record<string,unknown>;return '{'+Object.keys(row).sort().map(key=>JSON.stringify(key)+':'+canonicalSleepValue(row[key])).join(',')+'}';
}

/** Uniform-only appearance edits retain the same geometric preparation. */
export function sleepContactAppearance(appearance:CharacterAppearanceV1):CharacterAppearanceV1 {
  validateAppearance(appearance);const result=structuredClone(appearance),defaults=defaultAppearance(appearance.presentation);
  result.colors=defaults.colors;result.undertone=defaults.undertone;result.freckles=defaults.freckles;result.freckle_density=defaults.freckle_density;
  return result;
}
export function sleepContactAppearanceKey(appearance:CharacterAppearanceV1):string {return canonicalSleepValue(sleepContactAppearance(appearance));}
export function sleepShapeKey(shape:ShapeParameters,top:number):string {
  return canonicalSleepValue([shape.presentation,shape.height,shape.build,shape.shoulders??shape.build,shape.hips??shape.build,shape.torso??50,shape.face??null,top]);
}
export function sleepPartKey(geometry:Geometry):string {
  return JSON.stringify([geometry.description.vertexCount,geometry.description.cageCount,geometry.description.coefficientCount,
    geometry.description.parts.map(part=>[part.name,part.start,part.count,part.region])]);
}
export function assertStaticSleepClip(bundle:Bundle,action:SleepAction):void {
  const clip=bundle.clipMetadata?.[action];
  if(!clip||clip.playback!=='static'||clip.contacts.policy!=='sleep'||bundle.actions[action]?.length!==1||bundle.basisActions[action]?.length!==1
      ||clip.rigs.length!==1||clip.contactFrames.length!==1||clip.visibility.length!==1)throw new Error('Sleeping preparation requires an authored static one-sample clip: '+action);
}
