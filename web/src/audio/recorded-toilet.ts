import type { RecordedCuePolicy } from './recorded-cues.js';

/**
 * The toilet flush after a completed use. Up to four flushes overlap, one per
 * toilet: the controller passes the toilet's object id as the player key, so
 * a toilet already flushing cannot start a second flush.
 */
export const TOILET_POLICY: RecordedCuePolicy = {
  gain: 0.08,
  maxVoices: 4,
  maxClipSeconds: 30,
  minStartIntervalSeconds: 0,
};
