import {readFileSync} from 'node:fs';
import {decodeGeometry,geometryBuffers,type Bundle,type Geometry,type MeshDescription} from '../src/render/character/bundle.js';
import {prepareClipFamily,type ClipLibrary,type ClipParts} from '../src/render/character/clip-runtime.js';
import {PreparedBody} from '../src/render/character/prepared-body.js';
import {configuredPoseForProof} from '../src/render/character/pose.js';
import {anatomicalHeight,shapeVertices} from '../src/render/character/shape.js';
import {posedCageSurface} from '../src/render/character/geometry-proof.js';
import type {CharacterAppearanceV1} from '../src/character/schema.js';
import type {PoolFixtureV1} from '../src/render/character/pool-contact-types.js';

const directory=new URL('../../assets/models/sims/character-creator/',import.meta.url);
const manifest=JSON.parse(readFileSync(new URL('export/manifest.json',directory),'utf8')) as Bundle;
export const poolLibrary=JSON.parse(readFileSync(new URL('clips/clips.json',directory),'utf8')) as ClipLibrary;
export const poolFixture=JSON.parse(readFileSync(new URL('clips/pool/contacts-v1.json',directory),'utf8')) as PoolFixtureV1;
const parts=JSON.parse(readFileSync(new URL('clips/pool/parts.json',directory),'utf8')) as ClipParts;
function load(description:MeshDescription,folder:string):Geometry {
  const buffers=Object.fromEntries(geometryBuffers.map(key=>[key,Uint8Array.from(readFileSync(new URL(folder+'/'+description[key],directory))).buffer]));
  return decodeGeometry({...manifest,runtime:description},'runtime',buffers as Record<typeof geometryBuffers[number],ArrayBuffer>);
}
export const poolBase=load(manifest.runtime,'export'),poolRig=prepareClipFamily(poolBase,load(parts.geometry!,'clips/pool'),parts,poolLibrary,'pool');
const bodies=new WeakMap<CharacterAppearanceV1,PreparedBody>();

/** Frozen current pose preference, before the new solid-constrained trajectory compiler. */
export function observePoolInput(appearance:CharacterAppearanceV1,action:string,frame:number){
  const started=performance.now();
  let body=bodies.get(appearance);if(!body){body=new PreparedBody(poolBase,appearance);bodies.set(appearance,body);}
  const selected=body.select(poolRig,appearance,{wear:'bare',prop:'none',fixture:'none',eyes_closed:false,includeFixture:false,clip:action,
    swimwear:appearance.presentation==='feminine'?'two_piece':'trunks'});
  const shape={presentation:appearance.presentation,...appearance.body,face:appearance.face},top=anatomicalHeight(poolBase.vertices);
  const selectedAt=performance.now();
  const matrices=configuredPoseForProof(poolRig.manifest,shape,action,frame,top,undefined,selected.body);
  const posedAt=performance.now();
  const source=poolFixture.clips[action],count=poolRig.manifest.actions[action].length;
  const phase=source.playback==='loop'?(frame%count)/count:Math.min(1,frame/(count-1));
  const supports=phase===1?source.samples.at(-1)!.limbs:source.intervals.find(interval=>phase>=interval.start&&phase<interval.end)!.limbs;
  const surfaces=[selected.body,selected.extra!].map(geometry=>({geometry,
    points:posedCageSurface(geometry,shapeVertices(geometry.cage,shape,top),matrices)}));
  return {phase,shape,top,matrices,supports,surfaces,timingsMs:{selection:selectedAt-started,pose:posedAt-selectedAt,deformation:performance.now()-posedAt,total:performance.now()-started}};
}
