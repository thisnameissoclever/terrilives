import {readFileSync,mkdirSync,writeFileSync} from 'node:fs';
import {afterAll,expect,it,vi} from 'vitest';
import {defaultAppearance} from '../src/character/schema.js';
import {anatomicalHeight} from '../src/render/character/shape.js';
import {configuredPose,configuredPoseForProof} from '../src/render/character/pose.js';
import * as bike from '../src/render/character/bike-fit.js';
import {compileBikeContact} from '../src/render/character/bike-contact-compile.js';
import {makeBikeContactInput,freezeBikeContactArtifact} from '../src/render/character/bike-contact-protocol.js';
import {sampleBikeContact,BikeContactNotReadyError} from '../src/render/character/bike-contact-sample.js';
import {PreparedBody} from '../src/render/character/prepared-body.js';
import type {BikeFit} from '../src/render/character/bike-contact-types.js';
import {fitBike as frozenFit} from './fixtures/support-surface/bike-original.js';
import {bikeGeometry,bikeInput,bikeRig} from './bike-contact-fixture.js';

const golden=JSON.parse(readFileSync(new URL('./fixtures/support-surface/bike-fit-golden.json',import.meta.url),'utf8')) as
  {cases:{presentation:'masculine'|'feminine';bits:number;body:ReturnType<typeof defaultAppearance>['body'];frames:{frame:number;fit:BikeFit}[]}[]};
const evidence:unknown[]=[];
it.each(golden.cases)('compiles the exact frozen cycle for $presentation corner $bits',async row=>{
  const appearance=defaultAppearance(row.presentation);appearance.body=row.body;appearance.footwear='trainers';appearance.bottoms='shorts';appearance.top='jacket';appearance.sleeves='short';
  const geometry=bikeGeometry(appearance),data=bikeInput(appearance,geometry),input=await makeBikeContactInput(data);
  const started=performance.now(),artifact=freezeBikeContactArtifact(compileBikeContact(input)),compileMs=performance.now()-started;
  const shape={presentation:appearance.presentation,...appearance.body,face:appearance.face},top=anatomicalHeight(geometry.vertices);
  let checked=0;
  const original=vi.spyOn(bike,'fitBike').mockImplementation((g,a,t,rest,pose,source,dimensions,lengths,angle)=>{
    const expected=frozenFit({...g},a,t,rest,pose,source,dimensions,lengths,angle);
    expect(sampleBikeContact(artifact,angle??0)).toStrictEqual(expected);checked++;return expected;
  });
  try{configuredPoseForProof(geometry.manifest,shape,'exercise',0,top,undefined,geometry);}finally{original.mockRestore();}
  expect(checked).toBe(1);
  for(const frame of row.frames)expect(JSON.stringify(sampleBikeContact(artifact,-frame.frame/8*Math.PI*2))).toBe(JSON.stringify(frame.fit));
  const forbidden=vi.spyOn(bike,'fitBike').mockImplementation(()=>{throw new Error('Production pose attempted synchronous compilation.');});
  try{
    for(const frame of [7.5,0,3.5,1,6.25])expect(configuredPose(geometry.manifest,shape,'exercise',frame,top,undefined,geometry,artifact).every(Number.isFinite)).toBe(true);
    expect(()=>configuredPose(geometry.manifest,shape,'exercise',1,top,undefined,geometry)).toThrow(BikeContactNotReadyError);
  }finally{forbidden.mockRestore();}
  if(process.env.BIKE_CONTACT_COMPILE_EVIDENCE)evidence.push({presentation:row.presentation,bits:row.bits,key:artifact.key,compileMs,fit:artifact.fit});
},30000);

it('uses the same artifact for a once-compacted prepared body and explicit CPU proof on arbitrary entry phases',async()=>{
  const appearance=defaultAppearance('feminine');appearance.body={height:0,build:0,shoulders:0,hips:0,torso:100};appearance.footwear='trainers';
  const raw=bikeGeometry(appearance),artifact=freezeBikeContactArtifact(compileBikeContact(await makeBikeContactInput(bikeInput(appearance,raw))));
  const prepared=new PreparedBody(bikeRig.base,appearance).select(bikeRig,appearance,
    {wear:'clothed',prop:'none',fixture:'none',eyes_closed:false,clip:'exercise',grip:'relaxed',includeFixture:false}).body;
  const shape={presentation:appearance.presentation,...appearance.body,face:appearance.face},top=anatomicalHeight(prepared.vertices);
  for(const phase of [6.75,0,3.25,7.75,1.5]){
    const actual=configuredPose(prepared.manifest,shape,'exercise',phase,top,undefined,prepared,artifact);
    const proof=configuredPoseForProof(prepared.manifest,shape,'exercise',phase,top,undefined,prepared);
    expect(actual).toStrictEqual(proof);
  }
  const changed={...shape,height:1};expect(()=>configuredPose(prepared.manifest,changed,'exercise',0,top,undefined,prepared,artifact)).toThrow(BikeContactNotReadyError);
},30000);

afterAll(()=>{
  if(!process.env.BIKE_CONTACT_COMPILE_EVIDENCE)return;
  const folder=new URL('../../docs/evidence/2026-10-13-creator-repair/bike-contact-compilation/',import.meta.url);mkdirSync(folder,{recursive:true});
  writeFileSync(new URL('compiled-cycles.json',folder),JSON.stringify({expectedCases:64,observedCases:evidence.length,cases:evidence},null,2),'utf8');
});
