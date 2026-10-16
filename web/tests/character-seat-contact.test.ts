import {expect,it,vi} from 'vitest';
import {defaultAppearance} from '../src/character/schema.js';
import {anatomicalHeight} from '../src/render/character/shape.js';
import {configuredPose,configuredPoseForProof} from '../src/render/character/pose.js';
import {compileSeatContact} from '../src/render/character/seat-contact-compile.js';
import {createSeatContactInput} from '../src/render/character/seat-contact-preparation.js';
import {validateSeatContactArtifact,verifySeatContactInput} from '../src/render/character/seat-contact-protocol.js';
import {requireSeatContact,SeatContactNotReadyError,bindSeatContacts,seatContactResolver} from '../src/render/character/seat-contact-sample.js';
import {stationarySeatLowerKey} from '../src/render/character/seat-contact-identity.js';
import {SEAT_ACTIONS} from '../src/render/character/seat-contact-types.js';
import * as fitter from '../src/render/character/seat-fit.js';
import {seatRigs,preparedSeatGeometry,preparedToiletGeometry} from './seat-contact-fixture.js';

it('preserves the separate toilet contact solver without requiring a chair artifact',async()=>{
  const appearance=defaultAppearance(),geometry=preparedToiletGeometry(appearance),shape={presentation:appearance.presentation,...appearance.body,face:appearance.face},top=anatomicalHeight(geometry.vertices);
  const input=await createSeatContactInput(appearance),artifact=compileSeatContact(input,{rigs:seatRigs,revisions:input.revisions});
  expect(()=>bindSeatContacts(artifact,geometry,shape,top)).not.toThrow();
  expect(seatContactResolver(artifact,'seat_sofa_read')).toBe(seatContactResolver(artifact,'seat_sofa_read'));
  for(const phase of [0,.5,1.375]){
    const expected=configuredPoseForProof(geometry.manifest,shape,'toilet',phase,top,undefined,geometry);
    const actual=configuredPose(geometry.manifest,shape,'toilet',phase,top,undefined,geometry);
    expect(actual).toEqual(expected);
    expect(configuredPose(geometry.manifest,shape,'toilet',phase,top,undefined,geometry,undefined,undefined,artifact)).toEqual(expected);
  }
});

it.each(['masculine','feminine'] as const)('preserves all thirteen actions and fractional upper animation for %s',async presentation=>{
  const appearance=defaultAppearance(presentation),input=await createSeatContactInput(appearance),artifact=compileSeatContact(input,{rigs:seatRigs,revisions:input.revisions});
  let maxDrift=0;
  for(const action of SEAT_ACTIONS){const geometry=preparedSeatGeometry(appearance,action),shape={presentation,...appearance.body,face:appearance.face},top=anatomicalHeight(geometry.vertices),count=geometry.manifest.actions[action].length;
    for(const phase of [0,.125,.5,1.375,count-1.5,count-.125]){const expected=configuredPoseForProof(geometry.manifest,shape,action,phase,top,undefined,geometry);
      const forbidden=vi.spyOn(fitter,'fitSeatedPose').mockImplementation(()=>{throw new Error('Production performed a synchronous seated fit.');});
      try{const pose=configuredPose(geometry.manifest,shape,action,phase,top,undefined,geometry,undefined,undefined,artifact);for(let i=0;i<pose.length;i++)maxDrift=Math.max(maxDrift,Math.abs(pose[i]-expected[i]));expect(forbidden).not.toHaveBeenCalled();}finally{forbidden.mockRestore();}
    }
    const closed=preparedSeatGeometry(appearance,action,true);expect(()=>requireSeatContact(artifact,closed,shape,top,action)).not.toThrow();
    expect(()=>configuredPose(geometry.manifest,shape,action,0,top,undefined,geometry)).toThrow(SeatContactNotReadyError);
  }
  expect(maxDrift).toBeLessThan(.00001);
},30000);

