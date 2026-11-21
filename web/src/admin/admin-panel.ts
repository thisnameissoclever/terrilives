import type { AdminApplyResult, AdminBeginResult, AdminChange, AdminUndoResult } from './codec.js';
import {
  ADMIN_WORDS,
  UNDO_WORDS,
  beginRefusalText,
  pillNote,
  refusalText,
  undoWithChange,
  type RefusalParams,
} from './admin-words.js';
import { setActionIntent } from '../ui/action-intent.js';
import '../ui/admin-panel.css';

// The admin panel's shell (issue 312, [AP-web] and [AP-undo] in
// docs/specs/2026-11-20-admin-panel.md): the dialog, its header, the tabs, the
// housemate picker the Housemate and Relationships tabs share, the pause and
// its exact restore, Undo and focus. The tabs' contents are separate modules
// that plug in through `AdminTabFactory`.
//
// Pausing is shell time, as for the review window: `OverlayPauseController`
// restores the speed chosen before opening (paused, 1x, 2x or 3x) when the last
// surface holding the pause closes, so nothing here remembers a speed.

const PAUSE_OWNER = 'admin-panel';

/** The tabs, in order. `picker` says whether the housemate picker shows under them. */
export const ADMIN_TABS = [
  { id: 'housemate', label: 'Housemate', picker: true },
  { id: 'relationships', label: 'Relationships', picker: true },
  { id: 'household', label: 'Household', picker: false },
] as const;

export type AdminTabId = typeof ADMIN_TABS[number]['id'];

/** A living housemate, by stable id. */
export interface AdminMember {
  readonly simId: number;
  readonly name: string;
}

/** What a tab passes with a change. */
export interface AdminApplyOptions {
  /** The Undo button's words for this change, from `undoLabels` in admin-words.ts. */
  readonly label: string;
  /**
   * Receives the refusal sentence, or null once a change applies, so the tab
   * can show it in the status line under the section that sent the change.
   */
  readonly report?: (message: string | null) => void;
  /** Names a refusal's sentence needs; `name` defaults to the chosen housemate. */
  readonly words?: RefusalParams;
}

/** How a skip ahead ended: ran its hours, was stopped by the player, or stopped because a housemate died. */
export type SkipResult =
  | { readonly kind: 'done'; readonly hours: number }
  | { readonly kind: 'stopped'; readonly hours: number }
  | { readonly kind: 'died'; readonly hours: number; readonly name: string };

/** Where a skip ahead stands: running with its progress, or not with how the last one ended. */
export type AdminSkipState =
  | { readonly running: true; readonly asked: number; readonly done: number }
  | { readonly running: false; readonly last: SkipResult | null };

/** What the Household tab uses to skip ahead; the shell runs it through the host ([AP-skip]). */
export interface AdminSkipControl {
  /** False when the host cannot run a skip; the tab then hides it. */
  available(): boolean;
  /** The most hours one skip runs and the hours the box starts with. */
  limits(): { readonly maxHours: number; readonly defaultHours: number };
  /**
   * Ends the session (the Undo history goes with it), locks the rest of the
   * panel and has the host run `hours`. Ignored while one runs or the panel
   * is closed.
   */
  start(hours: number): void;
  /** Asks the run to end at the end of the current frame, keeping the hours already run. */
  stop(): void;
  state(): AdminSkipState;
}

/** What the host (the frame loop) does for Skip ahead. */
export interface AdminSkipHost {
  limits(): { readonly maxHours: number; readonly defaultHours: number };
  /**
   * Starts running `hours` in game time, a budget of ticks a frame.
   * `progress` reports the whole hours run after a frame; `finish` is called
   * exactly once, unless `cancel` was called first.
   */
  start(hours: number, handlers: { progress(hoursRun: number): void; finish(result: SkipResult): void }): void;
  /** Ends the run at the end of the current frame, keeping the hours run. */
  stop(): void;
  /** Abandons the run at once with no `finish`: the world is being replaced. */
  cancel(): void;
}

