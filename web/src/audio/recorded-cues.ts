import type { GainNodePort, AudioNodePort } from './procedural-cues.js';
import type { AudioBufferPort, AudioBufferSourcePort, VoiceAudioContext } from './voice-clips.js';

/**
 * How one family of short recordings plays. `gain` is the level before the
 * player's Effects volume. `maxVoices` caps overlap; a start beyond it is
 * refused rather than queued. `minStartIntervalSeconds` is real (audio clock)
 * time between starts, so game speed cannot make the cue more frequent.
 * Families without a length limit or spacing use `Infinity` and `0`.
 */
export interface RecordedCuePolicy {
  readonly gain: number;
  readonly maxVoices: number;
  readonly maxClipSeconds: number;
  readonly minStartIntervalSeconds: number;
}

const FADE_SECONDS = 0.012;

interface RecordedVoice {
  source: AudioBufferSourcePort;
  gain: GainNodePort;
  endsAt: number;
  key: number | undefined;
}

/** The largest key is reserved, matching the bridge's "no object" sentinel. */
const MAX_KEY = 0xffff_fffe;

/**
 * Plays short recordings at their original rate, independently of game speed,
 * and owns every node until it ends or is stopped. Doors, the toilet flush and
 * the sleeping snore each own one instance with their own policy.
 */
export class RecordedCuePlayer {
  private readonly active = new Set<RecordedVoice>();
  private readonly byKey = new Map<number, RecordedVoice>();
  private lastStartAt = Number.NEGATIVE_INFINITY;

  constructor(
    private readonly context: VoiceAudioContext,
    private readonly destination: unknown,
    private readonly policy: RecordedCuePolicy,
  ) {}

  /**
   * Starts `buffer` unless a limit refuses it. A `key` names the thing making
   * the sound, such as one toilet: while that key's recording plays, another
   * start for the same key is refused. A key must be an integer from 0 to
   * 0xfffffffe; any other key is refused.
   */
  play(buffer: AudioBufferPort, key?: number): boolean {
    this.sweep();
    const now = this.context.currentTime;
    if (key !== undefined && (!Number.isInteger(key) || key < 0 || key > MAX_KEY || this.byKey.has(key))) {
      return false;
    }
    if (!Number.isFinite(buffer.duration) || buffer.duration < FADE_SECONDS * 2 ||
      buffer.duration > this.policy.maxClipSeconds ||
      this.active.size >= this.policy.maxVoices ||
      now - this.lastStartAt < this.policy.minStartIntervalSeconds) return false;
    let source: AudioBufferSourcePort | null = null;
    let gain: GainNodePort | null = null;
    let voice: RecordedVoice | null = null;
    try {
      source = this.context.createBufferSource();
      gain = this.context.createGain();
      source.buffer = buffer;
      source.playbackRate.setValueAtTime(1, now);
      source.connect(gain);
      gain.connect(this.destination);
      gain.gain.setValueAtTime(0, now);
      gain.gain.linearRampToValueAtTime(this.policy.gain, now + FADE_SECONDS);
      gain.gain.setValueAtTime(this.policy.gain, now + buffer.duration - FADE_SECONDS);
      gain.gain.linearRampToValueAtTime(0, now + buffer.duration);
      voice = { source, gain, endsAt: now + buffer.duration, key };
      const registered = voice;
      this.active.add(registered);
      if (key !== undefined) this.byKey.set(key, registered);
      source.onended = () => this.finish(registered);
      source.start(now);
      source.stop(registered.endsAt);
      this.lastStartAt = now;
      return true;
    } catch {
      if (voice !== null) this.finish(voice, true);
      else {
        if (source !== null) {
          try { source.stop(); } catch { /* Unstarted sources may reject stop. */ }
          disconnect(source);
        }
        disconnect(gain);
      }
      return false;
    }
  }

  /** Silences everything and forgets the spacing, so the next start is immediate. */
  stopAll(): void {
    for (const voice of this.active) this.finish(voice, true);
    this.lastStartAt = Number.NEGATIVE_INFINITY;
  }

  activeVoiceCount(): number { this.sweep(); return this.active.size; }

  private sweep(): void {
    for (const voice of this.active) {
      if (voice.endsAt <= this.context.currentTime) this.finish(voice, true);
    }
  }

  private finish(voice: RecordedVoice, stop = false): void {
    if (!this.active.delete(voice)) return;
    if (voice.key !== undefined && this.byKey.get(voice.key) === voice) this.byKey.delete(voice.key);
    voice.source.onended = null;
    if (stop) {
      try { voice.source.stop(this.context.currentTime); } catch { /* Cleanup continues. */ }
    }
    disconnect(voice.source);
    disconnect(voice.gain);
  }
}

function disconnect(node: AudioNodePort | null): void {
  try { node?.disconnect(); } catch { /* Sound failure must not stop simulation. */ }
}
