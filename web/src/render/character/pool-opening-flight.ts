import {plantedStepHips,type PlantedStep} from './pool-planted-step.js';
import {interpolateTransform} from './motion.js';
import {installedPoolSupport} from './pool-installed-support.js';
import {canonicalPoolValue} from './pool-contact-identity.js';
import type {Vec3} from './math.js';
import type {PoolCycleDefinition} from './pool-cycle-source.js';
import type {PoolFixtureV1} from './pool-contact-types.js';
import {poolSourcePolicy,poolSourceRecord} from './pool-source-policy.js';
import {poolReplaySchedule} from './pool-replay-schedule.js';
import type {NumericBody,NumericHandGoal,NumericKnot,NumericRecipe,NumericStageRequest} from './pool-numeric-recipe.js';
import type {PoolTrialWork} from './pool-trial-work.js';

export interface OpeningFlight {kind:'first-exterior-step'|'second-exterior-step'|'third-exterior-step'|'crest-landing-step';limb:'footL'|'footR';from:string;to:string;startUnit:number;endUnit:number}
export interface OpeningFlightRequest extends OpeningFlight {additionalUnits?:readonly number[]}
export interface ExteriorToe {limb:'footL';place:'outside3';startUnit:42000;firstUnit:42001;secondUnit:42101;releaseEnd:43200;liftScale:1}
export interface ExteriorChainRequest {kind:'connected-exterior';steps:readonly [OpeningFlightRequest,OpeningFlightRequest];outgoingToe?:ExteriorToe}
export type PoolOpeningRequest=OpeningFlightRequest|ExteriorChainRequest;
export interface ParsedOpening {readonly flight:OpeningFlight;readonly units:readonly number[];readonly completionUnit:number;readonly next?:ParsedOpening;readonly outgoingToe?:ExteriorToe}
export interface OpeningGeometry extends ParsedOpening {readonly next?:OpeningGeometry;departureLift:number;arrivalLift:number;corridorY:number}
export interface FlyingFoot {flight:OpeningFlight;target:Vec3;orientation:readonly number[]}

export function requireOpeningDefinition(f:OpeningFlight,def:PoolCycleDefinition):void {
  if(def.version!==16)throw new Error('Unexpected exterior step.');
  const stages=['first-exterior-step','second-exterior-step','third-exterior-step','crest-landing-step'] as const;
  const indexInMotion=stages.indexOf(f.kind);
  const units=[def.groundGrip.acquisitionUnit,def.groundGrip.firstRungUnit,def.groundGrip.secondRungUnit,
    def.anchors.find(a=>a.name==='outside-third')?.unit,def.crestRoute.sampleUnits[0]];
  const start=units[indexInMotion],end=units[indexInMotion+1];
  if(indexInMotion<0||start===undefined||end===undefined)throw new Error('Unexpected exterior step.');
  const moving=indexInMotion%2===0?'footL':'footR',fixed=moving==='footL'?'footR':'footL',index=moving==='footL'?0:1;
  const takeoff=def.anchors.find(a=>a.unit===start),landing=def.anchors.find(a=>a.unit===end);
  const move=def.footTransitions.find(t=>t.limb===moving&&t.startUnit===start);
  if(!move||!takeoff||!landing||f.limb!==moving||f.startUnit!==start||f.endUnit!==end||
    move.from!==f.from||move.to!==f.to||move.endUnit!==end||!Object.hasOwn(def.places,f.to)||
    takeoff.feet[index]!==f.from||landing.feet[index]!==f.to||takeoff.feet[1-index]!==landing.feet[1-index]||
    def.footTransitions.some(t=>t.limb===fixed&&t.startUnit<end&&t.endUnit>start)||
    JSON.stringify(def.transferPercentages)!==JSON.stringify([0,20,65,85,100]))
    throw new Error('Opening flight differs from its authored sole places or units.');
}

