/**
 * The need bars: one labelled bar per need for whichever sim the
 * SIMULATION says is selected.
 *
 * **This panel renders simulation state and owns none of it** ([D-5]).
 * The only state it holds is a throttle timestamp, and that is not a
 * projection of anything in the world - it is a fact about when the DOM
 * was last written. Everything else is re-read: the selection, the seven
 * levels, and the labels' order.
 *
 * That is a rule about rot rather than about tidiness. The standard way a
 * project like this paints itself into a corner is that the shell caches
 * "the selected sim's hunger" for convenience, something else starts
 * reading the cache, and eventually the simulation cannot be replayed
 * without the shell running. Selection lives in the simulation for the
 * same reason: a replay has to reproduce it.
 *
 * The DOM types are named structurally rather than imported, so the logic
 * below is testable in Node without a DOM. Real `HTMLElement`s satisfy
 * them; the interfaces also state exactly how much of an element this
 * panel is allowed to touch, which is one property each.
 */

/** What the panel reads. `SimBridge` satisfies it structurally. */
export interface NeedsSource {
  /** The selected sim's raw entity index, or null when none is. */
  selectedIndex(): number | null;
  /**
   * Seven levels in `NeedId` index order, or an EMPTY array when the
   * index names nothing live or names something with no needs.
   */
  needsOf(entityIndex: number): Float32Array;
  /**
   * The selected sim's display name, or the empty string for anything
   * that has none. Whose bars these are stopped being obvious the moment
   * the household grew past one sim, and the caption is what makes a
   * glance at the panel answer it - goal item 10's "which sim is
   * selected", in words as well as in the floor ring.
   */
  simName(entityIndex: number): string;
}

/** The one property the panel writes on its caption. */
export interface CaptionText {
  textContent: string | null;
}

/** The one property the panel writes on a bar. `HTMLElement` satisfies it. */
export interface BarFill {
  readonly style: { width: string };
  setAttribute?(name: string, value: string): void;
  readonly stateText?: CaptionText;
}

/** The one property the panel writes on the panel itself. */
export interface PanelRoot {
  hidden: boolean;
}

export interface VisibilityTarget {
  hidden: boolean;
}

/**
 * A need level as a percentage of full, rounded to a tenth and clamped
 * into `[0, 100]`.
 *
 * Clamped rather than trusted because the panel is downstream of a
 * boundary: `needsOf` returns whatever the simulation holds, and a bar
 * wider than its track is a layout the CSS cannot express. NaN maps to
 * empty rather than propagating, since `NaN%` is not a width and the
 * browser would silently keep the previous one - a bar frozen at a stale
 * value is the one failure this panel must not have.
 *
 * The rounding is what stops a full-precision float being written into
 * the DOM ten times a second: a level that has not visibly changed then
 * produces the same string, and the browser has nothing to do.
 */
export function levelPercent(level: number, levelMax: number): number {
  if (!Number.isFinite(level) || !(levelMax > 0)) return 0;
  const percent = (level / levelMax) * 100;
  if (percent <= 0) return 0;
  if (percent >= 100) return 100;
  return Math.round(percent * 10) / 10;
}

/**
 * Writes the need bars from the simulation at a throttled rate.
 *
 * Constructed with bars already built - see `buildNeedBars` - because
 * building them needs a `Document` and updating them does not, and the
 * half that carries every decision is the half worth testing in Node.
 */
export class NeedsPanel {
  /**
   * When the panel last read the simulation, or null before the first
   * read.
   *
   * **The only state this class holds**, and the only state [D-5] permits
   * it. Note what is deliberately NOT here: the selected index, the last
   * seven levels, and whether the panel is currently showing. All three
   * are re-read or re-derived, because all three are things a replay must
   * reproduce from the simulation rather than from the shell.
   */
  private lastReadMs: number | null = null;

  /**
   * @param root       hidden when there is nothing to show.
   * @param bars       one fill per need, in `NeedId` index order.
   * @param refreshMs  `need_bar_refresh_ms` from `content/tuning.toml`.
   * @param levelMax   the simulation's full-need level, from the bridge.
   */
  constructor(
    private readonly root: PanelRoot,
    private readonly caption: CaptionText,
    private readonly bars: readonly BarFill[],
    private readonly refreshMs: number,
    private readonly levelMax: number,
    private readonly emptyState?: VisibilityTarget,
    private readonly content?: VisibilityTarget,
  ) {}

