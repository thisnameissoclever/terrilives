import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import init, { SimHandle } from '../src/wasm/terri_wasm.js';
import { decodeCharacterCatalog } from '../src/character/codec.js';
import { activityCategories, categoryMembers, hiddenActivityRoutes, matchesRoute, unsupportedActivityRoutes } from '../src/character/activity-categories.js';

it('assigns every live catalog route to exactly one activity category or explicit hidden route',async()=>{
  await init({module_or_path:readFileSync('src/wasm/terri_wasm_bg.wasm')});
  const sim=new SimHandle(24,24);
  try{
    const catalog=decodeCharacterCatalog(sim.character_catalog());
    expect(catalog.activities.length).toBeGreaterThan(20);
    expect(unsupportedActivityRoutes(catalog)).toEqual([]);
    for(const category of activityCategories)expect(categoryMembers(category,catalog).length,category.id).toBeGreaterThan(0);
    for(const route of catalog.activities){
      const owners=activityCategories.filter(category=>category.routes.some(pair=>matchesRoute(route,pair))).length;
      const hidden=hiddenActivityRoutes.filter(pair=>matchesRoute(route,pair)).length;expect(owners+hidden,route.object+'/'+route.action).toBe(1);
    }
  }finally{sim.free();}
});
