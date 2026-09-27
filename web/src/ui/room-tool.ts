// The Room tool in Build mode - [RT-shell] in docs/specs/2026-09-22-room-tool.md.
//
// The player chooses two opposite corner tiles and, if they like, one line of
// the outline as the doorway, and builds the whole room in one edit. Rust owns
// every decision: this controller asks for a preview, stages the room the
// player confirms, and reads back what the drain did with it.

import { DOORWAY_MENDS, type EdgeLine, type RoomPreview, type SimBridge } from '../bridge.js';
import type { TileHighlight } from '../render/placement-preview.js';
import { nearestLine } from './wall-tool.js';

type RoomSource = Pick<SimBridge, 'roomEditPreview' | 'buildRoom' | 'lastRoomResult' | 'lotRevision'>;

export const CHOOSE_CORNER = 'Choose a corner tile of the room.';
const CHOOSE_OPPOSITE = 'Choose the opposite corner.';
const READY = 'Ready to build. Choose a line of the outline for a doorway.';
const READY_WITH_DOORWAY = 'Ready to build, with a doorway.';
const ALREADY_BUILT = 'This room is already built.';
const BUILDING = 'Building the room…';
const BUILT = 'Room built.';
const NOT_SENT = 'The room could not be sent.';
const EDIT_KEYS = new Set(['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown',
  'd', 'D', 'Enter', 'Escape']);

type Tile = readonly [number, number];

/**
 * The interior lines on the edge of the rectangle of tiles between two corners,
 * in the order the simulation writes them: the top side, then the bottom side,
 * left to right; then the left side, then the right side, top to bottom. Lines
 * on the lot's own edge are the outside wall and are left out. Mirrors
 * `rooms::outline` in Rust, which decides; this only draws and chooses.
 */
export function roomOutline(width: number, height: number, a: Tile, b: Tile): EdgeLine[] {
  const [left, right] = [Math.min(a[0], b[0]), Math.max(a[0], b[0])];
  const [top, bottom] = [Math.min(a[1], b[1]), Math.max(a[1], b[1])];
  const lines: EdgeLine[] = [];
  for (const y of [top, bottom + 1]) {
    for (let x = left; x <= right; x += 1) lines.push({ axis: 1, x, y });
  }
  for (const x of [left, right + 1]) {
    for (let y = top; y <= bottom; y += 1) lines.push({ axis: 0, x, y });
  }
  return lines.filter(line => line.axis === 0
    ? line.x > 0 && line.x < width && line.y < height
    : line.y > 0 && line.y < height && line.x < width);
}

function sameLine(a: EdgeLine | null, b: EdgeLine | null): boolean {
  return a !== null && b !== null && a.axis === b.axis && a.x === b.x && a.y === b.y;
}

interface Sent { readonly corners: readonly number[]; readonly doorway: EdgeLine | null }

export class RoomTool {
  active = false;
  first: Tile | null = null;
  second: Tile | null = null;
  doorway: EdgeLine | null = null;
  status = CHOOSE_CORNER;
  /** Another pause holds, such as a Load in progress: nothing may be staged. */
  blocked = false;
  private preview: RoomPreview | null = null;
  private sent: Sent | null = null;
  private revision: number;
  /** Rebuilt when the room or its doorway changes, never per frame. */
  private shownHighlight: TileHighlight | null = null;

  constructor(private readonly source: RoomSource, private width: number,
    private height: number, private readonly hooks: { changed(): void }) {
    this.revision = source.lotRevision();
  }

  get pending(): boolean { return this.sent !== null; }

  get canBuild(): boolean {
    return this.active && !this.blocked && !this.pending && this.second !== null
      && this.preview?.valid === true && this.preview.changes;
  }

  enter(): void {
    if (this.active) return;
    this.active = true;
    if (!this.pending) this.status = this.describe();
    this.hooks.changed();
  }

  /** Leaves the tool; a room on its way is kept until its result arrives. */
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

  /**
   * A click or tap at an unrounded world point: the first corner, then the
   * opposite one; once both are chosen, a click on a line of the outline
   * toggles the doorway there and a click anywhere else starts a new room.
   */
  choosePoint(wx: number, wy: number): void {
    if (!this.active || this.pending || this.blocked) return;
    const tile: Tile = [Math.round(wx), Math.round(wy)];
    if (tile[0] < 0 || tile[1] < 0 || tile[0] >= this.width || tile[1] >= this.height) return;
    if (this.first !== null && this.second !== null) {
      const line = nearestLine(wx, wy, this.width, this.height);
      if (line && this.outline().some(edge => sameLine(edge, line))) {
        this.doorway = sameLine(this.doorway, line) ? null : line;
        this.refresh();
        return;
      }
    }
    if (this.first === null || this.second !== null) {
      this.first = tile;
      this.second = null;
      this.doorway = null;
    } else {
      this.second = tile;
    }
    this.refresh();
  }

  /** Steps the doorway along the outline: none, each line in turn, then none. */
  cycleDoorway(): void {
    if (!this.active || this.pending || this.blocked || this.second === null) return;
    const lines = this.outline();
    const at = lines.findIndex(line => sameLine(line, this.doorway));
    this.doorway = at + 1 < lines.length ? lines[at + 1] : null;
    this.refresh();
  }

