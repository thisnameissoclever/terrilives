// The Buy tool in Build mode - [BM-shell] in docs/specs/2026-09-21-buy-mode.md.
//
// The player chooses something from the catalogue, points at the floor, turns
// it and buys it. Rust owns every decision: this controller asks for a preview
// at each position, stages the purchase the player confirms, and reads back
// what the drain did with it.

import type { CatalogueItem, PlacementPreview, SimBridge } from '../bridge.js';

type BuySource = Pick<SimBridge, 'catalogue' | 'purchasePreview' | 'buyObject' |
  'lastPurchaseResult' | 'lotRevision' | 'funds' | 'colourwayNames' | 'buyObjectInColourway'>;

export const CHOOSE_ITEM = 'Choose something to buy.';
const READY = 'Ready to buy.';
const BUYING = 'Buying…';
const NOT_SENT = 'The purchase could not be sent.';
const UNAVAILABLE = 'This position is unavailable.';
const EDIT_KEYS = new Set(['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown',
  '[', ']', 'r', 'R', 'Enter', 'Escape']);

/** Sort primary labels first, model names second, then retain content order. */
export function listed(items: readonly CatalogueItem[]): CatalogueItem[] {
  return [...items].sort((a, b) => {
    if (a.name !== b.name) return a.name < b.name ? -1 : 1;
    const left = a.details?.modelName ?? '';
    const right = b.details?.modelName ?? '';
    return left < right ? -1 : left > right ? 1 : a.definition - b.definition;
  });
}

interface Sent { readonly definition: number; readonly x: number; readonly y: number; readonly facing: number }

export class BuyTool {
  active = false;
  readonly items: readonly CatalogueItem[];
  chosen: CatalogueItem | null = null;
  /** The need the list is narrowed to, by need index, or null for everything ([CB-filter]). */
  filter: number | null = null;
  preview: PlacementPreview | null = null;
  /** The colourway names, in content order; the first is the art as drawn ([RC-slice-buy]). */
  readonly colourways: readonly string[];
  /** The colourway the next purchase is drawn in; kept between purchases. */
  colourway = 0;
  status = CHOOSE_ITEM;
  /** Another pause holds, such as a Load in progress: nothing may be staged. */
  blocked = false;
  private sent: Sent | null = null;
  private revision: number;

  constructor(private readonly source: BuySource, private width: number,
    private height: number, private readonly hooks: { changed(): void }) {
    this.items = listed(source.catalogue());
    this.colourways = source.colourwayNames();
    this.revision = source.lotRevision();
  }

  /** Chooses the colourway the ghost and the next purchase are drawn in. */
  setColourway(colourway: number): void {
    if (this.pending || this.blocked) return;
    if (!Number.isInteger(colourway) || colourway < 0 || colourway >= this.colourways.length) return;
    this.colourway = colourway;
    this.hooks.changed();
  }

  get pending(): boolean { return this.sent !== null; }

  get canRotate(): boolean {
    const mask = this.chosen?.facings ?? 0;
    return (mask & (mask - 1)) !== 0;
  }

  get canBuy(): boolean {
    return this.active && !this.blocked && !this.pending && this.chosen !== null
      && this.preview?.valid === true;
  }

  affordable(item: CatalogueItem): boolean {
    return item.price <= this.source.funds();
  }

  /** Whether the list shows `item` under the filter. */
  shows(item: CatalogueItem): boolean {
    return this.filter === null || (item.needs & (1 << this.filter)) !== 0;
  }

  /**
   * Narrows the list to what serves one need, or `null` for everything. A
   * choice the filter hides is dropped, as the list's placeholder drops it;
   * nothing changes while a purchase is on its way.
   */
  setFilter(need: number | null): void {
    if (this.pending || this.blocked) return;
    this.filter = need;
    if (this.chosen !== null && !this.shows(this.chosen)) this.clear();
    else this.hooks.changed();
  }

  enter(): void {
    if (this.active) return;
    this.active = true;
    // Back before a purchase left on its way has landed: the choice and its
    // status still describe it, and the next drain reports the result.
    if (!this.pending) this.status = CHOOSE_ITEM;
    this.hooks.changed();
  }

  /**
   * Leaves the tool. A purchase already on its way is applied whatever happens
   * here, so it is kept until its result arrives and only then forgotten.
   */
  exit(): void {
    if (!this.active) return;
    this.active = false;
    if (this.pending) this.hooks.changed();
    else this.clear();
  }

  setBlocked(blocked: boolean): void {
    if (this.blocked === blocked) return;
    this.blocked = blocked;
    this.hooks.changed();
  }

  /** Chooses a catalogue item by its pack object index, keeping the ghost where it was. */
  choose(definition: number): void {
    if (!this.active || this.pending || this.blocked) return;
    const item = this.items.find(entry => entry.definition === definition);
    if (!item) return;
    this.chosen = item;
    const at = this.preview ?? { x: Math.floor(this.width / 2), y: Math.floor(this.height / 2) };
    this.query(at.x, at.y, item.baseFacing);
  }

