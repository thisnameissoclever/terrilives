import { bedSceneKey, SLEEP_VISUAL_ACTION, type BedCatalog, type BedScene } from './bed-sprites.js';
import { ACTIVITY_AT_WORK, KIND_AGENT } from './instances.js';
import { tickAnimationFrame } from './sim-animation.js';
import { sharedSeatKey, sharedSeatPhase, reclineKey, RECLINE_ACTIVITY, RECLINE_VISUAL_ACTION, type SharedSeatCatalog, type ReclineCatalog } from './shared-seat-sprites.js';
import { readingBodyScene, type ReadingBodyCatalog } from './reading-sprites.js';
import { bookReachFrame, FETCH_BOOK_STAGE, SHELVE_BOOK_STAGE, type BookReachCatalog } from './book-reach-sprites.js';
import { fetchFrame, FETCH_VISUAL_ACTION } from './fetch-animation.js';

function paletteIndex(variant: ShirtVariant): number {
  return variant === 'green' ? 0 : variant === 'blue' ? 1 : 2;
}

export type ShirtVariant = 'green' | 'blue' | 'red';
export interface InteractionProfile {
  readonly action: number;
  readonly halfCycleTicks: number;
  readonly frames: Readonly<Record<ShirtVariant, readonly number[]>>;
  readonly facingFrames?: Readonly<Record<number, Readonly<Record<ShirtVariant, readonly number[]>>>>;
  readonly idleFrames?: Readonly<Record<ShirtVariant, readonly number[]>>;
  /**
   * Feet centre of each sample in tiles relative to the fixture, for scenes
   * whose body stands off the fixture's tile. The marker and bubble follow it.
   */
  readonly feet?: readonly (readonly [number, number])[];
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
  readonly seatedFurniture?: Uint32Array;
  readonly seatedPlaces?: Uint32Array;
  readonly seatedWhole?: Uint32Array;
  readonly seatIdsByModel?: Readonly<Record<string, readonly string[]>>;
  readonly readingStages?: Uint32Array;
  readonly readingCopies?: Uint32Array;
  readonly readingHomeShelves?: Uint32Array;
  readonly readingHomeSlots?: Uint32Array;
  readonly readingReachRemaining?: Uint32Array;
  readonly readingReachTotals?: Uint32Array;
  readonly carriedBooks?: Uint32Array;
  readonly positions?: Float32Array;
  /** Step progress in thousandths; progress-driven profiles (the fridge reach) sample from it. */
  readonly choreProgress?: Uint32Array;
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
  seatedFurniture?(): Uint32Array;
  seatedPlaces?(): Uint32Array;
  seatedWhole?(): Uint32Array;
  modelSeatIds?(model: string): readonly string[];
  readingStages?(): Uint32Array;
  readingCopies?(): Uint32Array;
  readingHomeShelves?(): Uint32Array;
  readingHomeSlots?(): Uint32Array;
  readingReachRemaining?(): Uint32Array;
  readingReachTotals?(): Uint32Array;
  carriedBooks?(): Uint32Array;
  positions?(): Float32Array;
  choreProgress?(): Uint32Array;
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
  readonly bookReachRows: boolean[] = [];
  /** Rows drawing a fixture scene whose body stands on the front tile. */
  reachRows = new Uint8Array(0);
  /** For those rows, the drawn feet in tiles relative to the fixture, as x, y pairs. */
  reachFeet = new Float32Array(0);
  private stockSuppression = new Uint32Array(0);
  private stockPresence = new Uint32Array(0);
  private place0 = new Int32Array(0);
  private place1 = new Int32Array(0);
  private place2 = new Int32Array(0);
  private source: InteractionSource | undefined;
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
    private readonly sharedSeats: SharedSeatCatalog = {},
    private readonly readingBodies: ReadingBodyCatalog = {},
    private readonly reclines: ReclineCatalog = {},
    private readonly bookReaches: BookReachCatalog = {},
  ) {}

  shelfMask(row: number, physicalMask: number): number {
    return ((physicalMask | this.stockPresence[row]) & ~this.stockSuppression[row]) & 0xffffff;
  }

  ownerForTarget(row: number): number {
    return this.owners[row] ?? -1;
  }

  private profileFor(sprite: number, action: number, atTable = false): InteractionProfile | undefined {
    if (atTable && action === 8 && this.catalog[sprite]?.idleFrames) return this.catalog[sprite];
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
    this.source = source;
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
    this.columns.seatedFurniture = source.seatedFurniture?.();
    this.columns.seatedPlaces = source.seatedPlaces?.();
    this.columns.seatedWhole = source.seatedWhole?.();
    this.columns.readingStages = source.readingStages?.();
    this.columns.readingCopies = source.readingCopies?.();
    this.columns.readingHomeShelves = source.readingHomeShelves?.();
    this.columns.readingHomeSlots = source.readingHomeSlots?.();
    this.columns.readingReachRemaining = source.readingReachRemaining?.();
    this.columns.readingReachTotals = source.readingReachTotals?.();
    this.columns.carriedBooks = source.carriedBooks?.();
    this.columns.positions = source.positions?.();
    this.columns.choreProgress = source.choreProgress?.();
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
      this.place2 = new Int32Array(count);
      this.bedPlaces = new Int8Array(count);
      this.drawSuppressed = new Uint8Array(count);
      this.bedDrawRows = new Int32Array(count);
      this.stockSuppression = new Uint32Array(count);
      this.stockPresence = new Uint32Array(count);
      this.reachRows = new Uint8Array(count);
      this.reachFeet = new Float32Array(count * 2);
    }
    this.bodies.fill(-1, 0, count);
    this.targetRows.fill(-1, 0, count);
    this.mealRows.fill(-1, 0, count);
    this.suppressed.fill(0, 0, count);
    this.owners.fill(-1, 0, count);
    this.place0.fill(-1, 0, count);
    this.place1.fill(-1, 0, count);
    this.place2.fill(-1, 0, count);
    this.bedPlaces.fill(-1, 0, count);
    this.drawSuppressed.fill(0, 0, count);
    this.bedDrawRows.fill(-1, 0, count);
    this.stockSuppression.fill(0, 0, count);
    this.stockPresence.fill(0, 0, count);
    this.reachRows.fill(0, 0, count);
    this.bookReachRows.length = count;
    this.bookReachRows.fill(false);
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
    this.place0.fill(-1, 0, count);
    this.place1.fill(-1, 0, count);
    if (actions && columns.seatedFurniture && columns.seatedWhole) {
      for (let row = 0; row < count; row++) {
        if (kinds[row] !== KIND_AGENT || activities[row] === ACTIVITY_AT_WORK
            || columns.seatedWhole[row] !== 1 || columns.seatedFurniture[row] === 0xffffffff) continue;
        const target = this.findRow(columns.seatedFurniture[row]);
        const profile = target === undefined ? undefined : this.reclines[sprites[target]];
        if (target === undefined || !profile) continue;
        if (actions[row] !== RECLINE_VISUAL_ACTION || activities[row] !== RECLINE_ACTIVITY) {
          throw new Error('Whole-sofa owner has no active lounging presentation');
        }
        for (let other = 0; other < count; other++) {
          if (other !== row && kinds[other] === KIND_AGENT && columns.seatedFurniture[other] === columns.seatedFurniture[row]) {
            throw new Error('Exclusive whole-sofa recline overlaps another active physical seat');
          }
        }
        const scene = profile.scenes[reclineKey(sharedSeatPhase(tick, reducedMotion), paletteIndex(this.shirtVariant(simIds?.[row])))];
        if (!scene || scene.owners.length !== 1 || !scene.owners[0]) throw new Error('Whole-sofa recline scene or owner is missing');
        this.bodies[row] = scene.sprite; this.targetRows[row] = target;
        this.bedScenes[row] = scene; this.bedPlaces[row] = 0; this.bedDrawRows[row] = row;
        this.bodies[target] = scene.sprite; this.targetRows[target] = target;
        this.bedScenes[target] = scene; this.bedDrawRows[target] = row; this.suppressed[target] = 1;
      }
    }
    if (actions && columns.seatedFurniture && columns.seatedPlaces) {
      for (let row = 0; row < count; row++) {
        if (kinds[row] !== KIND_AGENT || columns.seatedFurniture[row] === 0xffffffff
            || columns.seatedWhole?.[row] === 1) continue;
        const target = this.findRow(columns.seatedFurniture[row]);
        const profile = target === undefined ? undefined : this.sharedSeats[sprites[target]];
        if (target === undefined || !profile) continue;
        if (profile.actions && !profile.actions.includes(actions[row])) continue;
        const authored = columns.seatIdsByModel?.[profile.model] ?? this.source?.modelSeatIds?.(profile.model);
        const stable = authored?.[columns.seatedPlaces[row]];
        const place = stable === undefined ? -1 : profile.seatIds.indexOf(stable);
        if (place < 0) throw new Error('Active sofa seat has no stable authored art place');
        if (actions[row] !== 3 && actions[row] !== 8) throw new Error('Active sofa action has no shared art profile');
        const owner = place === 0 ? this.place0 : place === 1 ? this.place1 : this.place2;
        if (owner[target] >= 0) throw new Error('Sofa has duplicate physical seat owners');
        owner[target] = row;
      }
      for (let target = 0; target < count; target++) {
        const profile = this.sharedSeats[sprites[target]];
        if (!profile || kinds[target] === KIND_AGENT) continue;
        const a = this.place0[target], b = this.place1[target], c = this.place2[target];
        const action = (a < 0 ? 0 : actions[a] === 3 ? 2 : 1)
          + 3 * (b < 0 ? 0 : actions[b] === 3 ? 2 : 1)
          + 9 * (c < 0 ? 0 : actions[c] === 3 ? 2 : 1);
        if (action === 0) continue;
        const scene = profile.scenes[sharedSeatKey(action, sharedSeatPhase(tick, reducedMotion),
          a < 0 ? 0 : paletteIndex(this.shirtVariant(simIds?.[a])),
          b < 0 ? 0 : paletteIndex(this.shirtVariant(simIds?.[b])),
          c < 0 ? 0 : paletteIndex(this.shirtVariant(simIds?.[c])))];
        if (!scene || scene.owners.length !== profile.seatIds.length) throw new Error('Shared seat scene is missing its actions, phase or palettes');
        const drawRow = a >= 0 ? a : b >= 0 ? b : c;
        this.bodies[target] = scene.sprite; this.targetRows[target] = target;
        this.bedScenes[target] = scene; this.bedDrawRows[target] = drawRow;
        this.suppressed[target] = 1;
        for (let place = 0; place < profile.seatIds.length; place++) {
          const row = place === 0 ? a : place === 1 ? b : c;
          if ((row >= 0) !== (scene.owners[place] !== null)) throw new Error('Shared sofa visible owners differ from physical seats');
          if (row < 0) continue;
          this.bodies[row] = scene.sprite; this.targetRows[row] = target;
          this.bedScenes[row] = scene; this.bedPlaces[row] = place;
          this.bedDrawRows[row] = drawRow; this.drawSuppressed[row] = row === drawRow ? 0 : 1;
        }
      }
    }
    if (columns.readingStages && columns.readingCopies && columns.readingHomeShelves
        && columns.readingHomeSlots && columns.readingReachRemaining && columns.readingReachTotals) {
      for (let row = 0; row < count; row++) {
        const stage = columns.readingStages[row];
        if (kinds[row] !== KIND_AGENT || activities[row] === ACTIVITY_AT_WORK
            || (stage !== FETCH_BOOK_STAGE && stage !== SHELVE_BOOK_STAGE)) continue;
        const target = this.findRow(columns.readingHomeShelves[row]);
        const profile = target === undefined ? undefined : this.bookReaches[sprites[target]];
        if (target === undefined || !profile) continue;
        if (columns.readingCopies[row] === 0xffffffff || kinds[target] === KIND_AGENT) {
          throw new Error('Book reach has no physical copy or home bookcase');
        }
        if (this.suppressed[target]) throw new Error('Bookcase has conflicting visible reach owners');
        const slot = columns.readingHomeSlots[row];
        const frame = bookReachFrame(profile, stage, slot, columns.readingReachRemaining[row],
          columns.readingReachTotals[row], paletteIndex(this.shirtVariant(simIds?.[row])));
        this.bodies[row] = frame.scene.sprite; this.targetRows[row] = target;
        this.bedScenes[row] = frame.scene; this.bedPlaces[row] = 0; this.bedDrawRows[row] = row;
        this.bodies[target] = frame.scene.sprite; this.targetRows[target] = target;
        this.bedScenes[target] = frame.scene; this.bedDrawRows[target] = row;
        this.suppressed[target] = 1; this.bookReachRows[row] = true;
        if (frame.suppressStock) this.stockSuppression[target] |= 1 << slot;
        else this.stockPresence[target] |= 1 << slot;
      }
    }
    if (actions && columns.readingStages && columns.carriedBooks) {
      for (let row = 0; row < count; row++) {
        if (kinds[row] !== KIND_AGENT || this.bedPlaces[row] >= 0 || activities[row] === ACTIVITY_AT_WORK) continue;
        const scene = readingBodyScene(this.readingBodies, columns.readingStages[row], columns.carriedBooks[row],
          actions[row], columns.facings?.[row] ?? 0, paletteIndex(this.shirtVariant(simIds?.[row])), tick, reducedMotion,
          columns.positions?.[row * 2] ?? 0, columns.positions?.[row * 2 + 1] ?? 0);
        if (!scene) continue;
        this.bodies[row] = scene.sprite; this.bedScenes[row] = scene; this.bedPlaces[row] = 0;
        this.bedDrawRows[row] = row;
      }
    }
    if (!targets || !actions) return;
    for (let row = 0; row < count; row++) {
      if (this.bedPlaces[row] >= 0 || kinds[row] !== KIND_AGENT || activities[row] === ACTIVITY_AT_WORK) continue;
      const activeFurniture = columns.seatedFurniture?.[row];
      const targetId = activeFurniture !== undefined && activeFurniture !== 0xffffffff ? activeFurniture : targets[row];
      if (targetId === 0xffffffff) continue;
      const target = this.findRow(targetId);
      if (target === undefined || kinds[target] === KIND_AGENT || activities[target] === ACTIVITY_AT_WORK) continue;
      const profile = this.profileFor(sprites[target], actions[row], columns.mealTables?.[row] !== undefined && columns.mealTables[row] !== 0xffffffff);
      if (!profile) continue;
      const owner = this.owners[target];
      if (owner < 0 || ids[row] < ids[owner]) this.owners[target] = row;
    }
    for (let target = 0; target < count; target++) {
      const row = this.owners[target];
      if (row < 0) continue;
      const profile = this.profileFor(sprites[target], actions[row], columns.mealTables?.[row] !== undefined && columns.mealTables[row] !== 0xffffffff);
      if (!profile) throw new Error('Owned interaction lost its exact action profile');
      const variant = this.shirtVariant(simIds?.[row]);
      const resting = actions[row] === 8 && profile.idleFrames;
      const frames = (resting || profile.facingFrames?.[columns.facings?.[row] ?? 0] || profile.frames)[variant];
      const sample = resting ? 0
        : profile.action === FETCH_VISUAL_ACTION
          ? fetchFrame(columns.choreProgress?.[row] ?? 0, frames.length, reducedMotion)
          : tickAnimationFrame(tick, ids[row] % profile.halfCycleTicks,
            frames.length, 2 * profile.halfCycleTicks / frames.length, reducedMotion);
      this.bodies[row] = frames[sample];
      this.targetRows[row] = target;
      this.suppressed[target] = 1;
      if (profile.action === FETCH_VISUAL_ACTION) {
        this.reachRows[row] = 1;
        const feet = profile.feet?.[sample];
        this.reachFeet[row * 2] = feet?.[0] ?? 0;
        this.reachFeet[row * 2 + 1] = feet?.[1] ?? 0;
      }
      const mealTable = columns.mealTables?.[row];
      if (profile.action === 13 && mealTable !== undefined && mealTable !== 0xffffffff) {
        const table = this.findRow(mealTable);
        if (table !== undefined && kinds[table] !== KIND_AGENT && activities[table] !== ACTIVITY_AT_WORK) {
          this.mealRows[row] = table;
        }
      }
    }
    // These generic body clips share the same complementary surface-depth pass.
    for (let row=0;row<count;row++) {
      if(kinds[row]!==KIND_AGENT || activities[row]===ACTIVITY_AT_WORK || actions[row]<15 || actions[row]>17) continue;
      const support=this.findRow(targets[row]);
      if(support!==undefined && kinds[support]!==KIND_AGENT) this.mealRows[row]=support;
    }
  }
}