  build(): void {
    const first = this.first;
    const second = this.second;
    if (!this.canBuild || first === null || second === null) return;
    const sent = { corners: [first[0], first[1], second[0], second[1]], doorway: this.doorway };
    if (this.source.buildRoom(sent.corners, sent.doorway)) {
      this.sent = sent;
      this.status = BUILDING;
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
      if (this.first === null) return false;
      // A room on its way is built whatever happens here; clearing now would
      // lose its result, so Escape waits the one frame it takes.
      this.cancel();
      return true;
    }
    if (this.pending || this.blocked) return true;
    const step = ({ ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] } as
      Record<string, [number, number] | undefined>)[key];
    if (step) {
      this.nudge(step[0], step[1]);
      return true;
    }
    if (key !== 'Enter') this.cycleDoorway();
    else if (this.first !== null && this.second === null) {
      // Enter fixes the first corner; the arrows then move the opposite one.
      this.second = this.first;
      this.refresh();
    } else this.build();
    return true;
  }

  /** Call after the frame drains commands, before drawing. */
  afterCommands(): void {
    const revision = this.source.lotRevision();
    const lotChanged = revision !== this.revision;
    this.revision = revision;
    const sent = this.sent;
    if (sent !== null) {
      const result = this.source.lastRoomResult();
      if (result && result.corners.every((value, index) => value === sent.corners[index])
        && (result.doorway === null ? sent.doorway === null : sameLine(result.doorway, sent.doorway))) {
        this.sent = null;
        if (!this.active) {
          this.clear();
          return;
        }
        // A built room is done with: its choice clears, so Build room cannot
        // stage the same room again. A refused one stays, to be changed.
        if (result.reason === null) this.clear();
        else this.refresh();
        this.status = result.reason === null ? BUILT : this.refusal(result.reason, result.code);
        this.hooks.changed();
        return;
      }
    }
    if (lotChanged && this.active && this.second !== null && !this.pending) this.refresh();
  }

  /** After Load: nothing chosen, nothing pending, and the loaded lot's size. */
  resetAfterLoad(width: number, height: number): void {
    this.width = width;
    this.height = height;
    this.revision = this.source.lotRevision();
    this.clear();
  }

  /**
   * The room's tiles tinted for whether it can be built, and, when a doorway is
   * chosen, the tile outside it too, so the doorway shows as a step out.
   */
  highlight(): TileHighlight | null {
    return this.active ? this.shownHighlight : null;
  }

  /**
   * The keyboard's corner in hand: the first arrow puts a first corner mid-lot,
   * later arrows move it until Enter fixes it, then move the opposite corner.
   */
  private nudge(dx: number, dy: number): void {
    const clamp = (value: number, high: number) => Math.min(high - 1, Math.max(0, value));
    const moving = this.second ?? this.first;
    if (moving === null) {
      this.first = [Math.floor(this.width / 2), Math.floor(this.height / 2)];
    } else {
      const moved: Tile = [clamp(moving[0] + dx, this.width), clamp(moving[1] + dy, this.height)];
      if (this.second === null) this.first = moved;
      else this.second = moved;
    }
    this.doorway = null;
    this.refresh();
  }

  private outline(): EdgeLine[] {
    return this.first !== null && this.second !== null
      ? roomOutline(this.width, this.height, this.first, this.second) : [];
  }

  private refresh(): void {
    const first = this.first;
    const second = this.second;
    if (first === null) {
      this.preview = null;
      this.shownHighlight = null;
    } else if (second === null) {
      this.preview = null;
      this.shownHighlight = { tiles: [first], valid: true };
    } else {
      this.preview = this.source.roomEditPreview([first[0], first[1], second[0], second[1]], this.doorway);
      const tiles: [number, number][] = [];
      for (let y = Math.min(first[1], second[1]); y <= Math.max(first[1], second[1]); y += 1) {
        for (let x = Math.min(first[0], second[0]); x <= Math.max(first[0], second[0]); x += 1) {
          tiles.push([x, y]);
        }
      }
      const door = this.doorway;
      if (door !== null) {
        const beside: [number, number][] = door.axis === 0
          ? [[door.x - 1, door.y], [door.x, door.y]] : [[door.x, door.y - 1], [door.x, door.y]];
        for (const tile of beside) {
          if (!tiles.some(([x, y]) => x === tile[0] && y === tile[1])) tiles.push(tile);
        }
      }
      this.shownHighlight = { tiles, valid: this.preview.valid };
    }
    this.status = this.describe();
    this.hooks.changed();
  }

  /**
   * A refusal for the status line, whether the preview or the drain gave it.
   * Something cut off by the outline is what a doorway can mend, so say how.
   */
  private refusal(reason: string, code: number): string {
    if (!DOORWAY_MENDS.has(code)) return reason;
    return `${reason} ${this.doorway === null ? 'Choose a doorway.' : 'Try the doorway on another line.'}`;
  }

  private describe(): string {
    if (this.first === null) return CHOOSE_CORNER;
    if (this.second === null) return CHOOSE_OPPOSITE;
    const preview = this.preview;
    if (preview && !preview.valid) {
      return this.refusal(preview.reason ?? 'That room is not possible.', preview.code);
    }
    if (preview && !preview.changes) return ALREADY_BUILT;
    return this.doorway === null ? READY : READY_WITH_DOORWAY;
  }

  private clear(): void {
    this.sent = null;
    this.first = null;
    this.second = null;
    this.doorway = null;
    this.preview = null;
    this.shownHighlight = null;
    this.status = CHOOSE_CORNER;
    this.hooks.changed();
  }
}
