import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import type {
  GameAudioEvent,
  GameAudioEventSink,
} from '../src/audio/audio-controller.js';
import {
  FOOTSTEP_DISTANCE_TILES,
  FootstepScheduler,
  MAX_FOOTSTEPS_PER_UPDATE,
} from '../src/audio/footsteps.js';

function recordingSink(): GameAudioEventSink & {
  readonly events: GameAudioEvent[];
} {
  const events: GameAudioEvent[] = [];
  return { events, emit: (event) => events.push(event) };
}

function frame(
  scheduler: FootstepScheduler,
  observations: ReadonlyArray<
    readonly [simId: number, x: number, y: number, walking: boolean]
  >,
): void {
  scheduler.beginFrame();
  for (const [simId, x, y, walking] of observations) {
    scheduler.observe(simId, x, y, walking);
  }
  scheduler.endFrame();
}

describe('FootstepScheduler', () => {
  it('uses travelled distance rather than stationary render updates', () => {
    const sink = recordingSink();
    const scheduler = new FootstepScheduler(sink);

    frame(scheduler, [[7, 2, 3, true]]);
    for (let index = 0; index < 20; index += 1) {
      frame(scheduler, [[7, 2, 3, true]]);
    }
    expect(sink.events).toEqual([]);

    frame(scheduler, [[7, 2 + FOOTSTEP_DISTANCE_TILES, 3, true]]);
    expect(sink.events).toEqual([
      { type: 'sim.footstep', simId: 7, stepIndex: 0 },
    ]);
  });

  it('preserves the same stride result when travel is split across frames', () => {
    const directSink = recordingSink();
    const direct = new FootstepScheduler(directSink);
    frame(direct, [[3, 0, 0, true]]);
    frame(direct, [[3, FOOTSTEP_DISTANCE_TILES * 1.5, 0, true]]);

    const splitSink = recordingSink();
    const split = new FootstepScheduler(splitSink);
    frame(split, [[3, 0, 0, true]]);
    frame(split, [[3, FOOTSTEP_DISTANCE_TILES * 0.5, 0, true]]);
    frame(split, [[3, FOOTSTEP_DISTANCE_TILES, 0, true]]);
    frame(split, [[3, FOOTSTEP_DISTANCE_TILES * 1.5, 0, true]]);

    expect(splitSink.events).toEqual(directSink.events);
    expect(splitSink.events).toEqual([
      { type: 'sim.footstep', simId: 3, stepIndex: 0 },
    ]);
  });

  it('re-anchors when walking starts after a socket-projected action', () => {
    const sink = recordingSink();
    const scheduler = new FootstepScheduler(sink);

    frame(scheduler, [[12, 9, 9, false]]);
    frame(scheduler, [[12, 1, 1, true]]);
    expect(sink.events).toEqual([]);

    frame(scheduler, [[12, 1 + FOOTSTEP_DISTANCE_TILES, 1, true]]);
    expect(sink.events).toEqual([
      { type: 'sim.footstep', simId: 12, stepIndex: 0 },
    ]);
  });

  it('keys stride phase by stable Sim identity when row order changes', () => {
    const sink = recordingSink();
    const scheduler = new FootstepScheduler(sink);

    frame(scheduler, [
      [11, 0, 0, true],
      [22, 10, 0, true],
    ]);
    frame(scheduler, [
      [22, 10 + FOOTSTEP_DISTANCE_TILES, 0, true],
      [11, FOOTSTEP_DISTANCE_TILES, 0, true],
    ]);

    expect(sink.events).toEqual([
      { type: 'sim.footstep', simId: 22, stepIndex: 0 },
      { type: 'sim.footstep', simId: 11, stepIndex: 0 },
    ]);
  });

  it('forgets an unseen Sim and treats its return as a new anchor', () => {
    const sink = recordingSink();
    const scheduler = new FootstepScheduler(sink);

    frame(scheduler, [
      [1, 0, 0, true],
      [2, 10, 0, true],
    ]);
    frame(scheduler, [[1, FOOTSTEP_DISTANCE_TILES / 2, 0, true]]);
    frame(scheduler, [
      [1, FOOTSTEP_DISTANCE_TILES, 0, true],
      [2, 100, 0, true],
    ]);

    expect(sink.events).toEqual([
      { type: 'sim.footstep', simId: 1, stepIndex: 0 },
    ]);
  });

  it('retains one Map instead of rebuilding footstep storage each frame', () => {
    const source = readFileSync(
      fileURLToPath(new URL('../src/audio/footsteps.ts', import.meta.url)),
      'utf8',
    );

    expect(source.match(/new Map<number, number>/g)).toHaveLength(1);
    expect(source).not.toMatch(/interface FootstepTrack/);
  });

  it('drops burst overflow rather than queuing delayed footsteps', () => {
    const sink = recordingSink();
    const scheduler = new FootstepScheduler(sink);
    frame(scheduler, [[5, 0, 0, true]]);

    frame(scheduler, [[5, FOOTSTEP_DISTANCE_TILES * 20, 0, true]]);
    expect(sink.events).toHaveLength(MAX_FOOTSTEPS_PER_UPDATE);

    frame(scheduler, [[5, FOOTSTEP_DISTANCE_TILES * 20, 0, true]]);
    expect(sink.events).toHaveLength(MAX_FOOTSTEPS_PER_UPDATE);
  });

  it.each(['load', 'background'] as const)(
    'anchors after a %s reset without replaying old distance',
    (boundary) => {
      const sink = recordingSink();
      const scheduler = new FootstepScheduler(sink);
      frame(scheduler, [[9, 0, 0, true]]);
      frame(scheduler, [[9, FOOTSTEP_DISTANCE_TILES * 0.75, 0, true]]);

      scheduler.reset();
      frame(scheduler, [[9, FOOTSTEP_DISTANCE_TILES, 0, true]]);
      expect(sink.events, boundary).toEqual([]);

      frame(scheduler, [[9, FOOTSTEP_DISTANCE_TILES * 2, 0, true]]);
      expect(sink.events, boundary).toEqual([
        { type: 'sim.footstep', simId: 9, stepIndex: 0 },
      ]);
    },
  );

  it('rejects unbalanced or duplicate frame observations', () => {
    const scheduler = new FootstepScheduler(recordingSink());
    expect(() => scheduler.observe(1, 0, 0, true)).toThrow(
      'footstep frame is not open',
    );
    expect(() => scheduler.endFrame()).toThrow('footstep frame is not open');

    scheduler.beginFrame();
    expect(() => scheduler.beginFrame()).toThrow('footstep frame is already open');
    scheduler.observe(1, 0, 0, true);
    expect(() => scheduler.observe(1, 1, 0, true)).toThrow(
      'duplicate footstep sample for Sim 1',
    );
  });
});
