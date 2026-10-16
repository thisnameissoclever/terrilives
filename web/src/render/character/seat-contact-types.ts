import type {CharacterAppearanceV1} from '../../character/schema.js';
import type {CharacterRig} from './clip-runtime.js';
import type {fitSeatedPose,SeatedPoseFit} from './seat-fit.js';

export const SEAT_CONTACT_SOLVER_REVISION='stationary-lower-seat-v1';
export const SEAT_ACTIONS=['seated_eat','seat_armchair_sit','seat_armchair_read','seat_reading_sit','seat_reading_read','seat_dining_sit','seat_dining_read','seat_office_sit','seat_office_read','seat_ottoman_sit','seat_ottoman_read','seat_sofa_sit','seat_sofa_read'] as const;
export type SeatAction=typeof SEAT_ACTIONS[number];
export type SeatFitResolver=typeof fitSeatedPose;
export interface SeatContactRevisions {source:string;body:string;clips:string}
export interface SeatContactInputDataV1 {version:1;solverRevision:typeof SEAT_CONTACT_SOLVER_REVISION;appearance:CharacterAppearanceV1;appearanceKey:string;revisions:SeatContactRevisions}
export interface SeatContactInputV1 extends SeatContactInputDataV1 {key:string}
export interface SeatClipArtifactV1 {action:SeatAction;source:string;partKey:string;shapeKey:string;lowerKey:string;top:number;fit:SeatedPoseFit}
export interface SeatContactArtifactV1 {version:1;solverRevision:typeof SEAT_CONTACT_SOLVER_REVISION;key:string;appearanceKey:string;revisions:SeatContactRevisions;clips:Readonly<Record<SeatAction,SeatClipArtifactV1>>}
export interface SeatContactSources {rigs:Readonly<Record<SeatAction,CharacterRig>>;revisions:SeatContactRevisions}
