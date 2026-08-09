/**
 * The right-click flyout: one row per interaction the object offers, plus
 * a row that hands the sim back to its own judgement.
 *
 * **This menu owns nothing the simulation owns** ([D-5]). It holds which
 * rows are currently on screen and where, and both of those are facts
 * about the DOM rather than projections of the world - a replay would not
 * want them back. The rows themselves are re-read from the simulation on
 * every open, because an object's interaction list is content and
 * `interactionLabels` is where it lives.
 *
 * # Why it exists before any object has a second verb
 *
 * Every shipped object declares exactly one interaction today, so every
 * menu built here has two rows. [I4] in
 * `docs/specs/2026-07-30-selection-and-input-design.md` decided to build
 * it anyway: `Intent::interaction` has always been an index, and a menu is
 * the thing that makes that index reachable. Building it after the first
 * two-verb object exists is how `UseObject`'s hardcoded 0 got there in the
 * first place.
 *
 * **The index now reaches the simulation.** `SimCommand::UseObject` carries
 * an `interaction` field, so picking row `n` runs interaction `n` rather
 * than whatever row 0 would have run. That means nothing here may sort,
 * filter or renumber the rows: a row's POSITION is the index it sends, and
 * the one place that is stated is `menuEntries` below.
 *
 * The consequence for testing is that the shipped game cannot demonstrate
 * this. Every object has one interaction, so row 0 is the only row, and a
 * menu that always sent 0 would look perfectly correct on the whole lot.
 * The tests that can tell the difference are in Rust, against fixtures with
 * a two-verb object.
 *
 * # The DOM split
 *
 * Everything with a decision in it - which rows, which action a row names,
 * when the menu closes - is in [`ObjectMenu`] and the pure functions
 * beside it, over structural interfaces that a plain object satisfies.
 * [`createMenuSurface`] is the half that needs a `Document`, and it is the
 * only untested thing in this file - the same division `buildNeedBars`
 * draws against `NeedsPanel`, and `buildTimeControls` against
 * `FixedStepDriver`. There is no jsdom in this project.
 */

/**
 * What a row does when picked.
 *
 * `cancel` names no agent, and `use` names no agent either: both act on
 * whichever sim the SIMULATION says is selected at the moment the row is
 * picked, which is read then rather than captured when the menu opened.
 * That is [D-5] again - a menu that remembered the selection could act on
 * a sim the player had since changed, or on one that had despawned.
 */
export type MenuAction =
  | {
      readonly kind: 'use';
      readonly object: number;
      /**
       * The interaction's position in the object's own list, which IS
       * `Intent::interaction` and the last field of
       * `SimCommand::UseObject`. `dispatchMenuAction` in `input.ts` is what
       * puts it into the command.
       */
      readonly interaction: number;
    }
  | {
      readonly kind: 'talk';
      /** The entity index of the sim being approached. */
      readonly target: number;
      /**
       * The entry's position in the pack's SOCIAL vocabulary, which is
       * `SimCommand::TalkTo`'s last field - the same order-is-the-index
       * contract `use` rows carry for an object's own list.
       */
      readonly interaction: number;
    }
  | { readonly kind: 'cancel' };

/** One row. */
export interface MenuEntry {
  readonly label: string;
  readonly action: MenuAction;
  /**
   * Draw a rule ABOVE this row.
   *
   * Set on the cancel row and nowhere else, because it is the one row that
   * is not about the thing under the pointer. Without it the flyout reads
   * as a flat list in which "Nothing" is a fourth thing you could do to
   * the bookshelf.
   */
  readonly divider?: boolean;
}

/**
 * A flyout: what it is about, and what you can do to it.
 *
 * The title is carried BESIDE the rows rather than as a row, and that is
 * the whole reason this type exists. `entries[n]` has to stay the row a
 * player clicks, and a heading occupying index 0 would put a
 * non-interactive row in the middle of that list for every reader to
 * special-case. One extra field costs less than that.
 *
 * An empty title means "nothing worth naming" - a right click on bare
 * floor - and the surface draws no heading at all rather than an empty
 * line.
 */
export interface Menu {
  readonly title: string;
  readonly entries: readonly MenuEntry[];
}

/**
 * The row that cancels, which right-click used to perform directly.
 *
 * Worded as a refusal of the menu rather than as an order - "Nothing"
 * rather than "Stop" - because that is what it does to a sim acting on its
 * own: nothing. `CancelIntents` releases the sim's current commitment only
 * when that commitment is the intent being cancelled, so a sim that chose
 * to sleep by itself keeps sleeping. A row labelled "Stop" would be
 * promising something the simulation deliberately does not do.
 *
 * It was "Never mind", which reads as an apology to the menu rather than
 * as an answer to the question the menu is asking. The question is what
 * this person should do, and the answer is Nothing.
 */
