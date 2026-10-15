import { expect, it } from 'vitest';
import { CharacterDraft } from '../src/character/draft.js';
import { characterNames, nameGroups } from '../src/character/names.js';
import { defaultAppearance, floatBits, neutralDraft } from '../src/character/schema.js';
import type { CharacterCatalog } from '../src/character/catalog.js';

const catalog:CharacterCatalog={version:1,name_limit:24,max_traits:4,max_household:6,
  traits:Array.from({length:6},(_,i)=>({id:`trait${i}`,label:`Trait ${i}`,description:'',kind:i===0?'condition' as const:'disposition' as const,initial_state:floatBits(i===0?.5:0),weights:[]})),
  affinities:[{id:'plants',label:'Plants',description:''}],skills:[{id:'reading',label:'Reading',description:'',thresholds:[floatBits(0),floatBits(.1),floatBits(.3)]}],
  hobbies:[{id:'reading',label:'Reading'}],activities:[{object:'chair',action:'read',label:'Read',tags:['reading']}],personalities:[]};
const household=[{sim_id:7,name:'Mira'}];

it('uses the exact 40/40/20 pool with no duplicate names',()=>{
  expect(Object.values(nameGroups).map(group=>group.length)).toEqual([40,40,20]);
  expect(new Set(characterNames).size).toBe(100);
});
it('randomizes complete new drafts reproducibly and edits without consuming a draw',()=>{
  const a=CharacterDraft.create(123,catalog,household),b=CharacterDraft.create(123,catalog,household);
  expect(a.resolve()).toEqual(b.resolve());expect(a.randomState).toBe(b.randomState);
  expect(a.resolve().skills).toHaveLength(1);expect(a.resolve().affinities).toHaveLength(1);expect(a.resolve().ties).toHaveLength(1);
  const source=neutralDraft('Custom');source.affinities=[{id:'plants',value:floatBits(.1234567)}];source.behavior.drain[0]=floatBits(.23456789);
  const edit=CharacterDraft.edit(source,123,catalog,household);
  expect(edit.resolve()).toEqual(source);expect(edit.randomState).toBe(123);expect(edit.patch()).toEqual({version:1});
  edit.set('name','Changed');expect(edit.patch()).toEqual({version:1,name:'Changed'});expect(source.name).toBe('Custom');
});
it('protects locks, preserves a locked condition severity and restores random state on undo',()=>{
  const draft=CharacterDraft.create(77,catalog,household);
  draft.set(JSON.stringify(['trait','trait0']),true);
  draft.set(JSON.stringify(['severity','trait0']),floatBits(.73));
  draft.lock(JSON.stringify(['severity','trait0']),true);draft.lock('appearance.body.height',true);
  const before=draft.resolve(),state=draft.randomState;
  draft.randomize('all');const changed=draft.resolve();
  expect(changed.appearance.body.height).toBe(before.appearance.body.height);
  expect(changed.traits.find(t=>t.id==='trait0')?.state).toBe(floatBits(.73));
  draft.undo();expect(draft.resolve()).toEqual(before);expect(draft.randomState).toBe(state);
  draft.randomize('all');expect(draft.resolve()).toEqual(changed);
});
it('rejects invalid edits atomically and undo restores the original draft',()=>{
  const draft=CharacterDraft.create(91,catalog,household),initial=draft.resolve();
  draft.set('name','Changed');expect(()=>draft.set('appearance.body.height',200)).toThrow();
  draft.undo();expect(draft.resolve()).toEqual(initial);
  draft.randomize('appearance');draft.undo();expect(draft.resolve()).toEqual(initial);
});

