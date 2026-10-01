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
import { RecordedDoorPlayer } from '../src/audio/recorded-doors.js';
import { OverlayPauseController } from '../src/ui/overlay-pause.js';
import { withObjectSoundPause } from '../src/audio/frame-audio.js';
import type { ObjectLoopClips } from '../src/audio/object-loops.js';
import {
  OBJECT_SOUND_ACTION_SHOWER_WATER,
  OBJECT_SOUND_ACTION_STOVE_COOKING,
} from '../src/audio/object-cues.js';
import type {
  AudioParamPort,
  GainNodePort,
  OscillatorNodePort,
} from '../src/audio/procedural-cues.js';
import type { ConversationVoicePair } from '../src/audio/activity-cues.js';
import type {
  AudioBufferPort,
  AudioBufferSourcePort,
} from '../src/audio/voice-clips.js';

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

class FakeBufferSource implements AudioBufferSourcePort {
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
  readonly bufferSources: FakeBufferSource[] = [];
  decodedByteLengths: number[] = [];
  resumeCalls = 0;
  suspendCalls = 0;
  closeCalls = 0;
  rejectResume = false;
  /** Chrome does not reject a blocked resume; it leaves the promise pending. */
  hangResume = false;
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

  createBufferSource(): FakeBufferSource {
    const source = new FakeBufferSource();
    this.bufferSources.push(source);
    return source;
  }

  async decodeAudioData(bytes: ArrayBuffer): Promise<AudioBufferPort> {
    this.decodedByteLengths.push(bytes.byteLength);
    return { duration: 1 };
  }

