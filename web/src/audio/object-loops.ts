import type { ObjectSoundAction } from './object-cues.js';
import type { GainNodePort } from './procedural-cues.js';
import type { AudioBufferPort, AudioBufferSourcePort, VoiceAudioContext } from './voice-clips.js';

/** Loop seams are prepared offline; subjective acceptance is tracked with the asset. */
export interface PreparedObjectLoopClip {
  readonly buffer: AudioBufferPort;
  readonly gain: number;
  readonly loopStart: number;
  readonly loopEnd: number;
}
export type ObjectLoopClips = ReadonlyMap<ObjectSoundAction, PreparedObjectLoopClip>;
const EDGE_SECONDS = 0.02;
const MAX_ACTIVE_LOOPS = 4;
const MAX_RETAINED_LOOPS = 8;

export function prepareObjectLoopClips(clips: ObjectLoopClips): ObjectLoopClips {
  const prepared = new Map<ObjectSoundAction, PreparedObjectLoopClip>();
  for (const [action, clip] of clips) {
    if ((action === 1 || action === 2 || action === 3) &&
      Number.isFinite(clip.buffer.duration) && clip.buffer.duration > 0 &&
      Number.isFinite(clip.gain) && clip.gain >= 0 &&
      Number.isFinite(clip.loopStart) && clip.loopStart >= 0 &&
      Number.isFinite(clip.loopEnd) && clip.loopEnd > clip.loopStart &&
      clip.loopEnd <= clip.buffer.duration) prepared.set(action, { ...clip });
  }
  return prepared;
}

interface ActiveLoop {
  readonly sourceId: number;
  readonly action: ObjectSoundAction;
  readonly source: AudioBufferSourcePort;
  readonly gain: GainNodePort;
  readonly startedAt: number;
  readonly level: number;
  releaseEnd: number;
}

/** Plays only explicitly installed, decoded object recordings. */
export class ObjectLoopPlayer {
  private clips: ObjectLoopClips = new Map();
  private readonly active = new Map<number, ActiveLoop>();
  private readonly retained = new Set<ActiveLoop>();

  constructor(private readonly context: VoiceAudioContext, private readonly output: unknown) {}

  setClips(clips: ObjectLoopClips): void {
    const prepared = prepareObjectLoopClips(clips);
    for (const loop of this.active.values()) {
      const next = prepared.get(loop.action);
      const previous = this.clips.get(loop.action);
      if (!next || !previous || next.buffer !== previous.buffer ||
        next.gain !== previous.gain || next.loopStart !== previous.loopStart ||
        next.loopEnd !== previous.loopEnd) this.stop(loop.sourceId, loop.action);
    }
    this.clips = prepared;
  }

  play(sourceId: number, action: ObjectSoundAction): boolean {
    this.sweep();
    if (!Number.isSafeInteger(sourceId) || sourceId < 0 || sourceId >= 0xffff_ffff) return false;
    if (this.active.get(sourceId)?.action === action) return true;
    const previous = this.active.get(sourceId);
    if (previous) this.stop(sourceId, previous.action);
    const clip = this.clips.get(action);
    if (!clip || this.active.size >= MAX_ACTIVE_LOOPS || this.retained.size >= MAX_RETAINED_LOOPS) return false;
    let source: AudioBufferSourcePort | null = null;
    let gain: GainNodePort | null = null;
    let loop: ActiveLoop | null = null;
    try {
      source = this.context.createBufferSource();
      gain = this.context.createGain();
      const now = this.context.currentTime;
      source.buffer = clip.buffer;
      source.loop = true;
      source.loopStart = clip.loopStart;
      source.loopEnd = clip.loopEnd;
      gain.gain.setValueAtTime(0, now);
      gain.gain.linearRampToValueAtTime(clip.gain, now + EDGE_SECONDS);
      source.connect(gain);
      gain.connect(this.output);
      const owned = { sourceId, action, source, gain, startedAt: now, level: clip.gain, releaseEnd: Infinity };
      loop = owned;
      this.active.set(sourceId, owned);
      this.retained.add(owned);
      source.onended = () => this.dispose(owned);
      source.start(now, clip.loopStart);
      return true;
    } catch {
      if (loop) this.dispose(loop);
      else disconnectNodes(source, gain);
      return false;
    }
  }

  stop(sourceId: number, action: ObjectSoundAction): void {
    const loop = this.active.get(sourceId);
    if (!loop || loop.action !== action) return;
    this.active.delete(sourceId);
    const now = this.context.currentTime;
    const attack = Math.min(1, Math.max(0, (now - loop.startedAt) / EDGE_SECONDS));
    const level = loop.level * attack;
    loop.releaseEnd = now + EDGE_SECONDS;
    try {
      loop.gain.gain.cancelScheduledValues(now);
      // Recreate the interrupted ramp before anchoring its instantaneous level.
      if (attack < 1) loop.gain.gain.linearRampToValueAtTime(level, now);
      loop.gain.gain.setValueAtTime(level, now);
      loop.gain.gain.linearRampToValueAtTime(0, loop.releaseEnd);
      loop.source.stop(loop.releaseEnd);
    } catch {
      this.dispose(loop);
    }
  }

  sweep(): void {
    for (const loop of this.retained) {
      if (this.context.currentTime > loop.releaseEnd) this.dispose(loop);
    }
  }

  stopAll(immediate = false): void {
    if (immediate) {
      for (const loop of this.retained) {
        this.dispose(loop);
      }
    } else {
      for (const loop of this.active.values()) this.stop(loop.sourceId, loop.action);
    }
  }

  activeLoopCount(): number { return this.active.size; }
  retainedLoopCount(): number { return this.retained.size; }

  private dispose(loop: ActiveLoop): void {
    if (!this.retained.delete(loop)) return;
    if (this.active.get(loop.sourceId) === loop) this.active.delete(loop.sourceId);
    disconnectNodes(loop.source, loop.gain);
  }
}

function disconnectNodes(source: AudioBufferSourcePort | null, gain: GainNodePort | null): void {
  if (source) {
    try { source.onended = null; } catch { /* Continue releasing the remaining nodes. */ }
    try { source.stop(); } catch { /* An unstarted or ended source may reject stop. */ }
    try { source.disconnect(); } catch { /* Still release the gain if the source fails. */ }
  }
  try { gain?.disconnect(); } catch { /* Ownership has already been cleared. */ }
}
