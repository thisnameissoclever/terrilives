import type {Geometry} from './bundle.js';
import type {ShapeParameters} from './shape.js';
import type {BikeContactArtifactV1,BikeFit} from './bike-contact-types.js';
import {bikeContactShapeKey,bikeContactShoeKey} from './bike-contact-input.js';

export class BikeContactNotReadyError extends Error {
  constructor(message='Bike contacts are not ready for this configuration.'){super(message);this.name='BikeContactNotReadyError';}
}
export function sampleBikeFit(fit:BikeFit,angle:number):BikeFit {
  if(!Number.isFinite(angle))throw new Error('Invalid bike contact phase.');
  if(!fit.hipCycle)return fit;
  const phase=((angle/(Math.PI*2)%1)+1)%1*fit.hipCycle.length,index=Math.floor(phase),t=phase-index;
  const a=fit.hipCycle[index],b=fit.hipCycle[(index+1)%fit.hipCycle.length];
  return {...fit,hip:[a[0]*(1-t)+b[0]*t,a[1]*(1-t)+b[1]*t,a[2]*(1-t)+b[2]*t]};
}
export function sampleBikeContact(artifact:BikeContactArtifactV1,angle:number):BikeFit {return sampleBikeFit(artifact.fit,angle);}
export function requireBikeContact(artifact:BikeContactArtifactV1|undefined,geometry:Geometry,a:ShapeParameters,top:number):BikeContactArtifactV1 {
  if(!artifact||artifact.sourcePhase!==0)throw new BikeContactNotReadyError();
  if(artifact.shapeKey!==bikeContactShapeKey(a,top)||artifact.shoeKey!==bikeContactShoeKey(geometry)||artifact.revisions.source!==geometry.manifest.sourceSha256)
    throw new BikeContactNotReadyError('The admitted bike contacts do not match the rendered body.');
  return artifact;
}
