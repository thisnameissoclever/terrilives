import {freePoolPolicy} from './pool-policy-fixture.js';
import {POOL_INTERPOLATION_REVISION,POOL_OBSERVER_REVISION,type PoolContactInputV1,type PoolContactArtifactV1,type PoolPreparedTrack} from '../src/render/character/pool-contact-types.js';
import {identity} from '../src/render/character/math.js';

/** Synthetic protocol/queue data. No evaluated physical surface or admission witness. */
export function schemaPoolArtifact(input:PoolContactInputV1):PoolContactArtifactV1 {
  const track=(keys:{phase:number;pose:number}[]):PoolPreparedTrack=>({keys,intervals:keys.slice(1).map(()=>({controls:[],supportLimbs:[],policy:freePoolPolicy(),status:'measured',
    observerRevision:POOL_OBSERVER_REVISION,interpolationRevision:POOL_INTERPOLATION_REVISION,
    observations:[0,.5,1].map(fraction=>({fraction,minimumObservedClearance:0,minimumClassifiedClearance:0,arithmeticContacts:[],airwayMinimum:1,rootReachSatisfied:true,supports:[]}))}))});
  return {...input,source:'synthetic queue fixture',partKeys:['synthetic body','synthetic garment'],shapeKey:'synthetic',top:2,waterHeight:.82,
    graph:{poses:[{preferenceBasis:Array.from({length:17},identity),controls:[],policy:freePoolPolicy()},{preferenceBasis:Array.from({length:17},identity),controls:[],policy:freePoolPolicy()}],entry:track([{phase:0,pose:0},{phase:1,pose:1}]),
      paddle:track(Array.from({length:13},(_,index)=>({phase:index/12,pose:1}))),bridges:Array.from({length:12},()=>track([{phase:0,pose:1},{phase:1,pose:1}]))},
    coverage:{observerRevision:POOL_OBSERVER_REVISION,samples:75,interpolationSamples:25,minimumObservedClearance:0,minimumClassifiedClearance:0,continuousBound:false}};
}
