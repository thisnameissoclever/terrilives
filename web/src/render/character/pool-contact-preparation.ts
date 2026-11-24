import {decodePoolRoute,fetchPoolReleaseBytes,loadBundledPoolArtifact} from './pool-bundled-artifact.js';
import {poolContactFixture,poolContactRelease} from './pool-contact-release.js';
export {poolContactFixture} from './pool-contact-release.js';
import {PoolCycleSource,validatePoolCycleDefinition} from './pool-cycle-source.js';
import type {PoolCycleDiagnostic} from './pool-cycle-compiler.js';
import {compileOwnedPoolCycle,type PoolOwnedCompilationCounters} from './pool-owned-compilation.js';
import manifest from '../../../../assets/models/sims/character-creator/export/manifest.json';
import library from '../../../../assets/models/sims/character-creator/clips/clips.json';
import parts from '../../../../assets/models/sims/character-creator/clips/pool/parts.json';
import policy from '../../../../assets/models/sims/character-creator/pool-surface-policy-v1.json';
import type {CharacterAppearanceV1} from '../../character/schema.js';
import {canonicalPoolValue,poolContactAppearance,poolContactAppearanceKey,poolPartKey,poolShapeIdentity} from './pool-contact-identity.js';
import type {PoolShapePlayback} from './pool-contact-types.js';
import type {SharedPoolRoute,SplitPoolRoute} from './pool-shape-route.js';
import {freezePoolPlayback,makePoolContactInput,verifyPoolContactInput,POOL_ACTIONS} from './pool-contact-protocol.js';
import {sleepContactDigest} from './sleep-contact-protocol.js';
import {POOL_SOLVER_REVISION,POOL_OBSERVER_REVISION,POOL_INTERPOLATION_REVISION,type PoolContactInputV1,type PoolContactRevisions} from './pool-contact-types.js';
import {PreparedBody} from './prepared-body.js';
import {anatomicalHeight} from './shape.js';
import {requirePoolOuterTransfer} from './pool-exit-transfer.js';

let revisions:Promise<PoolContactRevisions>|undefined;
export function poolContactSourceRevisions():Promise<PoolContactRevisions> {
  return revisions??=(async()=>({body:await sleepContactDigest(manifest),garments:await sleepContactDigest({parts,policy}),
    clips:await sleepContactDigest({definition:poolContactRelease.motion,...(poolContactRelease.selection?{selectedRoute:poolContactRelease.selection.sourceText}:poolContactRelease.family?{family:poolContactRelease.family.sha256}:{}),sources:library.sources,clips:POOL_ACTIONS.map(action=>library.clips[action as keyof typeof library.clips])}),
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
  const fixture=poolContactFixture(),definition=poolContactRelease.motion;
  validatePoolCycleDefinition(definition);
  requirePoolOuterTransfer(definition,fixture);
  const digest=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(poolContactRelease.motionText))),v=>v.toString(16).padStart(2,'0')).join('');
  if(digest!==fixture.revisions.poseProducer||canonicalPoolValue(library.clips.pool_enter.samples[0])!==canonicalPoolValue(definition.reference.neutralSample))throw new Error('Pool source revision or anatomical reference differs from the fixture.');
  if(canonicalPoolValue(input.revisions)!==canonicalPoolValue(await poolContactSourceRevisions()))throw new Error('Pool source revisions do not match this worker.');
  const {loadCreatorRig}=await import('./creator-assets.js'),rig=await loadCreatorRig('pool_enter');
  const appearance=input.appearance,selection=new PreparedBody(rig.base,appearance).select(rig,appearance,{wear:'bare',prop:'none',fixture:'none',
    eyes_closed:false,includeFixture:false,clip:'pool_enter',swimwear:appearance.presentation==='feminine'?'two_piece':'trunks'});
  if(!selection.extra||selection.variants.length)throw new Error('Pool preparation requires an explicitly supported complete physical selection.');
  return {definition,rig,geometry:[selection.body,selection.extra],fixture,
    shape:{presentation:appearance.presentation,...appearance.body,face:appearance.face},top:anatomicalHeight(rig.base.vertices)};
}

