import {readFileSync} from 'node:fs';
import {decodeGeometry,geometryBuffers,type Bundle,type Geometry,type MeshDescription} from '../src/render/character/bundle.js';
import {combineClipFamily,prepareClipFamily,type ClipLibrary,type ClipParts} from '../src/render/character/clip-runtime.js';
import {selectParts,selectGeometry} from '../src/render/character/variants.js';
import type {CharacterAppearanceV1} from '../src/character/schema.js';
import {anatomicalHeight} from '../src/render/character/shape.js';
import {prepareBikeContactInput} from '../src/render/character/bike-contact-input.js';

const directory=new URL('../../assets/models/sims/character-creator/',import.meta.url);
export const bikeManifest=JSON.parse(readFileSync(new URL('export/manifest.json',directory),'utf8')) as Bundle;
export const bikeLibrary=JSON.parse(readFileSync(new URL('clips/clips.json',directory),'utf8')) as ClipLibrary;
function load(description:MeshDescription,folder:string){
  const buffers=Object.fromEntries(geometryBuffers.map(key=>[key,Uint8Array.from(readFileSync(new URL(folder+'/'+description[key],directory))).buffer]));
  return decodeGeometry({...bikeManifest,runtime:description},'runtime',buffers as Record<typeof geometryBuffers[number],ArrayBuffer>);
}
const base=load(bikeManifest.runtime,'export'),parts=JSON.parse(readFileSync(new URL('clips/exercise/parts.json',directory),'utf8')) as ClipParts;
const extra=load(parts.geometry!,'clips/exercise');
export const bikeRig=prepareClipFamily(base,extra,parts,bikeLibrary,'exercise');
const rig=bikeRig,legacy=combineClipFamily(base,extra,parts,bikeLibrary,'exercise');
const context={wear:'clothed' as const,prop:'none',fixture:'none',eyes_closed:false,clip:'exercise',grip:'relaxed' as const,includeFixture:false};
export function bikeGeometry(appearance:CharacterAppearanceV1,compact=false):Geometry {
  if(compact)return selectGeometry(legacy,appearance,context);
  const view={...base,manifest:rig.manifest};
  return {...view,fixtureGeometry:rig.supplemental??base,description:{...base.description,parts:selectParts(view,appearance,context)}};
}
export function bikeInput(appearance:CharacterAppearanceV1,geometry=bikeGeometry(appearance),frame=0){
  const shape={presentation:appearance.presentation,...appearance.body,face:appearance.face},top=anatomicalHeight(geometry.vertices);
  return prepareBikeContactInput(geometry,shape,top,{source:geometry.manifest.sourceSha256,fixture:bikeLibrary.sources.exercise.sha256,shoes:appearance.footwear},frame);
}
