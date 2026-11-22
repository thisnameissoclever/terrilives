import { describe, expect, it } from 'vitest';
import type { SkipResult } from '../src/admin/admin-panel.js';
import { SkipRunner, type SkipWorld } from '../src/admin/admin-skip.js';

// Skip ahead's runner ([AP-skip] in docs/specs/2026-11-20-admin-panel.md):
// ordinary ticks, a budget of them a frame, `hours * ticksPerHour` in all,
// stopped only at a frame boundary, by the player or by a death.

class FakeWorld implements SkipWorld {
  ticks = 0;
  perHour = 60;
  perFrame = 300;
  people = new Map<number, string>([[3, 'Tim'], [5, 'Bill']]);
  /** Runs after each tick with the tick count; lets a test change the world mid frame. */
  onTick: (count: number) => void = () => {};
  tick(): void { this.ticks += 1; this.onTick(this.ticks); }
  ticksPerHour(): number { return this.perHour; }
  ticksPerFrame(): number { return this.perFrame; }
  living(): ReadonlyMap<number, string> { return new Map(this.people); }
}

function build(world = new FakeWorld()) {
  const runner = new SkipRunner(world, () => ({ maxHours: 168, defaultHours: 8 }));
  const progress: number[] = [];
  const finished: SkipResult[] = [];
  const handlers = { progress: (hours: number) => progress.push(hours), finish: (result: SkipResult) => finished.push(result) };
  return { world, runner, progress, finished, handlers };
}

describe('the length of a skip', () => {
  it('runs hours times the ticks of an hour, across frames at the knob\'s budget', () => {
    const b = build();
    b.runner.start(8, b.handlers);
    b.runner.step();
    expect(b.world.ticks, 'one frame is the budget').toBe(300);
    expect(b.progress).toEqual([5]);
    expect(b.finished).toEqual([]);
    b.runner.step();
    expect(b.world.ticks, 'hours times sixty in all').toBe(480);
    expect(b.finished).toEqual([{ kind: 'done', hours: 8 }]);
    expect(b.runner.running).toBe(false);
  });

  it('takes the ticks of an hour from the day length, not a constant', () => {
    const world = new FakeWorld();
    world.perHour = 100;
    const b = build(world);
    b.runner.start(3, b.handlers);
    while (b.runner.running) b.runner.step();
    expect(world.ticks).toBe(300);
    expect(b.finished).toEqual([{ kind: 'done', hours: 3 }]);
  });

  it('runs one tick a frame when that is the budget', () => {
    const world = new FakeWorld();
    world.perFrame = 1;
    const b = build(world);
    b.runner.start(1, b.handlers);
    let frames = 0;
    while (b.runner.running) { b.runner.step(); frames += 1; }
    expect(frames).toBe(60);
    expect(world.ticks).toBe(60);
  });

  it('reports whole hours run and never more than were asked', () => {
    const world = new FakeWorld();
    world.perFrame = 90;
    const b = build(world);
    b.runner.start(2, b.handlers);
    while (b.runner.running) b.runner.step();
    expect(b.progress).toEqual([1]);
    expect(b.finished).toEqual([{ kind: 'done', hours: 2 }]);
  });

  it('does nothing before a start and after a finish', () => {
    const b = build();
    b.runner.step();
    expect(b.world.ticks).toBe(0);
    b.runner.start(1, b.handlers);
    b.runner.step();
    const ticks = b.world.ticks;
    b.runner.step();
    expect(b.world.ticks).toBe(ticks);
    expect(b.finished).toHaveLength(1);
  });

  it('ignores a start while one runs, and starts again after it ends', () => {
    const b = build();
    b.runner.start(8, b.handlers);
    b.runner.start(1, b.handlers);
    while (b.runner.running) b.runner.step();
    expect(b.world.ticks).toBe(480);
    b.runner.start(1, b.handlers);
    while (b.runner.running) b.runner.step();
    expect(b.world.ticks).toBe(540);
    expect(b.finished).toHaveLength(2);
  });

  it('passes the knobs through', () => {
    expect(build().runner.limits()).toEqual({ maxHours: 168, defaultHours: 8 });
  });
});

describe('stopping', () => {
  it('stops at the next frame boundary and keeps the hours already run', () => {
    const b = build();
    b.runner.start(8, b.handlers);
    b.runner.step();
    b.runner.stop();
    expect(b.finished, 'a request alone ends nothing').toEqual([]);
    b.runner.step();
    expect(b.world.ticks, 'no tick runs after the request').toBe(300);
    expect(b.finished).toEqual([{ kind: 'stopped', hours: 5 }]);
  });

  it('stops before the first frame with none run', () => {
    const b = build();
    b.runner.start(8, b.handlers);
    b.runner.stop();
    b.runner.step();
    expect(b.world.ticks).toBe(0);
    expect(b.finished).toEqual([{ kind: 'stopped', hours: 0 }]);
  });

  it('is not a stop when the last frame already finished the run', () => {
    const b = build();
    b.runner.start(1, b.handlers);
    b.runner.step();
    b.runner.stop();
    b.runner.step();
    expect(b.finished).toEqual([{ kind: 'done', hours: 1 }]);
  });
});

describe('a death', () => {
  it('stops at the end of the frame it happened in, naming who died', () => {
    const b = build();
    b.world.onTick = count => { if (count === 100) b.world.people.delete(5); };
    b.runner.start(8, b.handlers);
    b.runner.step();
    expect(b.world.ticks, 'the whole frame ran').toBe(300);
    expect(b.finished).toEqual([{ kind: 'died', hours: 5, name: 'Bill' }]);
    b.runner.step();
    expect(b.world.ticks, 'and nothing after').toBe(300);
  });

  it('counts a death in the frame that would have finished the run', () => {
    const b = build();
    b.world.onTick = count => { if (count === 50) b.world.people.delete(3); };
    b.runner.start(1, b.handlers);
    b.runner.step();
    expect(b.finished).toEqual([{ kind: 'died', hours: 1, name: 'Tim' }]);
  });

  it('is not fooled by someone who moves in', () => {
    const b = build();
    b.world.onTick = count => { if (count === 10) b.world.people.set(9, 'Casey'); };
    b.runner.start(1, b.handlers);
    b.runner.step();
    expect(b.finished).toEqual([{ kind: 'done', hours: 1 }]);
  });
});

describe('cancelling', () => {
  it('abandons the run with no finish and no more ticks', () => {
    const b = build();
    b.runner.start(8, b.handlers);
    b.runner.step();
    b.runner.cancel();
    b.runner.step();
    expect(b.world.ticks).toBe(300);
    expect(b.finished).toEqual([]);
    expect(b.runner.running).toBe(false);
  });

  it('abandons the run when a tick throws, and passes the error on', () => {
    const b = build();
    b.world.onTick = count => { if (count === 5) throw new Error('boom'); };
    b.runner.start(8, b.handlers);
    expect(() => b.runner.step()).toThrow('boom');
    expect(b.runner.running).toBe(false);
    expect(b.finished).toEqual([]);
  });
});
