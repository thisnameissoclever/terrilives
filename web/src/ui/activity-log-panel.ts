/**
 * The activity log panel ([AL-panel] in docs/specs/2026-10-18-activity-log.md):
 * a `Log` toggle at the top right opens a non-modal right-side panel with
 * seven filter toggles, a line naming the selected housemate, and the
 * newest 200 visible lines, 200 more per Show earlier entries.
 *
 * The store fills every frame whether or not the panel is open. While the
 * panel is closed, `update` returns at once: no text, no DOM, no
 * allocation. While it is open, only new records are composed and only new
 * or merged lines touch the DOM. Filter choices last for the page session,
 * across Loads.
 */

import {
  type ComposeContext, DEFAULT_FILTERS, FILTER_ORDER, LogLines, type LogLine, lineText,
} from './activity-log-compose.js';
import { ACTIVITY_LOG_CAPACITY, type ActivityLogStore } from './activity-log-store.js';
import { PANEL_WORDS, SOMEONE, onlyInvolving } from './activity-log-words.js';
import type { HouseholdRosterSurface } from './household-roster.js';
import { setTextIfChanged } from './set-text-if-changed.js';

/** Lines rendered at first, and added by each Show earlier entries. */
export const ACTIVITY_LOG_WINDOW = 200;

/** One rendered line, owned by the view. */
export interface ActivityLogRow { readonly __row: true }

/** The DOM half, kept narrow so the controller is testable without a page. */
export interface ActivityLogView {
  reflectOpen(open: boolean): void;
  reflectToggleHidden(hidden: boolean): void;
  reflectFilter(index: number, on: boolean): void;
  /** The selected-person line, or null to hide it. */
  reflectSelected(text: string | null): void;
  /** The empty state, or null to hide it. */
  reflectEmpty(text: string | null): void;
  reflectShowEarlier(visible: boolean): void;
  /**
   * Replaces every row. With `anchor`, the row at that index of the new list
   * takes the place on screen of the old first row; with null, the list
   * scrolls to the bottom.
   */
  replaceRows(texts: readonly string[], anchor: number | null): ActivityLogRow[];
  appendRow(text: string): ActivityLogRow;
  removeRow(row: ActivityLogRow): void;
  atBottom(): boolean;
  scrollToBottom(): void;
  focusToggle(): void;
  /** Keeps the panel above the Sim dock, whose height changes. */
  fitAboveDock(): void;
}

/** The last name the shell saw for each `SimId`, so a line about someone who has left still names them. */
export class ActivityLogNames {
  private readonly names = new Map<number, string>();

  remember(members: Iterable<{ readonly simId: number; readonly name: string }>): void {
    for (const member of members) {
      if (this.names.get(member.simId) !== member.name) this.names.set(member.simId, member.name);
    }
  }

  name(simId: number): string | null { return this.names.get(simId) ?? null; }
}

/**
 * Wraps the household roster's surface so the log learns each housemate's
 * name at the roster's own cadence, with no extra reads while the panel is
 * closed.
 */
export function rememberingNames(surface: HouseholdRosterSurface, names: ActivityLogNames): HouseholdRosterSurface {
  return {
    render(members, selectedSimId, onSelect) {
      names.remember(members);
      surface.render(members, selectedSimId, onSelect);
    },
  };
}

export interface ActivityLogPanelOptions {
  readonly store: ActivityLogStore;
  readonly view: ActivityLogView;
  readonly names: ActivityLogNames;
  /** The label table, read once on the first open. */
  labels(): readonly string[];
  /** The Likes and dislikes band edges, from -1 to 1. */
  bands(): { loves: number; likes: number };
  readonly dayTicks: number;
  /** The selected housemate's `SimId`, or null. */
  selected(): number | null;
  room(kind: number, target: number): string;
  /** The HUD refresh cadence for the selection poll, in milliseconds. */
  readonly refreshMs: number;
  /** Closes the Options flyout and the Sim details sheet: one right-side surface at a time. */
  onOpen(): void;
}

class PanelContext implements ComposeContext {
  labels: readonly string[] = [];
  filters = DEFAULT_FILTERS;
  selected: number | null = null;
  bands = { loves: 0, likes: 0 };

  constructor(
    readonly dayTicks: number,
    private readonly names: ActivityLogNames,
    readonly room: (kind: number, target: number) => string,
  ) {}

