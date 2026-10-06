import type { SkillStanding } from '../bridge.js';
import { setTextIfChanged } from './set-text-if-changed.js';

// The selected person's skills in plain words - [SK-hud] in
// docs/specs/2026-10-05-skills.md.
//
// A collapsed disclosure in the Overview sheet, beside "Personality, habits
// and bed". Every content skill gets one row: its label, how far up its
// ladder the person stands, and one sentence saying what it covers. Like the
// personal details, it reads nothing while it is closed.

export interface SkillsPanelSource {
  selectedIndex(): number | null;
  skillsOf(entity: number): SkillStanding[] | null;
}

/** Three columns of one table, read once at startup and aligned by index. */
export interface SkillLibrary {
  readonly labels: readonly string[];
  readonly descriptions: readonly string[];
  /** The top level of each skill's ladder. */
  readonly levels: readonly number[];
}

export type SkillsPanelState =
  | { kind: 'unselected' }
  | { kind: 'unavailable' }
  | { kind: 'ready'; skills: readonly { label: string; description: string; standing: string }[] };

export interface SkillsPanelSurface {
  render(state: SkillsPanelState): void;
}

const UNAVAILABLE: SkillsPanelState = { kind: 'unavailable' };

/**
 * "Level 2 of 10, 50% to the next level", or "Level 10 of 10" at the top.
 * Floored and capped at 99, so a person still on the lower level never
 * reads 100%. Progress arrives as an f32, which can sit a step below the
 * value it names (a half is 0.49999997 on a flat ladder); the 1e-4
 * allowance on the percentage absorbs that.
 */
function standingText(standing: SkillStanding, levels: number): string {
  if (standing.level === levels) return `Level ${levels} of ${levels}`;
  const percent = Math.min(99, Math.floor(standing.progress * 100 + 1e-4));
  return `Level ${standing.level} of ${levels}, ${percent}% to the next level`;
}

export function skillsPanelState(source: SkillsPanelSource, library: SkillLibrary): SkillsPanelState {
  const selected = source.selectedIndex();
  if (selected === null) return { kind: 'unselected' };
  if (library.descriptions.length !== library.labels.length || library.levels.length !== library.labels.length) {
    return UNAVAILABLE;
  }
  const standings = source.skillsOf(selected);
  if (standings === null || standings.length === 0 || standings.length !== library.labels.length) return UNAVAILABLE;
  const skills = [];
  for (const [index, standing] of standings.entries()) {
    const levels = library.levels[index];
    if (standing.level > levels) return UNAVAILABLE;
    skills.push({ label: library.labels[index], description: library.descriptions[index],
      standing: standingText(standing, levels) });
  }
  return { kind: 'ready', skills };
}

/** A closed disclosure does no periodic reads; opening or loading forces a fresh one. */
export class SkillsPanel {
  private lastRenderMs: number | null = null;

  constructor(
    private readonly source: SkillsPanelSource,
    private readonly library: SkillLibrary,
    private readonly surface: SkillsPanelSurface,
    private readonly refreshMs: number,
    private readonly active: () => boolean,
  ) {
    if (!Number.isFinite(refreshMs) || refreshMs <= 0) {
      throw new Error('Skills panel refresh interval must be a positive finite number');
    }
  }

  update(nowMs: number, force = false): boolean {
    if (!force && (!this.active() || (this.lastRenderMs !== null && nowMs - this.lastRenderMs < this.refreshMs))) {
      return false;
    }
    this.surface.render(skillsPanelState(this.source, this.library));
    this.lastRenderMs = nowMs;
    return true;
  }
}

interface SkillRow {
  readonly root: HTMLElement;
  readonly label: HTMLElement;
  readonly standing: HTMLElement;
  readonly description: HTMLElement;
}

function createSkillRow(doc: Document): SkillRow {
  const root = doc.createElement('li');
  root.className = 'skill-row';
  const heading = doc.createElement('div');
  heading.className = 'skill-heading';
  const label = doc.createElement('span');
  label.className = 'skill-label';
  const standing = doc.createElement('span');
  standing.className = 'skill-standing';
  heading.append(label, standing);
  const description = doc.createElement('p');
  description.className = 'skill-description';
  root.append(heading, description);
  return { root, label, standing, description };
}

/**
 * `block` stays visible in every state, because its empty line tells the
 * player what to do. It carries the rendered state in `data-state`, so a
 * displayed check can wait for the rows rather than for a string.
 */
export function createSkillsPanelSurface(
  doc: Document,
  block: HTMLElement,
  empty: HTMLElement,
  list: HTMLElement,
): SkillsPanelSurface {
  // Rows are keyed by position: the pack's skill order is the same for
  // every person, so a row keeps its skill across a change of selection.
  const rows: SkillRow[] = [];

  return {
    render(state: SkillsPanelState): void {
      const skills = state.kind === 'ready' ? state.skills : [];
      while (rows.length > skills.length) rows.pop()!.root.remove();
      for (const [index, skill] of skills.entries()) {
        let row = rows[index];
        if (row === undefined) {
          row = createSkillRow(doc);
          rows.push(row);
          list.append(row.root);
        }
        setTextIfChanged(row.label, skill.label);
        setTextIfChanged(row.standing, skill.standing);
        setTextIfChanged(row.description, skill.description);
      }
      block.dataset.state = state.kind;
      list.hidden = skills.length === 0;
      empty.hidden = skills.length > 0;
      setTextIfChanged(empty, state.kind === 'unavailable' ? 'Skills unavailable' : 'Select a person to see their skills.');
    },
  };
}
