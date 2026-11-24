import type {PoolContactInputV1} from './pool-contact-types.js';
import type {PoolCycleSource} from './pool-cycle-source.js';
import type {PoolPoseProgram} from './pool-pose-program.js';
import type {PoolFootContactFrame} from './pool-foot-contact-frame.js';
import {expandSelectedPoolRecipes,selectNumericPoolAnchors,type NumericBody,type NumericKnot,type NumericStageRequest} from './pool-numeric-recipe.js';
import {openingKnots,openingSegments,parseOpening,requireSelectedPoolRecipe,type ExteriorChainRequest,type OpeningFlightRequest} from './pool-opening-flight.js';
import {poolSourceRecord} from './pool-source-policy.js';
import {exactPoolEntryUnit,poolReplaySchedule} from './pool-replay-schedule.js';
import {captureSelectedPoolKnot,type SelectedPoolRoute} from './pool-selected-cycle.js';
import {poolWithdrawalStart} from './pool-late-withdrawal.js';
import {PoolTrialRefusal,PoolTrialWork} from './pool-trial-work.js';
import {canonicalPoolValue} from './pool-contact-identity.js';

export interface PoolCrestLanding {
  intent:NumericBody;
  program:PoolPoseProgram;
  feet:{footL:PoolFootContactFrame;footR:PoolFootContactFrame};
}
export interface PoolCrossingPrograms {
  readonly withdrawalBody:NumericBody;
  at(unit:number):PoolPoseProgram;
}
export interface FittedPoolExterior {
  readonly fitPlatformGrips?:boolean;
  /** One selected body and wrist command at each semantic anchor, for this source's configured geometry. */
  readonly stages:readonly NumericStageRequest[];
  readonly exterior:ExteriorChainRequest;
}
export interface PoolRoutePlan {
  exteriorSource:{kind:'authored'}|({kind:'fitted'}&FittedPoolExterior);
  crossing(source:PoolCycleSource,landing:PoolCrestLanding,units:readonly number[],work:PoolTrialWork):PoolCrossingPrograms;
}

/** Materialize one connected selection. The publishing owner subsequently verifies the entire motion. */
export function assembleSelectedPoolExterior(source:PoolCycleSource,plan:FittedPoolExterior,work:PoolTrialWork){
  const def=source.definition;
  if(def.version!==16||plan.stages.length!==5||plan.stages.some(s=>s.choices.length!==1))
    throw new Error('A production pool route needs one selected command at each exterior anchor.');
  const captured=source.captureNumericExterior(plan.stages,work,plan.exterior,plan.fitPlatformGrips),geometry=captured.opening;
  if(!geometry?.next)throw new Error('The selected exterior must reach the crest landing.');
  const choices=selectNumericPoolAnchors(captured,work),first=choices.next();
  if(first.done)throw new PoolTrialRefusal('The pool exterior selection is empty.');
  if(first.value.kind==='unavailable')throw new PoolTrialRefusal(first.value.reason,{cause:{unit:first.value.unit}});
  const selection=first.value.recipe;
  if(!choices.next().done)throw new Error('A selected pool plan produced multiple exterior chains.');
  const plants=openingSegments(geometry).map(segment=>source.preparePlantedStep(segment,selection.knots,work));
  const expansion=expandSelectedPoolRecipes(captured,work,selection,structuredClone(plants)).next();
  if(expansion.done)throw new Error('The selected pool exterior has no complete expansion.');
  const expanded=expansion.value;
  requireSelectedPoolRecipe(expanded.recipe,selection,geometry,plants,work);
  const knots=new Map<number,NumericKnot>(expanded.recipe.knots.map(k=>[k.unit,k]));
  const {acquisitionUnit,firstRungUnit,secondRungUnit}=def.groundGrip;
  const openingSteps=[
    {kind:'first-exterior-step',limb:'footL',from:'ground',to:'outside1',startUnit:acquisitionUnit,endUnit:firstRungUnit},
    {kind:'second-exterior-step',limb:'footR',from:'ground',to:'outside2',startUnit:firstRungUnit,endUnit:secondRungUnit},
  ] as const satisfies readonly OpeningFlightRequest[];
  for(const step of openingSteps){
    const parsed=parseOpening(step,def,source.fixture,plan.stages,work)!;
    const generated=openingKnots(selection.knots,source.captureOpeningGeometry(parsed,work),work);
    requireSelectedPoolRecipe({...selection,knots:generated},selection,parsed,[],work);
    for(const knot of generated){
      const shared=knots.get(knot.unit);
      if(shared&&canonicalPoolValue(shared)!==canonicalPoolValue(knot))throw new Error('Selected pool exterior changes a shared knot.');
      knots.set(knot.unit,knot);
    }
  }
  const crestUnit=geometry.next.flight.endUnit,withdrawalUnit=def.forwardHop?def.clockUnits:exactPoolEntryUnit(poolWithdrawalStart,def.clockUnits);
  const schedule=poolReplaySchedule(source.fixture,def,[...knots.values()]);
  const prefixUnits=schedule.entryUnits.filter(u=>u<=withdrawalUnit),middleUnits=prefixUnits.filter(u=>u>=crestUnit);
  if(middleUnits[0]!==crestUnit||middleUnits.at(-1)!==withdrawalUnit)throw new Error('Pool motion must declare both ends of the selected crossing.');
  const programs=new Map<number,PoolPoseProgram>();
  for(const [unit,knot] of knots){
    work.reserve('materialize selected exterior '+unit,{expansions:1});
    programs.set(unit,source.materializeNumericKnot(knot,unit===crestUnit));
  }
  const crest=knots.get(crestUnit)!,crestProgram=programs.get(crestUnit)!;
  const foot=(limb:'footL'|'footR')=>{
    const selected=crest.feet[limb];
    if('flight' in selected)throw new Error('The selected crest landing needs both installed feet.');
    const goal=source.foot(limb,selected.place,work);
    return source.frame(limb,poolSourceRecord(source.fixture,{action:'pool_enter',phase:crestUnit/def.clockUnits}).limbs[limb],[goal.target[0],goal.target[1]],work);
  };
  const landing:PoolCrestLanding={intent:crest.body,program:crestProgram,feet:{footL:foot('footL'),footR:foot('footR')}};
  const acquired=knots.get(acquisitionUnit)!,origin=programs.get(acquisitionUnit)!;
  for(const unit of prefixUnits){
    if(unit>=acquisitionUnit)break;
    work.reserve('approach selected first pool grip '+unit,{expansions:1});
    programs.set(unit,source.acquireFromStanding(unit,acquired,origin));
  }
  return {programs,landing,crestUnit,middleUnits,prefixUnits};
}

