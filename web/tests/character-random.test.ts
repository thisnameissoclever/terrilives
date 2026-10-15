import { expect, it, vi } from 'vitest';
import { DraftRandom } from '../src/character/random.js';

it('advances only its own seeded state and reproduces a saved continuation', () => {
  const globalRandom = vi.spyOn(Math, 'random').mockImplementation(() => { throw new Error('Global randomness was consumed'); });
  try {
    const draft = new DraftRandom(21), other = new DraftRandom(21);
    const initial = draft.state, first = draft.index(1000000);
    expect(draft.state).not.toBe(initial);
    expect(other.state).toBe(initial);
    expect(other.index(1000000)).toBe(first);
    const saved = draft.state, next = draft.index(1000000);
    expect(new DraftRandom(saved).index(1000000)).toBe(next);
    expect(draft.state).not.toBe(saved);
    expect(globalRandom).not.toHaveBeenCalled();
  } finally { globalRandom.mockRestore(); }
});
