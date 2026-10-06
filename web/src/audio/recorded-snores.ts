import type { RecordedCuePolicy } from './recorded-cues.js';

/**
 * Five snores cut from one CC0 recording; see ASSETS.md, "Sleeping snore
 * recordings". Each clip's loud part is level-matched, so one gain serves all.
 */
export const SNORE_CLIP_URLS: readonly string[] = [1, 2, 3, 4, 5]
  .map((index) => `audio/sleep/snore-${index}.wav`);

/**
 * The clips' loud parts sit at RMS 0.1. A gain of 0.05 puts them near RMS
 * 0.005 before Effects, the level of the flush, sink, stove and conversation
 * recordings. One snore at a time, at most one start every six real seconds:
 * the recorded sleeper's own rhythm, kept at every game speed.
 */
export const SNORE_POLICY: RecordedCuePolicy = {
  gain: 0.05,
  maxVoices: 1,
  maxClipSeconds: 8,
  minStartIntervalSeconds: 6,
};
