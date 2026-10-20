import { windowReason, type SimBridge } from '../bridge.js';
import { coveredWindowLines, decodeWindowPlacements, windowAt, type WindowDefinition,
  type WindowEditPreview, type WindowModelId, type WindowPlacement } from '../architecture/windows.js';
import { lineMarks, type TileHighlight } from '../render/placement-preview.js';
import { nearestLine, type WallLine } from './wall-tool.js';
import { logWarning } from '../diagnostics/log.js';

type WindowSource = Pick<SimBridge, 'windowCatalogue' | 'windowPlacements' | 'windowEditPreview'
  | 'windowRemovalPreview' | 'fitWindow' | 'removeWindow' | 'lastWindowEditResult' | 'lotRevision'>;
const CHOOSE = 'Choose a wall line for the window.';

/** Owns one complete window edit, including its result after leaving the tool. */
export class WindowTool {
  active = false;
  blocked = false;
  line: WallLine | null = null;
  /** The clicked or navigated unit, retained for ordinary wall/doorway edits. */
  selectedLine: WallLine | null = null;
  owner: WindowPlacement | null = null;
  chosen: WindowModelId;
  pending: 'fit' | 'remove' | null = null;
  status = CHOOSE;
  readonly catalogue: readonly WindowDefinition[];
  private candidate: WindowEditPreview | null = null;
  private removal: WindowEditPreview | null = null;
  private revision: number;
  private shownHighlight: TileHighlight | null = null;

  constructor(private readonly source: WindowSource, private width: number, private height: number,
    private readonly hooks: { changed(): void }) {
    this.catalogue = source.windowCatalogue();
    if (!this.catalogue.length) throw new Error('The window catalogue is empty.');
    this.chosen = this.catalogue[0].id;
    this.revision = source.lotRevision();
  }