  name(simId: number): string | null { return this.names.name(simId); }
}

export class ActivityLogPanel {
  private open_ = false;
  private building = false;
  private prepared = false;
  private limit = ACTIVITY_LOG_WINDOW;
  private seen = 0;
  private lastPollMs: number | null = null;
  private readonly lines = new LogLines();
  private readonly rows = new Map<LogLine, ActivityLogRow>();
  private readonly context: PanelContext;

  constructor(private readonly options: ActivityLogPanelOptions) {
    if (!Number.isFinite(options.refreshMs) || options.refreshMs <= 0) {
      throw new Error('activity log refresh interval must be positive');
    }
    this.context = new PanelContext(options.dayTicks, options.names, options.room);
    FILTER_ORDER.forEach((filter, index) => options.view.reflectFilter(index, (this.context.filters & filter) !== 0));
    options.view.reflectOpen(false);
  }

  isOpen(): boolean { return this.open_; }
  filters(): number { return this.context.filters; }

  open(): void {
    if (this.open_ || this.building) return;
    this.options.onOpen();
    this.open_ = true;
    if (!this.prepared) {
      this.context.labels = this.options.labels();
      const { loves, likes } = this.options.bands();
      this.context.bands = { loves: Math.round(loves * 100), likes: Math.round(likes * 100) };
      this.prepared = true;
    }
    this.options.view.reflectOpen(true);
    this.options.view.fitAboveDock();
    this.context.selected = this.options.selected();
    this.lastPollMs = null;
    this.limit = ACTIVITY_LOG_WINDOW;
    this.rebuild(false);
  }

  /** Closes the panel; true when it was open, so the caller can move focus. */
  close(): boolean {
    if (!this.open_) return false;
    this.open_ = false;
    this.options.view.reflectOpen(false);
    // Nothing is composed while closed; the next open recomposes from the store.
    this.lines.reset();
    this.rows.clear();
    this.options.view.replaceRows([], null);
    return true;
  }

  toggle(): boolean {
    if (this.open_) this.close();
    else this.open();
    return this.open_;
  }

  /** Escape closes an open panel, returns focus to the toggle and reports that it was handled. */
  handleKey(key: string): boolean {
    if (key !== 'Escape' || !this.close()) return false;
    this.options.view.focusToggle();
    return true;
  }

  /** Build owns the top-right corner and pauses the household: the toggle hides and the panel closes. */
  setBuilding(active: boolean): void {
    if (this.building === active) return;
    this.building = active;
    if (active) this.close();
    this.options.view.reflectToggleHidden(active);
  }

  toggleFilter(index: number): void {
    const filter = FILTER_ORDER[index];
    if (filter === undefined) return;
    this.context.filters ^= filter;
    this.options.view.reflectFilter(index, (this.context.filters & filter) !== 0);
    if (this.open_) this.rebuild(false);
  }

  showEarlier(): void {
    if (!this.open_) return;
    this.limit = Math.min(ACTIVITY_LOG_CAPACITY, this.limit + ACTIVITY_LOG_WINDOW);
    this.rebuild(true);
  }

  /** After a successful Load has emptied the store. Filters stay as they were. */
  resetAfterLoad(): void {
    this.seen = 0;
    if (this.open_) this.rebuild(false);
  }

  /** Once a frame, after the store's drain. Returns at once while closed. */
  update(nowMs: number): void {
    if (!this.open_) return;
    if (this.lastPollMs === null || nowMs - this.lastPollMs >= this.options.refreshMs) {
      this.lastPollMs = nowMs;
      this.options.view.fitAboveDock();
      const selected = this.options.selected();
      if (selected !== this.context.selected) {
        this.context.selected = selected;
        this.rebuild(false);
        return;
      }
    }
    const fresh = this.options.store.total - this.seen;
    if (fresh <= 0) return;
    this.append(fresh);
  }

  private reflectSelected(): void {
    const selected = this.context.selected;
    this.options.view.reflectSelected(selected === null ? null : onlyInvolving(this.context.name(selected) ?? SOMEONE));
  }

