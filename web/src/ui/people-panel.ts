import { relationWord } from '../bridge.js';
import {
  householdMembers,
  type HouseholdMember,
  type HouseholdRosterSource,
} from './household-roster.js';

export interface PeoplePanelSource extends HouseholdRosterSource {
  /** Interleaved [other SimId, feeling] pairs for one live entity. */
  relationshipsOf(entityIndex: number): Float32Array;
  /**
   * Three words per family tie: the lower entity index, the higher, and the
   * relation ([FM-save] in `docs/specs/2026-09-22-family.md`). Optional, so
   * a source written before ties existed still satisfies this.
   */
  familyTies?(): Uint32Array;
}

export type RelationshipTone = 'negative' | 'neutral' | 'positive';

/** What a tie between two entity indices says, from `who`'s side. */
export function tieBetween(
  ties: ArrayLike<number>,
  who: number,
  other: number,
): string | null {
  const [low, high] = who < other ? [who, other] : [other, who];
  for (let at = 0; at + 2 < ties.length; at += 3) {
    if (ties[at] !== low || ties[at + 1] !== high) continue;
    const stored = ties[at + 2];
    // Stored from the lower index's side, so the higher reads the mirror:
    // a parent one way is a child the other ([FM-tie]).
    const seen = who === low ? stored : MIRRORED[stored] ?? stored;
    return relationWord(seen);
  }
  return null;
}

const MIRRORED: Readonly<Record<number, number>> = { 1: 2, 2: 1 };

export interface RelationshipDescription {
  /** Bounded simulation value, kept for the meter's accessible value. */
  readonly feeling: number;
  /** Position on the visual track, from enemy at 0 to close friend at 100. */
  readonly percent: number;
  readonly label: string;
  readonly tone: RelationshipTone;
}

export interface PersonRelationship extends RelationshipDescription {
  readonly simId: number;
  readonly entity: number;
  readonly name: string;
  /**
   * What this person is to the selected one, in a plain word, or null when
   * they are not related ([FM-show] in `docs/specs/2026-09-22-family.md`).
   */
  readonly tie: string | null;
}

export interface PeoplePanelView {
  readonly selectedName: string;
  readonly people: readonly PersonRelationship[];
}

export interface PeoplePanelSurface {
  render(view: PeoplePanelView | null): void;
}

/**
 * Turns the simulation's directional -1..=1 value into player vocabulary.
 *
 * The bands deliberately expose a first completed Chat: the authored gain is
 * 0.15, so one conversation moves a stranger to Warm. The UI does not
 * call this friendship or romance state because the simulation currently owns
 * one ordered feeling, not two relationship axes.
 */
export function describeRelationship(feeling: number): RelationshipDescription {
  const bounded = Number.isFinite(feeling)
    ? Math.max(-1, Math.min(1, feeling))
    : 0;
  const percent = Math.round((bounded + 1) * 500) / 10;

  if (bounded <= -0.6) {
    return { feeling: bounded, percent, label: 'Hostile', tone: 'negative' };
  }
  if (bounded <= -0.2) {
    return { feeling: bounded, percent, label: 'Dislikes', tone: 'negative' };
  }
  if (bounded < -0.05) {
    return { feeling: bounded, percent, label: 'Wary', tone: 'negative' };
  }
  if (bounded <= 0.05) {
    return { feeling: bounded, percent, label: 'Stranger', tone: 'neutral' };
  }
  if (bounded < 0.2) {
    return {
      feeling: bounded,
      percent,
      label: 'Warm',
      tone: 'positive',
    };
  }
  if (bounded < 0.6) {
    return { feeling: bounded, percent, label: 'Friendly', tone: 'positive' };
  }
  return {
    feeling: bounded,
    percent,
    label: 'Close',
    tone: 'positive',
  };
}

/**
 * Builds the selected person's complete live-household relationship view.
 *
 * Relationship storage is sparse. A missing pair therefore becomes Stranger,
 * while entries pointing at absent sims are ignored. Household members and
 * relationships both key on stable SimId, never the reusable ECS entity index.
 */
