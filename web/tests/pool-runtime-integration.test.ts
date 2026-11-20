import {expect,it} from 'vitest';
import {defaultAppearance} from '../src/character/schema.js';
import {createPoolContactInput} from '../src/render/character/pool-contact-preparation.js';
import {validatePreparationRequest} from '../src/render/character/preparation-protocol.js';
import {configuredPose} from '../src/render/character/pose.js';
import {bindPoolContacts,requirePoolPose,PoolContactNotReadyError} from '../src/render/character/pool-contact-sample.js';
import {PreparedBody} from '../src/render/character/prepared-body.js';
import {anatomicalHeight} from '../src/render/character/shape.js';
import {poolBase,poolRig} from './pool-observer-fixture.js';
import {schemaPoolArtifact} from './pool-contact-service-fixture.js';
import {syntheticPoolPolicyFixture} from './pool-policy-fixture.js';
import {poolPartKey,poolShapeIdentity} from '../src/render/character/pool-contact-identity.js';

it('admits the actual pool input through the shared worker request boundary',async()=>{
  const input=await createPoolContactInput(defaultAppearance('feminine'));
  expect(()=>validatePreparationRequest({version:1,id:1,kind:'pool',input})).not.toThrow();
});

it('refuses production pool sampling before the complete physical artifact is bound',()=>{
  const appearance=defaultAppearance('feminine'),shape={presentation:appearance.presentation,...appearance.body,face:appearance.face};
  const selected=new PreparedBody(poolBase,appearance).select(poolRig,appearance,{wear:'bare',prop:'none',fixture:'none',eyes_closed:false,includeFixture:false,clip:'pool_paddle',swimwear:'two_piece'});
  expect(()=>configuredPose(poolRig.manifest,shape,'pool_paddle',0,anatomicalHeight(poolBase.vertices),undefined,selected.body)).toThrow(PoolContactNotReadyError);
});


it('samples production entry, paddle and exit through selected body and garment admission',async()=>{
  // Synthetic protocol exercise only; complete physical graph acceptance is a separate game check.
  const appearance=defaultAppearance('feminine'),shape={presentation:appearance.presentation,...appearance.body,face:appearance.face};
  const selected=new PreparedBody(poolBase,appearance).select(poolRig,appearance,{wear:'bare',prop:'none',fixture:'none',eyes_closed:false,includeFixture:false,clip:'pool_paddle',swimwear:'two_piece'});
  const artifact=schemaPoolArtifact(await createPoolContactInput(appearance)),top=anatomicalHeight(poolBase.vertices);
  Object.assign(artifact,{source:selected.body.manifest.sourceSha256,partKeys:[selected.body,selected.extra!].map(poolPartKey),shapeKey:poolShapeIdentity(shape,top),top});
  expect(()=>configuredPose(poolRig.manifest,shape,'pool_enter',0,top,undefined,selected.body,undefined,undefined,undefined,artifact)).toThrow(PoolContactNotReadyError);
  bindPoolContacts(artifact,selected.body,shape,top,[selected.extra!],syntheticPoolPolicyFixture());
  for(const action of ['pool_enter','pool_paddle',...Array.from({length:12},(_,i)=>'pool_exit_'+i)]){
    const frames=poolRig.manifest.actions[action].length;
    for(const frame of [0,(frames-1)/2,frames-1]){
      const actual=configuredPose(poolRig.manifest,shape,action,frame,top,undefined,selected.body,undefined,undefined,undefined,artifact);
      expect(actual).toEqual(requirePoolPose(artifact,selected.body,shape,top,action,frame));
      expect(actual.length).toBe(17*16);expect([...actual].every(Number.isFinite)).toBe(true);
    }
  }
});