/** The takeoff and landing use their installed frames. Only the strict interior may use a free sole. */
export function openingPolicy(f:OpeningFlight,fixture:PoolFixtureV1,def:PoolCycleDefinition,phase:number,toe?:ExteriorToe){
  const a=f.startUnit/def.clockUnits,b=f.endUnit/def.clockUnits,action='pool_enter';
  if(phase<a||phase>b)throw new Error('Opening flight has no ownership at this phase.');
  const policy=poolSourcePolicy(fixture,action,phase),row=poolSourceRecord(fixture,{action,phase}).limbs;
  const fixed=f.limb==='footL'?'footR':'footL',index=fixed==='footL'?0:1;
  const takeoff=def.anchors.find(k=>k.unit===f.startUnit)!;
  const l=policy[f.limb],r=policy[fixed],old=def.places[f.from].surface,next=def.places[f.to].surface;
  const held=def.places[takeoff.feet[index]].surface;
  const acquisition=poolSourcePolicy(fixture,action,def.groundGrip!.acquisitionUnit/def.clockUnits);
  const nextRelease=def.footTransitions.find(t=>t.limb===fixed&&t.startUnit===f.endUnit);
  const outgoing=toe&&phase===b&&f.kind==='crest-landing-step';
  const release=phase===b&&nextRelease;
  if(!r.required||r.surface!==held||r.region?.kind!=='top-face'||canonicalPoolValue(r.region)!==canonicalPoolValue(installedPoolSupport(fixture,held).region)||
    r.mode!==(release||outgoing?'release':'support'))throw new Error('Opening flight lost its installed supporting foot.');
  if(outgoing&&(row[fixed].interval?.[0]!==b||row[fixed].interval?.[1]!==toe.releaseEnd/def.clockUnits||row[fixed].intervalSpace!=='clip-phase'))throw new Error('Crest toe has a different outgoing release.');
  if(release){
    const releaseEnd=(release.startUnit+(release.endUnit-release.startUnit)*def.transferPercentages[1]/100)/def.clockUnits;
    const actual=row[fixed];
    if(actual.intervalSpace!=='clip-phase'||actual.interval?.[0]!==b||actual.interval?.[1]!==releaseEnd)
      throw new Error('Opening supporting foot has a different outgoing release.');
  }
  for(const hand of ['handL','handR'] as const){
    const held=acquisition[hand];
    if(!held.required||held.region?.kind!=='rail'||canonicalPoolValue(policy[hand])!==canonicalPoolValue(held))
      throw new Error('Opening flight changed the acquired wrist policy: '+hand);
  }
  const cut=(percentage:number)=>(f.startUnit+(f.endUnit-f.startUnit)*percentage/100)/def.clockUnits;
  const releaseEnd=cut(def.transferPercentages[1]),approachStart=cut(def.transferPercentages[3]);
  const mode=phase<releaseEnd?'release':phase<approachStart?'free':phase<b?'approach':'support';
  const surface=mode==='release'?old:mode==='free'?null:next;
  const interval=mode==='release'?[a,releaseEnd]:mode==='approach'?[approachStart,b]:null;
  if(surface!==null&&canonicalPoolValue(l.region)!==canonicalPoolValue(installedPoolSupport(fixture,surface).region))
    throw new Error('Opening support differs from the installed moving sole region.');
  const actual=row[f.limb].interval;
  if(l.mode!==mode||l.required!==(phase===a||phase===b)||l.surface!==surface||
    (surface===null?l.region!==null:l.region?.kind!=='top-face')||row[f.limb].intervalSpace!=='clip-phase'||
    (interval?(!actual||actual[0]!==interval[0]||actual[1]!==interval[1]):actual!==null))
    throw new Error('Moving foot command differs from the actual opening support.');
  return row;
}

