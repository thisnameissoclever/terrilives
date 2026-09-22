/**
 * The New housemate form - [CS-command] and [CS-pages] in
 * `docs/specs/2026-09-22-create-a-sim.md`. Page 1 names the newcomer and
 * picks a personality, each described; page 2 picks up to a few traits, and
 * Move in stages one command the simulation checks whole. The form only
 * mirrors the simulation's rules so a button can be off before a refusal,
 * never instead of one: the drain's own check decides.
 */
import type { SimBridge } from '../bridge.js';

/** What the form reads from the simulation. */
export type HousemateSource = Pick<SimBridge, 'personalityLabels' | 'personalityDescriptions' |
  'traitLabels' | 'traitDescriptions' | 'householdSize' | 'housemateLimits' | 'addHousemate' |
  'lastHousemateResult' | 'select'>;

export const CHOOSE_NAME = 'Give them a name.';
export const HOUSEHOLD_FULL = 'The household is full.';
export const MOVING_IN = 'Moving in…';

/** The form's two pages: who they are, then their traits. */
export type HousematePage = 'personality' | 'traits';

export interface HousemateFormHooks {
  /** The form's state changed; redraw. */
  changed(): void;
  /** The newcomer moved in and was selected; close the form. */
  movedIn(): void;
}

export class HousemateForm {
  readonly personalities: readonly string[];
  readonly personalityDescriptions: readonly string[];
  readonly traits: readonly string[];
  readonly traitDescriptions: readonly string[];
  readonly nameMaxChars: number;
  readonly maxTraits: number;
  page: HousematePage = 'personality';
  name = '';
  personality = 0;
  chosenTraits: number[] = [];
  /** Whether a move-in is on its way to the drain. */
  pending = false;
  /** The drain's move-in count when this one was staged; its answer has a larger one. */
  private stagedAfter = 0;
  status = CHOOSE_NAME;

  constructor(private readonly source: HousemateSource, private readonly hooks: HousemateFormHooks) {
    this.personalities = source.personalityLabels();
    this.personalityDescriptions = source.personalityDescriptions();
    this.traits = source.traitLabels();
    this.traitDescriptions = source.traitDescriptions();
    const [nameMaxChars, maxTraits] = source.housemateLimits();
    this.nameMaxChars = nameMaxChars;
    this.maxTraits = maxTraits;
  }

  /** How many people live here and the most that may. */
  household(): [number, number] {
    return this.source.householdSize();
  }

  /** Whether one more person may move in. */
  roomForOne(): boolean {
    const [size, most] = this.household();
    return size < most;
  }

  /**
   * Clears the form for a fresh newcomer, on its first page. A move-in
   * still on its way is kept, so reopening the form cannot stage a second
   * one before the first is answered.
   */
  reset(): void {
    if (this.pending) {
      this.hooks.changed();
      return;
    }
    this.page = 'personality';
    this.name = '';
    this.personality = 0;
    this.chosenTraits = [];
    this.pending = false;
    this.status = this.nameStatus();
    this.hooks.changed();
  }

  setName(name: string): void {
    if (this.pending) return;
    this.name = name;
    this.status = this.nameStatus();
    this.hooks.changed();
  }

  setPersonality(personality: number): void {
    if (this.pending) return;
    if (!Number.isInteger(personality) || personality < 0 || personality >= this.personalities.length) return;
    this.personality = personality;
    this.hooks.changed();
  }

  /** Wears or takes off one trait; a choice past the limit is ignored. */
  toggleTrait(trait: number): void {
    if (this.pending) return;
    if (!Number.isInteger(trait) || trait < 0 || trait >= this.traits.length) return;
    const at = this.chosenTraits.indexOf(trait);
    if (at >= 0) this.chosenTraits.splice(at, 1);
    else if (this.chosenTraits.length < this.maxTraits) this.chosenTraits.push(trait);
    else return;
    this.hooks.changed();
  }

