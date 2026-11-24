import type {PoolFixtureV1,PoolLimb,PoolSupport} from './pool-contact-types.js';
import {canonicalPoolValue} from './pool-contact-identity.js';

export const POOL_LIMBS=['handL','handR','footL','footR'] as const;
export interface PoolContactPolicy {mode:PoolSupport['mode'];surface:string|null;region:PoolSupport['region'];required:boolean}
export type PoolSourcePolicy=Record<PoolLimb,PoolContactPolicy>;
const fail=()=>{throw new Error('Pool source contact policy differs from its endpoint or interval ownership.');};

export interface PoolSourceLocation {readonly action:string;readonly phase:number}
export interface PoolSupportLocation extends PoolSourceLocation {readonly limb:PoolLimb}

/** Exact source keys take precedence over interval records, using the clip's actual time space. */
export function poolSourceRecord(fixture:PoolFixtureV1,location:PoolSourceLocation){
  const {action}=location;let {phase}=location;
  const clip=fixture.clips[action];if(!clip||!Number.isFinite(phase)||phase<0||phase>1)return fail();
  if(clip.playback==='loop'&&phase===1)phase=0;
  const sample=clip.samples.find(sample=>sample.phase===phase),interval=clip.intervals.find(interval=>phase>=interval.start&&phase<interval.end);
  const limbs=sample?.limbs??interval?.limbs;if(!limbs)return fail();
  const travel=sample?.travel??(action==='pool_paddle'?1:action.startsWith('pool_exit_')?(phase<=.1?1:(1-phase)/.9):phase);
  return {limbs,phase,travel,kind:sample?'key' as const:'interior' as const};
}

export function poolSourceSupport(fixture:PoolFixtureV1,location:PoolSupportLocation){
  if(!POOL_LIMBS.includes(location.limb))return fail();
  const record=poolSourceRecord(fixture,location),support=record.limbs[location.limb],coordinate=support.intervalSpace==='clip-phase'?record.phase:record.travel;
  const required=support.mode==='support'||support.mode==='approach'&&coordinate===support.interval?.[1]||support.mode==='release'&&coordinate===support.interval?.[0];
  return {support,required,coordinate,kind:record.kind};
}

export function requirePoolSourceSupport(fixture:PoolFixtureV1,location:PoolSupportLocation,support:PoolSupport):void {
  if(canonicalPoolValue(poolSourceSupport(fixture,location).support)!==canonicalPoolValue(support))throw new Error('Pool support differs from the actual observation source context.');
}

/** Keep source modes and finite regions, plus the actual endpoint contact obligation. */
export function poolSourcePolicy(fixture:PoolFixtureV1,action:string,phase:number):PoolSourcePolicy {
  return ownPoolSourcePolicy(Object.fromEntries(POOL_LIMBS.map(limb=>{
    const {support,required}=poolSourceSupport(fixture,{action,phase,limb});
    return [limb,{mode:support.mode,surface:support.surface,region:support.region,required}];
  })) as PoolSourcePolicy);
}

/** Include explicit keys and support-time events even when no retained sample landed on them. */
export function poolSourceEvents(fixture:PoolFixtureV1,action:string):number[] {
  const clip=fixture.clips[action];if(!clip)return fail();
  const events=new Set(clip.samples.map(sample=>sample.phase));
  for(const interval of clip.intervals){events.add(interval.start);events.add(interval.end);}
  for(const row of [...clip.samples,...clip.intervals])for(const support of Object.values(row.limbs))for(const coordinate of support.interval??[]){
    const phase=support.intervalSpace==='clip-phase'||action==='pool_enter'?coordinate:action.startsWith('pool_exit_')?1-.9*coordinate:NaN;
    if(Number.isFinite(phase)&&phase>=0&&phase<=1)events.add(phase);
  }
  return [...events].sort((a,b)=>a-b);
}

export function requirePoolSourcePolicy(value:unknown):asserts value is PoolSourcePolicy {
  if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).sort().join()!==[...POOL_LIMBS].sort().join())return fail();
  for(const limb of POOL_LIMBS){const row=(value as PoolSourcePolicy)[limb];
    if(!row||!['free','approach','support','release'].includes(row.mode)||typeof row.required!=='boolean')return fail();
    if(row.mode==='free'){if(row.surface!==null||row.region!==null||row.required)return fail();continue;}
    if(typeof row.surface!=='string'||!row.surface.length||!row.region||row.mode==='support'&&!row.required)return fail();
    const region=row.region;
    if(region.kind==='rail'){
      if(!Array.isArray(region.parameter)||region.parameter.length!==2||region.parameter.some(value=>!Number.isFinite(value))||region.parameter[0]>=region.parameter[1])return fail();
    }else if(region.kind==='top-face'){
      if(region.triangles!==undefined&&(!Array.isArray(region.triangles)||region.triangles.some(value=>!Number.isSafeInteger(value)||value<0)||new Set(region.triangles).size!==region.triangles.length))return fail();
    }else return fail();
  }
}

export function ownPoolSourcePolicy(value:PoolSourcePolicy):PoolSourcePolicy {
  requirePoolSourcePolicy(value);
  const copy=structuredClone(value);for(const row of Object.values(copy)){if(row.region){if(row.region.kind==='rail')Object.freeze(row.region.parameter);else if(row.region.triangles)Object.freeze(row.region.triangles);Object.freeze(row.region);}Object.freeze(row);}return Object.freeze(copy);
}

function transition(from:PoolContactPolicy,to:PoolContactPolicy):void {
  const allowed=from.mode===to.mode||['free:approach','approach:support','support:release','release:free'].includes(from.mode+':'+to.mode)
    ||from.mode==='approach'&&to.mode==='release'&&to.required;
  if(!allowed)return fail();
  if(from.mode!=='free'&&to.mode!=='free'&&canonicalPoolValue({surface:from.surface,region:from.region})!==canonicalPoolValue({surface:to.surface,region:to.region}))return fail();
}

/** Each interval has one source mode between its explicit handoff keys. */
export function requirePoolPolicyInterval(left:PoolSourcePolicy,right:PoolSourcePolicy,interior:PoolSourcePolicy,supportLimbs:readonly PoolLimb[]):void {
  for(const policy of [left,right,interior])requirePoolSourcePolicy(policy);
  for(const limb of POOL_LIMBS){transition(left[limb],interior[limb]);transition(interior[limb],right[limb]);}
  const required=POOL_LIMBS.filter(limb=>left[limb].required||right[limb].required||interior[limb].required);
  if(canonicalPoolValue([...required].sort())!==canonicalPoolValue([...supportLimbs].sort()))return fail();
}

export function poolPolicySupportLimbs(policy:PoolSourcePolicy):PoolLimb[]{return POOL_LIMBS.filter(limb=>policy[limb].required);}
export function requirePoolPolicyEqual(actual:PoolSourcePolicy,expected:PoolSourcePolicy,location?:PoolSourceLocation):void {
  if(canonicalPoolValue(actual)===canonicalPoolValue(expected))return;
  if(!location)return fail();
  const limb=POOL_LIMBS.find(name=>canonicalPoolValue(actual[name])!==canonicalPoolValue(expected[name]))!;
  throw new Error(`Pool source contact policy differs for ${limb} in ${location.action} at phase ${location.phase}.`,{
    cause:{...location,limb,actual:actual[limb],expected:expected[limb]},
  });
}