  /**
   * Reads the simulation and redraws, if the throttle interval has
   * elapsed. Returns whether it read.
   *
   * Called every frame; the throttle is why that is cheap. The
   * simulation advances ten times a second and the display runs at sixty
   * or more, so without this five reads in six would return the seven
   * numbers the previous one already returned, each one a call across the
   * WASM boundary that allocates. **The skipped path allocates nothing at
   * all** - it is two comparisons and a return - which is what keeps a
   * DOM panel out of [D11]'s way.
   *
   * `nowMs` is passed in rather than read from `performance.now()` here,
   * so the caller's single frame timestamp governs everything in the
   * frame and a test can drive the clock directly.
   */
  update(nowMs: number, source: NeedsSource): boolean {
    if (this.lastReadMs !== null && nowMs - this.lastReadMs < this.refreshMs) {
      return false;
    }
    this.lastReadMs = nowMs;

    // Read, never remembered. `selectedIndex` is the simulation's answer
    // to "what is the player looking at", so asking it every read is what
    // makes the panel follow a selection that changed inside a tick.
    //
    // Nothing selected, a sim that despawned between the click and this
    // frame, and a click that landed on a fridge all draw no bars, and
    // collapsing them is deliberate: the useful response to all three is
    // identical. The null case exits before `needsOf` so a deselected
    // panel costs no boundary call - the test counting reads pins that.
    const selected = source.selectedIndex();
    if (selected === null) {
      this.showEmptyState();
      return true;
    }
    const levels = source.needsOf(selected);
    if (levels.length === 0) {
      this.showEmptyState();
      return true;
    }
    this.root.hidden = false;
    if (this.emptyState) this.emptyState.hidden = true;
    if (this.content) this.content.hidden = false;

    // Re-read like everything else, not cached on selection change: a
    // future rename - sims will have editable names eventually - must
    // reach the caption without the panel being told. The write is
    // throttled with the bars, and an unchanged string is a no-op for
    // the browser. An empty name - a stress filler agent - captions as
    // empty rather than as the previous sim's name, which is the stale
    // caption this placement exists to prevent.
    this.caption.textContent = source.simName(selected);

    for (let i = 0; i < this.bars.length; i++) {
      // A bar past the levels the simulation reported reads empty rather
      // than keeping whatever it last showed. A stale bar is worse than
      // an empty one: it is indistinguishable from a need that stopped
      // changing, which is a real thing that happens mid-interaction.
      const level = i < levels.length ? levels[i] : 0;
      const percent = levelPercent(level, this.levelMax);
      const bar = this.bars[i];
      bar.style.width = `${percent}%`;
      bar.setAttribute?.('aria-valuemin', '0');
      bar.setAttribute?.('aria-valuemax', '100');
      bar.setAttribute?.('aria-valuenow', String(percent));
      const state = percent <= 20 ? 'critical' : percent <= 40 ? 'low' : 'steady';
      bar.setAttribute?.('aria-valuetext', `${percent}% full, ${state}`);
      if (bar.stateText) {
        bar.stateText.textContent = state === 'steady' ? '' : ` (${state})`;
      }
    }
    return true;
  }

  private showEmptyState(): void {
    if (this.emptyState && this.content) {
      this.root.hidden = false;
      this.emptyState.hidden = false;
      this.content.hidden = true;
      return;
    }
    this.root.hidden = true;
  }
}

/**
 * Returned for a deselected panel so the empty case allocates nothing.
 * Never written to.
 */
const EMPTY_LEVELS = new Float32Array(0);

/**
 * Builds one labelled row per need and returns the fills, in the order
 * the names arrived.
 *
 * **The names come from the simulation**, never from a list here. Seven
 * strings in this file would be a second copy of the need list that
 * nothing keeps in sync, and the way it would fail is the worst
 * available: every bar still drawn, every number still correct, and the
 * labels shifted by one against them. Reading a decision against the bars
 * - which is the entire reason this panel exists - would then give the
 * wrong answer with no sign that anything was wrong.
 *
 * Browser-only, and that is why it is separated from the class above: it
 * is wiring with no decisions in it, in the sense `main.ts` is.
 */
export function buildNeedBars(
  doc: Document,
  root: HTMLElement,
  names: readonly string[],
): BarFill[] {
  const fills: BarFill[] = [];
  for (const name of names) {
    const row = doc.createElement('div');
    row.className = 'need-row';

    const label = doc.createElement('span');
    label.className = 'need-label';
    label.textContent = name;

    const stateText = doc.createElement('span');
    stateText.className = 'need-state';
    label.appendChild(stateText);

    const track = doc.createElement('div');
    track.className = 'need-track';

    const fill = doc.createElement('div');
    fill.className = 'need-fill';
    // Named on the element as well as beside it, so the accessibility
    // tree carries which bar is which rather than seven anonymous divs.
    fill.setAttribute('role', 'meter');
    fill.setAttribute('aria-label', name);
    fill.setAttribute('aria-valuemin', '0');
    fill.setAttribute('aria-valuemax', '100');
    fill.setAttribute('aria-valuenow', '0');
    fill.setAttribute('aria-valuetext', '0% full, critical');
    fill.style.width = '0%';

    track.appendChild(fill);
    row.appendChild(label);
    row.appendChild(track);
    root.appendChild(row);
    Object.defineProperty(fill, 'stateText', { value: stateText });
    fills.push(fill as BarFill);
  }
  return fills;
}
