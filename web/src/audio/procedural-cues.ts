export type ProceduralCue =
  | 'rejected'
  | 'footstep'
  | 'sleep-breath'
  | 'eating'
  | 'page-turn'
  | 'exercise'
  | 'door-opened'
  | 'door-closed';

export interface AudioParamPort {
  cancelScheduledValues(startTime: number): void;
  setValueAtTime(value: number, startTime: number): void;
  linearRampToValueAtTime(value: number, endTime: number): void;
}

export interface AudioNodePort {
  connect(destination: unknown): unknown;
  disconnect(): void;
}

export interface GainNodePort extends AudioNodePort {
  readonly gain: AudioParamPort;
}

export interface OscillatorNodePort extends AudioNodePort {
  type: OscillatorType;
  readonly frequency: AudioParamPort;
  onended: (() => void) | null;
  start(when?: number): void;
  stop(when?: number): void;
}

export interface ProceduralAudioContext {
  readonly currentTime: number;
  createGain(): GainNodePort;
  createOscillator(): OscillatorNodePort;
}

interface CueShape {
  readonly durationSeconds: number;
  readonly peakGain: number;
  readonly startHz: number;
  readonly endHz: number;
  readonly oscillator: OscillatorType;
  /**
   * Seconds from silence to peak gain. Short impact cues keep the default
   * 8 ms so they read as a tap; a sustained cue such as the sleep snore sets a
   * longer swell so it fades in rather than switching on. Must stay below
   * `durationSeconds`, because the fade back to silence ends there.
   */
  readonly attackSeconds?: number;
}

interface ActiveVoice {
  readonly oscillator: OscillatorNodePort;
  readonly gain: GainNodePort;
  ended: boolean;
}

const SILENCE_GAIN = 0.0001;
const DEFAULT_ATTACK_SECONDS = 0.008;
export const MAX_ACTIVE_PROCEDURAL_VOICES = 8;

const CUE_SHAPES: Readonly<Record<ProceduralCue, CueShape>> = {
  rejected: {
    durationSeconds: 0.09,
    peakGain: 0.07,
    startHz: 520,
    endHz: 680,
    oscillator: 'triangle',
  },
  footstep: {
    durationSeconds: 0.04,
    peakGain: 0.0225,
    startHz: 175,
    endHz: 130,
    oscillator: 'triangle',
  },
  // A soft, low snore: one slow exhale every household sleep interval. The
  // owner wants as little high-pitched sound as possible from a game left
  // playing in the background, so this sits near the bottom of the voice
  // range and swells in over a fifth of a second instead of clicking on. The
  // triangle's faint odd harmonics give it the rasp of a snore; a pure sine
  // this low is a hum that small speakers cannot reproduce at all.
  'sleep-breath': {
    durationSeconds: 0.6,
    attackSeconds: 0.22,
    peakGain: 0.008,
    startHz: 92,
    endHz: 68,
    oscillator: 'triangle',
  },
  eating: {
    durationSeconds: 0.08,
    peakGain: 0.022,
    startHz: 920,
    endHz: 680,
    oscillator: 'sine',
  },
  'page-turn': {
    durationSeconds: 0.13,
    peakGain: 0.018,
    startHz: 1200,
    endHz: 480,
    oscillator: 'triangle',
  },
  exercise: {
    durationSeconds: 0.055,
    peakGain: 0.014,
    startHz: 520,
    endHz: 340,
    oscillator: 'triangle',
  },
  'door-opened': {
    durationSeconds: 0.12,
    peakGain: 0.075,
    startHz: 165,
    endHz: 230,
    oscillator: 'triangle',
  },
  'door-closed': {
    durationSeconds: 0.1,
    peakGain: 0.08,
    startHz: 205,
    endHz: 125,
    oscillator: 'triangle',
  },
};

/**
 * Builds brief cues from Web Audio nodes and owns every node until it ends.
 * The voice cap is deliberately small. A burst of semantic events should drop
 * old sounds rather than grow an invisible queue of oscillators.
 */
export class ProceduralCuePlayer {
  private readonly voices: ActiveVoice[] = [];

  constructor(
    private readonly context: ProceduralAudioContext,
    private readonly output: unknown,
  ) {}

  play(cue: ProceduralCue, pitchScale = 1): boolean {
    const shape = CUE_SHAPES[cue];
    const now = this.context.currentTime;
    let gain: GainNodePort | null = null;
    let oscillator: OscillatorNodePort | null = null;
    let voice: ActiveVoice | null = null;

    try {
      while (this.voices.length >= MAX_ACTIVE_PROCEDURAL_VOICES) {
        this.finishVoice(this.voices[0], true);
      }

      gain = this.context.createGain();
      oscillator = this.context.createOscillator();

      oscillator.type = shape.oscillator;
      oscillator.frequency.cancelScheduledValues(now);
      oscillator.frequency.setValueAtTime(shape.startHz * pitchScale, now);
      oscillator.frequency.linearRampToValueAtTime(
        shape.endHz * pitchScale,
        now + shape.durationSeconds,
      );

      gain.gain.cancelScheduledValues(now);
      gain.gain.setValueAtTime(SILENCE_GAIN, now);
      gain.gain.linearRampToValueAtTime(
        shape.peakGain,
        now + (shape.attackSeconds ?? DEFAULT_ATTACK_SECONDS),
      );
      gain.gain.linearRampToValueAtTime(
        SILENCE_GAIN,
        now + shape.durationSeconds,
      );

      oscillator.connect(gain);
      gain.connect(this.output);
      const activeVoice: ActiveVoice = { oscillator, gain, ended: false };
      voice = activeVoice;
      oscillator.onended = () => this.finishVoice(activeVoice, false);
      this.voices.push(activeVoice);
      oscillator.start(now);
      oscillator.stop(now + shape.durationSeconds);
      return true;
    } catch {
      if (voice !== null) {
        this.finishVoice(voice, true);
      } else {
        if (oscillator !== null) {
          oscillator.onended = null;
          try {
            oscillator.stop(now);
          } catch {
            // The node may not have reached a startable state.
          }
          safeDisconnect(oscillator);
        }
        if (gain !== null) safeDisconnect(gain);
      }
      return false;
    }
  }

  stopAll(): void {
    for (const voice of [...this.voices]) this.finishVoice(voice, true);
  }

  activeVoiceCount(): number {
    return this.voices.length;
  }

  private finishVoice(voice: ActiveVoice, stop: boolean): void {
    if (voice.ended) return;
    voice.ended = true;

    const index = this.voices.indexOf(voice);
    if (index >= 0) this.voices.splice(index, 1);

    voice.oscillator.onended = null;
    if (stop) {
      try {
        voice.oscillator.stop(this.context.currentTime);
      } catch {
        // A browser may report an oscillator that already reached its stop time.
      }
    }
    safeDisconnect(voice.oscillator);
    safeDisconnect(voice.gain);
  }
}

function safeDisconnect(node: AudioNodePort): void {
  try {
    node.disconnect();
  } catch {
    // Audio hardware failure must not escape into the simulation frame.
  }
}
