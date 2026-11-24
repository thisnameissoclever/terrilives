import {poolClimbOutSteps} from './pool-climb-out.js';
import {poolSourcePolicy,poolSourceRecord} from './pool-source-policy.js';
import type {Vec3} from './math.js';
import type {PoolPoseProgram} from './pool-pose-program.js';
import type {SelectedPoolLimb} from './pool-selected-cycle.js';
import {canonicalPoolValue} from './pool-contact-identity.js';
import {captureSelectedPoolKnot,type SelectedPoolKnot,type SelectedPoolHopRoute} from './pool-selected-cycle.js';
import fitted from './pool-wide-exterior-fits.json';
import type {PoolContactInputV1} from './pool-contact-types.js';
import type {PoolCycleSource} from './pool-cycle-source.js';
import {assembleSelectedPoolRoute,authorExteriorKeys,assembleSelectedPoolExterior,type PoolRoutePlan} from './pool-route-assembler.js';
import type {ExteriorChainRequest} from './pool-opening-flight.js';
import type {NumericStageRequest} from './pool-numeric-recipe.js';
import {PoolTrialRefusal,PoolTrialStopped,type PoolTrialWork} from './pool-trial-work.js';
import {validatePoolKneeOrbit} from './pool-contact-evaluator.js';

/** These fitted stances were measured with the widened ladder. Publication still checks each requested body and garment. */
export function configuredPoolExterior(source:PoolCycleSource,exterior:ExteriorChainRequest):PoolRoutePlan['exteriorSource'] {
  const s=source.shape;
  if(source.definition.version===16&&source.definition.crestRoute.path==='supported-turn'&&!source.definition.forwardHop?.launchFromUnit){
    const r=source.definition.crestRoute;
    if(r.footSwingUnits[0]!==42000||![42000,42001,42101,43200].every(u=>r.sampleUnits.includes(u)))
      throw new Error('The supported pool release does not declare its initial toe path.');
    exterior={...exterior,outgoingToe:{limb:'footL',place:'outside3',startUnit:42000,firstUnit:42001,secondUnit:42101,releaseEnd:43200,liftScale:1}};
  }
  const fit=(id:keyof typeof fitted)=>({kind:'fitted' as const,exterior,stages:structuredClone(fitted[id]) as unknown as NumericStageRequest[],
    fitPlatformGrips:source.definition.version===16&&Boolean(source.definition.forwardHop?.platformTurn)});
  if(s.presentation==='feminine'&&[s.height,s.build,s.hips,s.shoulders,s.torso].every(v=>v===100))
    return fit('feminine-tall-broad');
  if(s.presentation==='feminine'&&[s.height,s.build,s.hips,s.shoulders,s.torso].every(v=>v===0))
    return fit('feminine-short-slim');
  if(s.presentation==='masculine'&&s.height===100&&[s.build,s.hips,s.shoulders,s.torso].every(v=>v===0))
    return fit('masculine-tall-slim');
  return {kind:'authored'};
}

export function selectCohortPoolRoute(input:PoolContactInputV1,source:PoolCycleSource,exterior:ExteriorChainRequest,
 crossing:PoolRoutePlan['crossing'],work:PoolTrialWork){
  return assembleSelectedPoolRoute(input,source,{exteriorSource:configuredPoolExterior(source,exterior),crossing},work);
}


/** A named installed sole and a free ankle goal are mutually exclusive numerical commands. */
export type AuthoredHopKnot=Omit<SelectedPoolKnot,'limbs'>&{limbs:{
  handL:SelectedPoolLimb;handR:SelectedPoolLimb;
  footL:SelectedPoolLimb|{place:string;pole:Vec3;kneeOrbit?:number};footR:SelectedPoolLimb|{place:string;pole:Vec3;kneeOrbit?:number};
}};
export interface AuthoredPoolHop {
  model:string;
  body:{presentation:'masculine'|'feminine';height:number;build:number;hips:number;shoulders:number;torso:number};
  entry:readonly AuthoredHopKnot[];
  climbOut:readonly AuthoredHopKnot[];
  entrySplitUnits?:readonly number[];
  exitSplitUnits?:readonly number[];
}

