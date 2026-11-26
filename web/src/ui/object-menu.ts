/**
 * The object flyout reads current interaction labels and identity on each open.
 * Action order is the simulation's interaction-index order. Identity and its
 * optional description stay outside that list, so disclosure never sends an order.
 * Menu position, focus, and expansion are browser presentation state.
 */

import { setActionIntent, type ActionIntent } from './action-intent.js';
import { createObjectIdentity, type ObjectDetails } from './object-identity.js';
import type { PurchaseQuote, SaleQuote, QuoteResult, ReadingChoice } from '../books/commerce-codec.js';
import { placeObjectMenu } from './object-menu-layout.js';
import type { ScenePoint } from './scene-feedback-layout.js';
import type { BookCopy, BookTitle } from '../books/codec.js';
import { formatFunds } from './game-hud.js';
import { preventMenuSelection } from './menu-selection.js';

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
  | { readonly kind: 'build'; readonly object: number }
  | { readonly kind: 'buy-book'; readonly quote: PurchaseQuote | null }
  | { readonly kind: 'sell-book'; readonly quote: SaleQuote | null }
  | { readonly kind: 'recover-book'; readonly copy: number }
  | {readonly kind:'chore';readonly choreKind:number;readonly target:number}
  | { readonly kind: 'clean'; readonly surface: number; readonly dishes: readonly number[] | null }
  | { readonly kind: 'read'; readonly object: number; readonly action: string; readonly title: string }
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

function menuActionIntent(action: MenuAction): ActionIntent {
  switch (action.kind) {
    case 'buy-book': return 'affirmative';
    case 'sell-book': return 'destructive';
    case 'cancel': return 'negative';
    default: return 'neutral';
  }
}

