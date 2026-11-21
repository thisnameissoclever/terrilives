import { setActionIntent, type ActionIntent } from '../ui/action-intent.js';
import { MAX_ADMIN_FUNDS_CENTS, parseDollars } from './codec.js';

// The building blocks the admin panel's tabs share (issue 312, [AP-web-modal]
// item 5 and [AP-web-focus] in docs/specs/2026-11-20-admin-panel.md): a titled
// section with a status line, a slider with its number box, a select, a check
// box and a button. A slider and a number box send one change when the player
// finishes (`change`: a slider's release, a number box's Enter or leaving it),
// never while dragging (`input`), so one adjustment is one Undo step. A typed
// number outside the shown range is clamped to it and the box shows the
// clamped value; text that is not a number puts the old value back and sends
// nothing. The tabs hold no text of their own here: every word comes from the
// caller.

export function make<K extends keyof HTMLElementTagNameMap>(doc: Document, tag: K, className?: string): HTMLElementTagNameMap[K] {
  const node = doc.createElement(tag);
  if (className) node.setAttribute('class', className);
  return node;
}

export function textNode<K extends keyof HTMLElementTagNameMap>(doc: Document, tag: K, className: string, text: string): HTMLElementTagNameMap[K] {
  const node = make(doc, tag, className);
  node.textContent = text;
  return node;
}

/** A titled block of one tab: heading, optional range, body and the status line a refusal shows in. */
export interface Section {
  readonly root: HTMLElement;
  /** Focus lands here when a control disabled by its own change held it ([L-bed-pending-focus]). */
  readonly heading: HTMLElement;
  /** Buttons that belong in the heading row, such as "Fill Tim's needs". */
  readonly actions: HTMLElement;
  readonly body: HTMLElement;
  readonly status: HTMLElement;
  /** Shows a refusal sentence; null clears it. */
  report(message: string | null): void;
  /** Sets the range beside the heading, for a range that comes from tuning. */
  setRange(text: string): void;
}

export function createSection(doc: Document, title: string, range?: string): Section {
  const root = make(doc, 'section', 'admin-section');
  const head = make(doc, 'div', 'admin-section-head');
  const heading = textNode(doc, 'h3', 'admin-section-title', title);
  heading.setAttribute('tabindex', '-1');
  const rangeNode = textNode(doc, 'span', 'admin-range', range ?? '');
  head.append(heading, rangeNode);
  const actions = make(doc, 'span', 'admin-section-actions');
  head.append(actions);
  const body = make(doc, 'div', 'admin-section-body');
  const status = make(doc, 'p', 'admin-status');
  status.setAttribute('role', 'status');
  root.append(head, body, status);
  return {
    root, heading, actions, body, status,
    report(message) { status.textContent = message ?? ''; },
    setRange(text) { rangeNode.textContent = text; },
  };
}

/** Visible and enabled: able to take focus. */
function usable(node: HTMLElement | null): node is HTMLElement {
  if (node === null || node.hidden || (node as HTMLButtonElement).disabled || node.isConnected === false) return false;
  const boxes = node.getClientRects?.();
  return boxes === undefined || boxes.length > 0;
}

/**
 * Redraws `container` from `build`, keeping focus. A control that had focus
 * is found again by its `data-key` and focused; when it is gone or disabled,
 * focus moves to `heading` so it is never left on a removed element.
 */
export function rebuild(doc: Document, container: HTMLElement, heading: HTMLElement, build: () => HTMLElement[]): void {
  const active = doc.activeElement as HTMLElement | null;
  const inside = active !== null && container.contains(active);
  const key = inside ? active.getAttribute('data-key') : null;
  container.replaceChildren(...build());
  if (!inside) return;
  const same = key === null ? null : container.querySelector<HTMLElement>(`[data-key="${key}"]`);
  (usable(same) ? same : heading).focus();
}

function formatNumber(value: number, decimals: number): string {
  return value.toFixed(decimals);
}

/** `value` clamped into the range and rounded to `decimals` places. */
export function settle(value: number, min: number, max: number, decimals: number): number {
  const clamped = Math.min(max, Math.max(min, value));
  return Number(clamped.toFixed(decimals));
}

