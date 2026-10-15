import manifest from '../../../../assets/models/sims/character-creator/export/manifest.json';
import library from '../../../../assets/models/sims/character-creator/clips/clips.json';
import bedParts from '../../../../assets/models/sims/character-creator/clips/bed/parts.json';
import bunkParts from '../../../../assets/models/sims/character-creator/clips/bunk/parts.json';
import type {CharacterAppearanceV1} from '../../character/schema.js';
import {SLEEP_CONTACT_SOLVER_REVISION,type SleepContactArtifactV1,type SleepContactInputV1,type SleepContactRevisions} from './sleep-contact-types.js';
import {canonicalSleepValue,sleepContactAppearance,sleepContactAppearanceKey} from './sleep-contact-identity.js';
import {makeSleepContactInput,sleepContactDigest,verifySleepContactInput} from './sleep-contact-protocol.js';
import {compileSleepContact} from './sleep-contact-compile.js';
export {sleepContactAppearanceKey} from './sleep-contact-identity.js';

let sourceRevisions:Promise<SleepContactRevisions>|undefined;
export function sleepContactSourceRevisions():Promise<SleepContactRevisions> {
  return sourceRevisions??=(async()=>{
    const [body,bed,bunk]=await Promise.all([
      sleepContactDigest(manifest),
      sleepContactDigest({source:library.sources.bed,clip:library.clips.bed_sleep,parts:bedParts}),
      sleepContactDigest({source:library.sources.bunk,clip:library.clips.bunk_sleep,parts:bunkParts}),
    ]);
    return {source:manifest.sourceSha256,body,bed,bunk};
  })().catch(error=>{sourceRevisions=undefined;throw error;});
}

/** Admission sends a small configuration record; body construction belongs to the worker. */
export async function createSleepContactInput(appearance:CharacterAppearanceV1):Promise<SleepContactInputV1> {
  const normalized=sleepContactAppearance(appearance),appearanceKey=sleepContactAppearanceKey(normalized),revisions=await sleepContactSourceRevisions();
  return makeSleepContactInput({version:1,solverRevision:SLEEP_CONTACT_SOLVER_REVISION,appearanceKey,appearance:normalized,revisions});
}

/** Worker-only source preparation retains the shared immutable asset cache. */
export async function prepareSleepContact(input:SleepContactInputV1):Promise<SleepContactArtifactV1> {
  await verifySleepContactInput(input);const revisions=await sleepContactSourceRevisions();
  if(canonicalSleepValue(input.revisions)!==canonicalSleepValue(revisions))throw new Error('Sleeping source revisions do not match this worker.');
  const {loadCreatorRig}=await import('./creator-assets.js');
  const [bed,bunk]=await Promise.all([loadCreatorRig('bed_sleep'),loadCreatorRig('bunk_sleep')]);
  return compileSleepContact(input,{bed,bunk,revisions});
}
