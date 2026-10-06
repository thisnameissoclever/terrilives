import type { RecordedCuePolicy } from './recorded-cues.js';

/**
 * The closing door thunk. Up to four closings overlap; there is no length
 * limit beyond the decoder's own check, and no spacing between starts.
 */
export const DOOR_POLICY: RecordedCuePolicy = {
  gain: 0.05,
  maxVoices: 4,
  maxClipSeconds: Infinity,
  minStartIntervalSeconds: 0,
};
