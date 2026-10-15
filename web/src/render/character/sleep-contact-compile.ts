import {PreparedBody} from './prepared-body.js';
import {anatomicalHeight,shapeVertices} from './shape.js';
import {configuredPoseForProof} from './pose.js';
import {posedCageSurface} from './geometry-proof.js';
import {prepareSleepingCoverContribution} from './sleep-cover.js';
import {assertStaticSleepClip,canonicalSleepValue,sleepPartKey,sleepShapeKey} from './sleep-contact-identity.js';
import {freezeSleepContactArtifact,validateSleepContactInput} from './sleep-contact-protocol.js';
import {SLEEP_ACTIONS,type SleepContactArtifactV1,type SleepContactInputV1,type SleepContactSources,type SleepClipArtifactV1} from './sleep-contact-types.js';

/** Worker compilation uses the same body union and visible parts as live sleeping actors. */
export function compileSleepContact(input:SleepContactInputV1,sources:SleepContactSources):SleepContactArtifactV1 {
  validateSleepContactInput(input);
  if(canonicalSleepValue(input.revisions)!==canonicalSleepValue(sources.revisions))throw new Error('Sleeping source revisions differ from the request.');
  if(sources.bed.base!==sources.bunk.base)throw new Error('Sleeping clips must share the prepared body source.');
  const appearance=input.appearance,shape={presentation:appearance.presentation,...appearance.body,face:appearance.face};
  const prepared=new PreparedBody(sources.bed.base,appearance),top=anatomicalHeight(prepared.geometry.vertices);
  const deformed=shapeVertices(prepared.geometry.cage,shape,top),clips={} as Record<typeof SLEEP_ACTIONS[number],SleepClipArtifactV1>;
  for(const action of SLEEP_ACTIONS){
    const rig=action==='bed_sleep'?sources.bed:sources.bunk;assertStaticSleepClip(rig.manifest,action);
    if(rig.manifest.sourceSha256!==input.revisions.source)throw new Error('Sleeping body source identity differs.');
    const geometry=prepared.select(rig,appearance,{wear:'clothed',prop:'none',fixture:'none',eyes_closed:true,clip:action,grip:'relaxed',includeFixture:false}).body;
    const matrices=configuredPoseForProof(geometry.manifest,shape,action,0,top,undefined,geometry);
    const points=posedCageSurface(geometry,deformed,matrices),offsets=action==='bed_sleep'?[0,-.77]:[0];
    clips[action]={action,sourcePhase:0,source:geometry.manifest.sourceSha256,partKey:sleepPartKey(geometry),shapeKey:sleepShapeKey(shape,top),top,
      matrices:Array.from(matrices),covers:offsets.map(offsetX=>({offsetX,heights:Array.from(prepareSleepingCoverContribution({geometry,points,offsetX},action==='bunk_sleep'))}))};
  }
  const {version,solverRevision,key,appearanceKey,revisions}=input;
  return freezeSleepContactArtifact({version,solverRevision,key,appearanceKey,revisions,clips});
}
