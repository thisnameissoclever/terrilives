import {
  VISUAL_ACTION_EAT,
  VISUAL_ACTION_EXERCISE,
  VISUAL_ACTION_READ,
  VISUAL_ACTION_SLEEP,
  VISUAL_ACTION_STANDING_READ,
  VISUAL_ACTION_TALK,
  VISUAL_ACTION_WALK,
} from '../frame.js';
import type {
  ConversationVoicePair,
  SimActivityAudioState,
} from './activity-cues.js';
export interface SimAudioFrameSource {
  readonly count: number;
  positions(): Float32Array;
  simIds(): Uint32Array;
  visualActions(): Uint32Array;
  soundActions(): Uint32Array;
  soundSources(): Uint32Array;
  voiceFirsts(): Uint32Array;
  voiceSeconds(): Uint32Array;
}

export interface SimAudioFrameSink {
  beginFootstepFrame(): void;
  observeFootstep(simId: number, x: number, y: number, walking: boolean): void;
  endFootstepFrame(): void;
  beginActivityFrame(): void;
  observeActivity(
    simId: number,
    activity: SimActivityAudioState,
    voice?: ConversationVoicePair,
  ): void;
  endActivityFrame(): void;
  beginObjectSoundFrame(): void;
  observeObjectSound(sourceId: number, action: number): void;
  endObjectSoundFrame(): void;
}

const NO_SIM_ID = 0xffff_ffff;
/** Matches `render_buffer::NO_VOICE_CLIP`: this row is not in a talk. */
const NO_VOICE_CLIP = 0xffff_ffff;

/**
 * Samples stable Sim identity, travel, and authored activity after one fixed
 * tick.
 *
 * This is deliberately columnar. It creates no per-Sim object or array, and it
 * re-reads every WASM-backed view after the tick that may have grown memory.
 * Stable ids come from the render buffer's aligned identity column; using an
 * entity id or row as identity would swap footsteps between people after Load.
 */
export function sampleSimAudioAfterTick(
  source: SimAudioFrameSource,
  sink: SimAudioFrameSink,
): void {
  const count = source.count;
  const positions = source.positions();
  const simIds = source.simIds();
  const visualActions = source.visualActions();
  const soundActions = source.soundActions();
  const soundSources = source.soundSources();
  const voiceFirsts = source.voiceFirsts();
  const voiceSeconds = source.voiceSeconds();

  sink.beginFootstepFrame();
  try {
    sink.beginActivityFrame();
    try {
      sink.beginObjectSoundFrame();
      try {
        for (let row = 0; row < count; row += 1) {
          const soundAction = soundActions[row];
          const soundSource = soundSources[row];
          if (soundAction !== 0 && soundSource !== NO_SIM_ID) {
            sink.observeObjectSound(soundSource, soundAction);
          }
          const simId = simIds[row];
          if (simId === NO_SIM_ID) continue;
          const visualAction = visualActions[row];
          sink.observeFootstep(
            simId,
            positions[row * 2],
            positions[row * 2 + 1],
            visualAction === VISUAL_ACTION_WALK,
          );
          const activity = activityForVisualAction(visualAction);
          if (activity !== 'other') {
            // Both talkers carry the pair, so whichever row the scheduler
            // picks to speak for the conversation finds it. A row that is
            // talking but carries no pair is a pack with no recordings,
            // which is silent rather than broken.
            const first = voiceFirsts[row];
            const second = voiceSeconds[row];
            const voice =
              activity === 'conversation' &&
              first !== NO_VOICE_CLIP &&
              second !== NO_VOICE_CLIP
                ? { first, second }
                : undefined;
            sink.observeActivity(simId, activity, voice);
          }
        }
      } finally {
        sink.endObjectSoundFrame();
      }
    } finally {
      sink.endActivityFrame();
    }
  } finally {
    sink.endFootstepFrame();
  }
}

function activityForVisualAction(visualAction: number): SimActivityAudioState {
  if (visualAction === VISUAL_ACTION_TALK) return 'conversation';
  if (visualAction === VISUAL_ACTION_SLEEP) return 'sleep';
  if (visualAction === VISUAL_ACTION_EAT) return 'eating';
  if (
    visualAction === VISUAL_ACTION_READ ||
    visualAction === VISUAL_ACTION_STANDING_READ
  ) {
    return 'reading';
  }
  if (visualAction === VISUAL_ACTION_EXERCISE) return 'exercise';
  return 'other';
}
