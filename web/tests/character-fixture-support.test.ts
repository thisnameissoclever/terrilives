import {readFileSync} from 'node:fs';
import {expect,it} from 'vitest';
import {decodeGeometry,geometryBuffers,type Bundle,type MeshDescription} from '../src/render/character/bundle.js';
import {combineClipFamily,type ClipLibrary,type ClipParts} from '../src/render/character/clip-runtime.js';
import {selectGeometry} from '../src/render/character/variants.js';
import {defaultAppearance} from '../src/character/schema.js';
import {configuredPoseForProof as configuredPose} from '../src/render/character/pose.js';
import {anatomicalHeight} from '../src/render/character/shape.js';

const base=new URL('../../assets/models/sims/character-creator/',import.meta.url);
const manifest=JSON.parse(readFileSync(new URL('export/manifest.json',base),'utf8')) as Bundle;
const library=JSON.parse(readFileSync(new URL('clips/clips.json',base),'utf8')) as ClipLibrary;
function load(description:MeshDescription,folder:string){
 const buffers=Object.fromEntries(geometryBuffers.map(key=>[key,Uint8Array.from(readFileSync(new URL(folder+'/'+description[key],base))).buffer]));
 return decodeGeometry({...manifest,runtime:description},'runtime',buffers as Record<typeof geometryBuffers[number],ArrayBuffer>);
}
const original=load(manifest.runtime,'export');
it.each([['bed','bed_sleep'],['bunk','bunk_sleep'],['exercise','exercise']])('retains %s contact geometry when its pixels belong to the fixture renderer',(family,action)=>{
 const parts=JSON.parse(readFileSync(new URL('clips/'+family+'/parts.json',base),'utf8')) as ClipParts;
 const source=combineClipFamily(original,parts.geometry?load(parts.geometry,'clips/'+family):null,parts,library,family);
 const appearance=defaultAppearance();
 const context={wear:'clothed' as const,prop:'none',fixture:'none',eyes_closed:action!=='exercise',clip:action};
 const reference=selectGeometry(source,appearance,{...context,includeFixture:true});
 const person=selectGeometry(source,appearance,{...context,includeFixture:false});
 expect(person.description.parts.some(part=>[10,12].includes(part.region))).toBe(false);
 const shape={presentation:appearance.presentation,...appearance.body,face:appearance.face};
 const top=anatomicalHeight(person.vertices);
 const expected=configuredPose(reference.manifest,shape,action,0,top,undefined,reference);
 const actual=configuredPose(person.manifest,shape,action,0,top,undefined,person);
 expect(actual.length).toBe(expected.length);
 for(let i=0;i<actual.length;i++)expect(actual[i]).toBeCloseTo(expected[i],5);
});
