import type {CharacterAppearanceV1} from '../../character/schema.js';
import type {Vec3} from './math.js';
import type {PoolIntervalLimb} from './pool-contact-evaluator.js';
import type {PoolCanonicalGraph,PoolGraphTrack} from './pool-motion-graph.js';
import type {PoolSourcePolicy} from './pool-source-policy.js';
import type {PoolPoseProgram} from './pool-pose-program.js';

export const POOL_SOLVER_REVISION='pool-surfaces-v1';
export const POOL_OBSERVER_REVISION='pool-evaluated-solids-v1';
export const POOL_INTERPOLATION_REVISION='pool-canonical-contact-v10';
export type PoolLimb='handL'|'handR'|'footL'|'footR';
export interface PoolSupport {
  mode:'free'|'approach'|'support'|'release';surface:string|null;interval:[number,number]|null;
  intervalSpace?:'entry-travel'|'clip-phase';
  region:{kind:'rail';parameter:[number,number]}|{kind:'top-face';triangles?:number[]}|null;
}
export interface PoolSolid {id:string;kind:'solid'|'floor';vertices:Vec3[];triangles:[number,number,number][];bounds:[Vec3,Vec3]}
export interface PoolFixtureV1 {
  version:1;frame:'pool-local-metres';fixtureModel:'pool';waterHeight:number;
  ground:{id:string;bounds:[Vec3,Vec3]};solids:PoolSolid[];
  rails:{id:string;radius:number;points:{point:Vec3;left:Vec3;right:Vec3}[]}[];
  clips:Record<string,{playback:'loop'|'progress';samples:{phase:number;travel:number;limbs:Record<PoolLimb,PoolSupport>;
    rootRegion:{anchor:'hips';reference:'authored';minimum:Vec3;maximum:Vec3}}[];
    intervals:{start:number;end:number;limbs:Record<PoolLimb,PoolSupport>}[]}>;
  revisions:{model:string;producer:string;poseProducer:string;clipLibrary:string};
}
export interface PoolContactRevisions {body:string;garments:string;clips:string;fixture:string;observer:string;interpolation:string}
export interface PoolContactInputDataV1 {
  version:1;solverRevision:typeof POOL_SOLVER_REVISION;appearance:CharacterAppearanceV1;appearanceKey:string;revisions:PoolContactRevisions;
}
export interface PoolContactInputV1 extends PoolContactInputDataV1 {key:string}
export type PoolPreparedPose=PoolPoseProgram;
interface PoolArithmeticContactBase {part:string;surface:string;rawClearance:number;bound:number;activeVertex:number}
export type PoolArithmeticContactRecord=(PoolArithmeticContactBase&{method:'constructive-horizontal-foot-v1';planeHeight:number})
  |(PoolArithmeticContactBase&{method:'constructive-rail-edge-v1';planeX:number;edge:readonly [number,number];incidentFacets:readonly number[];activePointResidual:number});
export interface PoolIntervalObservation {
  fraction:number;minimumObservedClearance:number;minimumClassifiedClearance:number;airwayMinimum:number|null;
  arithmeticContacts:PoolArithmeticContactRecord[];
  rootReachSatisfied:true;supports:{limb:PoolLimb;satisfied:true}[];
}
export interface PoolPreparedInterval {
  policy:PoolSourcePolicy;
  controls:PoolIntervalLimb[];
  supportLimbs:PoolLimb[];
  observations:PoolIntervalObservation[];
  observerRevision:typeof POOL_OBSERVER_REVISION;
  interpolationRevision:typeof POOL_INTERPOLATION_REVISION;
  status:'measured';
}
export interface PoolPreparedTrack extends PoolGraphTrack {intervals:PoolPreparedInterval[]}
export interface PoolPreparedGraph extends PoolCanonicalGraph<PoolPreparedPose> {
  entry:PoolPreparedTrack;paddle:PoolPreparedTrack;bridges:PoolPreparedTrack[];climbOut?:PoolPreparedTrack;
}
export interface PoolContactArtifactV1 {
  version:1;solverRevision:typeof POOL_SOLVER_REVISION;key:string;appearanceKey:string;revisions:PoolContactRevisions;
  source:string;partKeys:string[];shapeKey:string;top:number;waterHeight:number;graph:PoolPreparedGraph;
  coverage:{observerRevision:typeof POOL_OBSERVER_REVISION;samples:number;interpolationSamples:number;minimumObservedClearance:number;minimumClassifiedClearance:number;continuousBound:false};
}

export interface PoolConfiguredInterval {
  policy:PoolSourcePolicy;controls:PoolIntervalLimb[];supportLimbs:PoolLimb[];
}
export interface PoolConfiguredTrack extends PoolGraphTrack {intervals:PoolConfiguredInterval[]}
export interface PoolConfiguredGraph extends PoolCanonicalGraph<PoolPreparedPose> {
  entry:PoolConfiguredTrack;paddle:PoolConfiguredTrack;bridges:PoolConfiguredTrack[];climbOut:PoolConfiguredTrack;
}
/** Configured target controls carry no measurements from the actor used to author the route. */
export interface PoolShapePlayback extends Omit<PoolContactArtifactV1,'coverage'|'graph'> {
  kind:'configured-shape';family:string;graph:PoolConfiguredGraph;
}
export type PoolPlayback=PoolContactArtifactV1|PoolShapePlayback;
export function isPoolShapePlayback(value:unknown):value is PoolShapePlayback {
  return typeof value==='object'&&value!==null&&'kind' in value&&value.kind==='configured-shape';
}
