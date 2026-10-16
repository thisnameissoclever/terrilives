import type {Bundle,Geometry} from './bundle.js';
import type {ShapeParameters} from './shape.js';
import {applySeatedPoseFit} from './seat-fit.js';
import {seatPartKey,seatShapeKey,stationarySeatLowerKey} from './seat-contact-identity.js';
import {SEAT_ACTIONS,SEAT_CONTACT_SOLVER_REVISION,type SeatAction,type SeatContactArtifactV1,type SeatClipArtifactV1,type SeatFitResolver} from './seat-contact-types.js';
export class SeatContactNotReadyError extends Error {constructor(){super('Seated support must be prepared before rendering this configuration.');this.name='SeatContactNotReadyError';}}
const partKeys=new WeakMap<Geometry,string>();
interface Binding {artifact:SeatContactArtifactV1;action:SeatAction;clip:SeatClipArtifactV1;top:number;presentation:ShapeParameters['presentation'];height:number;build:number;shoulders:number|undefined;hips:number|undefined;torso:number|undefined}
const bindings=new WeakMap<Geometry,Map<SeatAction,Binding>>();
const actions=new Set<string>(SEAT_ACTIONS);
const bundleActions=new WeakMap<Bundle,readonly SeatAction[]>();
const resolvers=new WeakMap<SeatContactArtifactV1,Map<SeatAction,SeatFitResolver>>();
const ordinaryToiletSeat:SeatFitResolver=()=>false;
const unavailableSeat:SeatFitResolver=()=>{throw new SeatContactNotReadyError();};

/** Contact installation retains callbacks; animated frames do not allocate new closures. */
export function seatContactResolver(artifact:SeatContactArtifactV1|undefined,action:string):SeatFitResolver {
  if(action==='toilet')return ordinaryToiletSeat;
  if(!artifact||!actions.has(action))return unavailableSeat;
  const selected=action as SeatAction;
  let entries=resolvers.get(artifact);if(!entries){entries=new Map();resolvers.set(artifact,entries);}
  let resolve=entries.get(selected);
  if(!resolve){resolve=(geometry,shape,top,_family,pose)=>applySeatContact(requireSeatContact(artifact,geometry,shape,top,selected),geometry,pose);entries.set(selected,resolve);}
  return resolve;
}
/** Admitted source geometry/manifests are immutable; primitive shape edits invalidate the binding. */
export function requireSeatContact(artifact:SeatContactArtifactV1|undefined,geometry:Geometry,shape:ShapeParameters,top:number,action:SeatAction):SeatClipArtifactV1 {
  const bound=bindings.get(geometry)?.get(action);if(bound&&bound.artifact===artifact&&bound.action===action&&bound.top===top&&bound.presentation===shape.presentation
    &&bound.height===shape.height&&bound.build===shape.build&&bound.shoulders===shape.shoulders&&bound.hips===shape.hips&&bound.torso===shape.torso)return bound.clip;
  if(!artifact||artifact.version!==1||artifact.solverRevision!==SEAT_CONTACT_SOLVER_REVISION)throw new SeatContactNotReadyError();
  const clip=artifact.clips[action],metadata=geometry.manifest.clipMetadata?.[action];if(!metadata||!clip)throw new SeatContactNotReadyError();
  let partKey=partKeys.get(geometry);if(partKey===undefined){partKey=seatPartKey(geometry,metadata.family);partKeys.set(geometry,partKey);}
  if(clip.action!==action||clip.source!==geometry.manifest.sourceSha256||clip.partKey!==partKey||clip.shapeKey!==seatShapeKey(shape,top)||clip.lowerKey!==stationarySeatLowerKey(geometry.manifest,action))throw new SeatContactNotReadyError();
  let selected=bindings.get(geometry);if(!selected){selected=new Map();bindings.set(geometry,selected);}selected.set(action,{artifact,action,clip,top,presentation:shape.presentation,height:shape.height,build:shape.build,shoulders:shape.shoulders,hips:shape.hips,torso:shape.torso});return clip;
}
/** Selection and contact installation perform validation before drawing the selected pose. */
export function bindSeatContacts(artifact:SeatContactArtifactV1|undefined,geometry:Geometry,shape:ShapeParameters,top:number):void {
  if(!artifact)return;
  let selected=bundleActions.get(geometry.manifest);
  if(!selected){selected=Object.keys(geometry.manifest.clipMetadata??{}).filter((action):action is SeatAction=>actions.has(action));bundleActions.set(geometry.manifest,selected);}
  for(let i=0;i<selected.length;i++){
    const action=selected[i];requireSeatContact(artifact,geometry,shape,top,action);seatContactResolver(artifact,action);
  }
}
export function applySeatContact(clip:SeatClipArtifactV1,geometry:Geometry,pose:number[][]):boolean {applySeatedPoseFit(geometry,pose,clip.fit);return true;}
