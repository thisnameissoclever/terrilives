import {add,sub,scale,length,type Vec3} from './math.js';
import type {PoolCycleSource,PoolHand} from './pool-cycle-source.js';
import {poolSurfacePoint} from './pool-entry-anatomy.js';
import type {PoolLimbState} from './pool-contact-evaluator.js';
import {configuredPoolChainReach,poolChainReachable} from './pool-entry-domain.js';
import {resolvePoolRailContactFrame} from './pool-rail-contact-frame.js';
import {PoolSolidIndex} from './pool-solid.js';
import type {PoolSolid} from './pool-contact-types.js';
import {PoolTrialRefusal} from './pool-trial-work.js';

const indices=new WeakMap<PoolSolid,PoolSolidIndex>();
function index(solid:PoolSolid){
  let value=indices.get(solid);
  if(!value){value=new PoolSolidIndex(solid);indices.set(solid,value);}
  return value;
}
const near=(p:Vec3,s:PoolSolid)=>p.every((v,i)=>v>=s.bounds[0][i]&&v<=s.bounds[1][i]);

/** Slide a held wrist along its finite rail until the selected thumb clears the curved upright. */
export function fitClimbHand(source:PoolCycleSource,limb:PoolHand,shoulder:Vec3,state:PoolLimbState,branch?:readonly [number,number]):PoolLimbState {
  const anatomy=source.anatomy[limb],reach=configuredPoolChainReach(source.neutral.rest,anatomy.upper,anatomy.lower,anatomy.end);
  const complete=anatomy.completeHandCoefficients!,goal=state.attached;
  const rails=source.fixture.rails.map(r=>source.fixture.solids.find(s=>s.id===r.id)!);
  const points=(target:Vec3,orientation:readonly number[],from:number)=>complete.slice(from).map(c=>
    ({point:add(poolSurfacePoint(orientation,c),scale(target,c[3])),weight:c[3]}));
  const clearance=source.fixture.rails[0].radius/8;
  if(!goal){
    const hand=points(state.target,state.orientation,0);
    if(!hand.some(({point})=>rails.some(solid=>near(point,solid)&&index(solid).inside(point))))return state;
    const lo=Math.max(...hand.map(({point,weight})=>(rails[0].bounds[1][0]+clearance-point[0])/weight));
    const hi=Math.min(...hand.map(({point,weight})=>(rails[1].bounds[0][0]-clearance-point[0])/weight));
    if(lo>hi)throw new PoolTrialRefusal('Free climb hand does not fit between the two rail faces.');
    const target=add(state.target,[Math.max(lo,Math.min(hi,0)),0,0]);
    if(!poolChainReachable(reach,shoulder,target))throw new PoolTrialRefusal('Free climb hand cannot clear the post within wrist reach.');
    return {...state,target};
  }
  const solid=rails.find(s=>s.id===goal.geometry.surface)!;
  const trapped=(s:PoolLimbState)=>points(s.target,s.orientation,anatomy.surfaceCoefficients.length)
    .filter(({point})=>near(point,solid)&&index(solid).inside(point));
  if(!trapped(state).length)return state;
  const region=goal.geometry.support.region;
  if(region?.kind!=='rail')throw new Error('Climb hand requires its declared finite rail.');
  const domain=branch?[Math.max(region.parameter[0],branch[0]),Math.min(region.parameter[1],branch[1])]:region.parameter;
  if(goal.parameter<domain[0]||goal.parameter>domain[1])throw new Error('The held wrist is outside its authored rail branch.');
  const edges=goal.geometry.edges.filter(e=>e.edge.fromParameter<domain[1]&&e.edge.toParameter>domain[0]);
  const alternatives:{state:PoolLimbState;travel:number}[]=[];
  for(const sign of [-1,1]){
    let parameter=goal.parameter,current=state,travel=0;
    for(let n=0;n<edges.length*3;n++){
      const collisions=trapped(current);
      if(!collisions.length){if(poolChainReachable(reach,shoulder,current.target))alternatives.push({state:current,travel});break;}
      const e=edges.find(({edge})=>sign>0?parameter>=edge.fromParameter&&parameter<edge.toParameter:parameter>edge.fromParameter&&parameter<=edge.toParameter);
      if(!e)break;
      const segment=sub(e.to,e.from),size=length(segment),dir=scale(segment,sign/size),range=e.edge.toParameter-e.edge.fromParameter;
      const extremum=goal.geometry.coefficients[goal.geometry.vertices.indexOf(goal.activeVertex)][3];
      const w=Number(extremum.numerator)*2**extremum.exponent;
      const required=Math.max(...collisions.map(({point,weight})=>((index(solid).exitAlong(point,dir)??Infinity)+clearance)*w/weight));
      const limit=sign>0?Math.min(e.edge.toParameter,domain[1]):Math.max(e.edge.fromParameter,domain[0]);
      const end=sign>0?Math.min(limit,parameter+required*range/size):Math.max(limit,parameter-required*range/size);
      if(end===parameter)break;
      const frame=resolvePoolRailContactFrame(goal.geometry,goal.rawOrientation,end,goal.activeVertex,goal.source);
      travel+=length(sub(frame.translation,current.target));
      parameter=end;current={...state,target:frame.translation,orientation:frame.orientation,attached:{...goal,parameter}};
    }
  }
  alternatives.sort((a,b)=>a.travel-b.travel);
  if(!alternatives.length)throw new PoolTrialRefusal('No reachable rail slide clears the configured thumb.');
  return alternatives[0].state;
}