function selectedTrack(source:PoolCycleSource,authored:readonly AuthoredHopKnot[],units:readonly number[],splits:readonly number[],
 action:'pool_enter'|'pool_exit_0',work:PoolTrialWork):SelectedPoolKnot[] {
  const derived=new Set(splits),required=units.filter(u=>!derived.has(u)),clock=source.definition.clockUnits;
  if(derived.size!==splits.length||splits.some(u=>!units.includes(u)||u===units[0]||u===units.at(-1))||
     required.length!==authored.length||authored.some((k,i)=>k.unit!==required[i]))
    throw new Error('The selected '+action+' path is missing an authored key or has an unbound split.');
  for(const u of splits){
    const i=units.indexOf(u),phase=u/clock,lo=(units[i-1]+u)/(2*clock),hi=(u+units[i+1])/(2*clock);
    const key=canonicalPoolValue(poolSourceRecord(source.fixture,{action,phase}).limbs);
    if(key!==canonicalPoolValue(poolSourceRecord(source.fixture,{action,phase:lo}).limbs)||
       key!==canonicalPoolValue(poolSourceRecord(source.fixture,{action,phase:hi}).limbs)||
       (action==='pool_enter'&&source.definition.version===16&&u===source.definition.forwardHop?.takeoffUnit))
      throw new Error('A change in support or takeoff must retain its original authored knot: '+u);
  }
  const programs=new Map<number,PoolPoseProgram>(),selected=new Map<number,SelectedPoolKnot>();
  for(const k of authored){
    work.reserve('rebind selected '+action+' controls at '+k.unit,{expansions:1});
    const phase=k.unit/clock,policy=poolSourcePolicy(source.fixture,action,phase);
    const installed=(limb:'footL'|'footR'):SelectedPoolLimb=>{
      const control=k.limbs[limb];
      if(!('place' in control))return control;
      validatePoolKneeOrbit(control.kneeOrbit,true);
      if(Object.keys(control).sort().join(',')!==(Object.hasOwn(control,'kneeOrbit')?'kneeOrbit,place,pole':'place,pole')||!policy[limb].required||
        source.definition.places[control.place]?.surface!==policy[limb].surface)
        throw new Error('Selected sole is not installed on its declared phase-owned surface.');
      const f=action==='pool_enter'?source.foot(limb,control.place,work):source.primaryExitFoot(limb,control.place,k.unit);
      return {target:f.target,orientation:f.orientation,pole:control.pole,...(control.kneeOrbit===undefined?{}:{kneeOrbit:control.kneeOrbit})};
    };
    const knot={...k,limbs:{handL:k.limbs.handL,handR:k.limbs.handR,footL:installed('footL'),footR:installed('footR')}};
    selected.set(k.unit,knot);
  }
  const program=(u:number)=>{
    const saved=programs.get(u);if(saved)return saved;
    const node=source.materializeSelectedKnot(selected.get(u)!,action);programs.set(u,node);return node;
  };
  return units.map(u=>{
    if(!derived.has(u))return selected.get(u)!;
    const right=required.findIndex(v=>v>u),lo=required[right-1],hi=required[right];
    work.reserve('split selected '+action+' interval at '+u,{expansions:1});
    return captureSelectedPoolKnot(source,u,source.splitSelectedEntry(program(lo),program(hi),lo,hi,u,action),action);
  });
}

