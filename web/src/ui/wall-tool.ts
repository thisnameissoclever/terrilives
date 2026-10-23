// The Walls tool in Build mode - [WT-shell] in
// docs/specs/2026-09-21-wall-tool.md.
//
// The player chooses one line between two floor tiles and makes it a wall, a
// doorway, a window or nothing. Rust owns every decision: this controller asks for a
// preview of each state, stages the one the player picks, and reads back what
// the drain did with it.

import { WALL_OUT_OF_BOUNDS, type SimBridge, type WallEditPreview } from '../bridge.js';
import { lineMarks, type TileHighlight } from '../render/placement-preview.js';
import type { WindowTool } from './window-tool.js';
import { EDITS_PER_FRAME } from './command-batch.js';
import { logWarning } from '../diagnostics/log.js';

export const OPEN = 0;
export const WALL = 1;
export const DOORWAY = 2;
/** [WN-state] in `docs/specs/2026-09-22-windows.md`. */
export const WINDOW = 3;
export type WallStateCode = typeof OPEN | typeof WALL | typeof DOORWAY | typeof WINDOW;

/** Axis 0 is a vertical line between (x-1, y) and (x, y); 1 is horizontal. */
export interface WallLine {
  readonly axis: 0 | 1;
  readonly x: number;
  readonly y: number;
}

type WallSource = Pick<SimBridge, 'wallEdges' | 'windowLines' | 'wallEditPreview' | 'setWallEdge' |
  'lastWallEditResult' | 'lotRevision'>;

export const CHOOSE_LINE = 'Choose a line between two floor tiles.';
/** How far, in tiles, a second click may land from the chosen line's row and still end a run. */
const RUN_REACH = 0.6;
/** Tiles two clicks must lie apart along one axis to trace a run across the first line's turn. */
const RUN_MIN_TRAVEL = 0.75;
/** The most the clicks may drift across that axis, as a share of their travel along it. */
const RUN_MAX_SLANT = 0.5;
const RUN_DONE: Readonly<Record<WallStateCode, string>> = {
  [OPEN]: 'removed',
  [WALL]: 'built',
  [DOORWAY]: 'made',
  [WINDOW]: 'fitted',
};
const RUN_NOUN: Readonly<Record<WallStateCode, readonly [string, string]>> = {
  [OPEN]: ['wall', 'walls'],
  [WALL]: ['wall', 'walls'],
  [DOORWAY]: ['doorway', 'doorways'],
  [WINDOW]: ['window', 'windows'],
};

export function sameLine(a: WallLine | null, b: WallLine | null): boolean {
  return a !== null && b !== null && a.axis === b.axis && a.x === b.x && a.y === b.y;
}

/** The floor point at the middle of a line. */
function lineMiddle(line: WallLine): [number, number] {
  return line.axis === 0 ? [line.x - 0.5, line.y] : [line.x, line.y - 0.5];
}
const CURRENT: Readonly<Record<WallStateCode, string>> = {
  [OPEN]: 'No wall on this line.',
  [WALL]: 'A wall stands on this line.',
  [DOORWAY]: 'This line is a doorway.',
  [WINDOW]: 'A window stands on this line.',
};
const DONE: Readonly<Record<WallStateCode, string>> = {
  [OPEN]: 'Wall removed.',
  [WALL]: 'Wall built.',
  [DOORWAY]: 'Doorway made.',
  [WINDOW]: 'Window fitted.',
};
const NOT_SENT = 'That change could not be sent.';

/**
 * The boundary nearest a world point, or null when the point is off the lot.
 * Tiles are centred on whole numbers, so the line between tile x-1 and tile x
 * sits at x - 0.5. The nearer of the nearest vertical and the nearest
 * horizontal line wins. A lot's outer lines are offered too, so a click there
 * reads the simulation's own refusal rather than quietly choosing another line.
 * The lot's edge counts as on the lot on all four sides. A point exactly on
 * the far corner ties, and a tie goes vertical, so its row is clamped to the
 * last one; a horizontal line never lands past the last column, because a
 * point on the right edge always ties vertical.
 */
