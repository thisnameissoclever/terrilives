import {PreparedBody} from './prepared-body.js';
import {anatomicalHeight} from './shape.js';
import {configuredPoseForProof} from './pose.js';
import {compileSeatedPoseFit,applySeatedPoseFit} from './seat-fit.js';
import {canonicalSeatValue,seatPartKey,seatShapeKey,stationarySeatLowerKey} from './seat-contact-identity.js';
import {freezeSeatContactArtifact,validateSeatContactInput} from './seat-contact-protocol.js';
import {SEAT_ACTIONS,type SeatContactArtifactV1,type SeatContactInputV1,type SeatContactSources,type SeatClipArtifactV1,type SeatFitResolver} from './seat-contact-types.js';
/** Build every supported action in the worker, using the runtime's selected physical geometry. */
export function compileSeatContact(input:SeatContactInputV1,sources:SeatContactSources):SeatContactArtifactV1 {
  validateSeatContactInput(input);if(canonicalSeatValue(input.revisions)!==canonicalSeatValue(sources.revisions))throw new Error('Seated source revisions differ from the request.');
  const appearance=input.appearance,shape={presentation:appearance.presentation,...appearance.body,face:appearance.face},base=sources.rigs.seated_eat.base;
  const prepared=new PreparedBody(base,appearance),top=anatomicalHeight(prepared.geometry.vertices),clips={} as Record<typeof SEAT_ACTIONS[number],SeatClipArtifactV1>;
  for(const action of SEAT_ACTIONS){const rig=sources.rigs[action];if(rig.base!==base||rig.manifest.sourceSha256!==input.revisions.source)throw new Error('Seated body source identity differs.');
    const lowerKey=stationarySeatLowerKey(rig.manifest,action),geometry=prepared.select(rig,appearance,{wear:'clothed',prop:'none',fixture:'none',eyes_closed:false,clip:action,grip:'relaxed',includeFixture:false}).body;
    let fit:SeatClipArtifactV1['fit']|undefined;
    const resolve:SeatFitResolver=(geometry,a,top,family,pose,rest,rig,source,range)=>{fit=compileSeatedPoseFit(geometry,a,top,family,pose,rest,rig,source,range);if(!fit)throw new Error('Unknown seated support family: '+family);applySeatedPoseFit(geometry,pose,fit);return true;};
    configuredPoseForProof(geometry.manifest,shape,action,0,top,undefined,geometry,resolve);if(!fit)throw new Error('Seated action did not compile its support: '+action);
    clips[action]={action,source:geometry.manifest.sourceSha256,partKey:seatPartKey(geometry,rig.family),shapeKey:seatShapeKey(shape,top),lowerKey,top,fit};
  }
  const {version,solverRevision,key,appearanceKey,revisions}=input;return freezeSeatContactArtifact({version,solverRevision,key,appearanceKey,revisions,clips});
}
