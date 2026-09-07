import {
  ProceduralCuePlayer,
  type GainNodePort,
  type ProceduralAudioContext,
  type ProceduralCue,
} from './procedural-cues.js';
import {
  ActivityCueScheduler,
  type ActivityCueEvent,
  type SimActivityAudioState,
} from './activity-cues.js';
import { FootstepScheduler } from './footsteps.js';
import {
  ObjectSoundCueScheduler,
  type ObjectSoundCueEvent,
} from './object-cues.js';

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
  | ActivityCueEvent
  | ObjectSoundCueEvent
  | { readonly type: 'door.opened'; readonly doorId: string }
  | { readonly type: 'door.closed'; readonly doorId: string };

export interface GameAudioEventSink {
  emit(event: GameAudioEvent): void;
}

export interface AudioCuePlayCounts {
  readonly rejected: number;
  readonly footstep: number;
  readonly conversation: number;
  readonly 'sleep-breath': number;
  readonly eating: number;
  readonly 'page-turn': number;
  readonly exercise: number;
  readonly 'door-opened': number;
  readonly 'door-closed': number;
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
  private readonly activities: ActivityCueScheduler;
  private readonly objectSounds: ObjectSoundCueScheduler;
  private readonly playedCueCounts = new Uint32Array(9);

  constructor(
    private readonly createContext: AudioContextFactory = createBrowserAudioContext,
    private readonly store: AudioPreferenceStore | undefined = browserAudioPreferenceStore(),
  ) {
    const preferences = readPreferences(store);
    this.mutedPreference = preferences.muted;
    this.effectsLevelPreference = preferences.effectsLevel;
    this.footsteps = new FootstepScheduler(this);
    this.activities = new ActivityCueScheduler(this);
    this.objectSounds = new ObjectSoundCueScheduler(this);
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
    const changed = this.mutedPreference !== muted;
    this.mutedPreference = muted;
    if (changed) this.resetSchedulers();
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
    const wasSilent = this.effectsLevelPreference === 0;
    this.effectsLevelPreference = clampLevel(level);
    if (wasSilent !== (this.effectsLevelPreference === 0)) {
      this.resetSchedulers();
    }
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
    if (cue === null) return;
    const pitchScale = pitchScaleForEvent(event);
    const player = this.player;
    if (player === null) return;
    try {
      if (player.play(cue, pitchScale)) {
        this.playedCueCounts[cueIndex(cue)] += 1;
      }
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

  beginActivityFrame(): void {
    this.activities.beginFrame();
  }

  observeActivity(simId: number, activity: SimActivityAudioState): void {
    this.activities.observe(simId, activity);
  }

  endActivityFrame(): void {
    this.activities.endFrame();
  }

  beginObjectSoundFrame(): void {
    this.objectSounds.beginFrame();
  }

  observeObjectSound(sourceId: number, action: number): void {
    this.objectSounds.observe(sourceId, action);
  }

  endObjectSoundFrame(): void {
    this.objectSounds.endFrame();
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
    this.activities.reset();
    this.objectSounds.reset();
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
    this.activities.reset();
    this.objectSounds.reset();
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

  activeActivityTrackCount(): number {
    return this.activities.activePersonalTrackCount();
  }

  activityTrackCapacity(): number {
    return this.activities.personalTrackCapacity();
  }

  activeObjectSoundTrackCount(): number {
    return this.objectSounds.activeTrackCount();
  }

  objectSoundTrackCapacity(): number {
    return this.objectSounds.trackCapacity();
  }

  /** Successful procedural cue starts, exposed through `?stress=N` only. */
  cuePlayCounts(): AudioCuePlayCounts {
    return {
      rejected: this.playedCueCounts[0] ?? 0,
      footstep: this.playedCueCounts[1] ?? 0,
      conversation: this.playedCueCounts[2] ?? 0,
      'sleep-breath': this.playedCueCounts[3] ?? 0,
      eating: this.playedCueCounts[4] ?? 0,
      'page-turn': this.playedCueCounts[5] ?? 0,
      exercise: this.playedCueCounts[6] ?? 0,
      'door-opened': this.playedCueCounts[7] ?? 0,
      'door-closed': this.playedCueCounts[8] ?? 0,
    };
  }

  private resetSchedulers(): void {
    this.footsteps.reset();
    this.activities.reset();
    this.objectSounds.reset();
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
    const resumedContext = context.state !== 'running';
    if (resumedContext) {
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
      this.activities.reset();
      this.objectSounds.reset();
    } else if (running && resumedContext) {
      this.objectSounds.reset();
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

function cueForEvent(event: GameAudioEvent): ProceduralCue | null {
  switch (event.type) {
    case 'command.staged':
    case 'ui.confirmed':
      return null;
    case 'command.rejected':
      return 'rejected';
    case 'sim.footstep':
      return 'footstep';
    case 'sim.conversation':
      return 'conversation';
    case 'sim.sleep-breath':
      return 'sleep-breath';
    case 'sim.eating':
      return 'eating';
    case 'sim.page-turn':
      return 'page-turn';
    case 'sim.exercise':
      return 'exercise';
    case 'object.sound-started':
    case 'object.sound-stopped':
      return null;
    case 'door.opened':
      return 'door-opened';
    case 'door.closed':
      return 'door-closed';
  }
}

function pitchScaleForEvent(event: GameAudioEvent): number {
  switch (event.type) {
    case 'sim.footstep':
      return footstepPitchScale(event.simId, event.stepIndex);
    case 'sim.conversation': {
      const phase = (Math.trunc(event.simId) * 13 + event.phraseIndex * 7) & 3;
      return 0.94 + phase * 0.045;
    }
    case 'sim.sleep-breath': {
      const phase = (Math.trunc(event.simId) + event.breathIndex) & 1;
      return 0.97 + phase * 0.04;
    }
    case 'sim.eating': {
      const phase = (Math.trunc(event.simId) * 5 + event.biteIndex) & 3;
      return 0.96 + phase * 0.025;
    }
    case 'sim.page-turn': {
      const phase = (Math.trunc(event.simId) + event.pageIndex * 3) & 3;
      return 0.94 + phase * 0.03;
    }
    case 'sim.exercise': {
      const phase = (Math.trunc(event.simId) + event.repetitionIndex) & 1;
      return 0.97 + phase * 0.04;
    }
    default:
      return 1;
  }
}

function footstepPitchScale(simId: number, stepIndex: number): number {
  const phase = (Math.trunc(simId) * 17 + Math.trunc(stepIndex) * 31) & 3;
  return 0.94 + phase * 0.035;
}

function cueIndex(cue: ProceduralCue): number {
  switch (cue) {
    case 'rejected':
      return 0;
    case 'footstep':
      return 1;
    case 'conversation':
      return 2;
    case 'sleep-breath':
      return 3;
    case 'eating':
      return 4;
    case 'page-turn':
      return 5;
    case 'exercise':
      return 6;
    case 'door-opened':
      return 7;
    case 'door-closed':
      return 8;
  }
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
