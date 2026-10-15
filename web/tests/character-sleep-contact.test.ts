import {mkdirSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {afterAll,expect,it,vi} from 'vitest';
import {defaultAppearance,type CharacterAppearanceV1} from '../src/character/schema.js';
import {anatomicalHeight,shapeVertices} from '../src/render/character/shape.js';
import {configuredPoseForProof} from '../src/render/character/pose.js';
import {posedCageSurface} from '../src/render/character/geometry-proof.js';
import {compileSleepContact} from '../src/render/character/sleep-contact-compile.js';
import {createSleepContactInput,sleepContactAppearanceKey} from '../src/render/character/sleep-contact-preparation.js';
import {canonicalSleepValue} from '../src/render/character/sleep-contact-identity.js';
import {requireSleepPose,requireSleepingCoverContribution,SleepContactNotReadyError} from '../src/render/character/sleep-contact-sample.js';
import {validateSleepContactArtifact,validateSleepContactInput,verifySleepContactInput} from '../src/render/character/sleep-contact-protocol.js';
import * as sleepingFit from '../src/render/character/sleep-fit.js';
import {createSleepingCoverFromContributions,updateSleepingCoverFromContributions,prepareSleepingCoverContribution,composeSleepingCoverHeights} from '../src/render/character/sleep-cover.js';
import type {Geometry} from '../src/render/character/bundle.js';
import {configuredPoseForProof as originalPose} from './fixtures/sleep-contact/pose-original.js';
import {createSleepingCover as originalCover} from './fixtures/sleep-contact/cover-original.js';
import {sleepRigs,preparedSleepGeometry,sleepLibrary} from './sleep-contact-fixture.js';
import type {SleepAction,SleepContactArtifactV1} from '../src/render/character/sleep-contact-types.js';

const evidence:unknown[]=[];
const bytes=(data:ArrayBuffer|ArrayBufferView)=>data instanceof ArrayBuffer?new Uint8Array(data):new Uint8Array(data.buffer,data.byteOffset,data.byteLength);
function exactGeometry(actual:Geometry,expected:Geometry){
  expect(actual.description).toStrictEqual(expected.description);expect(actual.manifest.materials).toStrictEqual(expected.manifest.materials);
  for(const key of ['vertices','cage','indices','stencilRanges','stencilWeights','normalRanges','normalTriangles'] as const)expect(Buffer.from(bytes(actual[key])).equals(Buffer.from(bytes(expected[key]))),key+' exact bytes').toBe(true);
}
function coldSurface(appearance:CharacterAppearanceV1,action:SleepAction){
  const geometry=preparedSleepGeometry(appearance,action),shape={presentation:appearance.presentation,...appearance.body,face:appearance.face},top=anatomicalHeight(geometry.vertices);
  const matrices=originalPose(geometry.manifest,shape,action,0,top,undefined,geometry);
  return {geometry,shape,top,matrices,points:posedCageSurface(geometry,shapeVertices(geometry.cage,shape,top),matrices)};
}
const corners=(['masculine','feminine'] as const).flatMap(presentation=>Array.from({length:32},(_,bits)=>({presentation,bits})));
it.each(corners)('preserves complete static support and covers for $presentation corner $bits',async({presentation,bits})=>{
  const appearance=defaultAppearance(presentation);appearance.body={height:bits&1?100:0,build:bits&2?100:0,shoulders:bits&4?100:0,hips:bits&8?100:0,torso:bits&16?100:0};
  const input=await createSleepContactInput(appearance),started=performance.now(),artifact=compileSleepContact(input,{...sleepRigs,revisions:input.revisions}),compileMs=performance.now()-started;
  const rows=[];
  for(const action of ['bed_sleep','bunk_sleep'] as const){
    const old=coldSurface(appearance,action),clip=artifact.clips[action];expect(Float32Array.from(clip.matrices)).toStrictEqual(old.matrices);
    expect(sleepLibrary.clips[action].playback).toBe('static');expect(sleepLibrary.clips[action].samples).toHaveLength(1);
    for(const phase of [0,.25,.5,1,3.75,127.5])expect(configuredPoseForProof(old.geometry.manifest,old.shape,action,phase,old.top,undefined,old.geometry)).toStrictEqual(old.matrices);
    const forbidden=vi.spyOn(sleepingFit,'fitSleepingPose').mockImplementation(()=>{throw new Error('Sleeping sampled a synchronous fit.');});
    try{
      const pose=requireSleepPose(artifact,old.geometry,old.shape,old.top,action);expect(pose).toStrictEqual(old.matrices);expect(requireSleepPose(artifact,old.geometry,old.shape,old.top,action)).toBe(pose);
      expect(()=>requireSleepPose(undefined,old.geometry,old.shape,old.top,action)).toThrow(SleepContactNotReadyError);
    }finally{forbidden.mockRestore();}
    const topology=createSleepingCoverFromContributions(old.geometry,[],action==='bunk_sleep'),identities=Object.fromEntries(['vertices','cage','indices','stencilRanges','stencilWeights','normalRanges','normalTriangles'].map(key=>[key,topology[key as keyof Geometry]]));
    for(const cover of clip.covers){
      const expected=originalCover(old.geometry,[{...old,offsetX:cover.offsetX}],action==='bunk_sleep');
      exactGeometry(createSleepingCoverFromContributions(old.geometry,[cover.heights],action==='bunk_sleep'),expected);
      updateSleepingCoverFromContributions(topology,[cover.heights],action==='bunk_sleep');exactGeometry(topology,expected);
      for(const [key,identity] of Object.entries(identities))expect(topology[key as keyof Geometry]).toBe(identity);
      rows.push({action,offsetX:cover.offsetX,vertexSha256:createHash('sha256').update(bytes(expected.vertices)).digest('hex')});
    }
  }
  evidence.push({presentation,bits,compileMs,rows});
},30000);

const styles=[
  {label:'curl',hairstyle:'curl'}, {label:'bob',hairstyle:'bob'}, {label:'wave',hairstyle:'wave'},
  {label:'crop',hairstyle:'crop'}, {label:'quiff',hairstyle:'quiff'}, {label:'bald',bald:true},
  {label:'beard',facial_hair:'beard'}, {label:'glasses',glasses:true,glasses_style:'rectangular'},
  {label:'shorts and trainers',bottoms:'shorts',footwear:'trainers',top:'tshirt',sleeves:'short'},
  {label:'jacket and laceups',top:'jacket',sleeves:'long',footwear:'laceups'},
  {label:'head details',scar:'cheek',earrings:'hoops',face:{...defaultAppearance().face,shape:'angular',cheeks:100,jaw:0,chin:100,eye_size:0,brow_thickness:100,nose_width:0,mouth_fullness:100,ears:0}},
];
it.each(styles)('preserves prepared head, face and garment geometry for $label',async style=>{
  const {label,...changes}=style;
  for(const presentation of ['masculine','feminine'] as const){
    const appearance={...defaultAppearance(presentation),...changes};
    appearance.body={height:100,build:0,shoulders:100,hips:0,torso:100};
    const input=await createSleepContactInput(appearance),artifact=compileSleepContact(input,{...sleepRigs,revisions:input.revisions});
    for(const action of ['bed_sleep','bunk_sleep'] as const){
      const old=coldSurface(appearance,action);expect(Float32Array.from(artifact.clips[action].matrices)).toStrictEqual(old.matrices);
      const grids=artifact.clips[action].covers;
      for(const {offsetX,heights} of grids)exactGeometry(createSleepingCoverFromContributions(old.geometry,[heights],action==='bunk_sleep'),originalCover(old.geometry,[{...old,offsetX}],action==='bunk_sleep'));
    }
  }
},30000);

it('preserves rounding at support-grid boundaries before and after independent draping',()=>{
  let seed=714021;const next=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/2**32;};
  const scene=preparedSleepGeometry(defaultAppearance(),'bed_sleep');
  for(const bunk of [false,true])for(let iteration=0;iteration<16;iteration++){
    const surface=()=>{
      const z=Math.fround(.475+next()*.45),points=Float32Array.from([-.48,-.70,z,.49,-.70,z+2**-24,-.48,.15,z-2**-24,.49,.15,z]);
      const geometry={...scene,indices:Uint32Array.from([0,1,2,1,3,2]),description:{...scene.description,parts:[{name:'Test support',region:2,start:0,count:6,outline:false}]}};
      return {geometry,points,offsetX:iteration%2?-.77:0};
    };
    const sleepers=[surface(),surface()],grids=sleepers.map(sleeper=>prepareSleepingCoverContribution(sleeper,bunk));
    exactGeometry(createSleepingCoverFromContributions(scene,grids,bunk),originalCover(scene,sleepers,bunk));
    expect(composeSleepingCoverHeights(grids,bunk)).toStrictEqual(composeSleepingCoverHeights([...grids].reverse(),bunk));
  }
},30000);

