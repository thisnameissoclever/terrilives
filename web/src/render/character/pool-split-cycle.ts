import type {PoolCycleSource} from './pool-cycle-source.js';
import type {PoolPoseProgram} from './pool-pose-program.js';
import type {PoolShapeExterior} from './pool-shape-exterior.js';
import {poolClimbOutSteps} from './pool-climb-out.js';
import {prepareSplitLevelPoolHop} from './pool-split-launch.js';
import {withSelectedPoolBasisInputs} from './pool-matrix-producer.js';
import {canonicalPoolValue} from './pool-contact-identity.js';
import {fitClimbApproach} from './pool-climb-reach-in.js';
import {fitClimbPassage} from './pool-climb-passage.js';
import {fitClimbKneeCurve} from './pool-climb-knee-curve.js';

/** The climb owns its inside poses. Its final descent uses this actor's exterior ascent in reverse. */
export interface SplitPreparationTimes {exterior:number;hop:number;climb:number;hands:number;passage:number;knees:number}
interface SplitPrograms {entry:Map<number,PoolPoseProgram>;exit:Map<number,PoolPoseProgram>;passage:ReturnType<typeof fitClimbPassage>;times:SplitPreparationTimes}
export function prepareSplitPoolPrograms<T>(source:PoolCycleSource,exterior:PoolShapeExterior,exitReference:(unit:number)=>PoolPoseProgram,use:(programs:SplitPrograms)=>T):T {
  const motion=source.definition;
  if(motion.version!==16||!motion.forwardHop?.launchFromUnit||motion.forwardHop.launchFromUnit!==exterior.crestUnit)
    throw new Error('The split-level pool hop differs from its exterior launch stance.');
  const hop=motion.forwardHop;
  return withSelectedPoolBasisInputs(()=>{
    let previous=performance.now();
    const elapsed=()=>{const now=performance.now(),duration=now-previous;previous=now;return duration;};
    const supported=new Map<number,PoolPoseProgram>();
    for(const u of hop.entryUnits){
      if(u>exterior.crestUnit)break;
      supported.set(u,exterior.at(u));
    }
    const outer=(u:number)=>{
      const stance=supported.get(u);
      if(!stance)throw new Error('The climb requested an undeclared exterior stance at '+u);
      return stance;
    };
    const exteriorMs=elapsed(),jump=prepareSplitLevelPoolHop(source,outer(exterior.crestUnit));
    const entry=new Map(supported);
    for(const u of hop.entryUnits)if(u>exterior.crestUnit)entry.set(u,jump(u));
    const hopMs=elapsed(),exit=new Map<number,PoolPoseProgram>();
    for(const [u,build] of poolClimbOutSteps(source,outer,exitReference)){
      try{exit.set(u,build());}catch(cause){
        throw new Error('Configured ladder exit failed at phase '+u/motion.clockUnits+'.',{cause});
      }
    }
    const units=hop.climbOutUnits.filter(u=>u>=hop.bridgeEndUnit);
    if(exit.size!==units.length||units.some(u=>!exit.has(u)))throw new Error('Independent pool exit omitted an authored event.');
    const legacy=!hop.outwardDescent&&!hop.platformTurn;
    const climbMs=elapsed();if(legacy)fitClimbApproach(source,exit);
    const handMs=elapsed();
    const passage=legacy?fitClimbPassage(source,exit):undefined;
    const passageMs=elapsed();
    if(legacy)fitClimbKneeCurve(source,exit);
    const kneeMs=elapsed();
    const check=(a:PoolPoseProgram|undefined,b:PoolPoseProgram|undefined)=>{
      if(!a||!b||a!==b&&canonicalPoolValue(a)!==canonicalPoolValue(b))throw new Error('Split-level pool tracks disagree at their standing or water join.');
    };
    check(entry.get(motion.clockUnits),source.paddle(0));
    check(exit.get(hop.bridgeEndUnit),source.paddle(0));
    check(exit.get(motion.clockUnits),entry.get(0));
    return use({entry,exit,passage,times:{exterior:exteriorMs,hop:hopMs,climb:climbMs,hands:handMs,passage:passageMs,knees:kneeMs}});
  });
}
