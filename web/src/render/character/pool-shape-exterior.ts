import type {PoolCycleSource} from './pool-cycle-source.js';
import {configuredPoolExterior} from './pool-cohort-route.js';
import {assembleSelectedPoolExterior} from './pool-route-assembler.js';
import {PoolTrialWork} from './pool-trial-work.js';
import type {PoolPoseProgram} from './pool-pose-program.js';
import {fitExteriorLandingShin} from './pool-exterior-shin.js';

export interface PoolShapeExterior {
  readonly crestUnit:number;
  at(unit:number):PoolPoseProgram;
}

/** The supported entry and its outgoing wrist transfer share the target's chosen crest stance. */
export function preparePoolShapeExterior(source:PoolCycleSource):PoolShapeExterior {
  const def=source.definition;
  if(def.version!==16||!def.forwardHop)throw new Error('Shape-configured pool entry requires a forward hop.');
  const third=def.anchors.find(a=>a.name==='outside-third')?.unit;
  if(third===undefined)throw new Error('Missing exterior ladder anchor.');
  const crestUnit=def.crestRoute.sampleUnits[0];
  const plan=configuredPoolExterior(source,{kind:'connected-exterior',steps:[
    {kind:'third-exterior-step',limb:'footL',from:'outside1',to:'outside3',startUnit:def.groundGrip.secondRungUnit,endUnit:third},
    {kind:'crest-landing-step',limb:'footR',from:'outside2',to:'crest',startUnit:third,endUnit:crestUnit},
  ]});
  const cache=new Map<number,PoolPoseProgram>();
  const units=new Set(def.forwardHop.entryUnits.filter(u=>u<=crestUnit));
  let fitted:ReadonlyMap<number,PoolPoseProgram>|undefined;
  return {crestUnit,at(unit){
    if(!units.has(unit))throw new Error('An exterior knot must use its declared entry clock.');
    const existing=cache.get(unit);if(existing)return existing;
    let program:PoolPoseProgram|undefined;
    if(plan.kind==='fitted'){
      fitted??=assembleSelectedPoolExterior(source,plan,new PoolTrialWork({captures:32,expansions:250000,observations:0,reverseComparisons:0,milliseconds:30000})).programs;
      program=fitted.get(unit);
    }else{
      program=source.entry(unit/def.clockUnits);
      if(def.forwardHop!.launchFromUnit===42000&&unit>=third&&unit<=crestUnit)
        program=fitExteriorLandingShin(source,program,unit);
    }
    if(!program)throw new Error('The configured pool exterior omitted unit '+unit);
    cache.set(unit,program);return program;
  }};
}