  async resume(): Promise<void> {
    this.resumeCalls += 1;
    if (this.rejectResume) throw new Error('gesture expired');
    if (this.hangResume) return new Promise<void>(() => {});
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

function portalFrame(controller: AudioController, state: number): void {
  controller.beginPortalFrame();
  controller.observePortal(2, 3, 4, 5, state);
  controller.endPortalFrame();
}

describe('recorded physical doors', () => {
  it.each(['locked', 'muted', 'effects-zero', 'hidden', 'paused'])(
    'does not fetch or play on %s portal demand', async boundary => {
      const context = new FakeContext();
      const controller = new AudioController(() => context, undefined);
      const fetcher = vi.fn();
      vi.stubGlobal('fetch', fetcher);
      try {
        if (boundary !== 'locked') await controller.unlockFromGesture();
        if (boundary === 'muted') controller.setMuted(true);
        if (boundary === 'effects-zero') controller.setEffectsLevel(0);
        if (boundary === 'hidden') await controller.setBackgrounded(true);
        if (boundary === 'paused') controller.setObjectSoundsPaused(true);
        portalFrame(controller, 0); portalFrame(controller, 1);
        await controller.loadDoorRecordings();
        expect(fetcher).not.toHaveBeenCalled();
        expect(context.bufferSources).toHaveLength(0);
      } finally { vi.unstubAllGlobals(); }
    },
  );

  it('retries failed clips only on new demand after cooldown and keeps successful clips', async () => {
    let now = 0;
    const clock = vi.spyOn(performance, 'now').mockImplementation(() => now);
    const context = new FakeContext();
    const controller = new AudioController(() => context, undefined);
    let failClose = true;
    const fetcher = vi.fn(async (url: string) => ({
      ok: !(url.endsWith('close.wav') && failClose), status: 503,
      arrayBuffer: async () => new ArrayBuffer(4),
    }));
    vi.stubGlobal('fetch', fetcher);
    try {
      await controller.unlockFromGesture();
      portalFrame(controller, 0);
      await controller.loadDoorRecordings();
      expect(fetcher).toHaveBeenCalledTimes(2);
      now = 4999;
      portalFrame(controller, 1); portalFrame(controller, 0);
      await controller.loadDoorRecordings();
      expect(fetcher).toHaveBeenCalledTimes(2);
      now = 5000;
      for (let i = 0; i < 50; i++) portalFrame(controller, 0);
      expect(fetcher).toHaveBeenCalledTimes(2);
      failClose = false;
      portalFrame(controller, 1);
      await controller.loadDoorRecordings();
      expect(fetcher.mock.calls.map(call => call[0])).toEqual([
        'audio/doors/open.wav', 'audio/doors/close.wav', 'audio/doors/close.wav',
      ]);
      expect(controller.cuePlayCounts()['door-closed']).toBe(0);
      portalFrame(controller, 0);
      expect(controller.cuePlayCounts()['door-closed']).toBe(1);
    } finally { clock.mockRestore(); vi.unstubAllGlobals(); }
  });

  it.each(['load', 'mute', 'effects', 'background', 'pause', 'recovery'] as const)(
    'late decode after %s never starts an old transition', async boundary => {
      let release!: () => void;
      const gate = new Promise<void>(resolve => { release = resolve; });
      const context = new FakeContext();
      const controller = new AudioController(() => context, undefined);
      const fetcher = vi.fn(async () => {
        await gate;
        return { ok: true, arrayBuffer: async () => new ArrayBuffer(4) };
      });
      vi.stubGlobal('fetch', fetcher);
      try {
        await controller.unlockFromGesture();
        portalFrame(controller, 0); portalFrame(controller, 1);
        const pending = controller.loadDoorRecordings();
        expect(fetcher).toHaveBeenCalledTimes(2);
        if (boundary === 'load') controller.reset('load');
        if (boundary === 'mute') controller.setMuted(true);
        if (boundary === 'effects') controller.setEffectsLevel(0);
        if (boundary === 'background') await controller.setBackgrounded(true);
        if (boundary === 'pause') controller.setObjectSoundsPaused(true);
        if (boundary === 'recovery') { context.state = 'suspended'; await controller.unlockFromGesture(); }
        release(); await pending;
        if (boundary === 'mute') controller.setMuted(false);
        if (boundary === 'effects') controller.setEffectsLevel(1);
        if (boundary === 'background') await controller.setBackgrounded(false);
        if (boundary === 'pause') controller.setObjectSoundsPaused(false);
        portalFrame(controller, 0);
        expect(context.bufferSources).toHaveLength(0);
        portalFrame(controller, 1);
        expect(context.bufferSources).toHaveLength(1);
      } finally { release(); vi.unstubAllGlobals(); }
    },
  );

  it('rejects invalid recordings without nodes and sweeps ended sources even without callbacks', () => {
    const context = new FakeContext();
    const player = new RecordedDoorPlayer(context, context.destination);
    for (const duration of [0, 0.01, -1, NaN, Infinity]) expect(player.play({ duration })).toBe(false);
    expect(context.bufferSources).toHaveLength(0);
    expect(player.play({ duration: 1 })).toBe(true);
    context.currentTime = 5;
    expect(player.activeVoiceCount()).toBe(0);
    expect(context.bufferSources[0].disconnected).toBe(true);
    expect(context.gains[0].disconnected).toBe(true);
  });

  it.each(['connect', 'start', 'stop'] as const)('cleans registered and partial nodes when source %s fails', failure => {
    const context = new FakeContext();
    const create = context.createBufferSource.bind(context);
    context.createBufferSource = () => {
      const source = create();
      source[failure] = () => { throw new Error('hardware'); };
      return source;
    };
    const player = new RecordedDoorPlayer(context, context.destination);
    expect(player.play({ duration: 1 })).toBe(false);
    expect(player.activeVoiceCount()).toBe(0);
    expect(context.bufferSources[0].disconnected).toBe(true);
    expect(context.gains[0].disconnected).toBe(true);
  });

  it('loads only after audible portal demand, caches both clips and never replays the uncached transition', async () => {
    const context = new FakeContext();
    const controller = new AudioController(() => context, undefined);
    const fetcher = vi.fn(async (_url: string) => ({ ok: true, arrayBuffer: async () => new ArrayBuffer(4) }));
    vi.stubGlobal('fetch', fetcher);
    try {
      portalFrame(controller, 0);
      expect(fetcher).not.toHaveBeenCalled();
      await controller.unlockFromGesture();
      controller.setMuted(true);
      portalFrame(controller, 0);
      expect(fetcher).not.toHaveBeenCalled();
      controller.setMuted(false);
      portalFrame(controller, 0);
      portalFrame(controller, 1);
      await controller.loadDoorRecordings();
      expect(fetcher.mock.calls.map(call => call[0])).toEqual(['audio/doors/open.wav', 'audio/doors/close.wav']);
      expect(context.bufferSources).toHaveLength(0);
      portalFrame(controller, 2);
      portalFrame(controller, 3);
      expect(context.bufferSources).toHaveLength(0);
      controller.setGameSpeed(3);
      controller.setVoicesLevel(0);
      portalFrame(controller, 0);
      expect(context.bufferSources).toHaveLength(1);
      expect(context.oscillators).toHaveLength(0);
      expect(context.bufferSources[0].playbackRate.calls).toContainEqual({ kind: 'set', value: 1, time: 4 });
      expect(context.gains[3].connections).toEqual([context.gains[1]]);
      expect(context.gains[3].gain.calls).toEqual([
        { kind: 'set', value: 0, time: 4 },
        { kind: 'ramp', value: 0.05, time: 4.012 },
        { kind: 'set', value: 0.05, time: 4.988 },
        { kind: 'ramp', value: 0, time: 5 },
      ]);
      expect(controller.cuePlayCounts()['door-closed']).toBe(1);
      await controller.loadDoorRecordings();
      expect(fetcher).toHaveBeenCalledTimes(2);
    } finally { vi.unstubAllGlobals(); }
  });

  it.each(['load', 'mute', 'effects', 'background', 'pause', 'recovery'] as const)(
    '%s reanchors the next observation without stale playback', async boundary => {
      const context = new FakeContext();
      const controller = new AudioController(() => context, undefined);
      vi.stubGlobal('fetch', async () => ({ ok: true, arrayBuffer: async () => new ArrayBuffer(4) }));
      try {
        await controller.unlockFromGesture();
        portalFrame(controller, 0);
        await controller.loadDoorRecordings();
        portalFrame(controller, 1);
        expect(controller.activeDoorVoiceCount()).toBe(1);
        if (boundary === 'load') controller.reset('load');
        if (boundary === 'mute') controller.setMuted(true);
        if (boundary === 'effects') controller.setEffectsLevel(0);
        if (boundary === 'background') await controller.setBackgrounded(true);
        if (boundary === 'pause') controller.setObjectSoundsPaused(true);
        if (boundary === 'recovery') { context.state = 'suspended'; await controller.unlockFromGesture(); }
        expect(controller.activeDoorVoiceCount()).toBe(boundary === 'pause' ? 1 : 0);
        expect(context.bufferSources[0].disconnected).toBe(boundary !== 'pause');
        if (boundary === 'pause') {
          controller.emit({ type: 'door.closed', doorId: 'paused' });
          expect(context.bufferSources).toHaveLength(1);
        }
        if (boundary === 'mute') controller.setMuted(false);
        if (boundary === 'effects') controller.setEffectsLevel(1);
        if (boundary === 'background') await controller.setBackgrounded(false);
        if (boundary === 'pause') controller.setObjectSoundsPaused(false);
        portalFrame(controller, 0);
        expect(context.bufferSources).toHaveLength(1);
        portalFrame(controller, 1);
        expect(context.bufferSources).toHaveLength(2);
      } finally { vi.unstubAllGlobals(); }
    },
  );

  it('bounds concurrent nodes, disconnects ended nodes and cleans up partial hardware failure', async () => {
    const context = new FakeContext();
    const controller = new AudioController(() => context, undefined);
    vi.stubGlobal('fetch', async () => ({ ok: true, arrayBuffer: async () => new ArrayBuffer(4) }));
    try {
      await controller.unlockFromGesture();
      portalFrame(controller, 0);
      await controller.loadDoorRecordings();
      for (let i = 0; i < 8; i++) controller.emit({ type: 'door.opened', doorId: `${i}` });
      expect(controller.activeDoorVoiceCount()).toBe(4);
      expect(context.bufferSources).toHaveLength(4);
      context.bufferSources[0].onended?.();
      expect(controller.activeDoorVoiceCount()).toBe(3);
      expect(context.bufferSources[0].disconnected).toBe(true);
      expect(context.gains[3].disconnected).toBe(true);
      context.createGain = () => { throw new Error('device failed'); };
      expect(() => controller.emit({ type: 'door.opened', doorId: 'failure' })).not.toThrow();
      expect(context.bufferSources[4].disconnected).toBe(true);
      expect(controller.activeDoorVoiceCount()).toBe(3);
    } finally { vi.unstubAllGlobals(); }
  });
});

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

function activityFrame(
  controller: AudioController,
  observations: ReadonlyArray<
    readonly [
      number,
      | 'other'
      | 'conversation'
      | 'sleep'
      | 'eating'
      | 'reading'
      | 'exercise',
      ConversationVoicePair?,
    ]
  >,
): void {
  controller.beginActivityFrame();
  for (const [simId, activity, voice] of observations) {
    controller.observeActivity(simId, activity, voice);
  }
  controller.endActivityFrame();
}

function objectSoundFrame(
  controller: AudioController,
  observations: ReadonlyArray<readonly [number, number]>,
): void {
  controller.beginObjectSoundFrame();
  for (const [sourceId, action] of observations) {
    controller.observeObjectSound(sourceId, action);
  }
  controller.endObjectSoundFrame();
}

const OBJECT_CLIPS: ObjectLoopClips = new Map([
  [1, { buffer: { duration: 4 }, gain: 0.3, loopStart: 0.5, loopEnd: 3.5 }],
  [2, { buffer: { duration: 2 }, gain: 0.2, loopStart: 0, loopEnd: 2 }],
]);

describe('AudioController water recording demand', () => {
  it('ends a playing object through frames while hardware is externally suspended', async () => {
    const context = new FakeContext();
    const controller = new AudioController(() => context, memoryStore());
    controller.installObjectLoopClips(OBJECT_CLIPS);
    await controller.unlockFromGesture();
    objectSoundFrame(controller, [[41, OBJECT_SOUND_ACTION_SHOWER_WATER]]);
    expect(context.bufferSources).toHaveLength(1);
    expect(controller.activeObjectLoopCount()).toBe(1);
    const resumes = context.resumeCalls;

    context.state = 'suspended';
    objectSoundFrame(controller, []);
    expect(controller.activeObjectLoopCount()).toBe(0);
    expect(controller.retainedObjectLoopCount()).toBe(0);
    expect(context.bufferSources[0].disconnected).toBe(true);
    context.state = 'running';
    objectSoundFrame(controller, []);

    expect(controller.activeObjectLoopCount()).toBe(0);
    expect(context.bufferSources[0].stops).toEqual([0]);
    expect(context.bufferSources).toHaveLength(1);
    expect(context.resumeCalls).toBe(resumes);
    context.currentTime = 5;
    objectSoundFrame(controller, []);
    expect(context.bufferSources[0].disconnected).toBe(true);
    expect(controller.retainedObjectLoopCount()).toBe(0);
  });

  it('forgets a pending object decode when its frame ends during external suspension', async () => {
    const context = new FakeContext();
    const controller = new AudioController(() => context, memoryStore());
    const fetcher = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(new ArrayBuffer(16)));
    let entered!: () => void;
    let release!: () => void;
    const decoding = new Promise<void>(resolve => { entered = resolve; });
    const gate = new Promise<void>(resolve => { release = resolve; });
    context.decodeAudioData = async bytes => {
      context.decodedByteLengths.push(bytes.byteLength);
      entered();
      await gate;
      return { duration: 2 };
    };
    try {
      await controller.unlockFromGesture();
      objectSoundFrame(controller, [[41, OBJECT_SOUND_ACTION_SHOWER_WATER]]);
      const loading = controller.loadObjectRecordings();
      await decoding;
      const resumes = context.resumeCalls;
      context.state = 'suspended';
      objectSoundFrame(controller, []);
      context.state = 'running';
      objectSoundFrame(controller, []);
      release();
      await loading;
      expect(context.bufferSources).toHaveLength(0);
      expect(context.resumeCalls).toBe(resumes);
      objectSoundFrame(controller, [[42, OBJECT_SOUND_ACTION_SHOWER_WATER]]);
      await controller.loadObjectRecordings();
      expect(context.bufferSources).toHaveLength(1);
      expect(fetcher).toHaveBeenCalledTimes(1);
      expect(context.decodedByteLengths).toEqual([16]);
    } finally { release(); fetcher.mockRestore(); }
  });

  describe.each([1, 3])('action %s lifecycle', action => {
  it.each(['locked', 'muted', 'effects-zero', 'background', 'pause'] as const)(
    'does not request a recording while %s, then loads on fresh audible demand', async boundary => {
      const context = new FakeContext();
      const controller = new AudioController(() => context, memoryStore());
      const fetcher = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => new Response(new ArrayBuffer(16)));
      try {
        if (boundary !== 'locked') await controller.unlockFromGesture();
        if (boundary === 'muted') controller.setMuted(true);
        if (boundary === 'effects-zero') controller.setEffectsLevel(0);
        if (boundary === 'background') await controller.setBackgrounded(true);
        if (boundary === 'pause') controller.setObjectSoundsPaused(true);
        objectSoundFrame(controller, [[41, action]]);
        await controller.loadObjectRecordings();
        expect(fetcher).not.toHaveBeenCalled();
        if (boundary === 'locked') await controller.unlockFromGesture();
        if (boundary === 'muted') controller.setMuted(false);
        if (boundary === 'effects-zero') controller.setEffectsLevel(0.7);
        if (boundary === 'background') await controller.setBackgrounded(false);
        if (boundary === 'pause') controller.setObjectSoundsPaused(false);
        objectSoundFrame(controller, [[41, action]]);
        await controller.loadObjectRecordings();
        expect(fetcher).toHaveBeenCalledTimes(1);
        expect(controller.activeObjectLoopCount()).toBe(1);
      } finally { fetcher.mockRestore(); }
    },
  );

  it.each(['ended', 'load', 'muted', 'effects-zero', 'background', 'pause', 'context-recovery'] as const)(
    'does not revive pending water ownership after %s, and caches the late success', async boundary => {
      const context = new FakeContext();
      const controller = new AudioController(() => context, memoryStore());
      let resolve!: (response: Response) => void;
      const response = new Promise<Response>(done => { resolve = done; });
      const fetcher = vi.spyOn(globalThis, 'fetch').mockImplementation(() => response);
      try {
        await controller.unlockFromGesture();
        objectSoundFrame(controller, [[41, action]]);
        const loading = controller.loadObjectRecordings();
        expect(fetcher).toHaveBeenCalledTimes(1);
        if (boundary === 'ended') objectSoundFrame(controller, []);
        if (boundary === 'load') controller.reset('load');
        if (boundary === 'muted') controller.setMuted(true);
        if (boundary === 'effects-zero') controller.setEffectsLevel(0);
        if (boundary === 'background') await controller.setBackgrounded(true);
        if (boundary === 'pause') controller.setObjectSoundsPaused(true);
        if (boundary === 'context-recovery') {
          context.state = 'suspended';
          await controller.unlockFromGesture();
        }
        resolve(new Response(new ArrayBuffer(16)));
        await loading;
        expect(context.bufferSources).toHaveLength(0);
        if (boundary === 'muted') controller.setMuted(false);
        if (boundary === 'effects-zero') controller.setEffectsLevel(0.7);
        if (boundary === 'background') await controller.setBackgrounded(false);
        if (boundary === 'pause') controller.setObjectSoundsPaused(false);
        expect(controller.activeObjectLoopCount()).toBe(0);
        objectSoundFrame(controller, [[42, action]]);
        await controller.loadObjectRecordings();
        expect(controller.activeObjectLoopCount()).toBe(1);
        expect(fetcher).toHaveBeenCalledTimes(1);
        expect(context.decodedByteLengths).toEqual([16]);
      } finally { fetcher.mockRestore(); }
    },
  );

  });

  it.each([1, 3] as const)('keeps manual action %s while loading the other water action', async manualAction => {
    const context = new FakeContext();
    const controller = new AudioController(() => context, memoryStore());
    const manual = { buffer: { duration: 8 }, gain: 0.1, loopStart: 0, loopEnd: 8 };
    const fetcher = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(new ArrayBuffer(16)));
    try {
      controller.installObjectLoopClips(new Map([[manualAction, manual]]));
      await controller.unlockFromGesture();
      objectSoundFrame(controller, [[40, manualAction]]);
      await controller.loadObjectRecordings();
      expect(fetcher).not.toHaveBeenCalled();
      objectSoundFrame(controller, [[40, manualAction], [41, manualAction === 1 ? 3 : 1]]);
      await controller.loadObjectRecordings();
      expect(fetcher).toHaveBeenCalledTimes(1);
      expect(context.decodedByteLengths).toEqual([16]);
      expect(context.bufferSources).toHaveLength(2);
      expect(context.bufferSources[0]!.buffer).toBe(manual.buffer);
      expect(context.bufferSources[1]!.buffer?.duration).toBe(1);
      expect(controller.activeObjectLoopCount()).toBe(2);
    } finally { fetcher.mockRestore(); }
  });

