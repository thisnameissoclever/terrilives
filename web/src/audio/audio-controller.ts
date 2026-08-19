import {
  ProceduralCuePlayer,
  type GainNodePort,
  type ProceduralAudioContext,
  type ProceduralCue,
} from './procedural-cues.js';
import { FootstepScheduler } from './footsteps.js';

export const AUDIO_PREFERENCES_KEY = 'terrilives.audio-preferences.v1';
export const AUDIO_PREFERENCES_VERSION = 1;
export const DEFAULT_EFFECTS_LEVEL = 0.7;

export interface AudioPreferences {
  readonly muted: boolean;
  readonly effectsLevel: number;
}

interface StoredAudioPreferences extends AudioPreferences {
  readonly version: typeof AUDIO_PREFERENCES_VERSION;
}

export interface AudioPreferenceStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export interface BrowserAudioContext extends ProceduralAudioContext {
  readonly destination: unknown;
  readonly state: AudioContextState;
  close(): Promise<void>;
  resume(): Promise<void>;
  suspend(): Promise<void>;
}

export type AudioContextFactory = () => BrowserAudioContext;

export type GameAudioEvent =
  /** The command entered the simulation queue, but has not drained yet. */
  | { readonly type: 'command.staged' }
  | { readonly type: 'command.rejected' }
  /** An immediate UI control completed without a deferred simulation result. */
  | { readonly type: 'ui.confirmed' }
  | {
      readonly type: 'sim.footstep';
      readonly simId: number;
      readonly stepIndex: number;
    }
  | { readonly type: 'door.opened'; readonly doorId: string }
  | { readonly type: 'door.closed'; readonly doorId: string };

export interface GameAudioEventSink {
  emit(event: GameAudioEvent): void;
}

export type AudioResetBoundary = 'load' | 'background';

export function createBrowserAudioContext(): BrowserAudioContext {
  return new AudioContext() as unknown as BrowserAudioContext;
}

export function browserAudioPreferenceStore(): AudioPreferenceStore | undefined {
  try {
    return globalThis.localStorage;
  } catch {
    return undefined;
  }
}

/**
 * Owns browser audio state without owning DOM listeners or simulation state.
 * Call `unlockFromGesture` only inside a trusted pointer or keyboard handler.
 */
export class AudioController implements GameAudioEventSink {
  private mutedPreference: boolean;
  private effectsLevelPreference: number;
  private context: BrowserAudioContext | null = null;
  private masterGain: GainNodePort | null = null;
  private effectsGain: GainNodePort | null = null;
  private player: ProceduralCuePlayer | null = null;
  private unlockAttempt: Promise<boolean> | null = null;
  private hasUnlocked = false;
  private backgrounded = false;
  private contextStateRevision = 0;
  private contextStateTail: Promise<void> = Promise.resolve();
  private readonly footsteps: FootstepScheduler;

  constructor(
    private readonly createContext: AudioContextFactory = createBrowserAudioContext,
    private readonly store: AudioPreferenceStore | undefined = browserAudioPreferenceStore(),
  ) {
    const preferences = readPreferences(store);
    this.mutedPreference = preferences.muted;
    this.effectsLevelPreference = preferences.effectsLevel;
    this.footsteps = new FootstepScheduler(this);
  }

  preferences(): AudioPreferences {
    return {
      muted: this.mutedPreference,
      effectsLevel: this.effectsLevelPreference,
    };
  }

  isUnlocked(): boolean {
    return !this.backgrounded && this.context?.state === 'running';
  }

  /**
   * Creates or resumes the context. This method never runs from `emit`, so a
   * background event cannot consume the browser's user-activation allowance.
   */
  unlockFromGesture(): Promise<boolean> {
    if (this.backgrounded) return Promise.resolve(false);
    if (this.unlockAttempt !== null) return this.unlockAttempt;

    const attempt = this.resumeFromGesture();
    this.unlockAttempt = attempt;
    void attempt.finally(() => {
      if (this.unlockAttempt === attempt) this.unlockAttempt = null;
    });
    return attempt;
  }

