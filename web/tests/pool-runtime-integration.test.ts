import {expect,it} from 'vitest';
import {defaultAppearance} from '../src/character/schema.js';
import {createPoolContactInput} from '../src/render/character/pool-contact-preparation.js';
import {validatePreparationRequest} from '../src/render/character/preparation-protocol.js';
import {configuredPose} from '../src/render/character/pose.js';
import {PoolContactNotReadyError} from '../src/render/character/pool-contact-sample.js';
import {PreparedBody} from '../src/render/character/prepared-body.js';
import {anatomicalHeight} from '../src/render/character/shape.js';
import {poolBase,poolRig} from './pool-observer-fixture.js';

it('admits the actual pool input through the shared worker request boundary',async()=>{
  const input=await createPoolContactInput(defaultAppearance('feminine'));
  expect(()=>validatePreparationRequest({version:1,id:1,kind:'pool',input})).not.toThrow();
});

it('refuses production pool sampling before the complete physical artifact is bound',()=>{
  const appearance=defaultAppearance('feminine'),shape={presentation:appearance.presentation,...appearance.body,face:appearance.face};
  const selected=new PreparedBody(poolBase,appearance).select(poolRig,appearance,{wear:'bare',prop:'none',fixture:'none',eyes_closed:false,includeFixture:false,clip:'pool_paddle',swimwear:'two_piece'});
  expect(()=>configuredPose(poolRig.manifest,shape,'pool_paddle',0,anatomicalHeight(poolBase.vertices),undefined,selected.body)).toThrow(PoolContactNotReadyError);
});