export function nearestLine(wx: number, wy: number, width: number, height: number): WallLine | null {
  if (!Number.isFinite(wx) || !Number.isFinite(wy) || width < 1 || height < 1) return null;
  const tx = wx + 0.5;
  const ty = wy + 0.5;
  if (tx < 0 || ty < 0 || tx > width || ty > height) return null;
  const vertical = Math.abs(tx - Math.round(tx)) <= Math.abs(ty - Math.round(ty));
  return vertical
    ? { axis: 0, x: Math.round(tx), y: Math.min(Math.floor(ty), height - 1) }
    : { axis: 1, x: Math.floor(tx), y: Math.round(ty) };
}

/** The two tiles a line separates. */
export function tilesBeside(line: WallLine): [[number, number], [number, number]] {
  return line.axis === 0
    ? [[line.x - 1, line.y], [line.x, line.y]]
    : [[line.x, line.y - 1], [line.x, line.y]];
}

/**
 * What the line is: `wall_edges` holds four words per wall or doorway record,
 * and `window_lines` three per window ([WN-state]). A line in both is a
 * corrupt save and reads as the wall, which is what the simulation says too.
 */
export function stateOf(
  edges: ArrayLike<number>,
  line: WallLine,
  windows: ArrayLike<number> = [],
): WallStateCode {
  for (let at = 0; at + 3 < edges.length; at += 4) {
    if (edges[at] === line.axis && edges[at + 1] === line.x && edges[at + 2] === line.y) {
      return edges[at + 3] === 1 ? DOORWAY : WALL;
    }
  }
  for (let at = 0; at + 2 < windows.length; at += 3) {
    if (windows[at] === line.axis && windows[at + 1] === line.x && windows[at + 2] === line.y) {
      return WINDOW;
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
  private previews:
    readonly [WallEditPreview, WallEditPreview, WallEditPreview, WallEditPreview] | null = null;
  /** A run's far end, or null for one line ([WT-run]). */
  private end: WallLine | null = null;
  /** Whether the next click may end a run at the chosen line. */
  private extendable = false;
  /** Where the click that chose the line landed, as a floor point, or null when no click chose it. */
  private firstClick: readonly [number, number] | null = null;
  /** Every chosen line's state and previews, in `lines()` order. */
  private runStates: WallStateCode[] = [];
  private runPreviews: (readonly [WallEditPreview, WallEditPreview, WallEditPreview, WallEditPreview])[] = [];
  /** The lines the batch on its way changes, in the order they were staged. */
  private sent: WallLine[] = [];
  /** Every line staged so far for the edit on its way, and the ones still waiting for a batch. */
  private staged: WallLine[] = [];
  private waiting: WallLine[] = [];
  private revision: number;
  /** Rebuilt when the line or what it may become changes, never per frame. */
  private shownHighlight: TileHighlight | null = null;

  constructor(private readonly source: WallSource, private width: number,
    private height: number, private readonly hooks: { changed(): void }, readonly windows?: WindowTool) {
    this.revision = source.lotRevision();
  }

  enter(): void {
    if (this.active) return;
    this.active = true;
    if (this.windows?.pending !== null && this.windows?.pending !== undefined) this.windows.enter();
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
    this.windows?.exit();
    if (this.pending === null) this.clear();
    else this.hooks.changed();
  }

  /** A click or tap at an unrounded world point. */
  choosePoint(wx: number, wy: number): void {
    if (!this.active || this.pending !== null || this.blocked) return;
    const line = nearestLine(wx, wy, this.width, this.height);
    if (line) this.chooseClicked(line, [wx, wy]);
  }

  /**
   * [WT-run]: a click. The first chooses one line; a second in the same row
   * or column, or on the floor beside it, selects every line between the two.
   * Once a run is chosen or an edit lands, the next click starts again.
   * `floor` is the floor point under the pointer, when there is one.
   */
  chooseClicked(line: WallLine, floor: readonly [number, number] | null = null): void {
    if (!this.active || this.pending !== null || this.blocked) return;
    const point = floor ?? lineMiddle(line);
    if (this.line !== null && this.extendable && !this.windows?.active) {
      const run = this.collinear(line, floor) ?? this.alongClicks(point);
      if (run !== null) {
        const [start, end] = run;
        if (!sameLine(end, start)) {
          this.line = start;
          this.end = end;
          this.extendable = false;
          this.refresh();
          this.status = this.describe();
          this.hooks.changed();
        }
        return;
      }
    }
    this.choose(line);
    this.firstClick = point;
  }

  choose(line: WallLine): void {
    if (!this.active || this.pending !== null || this.blocked) return;
    if (this.windows?.active || this.windows?.ownerAt(line)) {
      this.windows.enter();
      this.windows.choose(line);
      return;
    }
    this.line = line;
    this.end = null;
    this.extendable = true;
    this.firstClick = null;
    this.refresh();
    this.status = this.describe();
    this.hooks.changed();
  }

  /** The chosen line and, for a run, every line through to its far end, in order along the axis. */
  lines(): WallLine[] {
    const line = this.line;
    if (line === null) return [];
    const end = this.end;
    if (end === null) return [line];
    const along = line.axis === 0 ? 'y' : 'x';
    const from = Math.min(line[along], end[along]), to = Math.max(line[along], end[along]);
    return Array.from({ length: to - from + 1 }, (_, step) => ({ ...line, [along]: from + step }));
  }

  /** Whether more than one line is chosen. */
  get isRun(): boolean { return this.end !== null; }

  /**
   * The run's end for `line`: the line itself when it lies in the chosen
   * line's row or column, else the line of that row nearest the floor point
   * when the point lies within reach of the row, else null.
   */
  private collinear(line: WallLine, floor: readonly [number, number] | null): [WallLine, WallLine] | null {
    const anchor = this.line!;
    const sameRow = anchor.axis === 0 ? line.x === anchor.x : line.y === anchor.y;
    if (line.axis === anchor.axis && sameRow) return [anchor, line];
    if (floor === null) return null;
    const [wx, wy] = floor;
    const clamp = (value: number, high: number) => Math.min(high, Math.max(0, value));
    if (anchor.axis === 0) {
      return Math.abs(wx - (anchor.x - 0.5)) > RUN_REACH ? null
        : [anchor, { axis: 0, x: anchor.x, y: clamp(Math.round(wy), this.height - 1) }];
    }
    return Math.abs(wy - (anchor.y - 0.5)) > RUN_REACH ? null
      : [anchor, { axis: 1, x: clamp(Math.round(wx), this.width - 1), y: anchor.y }];
  }

  /**
   * The run two clicks trace when the second is not in the first line's row:
   * clicks that move clearly along one world axis choose the row of lines
   * along that axis nearest both, whichever way the first line turned. The
   * first click on the floor near a corner can pick the crossing line; the
   * player meant the row they then moved along.
   */
  private alongClicks(point: readonly [number, number]): [WallLine, WallLine] | null {
    const from = this.firstClick;
    if (from === null) return null;
    const dx = Math.abs(point[0] - from[0]), dy = Math.abs(point[1] - from[1]);
    const long = Math.max(dx, dy), short = Math.min(dx, dy);
    if (long < RUN_MIN_TRAVEL || short > long * RUN_MAX_SLANT) return null;
    const clamp = (value: number, high: number) => Math.min(high, Math.max(0, value));
    if (dx >= dy) {
      const y = clamp(Math.round((from[1] + point[1]) / 2 + 0.5), this.height);
      return [{ axis: 1, x: clamp(Math.round(from[0]), this.width - 1), y },
        { axis: 1, x: clamp(Math.round(point[0]), this.width - 1), y }];
    }
    const x = clamp(Math.round((from[0] + point[0]) / 2 + 0.5), this.width);
    return [{ axis: 0, x, y: clamp(Math.round(from[1]), this.height - 1) },
      { axis: 0, x, y: clamp(Math.round(point[1]), this.height - 1) }];
  }

  setBlocked(blocked: boolean): void {
    this.windows?.setBlocked(blocked);
    if (this.blocked === blocked) return;
    this.blocked = blocked;
    this.hooks.changed();
  }

  /** Whether pressing this state's button would stage an edit. */
  canApply(state: WallStateCode): boolean {
    if (!(this.active && !this.windows?.active && this.windows?.pending == null && !this.blocked
      && this.line !== null && this.pending === null)) return false;
    // A run takes walls, doorways or nothing; windows are fitted one at a time.
    if (this.isRun) return state !== WINDOW && this.targets(state).length > 0;
    return state !== this.current && this.previews?.[state].valid === true;
  }

  /** The chosen lines this state would change and the simulation would accept. */
  private targets(state: WallStateCode): WallLine[] {
    return this.lines().filter((_, at) => this.runStates[at] !== state && this.runPreviews[at]?.[state].valid === true);
  }

  apply(state: WallStateCode): void {
    const line = this.line;
    if (line === null || !this.canApply(state)) return;
    this.waiting = this.isRun ? this.targets(state) : [line];
    this.staged = [];
    if (this.stageBatch(state) > 0) {
      this.pending = state;
    } else {
      this.waiting = [];
      this.status = NOT_SENT;
    }
    this.hooks.changed();
  }

  /** Stages the next batch of waiting lines; how many the queue took. */
  private stageBatch(state: WallStateCode): number {
    const sent: WallLine[] = [];
    while (this.waiting.length > 0 && sent.length < EDITS_PER_FRAME) {
      const target = this.waiting[0];
      if (!this.source.setWallEdge(target.axis, target.x, target.y, state)) break;
      sent.push(this.waiting.shift()!);
    }
    this.sent = sent;
    this.staged.push(...sent);
    return sent.length;
  }

  handleKey(key: string): boolean {
    if (!this.active) return false;
    if (this.windows && (key === 'n' || key === 'N')) { this.selectWindows(); return true; }
    if (this.windows?.active) {
      if (key === 'w' || key === 'W' || key === 'd' || key === 'D') {
        this.selectWalls();
        this.apply(key.toLowerCase() === 'w' ? WALL : DOORWAY);
        return true;
      }
      return this.windows.handleKey(key);
    }
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
      case 'n': case 'N': this.apply(WINDOW); return true;
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
      const last = this.sent.at(-1) ?? null;
      if (result && last && result.axis === last.axis && result.x === last.x && result.y === last.y
        && result.state === this.pending) {
        const done = this.pending;
        // A long run goes one batch per drain; the next one goes now.
        if (this.waiting.length > 0 && this.stageBatch(done) > 0) return;
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
        this.status = this.isRun ? this.runOutcome(done, sent) : result.reason ?? DONE[done];
        if (result.reason) logWarning('Walls', 'Wall edit refused.', { ...result });
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
    return this.windows?.active ? this.windows.highlight() : this.active ? this.shownHighlight : null;
  }

  selectWindows(): void {
    if (!this.windows || !this.active || this.pending !== null || this.blocked) return;
    if (this.windows.active) return;
    this.windows.enter();
    if (this.line && this.windows.pending === null) this.windows.choose(this.line);
    this.hooks.changed();
  }

  selectWalls(): void {
    if (!this.windows?.active || this.windows.pending !== null || this.pending !== null) return;
    this.line = this.windows.selectedLine;
    this.end = null;
    this.extendable = true;
    this.windows.exit();
    if (this.line === null) { this.clear(); return; }
    this.refresh();
    this.status = this.describe();
    this.hooks.changed();
  }

  /**
   * The chosen lines and, line by line, whether a barrier may stand there:
   * what the floor marker draws ([WB-mark]). The Window tool's span while it
   * is choosing.
   */
  selection(): { readonly lines: readonly WallLine[]; readonly valid: readonly boolean[] } | null {
    if (!this.active) return null;
    if (this.windows?.active) return this.windows.selection();
    if (this.line === null) return null;
    return { lines: this.lines(), valid: this.runStates.map((state, at) => barrierMayStand(state, this.runPreviews[at])) };
  }

  /** The world point the contextual controls stand on: the middle of the selection. */
  anchorPoint(): [number, number] | null {
    const lines: readonly WallLine[] = this.windows?.active ? this.windows.span() : this.lines();
    if (lines.length === 0) return null;
    const point = (line: WallLine): [number, number] =>
      [line.x - (line.axis === 0 ? 0.5 : 0), line.y - (line.axis === 1 ? 0.5 : 0)];
    const [a, b] = [point(lines[0]), point(lines[lines.length - 1])];
    return [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
  }

  private clear(): void {
    this.line = null;
    this.end = null;
    this.extendable = false;
    this.firstClick = null;
    this.sent = [];
    this.staged = [];
    this.waiting = [];
    this.runStates = [];
    this.runPreviews = [];
    this.pending = null;
    this.previews = null;
    this.current = OPEN;
    this.status = CHOOSE_LINE;
    this.shownHighlight = null;
    this.hooks.changed();
  }

  clearSelection(): void {
    if (!this.active || this.pending !== null || this.blocked) return;
    this.clear();
  }

  rotate(): void {
    if (!this.line) return;
    this.turn(this.line.axis === 0 ? 1 : 0);
  }

  turn(axis: 0 | 1): void {
    if (!this.active || this.pending !== null || this.blocked) return;
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
    const edges = this.source.wallEdges() ?? [], windows = this.source.windowLines();
    const lines = this.lines();
    this.runStates = lines.map(segment => stateOf(edges, segment, windows));
    this.runPreviews = lines.map(segment => {
      const preview = (state: WallStateCode) => this.source.wallEditPreview(segment.axis, segment.x, segment.y, state);
      return [preview(OPEN), preview(WALL), preview(DOORWAY), preview(WINDOW)] as const;
    });
    const at = lines.findIndex(segment => sameLine(segment, line));
    this.current = this.runStates[at];
    this.previews = this.runPreviews[at];
    const valid = this.runStates.map((state, index) => barrierMayStand(state, this.runPreviews[index]));
    // [WB-mark]: a bar along the chosen lines themselves, not the tiles beside them.
    this.shownHighlight = { tiles: [], valid: valid.every(Boolean), lines: lineMarks(lines, valid) };
  }

  private describe(): string {
    if (this.isRun) {
      const lines = this.runStates.length;
      const refused = this.runPreviews.findIndex((previews, at) => !barrierMayStand(this.runStates[at], previews));
      const reason = refused < 0 ? null : this.runPreviews[refused][WALL].reason;
      return `${lines} lines selected.${reason ? ` ${reason}` : ''}`;
    }
    const wall = this.previews?.[WALL];
    // The outside wall is drawn but is no line the tool owns, so "no wall on
    // this line" would be false there. Say the one true thing instead.
    if (wall?.code === WALL_OUT_OF_BOUNDS && wall.reason) return wall.reason;
    const current = CURRENT[this.current];
    return this.current !== WALL && wall && !wall.valid && wall.reason ? `${current} ${wall.reason}` : current;
  }

  /** What a run's edit did: every line, or how many and why the rest were refused. */
  private runOutcome(state: WallStateCode, sent: readonly WallLine[]): string {
    const edges = this.source.wallEdges() ?? [], windows = this.source.windowLines();
    const missed = sent.filter(line => stateOf(edges, line, windows) !== state);
    const done = sent.length - missed.length;
    const [one, many] = RUN_NOUN[state];
    if (missed.length === 0) return `${done} ${done === 1 ? one : many} ${RUN_DONE[state]}.`;
    const reason = this.source.wallEditPreview(missed[0].axis, missed[0].x, missed[0].y, state).reason;
    return `${done} of ${sent.length} ${many} ${RUN_DONE[state]}.${reason ? ` ${reason}` : ''}`;
  }
}

/** A barrier already standing is proof enough that one may; otherwise the wall preview decides. */
function barrierMayStand(state: WallStateCode,
  previews: readonly [WallEditPreview, WallEditPreview, WallEditPreview, WallEditPreview] | undefined): boolean {
  return state === WALL || state === WINDOW || previews?.[WALL].valid === true;
}
