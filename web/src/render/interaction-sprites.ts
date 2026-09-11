import { ACTIVITY_AT_WORK, KIND_AGENT } from './instances.js';
import { tickAnimationFrame } from './sim-animation.js';

export type ShirtVariant = 'green' | 'blue' | 'red';
export interface InteractionProfile {
  readonly action: number;
  readonly halfCycleTicks: number;
  readonly frames: Readonly<Record<ShirtVariant, readonly number[]>>;
}
export type InteractionCatalog = Readonly<Record<number, InteractionProfile>>;

export interface InteractionColumns {
  readonly count: number;
  readonly ids: Uint32Array;
  readonly kinds: Uint32Array;
  readonly sprites: Uint32Array;
  readonly actions: Uint32Array | null;
  readonly activities: Uint32Array;
  readonly targets?: Uint32Array;
  readonly simIds?: Uint32Array;
}

export interface InteractionSource {
  readonly count: number;
  ids(): Uint32Array;
  kinds(): Uint32Array;
  sprites(): Uint32Array;
  visualActions?(): Uint32Array;
  activities(): Uint32Array;
  interactionTargets?(): Uint32Array;
  simIds?(): Uint32Array;
}

/** Reused row tables keep selection, suppression and sampling on one contract. */
export class InteractionSelection {
  bodies = new Int32Array(0);
  targetRows = new Int32Array(0);
  suppressed = new Uint8Array(0);
  private owners = new Int32Array(0);
  // Open addressing avoids Map.clear() rebuilding entry storage every frame.
  private rowKeys = new Uint32Array(0);
  private rowValues = new Int32Array(0);
  private readonly columns: { -readonly [K in keyof InteractionColumns]: InteractionColumns[K] } = {
    count: 0, ids: new Uint32Array(0), kinds: new Uint32Array(0),
    sprites: new Uint32Array(0), actions: null, activities: new Uint32Array(0),
  };

  constructor(
    private readonly catalog: InteractionCatalog,
    private readonly shirtVariant: (simId?: number) => ShirtVariant,
  ) {}

  private indexRows(ids: Uint32Array, count: number): void {
    let capacity = 1;
    while (capacity < count * 2) capacity *= 2;
    if (this.rowKeys.length < capacity) {
      this.rowKeys = new Uint32Array(capacity);
      this.rowValues = new Int32Array(capacity);
    }
    this.rowKeys.fill(0xffffffff);
    const mask = this.rowKeys.length - 1;
    for (let row = 0; row < count; row++) {
      const id = ids[row];
      if (id === 0xffffffff) continue;
      let slot = Math.imul(id, 2654435761) & mask;
      for (let probe = 0; probe < this.rowKeys.length; probe++) {
        if (this.rowKeys[slot] === 0xffffffff || this.rowKeys[slot] === id) {
          this.rowKeys[slot] = id;
          this.rowValues[slot] = row;
          break;
        }
        slot = (slot + 1) & mask;
      }
    }
  }

  private findRow(id: number): number | undefined {
    const mask = this.rowKeys.length - 1;
    let slot = Math.imul(id, 2654435761) & mask;
    for (let probe = 0; probe < this.rowKeys.length; probe++) {
      if (this.rowKeys[slot] === 0xffffffff) return undefined;
      if (this.rowKeys[slot] === id) return this.rowValues[slot];
      slot = (slot + 1) & mask;
    }
    return undefined;
  }

  updateSource(source: InteractionSource, tick: number, reducedMotion: boolean): void {
    this.columns.count = source.count;
    this.columns.ids = source.ids();
    this.columns.kinds = source.kinds();
    this.columns.sprites = source.sprites();
    this.columns.actions = source.visualActions?.() ?? null;
    this.columns.activities = source.activities();
    this.columns.targets = source.interactionTargets?.();
    this.columns.simIds = source.simIds?.();
    this.update(this.columns, tick, reducedMotion);
  }

  update(columns: InteractionColumns, tick: number, reducedMotion: boolean): void {
    const { count, ids, kinds, sprites, actions, activities, targets, simIds } = columns;
    if (this.bodies.length < count) {
      this.bodies = new Int32Array(count);
      this.targetRows = new Int32Array(count);
      this.suppressed = new Uint8Array(count);
      this.owners = new Int32Array(count);
    }
    this.bodies.fill(-1, 0, count);
    this.targetRows.fill(-1, 0, count);
    this.suppressed.fill(0, 0, count);
    this.owners.fill(-1, 0, count);
    if (!targets || !actions) return;
    this.indexRows(ids, count);
    for (let row = 0; row < count; row++) {
      if (kinds[row] !== KIND_AGENT || activities[row] === ACTIVITY_AT_WORK || targets[row] === 0xffffffff) continue;
      const target = this.findRow(targets[row]);
      if (target === undefined || kinds[target] === KIND_AGENT || activities[target] === ACTIVITY_AT_WORK) continue;
      const profile = this.catalog[sprites[target]];
      if (!profile || profile.action !== actions[row]) continue;
      const owner = this.owners[target];
      if (owner < 0 || ids[row] < ids[owner]) this.owners[target] = row;
    }
    for (let target = 0; target < count; target++) {
      const row = this.owners[target];
      if (row < 0) continue;
      const profile = this.catalog[sprites[target]];
      const frames = profile.frames[this.shirtVariant(simIds?.[row])];
      const sample = tickAnimationFrame(tick, ids[row] % profile.halfCycleTicks,
        frames.length, 2 * profile.halfCycleTicks / frames.length, reducedMotion);
      this.bodies[row] = frames[sample];
      this.targetRows[row] = target;
      this.suppressed[target] = 1;
    }
  }
}