  setMuted(muted: boolean): void {
    this.mutedPreference = muted;
    this.applyMasterGain();
    this.persist();
    if (muted) this.player?.stopAll();
  }

  isMuted(): boolean {
    return this.mutedPreference;
  }

  setEffectsLevel(level: number): void {
    this.previewEffectsLevel(level);
    this.persist();
  }

  /** Applies a live slider preview without writing storage on every pixel. */
  previewEffectsLevel(level: number): void {
    this.effectsLevelPreference = clampLevel(level);
    this.applyEffectsGain();
    if (this.effectsLevelPreference === 0) this.player?.stopAll();
  }

  effectsLevel(): number {
    return this.effectsLevelPreference;
  }

  emit(event: GameAudioEvent): void {
    if (
      !this.isUnlocked() ||
      this.mutedPreference ||
      this.effectsLevelPreference === 0
    ) {
      return;
    }

    const cue = cueForEvent(event);
    const pitchScale =
      event.type === 'sim.footstep'
        ? footstepPitchScale(event.simId, event.stepIndex)
        : 1;
    try {
      this.player?.play(cue, pitchScale);
    } catch {
      // Sound is presentation. A browser node failure may drop one cue but may
      // never terminate the simulation frame that observed it.
    }
  }

  beginFootstepFrame(): void {
    this.footsteps.beginFrame();
  }

  observeFootstep(simId: number, x: number, y: number, walking: boolean): void {
    this.footsteps.observe(simId, x, y, walking);
  }

  endFootstepFrame(): void {
    this.footsteps.endFrame();
  }

  /**
   * Gates sound synchronously, then serializes hardware suspend or resume.
   * The latest desired visibility wins even if an older browser promise settles
   * late. A foreground transition resumes only a previously gesture-unlocked
   * context; it never creates one on its own.
   */
  setBackgrounded(backgrounded: boolean): Promise<boolean> {
    this.backgrounded = backgrounded;
    // Clear on both edges. Hidden fixed ticks may still sample positions after
    // the first reset; the foreground reset makes the first audible tick a new
    // anchor instead of completing a stride travelled while inaudible.
    this.footsteps.reset();
    if (backgrounded) {
      this.player?.stopAll();
    }

    const revision = this.contextStateRevision + 1;
    this.contextStateRevision = revision;
    const transition = this.contextStateTail.then(async () => {
      if (revision !== this.contextStateRevision) return false;
      const context = this.context;
      if (context === null) return backgrounded;
      try {
        if (this.backgrounded) {
          if (context.state === 'running') await context.suspend();
        } else if (this.hasUnlocked && context.state !== 'running') {
          await context.resume();
        }
      } catch {
        return false;
      }
      if (revision !== this.contextStateRevision) return false;
      return this.backgrounded
        ? context.state !== 'running'
        : this.hasUnlocked && context.state === 'running';
    });
    this.contextStateTail = transition.then(
      () => undefined,
      () => undefined,
    );
    return transition;
  }

  /**
   * Drops active voices and movement history at discontinuities. The next
   * footstep update only anchors positions, so Load and tab restoration cannot
   * replay distance travelled while audio was inactive.
   */
  reset(boundary: AudioResetBoundary): void {
    if (boundary === 'background') {
      void this.setBackgrounded(true);
      return;
    }
    this.player?.stopAll();
    this.footsteps.reset();
  }

  activeVoiceCount(): number {
    return this.player?.activeVoiceCount() ?? 0;
  }

  activeFootstepTrackCount(): number {
    return this.footsteps.activeTrackCount();
  }

  footstepTrackCapacity(): number {
    return this.footsteps.trackCapacity();
  }

