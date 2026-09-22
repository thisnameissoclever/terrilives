import { readFileSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';
import init, { SimHandle } from '../src/wasm/terri_wasm.js';
import { SimBridge, housemateReason, type HousemateResult } from '../src/bridge.js';
import {
  CHOOSE_NAME, HOUSEHOLD_FULL, HousemateForm, HousemateFormView, MOVING_IN,
} from '../src/ui/housemate-form.js';

const INDEX_HTML = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const MAIN_TS = readFileSync(new URL('../src/main.ts', import.meta.url), 'utf8');

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
  personalityLabels() { return ['The correspondent', 'The settled', 'The flitting']; }
  personalityDescriptions() { return ['Writes letters.', 'Sits down.', 'Flits about.']; }
  traitLabels() { return ['Bookworm', 'Early riser', 'Night owl', 'Tidy', 'Loud', 'Shy']; }
  traitDescriptions() { return this.traitLabels().map((label) => `About ${label.toLowerCase()}.`); }
  householdSize(): [number, number] { return [this.size, this.most]; }
  housemateLimits(): [number, number] { return [8, 2]; }
  addHousemate(name: string, personality: number, traits: readonly number[]) {
    this.staged.push([name, personality, [...traits]]);
    return this.accept;
  }
  lastHousemateResult() { return this.result; }
  select(entity: number) { this.selected.push(entity); return true; }
}

function form() {
  const source = new FakeHousehold();
  let changes = 0;
  let movedIn = 0;
  const housemate = new HousemateForm(source, {
    changed: () => { changes += 1; },
    movedIn: () => { movedIn += 1; },
  });
  return { housemate, source, changes: () => changes, movedIn: () => movedIn };
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
    for (const code of [1, 2, 3, 4, 5, 6, 7]) expect(housemateReason(code)).toMatch(/^[A-Z].*\.$/);
    expect(housemateReason(0)).toBeNull();
    expect(housemateReason(99)).toBe('They could not move in.');
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
    append(...children: FakeElement[]) { this.children.push(...children); }
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
});

describe('the New housemate form on real wasm', () => {
  it('moves a housemate in through the real boundary and selects them', () => {
    const bridge = new SimBridge(SimHandle.from_lot(), wasmMemory);
    expect(bridge.householdSize()).toEqual([3, 6]);
    expect(bridge.personalityLabels()).toEqual(['The correspondent', 'The settled', 'The flitting']);
    expect(bridge.personalityDescriptions().map((text) => text.split(' ')[0])).toEqual(['Up', 'Keeps', 'A']);
    expect(bridge.housemateLimits()).toEqual([24, 4]);
    let movedIn = 0;
    const housemate = new HousemateForm(bridge, { changed: () => {}, movedIn: () => { movedIn += 1; } });
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
