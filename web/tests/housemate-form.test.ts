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

// [CS-command] in docs/specs/2026-09-22-create-a-sim.md: the form mirrors the
// simulation's rules so Move in is off before a refusal, never instead of one.
describe('HousemateForm', () => {
  it('reads its lists and limits from content and starts empty', () => {
    const { housemate } = form();
    expect(housemate.personalities).toHaveLength(3);
    expect(housemate.traits).toHaveLength(6);
    expect([housemate.nameMaxChars, housemate.maxTraits]).toEqual([8, 2]);
    expect([housemate.name, housemate.personality, housemate.chosenTraits, housemate.status])
      .toEqual(['', 0, [], CHOOSE_NAME]);
    expect(housemate.canMoveIn()).toBe(false);
  });

  it('needs a name that fits, and trims it', () => {
    const { housemate } = form();
    housemate.setName('   ');
    expect([housemate.canMoveIn(), housemate.status]).toEqual([false, CHOOSE_NAME]);
    housemate.setName('  Ann  ');
    expect([housemate.trimmedName(), housemate.canMoveIn()]).toEqual(['Ann', true]);
    housemate.setName('Annabella');
    expect(housemate.canMoveIn()).toBe(false);
    housemate.setName('Annabell');
    expect(housemate.canMoveIn()).toBe(true);
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
    expect([housemate.roomForOne(), housemate.canMoveIn(), housemate.status])
      .toEqual([false, false, HOUSEHOLD_FULL]);
  });

  it('stages the trimmed name, the personality and the traits, then selects the newcomer', () => {
    const { housemate, source, movedIn } = form();
    housemate.setName(' Ann ');
    housemate.setPersonality(1);
    housemate.toggleTrait(4);
    housemate.moveIn();
    expect(source.staged).toEqual([['Ann', 1, [4]]]);
    expect([housemate.pending, housemate.status, housemate.canMoveIn()]).toEqual([true, MOVING_IN, false]);
    // Nothing changes while the move-in is on its way.
    housemate.setName('Bo');
    housemate.toggleTrait(0);
    housemate.setPersonality(2);
    expect([housemate.name, housemate.chosenTraits, housemate.personality]).toEqual([' Ann ', [4], 1]);
    housemate.afterCommands();
    expect(housemate.pending).toBe(true);
    source.result = { reason: null, sim: 41 };
    housemate.afterCommands();
    expect([housemate.pending, source.selected, movedIn()]).toEqual([false, [41], 1]);
  });

  it('shows the refusal and lets the player try again', () => {
    const { housemate, source, movedIn } = form();
    housemate.setName('Ann');
    housemate.moveIn();
    source.result = { reason: 'The household is full.', sim: null };
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
  class FakeElement {
    disabled = false;
    checked = false;
    textContent = '';
    value = '';
    maxLength = 0;
    type = '';
    className = '';
    readonly children: FakeElement[] = [];
    readonly listeners = new Map<string, ((event: { preventDefault(): void }) => void)[]>();
    addEventListener(type: string, listener: (event: { preventDefault(): void }) => void) {
      this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
    }
    fire(type: string) {
      for (const listener of this.listeners.get(type) ?? []) listener({ preventDefault() {} });
    }
    append(...children: FakeElement[]) { this.children.push(...children); }
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
    return { housemate, source, formView, element: (id: string) => elements.get(id)! };
  }

  it('lists the personalities and the traits with their sentences, and caps the name', () => {
    const { element } = view();
    expect(element('housemate-personality').children.map((o) => o.textContent))
      .toEqual(['The correspondent', 'The settled', 'The flitting']);
    const rows = element('housemate-traits').children;
    expect(rows).toHaveLength(6);
    expect(rows[0].children[1].textContent).toBe('Bookworm: About bookworm.');
    expect(element('housemate-name').maxLength).toBe(8);
    expect(element('housemate-count').textContent).toBe('3 of 6 live here.');
    expect(element('housemate-confirm').disabled).toBe(true);
  });

  it('drives the form from its controls and greys out the boxes past the limit', () => {
    const { housemate, source, element } = view();
    const name = element('housemate-name');
    name.value = 'Ann';
    name.fire('input');
    element('housemate-personality').value = '2';
    element('housemate-personality').fire('change');
    const boxes = element('housemate-traits').children.map((row) => row.children[0]);
    boxes[1].fire('change');
    boxes[5].fire('change');
    expect([housemate.name, housemate.personality, housemate.chosenTraits]).toEqual(['Ann', 2, [1, 5]]);
    expect(boxes.map((box) => box.disabled)).toEqual([true, false, true, true, true, false]);
    expect(element('housemate-confirm').disabled).toBe(false);
    element('housemate-confirm').fire('click');
    expect(source.staged).toEqual([['Ann', 2, [1, 5]]]);
    expect([name.disabled, element('housemate-status').textContent]).toEqual([true, MOVING_IN]);
  });

  it('is wired into the page', () => {
    for (const id of ['new-housemate', 'housemate-dialog', 'housemate-name', 'housemate-personality',
      'housemate-traits', 'housemate-count', 'housemate-status', 'housemate-confirm']) {
      expect(INDEX_HTML).toContain(`id="${id}"`);
    }
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
    expect(bridge.housemateLimits()).toEqual([24, 4]);
    let movedIn = 0;
    const housemate = new HousemateForm(bridge, { changed: () => {}, movedIn: () => { movedIn += 1; } });
    housemate.setName('Ann');
    housemate.setPersonality(1);
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
