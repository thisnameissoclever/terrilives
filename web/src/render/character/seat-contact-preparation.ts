import manifest from '../../../../assets/models/sims/character-creator/export/manifest.json';
import library from '../../../../assets/models/sims/character-creator/clips/clips.json';
import dining from '../../../../assets/models/sims/character-creator/clips/dining/parts.json';
import armchair from '../../../../assets/models/sims/character-creator/clips/seat_armchair/parts.json';
import reading from '../../../../assets/models/sims/character-creator/clips/seat_reading/parts.json';
import chair from '../../../../assets/models/sims/character-creator/clips/seat_dining/parts.json';
import office from '../../../../assets/models/sims/character-creator/clips/seat_office/parts.json';
import ottoman from '../../../../assets/models/sims/character-creator/clips/seat_ottoman/parts.json';
import sofa from '../../../../assets/models/sims/character-creator/clips/seat_sofa/parts.json';
import type {CharacterAppearanceV1} from '../../character/schema.js';
import {canonicalSeatValue,seatContactAppearance,seatContactAppearanceKey} from './seat-contact-identity.js';
import {sleepContactDigest} from './sleep-contact-protocol.js';
import {makeSeatContactInput,verifySeatContactInput} from './seat-contact-protocol.js';
import {compileSeatContact} from './seat-contact-compile.js';
import {SEAT_ACTIONS,SEAT_CONTACT_SOLVER_REVISION,type SeatContactRevisions,type SeatContactInputV1,type SeatContactArtifactV1,type SeatContactSources} from './seat-contact-types.js';
export {seatContactAppearanceKey} from './seat-contact-identity.js';
let revisions:Promise<SeatContactRevisions>|undefined;
export function seatContactSourceRevisions():Promise<SeatContactRevisions>{return revisions??=(async()=>({source:manifest.sourceSha256,body:await sleepContactDigest(manifest),
  clips:await sleepContactDigest({sources:library.sources,clips:SEAT_ACTIONS.map(action=>library.clips[action]),parts:{dining,armchair,reading,chair,office,ottoman,sofa}})}))().catch(error=>{revisions=undefined;throw error;});}
export async function createSeatContactInput(appearance:CharacterAppearanceV1):Promise<SeatContactInputV1>{const normalized=seatContactAppearance(appearance);return makeSeatContactInput({version:1,solverRevision:SEAT_CONTACT_SOLVER_REVISION,appearance:normalized,appearanceKey:seatContactAppearanceKey(normalized),revisions:await seatContactSourceRevisions()});}
/** Asset loading and configured body construction stay in the existing single worker. */
export async function prepareSeatContact(input:SeatContactInputV1):Promise<SeatContactArtifactV1>{await verifySeatContactInput(input);const revisions=await seatContactSourceRevisions();if(canonicalSeatValue(revisions)!==canonicalSeatValue(input.revisions))throw new Error('Seated source revisions do not match this worker.');
  const {loadCreatorRig}=await import('./creator-assets.js'),rigs=Object.fromEntries(await Promise.all(SEAT_ACTIONS.map(async action=>[action,await loadCreatorRig(action)]))) as SeatContactSources['rigs'];return compileSeatContact(input,{rigs,revisions});}