export interface NumberControlOptions {
  readonly doc: Document;
  /** The row's accessible name; the box adds "value". */
  readonly label: string;
  /** Names the control for focus restoring: `{key}` is the slider or box, `{key}-box` the number box. */
  readonly key: string;
  readonly min: number;
  readonly max: number;
  readonly step: number;
  readonly decimals: number;
  readonly value: number;
  readonly disabled?: boolean;
  /** Called with the settled value, only when it differs from the one shown. */
  readonly onCommit: (value: number) => void;
}

export interface NumberControl {
  readonly slider: HTMLInputElement | null;
  readonly box: HTMLInputElement;
}

/** Wires a number box (and a slider when given) to one commit path. */
function wire(options: NumberControlOptions, slider: HTMLInputElement | null, box: HTMLInputElement): void {
  const { min, max, decimals } = options;
  let shown = settle(options.value, min, max, decimals);
  const show = (value: number): void => {
    shown = value;
    box.value = formatNumber(value, decimals);
    if (slider) slider.value = String(value);
  };
  const commit = (value: number): void => {
    const settled = settle(value, min, max, decimals);
    const changed = settled !== shown;
    show(settled);
    if (changed) options.onCommit(settled);
  };
  show(shown);
  slider?.addEventListener('input', () => { box.value = formatNumber(settle(Number(slider.value), min, max, decimals), decimals); });
  slider?.addEventListener('change', () => {
    const typed = Number(slider.value);
    if (Number.isFinite(typed)) commit(typed); else show(shown);
  });
  box.addEventListener('change', () => {
    const text = box.value.trim();
    const typed = text === '' ? Number.NaN : Number(text);
    if (Number.isFinite(typed)) commit(typed); else show(shown);
  });
}

function numberBox(options: NumberControlOptions): HTMLInputElement {
  const box = make(options.doc, 'input', 'admin-number');
  box.type = 'number';
  box.setAttribute('aria-label', `${options.label} value`);
  box.setAttribute('data-key', `${options.key}-box`);
  box.min = String(options.min);
  box.max = String(options.max);
  box.step = String(options.step);
  box.disabled = options.disabled === true;
  return box;
}

/** A labelled slider with its number box: `Hunger [-----o---] [62]`. */
export function sliderRow(options: NumberControlOptions, extras: readonly HTMLElement[] = []): { root: HTMLElement } & NumberControl {
  const { doc } = options;
  const root = make(doc, 'div', 'admin-row admin-slider-row');
  const label = textNode(doc, 'span', 'admin-row-label', options.label);
  const slider = make(doc, 'input', 'admin-slider');
  slider.type = 'range';
  slider.setAttribute('aria-label', options.label);
  slider.setAttribute('data-key', options.key);
  slider.min = String(options.min);
  slider.max = String(options.max);
  slider.step = String(options.step);
  slider.disabled = options.disabled === true;
  const box = numberBox(options);
  wire(options, slider, box);
  root.append(label, slider, box, ...extras);
  return { root, slider, box };
}

/** A labelled number box alone, for counts that a slider would make awkward. */
export function numberRow(options: NumberControlOptions, extras: readonly HTMLElement[] = []): { root: HTMLElement } & NumberControl {
  const { doc } = options;
  const root = make(doc, 'div', 'admin-row admin-number-row');
  const label = textNode(doc, 'span', 'admin-row-label', options.label);
  const box = numberBox(options);
  wire(options, null, box);
  root.append(label, box, ...extras);
  return { root, slider: null, box };
}

export interface SelectOption { readonly value: string; readonly label: string }

export interface SelectRowOptions {
  readonly doc: Document;
  readonly label: string;
  readonly key: string;
  readonly options: readonly SelectOption[];
  readonly value: string;
  readonly disabled?: boolean;
  /** Called with the chosen value, only when it differs from the one shown. */
  readonly onCommit: (value: string) => void;
}

/** A native select. Its accessible name is `label`; the caller decides whether to show the label beside it. */
export function selectControl(options: SelectRowOptions): HTMLSelectElement {
  const { doc } = options;
  const select = make(doc, 'select', 'admin-select');
  select.setAttribute('aria-label', options.label);
  select.setAttribute('data-key', options.key);
  select.disabled = options.disabled === true;
  for (const option of options.options) {
    const node = make(doc, 'option');
    node.value = option.value;
    node.textContent = option.label;
    select.append(node);
  }
  select.value = options.value;
  let shown = options.value;
  select.addEventListener('change', () => {
    const chosen = select.value;
    if (chosen === shown) return;
    shown = chosen;
    options.onCommit(chosen);
  });
  return select;
}