it('presets are explicit, preserve unrelated fields and have one-step undo',()=>{
  const values={cleanliness:floatBits(.7),chronotype_offset_ticks:60,drain:Array(7).fill(floatBits(.8)),recovery:Array(7).fill(floatBits(1.2)),dispositions:[]};
  const withPreset={...catalog,personalities:[{id:'quiet',label:'Quiet',description:'',values}]};
  const draft=CharacterDraft.create(153,withPreset,household),before=draft.resolve();
  draft.applyPersonalityPreset('quiet');const changed=draft.resolve();
  expect(draft.personalityPreset).toBe('quiet');expect(changed.appearance).toEqual(before.appearance);
  expect(changed.behavior.shyness).toBe(before.behavior.shyness);expect(changed.traits).toEqual(before.traits);
  draft.undo();expect(draft.resolve()).toEqual(before);
  draft.set('appearance.presentation','feminine');draft.resetAppearanceToPreset();
  expect(draft.resolve().appearance.hairstyle).toBe('bob');
  expect(draft.resolve().behavior).toEqual(before.behavior);
});

it('section undo preserves sparse loaded records exactly and every pool is reachable',()=>{
  const source=neutralDraft('Custom');source.affinities=[{id:'plants',value:floatBits(0)}];
  const draft=CharacterDraft.edit(source,7,catalog,household);
  draft.randomize('personality');draft.undo();expect(draft.resolve()).toEqual(source);
  const presentations=new Set(),counts=new Set(),names=new Set();
  for(let seed=0;seed<1000;seed++){
    const value=CharacterDraft.create(seed,catalog,household).resolve();
    presentations.add(value.appearance.presentation);counts.add(value.traits.length);names.add(value.name);
  }
  expect([...presentations].sort()).toEqual(['feminine','masculine']);
  expect([...counts].sort()).toEqual([1,2,3,4]);expect(names.size).toBe(100);
});

it('keeps retired hobbies and existing selections above a reduced trait cap',()=>{
  const original=neutralDraft('Legacy');original.affinities=[{id:'plants',value:floatBits(0)}];original.hobbies=['retired_tag'];
  original.traits=[{id:'trait0',state:floatBits(.7)},{id:'trait1',state:floatBits(0)}];
  const draft=CharacterDraft.edit(original,1,{...catalog,max_traits:1},household);
  draft.set('name','Renamed');expect(draft.resolve().hobbies).toEqual(['retired_tag']);expect(draft.resolve().traits).toEqual(original.traits);
  expect(()=>draft.set(JSON.stringify(['trait','trait2']),true)).toThrow();
});

it('applies authored values outside ordinary sliders and includes them in randomization',()=>{
  const values={cleanliness:floatBits(.7),chronotype_offset_ticks:210,drain:Array(7).fill(floatBits(.4)),recovery:Array(7).fill(floatBits(1.7)),
    dispositions:[{object:'chair',action:'read',weight:floatBits(2.5)}]};
  const extended={...catalog,personalities:[{id:'custom',label:'Custom content',description:'',values}]};
  const draft=CharacterDraft.create(5,extended,household);draft.applyPersonalityPreset('custom');
  expect(draft.resolve().behavior.drain[0]).toBe(floatBits(.4));expect(draft.personalityPreset).toBe('custom');
  expect(draft.fields.find(field=>field.id==='behavior.drain.0')!.extraValues).toContain(floatBits(.4));
  expect(draft.fields.find(field=>field.id==='behavior.chronotype_offset_ticks')!.extraValues).toContain(210);
  expect(()=>draft.set('behavior.drain.0',floatBits(.3))).toThrow();
});

it('randomizes unrelated fields with locked legacy traits above the current cap',()=>{
  const original=neutralDraft('Legacy');original.affinities=[{id:'plants',value:floatBits(0)}];
  original.traits=[{id:'trait0',state:floatBits(.7)},{id:'trait1',state:floatBits(0)}];
  const draft=CharacterDraft.edit(original,1,{...catalog,max_traits:1},[]);
  for(const trait of original.traits)draft.lock(JSON.stringify(['trait',trait.id]),true);
  draft.lock(JSON.stringify(['severity','trait0']),true);
  draft.randomize('all');expect(draft.resolve().traits).toEqual(original.traits);
  expect(draft.resolve().appearance).not.toEqual(original.appearance);
  const before=draft.resolve(),state=draft.randomState;
  draft.randomize('household');expect(draft.resolve()).toEqual(before);expect(draft.randomState).toBe(state);
});

