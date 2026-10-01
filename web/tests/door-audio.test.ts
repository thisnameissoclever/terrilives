import { describe, expect, it } from 'vitest';
import { PortalAudioScheduler } from '../src/audio/portal-audio.js';
import { samplePortalAudioAfterTick } from '../src/audio/frame-audio.js';

describe('physical portal audio', () => {
  it.each([0, 1, 2, 3])('keeps coordinate %s in physical identity', axis => {
    const events: unknown[] = [];
    const scheduler = new PortalAudioScheduler({ emit: event => events.push(event) });
    const a = [2, 3, 4, 5];
    const b = [...a]; b[axis] += 10;
    const observe = (point: number[], state: number) => scheduler.observe(point[0], point[1], point[2], point[3], state);
    scheduler.beginFrame(); observe(a, 0); observe(b, 2); scheduler.endFrame();
    scheduler.beginFrame(); observe(b, 2); observe(a, 1); scheduler.endFrame();
    expect(events).toEqual([{ type: 'door.opened', doorId: '2:3:4:5' }]);
  });

  it('retains warmed capacity across repeated state changes and clears removed tracks', () => {
    const scheduler = new PortalAudioScheduler({ emit() {} });
    for (let tick = 0; tick < 100; tick++) {
      scheduler.beginFrame();
      for (let i = 0; i < 20; i++) scheduler.observe(i, 1, i, 2, tick % 4);
      scheduler.endFrame();
      expect(scheduler.activeTrackCount()).toBe(20);
      expect(scheduler.trackCapacity()).toBe(20);
    }
    scheduler.beginFrame(); scheduler.endFrame();
    expect(scheduler.activeTrackCount()).toBe(0);
    expect(scheduler.trackCapacity()).toBe(20);
    for (let batch = 1; batch <= 20; batch++) {
      scheduler.beginFrame();
      for (let i = 0; i < 20; i++) scheduler.observe(batch * 100 + i, 3, i, 4, 0);
      scheduler.endFrame();
      expect(scheduler.activeTrackCount()).toBe(20);
      expect(scheduler.trackCapacity()).toBe(20);
      scheduler.beginFrame(); scheduler.endFrame();
    }
  });

  it('anchors silently, emits only closed boundary crossings and follows full geometry across row reorder', () => {
    const events: unknown[] = [];
    const scheduler = new PortalAudioScheduler({ emit: event => events.push(event) });
    const frame = (rows: number[][]) => {
      scheduler.beginFrame();
      for (const row of rows) scheduler.observe(row[0], row[1], row[2], row[3], row[4]);
      scheduler.endFrame();
    };
    frame([[2, 3, 4, 5, 0], [2, 3, 6, 7, 2]]);
    expect(events).toEqual([]);
    frame([[2, 3, 6, 7, 3], [2, 3, 4, 5, 1]]);
    frame([[2, 3, 4, 5, 2], [2, 3, 6, 7, 0]]);
    frame([[2, 3, 4, 5, 3], [2, 3, 6, 7, 0]]);
    frame([[2, 3, 4, 5, 0], [2, 3, 6, 7, 0]]);
    expect(events).toEqual([
      { type: 'door.opened', doorId: '2:3:4:5' },
      { type: 'door.closed', doorId: '2:3:6:7' },
      { type: 'door.closed', doorId: '2:3:4:5' },
    ]);
    events.length = 0;
    frame([]);
    frame([[2, 3, 4, 5, 2]]);
    scheduler.reset();
    frame([[2, 3, 4, 5, 0]]);
    expect(events).toEqual([]);
  });

  it('collapses duplicates and invalidates conflicting or malformed observations without replay', () => {
    const events: unknown[] = [];
    const scheduler = new PortalAudioScheduler({ emit: event => events.push(event) });
    const frame = (...states: number[]) => {
      scheduler.beginFrame();
      for (const state of states) scheduler.observe(1, 2, 3, 4, state);
      scheduler.endFrame();
    };
    frame(0); frame(1, 1);
    expect(events).toEqual([{ type: 'door.opened', doorId: '1:2:3:4' }]);
    events.length = 0;
    frame(0, 2); frame(0); frame(99); frame(2); frame(NaN); frame(0);
    expect(events).toEqual([]);
    frame(1);
    expect(events).toEqual([{ type: 'door.opened', doorId: '1:2:3:4' }]);
  });

  it('reads fresh portal columns and passes both ends and raw state through the fixed-tick boundary', () => {
    const events: unknown[] = [];
    const scheduler = new PortalAudioScheduler({ emit: event => events.push(event) });
    let state = 0;
    const source = {
      portalCount: 1,
      portalPositions: () => new Float32Array([8, 9]),
      portalFarSides: () => new Float32Array([10, 11]),
      portalStates: () => new Uint32Array([state]),
    };
    const sink = {
      beginPortalFrame: () => scheduler.beginFrame(),
      observePortal: (a: number, b: number, c: number, d: number, s: number) => scheduler.observe(a, b, c, d, s),
      endPortalFrame: () => scheduler.endFrame(),
    };
    samplePortalAudioAfterTick(source, sink);
    state = 1;
    samplePortalAudioAfterTick(source, sink);
    expect(events).toEqual([{ type: 'door.opened', doorId: '8:9:10:11' }]);
  });

  it('closes the portal frame when an observer throws without swallowing the failure', () => {
    const events: unknown[] = [];
    const scheduler = new PortalAudioScheduler({ emit: event => events.push(event) });
    scheduler.beginFrame(); scheduler.observe(8, 9, 10, 11, 0); scheduler.endFrame();
    const source = {
      portalCount: 1,
      portalPositions: () => new Float32Array([8, 9]),
      portalFarSides: () => new Float32Array([10, 11]),
      portalStates: () => new Uint32Array([1]),
    };
    expect(() => samplePortalAudioAfterTick(source, {
      beginPortalFrame: () => scheduler.beginFrame(),
      observePortal: (a, b, c, d, state) => {
        scheduler.observe(a, b, c, d, state);
        throw new Error('observation failed');
      },
      endPortalFrame: () => scheduler.endFrame(),
    })).toThrow('observation failed');
    expect(events).toEqual([{ type: 'door.opened', doorId: '8:9:10:11' }]);
  });
});
