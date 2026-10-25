import type {CharacterAppearanceV1} from '../../character/schema.js';
import {poolContactAppearanceKey} from './pool-contact-identity.js';
import {createPoolContactInput} from './pool-contact-preparation.js';
import {freezePoolContactArtifact,validatePoolArtifactForInput,verifyPoolContactInput} from './pool-contact-protocol.js';
import type {PoolContactInputV1,PoolContactArtifactV1} from './pool-contact-types.js';
import type {PreparationDefinition} from './preparation-queue.js';
import {awaitPreparation} from './preparation-abort.js';

export interface PoolContactResourceOptions {
  compile(input:PoolContactInputV1,signal:AbortSignal):Promise<unknown>;
  inputFactory?:(appearance:CharacterAppearanceV1)=>Promise<PoolContactInputV1>;
}

/** The shared serial queue owns input work, cancellation and complete-artifact validation. */
export function poolContactResource(options:PoolContactResourceOptions):PreparationDefinition<PoolContactArtifactV1> {
  return {key:appearance=>'pool:'+poolContactAppearanceKey(appearance),prepare:async(appearance,work)=>{
    work.inputPrepared();
    const input=await awaitPreparation((options.inputFactory??createPoolContactInput)(appearance),work.signal);
    await awaitPreparation(verifyPoolContactInput(input),work.signal);
    if(input.appearanceKey!==poolContactAppearanceKey(appearance))throw new Error('Pool input does not match the requested physical appearance.');
    const saved=work.findReady(input.key);
    if(saved){validatePoolArtifactForInput(saved,input);return freezePoolContactArtifact(saved);}
    work.compiled();
    const artifact=await awaitPreparation(options.compile(input,work.signal),work.signal);
    validatePoolArtifactForInput(artifact,input);return freezePoolContactArtifact(artifact);
  }};
}
