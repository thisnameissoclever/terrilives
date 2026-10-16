import type {CharacterAppearanceV1} from '../src/character/schema.js';
import {makeSeatContactInput,validateSeatContactArtifact} from '../src/render/character/seat-contact-protocol.js';
import {seatContactAppearanceKey} from '../src/render/character/seat-contact-identity.js';
import {SEAT_ACTIONS,SEAT_CONTACT_SOLVER_REVISION,type SeatContactInputV1,type SeatContactArtifactV1} from '../src/render/character/seat-contact-types.js';
export function seatInput(appearance:CharacterAppearanceV1){return makeSeatContactInput({version:1,solverRevision:SEAT_CONTACT_SOLVER_REVISION,appearance,appearanceKey:seatContactAppearanceKey(appearance),revisions:{source:'test',body:'body',clips:'clips'}});}
export function seatArtifact(input:SeatContactInputV1):SeatContactArtifactV1 {const artifact={...input,clips:Object.fromEntries(SEAT_ACTIONS.map(action=>[action,{action,source:'test',partKey:'parts',shapeKey:'shape',lowerKey:'lower',top:2,fit:{pelvis:[0,0,0],legs:Array.from({length:6},()=>new Array(16).fill(0))}}]))};validateSeatContactArtifact(artifact);return artifact;}
