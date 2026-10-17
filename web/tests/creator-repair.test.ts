import { expect, it } from 'vitest';
import { CharacterDraft } from '../src/character/draft.js';
import { floatBits, floatValue, neutralDraft } from '../src/character/schema.js';
import type { CharacterCatalog } from '../src/character/catalog.js';
import { characterNames, namesForPresentation } from '../src/character/names.js';
import { activityCategories, categoryMembers, unsupportedActivityRoutes } from '../src/character/activity-categories.js';
import { categoryInfluence } from '../src/character/choice-influences.js';
import { readableNumber, skillStanding, reviewValue } from '../src/character/presentation.js';
import { CreatorClock } from '../src/ui/character-creator/clock.js';

const catalog:CharacterCatalog={version:1,name_limit:24,max_traits:4,max_household:6,
  traits:Array.from({length:6},(_,i)=>({id:`trait${i}`,label:`Trait ${i}`,description:'',kind:'disposition' as const,initial_state:floatBits(0),weights:[]})),
  affinities:[],skills:[{id:'reading',label:'Reading',description:'',thresholds:[floatBits(0),floatBits(.1),floatBits(.3)]}],hobbies:[],personalities:[],
  activities:[{object:'bookshelf',action:'read',label:'Read',tags:['reading']},{object:'reading_chair',action:'settle_in',label:'Read seated',tags:['reading','lounging']},
    {object:'kitchen_sink',action:'clean_dishes',label:'Clean dishes',tags:[]}]};
const categoryId='activity-category:read';

it('samples a matching name after gender and preserves manual names and legacy pronouns',()=>{
  for(let seed=0;seed<250;seed++){
    const draft=CharacterDraft.create(seed,catalog,[]),value=draft.value;
    expect(namesForPresentation(value.appearance.presentation)).toContain(value.name);
    expect(value.traits.length).toBeGreaterThanOrEqual(1);expect(value.traits.length).toBeLessThanOrEqual(4);
  }
  expect(new Set(characterNames).size).toBe(100);
  const source=neutralDraft('Player name');source.pronouns='custom stored pronouns';
  const draft=CharacterDraft.edit(source,42,catalog,[]);
  draft.set('appearance.presentation','feminine');expect(draft.value.name).toBe('Player name');
  draft.randomize('name');expect(namesForPresentation('feminine')).toContain(draft.value.name);
  draft.randomize('all');expect(draft.value.pronouns).toBe(source.pronouns);
  expect(draft.fields.some(field=>field.id==='pronouns')).toBe(false);
});

it('treats baldness and hairstyle as one edit and one randomization lock',()=>{
  const source=neutralDraft('Test'),draft=CharacterDraft.edit(source,12,catalog,[]);
  draft.set('appearance.hairstyle','bald');expect(draft.value.appearance.bald).toBe(true);
  expect(draft.value.appearance.hairstyle).toBe(source.appearance.hairstyle);
  draft.lock('appearance.hairstyle',true);draft.randomize('appearance');
  expect(draft.value.appearance.bald).toBe(true);expect(draft.value.appearance.hairstyle).toBe(source.appearance.hairstyle);
  draft.reset('appearance.hairstyle');expect(draft.value.appearance.bald).toBe(false);
  draft.undo();expect(draft.value.appearance.bald).toBe(true);
  draft.set('appearance.hairstyle','bob');expect(draft.value.appearance.bald).toBe(false);expect(draft.value.appearance.hairstyle).toBe('bob');
});

