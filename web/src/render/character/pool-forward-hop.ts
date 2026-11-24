import {add,sub,scale,length,type Vec3} from './math.js';
import {poolIntervalPreference} from './pool-contact-sample.js';
import {translatePoolRoot} from './pool-canonical-pose.js';
import {makePoolPoseProgram,type PoolPoseProgram} from './pool-pose-program.js';
import {poolSourcePolicy} from './pool-source-policy.js';
import type {PoolCycleSource} from './pool-cycle-source.js';
import {configuredPoolChainReach} from './pool-entry-domain.js';

const launch=60000,wet=75000,clock=100000;
const smooth=(t:number)=>{const u=Math.max(0,Math.min(1,t));return u*u*(3-2*u);};
const point=(m:readonly number[]):Vec3=>[m[12],m[13],m[14]];

/** Keep the loaded sole on the crest up to takeoff, then carry the body into open water. */
export function prepareForwardPoolHop(source:PoolCycleSource,start:PoolPoseProgram) {
 const {bundle,neutral}=source;
 const original=poolIntervalPreference(bundle,neutral.rest,neutral.inverse,start.preferenceBasis,start.preferenceBasis,0,true);
 const pelvis=bundle.bones.findIndex(b=>b.name==='hips'),hip=point(original.world[pelvis]);
 const foot=start.controls[1],socket=point(original.world[foot.upper]),v=sub(socket,foot.state.target);
 const reach=configuredPoolChainReach(neutral.rest,foot.upper,foot.lower,foot.end).maximum;
 const height=Math.sqrt(Math.max(0,reach*reach-v[0]*v[0]-v[1]*v[1]));
 const push=Math.max(0,Math.min(.065,(height-v[2])*.55));
 const travelSeconds=source.definition.nativeTicks.enter/source.definition.nativeTicks.tickHz;
 const flightSeconds=(wet-launch)/clock*travelSeconds;
 const crest=source.foot('footR','crest'),water=source.fixture.waterHeight;
 const gravity=9.81,up=(water-crest.plane+.5*gravity*flightSeconds**2)/flightSeconds;
 const forward=-(crest.target[1]-source.definition.waterCorridor.initialCentre[1])/flightSeconds;
 const neutralHands=start.controls.slice(2).map(c=>{
  const joint=point(original.world[c.upper]),line=sub(c.state.target,joint);
  const desired:Vec3=[hip[0]+(joint[0]-hip[0])*.65,joint[1]-.10,joint[2]-.22];
  return length(line)>0?desired:c.state.target;
 });
 const waterProgram=source.paddle(0);
 function airborne(unit:number):PoolPoseProgram {
  const phase=unit/clock,policy=poolSourcePolicy(source.fixture,'pool_enter',phase);
  const t=Math.max(0,(unit-launch)/clock*travelSeconds),load=smooth((unit-53000)/(launch-53000));
  const displacement:Vec3=[0,forward*t,push*load+up*t-.5*gravity*t*t];
  const pose=poolIntervalPreference(bundle,neutral.rest,neutral.inverse,start.preferenceBasis,start.preferenceBasis,0,true);
  translatePoolRoot(pose,displacement);
  const controls=start.controls.map((c,i)=>{
   const limb=(['footL','footR','handL','handR'] as const)[i],s=c.state;
   if(i<2){
    const delta=i===1?[0,forward*t,up*t-.5*gravity*t*t] as Vec3:displacement;
    return {...c,state:{...s,target:add(s.target,delta),pole:add(s.pole,displacement)}};
   }
   const attached=s.attached;
   if(!attached)throw new Error('Forward pool launch has no starting palm on its physical rail.');
   if(policy[limb].required)return {...c,state:{...s,attached:{...attached,source:{...attached.source,phase}}}};
   const left=i===2,amount=smooth((unit-(left?50668:53000))/((left?55000:59000)-(left?50668:53000)));
   return {...c,state:{target:add(add(s.target,scale(sub(neutralHands[i-2],s.target),amount)),displacement),
                       orientation:s.orientation,pole:add(s.pole,displacement)}};
  });
  return makePoolPoseProgram(pose.basis,controls,policy);
 }
 const impact=airborne(wet);
 return (unit:number):PoolPoseProgram=>{
  if(!Number.isSafeInteger(unit)||unit<50668||unit>clock)throw new Error('Forward hop unit is outside the launch and landing.');
  if(unit===50668)return start;
  if(unit<=wet)return airborne(unit);
  if(unit===clock)return waterProgram;
  return source.freeWaterKnot(impact,waterProgram,smooth((unit-wet)/(clock-wet)),'pool_enter',unit/clock);
 };
}
