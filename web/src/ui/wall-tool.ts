// The Walls tool in Build mode - [WT-shell] in
// docs/specs/2026-09-21-wall-tool.md.
//
// The player chooses one line between two floor tiles and makes it a wall, a
// doorway or nothing. Rust owns every decision: this controller asks for a
// preview of each state, stages the one the player picks, and reads back what
// the drain did with it.

import { WALL_OUT_OF_BOUNDS, type SimBridge, type WallEditPreview } from '../bridge.js';
import type { TileHighlight } from '../render/placement-preview.js';

export const OPEN = 0;
export const WALL = 1;
export const DOORWAY = 2;
export type WallStateCode = typeof OPEN | typeof WALL | typeof DOORWAY;

/** Axis 0 is a vertical line between (x-1, y) and (x, y); 1 is horizontal. */
export interface WallLine {
  readonly axis: 0 | 1;
  readonly x: number;
  readonly y: number;
}

type WallSource = Pick<SimBridge, 'wallEdges' | 'wallEditPreview' | 'setWallEdge' |
  'lastWallEditResult' | 'lotRevision'>;

export const CHOOSE_LINE = 'Choose a line between two floor tiles.';
const CURRENT: Readonly<Record<WallStateCode, string>> = {
  [OPEN]: 'No wall on this line.',
  [WALL]: 'A wall stands on this line.',
  [DOORWAY]: 'This line is a doorway.',
};
const DONE: Readonly<Record<WallStateCode, string>> = {
  [OPEN]: 'Wall removed.',
  [WALL]: 'Wall built.',
  [DOORWAY]: 'Doorway made.',
};
const NOT_SENT = 'That change could not be sent.';

/**
 * The boundary nearest a world point, or null when the point is off the lot.
 * Tiles are centred on whole numbers, so the line between tile x-1 and tile x
 * sits at x - 0.5. The nearer of the nearest vertical and the nearest
 * horizontal line wins. A lot's outer lines are offered too, so a click there
 * reads the simulation's own refusal rather than quietly choosing another line.
 */
export function nearestLine(wx: number, wy: number, width: number, height: number): WallLine | null {
  if (!Number.isFinite(wx) || !Number.isFinite(wy) || width < 1 || height < 1) return null;
  const tx = wx + 0.5;
  const ty = wy + 0.5;
  if (tx < 0 || ty < 0 || tx >= width || ty >= height) return null;
  const vertical = Math.abs(tx - Math.round(tx)) <= Math.abs(ty - Math.round(ty));
  return vertical
    ? { axis: 0, x: Math.round(tx), y: Math.floor(ty) }
    : { axis: 1, x: Math.floor(tx), y: Math.round(ty) };
}

/** The two tiles a line separates. */
export function tilesBeside(line: WallLine): [[number, number], [number, number]] {
  return line.axis === 0
    ? [[line.x - 1, line.y], [line.x, line.y]]
    : [[line.x, line.y - 1], [line.x, line.y]];
}

/** What `wall_edges` says the line is: four words per record. */
export function stateOf(edges: ArrayLike<number>, line: WallLine): WallStateCode {
  for (let at = 0; at + 3 < edges.length; at += 4) {
    if (edges[at] === line.axis && edges[at + 1] === line.x && edges[at + 2] === line.y) {
      return edges[at + 3] === 1 ? DOORWAY : WALL;
    }
  }
  return OPEN;
}

export class WallTool {
  active = false;
  line: WallLine | null = null;
  current: WallStateCode = OPEN;
  status = CHOOSE_LINE;
  pending: WallStateCode | null = null;
  /** Another pause holds, such as a Load in progress: nothing may be staged. */
  blocked = false;
  private previews: readonly [WallEditPreview, WallEditPreview, WallEditPreview] | null = null;
  private revision: number;
  /** Rebuilt when the line or what it may become changes, never per frame. */
  private shownHighlight: TileHighlight | null = null;

  constructor(private readonly source: WallSource, private width: number,
    private height: number, private readonly hooks: { changed(): void }) {
    this.revision = source.lotRevision();
  }

  enter(): void {
    if (this.active) return;
    this.active = true;
    // Back before an edit left on its way has landed: the line and its status
    // still describe it, and the next drain reports the result.
    if (this.pending === null) this.status = CHOOSE_LINE;
    this.hooks.changed();
  }

  /**
   * Leaves the tool. An edit already on its way is applied whatever happens
   * here, so it is kept until its result arrives and only then forgotten;
   * clearing it now would leave its result for nobody.
   */
  exit(): void {
    if (!this.active) return;
    this.active = false;
    if (this.pending === null) this.clear();
    else this.hooks.changed();
  }

  /** A click or tap at an unrounded world point. */
  choosePoint(wx: number, wy: number): void {
    if (!this.active || this.pending !== null) return;
    const line = nearestLine(wx, wy, this.width, this.height);
    if (line) this.choose(line);
  }