  /**
   * Steps through the list the way the keys do, skipping what the filter
   * hides and what the household cannot afford, as the list greys it out.
   * Does nothing when nothing is left.
   */
  cycle(direction: -1 | 1): void {
    const count = this.items.length;
    const current = this.chosen === null ? (direction > 0 ? -1 : count) : this.items.indexOf(this.chosen);
    for (let step = 1; step <= count; step += 1) {
      const item = this.items[(((current + direction * step) % count) + count) % count];
      if (this.shows(item) && this.affordable(item)) {
        this.choose(item.definition);
        return;
      }
    }
  }

  /** A click or tap on a lot tile. */
  moveTo(x: number, y: number): void {
    if (!this.active || this.pending || this.blocked || !this.preview) return;
    this.query(x, y, this.preview.facing);
  }

  rotate(): void {
    if (!this.active || this.pending || this.blocked || !this.preview || !this.canRotate) return;
    const mask = this.chosen?.facings ?? 0;
    for (let turn = 1; turn <= 4; turn += 1) {
      const facing = (this.preview.facing + turn) % 4;
      if ((mask & (1 << facing)) !== 0) {
        this.query(this.preview.x, this.preview.y, facing);
        return;
      }
    }
  }

  buy(): void {
    const chosen = this.chosen;
    const preview = this.preview;
    if (!this.canBuy || chosen === null || preview === null) return;
    const sent = { definition: chosen.definition, x: preview.x, y: preview.y, facing: preview.facing };
    // As drawn is the plain purchase; any other colourway buys it drawn in it.
    const staged = this.colourway === 0
      ? this.source.buyObject(sent.definition, sent.x, sent.y, sent.facing)
      : this.source.buyObjectInColourway(sent.definition, sent.x, sent.y, sent.facing, this.colourway);
    if (staged) {
      this.sent = sent;
      this.status = BUYING;
    } else {
      this.status = NOT_SENT;
    }
    this.hooks.changed();
  }

  cancel(): void {
    if (this.pending || this.blocked) return;
    this.clear();
  }

  handleKey(key: string): boolean {
    if (!this.active || !EDIT_KEYS.has(key)) return false;
    if (key === 'Escape') {
      if (this.chosen === null) return false;
      // A purchase on its way is applied whatever happens here; clearing now
      // would lose its result, so Escape waits the one frame it takes.
      this.cancel();
      return true;
    }
    if (this.pending || this.blocked) return true;
    const step = ({ ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] } as
      Record<string, [number, number] | undefined>)[key];
    if (step) {
      if (this.preview) this.moveTo(this.preview.x + step[0], this.preview.y + step[1]);
      else this.cycle(1);
      return true;
    }
    switch (key) {
      case '[': this.cycle(-1); break;
      case ']': this.cycle(1); break;
      case 'r': case 'R': this.rotate(); break;
      case 'Enter': this.buy(); break;
    }
    return true;
  }

  /** Call after the frame drains commands, before drawing. */
  afterCommands(): void {
    const revision = this.source.lotRevision();
    const lotChanged = revision !== this.revision;
    this.revision = revision;
    const sent = this.sent;
    if (sent !== null) {
      const result = this.source.lastPurchaseResult();
      if (result && result.definition === sent.definition && result.x === sent.x
        && result.y === sent.y && result.facing === sent.facing) {
        this.sent = null;
        if (!this.active) {
          this.clear();
          return;
        }
        if (this.preview) this.query(this.preview.x, this.preview.y, this.preview.facing);
        this.status = result.reason ?? `${this.chosen?.name ?? 'Furniture'} bought.`;
        this.hooks.changed();
        return;
      }
    }
    if (lotChanged && this.active && this.preview && !this.pending) {
      this.query(this.preview.x, this.preview.y, this.preview.facing);
    }
  }

  /**
   * After Load: nothing chosen, nothing pending, the whole catalogue shown and
   * the loaded lot's size. Leaving the tool and coming back keeps the filter;
   * a Load starts the panel afresh ([CB-filter]).
   */
  resetAfterLoad(width: number, height: number): void {
    this.width = width;
    this.height = height;
    this.revision = this.source.lotRevision();
    this.filter = null;
    this.colourway = 0;
    this.clear();
  }

  /** The colourway the ghost is drawn in, while this is the tool in use. */
  ghostColourway(): number {
    return this.active ? this.colourway : 0;
  }

  /** The ghost to draw, while this is the tool in use. */
  ghost(): PlacementPreview | null {
    return this.active ? this.preview : null;
  }

  private query(x: number, y: number, facing: number): void {
    const chosen = this.chosen;
    if (chosen === null) return;
    const preview = this.source.purchasePreview(chosen.definition, x, y, facing);
    // A ghost pushed off the lot still needs its size and art to be drawn
    // red, so they come from a query at a tile that always has them.
    const geometry = preview.width > 0 ? preview :
      this.source.purchasePreview(chosen.definition, 0, 0, facing);
    this.preview = { ...preview, width: geometry.width, depth: geometry.depth,
      sprite: geometry.sprite, foreground: geometry.foreground };
    this.status = preview.valid ? READY : preview.reason ?? UNAVAILABLE;
    this.hooks.changed();
  }

  private clear(): void {
    this.sent = null;
    this.chosen = null;
    this.preview = null;
    this.status = CHOOSE_ITEM;
    this.hooks.changed();
  }
}
