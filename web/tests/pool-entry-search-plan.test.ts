import {expect,it} from 'vitest';
import {poolEntrySearchPlan,POOL_ENTRY_NODE_ATTEMPTS} from '../src/render/character/pool-entry-search-plan.js';

it('exposes every declared contact, posture, root and independent limb branch within 32 attempts',()=>{
  const plan=poolEntrySearchPlan(.2);expect(plan).toHaveLength(POOL_ENTRY_NODE_ATTEMPTS);expect(plan).toEqual(poolEntrySearchPlan(.2));
  expect(new Set(plan.map(request=>request.id)).size).toBe(32);expect(new Set(plan.map(request=>request.profile)).size).toBe(4);
  expect(new Set(plan.map(request=>request.ray)).size).toBe(8);expect(new Set(plan.map(request=>request.posture)).size).toBe(4);
  for(const field of ['kneeL','kneeR','elbowL','elbowR','rollL','rollR','railL','railR'] as const)expect(new Set(plan.map(request=>request[field])).size).toBeGreaterThan(1);
  expect(plan.some(request=>request.kneeL!==request.kneeR)).toBe(true);expect(plan.some(request=>request.rollL!==request.rollR)).toBe(true);
  expect(plan.some(request=>request.direction[2]<0&&request.direction[1]>0)).toBe(true);
});
