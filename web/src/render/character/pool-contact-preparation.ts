import definition from '../../../../assets/models/sims/character-creator/pool_activity_motion_v9.json';
import definitionText from '../../../../assets/models/sims/character-creator/pool_activity_motion_v9.json?raw';
import {validatePoolCycleDefinition} from './pool-cycle-source.js';
import {compilePoolCycle} from './pool-cycle-compiler.js';
import manifest from '../../../../assets/models/sims/character-creator/export/manifest.json';
import library from '../../../../assets/models/sims/character-creator/clips/clips.json';
import parts from '../../../../assets/models/sims/character-creator/clips/pool/parts.json';
import fixtureData from '../../../../assets/models/sims/character-creator/clips/pool/contacts-v2.json';
import policy from '../../../../assets/models/sims/character-creator/pool-surface-policy-v1.json';
import type {CharacterAppearanceV1} from '../../character/schema.js';
import {canonicalPoolValue,poolContactAppearance,poolContactAppearanceKey} from './pool-contact-identity.js';
import {makePoolContactInput,verifyPoolContactInput,POOL_ACTIONS,freezePoolFixture} from './pool-contact-protocol.js';
import {sleepContactDigest} from './sleep-contact-protocol.js';
import {POOL_SOLVER_REVISION,POOL_OBSERVER_REVISION,POOL_INTERPOLATION_REVISION,type PoolContactInputV1,type PoolContactRevisions} from './pool-contact-types.js';
import {PreparedBody} from './prepared-body.js';
import {anatomicalHeight} from './shape.js';

let revisions:Promise<PoolContactRevisions>|undefined;
export function poolContactSourceRevisions():Promise<PoolContactRevisions> {
  return revisions??=(async()=>({body:await sleepContactDigest(manifest),garments:await sleepContactDigest({parts,policy}),
    clips:await sleepContactDigest({definition,sources:library.sources,clips:POOL_ACTIONS.map(action=>library.clips[action as keyof typeof library.clips])}),
    fixture:await sleepContactDigest(fixtureData),observer:POOL_OBSERVER_REVISION,interpolation:POOL_INTERPOLATION_REVISION}))()
    .catch(error=>{revisions=undefined;throw error;});
}

export async function createPoolContactInput(appearance:CharacterAppearanceV1):Promise<PoolContactInputV1> {
  const normalized=poolContactAppearance(appearance);
  return makePoolContactInput({version:1,solverRevision:POOL_SOLVER_REVISION,appearance:normalized,
    appearanceKey:poolContactAppearanceKey(normalized),revisions:await poolContactSourceRevisions()});
}

/** The serial preparation owner loads the exact selected body and temporary garments. */
export async function loadPoolContactSources(input:PoolContactInputV1) {
  await verifyPoolContactInput(input);
  validatePoolCycleDefinition(definition);
  const digest=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(definitionText))),v=>v.toString(16).padStart(2,'0')).join('');
  if(digest!==fixtureData.revisions.poseProducer||canonicalPoolValue(library.clips.pool_enter.samples[0])!==canonicalPoolValue(definition.reference.neutralSample))throw new Error('Pool source definition, anatomical gauge and fixture were not exported together.');
  if(canonicalPoolValue(input.revisions)!==canonicalPoolValue(await poolContactSourceRevisions()))throw new Error('Pool source revisions do not match this worker.');
  const {loadCreatorRig}=await import('./creator-assets.js'),rig=await loadCreatorRig('pool_enter');
  const appearance=input.appearance,selection=new PreparedBody(rig.base,appearance).select(rig,appearance,{wear:'bare',prop:'none',fixture:'none',
    eyes_closed:false,includeFixture:false,clip:'pool_enter',swimwear:appearance.presentation==='feminine'?'two_piece':'trunks'});
  if(!selection.extra||selection.variants.length)throw new Error('Pool preparation requires an explicitly supported complete physical selection.');
  return {rig,geometry:[selection.body,selection.extra],fixture:freezePoolFixture(fixtureData),
    shape:{presentation:appearance.presentation,...appearance.body,face:appearance.face},top:anatomicalHeight(rig.base.vertices)};
}

export async function preparePoolContact(input:PoolContactInputV1){
  const source=await loadPoolContactSources(input);
  validatePoolCycleDefinition(definition);
  return compilePoolCycle(input,source.rig.manifest,source.shape,source.top,source.geometry,source.fixture,definition);
}