/** One row. */
export interface MenuEntry {
  readonly enabled?: boolean;
  readonly price?: number;
  readonly secondary?: string;
  readonly label: string;
  readonly action: MenuAction;
  /**
   * Draw a rule ABOVE this row.
   *
   * Set on the cancel row and nowhere else, because it is the one row that
   * is not about the thing under the pointer. Without it the flyout reads
   * as a flat list in which "Clear orders" is another thing you could do to
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
  readonly object?: number;
  readonly person?: number;
  readonly book?: number;
  readonly dishes?: readonly number[];
  readonly needsPerson?: boolean;
  readonly title: string;
  readonly details?: ObjectDetails;
  readonly entries: readonly MenuEntry[];
}

/** Clears the selected person's player orders; dismissing the menu is a separate action. */
export const NOTHING: MenuEntry = {
  label: 'Clear orders',
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
  details?: ObjectDetails,
): Menu {
  const entries: MenuEntry[] = labels.map((label, interaction) => ({
    label,
    action: { kind: 'use', object, interaction },
  }));
  entries.push(NOTHING);
  return { title, entries, ...(details ? { details } : {}) };
}

export interface SurfaceMenuSource {
  selectedIndex?(): number | null;
  objectModel?(entity: number): { shelfCapacity: number; actions: readonly { id: string; reading: boolean }[] } | undefined;
  automaticReadingChoice?(person: number, object: number, action: string): ReadingChoice | null;
  bookPurchaseQuote?(): QuoteResult<PurchaseQuote>;
  bookPurchasePrice?(): number | null;
  bookSaleQuote?(shelf: number): QuoteResult<SaleQuote>;
  bookCatalogue?(): readonly BookTitle[];
  bookCopies?(): readonly BookCopy[];
  pendingBookCommands?(): number;
  funds?(): number;
  tableActions?(entity:number):Uint32Array;
  choreOptions?(entity:number):Uint32Array;
  entityName(entity: number): string;
  interactionLabels(entity: number): readonly string[];
  objectDetails?(entity: number): ObjectDetails | undefined;
  dishPiles?(): Uint32Array;
}

/** Pointer and keyboard target selection use the same dirty-surface actions. */
export function surfaceMenuEntries(source: SurfaceMenuSource, entity: number): Menu {
  const person = source.selectedIndex ? source.selectedIndex() : 0;
  const model = source.objectModel?.(entity);
  let menu = menuEntries(source.entityName(entity), source.interactionLabels(entity), entity, source.objectDetails?.(entity));
  if (source.dishPiles?.().some((value, i) => i % 3 === 0 && value === entity)) {
    return { ...menu, object: entity, ...(person === null ? { needsPerson: true } : {}), entries: [{ label: 'Clean up', enabled: person !== null, action: { kind: 'clean', surface: entity, dishes: null } },
      { label: 'Enter build mode', enabled: true, action: { kind: 'build', object: entity } }, ...(person === null ? [] : [NOTHING])] };
  }
  const table = source.tableActions?.(entity);
  if (table?.length === 2) menu = { ...menu, entries: [
    ...(table[0] ? [{ label: 'Sit', action: { kind: 'use' as const, object: entity, interaction: 0 } }] : []),
    ...(table[1] ? [{ label: 'Eat prepared food', action: { kind: 'use' as const, object: entity, interaction: 1 } }] : []), NOTHING] };
  const entries: MenuEntry[] = menu.entries.filter(entry => entry.action.kind !== 'cancel').map(entry => {
    const action = entry.action.kind === 'use' ? model?.actions[entry.action.interaction] : undefined;
    if (action?.reading) {
      const choice = person === null ? null : source.automaticReadingChoice?.(person, entity, action.id) ?? null;
      return { ...entry, label: 'Read book', enabled: person !== null && choice !== null,
        ...(choice?.title ? { secondary: `${choice.title} \u00b7 ${Math.floor(choice.progress)}%` } : {}) };
    }
    return { ...entry, enabled: person !== null };
  });
  const chores = source.choreOptions?.(entity);
  if (chores) for (let i = 0; i + 1 < chores.length; i += 2) entries.push({ ...choreEntry(chores[i], chores[i + 1]), enabled: person !== null });
  const needsPerson = person === null && entries.length > 0;
  if (model && model.shelfCapacity > 0) {
    const buy = source.bookPurchaseQuote?.().quote ?? null;
    const sell = source.bookSaleQuote?.(entity).quote ?? null;
    const pending = (source.pendingBookCommands?.() ?? 0) > 0;
    const price = buy?.price ?? source.bookPurchasePrice?.();
    const catalogue = source.bookCatalogue?.();
    const saleTitleId = sell && source.bookCopies?.().find(copy => copy.id === sell.copy)?.titleId;
    entries.push({ label: 'Buy book', enabled: buy !== null && !pending && buy.price <= (source.funds?.() ?? Infinity),
      ...(price != null ? { price } : {}), ...(buy && catalogue ? { secondary: catalogue.find(title => title.id === buy.title)?.title } : {}),
      action: { kind: 'buy-book', quote: buy } },
    { label: 'Sell book', enabled: sell !== null && !pending, ...(sell ? { price: sell.price } : {}),
      ...(saleTitleId && catalogue ? { secondary: catalogue.find(title => title.id === saleTitleId)?.title } : {}), action: { kind: 'sell-book', quote: sell } });
  }
  entries.push({ label: 'Enter build mode', enabled: true, action: { kind: 'build', object: entity } });
  if (person !== null) entries.push(NOTHING);
  return { ...menu, object: entity, ...(needsPerson ? { needsPerson } : {}), entries };
}

