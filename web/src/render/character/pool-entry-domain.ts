import {inverseAffine,length,multiply,sub,type Vec3} from './math.js';
import {fitAssembly} from './contact-math.js';

export interface PoolChainReach {lengths:readonly [number,number];minimum:number;maximum:number}
export interface PoolReachConstraint {limb:string;center:Vec3;reach:PoolChainReach}

/** Actual configured rest offsets own anatomical reach; source chords only describe preference. */
export function configuredPoolChainReach(rest:readonly number[][],upper:number,lower:number,end:number):PoolChainReach {
  const offset=(parent:number,child:number)=>multiply(inverseAffine(rest[parent]),rest[child]).slice(12,15) as unknown as Vec3;
  const lengths=[length(offset(upper,lower)),length(offset(lower,end))] as const;
  if(lengths.some(value=>!Number.isFinite(value)||value<=0))throw new Error('Pool limb has invalid configured segment lengths.');
  return {lengths,minimum:Math.abs(lengths[0]-lengths[1]),maximum:lengths[0]+lengths[1]};
}

export function poolChainReachable(reach:PoolChainReach,start:Vec3,end:Vec3):boolean {
  const distance=length(sub(end,start));return distance>reach.minimum&&distance<reach.maximum;
}

/** The source hips box is provenance and deviation reporting, never an anatomical ceiling. */
export function projectPoolEntryRoot(requested:Vec3,constraints:readonly PoolReachConstraint[],sourceRegion:{minimum:Vec3;maximum:Vec3}) {
  if(!constraints.length)throw new Error('Pool entry root needs an active support constraint.');
  const minimum=[0,1,2].map(axis=>Math.max(...constraints.map(c=>c.center[axis]-c.reach.maximum))) as unknown as Vec3;
  const maximum=[0,1,2].map(axis=>Math.min(...constraints.map(c=>c.center[axis]+c.reach.maximum))) as unknown as Vec3;
  const projected=fitAssembly(requested,minimum,maximum,constraints.map(c=>({center:c.center,radius:c.reach.maximum})));
  if(!projected)return {requested,projected:null,active:constraints.map(c=>({limb:c.limb,kind:'maximum' as const})),sourceRegionPolicy:'preference-only' as const};
  const active=constraints.flatMap<{limb:string;kind:'minimum'|'maximum'}>(c=>{
    const distance=length(sub(projected,c.center));
    return distance<=c.reach.minimum?[{limb:c.limb,kind:'minimum' as const}]:distance>=c.reach.maximum?[{limb:c.limb,kind:'maximum' as const}]:[];
  });
  const sourceDeviation=[0,1,2].map(axis=>Math.max(0,sourceRegion.minimum[axis]-projected[axis],projected[axis]-sourceRegion.maximum[axis])) as unknown as Vec3;
  return {requested,projected,active,sourceDeviation,sourceRegionPolicy:'preference-only' as const};
}

export interface PoolRootRayInterval {minimum:number;maximum:number;open:true}

/** Intersect true two-segment reach shells along one declared root ray. */
export function poolRootRayIntervals(direction:Vec3,constraints:readonly PoolReachConstraint[]):PoolRootRayInterval[] {
  const a=direction.reduce((sum,value)=>sum+value*value,0);if(!Number.isFinite(a)||a<=0||!constraints.length)throw new Error('Pool root ray needs a finite direction and active supports.');
  let intervals:PoolRootRayInterval[]=[{minimum:0,maximum:Infinity,open:true}];
  for(const constraint of constraints){
    const b=-2*direction.reduce((sum,value,axis)=>sum+value*constraint.center[axis],0),squared=constraint.center.reduce((sum,value)=>sum+value*value,0);
    const roots=(radius:number):[number,number]|null=>{const discriminant=b*b-4*a*(squared-radius*radius);if(discriminant<=0)return null;const d=Math.sqrt(discriminant);return [(-b-d)/(2*a),(-b+d)/(2*a)];};
    const outer=roots(constraint.reach.maximum);if(!outer)return [];
    intervals=intervals.flatMap(interval=>{const minimum=Math.max(interval.minimum,outer[0]),maximum=Math.min(interval.maximum,outer[1]);return minimum<maximum?[{minimum,maximum,open:true as const}]:[];});
    const inner=roots(constraint.reach.minimum);
    if(inner)intervals=intervals.flatMap(interval=>{
      const parts:PoolRootRayInterval[]=[];
      if(interval.minimum<Math.min(interval.maximum,inner[0]))parts.push({minimum:interval.minimum,maximum:Math.min(interval.maximum,inner[0]),open:true});
      if(Math.max(interval.minimum,inner[1])<interval.maximum)parts.push({minimum:Math.max(interval.minimum,inner[1]),maximum:interval.maximum,open:true});return parts;
    });
  }
  return intervals;
}
