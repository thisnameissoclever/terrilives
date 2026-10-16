import {readFileSync} from 'node:fs';
import {decodeGeometry,geometryBuffers,type Bundle,type Geometry,type MeshDescription} from '../src/render/character/bundle.js';
import {prepareClipFamily,type ClipLibrary,type ClipParts} from '../src/render/character/clip-runtime.js';
import {PreparedBody} from '../src/render/character/prepared-body.js';
import type {CharacterAppearanceV1} from '../src/character/schema.js';
import {SEAT_ACTIONS,type SeatAction,type SeatContactSources} from '../src/render/character/seat-contact-types.js';
const directory=new URL('../../assets/models/sims/character-creator/',import.meta.url);
const manifest=JSON.parse(readFileSync(new URL('export/manifest.json',directory),'utf8')) as Bundle;
export const seatLibrary=JSON.parse(readFileSync(new URL('clips/clips.json',directory),'utf8')) as ClipLibrary;
function load(description:MeshDescription,folder:string):Geometry {const buffers=Object.fromEntries(geometryBuffers.map(key=>[key,Uint8Array.from(readFileSync(new URL(folder+'/'+description[key],directory))).buffer]));return decodeGeometry({...manifest,runtime:description},'runtime',buffers as Record<typeof geometryBuffers[number],ArrayBuffer>);}
const base=load(manifest.runtime,'export'),families=new Map<string,ReturnType<typeof prepareClipFamily>>();
export const seatRigs=Object.fromEntries(SEAT_ACTIONS.map(action=>{const family=seatLibrary.clips[action].family;let rig=families.get(family);if(!rig){const parts=JSON.parse(readFileSync(new URL('clips/'+family+'/parts.json',directory),'utf8')) as ClipParts;rig=prepareClipFamily(base,load(parts.geometry!,'clips/'+family),parts,seatLibrary,family);families.set(family,rig);}return [action,rig];})) as SeatContactSources['rigs'];
export function preparedSeatGeometry(appearance:CharacterAppearanceV1,action:SeatAction,closed=false):Geometry {const rig=seatRigs[action];return new PreparedBody(base,appearance).select(rig,appearance,{wear:'clothed',prop:'none',fixture:'none',eyes_closed:closed,clip:action,grip:'relaxed',includeFixture:false}).body;}
export function preparedToiletGeometry(appearance:CharacterAppearanceV1):Geometry {
 const parts=JSON.parse(readFileSync(new URL('clips/toilet/parts.json',directory),'utf8')) as ClipParts;
 const rig=prepareClipFamily(base,load(parts.geometry!,'clips/toilet'),parts,seatLibrary,'toilet');
 return new PreparedBody(base,appearance).select(rig,appearance,{wear:'clothed',prop:'none',fixture:'none',eyes_closed:false,clip:'toilet',grip:'relaxed',includeFixture:false}).body;
}
