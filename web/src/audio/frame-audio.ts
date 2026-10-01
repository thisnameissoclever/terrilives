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
import type { AudioController } from './audio-controller.js';
import type { SpeedDriver } from '../ui/overlay-pause.js';

/** Shares effective pause across manual speed selection and blocking overlays. */
export function withObjectSoundPause(
  driver: SpeedDriver,
  audio: Pick<AudioController, 'setObjectSoundsPaused'>,
): SpeedDriver {
  return { setSpeed(multiplier) {
    driver.setSpeed(multiplier);
    audio.setObjectSoundsPaused(multiplier === 0);
  } };
}

export interface SimAudioFrameSource {
  readonly count: number;
  positions(): Float32Array;
  simIds(): Uint32Array;
  visualActions(): Uint32Array;
  soundActions(): Uint32Array;
  soundSources(): Uint32Array;
  voiceFirsts(): Uint32Array;
  voiceSeconds(): Uint32Array;
  conversationOwners(): Uint32Array;
  conversationEndLows(): Uint32Array;
  conversationEndHighs(): Uint32Array;
}

export interface SimAudioFrameSink {
  observeRunningWorld(): void;
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
export interface PortalAudioFrameSource {
  readonly portalCount: number;
  portalPositions(): Float32Array;
  portalFarSides(): Float32Array;
  portalStates(): Uint32Array;
}

export interface PortalAudioFrameSink {
  beginPortalFrame(): void;
  observePortal(x: number, y: number, farX: number, farY: number, state: number): void;
  endPortalFrame(): void;
}

/** Acquire fresh WASM views after each fixed tick, independently of Sim rows. */
export function samplePortalAudioAfterTick(source: PortalAudioFrameSource, sink: PortalAudioFrameSink): void {
  const count = source.portalCount;
  const positions = source.portalPositions();
  const farSides = source.portalFarSides();
  const states = source.portalStates();
  sink.beginPortalFrame();
  try {
    for (let row = 0; row < count; row++) {
      sink.observePortal(positions[row * 2], positions[row * 2 + 1],
        farSides[row * 2], farSides[row * 2 + 1], states[row]);
    }
  } finally {
    sink.endPortalFrame();
  }
}
/** Matches `render_buffer::NO_VOICE_CLIP`: this row is not in a talk. */
const NO_VOICE_CLIP = 0xffff_ffff;

/**
 * Samples stable Sim identity, travel, and authored activity after one fixed
 * tick.
 *
 * This re-reads every columnar WASM view after ticks that may grow memory.
 * Only talking rows allocate their small conversation observation object.
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
  const conversationOwners = source.conversationOwners();
  const conversationEndLows = source.conversationEndLows();
  const conversationEndHighs = source.conversationEndHighs();

  sink.observeRunningWorld();

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
            // Both participants carry the same authoritative instance. A
            // talk with no recordings or no owner stays silent.
            const first = voiceFirsts[row];
            const second = voiceSeconds[row];
            const owner = conversationOwners[row];
            const voice =
              activity === 'conversation' &&
              owner !== NO_SIM_ID &&
              first !== NO_VOICE_CLIP &&
              second !== NO_VOICE_CLIP
                ? { owner, endLow: conversationEndLows[row], endHigh: conversationEndHighs[row], first, second }
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
