import type { GainNodePort, AudioNodePort } from './procedural-cues.js';
import type { AudioBufferPort, AudioBufferSourcePort, VoiceAudioContext } from './voice-clips.js';

export const TOILET_CLIP_GAIN = 0.08;
export const MAX_ACTIVE_TOILET_VOICES = 4;
export const MAX_TOILET_CLIP_SECONDS = 30;
const FADE_SECONDS = 0.012;

interface ToiletVoice {
  source: AudioBufferSourcePort;
  gain: GainNodePort;
  endsAt: number;
  sourceId: number;
}

/** Short recordings run at their original rate, independently of game speed. */
export class RecordedToiletPlayer {
  private readonly active = new Map<number, ToiletVoice>();
  constructor(private readonly context: VoiceAudioContext, private readonly destination: unknown) {}

  play(sourceId: number, buffer: AudioBufferPort): boolean {
    this.sweep();
    if (!Number.isInteger(sourceId) || sourceId < 0 || sourceId >= 0xffff_ffff ||
      this.active.has(sourceId) || buffer.duration > MAX_TOILET_CLIP_SECONDS ||
      !Number.isFinite(buffer.duration) || buffer.duration < FADE_SECONDS * 2 ||
      this.active.size >= MAX_ACTIVE_TOILET_VOICES) return false;
    let source: AudioBufferSourcePort | null = null;
    let gain: GainNodePort | null = null;
    let voice: ToiletVoice | null = null;
    try {
      const now = this.context.currentTime;
      source = this.context.createBufferSource();
      gain = this.context.createGain();
      source.buffer = buffer;
      source.playbackRate.setValueAtTime(1, now);
      source.connect(gain);
      gain.connect(this.destination);
      gain.gain.setValueAtTime(0, now);
      gain.gain.linearRampToValueAtTime(TOILET_CLIP_GAIN, now + FADE_SECONDS);
      gain.gain.setValueAtTime(TOILET_CLIP_GAIN, now + buffer.duration - FADE_SECONDS);
      gain.gain.linearRampToValueAtTime(0, now + buffer.duration);
      voice = { sourceId, source, gain, endsAt: now + buffer.duration };
      const registered = voice;
      this.active.set(sourceId, registered);
      source.onended = () => this.finish(registered);
      source.start(now);
      source.stop(registered.endsAt);
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

  stopAll(): void { for (const voice of this.active.values()) this.finish(voice, true); }
  activeVoiceCount(): number { this.sweep(); return this.active.size; }
  private sweep(): void {
    for (const voice of this.active.values()) {
      if (voice.endsAt <= this.context.currentTime) this.finish(voice, true);
    }
  }
  private finish(voice: ToiletVoice, stop = false): void {
    if (this.active.get(voice.sourceId) !== voice) return;
    this.active.delete(voice.sourceId);
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
