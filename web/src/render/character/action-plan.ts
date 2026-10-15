import {distanceAnimationSample,tickAnimationSample} from '../sim-animation.js';

export interface CharacterActionState {
  action:number;activity:number;entity:number;facing:number;x:number;y:number;tick:number;reducedMotion:boolean;
  fixtureModel:string|null;wholeSeat:boolean;readingStage:number;carriedBook:boolean;carriedDishes:boolean;carriedDinner:boolean;
  shelfSlot:number;reachRemaining:number;reachTotal:number;progress:number;
  halfCycleTicks?:number;
}
export interface CharacterActionPlan {clip:string;sample:number;fixture:boolean;heldSlot?:number}
const seatKinds:Readonly<Record<string,string>>={armchair:'armchair',reading_chair:'reading',chair:'dining',desk_chair:'office',sofa:'ottoman',long_sofa:'sofa'};
const actions=['idle','talk','eat','read','stand_read','walk','exercise','watch_fish','sit','sleep','prepare','cook_v2','wash','seated_eat','mop','wipe_counter','wipe_table','empty_bin','toilet','bath','shower','prepare','idle'];
const halfCycles=[1,8,16,24,24,1,8,24,24,32,10,10,10,16,1,1,1,1,12,12,12,10,1];

/** Select source motion using the same ownership precedence as the static interaction resolver. */
export function characterActionPlan(state:CharacterActionState,frameCount:(clip:string)=>number):CharacterActionPlan|null {
  if(state.activity===6)return null;
  let clip=actions[state.action];if(!clip)throw new Error('No configured character action: '+state.action);
  let fixture=false,heldSlot:number|undefined;
  if(state.action===9&&state.fixtureModel){
    if(!['bed','double_bed'].includes(state.fixtureModel))throw new Error('No configured sleeping fixture: '+state.fixtureModel);
    clip=state.fixtureModel==='bed'?'bunk_sleep':'bed_sleep';fixture=true;
  }else if(state.wholeSeat&&state.activity===15){clip='sofa_recline';fixture=true;}
  else if(state.readingStage===6||state.readingStage===7){
    if(!Number.isInteger(state.shelfSlot)||state.shelfSlot<0||state.shelfSlot>=24)throw new Error('Invalid physical book slot.');
    clip=(state.readingStage===6?'fetch_':'shelve_')+state.shelfSlot;fixture=true;heldSlot=state.shelfSlot;
  }else if(state.fixtureModel&&seatKinds[state.fixtureModel]&&[3,8].includes(state.action)){
    clip='seat_'+seatKinds[state.fixtureModel]+(state.action===3?'_read':'_sit');fixture=true;
  }else if(state.readingStage===3&&state.action===4)clip='owned_stand_read';
  else if(state.carriedBook&&state.readingStage!==0&&state.readingStage!==3)clip=state.action===5?'book_walk':'book_idle';
  else if(state.action===22&&state.fixtureModel==='fridge'){clip='fridge';fixture=true;}
  else if([6,13,18,19,20].includes(state.action))fixture=true;
  else if([0,5].includes(state.action)&&state.carriedDinner)clip=state.action===5?'food_walk':'food_idle';
  else if([0,5].includes(state.action)&&state.carriedDishes)clip=state.action===5?'carry_walk':'carry_idle';
  const count=frameCount(clip);let sample=0;
  if(state.readingStage===6||state.readingStage===7){
    if(state.reachTotal<=0)throw new Error('Book reach has no total duration.');
    sample=state.reducedMotion?0:Math.min(count-1,Math.floor((state.reachTotal-state.reachRemaining)*count/state.reachTotal));
  }else if(clip==='fridge')sample=state.reducedMotion?0:Math.min(count-1,Math.floor(state.progress*count/1000));
  else if(state.action>=14&&state.action<=17){
    const progress=Math.max(0,Math.min(1000,state.progress));
    sample=state.reducedMotion?Math.floor(count/2):state.action===17?Math.min(count-1,progress*count/1000):((progress*(state.action===14?1:3))%1000)*count/1000;
  }else if(state.action===5)sample=distanceAnimationSample(state.x,state.y,state.facing,count,1,state.reducedMotion);
  else {
    const half=state.halfCycleTicks??halfCycles[state.action]??1,phase=state.action===1?(state.entity&1)*half:state.entity%half;
    sample=tickAnimationSample(state.tick,phase,count,2*half/count,state.reducedMotion);
  }
  return {clip,sample,fixture,heldSlot};
}
