import { readFileSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';
import init, { SimHandle } from '../src/wasm/terri_wasm.js';
import { NO_RELATION, SimBridge, editReason, housemateReason, type HousemateResult } from '../src/bridge.js';
import {
  CHOOSE_NAME, CONFIRM_CHANGES, EDIT_TITLE, HOUSEHOLD_FULL, HousemateForm, HousemateFormView, KEEP_PERSONALITY,
  MOVING_IN, REMOVAL_NOTE, SAVING_CHANGES,
} from '../src/ui/housemate-form.js';
import { editTargetOf } from '../src/ui/edit-target.js';
import { householdMembers } from '../src/ui/household-roster.js';

const INDEX_HTML = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const MAIN_TS = readFileSync(new URL('../src/main.ts', import.meta.url), 'utf8');
const COMPACT_HUD_CSS = readFileSync(new URL('../src/ui/compact-hud.css', import.meta.url), 'utf8');

let wasmMemory: WebAssembly.Memory;
beforeAll(async () => {
  const wasm = await init({ module_or_path: readFileSync('src/wasm/terri_wasm_bg.wasm') });
  wasmMemory = wasm.memory;
});

/** A scripted source: a household of a size, a staging log, an answer. */
class FakeHousehold {
  size = 3;
  most = 6;
  accept = true;
  staged: [string, number, number[]][] = [];
  result: HousemateResult | null = null;
  selected: number[] = [];
  /** [FM-choose]: the ties the form asked for, in the order it asked. */
  ties: [number, number, number][] = [];

  setFamilyTie(who: number, to: number, relation: number): boolean {
    this.ties.push([who, to, relation]);
    return true;
  }
  personalityLabels() { return ['The correspondent', 'The settled', 'The flitting']; }
  personalityDescriptions() { return ['Writes letters.', 'Sits down.', 'Flits about.']; }
  traitLabels() { return ['Bookworm', 'Early riser', 'Night owl', 'Tidy', 'Loud', 'Shy']; }
  traitDescriptions() { return this.traitLabels().map((label) => `About ${label.toLowerCase()}.`); }
  householdSize(): [number, number] { return [this.size, this.most]; }
  housemateLimits(): [number, number] { return [8, 2]; }
  addHousemate(name: string, personality: number, traits: readonly number[], _instinct?: number | null) {
    this.staged.push([name, personality, [...traits]]);
    return this.accept;
  }
  lastHousemateResult() { return this.result; }
  select(entity: number) { this.selected.push(entity); return true; }
  /** [ES-atomic]: the drain's answer to the last edit, and every edit staged. */
  editResult: { reason: string | null; sim: number | null; handled: number } | null = null;
  edits: unknown[] = [];
  editHousemate(sim: number, name: string, personality: number | null, traits: readonly number[], ties: readonly (readonly [number, number])[]): boolean {
    this.edits.push({ sim, name, personality, traits: [...traits], ties: ties.map((pair) => [...pair]) });
    return this.acceptEdit;
  }
  acceptEdit = true;
  lastEditResult() { return this.editResult; }
}

function form() {
  const source = new FakeHousehold();
  let changes = 0;
  let movedIn = 0;
  const edited: number[] = [];
  const housemate = new HousemateForm(source, {
    changed: () => { changes += 1; },
    movedIn: () => { movedIn += 1; },
    edited: (entity) => { edited.push(entity); },
  });
  return { housemate, source, changes: () => changes, movedIn: () => movedIn, edited: () => [...edited] };
}

// [CS-command] and [CS-pages] in docs/specs/2026-09-22-create-a-sim.md: the
// form mirrors the simulation's rules so a button is off before a refusal,
// never instead of one.
describe('HousemateForm', () => {
  it('reads its lists and limits from content and starts empty on the first page', () => {
    const { housemate } = form();
    expect(housemate.personalities).toHaveLength(3);
    expect(housemate.personalityDescriptions).toEqual(['Writes letters.', 'Sits down.', 'Flits about.']);
    expect(housemate.traits).toHaveLength(6);
    expect([housemate.nameMaxChars, housemate.maxTraits]).toEqual([8, 2]);
    expect([housemate.page, housemate.name, housemate.personality, housemate.chosenTraits, housemate.status])
      .toEqual(['personality', '', 0, [], CHOOSE_NAME]);
    expect([housemate.canGoNext(), housemate.canMoveIn()]).toEqual([false, false]);
  });

  it('needs a name that fits before the traits, and trims it', () => {
    const { housemate } = form();
    housemate.setName('   ');
    expect([housemate.canGoNext(), housemate.status]).toEqual([false, CHOOSE_NAME]);
    housemate.next();
    expect(housemate.page).toBe('personality');
    housemate.setName('  Ann  ');
    expect([housemate.trimmedName(), housemate.canGoNext(), housemate.status]).toEqual(['Ann', true, '']);
    housemate.setName('Annabella');
    expect(housemate.canGoNext()).toBe(false);
    housemate.setName('Annabell');
    expect(housemate.canGoNext()).toBe(true);
  });

  it('moves in only from the traits page, and Back keeps every choice', () => {
    const { housemate, source } = form();
    housemate.setName('Ann');
    housemate.setPersonality(2);
    expect(housemate.canMoveIn()).toBe(false);
    housemate.moveIn();
    expect(source.staged).toEqual([]);
    housemate.next();
    expect([housemate.page, housemate.canMoveIn(), housemate.status]).toEqual(['traits', true, '']);
    housemate.toggleTrait(1);
    housemate.back();
    expect([housemate.page, housemate.name, housemate.personality, housemate.chosenTraits])
      .toEqual(['personality', 'Ann', 2, [1]]);
    housemate.next();
    housemate.next();
    expect(housemate.page).toBe('traits');
    // A name emptied after Next still stops Move in.
    housemate.setName(' ');
    expect(housemate.canMoveIn()).toBe(false);
  });

  it('starts every opening on the first page', () => {
    const { housemate } = form();
    housemate.setName('Ann');
    housemate.next();
    housemate.reset();
    expect([housemate.page, housemate.name, housemate.status]).toEqual(['personality', '', CHOOSE_NAME]);
  });

  it('wears at most the tuned number of traits, each once, and only known ones', () => {
    const { housemate, changes } = form();
    housemate.toggleTrait(3);
    housemate.toggleTrait(0);
    expect(housemate.chosenTraits).toEqual([3, 0]);
    const before = changes();
    housemate.toggleTrait(5);
    expect([housemate.chosenTraits, changes()]).toEqual([[3, 0], before]);
    housemate.toggleTrait(3);
    expect(housemate.chosenTraits).toEqual([0]);
    for (const refused of [-1, 6, 1.5]) housemate.toggleTrait(refused);
    expect(housemate.chosenTraits).toEqual([0]);
    housemate.setPersonality(2);
    for (const refused of [-1, 3, 0.5]) housemate.setPersonality(refused);
    expect(housemate.personality).toBe(2);
  });

  it('is off when the household is full, and says so', () => {
    const { housemate, source } = form();
    source.size = 6;
    housemate.reset();
    housemate.setName('Ann');
    expect([housemate.roomForOne(), housemate.canGoNext(), housemate.status])
      .toEqual([false, false, HOUSEHOLD_FULL]);
  });

  it('stages the trimmed name, the personality and the traits, then selects the newcomer', () => {
    const { housemate, source, movedIn } = form();
    housemate.setName(' Ann ');
    housemate.setPersonality(1);
    housemate.next();
    housemate.toggleTrait(4);
    housemate.moveIn();
    expect(source.staged).toEqual([['Ann', 1, [4]]]);
    expect([housemate.pending, housemate.status, housemate.canMoveIn()]).toEqual([true, MOVING_IN, false]);
    // Nothing changes while the move-in is on its way, not even the page.
    housemate.setName('Bo');
    housemate.toggleTrait(0);
    housemate.setPersonality(2);
    housemate.back();
    expect([housemate.name, housemate.chosenTraits, housemate.personality, housemate.page])
      .toEqual([' Ann ', [4], 1, 'traits']);
    housemate.afterCommands();
    expect(housemate.pending).toBe(true);
    source.result = { reason: null, sim: 41, handled: 1 };
    housemate.afterCommands();
    expect([housemate.pending, source.selected, movedIn()]).toEqual([false, [41], 1]);
  });

  it('takes only the answer to its own move-in, never an older one', () => {
    const { housemate, source, movedIn } = form();
    source.result = { reason: null, sim: 7, handled: 4 };
    housemate.setName('Ann');
    housemate.next();
    housemate.moveIn();
    // The drain has not reached it: the answer on show is the fourth, from before.
    housemate.afterCommands();
    expect([housemate.pending, source.selected, movedIn()]).toEqual([true, [], 0]);
    source.result = { reason: 'The household is full.', sim: null, handled: 5 };
    housemate.afterCommands();
    expect([housemate.pending, housemate.status]).toEqual([false, 'The household is full.']);
  });

  it('keeps a move-in on its way when the form is opened again, and drops it on Load', () => {
    const { housemate } = form();
    housemate.setName('Ann');
    housemate.next();
    housemate.moveIn();
    housemate.reset();
    expect([housemate.pending, housemate.page, housemate.name, housemate.canMoveIn()])
      .toEqual([true, 'traits', 'Ann', false]);
    housemate.resetAfterLoad();
    expect([housemate.pending, housemate.page, housemate.name, housemate.status])
      .toEqual([false, 'personality', '', CHOOSE_NAME]);
  });

  it('shows the refusal and lets the player try again', () => {
    const { housemate, source, movedIn } = form();
    housemate.setName('Ann');
    housemate.next();
    housemate.moveIn();
    source.result = { reason: 'The household is full.', sim: null, handled: 1 };
    housemate.afterCommands();
    expect([housemate.pending, housemate.status, movedIn()]).toEqual([false, 'The household is full.', 0]);
    expect(housemate.canMoveIn()).toBe(true);
    source.accept = false;
    housemate.moveIn();
    expect([housemate.pending, housemate.status]).toEqual([false, 'That could not be sent.']);
  });

  it('words every refusal code', () => {
    for (const code of [1, 2, 3, 4, 5, 6, 7, 8]) expect(housemateReason(code)).toMatch(/^[A-Z].*\.$/);
    expect(housemateReason(0)).toBeNull();
    expect(housemateReason(99)).toBe('They could not move in.');
  });
});

// [ES-form] and [ES-atomic] in docs/specs/2026-09-30-edit-sims.md: the same
// two pages, filled with who the person is now, sending one edit.
describe('the form in edit mode', () => {
  const target = () => ({
    entity: 4, simId: 10, name: 'Ann', personality: 1, traits: [0, 3],
    ties: new Map([[11, 1], [12, 4]]),
  });
  const others = [{ simId: 11, entity: 5, name: 'Bill' }, { simId: 12, entity: 6, name: 'Cat' }];

  it('prefills who they are and keeps the personality unless told otherwise', () => {
    const { housemate } = form();
    housemate.beginEdit(target(), others);
    expect(housemate.mode).toBe('edit');
    expect(housemate.page).toBe('personality');
    expect(housemate.name).toBe('Ann');
    expect(housemate.keepPersonality).toBe(true);
    expect(housemate.personality).toBe(1);
    expect(housemate.chosenTraits).toEqual([0, 3]);
    expect(housemate.ties).toEqual(new Map([[11, 1], [12, 4]]));
    expect(housemate.status).toBe('');
  });

  it('edits in a full household', () => {
    const { housemate, source } = form();
    source.size = 6;
    housemate.beginEdit(target(), others);
    expect(housemate.canGoNext()).toBe(true);
    housemate.next();
    expect(housemate.canConfirm()).toBe(true);
  });

  it('sends one edit with the trimmed name, the choice of personality, the traits and every tie', () => {
    const { housemate, source, edited } = form();
    housemate.beginEdit(target(), others);
    housemate.setName('  Annie ');
    housemate.setPersonality(2);
    expect(housemate.keepPersonality).toBe(false);
    housemate.next();
    housemate.toggleTrait(3);
    housemate.chooseTie(12, 3);
    source.editResult = { reason: null, sim: 4, handled: 1 };
    housemate.confirm();
    expect(housemate.pending).toBe(true);
    expect(housemate.status).toBe('Making the changes…');
    expect(source.edits).toEqual([{ sim: 10, name: 'Annie', personality: 2, traits: [0], ties: [[11, 1], [12, 3]] }]);
    source.editResult = { reason: null, sim: 4, handled: 2 };
    housemate.afterCommands();
    expect(housemate.pending).toBe(false);
    expect(edited()).toEqual([4]);
  });

  it('keeps the current personality when Keep is chosen after an archetype', () => {
    const { housemate, source } = form();
    housemate.beginEdit(target(), others);
    housemate.setPersonality(0);
    housemate.chooseKeepPersonality();
    housemate.next();
    source.editResult = { reason: null, sim: 4, handled: 0 };
    housemate.confirm();
    expect((source.edits[0] as { personality: number | null }).personality).toBeNull();
  });

  it('shows the refusal and stays open', () => {
    const { housemate, source, edited } = form();
    housemate.beginEdit(target(), others);
    housemate.next();
    source.editResult = { reason: null, sim: 4, handled: 3 };
    housemate.confirm();
    source.editResult = { reason: 'Each relative once.', sim: null, handled: 4 };
    housemate.afterCommands();
    expect([housemate.pending, housemate.status, edited()]).toEqual([false, 'Each relative once.', []]);
  });

  it('takes only the answer to its own edit, never an older one', () => {
    const { housemate, source, edited } = form();
    housemate.beginEdit(target(), others);
    housemate.next();
    source.editResult = { reason: null, sim: 4, handled: 4 };
    housemate.confirm();
    housemate.afterCommands();
    expect([housemate.pending, edited()]).toEqual([true, []]);
  });

  it('reset returns to create mode', () => {
    const { housemate } = form();
    housemate.beginEdit(target(), others);
    housemate.reset();
    expect([housemate.mode, housemate.target, housemate.name, housemate.keepPersonality]).toEqual(['create', null, '', false]);
  });

  it('a load while an edit is pending closes the draft and ignores the old answer', () => {
    const { housemate, source, edited } = form();
    housemate.beginEdit(target(), others);
    housemate.next();
    source.editResult = { reason: null, sim: 4, handled: 0 };
    housemate.confirm();
    housemate.resetAfterLoad();
    source.editResult = { reason: null, sim: 4, handled: 1 };
    housemate.afterCommands();
    expect([housemate.mode, housemate.pending, edited()]).toEqual(['create', false, []]);
  });

  it('reads no answer while nothing is on its way, so an earlier edit cannot close a new draft', () => {
    const { housemate, source, edited } = form();
    source.editResult = { reason: null, sim: 4, handled: 7 };
    housemate.beginEdit(target(), others);
    housemate.afterCommands();
    expect([housemate.pending, edited()]).toEqual([false, []]);
  });

  it('refuses a tie to somebody not shown and a code it does not know, and holds still while pending', () => {
    const { housemate, source } = form();
    housemate.beginEdit(target(), others);
    for (const [relative, code] of [[13, 1], [11, 5], [11, -1], [11, 1.5]]) housemate.chooseTie(relative, code);
    expect(housemate.ties).toEqual(new Map([[11, 1], [12, 4]]));
    housemate.chooseTie(11, NO_RELATION);
    expect(housemate.ties.get(11)).toBe(NO_RELATION);
    housemate.next();
    housemate.confirm();
    expect([housemate.pending, housemate.status]).toEqual([true, SAVING_CHANGES]);
    housemate.chooseTie(12, 0);
    housemate.chooseKeepPersonality();
    housemate.setPersonality(2);
    housemate.beginEdit({ ...target(), name: 'Zed' }, others);
    expect([housemate.ties.get(12), housemate.keepPersonality, housemate.personality, housemate.name])
      .toEqual([4, true, 1, 'Ann']);
  });

  it('chooses Keep only in edit mode', () => {
    const { housemate } = form();
    housemate.chooseKeepPersonality();
    housemate.chooseTie(11, 1);
    expect([housemate.keepPersonality, housemate.ties]).toEqual([false, new Map()]);
  });

  it('says so when the edit could not be sent, and does not wait for an answer', () => {
    const { housemate, source } = form();
    source.acceptEdit = false;
    housemate.beginEdit(target(), others);
    housemate.next();
    housemate.confirm();
    expect([housemate.pending, housemate.status]).toEqual([false, 'That could not be sent.']);
  });

  it('confirms only from the traits page with a name that fits', () => {
    const { housemate, source } = form();
    housemate.beginEdit(target(), others);
    expect(housemate.canConfirm()).toBe(false);
    housemate.confirm();
    housemate.next();
    housemate.setName('   ');
    expect([housemate.canConfirm(), housemate.status]).toEqual([false, CHOOSE_NAME]);
    housemate.confirm();
    expect(source.edits).toEqual([]);
  });

  it('confirms a move-in in create mode', () => {
    const { housemate, source } = form();
    housemate.setName('Bo');
    housemate.next();
    expect(housemate.canConfirm()).toBe(true);
    housemate.confirm();
    expect([source.staged, source.edits]).toEqual([[['Bo', 0, []]], []]);
  });

  it('leaves the edited person out of the tie rows', () => {
    const { housemate } = form();
    housemate.beginEdit(target(), [{ simId: 10, entity: 4, name: 'Ann' }, ...others]);
    expect(housemate.others.map((member) => member.simId)).toEqual([11, 12]);
  });

  it('keeps the personality when no archetype matched', () => {
    const { housemate, source } = form();
    housemate.beginEdit({ ...target(), personality: null }, others);
    expect(housemate.keepPersonality).toBe(true);
    housemate.next();
    housemate.confirm();
    expect((source.edits[0] as { personality: number | null }).personality).toBeNull();
  });

  it('words every edit refusal plainly', () => {
    expect([1, 2, 3, 4, 5, 6, 7, 8, 9].map(editReason)).toEqual([
      'That person is no longer here.', 'Give them a name that fits.', 'That personality is not available.',
      'Choose fewer traits.', 'That trait is not available.', 'Each trait once.',
      'That relative is no longer here.', 'Each relative once.', 'They cannot be their own relative.',
    ]);
    expect(editReason(0)).toBeNull();
    expect(editReason(99)).toBe('The changes could not be made.');
  });
});

describe('HousemateFormView', () => {
  interface FakeEvent { key?: string; defaultPrevented: boolean; preventDefault(): void }
  class FakeElement {
    disabled = false;
    checked = false;
    hidden = false;
    textContent = '';
    value = '';
    name = '';
    maxLength = 0;
    type = '';
    className = '';
    closedWith: string | null = null;
    focused = 0;
    readonly children: FakeElement[] = [];
    readonly listeners = new Map<string, ((event: FakeEvent) => void)[]>();
    addEventListener(type: string, listener: (event: FakeEvent) => void) {
      this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
    }
    fire(type: string, key?: string): FakeEvent {
      const event: FakeEvent = { key, defaultPrevented: false, preventDefault() { this.defaultPrevented = true; } };
      for (const listener of this.listeners.get(type) ?? []) listener(event);
      return event;
    }
    setAttribute(_name: string, _value: string) {}
    querySelector() { return null; }
    append(...children: FakeElement[]) { this.children.push(...children); }
    replaceChildren(...children: FakeElement[]) { this.children.splice(0, this.children.length, ...children); }
    close(value: string) { this.closedWith = value; }
    focus() { this.focused += 1; }
  }

  function view() {
    const elements = new Map<string, FakeElement>();
    const doc = {
      querySelector: (selector: string) => {
        const id = selector.slice(1);
        if (!elements.has(id)) elements.set(id, new FakeElement());
        return elements.get(id);
      },
      createElement: () => new FakeElement(),
    } as unknown as Document;
    const source = new FakeHousehold();
    let formView: HousemateFormView | undefined;
    const housemate = new HousemateForm(source, {
      changed: () => formView?.render(),
      movedIn: () => {},
      edited: () => {},
    });
    formView = new HousemateFormView(doc, housemate);
    const element = (id: string) => elements.get(id)!;
    /** A row's [control, name, sentence]. */
    const row = (list: string, index: number) => {
      const [control, text] = element(list).children[index].children;
      return { control, name: text.children[0].textContent, sentence: text.children[1].textContent };
    };
    return { housemate, source, formView, element, row };
  }

  it('lists each personality as a radio with its sentence, and caps the name', () => {
    const { element, row } = view();
    expect(element('housemate-personality-list').children).toHaveLength(3);
    const settled = row('housemate-personality-list', 1);
    expect([settled.control.type, settled.control.name, settled.name, settled.sentence])
      .toEqual(['radio', 'housemate-personality', 'The settled', 'Sits down.']);
    expect(row('housemate-personality-list', 0).control.checked).toBe(true);
    expect(element('housemate-name').maxLength).toBe(8);
    expect(element('housemate-count').textContent).toBe('3 of 6 live here.');
    expect([element('housemate-page-personality').hidden, element('housemate-page-traits').hidden])
      .toEqual([false, true]);
    expect(element('housemate-next').disabled).toBe(true);
  });

  it('lists the traits with their sentences on the second page, with the limit in the legend', () => {
    const { element, row } = view();
    expect(element('housemate-traits').children).toHaveLength(6);
    const bookworm = row('housemate-traits', 0);
    expect([bookworm.control.type, bookworm.name, bookworm.sentence])
      .toEqual(['checkbox', 'Bookworm', 'About bookworm.']);
    expect(element('housemate-traits-legend').textContent).toBe('Traits, up to 2');
  });

  it('drives both pages from their controls and greys out the boxes past the limit', () => {
    const { housemate, source, element, row } = view();
    const name = element('housemate-name');
    name.value = 'Ann';
    name.fire('input');
    row('housemate-personality-list', 2).control.fire('change');
    expect(row('housemate-personality-list', 2).control.checked).toBe(true);
    expect(row('housemate-personality-list', 0).control.checked).toBe(false);
    expect(element('housemate-next').disabled).toBe(false);
    element('housemate-next').fire('click');
    expect([element('housemate-page-personality').hidden, element('housemate-page-traits').hidden])
      .toEqual([true, false]);
    const boxes = element('housemate-traits').children.map((r) => r.children[0]);
    // Focus follows the page, onto its first box.
    expect(boxes[0].focused).toBe(1);
    boxes[1].fire('change');
    boxes[5].fire('change');
    // Ticking a box leaves focus on it; only a page change or a refusal moves it.
    expect(element('housemate-confirm').focused).toBe(0);
    expect([housemate.name, housemate.personality, housemate.chosenTraits]).toEqual(['Ann', 2, [1, 5]]);
    expect(boxes.map((box) => box.disabled)).toEqual([true, false, true, true, true, false]);
    element('housemate-back').fire('click');
    expect([housemate.page, name.focused]).toEqual(['personality', 1]);
    element('housemate-next').fire('click');
    expect(element('housemate-confirm').disabled).toBe(false);
    element('housemate-confirm').fire('click');
    expect(source.staged).toEqual([['Ann', 2, [1, 5]]]);
    expect([element('housemate-back').disabled, element('housemate-status').textContent]).toEqual([true, MOVING_IN]);
  });

  it('turns Enter in the name box into Next instead of closing the dialog', () => {
    const { housemate, element } = view();
    const name = element('housemate-name');
    expect(name.fire('keydown', 'Enter').defaultPrevented).toBe(true);
    expect(housemate.page).toBe('personality');
    name.value = 'Ann';
    name.fire('input');
    expect(name.fire('keydown', 'a').defaultPrevented).toBe(false);
    name.fire('keydown', 'Enter');
    expect(housemate.page).toBe('traits');
  });

  it('returns to the first enabled trait when a full selection disables the first box', () => {
    const { housemate, element, row } = view();
    housemate.setName('Ann');
    element('housemate-next').fire('click');
    row('housemate-traits', 1).control.fire('change');
    row('housemate-traits', 5).control.fire('change');
    expect(housemate.chosenTraits).toEqual([1, 5]);
    expect(row('housemate-traits', 0).control.disabled).toBe(true);
    element('housemate-back').fire('click');
    element('housemate-next').fire('click');
    expect(row('housemate-traits', 1).control.focused).toBe(1);
    expect(row('housemate-traits', 0).control.focused).toBe(1);
    expect(element('housemate-confirm').focused).toBe(0);
  });

  it('closes the dialog from Cancel, and never lets the form submit', () => {
    const { element } = view();
    element('housemate-cancel').fire('click');
    expect(element('housemate-dialog').closedWith).toBe('cancel');
    expect(element('housemate-form').fire('submit').defaultPrevented).toBe(true);
  });

  it('puts focus back on Move in after a refusal', () => {
    const { housemate, source, element } = view();
    const name = element('housemate-name');
    name.value = 'Ann';
    name.fire('input');
    element('housemate-next').fire('click');
    const confirm = element('housemate-confirm');
    confirm.fire('click');
    expect(confirm.focused).toBe(0);
    source.result = { reason: 'The household is full.', sim: null, handled: 1 };
    // The form reads the answer after a drain; a render follows its change.
    housemate.afterCommands();
    expect([confirm.focused, element('housemate-status').textContent]).toEqual([1, 'The household is full.']);
  });

  it('puts focus on Back when a refusal leaves Move in off', () => {
    const { housemate, source, element } = view();
    const name = element('housemate-name');
    name.value = 'Ann';
    name.fire('input');
    element('housemate-next').fire('click');
    element('housemate-confirm').fire('click');
    // The household filled while the move-in waited.
    source.size = 6;
    source.result = { reason: 'The household is full.', sim: null, handled: 1 };
    housemate.afterCommands();
    expect([element('housemate-confirm').disabled, element('housemate-confirm').focused,
      element('housemate-back').focused]).toEqual([true, 0, 1]);
  });

  // [ES-form] in docs/specs/2026-09-30-edit-sims.md.
  const editTarget = () => ({
    entity: 4, simId: 10, name: 'Ann', personality: 1, traits: [0], ties: new Map([[11, 1], [12, 4]]),
  });
  const editOthers = [{ simId: 11, entity: 5, name: 'Bill' }, { simId: 12, entity: 6, name: 'Cat' }];
  /** A tie row as a player reads it: the words around the select and its chosen option. */
  const tieText = (row: FakeElement) => (row.children as (FakeElement | string)[]).map((part) => (
    typeof part === 'string' ? part : part.children.find((choice) => choice.value === part.value)?.textContent
  )).join('');
  const instinctGroup = (element: (id: string) => FakeElement) => element('housemate-page-traits').children
    .find((child) => child.className === 'instinct-controls')!;

  it('in edit mode shows the edit title, Keep current personality, a tie row per other person, and Confirm changes', () => {
    const { housemate, element, row } = view();
    housemate.beginEdit(editTarget(), editOthers);
    expect(element('housemate-title').textContent).toBe(EDIT_TITLE);
    expect(element('housemate-confirm').textContent).toBe(CONFIRM_CHANGES);
    const keepList = element('housemate-keep-personality');
    expect(keepList.hidden).toBe(false);
    const [keepRadio, keepText] = keepList.children[0].children;
    expect([keepRadio.type, keepRadio.name, keepRadio.checked, keepText.children[0].textContent])
      .toEqual(['radio', 'housemate-personality', true, KEEP_PERSONALITY]);
    const archetypes = [0, 1, 2].map((index) => row('housemate-personality-list', index));
    expect(archetypes.map((choice) => [choice.name, choice.control.checked])).toEqual([
      ['The correspondent', false], ['The settled, current', false], ['The flitting', false],
    ]);
    expect([instinctGroup(element).hidden, element('housemate-family').hidden]).toEqual([true, true]);
    const ties = element('housemate-ties');
    expect(ties.hidden).toBe(false);
    expect(ties.children.map(tieText)).toEqual(['They are the parent of Bill', 'They are the Nobody of Cat']);
    const selects = ties.children.map((tieRow) => tieRow.children[1]);
    expect(selects.map((select) => [(select as unknown as { id: string }).id, select.value]))
      .toEqual([['housemate-tie-11', '1'], ['housemate-tie-12', '4']]);
    expect(selects[0].children.map((choice) => choice.textContent))
      .toEqual(['Nobody', 'partner', 'parent', 'child', 'sibling']);
    expect([element('housemate-removal-note').hidden, element('housemate-removal-note').textContent])
      .toEqual([false, REMOVAL_NOTE]);
    expect(element('housemate-count').textContent).toBe('3 of 6 live here.');
  });

  it('marks no archetype current when none matched, and picks between Keep and an archetype', () => {
    const { housemate, element, row } = view();
    housemate.beginEdit({ ...editTarget(), personality: null }, editOthers);
    expect([0, 1, 2].map((index) => row('housemate-personality-list', index).name))
      .toEqual(['The correspondent', 'The settled', 'The flitting']);
    const keepRadio = element('housemate-keep-personality').children[0].children[0];
    expect(keepRadio.checked).toBe(true);
    row('housemate-personality-list', 2).control.fire('change');
    expect([housemate.keepPersonality, keepRadio.checked, row('housemate-personality-list', 2).control.checked])
      .toEqual([false, false, true]);
    keepRadio.fire('change');
    expect([housemate.keepPersonality, keepRadio.checked, row('housemate-personality-list', 2).control.checked])
      .toEqual([true, true, false]);
  });

  it('changes a tie from its select, keeps the same select while the player uses it, and locks it while sending', () => {
    const { housemate, source, element } = view();
    housemate.beginEdit(editTarget(), editOthers);
    element('housemate-next').fire('click');
    const ties = element('housemate-ties');
    const select = ties.children[1].children[1];
    select.value = '3';
    select.fire('change');
    expect(housemate.ties.get(12)).toBe(3);
    expect(ties.children[1].children[1]).toBe(select);
    expect(tieText(ties.children[1])).toBe('They are the sibling of Cat');
    expect(element('housemate-confirm').disabled).toBe(false);
    element('housemate-confirm').fire('click');
    expect(source.edits).toEqual([{ sim: 10, name: 'Ann', personality: null, traits: [0], ties: [[11, 1], [12, 3]] }]);
    expect(source.staged).toEqual([]);
    expect([select.disabled, element('housemate-status').textContent, element('housemate-confirm').disabled])
      .toEqual([true, SAVING_CHANGES, true]);
  });

  it('builds the tie rows again for another person', () => {
    const { housemate, element } = view();
    housemate.beginEdit(editTarget(), editOthers);
    housemate.reset();
    housemate.beginEdit({ entity: 5, simId: 11, name: 'Bill', personality: 0, traits: [], ties: new Map([[10, 2]]) },
      [{ simId: 10, entity: 4, name: 'Ann' }, { simId: 11, entity: 5, name: 'Bill' }]);
    expect(element('housemate-ties').children.map(tieText)).toEqual(['They are the child of Ann']);
  });

  it('edits in a full household, and goes back to the New housemate form on reset', () => {
    const { housemate, source, element, row } = view();
    source.size = 6;
    housemate.beginEdit(editTarget(), editOthers);
    expect([element('housemate-next').disabled, element('housemate-count').textContent, element('housemate-status').textContent])
      .toEqual([false, '6 of 6 live here.', '']);
    housemate.reset();
    expect([element('housemate-title').textContent, element('housemate-confirm').textContent]).toEqual(['New housemate', 'Move in']);
    expect([element('housemate-keep-personality').hidden, element('housemate-ties').hidden,
      element('housemate-removal-note').hidden, instinctGroup(element).hidden, element('housemate-family').hidden])
      .toEqual([true, true, true, false, false]);
    expect(row('housemate-personality-list', 1).name).toBe('The settled');
    expect(row('housemate-personality-list', 0).control.checked).toBe(true);
  });

  it('is wired into the page, with no button that submits the form', () => {
    for (const id of ['new-housemate', 'housemate-dialog', 'housemate-page-personality', 'housemate-page-traits',
      'housemate-name', 'housemate-personality', 'housemate-personality-list', 'housemate-traits',
      'housemate-traits-legend', 'housemate-count', 'housemate-status', 'housemate-cancel', 'housemate-next',
      'housemate-back', 'housemate-confirm', 'housemate-form']) {
      expect(INDEX_HTML).toContain(`id="${id}"`);
    }
    const dialog = INDEX_HTML.slice(INDEX_HTML.indexOf('<dialog id="housemate-dialog"'));
    const markup = dialog.slice(0, dialog.indexOf('</dialog>'));
    const buttons = markup.match(/<button[^>]*>/g) ?? [];
    expect(buttons).toHaveLength(4);
    for (const button of buttons) expect(button).toContain('type="button"');
    expect(markup).toContain('<div id="housemate-page-traits" hidden>');
    expect(MAIN_TS).toContain("overlayPause.suspend('housemate')");
    expect(MAIN_TS).toContain("overlayPause.resume('housemate')");
    expect(MAIN_TS).toContain('housemateForm.afterCommands();');
  });

  it('puts the Edit button beside the selected person and the edit rows on the traits page', () => {
    const header = INDEX_HTML.slice(INDEX_HTML.indexOf('<div id="sim-dock-header">'));
    const identityEnd = header.indexOf('</div>', header.indexOf('<div id="sim-identity">')) + '</div>'.length;
    expect(header.slice(identityEnd).trimStart())
      .toMatch(/^<button id="edit-housemate" class="hud-button" type="button" disabled>Edit<\/button>/);
    const dialog = INDEX_HTML.slice(INDEX_HTML.indexOf('<dialog id="housemate-dialog"'));
    const markup = dialog.slice(0, dialog.indexOf('</dialog>'));
    expect(markup.indexOf('id="housemate-keep-personality"')).toBeGreaterThan(-1);
    expect(markup.indexOf('id="housemate-keep-personality"')).toBeLessThan(markup.indexOf('id="housemate-personality-list"'));
    const traitsPage = markup.slice(markup.indexOf('<div id="housemate-page-traits"'));
    expect(traitsPage.indexOf('<div id="housemate-ties" hidden></div>')).toBeGreaterThan(traitsPage.indexOf('id="housemate-family"'));
    expect(traitsPage).toContain('<p id="housemate-removal-note" hidden>Removing a trait forgets its progress.</p>');
    // Phone layout: the header's buttons, Edit among them, and the tie selects reach 44 px.
    const phone = COMPACT_HUD_CSS.slice(COMPACT_HUD_CSS.indexOf('@media (max-width: 600px), (max-height: 480px)'));
    expect(phone).toMatch(/#sim-dock-header > \.hud-button \{ min-height: 44px;/);
    expect(INDEX_HTML).toMatch(/#housemate-ties select \{[^}]*min-height: 44px;/);
    // The family row's display: contents would outrank a bare hidden attribute.
    expect(INDEX_HTML).toContain('#housemate-family[hidden] { display: none; }');
  });

  it('wires the Edit button, its focus return and the Load path in main.ts', () => {
    expect(MAIN_TS).toContain('editTargetOf(sim, selected, members)');
    expect(MAIN_TS).toContain('housemateForm.beginEdit(target, members)');
    expect(MAIN_TS).toContain('editHousemateButton.disabled = housemateForm.pending || sim.selectedIndex() === null;');
    expect(MAIN_TS).toContain('restorePersistenceFocus(document, housemateDialog, housemateOpener');
    const loaded = MAIN_TS.slice(MAIN_TS.indexOf('if (loaded) {'));
    const loadBranch = loaded.slice(0, loaded.indexOf('housemateForm.resetAfterLoad();'));
    expect(loadBranch).toContain("if (housemateDialog.open) housemateDialog.close('cancel');");
    expect(loaded.slice(0, loaded.indexOf('wallTool.resetAfterLoad('))).toContain('syncEditHousemateButton();');
    const frame = MAIN_TS.slice(MAIN_TS.indexOf('function frame('));
    expect(frame).toContain('syncEditHousemateButton();');
  });
});

describe('the New housemate form on real wasm', () => {
  it('edits a person through the real boundary and keeps their SimId', () => {
    const bridge = new SimBridge(SimHandle.from_lot(), wasmMemory);
    const members = householdMembers(bridge);
    const tim = members.find((member) => member.name === 'Tim')!;
    const target = editTargetOf(bridge, tim.entity, members)!;
    expect(target.personality).toBe(0);
    const edited: number[] = [];
    const housemate = new HousemateForm(bridge, { changed: () => {}, movedIn: () => {}, edited: (entity) => { edited.push(entity); } });
    housemate.beginEdit(target, members);
    housemate.setName('Timothy');
    housemate.setPersonality(1);
    housemate.next();
    // Tim starts with traits 2, 3 and 11: take one off and put another on.
    expect(target.traits).toEqual([2, 3, 11]);
    housemate.toggleTrait(2);
    housemate.toggleTrait(0);
    const bill = members.find((member) => member.name === 'Bill')!;
    housemate.chooseTie(bill.simId, 3);
    housemate.confirm();
    bridge.flushCommands();
    housemate.afterCommands();
    expect(edited).toEqual([tim.entity]);
    expect(bridge.simName(tim.entity)).toBe('Timothy');
    expect(bridge.simIdOf(tim.entity)).toBe(tim.simId);
    expect(bridge.personalityIndexOf(tim.entity)).toBe(1);
    expect(editTargetOf(bridge, tim.entity, members)!.ties.get(bill.simId)).toBe(3);
    expect(editTargetOf(bridge, tim.entity, members)!.traits).toEqual([0, 3, 11]);
    // Bill reads the same tie from his side, and nobody else was touched.
    expect(editTargetOf(bridge, bill.entity, members)!.ties.get(tim.simId)).toBe(3);
    expect(bridge.householdSize()).toEqual([3, 6]);
  });

  it('moves a housemate in through the real boundary and selects them', () => {
    const bridge = new SimBridge(SimHandle.from_lot(), wasmMemory);
    expect(bridge.householdSize()).toEqual([3, 6]);
    expect(bridge.personalityLabels()).toEqual(['The correspondent', 'The settled', 'The flitting']);
    expect(bridge.personalityDescriptions().map((text) => text.split(' ')[0])).toEqual(['Up', 'Keeps', 'A']);
    expect(bridge.housemateLimits()).toEqual([24, 4]);
    let movedIn = 0;
    const housemate = new HousemateForm(bridge, { changed: () => {}, movedIn: () => { movedIn += 1; }, edited: () => {} });
    housemate.setName('Ann');
    housemate.setPersonality(1);
    housemate.next();
    housemate.toggleTrait(0);
    housemate.toggleTrait(3);
    housemate.moveIn();
    bridge.flushCommands();
    housemate.afterCommands();
    expect(movedIn).toBe(1);
    expect(bridge.householdSize()).toEqual([4, 6]);
    const result = bridge.lastHousemateResult()!;
    expect(result.reason).toBeNull();
    expect(bridge.simName(result.sim!)).toBe('Ann');
    // The selection is a command of its own, applied by the next drain.
    bridge.flushCommands();
    expect(bridge.selectedIndex()).toBe(result.sim);
  });
});

// [FM-choose] in docs/specs/2026-09-22-family.md: a newcomer arrives as
// somebody, and the tie is sent once the move-in lands.
describe('who the newcomer is', () => {
  const form2 = form;
  const movedIn = (form: HousemateForm, source: FakeHousehold, sim: number) => {
    source.result = { handled: 1, sim, reason: null };
    form.afterCommands();
  };

  it('sends the tie after the move-in, from the newcomer to the member chosen', () => {
    const { housemate: form, source } = form2();
    form.setName('Ann');
    form.next();
    form.chooseRelation(1);
    form.chooseRelative(7);
    form.moveIn();
    expect(source.ties).toEqual([]);
    movedIn(form, source, 12);
    expect(source.ties).toEqual([[12, 7, 1]]);
  });

  // Review finding [F4] on PR 131: the form is the only way to make a tie,
  // so a tie the queue refused must not vanish without a word.
  it('says so when the tie could not be sent', () => {
    const { housemate: form, source } = form2();
    source.ties = [];
    source.setFamilyTie = () => false;
    form.setName('Ann');
    form.next();
    form.chooseRelation(1);
    form.chooseRelative(7);
    form.moveIn();
    movedIn(form, source, 12);
    expect(form.status).toBe('They moved in, but the family tie could not be sent.');
  });

  it('sends no tie when the newcomer is nobody to anybody', () => {
    const { housemate: form, source } = form2();
    form.setName('Ann');
    form.next();
    form.moveIn();
    movedIn(form, source, 12);
    expect(source.ties).toEqual([]);

    // Or when a relation was chosen without saying to whom.
    const second = form2();
    second.housemate.setName('Bo');
    second.housemate.next();
    second.housemate.chooseRelation(3);
    second.housemate.moveIn();
    movedIn(second.housemate, second.source, 13);
    expect(second.source.ties).toEqual([]);
  });

  it('shows the choice in the dialog, and greys the person list until a relation is chosen', () => {
    const { housemate: form } = form2();
    const elements = new Map<string, FakeFormElement>();
    const view = new HousemateFormView(fakeFormDocument(elements) as never, form);
    view.setHousehold([{ entity: 7, name: 'Bill' }, { entity: 9, name: 'Casey' }]);

    const relation = elements.get('housemate-relation')!;
    const relative = elements.get('housemate-relative')!;
    expect(relation.children.map((child) => child.textContent))
      .toEqual(['Nobody', 'partner', 'parent', 'child', 'sibling']);
    expect(relative.children.map((child) => child.textContent))
      .toEqual(['nobody here', 'Bill', 'Casey']);
    expect(relative.disabled).toBe(true);

    relation.value = '2';
    relation.listeners.change?.();
    expect(form.relation).toBe(2);
    view.render();
    expect(relative.disabled).toBe(false);

    relative.value = '9';
    relative.listeners.change?.();
    expect(form.relative).toBe(9);
  });

  it('refuses a relation it does not know, and forgets the choice on reset', () => {
    const { housemate: form } = form2();
    form.chooseRelation(9);
    expect(form.relation).toBe(NO_RELATION);
    form.chooseRelation(2);
    form.chooseRelative(4);
    expect([form.relation, form.relative]).toEqual([2, 4]);
    form.reset();
    expect([form.relation, form.relative]).toEqual([NO_RELATION, null]);
  });
});

interface FakeFormElement {
  value: string;
  textContent: string;
  hidden: boolean;
  disabled: boolean;
  children: FakeFormElement[];
  ownerDocument: unknown;
  listeners: Record<string, (() => void) | undefined>;
  addEventListener(name: string, handler: () => void): void;
  append(...children: FakeFormElement[]): void;
  replaceChildren(): void;
  setAttribute(): void;
  removeAttribute(): void;
  querySelector(): null;
}

function fakeFormElement(document: unknown): FakeFormElement {
  const element: FakeFormElement = {
    value: '',
    textContent: '',
    hidden: false,
    disabled: false,
    children: [],
    ownerDocument: document,
    listeners: {},
    addEventListener(name, handler) { this.listeners[name] = handler; },
    append(...children) { this.children.push(...children); },
    replaceChildren() { this.children = []; },
    setAttribute() {},
    removeAttribute() {},
    querySelector: () => null,
  };
  return element;
}

function fakeFormDocument(elements: Map<string, FakeFormElement>): unknown {
  const document = {
    querySelector(selector: string): FakeFormElement {
      const id = selector.slice(1);
      let element = elements.get(id);
      if (!element) {
        element = fakeFormElement(document);
        elements.set(id, element);
      }
      return element;
    },
    createElement: () => fakeFormElement(document),
  };
  return document;
}


it('refreshes move-in availability each frame when death frees a full household slot', () => {
  const { housemate, source } = form();
  source.size = source.most;
  expect(housemate.roomForOne()).toBe(false);
  source.size -= 1;
  expect(housemate.roomForOne()).toBe(true);
  source.size = 0;
  expect(housemate.roomForOne()).toBe(true);
  const frame = MAIN_TS.slice(MAIN_TS.indexOf('function frame('));
  expect(frame.includes('syncNewHousemateButton();')).toBe(true);
});

it('keeps self-preservation random by default and accepts a chosen zero without using a trait slot', () => {
  const { housemate, source } = form();
  expect(housemate.instinct).toBeNull();
  housemate.setName('Ann');
  housemate.next();
  housemate.setInstinct(0);
  expect(housemate.chosenTraits).toEqual([]);
  let chosen: number | null | undefined;
  source.addHousemate = (_name, _personality, _traits, value?: number | null) => { chosen = value; return true; };
  housemate.setInstinct(-1);
  housemate.setInstinct(101);
  housemate.setInstinct(0.5);
  expect(housemate.instinct).toBe(0);
  housemate.moveIn();
  expect(chosen).toBe(0);
});

it('creates and saves an explicitly chosen instinct through real WASM', () => {
  const handle = SimHandle.from_lot_with_seed(123, 0xfedcba98);
  try {
    const bridge = new SimBridge(handle, wasmMemory);
    expect(bridge.addHousemate('Instinct', 0, [], 5)).toBe(true);
    bridge.flushCommands();
    const entity = bridge.lastHousemateResult()!.sim!;
    expect(bridge.selfPreservationOf(entity)).toBe(5);
    const saved = handle.save_bytes();
    expect(handle.load_bytes(saved)).toBe(true);
    expect(bridge.selfPreservationOf(entity)).toBe(5);
    expect(bridge.addHousemate('Bad', 0, [], 100.5)).toBe(false);
  } finally { handle.free(); }
});
