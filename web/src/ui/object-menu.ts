/**
 * The object flyout reads current interaction labels and identity on each open.
 * Action order is the simulation's interaction-index order. Identity and its
 * optional description stay outside that list, so disclosure never sends an order.
 * Menu position, focus, and expansion are browser presentation state.
 */

import { createObjectIdentity, type ObjectDetails } from './object-identity.js';
import type { PurchaseQuote, SaleQuote, QuoteResult, ReadingChoice } from '../books/commerce-codec.js';
import { actionPage, layoutObjectActions, maximumActionSize, chooseActionPlacement, type ActionRegion } from './object-menu-layout.js';
import { formatFunds } from './game-hud.js';

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
  readonly object?: number;
  readonly title: string;
  readonly details?: ObjectDetails;
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
    return { ...menu, object: entity, entries: [{ label: 'Clean up', enabled: person !== null, action: { kind: 'clean', surface: entity, dishes: null } },
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
  if (model && model.shelfCapacity > 0) {
    const buy = source.bookPurchaseQuote?.().quote ?? null;
    const sell = source.bookSaleQuote?.(entity).quote ?? null;
    const pending = (source.pendingBookCommands?.() ?? 0) > 0;
    const price = buy?.price ?? source.bookPurchasePrice?.();
    entries.push({ label: 'Buy book', enabled: buy !== null && !pending && buy.price <= (source.funds?.() ?? Infinity), ...(price != null ? { price } : {}), action: { kind: 'buy-book', quote: buy } },
      { label: 'Sell book', enabled: sell !== null && !pending, ...(sell ? { price: sell.price } : {}), action: { kind: 'sell-book', quote: sell } });
  }
  entries.push({ label: 'Enter build mode', enabled: true, action: { kind: 'build', object: entity } });
  if (person !== null) entries.push(NOTHING);
  return { ...menu, object: entity, entries };
}

  export const CHORE_LABELS=['Do dishes','Clean floor','Wipe surface','Empty bin','Wipe counter surfaces','Wipe table surfaces'] as const;
export function choreEntry(choreKind:number,target:number):MenuEntry {
  return {label:CHORE_LABELS[choreKind]??'Unavailable chore',action:{kind:'chore',choreKind,target}};
}
export function floorMenuEntries(kind:number,target:number):Menu{return {title:'Floor',entries:[choreEntry(kind,target),NOTHING]};}

export function dishMenuEntries(surface: number, dishes: readonly number[], hasPerson = true): Menu {
  return { title: 'Dishes', entries: [{ label: 'Do dishes', enabled: hasPerson, action: { kind: 'clean', surface, dishes } }, ...(hasPerson ? [NOTHING] : [])] };
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
    this.entries = menu.entries.map(entry => this.canActivate(entry.action) ? entry : { ...entry, enabled: false, secondary: undefined });
    this.showing = true;
    this.surface.show({ ...menu, entries: this.entries }, clientX, clientY, (index, additive) =>
      this.activate(index, additive),
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
   *
   * `additive` is passed through untouched: whether the queue modifier
   * was held is the surface's observation and the dispatcher's decision.
   */
  private activate(index: number, additive: boolean): void {
    const entry = this.entries[index];
    if (entry?.enabled === false) return;
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
export interface MenuSurfaceOptions {
  anchor?(menu: Menu): { x: number; y: number } | null;
  revision?(): string;
  keepouts?(): readonly ActionRegion[];
  dismiss?(): void;
}

export function createMenuSurface(doc: Document, root: HTMLElement, options: MenuSurfaceOptions = {}): MenuSurface {
  let returnFocus: HTMLElement | null = null;
  let disposeIdentity: (() => void) | undefined;
  let cleanup: (() => void) | undefined;
  return {
    show(menu, clientX, clientY, onPick) {
      cleanup?.(); disposeIdentity?.();
      returnFocus = doc.activeElement instanceof HTMLElement ? doc.activeElement : null;
      root.replaceChildren(); root.classList.add('object-menu-radial');
      root.setAttribute('aria-label', menu.title ? `${menu.title} actions` : 'Actions');
      root.hidden = false;
      const identity = doc.createElement('div'); identity.className = 'radial-identity';
      if (menu.details) {
        const presentation = createObjectIdentity(doc, menu.title, menu.details);
        disposeIdentity = presentation.dispose; identity.append(presentation.element);
      } else if (menu.title) {
        const name = doc.createElement('strong'); name.textContent = menu.title; identity.append(name);
      }
      root.append(identity);
      const close = doc.createElement('button'); close.type = 'button'; close.className = 'radial-close';
      close.textContent = '\u00d7'; close.setAttribute('aria-label', 'Close menu');
      close.addEventListener('click', () => options.dismiss?.()); root.append(close);
      let page = 0, capacity = 6, buttons: HTMLButtonElement[] = [];
      let revision = '', frame = 0, disposed = false;
      let measurementKey = '', measuredEntries: {width:number;height:number}[] = [], navigation = {width:44,height:44};
      const make = (label: string, activate: (event: MouseEvent) => void, entry?: MenuEntry): HTMLButtonElement => {
        const button = doc.createElement('button'); button.type = 'button'; button.className = 'menu-entry';
        button.disabled = entry?.enabled === false;
        const text = doc.createElement('span'); text.textContent = label; button.append(text);
        if (entry?.price !== undefined) {
          const price = doc.createElement('small'); price.className = 'action-price'; price.textContent = `$${formatFunds(entry.price)}`;
          button.append(price);
        }
        if (entry?.secondary) { const secondary = doc.createElement('small'); secondary.className = 'menu-secondary'; secondary.textContent = entry.secondary; button.append(secondary); }
        button.addEventListener('click', event => { event.stopPropagation(); activate(event); });
        root.append(button); return button;
      };
      const render = () => {
        buttons.forEach(button => button.remove()); buttons = [];
        const current = actionPage(menu.entries.length, capacity, page); page = current.page;
        current.indices.forEach(index => { const entry = menu.entries[index]; const button=make(entry.label,
          event => onPick(index, queueModifierHeld(event)), entry); button.dataset.menuIndex=String(index); buttons.push(button); });
        const turn = (delta: number) => {
          page += delta; render(); place();
          buttons.find(button => !button.disabled)?.focus();
        };
        if (current.back) buttons.push(make('Back', () => turn(-1)));
        if (current.more) buttons.push(make('More actions', () => turn(1)));
      };
      const place = () => {
        const view = doc.defaultView;
        if (!view || root.hidden || disposed) return;
        const anchor = menu.object !== undefined && options.anchor ? options.anchor(menu) : { x: clientX, y: clientY };
        if (!anchor) { options.dismiss?.(); return; }
        const maximumWidth = Math.max(44,Math.min(136,view.innerWidth-16));
        buttons.forEach(button => { button.style.maxWidth = `${maximumWidth}px`; });
        const nextMeasurement = `${maximumWidth}:${view.getComputedStyle(root).fontSize}`;
        if (measurementKey !== nextMeasurement) {
          measurementKey = nextMeasurement;
          const probes = [...menu.entries.map(entry => make(entry.label, () => {}, entry)), make('More actions', () => {}), make('Back', () => {})];
          probes.forEach(button => { button.style.visibility = 'hidden'; button.style.maxWidth = `${maximumWidth}px`; });
          measuredEntries = probes.slice(0,menu.entries.length).map(button=>({width:button.offsetWidth,height:button.offsetHeight}));
          navigation = maximumActionSize(probes.slice(menu.entries.length).map(button=>({width:button.offsetWidth,height:button.offsetHeight})));
          probes.forEach(button=>button.remove());
        }
        identity.style.maxHeight = ''; identity.style.overflowY = '';
        const viewport = {width:view.innerWidth,height:view.innerHeight};
        const placement = chooseActionPlacement(anchor,measuredEntries,navigation,viewport,identity.offsetHeight,options.keepouts?.() ?? []);
        if (!placement) { options.dismiss?.(); return; }
        let focusAfterPlace: HTMLButtonElement | null = null;
        if (placement.capacity !== capacity) {
          const focused=doc.activeElement as HTMLButtonElement, hadFocus=buttons.includes(focused);
          const index=focused?.dataset?.menuIndex;
          capacity=placement.capacity; page=0;
          if (index !== undefined) for (let candidate=0;candidate<=menu.entries.length;candidate++) {
            const part=actionPage(menu.entries.length,capacity,candidate);
            if (part.indices.includes(Number(index))) {page=candidate;break;}
            if (!part.more) break;
          }
          render(); buttons.forEach(button=>{button.style.maxWidth=`${maximumWidth}px`;});
          if (hadFocus) focusAfterPlace=buttons.find(button=>!button.disabled && button.dataset.menuIndex===index) ?? buttons.find(button=>!button.disabled) ?? close;
        }
        identity.style.maxHeight = `${placement.identityHeight}px`; identity.style.overflowY='auto';
        const region=placement.region, sizes=buttons.map(button=>({width:button.offsetWidth,height:button.offsetHeight}));
        const layout=layoutObjectActions(anchor,sizes,viewport,region.top,placement.scroll ? region.top+44 : region.bottom,identity.offsetHeight,region.left,region.right);
        root.dataset.compact=String(layout.compact);
        root.style.left=placement.scroll ? `${region.left}px` : '0px'; root.style.top=placement.scroll ? `${region.top}px` : '0px';
        root.style.width=placement.scroll ? `${region.right-region.left}px` : '0px'; root.style.height=placement.scroll ? `${region.bottom-region.top}px` : '0px';
        root.style.overflowY=placement.scroll ? 'auto' : ''; root.style.pointerEvents=placement.scroll ? 'auto' : 'none';
        buttons.forEach((button,index)=>{button.style.position=placement.scroll ? 'absolute' : 'fixed';button.style.left=`${layout.positions[index].x-(placement.scroll?region.left:0)}px`;button.style.top=`${layout.positions[index].y-(placement.scroll?region.top:0)}px`;});
        identity.style.position=placement.scroll ? 'absolute' : 'fixed';identity.style.left=`${layout.identity.x-(placement.scroll?region.left:0)}px`;identity.style.top=`${layout.identity.y-(placement.scroll?region.top:0)}px`;
        close.style.left=`${layout.close.x}px`;close.style.top=`${layout.close.y}px`;
        focusAfterPlace?.focus({preventScroll:!placement.scroll});
      };
      const toggle = () => place(); root.addEventListener('toggle', toggle, true);
      const observer = new ResizeObserver(() => place());
      for (const id of ['hud','time-controls','build-toggle','options-toggle','build-camera','sim-dock','builder-controls']) {
        const element=doc.getElementById(id);if(element) observer.observe(element);
      }
      observer.observe(identity);
      const navigate = (event: KeyboardEvent) => {
        if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return;
        const usable = buttons.filter(button => !button.disabled), index = usable.indexOf(doc.activeElement as HTMLButtonElement);
        if (index < 0 || !usable.length) return;
        event.preventDefault(); const delta = event.key === 'ArrowLeft' || event.key === 'ArrowUp' ? -1 : 1;
        usable[(index + delta + usable.length) % usable.length].focus();
      };
      root.addEventListener('keydown', navigate);
      const follow = () => {
        if (disposed || root.hidden) return;
        const next = options.revision?.() ?? '';
        if (next !== revision) { revision = next; place(); }
        frame = requestAnimationFrame(follow);
      };
      frame = requestAnimationFrame(follow);
      cleanup = () => { disposed = true; observer.disconnect(); cancelAnimationFrame(frame); root.removeEventListener('toggle', toggle, true); root.removeEventListener('keydown', navigate); };
      render(); place();
      if (!root.hidden) (buttons.find(button => !button.disabled) ?? close).focus();
    },
    hide() {
      cleanup?.(); cleanup = undefined; disposeIdentity?.(); disposeIdentity = undefined;
      const restore = root.contains(doc.activeElement);
      root.hidden = true; root.replaceChildren();
      if (restore) returnFocus?.focus(); returnFocus = null;
    },
  };
}
