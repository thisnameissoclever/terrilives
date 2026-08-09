import {
  menuEntries,
  socialMenuEntries,
  type Menu,
} from './object-menu.js';

const KIND_AGENT = 0;

export interface KeyboardTargetSource {
  readonly count: number;
  ids(): Uint32Array;
  kinds(): Uint32Array;
  simName(entityIndex: number): string;
  objectName(entityIndex: number): string;
  /** A sim's name or an object's, for the flyout heading. */
  entityName(entityIndex: number): string;
  interactionLabels(entityIndex: number): readonly string[];
  socialLabels(): readonly string[];
  selectedIndex(): number | null;
}

export interface KeyboardTarget {
  readonly entity: number;
  readonly kind: 'person' | 'object';
  readonly label: string;
}

export type KeyboardActivation =
  | { readonly kind: 'select'; readonly entity: number; readonly label: string }
  | { readonly kind: 'menu'; readonly menu: Menu }
  | { readonly kind: 'unavailable'; readonly message: string };

export interface KeyboardTargetStatus {
  hidden: boolean;
  textContent: string | null;
}

/** Announces both halves of a keyboard Select attempt through its live region. */
export function reportKeyboardSelection(
  status: KeyboardTargetStatus,
  label: string,
  accepted: boolean,
): void {
  status.hidden = false;
  status.textContent = accepted
    ? `Selected ${label}`
    : 'That person could not be selected';
}

/** Rebuilds the list from the live render rows so restored worlds stay current. */
export function keyboardTargets(source: KeyboardTargetSource): KeyboardTarget[] {
  const count = source.count;
  // These start as zero-copy views into WASM memory. Copy each one before any
  // label lookup crosses the boundary: a string allocation may grow memory and
  // detach every view over the old ArrayBuffer midway through this loop.
  const ids = Array.from(source.ids().subarray(0, count));
  const kinds = Array.from(source.kinds().subarray(0, count));
  const targets: KeyboardTarget[] = [];
  const rowCount = Math.min(count, ids.length, kinds.length);
  for (let row = 0; row < rowCount; row++) {
    const entity = ids[row];
    if (kinds[row] === KIND_AGENT) {
      const name = source.simName(entity);
      if (name) targets.push({ entity, kind: 'person', label: name });
      continue;
    }
    const label = source.objectName(entity);
    if (label && source.interactionLabels(entity).length > 0) {
      targets.push({ entity, kind: 'object', label });
    }
  }
  return targets;
}

/** Keyboard-only presentation state for choosing a world target. */
export class KeyboardTargetController {
  private entity: number | null = null;

  constructor(
    private readonly source: KeyboardTargetSource,
    private readonly status: KeyboardTargetStatus,
  ) {}

  cycle(direction: -1 | 1): KeyboardTarget | null {
    const targets = keyboardTargets(this.source);
    if (targets.length === 0) return null;
    const current = targets.findIndex((target) => target.entity === this.entity);
    const next = current < 0 ? (direction > 0 ? 0 : targets.length - 1) :
      (current + direction + targets.length) % targets.length;
    const target = targets[next];
    this.entity = target.entity;
    this.status.hidden = false;
    const controls = target.kind === 'person'
      ? 'Space selects this person; Enter selects or opens social actions.'
      : 'Enter opens actions.';
    this.status.textContent = `Target: ${target.label}. ${controls}`;
    return target;
  }

  current(): KeyboardTarget | null {
    return keyboardTargets(this.source).find((target) => target.entity === this.entity) ?? null;
  }

  activate(): KeyboardActivation {
    const target = this.current();
    if (target === null) {
      return { kind: 'unavailable', message: 'Use an arrow key to choose a target first' };
    }
    if (target.kind === 'person') {
      const selected = this.source.selectedIndex();
      if (selected === null || selected === target.entity) {
        return { kind: 'select', entity: target.entity, label: target.label };
      }
      return {
        kind: 'menu',
        menu: socialMenuEntries(
          this.source.entityName(target.entity),
          this.source.socialLabels(),
          target.entity,
        ),
      };
    }
    if (this.source.selectedIndex() === null) {
      return { kind: 'unavailable', message: 'Select a person before choosing an object' };
    }
    return {
      kind: 'menu',
      menu: menuEntries(
        this.source.entityName(target.entity),
        this.source.interactionLabels(target.entity),
        target.entity,
      ),
    };
  }

  clear(): void {
    this.entity = null;
    this.status.hidden = true;
    this.status.textContent = '';
  }
}