export interface PoolPreparationDiagnostics {
  observation?:(row:PoolCycleDiagnostic)=>void;
  counters?:(summary:PoolOwnedCompilationCounters)=>void;
  stage?:(row:{stage:'source-load'|'physical-compile'|'bundled-load'|'shape-route';elapsedMs:number;completed:boolean})=>void;
}

let familyTemplate:Promise<SharedPoolRoute|SplitPoolRoute>|undefined;
function installedFamily(){
  const family=poolContactRelease.family;
  if(!family)throw new Error('No pool shape family is installed.');
  return familyTemplate??=fetchPoolReleaseBytes(family).then(bytes=>{
    if(!bytes)throw new Error('The installed pool shape route is missing.');
    return decodePoolRoute(bytes) as SharedPoolRoute|SplitPoolRoute;
  }).catch(error=>{familyTemplate=undefined;throw error;});
}

export async function preparePoolContact(input:PoolContactInputV1,diagnostics?:PoolPreparationDiagnostics){
  const catalog=poolContactRelease.bundled;
  if(catalog?.some(record=>record.key===input.key)){
    await verifyPoolContactInput(input);
    if(canonicalPoolValue(input.revisions)!==canonicalPoolValue(await poolContactSourceRevisions()))
      throw new Error('Bundled pool request has stale source revisions.');
    const started=performance.now();let completed=false;
    try{
      const artifact=await loadBundledPoolArtifact(input,catalog);
      if(artifact){completed=true;return artifact;}
    }finally{diagnostics?.stage?.({stage:'bundled-load',elapsedMs:performance.now()-started,completed});}
  }
  const family=poolContactRelease.family;
  if(!family)return compilePoolContact(input,diagnostics);
  const started=performance.now();let completed=false;
  try{
    const src=await loadPoolContactSources(input);
    const {PoolShapeRouteSampler}=await import('./pool-shape-route.js');
    const source=new PoolCycleSource(src.rig.manifest,src.shape,src.top,src.geometry,src.fixture,src.definition);
    const sampler=new PoolShapeRouteSampler(source,await installedFamily());
    const artifact:PoolShapePlayback={kind:'configured-shape',family:family.sha256,version:1,solverRevision:input.solverRevision,
      key:input.key,revisions:input.revisions,appearanceKey:input.appearanceKey,source:src.rig.manifest.sourceSha256,
      partKeys:src.geometry.map(poolPartKey),shapeKey:poolShapeIdentity(src.shape,src.top),top:src.top,
      waterHeight:src.fixture.waterHeight,graph:sampler.configuredGraph()};
    const playback=freezePoolPlayback(artifact);completed=true;return playback;
  }finally{diagnostics?.stage?.({stage:'shape-route',elapsedMs:performance.now()-started,completed});}
}

/** Build a complete artifact using the real worker compiler even when that release also ships packets. */
export async function compilePoolContact(input:PoolContactInputV1,diagnostics?:PoolPreparationDiagnostics){
  const loadStart=performance.now();let loaded=false;
  const source=await (async()=>{
    try{const value=await loadPoolContactSources(input);loaded=true;return value;}
    finally{diagnostics?.stage?.({stage:'source-load',elapsedMs:performance.now()-loadStart,completed:loaded});}
  })();
  const compileStart=performance.now();let compiled=false;
  try{
    const {definition,rig,shape,top,geometry,fixture}=source;
    let select=poolContactRelease.selection?.select;
    if(!select&&poolContactRelease.family){
      const route=await installedFamily();
      if(route.version!==2)throw new Error('The installed pool motion requires a complete selected physical route.');
      const {selectSplitPoolHop}=await import('./pool-shape-route.js');
      select=(request,owner)=>selectSplitPoolHop(request,owner,route);
    }
    if(definition.version===16&&!select)throw new Error('The installed motion lacks its selected complete pool route.');
    const artifact=compileOwnedPoolCycle(input,{bundle:rig.manifest,shape,top,geometry,fixture},definition,diagnostics?.observation,diagnostics?.counters,select);
    compiled=true;return artifact;
  }finally{diagnostics?.stage?.({stage:'physical-compile',elapsedMs:performance.now()-compileStart,completed:compiled});}
}
