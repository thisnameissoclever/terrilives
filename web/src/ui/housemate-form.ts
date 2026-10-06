/**
 * The New housemate form - [CS-command] and [CS-pages] in
 * `docs/specs/2026-09-22-create-a-sim.md`. Page 1 names the newcomer and
 * picks a personality, each described; page 2 picks up to a few traits, and
 * Move in stages one command the simulation checks whole. The form only
 * mirrors the simulation's rules so a button can be off before a refusal,
 * never instead of one: the drain's own check decides.
 *
 * The same two pages edit a living person ([ES-form] in
 * `docs/specs/2026-09-30-edit-sims.md`): filled with who they are now, with
 * a relation to each other household member on page 2, and Confirm changes
 * staging one edit ([ES-atomic]).
 */
import type { SimBridge } from '../bridge.js';

/** What the form reads from the simulation. */
import { NO_RELATION, RELATION_WORDS, relationWord } from '../bridge.js';
import type { EditTarget } from './edit-target.js';
import type { HouseholdMember } from './household-roster.js';
import { setTextIfChanged } from './set-text-if-changed.js';

export type HousemateSource = Pick<SimBridge, 'personalityLabels' | 'personalityDescriptions' |
  'traitLabels' | 'traitDescriptions' | 'householdSize' | 'housemateLimits' | 'addHousemate' |
  'lastHousemateResult' | 'select' | 'setFamilyTie' | 'editHousemate' | 'lastEditResult'>;

export const CHOOSE_NAME = 'Give them a name.';
export const HOUSEHOLD_FULL = 'The household is full.';
export const MOVING_IN = 'Moving in…';
export const NEW_TITLE = 'New housemate';
export const MOVE_IN = 'Move in';
export const EDIT_TITLE = 'Edit housemate';
export const CONFIRM_CHANGES = 'Confirm changes';
export const SAVING_CHANGES = 'Making the changes…';
export const KEEP_PERSONALITY = 'Keep current personality';
export const REMOVAL_NOTE = 'Removing a condition forgets its severity. Skills are kept.';

/** The form's two pages: who they are, then their traits. */
export type HousematePage = 'personality' | 'traits';

/** Whether the form brings a newcomer in or changes somebody already here. */
export type HousemateMode = 'create' | 'edit';

export interface HousemateFormHooks {
  /** The form's state changed; redraw. */
  changed(): void;
  /** The newcomer moved in and was selected; close the form. */
  movedIn(): void;
  /** The edit was applied to this entity; close the form and refresh. */
  edited(entity: number): void;
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
  instinct: number | null = null;
  /** Whether a move-in or an edit is on its way to the drain. */
  pending = false;
  /** The drain's move-in or edit count when this one was staged; its answer has a larger one. */
  private stagedAfter = 0;
  status = CHOOSE_NAME;
  mode: HousemateMode = 'create';
  /** The person being edited, as they were when the form opened; null in create mode. */
  target: EditTarget | null = null;
  /** Edit mode: send no personality, so the person keeps the effects they have. */
  keepPersonality = false;
  /** Relation code from the edited person's side, by relative SimId. */
  ties: Map<number, number> = new Map();
  /** The other living household members the edited person has a tie row for. */
  others: readonly HouseholdMember[] = [];

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
   * Clears the form for a fresh newcomer, on its first page. A move-in or
   * an edit still on its way is kept, so reopening the form cannot stage a
   * second one before the first is answered.
   */
  reset(): void {
    if (this.pending) {
      this.hooks.changed();
      return;
    }
    this.mode = 'create';
    this.target = null;
    this.keepPersonality = false;
    this.ties = new Map();
    this.others = [];
    this.page = 'personality';
    this.name = '';
    this.personality = 0;
    this.chosenTraits = [];
    this.instinct = null;
    this.relation = NO_RELATION;
    this.relative = null;
    this.pending = false;
    this.status = this.nameStatus();
    this.hooks.changed();
  }

  /**
   * Opens the form on a living person, filled with who they are now
   * ([ES-form]). The personality is kept unless the player picks an
   * archetype: the editor never preselects one by default
   * ([ES-personality]).
   */
  beginEdit(target: EditTarget, others: readonly HouseholdMember[]): void {
    if (this.pending) {
      this.hooks.changed();
      return;
    }
    this.mode = 'edit';
    this.target = target;
    this.others = others.filter((member) => member.simId !== target.simId);
    this.page = 'personality';
    this.name = target.name;
    this.keepPersonality = true;
    this.personality = target.personality ?? 0;
    this.chosenTraits = [...target.traits];
    this.instinct = null;
    this.relation = NO_RELATION;
    this.relative = null;
    this.ties = new Map(target.ties);
    this.status = this.nameStatus();
    this.hooks.changed();
  }

