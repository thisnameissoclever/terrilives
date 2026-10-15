import type {Geometry,MeshPart} from './bundle.js';
import type {CharacterRig} from './clip-runtime.js';
import {compactGeometry} from './variants.js';
import {assertIndependentBodyParts} from './prepared-body.js';

export interface CharacterBodyVariant {
  id:'mop-hands';
  source:Geometry;
  sourceParts:ReadonlySet<MeshPart>;
  geometry:Geometry;
}
const variants=new WeakMap<CharacterRig,CharacterBodyVariant>();
const prepared=new WeakMap<CharacterRig,CharacterRig>();

/** These authored alternate hands belong to the person and use the common body bones. */
export function prepareMopHandVariant(cleaning:CharacterRig):CharacterBodyVariant {
  const saved=variants.get(cleaning);if(saved)return saved;
  if(cleaning.family!=='cleaning'||!cleaning.supplemental)throw new Error('Mop hands require the cleaning source.');
  const source=cleaning.supplemental,parts=source.description.parts.filter(part=>part.region===4);
  if(!parts.length)throw new Error('The cleaning source has no authored Mop hands.');
  const geometry=compactGeometry(source,parts);
  assertIndependentBodyParts(geometry);
  for(let at=0;at<geometry.cage.length;at+=16)for(let influence=0;influence<4;influence++){
    if(geometry.cage[at+10+influence]&&geometry.cage[at+6+influence]>=17)throw new Error('Mop hands must use the common character skeleton.');
  }
  const variant:CharacterBodyVariant={id:'mop-hands',source,sourceParts:new Set(parts),geometry};variants.set(cleaning,variant);return variant;
}

/** Each immutable clip rig shares the same finite body-variant inventory. */
export function withBodyVariants(rig:CharacterRig,bodyVariants:readonly CharacterBodyVariant[]):CharacterRig {
  if(new Set(bodyVariants.map(variant=>variant.id)).size!==bodyVariants.length)throw new Error('Character body variants must have distinct identities.');
  const saved=prepared.get(rig);
  if(saved){
    const previous=saved.bodyVariants??[];
    if(previous.length!==bodyVariants.length||previous.some((variant,index)=>variant!==bodyVariants[index]))throw new Error('Character body variants changed after preparing the rig.');
    return saved;
  }
  const result={...rig,bodyVariants};prepared.set(rig,result);return result;
}
