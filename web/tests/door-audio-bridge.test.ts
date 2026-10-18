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

    // Give this door a real crossing rather than relying on an autonomous itinerary.
    const existing = new Set(Array.from(sim.ids()).filter((_, row) => sim.kinds()[row] === 0));
    handle.spawn_agent(3, 5, 80);
    const witness = Array.from(sim.ids()).find((id, row) => sim.kinds()[row] === 0 && !existing.has(id))!;
    expect(witness).toBeDefined();
    const object = (model: string): number => Array.from(sim.ids()).find((id, row) => sim.kinds()[row] !== 0 && sim.objectModel(id)?.id === model)!;
    const bed = object('double_bed'), kitchenSink = object('kitchen_sink');
    expect(bed).toBeDefined(); expect(kitchenSink).toBeDefined();
    const door = Array.from(sim.portalStates()).findIndex((_, row) => {
      const near = sim.portalPositions(), far = sim.portalFarSides();
      return near[row * 2] === 3 && near[row * 2 + 1] === 5 && far[row * 2] === 3 && far[row * 2 + 1] === 6;
    });
    expect(door).toBeGreaterThanOrEqual(0);
    const position = (): readonly [number, number] => {
      const row = Array.from(sim.ids()).indexOf(witness), positions = sim.positions();
      return [positions[row * 2], positions[row * 2 + 1]];
    };
    let previousPosition = position(), previousState = sim.portalStates()[door];
    const crossings: string[] = [], physicalEvents: string[] = [];
    const firstEvent = events.length;
    const crossAndClose = (count: number): void => {
      for (let tick = 0; tick < 200; tick++) {
        sim.tick();
        const next = position(), state = sim.portalStates()[door];
        if (next[1] !== previousPosition[1]) {
          const t = (5.5 - previousPosition[1]) / (next[1] - previousPosition[1]);
          if (t > 0 && t <= 1 && Math.abs(previousPosition[0] + t * (next[0] - previousPosition[0]) - 3) <= 0.5) {
            crossings.push(next[1] > previousPosition[1] ? 'bedroom' : 'kitchen');
          }
        }
        if (previousState === 0 && state !== 0) physicalEvents.push('door.opened');
        if (previousState !== 0 && state === 0) physicalEvents.push('door.closed');
        previousPosition = next; previousState = state;
        samplePortalAudioAfterTick(sim, sink);
        if (crossings.length === count && state === 0) return;
      }
      throw new Error(`The commanded door crossing did not finish: ${crossings.join(', ')}`);
    };
    expect(sim.useObjectFirst(witness, bed, 0)).toBe(true);
    crossAndClose(1);
    expect(sim.cancelIntents(witness)).toBe(true);
    sim.flushCommands();
    expect(sim.useObjectFirst(witness, kitchenSink, 0)).toBe(true);
    crossAndClose(2);
    expect(crossings).toEqual(['bedroom', 'kitchen']);
    expect(physicalEvents).toEqual(['door.opened', 'door.closed', 'door.opened', 'door.closed']);
    expect(events.slice(firstEvent).filter(event => 'doorId' in event && event.doorId === '3:5:3:6').map(event => event.type)).toEqual(physicalEvents);
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