  it('shares one fetch and decoded buffer across simultaneous sinks and a shower', async () => {
    const context = new FakeContext();
    const controller = new AudioController(() => context, memoryStore());
    const fetcher = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(new ArrayBuffer(16)));
    try {
      await controller.unlockFromGesture();
      objectSoundFrame(controller, [[40, 3], [41, 1], [42, 3]]);
      await controller.loadObjectRecordings();
      expect(fetcher.mock.calls).toEqual([['audio/objects/shower-water.wav']]);
      expect(context.decodedByteLengths).toEqual([16]);
      expect(context.bufferSources).toHaveLength(3);
      expect(new Set(context.bufferSources.map(source => source.buffer)).size).toBe(1);
      objectSoundFrame(controller, [[41, 1], [42, 3]]);
      expect(context.bufferSources[0]!.stops).toHaveLength(1);
      expect(context.bufferSources[1]!.stops).toHaveLength(0);
      expect(context.bufferSources[2]!.stops).toHaveLength(0);
      expect(controller.activeObjectLoopCount()).toBe(2);
      objectSoundFrame(controller, []);
      expect(controller.activeObjectLoopCount()).toBe(0);
    } finally { fetcher.mockRestore(); }
  });

  it('keeps manually installed clips without requests or an in-flight overwrite', async () => {
    const context = new FakeContext();
    const controller = new AudioController(() => context, memoryStore());
    let resolve!: (response: Response) => void;
    const response = new Promise<Response>(done => { resolve = done; });
    const fetcher = vi.spyOn(globalThis, 'fetch').mockImplementation(() => response);
    try {
      await controller.unlockFromGesture();
      objectSoundFrame(controller, [[41, 1]]);
      const loading = controller.loadObjectRecordings();
      controller.installObjectLoopClips(OBJECT_CLIPS);
      expect(context.bufferSources[0]!.buffer).toBe(OBJECT_CLIPS.get(1)!.buffer);
      resolve(new Response(new ArrayBuffer(16)));
      await loading;
      expect(context.bufferSources).toHaveLength(1);
      controller.reset('load');
      objectSoundFrame(controller, [[42, 1], [43, 2]]);
      await controller.loadObjectRecordings();
      expect(fetcher).toHaveBeenCalledTimes(1);
      expect(context.bufferSources[1]!.buffer).toBe(OBJECT_CLIPS.get(1)!.buffer);
      expect(context.bufferSources[2]!.buffer).toBe(OBJECT_CLIPS.get(2)!.buffer);
      const preinstalled = new AudioController(() => new FakeContext(), memoryStore());
      preinstalled.installObjectLoopClips(OBJECT_CLIPS);
      await preinstalled.unlockFromGesture();
      objectSoundFrame(preinstalled, [[41, 1]]);
      await preinstalled.loadObjectRecordings();
      expect(fetcher).toHaveBeenCalledTimes(1);
    } finally { fetcher.mockRestore(); }
  });

  describe.each([1, 3] as const)('action %s retry', action => {
  it.each(['fetch', 'decode'] as const)('bounds %s failure retries by new water demand, monotonic cooldown, and one batch', async failure => {
    const context = new FakeContext();
    const controller = new AudioController(() => context, memoryStore());
    let now = 0;
    const clock = vi.spyOn(performance, 'now').mockImplementation(() => now);
    let failing = true;
    let resolve!: (response: Response) => void;
    const response = new Promise<Response>(done => { resolve = done; });
    const fetcher = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => {
      if (!failing) return response;
      return failure === 'fetch' ? new Response(null, { status: 503 }) : new Response(new ArrayBuffer(16));
    });
    const decode = vi.spyOn(context, 'decodeAudioData').mockImplementation(async () => {
      if (failing && failure === 'decode') throw new Error('decode failed');
      return { duration: 3 };
    });
    try {
      await controller.unlockFromGesture();
      objectSoundFrame(controller, [[41, action]]);
      await controller.loadObjectRecordings();
      expect(fetcher).toHaveBeenCalledTimes(1);
      expect(controller.activeObjectLoopCount()).toBe(0);
      now = 4999;
      objectSoundFrame(controller, [[42, action]]);
      await controller.loadObjectRecordings();
      expect(fetcher).toHaveBeenCalledTimes(1);
      now = 6000;
      objectSoundFrame(controller, [[42, action]]);
      controller.emit({ type: 'object.sound-started', sourceId: 42, action });
      controller.emit({ type: 'ui.confirmed' });
      expect(fetcher).toHaveBeenCalledTimes(1);
      objectSoundFrame(controller, [[42, action], [43, 2]]);
      expect(fetcher).toHaveBeenCalledTimes(1);
      failing = false;
      objectSoundFrame(controller, [[44, action]]);
      const loading = controller.loadObjectRecordings();
      expect(fetcher).toHaveBeenCalledTimes(2);
      now = 20000;
      objectSoundFrame(controller, [[44, action], [45, action], [46, action]]);
      expect(fetcher).toHaveBeenCalledTimes(2);
      resolve(new Response(new ArrayBuffer(16)));
      await loading;
      expect(controller.activeObjectLoopCount()).toBe(3);
      expect(context.bufferSources).toHaveLength(3);
    } finally { fetcher.mockRestore(); clock.mockRestore(); decode.mockRestore(); }
  });
  });

  it.each([1, 3])('automatically loads water action %s only on audible demand, leaving existing cues intact', async action => {
    const context = new FakeContext();
    const controller = new AudioController(() => context, memoryStore());
    const fetcher = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(new ArrayBuffer(16)));
    try {
      objectSoundFrame(controller, [[41, action]]);
      expect(fetcher).not.toHaveBeenCalled();
      await controller.unlockFromGesture();
      expect(fetcher).not.toHaveBeenCalled();
      objectSoundFrame(controller, [[42, 2]]);
      expect(fetcher).not.toHaveBeenCalled();
      objectSoundFrame(controller, [[41, action]]);
      await vi.waitFor(() => expect(controller.activeObjectLoopCount()).toBe(1));
      expect(fetcher.mock.calls).toEqual([['audio/objects/shower-water.wav']]);
      expect(context.bufferSources[0]!.buffer?.duration).toBe(1);
      controller.emit({ type: 'command.rejected' });
      expect(controller.cuePlayCounts().rejected).toBe(1);
    } finally { fetcher.mockRestore(); }
  });
});

