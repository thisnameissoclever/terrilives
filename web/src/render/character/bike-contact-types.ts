import type {Geometry} from './bundle.js';
import type {Vec3} from './math.js';
import type {ShapeParameters} from './shape.js';

export const BIKE_CONTACT_VERSION=1;
export const BIKE_CONTACT_SOLVER_REVISION='stationary-periodic-phase-zero-v1';
export interface BikeDimensions {axle:Vec3;radius:number;halfSpacing:number;pedalTop:number;flywheelFace:number}
export interface BikeFit {hip:Vec3;hipCycle?:Vec3[];pelvisRotation:number[];pitch:number;feet:[{rotation:number[];offset:Vec3;contact:Vec3},{rotation:number[];offset:Vec3;contact:Vec3}];reachMargin:number;supportSamples:number}
export interface BikeContactSurface {points:Vec3[];triangles:[number,number,number][]}
export interface BikeContactInputDataV1 {
  version:1;solverRevision:typeof BIKE_CONTACT_SOLVER_REVISION;
  sourcePhase:number;
  revisions:{source:string;fixture:string;shoes:string};shapeKey:string;shoeKey:string;
  hip:Vec3;hipSurface:BikeContactSurface;saddle:BikeContactSurface;
  soles:[{points:Vec3[];source:number[]},{points:Vec3[];source:number[]}];
  thighOffsets:[Vec3,Vec3];legLengths:[number,number];dimensions:BikeDimensions;
}
export interface BikeContactInputV1 extends BikeContactInputDataV1 {key:string;sourcePhase:0}
export interface BikeContactArtifactV1 {
  version:1;solverRevision:typeof BIKE_CONTACT_SOLVER_REVISION;key:string;
  sourcePhase:0;
  revisions:BikeContactInputDataV1['revisions'];shapeKey:string;shoeKey:string;fit:BikeFit;
}
export type BikeFitResolver=(geometry:Geometry,shape:ShapeParameters,top:number,rest:number[][],pose:number[][],
  source:number[][],dimensions:BikeDimensions,legLengths:[number,number],angle:number)=>BikeFit;
