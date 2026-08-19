import { describe, expect, it, vi } from 'vitest';

import {
  AUDIO_PREFERENCES_KEY,
  AUDIO_PREFERENCES_VERSION,
  AudioController,
  DEFAULT_EFFECTS_LEVEL,
  type AudioPreferenceStore,
  type BrowserAudioContext,
} from '../src/audio/audio-controller.js';
import { FOOTSTEP_DISTANCE_TILES } from '../src/audio/footsteps.js';
import type {
  AudioParamPort,
  GainNodePort,
  OscillatorNodePort,
} from '../src/audio/procedural-cues.js';

interface ParamCall {
  readonly kind: 'cancel' | 'set' | 'ramp';
  readonly value?: number;
  readonly time: number;
}

class FakeParam implements AudioParamPort {
  readonly calls: ParamCall[] = [];

  cancelScheduledValues(startTime: number): void {
    this.calls.push({ kind: 'cancel', time: startTime });
  }

  setValueAtTime(value: number, startTime: number): void {
    this.calls.push({ kind: 'set', value, time: startTime });
  }

  linearRampToValueAtTime(value: number, endTime: number): void {
    this.calls.push({ kind: 'ramp', value, time: endTime });
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

class FakeOscillator implements OscillatorNodePort {
  type: OscillatorType = 'sine';
  readonly frequency = new FakeParam();
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

  stop(when = 0): void {
    this.stops.push(when);
  }
}

class FakeContext implements BrowserAudioContext {
  currentTime = 4;
  readonly destination = { kind: 'destination' };
  state: AudioContextState = 'suspended';
  readonly gains: FakeGain[] = [];
  readonly oscillators: FakeOscillator[] = [];
  resumeCalls = 0;
  suspendCalls = 0;
  closeCalls = 0;
  rejectResume = false;
  rejectSuspend = false;
  suspendGate: Promise<void> | null = null;

  createGain(): FakeGain {
    const gain = new FakeGain();
    this.gains.push(gain);
    return gain;
  }

  createOscillator(): FakeOscillator {
    const oscillator = new FakeOscillator();
    this.oscillators.push(oscillator);
    return oscillator;
  }

  async resume(): Promise<void> {
    this.resumeCalls += 1;
    if (this.rejectResume) throw new Error('gesture expired');
    this.state = 'running';
  }

  async suspend(): Promise<void> {
    this.suspendCalls += 1;
    if (this.rejectSuspend) throw new Error('hardware refused suspension');
    if (this.suspendGate !== null) await this.suspendGate;
    this.state = 'suspended';
  }

  async close(): Promise<void> {
    this.closeCalls += 1;
    this.state = 'closed';
  }
}

function memoryStore(initial: string | null = null): AudioPreferenceStore & {
  readonly writes: Array<readonly [string, string]>;
} {
  const writes: Array<readonly [string, string]> = [];
  return {
    writes,
    getItem: () => initial,
    setItem(key, value) {
      writes.push([key, value]);
    },
  };
}

function footstepFrame(
  controller: AudioController,
  simId: number,
  x: number,
): void {
  controller.beginFootstepFrame();
  controller.observeFootstep(simId, x, 0, true);
  controller.endFootstepFrame();
}

describe('AudioController preferences', () => {
  it('uses audible bounded defaults and persists one versioned record', () => {
    const store = memoryStore();
    const controller = new AudioController(() => new FakeContext(), store);

    expect(controller.isMuted()).toBe(false);
    expect(controller.effectsLevel()).toBe(DEFAULT_EFFECTS_LEVEL);

    controller.setMuted(true);
    controller.setEffectsLevel(5);

    expect(controller.preferences()).toEqual({ muted: true, effectsLevel: 1 });
    expect(store.writes).toHaveLength(2);
    expect(store.writes[1]?.[0]).toBe(AUDIO_PREFERENCES_KEY);
    expect(JSON.parse(store.writes[1]?.[1] ?? '')).toEqual({
      version: AUDIO_PREFERENCES_VERSION,
      muted: true,
      effectsLevel: 1,
    });
  });

  it('restores only a complete current-version preference', () => {
    const valid = JSON.stringify({
      version: AUDIO_PREFERENCES_VERSION,
      muted: true,
      effectsLevel: 0.25,
    });
    expect(
      new AudioController(() => new FakeContext(), memoryStore(valid)).preferences(),
    ).toEqual({ muted: true, effectsLevel: 0.25 });

    for (const invalid of [
      '{',
      JSON.stringify({ version: 0, muted: true, effectsLevel: 0.25 }),
      JSON.stringify({ version: 1, muted: 'yes', effectsLevel: 0.25 }),
      JSON.stringify({ version: 1, muted: true, effectsLevel: 1.1 }),
    ]) {
      expect(
        new AudioController(
          () => new FakeContext(),
          memoryStore(invalid),
        ).preferences(),
      ).toEqual({ muted: false, effectsLevel: DEFAULT_EFFECTS_LEVEL });
    }
  });

  it('keeps session settings when browser preference storage is blocked', () => {
    const blocked: AudioPreferenceStore = {
      getItem() {
        throw new Error('denied');
      },
      setItem() {
        throw new Error('denied');
      },
    };
    const controller = new AudioController(() => new FakeContext(), blocked);

    controller.setMuted(true);
    controller.setEffectsLevel(0.4);

    expect(controller.preferences()).toEqual({ muted: true, effectsLevel: 0.4 });
  });
});

describe('AudioController gesture and cue lifecycle', () => {
  it('drops pre-gesture events without creating or queuing a context', async () => {
    const context = new FakeContext();
    const factory = vi.fn(() => context);
    const controller = new AudioController(factory, undefined);

    controller.emit({ type: 'command.staged' });
    controller.emit({ type: 'command.rejected' });

    expect(factory).not.toHaveBeenCalled();
    expect(context.oscillators).toHaveLength(0);

    expect(await controller.unlockFromGesture()).toBe(true);
    expect(factory).toHaveBeenCalledTimes(1);
    expect(context.oscillators).toHaveLength(0);
  });

  it('shares concurrent gesture attempts and permits a later retry after failure', async () => {
    const context = new FakeContext();
    context.rejectResume = true;
    const controller = new AudioController(() => context, undefined);

    const first = controller.unlockFromGesture();
    const second = controller.unlockFromGesture();
    expect(second).toBe(first);
    expect(await first).toBe(false);
    expect(context.resumeCalls).toBe(1);

    context.rejectResume = false;
    expect(await controller.unlockFromGesture()).toBe(true);
    expect(context.resumeCalls).toBe(2);
  });

  it('discards pre-unlock stride progress on the first successful gesture', async () => {
    const context = new FakeContext();
    const controller = new AudioController(() => context, undefined);

    footstepFrame(controller, 41, 0);
    footstepFrame(controller, 41, 0.3);
    await controller.unlockFromGesture();

    footstepFrame(controller, 41, 0.42);
    expect(context.oscillators).toHaveLength(0);

    footstepFrame(controller, 41, 0.84);
    expect(context.oscillators).toHaveLength(1);
  });

  it('schedules distinct accepted and rejected envelopes under 150 ms', async () => {
    const context = new FakeContext();
    const controller = new AudioController(() => context, undefined);
    await controller.unlockFromGesture();

    controller.emit({ type: 'command.staged' });
    controller.emit({ type: 'command.rejected' });

    const [accepted, rejected] = context.oscillators;
    expect(accepted?.type).toBe('triangle');
    expect(rejected?.type).toBe('square');
    expect(accepted?.frequency.calls).toContainEqual({
      kind: 'set',
      value: 520,
      time: 4,
    });
    expect(rejected?.frequency.calls).toContainEqual({
      kind: 'set',
      value: 240,
      time: 4,
    });
    expect(accepted?.stops).toEqual([4.09]);
    expect(rejected?.stops).toEqual([4.13]);
    expect(Math.max(...(accepted?.stops ?? [])) - context.currentTime).toBeLessThan(
      0.15,
    );
    expect(Math.max(...(rejected?.stops ?? [])) - context.currentTime).toBeLessThan(
      0.15,
    );
  });

  it('applies mute and effects level immediately without creating muted voices', async () => {
    const context = new FakeContext();
    const controller = new AudioController(() => context, undefined);
    await controller.unlockFromGesture();
    const master = context.gains[0];
    const effects = context.gains[1];
    expect(context.gains).toHaveLength(2);
    expect(effects?.connections).toEqual([master]);
    expect(master?.connections).toEqual([context.destination]);

    controller.emit({ type: 'ui.confirmed' });
    expect(controller.activeVoiceCount()).toBe(1);

    controller.setMuted(true);
    expect(controller.activeVoiceCount()).toBe(0);
    expect(master?.gain.calls.at(-1)).toEqual({ kind: 'set', value: 0, time: 4 });
    controller.emit({ type: 'command.rejected' });
    expect(context.oscillators).toHaveLength(1);

    controller.setMuted(false);
    controller.setEffectsLevel(0.35);
    expect(master?.gain.calls.at(-1)).toEqual({ kind: 'set', value: 1, time: 4 });
    expect(effects?.gain.calls.at(-1)).toEqual({
      kind: 'set',
      value: 0.35,
      time: 4,
    });
    controller.emit({ type: 'command.rejected' });
    expect(context.oscillators).toHaveLength(2);
  });

  it('caps active voices and disconnects the oldest voice in a burst', async () => {
    const context = new FakeContext();
    const controller = new AudioController(() => context, undefined);
    await controller.unlockFromGesture();

    for (let index = 0; index < 9; index += 1) {
      controller.emit({ type: 'command.staged' });
    }

    expect(controller.activeVoiceCount()).toBe(8);
    expect(context.oscillators).toHaveLength(9);
    expect(context.oscillators[0]?.stops).toEqual([4.09, 4]);
    expect(context.oscillators[0]?.disconnected).toBe(true);
    expect(context.gains[2]?.disconnected).toBe(true);
  });

  it('disconnects a naturally ended voice and releases it from the cap', async () => {
    const context = new FakeContext();
    const controller = new AudioController(() => context, undefined);
    await controller.unlockFromGesture();
    controller.emit({ type: 'ui.confirmed' });

    context.oscillators[0]?.onended?.();

    expect(controller.activeVoiceCount()).toBe(0);
    expect(context.oscillators[0]?.disconnected).toBe(true);
    expect(context.gains[2]?.disconnected).toBe(true);
  });

  it('contains per-cue node creation failures and permits a later footstep', async () => {
    const context = new FakeContext();
    const controller = new AudioController(() => context, undefined);
    await controller.unlockFromGesture();
    const createOscillator = context.createOscillator.bind(context);
    context.createOscillator = () => {
      throw new Error('device disappeared');
    };

    expect(() => controller.emit({ type: 'command.staged' })).not.toThrow();
    expect(controller.activeVoiceCount()).toBe(0);

    context.createOscillator = createOscillator;
    footstepFrame(controller, 27, 0);
    footstepFrame(controller, 27, FOOTSTEP_DISTANCE_TILES);
    expect(controller.activeVoiceCount()).toBe(1);
  });

  it('cleans up a partially configured cue when parameter scheduling fails', async () => {
    const context = new FakeContext();
    const controller = new AudioController(() => context, undefined);
    await controller.unlockFromGesture();
    const createOscillator = context.createOscillator.bind(context);
    context.createOscillator = () => {
      const oscillator = createOscillator();
      oscillator.frequency.setValueAtTime = () => {
        throw new Error('parameter scheduling failed');
      };
      return oscillator;
    };

    expect(() => controller.emit({ type: 'command.staged' })).not.toThrow();
    expect(controller.activeVoiceCount()).toBe(0);
    expect(context.oscillators[0]?.disconnected).toBe(true);
    expect(context.gains[2]?.disconnected).toBe(true);
  });

  it('removes a registered voice when scheduling its stop fails', async () => {
    const context = new FakeContext();
    const controller = new AudioController(() => context, undefined);
    await controller.unlockFromGesture();
    const createOscillator = context.createOscillator.bind(context);
    context.createOscillator = () => {
      const oscillator = createOscillator();
      oscillator.stop = () => {
        throw new Error('device rejected stop time');
      };
      return oscillator;
    };

    expect(() => controller.emit({ type: 'command.staged' })).not.toThrow();
    expect(context.oscillators[0]?.starts).toEqual([4]);
    expect(controller.activeVoiceCount()).toBe(0);
    expect(context.oscillators[0]?.disconnected).toBe(true);
    expect(context.gains[2]?.disconnected).toBe(true);
  });

  it('clears partial stride at the load boundary', async () => {
    const context = new FakeContext();
    const controller = new AudioController(() => context, undefined);
    await controller.unlockFromGesture();
    footstepFrame(controller, 18, 0);
    footstepFrame(controller, 18, 0.3);

    controller.reset('load');
    footstepFrame(controller, 18, 0.42);
    expect(context.oscillators).toHaveLength(0);

    footstepFrame(controller, 18, 0.84);
    expect(context.oscillators).toHaveLength(1);
  });

  it('previews effects gain without persisting until commit', async () => {
    const context = new FakeContext();
    const store = memoryStore();
    const controller = new AudioController(() => context, store);
    await controller.unlockFromGesture();

    controller.previewEffectsLevel(0.45);
    expect(controller.effectsLevel()).toBe(0.45);
    expect(store.writes).toHaveLength(0);

    controller.setEffectsLevel(0.45);
    expect(store.writes).toHaveLength(1);
    expect(JSON.parse(store.writes[0]?.[1] ?? '')).toMatchObject({
      effectsLevel: 0.45,
    });
  });

  it.each(['load', 'background'] as const)(
    'stops active voices at the %s boundary',
    async (boundary) => {
      const context = new FakeContext();
      const controller = new AudioController(() => context, undefined);
      await controller.unlockFromGesture();
      controller.emit({ type: 'door.opened', doorId: 'front' });

      controller.reset(boundary);

      expect(controller.activeVoiceCount()).toBe(0);
      expect(context.oscillators[0]?.stops).toEqual([4.12, 4]);
      expect(context.oscillators[0]?.disconnected).toBe(true);
    },
  );

  it('returns false when context or graph construction fails', async () => {
    const factoryFailure = new AudioController(() => {
      throw new Error('no audio device');
    }, undefined);
    expect(await factoryFailure.unlockFromGesture()).toBe(false);

    const context = new FakeContext();
    context.createGain = () => {
      throw new Error('node allocation failed');
    };
    const graphFailure = new AudioController(() => context, undefined);
    await expect(graphFailure.unlockFromGesture()).resolves.toBe(false);
    expect(graphFailure.isUnlocked()).toBe(false);
    expect(context.closeCalls).toBe(1);
  });

  it('disconnects a partial graph before closing its failed context', async () => {
    const context = new FakeContext();
    const createGain = context.createGain.bind(context);
    let gainCalls = 0;
    context.createGain = () => {
      gainCalls += 1;
      if (gainCalls === 2) throw new Error('effects node allocation failed');
      return createGain();
    };
    const controller = new AudioController(() => context, undefined);

    await expect(controller.unlockFromGesture()).resolves.toBe(false);
    expect(context.gains).toHaveLength(1);
    expect(context.gains[0]?.disconnected).toBe(true);
    expect(context.closeCalls).toBe(1);
    expect(controller.isUnlocked()).toBe(false);
  });

  it('gates immediately and serializes background suspend and foreground resume', async () => {
    const context = new FakeContext();
    const controller = new AudioController(() => context, undefined);
    await controller.unlockFromGesture();

    const hidden = controller.setBackgrounded(true);
    controller.emit({ type: 'command.rejected' });
    expect(context.oscillators).toHaveLength(0);
    expect(await hidden).toBe(true);
    expect(context.state).toBe('suspended');
    expect(context.suspendCalls).toBe(1);

    expect(await controller.setBackgrounded(false)).toBe(true);
    expect(context.state).toBe('running');
    expect(context.resumeCalls).toBe(2);
    controller.emit({ type: 'command.rejected' });
    expect(context.oscillators).toHaveLength(1);
  });

  it('settles rapid visibility races at the latest desired state', async () => {
    const context = new FakeContext();
    const controller = new AudioController(() => context, undefined);
    await controller.unlockFromGesture();

    const hidden = controller.setBackgrounded(true);
    const visible = controller.setBackgrounded(false);

    expect(await hidden).toBe(false);
    expect(await visible).toBe(true);
    expect(context.state).toBe('running');
    expect(controller.isUnlocked()).toBe(true);
  });

  it('repairs a foreground request that arrives during an unresolved suspend', async () => {
    const context = new FakeContext();
    let releaseSuspend = () => {};
    context.suspendGate = new Promise<void>((resolve) => {
      releaseSuspend = resolve;
    });
    const controller = new AudioController(() => context, undefined);
    await controller.unlockFromGesture();

    const hidden = controller.setBackgrounded(true);
    await Promise.resolve();
    expect(context.suspendCalls).toBe(1);

    const visible = controller.setBackgrounded(false);
    releaseSuspend();

    expect(await hidden).toBe(false);
    expect(await visible).toBe(true);
    expect(context.state).toBe('running');
    expect(context.resumeCalls).toBe(2);
  });

  it('recovers from a rejected automatic foreground resume on a later gesture', async () => {
    const context = new FakeContext();
    const controller = new AudioController(() => context, undefined);
    await controller.unlockFromGesture();
    await controller.setBackgrounded(true);

    context.rejectResume = true;
    expect(await controller.setBackgrounded(false)).toBe(false);
    expect(controller.isUnlocked()).toBe(false);

    context.rejectResume = false;
    expect(await controller.unlockFromGesture()).toBe(true);
    expect(controller.isUnlocked()).toBe(true);
    expect(context.resumeCalls).toBe(3);
  });

  it('re-anchors after hidden samples before audible foreground travel', async () => {
    const context = new FakeContext();
    const controller = new AudioController(() => context, undefined);
    await controller.unlockFromGesture();
    footstepFrame(controller, 17, 0);

    await controller.setBackgrounded(true);
    footstepFrame(controller, 17, 0.4);
    footstepFrame(controller, 17, 0.8);
    await controller.setBackgrounded(false);

    footstepFrame(controller, 17, 1.2);
    expect(context.oscillators).toHaveLength(0);
    footstepFrame(controller, 17, 1.2 + 0.42);
    expect(context.oscillators).toHaveLength(1);
  });
});