export const NOTHING: MenuEntry = {
  label: 'Nothing',
  action: { kind: 'cancel' },
  divider: true,
};

/** A flyout over something with no name and nothing to offer. */
export const NOTHING_MENU: Menu = { title: '', entries: [NOTHING] };

/**
 * The rows for an object: its own interactions, in the order the
 * simulation reported them, then the cancel.
 *
 * **The order is not cosmetic.** `labels[n]` is interaction `n`, so the
 * row index and the interaction index are the same number by
 * construction; sorting these, or filtering one out, would renumber an
 * index the simulation owns. The cancel goes last because it is the one
 * row that is not about this object.
 *
 * An object with no interactions at all yields a menu of just the cancel
 * rather than nothing, which is what makes "right-clicked a rug" and
 * "right-clicked the floor" behave alike.
 */
export function menuEntries(
  title: string,
  labels: readonly string[],
  object: number,
): Menu {
  const entries: MenuEntry[] = labels.map((label, interaction) => ({
    label,
    action: { kind: 'use', object, interaction },
  }));
  entries.push(NOTHING);
  return { title, entries };
}

/**
 * The rows for a fellow SIM: the social vocabulary, in the order the
 * simulation reported it, then the cancel. Same order-is-the-index rule
 * as `menuEntries` and for the same reason; an empty vocabulary yields
 * just the cancel, like a rug.
 */
export function socialMenuEntries(
  title: string,
  labels: readonly string[],
  target: number,
): Menu {
  const entries: MenuEntry[] = labels.map((label, interaction) => ({
    label,
    action: { kind: 'talk', target, interaction },
  }));
  entries.push(NOTHING);
  return { title, entries };
}

/**
 * Where the rows are drawn. A DOM element satisfies this through
 * [`createMenuSurface`]; a recording object satisfies it in tests.
 *
 * `onPick` arrives with each `show` rather than being held by the surface,
 * so the surface never has to know about the menu that drives it. The
 * alternative - handing the surface a callback at construction - needs the
 * menu to exist first and the surface to exist first, which is a cycle
 * somebody would break with a mutable field.
 */
export interface MenuSurface {
  /** Draws `menu` at a point in CLIENT pixels and makes it visible. */
  show(
    menu: Menu,
    clientX: number,
    clientY: number,
    onPick: (index: number) => void,
  ): void;
  hide(): void;
}

export interface MenuPosition {
  readonly x: number;
  readonly y: number;
}

/** Keeps a laid-out menu inside the visible viewport. */
export function clampMenuPosition(
  clientX: number,
  clientY: number,
  menuWidth: number,
  menuHeight: number,
  viewportWidth: number,
  viewportHeight: number,
  margin = 8,
): MenuPosition {
  const maxX = Math.max(margin, viewportWidth - menuWidth - margin);
  const maxY = Math.max(margin, viewportHeight - menuHeight - margin);
  return {
    x: Math.min(Math.max(margin, clientX), maxX),
    y: Math.min(Math.max(margin, clientY), maxY),
  };
}

/**
 * The flyout's behaviour: what is open, and how every owner closes it.
 *
 * Closing is wired from several independent events: picking a row, pressing
 * Escape, pointing elsewhere, a viewport change, an invalid target, or a
 * wholesale world replacement. Keeping one guarded `close` operation makes
 * every route discard the retained entity-bearing rows as well as the DOM.
 */
export class ObjectMenu {
  /**
   * The rows currently on screen. Empty exactly when the menu is closed,
   * which is what lets a pick that arrives after a close - a queued click
   * event, say - resolve to nothing instead of to a stale row.
   */
  private entries: readonly MenuEntry[] = [];

  private showing = false;

  /**
   * @param surface  where rows are drawn.
   * @param onAction what a picked row's action is handed to. It is a
   *                 callback rather than a `CommandSink` so this file
   *                 stays free of the command encoding, which keeps
   *                 `input.ts` importing this module and not the reverse.
   */
  constructor(
    private readonly surface: MenuSurface,
    private readonly onAction: (action: MenuAction) => void,
  ) {}

  /** Whether rows are on screen. */
  isShowing(): boolean {
    return this.showing;
  }

  /** The rows on screen, for tests and for nothing else. */
  shownEntries(): readonly MenuEntry[] {
    return this.entries;
  }

  /**
   * Draws `entries` at the pointer. Re-opening while already open replaces
   * the rows rather than stacking a second menu, which is what a right
   * click on a second object has to do.
   */
  open(menu: Menu, clientX: number, clientY: number): void {
    this.entries = menu.entries;
    this.showing = true;
    this.surface.show(menu, clientX, clientY, (index) => this.activate(index));
  }

