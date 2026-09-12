import { describe, expect, it } from 'vitest';

import {
  loadVoiceClips,
  voiceClipUrl,
  VoiceClipPlayer,
  MAX_ACTIVE_VOICE_CONVERSATIONS,
  type AudioBufferPort,
  type AudioBufferSourcePort,
  type VoiceAudioContext,
} from '../src/audio/voice-clips.js';
import { voiceRateForSpeed } from '../src/audio/audio-controller.js';
import type {
  AudioParamPort,
  GainNodePort,
} from '../src/audio/procedural-cues.js';

class FakeParam implements AudioParamPort {
  readonly ramps: { value: number; endTime: number }[] = [];
  readonly sets: { value: number; startTime: number }[] = [];
  cancels = 0;

  cancelScheduledValues(): void {
    this.cancels += 1;
  }

  setValueAtTime(value: number, startTime: number): void {
    this.sets.push({ value, startTime });
  }

  linearRampToValueAtTime(value: number, endTime: number): void {
    this.ramps.push({ value, endTime });
  }
}

class FakeGain implements GainNodePort {
  readonly gain = new FakeParam();
  readonly connections: unknown[] = [];
  disconnected = false;

  connect(destination: unknown): unknown {
    this.connections.push(destination);
    return destination;
  }

  disconnect(): void {
    this.disconnected = true;
  }
}

class FakeSource implements AudioBufferSourcePort {
  buffer: AudioBufferPort | null = null;
  readonly playbackRate = new FakeParam();
  readonly connections: unknown[] = [];
  readonly starts: number[] = [];
  readonly stops: number[] = [];
  onended: (() => void) | null = null;
  disconnected = false;

  connect(destination: unknown): unknown {
    this.connections.push(destination);
    return destination;
  }

  disconnect(): void {
    this.disconnected = true;
  }

  start(when = 0): void {
    this.starts.push(when);
  }

  /** Set to make the next `stop` throw, as a closed context's would. */
  failNextStop = false;

  stop(when = 0): void {
    if (this.failNextStop) {
      this.failNextStop = false;
      throw new Error('source was never started');
    }
    this.stops.push(when);
  }
}

class FakeContext implements VoiceAudioContext {
  currentTime = 10;
  readonly gains: FakeGain[] = [];
  readonly sources: FakeSource[] = [];
  failNextGain = false;

  createGain(): FakeGain {
    if (this.failNextGain) {
      this.failNextGain = false;
      throw new Error('audio hardware refused');
    }
    const gain = new FakeGain();
    this.gains.push(gain);
    return gain;
  }

  createBufferSource(): FakeSource {
    const source = new FakeSource();
    this.sources.push(source);
    return source;
  }
}

/** Durations chosen so no two sum to the same total. */
const CLIPS: AudioBufferPort[] = [
  { duration: 2.5 },
  { duration: 3.1 },
  { duration: 4.6 },
];

function player(context = new FakeContext()): {
  context: FakeContext;
  player: VoiceClipPlayer;
  output: object;
} {
  const output = { kind: 'effects' };
  const instance = new VoiceClipPlayer(context, output);
  instance.setClips(CLIPS);
  return { context, player: instance, output };
}

