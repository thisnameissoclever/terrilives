/**
 * Who a living person is right now, read for the Edit housemate form
 * ([ES-form] in `docs/specs/2026-09-30-edit-sims.md`). The form starts from
 * this and sends one edit the simulation checks whole.
 */
import type { SimBridge } from '../bridge.js';
import { NO_RELATION } from '../bridge.js';
import type { HouseholdMember } from './household-roster.js';

/** Who a living person is right now, as the Edit housemate form shows them ([ES-form]). */
export interface EditTarget {
  readonly entity: number;
  readonly simId: number;
  readonly name: string;
  /** The archetype to mark as current, or null when only "Keep current personality" fits. */
  readonly personality: number | null;
  /** Active pack trait indices, ascending. */
  readonly traits: number[];
  /** Relation code from this person's side, keyed by the other person's SimId; NO_RELATION when none. */
  readonly ties: Map<number, number>;
}

export type EditTargetSource = Pick<SimBridge, 'simIdOf' | 'simName' | 'personalityIndexOf' | 'traitsOf' | 'familyTies'>;

/** Parent and child swap when read from the higher SimId's side ([FM-tie]). */
const MIRRORED: Readonly<Record<number, number>> = { 1: 2, 2: 1 };

/** The relation `who` has to `other`, from the flat `[low, high, code]` tie list. */
function tieFrom(ties: Uint32Array, who: number, other: number): number {
  const low = Math.min(who, other);
  const high = Math.max(who, other);
  for (let at = 0; at + 2 < ties.length; at += 3) {
    if (ties[at] === low && ties[at + 1] === high) {
      const stored = ties[at + 2];
      return who === low ? stored : (MIRRORED[stored] ?? stored);
    }
  }
  return NO_RELATION;
}

/**
 * Reads the person at `entity` with a tie code for each of `others`, or null
 * when the entity is not a living, named person.
 */
export function editTargetOf(
  source: EditTargetSource,
  entity: number,
  others: readonly HouseholdMember[],
): EditTarget | null {
  const simId = source.simIdOf(entity);
  const name = source.simName(entity);
  if (simId === null || name === '') return null;
  const worn = source.traitsOf(entity);
  const traits: number[] = [];
  for (let at = 0; at + 1 < worn.length; at += 2) traits.push(worn[at]);
  traits.sort((a, b) => a - b);
  const family = source.familyTies();
  const ties = new Map<number, number>();
  for (const other of others) {
    if (other.simId === simId) continue;
    ties.set(other.simId, tieFrom(family, simId, other.simId));
  }
  return { entity, simId, name, personality: source.personalityIndexOf(entity), traits, ties };
}