  /** Edit mode: keep the personality the person has instead of an archetype. */
  chooseKeepPersonality(): void {
    if (this.pending || this.mode !== 'edit') return;
    this.keepPersonality = true;
    this.hooks.changed();
  }

  /**
   * Edit mode: the relation the edited person is to one shown relative,
   * `NO_RELATION` for none. A relative without a row or a code the game
   * does not know is refused rather than trusted.
   */
  chooseTie(relativeSimId: number, code: number): void {
    if (this.pending || this.mode !== 'edit' || !this.ties.has(relativeSimId)) return;
    if (!Number.isInteger(code) || code < 0 || code > NO_RELATION) return;
    this.ties.set(relativeSimId, code);
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
    // Choosing an archetype replaces the personality ([ES-personality]).
    this.keepPersonality = false;
    this.hooks.changed();
  }

  setInstinct(value: number | null): void {
    if (this.pending || (value !== null && (!Number.isInteger(value) || value < 0 || value > 100))) return;
    this.instinct = value;
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

  /**
   * Whether the first page is complete: a name that fits, nothing on its
   * way, and room for one when somebody is moving in. An edit adds nobody,
   * so it works in a full household ([ES-form]).
   */
  canGoNext(): boolean {
    const name = this.trimmedName();
    return !this.pending && (this.mode === 'edit' || this.roomForOne())
      && name !== '' && [...name].length <= this.nameMaxChars;
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

  /**
   * Who this newcomer is to somebody already here, and to whom ([FM-choose]
   * in `docs/specs/2026-09-22-family.md`). `NO_RELATION` means nobody, which
   * is the default and the only answer when the household is empty.
   */
  relation = NO_RELATION;
  relative: number | null = null;

  /** Picks the relation a newcomer arrives with. */
  chooseRelation(relation: number): void {
    if (this.pending) return;
    if (relation !== NO_RELATION && relationWord(relation) === null) return;
    this.relation = relation;
    this.hooks.changed();
  }

  /**
   * Picks which household member the relation is to, by entity index. A
   * number that is not one is refused, as the personality and trait choices
   * are, rather than trusted because the view only offers real ones.
   */
  chooseRelative(entity: number | null): void {
    if (this.pending) return;
    if (entity !== null && (!Number.isSafeInteger(entity) || entity < 0)) return;
    this.relative = entity;
    this.hooks.changed();
  }

  /** Whether the confirming button may be pressed: Move in, or Confirm changes in edit mode. */
  canConfirm(): boolean {
    return this.mode === 'edit' ? this.page === 'traits' && this.canGoNext() : this.canMoveIn();
  }

  /** Moves in, or sends the edit, according to the mode. */
  confirm(): void {
    if (this.mode === 'create') {
      this.moveIn();
      return;
    }
    if (!this.canConfirm() || this.target === null) return;
    this.stagedAfter = this.source.lastEditResult()?.handled ?? 0;
    const accepted = this.source.editHousemate(
      this.target.simId,
      this.trimmedName(),
      this.keepPersonality ? null : this.personality,
      this.chosenTraits,
      [...this.ties.entries()],
    );
    if (accepted) {
      this.pending = true;
      this.status = SAVING_CHANGES;
    } else {
      this.status = 'That could not be sent.';
    }
    this.hooks.changed();
  }

  /** Stages the move-in; the drain's answer arrives through `afterCommands`. */
  moveIn(): void {
    if (this.mode !== 'create' || !this.canMoveIn()) return;
    this.stagedAfter = this.source.lastHousemateResult()?.handled ?? 0;
    const accepted = this.instinct === null
      ? this.source.addHousemate(this.trimmedName(), this.personality, this.chosenTraits)
      : this.source.addHousemate(this.trimmedName(), this.personality, this.chosenTraits, this.instinct);
    if (accepted) {
      this.pending = true;
      this.status = MOVING_IN;
    } else {
      this.status = 'That could not be sent.';
    }
    this.hooks.changed();
  }

  /** Reads the drain's answer to a move-in or an edit on its way, and only that answer. */
  afterCommands(): void {
    if (!this.pending) return;
    if (this.mode === 'edit') {
      const result = this.source.lastEditResult();
      if (result === null || result.handled <= this.stagedAfter) return;
      this.pending = false;
      if (result.reason !== null) {
        this.status = result.reason;
        this.hooks.changed();
        return;
      }
      if (result.sim !== null) this.hooks.edited(result.sim);
      else this.hooks.changed();
      return;
    }
    const result = this.source.lastHousemateResult();
    if (result === null || result.handled <= this.stagedAfter) return;
    this.pending = false;
    if (result.reason !== null) {
      this.status = result.reason;
      this.hooks.changed();
      return;
    }
    if (result.sim !== null) {
      this.source.select(result.sim);
      // [FM-choose]: the tie is its own command, sent once the newcomer
      // exists, because until the drain answers there is nobody to tie.
      if (this.relation !== NO_RELATION && this.relative !== null
        && !this.source.setFamilyTie(result.sim, this.relative, this.relation)) {
        // The queue was full, so the tie never left. Say so: the form is the
        // only way to make one, and a silent drop would leave a player
        // believing they had recorded a family they had not.
        this.status = 'They moved in, but the family tie could not be sent.';
        this.hooks.changed();
      }
    }
    this.hooks.movedIn();
  }

  /**
   * A Load replaces the world, the queued move-in or edit and the drain's
   * counts with the saved ones, so nothing is on its way any more, and the
   * form returns to create mode so an old world's answer cannot complete an
   * edit draft.
   */
  resetAfterLoad(): void {
    this.pending = false;
    this.reset();
  }

  private nameStatus(): string {
    if (this.mode === 'create' && !this.roomForOne()) return HOUSEHOLD_FULL;
    return this.trimmedName() === '' ? CHOOSE_NAME : '';
  }
}

/**
 * One choice row: a control, then the name and its sentence on their own
 * lines; no sentence line when there is none. Returns the row and its name,
 * which edit mode marks as current.
 */
function optionRow(
  document: Document,
  input: HTMLInputElement,
  name: string,
  sentence: string,
): { row: HTMLLabelElement; title: HTMLElement } {
  const row = document.createElement('label');
  row.className = 'housemate-option';
  const text = document.createElement('span');
  const title = document.createElement('span');
  title.className = 'housemate-option-name';
  title.textContent = name;
  text.append(title);
  if (sentence !== '') {
    const detail = document.createElement('span');
    detail.className = 'housemate-option-text';
    detail.textContent = sentence;
    text.append(detail);
  }
  row.append(input, text);
  return { row, title };
}

/** One option of a select, as plain as the rest of this surface. */
function option(document: Document, value: string, label: string): HTMLOptionElement {
  const element = document.createElement('option');
  element.value = value;
  element.textContent = label;
  return element;
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
  /** Each archetype's name, which edit mode suffixes with ", current". */
  private readonly personalityNames: HTMLElement[] = [];
  private readonly traitBoxes: HTMLInputElement[] = [];
  private readonly instinctGroup: HTMLFieldSetElement;
  private readonly instinctRandom: HTMLInputElement;
  private readonly instinctSlider: HTMLInputElement;
  private readonly instinctValue: HTMLOutputElement;
  private readonly title: HTMLElement;
  private readonly family: HTMLElement;
  /** Edit mode: "Keep current personality", above the archetypes. */
  private readonly keepList: HTMLElement;
  private readonly keepRadio: HTMLInputElement;
  /** Edit mode: one relation row per other household member ([ES-form]). */
  private readonly tieList: HTMLElement;
  private readonly tieSelects = new Map<number, HTMLSelectElement>();
  /** The members the tie rows were built for; a new list rebuilds them. */
  private shownOthers: readonly HouseholdMember[] | null = null;
  private readonly removalNote: HTMLElement;
  private shownPage: HousematePage | null = null;
  private wasPending = false;

  /**
   * Fills the "of whom" list with the household as it stands, which the page
   * does when the dialog opens: the household changes between openings.
   */
  setHousehold(members: readonly { entity: number; name: string }[]): void {
    const document = this.relativeSelect.ownerDocument;
    this.relativeSelect.replaceChildren();
    this.relativeSelect.append(option(document, '', 'nobody here'));
    for (const member of members) {
      this.relativeSelect.append(option(document, String(member.entity), member.name));
    }
    this.render();
  }

  private readonly relationSelect: HTMLSelectElement;
  private readonly relativeSelect: HTMLSelectElement;

  constructor(private readonly document: Document, private readonly form: HousemateForm) {
    const required = <T extends HTMLElement>(id: string): T => {
      const element = document.querySelector<T>(`#${id}`);
      if (!element) throw new Error(`Missing housemate form: ${id}`);
      return element;
    };
    this.dialog = required('housemate-dialog');
    this.relationSelect = required<HTMLSelectElement>('housemate-relation');
    this.relativeSelect = required<HTMLSelectElement>('housemate-relative');
    // Enter on a box or a radio could submit the form by the browser's
    // implicit-submission rule and close the dialog; nothing here submits.
    required('housemate-form').addEventListener('submit', (event) => event.preventDefault());
    this.personalityPage = required('housemate-page-personality');
    this.traitsPage = required('housemate-page-traits');
    this.nameInput = required('housemate-name');
    const instinctGroup = document.createElement('fieldset');
    this.instinctGroup = instinctGroup;
    instinctGroup.className = 'instinct-controls';
    const legend = document.createElement('legend');
    legend.textContent = 'Self-preservation instinct';
    const randomLabel = document.createElement('label');
    this.instinctRandom = document.createElement('input');
    this.instinctRandom.type = 'checkbox';
    this.instinctRandom.checked = true;
    const randomText = document.createElement('span');
    randomText.textContent = ' Random';
    randomLabel.append(this.instinctRandom, randomText);
    const sliderLabel = document.createElement('label');
    sliderLabel.textContent = 'Instinct: ';
    this.instinctSlider = document.createElement('input');
    this.instinctSlider.type = 'range';
    this.instinctSlider.min = '0';
    this.instinctSlider.max = '100';
    this.instinctSlider.step = '1';
    this.instinctSlider.value = '50';
    this.instinctSlider.setAttribute('aria-label', 'Self-preservation instinct');
    this.instinctSlider.setAttribute('aria-describedby', 'instinct-description');
    this.instinctValue = document.createElement('output');
    sliderLabel.append(this.instinctSlider, this.instinctValue);
    const help = document.createElement('p');
    help.id = 'instinct-description';
    help.textContent = 'Higher values favor meeting low needs. Very low values can lead to dangerous neglect.';
    instinctGroup.append(legend, randomLabel, sliderLabel, help);
    const actions = this.traitsPage.querySelector('menu');
    if (actions) actions.before(instinctGroup);
    else this.traitsPage.append(instinctGroup);
    this.instinctRandom.addEventListener('change', () => form.setInstinct(
      this.instinctRandom.checked ? null : Number(this.instinctSlider.value)));
    this.instinctSlider.addEventListener('input', () => form.setInstinct(Number(this.instinctSlider.value)));

    this.personalityList = required('housemate-personality-list');
    this.traitsList = required('housemate-traits');
    this.count = required('housemate-count');
    this.status = required('housemate-status');
    this.nextButton = required('housemate-next');
    this.backButton = required('housemate-back');
    this.confirm = required('housemate-confirm');
    this.title = required('housemate-title');
    this.family = required('housemate-family');
    this.tieList = required('housemate-ties');
    this.removalNote = required('housemate-removal-note');
    this.removalNote.textContent = REMOVAL_NOTE;
    const cancelButtons = [required<HTMLButtonElement>('housemate-cancel')];
    this.nameInput.maxLength = form.nameMaxChars;
    required('housemate-traits-legend').textContent = `Traits, up to ${form.maxTraits}`;
    // [ES-personality]: in edit mode the person keeps their personality
    // unless the player picks an archetype, so Keep comes first and is the
    // starting choice. It shares the archetypes' radio group.
    this.keepList = required('housemate-keep-personality');
    this.keepRadio = document.createElement('input');
    this.keepRadio.type = 'radio';
    this.keepRadio.name = 'housemate-personality';
    this.keepRadio.value = 'keep';
    this.keepRadio.addEventListener('change', () => form.chooseKeepPersonality());
    this.keepList.append(optionRow(document, this.keepRadio, KEEP_PERSONALITY, '').row);
    for (const [index, label] of form.personalities.entries()) {
      const radio = document.createElement('input');
      radio.type = 'radio';
      radio.name = 'housemate-personality';
      radio.value = String(index);
      radio.addEventListener('change', () => form.setPersonality(index));
      const { row, title } = optionRow(document, radio, label, form.personalityDescriptions[index] ?? '');
      this.personalityList.append(row);
      this.personalityRadios.push(radio);
      this.personalityNames.push(title);
    }
    for (const [index, label] of form.traits.entries()) {
      const box = document.createElement('input');
      box.type = 'checkbox';
      box.value = String(index);
      box.addEventListener('change', () => {
        form.toggleTrait(index);
        this.render();
      });
      this.traitsList.append(optionRow(document, box, label, form.traitDescriptions[index] ?? '').row);
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
    this.confirm.addEventListener('click', () => form.confirm());
    // [FM-choose]: the relation list is the game's, in its own order, with
    // "Nobody" first because that is the default and the common answer.
    this.relationSelect.append(option(document, String(NO_RELATION), 'Nobody'));
    for (const [index, word] of RELATION_WORDS.entries()) {
      this.relationSelect.append(option(document, String(index), word));
    }
    this.relationSelect.addEventListener('change', () => {
      form.chooseRelation(Number(this.relationSelect.value));
    });
    this.relativeSelect.addEventListener('change', () => {
      const value = this.relativeSelect.value;
      form.chooseRelative(value === '' ? null : Number(value));
    });
    this.render();
  }

  /**
   * Edit mode's relation rows: built when the form opens on a person, then
   * only kept in step, so a select the player is using is never replaced
   * under them.
   */
  private renderTies(): void {
    const form = this.form;
    if (this.shownOthers !== form.others) {
      this.shownOthers = form.others;
      this.tieSelects.clear();
      const rows = form.others.map((member) => {
        const select = this.document.createElement('select');
        select.id = `housemate-tie-${member.simId}`;
        select.append(option(this.document, String(NO_RELATION), 'Nobody'));
        for (const [code, word] of RELATION_WORDS.entries()) {
          select.append(option(this.document, String(code), word));
        }
        select.addEventListener('change', () => form.chooseTie(member.simId, Number(select.value)));
        this.tieSelects.set(member.simId, select);
        const row = this.document.createElement('label');
        row.append('They are the ', select, ` of ${member.name}`);
        return row;
      });
      this.tieList.replaceChildren(...rows);
    }
    for (const [simId, select] of this.tieSelects) {
      const value = String(form.ties.get(simId) ?? NO_RELATION);
      if (select.value !== value) select.value = value;
      select.disabled = form.pending;
    }
  }

  render(): void {
    const form = this.form;
    // [ES-form]: one dialog, titled and confirmed for what it is doing.
    const editing = form.mode === 'edit';
    setTextIfChanged(this.title, editing ? EDIT_TITLE : NEW_TITLE);
    setTextIfChanged(this.confirm, editing ? CONFIRM_CHANGES : MOVE_IN);
    this.keepList.hidden = !editing;
    this.keepRadio.checked = form.keepPersonality;
    this.keepRadio.disabled = form.pending;
    const current = editing ? form.target?.personality ?? null : null;
    for (const [index, title] of this.personalityNames.entries()) {
      const label = form.personalities[index] ?? '';
      setTextIfChanged(title, index === current ? `${label}, current` : label);
    }
    // Instinct and the newcomer's one family row are creation's; an edit
    // has a row per relative instead, and the removal warning.
    this.instinctGroup.hidden = editing;
    this.family.hidden = editing;
    this.tieList.hidden = !editing;
    this.removalNote.hidden = !editing;
    if (editing) this.renderTies();
    // [FM-choose]: the relation and who it is to, kept in step with the form.
    if (this.relationSelect.value !== String(form.relation)) {
      this.relationSelect.value = String(form.relation);
    }
    const relative = form.relative === null ? '' : String(form.relative);
    if (this.relativeSelect.value !== relative) this.relativeSelect.value = relative;
    this.relativeSelect.disabled = form.relation === NO_RELATION;
    this.instinctRandom.checked = form.instinct === null;
    this.instinctRandom.disabled = form.pending;
    this.instinctSlider.disabled = form.pending || form.instinct === null;
    if (form.instinct !== null) this.instinctSlider.value = String(form.instinct);
    this.instinctValue.textContent = form.instinct === null ? 'Random (0 to 100)' : String(form.instinct);
    const onTraits = form.page === 'traits';
    this.personalityPage.hidden = onTraits;
    this.traitsPage.hidden = !onTraits;
    if (this.nameInput.value !== form.name) this.nameInput.value = form.name;
    for (const [index, radio] of this.personalityRadios.entries()) {
      radio.checked = !form.keepPersonality && index === form.personality;
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
    this.confirm.disabled = !form.canConfirm();
    // A page change moves focus onto the new page, so a keyboard player is
    // never left on a control that has just been hidden.
    if (this.shownPage !== null && this.shownPage !== form.page) {
      const traitTarget = this.traitBoxes.find((box) => !box.disabled)
        ?? (this.confirm.disabled ? this.backButton : this.confirm);
      (onTraits ? traitTarget : this.nameInput).focus();
    } else if (this.wasPending && !form.pending && onTraits) {
      // Move in had focus and went off while it waited; a refusal leaves the
      // player on the page with focus back where they pressed, or on Back
      // when the refusal leaves Move in off, as a full household does.
      (this.confirm.disabled ? this.backButton : this.confirm).focus();
    }
    this.shownPage = form.page;
    this.wasPending = form.pending;
  }
}
