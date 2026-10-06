import { describe, expect, it } from 'vitest';
import { editTargetOf } from '../src/ui/edit-target.js';
import type { HouseholdMember } from '../src/ui/household-roster.js';

function source(overrides: Partial<Parameters<typeof editTargetOf>[0]> = {}) {
  return {
    simIdOf: (entity: number) => (entity === 4 ? 10 : entity === 5 ? 11 : entity === 6 ? 12 : null),
    simName: (entity: number) => (entity === 4 ? 'Ann' : entity === 5 ? 'Bill' : entity === 6 ? 'Cat' : ''),
    personalityIndexOf: (entity: number) => (entity === 4 ? 1 : null),
    traitsOf: (entity: number) => (entity === 4 ? Float32Array.from([3, 0.5, 0, 0]) : Float32Array.from([])),
    // (10, 11): from 10's side, parent. (11, 12): siblings. 10 has no tie to 12.
    familyTies: () => Uint32Array.from([10, 11, 1, 11, 12, 3]),
    ...overrides,
  };
}

const others: HouseholdMember[] = [
  { simId: 11, entity: 5, name: 'Bill' },
  { simId: 12, entity: 6, name: 'Cat' },
];

describe('editTargetOf', () => {
  it('reads the person as they are now, with a tie code for every other living member', () => {
    const target = editTargetOf(source(), 4, others);
    expect(target).toEqual({
      entity: 4, simId: 10, name: 'Ann', personality: 1, traits: [0, 3],
      ties: new Map([[11, 1], [12, 4]]),
    });
  });

  it('reports the mirrored relation when the person is the higher SimId', () => {
    const target = editTargetOf(source(), 5, [{ simId: 10, entity: 4, name: 'Ann' }, { simId: 12, entity: 6, name: 'Cat' }]);
    expect(target?.ties).toEqual(new Map([[10, 2], [12, 3]]));
  });

  it('is null for an entity without a SimId or a name', () => {
    expect(editTargetOf(source(), 9, others)).toBeNull();
    expect(editTargetOf(source({ simName: () => '' }), 4, others)).toBeNull();
  });

  it('uses null personality for an unmatched archetype', () => {
    expect(editTargetOf(source({ personalityIndexOf: () => null }), 4, others)?.personality).toBeNull();
  });
});