export function selectCohortHopEntry(source:PoolCycleSource,exterior:ExteriorChainRequest,
 authored:Pick<AuthoredPoolHop,'model'|'body'|'entry'|'entrySplitUnits'>,work:PoolTrialWork):SelectedPoolKnot[] {
  const def=source.definition;
  if(def.version!==16||!def.forwardHop)throw new Error('The installed motion does not declare a forward hop.');
  if(authored.model!==source.fixture.revisions.model||authored.body.presentation!==source.shape.presentation||
    (['height','build','hips','shoulders','torso'] as const).some(k=>authored.body[k]!==source.shape[k]))throw new Error('The selected hop has a different pool or physical appearance.');
  const plan=configuredPoolExterior(source,exterior),crestUnit=def.crestRoute.sampleUnits[0];
  const units=def.forwardHop.entryUnits,approach=units.filter(u=>u<crestUnit);
  const afterCrest=selectedTrack(source,authored.entry,units.filter(u=>u>=crestUnit),authored.entrySplitUnits??[],'pool_enter',work);
  // The captured stance owns the crest itself. The two incident intervals reference this one node.
  const crest=source.materializeSelectedKnot(afterCrest[0]);
  const head=plan.kind==='authored'?authorExteriorKeys(source,approach,work):assembleSelectedPoolExterior(source,plan,work).programs;
  if(plan.kind==='fitted'&&canonicalPoolValue(crest)!==canonicalPoolValue(head.get(crestUnit)))
    throw new Error('The selected hop differs from its independently fitted crest commands.');
  const entry=approach.map(u=>{
    const pose=head.get(u);if(!pose)throw new Error('Missing exterior key before hop: '+u);
    return captureSelectedPoolKnot(source,u,pose);
  });
  afterCrest[0]=captureSelectedPoolKnot(source,crestUnit,crest);
  return [...entry,...afterCrest];
}

/** Connect the selected hop to the configured exterior and keep the independently authored exit intact. */
export function selectCohortPoolHop(input:PoolContactInputV1,source:PoolCycleSource,exterior:ExteriorChainRequest,
 authored:AuthoredPoolHop,work:PoolTrialWork):SelectedPoolHopRoute {
 const entry=selectCohortHopEntry(source,exterior,authored,work),def=source.definition;
 if(def.version!==16||!def.forwardHop)throw new Error('The installed motion does not declare a climb-out.');
 const hop=def.forwardHop,units=hop.climbOutUnits.filter(u=>u>=hop.bridgeEndUnit);
 const climbOut=selectedTrack(source,authored.climbOut,units,authored.exitSplitUnits??[],'pool_exit_0',work);
 return {kind:'hop',inputKey:input.key,takeoffUnit:hop.takeoffUnit,entry,climbOut};
}

/** Build the measured entry and run the independent climb author on its own clip clock. */
export function selectCohortHopAndClimb(input:PoolContactInputV1,source:PoolCycleSource,exterior:ExteriorChainRequest,
 authored:Pick<AuthoredPoolHop,'model'|'body'|'entry'|'entrySplitUnits'>,work:PoolTrialWork):SelectedPoolHopRoute {
 const entry=selectCohortHopEntry(source,exterior,authored,work),def=source.definition;
 if(def.version!==16||!def.forwardHop)throw new Error('Missing authored pool exit clock.');
 const head=new Map(entry.filter(k=>k.unit<=def.forwardHop!.takeoffUnit).map(k=>[k.unit,k]));
 const supportPrograms=new Map<number,PoolPoseProgram>();
 const exteriorProgram=(unit:number)=>{
  const existing=supportPrograms.get(unit);if(existing)return existing;
  const k=head.get(unit);if(!k)throw new Error('Climb-out requested an undeclared or airborne entry key at '+unit);
  work.reserve('rebuild selected supported entry reference at '+unit,{expansions:1});
  const pose=source.materializeSelectedKnot(k);supportPrograms.set(unit,pose);return pose;
 };
 const climbOut:SelectedPoolKnot[]=[];
 work.reserve('prepare the independent ladder exit',{expansions:1});
 for(const [unit,build] of poolClimbOutSteps(source,exteriorProgram)){
  work.reserve('author and capture pool exit at '+unit,{expansions:1});
  try{climbOut.push(captureSelectedPoolKnot(source,unit,build(),'pool_exit_0'));}
  catch(cause){
   if(cause instanceof PoolTrialStopped)throw cause;
   const message='Selected climb-out failed at exit unit '+unit+' (phase '+unit/def.clockUnits+').';
   if(cause instanceof PoolTrialRefusal)throw new PoolTrialRefusal(message,{cause});
   throw new Error(message,{cause});
  }
 }
 const expected=def.forwardHop.climbOutUnits.filter(u=>u>=def.forwardHop!.bridgeEndUnit);
 if(climbOut.length!==expected.length||climbOut.some((k,i)=>k.unit!==expected[i]))throw new Error('Climb-out producer omitted an authored unit.');
 return {kind:'hop',inputKey:input.key,takeoffUnit:def.forwardHop.takeoffUnit,entry,climbOut};
}
