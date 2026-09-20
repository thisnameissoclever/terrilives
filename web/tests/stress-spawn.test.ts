import { describe, expect, it, vi } from 'vitest';

import { spawnStressAgents } from '../src/debug/stress-spawn.js';

function target(accepts: (x: number, y: number) => boolean) {
  let count = 37;
  return {
    get count() { return count; },
    spawnAgent: vi.fn((x: number, y: number, _hunger: number) => {
      if (accepts(x, y)) count++;
    }),
  };
}

describe('spawnStressAgents', () => {
  it('spreads over accepted cells and reuses them to reach the actual requested count', () => {
    const sim = target((x, y) => (x === 1 && y === 0) || (x === 3 && y === 1));
    expect(spawnStressAgents(sim, 4, 2, 7)).toBe(7);
    expect(sim.count).toBe(44);
    expect(sim.spawnAgent.mock.calls).toEqual([
      [0, 0, 100], [1, 0, 100], [2, 0, 100], [3, 0, 100],
      [0, 1, 100], [1, 1, 100], [2, 1, 100], [3, 1, 100],
      [1, 0, 100], [3, 1, 100], [1, 0, 100], [3, 1, 100], [1, 0, 100],
    ]);
  });

  it('reports a full rejected scan instead of claiming a stress population was created', () => {
    const sim = target(() => false);
    expect(() => spawnStressAgents(sim, 4, 2, 7)).toThrow(/no grid cell accepted/i);
    expect(sim.count).toBe(37);
    expect(sim.spawnAgent).toHaveBeenCalledTimes(8);
  });

  it('rejects a negative requested population before spawning', () => {
    const sim = target(() => true);
    expect(() => spawnStressAgents(sim, 4, 2, -1)).toThrow(/integer.*0.*10000/i);
    expect(sim.spawnAgent).not.toHaveBeenCalled();
  });

  it.each([NaN, Infinity, -Infinity, 1.5, 10_001])('rejects invalid count %s before spawning', (requested) => {
    const sim = target(() => true);
    expect(() => spawnStressAgents(sim, 4, 2, requested)).toThrow(/integer.*0.*10000/i);
    expect(sim.spawnAgent).not.toHaveBeenCalled();
  });

  it('permits zero requested agents without requiring a usable grid', () => {
    const sim = target(() => false);
    expect(spawnStressAgents(sim, 0, 0, 0)).toBe(0);
    expect(sim.spawnAgent).not.toHaveBeenCalled();
  });

  it('stops as soon as a small request is satisfied', () => {
    const sim = target(() => true);
    expect(spawnStressAgents(sim, 4, 2, 2)).toBe(2);
    expect(sim.spawnAgent.mock.calls).toEqual([[0, 0, 100], [1, 0, 100]]);
  });

  it('fills the maximum population with one grid scan and bounded reuse', () => {
    const sim = target((x, y) => x === 3 && y === 1);
    expect(spawnStressAgents(sim, 4, 2, 10_000)).toBe(10_000);
    expect(sim.count).toBe(10_037);
    expect(sim.spawnAgent).toHaveBeenCalledTimes(10_007);
  });

  it('rejects an unusable grid before spawning', () => {
    const sim = target(() => true);
    expect(() => spawnStressAgents(sim, 0, 2, 1)).toThrow(/grid dimensions/i);
    expect(sim.spawnAgent).not.toHaveBeenCalled();
  });

  it('refuses unexpected count changes instead of returning more than requested', () => {
    let count = 37;
    const sim = {
      get count() { return count; },
      spawnAgent: vi.fn(() => { count += 2; }),
    };
    expect(() => spawnStressAgents(sim, 1, 1, 1)).toThrow(/count changed unexpectedly/i);
    expect(sim.spawnAgent).toHaveBeenCalledTimes(1);
  });

  it('fails promptly if a previously accepted cell stops accepting spawns', () => {
    let attempts = 0;
    const sim = target(() => ++attempts === 1);
    expect(() => spawnStressAgents(sim, 1, 1, 3)).toThrow(/previously accepted.*rejected/i);
    expect(sim.count).toBe(38);
    expect(sim.spawnAgent).toHaveBeenCalledTimes(2);
  });

  it.each([
    [NaN, 1], [Infinity, 1], [-1, 1], [1.5, 1], [1, 0], [1, NaN],
    [1, Infinity], [1, -1], [1, 1.5], [1024, 1025],
  ])('rejects unsupported grid dimensions %s by %s before spawning', (width, height) => {
    const sim = target(() => true);
    expect(() => spawnStressAgents(sim, width, height, 1)).toThrow(/grid dimensions/i);
    expect(sim.spawnAgent).not.toHaveBeenCalled();
  });
});
