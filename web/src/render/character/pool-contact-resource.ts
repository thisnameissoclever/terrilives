import type {CharacterAppearanceV1} from '../../character/schema.js';
import {poolContactAppearanceKey} from './pool-contact-identity.js';
import {createPoolContactInput,loadPoolContactSources} from './pool-contact-preparation.js';
import {freezePoolPlayback,requirePoolPlaybackInput,verifyPoolContactInput} from './pool-contact-protocol.js';
import {isPoolShapePlayback,type PoolContactInputV1,type PoolPlayback} from './pool-contact-types.js';
import {poolContactRelease,poolContactTakeoffPhase} from './pool-contact-release.js';
import {preparePoolRendererBinding} from './pool-contact-sample.js';
import type {PreparationDefinition} from './preparation-queue.js';
import {awaitPreparation} from './preparation-abort.js';

export interface PoolContactResourceOptions {
  compile(input:PoolContactInputV1,signal:AbortSignal):Promise<unknown>;
  inputFactory?:(appearance:CharacterAppearanceV1)=>Promise<PoolContactInputV1>;
}

/** The shared serial queue owns input work, cancellation and complete-artifact validation. */
export function poolContactResource(options:PoolContactResourceOptions):PreparationDefinition<PoolPlayback> {
  return {key:appearance=>'pool:'+poolContactAppearanceKey(appearance),prepare:async(appearance,work)=>{
    work.inputPrepared();
    const input=await awaitPreparation((options.inputFactory??createPoolContactInput)(appearance),work.signal);
    await awaitPreparation(verifyPoolContactInput(input),work.signal);
    if(input.appearanceKey!==poolContactAppearanceKey(appearance))throw new Error('Pool input does not match the requested physical appearance.');
    const saved=work.findReady(input.key);
    if(!saved)work.compiled();
    const artifact=freezePoolPlayback(saved??await awaitPreparation(options.compile(input,work.signal),work.signal));
    if(isPoolShapePlayback(artifact)&&artifact.family!==poolContactRelease.family?.sha256)
      throw new Error('Configured pool playback differs from the installed motion family.');
    requirePoolPlaybackInput(artifact,input);
    if(!saved&&(isPoolShapePlayback(artifact)||poolContactRelease.bundled?.some(row=>row.key===input.key))){
      const source=await awaitPreparation(loadPoolContactSources(input),work.signal);
      await preparePoolRendererBinding(work.signal,artifact,source.geometry[0],source.shape,source.top,source.geometry.slice(1),source.fixture,poolContactTakeoffPhase());
    }
    return artifact;
  }};
}
