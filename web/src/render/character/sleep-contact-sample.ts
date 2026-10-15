import type {Geometry} from './bundle.js';
import type {ShapeParameters} from './shape.js';
import {assertStaticSleepClip,sleepPartKey,sleepShapeKey} from './sleep-contact-identity.js';
import {SLEEP_CONTACT_SOLVER_REVISION,type SleepAction,type SleepContactArtifactV1,type SleepClipArtifactV1} from './sleep-contact-types.js';

export class SleepContactNotReadyError extends Error {
  constructor(){super('Sleeping support must be prepared before rendering this configuration.');this.name='SleepContactNotReadyError';}
}
const matrices=new WeakMap<SleepClipArtifactV1,Float32Array<ArrayBuffer>>();
const partKeys=new WeakMap<Geometry,string>();
/** Admission validates full appearance ownership; sampling additionally binds the selected mesh and pose. */
export function requireSleepPose(artifact:SleepContactArtifactV1|undefined,geometry:Geometry,shape:ShapeParameters,top:number,action:SleepAction):Float32Array<ArrayBuffer> {
  if(!artifact||artifact.version!==1||artifact.solverRevision!==SLEEP_CONTACT_SOLVER_REVISION)throw new SleepContactNotReadyError();assertStaticSleepClip(geometry.manifest,action);
  const clip=artifact.clips[action];let partKey=partKeys.get(geometry);if(partKey===undefined){partKey=sleepPartKey(geometry);partKeys.set(geometry,partKey);}
  if(!clip||clip.sourcePhase!==0||clip.action!==action||clip.source!==geometry.manifest.sourceSha256||clip.partKey!==partKey||clip.shapeKey!==sleepShapeKey(shape,top)
      ||clip.matrices.length!==geometry.manifest.bones.length*16)throw new SleepContactNotReadyError();
  let pose=matrices.get(clip);if(!pose){pose=Float32Array.from(clip.matrices);matrices.set(clip,pose);}return pose;
}
export function requireSleepingCoverContribution(artifact:SleepContactArtifactV1|undefined,action:SleepAction,offsetX:number):readonly number[] {
  const cover=artifact?.clips[action].covers.find(cover=>Object.is(cover.offsetX,offsetX));
  if(!cover)throw new SleepContactNotReadyError();return cover.heights;
}
