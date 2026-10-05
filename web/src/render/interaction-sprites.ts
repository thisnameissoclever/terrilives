import { bedSceneKey, SLEEP_VISUAL_ACTION, type BedCatalog, type BedScene } from './bed-sprites.js';
import { ACTIVITY_AT_WORK, KIND_AGENT } from './instances.js';
import { tickAnimationFrame } from './sim-animation.js';

function paletteIndex(variant: ShirtVariant): number {
  return variant === 'green' ? 0 : variant === 'blue' ? 1 : 2;
}

export type ShirtVariant = 'green' | 'blue' | 'red';
export interface InteractionProfile {
  readonly action: number;
  readonly halfCycleTicks: number;
  readonly frames: Readonly<Record<ShirtVariant, readonly number[]>>;
  readonly facingFrames?: Readonly<Record<number, Readonly<Record<ShirtVariant, readonly number[]>>>>;
}
export type InteractionCatalog = Readonly<Record<number, InteractionProfile>>;
export type ActionInteractionCatalog = Readonly<Record<number, Readonly<Record<number, InteractionProfile>>>>;

export interface InteractionColumns {
  readonly count: number;
  readonly ids: Uint32Array;
  readonly kinds: Uint32Array;
  readonly sprites: Uint32Array;
  readonly actions: Uint32Array | null;
  readonly activities: Uint32Array;
  readonly facings?: Uint32Array;
  readonly targets?: Uint32Array;
  readonly simIds?: Uint32Array;
  readonly sleepingBeds?: Uint32Array;
  readonly sleepingPlaces?: Uint32Array;
  readonly mealTables?: Uint32Array;
}

export interface InteractionSource {
  readonly count: number;
  ids(): Uint32Array;
  kinds(): Uint32Array;
  sprites(): Uint32Array;
  visualActions?(): Uint32Array;
  activities(): Uint32Array;
  facings?(): Uint32Array;
  interactionTargets?(): Uint32Array;
  simIds?(): Uint32Array;
  sleepingBeds?(): Uint32Array;
  sleepingPlaces?(): Uint32Array;
  mealTables?(): Uint32Array;
}

