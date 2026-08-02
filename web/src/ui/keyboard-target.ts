import {
  menuEntries,
  socialMenuEntries,
  type MenuEntry,
} from './object-menu.js';

const KIND_AGENT = 0;

export interface KeyboardTargetSource {
  readonly count: number;
  ids(): Uint32Array;
  kinds(): Uint32Array;
  simName(entityIndex: number): string;
  objectName(entityIndex: number): string;
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
  | { readonly kind: 'menu'; readonly entries: readonly MenuEntry[] }
  | { readonly kind: 'unavailable'; readonly message: string };

export interface KeyboardTargetStatus {
  hidden: boolean;
  textContent: string | null;
}

/** Rebuilds the list from the live render rows so restored worlds stay current. */
export function keyboardTargets(source: KeyboardTargetSource): KeyboardTarget[] {
  const ids = source.ids();
  const kinds = source.kinds();
  const targets: KeyboardTarget[] = [];
  for (let row = 0; row < source.count; row++) {
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
    this.status.textContent = `Target: ${target.label}. Space selects a person; Enter opens actions.`;
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
        entries: socialMenuEntries(this.source.socialLabels(), target.entity),
      };
    }
    if (this.source.selectedIndex() === null) {
      return { kind: 'unavailable', message: 'Select a person before choosing an object' };
    }
    return {
      kind: 'menu',
      entries: menuEntries(this.source.interactionLabels(target.entity), target.entity),
    };
  }

  clear(): void {
    this.entity = null;
    this.status.hidden = true;
    this.status.textContent = '';
  }
}
