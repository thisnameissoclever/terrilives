import type {CharacterAppearanceV1} from '../../character/schema.js';
import type {CharacterRig} from './clip-runtime.js';

export const SLEEP_CONTACT_VERSION=1;
export const SLEEP_CONTACT_SOLVER_REVISION='static-sleep-and-draped-cover-v1';
export const SLEEP_ACTIONS=['bed_sleep','bunk_sleep'] as const;
export type SleepAction=typeof SLEEP_ACTIONS[number];
export interface SleepContactRevisions {source:string;body:string;bed:string;bunk:string}
export interface SleepContactInputDataV1 {
  version:1;solverRevision:typeof SLEEP_CONTACT_SOLVER_REVISION;appearanceKey:string;
  appearance:CharacterAppearanceV1;revisions:SleepContactRevisions;
}
export interface SleepContactInputV1 extends SleepContactInputDataV1 {key:string}
export interface SleepingCoverContribution {offsetX:number;heights:readonly number[]}
export interface SleepClipArtifactV1 {
  action:SleepAction;sourcePhase:0;source:string;partKey:string;shapeKey:string;top:number;
  matrices:readonly number[];covers:readonly SleepingCoverContribution[];
}
export interface SleepContactArtifactV1 {
  version:1;solverRevision:typeof SLEEP_CONTACT_SOLVER_REVISION;key:string;appearanceKey:string;
  revisions:SleepContactRevisions;clips:Readonly<Record<SleepAction,SleepClipArtifactV1>>;
}
export interface SleepContactSources {bed:CharacterRig;bunk:CharacterRig;revisions:SleepContactRevisions}