  choose(line: WallLine): void {
    if (!this.active || this.pending !== null) return;
    this.line = line;
    this.refresh();
    this.status = this.describe();
    this.hooks.changed();
  }

  setBlocked(blocked: boolean): void {
    if (this.blocked === blocked) return;
    this.blocked = blocked;
    this.hooks.changed();
  }

  /** Whether pressing this state's button would stage an edit. */
  canApply(state: WallStateCode): boolean {
    return this.active && !this.blocked && this.line !== null && this.pending === null
      && state !== this.current && this.previews?.[state].valid === true;
  }

  apply(state: WallStateCode): void {
    const line = this.line;
    if (line === null || !this.canApply(state)) return;
    if (this.source.setWallEdge(line.axis, line.x, line.y, state)) {
      this.pending = state;
    } else {
      this.status = NOT_SENT;
    }
    this.hooks.changed();
  }

  handleKey(key: string): boolean {
    if (!this.active) return false;
    if (key === 'Escape') {
      if (this.line === null) return false;
      // An edit on its way is applied whatever happens here; clearing now
      // would lose its result, so Escape waits the one frame it takes.
      if (this.pending === null) this.clear();
      return true;
    }
    const step = ({ ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] } as
      Record<string, [number, number] | undefined>)[key];
    if (step) {
      const from = this.line ?? { axis: 0 as const, x: Math.floor(this.width / 2), y: Math.floor(this.height / 2) };
      this.choose(this.clamped({ ...from, x: from.x + (this.line ? step[0] : 0), y: from.y + (this.line ? step[1] : 0) }));
      return true;
    }
    switch (key) {
      case 'v': case 'V': this.turn(0); return true;
      case 'h': case 'H': this.turn(1); return true;
      case 'w': case 'W': this.apply(WALL); return true;
      case 'd': case 'D': this.apply(DOORWAY); return true;
      case 'Backspace': case 'Delete': this.apply(OPEN); return true;
      default: return false;
    }
  }

  /** Call after the frame drains commands, before drawing. */
  afterCommands(): void {
    const revision = this.source.lotRevision();
    const lotChanged = revision !== this.revision;
    this.revision = revision;
    if (this.pending !== null) {
      const result = this.source.lastWallEditResult();
      const line = this.line;
      if (result && line && result.axis === line.axis && result.x === line.x && result.y === line.y
        && result.state === this.pending) {
        const done = this.pending;
        this.pending = null;
        if (!this.active) {
          this.clear();
          return;
        }
        this.refresh();
        this.status = result.reason ?? DONE[done];
        this.hooks.changed();
        return;
      }
    }
    if (lotChanged && this.active && this.line !== null && this.pending === null) {
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

  /** The lot tiles beside the chosen line, tinted for whether a wall may go there. */
  highlight(): TileHighlight | null {
    return this.active ? this.shownHighlight : null;
  }

  private clear(): void {
    this.line = null;
    this.pending = null;
    this.previews = null;
    this.current = OPEN;
    this.status = CHOOSE_LINE;
    this.shownHighlight = null;
    this.hooks.changed();
  }

  private turn(axis: 0 | 1): void {
    const from = this.line ?? { axis, x: Math.floor(this.width / 2), y: Math.floor(this.height / 2) };
    this.choose(this.clamped({ ...from, axis }));
  }

  /** Keeps a line on the lot, its outer lines included, as a click can choose. */
  private clamped(line: WallLine): WallLine {
    const clamp = (value: number, low: number, high: number) => Math.min(high, Math.max(low, value));
    return line.axis === 0
      ? { axis: 0, x: clamp(line.x, 0, this.width), y: clamp(line.y, 0, this.height - 1) }
      : { axis: 1, x: clamp(line.x, 0, this.width - 1), y: clamp(line.y, 0, this.height) };
  }

  private refresh(): void {
    const line = this.line;
    if (line === null) return;
    // A legacy house has no edge list; every preview then refuses it.
    this.current = stateOf(this.source.wallEdges() ?? [], line);
    const preview = (state: WallStateCode) => this.source.wallEditPreview(line.axis, line.x, line.y, state);
    this.previews = [preview(OPEN), preview(WALL), preview(DOORWAY)];
    this.shownHighlight = {
      tiles: tilesBeside(line).filter(([x, y]) => x >= 0 && y >= 0 && x < this.width && y < this.height),
      valid: this.current === WALL || this.previews[WALL].valid,
    };
  }

  private describe(): string {
    const wall = this.previews?.[WALL];
    // The outside wall is drawn but is no line the tool owns, so "no wall on
    // this line" would be false there. Say the one true thing instead.
    if (wall?.code === WALL_OUT_OF_BOUNDS && wall.reason) return wall.reason;
    const current = CURRENT[this.current];
    return this.current !== WALL && wall && !wall.valid && wall.reason ? `${current} ${wall.reason}` : current;
  }
}