  /** Recomposes every line from the store and renders the newest `limit`. */
  private rebuild(anchor: boolean): void {
    const { store, view } = this.options;
    const first = anchor ? this.lines.lines.find(line => this.rows.has(line))?.seq ?? null : null;
    this.lines.reset();
    this.rows.clear();
    this.lines.add(store, 0, this.context);
    this.seen = store.total;
    const shown = this.lines.lines.slice(-this.limit);
    const kept = first === null ? -1 : shown.findIndex(line => line.seq === first);
    const rows = view.replaceRows(shown.map(line => lineText(store, line, this.context)), kept < 0 ? null : kept);
    shown.forEach((line, index) => this.rows.set(line, rows[index]));
    this.reflectSelected();
    this.reflectState();
  }

  /** Composes the `fresh` newest records and appends their lines. */
  private append(fresh: number): void {
    const { store, view } = this.options;
    const from = Math.max(0, store.length - fresh);
    this.seen = store.total;
    const changed = this.lines.add(store, from, this.context);
    if (changed.length === 0) {
      // The first records can arrive hidden: Nothing matches these filters.
      this.reflectState();
      return;
    }
    const follow = view.atBottom();
    for (const line of changed) {
      const old = this.rows.get(line);
      if (old) view.removeRow(old);
      this.rows.set(line, view.appendRow(lineText(store, line, this.context)));
    }
    this.forgetEvicted();
    this.trimRows();
    this.reflectState();
    if (follow) view.scrollToBottom();
  }

  /** Lines rise by `seq`; drop those whose newest record has left the store. */
  private forgetEvicted(): void {
    const { store } = this.options;
    if (store.length === 0) return;
    const oldest = store.seq(0);
    let evicted = 0;
    while (evicted < this.lines.lines.length && this.lines.lines[evicted].seq < oldest) evicted++;
    if (evicted === 0) return;
    for (const line of this.lines.lines.slice(0, evicted)) this.dropRow(line);
    this.lines.trim(this.lines.lines.length - evicted);
  }

  private trimRows(): void {
    const keepFrom = this.lines.lines.length - this.limit;
    for (let index = 0; index < keepFrom; index++) this.dropRow(this.lines.lines[index]);
  }

  private dropRow(line: LogLine): void {
    const row = this.rows.get(line);
    if (!row) return;
    this.options.view.removeRow(row);
    this.rows.delete(line);
  }

  private reflectState(): void {
    const { store, view } = this.options;
    const empty = this.lines.lines.length === 0;
    view.reflectEmpty(!empty ? null : store.length === 0 ? PANEL_WORDS.nothingYet : PANEL_WORDS.nothingMatches);
    view.reflectShowEarlier(this.lines.lines.length > this.limit && this.limit < ACTIVITY_LOG_CAPACITY);
  }
}

/** The page elements the panel needs. */
export interface ActivityLogElements {
  readonly toggle: HTMLButtonElement;
  readonly panel: HTMLElement;
  readonly close: HTMLButtonElement;
  readonly filters: readonly HTMLButtonElement[];
  readonly selected: HTMLElement;
  readonly scroller: HTMLElement;
  readonly earlier: HTMLButtonElement;
  readonly list: HTMLOListElement;
  readonly empty: HTMLElement;
  readonly dock: HTMLElement;
}

/**
 * Finds the panel's elements in `index.html` and gives them their words
 * from `activity-log-words.ts`, the one place those strings live. The
 * filter toggles are made here, one per filter, in panel order.
 */
export function activityLogElements(doc: Document): ActivityLogElements {
  const element = <T extends HTMLElement>(id: string): T => {
    const found = doc.getElementById(id);
    if (!found) throw new Error(`missing #${id}`);
    return found as T;
  };
  const toggle = element<HTMLButtonElement>('activity-log-toggle');
  const close = element<HTMLButtonElement>('activity-log-close');
  const earlier = element<HTMLButtonElement>('activity-log-earlier');
  const group = element('activity-log-filters');
  toggle.textContent = PANEL_WORDS.toggle;
  element('activity-log-title').textContent = PANEL_WORDS.title;
  close.textContent = PANEL_WORDS.close;
  earlier.textContent = PANEL_WORDS.showEarlier;
  const filters = PANEL_WORDS.filters.map(word => {
    const button = doc.createElement('button');
    button.type = 'button';
    button.className = 'hud-button';
    button.textContent = word;
    button.setAttribute('aria-pressed', 'false');
    return button;
  });
  group.replaceChildren(...filters);
  return {
    toggle,
    panel: element('activity-log'),
    close,
    filters,
    selected: element('activity-log-selected'),
    scroller: element('activity-log-scroller'),
    earlier,
    list: element<HTMLOListElement>('activity-log-list'),
    empty: element('activity-log-empty'),
    dock: element('sim-dock'),
  };
}

