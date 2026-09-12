import {
  ProceduralCuePlayer,
  type GainNodePort,
  type ProceduralAudioContext,
  type ProceduralCue,
} from './procedural-cues.js';
import {
  ActivityCueScheduler,
  type ActivityCueEvent,
  type ConversationVoicePair,
  type SimActivityAudioState,
} from './activity-cues.js';
import {
  loadVoiceClips,
  VoiceClipPlayer,
  type AudioBufferPort,
  type VoiceAudioContext,
} from './voice-clips.js';
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

export interface BrowserAudioContext
  extends ProceduralAudioContext,
    VoiceAudioContext {
  readonly destination: unknown;
  readonly state: AudioContextState;
  close(): Promise<void>;
  resume(): Promise<void>;
  suspend(): Promise<void>;
  decodeAudioData(bytes: ArrayBuffer): Promise<AudioBufferPort>;
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
  private voices: VoiceClipPlayer | null = null;
  /** Decoded once and reinstalled on every context rebuild. */
  private voiceClips: readonly (AudioBufferPort | undefined)[] = [];
  private voiceClipIds: readonly string[] = [];
  /** The player's chosen speed, so conversations can follow it. */
  private gameSpeed = 1;
  /**
   * A conversation that asked to be played before it could be.
   *
   * The recordings are fetched after a gesture and decoded asynchronously,
   * so the first conversation of a session can easily begin while the
   * library is still arriving. Without this it would be recorded as playing,
   * never retried, and stay silent for its whole length.
   */
  private pendingVoice: ConversationVoicePair | null = null;
  /** The in-flight library fetch, so two callers cannot both download it. */
  private voiceFetch: Promise<(AudioBufferPort | undefined)[]> | null = null;
  private hasUnlocked = false;
  private backgrounded = false;
  private contextStateRevision = 0;
  private contextStateTail: Promise<void> = Promise.resolve();
  private readonly footsteps: FootstepScheduler;
  private readonly activities: ActivityCueScheduler;
  private readonly objectSounds: ObjectSoundCueScheduler;
  private readonly playedCueCounts = new Uint32Array(8);

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
   *
   * Every trusted gesture gets its own `resume()`. An in-flight attempt is
   * deliberately NOT reused: a browser that blocks a resume answers with a
   * promise it never settles, so a cached attempt from one mistimed gesture
   * would be handed to every later one and the page would never try again.
   * Repeating the call is cheap, and the context itself is built only once
   * because `resumeFromGesture` assigns it before it awaits anything.
   */
  unlockFromGesture(): Promise<boolean> {
    if (this.backgrounded) return Promise.resolve(false);
    return this.resumeFromGesture();
  }

  setMuted(muted: boolean): void {
    const changed = this.mutedPreference !== muted;
    this.mutedPreference = muted;
    if (changed) this.resetSchedulers();
    this.applyMasterGain();
    this.persist();
    if (muted) this.stopEveryPlayer();
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
    if (this.effectsLevelPreference === 0) this.stopEveryPlayer();
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

    if (event.type === 'sim.conversation-started') {
      this.startConversationVoice(event.voice);
      return;
    }
    if (event.type === 'sim.conversation-ended') {
      this.pendingVoice = null;
      // Only reached when the world outran its own audio, which is what
      // fast-forward makes routine. At normal speed the recordings finish on
      // the tick the talking does and have already torn themselves down.
      this.voices?.stopAll();
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

  observeActivity(
    simId: number,
    activity: SimActivityAudioState,
    voice?: ConversationVoicePair,
  ): void {
    // **The third argument is load-bearing and the types cannot protect it.**
    // A two-parameter method is assignable to a three-parameter signature in
    // TypeScript, so leaving `voice` off compiles, typechecks, and silently
    // drops every conversation's clips - which is exactly what it did until a
    // run in the browser showed two Sims talking with the pair reaching the
    // render buffer and nothing playing.
    this.activities.observe(simId, activity, voice);
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
      this.stopEveryPlayer();
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
    this.stopEveryPlayer();
    this.footsteps.reset();
    this.activities.reset();
    this.objectSounds.reset();
  }

  /**
   * Silences every player at once.
   *
   * A single method rather than a call to each, because the schedulers have
   * already been through the failure where a new one was added and three of
   * the four routes back to silence were not updated. One method means the
   * next one added here cannot be half-wired.
   */
  private stopEveryPlayer(): void {
    // **Dropped FIRST**, before anything that touches the audio hardware. If
    // a `stopAll` threw, a hold cleared after it would survive the silencing,
    // which is the whole defect this line exists to prevent.
    //
    // **Drop the held conversation at all.** Every route here - mute, Effects
    // reaching zero, backgrounding, Load - also resets the scheduler, and
    // that reset deliberately emits no end event. Without this the pair stays
    // held, and the library landing a moment later would start a conversation
    // the player has already silenced: against a muted master gain, or
    // against a suspended clock that plays it on return to the tab.
    this.pendingVoice = null;
    this.player?.stopAll();
    this.voices?.stopAll();
  }

  /**
   * Follows the player's chosen speed, so conversations keep pace with the
   * world.
   *
   * Only the RATE changes, and only a little. Conversation length is measured
   * in simulation ticks, so at double speed a conversation is over in half the
   * real time while its recordings are not; matching that exactly would mean
   * playing them at 2x, which is a full octave up and sounds like a cartoon.
   * A gentle rise reads as "faster and brighter" without that, and the
   * mismatch it leaves is handled by cutting the audio when the talking ends,
   * which is what `sim.conversation-ended` is for.
   */
  setGameSpeed(multiplier: number): void {
    this.gameSpeed = Number.isFinite(multiplier) && multiplier > 0 ? multiplier : 1;
  }

  /**
   * Fetches and decodes the voice library, then installs it.
   *
   * Takes ids rather than URLs or files: the ids come from the compiled
   * content pack across the boundary, and this is the only place that knows
   * they name files. Safe to call again - a rebuilt audio context reinstalls
   * the buffers it already decoded rather than fetching them a second time.
   *
   * Never rejects. A library that fails to load costs conversations their
   * sound; it does not stop the game.
   */
  async loadVoiceLibrary(ids: readonly string[]): Promise<void> {
    this.voiceClipIds = ids;
    await this.fetchVoiceLibrary();
  }

  /**
   * Fetches and decodes whatever library has been handed over, if there is a
   * context to decode with.
   *
   * **The caller does not choose the moment.** Decoding needs an audio
   * context, and a context needs a gesture, so the ids arrive long before the
   * bytes can. Calling this again when a context appears is what makes the
   * ordering the caller's non-problem - and it has to be, because unlocking
   * is owned by `gesture-unlock.ts` and main() is forbidden from driving it.
   *
   * Fetching only after a gesture is also the right behaviour on its own
   * terms: a player who never clicks never downloads several megabytes of
   * audio they will never hear.
   *
   * Never rejects. A library that fails to load costs conversations their
   * sound; it does not stop the game.
   */
  private async fetchVoiceLibrary(): Promise<void> {
    const context = this.context;
    if (context === null || this.voiceClipIds.length === 0) return;
    // One fetch at a time, defensively. The cache check below only sees a
    // FINISHED load, so any second caller arriving mid-flight would fetch the
    // whole library again. No current path does: the context is built once
    // and only cleared when construction itself fails. This costs one field
    // and removes the question.
    if (this.voiceFetch !== null) {
      await this.voiceFetch;
      return;
    }
    if (this.voiceClips.length === this.voiceClipIds.length) {
      // Already decoded. A rebuilt context reinstalls these buffers rather
      // than pulling them down a second time.
      this.voices?.setClips(compactClips(this.voiceClips));
      this.retryPendingVoice();
      return;
    }
    const fetching = loadVoiceClips(
      this.voiceClipIds,
      async (url) => {
        const response = await fetch(url);
        if (!response.ok) throw new Error(`voice clip ${url}: ${response.status}`);
        return response.arrayBuffer();
      },
      (bytes) => context.decodeAudioData(bytes),
    );
    this.voiceFetch = fetching;
    try {
      this.voiceClips = await fetching;
      this.voices?.setClips(compactClips(this.voiceClips));
      this.retryPendingVoice();
    } catch {
      // Presentation only. The simulation already decided the conversation's
      // length, so a silent conversation is the whole cost of failing here.
    } finally {
      if (this.voiceFetch === fetching) this.voiceFetch = null;
    }
  }

  /**
   * Plays a conversation that asked to start before the library was ready.
   *
   * Starts from the beginning rather than from where the conversation has got
   * to. The pair is what the simulation chose and the talking has not finished
   * yet, so the recordings are still the right thing to hear; starting them
   * partway through to chase the clock would be a worse result than a
   * conversation whose audio runs a moment past it.
   */
  private retryPendingVoice(): void {
    const voice = this.pendingVoice;
    if (voice === null) return;
    this.pendingVoice = null;
    // The same gate `emit` applies. Reaching the player directly from the
    // library's load would otherwise bypass every reason the game has for
    // being silent right now.
    //
    // The hold is dropped rather than kept when this gate refuses, on
    // purpose: recovering a resumed context resets the schedulers, and the
    // next tick re-emits a conversation that is still running. Keeping it
    // would risk starting one that is not.
    if (
      !this.isUnlocked() ||
      this.mutedPreference ||
      this.effectsLevelPreference === 0
    ) {
      return;
    }
    this.startConversationVoice(voice);
  }

  /** Ids the shell last handed over, so a rebuilt context can reload them. */
  voiceLibraryIds(): readonly string[] {
    return this.voiceClipIds;
  }

  /** Conversations currently sounding, for the retained-memory proof. */
  activeConversationVoiceCount(): number {
    return this.voices?.activeConversationCount() ?? 0;
  }

  /**
   * Every conversation this player still holds nodes for, sounding or fading.
   *
   * Reported separately from the live count because the fading ones are the
   * half that can actually grow: they leave the active list as soon as they
   * are stopped and are reclaimed later, so a leak would be invisible to
   * `activeConversationVoiceCount` while being exactly what a bounded-state
   * proof exists to catch.
   */
  retainedConversationVoiceCount(): number {
    return this.voices?.retainedConversationCount() ?? 0;
  }

  private startConversationVoice(voice: ConversationVoicePair): void {
    const voices = this.voices;
    if (voices === null) {
      this.pendingVoice = voice;
      return;
    }
    try {
      // One conversation at a time from this scheduler: it tracks a single
      // household-wide conversation, so a new pair replaces the old rather
      // than layering on top of it.
      voices.stopAll();
      const played = voices.play(
        voice.first,
        voice.second,
        voiceRateForSpeed(this.gameSpeed),
      );
      // Held rather than dropped. The usual reason a play fails is that the
      // library has not finished decoding, and that resolves on its own
      // moments later while this conversation is still going.
      this.pendingVoice = played ? null : voice;
    } catch {
      // Sound is presentation. A node failure may drop one conversation but
      // may never terminate the simulation frame that observed it.
      this.pendingVoice = voice;
    }
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
      'sleep-breath': this.playedCueCounts[2] ?? 0,
      eating: this.playedCueCounts[3] ?? 0,
      'page-turn': this.playedCueCounts[4] ?? 0,
      exercise: this.playedCueCounts[5] ?? 0,
      'door-opened': this.playedCueCounts[6] ?? 0,
      'door-closed': this.playedCueCounts[7] ?? 0,
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
        // Same bus as the cues: `Effects` governs both, and `Sound`
        // governs the master gain above it. Voices must never hang off
        // the master directly, or muting effects would leave Sims
        // talking over silence.
        const voices = new VoiceClipPlayer(context, effectsGain);
        voices.setClips(compactClips(this.voiceClips));
        this.voices = voices;
        // The ids usually arrived before any gesture could create this
        // context, so this is the first moment the bytes can be decoded.
        void this.fetchVoiceLibrary();
        this.applyMasterGain();
        this.applyEffectsGain();
      } catch {
        safelyDisconnect(effectsGain);
        safelyDisconnect(masterGain);
        this.context = null;
        this.masterGain = null;
        this.effectsGain = null;
        this.player = null;
        this.voices = null;
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
      this.resetSchedulers();
    } else if (running && resumedContext) {
      this.resetSchedulers();
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

/**
 * Maps game speed to playback rate.
 *
 * Deliberately far below the speed itself: 2x speed plays at 1.12 and 3x at
 * 1.22, which is about two and three and a half semitones up rather than the
 * twelve and nineteen that matching the speed exactly would cost. The
 * exponent is the whole rule - `speed ** 0.18` - and it exists so that
 * fast-forward sounds quicker without sounding like a different species.
 */
export function voiceRateForSpeed(speed: number): number {
  if (!Number.isFinite(speed) || speed <= 1) return 1;
  return Math.pow(speed, 0.18);
}

/**
 * Replaces clips that failed to load with a zero-length stand-in.
 *
 * The player indexes this array with the simulation's clip index, so a hole
 * has to keep its position. A zero-length buffer plays nothing and ends
 * immediately, which is the honest behaviour for a recording that is not
 * there.
 */
function compactClips(
  clips: readonly (AudioBufferPort | undefined)[],
): readonly AudioBufferPort[] {
  return clips.map((clip) => clip ?? { duration: 0 });
}

function cueForEvent(event: GameAudioEvent): ProceduralCue | null {
  switch (event.type) {
    case 'command.staged':
    case 'ui.confirmed':
    // The recordings replaced the conversation tone, so these two carry no
    // procedural cue at all; `emit` handles them before reaching here.
    case 'sim.conversation-started':
    case 'sim.conversation-ended':
      return null;
    case 'command.rejected':
      return 'rejected';
    case 'sim.footstep':
      return 'footstep';
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
    case 'sleep-breath':
      return 2;
    case 'eating':
      return 3;
    case 'page-turn':
      return 4;
    case 'exercise':
      return 5;
    case 'door-opened':
      return 6;
    case 'door-closed':
      return 7;
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