  private async resumeFromGesture(): Promise<boolean> {
    if (this.context === null) {
      let context: BrowserAudioContext | null = null;
      let masterGain: GainNodePort | null = null;
      let effectsGain: GainNodePort | null = null;
      try {
        context = this.createContext();
        masterGain = context.createGain();
        effectsGain = context.createGain();
        effectsGain.connect(masterGain);
        masterGain.connect(context.destination);
        this.context = context;
        this.masterGain = masterGain;
        this.effectsGain = effectsGain;
        this.player = new ProceduralCuePlayer(context, effectsGain);
        this.applyMasterGain();
        this.applyEffectsGain();
      } catch {
        safelyDisconnect(effectsGain);
        safelyDisconnect(masterGain);
        this.context = null;
        this.masterGain = null;
        this.effectsGain = null;
        this.player = null;
        if (context !== null) {
          try {
            await context.close();
          } catch {
            // A failed graph has already been abandoned. Closing is best effort.
          }
        }
        return false;
      }
    }

    const context = this.context;
    if (context === null || this.backgrounded) return false;
    if (context.state !== 'running') {
      try {
        await context.resume();
      } catch {
        return false;
      }
    }
    if (this.backgrounded) {
      try {
        if (context.state === 'running') await context.suspend();
      } catch {
        return false;
      }
      return false;
    }

    const running = context.state === 'running';
    if (running && !this.hasUnlocked) {
      this.hasUnlocked = true;
      this.footsteps.reset();
    }
    return running;
  }

  private applyMasterGain(): void {
    if (this.masterGain === null || this.context === null) return;
    const gain = this.mutedPreference ? 0 : 1;
    this.masterGain.gain.cancelScheduledValues(this.context.currentTime);
    this.masterGain.gain.setValueAtTime(gain, this.context.currentTime);
  }

  private applyEffectsGain(): void {
    if (this.effectsGain === null || this.context === null) return;
    this.effectsGain.gain.cancelScheduledValues(this.context.currentTime);
    this.effectsGain.gain.setValueAtTime(
      this.effectsLevelPreference,
      this.context.currentTime,
    );
  }

  private persist(): void {
    const value: StoredAudioPreferences = {
      version: AUDIO_PREFERENCES_VERSION,
      muted: this.mutedPreference,
      effectsLevel: this.effectsLevelPreference,
    };
    try {
      this.store?.setItem(AUDIO_PREFERENCES_KEY, JSON.stringify(value));
    } catch {
      // Storage denial must not undo a usable in-memory choice for this session.
    }
  }
}

function safelyDisconnect(node: GainNodePort | null): void {
  if (node === null) return;
  try {
    node.disconnect();
  } catch {
    // Graph construction already failed. Cleanup remains best effort so the
    // original browser failure cannot escape the gesture handler.
  }
}

function cueForEvent(event: GameAudioEvent): ProceduralCue {
  switch (event.type) {
    case 'command.staged':
    case 'ui.confirmed':
      return 'accepted';
    case 'command.rejected':
      return 'rejected';
    case 'sim.footstep':
      return 'footstep';
    case 'door.opened':
      return 'door-opened';
    case 'door.closed':
      return 'door-closed';
  }
}

function footstepPitchScale(simId: number, stepIndex: number): number {
  const phase = (Math.trunc(simId) * 17 + Math.trunc(stepIndex) * 31) & 3;
  return 0.94 + phase * 0.035;
}

function clampLevel(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_EFFECTS_LEVEL;
  return Math.min(1, Math.max(0, value));
}

function readPreferences(store: AudioPreferenceStore | undefined): AudioPreferences {
  const fallback = { muted: false, effectsLevel: DEFAULT_EFFECTS_LEVEL };
  try {
    const raw = store?.getItem(AUDIO_PREFERENCES_KEY);
    if (raw === undefined || raw === null) return fallback;
    const parsed = JSON.parse(raw) as Partial<StoredAudioPreferences>;
    if (
      parsed.version !== AUDIO_PREFERENCES_VERSION ||
      typeof parsed.muted !== 'boolean' ||
      typeof parsed.effectsLevel !== 'number' ||
      !Number.isFinite(parsed.effectsLevel) ||
      parsed.effectsLevel < 0 ||
      parsed.effectsLevel > 1
    ) {
      return fallback;
    }
    return { muted: parsed.muted, effectsLevel: parsed.effectsLevel };
  } catch {
    return fallback;
  }
}
