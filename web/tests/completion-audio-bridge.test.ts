import { beforeAll, expect, test } from 'vitest';
import { readFileSync } from 'node:fs';
import init, { SimHandle } from '../src/wasm/terri_wasm.js';
import { SimBridge } from '../src/bridge.js';
import { drainCompletionAudioAfterTick } from '../src/audio/completion-audio.js';
import type { GameAudioEvent } from '../src/audio/audio-controller.js';
import { formatActivity } from '../src/ui/game-hud.js';

let memory: WebAssembly.Memory;
beforeAll(async () => {
  memory = (await init({ module_or_path: readFileSync('src/wasm/terri_wasm_bg.wasm') })).memory;
});

function fixture() {
  const handle = new SimHandle(24, 24);
  const sim = new SimBridge(handle, memory);
  expect(sim.spawnObject(4, 4, 'toilet')).toBe(true);
  sim.spawnAgent(3, 4, 100);
  const ids = Array.from(sim.ids());
  return { handle, sim, object: ids[0], actor: ids[1] };
}

test('release WASM completion exports consume real orders once after memory growth and preserve state', () => {
  const { handle, sim, object, actor } = fixture();
  const events: GameAudioEvent[] = [];
  const sink = { emit: (event: GameAudioEvent) => events.push(event) };
  try {
    expect(sim.useObject(actor, object, 0)).toBe(true);
    sim.flushCommands();
    expect(sim.completionSoundCount).toBe(0);
    const stale = sim.completionSounds();
    memory.grow(1);
    expect(stale.buffer.byteLength).toBe(0);
    let ticks = 0;
    for (; ticks < 100 && events.length === 0; ticks++) {
      sim.tick();
      const save = sim.saveBytes();
      const hash = sim.worldHash();
      drainCompletionAudioAfterTick(sim, sink, true);
      expect(sim.saveBytes()).toEqual(save);
      expect(sim.worldHash()).toBe(hash);
      expect(sim.completionSoundCount).toBe(0);
      drainCompletionAudioAfterTick(sim, sink, true);
    }
    expect(ticks).toBeGreaterThan(1);
    expect(events).toEqual([{ type: 'object.completed', sourceId: object, action: 1 }]);
    expect(sim.actionQueueOf(actor).some(row => row.startsWith('Use the toilet:'))).toBe(false);
    expect(sim.useObject(actor, object, 0)).toBe(true);
    for (let tick = 0; tick < 100 && events.length < 2; tick++) {
      sim.tick(); drainCompletionAudioAfterTick(sim, sink, true);
    }
    expect(events).toHaveLength(2);
  } finally { handle.free(); }
});

test('paused cancellation and load cannot invent completion, while a loaded live use may finish', () => {
  const { handle, sim, object, actor } = fixture();
  const events: GameAudioEvent[] = [];
  const sink = { emit: (event: GameAudioEvent) => events.push(event) };
  try {
    sim.useObject(actor, object, 0);
    for (let tick = 0; tick < 4; tick++) { sim.tick(); drainCompletionAudioAfterTick(sim, sink, true); }
    expect(formatActivity(sim.activityOf(actor), null, null)).toBe('Using the toilet');
    expect(events).toEqual([]);
    const midUse = sim.saveBytes();
    expect(sim.cancelIntents(actor)).toBe(true);
    sim.flushCommands();
    expect(sim.completionSoundCount).toBe(0);
    expect(formatActivity(sim.activityOf(actor), null, null)).not.toBe('Using the toilet');
    expect(sim.loadBytes(midUse)).toBe(true);
    expect(sim.completionSoundCount).toBe(0);
    for (let tick = 0; tick < 100 && events.length === 0; tick++) {
      sim.tick(); drainCompletionAudioAfterTick(sim, sink, true);
    }
    expect(events).toHaveLength(1);
    const completed = sim.saveBytes();
    expect(sim.loadBytes(completed)).toBe(true);
    expect(sim.completionSoundCount).toBe(0);
    sim.tick(); drainCompletionAudioAfterTick(sim, sink, true);
    expect(events).toHaveLength(1);
  } finally { handle.free(); }
});

test('loading replaces a world with an undrained completion without replay', () => {
  const { handle, sim, object, actor } = fixture();
  const events: GameAudioEvent[] = [];
  try {
    expect(sim.useObject(actor, object, 0)).toBe(true);
    for (let tick = 0; tick < 100 && sim.completionSoundCount === 0; tick++) sim.tick();
    expect(sim.completionSoundCount).toBe(1);
    const save = sim.saveBytes();
    const hash = sim.worldHash();
    expect(sim.loadBytes(save)).toBe(true);
    expect(sim.completionSoundCount).toBe(0);
    expect(sim.worldHash()).toBe(hash);
    expect(sim.saveBytes()).toEqual(save);
    drainCompletionAudioAfterTick(sim, { emit: event => events.push(event) }, true);
    expect(events).toEqual([]);
  } finally { handle.free(); }
});

test('every fixed tick drains even when one rendered frame advances multiple ticks or disables audio sampling', () => {
  const { handle, sim, object, actor } = fixture();
  const events: GameAudioEvent[] = [];
  const sink = { emit: (event: GameAudioEvent) => events.push(event) };
  try {
    sim.useObject(actor, object, 0);
    let completionTicks = 0;
    for (let frame = 0; frame < 30 && completionTicks === 0; frame++) {
      for (let tick = 0; tick < 3; tick++) {
        sim.tick();
        completionTicks += sim.completionSoundCount;
        drainCompletionAudioAfterTick(sim, sink, false);
        expect(sim.completionSoundCount).toBe(0);
      }
    }
    expect(completionTicks).toBe(1);
    expect(events).toEqual([]);
    sim.tick(); drainCompletionAudioAfterTick(sim, sink, true);
    expect(events).toEqual([]);
  } finally { handle.free(); }
});