  trimmedName(): string {
    return this.name.trim();
  }

  /** Whether the first page is complete: a name that fits, room for one, nothing on its way. */
  canGoNext(): boolean {
    const name = this.trimmedName();
    return !this.pending && this.roomForOne() && name !== '' && [...name].length <= this.nameMaxChars;
  }

  /** Moves on to the traits once the first page is complete. */
  next(): void {
    if (this.page !== 'personality' || !this.canGoNext()) return;
    this.page = 'traits';
    this.status = '';
    this.hooks.changed();
  }

  /** Returns to the first page, keeping every choice made so far. */
  back(): void {
    if (this.pending || this.page !== 'traits') return;
    this.page = 'personality';
    this.status = this.nameStatus();
    this.hooks.changed();
  }

  /** Whether Move in may be pressed: the traits page, with the first page still complete. */
  canMoveIn(): boolean {
    return this.page === 'traits' && this.canGoNext();
  }

  /** Stages the move-in; the drain's answer arrives through `afterCommands`. */
  moveIn(): void {
    if (!this.canMoveIn()) return;
    this.stagedAfter = this.source.lastHousemateResult()?.handled ?? 0;
    if (this.source.addHousemate(this.trimmedName(), this.personality, this.chosenTraits)) {
      this.pending = true;
      this.status = MOVING_IN;
    } else {
      this.status = 'That could not be sent.';
    }
    this.hooks.changed();
  }

  /** Reads the drain's answer to a move-in on its way, and only that answer. */
  afterCommands(): void {
    if (!this.pending) return;
    const result = this.source.lastHousemateResult();
    if (result === null || result.handled <= this.stagedAfter) return;
    this.pending = false;
    if (result.reason !== null) {
      this.status = result.reason;
      this.hooks.changed();
      return;
    }
    if (result.sim !== null) this.source.select(result.sim);
    this.hooks.movedIn();
  }

  /**
   * A Load replaces the world, the queued move-in and the drain's count with
   * the saved ones, so nothing is on its way any more.
   */
  resetAfterLoad(): void {
    this.pending = false;
    this.stagedAfter = 0;
    this.reset();
  }

  private nameStatus(): string {
    if (!this.roomForOne()) return HOUSEHOLD_FULL;
    return this.trimmedName() === '' ? CHOOSE_NAME : '';
  }
}

/** One choice row: a control, then the name and its sentence on their own lines. */
function optionRow(document: Document, input: HTMLInputElement, name: string, sentence: string): HTMLLabelElement {
  const row = document.createElement('label');
  row.className = 'housemate-option';
  const text = document.createElement('span');
  const title = document.createElement('span');
  title.className = 'housemate-option-name';
  title.textContent = name;
  const detail = document.createElement('span');
  detail.className = 'housemate-option-text';
  detail.textContent = sentence;
  text.append(title, detail);
  row.append(input, text);
  return row;
}

/** Wires the form to its dialog. */
export class HousemateFormView {
  private readonly dialog: HTMLDialogElement;
  private readonly personalityPage: HTMLElement;
  private readonly traitsPage: HTMLElement;
  private readonly nameInput: HTMLInputElement;
  private readonly personalityList: HTMLElement;
  private readonly traitsList: HTMLElement;
  private readonly count: HTMLElement;
  private readonly status: HTMLElement;
  private readonly nextButton: HTMLButtonElement;
  private readonly backButton: HTMLButtonElement;
  private readonly confirm: HTMLButtonElement;
  private readonly personalityRadios: HTMLInputElement[] = [];
  private readonly traitBoxes: HTMLInputElement[] = [];
  private shownPage: HousematePage | null = null;
  private wasPending = false;

