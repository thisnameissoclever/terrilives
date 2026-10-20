// The Floors tool in Build mode - [FL-tool] in
// docs/specs/2026-09-22-floors.md.
//
// The player selects a tile, or two opposite corners and every tile between
// them ([FL-area]), then applies a covering. Rust owns every decision: this
// controller asks for a preview, stages the changes the player asked for, and
// reads back what the drain did with them.

import { floorReason, type SimBridge } from '../bridge.js';
import type { TileHighlight } from '../render/placement-preview.js';
import { EDITS_PER_FRAME } from './command-batch.js';

/** No covering: the tile is drawn by where it is ([OS-yard]). */
export const BARE = 0;

type FloorSource = Pick<SimBridge, 'coveringNames' | 'floorTiles' | 'floorEditPreview' |
  'setFloor' | 'lastFloorEditResult' | 'lotRevision'>;
type Tile = [number, number];

export const CHOOSE_TILE = '';
const NOT_SENT = 'That change could not be sent.';

/** The tile under a world point, or null when the point is off the lot. */
export function tileAt(wx: number, wy: number, width: number, height: number): [number, number] | null {
  if (!Number.isFinite(wx) || !Number.isFinite(wy)) return null;
  const x = Math.round(wx);
  const y = Math.round(wy);
  return x >= 0 && y >= 0 && x < width && y < height ? [x, y] : null;
}

/** What the tile list says is on this tile, 0 for a tile nobody has painted. */
export function coveringOf(tiles: ArrayLike<number>, x: number, y: number): number {
  for (let at = 0; at + 2 < tiles.length; at += 3) {
    if (tiles[at] === x && tiles[at + 1] === y) return tiles[at + 2];
  }
  return BARE;
}

export class FloorTool {
  active = false;
  /** The chosen tile: the first corner of an area. */
  tile: [number, number] | null = null;
  /** The opposite corner of an area, or null for one tile ([FL-area]). */
  corner: [number, number] | null = null;
  /** The last covering requested, 0 for Remove. Selecting a tile never applies it. */
  chosen = 1;
  /** What the chosen tile carries now. */
  current = BARE;
  status = CHOOSE_TILE;
  pending: number | null = null;
  /** Another pause holds, such as a Load in progress: nothing may be staged. */
  blocked = false;
  resourceStatus: string | null = null;
  resourceFailed = false;
  private revision: number;
  private shownHighlight: TileHighlight | null = null;
  /** Whether the next click may be the opposite corner of an area. */
  private extendable = false;
  /** Every chosen tile's covering now, in `tiles()` order. */
  private currents: number[] = [];
  /** Each covering's preview codes for every chosen tile, read once per selection. */
  private previews = new Map<number, number[]>();
  /** The tiles the batch on its way changes, in the order they were staged. */
  private sent: Tile[] = [];
  /** Every tile staged so far for the edit on its way, and the ones still waiting for a batch. */
  private staged: Tile[] = [];
  private waiting: Tile[] = [];

  constructor(private readonly source: FloorSource, private width: number,
    private height: number, private readonly hooks: { changed(): void }) {
    this.revision = source.lotRevision();
  }

  /** The coverings to offer, in content order; the ids are 1 upward. */
  coverings(): string[] {
    return this.source.coveringNames();
  }

  enter(): void {
    if (this.active) return;
    this.active = true;
    if (this.pending === null) this.status = CHOOSE_TILE;
    this.hooks.changed();
  }

  exit(): void {
    if (!this.active) return;
    this.active = false;
    if (this.pending === null) this.clear();
    else this.hooks.changed();
  }

  /** Chooses a covering for validation without staging an edit. */
  choose(covering: number): void {
    if (!this.active || this.pending !== null || this.blocked) return;
    if (!Number.isInteger(covering) || covering < BARE || covering > this.coverings().length) return;
    this.chosen = covering;
    if (this.tile) this.refresh();
    this.hooks.changed();
  }

  /**
   * A click or tap selects a tile without changing its covering. A second
   * click on another tile, before anything is applied, makes the two the
   * opposite corners of an area; the click after that starts again.
   */
  choosePoint(wx: number, wy: number): void {
    if (!this.active || this.pending !== null || this.blocked) return;
    const tile = tileAt(wx, wy, this.width, this.height);
    if (!tile) return;
    if (this.tile !== null && this.extendable) {
      if (tile[0] === this.tile[0] && tile[1] === this.tile[1]) return;
      this.corner = tile;
      this.extendable = false;
    } else {
      this.tile = tile;
      this.corner = null;
      this.extendable = true;
    }
    this.refresh();
    this.status = this.describe();
    this.hooks.changed();
  }

