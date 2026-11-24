import {poolSourcePolicy} from './pool-source-policy.js';
import {canonicalPoolValue} from './pool-contact-identity.js';
import {selectedPoolRotationInput} from './pool-matrix-producer.js';
import type {PoolPoseProgram} from './pool-pose-program.js';
import type {PoolCycleSource} from './pool-cycle-source.js';
import type {PoolContactInputV1,PoolLimb} from './pool-contact-types.js';
import type {NumericBody,NumericGrasp} from './pool-numeric-recipe.js';
import type {Vec3} from './math.js';
import {poolReplaySchedule} from './pool-replay-schedule.js';
import {poolWithdrawalStart} from './pool-late-withdrawal.js';
import {validatePoolKneeOrbit} from './pool-contact-evaluator.js';

export interface SelectedPoolLimb {
  target: Vec3;
  pole: Vec3;
  orientation: readonly number[];
  kneeOrbit?:number;
  grasp?: NumericGrasp;
}

export interface SelectedPoolKnot {
  unit: number;
  rootTravel: Vec3;
  rotationInputs: readonly (readonly number[])[];
  limbs: Record<PoolLimb, SelectedPoolLimb>;
}

/** Selection ends at the approach to the right inside2 tread. All later controls use this same landing. */
export interface SelectedPoolDescent {
  kind?:'descent';
  inputKey: string;
  entry: readonly SelectedPoolKnot[];
  withdrawalBody: NumericBody;
}

export interface SelectedPoolHopRoute {
  kind:'hop';
  inputKey:string;
  takeoffUnit:number;
  entry:readonly SelectedPoolKnot[];
  /** Canonical pool_exit_0 clock, including both the settled bridge and final standing endpoints. */
  climbOut:readonly SelectedPoolKnot[];
}
export type SelectedPoolRoute=SelectedPoolDescent|SelectedPoolHopRoute;

/** Strip live source certificates; the publishing owner must reconstruct each contact on its own geometry. */
export function captureSelectedPoolKnot(source:PoolCycleSource,unit:number,program:PoolPoseProgram,action:'pool_enter'|'pool_exit_0'='pool_enter'):SelectedPoolKnot {
  const limbs={} as Record<PoolLimb,SelectedPoolLimb>;
  for(const limb of ['footL','footR','handL','handR'] as const){
    const anatomy=source.anatomy[limb],matches=program.controls.filter(c=>c.end===anatomy.end);
    if(matches.length!==1||program.controls.length!==4)throw new Error('Selected pool program lacks its four distinct configured limbs.');
    const c=matches[0],s=c.state,g=s.attached;
    if(c.upper!==anatomy.upper||c.lower!==anatomy.lower||c.anchor.length!==4||c.anchor.some((v,i)=>v!==[0,0,0,1][i])||
      c.legFrame!==(limb.startsWith('foot')?'source-entry-0':undefined))throw new Error('Selected pool control differs from its anatomical chain.');
    if(g&&(g.source.action!==action||g.source.phase!==unit/source.definition.clockUnits||g.source.limb!==limb))
      throw new Error('Selected wrist belongs to a different source key.');
    validatePoolKneeOrbit(s.kneeOrbit,c.legFrame==='source-entry-0');
    limbs[limb]={target:[...s.target],pole:[...s.pole],orientation:[...s.orientation],
      ...(s.kneeOrbit===undefined?{}:{kneeOrbit:s.kneeOrbit}),
      ...(g?{grasp:{surface:g.geometry.surface,parameter:g.parameter,rawOrientation:[...g.rawOrientation],activeVertex:g.activeVertex}}:{})};
  }
  const root=program.preferenceBasis[0];
  return {unit,rootTravel:[root[12],root[13],root[14]],rotationInputs:program.preferenceBasis.map(selectedPoolRotationInput),limbs};
}