  /**
   * Hides the menu.
   *
   * Guarded on being open, so the document-wide pointer handler below does
   * not write to the DOM on every click anywhere on the page. The surface
   * and this object cannot drift apart as a result, because nothing else
   * shows or hides the surface.
   */
  close(): void {
    if (!this.showing) return;
    this.showing = false;
    this.entries = [];
    this.surface.hide();
  }

  /**
   * **Escape closes, and every other key is left alone.** Returns whether
   * the key was consumed, so a caller can decide about `preventDefault`.
   *
   * The second half matters as much as the first: this is wired to the
   * document, so a handler that closed on any key would dismiss the menu
   * the instant the player touched the speed controls' keyboard focus, and
   * one that consumed every key would swallow input the page does not own.
   */
  handleKey(key: string): boolean {
    if (key !== 'Escape') return false;
    if (!this.showing) return false;
    this.close();
    return true;
  }

  /**
   * A pointer went down somewhere. `insideMenu` says whether it landed on
   * the menu itself.
   *
   * The inside case must NOT close, and that is the whole content of this
   * method: this fires before the row's own click event, so a version
   * without the guard would tear the row out from under the click that was
   * picking it and the menu would appear to ignore every selection.
   *
   * Deciding `insideMenu` is `Node.contains` and therefore wiring; see
   * `attachPointerInput`.
   */
  pointerDown(insideMenu: boolean): void {
    if (insideMenu) return;
    this.close();
  }

  /**
   * The row at `index` was picked: close first, then report the action.
   *
   * Closing first rather than after is deliberate. The action reaches a
   * command sink, and if anything downstream throws, a menu left on screen
   * over a game that has already acted is the worse of the two failures.
   *
   * An index that names no row does nothing at all - it is what a pick
   * arriving after a close looks like, and there is no row to report.
   */
  private activate(index: number): void {
    const entry = this.entries[index];
    this.close();
    if (entry === undefined) return;
    this.onAction(entry.action);
  }
}

/**
 * A [`MenuSurface`] over a real DOM element.
 *
 * Browser-only wiring with no decisions in it, in the sense
 * `buildNeedBars` is: every rule about what the menu contains and when it
 * goes away is in [`ObjectMenu`] above, where a test can reach it.
 *
 * `<button>` per row rather than `<div>`, so the rows are reachable by
 * keyboard and announced as controls without a hand-written ARIA role.
 *
 * **The rows are removed on hide, not merely hidden.** A `hidden` element's
 * buttons are out of the tab order, but leaving them in the tree means the
 * next open has to clear them anyway, and a stale row that somehow received
 * a click would name an object the player right-clicked minutes ago.
 *
 * Positioned in CLIENT pixels, which is correct only for a `position:
 * fixed` element; `index.html` styles it that way. It is made visible before
 * its final position is calculated so `offsetWidth` and `offsetHeight` are
 * real layout measurements rather than guessed menu dimensions.
 */
export function createMenuSurface(
  doc: Document,
  root: HTMLElement,
): MenuSurface {
  let returnFocus: HTMLElement | null = null;
  return {
    show(menu, clientX, clientY, onPick) {
      returnFocus = doc.activeElement instanceof HTMLElement ? doc.activeElement : null;
      root.replaceChildren();
      // The heading names what was right-clicked. A `<p>` rather than a
      // `<button>`: it is not a row, it must not take focus, and the
      // keyboard walk below has to land on the first real action.
      if (menu.title !== '') {
        const title = doc.createElement('p');
        title.className = 'menu-title';
        title.textContent = menu.title;
        root.appendChild(title);
      }
      for (const [index, entry] of menu.entries.entries()) {
        if (entry.divider === true && root.childElementCount > 0) {
          const rule = doc.createElement('div');
          rule.className = 'menu-divider';
          root.appendChild(rule);
        }
        const button = doc.createElement('button');
        button.type = 'button';
        button.className = 'menu-entry';
        button.textContent = entry.label;
        button.addEventListener('click', () => onPick(index));
        root.appendChild(button);
      }
      root.style.left = `${clientX}px`;
      root.style.top = `${clientY}px`;
      root.hidden = false;
      const view = doc.defaultView;
      if (view) {
        const position = clampMenuPosition(
          clientX,
          clientY,
          root.offsetWidth,
          root.offsetHeight,
          view.innerWidth,
          view.innerHeight,
        );
        root.style.left = `${position.x}px`;
        root.style.top = `${position.y}px`;
      }
      root.querySelector<HTMLButtonElement>('.menu-entry')?.focus();
    },
    hide() {
      const restore = root.contains(doc.activeElement);
      root.hidden = true;
      root.replaceChildren();
      if (restore) returnFocus?.focus();
      returnFocus = null;
    },
  };
}