describe('AudioController object loops', () => {
  it.each(['mute', 'effects'] as const)('clears pending loops before a %s hardware gain failure', async boundary => {
    const context = new FakeContext();
    const controller = new AudioController(() => context, memoryStore());
    await controller.unlockFromGesture();
    objectSoundFrame(controller, [[1, 1]]);
    const target = context.gains[boundary === 'mute' ? 0 : 1].gain;
    vi.spyOn(target, 'cancelScheduledValues').mockImplementationOnce(() => { throw Error('hardware'); });
    try {
      if (boundary === 'mute') controller.setMuted(true);
      else controller.setEffectsLevel(0);
    } catch { /* An existing preference failure must not retain object ownership. */ }
    if (boundary === 'mute') controller.setMuted(false);
    else controller.setEffectsLevel(0.7);
    controller.installObjectLoopClips(OBJECT_CLIPS);
    expect(context.bufferSources).toHaveLength(0);
  });

  it('does not affect a playing conversation when only object sounds pause', async () => {
    const context = new FakeContext();
    const controller = new AudioController(() => context, memoryStore());
    await controller.unlockFromGesture();
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () => new Response(new ArrayBuffer(16))) as typeof fetch;
    try { await controller.loadVoiceLibrary(['a', 'b']); }
    finally { globalThis.fetch = originalFetch; }
    controller.emit({ type: 'sim.conversation-started', simId: 4, voice: { owner: 4, endLow: 80, endHigh: 0, first: 0, second: 1 } });
    const stops = context.bufferSources.map(source => [...source.stops]);
    controller.setObjectSoundsPaused(true);
    expect(controller.activeConversationVoiceCount()).toBe(1);
    expect(context.bufferSources.map(source => source.stops)).toEqual(stops);
  });

  it('does not let a stale object stop erase a changed pending action', async () => {
    const context = new FakeContext();
    const controller = new AudioController(() => context, memoryStore());
    await controller.unlockFromGesture();
    controller.emit({ type: 'object.sound-started', sourceId: 41, action: 1 });
    controller.emit({ type: 'object.sound-started', sourceId: 41, action: 2 });
    controller.emit({ type: 'object.sound-stopped', sourceId: 41, action: 1 });
    controller.installObjectLoopClips(OBJECT_CLIPS);
    expect(context.bufferSources).toHaveLength(1);
    expect(context.bufferSources[0].buffer).toEqual({ duration: 2 });
  });

  it('pauses object loops for overlapping overlays without cutting short cues or conversation transport', async () => {
    const context = new FakeContext();
    const controller = new AudioController(() => context, memoryStore());
    controller.installObjectLoopClips(OBJECT_CLIPS);
    await controller.unlockFromGesture();
    const speeds: number[] = [];
    const overlay = new OverlayPauseController(
      withObjectSoundPause({ setSpeed: speed => speeds.push(speed) }, controller),
      () => {}, 2,
    );
    objectSoundFrame(controller, [[1, 1]]);
    controller.emit({ type: 'command.rejected' });
    const shortStops = [...context.oscillators[0].stops];
    overlay.suspend('help');
    overlay.suspend('build');
    expect(controller.activeObjectLoopCount()).toBe(0);
    expect(context.bufferSources[0].disconnected).toBe(false);
    expect(context.oscillators[0].stops).toEqual(shortStops);
    objectSoundFrame(controller, [[1, 1]]);
    controller.installObjectLoopClips(OBJECT_CLIPS);
    expect(context.bufferSources).toHaveLength(1);
    overlay.resume('help');
    overlay.selectSpeed(3);
    expect(context.bufferSources).toHaveLength(1);
    overlay.resume('build');
    expect(speeds).toEqual([0, 3]);
    expect(context.bufferSources).toHaveLength(1);
    objectSoundFrame(controller, [[1, 1]]);
    expect(context.bufferSources).toHaveLength(2);
    overlay.selectSpeed(0);
    overlay.selectSpeed(1);
    objectSoundFrame(controller, []);
    expect(controller.activeObjectLoopCount()).toBe(0);
  });

  it.each(['mute', 'effects', 'background', 'load', 'recovery'] as const)(
    'clears sounding and pending object ownership on %s before later installation', async boundary => {
      const context = new FakeContext();
      const controller = new AudioController(() => context, memoryStore());
      controller.installObjectLoopClips(new Map([[1, OBJECT_CLIPS.get(1)!]]));
      await controller.unlockFromGesture();
      objectSoundFrame(controller, [[1, 1], [2, 2]]);
      if (boundary === 'mute') { controller.setMuted(true); controller.setMuted(false); }
      if (boundary === 'effects') { controller.setEffectsLevel(0); controller.setEffectsLevel(0.7); }
      if (boundary === 'background') { await controller.setBackgrounded(true); await controller.setBackgrounded(false); }
      if (boundary === 'load') controller.reset('load');
      if (boundary === 'recovery') { context.state = 'suspended'; await controller.unlockFromGesture(); }
      expect(controller.retainedObjectLoopCount()).toBe(0);
      expect(context.bufferSources[0].disconnected).toBe(true);
      controller.installObjectLoopClips(OBJECT_CLIPS);
      expect(context.bufferSources).toHaveLength(1);
      objectSoundFrame(controller, [[1, 1], [2, 2]]);
      expect(context.bufferSources).toHaveLength(3);
    },
  );
  it('installs pending clips only for sources still active, through Effects independently of Voices', async () => {
    const context = new FakeContext();
    const controller = new AudioController(() => context, memoryStore());
    await controller.unlockFromGesture();
    objectSoundFrame(controller, [[41, 1], [42, 1]]);
    objectSoundFrame(controller, [[42, 1], [42, 1]]);
    expect(context.bufferSources).toHaveLength(0);
    controller.setVoicesLevel(0);
    controller.installObjectLoopClips(OBJECT_CLIPS);
    expect(context.bufferSources).toHaveLength(1);
    expect(context.gains[3].connections).toEqual([context.gains[1]]);
    objectSoundFrame(controller, [[42, 1]]);
    controller.setVoicesLevel(0.8);
    expect(context.bufferSources).toHaveLength(1);
    objectSoundFrame(controller, []);
    expect(context.bufferSources[0].stops).toEqual([4.02]);
  });

  it('retries rejected live sources on later ticks without restarting admitted loops', async () => {
    const context = new FakeContext();
    const controller = new AudioController(() => context, memoryStore());
    controller.installObjectLoopClips(OBJECT_CLIPS);
    await controller.unlockFromGesture();
    objectSoundFrame(controller, [[1, 1], [2, 1], [3, 1], [4, 1], [5, 2]]);
    expect(context.bufferSources).toHaveLength(4);
    objectSoundFrame(controller, [[2, 1], [3, 1], [4, 1], [5, 2]]);
    expect(context.bufferSources).toHaveLength(5);
    expect(context.bufferSources[4].buffer).toEqual({ duration: 2 });
    expect(context.bufferSources[1].stops).toEqual([]);
    expect(controller.activeObjectLoopCount()).toBe(4);
    context.currentTime = 5;
    objectSoundFrame(controller, [[2, 1], [3, 1], [4, 1], [5, 2]]);
    expect(controller.retainedObjectLoopCount()).toBe(4);
  });
});

describe('AudioController preferences', () => {
  it.each([
    [undefined, 1], [null, 1], ['quiet', 1], [-0.1, 1], [1.1, 1],
    [0, 0], [0.35, 0.35], [1, 1],
  ])('restores Voices %j without discarding valid v1 mute and Effects', (voicesLevel, expected) => {
    const store = memoryStore(JSON.stringify({ version: 1, muted: true, effectsLevel: 0.25, voicesLevel }));
    const controller = new AudioController(() => new FakeContext(), store);
    expect(controller.preferences()).toEqual({ muted: true, effectsLevel: 0.25, voicesLevel: expected });
    expect(store.writes).toHaveLength(0);
  });

  it('uses audible bounded defaults and persists one versioned record', () => {
    const store = memoryStore();
    const controller = new AudioController(() => new FakeContext(), store);

    expect(controller.isMuted()).toBe(false);
    expect(controller.effectsLevel()).toBe(DEFAULT_EFFECTS_LEVEL);

    controller.setMuted(true);
    controller.setEffectsLevel(5);

    expect(controller.preferences()).toEqual({ muted: true, effectsLevel: 1, voicesLevel: 1 });
    expect(store.writes).toHaveLength(2);
    expect(store.writes[1]?.[0]).toBe(AUDIO_PREFERENCES_KEY);
    expect(JSON.parse(store.writes[1]?.[1] ?? '')).toEqual({
      version: AUDIO_PREFERENCES_VERSION,
      muted: true,
      effectsLevel: 1,
      voicesLevel: 1,
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
    ).toEqual({ muted: true, effectsLevel: 0.25, voicesLevel: 1 });

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
      ).toEqual({ muted: false, effectsLevel: DEFAULT_EFFECTS_LEVEL, voicesLevel: 1 });
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

    expect(controller.preferences()).toEqual({ muted: true, effectsLevel: 0.4, voicesLevel: 1 });
  });

  it('bounds Voices previews and persists only the committed setting in v1', () => {
    const store = memoryStore();
    const controller = new AudioController(() => new FakeContext(), store);
    for (const [input, expected] of [[-1, 0], [2, 1], [NaN, 1], [Infinity, 1], [0.35, 0.35]]) {
      controller.previewVoicesLevel(input);
      expect(controller.voicesLevel()).toBe(expected);
    }
    expect(store.writes).toHaveLength(0);
    controller.setVoicesLevel(0.35);
    expect(store.writes).toHaveLength(1);
    expect(store.writes[0]?.[0]).toBe('terrilives.audio-preferences.v1');
    const reloaded = new AudioController(() => new FakeContext(), memoryStore(store.writes[0]![1]));
    expect(reloaded.preferences()).toEqual({ muted: false, effectsLevel: 0.7, voicesLevel: 0.35 });
  });
});