export function authorExteriorKeys(source:PoolCycleSource,units:readonly number[],work:PoolTrialWork){
  const programs=new Map<number,PoolPoseProgram>();
  for(const unit of units){
    work.reserve('author configured pool exterior '+unit,{expansions:1});
    programs.set(unit,source.entry(unit/source.definition.clockUnits));
  }
  return programs;
}

export function assembleAuthoredPoolExterior(source:PoolCycleSource,work:PoolTrialWork){
  const def=source.definition;
  if(def.version!==16)throw new Error('The authored selected exterior requires a crest route.');
  const crestUnit=def.crestRoute.sampleUnits[0],withdrawalUnit=def.forwardHop?def.clockUnits:exactPoolEntryUnit(poolWithdrawalStart,def.clockUnits);
  const schedule=poolReplaySchedule(source.fixture,def),prefixUnits=schedule.entryUnits.filter(u=>u<=withdrawalUnit);
  if(prefixUnits.at(-1)!==withdrawalUnit)throw new Error('Pool motion must declare its withdrawal handoff.');
  const programs=authorExteriorKeys(source,prefixUnits.filter(unit=>unit<=crestUnit),work);
  const program=programs.get(crestUnit);
  if(!program)throw new Error('Authored pool exterior lacks its crest landing.');
  const foot=(limb:'footL'|'footR',place:string)=>{
    const selected=source.foot(limb,place,work);
    return source.frame(limb,poolSourceRecord(source.fixture,{action:'pool_enter',phase:crestUnit/def.clockUnits}).limbs[limb],[selected.target[0],selected.target[1]],work);
  };
  const landing:PoolCrestLanding={intent:source.body(crestUnit/def.clockUnits).intent,program,
    feet:{footL:foot('footL','outside3'),footR:foot('footR','crest')}};
  return {programs,landing,crestUnit,middleUnits:prefixUnits.filter(u=>u>=crestUnit),prefixUnits};
}

export function assembleSelectedPoolRoute(input:PoolContactInputV1,source:PoolCycleSource,plan:PoolRoutePlan,work:PoolTrialWork):SelectedPoolRoute {
  const {programs,landing,crestUnit,middleUnits,prefixUnits}=plan.exteriorSource.kind==='authored'
    ?assembleAuthoredPoolExterior(source,work):assembleSelectedPoolExterior(source,plan.exteriorSource,work);
  const actual=plan.crossing(source,landing,middleUnits,work);
  if(actual.at(crestUnit)!==landing.program)throw new Error('The crossing did not consume the selected crest endpoint.');
  const entry=prefixUnits.map(unit=>{
    work.reserve('capture selected entry '+unit,{expansions:1});
    const node=unit<=crestUnit?programs.get(unit):actual.at(unit);
    if(!node)throw new Error('Missing selected pool program at '+unit);
    return captureSelectedPoolKnot(source,unit,node);
  });
  return {inputKey:input.key,entry,withdrawalBody:actual.withdrawalBody};
}
