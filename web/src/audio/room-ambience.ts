import type { GainNodePort } from './procedural-cues.js';
import type { AudioBufferPort, AudioBufferSourcePort, VoiceAudioContext } from './voice-clips.js';

export const ROOM_AMBIENCE_GAIN = 0.15;
export const ROOM_AMBIENCE_FADE_SECONDS = 0.1;
interface RoomLoop {
  source: AudioBufferSourcePort;
  gain: GainNodePort;
  startedAt: number;
  releaseEnd: number;
}

/** Owns the house-wide texture, including its disconnected-owner release tail. */
export class RoomAmbiencePlayer {
  private active: RoomLoop | null = null;
  private readonly retained = new Set<RoomLoop>();
  constructor(private readonly context: VoiceAudioContext, private readonly output: unknown) {}

  play(buffer: AudioBufferPort): boolean {
    this.sweep();
    if (!Number.isFinite(buffer.duration) || buffer.duration <= 0) return false;
    if (this.active) return true;
    while (this.retained.size > 1) this.dispose(this.retained.values().next().value!);
    let source: AudioBufferSourcePort | null = null;
    let gain: GainNodePort | null = null;
    let owned: RoomLoop | null = null;
    try {
      source = this.context.createBufferSource();
      gain = this.context.createGain();
      const now = this.context.currentTime;
      source.buffer = buffer;
      source.loop = true;
      source.loopStart = 0;
      source.loopEnd = buffer.duration;
      source.playbackRate.setValueAtTime(1, now);
      gain.gain.setValueAtTime(0, now);
      gain.gain.linearRampToValueAtTime(ROOM_AMBIENCE_GAIN, now + ROOM_AMBIENCE_FADE_SECONDS);
      source.connect(gain);
      gain.connect(this.output);
      owned = {source, gain, startedAt: now, releaseEnd: Infinity};
      this.active = owned;
      this.retained.add(owned);
      const loop = owned;
      source.onended = () => this.dispose(loop);
      source.start(now);
      return true;
    } catch {
      if (owned) this.dispose(owned);
      else disconnect(source, gain);
      return false;
    }
  }

  stop(immediate = false): void {
    if (immediate) {
      for (const loop of this.retained) this.dispose(loop);
      return;
    }
    const loop = this.active;
    if (!loop) return;
    for (const previous of this.retained) if (previous !== loop) this.dispose(previous);
    this.active = null;
    const now = this.context.currentTime;
    const attack = Math.min(1, Math.max(0, (now - loop.startedAt) / ROOM_AMBIENCE_FADE_SECONDS));
    const level = ROOM_AMBIENCE_GAIN * attack;
    loop.releaseEnd = now + ROOM_AMBIENCE_FADE_SECONDS;
    try {
      loop.gain.gain.cancelScheduledValues(now);
      if (attack < 1) loop.gain.gain.linearRampToValueAtTime(level, now);
      loop.gain.gain.setValueAtTime(level, now);
      loop.gain.gain.linearRampToValueAtTime(0, loop.releaseEnd);
      loop.source.stop(loop.releaseEnd);
    } catch { this.dispose(loop); }
  }

  sweep(): void {
    for (const loop of this.retained) if (this.context.currentTime >= loop.releaseEnd) this.dispose(loop);
  }
  activeCount(): number { return this.active ? 1 : 0; }
  retainedCount(): number { return this.retained.size; }
  private dispose(loop: RoomLoop): void {
    if (!this.retained.delete(loop)) return;
    if (this.active === loop) this.active = null;
    disconnect(loop.source, loop.gain);
  }
}
function disconnect(source: AudioBufferSourcePort | null, gain: GainNodePort | null): void {
  if (source) {
    try { source.onended = null; } catch { /* Continue cleanup. */ }
    try { source.stop(); } catch { /* Unstarted nodes can reject stop. */ }
    try { source.disconnect(); } catch { /* Still release the gain. */ }
  }
  try { gain?.disconnect(); } catch { /* Ownership is already cleared. */ }
}
