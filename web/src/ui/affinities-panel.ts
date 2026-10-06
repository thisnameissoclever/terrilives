import type { AffinityWord } from '../bridge.js';
import { setTextIfChanged } from './set-text-if-changed.js';

// The selected person's likes and dislikes in plain words - [OA-hud] in
// docs/specs/2026-10-06-object-affinities.md.
//
// A collapsed disclosure in the Overview sheet, after Skills. Every affinity
// kind gets one row: its label with the first letter upper-cased, then the
// word the simulation gives the person's value. The edges between the words
// live in content/tuning.toml and are applied in Rust, so this view keeps no
// thresholds of its own. Like Skills, a closed section does no periodic
// reads; the forced updates at start, after Load and after an edit still read.

export interface AffinitiesPanelSource {
  selectedIndex(): number | null;
  affinityWordsOf(entity: number): AffinityWord[] | null;
}

export interface AffinityRow {
  readonly label: string;
  readonly word: AffinityWord;
}

export type AffinitiesPanelState =
  | { kind: 'unselected' }
  | { kind: 'unavailable' }
  | { kind: 'ready'; rows: readonly AffinityRow[] };

export interface AffinitiesPanelSurface {
  render(state: AffinitiesPanelState): void;
}

const UNAVAILABLE: AffinitiesPanelState = { kind: 'unavailable' };

/** "plants" becomes "Plants": kind labels are lower case so they read inside the moodlet sentences. */
function rowLabel(label: string): string {
  return label.charAt(0).toUpperCase() + label.slice(1);
}

export function affinitiesPanelState(source: AffinitiesPanelSource, labels: readonly string[]): AffinitiesPanelState {
  const selected = source.selectedIndex();
  if (selected === null) return { kind: 'unselected' };
  const words = source.affinityWordsOf(selected);
  if (words === null || words.length === 0 || words.length !== labels.length) return UNAVAILABLE;
  return { kind: 'ready', rows: words.map((word, index) => ({ label: rowLabel(labels[index]), word })) };
}

/** A closed disclosure does no periodic reads; opening or loading forces a fresh one. */
export class AffinitiesPanel {
  private lastRenderMs: number | null = null;

  constructor(
    private readonly source: AffinitiesPanelSource,
    private readonly labels: readonly string[],
    private readonly surface: AffinitiesPanelSurface,
    private readonly refreshMs: number,
    private readonly active: () => boolean,
  ) {
    if (!Number.isFinite(refreshMs) || refreshMs <= 0) {
      throw new Error('Likes and dislikes panel refresh interval must be a positive finite number');
    }
  }

  update(nowMs: number, force = false): boolean {
    if (!force && (!this.active() || (this.lastRenderMs !== null && nowMs - this.lastRenderMs < this.refreshMs))) {
      return false;
    }
    this.surface.render(affinitiesPanelState(this.source, this.labels));
    this.lastRenderMs = nowMs;
    return true;
  }
}

/**
 * `block` stays visible in every state, because its empty line tells the
 * player what to do. It carries the rendered state in `data-state`, so a
 * displayed check can wait for the rows rather than for a string.
 */
export function createAffinitiesPanelSurface(
  doc: Document,
  block: HTMLElement,
  empty: HTMLElement,
  list: HTMLElement,
): AffinitiesPanelSurface {
  // Rows are keyed by position: the pack's kind order is the same for every
  // person, so a row keeps its kind across a change of selection.
  const rows: HTMLElement[] = [];

  return {
    render(state: AffinitiesPanelState): void {
      const shown = state.kind === 'ready' ? state.rows : [];
      while (rows.length > shown.length) rows.pop()!.remove();
      for (const [index, row] of shown.entries()) {
        let item = rows[index];
        if (item === undefined) {
          item = doc.createElement('li');
          item.className = 'affinity-row';
          rows.push(item);
          list.append(item);
        }
        setTextIfChanged(item, `${row.label}: ${row.word}`);
      }
      block.dataset.state = state.kind;
      list.hidden = shown.length === 0;
      empty.hidden = shown.length > 0;
      setTextIfChanged(empty, state.kind === 'unavailable'
        ? 'Likes and dislikes unavailable'
        : 'Select a person to see their likes and dislikes.');
    },
  };
}
