import { OBJECT_SOUND_ACTION_SHOWER_WATER } from './object-cues.js';
import { prepareObjectLoopClips, type ObjectLoopClips } from './object-loops.js';
import type { AudioBufferPort } from './voice-clips.js';

/** Provisional recording catalog. Stove cooking has no selected recording. */
export async function loadObjectRecordings(
  fetchBytes: (url: string) => Promise<ArrayBuffer>,
  decode: (bytes: ArrayBuffer) => Promise<AudioBufferPort>,
): Promise<ObjectLoopClips> {
  const buffer = await decode(await fetchBytes('audio/objects/shower-water.wav'));
  return prepareObjectLoopClips(new Map([
    [OBJECT_SOUND_ACTION_SHOWER_WATER, { buffer, gain: 0.6, loopStart: 0, loopEnd: buffer.duration }],
  ]));
}
