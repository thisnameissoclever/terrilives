import { expect, it } from 'vitest';
import { defaultAppearance, validateAppearance, floatBits, floatValue, neutralDraft, validateDraftStructure, makePatch } from '../src/character/schema.js';

it('validates actual named appearance fields and rejects unknown keys and assets',()=>{
  for(const value of [0,50,100]) {
    const a=defaultAppearance('feminine');a.body.height=value;a.body.build=value;
    expect(()=>validateAppearance(a)).not.toThrow();
  }
  const a=defaultAppearance('masculine');
  expect(()=>validateAppearance({...a,hairstyle:'unbuilt'})).toThrow('hairstyle');
  expect(()=>validateAppearance({...a,body:{...a.body,height:101}})).toThrow('height');
  expect(()=>validateAppearance({...a,invented:true})).toThrow('invented');
  expect(()=>validateAppearance({...a,colors:{...a.colors,skin:[1,2,NaN]}})).toThrow('skin');
});

it('preserves exact f32 values through drafts, including negative zero',()=>{
  for(const value of [-0,0.1234567,.5,1,1.5])expect(Object.is(floatValue(floatBits(value)),Math.fround(value))).toBe(true);
  for(const value of [NaN,Infinity,-Infinity,1e100])expect(()=>floatBits(value)).toThrow();
  const draft=neutralDraft('Mira');draft.behavior.drain[0]=floatBits(.1234567);
  draft.skills=[{id:'reading',practice:floatBits(.3172346)}];
  expect(()=>validateDraftStructure(draft)).not.toThrow();
  const changed=structuredClone(draft);changed.name='New name';
  expect(makePatch(draft,changed)).toEqual({version:1,name:'New name'});
  expect(changed.behavior.drain[0]).toBe(draft.behavior.drain[0]);
});

it('rejects malformed behavior and duplicate routes without mutating input',()=>{
  const draft=neutralDraft('Mira');
  const bad={...draft,behavior:{...draft.behavior,shyness:0}};
  const before=JSON.stringify(bad);expect(()=>validateDraftStructure(bad)).toThrow('shyness');
  expect(JSON.stringify(bad)).toBe(before);
  draft.behavior.recovery[3]=floatBits(0);
  expect(()=>validateDraftStructure(draft)).toThrow('recovery');
  draft.behavior.recovery[3]=floatBits(1);
  const route={object:'armchair',action:'read',weight:floatBits(1)};
  draft.behavior.dispositions=[route,route];
  expect(()=>validateDraftStructure(draft)).toThrow('dispositions');
});