/** A labelled row around any control. */
export function labelled(doc: Document, label: string, ...controls: HTMLElement[]): HTMLElement {
  const root = make(doc, 'div', 'admin-row');
  root.append(textNode(doc, 'span', 'admin-row-label', label), ...controls);
  return root;
}

/** A check box with its visible words. */
export function checkRow(doc: Document, options: {
  readonly label: string; readonly words: string; readonly key: string; readonly checked: boolean;
  readonly onCommit: (checked: boolean) => void;
}): HTMLElement {
  const root = make(doc, 'div', 'admin-row admin-check-row');
  const box = make(doc, 'input', 'admin-check');
  box.type = 'checkbox';
  box.checked = options.checked;
  box.setAttribute('aria-label', options.label);
  box.setAttribute('data-key', options.key);
  box.addEventListener('change', () => options.onCommit(box.checked));
  root.append(textNode(doc, 'span', 'admin-row-label', options.label), box, textNode(doc, 'span', 'admin-check-words', options.words));
  return root;
}

export function actionButton(doc: Document, options: {
  readonly text: string; readonly key: string; readonly onClick: () => void;
  readonly intent?: ActionIntent; readonly disabled?: boolean; readonly name?: string;
}): HTMLButtonElement {
  const button = make(doc, 'button', 'hud-button admin-action');
  button.type = 'button';
  button.textContent = options.text;
  button.setAttribute('data-key', options.key);
  if (options.name !== undefined) button.setAttribute('aria-label', options.name);
  if (options.intent !== undefined) setActionIntent(button, options.intent);
  button.disabled = options.disabled === true;
  button.addEventListener('click', () => { if (!button.disabled) options.onClick(); });
  return button;
}

/** Cents as dollars with commas and two decimals, no dollar sign: `2,318.40`, `-0.05`. */
export function formatMoney(cents: number): string {
  const sign = cents < 0 ? '-' : '';
  const whole = Math.abs(cents);
  return `${sign}${Math.trunc(whole / 100).toLocaleString('en-US')}.${String(whole % 100).padStart(2, '0')}`;
}

export interface MoneyBoxOptions {
  readonly doc: Document;
  readonly label: string;
  readonly key: string;
  readonly cents: number;
  /** The least and most the box takes, in cents; a typed sum outside them is clamped. */
  readonly min: number;
  readonly max: number;
  readonly disabled?: boolean;
  /** Called with the settled cents, only when they differ from the ones shown. */
  readonly onCommit: (cents: number) => void;
  /** Called when the text has more than two decimal places; the box shows the old value again. */
  readonly onPlaces?: () => void;
}

/**
 * A box for a sum of money. The text becomes cents through `parseDollars`,
 * never through a float multiply, so "2318.40" is exactly 231840. Text that is
 * not dollars puts the old value back and sends nothing; a sum past the bound
 * is held to the box's range.
 */
export function moneyBox(options: MoneyBoxOptions): HTMLInputElement {
  const { doc, min, max } = options;
  const box = make(doc, 'input', 'admin-number admin-money');
  box.type = 'text';
  box.setAttribute('inputmode', 'decimal');
  box.setAttribute('autocomplete', 'off');
  box.setAttribute('aria-label', options.label);
  box.setAttribute('data-key', options.key);
  box.disabled = options.disabled === true;
  let shown = Math.min(max, Math.max(min, options.cents));
  box.value = formatMoney(shown);
  const commit = (cents: number): void => {
    const settled = Math.min(max, Math.max(min, cents));
    const changed = settled !== shown;
    shown = settled;
    box.value = formatMoney(settled);
    if (changed) options.onCommit(settled);
  };
  box.addEventListener('change', () => {
    const typed = box.value;
    const parsed = parseDollars(typed);
    if (parsed.ok) { commit(parsed.cents); return; }
    // Past the bound reads as the bound, in the direction typed; anything else is put back.
    if (parsed.reason === 'range') { commit(typed.trim().startsWith('-') ? -MAX_ADMIN_FUNDS_CENTS : MAX_ADMIN_FUNDS_CENTS); return; }
    box.value = formatMoney(shown);
    if (parsed.reason === 'places') options.onPlaces?.();
  });
  return box;
}