/** What the shell gives each tab when it creates it. */
export interface AdminTabContext {
  readonly doc: Document;
  /** The living housemates by SimId, as read at the last refresh. */
  members(): readonly AdminMember[];
  /** The picker's choice, shared by the tabs that show the picker; null with no housemates. */
  selected(): AdminMember | null;
  /**
   * Sends one change and, when it applies, adds an Undo step. Afterwards the
   * shell tells the host, then re-reads every tab (this one included), then
   * calls `options.report`. A tab never refreshes itself after a change.
   */
  apply(change: AdminChange, options: AdminApplyOptions): AdminApplyResult;
  /** Skip ahead, which only the Household tab shows. */
  readonly skip: AdminSkipControl;
}

/** One tab's content. */
export interface AdminTab {
  /** The element placed in the tab's panel; created once, and kept for the life of the panel. */
  readonly body: HTMLElement;
  /**
   * Re-reads the world and redraws. Called when the tab is shown, when the
   * picker's choice changes, after every change and after Undo. Compare any
   * cache keyed on `LotEditState.revision` for inequality: Undo rebuilds it,
   * so it does not only rise.
   */
  refresh(): void;
  /**
   * A skip ahead started, made progress or ended; read `context.skip.state()`.
   * Called on every frame of a skip, so redraw only what changed.
   */
  skipChanged?(): void;
}

export type AdminTabFactory = (context: AdminTabContext) => AdminTab;

/** The part of the bridge the shell uses. */
export interface AdminPanelSource {
  adminBegin(): AdminBeginResult;
  adminEnd(): void;
  adminApply(change: AdminChange): AdminApplyResult;
  adminUndo(): AdminUndoResult;
  adminUndoDepth(): number;
}

/** The part of the overlay pause the shell uses. */
export interface AdminPanelPause {
  suspend(owner: string): void;
  resume(owner: string): void;
  /** The speed the player chose, 0 when paused. */
  readonly selectedSpeed: number;
}

export interface AdminPanelHost {
  /** The living housemates, in SimId order. */
  members(): readonly AdminMember[];
  /** The game's own selected housemate, which the picker starts at and never changes. */
  selectedSimId(): number | null;
  /** Where focus goes when the element that opened the panel is gone. */
  fallbackFocus(): HTMLElement | null;
  /**
   * After a change applies, or after Undo rebuilt the world. After Undo the
   * host runs the refresh Build's Cancel runs (entity indices may have
   * changed) and refreshes the HUD panels.
   */
  worldChanged?(cause: 'apply' | 'undo'): void;
  /** Tab modules that have been built; a missing one shows a plain placeholder. */
  tabs?: Partial<Record<AdminTabId, AdminTabFactory>>;
  /** Runs Skip ahead through the frame loop; without it the Household tab hides Skip. */
  skip?: AdminSkipHost;
}

const FOCUSABLE = 'button, input, select, textarea, [tabindex]';
const TEXT_INPUT_TYPES = new Set(['', 'text', 'number', 'search', 'tel', 'url', 'email', 'password']);

function make<K extends keyof HTMLElementTagNameMap>(doc: Document, tag: K, className?: string): HTMLElementTagNameMap[K] {
  const node = doc.createElement(tag);
  if (className) node.setAttribute('class', className);
  return node;
}

function span(doc: Document, className: string, text: string): HTMLSpanElement {
  const node = make(doc, 'span', className);
  node.textContent = text;
  return node;
}

/** Visible and enabled: able to take focus. */
function usable(node: HTMLElement | null): node is HTMLElement {
  if (node === null || node.hidden || (node as HTMLButtonElement).disabled || node.isConnected === false) return false;
  const boxes = node.getClientRects?.();
  return boxes === undefined || boxes.length > 0;
}

/** A text or number field, which keeps its own Ctrl+Z. */
export function editsText(target: EventTarget | null): boolean {
  const node = target as (HTMLElement & { type?: string }) | null;
  const tag = node?.tagName?.toLowerCase();
  if (tag === 'textarea') return true;
  if (node?.isContentEditable) return true;
  return tag === 'input' && TEXT_INPUT_TYPES.has((node?.type ?? '').toLowerCase());
}