  constructor(document: Document, private readonly form: HousemateForm) {
    const required = <T extends HTMLElement>(id: string): T => {
      const element = document.querySelector<T>(`#${id}`);
      if (!element) throw new Error(`Missing housemate form: ${id}`);
      return element;
    };
    this.dialog = required('housemate-dialog');
    // Enter on a box or a radio could submit the form by the browser's
    // implicit-submission rule and close the dialog; nothing here submits.
    required('housemate-form').addEventListener('submit', (event) => event.preventDefault());
    this.personalityPage = required('housemate-page-personality');
    this.traitsPage = required('housemate-page-traits');
    this.nameInput = required('housemate-name');
    this.personalityList = required('housemate-personality-list');
    this.traitsList = required('housemate-traits');
    this.count = required('housemate-count');
    this.status = required('housemate-status');
    this.nextButton = required('housemate-next');
    this.backButton = required('housemate-back');
    this.confirm = required('housemate-confirm');
    const cancelButtons = [required<HTMLButtonElement>('housemate-cancel')];
    this.nameInput.maxLength = form.nameMaxChars;
    required('housemate-traits-legend').textContent = `Traits, up to ${form.maxTraits}`;
    for (const [index, label] of form.personalities.entries()) {
      const radio = document.createElement('input');
      radio.type = 'radio';
      radio.name = 'housemate-personality';
      radio.value = String(index);
      radio.addEventListener('change', () => form.setPersonality(index));
      this.personalityList.append(optionRow(document, radio, label, form.personalityDescriptions[index] ?? ''));
      this.personalityRadios.push(radio);
    }
    for (const [index, label] of form.traits.entries()) {
      const box = document.createElement('input');
      box.type = 'checkbox';
      box.value = String(index);
      box.addEventListener('change', () => {
        form.toggleTrait(index);
        this.render();
      });
      this.traitsList.append(optionRow(document, box, label, form.traitDescriptions[index] ?? ''));
      this.traitBoxes.push(box);
    }
    this.nameInput.addEventListener('input', () => form.setName(this.nameInput.value));
    // Enter in the name box would submit the dialog's form and close it;
    // it moves on to the traits instead.
    this.nameInput.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter') return;
      event.preventDefault();
      form.next();
    });
    this.nextButton.addEventListener('click', () => form.next());
    this.backButton.addEventListener('click', () => form.back());
    for (const cancel of cancelButtons) cancel.addEventListener('click', () => this.dialog.close('cancel'));
    this.confirm.addEventListener('click', () => form.moveIn());
    this.render();
  }

  render(): void {
    const form = this.form;
    const onTraits = form.page === 'traits';
    this.personalityPage.hidden = onTraits;
    this.traitsPage.hidden = !onTraits;
    if (this.nameInput.value !== form.name) this.nameInput.value = form.name;
    for (const [index, radio] of this.personalityRadios.entries()) {
      radio.checked = index === form.personality;
      radio.disabled = form.pending;
    }
    const full = form.chosenTraits.length >= form.maxTraits;
    for (const [index, box] of this.traitBoxes.entries()) {
      const chosen = form.chosenTraits.includes(index);
      box.checked = chosen;
      box.disabled = form.pending || (full && !chosen);
    }
    const [size, most] = form.household();
    this.count.textContent = `${size} of ${most} live here.`;
    this.status.textContent = form.status;
    this.nameInput.disabled = form.pending;
    this.nextButton.disabled = !form.canGoNext();
    this.backButton.disabled = form.pending;
    this.confirm.disabled = !form.canMoveIn();
    // A page change moves focus onto the new page, so a keyboard player is
    // never left on a control that has just been hidden.
    if (this.shownPage !== null && this.shownPage !== form.page) {
      (onTraits ? this.traitBoxes[0] ?? this.confirm : this.nameInput).focus();
    } else if (this.wasPending && !form.pending && onTraits) {
      // Move in had focus and went off while it waited; a refusal leaves the
      // player on the page with focus back where they pressed.
      this.confirm.focus();
    }
    this.shownPage = form.page;
    this.wasPending = form.pending;
  }
}
