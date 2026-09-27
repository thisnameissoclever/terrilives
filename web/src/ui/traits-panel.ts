// The selected person's traits in plain words - [TL-panel] in
// docs/specs/2026-09-21-trait-library-and-traits-panel.md.
//
// The developer overlay has printed traits since [E3]; this is the same read
// for a player. A trait is a label, one sentence saying what it does, and for
// a capability or a condition a whole percentage that moves as the person
// practises or manages it. A disposition carries no state and shows no number.

export interface TraitsPanelSource {
  selectedIndex(): number | null;
  /** Interleaved [pack trait index, state, ...] pairs, or empty. */
  traitsOf(entity: number): Float32Array;
}

/** Three columns of one table, read once at startup and aligned by index. */
export interface TraitLibrary {
  readonly labels: readonly string[];
  readonly kinds: readonly string[];
  readonly descriptions: readonly string[];
}

export interface TraitView {
  /** The pack trait index: stable for a person, so a row survives a refresh. */
  readonly key: number;
  readonly label: string;
  readonly description: string;
  /** "Skill 42%", "Severity 60%", or empty for a disposition. */
  readonly state: string;
}

export type TraitsPanelState =
  | { readonly kind: 'unselected' }
  | { readonly kind: 'unavailable' }
  | { readonly kind: 'ready'; readonly traits: readonly TraitView[] };

export interface TraitsPanelSurface {
  render(state: TraitsPanelState): void;
}

const UNAVAILABLE: TraitsPanelState = { kind: 'unavailable' };

function percent(state: number): number {
  return Math.round(Math.min(1, Math.max(0, state)) * 100);
}

/**
 * How a trait's state is worded. The empty string is a real answer: a
 * disposition has no state, and the surface hides the slot when it is empty.
 * `null` means the row cannot be worded at all, and makes the whole panel
 * unavailable.
 *
 * `kind` is `undefined` whenever the index did not name a library row: past
 * the end, negative, or fractional. One check covers all of them, and an
 * unknown kind, because every one of them means the same thing to a player.
 */
function stateText(kind: string | undefined, state: number): string | null {
  switch (kind) {
    case 'disposition':
      return '';
    case 'capability':
      return `Skill ${percent(state)}%`;
    case 'condition':
      return `Severity ${percent(state)}%`;
    default:
      return null;
  }
}

export function traitsPanelState(
  source: TraitsPanelSource,
  library: TraitLibrary,
): TraitsPanelState {
  const selected = source.selectedIndex();
  if (selected === null) {
    return { kind: 'unselected' };
  }
  if (
    library.kinds.length !== library.labels.length ||
    library.descriptions.length !== library.labels.length
  ) {
    return UNAVAILABLE;
  }

  // `traitsOf` hands back its own copy, not a view into WebAssembly memory
  // (see bridge.ts), so it is read in place and cannot be detached.
  const worn = source.traitsOf(selected);

  const traits: TraitView[] = [];
  for (let at = 0; at < worn.length; at += 2) {
    const index = worn[at];
    // `undefined` past the end of an odd-length read, which is not finite.
    const state = worn[at + 1];
    if (!Number.isFinite(state)) {
      return UNAVAILABLE;
    }
    const text = stateText(library.kinds[index], state);
    if (text === null) {
      return UNAVAILABLE;
    }
    traits.push({
      key: index,
      label: library.labels[index],
      description: library.descriptions[index],
      state: text,
    });
  }
  return { kind: 'ready', traits };
}

export class TraitsPanel {
  private lastRenderMs: number | null = null;

  constructor(
    private readonly source: TraitsPanelSource,
    private readonly library: TraitLibrary,
    private readonly surface: TraitsPanelSurface,
    private readonly refreshMs: number,
  ) {
    if (!Number.isFinite(refreshMs) || refreshMs <= 0) {
      throw new Error('Traits panel refresh interval must be a positive finite number');
    }
  }

  update(nowMs: number, force = false): boolean {
    if (
      !force &&
      this.lastRenderMs !== null &&
      nowMs - this.lastRenderMs < this.refreshMs
    ) {
      return false;
    }
    this.surface.render(traitsPanelState(this.source, this.library));
    this.lastRenderMs = nowMs;
    return true;
  }
}

interface TraitRow {
  readonly root: HTMLElement;
  readonly label: HTMLElement;
  readonly state: HTMLElement;
  readonly description: HTMLElement;
}

function createTraitRow(doc: Document): TraitRow {
  const root = doc.createElement('li');
  root.className = 'trait-row';

  const heading = doc.createElement('div');
  heading.className = 'trait-heading';
  const label = doc.createElement('span');
  label.className = 'trait-label';
  const state = doc.createElement('span');
  state.className = 'trait-state';
  heading.append(label, state);

  const description = doc.createElement('p');
  description.className = 'trait-description';

  root.append(heading, description);
  return { root, label, state, description };
}

/**
 * `root` is hidden while nobody is selected. The panel it sits in already
 * says to select a person, and a second line saying so is noise.
 */
export function createTraitsPanelSurface(
  doc: Document,
  root: HTMLElement,
  empty: HTMLElement,
  list: HTMLElement,
): TraitsPanelSurface {
  const rowByKey = new Map<number, TraitRow>();

  return {
    render(state: TraitsPanelState): void {
      const traits = state.kind === 'ready' ? state.traits : [];

      const liveKeys = new Set(traits.map((trait) => trait.key));
      for (const [key, row] of rowByKey) {
        if (!liveKeys.has(key)) {
          row.root.remove();
          rowByKey.delete(key);
        }
      }

      for (let index = 0; index < traits.length; index += 1) {
        const trait = traits[index];
        let row = rowByKey.get(trait.key);
        if (row === undefined) {
          row = createTraitRow(doc);
          rowByKey.set(trait.key, row);
        }
        row.label.textContent = trait.label;
        row.state.textContent = trait.state;
        row.state.hidden = trait.state === '';
        row.description.textContent = trait.description;

        const current = list.children.item(index);
        if (current !== row.root) {
          list.insertBefore(row.root, current);
        }
      }

      const hasRows = traits.length > 0;
      root.hidden = state.kind === 'unselected';
      list.hidden = !hasRows;
      empty.hidden = hasRows;
      empty.textContent = state.kind === 'unavailable' ? 'Traits unavailable' : 'No traits.';
    },
  };
}
