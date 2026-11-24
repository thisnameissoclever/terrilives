import type {PoolFixtureV1} from './pool-contact-types.js';
import type {PoolCycleDefinition} from './pool-cycle-source.js';
import type {NumericStageRequest} from './pool-numeric-recipe.js';
import {poolSourceEvents} from './pool-source-policy.js';

export interface PoolReplayJob {
  readonly id:string;
  readonly kind:'node'|'interval'|'reverse';
  readonly action:string;
  readonly left:string;
  readonly right:string;
  readonly fraction:number;
  readonly phase:number;
  readonly travel:number;
}
export interface PoolReplaySchedule {
  readonly entryUnits:readonly number[];
  readonly jobs:readonly PoolReplayJob[];
  readonly observations:number;
  readonly reverseComparisons:number;
}

export function exactPoolEntryUnit(phase:number,clock:number):number {
  const unit=Math.round(phase*clock);
  if(!Number.isSafeInteger(clock)||clock<=0||!Number.isSafeInteger(unit)||unit<0||unit>clock||phase!==unit/clock)
    throw new Error('Pool event is off its declared entry clock.');
  return unit;
}

/** Names a node and both incident evaluations independently, even for a stationary self-edge. */
export function poolReplaySchedule(fixture:PoolFixtureV1,definition:PoolCycleDefinition,recipeKnots:readonly Pick<NumericStageRequest,'unit'>[]=[]):PoolReplaySchedule {
  const clock=definition.clockUnits,paddleCount=definition.paddle.samples;
  if(!Number.isSafeInteger(clock)||clock<1||paddleCount!==12)throw new Error('Invalid pool replay clock.');
  const authored:number[]=[],recipeUnits=recipeKnots.map(k=>k.unit);
  const hop=definition.version===16?definition.forwardHop:undefined;
  if(hop)authored.push(...hop.entryUnits);
  else{
    for(const anchor of definition.anchors){
      if(exactPoolEntryUnit(anchor.phase,clock)!==anchor.unit)throw new Error('Pool anchor phase differs from its unit.');
      authored.push(anchor.unit);
    }
    for(const t of definition.footTransitions){
      if(exactPoolEntryUnit(t.start,clock)!==t.startUnit||exactPoolEntryUnit(t.end,clock)!==t.endUnit)throw new Error('Pool transfer phase differs from its unit.');
      authored.push(t.startUnit,t.endUnit);
    }
    for(const p of definition.plantedBodyPaths)authored.push(p.fromUnit,p.toUnit,...p.boundaryUnits,...p.sampleUnits);
    for(const p of [...definition.hand.approach,...definition.hand.release.handL,...definition.hand.release.handR])authored.push(exactPoolEntryUnit(p,clock));
    if(definition.hand.crestElbowPole){
      const pole=definition.hand.crestElbowPole;authored.push(pole.fromUnit,pole.peakUnit,pole.toUnit);
    }
    if(definition.groundGrip)authored.push(definition.groundGrip.acquisitionUnit,definition.groundGrip.firstRungUnit,definition.groundGrip.secondRungUnit);
    if(definition.crestFit)authored.push(definition.crestFit.shinReferenceUnit);
    if(definition.version===16){
      const r=definition.crestRoute;authored.push(...r.handTransferUnits,...r.footSwingUnits,...r.rightStepUnits,...r.sampleUnits);
    }
  }
  if(!authored.includes(0)||!authored.includes(clock)||[...authored,...recipeUnits].some(u=>!Number.isSafeInteger(u)||u<0||u>clock))
    throw new Error('Invalid declared pool key sequence.');
  const units=new Set([...authored,...recipeUnits,...poolSourceEvents(fixture,'pool_enter').map(p=>exactPoolEntryUnit(p,clock))]);
  if(hop&&[...units].some(u=>!hop.entryUnits.includes(u)))throw new Error('Entry recipe or support event is absent from the forward hop clock.');
  if(!hop)for(let origin=0;origin<12;origin++)for(const phase of poolSourceEvents(fixture,'pool_exit_'+origin))if(phase>.1){
    const u=Math.round((1-phase)/.9*clock);
    if(!Number.isSafeInteger(u)||u<0||u>=clock||phase!==(u===0?1:1-.9*(u/clock)))throw new Error('Pool exit event is off the shared reverse clock.');
    units.add(u);
  }
  const entryUnits=[...units].sort((a,b)=>a-b);
  const jobs:PoolReplayJob[]=[];
  const add=(job:Omit<PoolReplayJob,'id'>,begin:number,end:number)=>{
    const id=job.kind==='node'?JSON.stringify([job.action,job.kind,job.left,job.phase]):
      JSON.stringify([job.action,job.kind,job.left,begin,job.right,end,job.fraction]);
    jobs.push(Object.freeze({...job,id}));
  };
  const at=(a:number,b:number,t:number)=>t===0?a:t===1?b:a+(b-a)*t;
  const entry=entryUnits.map(u=>({phase:u/clock,ref:'entry/'+u}));
  const paddlePhases=[...new Set([...Array.from({length:paddleCount+1},(_,i)=>i/paddleCount),...poolSourceEvents(fixture,'pool_paddle')])].sort((a,b)=>a-b);
  const paddle=paddlePhases.map(p=>({phase:p,ref:p===0||p===1?'entry/'+clock:'paddle/'+p}));
  function physical(action:string,keys:readonly {phase:number;ref:string}[],entryTravel:boolean){
    for(const k of keys)add({kind:'node',action,left:k.ref,right:k.ref,fraction:0,phase:k.phase,travel:entryTravel?k.phase:1},k.phase,k.phase);
    for(let i=1;i<keys.length;i++){
      const a=keys[i-1],b=keys[i];
      for(const t of [0,.25,.5,.75,1]){
        const phase=at(a.phase,b.phase,t);
        add({kind:'interval',action,left:a.ref,right:b.ref,fraction:t,phase,travel:entryTravel?phase:1},a.phase,b.phase);
      }
    }
  }
  physical('pool_enter',entry,true);
  physical('pool_paddle',paddle,false);
  for(let origin=0;origin<12;origin++){
    const action='pool_exit_'+origin,events=poolSourceEvents(fixture,action);
    const bridge=[...new Set([0,.1,...events.filter(p=>p>0&&p<.1)])].sort((a,b)=>a-b);
    const start=paddle.find(k=>k.phase===origin/12)!;
    const bridgeKeys=bridge.map(p=>({phase:p,ref:p===0?start.ref:p===.1?'entry/'+clock:action+'/bridge/'+p}));
    if(hop){
      const clip=fixture.clips[action];
      if([...clip.samples,...clip.intervals].some(row=>Object.values(row.limbs).some(s=>s.interval&&s.intervalSpace!=='clip-phase')))
        throw new Error('An authored climb-out must declare support times on its own clip clock.');
      for(const p of events)if(p>=.1&&!hop.climbOutUnits.includes(exactPoolEntryUnit(p,clock)))
        throw new Error('Exit support event is missing from the authored climb-out clock.');
      const climb=hop.climbOutUnits.filter(u=>u>hop.bridgeEndUnit).map(u=>({phase:u/clock,ref:u===clock?'entry/0':'climb/'+u}));
      physical(action,[...bridgeKeys,...climb],false);
      continue;
    }
    physical(action,bridgeKeys,false);
    for(let i=1;i<entry.length;i++){
      const a=entry[i-1],b=entry[i];
      for(const t of [0,.5,1]){
        const travel=at(a.phase,b.phase,t),phase=travel===1?.1:travel===0?1:1-.9*travel;
        add({kind:'reverse',action,left:a.ref,right:b.ref,fraction:t,phase,travel},a.phase,b.phase);
      }
    }
  }
  const reverseComparisons=jobs.filter(j=>j.kind==='reverse').length;
  return Object.freeze({entryUnits:Object.freeze(entryUnits),jobs:Object.freeze(jobs),observations:jobs.length-reverseComparisons,reverseComparisons});
}