export class AdminPanel {
  private readonly heading: HTMLElement;
  private readonly header: HTMLElement;
  private readonly pillLabel: HTMLElement;
  private readonly pillNote: HTMLElement;
  private readonly closeButton: HTMLButtonElement;
  private readonly undoButton: HTMLButtonElement;
  /** The words after Undo on the button; a phone hides them and the button keeps its full name. */
  private readonly undoVerb: HTMLElement;
  private readonly undoDetail: HTMLElement;
  private readonly undoStatus: HTMLElement;
  private readonly tabList: HTMLElement;
  private readonly picker: HTMLElement;
  private readonly tabButtons = new Map<AdminTabId, HTMLButtonElement>();
  private readonly panels = new Map<AdminTabId, HTMLElement>();
  private readonly tabs = new Map<AdminTabId, AdminTab>();

  private sessionOpen = false;
  /** Whether the simulation's own session is open: it is closed for the length of a skip. */
  private bridgeSession = false;
  private skipping = false;
  private skipRun = 0;
  private skipAsked = 0;
  private skipDone = 0;
  private lastSkip: SkipResult | null = null;
  private active: AdminTabId = 'housemate';
  private roster: readonly AdminMember[] = [];
  private chosen: number | null = null;
  private labels: string[] = [];
  private depth = 0;
  private undoFailed = false;
  private opener: HTMLElement | null = null;
  private alertDialog: HTMLDialogElement | null = null;
  private alertMessage: HTMLElement | null = null;
  private alertOpener: HTMLElement | null = null;

