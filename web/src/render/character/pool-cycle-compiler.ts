import type {Bundle,Geometry} from './bundle.js';
import type {ShapeParameters} from './shape.js';
import type {PoolFixtureV1,PoolContactInputV1,PoolContactArtifactV1,PoolPreparedTrack} from './pool-contact-types.js';
import {POOL_OBSERVER_REVISION} from './pool-contact-types.js';
import type {PoolCycleDefinition} from './pool-cycle-source.js';
import type {PoolPoseProgram} from './pool-pose-program.js';
import {compileRawPoolCycle} from './pool-owned-compilation.js';

export interface PoolCycleDiagnostic {action:string;phase:number;stage:string;passed:boolean;program?:PoolPoseProgram;interval?:{left:PoolPoseProgram;right:PoolPoseProgram;amount:number};world?:number[][];basis?:number[][];skin?:Float32Array<ArrayBuffer>;raw?:unknown;unresolved?:unknown;supports?:unknown;knees?:unknown;authoring?:unknown;error?:Error;sourceMs?:number;observationMs?:number;constructorMs?:number}

/** Summarize every admitted endpoint and interior observation without changing its measured scope. */
export function poolCycleCoverage(tracks:readonly PoolPreparedTrack[]):PoolContactArtifactV1['coverage'] {
 const all=tracks.flatMap(track=>track.intervals.flatMap(interval=>interval.observations));
 return {observerRevision:POOL_OBSERVER_REVISION,samples:all.length,interpolationSamples:all.filter(o=>o.fraction!==0&&o.fraction!==1).length,
  minimumObservedClearance:Math.min(...all.map(o=>o.minimumObservedClearance)),minimumClassifiedClearance:Math.min(...all.map(o=>o.minimumClassifiedClearance)),continuousBound:false};
}

/** Compile a complete cycle with the public mutable-input guards. */
export function compilePoolCycle(input:PoolContactInputV1,bundle:Bundle,shape:ShapeParameters,top:number,geometry:readonly Geometry[],fixture:PoolFixtureV1,definition:PoolCycleDefinition,diagnostic?:(row:PoolCycleDiagnostic)=>void):PoolContactArtifactV1 {
 return compileRawPoolCycle(input,bundle,shape,top,geometry,fixture,definition,diagnostic);
}
