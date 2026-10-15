import {isDeepStrictEqual} from 'node:util';
import {mkdirSync,writeFileSync} from 'node:fs';
import {afterAll,expect,it} from 'vitest';
import {defaultAppearance} from '../src/character/schema.js';
import {bikeGeometry,bikeInput} from './bike-contact-fixture.js';
import {makeBikeContactInput} from '../src/render/character/bike-contact-protocol.js';
import type {BikeContactInputDataV1} from '../src/render/character/bike-contact-types.js';

function difference(a:unknown,b:unknown,path='input'):string {
  if(Object.is(a,b))return '';
  if(!a||!b||typeof a!=='object'||typeof b!=='object')return `${path}: ${Object.is(a,-0)?'-0':String(a)} versus ${Object.is(b,-0)?'-0':String(b)}`;
  for(const key of new Set([...Object.keys(a),...Object.keys(b)])){
    const found=difference((a as Record<string,unknown>)[key],(b as Record<string,unknown>)[key],path+'.'+key);if(found)return found;
  }
  return '';
}
const evidence:unknown[]=[];
function nonorientation(input:BikeContactInputDataV1){
  const {sourcePhase:_,soles,...rest}=input;
  return {...rest,soles:soles.map(sole=>({points:sole.points}))};
}
function phaseCheck(appearance:ReturnType<typeof defaultAppearance>){
  const begin=performance.now(),geometry=bikeGeometry(appearance),viewMs=performance.now()-begin;
  let started=performance.now();const reference=bikeInput(appearance,geometry,0),extractionMs=[performance.now()-started],invariant=nonorientation(reference);
  let changedOrientations=0,maximumOrientationDelta=0;
  for(let frame=.25;frame<8;frame+=.25){
    started=performance.now();const actual=bikeInput(appearance,geometry,frame);extractionMs.push(performance.now()-started);
    if(!isDeepStrictEqual(nonorientation(actual),invariant)){
      const error=`Cold nonorientation phase ${frame}: ${difference(nonorientation(actual),invariant)}`;
      evidence.push({presentation:appearance.presentation,body:appearance.body,footwear:appearance.footwear,viewMs,extractionMs,error,reference,actual});
      throw new Error(error);
    }
    if(!isDeepStrictEqual(actual.soles.map(sole=>sole.source),reference.soles.map(sole=>sole.source)))changedOrientations++;
    for(let side=0;side<2;side++)for(let i=0;i<16;i++)maximumOrientationDelta=Math.max(maximumOrientationDelta,Math.abs(actual.soles[side].source[i]-reference.soles[side].source[i]));
  }
  expect(changedOrientations).toBeGreaterThan(0);
  evidence.push({presentation:appearance.presentation,body:appearance.body,footwear:appearance.footwear,viewMs,extractionMs,phases:32,changedOrientations,maximumOrientationDelta});
  return reference;
}
it('preserves actual neutral nonorientation inputs while recording source-orientation variation',()=>{phaseCheck(defaultAppearance());});

let seed=0x6135ab91;
const interior=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed%99+1;};
const profiles=[...Array.from({length:32},(_,bits)=>({label:'corner '+bits,body:{height:bits&1?100:0,build:bits&2?100:0,shoulders:bits&4?100:0,hips:bits&8?100:0,torso:bits&16?100:0}})),
  ...Array.from({length:8},(_,i)=>({label:'interior '+i,body:{height:interior(),build:interior(),shoulders:interior(),hips:interior(),torso:interior()}}))];
const cases=(['masculine','feminine'] as const).flatMap(presentation=>['loafers','laceups','trainers'].flatMap(footwear=>profiles.map(profile=>({presentation,footwear,...profile}))));
it.each(cases)('preserves nonorientation cold phase inputs for $presentation $footwear $label',({presentation,footwear,body})=>{
  const appearance=defaultAppearance(presentation);appearance.body=body;appearance.footwear=footwear;phaseCheck(appearance);
},30000);

it('preserves contact input through non-contact appearance choices',()=>{
  const appearance=defaultAppearance(),reference=bikeInput(appearance);
  const variants=[{...appearance,colors:{...appearance.colors,shirt:[1,2,3] as [number,number,number]}},
    {...appearance,hairstyle:'bob'}, {...appearance,bald:true}, {...appearance,glasses:true,glasses_style:'rectangular'},
    {...appearance,facial_hair:'beard',earrings:'studs',freckles:true,freckle_density:100,scar:'brow'},
    {...appearance,top:'jacket',sleeves:'short'},
    {...appearance,face:{...appearance.face,shape:'angular',cheeks:100,jaw:0,chin:100,eye_size:0,brow_thickness:100,nose_width:0,mouth_fullness:100,ears:0}}];
  for(const variant of variants){const actual=bikeInput(variant);expect(actual).toStrictEqual(reference);}
});
it('uses identical sparse and legacy compact contact input and revision-sensitive content keys',async()=>{
  const appearance=defaultAppearance(),input=bikeInput(appearance),compact=bikeInput(appearance,bikeGeometry(appearance,true));
  expect(input).toStrictEqual(compact);
  const before=await makeBikeContactInput(input),after=await makeBikeContactInput({...input,revisions:{...input.revisions,fixture:'different-fixture-revision'}});
  expect(before.key).not.toBe(after.key);
});
afterAll(()=>{
  if(!process.env.BIKE_CONTACT_INPUT_EVIDENCE)return;
  const folder=new URL('../../docs/evidence/2026-10-13-creator-repair/bike-contact-compilation/',import.meta.url);mkdirSync(folder,{recursive:true});
  const name=process.env.BIKE_CONTACT_INPUT_EVIDENCE==='neutral'?'input-neutral.json':'input-phase-matrix.json';
  writeFileSync(new URL(name,folder),JSON.stringify({cases:evidence},null,2),'utf8');
});