  enter(): void { this.active = true; this.hooks.changed(); }
  exit(): void {
    this.active = false;
    if (this.pending === null) this.clear();
    else this.hooks.changed();
  }
  ownerAt(line: WallLine): WindowPlacement | null {
    return windowAt(decodeWindowPlacements(this.source.windowPlacements()), line, this.catalogue);
  }
  choosePoint(x: number, y: number): void {
    const line = nearestLine(x, y, this.width, this.height);
    if (line) this.choose(line);
  }
  choose(line: WallLine): void {
    if (!this.active || this.pending !== null || this.blocked) return;
    this.selectedLine = line;
    this.owner = this.ownerAt(line);
    this.line = this.owner ? { axis: this.owner.axis, x: this.owner.x, y: this.owner.y } : this.fittedStart(line);
    this.refresh();
    this.hooks.changed();
  }
  chooseModel(model: WindowModelId): void {
    if (!this.active || this.blocked || this.pending !== null || !this.catalogue.some(item => item.id === model)) return;
    this.chosen = model;
    if (!this.owner && this.selectedLine) this.line = this.fittedStart(this.selectedLine);
    this.refresh();
    this.hooks.changed();
  }
  /**
   * [WN-fit]: where a new window of the chosen width starts so that it covers
   * the clicked unit. Centred on it first, then slid along the wall one unit
   * at a time, nearest first, until the simulation accepts the span. With no
   * accepted start, the centred one stands so its refusal can be read.
   */
  private fittedStart(clicked: WallLine): WallLine {
    const width = this.catalogue.find(item => item.id === this.chosen)?.width ?? 1;
    if (width <= 1) return clicked;
    const centre = Math.floor((width - 1) / 2);
    const offsets = Array.from({ length: width }, (_, offset) => offset)
      .sort((a, b) => Math.abs(a - centre) - Math.abs(b - centre) || a - b);
    const starts = offsets.map(offset => clicked.axis === 0
      ? { axis: 0 as const, x: clicked.x, y: clicked.y - offset }
      : { axis: 1 as const, x: clicked.x - offset, y: clicked.y })
      .filter(start => start.x >= 0 && start.y >= 0);
    for (const start of starts) {
      if (this.source.windowEditPreview(start.axis, start.x, start.y, this.chosen).valid) return start;
    }
    return starts[0] ?? clicked;
  }
  setBlocked(blocked: boolean): void {
    if (this.blocked === blocked) return;
    this.blocked = blocked;
    this.hooks.changed();
  }
  canApply(): boolean {
    return this.active && !this.blocked && this.pending === null && this.candidate?.valid === true
      && this.owner?.model !== this.chosen;
  }
  canRemove(): boolean {
    return this.active && !this.blocked && this.pending === null && this.owner !== null && this.removal?.valid === true;
  }
  apply(): void { if (this.canApply()) this.stage('fit'); }
  remove(): void { if (this.canRemove()) this.stage('remove'); }
  private stage(action: 'fit' | 'remove'): void {
    const line = this.line!;
    const accepted = action === 'fit'
      ? this.source.fitWindow(line.axis, line.x, line.y, this.chosen)
      : this.source.removeWindow(line.axis, line.x, line.y);
    if (accepted) { this.pending = action; this.status = 'Applying window change.'; }
    else this.status = 'That change could not be sent.';
    this.hooks.changed();
  }
  handleKey(key: string): boolean {
    if (!this.active) return false;
    if (key === 'Escape') {
      if (!this.line) return false;
      if (this.pending === null) this.clear();
      return true;
    }
    if (key === 'Enter') { this.apply(); return true; }
    if (key === 'Backspace' || key === 'Delete') { this.remove(); return true; }
    const step = ({ ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] } as
      Record<string, [number, number] | undefined>)[key];
    const axis = key.toLowerCase() === 'v' ? 0 : key.toLowerCase() === 'h' ? 1 : null;
    if (!step && axis === null) return false;
    // A new window steps the unit it was chosen for, since its start slides to fit ([WN-fit]).
    const from = (this.owner ? this.line : this.selectedLine ?? this.line)
      ?? { axis: 0 as const, x: Math.floor(this.width / 2), y: Math.floor(this.height / 2) };
    // Step from the far end when moving along a selected span, so arrow navigation cannot get stuck in its owner.
    const span = this.owner ? coveredWindowLines(this.owner, this.catalogue) : [];
    const end = step && ((from.axis === 0 && step[1] > 0) || (from.axis === 1 && step[0] > 0))
      ? span.at(-1) ?? from : from;
    const nextAxis = axis ?? from.axis;
    const x = end.x + (this.line ? step?.[0] ?? 0 : 0), y = end.y + (this.line ? step?.[1] ?? 0 : 0);
    this.choose({ axis: nextAxis, x: Math.max(0, Math.min(this.width - (nextAxis === 1 ? 1 : 0), x)),
      y: Math.max(0, Math.min(this.height - (nextAxis === 0 ? 1 : 0), y)) });
    return true;
  }
  afterCommands(): void {
    const revision = this.source.lotRevision(), changed = revision !== this.revision;
    this.revision = revision;
    if (this.pending !== null) {
      const result = this.source.lastWindowEditResult();
      if (result === null) return;
      const action = this.pending;
      this.pending = null;
      if (!this.active) { this.clear(); return; }
      this.refresh();
      this.status = windowReason(result.reason) ?? (action === 'fit' ? 'Window fitted.' : 'Window removed.');
      if (result.reason !== 0) logWarning('Windows', 'Window edit refused.', { action, code: result.reason, reason: this.status, line: this.line });
      this.hooks.changed();
    } else if (changed && this.active && this.line) { this.refresh(); this.hooks.changed(); }
  }
  resetAfterLoad(width: number, height: number): void {
    this.width = width; this.height = height; this.revision = this.source.lotRevision(); this.clear();
  }
  preview(): WindowEditPreview | null {
    return this.active && this.candidate?.valid && this.owner?.model !== this.chosen ? this.candidate : null;
  }
  highlight(): TileHighlight | null { return this.active ? this.shownHighlight : null; }
  /** The lines the shown window covers: the selected one, or the one the chosen model would fit. */
  span(): readonly WallLine[] {
    if (!this.active || !this.line) return [];
    return this.owner && this.owner.model === this.chosen
      ? coveredWindowLines(this.owner, this.catalogue)
      : coveredWindowLines({ ...this.line, model: this.chosen }, this.catalogue);
  }
  /** The span and whether it may hold the window, for the floor marker ([WB-mark]). */
  selection(): { readonly lines: readonly WallLine[]; readonly valid: readonly boolean[] } | null {
    const lines = this.span();
    if (lines.length === 0) return null;
    const valid = this.candidate?.valid === true || (this.owner !== null && this.owner.model === this.chosen);
    return { lines, valid: lines.map(() => valid) };
  }
  private clear(): void {
    this.line = null; this.selectedLine = null; this.owner = null; this.pending = null; this.candidate = null;
    this.removal = null; this.shownHighlight = null; this.status = CHOOSE; this.hooks.changed();
  }
  private refresh(): void {
    if (!this.line) return;
    this.owner = this.ownerAt(this.line);
    if (this.owner && !coveredWindowLines(this.owner, this.catalogue).some(line =>
      line.axis === this.selectedLine?.axis && line.x === this.selectedLine.x && line.y === this.selectedLine.y)) {
      this.selectedLine = this.line;
    }
    const { axis, x, y } = this.line;
    this.candidate = this.source.windowEditPreview(axis, x, y, this.chosen);
    this.removal = this.owner ? this.source.windowRemovalPreview(axis, x, y) : null;
    // Refused plans intentionally have no affectedLines. Show the attempted span in red, without inventing a valid plan.
    const lines = this.candidate.valid ? this.candidate.affectedLines
      : [...coveredWindowLines({ ...this.line, model: this.chosen }, this.catalogue),
        ...(this.owner ? coveredWindowLines(this.owner, this.catalogue) : [])];
    const unique = new Map<string, WallLine>();
    for (const line of lines) unique.set(`${line.axis}/${line.x}/${line.y}`, line);
    const ordered = [...unique.values()].sort((a, b) => a.axis - b.axis || a.x - b.x || a.y - b.y);
    // [WB-mark]: one bar along the span itself, not the tiles beside it.
    this.shownHighlight = { tiles: [], valid: this.candidate.valid,
      lines: lineMarks(ordered, ordered.map(() => this.candidate!.valid)) };
    const chosen = this.catalogue.find(item => item.id === this.chosen)!;
    this.status = windowReason(this.candidate.reason) ?? (this.owner
      ? `Selected window: ${this.catalogue.find(item => item.id === this.owner!.model)!.label}.`
      : `${chosen.label}: ${chosen.width}-unit window.`);
  }
}