function selectedNodes(source:PoolCycleSource,knots:readonly SelectedPoolKnot[],units:readonly number[],action:'pool_enter'|'pool_exit_0'){
  const mismatch=units.findIndex((unit,i)=>knots[i]?.unit!==unit);
  if(knots.length!==units.length||mismatch!==-1)throw new Error('Selected pool route lacks the complete ordered '+action+' clock.',
    {cause:{expectedCount:units.length,actualCount:knots.length,expected:units[mismatch],actual:knots[mismatch]?.unit}});
  const nodes=new Map<number,PoolPoseProgram>();
  for(const k of knots){
    try{nodes.set(k.unit,source.materializeSelectedKnot(k,action));}
    catch(cause){throw new Error('Unable to reconstruct '+action+' at unit '+k.unit,{cause});}
  }
  return nodes;
}

export function bindSelectedPoolRoute(source:PoolCycleSource,input:PoolContactInputV1,route:SelectedPoolRoute){
  if(source.definition.version!==16||route.inputKey!==input.key)throw new Error('Selected pool route belongs to a different motion or physical input.');
  const clock=source.definition.clockUnits,hop=source.definition.forwardHop;
  if(route.kind==='hop'){
    if(!hop||route.takeoffUnit!==hop.takeoffUnit)throw new Error('Selected takeoff differs from the native hop contract.');
    const schedule=poolReplaySchedule(source.fixture,source.definition,route.entry);
    const takeoffPhase=hop.takeoffUnit/clock;
    for(const phase of new Set(schedule.jobs.filter(j=>j.action==='pool_enter').map(j=>j.phase))){
      const policy=poolSourcePolicy(source.fixture,'pool_enter',phase);
      if(phase<=takeoffPhase&&!policy.footL.required&&!policy.footR.required)throw new Error('Hop retreat lost both sole supports before takeoff.');
      if(phase>takeoffPhase&&Object.values(policy).some(s=>s.required))throw new Error('Airborne hop unexpectedly reacquired a fixture support.');
    }
    const entries=selectedNodes(source,route.entry,schedule.entryUnits,'pool_enter');
    const climbOutUnits=hop.climbOutUnits.filter(u=>u>=hop.bridgeEndUnit);
    const exits=selectedNodes(source,route.climbOut,climbOutUnits,'pool_exit_0');
    const common=source.paddle(0),standing=entries.get(0)!;
    for(const [expected,actual] of [[common,entries.get(clock)],[common,exits.get(hop.bridgeEndUnit)],[standing,exits.get(clock)]]){
      if(!actual||canonicalPoolValue(expected)!==canonicalPoolValue(actual))throw new Error('Authored hop and climb-out do not share their exact water and standing endpoints.');
    }
    entries.set(clock,common);exits.set(hop.bridgeEndUnit,common);exits.set(clock,standing);
    const lookup=(m:Map<number,PoolPoseProgram>,u:number)=>{const n=m.get(u);if(!n)throw new Error('Missing selected hop program at '+u);return n;};
    return {schedule,entry:(u:number)=>lookup(entries,u),climbOut:(u:number)=>lookup(exits,u),climbOutUnits,takeoffPhase:hop.takeoffUnit/clock};
  }
  if(hop)throw new Error('This motion requires separate selected entry and climb-out programs.');
  const withdrawal=poolWithdrawalStart*clock;
  const schedule=poolReplaySchedule(source.fixture,source.definition,route.entry);
  const expected=schedule.entryUnits.filter(u=>u<=withdrawal);
  const mismatch=expected.findIndex((u,i)=>route.entry[i]?.unit!==u);
  if(!Number.isSafeInteger(withdrawal)||expected.at(-1)!==withdrawal||expected.length!==route.entry.length||mismatch!==-1)
    throw new Error('Selected pool route lacks an ordered, complete prefix through withdrawal.',
      {cause:{expectedCount:expected.length,actualCount:route.entry.length,expected:expected[mismatch],actual:route.entry[mismatch]?.unit}});
  const nodes=new Map<number,PoolPoseProgram>();
  for(const knot of route.entry){
    try{nodes.set(knot.unit,source.materializeSelectedKnot(knot));}
    catch(cause){throw new Error('Unable to reconstruct selected pool entry at unit '+knot.unit,{cause});}
  }
  const tail=source.withdrawalFrom(nodes.get(withdrawal)!,route.withdrawalBody);
  return {schedule,entry:(u:number)=>nodes.get(u)??tail(u/clock)};
}