function parseSingleOpening(raw:unknown,def:PoolCycleDefinition,fixture:PoolFixtureV1,stages:readonly Pick<NumericStageRequest,'unit'>[],work:PoolTrialWork,toe?:ExteriorToe):ParsedOpening|undefined {
  if(raw===undefined)return;
  if(!raw||typeof raw!=='object'||Array.isArray(raw)||![Object.prototype,null].includes(Object.getPrototypeOf(raw)))
    throw new Error('Invalid opening flight record.');
  const keys=['kind','limb','from','to','startUnit','endUnit'];
  if(keys.some(k=>!Object.hasOwn(raw,k))||Reflect.ownKeys(raw).some(k=>typeof k!=='string'||!keys.includes(k)&&k!=='additionalUnits'||
    !('value' in Object.getOwnPropertyDescriptor(raw,k)!)))throw new Error('Invalid opening flight fields.');
  const {kind,limb,from,to,startUnit,endUnit,additionalUnits}=raw as OpeningFlightRequest;
  const flight=Object.freeze({kind,limb,from,to,startUnit,endUnit});
  requireOpeningDefinition(flight,def);
  let extra:number[]=[];
  if(Object.hasOwn(raw,'additionalUnits')){
    if(!Array.isArray(additionalUnits))throw new Error('Invalid additional opening cut.');
    extra=Array.from({length:additionalUnits.length},(_,i)=>{
      const item=Object.getOwnPropertyDescriptor(additionalUnits,i);
      if(!item||!('value' in item)||!Number.isSafeInteger(item.value)||item.value<=startUnit||item.value>=endUnit)throw new Error('Invalid additional opening cut.');
      return item.value as number;
    });
    if(new Set(extra).size!==extra.length)throw new Error('Invalid additional opening cut.');
  }
  const width=endUnit-startUnit,completionUnit=startUnit+width*def.bodyProgressFraction;
  const motion=def.transferPercentages.map(p=>startUnit+width*p/100);
  if(!Number.isSafeInteger(completionUnit)||motion.some(u=>!Number.isSafeInteger(u)))throw new Error('Opening preference is off its authored clock.');
  const clip=fixture.clips.pool_enter;
  for(const unit of motion){
    const phase=unit/def.clockUnits;
    if(!clip.samples.some(k=>k.phase===phase)||
      (unit>startUnit&&!clip.intervals.some(i=>i.end===phase))||
      (unit<endUnit&&!clip.intervals.some(i=>i.start===phase)))
      throw new Error('Opening support lacks an authored transfer key or incident interval.');
  }
  const added=[...extra,completionUnit,...motion].map(unit=>({unit}));
  work.reserve('derive opening schedule',{expansions:1});
  const schedule=poolReplaySchedule(fixture,def,[...stages,...added]);
  const units=schedule.entryUnits.filter(u=>u>=startUnit&&u<=endUnit);
  for(const job of schedule.jobs)if(job.action==='pool_enter'&&job.phase>=startUnit/def.clockUnits&&job.phase<=endUnit/def.clockUnits){
    work.reserve('authenticate opening policy');
    openingPolicy(flight,fixture,def,job.phase,toe);
  }
  return Object.freeze({flight,units:Object.freeze(units),completionUnit,...(toe?{outgoingToe:toe}:{})});
}

