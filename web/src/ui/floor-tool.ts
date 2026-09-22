// The Floors tool in Build mode - [FL-tool] in
// docs/specs/2026-09-22-floors.md.
//
// The player picks a covering and clicks a tile to lay it. Rust owns every
// decision: this controller asks for a preview, stages the change the player
// asked for, and reads back what the drain did with it.

import type { SimBridge } from '../bridge.js';
import type { TileHighlight } from '../render/placement-preview.js';

/** No covering: the tile is drawn by where it is ([OS-yard]). */
export const BARE = 0;

type FloorSource = Pick<SimBridge, 'coveringNames' | 'floorTiles' | 'floorEditPreview' |
  'setFloor' | 'lastFloorEditResult' | 'lotRevision'>;

export const CHOOSE_TILE = 'Choose a tile.';
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
  tile: [number, number] | null = null;
  /** The covering the next click lays, 0 for the Remove button. */
  chosen = 1;
  /** What the chosen tile carries now. */
  current = BARE;
  status = CHOOSE_TILE;
  pending: number | null = null;
  /** Another pause holds, such as a Load in progress: nothing may be staged. */
  blocked = false;
  private revision: number;
  private shownHighlight: TileHighlight | null = null;

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

  /** Picks which covering a click lays. */
  choose(covering: number): void {
    if (!this.active || this.pending !== null) return;
    if (covering !== BARE && (covering < 1 || covering > this.coverings().length)) return;
    this.chosen = covering;
    if (this.tile) this.refresh();
    this.hooks.changed();
  }

  /** A click or tap at an unrounded world point lays the chosen covering. */
  choosePoint(wx: number, wy: number): void {
    if (!this.active || this.pending !== null || this.blocked) return;
    const tile = tileAt(wx, wy, this.width, this.height);
    if (!tile) return;
    this.tile = tile;
    this.refresh();
    this.apply();
  }

  setBlocked(blocked: boolean): void {
    if (this.blocked === blocked) return;
    this.blocked = blocked;
    this.hooks.changed();
  }

  /** Whether laying the chosen covering on the chosen tile would do anything. */
  canApply(): boolean {
    return this.active && !this.blocked && this.tile !== null && this.pending === null
      && this.chosen !== this.current
      && this.source.floorEditPreview(this.tile[0], this.tile[1], this.chosen) === 0;
  }

  apply(): void {
    const tile = this.tile;
    if (tile === null || !this.canApply()) {
      if (tile !== null && this.chosen === this.current) this.status = this.describe();
      this.hooks.changed();
      return;
    }
    if (this.source.setFloor(tile[0], tile[1], this.chosen)) {
      this.pending = this.chosen;
    } else {
      this.status = NOT_SENT;
    }
    this.hooks.changed();
  }

  handleKey(key: string): boolean {
    if (!this.active) return false;
    if (key === 'Escape') {
      if (this.tile === null) return false;
      if (this.pending === null) this.clear();
      return true;
    }
    const digit = Number(key);
    if (Number.isInteger(digit) && digit >= 0 && digit <= this.coverings().length) {
      this.choose(digit);
      return true;
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
      const tile = this.tile;
      if (result && tile && result.x === tile[0] && result.y === tile[1]
        && result.covering === this.pending) {
        this.pending = null;
        if (!this.active) {
          this.clear();
          return;
        }
        this.refresh();
        this.status = result.reason === 0 ? this.describe() : this.refusal(result.reason);
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

  /** The chosen tile, tinted for whether the covering may go there. */
  highlight(): TileHighlight | null {
    return this.active ? this.shownHighlight : null;
  }

  private clear(): void {
    this.tile = null;
    this.pending = null;
    this.current = BARE;
    this.status = CHOOSE_TILE;
    this.shownHighlight = null;
    this.hooks.changed();
  }

  private refresh(): void {
    const tile = this.tile;
    if (tile === null) return;
    this.current = coveringOf(this.source.floorTiles(), tile[0], tile[1]);
    this.shownHighlight = {
      tiles: [tile],
      valid: this.source.floorEditPreview(tile[0], tile[1], this.chosen) === 0,
    };
  }

  private describe(): string {
    const names = this.coverings();
    return this.current === BARE
      ? 'This floor is as the house came.'
      : `This floor is ${names[this.current - 1] ?? 'unknown'}.`;
  }

  private refusal(reason: number): string {
    // The two the simulation can give here: a tile off the lot, and a
    // covering the content does not have. Neither is reachable by clicking
    // the lot with a button the tool drew, so the wording is plain.
    return reason === 5 ? 'That tile is not on the lot.' : 'That floor is not one of these.';
  }
}