describe('VoiceClipPlayer', () => {
  it('plays the second clip the instant the first ends', () => {
    const { context, player: voices } = player();

    expect(voices.play(0, 1)).toBe(true);

    const [first, second] = context.sources;
    expect(first?.buffer).toBe(CLIPS[0]);
    expect(second?.buffer).toBe(CLIPS[1]);
    // Scheduled against the audio clock rather than started from the first
    // clip's ended callback. A callback lands whenever the main thread is
    // free, which would leave an audible gap of unpredictable length.
    expect(first?.starts).toEqual([10]);
    expect(second?.starts).toEqual([10 + 2.5]);
    expect(first?.stops).toEqual([10 + 2.5]);
    expect(second?.stops).toEqual([10 + 2.5 + 3.1]);
  });

  it('reports the conversation over only when the SECOND clip ends', () => {
    const { context, player: voices } = player();
    voices.play(0, 1);

    const [first, second] = context.sources;
    expect(first?.onended).toBeNull();
    expect(second?.onended).toBeTypeOf('function');

    expect(voices.activeConversationCount()).toBe(1);
    second?.onended?.();
    expect(voices.activeConversationCount()).toBe(0);
  });

  it('plays faster and only slightly higher when the world speeds up', () => {
    const { context, player: voices } = player();
    const rate = voiceRateForSpeed(3);

    voices.play(0, 1, rate);

    const [first, second] = context.sources;
    expect(first?.playbackRate.sets[0]?.value).toBeCloseTo(rate, 6);
    expect(second?.starts[0]).toBeCloseTo(10 + 2.5 / rate, 6);
    // The whole point of the exponent: triple speed costs about three and a
    // half semitones, not the nineteen that matching the speed would.
    expect(rate).toBeGreaterThan(1);
    expect(12 * Math.log2(rate)).toBeLessThan(4);
  });

  it('leaves normal speed exactly as recorded', () => {
    expect(voiceRateForSpeed(1)).toBe(1);
    expect(voiceRateForSpeed(0)).toBe(1);
    expect(voiceRateForSpeed(Number.NaN)).toBe(1);
  });

  it('fades rather than cuts when the world outruns the audio', () => {
    const { context, player: voices } = player();
    voices.play(0, 1);
    const gain = context.gains[0];
    const rampsBefore = gain?.gain.ramps.length ?? 0;

    voices.stopAll();

    // A stop lands on silence: the shared gain ramps down first, and every
    // source is stopped at the end of that ramp rather than immediately.
    // Cutting a waveform at an arbitrary sample is a step, and a step clicks.
    const lastRamp = gain?.gain.ramps.at(-1);
    expect(gain?.gain.ramps.length).toBeGreaterThan(rampsBefore);
    expect(lastRamp?.value).toBe(0);
    expect(lastRamp?.endTime).toBeGreaterThan(context.currentTime);
    for (const source of context.sources) {
      expect(source.stops.at(-1)).toBeCloseTo(lastRamp?.endTime ?? 0, 6);
      // **Still connected.** This assertion used to demand the opposite, and
      // in doing so it enshrined the bug: disconnecting in the same turn as
      // scheduling the ramp removes the nodes from the graph before the ramp
      // can reach the output, so the fade never rendered and the stop was the
      // hard cut it exists to prevent.
      expect(source.disconnected).toBe(false);
    }
    expect(gain?.disconnected).toBe(false);
    expect(voices.activeConversationCount()).toBe(0);

    // **Only the LAST source is fired**, because that is all a browser will
    // do: the first clip's handler was cleared when it ended naturally and
    // can never fire again. Firing both would let a teardown that waits on
    // every source pass here while hanging on forever in the real thing.
    context.sources.at(-1)?.onended?.();
    for (const source of context.sources) expect(source.disconnected).toBe(true);
    expect(gain?.disconnected).toBe(true);
  });

  it('reclaims a conversation whose every source refused to stop', () => {
    // The ordering that produced the original leak: teardown running inside
    // the stop loop, before the conversation had been listed as draining, so
    // it was listed afterwards and no sweep could ever remove it again.
    const { context, player: voices } = player();
    voices.play(0, 1);
    for (const source of context.sources) source.failNextStop = true;

    voices.stopAll();

    expect(voices.retainedConversationCount()).toBe(0);
    for (const source of context.sources) expect(source.disconnected).toBe(true);
  });

  it('counts a fading conversation as retained until it is reclaimed', () => {
    // `retainedConversationCount` is the only number the bounded-memory proof
    // now watches, so it has to move: a conversation that has been stopped is
    // out of the sounding list and still holds every node it was built from.
    const { context, player: voices } = player();
    voices.play(0, 1);
    expect(voices.retainedConversationCount()).toBe(1);

    voices.stopAll();
    expect(voices.activeConversationCount()).toBe(0);
    expect(voices.retainedConversationCount()).toBe(1);

    context.sources.at(-1)?.onended?.();
    expect(voices.retainedConversationCount()).toBe(0);
  });

  it('reclaims a faded conversation whose sources never report ending', () => {
    // The safety net for a source stopped before its scheduled start, which
    // may never fire `onended`. Without it those nodes would stay connected
    // for the life of the audio context.
    const { context, player: voices } = player();
    voices.play(0, 1);
    voices.stopAll();

    const stranded = [...context.sources];
    for (const source of stranded) expect(source.disconnected).toBe(false);

    // Advance past the fade and start something else, which sweeps.
    context.currentTime += 1;
    voices.play(1, 2);

    for (const source of stranded) expect(source.disconnected).toBe(true);
  });

  it('drops the OLDEST conversation rather than stacking babble', () => {
    const { context, player: voices } = player();

    // Distinct pairs, so which conversations survived is visible. Asserting
    // only the resulting count would pass just as happily if eviction threw
    // away the newest arrival instead of the oldest, which is the opposite
    // of what the cap is for.
    const pairs: readonly [number, number][] = [
      [0, 1],
      [1, 2],
      [2, 0],
      [0, 2],
    ];
    for (const [first, second] of pairs) voices.play(first, second);

    expect(voices.activeConversationCount()).toBe(MAX_ACTIVE_VOICE_CONVERSATIONS);

    // **Counted stops, not merely "was stopped".** Every source gets one stop
    // when it is scheduled, so "has at least one stop" cannot fail and says
    // nothing. The EVICTED conversation gets a second one, so the count is
    // what distinguishes it: evicting the newest instead of the oldest moves
    // the pair of twos to the other end of this list.
    const stopCounts: number[][] = [];
    for (let index = 0; index < context.sources.length; index += 2) {
      stopCounts.push([
        context.sources[index]?.stops.length ?? 0,
        context.sources[index + 1]?.stops.length ?? 0,
      ]);
    }
    expect(stopCounts).toEqual([
      [2, 2],
      [1, 1],
      [1, 1],
      [1, 1],
    ]);
  });

  it('silences BOTH halves when one recording failed to load', () => {
    // A clip that failed to load is carried as a zero-length stand-in so the
    // others keep their indices. Playing its partner alone would be half a
    // conversation arriving from nowhere and running for the wrong length.
    const context = new FakeContext();
    const voices = new VoiceClipPlayer(context, {});
    voices.setClips([{ duration: 2.5 }, { duration: 0 }]);

    expect(voices.play(0, 1)).toBe(false);
    expect(voices.play(1, 0)).toBe(false);
    expect(context.sources).toHaveLength(0);
  });

  it('plays nothing rather than throwing when a clip is missing', () => {
    const { context, player: voices } = player();

    expect(voices.play(0, 99)).toBe(false);
    expect(voices.play(99, 0)).toBe(false);
    expect(context.sources).toHaveLength(0);
    expect(voices.activeConversationCount()).toBe(0);
  });

  it('never lets an audio failure escape into the frame', () => {
    const { context, player: voices } = player();
    context.failNextGain = true;

    expect(voices.play(0, 1)).toBe(false);
    expect(voices.activeConversationCount()).toBe(0);
  });
});

describe('loadVoiceClips', () => {
  it('resolves an id to the served path', () => {
    expect(voiceClipUrl('sim-talking-4')).toBe('audio/voice/sim-talking-4.wav');
  });

  it('leaves a hole for a clip that fails rather than failing the load', async () => {
    const decoded = await loadVoiceClips(
      ['one', 'two', 'three'],
      async (url) => {
        if (url.includes('two')) throw new Error('404');
        return new ArrayBuffer(8);
      },
      async () => ({ duration: 1 }),
    );

    // Indices are the simulation's clip indices, so a missing recording has
    // to keep its position: shifting the list would make every later clip
    // play as the wrong one.
    expect(decoded).toHaveLength(3);
    expect(decoded[0]).toEqual({ duration: 1 });
    expect(decoded[1]).toBeUndefined();
    expect(decoded[2]).toEqual({ duration: 1 });
  });
});