export function parseOpening(raw:unknown,def:PoolCycleDefinition,fixture:PoolFixtureV1,stages:readonly Pick<NumericStageRequest,'unit'>[],work:PoolTrialWork):ParsedOpening|undefined {
 const kind=raw&&typeof raw==='object'?Object.getOwnPropertyDescriptor(raw,'kind')?.value:undefined;
 if(kind!=='connected-exterior'){
  const p=parseSingleOpening(raw,def,fixture,stages,work);
  if(p&&p.flight.kind!=='first-exterior-step'&&p.flight.kind!=='second-exterior-step')throw new Error('Both remaining exterior steps must be selected together.');
  return p;
 }
 if(!raw||typeof raw!=='object'||![null,Object.prototype].includes(Object.getPrototypeOf(raw))||
    Reflect.ownKeys(raw).some(k=>k!=='kind'&&k!=='steps'&&k!=='outgoingToe'))throw new Error('Invalid connected exterior fields.');
 const values=Object.getOwnPropertyDescriptor(raw,'steps')?.value;
 if(!Array.isArray(values)||values.length!==2||Reflect.ownKeys(values).some(k=>!['0','1','length'].includes(String(k))))throw new Error('Expected two connected exterior steps.');
 const toeField=Object.getOwnPropertyDescriptor(raw,'outgoingToe');
 let toe:ExteriorToe|undefined;
 if(toeField){
  const declared={limb:'footL',place:'outside3',startUnit:42000,firstUnit:42001,secondUnit:42101,releaseEnd:43200,liftScale:1} as const;
  const value=toeField.value;
  if(!value||typeof value!=='object'||![Object.prototype,null].includes(Object.getPrototypeOf(value))||
    Reflect.ownKeys(value).length!==Object.keys(declared).length||
    Object.entries(declared).some(([k,v])=>Object.getOwnPropertyDescriptor(value,k)?.value!==v))throw new Error('Invalid explicit exterior toe recipe.');
  toe=Object.freeze({...declared});
  const clip=fixture.clips.pool_enter,at=(u:number)=>u/def.clockUnits;
  const units=[toe.startUnit,toe.firstUnit,toe.secondUnit];
  for(const u of units){
   const phase=at(u),sample=clip.samples.find(k=>k.phase===phase);
   if(!sample)throw new Error('Toe recipe lacks a fixture cut.');
   const rows=[sample.limbs];
   const i=units.indexOf(u);
   if(i>0){const interior=clip.intervals.find(k=>k.start===at(units[i-1])&&k.end===phase);if(!interior)throw new Error('Toe recipe has a different fixture interval.');rows.push(interior.limbs);}
   for(const row of rows){
    const support=row.footL,sole=installedPoolSupport(fixture,def.places.outside3.surface),crest=installedPoolSupport(fixture,def.places.crest.surface);
    if(support.mode!=='release'||support.intervalSpace!=='clip-phase'||support.interval?.[0]!==at(toe.startUnit)||support.interval?.[1]!==at(toe.releaseEnd)||
      support.surface!==sole.surface||canonicalPoolValue(support.region)!==canonicalPoolValue(sole.region)||
      row.footR.mode!=='support'||row.footR.surface!==crest.surface||canonicalPoolValue(row.footR.region)!==canonicalPoolValue(crest.region))
      throw new Error('Toe recipe lacks its actual planted and moving soles.');
    const acquired=poolSourcePolicy(fixture,'pool_enter',def.groundGrip!.acquisitionUnit/def.clockUnits);
    for(const l of ['handL','handR'] as const)if(row[l].mode!=='support'||row[l].surface!==acquired[l].surface||canonicalPoolValue(row[l].region)!==canonicalPoolValue(acquired[l].region))
     throw new Error('Toe recipe changed its selected rail support.');
   }
  }
 }
 const first=parseSingleOpening(Object.getOwnPropertyDescriptor(values,'0')?.value,def,fixture,stages,work);
 const next=parseSingleOpening(Object.getOwnPropertyDescriptor(values,'1')?.value,def,fixture,stages,work,toe);
 if(first?.flight.kind!=='third-exterior-step'||next?.flight.kind!=='crest-landing-step'||first.flight.endUnit!==next.flight.startUnit)
  throw new Error('Invalid selected exterior transfer sequence.');
 return Object.freeze({...first,next});
}

export const openingSegments=(p?:ParsedOpening):readonly ParsedOpening[]=>p?(p.next?[p,p.next]:[p]):[];
export function openingAt(p:ParsedOpening|undefined,unit:number){return openingSegments(p).find(s=>unit>=s.flight.startUnit&&unit<=s.flight.endUnit);}

const mix=(a:number,b:number,t:number)=>t===0?a:t===1?b:a+(b-a)*t;
const between=(a:Vec3,b:Vec3,t:number):Vec3=>[mix(a[0],b[0],t),mix(a[1],b[1],t),mix(a[2],b[2],t)];