it('resets new characters to fixed defaults without rewinding randomization or honoring random locks',()=>{
  const draft=CharacterDraft.create(91,catalog,household);
  draft.randomize('all');draft.lock('name',true);draft.lock('appearance.presentation',true);
  const before=draft.resolve(),state=draft.randomState,locks=draft.locks;
  draft.reset();
  expect(draft.resolve()).toEqual({...neutralDraft('New housemate'),
    affinities:[{id:'plants',value:floatBits(0)}],skills:[{id:'reading',practice:floatBits(0)}],ties:[[7,null]]});
  expect(draft.randomState).toBe(state);expect(draft.locks).toEqual(locks);
  expect(draft.patch().name).toBe('New housemate');
  draft.undo();expect(draft.resolve()).toEqual(before);expect(draft.randomState).toBe(state);expect(draft.locks).toEqual(locks);
});

it('resets a saved person to exposed defaults and keeps hidden records and the original patch baseline',()=>{
  const definitions={...catalog,activities:[...catalog.activities,{object:'bookshelf',action:'read',label:'Read',tags:['reading']},
    {object:'kitchen_sink',action:'clean_dishes',label:'Clean dishes',tags:[]}]};
  const source=CharacterDraft.create(91,definitions,household).value;
  source.name='Saved person';source.pronouns='legacy pronouns';source.appearance.presentation='feminine';
  source.appearance.freckles=false;source.appearance.freckle_density=95;
  source.behavior.dispositions.push({object:'kitchen_sink',action:'clean_dishes',weight:floatBits(.123456789)});
  source.hobbies=['reading','retired_hobby'];source.skills=[{id:'reading',practice:floatBits(.23456789)}];source.ties=[[7,0]];
  const draft=CharacterDraft.edit(source,123,definitions,household),state=draft.randomState;
  expect(draft.resolve()).toEqual(source);expect(draft.patch()).toEqual({version:1});
  draft.reset('all');
  expect(draft.resolve()).toEqual({...neutralDraft('New housemate'),pronouns:source.pronouns,
    behavior:{...neutralDraft('Default').behavior,dispositions:[source.behavior.dispositions.at(-1)!]},
    hobbies:['retired_hobby'],affinities:[{id:'plants',value:floatBits(0)}],skills:[{id:'reading',practice:floatBits(0)}],ties:[[7,null]]});
  expect(draft.patch()).toMatchObject({name:'New housemate',ties:[[7,null]],traits:[],hobbies:['retired_hobby']});
  expect(draft.patch()).not.toHaveProperty('pronouns');expect(draft.randomState).toBe(state);
  draft.undo();expect(draft.resolve()).toEqual(source);expect(draft.patch()).toEqual({version:1});
});

it('resets one field or page without altering another page and clears saved ties explicitly',()=>{
  const source=CharacterDraft.create(19,catalog,household).value;
  source.ties=[[7,0]];source.appearance.presentation='feminine';source.appearance.hairstyle='quiff';source.appearance.bald=true;
  const draft=CharacterDraft.edit(source,9,catalog,household);
  draft.reset('appearance.hairstyle');
  expect(draft.value.appearance).toEqual({...source.appearance,hairstyle:'curl',bald:false});
  expect(draft.value.name).toBe(source.name);draft.undo();expect(draft.value).toEqual(source);
  draft.reset('appearance');expect(draft.value).toEqual({...source,appearance:defaultAppearance()});
  draft.undo();draft.reset('household');expect(draft.value).toEqual({...source,ties:[[7,null]]});
  expect(draft.patch()).toEqual({version:1,ties:[[7,null]]});draft.undo();
  draft.reset(JSON.stringify(['tie',7]));expect(draft.patch()).toEqual({version:1,ties:[[7,null]]});draft.undo();
  draft.reset('identity');expect(draft.value).toEqual({...source,name:'New housemate'});
});