export function peoplePanelView(source: PeoplePanelSource): PeoplePanelView | null {
  const members = householdMembers(source);
  const selectedEntity = source.selectedIndex();
  const selected = members.find((member) => member.entity === selectedEntity);
  if (selected === undefined) return null;

  // Copy before any future bridge call. The current relationship bridge owns
  // its returned array, but preserving this boundary rule prevents a later
  // zero-copy optimisation from reviving detached-WASM-view bugs here.
  const ties = source.familyTies ? Array.from(source.familyTies()) : [];
  const pairs = Array.from(source.relationshipsOf(selected.entity));
  const feelings = new Map<number, number>();
  for (let index = 0; index + 1 < pairs.length; index += 2) {
    const simId = pairs[index];
    if (!Number.isSafeInteger(simId) || simId < 0) continue;
    feelings.set(simId, pairs[index + 1]);
  }

  return {
    selectedName: selected.name,
    people: members
      .filter((member) => member.simId !== selected.simId)
      .map((member) => relationshipFor(
        member,
        feelings.get(member.simId) ?? 0,
        tieBetween(ties, selected.entity, member.entity),
      )),
  };
}

function relationshipFor(
  member: HouseholdMember,
  feeling: number,
  tie: string | null,
): PersonRelationship {
  return { ...member, ...describeRelationship(feeling), tie };
}

/** Reads and redraws relationship state at the ordinary HUD cadence. */
export class PeoplePanel {
  private lastReadMs: number | null = null;

  constructor(
    private readonly source: PeoplePanelSource,
    private readonly surface: PeoplePanelSurface,
    private readonly refreshMs: number,
  ) {
    if (!Number.isFinite(refreshMs) || refreshMs <= 0) {
      throw new Error('people panel refresh interval must be positive');
    }
  }

  update(nowMs: number, force = false): boolean {
    if (
      !force &&
      this.lastReadMs !== null &&
      nowMs - this.lastReadMs < this.refreshMs
    ) {
      return false;
    }
    this.lastReadMs = nowMs;
    this.surface.render(peoplePanelView(this.source));
    return true;
  }
}

interface RelationshipRow {
  readonly root: HTMLDivElement;
  readonly name: HTMLSpanElement;
  readonly state: HTMLSpanElement;
  readonly meter: HTMLDivElement;
  readonly marker: HTMLSpanElement;
}

/** DOM-only keyed renderer. Periodic updates reuse rows instead of churning. */
export function createPeoplePanelSurface(
  doc: Document,
  caption: HTMLElement,
  empty: HTMLElement,
  list: HTMLElement,
): PeoplePanelSurface {
  const rows = new Map<number, RelationshipRow>();

  return {
    render(view) {
      caption.textContent = view === null ? 'People' : `How ${view.selectedName} feels`;
      empty.hidden = view !== null && view.people.length > 0;
      empty.textContent =
        view === null
          ? 'Select a person to see how they feel about the household.'
          : 'There is nobody else in the household.';
      list.hidden = view === null || view.people.length === 0;

      const people = view?.people ?? [];
      const present = new Set(people.map((person) => person.simId));
      for (const [simId, row] of rows) {
        if (present.has(simId)) continue;
        row.root.remove();
        rows.delete(simId);
      }

      for (const [index, person] of people.entries()) {
        let row = rows.get(person.simId);
        if (row === undefined) {
          row = buildRelationshipRow(doc);
          rows.set(person.simId, row);
        }

        row.root.dataset.tone = person.tone;
        // [FM-show]: the tie beside the name, so the row reads as who they
        // are as well as how they are getting on.
        row.name.textContent = person.tie === null
          ? person.name
          : `${person.name}, their ${person.tie}`;
        row.state.textContent = person.label;
        row.meter.setAttribute(
          'aria-label',
          `${view?.selectedName ?? ''}'s feeling about ${person.name}`,
        );
        row.meter.setAttribute('aria-valuemin', '-1');
        row.meter.setAttribute('aria-valuemax', '1');
        row.meter.setAttribute(
          'aria-valuenow',
          String(Math.round(person.feeling * 1000) / 1000),
        );
        row.meter.setAttribute('aria-valuetext', person.label);
        row.marker.style.left = `${person.percent}%`;

        const current = list.children.item(index);
        if (current !== row.root) list.insertBefore(row.root, current);
      }
    },
  };
}

function buildRelationshipRow(doc: Document): RelationshipRow {
  const root = doc.createElement('div');
  root.className = 'relationship-row';

  const heading = doc.createElement('div');
  heading.className = 'relationship-heading';
  const name = doc.createElement('span');
  name.className = 'relationship-name';
  const state = doc.createElement('span');
  state.className = 'relationship-state';
  heading.appendChild(name);
  heading.appendChild(state);

  const meter = doc.createElement('div');
  meter.className = 'relationship-track';
  meter.setAttribute('role', 'meter');
  const marker = doc.createElement('span');
  marker.className = 'relationship-marker';
  marker.setAttribute('aria-hidden', 'true');
  meter.appendChild(marker);

  root.appendChild(heading);
  root.appendChild(meter);
  return { root, name, state, meter, marker };
}
