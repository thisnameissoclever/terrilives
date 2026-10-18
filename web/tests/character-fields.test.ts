import { creationInstinctBands } from './helpers/creation-instinct-bands.js';
import { expect, it } from 'vitest';
import { characterFields } from '../src/character/fields.js';
import { defaultAppearance, floatBits, neutralDraft } from '../src/character/schema.js';
import { validateDraft } from '../src/character/validate.js';
import type { CharacterCatalog } from '../src/character/catalog.js';

export const catalog:CharacterCatalog={version:1,name_limit:24,max_traits:4,max_household:6,self_preservation_bands:creationInstinctBands,
  traits:[{id:'private',label:'Private person',description:'Prefers privacy.',kind:'disposition',initial_state:floatBits(0),weights:[]},
    {id:'isolated',label:'Isolated',description:'Affects satisfaction.',kind:'condition',initial_state:floatBits(.5),weights:[]}],
  affinities:[{id:'plants',label:'Plants',description:'Reaction to nearby plants.'}],
  skills:[{id:'reading',label:'Reading',description:'Reading practice.',thresholds:[floatBits(0),floatBits(.1),floatBits(.3)]}],
  hobbies:[{id:'reading',label:'Reading'}],activities:[{object:'armchair',action:'read',label:'Read in an armchair',tags:['reading']}],personalities:[]};

it('covers appearance through one atomic hairstyle control and keeps behavior separate',()=>{
  const fields=characterFields(catalog,[{sim_id:3,name:'Mira'}]);
  expect(new Set(fields.map(f=>f.id)).size).toBe(fields.length);
  const paths:string[]=[];
  const appearance=defaultAppearance();
  for(const [key,value] of Object.entries(appearance)){
    if(key==='version'||key==='bald')continue;
    if(value&&typeof value==='object'&&!Array.isArray(value))for(const sub of Object.keys(value))paths.push(`appearance.${key}.${sub}`);
    else paths.push(`appearance.${key}`);
  }
  expect(fields.filter(f=>f.section==='appearance').map(f=>f.id).sort()).toEqual(paths.sort());
  expect(fields.find(field=>field.id==='appearance.hairstyle')?.choices?.map(choice=>choice.value)).toContain('bald');
  const draft=neutralDraft('Mira'),before=structuredClone(draft.behavior);
  fields.find(f=>f.id==='appearance.body.height')!.set(draft,83);
  expect(draft.appearance.body.height).toBe(83);expect(draft.behavior).toEqual(before);
});

it('preserves loaded out-of-editor-range values but rejects new invalid choices',()=>{
  const draft=neutralDraft('Mira');draft.affinities=[{id:'plants',value:floatBits(.35)}];
  draft.behavior.drain[0]=floatBits(.1234567);
  expect(()=>validateDraft(draft,catalog)).toThrow('drain');
  const changed=structuredClone(draft);changed.name='Casey';
  expect(()=>validateDraft(changed,catalog,draft)).not.toThrow();
  changed.behavior.drain[0]=floatBits(.2345678);expect(()=>validateDraft(changed,catalog,draft)).toThrow('drain');
  changed.behavior.drain[0]=floatBits(1);changed.traits=[{id:'missing',state:floatBits(0)}];
  expect(()=>validateDraft(changed,catalog,draft)).toThrow('Unknown trait');
});
