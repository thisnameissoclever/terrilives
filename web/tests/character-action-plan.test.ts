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

it('interpolates native pool endpoints through paused cancellation instead of predicting a future pose',()=>{
  const at=(extra:Record<string,number|boolean>)=>characterActionPlan({...base,action:23,activity:27,
    poolPhase:2,poolElapsed:17,poolExitOrigin:0,prevPoolPhase:2,prevPoolElapsed:16,
    prevPoolExitOrigin:0,poolAlpha:.5,tick:45.5,...extra},clip=>clip==='pool_paddle'?12:41);
  expect(at({})).toEqual({clip:'pool_paddle',sample:4.5,fixture:true});
  expect(at({poolPhase:3,poolElapsed:0,poolExitOrigin:17})).toEqual(at({}));
  expect(at({poolPhase:3,poolElapsed:1,poolExitOrigin:17,prevPoolElapsed:17})).toEqual({clip:'pool_exit_5',sample:1,fixture:true});
  expect(at({poolPhase:2,poolElapsed:0,prevPoolPhase:1,prevPoolElapsed:19})).toEqual({clip:'pool_enter',sample:39,fixture:true});
  expect(at({poolPhase:3,poolElapsed:0,poolExitOrigin:0,prevPoolPhase:1,prevPoolElapsed:19})).toEqual({clip:'pool_enter',sample:39,fixture:true});
  expect(at({poolPhase:3,poolElapsed:0,poolExitOrigin:0,prevPoolPhase:1,prevPoolElapsed:19,poolAlpha:1})).toEqual({clip:'pool_exit_0',sample:0,fixture:true});
  expect(at({poolExitTicks:40,poolPhase:3,poolElapsed:20,poolExitOrigin:5,prevPoolPhase:3,prevPoolElapsed:19})).toEqual({clip:'pool_exit_5',sample:19.5,fixture:true});
  expect(at({poolExitTicks:40,poolPhase:0,poolElapsed:0,prevPoolPhase:3,prevPoolElapsed:39,prevPoolExitOrigin:5})).toEqual({clip:'pool_exit_5',sample:39.5,fixture:true});
  expect(at({poolPhase:4,poolElapsed:7,prevPoolPhase:1,prevPoolElapsed:6})).toEqual({clip:'pool_enter',sample:13,fixture:true});
  expect(at({poolPhase:4,poolElapsed:6,prevPoolPhase:4,prevPoolElapsed:7})).toEqual({clip:'pool_enter',sample:13,fixture:true});
  expect(at({poolPhase:0,poolElapsed:0,prevPoolPhase:4,prevPoolElapsed:1})).toEqual({clip:'pool_enter',sample:1,fixture:true});
  expect(at({poolPhase:0,poolElapsed:0,prevPoolPhase:3,prevPoolElapsed:19,prevPoolExitOrigin:60})).toEqual({clip:'pool_exit_0',sample:39,fixture:true});
  expect(at({poolPhase:3,poolElapsed:0,poolExitOrigin:17,reducedMotion:true})).toEqual({clip:'pool_paddle',sample:0,fixture:true});
  expect(at({poolPhase:3,poolElapsed:1,poolExitOrigin:17,prevPoolElapsed:17,reducedMotion:true})).toEqual({clip:'pool_exit_0',sample:1,fixture:true});
  expect(at({prevPoolElapsed:17})).toEqual({clip:'pool_paddle',sample:5,fixture:true});
});
