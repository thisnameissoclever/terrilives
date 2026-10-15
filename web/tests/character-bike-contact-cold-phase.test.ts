import {mkdirSync,writeFileSync} from 'node:fs';
import {expect,it,vi} from 'vitest';
import {defaultAppearance} from '../src/character/schema.js';
import {anatomicalHeight} from '../src/render/character/shape.js';
import {configuredPoseForProof} from '../src/render/character/pose.js';
import * as bike from '../src/render/character/bike-fit.js';
import {extractBikeContactInput} from '../src/render/character/bike-contact-input.js';
import {compileBikeFit} from '../src/render/character/bike-contact-compile.js';
import {sampleBikeFit} from '../src/render/character/bike-contact-sample.js';
import {fitBike as frozenFit} from './fixtures/support-surface/bike-original.js';
import {bikeGeometry} from './bike-contact-fixture.js';

it('characterizes independent cold quarter-phase fits against the frozen solver',()=>{
  const appearance=defaultAppearance(),geometry=bikeGeometry(appearance),shape={presentation:appearance.presentation,...appearance.body,face:appearance.face};
  const top=anatomicalHeight(geometry.vertices),rows:unknown[]=[];let phase=0;
  const observed=vi.spyOn(bike,'fitBike').mockImplementation((...args:Parameters<typeof bike.fitBike>)=>{
    const [geometry,a,top,rest,pose,source,dimensions,lengths,angle]=args;
    const input=extractBikeContactInput(geometry,a,top,rest,pose,source,dimensions,lengths,{source:geometry.manifest.sourceSha256,fixture:'cold-phase-characterization',shoes:appearance.footwear},phase);
    const started=performance.now(),expected=frozenFit({...geometry},a,top,rest,pose,source,dimensions,lengths,angle),oldMs=performance.now()-started;
    const begin=performance.now(),actual=sampleBikeFit(compileBikeFit(input),angle??0),newMs=performance.now()-begin;
    expect(actual,'cold phase '+phase).toStrictEqual(expected);
    rows.push({phase,oldMs,newMs,orientations:input.soles.map(sole=>sole.source),fit:actual});return actual;
  });
  try{for(phase=0;phase<8;phase+=.25)configuredPoseForProof(geometry.manifest,shape,'exercise',phase,top,undefined,geometry);expect(rows).toHaveLength(32);}
  finally{
    observed.mockRestore();
    if(process.env.BIKE_CONTACT_INPUT_EVIDENCE){const folder=new URL('../../docs/evidence/2026-10-13-creator-repair/bike-contact-compilation/',import.meta.url);mkdirSync(folder,{recursive:true});writeFileSync(new URL('cold-neutral-phases.json',folder),JSON.stringify({rows},null,2),'utf8');}
  }
},30000);
