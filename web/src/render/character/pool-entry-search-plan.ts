import type {Vec3} from './math.js';

export const POOL_ENTRY_NODE_ATTEMPTS=32;
/** Four explicit contact profiles crossed with eight genuine reach rays, without starvation. */
export function poolEntrySearchPlan(phase:number){
  const directions:Vec3[]=[[0,0,0],[0,1,-1],[0,0,-1],[0,1,0],[0,-1,0],[0,0,1],[1,0,0],[-1,0,0]];
  const postures=[phase,0,.5,1],fractions=[.75,.25,.5,.9],blends=[0,.5,1];
  return Array.from({length:POOL_ENTRY_NODE_ATTEMPTS},(_,id)=>{
    const profile=id%4,ray=Math.floor(id/4);
    return {id,profile,ray,direction:directions[ray],posture:postures[(profile+ray)%4],rayFraction:.25,
      footY:fractions[profile],yawL:profile===1||profile===3?-1:0,yawR:profile===2||profile===3?1:0,
      xL:profile===1?.1:profile===3?.05:null,xR:profile===2?.9:profile===3?.95:null,
      kneeL:(ray+profile)%2===0?0:.5,kneeR:(ray+2*profile)%3===0?0:.5,
      elbowL:blends[(ray+profile)%3],elbowR:blends[(ray+2*profile)%3],
      rollL:ray%2,rollR:profile%2,railL:(ray+profile)%4,railR:(ray+3*profile)%4};
  });
}
