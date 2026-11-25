import {expect,it} from 'vitest';
import {characterActionPlan,type CharacterActionState} from '../src/render/character/action-plan.js';
import {IN_GROUND_POOL_MODEL,LODGE_POOL_MODEL,poolSwimPlacement} from '../src/render/character/pool-world-layout.js';
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

it('gives each shared swimmer a stable berth and uses the authored ladder at both ends',()=>{
  function swim(fixtureModel:string,slot:number,values:Partial<CharacterActionState>={}) {
    return characterActionPlan({...base,fixtureModel,action:23,activity:27,poolSlot:slot,prevPoolSlot:slot,
      poolPhase:2,poolElapsed:12,poolAlpha:1,...values},clip=>clip==='pool_paddle'?12:41)!;
  }
  for(const [model,capacity] of [['pool_above_ground_3x4',2],['pool_in_ground_5x7',4]] as const){
    const berths=Array.from({length:capacity},(_,slot)=>swim(model,slot).poolPlacement);
    expect(berths.every(placement=>placement&&placement.yaw!==0)).toBe(true);
    expect(new Set(berths.map(berth=>JSON.stringify(berth))).size).toBe(capacity);
    for(let slot=0;slot<capacity;slot++){
      const berth=berths[slot];
      expect(swim(model,slot,{poolElapsed:0}).poolPlacement).toBeUndefined();
      expect(swim(model,slot,{poolPhase:6,poolElapsed:2,poolExitOrigin:4}).poolPlacement).toEqual(berth);
      expect(swim(model,slot,{poolPhase:7,poolElapsed:0,poolExitOrigin:19}).poolPlacement).toEqual(berth);
      expect(swim(model,slot,{poolPhase:7,poolElapsed:0,poolExitOrigin:6,prevPoolPhase:6,prevPoolElapsed:1,
        prevPoolExitOrigin:4,poolAlpha:0}).poolPlacement).toEqual(swim(model,slot,{poolElapsed:5}).poolPlacement);
      expect(swim(model,slot,{poolPhase:7,poolElapsed:4,poolExitOrigin:19}).poolPlacement).not.toEqual(berth);
      expect(swim(model,slot,{poolPhase:7,poolElapsed:0,poolExitOrigin:0,poolAlpha:.5,prevPoolPhase:6,
        prevPoolElapsed:11,prevPoolExitOrigin:60})).toMatchObject({clip:'pool_paddle',sample:11.5,poolPlacement:berth});
      expect(swim(model,slot,{poolPhase:3,poolElapsed:0,poolExitOrigin:3,prevPoolPhase:7,prevPoolElapsed:7,
        prevPoolExitOrigin:7})).toEqual({clip:'pool_exit_3',sample:0,fixture:true});
    }
  }
  expect(swim('pool_above_ground_3x4',0xffffffff)).toEqual({clip:'pool_paddle',sample:0,fixture:true});
});

it('continues the stroke and stays at the berth when the ladder wait clock wraps',()=>{
  const at=(poolAlpha:number)=>characterActionPlan({...base,fixtureModel:'pool_in_ground_5x7',action:23,activity:27,
    poolSlot:3,prevPoolSlot:3,poolPhase:6,prevPoolPhase:6,poolElapsed:6,prevPoolElapsed:17,
    poolExitOrigin:100,prevPoolExitOrigin:100,poolAlpha},()=>12)!;
  const before=at(0),between=at(.5),after=at(1);
  expect([before.sample,between.sample,after.sample]).toEqual([9,9.5,10]);
  expect(before.poolPlacement).toBeDefined();
  expect(between.poolPlacement).toEqual(before.poolPlacement);
  expect(after.poolPlacement).toEqual(before.poolPlacement);
});

it('faces shared swimmers into open water between occupied berths',()=>{
  const pools=[
    [LODGE_POOL_MODEL,[.123,-.391],2],
    [IN_GROUND_POOL_MODEL,[.623,1.929],4],
  ] as const;
  for(const [model,[mouthX,mouthY],capacity] of pools){
    const swimmers=Array.from({length:capacity},(_,slot)=>{
      const {yaw,offset}=poolSwimPlacement(model,slot,1)!;
      const c=Math.cos(yaw),s=Math.sin(yaw);
      return {x:offset[0]+c*mouthX-s*mouthY,y:offset[1]+s*mouthX+c*mouthY,forwardX:s,forwardY:-c};
    });
    for(const [slot,swimmer] of swimmers.entries())for(const [otherSlot,other] of swimmers.entries()){
      if(slot===otherSlot)continue;
      const dx=other.x-swimmer.x,dy=other.y-swimmer.y;
      const alignment=(dx*swimmer.forwardX+dy*swimmer.forwardY)/Math.hypot(dx,dy);
      expect.soft(alignment,`${model} berth ${slot} facing berth ${otherSlot}`).toBeLessThan(.92);
      expect.soft(swimmer.forwardX*other.forwardX+swimmer.forwardY*other.forwardY,
        `${model} berths ${slot} and ${otherSlot} facing the same way`).toBeLessThan(.87);
    }
  }
});

it('uses a dedicated recline on the Sunstrip and retains ordinary sofa and chair selection',()=>{
  expect(plan({action:8,fixtureModel:'pool_lounger'})).toMatchObject({clip:'lounger_recline',fixture:true});
  expect(plan({action:8,fixtureModel:'chair'})).toMatchObject({clip:'seat_dining_sit',fixture:true});
  expect(plan({action:5,fixtureModel:'pool_lounger'})).toMatchObject({clip:'walk',fixture:false});
});

it('takes the west Lodge swimmer around the submerged tread',()=>{
  // This tall, wide swimmer's outer calf entered tread 2 on a direct west turn.
  const [calfX,calfY,calfZ]=[.402865,-.062326,.487523];
  function reachesTread(yaw:number,offset:readonly [number,number,number]):boolean {
    const c=Math.cos(yaw),s=Math.sin(yaw);
    const x=c*calfX-s*calfY+offset[0],y=s*calfX+c*calfY+offset[1];
    return x>-.84&&x<-.16&&y>-.40&&y<-.22&&calfZ>.475&&calfZ<.50;
  }
  expect(reachesTread(Math.PI/2,[-.381741,-.783,0])).toBe(true);
  for(let sample=1;sample<=120;sample++){
    const {yaw,offset}=poolSwimPlacement(LODGE_POOL_MODEL,0,sample/120)!;
    expect(reachesTread(yaw,offset)).toBe(false);
  }
});
