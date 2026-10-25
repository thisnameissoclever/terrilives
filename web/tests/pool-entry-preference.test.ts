import {beforeAll,expect,it} from 'vitest';
import {defaultAppearance} from '../src/character/schema.js';
import {PreparedBody} from '../src/render/character/prepared-body.js';
import {anatomicalHeight} from '../src/render/character/shape.js';
import {PoolEntryCompiler} from '../src/render/character/pool-entry-compiler.js';
import {poolEntrySearchPlan} from '../src/render/character/pool-entry-search-plan.js';
import {poolBase,poolRig,poolFixture} from './pool-observer-fixture.js';

let compiler:PoolEntryCompiler;
beforeAll(()=>{
  const appearance=defaultAppearance('feminine'),shape={presentation:appearance.presentation,...appearance.body,face:appearance.face};
  const selected=new PreparedBody(poolBase,appearance).select(poolRig,appearance,{wear:'bare',prop:'none',fixture:'none',eyes_closed:false,includeFixture:false,clip:'pool_enter',swimwear:'two_piece'});
  compiler=new PoolEntryCompiler(poolRig.manifest,shape,anatomicalHeight(poolBase.vertices),[selected.body,selected.extra!],poolFixture);
});

it('captures the phase-local free-foot goal before an optional pelvis preference',()=>{
  for(const phase of [.225,.25]){
    const domain=compiler.prepareLegDomain(phase,poolEntrySearchPlan(phase)[4]),free=domain.footContacts.find(contact=>contact.limb==='footL')!;
    expect(free.target).toEqual(domain.seed.world[compiler.anatomy.footL.end].slice(12,15));
  }
});


it('keeps owned phase intent immutable across pelvis choices and repeated root evaluation',()=>{
  const phase=.225,request=poolEntrySearchPlan(phase)[4],domain=compiler.prepareLegDomain(phase,request),source=domain.phasePreference.freeFeet.footL!;
  expect(Object.isFrozen(domain.phasePreference)).toBe(true);expect(Object.isFrozen(source.target)).toBe(true);expect(Object.isFrozen(source.orientation)).toBe(true);
  const other=compiler.prepareLegDomain(phase,{...request,posture:1});expect(other.phasePreference.freeFeet.footL).toEqual(source);
  const root=[0,.001,0] as const,first=compiler.evaluateLegDomain(domain,root,request),second=compiler.evaluateLegDomain(domain,root,request);
  for(const result of [first,second]){
    const foot=result.legContacts.find(contact=>contact.limb==='footL')!;
    expect(foot.target).toEqual([source.target[0],source.target[1]+root[1],source.target[2]]);expect(foot.orientation).toEqual(source.orientation);expect(result.knees.every(knee=>knee.admitted)).toBe(true);
  }
  expect(domain.phasePreference.freeFeet.footL).toBe(source);expect(domain.footContacts.find(contact=>contact.limb==='footL')!.target).toEqual(source.target);
});

it('leaves exact required-foot frames and obligations at the accepted release-start key',()=>{
  const domain=compiler.prepareLegDomain(.2,poolEntrySearchPlan(.2)[4]);
  expect(domain.phasePreference.freeFeet).toEqual({});expect(domain.footContacts.every(contact=>contact.frame)).toBe(true);
  expect(domain.phasePreference.policy.footL.required).toBe(true);expect(domain.phasePreference.policy.footR.required).toBe(true);
});