it('edits a category atomically, undoes exact sparse bytes and resets supported routes to neutral',()=>{
  const source=neutralDraft('Test');source.behavior.dispositions=[{object:'bookshelf',action:'read',weight:floatBits(.123456789)},
    {object:'kitchen_sink',action:'clean_dishes',weight:floatBits(.23456789)}];
  const draft=CharacterDraft.edit(source,42,catalog,[]),field=draft.fields.find(field=>field.id===categoryId)!;
  expect(Number(field.get(source))).toBeCloseTo((Math.fround(.123456789)+1)/2,12);
  draft.set(categoryId,1.25);expect(draft.value.behavior.dispositions.filter(row=>row.action!=='clean_dishes').map(row=>floatValue(row.weight))).toEqual([1.25,1.25]);
  draft.undo();expect(draft.value).toEqual(source);
  draft.set(categoryId,.5);const changed=draft.value,state=draft.randomState;
  draft.reset(categoryId);expect(field.get(draft.value)).toBe(1);
  expect(draft.value.behavior.dispositions).toEqual([source.behavior.dispositions[1]]);
  expect(draft.randomState).toBe(state);draft.undo();expect(draft.value).toEqual(changed);
  draft.randomize('needs');expect(draft.value.behavior.dispositions.find(row=>row.action==='clean_dishes')).toEqual(source.behavior.dispositions[1]);
  draft.reset('needs');expect(draft.value.behavior).toEqual({...neutralDraft('Test').behavior,dispositions:[source.behavior.dispositions[1]]});
});

it('resets and randomizes only the visible semantic page scope',()=>{
  const draft=CharacterDraft.create(13,catalog,[]);
  draft.set('behavior.chronotype_offset_ticks',180);draft.set('behavior.shyness',99);
  draft.reset('personality');expect(draft.value.behavior.shyness).toBe(50);expect(draft.value.behavior.chronotype_offset_ticks).toBe(180);
  const before=draft.value;draft.randomize('personality');expect(draft.value.behavior.drain).toEqual(before.behavior.drain);
  expect(draft.value.behavior.dispositions).toEqual(before.behavior.dispositions);
  draft.reset('needs');expect(draft.value.behavior.chronotype_offset_ticks).toBe(0);
});

it('preserves hidden weights through presets and restores the entire preset edit with one undo',()=>{
  const source=neutralDraft('Test');source.behavior.dispositions=[{object:'kitchen_sink',action:'clean_dishes',weight:floatBits(.1234567)}];
  const values={cleanliness:floatBits(.9),chronotype_offset_ticks:120,drain:Array(7).fill(floatBits(.8)),recovery:Array(7).fill(floatBits(1.2)),
    dispositions:[{object:'bookshelf',action:'read',weight:floatBits(1.7)}]};
  const draft=CharacterDraft.edit(source,42,{...catalog,personalities:[{id:'reader',label:'Reader',description:'',values}]},[]);
  draft.applyPersonalityPreset('reader');expect(draft.value.behavior.dispositions.find(row=>row.action==='clean_dishes')).toEqual(source.behavior.dispositions[0]);
  expect(draft.personalityPreset).toBe('reader');draft.undo();expect(draft.value).toEqual(source);
});

it('permits no manually selected traits and respects locks on absent traits and gender',()=>{
  const source=neutralDraft('Keep name'),draft=CharacterDraft.edit(source,42,catalog,[]);
  for(const trait of catalog.traits)draft.lock(JSON.stringify(['trait',trait.id]),true);
  draft.lock('appearance.presentation',true);draft.lock('name',true);draft.randomize('all');
  expect(draft.value.traits).toEqual([]);expect(draft.value.appearance.presentation).toBe('masculine');expect(draft.value.name).toBe('Keep name');
  draft.set(JSON.stringify(['trait','trait0']),true);draft.set(JSON.stringify(['trait','trait0']),false);expect(draft.value.traits).toEqual([]);
});

it('maps known routes explicitly and reports unsupported catalog routes',()=>{
  expect(categoryMembers(activityCategories.find(c=>c.id==='read')!,catalog).map(r=>r.object)).toEqual(['bookshelf','reading_chair']);
  expect(unsupportedActivityRoutes(catalog)).toEqual([]);
  const added={...catalog,activities:[...catalog.activities,{object:'future',action:'read',label:'Future',tags:['reading']}]};
  expect(unsupportedActivityRoutes(added).map(r=>r.object)).toEqual(['future']);
});

