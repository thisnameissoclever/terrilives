import type { GainNodePort, AudioNodePort } from './procedural-cues.js';
import type { AudioBufferPort, AudioBufferSourcePort, VoiceAudioContext } from './voice-clips.js';

export const DOOR_CLIP_GAIN = 0.05;
export const MAX_ACTIVE_DOOR_VOICES = 4;
const FADE_SECONDS = 0.012;

interface DoorVoice {
  source: AudioBufferSourcePort;
  gain: GainNodePort;
  endsAt: number;
}

/** Short recordings run at their original rate, independently of game speed. */
export class RecordedDoorPlayer {
  private readonly active = new Set<DoorVoice>();
  constructor(private readonly context: VoiceAudioContext, private readonly destination: unknown) {}

  play(buffer: AudioBufferPort): boolean {
    this.sweep();
    if (!Number.isFinite(buffer.duration) || buffer.duration < FADE_SECONDS * 2 ||
      this.active.size >= MAX_ACTIVE_DOOR_VOICES) return false;
    let source: AudioBufferSourcePort | null = null;
    let gain: GainNodePort | null = null;
    let voice: DoorVoice | null = null;
    try {
      const now = this.context.currentTime;
      source = this.context.createBufferSource();
      gain = this.context.createGain();
      source.buffer = buffer;
      source.playbackRate.setValueAtTime(1, now);
      source.connect(gain);
      gain.connect(this.destination);
      gain.gain.setValueAtTime(0, now);
      gain.gain.linearRampToValueAtTime(DOOR_CLIP_GAIN, now + FADE_SECONDS);
      gain.gain.setValueAtTime(DOOR_CLIP_GAIN, now + buffer.duration - FADE_SECONDS);
      gain.gain.linearRampToValueAtTime(0, now + buffer.duration);
      voice = { source, gain, endsAt: now + buffer.duration };
      const registered = voice;
      this.active.add(registered);
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

  stopAll(): void { for (const voice of this.active) this.finish(voice, true); }
  activeVoiceCount(): number { this.sweep(); return this.active.size; }
  private sweep(): void {
    for (const voice of this.active) {
      if (voice.endsAt <= this.context.currentTime) this.finish(voice, true);
    }
  }
  private finish(voice: DoorVoice, stop = false): void {
    if (!this.active.delete(voice)) return;
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