/** The DOM view over `index.html`'s panel. */
export function createActivityLogView(doc: Document, elements: ActivityLogElements): ActivityLogView {
  const { toggle, panel, filters, selected, scroller, earlier, list, empty, dock } = elements;
  const rowElements = new Map<ActivityLogRow, HTMLLIElement>();
  let lastBottom = -1;
  const row = (text: string): [ActivityLogRow, HTMLLIElement] => {
    const item = doc.createElement('li');
    item.textContent = text;
    const handle = { __row: true } as const;
    rowElements.set(handle, item);
    return [handle, item];
  };
  return {
    reflectOpen(open) {
      panel.hidden = !open;
      toggle.setAttribute('aria-expanded', String(open));
    },
    reflectToggleHidden(hidden) { toggle.hidden = hidden; },
    reflectFilter(index, on) { filters[index]?.setAttribute('aria-pressed', String(on)); },
    reflectSelected(text) {
      selected.hidden = text === null;
      setTextIfChanged(selected, text ?? '');
    },
    reflectEmpty(text) {
      empty.hidden = text === null;
      setTextIfChanged(empty, text ?? '');
    },
    reflectShowEarlier(visible) { earlier.hidden = !visible; },
    replaceRows(texts, anchor) {
      const first = anchor === null ? null : list.firstElementChild;
      const top = first ? first.getBoundingClientRect().top : 0;
      rowElements.clear();
      const handles: ActivityLogRow[] = [];
      const items = texts.map(text => {
        const [handle, item] = row(text);
        handles.push(handle);
        return item;
      });
      list.replaceChildren(...items);
      const kept = anchor === null ? undefined : items[anchor];
      if (first && kept) scroller.scrollTop += kept.getBoundingClientRect().top - top;
      else if (anchor === null) scroller.scrollTop = scroller.scrollHeight;
      return handles;
    },
    appendRow(text) {
      const [handle, item] = row(text);
      list.append(item);
      return handle;
    },
    removeRow(handle) {
      rowElements.get(handle)?.remove();
      rowElements.delete(handle);
    },
    atBottom() { return scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight <= 4; },
    scrollToBottom() { scroller.scrollTop = scroller.scrollHeight; },
    focusToggle() { toggle.focus(); },
    fitAboveDock() {
      // Numbers only, so the poll allocates nothing: the dock is fixed, so
      // its offsetTop is its distance from the top of the window.
      const view = doc.defaultView;
      if (!view) return;
      const bottom = dock.hidden ? 0 : Math.max(8, Math.round(view.innerHeight - dock.offsetTop + 6));
      if (bottom === lastBottom) return;
      lastBottom = bottom;
      if (bottom === 0) panel.style.removeProperty('--activity-log-bottom');
      else panel.style.setProperty('--activity-log-bottom', `${bottom}px`);
    },
  };
}

/** The page parts the panel's listeners need. */
export interface ActivityLogDocument {
  addEventListener(
    type: 'keydown',
    listener: (event: { readonly key: string; readonly target: unknown; readonly defaultPrevented: boolean;
      preventDefault(): void; stopPropagation(): void }) => void,
    capture: boolean,
  ): void;
}

/**
 * Wires the toggle, the Close button, the filters and Show earlier entries.
 * Escape is caught on the way down, like the Options flyout's, unless a
 * dialog or the object menu should have it.
 */
export function attachActivityLogPanel(
  doc: ActivityLogDocument,
  elements: Pick<ActivityLogElements, 'toggle' | 'close' | 'filters' | 'earlier'>,
  panel: ActivityLogPanel,
  blocked: (target: unknown) => boolean,
): void {
  elements.toggle.addEventListener('click', () => panel.toggle());
  elements.close.addEventListener('click', () => { if (panel.close()) elements.toggle.focus(); });
  elements.filters.forEach((button, index) => button.addEventListener('click', () => panel.toggleFilter(index)));
  elements.earlier.addEventListener('click', () => panel.showEarlier());
  doc.addEventListener('keydown', event => {
    if (event.defaultPrevented || blocked(event.target)) return;
    if (!panel.handleKey(event.key)) return;
    event.preventDefault();
    event.stopPropagation();
  }, true);
}