it('resets selected condition severity to its definition and clears traits without touching temperament',()=>{
  const source=neutralDraft('Test');source.affinities=[{id:'plants',value:floatBits(0)}];
  source.behavior.shyness=91;source.traits=[{id:'trait0',state:floatBits(.93)},{id:'trait1',state:floatBits(0)}];
  const draft=CharacterDraft.edit(source,19,catalog,[]);
  draft.lock(JSON.stringify(['severity','trait0']),true);draft.reset(JSON.stringify(['severity','trait0']));
  expect(draft.value.traits[0].state).toBe(floatBits(.5));draft.undo();expect(draft.value).toEqual(source);
  draft.reset('traits');expect(draft.value).toEqual({...source,traits:[]});draft.undo();expect(draft.value).toEqual(source);
  draft.reset('personality');expect(draft.value.behavior.shyness).toBe(50);expect(draft.value.traits).toEqual([]);
});

it('rolls back a rejected Reset atomically and preserves the preceding Undo checkpoint',()=>{
  const source=neutralDraft('Existing name');source.affinities=[{id:'plants',value:floatBits(0)}];
  const draft=CharacterDraft.edit(source,37,{...catalog,name_limit:3},household);
  draft.set('behavior.shyness',91);draft.lock('name',true);
  const before=draft.value,state=draft.randomState,locks=draft.locks;
  expect(()=>draft.reset()).toThrow('Name must fit within 3 characters.');
  expect(draft.value).toEqual(before);expect(draft.randomState).toBe(state);expect(draft.locks).toEqual(locks);
  draft.undo();expect(draft.value).toEqual(source);
});

it('restores exact retained condition states and trait order after unsubmitted toggles',()=>{
  const source=neutralDraft('Existing');source.affinities=[{id:'plants',value:floatBits(0)}];
  source.traits=[{id:'trait1',state:floatBits(0)},{id:'trait0',state:floatBits(.73123455)},{id:'trait2',state:floatBits(0)}];
  const draft=CharacterDraft.edit(source,23,catalog,household),state=draft.randomState;
  draft.set(JSON.stringify(['trait','trait0']),false);
  draft.set(JSON.stringify(['trait','trait1']),false);
  draft.set(JSON.stringify(['trait','trait0']),true);
  draft.set(JSON.stringify(['trait','trait1']),true);
  expect(draft.resolve()).toEqual(source);expect(draft.patch()).toEqual({version:1});
  expect(draft.randomState).toBe(state);
});

it('retains the most recent explicitly edited severity when its condition is toggled',()=>{
  const source=neutralDraft('Existing');source.affinities=[{id:'plants',value:floatBits(0)}];
  source.traits=[{id:'trait0',state:floatBits(.73)}];
  const draft=CharacterDraft.edit(source,23,catalog,household),severity=floatBits(.81234567);
  draft.set(JSON.stringify(['severity','trait0']),severity);
  draft.set(JSON.stringify(['trait','trait0']),false);draft.set(JSON.stringify(['trait','trait0']),true);
  expect(draft.resolve().traits).toEqual([{id:'trait0',state:severity}]);
});

it('includes retained trait states in Undo and rejected transaction restoration',()=>{
  const source=neutralDraft('Existing');source.affinities=[{id:'plants',value:floatBits(0)}];
  source.traits=[{id:'trait0',state:floatBits(.73123455)}];
  const draft=CharacterDraft.edit(source,23,catalog,household),state=draft.randomState;
  draft.lock(JSON.stringify(['severity','trait0']),true);
  draft.set(JSON.stringify(['trait','trait0']),false);
  const absent=draft.value,locks=draft.locks;
  draft.set(JSON.stringify(['trait','trait0']),true);draft.undo();expect(draft.value).toEqual(absent);
  expect(()=>draft.set('appearance.body.height',101)).toThrow();
  draft.set(JSON.stringify(['trait','trait0']),true);
  expect(draft.value).toEqual(source);expect(draft.randomState).toBe(state);expect(draft.locks).toEqual(locks);
});

