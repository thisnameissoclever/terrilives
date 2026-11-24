import fixture from '../../assets/models/sims/character-creator/clips/pool/contacts-v1.json';
import {poolSourcePolicy,type PoolSourcePolicy} from '../src/render/character/pool-source-policy.js';
import type {PoolFixtureV1,PoolSupport} from '../src/render/character/pool-contact-types.js';

/** Synthetic protocol/binding source only. It does not claim contact geometry was observed. */
export const freePoolPolicy=()=>structuredClone(poolSourcePolicy(fixture as unknown as PoolFixtureV1,'pool_paddle',0));
export function syntheticPoolPolicyFixture(policy:PoolSourcePolicy=freePoolPolicy()):PoolFixtureV1 {
  const result=structuredClone(fixture) as unknown as PoolFixtureV1;
  const limbs=()=>Object.fromEntries(Object.entries(policy).map(([limb,contact])=>[limb,{mode:contact.mode,surface:contact.surface,region:structuredClone(contact.region),interval:null,intervalSpace:'clip-phase'}])) as Record<keyof PoolSourcePolicy,PoolSupport>;
  for(const clip of Object.values(result.clips)){for(const sample of clip.samples)sample.limbs=limbs();for(const interval of clip.intervals)interval.limbs=limbs();}
  return result;
}