  /**
   * `dialog` is `#admin-panel` from index.html; the shell fills it. The panel
   * is created once and reused for every open.
   */
  constructor(
    private readonly doc: Document,
    readonly element: HTMLDialogElement,
    private readonly source: AdminPanelSource,
    private readonly pause: AdminPanelPause,
    private readonly host: AdminPanelHost,
  ) {
    const dialog = element;
    dialog.setAttribute('aria-labelledby', 'admin-panel-title');
    const frame = this.node('div', 'admin-frame');

    this.header = this.node('header', 'admin-header');
    this.heading = this.node('h2', 'admin-title');
    this.heading.id = 'admin-panel-title';
    this.heading.setAttribute('tabindex', '-1');
    this.heading.append(`${ADMIN_WORDS.title} `, span(doc, 'admin-cheat', ADMIN_WORDS.cheat));
    const pill = this.node('div', 'admin-pill');
    pill.setAttribute('role', 'status');
    this.pillNote = span(doc, 'admin-pill-note', '');
    this.pillLabel = span(doc, 'admin-pill-label', ADMIN_WORDS.paused);
    pill.append(this.pillLabel, this.pillNote);
    this.undoButton = this.node('button', 'hud-button admin-undo');
    this.undoButton.type = 'button';
    this.undoVerb = span(doc, 'admin-undo-verb', UNDO_WORDS.idle);
    this.undoDetail = span(doc, 'admin-undo-detail', '');
    this.undoButton.append(this.undoVerb, this.undoDetail);
    this.undoButton.addEventListener('click', () => this.undo());
    const close = this.node('button', 'hud-button admin-close');
    close.type = 'button';
    close.textContent = ADMIN_WORDS.close;
    setActionIntent(close, 'negative');
    close.addEventListener('click', () => this.close());
    this.closeButton = close;
    this.header.append(this.heading, pill, span(doc, 'admin-spacer', ''), span(doc, 'admin-hint', ADMIN_WORDS.hint), this.undoButton, close);
    this.undoStatus = this.node('p', 'admin-undo-status');
    this.undoStatus.setAttribute('role', 'status');

    const bar = this.node('div', 'admin-bar');
    this.tabList = this.node('div', 'admin-tabs');
    this.tabList.setAttribute('role', 'tablist');
    this.tabList.addEventListener('keydown', event => this.onTabKey(event as KeyboardEvent));
    this.picker = this.node('div', 'admin-picker');
    this.picker.setAttribute('role', 'group');
    this.picker.setAttribute('aria-label', ADMIN_WORDS.pickerGroup);
    bar.append(this.tabList, this.picker);

    const body = this.node('div', 'admin-body');
    for (const meta of ADMIN_TABS) {
      const button = this.node('button', 'hud-button admin-tab');
      button.type = 'button';
      button.id = `admin-tab-${meta.id}`;
      button.textContent = meta.label;
      button.setAttribute('role', 'tab');
      button.setAttribute('aria-controls', `admin-tabpanel-${meta.id}`);
      button.addEventListener('click', () => this.select(meta.id, false));
      this.tabButtons.set(meta.id, button);
      this.tabList.append(button);

      const panel = this.node('div', 'admin-tabpanel');
      panel.id = `admin-tabpanel-${meta.id}`;
      panel.setAttribute('role', 'tabpanel');
      panel.setAttribute('aria-labelledby', button.id);
      panel.hidden = true;
      this.panels.set(meta.id, panel);
      body.append(panel);
    }
    frame.append(this.header, this.undoStatus, bar, body);
    dialog.replaceChildren(frame);

    const context: AdminTabContext = {
      doc,
      members: () => this.roster,
      selected: () => this.selectedMember(),
      apply: (change, options) => this.apply(change, options),
      skip: {
        available: () => host.skip !== undefined,
        limits: () => host.skip?.limits() ?? { maxHours: 1, defaultHours: 1 },
        start: hours => this.startSkip(hours),
        stop: () => this.stopSkip(),
        state: () => this.skipState(),
      },
    };
    for (const meta of ADMIN_TABS) {
      const factory = host.tabs?.[meta.id];
      const tab = factory ? factory(context) : this.placeholder(meta.label);
      this.tabs.set(meta.id, tab);
      this.panels.get(meta.id)!.append(tab.body);
    }

    // Escape is the dialog's native cancel; it ends here with Close, so the
    // session ends and the game resumes exactly once.
    // While a skip runs Escape stops it instead and the panel stays open.
    dialog.addEventListener('cancel', event => {
      event.preventDefault();
      if (this.skipping) this.stopSkip(); else this.close();
    });
    dialog.addEventListener('close', () => this.afterClose());
    dialog.addEventListener('keydown', event => this.onKey(event as KeyboardEvent));
  }

  get isOpen(): boolean {
    return this.element.open;
  }

  /**
   * Pauses the game, begins the session and shows the panel; false, with the
   * game running as before, when it is already open or the session refused.
   * A refusal shows its reason in a small alert. `opener` takes focus back
   * when the panel closes; it defaults to the element that has focus now.
   */
  open(opener?: HTMLElement | null): boolean {
    if (this.element.open) return false;
    const focused = opener === undefined ? this.doc.activeElement as HTMLElement | null : opener;
    // With nothing focused the page's body has focus; it is no place to return to.
    const previous = focused === this.doc.body ? null : focused;
    this.pause.suspend(PAUSE_OWNER);
    let begun: AdminBeginResult;
    try {
      begun = this.source.adminBegin();
    } catch (error) {
      this.pause.resume(PAUSE_OWNER);
      throw error;
    }
    if (begun !== 'ok') {
      this.pause.resume(PAUSE_OWNER);
      this.showAlert(beginRefusalText(begun), previous);
      return false;
    }
    this.sessionOpen = true;
    this.bridgeSession = true;
    this.skipping = false;
    this.lastSkip = null;
    this.opener = previous;
    this.active = 'housemate';
    this.labels = [];
    this.depth = 0;
    this.undoFailed = false;
    this.undoStatus.textContent = '';
    this.chosen = null;
    try {
      this.syncMembers();
      this.select('housemate', false);
      this.lockControls();
      this.updateUndo();
      this.element.showModal();
    } catch (error) {
      this.afterClose();
      throw error;
    }
    // The heading, so a screen reader announces the panel.
    this.heading.focus();
    return true;
  }