it('rejects moving lower tracks, stale appearance/source/fixture and malformed worker records',async()=>{
  const appearance=defaultAppearance(),input=await createSeatContactInput(appearance),artifact=compileSeatContact(input,{rigs:seatRigs,revisions:input.revisions}),action='seat_sofa_read';
  await verifySeatContactInput(input);expect(()=>validateSeatContactArtifact({...artifact,clips:{...artifact.clips,[action]:{...artifact.clips[action],fit:{pelvis:[0,NaN,0],legs:artifact.clips[action].fit.legs}}}})).toThrow();
  const geometry=preparedSeatGeometry(appearance,action),shape={presentation:appearance.presentation,...appearance.body,face:appearance.face},top=anatomicalHeight(geometry.vertices);
  expect(()=>requireSeatContact(artifact,geometry,{...shape,height:0},top,action)).toThrow(SeatContactNotReadyError);
  expect(()=>requireSeatContact(artifact,{...geometry,manifest:{...geometry.manifest,sourceSha256:'stale'}},shape,top,action)).toThrow(SeatContactNotReadyError);
  const modified=structuredClone(geometry.manifest);modified.actions[action][1][1][13]+=.01;expect(()=>stationarySeatLowerKey(modified,action)).toThrow('stationary lower tracks');
  const fixture=geometry.fixtureGeometry!;expect(()=>requireSeatContact(artifact,{...geometry,fixtureGeometry:{...fixture,description:{...fixture.description,parts:fixture.description.parts.slice(1)}}},shape,top,action)).toThrow(SeatContactNotReadyError);
  const moved=fixture.vertices.slice();moved[0]+=.01;expect(()=>requireSeatContact(artifact,{...geometry,fixtureGeometry:{...fixture,vertices:moved}},shape,top,action)).toThrow(SeatContactNotReadyError);
  requireSeatContact(artifact,geometry,shape,top,action);const serialize=vi.spyOn(JSON,'stringify');try{for(let i=0;i<100;i++)requireSeatContact(artifact,geometry,shape,top,action);expect(serialize).not.toHaveBeenCalled();}finally{serialize.mockRestore();}
  shape.face.jaw=shape.face.jaw===0?100:0;expect(()=>requireSeatContact(artifact,geometry,shape,top,action)).not.toThrow();
  shape.height=NaN;expect(()=>requireSeatContact(artifact,geometry,shape,top,action)).toThrow();
});

it.each([{height:0,build:100,shoulders:0,hips:100,torso:0},{height:100,build:0,shoulders:100,hips:0,torso:100}])('preserves extreme configured shapes and selected garments: %j',async body=>{
  const appearance=defaultAppearance('feminine');appearance.body=body;appearance.bottoms='shorts';appearance.footwear='trainers';appearance.top='jacket';
  const input=await createSeatContactInput(appearance),artifact=compileSeatContact(input,{rigs:seatRigs,revisions:input.revisions});
  for(const action of SEAT_ACTIONS){const geometry=preparedSeatGeometry(appearance,action),shape={presentation:appearance.presentation,...body,face:appearance.face},top=anatomicalHeight(geometry.vertices),expected=configuredPoseForProof(geometry.manifest,shape,action,1.5,top,undefined,geometry),actual=configuredPose(geometry.manifest,shape,action,1.5,top,undefined,geometry,undefined,undefined,artifact);expect(Math.max(...actual.map((value,i)=>Math.abs(value-expected[i])))).toBeLessThan(.00001);}
},30000);

const corners=Array.from({length:32},(_,bits)=>({height:bits&1?100:0,build:bits&2?100:0,shoulders:bits&4?100:0,hips:bits&8?100:0,torso:bits&16?100:0}));
it.each(corners)('preserves prepared fractional poses at body corner %j',async body=>{
  for(const presentation of ['masculine','feminine'] as const){const appearance=defaultAppearance(presentation);appearance.body=body;const input=await createSeatContactInput(appearance),artifact=compileSeatContact(input,{rigs:seatRigs,revisions:input.revisions});
    for(const action of SEAT_ACTIONS){const geometry=preparedSeatGeometry(appearance,action),shape={presentation,...body,face:appearance.face},top=anatomicalHeight(geometry.vertices),expected=configuredPoseForProof(geometry.manifest,shape,action,1.375,top,undefined,geometry),actual=configuredPose(geometry.manifest,shape,action,1.375,top,undefined,geometry,undefined,undefined,artifact);
      for(let i=0;i<actual.length;i++)expect(Math.abs(actual[i]-expected[i])).toBeLessThan(.00001);
    }
  }
},30000);