describe('AudioController gesture and cue lifecycle', () => {
  it.each(['connect', 'gain'] as const)('disconnects all buses after Voices %s failure and rebuilds cleanly', async (failure) => {
    const failed = new FakeContext();
    const createGain = failed.createGain.bind(failed);
    failed.createGain = () => {
      const gain = createGain();
      if (failed.gains.length === 3) {
        const reject = () => { throw new Error('voices graph failure'); };
        if (failure === 'connect') gain.connect = reject;
        else gain.gain.setValueAtTime = reject;
      }
      return gain;
    };
    const recovered = new FakeContext();
    let attempts = 0;
    const controller = new AudioController(() => attempts++ === 0 ? failed : recovered, undefined);
    controller.setVoicesLevel(0.2);
    expect(await controller.unlockFromGesture()).toBe(false);
    expect(failed.gains).toHaveLength(3);
    expect(failed.gains.every((gain) => gain.disconnected)).toBe(true);
    expect(failed.closeCalls).toBe(1);
    expect(controller.activeConversationVoiceCount()).toBe(0);
    expect(await controller.unlockFromGesture()).toBe(true);
    expect(recovered.gains[2]?.gain.calls.at(-1)?.value).toBe(0.2);
  });

  it.each(['voices', 'mute', 'effects', 'load', 'background'] as const)(
    'respects %s while a held conversation finishes loading', async (boundary) => {
      const context = new FakeContext();
      const controller = new AudioController(() => context, undefined);
      await controller.unlockFromGesture();
      let release!: (response: Response) => void;
      const response = new Promise<Response>((resolve) => { release = resolve; });
      const originalFetch = globalThis.fetch;
      globalThis.fetch = (async () => (await response).clone()) as typeof fetch;
      try {
        const loading = controller.loadVoiceLibrary(['a', 'b']);
        const voice = { owner: 4, endLow: 80, endHigh: 0, first: 0, second: 1 };
        controller.emit({ type: 'sim.conversation-started', simId: 4, voice });
        controller.previewVoicesLevel(0);
        if (boundary === 'mute') { controller.setMuted(true); controller.setMuted(false); }
        else if (boundary === 'effects') { controller.setEffectsLevel(0); controller.setEffectsLevel(0.7); }
        else if (boundary === 'load') controller.reset('load');
        else if (boundary === 'background') await controller.setBackgrounded(true);
        release(new Response(new ArrayBuffer(16)));
        await loading;
        if (boundary === 'voices') {
          expect(controller.activeConversationVoiceCount()).toBe(1);
          const envelope = context.bufferSources[0]!.connections[0] as FakeGain;
          expect((envelope.connections[0] as FakeGain).gain.calls.at(-1)?.value).toBe(0);
          controller.previewVoicesLevel(1);
          expect(context.bufferSources).toHaveLength(2);
          controller.emit({ type: 'sim.conversation-ended', voice });
          expect(controller.activeConversationVoiceCount()).toBe(0);
          for (const source of context.bufferSources) source.onended?.();
          expect(controller.retainedConversationVoiceCount()).toBe(0);
        } else {
          expect(context.bufferSources).toHaveLength(0);
          expect(controller.activeConversationVoiceCount()).toBe(0);
        }
      } finally { globalThis.fetch = originalFetch; }
    },
  );

  it('routes recorded voices through saved Voices gain while procedural cues bypass it', async () => {
    const context = new FakeContext();
    const controller = new AudioController(() => context, memoryStore(JSON.stringify({
      version: 1, muted: false, effectsLevel: 0.5, voicesLevel: 0.25,
    })));
    await controller.unlockFromGesture();
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () => new Response(new ArrayBuffer(16))) as typeof fetch;
    try { await controller.loadVoiceLibrary(['a', 'b']); }
    finally { globalThis.fetch = originalFetch; }
    controller.emit({ type: 'sim.conversation-started', simId: 4, voice: { owner: 4, endLow: 80, endHigh: 0, first: 0, second: 1 } });
    controller.emit({ type: 'command.rejected' });
    const voiceEnvelope = context.bufferSources[0]!.connections[0] as FakeGain;
    const cueEnvelope = context.oscillators[0]!.connections[0] as FakeGain;
    const voiceBus = voiceEnvelope.connections[0] as FakeGain;
    const effectsBus = cueEnvelope.connections[0] as FakeGain;
    expect(voiceBus).not.toBe(effectsBus);
    expect(voiceBus.connections).toEqual([effectsBus]);
    expect(voiceBus.gain.calls.at(-1)).toEqual({ kind: 'set', value: 0.25, time: 4 });
    expect(effectsBus.gain.calls.at(-1)).toEqual({ kind: 'set', value: 0.5, time: 4 });
    expect((effectsBus.connections[0] as FakeGain).connections).toEqual([context.destination]);

    footstepFrame(controller, 9, 0);
    footstepFrame(controller, 9, 0.3);
    activityFrame(controller, [[8, 'eating']]);
    const sourceStarts = context.bufferSources.map((source) => [...source.starts]);
    const sourceStops = context.bufferSources.map((source) => [...source.stops]);
    const cueCount = context.oscillators.length;
    controller.previewVoicesLevel(0);
    expect(voiceBus.gain.calls.at(-1)).toEqual({ kind: 'set', value: 0, time: 4 });
    expect(controller.activeConversationVoiceCount()).toBe(1);
    activityFrame(controller, [[8, 'eating']]);
    expect(context.oscillators).toHaveLength(cueCount);
    footstepFrame(controller, 9, 0.42);
    expect(controller.cuePlayCounts().footstep).toBe(1);
    controller.setVoicesLevel(0.6);
    expect(voiceBus.gain.calls.at(-1)).toEqual({ kind: 'set', value: 0.6, time: 4 });
    expect(context.bufferSources.map((source) => source.starts)).toEqual(sourceStarts);
    expect(context.bufferSources.map((source) => source.stops)).toEqual(sourceStops);
    expect(context.bufferSources).toHaveLength(2);
  });

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

  it('permits a later retry after a rejected gesture', async () => {
    const context = new FakeContext();
    context.rejectResume = true;
    const controller = new AudioController(() => context, undefined);

    expect(await controller.unlockFromGesture()).toBe(false);
    expect(context.resumeCalls).toBe(1);

    context.rejectResume = false;
    expect(await controller.unlockFromGesture()).toBe(true);
    expect(context.resumeCalls).toBe(2);
  });

  it('builds the context once even when gestures arrive back to back', async () => {
    const context = new FakeContext();
    const factory = vi.fn(() => context);
    const controller = new AudioController(factory, undefined);

    const first = controller.unlockFromGesture();
    const second = controller.unlockFromGesture();
    expect(await first).toBe(true);
    expect(await second).toBe(true);
    expect(factory).toHaveBeenCalledTimes(1);
  });

  it('still reaches the browser on a later gesture when a resume never settles', async () => {
    // Chrome answers a blocked resume with a promise it never settles. Caching
    // that promise and handing it to every later gesture is what turned one
    // mistimed tap into a session with no sound at all.
    const context = new FakeContext();
    context.hangResume = true;
    const controller = new AudioController(() => context, undefined);

    void controller.unlockFromGesture();
    expect(context.resumeCalls).toBe(1);

    void controller.unlockFromGesture();
    expect(context.resumeCalls).toBe(2);

    context.hangResume = false;
    expect(await controller.unlockFromGesture()).toBe(true);
    expect(controller.isUnlocked()).toBe(true);
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

  it('keeps routine controls silent and gives rejection one quiet short cue', async () => {
    const context = new FakeContext();
    const controller = new AudioController(() => context, undefined);
    await controller.unlockFromGesture();

    controller.emit({ type: 'command.staged' });
    controller.emit({ type: 'ui.confirmed' });
    expect(context.oscillators).toHaveLength(0);

    controller.emit({ type: 'command.rejected' });

    const [rejected] = context.oscillators;
    expect(rejected?.type).toBe('triangle');
    expect(rejected?.frequency.calls).toContainEqual({
      kind: 'set',
      value: 520,
      time: 4,
    });
    expect(rejected?.frequency.calls).toContainEqual({
      kind: 'ramp',
      value: 680,
      time: 4.09,
    });
    expect((rejected?.connections[0] as FakeGain).gain.calls).toContainEqual({
      kind: 'ramp',
      value: 0.07,
      time: 4.008,
    });
    expect(rejected?.stops).toEqual([4.09]);
    expect(Math.max(...(rejected?.stops ?? [])) - context.currentTime).toBeLessThan(
      0.15,
    );
  });

  it('keeps an isolated footstep out of the bass-only thud range', async () => {
    const context = new FakeContext();
    const controller = new AudioController(() => context, undefined);
    await controller.unlockFromGesture();

    footstepFrame(controller, 3, 0);
    footstepFrame(controller, 3, FOOTSTEP_DISTANCE_TILES);

    const footstep = context.oscillators[0];
    expect(footstep?.type).toBe('triangle');
    const pitchedValues = footstep?.frequency.calls
      .map((call) => call.value)
      .filter((value): value is number => value !== undefined);
    expect(Math.min(...(pitchedValues ?? []))).toBeGreaterThanOrEqual(120);
  });

  it('drops a held conversation when the player silences the game', async () => {
    // A conversation can begin while the recordings are still decoding, and
    // is held so it can start when they land. If the player mutes in that
    // window the hold has to go: resetting the scheduler emits no end event,
    // so nothing else would clear it, and the library landing afterwards
    // would start a conversation that is over - against a muted master gain,
    // and audible again the moment the player unmutes.
    const context = new FakeContext();
    const controller = new AudioController(() => context, undefined);
    await controller.unlockFromGesture();

    // No library yet, so the conversation cannot play and is held.
    activityFrame(controller, [[4, 'conversation', { owner: 4, endLow: 80, endHigh: 0, first: 1, second: 0 }]]);
    expect(context.bufferSources).toHaveLength(0);

    controller.setMuted(true);

    // **Unmuted before the library lands**, which is what makes this test
    // about the hold being DROPPED rather than about the retry's own gate.
    // With the hold cleared nothing plays, correctly, because the
    // conversation is long over. Leave the hold in place and a finished
    // conversation starts here.
    controller.setMuted(false);

    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () =>
      new Response(new ArrayBuffer(16))) as typeof globalThis.fetch;
    try {
      await controller.loadVoiceLibrary(['clip-a', 'clip-b']);
    } finally {
      globalThis.fetch = originalFetch;
    }

    expect(context.decodedByteLengths).toHaveLength(2);
    expect(context.bufferSources).toHaveLength(0);
    expect(controller.activeConversationVoiceCount()).toBe(0);
  });

  it('does not substitute procedural tones for missing door recordings', async () => {
    const context = new FakeContext();
    const controller = new AudioController(() => context, undefined);
    await controller.unlockFromGesture();

    controller.emit({ type: 'door.closed', doorId: 'front' });
    controller.emit({ type: 'door.opened', doorId: 'front' });
    controller.emit({ type: 'command.rejected' });

    expect(controller.cuePlayCounts()).toMatchObject({
      'door-closed': 0,
      'door-opened': 0,
      rejected: 1,
    });
    expect(context.oscillators).toHaveLength(1);
  });

  it('plays a conversation\'s recordings end to end from an observed frame', async () => {
    // **The regression this exists for.** `observeActivity` took two
    // parameters while the interface it implements takes three, which
    // TypeScript accepts: a narrower function is assignable to a wider
    // signature. The clip pair was therefore dropped on the floor, and every
    // other check passed - the simulation drew a pair, the render buffer
    // carried it, the library loaded, and nothing made a sound. Only running
    // the real game found it, so the seam gets a test rather than trust.
    const context = new FakeContext();
    const controller = new AudioController(() => context, undefined);
    await controller.unlockFromGesture();

    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () =>
      new Response(new ArrayBuffer(16))) as typeof globalThis.fetch;
    try {
      await controller.loadVoiceLibrary(['clip-a', 'clip-b']);
    } finally {
      globalThis.fetch = originalFetch;
    }

    expect(context.decodedByteLengths).toHaveLength(2);
    expect(context.bufferSources).toHaveLength(0);

    activityFrame(controller, [[4, 'conversation', { owner: 4, endLow: 80, endHigh: 0, first: 1, second: 0 }]]);

    // Two recordings, one conversation: the pair plays back to back.
    expect(context.bufferSources).toHaveLength(2);
    expect(controller.activeConversationVoiceCount()).toBe(1);

    activityFrame(controller, [[4, 'other']]);
    expect(controller.activeConversationVoiceCount()).toBe(0);
  });

  it('ends only the matching conversation through frames during external suspension', async () => {
    const context = new FakeContext();
    const controller = new AudioController(() => context, undefined);
    const fetcher = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => new Response(new ArrayBuffer(16)));
    try {
      await controller.unlockFromGesture();
      await controller.loadVoiceLibrary(['a', 'b']);
      const ended = { owner: 4, endLow: 80, endHigh: 0, first: 0, second: 1 };
      const continuing = { ...ended, owner: 6 };
      activityFrame(controller, [[4, 'conversation', ended], [6, 'conversation', continuing]]);
      expect(controller.activeConversationVoiceCount()).toBe(2);
      expect(context.bufferSources).toHaveLength(4);
      const continuingStops = context.bufferSources.slice(2).map(source => [...source.stops]);
      const resumes = context.resumeCalls;
      context.currentTime = 4.25;
      context.state = 'suspended';
      activityFrame(controller, [[6, 'conversation', continuing]]);
      expect(controller.retainedConversationVoiceCount()).toBe(1);
      expect(context.bufferSources.slice(0, 2).every(source => source.disconnected && source.onended === null)).toBe(true);
      context.state = 'running';
      activityFrame(controller, [[6, 'conversation', continuing]]);
      expect(controller.activeConversationVoiceCount()).toBe(1);
      expect(context.bufferSources).toHaveLength(4);
      expect(context.bufferSources[0].stops.at(-1)).toBe(4.25);
      expect(context.bufferSources.slice(2).map(source => source.stops)).toEqual(continuingStops);
      expect(context.resumeCalls).toBe(resumes);
    } finally { fetcher.mockRestore(); }
  });

  it('cancels only the ended pending conversation decode during external suspension', async () => {
    const context = new FakeContext();
    const controller = new AudioController(() => context, undefined);
    const fetcher = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => new Response(new ArrayBuffer(16)));
    let entered!: () => void;
    let release!: () => void;
    const decoding = new Promise<void>(resolve => { entered = resolve; });
    const gate = new Promise<void>(resolve => { release = resolve; });
    context.decodeAudioData = async bytes => {
      context.decodedByteLengths.push(bytes.byteLength);
      entered();
      await gate;
      return { duration: 1 };
    };
    try {
      await controller.unlockFromGesture();
      const loading = controller.loadVoiceLibrary(['a', 'b']);
      await decoding;
      const ended = { owner: 4, endLow: 80, endHigh: 0, first: 0, second: 1 };
      const continuing = { ...ended, owner: 6 };
      activityFrame(controller, [[4, 'conversation', ended], [6, 'conversation', continuing]]);
      const resumes = context.resumeCalls;
      context.state = 'suspended';
      activityFrame(controller, [[6, 'conversation', continuing]]);
      context.state = 'running';
      activityFrame(controller, [[6, 'conversation', continuing]]);
      release();
      await loading;
      expect(context.bufferSources).toHaveLength(2);
      expect(controller.activeConversationVoiceCount()).toBe(1);
      expect(context.resumeCalls).toBe(resumes);
      expect(fetcher).toHaveBeenCalledTimes(2);
    } finally { release(); fetcher.mockRestore(); }
  });

  it.each(['fetch', 'decode'] as const)('recovers a %s failure on new conversation demand without restarting a good pair', async (failure) => {
    const context = new FakeContext();
    const controller = new AudioController(() => context, undefined);
    const requests: string[] = [];
    let failing = true;
    const clock = vi.spyOn(performance, 'now').mockReturnValue(0);
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (input) => {
      const url = String(input);
      requests.push(url);
      if (failing && failure === 'fetch' && url.includes('bad')) return new Response(null, { status: 503 });
      return new Response(new ArrayBuffer(url.includes('bad') ? 2 : 1));
    }) as typeof fetch;
    context.decodeAudioData = async (bytes) => {
      if (failing && failure === 'decode' && bytes.byteLength === 2) throw new Error('decode');
      return { duration: bytes.byteLength };
    };
    try {
      await controller.loadVoiceLibrary(['good', 'bad']);
      expect(requests).toEqual([]);
      await controller.unlockFromGesture();
      await controller.loadVoiceLibrary(['good', 'bad']);
      expect(requests).toHaveLength(2);
      const good = { owner: 0, endLow: 80, endHigh: 0, first: 0, second: 0 };
      const missing = { ...good, owner: 2, first: 1 };
      clock.mockReturnValue(5000);
      activityFrame(controller, [[0, 'conversation', good]]);
      const goodSources = context.bufferSources.slice();
      failing = false;
      clock.mockReturnValue(5000);
      await controller.unlockFromGesture();
      activityFrame(controller, [[0, 'conversation', good]]);
      expect(requests).toHaveLength(2);
      activityFrame(controller, [[0, 'conversation', good], [2, 'conversation', missing]]);
      expect(requests).toEqual(['audio/voice/good.wav', 'audio/voice/bad.wav', 'audio/voice/bad.wav']);
      await controller.loadVoiceLibrary(['good', 'bad']);
      expect(controller.activeConversationVoiceCount()).toBe(2);
      expect(context.bufferSources.map((source) => source.buffer?.duration)).toEqual([1, 1, 2, 1]);
      expect(goodSources.map((source) => source.stops.length)).toEqual([1, 1]);
      activityFrame(controller, [[0, 'conversation', good]]);
      expect(controller.activeConversationVoiceCount()).toBe(1);
    } finally {
      globalThis.fetch = originalFetch;
      clock.mockRestore();
    }
  });

  it('bounds failed retries by new demand, cooldown and one in-flight batch', async () => {
    const context = new FakeContext();
    const controller = new AudioController(() => context, undefined);
    const clock = vi.spyOn(performance, 'now').mockReturnValue(0);
    const originalFetch = globalThis.fetch;
    let requests = 0;
    let release!: () => void;
    let gate = Promise.resolve();
    globalThis.fetch = (async () => {
      requests += 1;
      await gate;
      return new Response(null, { status: 503 });
    }) as typeof fetch;
    const voice = { owner: 0, endLow: 80, endHigh: 0, first: 0, second: 1 };
    const start = (endLow: number) => controller.emit({
      type: 'sim.conversation-started', simId: 0, voice: { ...voice, endLow },
    });
    try {
      await controller.unlockFromGesture();
      await controller.loadVoiceLibrary(['a', 'b']);
      start(80);
      clock.mockReturnValue(4999);
      start(81);
      expect(requests).toBe(2);
      clock.mockReturnValue(5000);
      start(80);
      expect(requests).toBe(2);
      gate = new Promise<void>((resolve) => { release = resolve; });
      start(82);
      expect(requests).toBe(4);
      clock.mockReturnValue(15000);
      start(83);
      start(84);
      const joining = controller.loadVoiceLibrary(['a', 'b']);
      expect(requests).toBe(4);
      release();
      await joining;
      expect(requests).toBe(4);
      start(82);
      expect(requests).toBe(4);
      start(85);
      await controller.loadVoiceLibrary(['a', 'b']);
      expect(requests).toBe(6);
      expect(context.bufferSources).toHaveLength(0);
    } finally {
      globalThis.fetch = originalFetch;
      clock.mockRestore();
    }
  });

  it.each(['ended', 'mute', 'effects', 'load', 'background', 'recovery'] as const)(
    'does not revive a pending recovery after the %s boundary', async (boundary) => {
      const context = new FakeContext();
      const controller = new AudioController(() => context, undefined);
      const clock = vi.spyOn(performance, 'now').mockReturnValue(0);
      const originalFetch = globalThis.fetch;
      globalThis.fetch = (async () => new Response(null, { status: 503 })) as typeof fetch;
      const voice = { owner: 0, endLow: 80, endHigh: 0, first: 1, second: 0 };
      try {
        await controller.unlockFromGesture();
        await controller.loadVoiceLibrary(['a', 'b']);
        let release!: () => void;
        const gate = new Promise<void>((resolve) => { release = resolve; });
        globalThis.fetch = (async () => {
          await gate;
          return new Response(new ArrayBuffer(16));
        }) as typeof fetch;
        clock.mockReturnValue(5000);
        activityFrame(controller, [[0, 'conversation', voice]]);
        const joining = controller.loadVoiceLibrary(['a', 'b']);
        if (boundary === 'ended') activityFrame(controller, []);
        else if (boundary === 'mute') {
          controller.setMuted(true);
          controller.setMuted(false);
        } else if (boundary === 'effects') {
          controller.setEffectsLevel(0);
          controller.setEffectsLevel(1);
        } else if (boundary === 'background') {
          await controller.setBackgrounded(true);
          await controller.setBackgrounded(false);
        } else if (boundary === 'recovery') {
          context.state = 'suspended';
          await controller.unlockFromGesture();
        } else controller.reset('load');
        release();
        await joining;
        expect(context.bufferSources).toHaveLength(0);
        activityFrame(controller, [[0, 'conversation', { ...voice, endLow: 90 }]]);
        expect(controller.activeConversationVoiceCount()).toBe(1);
      } finally {
        globalThis.fetch = originalFetch;
        clock.mockRestore();
      }
    },
  );

  it('retries missing slots on an explicit load without a conversation', async () => {
    const context = new FakeContext();
    const controller = new AudioController(() => context, undefined);
    const originalFetch = globalThis.fetch;
    let requests = 0;
    globalThis.fetch = (async () => {
      requests += 1;
      return new Response(null, { status: 503 });
    }) as typeof fetch;
    try {
      await controller.unlockFromGesture();
      await controller.loadVoiceLibrary(['a', 'b']);
      globalThis.fetch = (async () => {
        requests += 1;
        return new Response(new ArrayBuffer(16));
      }) as typeof fetch;
      await controller.loadVoiceLibrary(['a', 'b']);
      await controller.loadVoiceLibrary(['a', 'b']);
      expect(requests).toBe(4);
      activityFrame(controller, [[0, 'conversation', { owner: 0, endLow: 80, endHigh: 0, first: 0, second: 1 }]]);
      expect(controller.activeConversationVoiceCount()).toBe(1);
    } finally { globalThis.fetch = originalFetch; }
  });

  it('starts and stops only the matching conversation recording pair', async () => {
    const context = new FakeContext();
    const controller = new AudioController(() => context, undefined);
    await controller.unlockFromGesture();
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () => new Response(new ArrayBuffer(16))) as typeof fetch;
    try { await controller.loadVoiceLibrary(['a', 'b']); }
    finally { globalThis.fetch = originalFetch; }
    const a = { owner: 0, endLow: 80, endHigh: 0, first: 0, second: 1 };
    const b = { ...a, owner: 2 };
    activityFrame(controller, [[0, 'conversation', a], [1, 'conversation', a]]);
    const firstSources = context.bufferSources.slice();
    activityFrame(controller, [[0, 'conversation', a], [1, 'conversation', a], [2, 'conversation', b], [3, 'conversation', b]]);
    expect(controller.activeConversationVoiceCount()).toBe(2);
    expect(firstSources.map((source) => source.stops.length)).toEqual([1, 1]);
    activityFrame(controller, [[2, 'conversation', b], [3, 'conversation', b]]);
    expect(controller.activeConversationVoiceCount()).toBe(1);
    expect(context.bufferSources).toHaveLength(4);
    expect(context.bufferSources.slice(2).map((source) => source.stops.length)).toEqual([1, 1]);
    expect(firstSources.map((source) => source.stops.length)).toEqual([2, 2]);
  });

  it.each([false, true])('holds each pair independently while decoding, ended first=%s', async (endFirst) => {
    const context = new FakeContext();
    const controller = new AudioController(() => context, undefined);
    await controller.unlockFromGesture();
    const a = { owner: 0, endLow: 80, endHigh: 0, first: 0, second: 1 };
    const b = { ...a, owner: 2 };
    activityFrame(controller, [[0, 'conversation', a], [2, 'conversation', b]]);
    if (endFirst) activityFrame(controller, [[2, 'conversation', b]]);
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () => new Response(new ArrayBuffer(16))) as typeof fetch;
    try { await controller.loadVoiceLibrary(['a', 'b']); }
    finally { globalThis.fetch = originalFetch; }
    expect(controller.activeConversationVoiceCount()).toBe(endFirst ? 1 : 2);
    expect(context.bufferSources).toHaveLength(endFirst ? 2 : 4);
    activityFrame(controller, []);
    expect(controller.activeConversationVoiceCount()).toBe(0);
  });

  it.each(['mute', 'effects', 'load', 'background', 'recovery'] as const)(
    'clears all held conversations at the %s boundary', async (boundary) => {
      const context = new FakeContext();
      const controller = new AudioController(() => context, undefined);
      await controller.unlockFromGesture();
      const a = { owner: 0, endLow: 80, endHigh: 0, first: 0, second: 1 };
      const b = { ...a, owner: 2 };
      activityFrame(controller, [[0, 'conversation', a], [2, 'conversation', b]]);
      if (boundary === 'mute') {
        controller.setMuted(true);
        controller.setMuted(false);
      } else if (boundary === 'effects') {
        controller.setEffectsLevel(0);
        controller.setEffectsLevel(1);
      } else if (boundary === 'background') {
        await controller.setBackgrounded(true);
        await controller.setBackgrounded(false);
      } else if (boundary === 'recovery') {
        context.state = 'suspended';
        await controller.unlockFromGesture();
      } else controller.reset(boundary);
      const originalFetch = globalThis.fetch;
      globalThis.fetch = (async () => new Response(new ArrayBuffer(16))) as typeof fetch;
      try { await controller.loadVoiceLibrary(['a', 'b']); }
      finally { globalThis.fetch = originalFetch; }
      expect(context.bufferSources).toHaveLength(0);
      activityFrame(controller, [[0, 'conversation', a], [2, 'conversation', b]]);
      expect(controller.activeConversationVoiceCount()).toBe(2);
    },
  );

  it('drops pre-suspension voice nodes before observing recovered conversations', async () => {
    const context = new FakeContext();
    const controller = new AudioController(() => context, undefined);
    await controller.unlockFromGesture();
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () => new Response(new ArrayBuffer(16))) as typeof fetch;
    try { await controller.loadVoiceLibrary(['a', 'b']); }
    finally { globalThis.fetch = originalFetch; }
    const a = { owner: 0, endLow: 80, endHigh: 0, first: 0, second: 1 };
    const b = { ...a, owner: 2 };
    activityFrame(controller, [[0, 'conversation', a], [2, 'conversation', b]]);
    expect(controller.activeConversationVoiceCount()).toBe(2);
    context.state = 'suspended';
    await controller.unlockFromGesture();
    expect(controller.activeConversationVoiceCount()).toBe(0);
    activityFrame(controller, [[2, 'conversation', b]]);
    expect(controller.activeConversationVoiceCount()).toBe(1);
    activityFrame(controller, []);
    expect(controller.activeConversationVoiceCount()).toBe(0);
  });

  it('synthesizes no tone for a conversation, which now plays recordings', async () => {
    const context = new FakeContext();
    const controller = new AudioController(() => context, undefined);
    await controller.unlockFromGesture();

    // This asserted a triangle tone until the recorded voices replaced it.
    // A conversation is two clips the simulation chose, so an oscillator
    // here would be a leftover beeping underneath them.
    activityFrame(controller, [
      [12, 'conversation'],
      [4, 'conversation'],
    ]);
    expect(context.oscillators).toHaveLength(0);

    activityFrame(controller, []);
    activityFrame(controller, [[9, 'sleep']]);

    const [sleep] = context.oscillators;
    expect(context.oscillators).toHaveLength(1);
    expect(sleep?.type).toBe('sine');
    expect(sleep?.stops[0]).toBeLessThanOrEqual(4.5);
  });

  it('keeps eating, reading, and exercise distinct without a bassy exercise thud', async () => {
    const context = new FakeContext();
    const controller = new AudioController(() => context, undefined);
    await controller.unlockFromGesture();

    activityFrame(controller, [[5, 'eating']]);
    activityFrame(controller, [[5, 'reading']]);
    activityFrame(controller, [[5, 'exercise']]);

    const [eating, reading, exercise] = context.oscillators;
    expect(eating?.type).toBe('sine');
    expect(reading?.type).toBe('triangle');
    expect(exercise?.type).toBe('triangle');
    const exerciseFrequencies = exercise?.frequency.calls
      .map((call) => call.value)
      .filter((value): value is number => value !== undefined);
    expect(exerciseFrequencies).toHaveLength(2);
    expect(exerciseFrequencies?.[0]).toBeCloseTo(520 * 1.01);
    expect(exerciseFrequencies?.[1]).toBeCloseTo(340 * 1.01);
    expect(Math.min(...(exerciseFrequencies ?? []))).toBeGreaterThanOrEqual(300);
    expect(eating?.frequency.calls).not.toEqual(reading?.frequency.calls);
    expect(reading?.frequency.calls).not.toEqual(exercise?.frequency.calls);
    expect(eating?.stops[0]).toBeLessThanOrEqual(4.12);
    expect(reading?.stops[0]).toBeLessThanOrEqual(4.16);
    expect(exercise?.stops[0]).toBeLessThanOrEqual(4.09);
    const cuePeakGains = context.oscillators.map((oscillator) => oscillator.connections[0] as FakeGain).map((gain) =>
      Math.max(
        ...gain.gain.calls
          .map((call) => call.value)
          .filter((value): value is number => value !== undefined),
      ),
    );
    expect(cuePeakGains).toEqual([0.022, 0.018, 0.014]);
  });

  it('tracks exact object sounds without inventing a procedural replacement', async () => {
    const context = new FakeContext();
    const controller = new AudioController(() => context, undefined);
    await controller.unlockFromGesture();

    objectSoundFrame(controller, [
      [44, OBJECT_SOUND_ACTION_SHOWER_WATER],
      [73, OBJECT_SOUND_ACTION_STOVE_COOKING],
    ]);
    objectSoundFrame(controller, [
      [44, OBJECT_SOUND_ACTION_SHOWER_WATER],
      [73, OBJECT_SOUND_ACTION_STOVE_COOKING],
    ]);

    expect(controller.activeObjectSoundTrackCount()).toBe(2);
    expect(context.oscillators).toHaveLength(0);

    objectSoundFrame(controller, []);
    expect(controller.activeObjectSoundTrackCount()).toBe(0);
    expect(context.oscillators).toHaveLength(0);
  });

  it.each(['load', 'background'] as const)(
    'clears exact object sound state across the %s boundary',
    async (boundary) => {
      const context = new FakeContext();
      const controller = new AudioController(() => context, undefined);
      await controller.unlockFromGesture();
      objectSoundFrame(controller, [[44, OBJECT_SOUND_ACTION_SHOWER_WATER]]);
      expect(controller.activeObjectSoundTrackCount()).toBe(1);

      if (boundary === 'background') {
        await controller.setBackgrounded(true);
        await controller.setBackgrounded(false);
      } else {
        controller.reset(boundary);
      }

      expect(controller.activeObjectSoundTrackCount()).toBe(0);
      objectSoundFrame(controller, [[44, OBJECT_SOUND_ACTION_SHOWER_WATER]]);
      expect(controller.activeObjectSoundTrackCount()).toBe(1);
    },
  );

  it.each(['mute', 'effects'] as const)(
    'restarts exact object sound state after the %s silence boundary',
    async (boundary) => {
      const context = new FakeContext();
      const controller = new AudioController(() => context, undefined);
      await controller.unlockFromGesture();
      objectSoundFrame(controller, [[44, OBJECT_SOUND_ACTION_SHOWER_WATER]]);
      expect(controller.activeObjectSoundTrackCount()).toBe(1);

      if (boundary === 'mute') {
        controller.setMuted(true);
      } else {
        controller.setEffectsLevel(0);
      }
      objectSoundFrame(controller, [[44, OBJECT_SOUND_ACTION_SHOWER_WATER]]);
      expect(controller.activeObjectSoundTrackCount()).toBe(1);

      if (boundary === 'mute') {
        controller.setMuted(false);
      } else {
        controller.setEffectsLevel(0.4);
      }
      expect(controller.activeObjectSoundTrackCount()).toBe(0);
      objectSoundFrame(controller, [[44, OBJECT_SOUND_ACTION_SHOWER_WATER]]);
      expect(controller.activeObjectSoundTrackCount()).toBe(1);
    },
  );

  it('starts personal cadence fresh after the first unlock', async () => {
    const context = new FakeContext();
    const controller = new AudioController(() => context, undefined);

    activityFrame(controller, [[5, 'eating']]);
    await controller.unlockFromGesture();
    activityFrame(controller, [[5, 'eating']]);

    expect(context.oscillators).toHaveLength(1);
  });

  it.each(['mute', 'effects'] as const)(
    'starts personal cadence fresh after the %s silence boundary',
    async (boundary) => {
      const context = new FakeContext();
      const controller = new AudioController(() => context, undefined);
      await controller.unlockFromGesture();
      activityFrame(controller, [[5, 'eating']]);
      expect(controller.cuePlayCounts().eating).toBe(1);

      if (boundary === 'mute') {
        controller.setMuted(true);
      } else {
        controller.setEffectsLevel(0);
      }
      activityFrame(controller, [[5, 'eating']]);

      if (boundary === 'mute') {
        controller.setMuted(false);
      } else {
        controller.setEffectsLevel(0.4);
      }
      activityFrame(controller, [[5, 'eating']]);

      expect(controller.cuePlayCounts().eating).toBe(2);
      expect(context.oscillators).toHaveLength(2);
    },
  );

  it('counts only cues that successfully reach the procedural player', async () => {
    const context = new FakeContext();
    const controller = new AudioController(() => context, undefined);

    controller.emit({ type: 'sim.sleep-breath', simId: 3, breathIndex: 0 });
    expect(controller.cuePlayCounts()['sleep-breath']).toBe(0);

    await controller.unlockFromGesture();
    controller.emit({ type: 'sim.sleep-breath', simId: 3, breathIndex: 0 });
    controller.emit({ type: 'sim.eating', simId: 3, biteIndex: 0 });

    expect(controller.cuePlayCounts()).toMatchObject({
      eating: 1,
      'sleep-breath': 1,
    });
    expect(context.oscillators).toHaveLength(2);
  });

  it.each(['load', 'background'] as const)(
    'starts personal cadence fresh after the %s boundary',
    async (boundary) => {
      const context = new FakeContext();
      const controller = new AudioController(() => context, undefined);
      await controller.unlockFromGesture();
      activityFrame(controller, [[5, 'eating']]);

      if (boundary === 'background') {
        await controller.setBackgrounded(true);
        await controller.setBackgrounded(false);
      } else {
        controller.reset(boundary);
      }
      activityFrame(controller, [[5, 'eating']]);

      expect(context.oscillators).toHaveLength(2);
    },
  );

  it('applies mute and effects level immediately without creating muted voices', async () => {
    const context = new FakeContext();
    const controller = new AudioController(() => context, undefined);
    await controller.unlockFromGesture();
    const master = context.gains[0];
    const effects = context.gains[1];
    expect(context.gains).toHaveLength(3);
    expect(effects?.connections).toEqual([master]);
    expect(master?.connections).toEqual([context.destination]);

    controller.emit({ type: 'ui.confirmed' });
    expect(controller.activeVoiceCount()).toBe(0);

    controller.setMuted(true);
    expect(controller.activeVoiceCount()).toBe(0);
    expect(master?.gain.calls.at(-1)).toEqual({ kind: 'set', value: 0, time: 4 });
    controller.emit({ type: 'command.rejected' });
    expect(context.oscillators).toHaveLength(0);

    controller.setMuted(false);
    controller.setEffectsLevel(0.35);
    expect(master?.gain.calls.at(-1)).toEqual({ kind: 'set', value: 1, time: 4 });
    expect(effects?.gain.calls.at(-1)).toEqual({
      kind: 'set',
      value: 0.35,
      time: 4,
    });
    controller.emit({ type: 'command.rejected' });
    expect(context.oscillators).toHaveLength(1);
  });

  it('caps active voices and disconnects the oldest voice in a burst', async () => {
    const context = new FakeContext();
    const controller = new AudioController(() => context, undefined);
    await controller.unlockFromGesture();

    for (let index = 0; index < 9; index += 1) {
      controller.emit({ type: 'command.rejected' });
    }

    expect(controller.activeVoiceCount()).toBe(8);
    expect(context.oscillators).toHaveLength(9);
    expect(context.oscillators[0]?.stops).toEqual([4.09, 4]);
    expect(context.oscillators[0]?.disconnected).toBe(true);
    expect((context.oscillators[0]?.connections[0] as FakeGain).disconnected).toBe(true);
  });

  it('disconnects a naturally ended voice and releases it from the cap', async () => {
    const context = new FakeContext();
    const controller = new AudioController(() => context, undefined);
    await controller.unlockFromGesture();
    controller.emit({ type: 'command.rejected' });

    context.oscillators[0]?.onended?.();

    expect(controller.activeVoiceCount()).toBe(0);
    expect(context.oscillators[0]?.disconnected).toBe(true);
    expect(context.gains.at(-1)?.disconnected).toBe(true);
  });

  it('contains per-cue node creation failures and permits a later footstep', async () => {
    const context = new FakeContext();
    const controller = new AudioController(() => context, undefined);
    await controller.unlockFromGesture();
    const createOscillator = context.createOscillator.bind(context);
    context.createOscillator = () => {
      throw new Error('device disappeared');
    };

    expect(() => controller.emit({ type: 'command.rejected' })).not.toThrow();
    expect(controller.activeVoiceCount()).toBe(0);
    expect(controller.cuePlayCounts().rejected).toBe(0);

    context.createOscillator = createOscillator;
    footstepFrame(controller, 27, 0);
    footstepFrame(controller, 27, FOOTSTEP_DISTANCE_TILES);
    expect(controller.activeVoiceCount()).toBe(1);
    expect(controller.cuePlayCounts().footstep).toBe(1);
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

    expect(() => controller.emit({ type: 'command.rejected' })).not.toThrow();
    expect(controller.activeVoiceCount()).toBe(0);
    expect(context.oscillators[0]?.disconnected).toBe(true);
    expect(context.gains.at(-1)?.disconnected).toBe(true);
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

    expect(() => controller.emit({ type: 'command.rejected' })).not.toThrow();
    expect(context.oscillators[0]?.starts).toEqual([4]);
    expect(controller.activeVoiceCount()).toBe(0);
    expect(context.oscillators[0]?.disconnected).toBe(true);
    expect(context.gains.at(-1)?.disconnected).toBe(true);
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
      controller.emit({ type: 'sim.footstep', simId: 1, stepIndex: 0 });

      controller.reset(boundary);

      expect(controller.activeVoiceCount()).toBe(0);
      expect(context.oscillators[0]?.stops).toEqual([4.04, 4]);
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

  it('clears every scheduler after an externally suspended context recovers', async () => {
    const context = new FakeContext();
    const controller = new AudioController(() => context, undefined);
    await controller.unlockFromGesture();
    footstepFrame(controller, 17, 0);
    activityFrame(controller, [[17, 'eating']]);
    objectSoundFrame(controller, [[44, OBJECT_SOUND_ACTION_SHOWER_WATER]]);

    context.state = 'suspended';
    footstepFrame(controller, 17, 0.4);
    activityFrame(controller, [[17, 'eating']]);
    objectSoundFrame(controller, [[44, OBJECT_SOUND_ACTION_SHOWER_WATER]]);
    expect(controller.activeFootstepTrackCount()).toBe(1);
    expect(controller.activeActivityTrackCount()).toBe(1);
    expect(controller.activeObjectSoundTrackCount()).toBe(1);

    expect(await controller.unlockFromGesture()).toBe(true);
    expect(controller.activeFootstepTrackCount()).toBe(0);
    expect(controller.activeActivityTrackCount()).toBe(0);
    expect(controller.activeObjectSoundTrackCount()).toBe(0);

    footstepFrame(controller, 17, 0.8);
    activityFrame(controller, [[17, 'eating']]);
    objectSoundFrame(controller, [[44, OBJECT_SOUND_ACTION_SHOWER_WATER]]);
    expect(controller.cuePlayCounts().footstep).toBe(0);
    expect(controller.cuePlayCounts().eating).toBe(2);
    expect(controller.activeObjectSoundTrackCount()).toBe(1);
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