  export const CHORE_LABELS=['Do dishes','Clean floor','Wipe surface','Empty bin','Wipe counter surfaces','Wipe table surfaces'] as const;
export function choreEntry(choreKind:number,target:number):MenuEntry {
  return {label:CHORE_LABELS[choreKind]??'Unavailable chore',action:{kind:'chore',choreKind,target}};
}
export function floorMenuEntries(kind:number,target:number):Menu{return {title:'Floor',entries:[choreEntry(kind,target),NOTHING]};}

export function dishMenuEntries(surface: number, dishes: readonly number[], hasPerson = true): Menu {
  return { title: 'Dishes', object: surface, dishes, ...(hasPerson ? {} : { needsPerson: true }),
    entries: [{ label: 'Do dishes', enabled: hasPerson, action: { kind: 'clean', surface, dishes } }, ...(hasPerson ? [NOTHING] : [])] };
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
  return { title, person: target, entries };
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
  /**
   * Draws `menu` at a point in CLIENT pixels and makes it visible.
   *
   * `onPick` receives the row index and whether the queue modifier (Ctrl
   * or Cmd) was held when the row was activated, so a modified pick can
   * append exactly as a modified click does.
   */
  show(
    menu: Menu,
    clientX: number,
    clientY: number,
    onPick: (index: number, additive: boolean) => void,
    preserveState?: boolean,
  ): void;
  hide(): void;
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
  private current: { menu: Menu; x: number; y: number } | null = null;
  private clearable = false;

  /**
   * @param surface  where rows are drawn.
   * @param onAction what a picked row's action is handed to, with whether
   *                 the queue modifier was held on the pick. It is a
   *                 callback rather than a `CommandSink` so this file
   *                 stays free of the command encoding, which keeps
   *                 `input.ts` importing this module and not the reverse.
   */
  constructor(
    private readonly surface: MenuSurface,
    private readonly onAction: (action: MenuAction, additive: boolean) => void,
    private readonly canActivate: (action: MenuAction) => boolean = () => true,
    private readonly canClearOrders: () => boolean = () => false,
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
  open(menu: Menu, clientX: number, clientY: number, preserveState = false): void {
    this.current = {menu, x: clientX, y: clientY};
    this.clearable = this.canClearOrders();
    this.entries = menu.entries.filter(entry => entry.action.kind !== 'cancel' || this.clearable)
      .map(entry => this.canActivate(entry.action) ? entry : { ...entry, enabled: false, secondary: undefined });
    if (!this.entries.length) { this.close(); this.current = null; return; }
    this.showing = true;
    this.surface.show({ ...menu, entries: this.entries }, clientX, clientY, (index, additive) =>
      this.activate(index, additive),
      preserveState,
    );
  }

  /** Recheck ownership when a running order ends while its menu stays open. */
  refresh(): void {
    if (!this.showing || !this.current || this.canClearOrders() === this.clearable) return;
    const {menu, x, y} = this.current;
    this.open(menu, x, y, true);
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
    this.current = null;
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
   *
   * `additive` is passed through untouched: whether the queue modifier
   * was held is the surface's observation and the dispatcher's decision.
   */
  private activate(index: number, additive: boolean): void {
    const entry = this.entries[index];
    if (entry?.enabled === false) return;
    if (entry?.action.kind === 'cancel' && !this.canClearOrders()) { this.refresh(); return; }
    this.close();
    if (entry === undefined) return;
    this.onAction(entry.action, additive);
  }
}

/**
 * Whether a row activation carried the queue modifier. Ctrl and Cmd both
 * count, exactly as on a canvas click (see `attachPointerInput` for why
 * both). Extracted so the rule is testable without a DOM: the listener in
 * `createMenuSurface` is the only caller.
 */
export function queueModifierHeld(event: {
  readonly ctrlKey: boolean;
  readonly metaKey: boolean;
}): boolean {
  return event.ctrlKey || event.metaKey;
}

/** DOM and geometry for the shared pointer, touch and keyboard menu. */
export interface MenuSurfaceOptions {
  anchor?(menu: Menu): ScenePoint | null | undefined;
  revision?(menu: Menu): string;
  keepouts?: readonly HTMLElement[];
  dismiss?(): void;
  closed?(): void;
  positioned?(point: ScenePoint): void;
}

export function createMenuSurface(doc: Document, root: HTMLElement, options: MenuSurfaceOptions = {}): MenuSurface {
  preventMenuSelection(root);
  let returnFocus: HTMLElement | null = null;
  let cleanup: (() => void) | undefined;
  return {
    show(menu, clientX, clientY, onPick, preserveState = false) {
      const wasOpen = !root.hidden;
      const active = doc.activeElement as HTMLElement | null;
      const hadFocus = root.contains(active);
      const previousIdentity = root.querySelector<HTMLDetailsElement>('.object-identity');
      const wasExpanded = preserveState && previousIdentity?.open;
      const identityFocused = preserveState && active === previousIdentity?.querySelector('summary');
      const closeFocused = preserveState && active === root.querySelector('.object-menu-close');
      const previousIndex = active?.dataset.menuIndex;
      const previousScroll = preserveState ? root.querySelector('.object-menu-panel')?.scrollTop ?? 0 : 0;
      cleanup?.();
      if (!wasOpen) returnFocus = active;

      const panel = doc.createElement('div');
      panel.className = 'object-menu-panel';
      const content = doc.createElement('div');
      const header = doc.createElement('div');
      header.className = 'object-menu-header';
      const description = doc.createElement('div');
      description.className = 'object-menu-description';
      description.hidden = true;
      const identity = menu.details
        ? createObjectIdentity(doc, menu.title, menu.details, { descriptionHost: description })
        : undefined;
      let summary: HTMLElement | null = null;
      if (identity) {
        header.append(identity.element);
        summary = identity.element.querySelector('summary');
        if (wasExpanded) {
          (identity.element as HTMLDetailsElement).open = true;
          description.hidden = false;
        }
      } else {
        const title = doc.createElement('strong');
        title.className = 'object-menu-title';
        title.textContent = menu.title;
        header.append(title);
      }
      const close = doc.createElement('button');
      close.type = 'button';
      close.className = 'object-menu-close';
      close.textContent = '\u00d7';
      close.setAttribute('aria-label', 'Close menu');
      setActionIntent(close, 'negative');
      close.addEventListener('click', () => options.dismiss?.());
      header.append(close);
      content.append(header, description);

      const actions = doc.createElement('div');
      actions.className = 'object-menu-actions';
      const buttons = menu.entries.map((entry, index) => {
        const button = doc.createElement('button');
        button.type = 'button';
        button.className = 'menu-entry';
        button.disabled = entry.enabled === false;
        button.dataset.menuIndex = String(index);
        if (entry.divider) button.dataset.divider = 'true';
        setActionIntent(button, menuActionIntent(entry.action));
        const text = doc.createElement('span');
        text.className = 'object-menu-action-text';
        text.textContent = entry.label;
        if (entry.secondary) {
          const secondary = doc.createElement('small');
          secondary.className = 'menu-secondary';
          secondary.textContent = entry.secondary;
          text.append(secondary);
        }
        button.append(text);
        if (entry.price !== undefined) {
          const price = doc.createElement('small');
          price.className = 'action-price';
          price.textContent = (entry.action.kind === 'sell-book' ? '+$' : '$') + formatFunds(entry.price);
          button.append(price);
        }
        button.addEventListener('click', event => onPick(index, queueModifierHeld(event)));
        return button;
      });
      const requirement = doc.createElement('p');
      requirement.className = 'object-menu-requirement';
      requirement.textContent = 'Select a person to use these actions.';
      const firstIndependent = menu.entries.findIndex(entry => ['buy-book', 'sell-book', 'build'].includes(entry.action.kind));
      buttons.forEach((button, index) => {
        if (menu.needsPerson && index === firstIndependent) actions.append(requirement);
        actions.append(button);
      });
      if (menu.needsPerson && firstIndependent < 0) actions.append(requirement);
      content.append(actions);
      panel.append(content);

      const scrollHint = doc.createElement('div');
      scrollHint.className = 'object-menu-scroll-hint';
      scrollHint.textContent = 'Scroll to see all actions';
      scrollHint.hidden = true;
      const tether = doc.createElement('span');
      tether.className = 'object-menu-tether';
      tether.setAttribute('aria-hidden', 'true');
      tether.hidden = true;
      root.replaceChildren();
      root.append(panel, scrollHint, tether);
      root.setAttribute('aria-label', menu.title ? menu.title + ' actions' : 'Actions');
      root.hidden = false;

      const view = doc.defaultView;
      const keepouts = options.keepouts ?? [];
      let dirty = true;
      let disposed = false;
      let frame = 0;
      let revision = options.revision?.(menu);
      const followsTarget = menu.object !== undefined || menu.person !== undefined || menu.book !== undefined;
      const place = () => {
        if (!view || disposed || root.hidden) return;
        const point = options.anchor?.(menu);
        if (point === null) { options.dismiss?.(); return; }
        const anchor = point ?? { x: clientX, y: clientY };
        const width = panel.offsetWidth;
        const height = content.getBoundingClientRect().height + 2;
        const viewport = { width: view.innerWidth, height: view.innerHeight };
        const obstacles = keepouts.map(element => element.getBoundingClientRect())
          .filter(rect => rect.width > 0 && rect.height > 0);
        const placement = placeObjectMenu(anchor, { width, height }, viewport, obstacles);
        if (!placement) { options.dismiss?.(); return; }
        const { left, top, height: available } = placement;
        root.style.left = left + 'px';
        root.style.top = top + 'px';
        // Keep a full 44-pixel control in view even with the cue below it.
        const hintHeight = height > available && available >= 64 ? 18 : 0;
        scrollHint.hidden = hintHeight === 0;
        panel.style.maxHeight = available - hintHeight + 'px';
        options.positioned?.(anchor);

        const x = Math.max(8, Math.min(viewport.width - 8, anchor.x));
        const y = Math.max(8, Math.min(viewport.height - 8, anchor.y));
        const right = left + width, bottom = top + available;
        const beside = x <= left || x >= right;
        const edgeX = beside ? (x <= left ? left : right) : Math.max(left + 10, Math.min(right - 10, x));
        const edgeY = beside ? Math.max(top + 10, Math.min(bottom - 10, y)) : (y < top ? top : bottom);
        const dx = edgeX - x, dy = edgeY - y;
        const length = Math.hypot(dx, dy);
        const unobstructed = !obstacles.some(rect => Math.min(y, edgeY) < rect.bottom + 5 && Math.max(y, edgeY) > rect.top - 5
          && Math.min(x, edgeX) < rect.right + 5 && Math.max(x, edgeX) > rect.left - 5);
        const targetUnderControl = obstacles.some(rect => x >= rect.left - 6 && x <= rect.right + 6
          && y >= rect.top - 6 && y <= rect.bottom + 6);
        tether.hidden = (!beside && y >= top && y <= bottom) || length < 6 || targetUnderControl
          || Math.abs(x - anchor.x) > 12 || Math.abs(y - anchor.y) > 12;
        if (!tether.hidden) {
          const shortLink = length <= 82 && unobstructed;
          tether.style.left = x - left + 'px';
          tether.style.top = y - top + 'px';
          tether.style.width = (shortLink ? length : 0) + 'px';
          tether.style.transform = shortLink ? 'rotate(' + Math.atan2(dy, dx) + 'rad)' : '';
        }
      };
      const invalidate = () => {
        dirty = true;
        if (!frame && !disposed && view) frame = view.requestAnimationFrame(follow);
      };
      const follow = () => {
        frame = 0;
        if (disposed || root.hidden || !view) return;
        const next = options.revision?.(menu);
        if (dirty || next !== revision) {
          dirty = false;
          revision = next;
          place();
        }
        if (!disposed && followsTarget) {
          frame = view.requestAnimationFrame(follow);
        }
      };
      const observer = new ResizeObserver(invalidate);
      observer.observe(content);
      keepouts.forEach(element => observer.observe(element));
      const navigate = (event: KeyboardEvent) => {
        if (event.key === 'Enter' && event.repeat) { event.preventDefault(); return; }
        if (!['ArrowDown', 'ArrowUp', 'ArrowLeft', 'ArrowRight'].includes(event.key)) return;
        const usable = buttons.filter(button => !button.disabled);
        const index = usable.indexOf(doc.activeElement as HTMLButtonElement);
        if (index < 0) return;
        event.preventDefault();
        const delta = event.key === 'ArrowUp' || event.key === 'ArrowLeft' ? -1 : 1;
        usable[(index + delta + usable.length) % usable.length].focus();
      };
      root.addEventListener('keydown', navigate);
      view?.addEventListener('resize', invalidate);
      cleanup = () => {
        disposed = true;
        observer.disconnect();
        if (frame) view?.cancelAnimationFrame(frame);
        view?.removeEventListener('resize', invalidate);
        root.removeEventListener('keydown', navigate);
        identity?.dispose();
      };
      dirty = false;
      place();
      if (!disposed) panel.scrollTop = previousScroll;
      if (!disposed && (!preserveState || hadFocus)) {
        const previous = (preserveState || wasOpen) && previousIndex !== undefined ? buttons[Number(previousIndex)] : undefined;
        const preferred = closeFocused ? close : identityFocused ? summary : previous && !previous.disabled ? previous : null;
        const compact = view && view.innerWidth <= 600;
        (preferred ?? (compact ? summary : null) ?? buttons.find(button => !button.disabled) ?? summary ?? close)
          .focus({ preventScroll: preserveState && !!preferred });
      }
      if (!disposed && view && followsTarget) frame = view.requestAnimationFrame(follow);
    },
    hide() {
      cleanup?.();
      cleanup = undefined;
      const restore = root.contains(doc.activeElement);
      root.hidden = true;
      root.replaceChildren();
      options.closed?.();
      if (restore) returnFocus?.focus({ preventScroll: true });
      returnFocus = null;
    },
  };
}
