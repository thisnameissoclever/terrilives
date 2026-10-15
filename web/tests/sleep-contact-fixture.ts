import {readFileSync} from 'node:fs';
import {decodeGeometry,geometryBuffers,type Bundle,type Geometry,type MeshDescription} from '../src/render/character/bundle.js';
import {prepareClipFamily,type ClipLibrary,type ClipParts} from '../src/render/character/clip-runtime.js';
import {PreparedBody} from '../src/render/character/prepared-body.js';
import type {CharacterAppearanceV1} from '../src/character/schema.js';
import type {SleepAction} from '../src/render/character/sleep-contact-types.js';

const directory=new URL('../../assets/models/sims/character-creator/',import.meta.url);
const manifest=JSON.parse(readFileSync(new URL('export/manifest.json',directory),'utf8')) as Bundle;
export const sleepLibrary=JSON.parse(readFileSync(new URL('clips/clips.json',directory),'utf8')) as ClipLibrary;
function load(description:MeshDescription,folder:string):Geometry {
  const buffers=Object.fromEntries(geometryBuffers.map(key=>[key,Uint8Array.from(readFileSync(new URL(folder+'/'+description[key],directory))).buffer]));
  return decodeGeometry({...manifest,runtime:description},'runtime',buffers as Record<typeof geometryBuffers[number],ArrayBuffer>);
}
const base=load(manifest.runtime,'export');
function rig(family:'bed'|'bunk'){
  const parts=JSON.parse(readFileSync(new URL('clips/'+family+'/parts.json',directory),'utf8')) as ClipParts;
  return prepareClipFamily(base,load(parts.geometry!,'clips/'+family),parts,sleepLibrary,family);
}
export const sleepRigs={bed:rig('bed'),bunk:rig('bunk')};
export function preparedSleepGeometry(appearance:CharacterAppearanceV1,action:SleepAction):Geometry {
  const rig=action==='bed_sleep'?sleepRigs.bed:sleepRigs.bunk;
  return new PreparedBody(base,appearance).select(rig,appearance,{wear:'clothed',prop:'none',fixture:'none',eyes_closed:true,clip:action,grip:'relaxed',includeFixture:false}).body;
}