function slideOpeningHand(start:NumericHandGoal,end:NumericHandGoal,t:number,changeOrientation:boolean):NumericHandGoal {
  const a=start.grasp,b=end.grasp;
  if(a.surface!==b.surface||a.activeVertex!==b.activeVertex||(!changeOrientation&&canonicalPoolValue(a.rawOrientation)!==canonicalPoolValue(b.rawOrientation)))
    throw new Error('Opening wrist slide changed its selected attachment frame.');
  if(t===0)return start;
  if(t===1)return end;
  return {grasp:{...a,parameter:mix(a.parameter,b.parameter,t),rawOrientation:canonicalPoolValue(a.rawOrientation)===canonicalPoolValue(b.rawOrientation)?a.rawOrientation:interpolateTransform([...a.rawOrientation],[...b.rawOrientation],t)},poleOffset:between(start.poleOffset,end.poleOffset,t)};
}

export function openingHands(f:OpeningFlight,from:NumericKnot,to:NumericKnot,t:number):NumericKnot['hands'] {
  if(f.kind==='first-exterior-step'){
    if(canonicalPoolValue(from.hands)!==canonicalPoolValue(to.hands))throw new Error('Opening flight changed its acquired wrists.');
    return from.hands;
  }
  const {handL:left,handR:right}=from.hands,{handL:toLeft,handR:toRight}=to.hands;
  if(!('grasp' in left&&'grasp' in right&&'grasp' in toLeft&&'grasp' in toRight))
    throw new Error('Opening wrist slide requires both selected rail destinations.');
  const turn=f.kind==='third-exterior-step'||f.kind==='crest-landing-step';
  return {handL:slideOpeningHand(left,toLeft,t,turn),handR:slideOpeningHand(right,toRight,t,turn)};
}

export function openingBodyFraction(unit:number,geometry:ParsedOpening):number {
  const u=Math.min(1,(unit-geometry.flight.startUnit)/(geometry.completionUnit-geometry.flight.startUnit));
  return u*u*(3-2*u);
}

/** Compare a detached recipe to the selection retained by its coordinator before expansion. */
export function requireSelectedPoolRecipe(recipe:NumericRecipe,selection:NumericRecipe,opening?:ParsedOpening,plants:readonly PlantedStep[]=[],work?:PoolTrialWork):void {
 const named=selection.knots,segments=openingSegments(opening);
 const expectedUnits=new Set([...named.map(k=>k.unit),...segments.flatMap(s=>s.units)]);
 const actualUnits=new Set<number>();
 for(const k of recipe.knots){
  if(k.ref!=='entry/'+k.unit||actualUnits.has(k.unit)||!expectedUnits.has(k.unit))throw new Error('Duplicate or unbound exterior knot identity.');
  actualUnits.add(k.unit);
 }
 if(actualUnits.size!==expectedUnits.size)throw new Error('Exterior expansion lost a selected or mandatory knot.');
 const knots=new Map(recipe.knots.map(k=>[k.unit,k]));
 for(const anchor of named){
  const k=knots.get(anchor.unit)!;
  if(canonicalPoolValue(k)!==canonicalPoolValue(anchor))throw new Error('Expanded recipe differs from the independently selected endpoint '+k.unit);
 }
 if(canonicalPoolValue(recipe.acquisition)!==canonicalPoolValue(selection.acquisition)||canonicalPoolValue(recipe.secondRung)!==canonicalPoolValue(selection.secondRung))
  throw new Error('Expanded recipe differs from its independently selected endpoint attachments.');
 for(const segment of segments){
  const f=segment.flight,from=named.find(k=>k.unit===f.startUnit),to=named.find(k=>k.unit===f.endUnit);
  if(!from||!to)throw new Error('Opening wrists have no independently selected endpoint.');
  const plant=plants.find(p=>p.fromUnit===f.startUnit&&p.toUnit===f.endUnit);
  const planted=f.kind==='third-exterior-step'||f.kind==='crest-landing-step';
  if(planted!==!!plant)throw new Error('Missing independent planted path geometry.');
  for(const u of segment.units){
   if(u===f.startUnit||u===f.endUnit)continue;
   const k=knots.get(u)!,amount=openingBodyFraction(u,segment);
   if(plant){
    work?.reserve('verify independently prepared planted hips at '+u,{expansions:1});
    const hips=amount===1?to.body.hips:plantedStepHips(plant,amount);
    if(!hips.every((v,i)=>v===k.body.hips[i]))throw new Error('Expanded recipe differs from its independently prepared planted hips at '+u);
   }
   if(canonicalPoolValue(k.hands)!==canonicalPoolValue(openingHands(f,from,to,amount)))
    throw new Error('Opening wrist slide differs from its selected finite rail trajectory at '+u);
  }
 }
}

