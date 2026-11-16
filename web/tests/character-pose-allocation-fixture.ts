import {readFileSync} from 'node:fs';
import {Session} from 'node:inspector';
import {decodeGeometry,geometryBuffers,type Bundle,type Geometry,type MeshDescription} from '../src/render/character/bundle.js';
import {combineClipFamily,type ClipLibrary,type ClipParts} from '../src/render/character/clip-runtime.js';
import {defaultAppearance,type CharacterAppearanceV1} from '../src/character/schema.js';
import {anatomicalHeight,type ShapeParameters} from '../src/render/character/shape.js';
import {selectGeometry} from '../src/render/character/variants.js';

const directory=new URL('../../assets/models/sims/character-creator/',import.meta.url);
export const manifest=JSON.parse(readFileSync(new URL('export/manifest.json',directory),'utf8')) as Bundle;
export const library=JSON.parse(readFileSync(new URL('clips/clips.json',directory),'utf8')) as ClipLibrary;
function readGeometry(description:MeshDescription,folder:string):Geometry {
  const buffers=Object.fromEntries(geometryBuffers.map(key=>[key,Uint8Array.from(readFileSync(new URL(folder+'/'+description[key],directory))).buffer]));
  return decodeGeometry({...manifest,runtime:description},'runtime',buffers as Record<typeof geometryBuffers[number],ArrayBuffer>);
}
const base=readGeometry(manifest.runtime,'export');
export const baseTop=anatomicalHeight(base.vertices);
const families=new Map<string,Geometry>();
function family(name:string):Geometry {
  let geometry=families.get(name);
  if(!geometry){
    const parts=JSON.parse(readFileSync(new URL(`clips/${name}/parts.json`,directory),'utf8')) as ClipParts;
    geometry=combineClipFamily(base,parts.geometry?readGeometry(parts.geometry,`clips/${name}`):null,parts,library,name);families.set(name,geometry);
  }
  return geometry;
}

/** The selected geometry and shape a world actor would pose for this clip and appearance. */
export function clipSubject(clip:string,appearance:CharacterAppearanceV1):{geometry:Geometry;shape:ShapeParameters;top:number}{
  const authored=library.clips[clip];
  const source=authored?family(authored.family):base;
  const geometry=selectGeometry(source,appearance,{wear:['bath','shower'].includes(clip)?'bare':'clothed',prop:authored?.samples[0].bookVisible?'book':'none',
    fixture:'none',eyes_closed:authored?.samples[0].eyesClosed??false,clip,grip:clip==='mop'?'mop':'relaxed'});
  return {geometry,shape:{presentation:appearance.presentation,...appearance.body,face:appearance.face},top:baseTop};
}

/** Appearances at the body-slider corners and the default, for both presentations. */
export function appearances():CharacterAppearanceV1[] {
  return (['masculine','feminine'] as const).flatMap(presentation=>[0,50,100].map(size=>{
    const appearance=defaultAppearance(presentation);appearance.body={height:size,build:100-size,shoulders:size,hips:100-size,torso:size};return appearance;
  }));
}

/** Frames a world actor reaches: whole samples and the fractional phases between them. */
export function framesOf(clip:string):number[] {
  const count=library.clips[clip]?.samples.length??manifest.actions[clip].length;
  return Array.from({length:count*4},(_,i)=>i/4+.0625*(i%3));
}

let session:Session|null=null;
function post<T>(method:string,params?:object):T {
  let result:unknown,failure:unknown;
  session!.post(method,params??{},(error,value)=>{failure=error;result=value;});
  if(failure)throw failure;
  return result as T;
}
interface ProfileNode {selfSize:number;children?:ProfileNode[]}

/**
 * Bytes `run` allocates, by V8's sampling heap profiler with both
 * garbage-collection inclusion flags ([L20]): temporaries the scavenger
 * reaps count as well as survivors. The inspector answers synchronously in
 * the same thread, so the window contains only `run`.
 */
export function sampledAllocationBytes(run:()=>void,samplingInterval=512):number {
  if(!session){session=new Session();session.connect();}
  post('HeapProfiler.enable');
  post('HeapProfiler.startSampling',{samplingInterval,includeObjectsCollectedByMinorGC:true,includeObjectsCollectedByMajorGC:true});
  let profile!:{head:ProfileNode};
  try{run();}
  finally{profile=post<{profile:{head:ProfileNode}}>('HeapProfiler.stopSampling').profile;}
  if(!profile)throw new Error('The heap profiler did not answer synchronously.');
  let total=0;const visit=(node:ProfileNode)=>{total+=node.selfSize;for(const child of node.children??[])visit(child);};visit(profile.head);
  return total;
}
