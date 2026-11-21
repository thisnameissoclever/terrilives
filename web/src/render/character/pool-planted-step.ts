import {multiply,sub,transform,type Vec3} from './math.js';
import {interpolateTransform} from './motion.js';

export interface PlantedEndpoint {
 upper:readonly number[];lower:readonly number[];hipRotation:readonly number[];branch:number;
}
export interface PlantedStep {
 fromUnit:number;toUnit:number;first:PlantedEndpoint;last:PlantedEndpoint;sole:Vec3;
 hipToUpper:readonly number[];upperToLower:readonly number[];lowerToEnd:readonly number[];
}
export function plantedStepHips(step:PlantedStep,t:number):Vec3 {
 const mix=(a:readonly number[],b:readonly number[])=>a.every((v,i)=>v===b[i])?[...a]:interpolateTransform([...a],[...b],t);
 const upper=mix(step.first.upper,step.last.upper),lower=mix(step.first.lower,step.last.lower);
 const knee=multiply(multiply(step.hipToUpper,upper),step.upperToLower);
 const ankle=multiply(multiply(knee,lower),step.lowerToEnd);
 const hips=sub(step.sole,transform(step.first.hipRotation,[ankle[12],ankle[13],ankle[14]]));
 if(!hips.every(Number.isFinite))throw new Error('Invalid planted exterior pelvis reconstruction.');
 return hips;
}
