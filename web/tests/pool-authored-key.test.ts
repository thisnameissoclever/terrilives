import {writeFileSync} from 'node:fs';
import {expect,it} from 'vitest';
import key from '../../assets/models/sims/character-creator/pool_activity_key_v2.json';
import {defaultAppearance} from '../src/character/schema.js';
import {PreparedBody} from '../src/render/character/prepared-body.js';
import {anatomicalHeight} from '../src/render/character/shape.js';
import {PoolEntryCompiler} from '../src/render/character/pool-entry-compiler.js';
import type {Vec3} from '../src/render/character/math.js';
import {poolBase,poolRig,poolFixture} from './pool-observer-fixture.js';

it('observes the complete authored neutral key with independently retained source head orientation',()=>{
  const appearance=defaultAppearance('feminine'),shape={presentation:appearance.presentation,...appearance.body,face:appearance.face};
  const selected=new PreparedBody(poolBase,appearance).select(poolRig,appearance,{wear:'bare',prop:'none',fixture:'none',eyes_closed:false,includeFixture:false,clip:'pool_enter',swimwear:'two_piece'});
  const compiler=new PoolEntryCompiler(poolRig.manifest,shape,anatomicalHeight(poolBase.vertices),[selected.body,selected.extra!],poolFixture);
  const witness={requestId:key.requestId,root:key.rootDelta as unknown as Vec3,trunkPitchDegrees:key.trunk.worldPitchDegrees,headSourcePhase:key.head.sourcePhase};
  const candidates=compiler.compileNodeCandidates(key.phase,witness),records=candidates.map(candidate=>({basis:candidate.pose.basis,rest:candidate.pose.rest,projection:candidate.projection,knees:candidate.knees,
    contacts:candidate.contacts.map(contact=>({limb:contact.limb,target:contact.target,pole:contact.pole,orientation:contact.orientation,surface:contact.surface,parameter:contact.parameter,roll:contact.roll,elbowBlend:contact.elbowBlend,frame:contact.frame,railFrame:contact.railFrame})),
    observation:candidate.observation,supports:candidate.supports,unresolvedViolations:candidate.unresolvedViolations,arithmetic:candidate.arithmetic.map(({geometry,...proof})=>proof)}));
  if(process.env.POOL_AUTHORED_KEY_OUTPUT)writeFileSync(process.env.POOL_AUTHORED_KEY_OUTPUT,JSON.stringify({scope:'Complete authored key material-clearance control. Rail support arithmetic and played posture remain independent gates.',key,search:compiler.searches.get(key.phase),records},null,2));
  expect(candidates).toHaveLength(1);expect(candidates[0].unresolvedViolations).toHaveLength(0);
  expect(candidates[0].supports).toHaveLength(4);expect(candidates[0].supports.every(support=>support.required&&support.satisfied)).toBe(true);
},30000);
