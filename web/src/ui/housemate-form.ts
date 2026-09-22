/**
 * The New housemate form - [CS-command] in
 * `docs/specs/2026-09-22-create-a-sim.md`. The player names the newcomer,
 * picks a personality and up to a few traits, and Move in stages one command
 * the simulation checks whole. The form only mirrors the simulation's rules
 * so the button can be off before a refusal, never instead of one: the
 * drain's own check decides.
 */
import type { SimBridge } from '../bridge.js';

/** What the form reads from the simulation. */
export type HousemateSource = Pick<SimBridge, 'personalityLabels' | 'traitLabels' |
  'traitDescriptions' | 'householdSize' | 'housemateLimits' | 'addHousemate' |
  'lastHousemateResult' | 'select'>;

export const CHOOSE_NAME = 'Give them a name.';
export const HOUSEHOLD_FULL = 'The household is full.';
export const MOVING_IN = 'Moving in…';

export interface HousemateFormHooks {
  /** The form's state changed; redraw. */
  changed(): void;
  /** The newcomer moved in and was selected; close the form. */
  movedIn(): void;
}

export class HousemateForm {
  readonly personalities: readonly string[];
  readonly traits: readonly string[];
  readonly traitDescriptions: readonly string[];
  readonly nameMaxChars: number;
  readonly maxTraits: number;
  name = '';
  personality = 0;
  chosenTraits: number[] = [];
  /** Whether a move-in is on its way to the drain. */
  pending = false;
  status = CHOOSE_NAME;

  constructor(private readonly source: HousemateSource, private readonly hooks: HousemateFormHooks) {
    this.personalities = source.personalityLabels();
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

  /** Clears the form for a fresh newcomer. */
  reset(): void {
    this.name = '';
    this.personality = 0;
    this.chosenTraits = [];
    this.pending = false;
    this.status = this.roomForOne() ? CHOOSE_NAME : HOUSEHOLD_FULL;
    this.hooks.changed();
  }

  setName(name: string): void {
    if (this.pending) return;
    this.name = name;
    this.status = this.roomForOne() ? (this.trimmedName() === '' ? CHOOSE_NAME : 'Ready to move in.')
      : HOUSEHOLD_FULL;
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

  /** Whether Move in may be pressed: a name, room for one, nothing on its way. */
  canMoveIn(): boolean {
    const name = this.trimmedName();
    return !this.pending && this.roomForOne() && name !== '' && [...name].length <= this.nameMaxChars;
  }

  /** Stages the move-in; the drain's answer arrives through `afterCommands`. */
  moveIn(): void {
    if (!this.canMoveIn()) return;
    if (this.source.addHousemate(this.trimmedName(), this.personality, this.chosenTraits)) {
      this.pending = true;
      this.status = MOVING_IN;
    } else {
      this.status = 'That could not be sent.';
    }
    this.hooks.changed();
  }

  /** Reads the drain's answer to a move-in on its way. */
  afterCommands(): void {
    if (!this.pending) return;
    const result = this.source.lastHousemateResult();
    if (result === null) return;
    this.pending = false;
    if (result.reason !== null) {
      this.status = result.reason;
      this.hooks.changed();
      return;
    }
    if (result.sim !== null) this.source.select(result.sim);
    this.hooks.movedIn();
  }
}

/** Wires the form to its dialog. */
export class HousemateFormView {
  private readonly nameInput: HTMLInputElement;
  private readonly personalitySelect: HTMLSelectElement;
  private readonly traitsList: HTMLElement;
  private readonly count: HTMLElement;
  private readonly status: HTMLElement;
  private readonly confirm: HTMLButtonElement;
  private readonly traitBoxes: HTMLInputElement[] = [];

  constructor(document: Document, private readonly form: HousemateForm) {
    const required = <T extends HTMLElement>(id: string): T => {
      const element = document.querySelector<T>(`#${id}`);
      if (!element) throw new Error(`Missing housemate form: ${id}`);
      return element;
    };
    this.nameInput = required('housemate-name');
    this.personalitySelect = required('housemate-personality');
    this.traitsList = required('housemate-traits');
    this.count = required('housemate-count');
    this.status = required('housemate-status');
    this.confirm = required('housemate-confirm');
    this.nameInput.maxLength = form.nameMaxChars;
    for (const [index, label] of form.personalities.entries()) {
      const option = document.createElement('option');
      option.value = String(index);
      option.textContent = label;
      this.personalitySelect.append(option);
    }
    for (const [index, label] of form.traits.entries()) {
      const row = document.createElement('label');
      row.className = 'housemate-trait';
      const box = document.createElement('input');
      box.type = 'checkbox';
      box.value = String(index);
      box.addEventListener('change', () => {
        form.toggleTrait(index);
        this.render();
      });
      const text = document.createElement('span');
      text.textContent = `${label}: ${form.traitDescriptions[index] ?? ''}`;
      row.append(box, text);
      this.traitsList.append(row);
      this.traitBoxes.push(box);
    }
    this.nameInput.addEventListener('input', () => form.setName(this.nameInput.value));
    this.personalitySelect.addEventListener('change', () => {
      form.setPersonality(Number(this.personalitySelect.value));
    });
    this.confirm.addEventListener('click', (event) => {
      event.preventDefault();
      form.moveIn();
    });
    this.render();
  }

  render(): void {
    const form = this.form;
    if (this.nameInput.value !== form.name) this.nameInput.value = form.name;
    this.personalitySelect.value = String(form.personality);
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
    this.personalitySelect.disabled = form.pending;
    this.confirm.disabled = !form.canMoveIn();
  }
}
