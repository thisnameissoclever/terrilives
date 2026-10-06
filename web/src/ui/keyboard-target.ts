import {
  surfaceMenuEntries,
  dishMenuEntries,
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
  objectDetails?(entityIndex: number): import('./object-identity.js').ObjectDetails | undefined;
  /** A sim's name or an object's, for the flyout heading. */
  entityName(entityIndex: number): string;
  interactionLabels(entityIndex: number): readonly string[];
  socialLabels(): readonly string[];
  selectedIndex(): number | null;
  choreOptions?(entity:number):Uint32Array;
  dishPiles?(): Uint32Array;
}

export interface KeyboardTarget {
  readonly entity: number;
  readonly kind: 'person' | 'object' | 'dishes';
  readonly pileSlot?: number;
  readonly dishes?: readonly number[];
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
  const piles = Array.from(source.dishPiles?.() ?? []);
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
    const slots = new Map<number, number[]>();
    for (let i = 0; i + 2 < piles.length; i += 3) if (piles[i] === entity) {
      const ids = slots.get(piles[i + 1]) ?? [];
      ids.push(piles[i + 2]); slots.set(piles[i + 1], ids);
    }
    if (label && (slots.size > 0 || source.interactionLabels(entity).length > 0 || source.objectDetails?.(entity))) {
      targets.push({ entity, kind: 'object', label });
      for (const [pileSlot, dishes] of slots) targets.push({ entity, kind: 'dishes', pileSlot, dishes,
        label: `Dishes: ${label}, pile ${pileSlot === 4 ? 1 : pileSlot + 1}` });
    }
  }
  return targets;
}

/** Keyboard-only presentation state for choosing a world target. */
export class KeyboardTargetController {
  private entity: number | null = null;
  private pileSlot: number | null = null;

  constructor(
    private readonly source: KeyboardTargetSource,
    private readonly status: KeyboardTargetStatus,
  ) {}

  cycle(direction: -1 | 1): KeyboardTarget | null {
    const targets = keyboardTargets(this.source);
    if (targets.length === 0) return null;
    const current = targets.findIndex((target) => target.entity === this.entity && (target.pileSlot ?? null) === this.pileSlot);
    const next = current < 0 ? (direction > 0 ? 0 : targets.length - 1) :
      (current + direction + targets.length) % targets.length;
    const target = targets[next];
    this.entity = target.entity;
    this.pileSlot = target.pileSlot ?? null;
    this.status.hidden = false;
    this.status.textContent = `Target: ${target.label}.`;
    return target;
  }

  current(): KeyboardTarget | null {
    return keyboardTargets(this.source).find((target) => target.entity === this.entity && (target.pileSlot ?? null) === this.pileSlot) ?? null;
  }

  activate(): KeyboardActivation {
    const target = this.current();
    if (target === null) {
      return { kind: 'unavailable', message: 'Choose a target first.' };
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
      menu: target.kind === 'dishes' ? dishMenuEntries(target.entity, target.dishes!) : surfaceMenuEntries(this.source, target.entity),
    };
  }

  clear(): void {
    this.entity = null;
    this.pileSlot = null;
    this.status.hidden = true;
    this.status.textContent = '';
  }
}
