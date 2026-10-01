import {
  OBJECT_SOUND_ACTION_SHOWER_WATER,
  OBJECT_SOUND_ACTION_SINK_WATER,
  OBJECT_SOUND_ACTION_STOVE_COOKING,
  type ObjectSoundAction,
} from './object-cues.js';
import { prepareObjectLoopClips, type ObjectLoopClips } from './object-loops.js';
import type { AudioBufferPort } from './voice-clips.js';

export const OBJECT_RECORDING_FAMILIES = ['water', 'stove'] as const;
export type ObjectRecordingFamily = typeof OBJECT_RECORDING_FAMILIES[number];

const RECORDINGS: Record<ObjectRecordingFamily, {
  readonly url: string;
  readonly gains: ReadonlyArray<readonly [ObjectSoundAction, number]>;
}> = {
  water: {
    url: 'audio/objects/shower-water.wav',
    gains: [[OBJECT_SOUND_ACTION_SHOWER_WATER, 0.6], [OBJECT_SOUND_ACTION_SINK_WATER, 0.35]],
  },
  stove: {
    url: 'audio/objects/stove-cooking.wav',
    gains: [[OBJECT_SOUND_ACTION_STOVE_COOKING, 0.6]],
  },
};

export function objectRecordingFamily(action: ObjectSoundAction): ObjectRecordingFamily | undefined {
  return OBJECT_RECORDING_FAMILIES.find(family =>
    RECORDINGS[family].gains.some(([candidate]) => candidate === action));
}

/** Decode one family; the two-argument form retains the original water catalog. */
export async function loadObjectRecordings(
  fetchBytes: (url: string) => Promise<ArrayBuffer>,
  decode: (bytes: ArrayBuffer) => Promise<AudioBufferPort>,
  family: ObjectRecordingFamily = 'water',
): Promise<ObjectLoopClips> {
  const recording = RECORDINGS[family];
  const buffer = await decode(await fetchBytes(recording.url));
  return prepareObjectLoopClips(new Map(recording.gains.map(([action, gain]) =>
    [action, { buffer, gain, loopStart: 0, loopEnd: buffer.duration }])));
}
