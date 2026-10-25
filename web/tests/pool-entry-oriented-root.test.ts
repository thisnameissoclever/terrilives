import {writeFileSync} from 'node:fs';
import {expect,it} from 'vitest';
import {defaultAppearance} from '../src/character/schema.js';
import {PreparedBody} from '../src/render/character/prepared-body.js';
import {anatomicalHeight} from '../src/render/character/shape.js';
import {PoolEntryCompiler} from '../src/render/character/pool-entry-compiler.js';
import {poolBase,poolRig,poolFixture} from './pool-observer-fixture.js';

it('observes the first leg-clear oriented ray witness through the complete unchanged hand and support domain',()=>{
  const appearance=defaultAppearance('feminine'),shape={presentation:appearance.presentation,...appearance.body,face:appearance.face};
  const selected=new PreparedBody(poolBase,appearance).select(poolRig,appearance,{wear:'bare',prop:'none',fixture:'none',eyes_closed:false,includeFixture:false,clip:'pool_enter',swimwear:'two_piece'});
  const compiler=new PoolEntryCompiler(poolRig.manifest,shape,anatomicalHeight(poolBase.vertices),[selected.body,selected.extra!],poolFixture);
  const root=[0,.4498388125651951,-.4498388125651951] as const,candidates=compiler.compileNodeCandidates(.2,{requestId:4,root});
  const records=candidates.map(candidate=>({phase:candidate.phase,planId:candidate.planId,posture:candidate.posture,projection:candidate.projection,knees:candidate.knees,
    basis:candidate.pose.basis,rest:candidate.pose.rest,contacts:candidate.contacts.map(contact=>({limb:contact.limb,target:contact.target,pole:contact.pole,orientation:contact.orientation,
      surface:contact.surface,patchPart:contact.patch.part,triangles:contact.patch.sourceTriangles,frame:contact.frame,parameter:contact.parameter,roll:contact.roll,elbowBlend:contact.elbowBlend})),
    observation:candidate.observation,supports:candidate.supports,unresolvedViolations:candidate.unresolvedViolations,arithmetic:candidate.arithmetic.map(({geometry,...proof})=>proof)}));
  if(process.env.POOL_ORIENTED_ROOT_OUTPUT)writeFileSync(process.env.POOL_ORIENTED_ROOT_OUTPUT,JSON.stringify({scope:'One explicit previously observed leg-clear root in the same configured compiler domain. No physical acceptance unless every original support and selected-surface gate passes.',appearance,root,requestId:4,search:compiler.searches.get(.2),records},null,2));
  expect(candidates.some(candidate=>candidate.unresolvedViolations.length===0&&candidate.supports.every(support=>support.satisfied)),JSON.stringify(compiler.searches.get(.2))).toBe(true);
},30000);
