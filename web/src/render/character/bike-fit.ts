import type {Geometry} from './bundle.js';
import type {ShapeParameters} from './shape.js';
import type {Vec3} from './math.js';
import {prepareBikeContactInput} from './bike-contact-input.js';
import {compileBikeFit} from './bike-contact-compile.js';
import {sampleBikeFit} from './bike-contact-sample.js';
import type {BikeDimensions,BikeFit} from './bike-contact-types.js';
export type {BikeDimensions,BikeFit} from './bike-contact-types.js';

export function bikePedalPosition(dimensions:BikeDimensions,angle:number,side:'L'|'R'):Vec3 {
  const phase=angle+(side==='R'?Math.PI:0);
  return [(side==='L'?-1:1)*dimensions.halfSpacing,dimensions.axle[1]+dimensions.radius*Math.sin(phase),dimensions.axle[2]+dimensions.radius*Math.cos(phase)];
}
const proofCache=new WeakMap<Geometry,Map<string,BikeFit>>();

/** Explicit synchronous CPU proof path; production poses require an admitted worker artifact. */
export function fitBike(geometry:Geometry,a:ShapeParameters,top:number,_rest:number[][],_pose:number[][],_source:number[][],
  _dimensions:BikeDimensions,_legLengths:[number,number],angle=0):BikeFit {
  const key=JSON.stringify([a.presentation,a.height,a.build,a.shoulders,a.hips,a.torso]);
  let entries=proofCache.get(geometry);if(!entries){entries=new Map();proofCache.set(geometry,entries);}
  const saved=entries.get(key);if(saved)return sampleBikeFit(saved,angle);
  const input=prepareBikeContactInput(geometry,a,top,
    {source:geometry.manifest.sourceSha256,fixture:'explicit-cpu-proof',shoes:geometry.manifest.runtime.verticesSha256},0);
  const fit=compileBikeFit(input);
  if(entries.size>=32)entries.delete(entries.keys().next().value!);entries.set(key,fit);
  return sampleBikeFit(fit,angle);
}
