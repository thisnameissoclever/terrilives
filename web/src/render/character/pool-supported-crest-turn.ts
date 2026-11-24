import type {Bundle} from './bundle.js';
import {setPoolWorldRotation,translatePoolRoot,type PoolHierarchy} from './pool-canonical-pose.js';
import {resolvePoolLimbState,type PoolLimbState} from './pool-contact-evaluator.js';
import {poolIntervalPreference} from './pool-contact-sample.js';
import type {PoolFixtureV1} from './pool-contact-types.js';
import type {PoolEntryAnatomy} from './pool-entry-anatomy.js';
import {makePoolPoseProgram,poolIntervalProgramControls,type PoolPoseProgram} from './pool-pose-program.js';
import {poolSourcePolicy} from './pool-source-policy.js';
import {add,cross,multiply,sub,unit,type Vec3} from './math.js';

export interface SupportedCrestTurn {
  fromUnit:number;
  unit:number;
  toUnit:number;
  pelvisDegrees:number;
  trunkDegrees:number;
  handParameters:readonly [number,number];
}

interface TurnSource {
  bundle:Bundle;
  rest:number[][];
  inverse:number[][];
  fixture:PoolFixtureV1;
  anatomy:PoolEntryAnatomy;
  clockUnits:number;
  grip:(limb:'handL'|'handR',phase:number,pose:PoolHierarchy,parameter:number,raw:readonly number[],active:number)=>PoolLimbState;
}

const position=(m:readonly number[]):Vec3=>[m[12],m[13],m[14]];
const direction=(m:readonly number[],v:Vec3):Vec3=>[
  m[0]*v[0]+m[4]*v[1]+m[8]*v[2],
  m[1]*v[0]+m[5]*v[1]+m[9]*v[2],
  m[2]*v[0]+m[6]*v[1]+m[10]*v[2],
];
function rotation(axis:Vec3,degrees:number):number[]{
  const [x,y,z]=unit(axis),radians=degrees*Math.PI/180,c=Math.cos(radians),s=Math.sin(radians),k=1-c;
  return [c+x*x*k,y*x*k+z*s,z*x*k-y*s,0,x*y*k-z*s,c+y*y*k,z*y*k+x*s,0,
    x*z*k+y*s,y*z*k-x*s,c+z*z*k,0,0,0,0,1];
}

/** Turn about the loaded hip-to-ankle line, carrying the free leg and preserving the literal crest sole. */
export function makeSupportedCrestTurn(source:TurnSource,left:PoolPoseProgram,right:PoolPoseProgram,turn:SupportedCrestTurn):PoolPoseProgram{
  const {fromUnit,unit:turnUnit,toUnit}=turn;
  if(![fromUnit,turnUnit,toUnit].every(Number.isSafeInteger)||!(fromUnit<turnUnit&&turnUnit<toUnit)||
    ![turn.pelvisDegrees,turn.trunkDegrees,...turn.handParameters].every(Number.isFinite))throw new Error('Invalid supported pool turn.');
  const {bundle,rest,inverse,anatomy,fixture}=source,amount=(turnUnit-fromUnit)/(toUnit-fromUnit),phase=turnUnit/source.clockUnits;
  const loc={action:'pool_enter',phase},policy=poolSourcePolicy(fixture,loc.action,phase);
  if(policy.footL.required||!policy.footR.required||!policy.handL.required||!policy.handR.required)
    throw new Error('Supported pool turn requires the right sole and both wrists.');
  const controls=poolIntervalProgramControls(left,right),order=[anatomy.footL,anatomy.footR,anatomy.handL,anatomy.handR];
  if(controls.length!==4||controls.some((c,i)=>c.upper!==order[i].upper||c.lower!==order[i].lower||c.end!==order[i].end))
    throw new Error('Supported pool turn has different configured limb chains.');
  const pose=poolIntervalPreference(bundle,rest,inverse,left.preferenceBasis,right.preferenceBasis,amount,true);
  const states=controls.map(c=>resolvePoolLimbState(c,amount,loc).state);
  const hip=bundle.bones.findIndex(b=>b.name==='hips'),spine=bundle.bones.findIndex(b=>b.name==='spine'),head=bundle.bones.findIndex(b=>b.name==='head');
  const origin=position(pose.world[anatomy.footR.upper]),Q=rotation(sub(states[1].target,origin),turn.pelvisDegrees);
  const about=(v:Vec3)=>add(origin,direction(Q,sub(v,origin)));
  const spineWorld=pose.world[spine],headWorld=pose.world[head],oldShoulders=[position(pose.world[anatomy.handL.upper]),position(pose.world[anatomy.handR.upper])];
  setPoolWorldRotation(pose,hip,multiply(Q,pose.world[hip]));
  translatePoolRoot(pose,sub(origin,position(pose.world[anatomy.footR.upper])));
  setPoolWorldRotation(pose,spine,spineWorld);
  const toHand=sub(states[3].target,position(pose.world[anatomy.handR.upper]));
  const lean=rotation(cross([0,0,1],unit([toHand[0],toHand[1],0])),turn.trunkDegrees);
  setPoolWorldRotation(pose,spine,multiply(lean,spineWorld));setPoolWorldRotation(pose,head,headWorld);
  const goals:PoolLimbState[]=[
    {...states[0],target:about(states[0].target),orientation:multiply(Q,states[0].orientation),pole:about(states[0].pole)},
    {...states[1],pole:about(states[1].pole)},
  ];
  for(const [j,limb] of (['handL','handR'] as const).entries()){
    const previous=states[j+2],grasp=previous.attached;
    if(!grasp)throw new Error('Supported pool turn lost its original wrist.');
    const actual=source.grip(limb,phase,pose,turn.handParameters[j],grasp.rawOrientation,grasp.activeVertex);
    goals.push({...actual,pole:add(position(pose.world[anatomy[limb].upper]),direction(lean,sub(previous.pole,oldShoulders[j])))});
  }
  return makePoolPoseProgram(pose.basis,left.controls.map((c,i)=>({...c,state:goals[i]})),policy);
}
