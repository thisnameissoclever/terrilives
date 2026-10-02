import { beforeAll, expect, test } from 'vitest';
import { readFileSync } from 'node:fs';
import init, { SimHandle } from '../src/wasm/terri_wasm.js';
import { SimBridge } from '../src/bridge.js';
import { samplePortalAudioAfterTick } from '../src/audio/frame-audio.js';
import { PortalAudioScheduler } from '../src/audio/portal-audio.js';
import type { GameAudioEvent } from '../src/audio/audio-controller.js';

let memory: WebAssembly.Memory;
beforeAll(async () => {
  memory = (await init({module_or_path: readFileSync('src/wasm/terri_wasm_bg.wasm')})).memory;
});

test('real household crossings emit physical door events after WASM growth without changing saves', () => {
  const handle = SimHandle.from_lot();
  const sim = new SimBridge(handle, memory);
  const events: GameAudioEvent[] = [];
  const scheduler = new PortalAudioScheduler({emit: event => events.push(event)});
  const sink = {
    beginPortalFrame: () => scheduler.beginFrame(),
    observePortal: (x: number, y: number, farX: number, farY: number, state: number) => scheduler.observe(x, y, farX, farY, state),
    endPortalFrame: () => scheduler.endFrame(),
  };
  try {
    expect(sim.portalCount).toBe(6);
    const before = sim.saveBytes();
    samplePortalAudioAfterTick(sim, sink);
    expect(sim.saveBytes()).toEqual(before);
    expect(events).toEqual([]);
    const stale = sim.portalStates();
    memory.grow(1);
    expect(stale.byteLength).toBe(0);
    for (let tick = 0; tick < 1100; tick++) {
      sim.tick();
      samplePortalAudioAfterTick(sim, sink);
    }
    const front = events.filter(event => 'doorId' in event && event.doorId === '15:2:16:2');
    expect(front.length).toBeGreaterThanOrEqual(4);
    expect(front.slice(0, 4).map(event => event.type)).toEqual([
      'door.opened', 'door.closed', 'door.opened', 'door.closed',
    ]);
    expect(events.some(event => 'doorId' in event && event.doorId === '5:9:6:9')).toBe(true);
    expect(events.some(event => 'doorId' in event && event.doorId === '3:5:3:6')).toBe(true);
    expect(events.some(event => 'doorId' in event && event.doorId === '13:5:13:6')).toBe(true);
    expect(scheduler.activeTrackCount()).toBe(6);
    expect(scheduler.trackCapacity()).toBe(6);
    scheduler.reset();
    const countBeforeLoad = events.length;
    expect(sim.loadBytes(sim.saveBytes())).toBe(true);
    samplePortalAudioAfterTick(sim, sink);
    expect(events.length).toBe(countBeforeLoad);
  } finally { handle.free(); }
});
