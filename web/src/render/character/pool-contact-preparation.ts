import definition from '../../../../assets/models/sims/character-creator/pool_activity_motion_v14.json';
import definitionText from '../../../../assets/models/sims/character-creator/pool_activity_motion_v14.json?raw';
import {validatePoolCycleDefinition} from './pool-cycle-source.js';
import type {PoolCycleDiagnostic} from './pool-cycle-compiler.js';
import {compileOwnedPoolCycle,type PoolOwnedCompilationCounters} from './pool-owned-compilation.js';
import manifest from '../../../../assets/models/sims/character-creator/export/manifest.json';
import library from '../../../../assets/models/sims/character-creator/clips/clips.json';
import parts from '../../../../assets/models/sims/character-creator/clips/pool/parts.json';
import fixtureData from '../../../../assets/models/sims/character-creator/clips/pool/contacts-v3.json';
import fixtureText from '../../../../assets/models/sims/character-creator/clips/pool/contacts-v3.json?raw';
import policy from '../../../../assets/models/sims/character-creator/pool-surface-policy-v1.json';
import type {CharacterAppearanceV1} from '../../character/schema.js';
import {canonicalPoolValue,poolContactAppearance,poolContactAppearanceKey} from './pool-contact-identity.js';
import {makePoolContactInput,verifyPoolContactInput,POOL_ACTIONS} from './pool-contact-protocol.js';
import {parseOwnedPoolFixture} from './pool-owned-fixture.js';
import {sleepContactDigest} from './sleep-contact-protocol.js';
import {POOL_SOLVER_REVISION,POOL_OBSERVER_REVISION,POOL_INTERPOLATION_REVISION,type PoolContactInputV1,type PoolContactRevisions,type PoolFixtureV1} from './pool-contact-types.js';
import {PreparedBody} from './prepared-body.js';
import {anatomicalHeight} from './shape.js';

let revisions:Promise<PoolContactRevisions>|undefined;
let actualFixture:PoolFixtureV1|undefined;
export function poolContactFixture():PoolFixtureV1 {
  if(!actualFixture){
    const parsed=parseOwnedPoolFixture(fixtureText);
    if(canonicalPoolValue(parsed)!==canonicalPoolValue(fixtureData))throw new Error('Pool fixture JSON differs from its revision input.');
    actualFixture=parsed;
  }
  return actualFixture;
}
export function poolContactSourceRevisions():Promise<PoolContactRevisions> {
  return revisions??=(async()=>({body:await sleepContactDigest(manifest),garments:await sleepContactDigest({parts,policy}),
    clips:await sleepContactDigest({definition,sources:library.sources,clips:POOL_ACTIONS.map(action=>library.clips[action as keyof typeof library.clips])}),
    fixture:await sleepContactDigest(poolContactFixture()),observer:POOL_OBSERVER_REVISION,interpolation:POOL_INTERPOLATION_REVISION}))()
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
  const fixture=poolContactFixture();
  validatePoolCycleDefinition(definition);
  const digest=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(definitionText))),v=>v.toString(16).padStart(2,'0')).join('');
  if(digest!==fixture.revisions.poseProducer||canonicalPoolValue(library.clips.pool_enter.samples[0])!==canonicalPoolValue(definition.reference.neutralSample))throw new Error('Pool source revision or anatomical reference differs from the fixture.');
  if(canonicalPoolValue(input.revisions)!==canonicalPoolValue(await poolContactSourceRevisions()))throw new Error('Pool source revisions do not match this worker.');
  const {loadCreatorRig}=await import('./creator-assets.js'),rig=await loadCreatorRig('pool_enter');
  const appearance=input.appearance,selection=new PreparedBody(rig.base,appearance).select(rig,appearance,{wear:'bare',prop:'none',fixture:'none',
    eyes_closed:false,includeFixture:false,clip:'pool_enter',swimwear:appearance.presentation==='feminine'?'two_piece':'trunks'});
  if(!selection.extra||selection.variants.length)throw new Error('Pool preparation requires an explicitly supported complete physical selection.');
  return {rig,geometry:[selection.body,selection.extra],fixture,
    shape:{presentation:appearance.presentation,...appearance.body,face:appearance.face},top:anatomicalHeight(rig.base.vertices)};
}

export interface PoolPreparationDiagnostics {
  observation?:(row:PoolCycleDiagnostic)=>void;
  counters?:(summary:PoolOwnedCompilationCounters)=>void;
  stage?:(row:{stage:'source-load'|'physical-compile';elapsedMs:number;completed:boolean})=>void;
}

export async function preparePoolContact(input:PoolContactInputV1,diagnostics?:PoolPreparationDiagnostics){
  const loadStart=performance.now();let loaded=false;
  const source=await (async()=>{
    try{const value=await loadPoolContactSources(input);loaded=true;return value;}
    finally{diagnostics?.stage?.({stage:'source-load',elapsedMs:performance.now()-loadStart,completed:loaded});}
  })();
  const compileStart=performance.now();let compiled=false;
  try{
    validatePoolCycleDefinition(definition);
    const {rig,shape,top,geometry,fixture}=source;
    const artifact=compileOwnedPoolCycle(input,{bundle:rig.manifest,shape,top,geometry,fixture},definition,diagnostics?.observation,diagnostics?.counters);
    compiled=true;return artifact;
  }finally{diagnostics?.stage?.({stage:'physical-compile',elapsedMs:performance.now()-compileStart,completed:compiled});}
}
