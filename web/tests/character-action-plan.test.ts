import {expect,it} from 'vitest';
import {characterActionPlan,type CharacterActionState} from '../src/render/character/action-plan.js';
const base:CharacterActionState={action:0,activity:0,entity:7,facing:1,x:0,y:0,tick:30,reducedMotion:false,
  fixtureModel:null,wholeSeat:false,readingStage:0,carriedBook:false,carriedDishes:false,carriedDinner:false,
  shelfSlot:0,reachRemaining:10,reachTotal:40,progress:0};
const plan=(values:Partial<CharacterActionState>)=>characterActionPlan({...base,...values},()=>4);
it('preserves physical ownership precedence over generic actions',()=>{
  expect(plan({activity:6})).toBeNull();
  expect(plan({action:9,fixtureModel:'bed'})?.clip).toBe('bunk_sleep');
  expect(plan({action:9,fixtureModel:'double_bed'})?.clip).toBe('bed_sleep');
  expect(plan({wholeSeat:true,activity:15,fixtureModel:'long_sofa'})?.clip).toBe('sofa_recline');
  expect(plan({action:3,fixtureModel:'long_sofa'})?.clip).toBe('seat_sofa_read');
  expect(plan({action:5,readingStage:2,carriedBook:true,carriedDishes:true})?.clip).toBe('book_walk');
  expect(plan({action:5,carriedDinner:true,carriedDishes:true})?.clip).toBe('food_walk');
  expect(plan({action:5,carriedDishes:true})?.clip).toBe('carry_walk');
});
it('keeps source book phase aliases and progress separate from elapsed display time',()=>{
  expect(plan({readingStage:6,shelfSlot:23})).toEqual({clip:'fetch_23',fixture:true,heldSlot:23,sample:3});
  expect(plan({readingStage:7,shelfSlot:4,reachRemaining:30})?.sample).toBe(1);
  expect(plan({action:22,fixtureModel:'fridge',progress:1000})?.sample).toBe(3);
  expect(plan({action:22,fixtureModel:'fridge',progress:1000,reducedMotion:true})?.sample).toBe(0);
  expect(()=>plan({readingStage:6,shelfSlot:24})).toThrow();
});