  /** Closes the panel, ending the session and resuming the game; nothing happens when it is closed. */
  close(): void {
    // A skip is abandoned at once: the host stops without a finish, the session is already ended.
    if (this.skipping) {
      this.skipping = false;
      this.host.skip?.cancel();
    }
    if (this.element.open) this.element.close();
    else this.afterClose();
  }

  /** The controls Tab visits, in order, for the focus trap. */
  focusable(): HTMLElement[] {
    const roots: HTMLElement[] = [this.header, this.tabList, this.picker, this.panels.get(this.active)!];
    const found: HTMLElement[] = [];
    for (const root of roots) {
      if (root.hidden) continue;
      for (const node of Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE))) {
        if (usable(node) && node.getAttribute('tabindex') !== '-1' && !found.includes(node)) found.push(node);
      }
    }
    return found;
  }

  // ---- the session ---------------------------------------------------------

  private afterClose(): void {
    if (!this.sessionOpen) return;
    this.sessionOpen = false;
    try {
      if (this.bridgeSession) this.source.adminEnd();
    } finally {
      this.bridgeSession = false;
      this.pause.resume(PAUSE_OWNER);
    }
    const previous = this.opener;
    this.opener = null;
    this.returnFocus(previous);
  }

  private returnFocus(previous: HTMLElement | null): void {
    const target = usable(previous) ? previous : this.host.fallbackFocus();
    if (target !== null) target.focus();
  }

  private apply(change: AdminChange, options: AdminApplyOptions): AdminApplyResult {
    if (!this.sessionOpen || this.skipping) {
      options.report?.(refusalText(1, {}));
      return { applied: false, edit: 0, refusal: 1, depth: this.depth };
    }
    const result = this.source.adminApply(change);
    if (result.applied) {
      this.labels.push(options.label);
      this.reconcile(result.depth);
      this.host.worldChanged?.('apply');
    } else {
      this.reconcile(result.depth);
    }
    this.refreshAll();
    this.updateUndo();
    if (options.report) {
      if (result.applied) options.report(null);
      else options.report(refusalText(result.refusal, { name: this.selectedMember()?.name, ...options.words }));
    }
    return result;
  }

  // ---- Skip ahead ----------------------------------------------------------

  private skipState(): AdminSkipState {
    return this.skipping
      ? { running: true, asked: this.skipAsked, done: this.skipDone }
      : { running: false, last: this.lastSkip };
  }

  private startSkip(hours: number): void {
    const host = this.host.skip;
    if (host === undefined || !this.sessionOpen || this.skipping || !Number.isInteger(hours) || hours < 1) return;
    // The journal ends with the session: Skip is not undoable, and a baseline taken before it would
    // name a world that time has moved on from.
    this.source.adminEnd();
    this.bridgeSession = false;
    this.labels = [];
    this.depth = 0;
    this.undoFailed = false;
    this.undoStatus.textContent = '';
    this.skipping = true;
    this.skipAsked = hours;
    this.skipDone = 0;
    this.lastSkip = null;
    const run = ++this.skipRun;
    this.lockControls();
    this.updateUndo();
    this.refreshAll();
    host.start(hours, {
      progress: done => { if (run === this.skipRun) this.skipProgress(done); },
      finish: result => { if (run === this.skipRun) this.finishSkip(result); },
    });
  }

  private stopSkip(): void {
    if (this.skipping) this.host.skip?.stop();
  }

  private skipProgress(done: number): void {
    if (!this.skipping) return;
    this.skipDone = Math.max(0, Math.min(done, this.skipAsked));
    for (const tab of this.tabs.values()) tab.skipChanged?.();
  }

  private finishSkip(result: SkipResult): void {
    if (!this.skipping) return;
    this.skipping = false;
    this.lastSkip = result;
    const begun = this.source.adminBegin();
    if (begun !== 'ok') {
      // Nothing to undo against: close, resume the game and say why.
      this.sessionOpen = false;
      this.lockControls();
      this.pause.resume(PAUSE_OWNER);
      const previous = this.opener;
      this.opener = null;
      if (this.element.open) this.element.close();
      this.showAlert(beginRefusalText(begun), previous);
      return;
    }
    this.bridgeSession = true;
    this.lockControls();
    this.syncMembers();
    this.host.worldChanged?.('apply');
    this.refreshAll();
    this.updateUndo();
  }

  /** The controls a skip locks: Close, the tabs, the picker and the pill's words. */
  private lockControls(): void {
    const on = this.skipping;
    this.closeButton.disabled = on;
    for (const button of this.tabButtons.values()) button.disabled = on;
    this.renderPicker();
    this.pillLabel.textContent = on ? ADMIN_WORDS.skipping : ADMIN_WORDS.paused;
    this.pillNote.textContent = on ? '' : pillNote(this.pause.selectedSpeed);
  }

  // ---- Undo ----------------------------------------------------------------

  /** Keeps one label per journal entry; a count that disagrees with the bridge drops the labels. */
  private reconcile(depth: number): void {
    this.depth = depth;
    if (this.labels.length !== depth) this.labels = [];
  }

  private undo(): void {
    if (!this.sessionOpen || this.undoButton.disabled) return;
    const result = this.source.adminUndo();
    if (result === 'failed') {
      this.undoFailed = true;
      this.undoStatus.textContent = UNDO_WORDS.failed;
      this.updateUndo();
      return;
    }
    if (result === 'ok') this.labels.pop();
    this.reconcile(this.source.adminUndoDepth());
    if (result === 'ok') {
      // The world was rebuilt: entity indices may differ, so the host refreshes first.
      this.host.worldChanged?.('undo');
      this.refreshAll();
    }
    this.updateUndo();
  }

  private updateUndo(): void {
    const button = this.undoButton;
    const enabled = !this.undoFailed && this.depth > 0 && !this.skipping;
    let text: string = UNDO_WORDS.idle;
    if (enabled) text = this.labels.length === this.depth ? undoWithChange(this.labels[this.labels.length - 1]) : UNDO_WORDS.unknown;
    // A button that is about to be disabled must not hold focus.
    if (!enabled && this.doc.activeElement === button) this.tabButtons.get(this.active)!.focus();
    // Every wording starts with Undo; a phone shows that word alone, so the full words are the button's name.
    this.undoVerb.textContent = UNDO_WORDS.idle;
    this.undoDetail.textContent = text.slice(UNDO_WORDS.idle.length);
    button.setAttribute('aria-label', text);
    button.disabled = !enabled;
    button.setAttribute('title', this.undoFailed ? UNDO_WORDS.failed : enabled ? text : UNDO_WORDS.nothing);
  }

  // ---- tabs and the picker -------------------------------------------------

  private select(id: AdminTabId, focus: boolean): void {
    this.active = id;
    for (const meta of ADMIN_TABS) {
      const on = meta.id === id;
      const button = this.tabButtons.get(meta.id)!;
      button.setAttribute('aria-selected', on ? 'true' : 'false');
      button.setAttribute('tabindex', on ? '0' : '-1');
      this.panels.get(meta.id)!.hidden = !on;
    }
    this.picker.hidden = !ADMIN_TABS.find(meta => meta.id === id)!.picker;
    if (focus) this.tabButtons.get(id)!.focus();
    this.tabs.get(id)!.refresh();
  }

  private onTabKey(event: KeyboardEvent): void {
    const at = ADMIN_TABS.findIndex(meta => meta.id === this.active);
    const last = ADMIN_TABS.length - 1;
    let next: number;
    switch (event.key) {
      case 'ArrowRight': next = at === last ? 0 : at + 1; break;
      case 'ArrowLeft': next = at === 0 ? last : at - 1; break;
      case 'Home': next = 0; break;
      case 'End': next = last; break;
      default: return;
    }
    event.preventDefault();
    this.select(ADMIN_TABS[next].id, true);
  }

  /** Re-reads the roster and every tab. Hidden tabs re-read too, so none shows a stale value when it is shown. */
  private refreshAll(): void {
    this.syncMembers();
    for (const tab of this.tabs.values()) tab.refresh();
  }

  /** Re-reads the housemates and keeps the picker's choice, else falls back to the game's, else the first. */
  private syncMembers(): void {
    this.roster = this.host.members();
    const present = (id: number | null): id is number => id !== null && this.roster.some(member => member.simId === id);
    if (!present(this.chosen)) {
      const game = this.host.selectedSimId();
      this.chosen = present(game) ? game : this.roster[0]?.simId ?? null;
    }
    this.renderPicker();
  }

  private selectedMember(): AdminMember | null {
    return this.roster.find(member => member.simId === this.chosen) ?? null;
  }

  private renderPicker(): void {
    const buttons = this.roster.map(member => {
      const button = this.node('button', 'hud-button admin-person');
      button.type = 'button';
      button.textContent = member.name;
      button.setAttribute('aria-pressed', member.simId === this.chosen ? 'true' : 'false');
      button.disabled = this.skipping;
      button.addEventListener('click', () => this.choose(member.simId));
      return button;
    });
    this.picker.replaceChildren(...buttons);
  }

  private choose(simId: number): void {
    if (simId === this.chosen) return;
    this.chosen = simId;
    this.renderPicker();
    for (const tab of this.tabs.values()) tab.refresh();
  }

  private placeholder(label: string): AdminTab {
    const body = this.node('p', 'admin-placeholder');
    body.textContent = label;
    return { body, refresh() {} };
  }

  // ---- keys and focus ------------------------------------------------------

  private onKey(event: KeyboardEvent): void {
    if (event.key === 'Tab') {
      this.trapTab(event);
      return;
    }
    const chord = (event.ctrlKey || event.metaKey) && !event.altKey && !event.shiftKey && event.key.toLowerCase() === 'z';
    if (chord && !editsText(event.target)) {
      event.preventDefault();
      this.undo();
    }
  }

  /** Wraps Tab at both ends of the panel. `showModal` keeps the page inert; this keeps focus off the browser's own controls. */
  private trapTab(event: KeyboardEvent): void {
    const order = this.focusable();
    if (order.length === 0) return;
    const first = order[0];
    const last = order[order.length - 1];
    const active = this.doc.activeElement as HTMLElement | null;
    const inside = active !== null && this.element.contains(active);
    if (event.shiftKey ? !inside || active === first : !inside || active === last) {
      event.preventDefault();
      (event.shiftKey ? last : first).focus();
    }
  }

  // ---- the refusal alert ---------------------------------------------------

  /** A small alert dialog for a session that would not begin; the game is already running again. */
  private showAlert(message: string, opener: HTMLElement | null): void {
    if (this.alertDialog === null) {
      const dialog = this.node('dialog', 'admin-alert');
      dialog.setAttribute('role', 'alertdialog');
      dialog.setAttribute('aria-label', ADMIN_WORDS.title);
      const text = this.node('p', 'admin-alert-message');
      dialog.setAttribute('aria-describedby', 'admin-alert-message');
      text.id = 'admin-alert-message';
      const close = this.node('button', 'hud-button');
      close.type = 'button';
      close.textContent = ADMIN_WORDS.close;
      close.addEventListener('click', () => dialog.close());
      dialog.append(text, close);
      dialog.addEventListener('close', () => this.returnFocus(this.alertOpener));
      this.doc.body.append(dialog);
      this.alertDialog = dialog;
      this.alertMessage = text;
    }
    this.alertMessage!.textContent = message;
    this.alertOpener = opener;
    this.alertDialog.showModal();
    this.alertDialog.querySelector('button')?.focus();
  }

  private node<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string): HTMLElementTagNameMap[K] {
    return make(this.doc, tag, className);
  }
}