/** Sample the preferences at actual clock cuts; the canonical program evaluator owns interpolation between samples. */
export function openingKnots(chosen:readonly NumericKnot[],geometry:OpeningGeometry,work:PoolTrialWork,plant?:PlantedStep):NumericKnot[] {
  const {flight:f}=geometry,from=chosen.find(k=>k.unit===f.startUnit),to=chosen.find(k=>k.unit===f.endUnit);
  if(!from||!to)throw new Error('Opening flight lacks its selected planted endpoints.');
  const moving=f.limb,fixed=moving==='footL'?'footR':'footL';
  const begin=from.feet[moving],end=to.feet[moving],planted=from.feet[fixed];
  if('flight' in begin||'flight' in end||'flight' in planted||begin.place!==f.from||end.place!==f.to||
    canonicalPoolValue(planted)!==canonicalPoolValue(to.feet[fixed])||canonicalPoolValue(begin.orientation)!==canonicalPoolValue(end.orientation))
    throw new Error('Opening flight changed its selected foot frames.');
  const width=f.endUnit-f.startUnit,at=(pct:number)=>f.startUnit+width*pct/100;
  const lifted:Vec3=[begin.target[0],f.from==='ground'?begin.target[1]:geometry.corridorY,begin.target[2]+geometry.departureLift];
  const outer:Vec3=[end.target[0],geometry.corridorY,end.target[2]+geometry.arrivalLift];
  const descent=between(outer,end.target,(85-65)/(100-65));
  const path:readonly [number,Vec3][]=[[f.startUnit,begin.target],[at(20),lifted],[at(65),outer],[at(85),descent],[f.endUnit,end.target]];
  const generated:NumericKnot[]=[];
  for(const unit of geometry.units){
    if(unit===f.startUnit||unit===f.endUnit)continue;
    work.reserve('generate complete opening knot '+unit,{expansions:1});
    const i=path.findIndex(([u])=>u>=unit),[lo,a]=path[i-1],[hi,b]=path[i];
    const t=openingBodyFraction(unit,geometry);
    const left=from.body,right=to.body;
    const body:NumericBody={hips:plant&&t>0&&t<1?plantedStepHips(plant,t):between(left.hips,right.hips,t),hipPitch:mix(left.hipPitch,right.hipPitch,t),
      trunkPitch:mix(left.trunkPitch,right.trunkPitch,t),headPitch:mix(left.headPitch,right.headPitch,t),
      ...(left.trunkYaw!==undefined||right.trunkYaw!==undefined?{trunkYaw:mix(left.trunkYaw??0,right.trunkYaw??0,t)}:{})};
    const feet={...from.feet,[moving]:{flight:f,target:between(a,b,(unit-lo)/(hi-lo)),orientation:begin.orientation}};
    generated.push({ref:'entry/'+unit,unit,body,feet,hands:openingHands(f,from,to,t)});
  }
  return [...chosen,...generated].sort((a,b)=>a.unit-b.unit);
}