it('combines different sleepers and occupancy orders exactly, including removal and reentry',async()=>{
  const a=defaultAppearance(),b=defaultAppearance('feminine');b.body={height:100,build:100,shoulders:0,hips:100,torso:0};b.hairstyle='quiff';b.top='jacket';b.sleeves='long';b.footwear='trainers';b.face.cheeks=100;b.face.jaw=0;
  const left=coldSurface(a,'bed_sleep'),right=coldSurface(b,'bed_sleep'),leftSleeper={...left,offsetX:0},rightSleeper={...right,offsetX:-.77};
  const l=Array.from(prepareSleepingCoverContribution(leftSleeper,false)),r=Array.from(prepareSleepingCoverContribution(rightSleeper,false));
  const cover=createSleepingCoverFromContributions(left.geometry,[],false);
  for(const [sleepers,grids] of [[[],[]],[[leftSleeper],[l]],[[rightSleeper],[r]],[[leftSleeper,rightSleeper],[l,r]],[[rightSleeper,leftSleeper],[r,l]],[[leftSleeper],[l]],[[],[]],[[leftSleeper,rightSleeper],[l,r]]] as const){
    updateSleepingCoverFromContributions(cover,grids,false);exactGeometry(cover,originalCover(left.geometry,sleepers,false));
  }
},30000);