/** Reused row tables keep selection, suppression and sampling on one contract. */
export class InteractionSelection {
  bodies = new Int32Array(0);
  targetRows = new Int32Array(0);
  mealRows = new Int32Array(0);
  suppressed = new Uint8Array(0);
  readonly bedScenes: (BedScene | undefined)[] = [];
  bedPlaces = new Int8Array(0);
  drawSuppressed = new Uint8Array(0);
  bedDrawRows = new Int32Array(0);
  private place0 = new Int32Array(0);
  private place1 = new Int32Array(0);
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
    private readonly beds: BedCatalog = {},
    private readonly actionCatalog: ActionInteractionCatalog = {},
  ) {}

  ownerForTarget(row: number): number {
    return this.owners[row] ?? -1;
  }

  private profileFor(sprite: number, action: number): InteractionProfile | undefined {
    const profile = this.actionCatalog[sprite]?.[action] ?? this.catalog[sprite];
    return profile?.action === action ? profile : undefined;
  }

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
    this.columns.facings = source.facings?.();
    this.columns.targets = source.interactionTargets?.();
    this.columns.simIds = source.simIds?.();
    this.columns.sleepingBeds = source.sleepingBeds?.();
    this.columns.sleepingPlaces = source.sleepingPlaces?.();
    this.columns.mealTables = source.mealTables?.();
    this.update(this.columns, tick, reducedMotion);
  }

  update(columns: InteractionColumns, tick: number, reducedMotion: boolean): void {
    const { count, ids, kinds, sprites, actions, activities, targets, simIds } = columns;
    if (this.bodies.length < count) {
      this.bodies = new Int32Array(count);
      this.targetRows = new Int32Array(count);
      this.mealRows = new Int32Array(count);
      this.suppressed = new Uint8Array(count);
      this.owners = new Int32Array(count);
      this.place0 = new Int32Array(count);
      this.place1 = new Int32Array(count);
      this.bedPlaces = new Int8Array(count);
      this.drawSuppressed = new Uint8Array(count);
      this.bedDrawRows = new Int32Array(count);
    }
    this.bodies.fill(-1, 0, count);
    this.targetRows.fill(-1, 0, count);
    this.mealRows.fill(-1, 0, count);
    this.suppressed.fill(0, 0, count);
    this.owners.fill(-1, 0, count);
    this.place0.fill(-1, 0, count);
    this.place1.fill(-1, 0, count);
    this.bedPlaces.fill(-1, 0, count);
    this.drawSuppressed.fill(0, 0, count);
    this.bedDrawRows.fill(-1, 0, count);
    this.bedScenes.fill(undefined, 0, this.bedScenes.length);
    this.bedScenes.length = Math.max(this.bedScenes.length, count);
    this.indexRows(ids, count);
    const sleepingBeds = columns.sleepingBeds, sleepingPlaces = columns.sleepingPlaces;
    if (sleepingBeds && sleepingPlaces && actions) {
      for (let row = 0; row < count; row++) {
        if (kinds[row] !== KIND_AGENT || activities[row] === ACTIVITY_AT_WORK
            || actions[row] !== SLEEP_VISUAL_ACTION || sleepingBeds[row] === 0xffffffff) continue;
        const target = this.findRow(sleepingBeds[row]);
        if (target === undefined || kinds[target] === KIND_AGENT || !this.beds[sprites[target]]) continue;
        const place = sleepingPlaces[row];
        if (place > 1) throw new Error('covered bed place is outside its catalog');
        const owners = place === 0 ? this.place0 : this.place1;
        if (owners[target] >= 0) throw new Error('covered bed has duplicate visible place owners');
        owners[target] = row;
      }
    }
    for (let target = 0; target < count; target++) {
      const catalog = kinds[target] === KIND_AGENT ? undefined : this.beds[sprites[target]];
      if (!catalog) continue;
      const a = this.place0[target], b = this.place1[target];
      const mask = (a >= 0 ? 1 : 0) | (b >= 0 ? 2 : 0);
      const scene = catalog[bedSceneKey(mask,
        a < 0 ? 0 : paletteIndex(this.shirtVariant(simIds?.[a])),
        b < 0 ? 0 : paletteIndex(this.shirtVariant(simIds?.[b])))];
      if (!scene) throw new Error('covered bed scene is missing its occupancy and shirt combination');
      this.bodies[target] = scene.sprite;
      this.targetRows[target] = target;
      this.bedScenes[target] = scene;
      const drawRow = a >= 0 ? a : b >= 0 ? b : target;
      this.bedDrawRows[target] = drawRow;
      this.suppressed[target] = mask ? 1 : 0;
      if (a >= 0) {
        this.bodies[a] = scene.sprite; this.targetRows[a] = target;
        this.bedScenes[a] = scene; this.bedPlaces[a] = 0;
        this.bedDrawRows[a] = drawRow;
      }
      if (b >= 0) {
        this.bodies[b] = scene.sprite; this.targetRows[b] = target;
        this.bedScenes[b] = scene; this.bedPlaces[b] = 1;
        this.bedDrawRows[b] = drawRow;
        this.drawSuppressed[b] = a >= 0 ? 1 : 0;
      }
    }
    if (!targets || !actions) return;
    for (let row = 0; row < count; row++) {
      if (this.bedPlaces[row] >= 0 || kinds[row] !== KIND_AGENT || activities[row] === ACTIVITY_AT_WORK || targets[row] === 0xffffffff) continue;
      const target = this.findRow(targets[row]);
      if (target === undefined || kinds[target] === KIND_AGENT || activities[target] === ACTIVITY_AT_WORK) continue;
      const profile = this.profileFor(sprites[target], actions[row]);
      if (!profile) continue;
      const owner = this.owners[target];
      if (owner < 0 || ids[row] < ids[owner]) this.owners[target] = row;
    }
    for (let target = 0; target < count; target++) {
      const row = this.owners[target];
      if (row < 0) continue;
      const profile = this.profileFor(sprites[target], actions[row]);
      if (!profile) throw new Error('Owned interaction lost its exact action profile');
      const variant = this.shirtVariant(simIds?.[row]);
      const frames = (profile.facingFrames?.[columns.facings?.[row] ?? 0] ?? profile.frames)[variant];
      const sample = tickAnimationFrame(tick, ids[row] % profile.halfCycleTicks,
        frames.length, 2 * profile.halfCycleTicks / frames.length, reducedMotion);
      this.bodies[row] = frames[sample];
      this.targetRows[row] = target;
      this.suppressed[target] = 1;
      const mealTable = columns.mealTables?.[row];
      if (profile.action === 13 && mealTable !== undefined && mealTable !== 0xffffffff) {
        const table = this.findRow(mealTable);
        if (table !== undefined && kinds[table] !== KIND_AGENT && activities[table] !== ACTIVITY_AT_WORK) {
          this.mealRows[row] = table;
        }
      }
    }
  }
}
