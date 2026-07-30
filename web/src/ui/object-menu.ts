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
 * it anyway: `Intent::interaction` has always been an index and
 * `UseObject` has always hardcoded 0, with a comment saying a click names
 * an object rather than one of its uses. A menu is the thing that makes
 * that index reachable, and building it after the first two-verb object
 * exists is how a hardcoded 0 got there in the first place.
 *
 * **The one half that is not here yet**: `SimCommand::UseObject` still
 * carries no interaction index, so picking row `n` sends the same command
 * row 0 would. The rows carry their index and the labels arrive in index
 * order, so the shell is ready; what remains is a wire-format change to
 * the command, which is a different decision from this one and moves a
 * published byte encoding. Until then a menu row is a nicer way to say
 * what a left click says.
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
       * `Intent::interaction`. Carried rather than dropped even though
       * `UseObject` cannot yet express it; see the module comment.
       */
      readonly interaction: number;
    }
  | { readonly kind: 'cancel' };

/** One row. */
export interface MenuEntry {
  readonly label: string;
  readonly action: MenuAction;
}

/**
 * The row that cancels, which right-click used to perform directly.
 *
 * Worded as a refusal of the menu rather than as an order - "Never mind"
 * rather than "Stop" - because that is what it does to a sim acting on its
 * own: nothing. `CancelIntents` releases the sim's current commitment only
 * when that commitment is the intent being cancelled, so a sim that chose
 * to sleep by itself keeps sleeping. A row labelled "Stop" would be
 * promising something the simulation deliberately does not do.
 */
export const NEVER_MIND: MenuEntry = {
  label: 'Never mind',
  action: { kind: 'cancel' },
};

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
  labels: readonly string[],
  object: number,
): MenuEntry[] {
  const entries: MenuEntry[] = labels.map((label, interaction) => ({
    label,
    action: { kind: 'use', object, interaction },
  }));
  entries.push(NEVER_MIND);
  return entries;
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
  /** Draws `entries` at a point in CLIENT pixels and makes them visible. */
  show(
    entries: readonly MenuEntry[],
    clientX: number,
    clientY: number,
    onPick: (index: number) => void,
  ): void;
  hide(): void;
}

/**
 * The flyout's behaviour: what is open, and the four ways it closes.
 *
 * Closing has four routes and each is a separate method, because each is
 * wired to a different event and any one of them can be forgotten on its
 * own: picking a row, pressing Escape, pointing somewhere that is not the
 * menu, and being told to close because a right click resolved to nothing.
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
  open(entries: readonly MenuEntry[], clientX: number, clientY: number): void {
    this.entries = entries;
    this.showing = true;
    this.surface.show(entries, clientX, clientY, (index) =>
      this.activate(index),
    );
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
 * fixed` element; `index.html` styles it that way. Nothing here clamps the
 * menu inside the viewport, so a right click within a menu's height of the
 * bottom edge draws part of it off screen. Clamping needs the menu's
 * measured size, which does not exist until after layout, so it would cost
 * a second frame or a hardcoded width - neither worth it against a fixed
 * 1280x720 canvas where the pointer is rarely at the very edge.
 */
export function createMenuSurface(
  doc: Document,
  root: HTMLElement,
): MenuSurface {
  return {
    show(entries, clientX, clientY, onPick) {
      root.replaceChildren();
      for (const [index, entry] of entries.entries()) {
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
    },
    hide() {
      root.hidden = true;
      root.replaceChildren();
    },
  };
}
