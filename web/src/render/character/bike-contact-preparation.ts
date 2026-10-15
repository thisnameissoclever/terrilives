import {validateAppearance,type CharacterAppearanceV1} from '../../character/schema.js';
import type {BikeContactInputV1} from './bike-contact-types.js';
import {prepareBikeContactInput} from './bike-contact-input.js';
import {makeBikeContactInput} from './bike-contact-protocol.js';
import {anatomicalHeight} from './shape.js';
import {selectParts} from './variants.js';

/** Uniforms, head details and upper garments do not change the measured bike contacts. */
export function bikeContactAppearanceKey(appearance:CharacterAppearanceV1):string {
  const {presentation,body,footwear,bottoms}=appearance;
  const values=[body.height,body.build,body.shoulders,body.hips,body.torso];
  if(values.some(value=>!Number.isFinite(value)))throw new Error('Bike contact body values must be finite.');
  return JSON.stringify([presentation,...values,footwear,bottoms]);
}

/** CPU-only sparse preparation shares immutable body arrays with the loaded rig. */
export async function prepareBikeContactForAppearance(appearance:CharacterAppearanceV1):Promise<BikeContactInputV1> {
  validateAppearance(appearance);
  const {loadCreatorRig,creatorClips}=await import('./creator-assets.js');
  const rig=await loadCreatorRig('exercise'),view={...rig.base,manifest:rig.manifest};
  const parts=selectParts(view,appearance,{wear:'clothed',prop:'none',fixture:'none',eyes_closed:false,clip:'exercise',grip:'relaxed',includeFixture:false});
  const geometry={...view,fixtureGeometry:rig.supplemental??rig.base,description:{...view.description,parts}};
  const shape={presentation:appearance.presentation,...appearance.body,face:appearance.face},top=anatomicalHeight(geometry.vertices);
  const runtime=rig.base.manifest.runtime;
  const revisions={source:rig.base.manifest.sourceSha256,fixture:creatorClips.sources.exercise.sha256,
    shoes:JSON.stringify([appearance.footwear,appearance.bottoms,runtime.verticesSha256,runtime.cageSha256,runtime.stencilWeightsSha256,runtime.indicesSha256])};
  return makeBikeContactInput(prepareBikeContactInput(geometry,shape,top,revisions));
}