it('undoes Reset and trait randomization without leaking later retained severity',()=>{
  const source=neutralDraft('Existing');source.affinities=[{id:'plants',value:floatBits(0)}];
  source.traits=[{id:'trait0',state:floatBits(.73123455)}];
  const draft=CharacterDraft.edit(source,23,catalog,household),state=draft.randomState;
  draft.reset('traits');draft.undo();expect(draft.value).toEqual(source);
  draft.randomize('traits');const randomized=draft.value,randomizedState=draft.randomState;
  draft.undo();expect(draft.value).toEqual(source);expect(draft.randomState).toBe(state);
  draft.set(JSON.stringify(['trait','trait0']),false);draft.set(JSON.stringify(['trait','trait0']),true);
  expect(draft.value).toEqual(source);
  draft.randomize('traits');expect(draft.value).toEqual(randomized);expect(draft.randomState).toBe(randomizedState);
});

it('retains condition severity through per-trait random toggles',()=>{
  const source=neutralDraft('Existing');source.affinities=[{id:'plants',value:floatBits(0)}];
  source.traits=[{id:'trait0',state:floatBits(.73123455)}];
  const draft=CharacterDraft.edit(source,23,catalog,household),id=JSON.stringify(['trait','trait0']);
  let removed=false,reselected=false;
  for(let attempt=0;attempt<32;attempt++){
    draft.randomize(id);
    if(!draft.value.traits.length)removed=true;
    else if(removed){reselected=true;expect(draft.value.traits).toEqual(source.traits);break;}
  }
  expect(removed).toBe(true);expect(reselected).toBe(true);
});

it('forgets removed condition severity when a new edit starts after applying removal',()=>{
  const source=neutralDraft('Existing');source.affinities=[{id:'plants',value:floatBits(0)}];
  source.traits=[{id:'trait0',state:floatBits(.73123455)}];
  const draft=CharacterDraft.edit(source,23,catalog,household);
  draft.set(JSON.stringify(['trait','trait0']),false);expect(draft.patch()).toEqual({version:1,traits:[]});
  const later=CharacterDraft.edit(draft.resolve(),23,catalog,household);
  later.set(JSON.stringify(['trait','trait0']),true);
  expect(later.resolve().traits).toEqual([{id:'trait0',state:floatBits(.5)}]);
});

it('clears retained trait states only in the explicit Reset scope and restores them on Undo',()=>{
  const source=neutralDraft('Existing');source.affinities=[{id:'plants',value:floatBits(0)}];
  source.traits=[{id:'trait0',state:floatBits(.73123455)}];
  const draft=CharacterDraft.edit(source,23,catalog,household),id=JSON.stringify(['trait','trait0']);
  draft.set(id,false);draft.reset('needs');draft.set(id,true);expect(draft.value.traits).toEqual(source.traits);
  draft.set(id,false);draft.reset('traits');draft.undo();draft.set(id,true);expect(draft.value.traits).toEqual(source.traits);
  draft.set(id,false);draft.reset(id);draft.set(id,true);
  expect(draft.value.traits).toEqual([{id:'trait0',state:floatBits(.5)}]);
});

it('restores retained state after undoing a severity edit or rejecting a whole-character Reset',()=>{
  const source=neutralDraft('Existing name');source.affinities=[{id:'plants',value:floatBits(0)}];
  source.traits=[{id:'trait0',state:floatBits(.73123455)}];
  const draft=CharacterDraft.edit(source,23,{...catalog,name_limit:3},household),id=JSON.stringify(['trait','trait0']);
  draft.set(JSON.stringify(['severity','trait0']),floatBits(.91));draft.undo();
  draft.set(id,false);expect(()=>draft.reset()).toThrow('Name must fit within 3 characters.');
  draft.set(id,true);expect(draft.value).toEqual(source);expect(draft.patch()).toEqual({version:1});
});