  /** Every chosen tile, row by row. */
  tiles(): Tile[] {
    const first = this.tile;
    if (first === null) return [];
    const second = this.corner ?? first;
    const [x0, x1] = [Math.min(first[0], second[0]), Math.max(first[0], second[0])];
    const [y0, y1] = [Math.min(first[1], second[1]), Math.max(first[1], second[1])];
    const tiles: Tile[] = [];
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) tiles.push([x, y]);
    return tiles;
  }

  /** Whether more than one tile is chosen. */
  get isArea(): boolean {
    return this.corner !== null;
  }

  /** The middle of the chosen tiles, where the contextual controls stand. */
  anchorPoint(): [number, number] | null {
    const first = this.tile;
    if (first === null) return null;
    const second = this.corner ?? first;
    return [(first[0] + second[0]) / 2, (first[1] + second[1]) / 2];
  }

  setBlocked(blocked: boolean): void {
    if (this.blocked === blocked) return;
    this.blocked = blocked;
    this.hooks.changed();
  }

  setResourceStatus(status: string | null, failed = false): void {
    if (status === this.resourceStatus && failed === this.resourceFailed) return;
    this.resourceStatus = status;
    this.resourceFailed = failed;
    this.hooks.changed();
  }

  /**
   * Shares the committed covering ID and the static floor material writer:
   * `[x, y, covering]` for every chosen tile that would take the covering.
   */
  preview(): readonly number[] | null {
    if (!this.active || this.blocked || this.resourceStatus !== null || !this.tile) return null;
    const codes = this.codes(this.chosen);
    const preview = this.tiles().flatMap(([x, y], at) => codes[at] === 0 ? [x, y, this.chosen] : []);
    return preview.length > 0 ? preview : null;
  }

  /** Whether laying the chosen covering on the chosen tiles would do anything. */
  canApply(): boolean {
    return this.canApplyCovering(this.chosen);
  }

  apply(): void {
    if (!this.active || this.pending !== null || this.blocked) return;
    const tile = this.tile;
    if (tile === null || !this.canApply()) {
      if (tile !== null) this.status = this.isArea || this.chosen === this.current ? this.describe()
        : this.refusal(this.codes(this.chosen)[0]);
      this.hooks.changed();
      return;
    }
    this.waiting = this.targets(this.chosen);
    this.staged = [];
    if (this.stageBatch(this.chosen) > 0) {
      this.pending = this.chosen;
    } else {
      this.waiting = [];
      this.status = NOT_SENT;
    }
    this.hooks.changed();
  }

  /** Stages the next batch of waiting tiles; how many the queue took. */
  private stageBatch(covering: number): number {
    const sent: Tile[] = [];
    while (this.waiting.length > 0 && sent.length < EDITS_PER_FRAME) {
      const [x, y] = this.waiting[0];
      if (!this.source.setFloor(x, y, covering)) break;
      sent.push(this.waiting.shift()!);
    }
    this.sent = sent;
    this.staged.push(...sent);
    return sent.length;
  }

  applyCovering(covering: number): void {
    if (!this.active || this.pending !== null || this.blocked) return;
    if (!Number.isInteger(covering) || covering < BARE || covering > this.coverings().length) return;
    this.choose(covering);
    if (this.tile === null) {
      this.status = 'Select a tile first.';
      this.hooks.changed();
      return;
    }
    this.apply();
  }

  clearSelection(): void {
    if (!this.active || this.pending !== null || this.blocked) return;
    this.clear();
  }

  canApplyCovering(covering: number): boolean {
    return Number.isInteger(covering) && covering >= BARE && covering <= this.coverings().length
      && this.active && !this.blocked && this.resourceStatus === null && this.pending === null && this.tile !== null
      && this.targets(covering).length > 0;
  }

  handleKey(key: string): boolean {
    if (!this.active) return false;
    if (key === 'Escape') {
      if (this.tile === null) return false;
      this.clearSelection();
      return true;
    }
    // A digit only: `Number(' ')` is 0, which would make Space choose
    // Remove and swallow the key from every other listener.
    if (/^[0-9]$/.test(key)) {
      const digit = Number(key);
      if (digit <= this.coverings().length) {
        this.applyCovering(digit);
        return true;
      }
    }
    return false;
  }

  /** Call after the frame drains commands, before drawing. */
  afterCommands(): void {
    const revision = this.source.lotRevision();
    const lotChanged = revision !== this.revision;
    this.revision = revision;
    if (this.pending !== null) {
      const result = this.source.lastFloorEditResult();
      const last = this.sent.at(-1) ?? null;
      if (result && last && result.x === last[0] && result.y === last[1]
        && result.covering === this.pending) {
        const done = this.pending;
        // A large area goes one batch per drain; the next one goes now.
        if (this.waiting.length > 0 && this.stageBatch(done) > 0) {
          this.status = `Laying the floor: ${this.staged.length} of ${this.staged.length + this.waiting.length} tiles.`;
          this.hooks.changed();
          return;
        }
        const sent = this.staged;
        this.pending = null;
        this.sent = [];
        this.staged = [];
        this.waiting = [];
        // Whatever the next click lands on starts a new choice.
        this.extendable = false;
        if (!this.active) {
          this.clear();
          return;
        }
        this.refresh();
        this.status = this.isArea ? this.areaOutcome(done, sent)
          : result.reason === 0 ? this.describe() : this.refusal(result.reason);
        this.hooks.changed();
        return;
      }
    }
    if (lotChanged && this.active && this.tile !== null && this.pending === null) {
      this.refresh();
      this.status = this.describe();
      this.hooks.changed();
    }
  }

  /** After Load: nothing chosen, nothing pending, and the loaded lot's size. */
  resetAfterLoad(width: number, height: number): void {
    this.width = width;
    this.height = height;
    this.revision = this.source.lotRevision();
    this.clear();
  }

  /** The chosen tiles: the ones the covering may go on, and the ones that refuse it. */
  highlight(): TileHighlight | null {
    return this.active ? this.shownHighlight : null;
  }

  private clear(): void {
    this.tile = null;
    this.corner = null;
    this.extendable = false;
    this.currents = [];
    this.previews.clear();
    this.sent = [];
    this.staged = [];
    this.waiting = [];
    this.pending = null;
    this.current = BARE;
    this.status = CHOOSE_TILE;
    this.shownHighlight = null;
    this.hooks.changed();
  }

  /** The preview codes for laying `covering` on every chosen tile, 0 where it may go. */
  private codes(covering: number): number[] {
    let codes = this.previews.get(covering);
    if (!codes) {
      codes = this.tiles().map(([x, y]) => this.source.floorEditPreview(x, y, covering));
      this.previews.set(covering, codes);
    }
    return codes;
  }

  /** The chosen tiles `covering` would change and the simulation would accept. */
  private targets(covering: number): Tile[] {
    const codes = this.codes(covering);
    return this.tiles().filter((_, at) => this.currents[at] !== covering && codes[at] === 0);
  }

  private refresh(): void {
    const tile = this.tile;
    if (tile === null) return;
    const floors = this.source.floorTiles();
    const tiles = this.tiles();
    this.currents = tiles.map(([x, y]) => coveringOf(floors, x, y));
    this.previews.clear();
    this.current = coveringOf(floors, tile[0], tile[1]);
    const codes = this.codes(this.chosen);
    if (!this.isArea) {
      this.shownHighlight = { tiles: [tile], valid: codes[0] === 0 };
      return;
    }
    // [FL-area]: tiles that would take the covering in the accepted tint,
    // the ones that refuse it in the refused tint.
    this.shownHighlight = {
      tiles: tiles.filter((_, at) => codes[at] === 0),
      valid: true,
      refused: tiles.filter((_, at) => codes[at] !== 0),
    };
  }

  private describe(): string {
    if (this.isArea) {
      const [first, second] = [this.tile!, this.corner!];
      const columns = Math.abs(first[0] - second[0]) + 1, rows = Math.abs(first[1] - second[1]) + 1;
      return `${columns} by ${rows} tiles selected.`;
    }
    const names = this.coverings();
    return this.current === BARE
      ? 'This floor is as the house came.'
      : `This floor is ${names[this.current - 1] ?? 'unknown'}.`;
  }

  /** What an area's edit did: every tile, or how many and why the rest were refused. */
  private areaOutcome(covering: number, sent: readonly Tile[]): string {
    const floors = this.source.floorTiles();
    const missed = sent.filter(([x, y]) => coveringOf(floors, x, y) !== covering);
    const done = sent.length - missed.length;
    const verb = covering === BARE ? 'restored' : 'laid';
    if (missed.length === 0) return `Floor ${verb} on ${done} ${done === 1 ? 'tile' : 'tiles'}.`;
    const reason = this.refusal(this.source.floorEditPreview(missed[0][0], missed[0][1], covering));
    return `Floor ${verb} on ${done} of ${sent.length} tiles. ${reason}`;
  }

  private refusal(reason: number): string {
    return floorReason(reason);
  }
}