it('keys every geometric appearance field and source while ignoring uniform edits',async()=>{
  const base=defaultAppearance(),input=await createSleepContactInput(base),key=sleepContactAppearanceKey(base);
  for(const [name,value] of Object.entries({presentation:'feminine',hairstyle:'wave',bald:true,facial_hair:'beard',scar:'brow',top:'jacket',sleeves:'long',bottoms:'shorts',footwear:'laceups',glasses:true,glasses_style:'rectangular',earrings:'hoops'})){
    const appearance={...base,[name]:value};expect(sleepContactAppearanceKey(appearance),name).not.toBe(key);
  }
  for(const name of Object.keys(base.body))expect(sleepContactAppearanceKey({...base,body:{...base.body,[name]:51}})).not.toBe(key);
  for(const name of ['cheeks','jaw','chin','eye_size','brow_thickness','nose_width','mouth_fullness','ears'])expect(sleepContactAppearanceKey({...base,face:{...base.face,[name]:51}})).not.toBe(key);
  const uniform={...base,undertone:'warm',freckles:true,freckle_density:100,colors:{...base.colors,shirt:[1,2,3] as [number,number,number]}};
  expect(sleepContactAppearanceKey(uniform)).toBe(key);expect(await createSleepContactInput(uniform)).toStrictEqual(input);
  await expect(verifySleepContactInput({...input,revisions:{...input.revisions,bed:'changed'}})).rejects.toThrow('key');
});

it('rejects malformed payloads, stale mesh identities and a future animated sleep clip',async()=>{
  const appearance=defaultAppearance(),input=await createSleepContactInput(appearance),artifact=compileSleepContact(input,{...sleepRigs,revisions:input.revisions});
  expect(Object.isFrozen(artifact.clips.bed_sleep.covers[0].heights)).toBe(true);
  for(const mutate of [
    (value:SleepContactArtifactV1)=>{(value.clips.bed_sleep.matrices as number[])[0]=NaN;},
    (value:SleepContactArtifactV1)=>{delete (value.clips.bed_sleep.matrices as number[])[0];},
    (value:SleepContactArtifactV1)=>{delete (value.clips.bed_sleep.covers[0].heights as number[])[0];},
    (value:SleepContactArtifactV1)=>{(value.clips.bed_sleep.covers[0].heights as number[])[0]=.1;},
    (value:SleepContactArtifactV1)=>{value.clips.bed_sleep.covers[1].offsetX=-.76;},
  ]){const value=structuredClone(artifact);mutate(value);expect(()=>validateSleepContactArtifact(value)).toThrow();}
  const bad=structuredClone(input);delete (bad.appearance.body as Partial<typeof bad.appearance.body>).height;expect(()=>validateSleepContactInput(bad)).toThrow();
  const geometry=preparedSleepGeometry(appearance,'bed_sleep'),shape={presentation:appearance.presentation,...appearance.body,face:appearance.face},top=anatomicalHeight(geometry.vertices);
  expect(()=>requireSleepPose(artifact,{...geometry,description:{...geometry.description,parts:geometry.description.parts.slice(1)}},shape,top,'bed_sleep')).toThrow(SleepContactNotReadyError);
  expect(()=>requireSleepPose(artifact,geometry,{...shape,face:{...shape.face,jaw:51}},top,'bed_sleep')).toThrow(SleepContactNotReadyError);
  expect(()=>requireSleepingCoverContribution(artifact,'bed_sleep',-.76)).toThrow(SleepContactNotReadyError);
  const moving={...sleepRigs.bed,manifest:{...sleepRigs.bed.manifest,clipMetadata:{...sleepRigs.bed.manifest.clipMetadata,bed_sleep:{...sleepRigs.bed.manifest.clipMetadata!.bed_sleep,playback:'loop' as const}}}};
  expect(()=>compileSleepContact(input,{...sleepRigs,bed:moving,revisions:input.revisions})).toThrow('static one-sample');
  expect(canonicalSleepValue([-0])).not.toBe(canonicalSleepValue([0]));
},30000);

afterAll(()=>{
  if(!process.env.SLEEP_CONTACT_EVIDENCE)return;
  const folder=new URL('../../docs/evidence/2026-10-13-creator-repair/sleep-contact-compilation/',import.meta.url);mkdirSync(folder,{recursive:true});
  writeFileSync(new URL('exact-corners.json',folder),JSON.stringify({expected:64,observed:evidence.length,cases:evidence},null,2),'utf8');
});