it('averages actual route products when a trait affects only one route',()=>{
  const source=neutralDraft('Test');source.traits=[{id:'trait0',state:floatBits(0)}];
  source.behavior.dispositions=[{object:'bookshelf',action:'read',weight:floatBits(.5)},{object:'reading_chair',action:'settle_in',weight:floatBits(1.5)}];
  const weighted={...catalog,traits:[{...catalog.traits[0],weights:[{tag:'lounging',value:floatBits(2)}]}]};
  const result=categoryInfluence(source,weighted,'read');
  expect(result.activityWeight).toBe(1);expect(result.traitMultiplier).toBe(1.5);expect(result.combined).toBe(1.75);
});

it('decodes in-progress skill practice and formats saved affinity precision readably',()=>{
  expect(skillStanding(floatBits(.2),catalog.skills[0].thresholds)).toMatchObject({level:1,progress:expect.closeTo(.5,5)});
  const source=neutralDraft('Test');source.skills=[{id:'reading',practice:floatBits(.2)}];
  const draft=CharacterDraft.edit(source,1,catalog,[]),field=draft.fields.find(field=>field.id===JSON.stringify(['skill','reading']))!;
  expect(reviewValue(field,source,catalog)).toContain('Level 1');expect(reviewValue(field,source,catalog)).toContain('50%');
});

it('reviews surroundings and trait influences at two decimals, never float noise',()=>{
  // A 32-bit 0.71 reads as 0.7099999785423279 once widened; a spawned draw can
  // carry any number of digits. Neither belongs in the review.
  const affinity={id:'plants',label:'Plants',description:'Potted plants around the house.'};
  const withAffinity:CharacterCatalog={...catalog,affinities:[affinity]};
  const source=neutralDraft('Test');
  for(const [value,expected] of [[.71,'Likes (0.71)'],[-.57,'Dislikes (-0.57)'],[.164,'Likes (0.16)'],[0,'Neutral (0)'],[.001,'Likes (0.001)']] as const){
    source.affinities=[{id:affinity.id,value:floatBits(value)}];
    const draft=CharacterDraft.edit(source,1,withAffinity,[]),field=draft.fields.find(field=>field.id===JSON.stringify(['affinity',affinity.id]))!;
    expect(reviewValue(field,source,withAffinity)).toBe(expected);
  }
  expect(readableNumber(1.1714)).toBe('1.17');
  expect(readableNumber(0.7099999785423279)).toBe('0.71');
});

it('explains the normalized height control and reviews physical height relative to average',()=>{
  const draft=CharacterDraft.edit(neutralDraft('Test'),1,catalog,[]);
  const height=draft.fields.find(field=>field.id==='appearance.body.height')!;
  expect(height.description).toBe('50 is average height; 0 and 100 are 15% shorter and taller.');
  expect([height.min,height.max]).toEqual([0,100]);
  for(const [value,expected] of [[0,'85% of average'],[50,'100% of average'],[90,'112% of average'],[100,'115% of average']] as const){
    draft.set(height.id,value);
    expect(reviewValue(height,draft.value,catalog)).toBe(expected);
    expect(draft.value.appearance.body.height).toBe(value);
  }
});

it('advances preview frames from wall time and resumes without hidden-time jumps',()=>{
  const clock=new CreatorClock();clock.setActive(true);expect(clock.tick(1000,8,1)).toBe(0);
  expect(clock.tick(1250,8,1)).toBe(2);clock.setActive(false);expect(clock.tick(9000,8,1)).toBe(2);
  clock.setActive(true);expect(clock.tick(10000,8,1)).toBe(2);expect(clock.tick(10250,8,1)).toBe(4);
  clock.setPaused(true);expect(clock.tick(11000,8,1)).toBe(4);clock.setPaused(false);expect(clock.tick(12000,8,1)).toBe(4);
  clock.reset();expect(clock.tick(13000,8,1)).toBe(0);
});
