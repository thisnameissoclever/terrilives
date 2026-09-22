import { readFileSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';
import init, { SimHandle } from '../src/wasm/terri_wasm.js';
import { SimBridge, type CatalogueItem, type PlacementPreview, type PurchaseResult } from '../src/bridge.js';
import { emissiveForSprite } from '../src/render/lighting.js';
import { routeBuildKey } from '../src/ui/build-tools.js';
import { BuyTool, CHOOSE_ITEM, listed } from '../src/ui/buy-tool.js';
import { BuyToolControls, itemLabel, servesLabel } from '../src/ui/buy-tool-controls.js';

const INDEX_HTML = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const MAIN_TS = readFileSync(new URL('../src/main.ts', import.meta.url), 'utf8');

let wasmMemory: WebAssembly.Memory;
beforeAll(async () => {
  const wasm = await init({ module_or_path: readFileSync('src/wasm/terri_wasm_bg.wasm') });
  wasmMemory = wasm.memory;
});

/** The need names in need-index order, as `SimBridge.needNames` gives them. */
const NEEDS = ['hunger', 'energy', 'hygiene', 'bladder', 'social', 'fun', 'comfort'];
const ENERGY = 1;
const FUN = 5;
const COMFORT = 6;

const CHAIR: CatalogueItem = { definition: 12, name: 'Chair', price: 40, facings: 0b1111, baseFacing: 1,
  needs: 0 };
const DESK: CatalogueItem = { definition: 24, name: 'Desk', price: 180, facings: 0b0010, baseFacing: 1,
  needs: 1 << FUN };
const BED: CatalogueItem = { definition: 1, name: 'Bed', price: 250, facings: 0b0101, baseFacing: 0,
  needs: (1 << ENERGY) | (1 << COMFORT) };

/** A scripted source: refusals by tile, a staging log, a result. */
class FakeShop {
  items: CatalogueItem[] = [CHAIR, DESK, BED];
  /** Refusal wording by "x,y"; every other tile is valid. */
  refused = new Map<string, string>();
  accept = true;
  staged: [number, number, number, number][] = [];
  result: PurchaseResult | null = null;
  revision = 0;
  money = 1_000;
  previews: [number, number, number, number][] = [];

  catalogue(): CatalogueItem[] { return this.items; }

  purchasePreview(definition: number, x: number, y: number, facing: number): PlacementPreview {
    this.previews.push([definition, x, y, facing]);
    const onLot = x >= 0 && y >= 0;
    const reason = onLot ? this.refused.get(`${x},${y}`) ?? null : 'Choose a whole tile and a supported direction.';
    return { valid: reason === null, reason, x, y, facing, width: onLot ? 1 : 0,
      depth: onLot ? 1 : 0, sprite: onLot ? definition : 0, foreground: null };
  }

  buyObject(definition: number, x: number, y: number, facing: number): boolean {
    this.staged.push([definition, x, y, facing]);
    return this.accept;
  }

  lastPurchaseResult(): PurchaseResult | null { return this.result; }
  lotRevision(): number { return this.revision; }
  funds(): number { return this.money; }
}

function tool() {
  const source = new FakeShop();
  let changes = 0;
  const buy = new BuyTool(source, 8, 6, { changed: () => { changes += 1; } });
  return { buy, source, changes: () => changes };
}

describe('the catalogue order', () => {
  it('lists by name, and by content order where two names match', () => {
    const twin = { ...CHAIR, definition: 3 };
    expect(listed([DESK, CHAIR, BED, twin]).map((item) => item.definition)).toEqual([1, 3, 12, 24]);
  });
});

describe('BuyTool', () => {
  // [CB-filter] in docs/specs/2026-09-22-catalogue-browsing.md.
  it('narrows the list to one need, cycles past what it hides, and drops a choice it hides', () => {
    const { buy } = tool();
    buy.enter();
    buy.choose(DESK.definition);
    buy.setFilter(ENERGY);
    expect(buy.items.filter((item) => buy.shows(item)).map((item) => item.name)).toEqual(['Bed']);
    expect([buy.chosen, buy.preview, buy.status]).toEqual([null, null, CHOOSE_ITEM]);
    buy.cycle(1);
    expect(buy.chosen?.name).toBe('Bed');
    buy.cycle(-1);
    expect(buy.chosen?.name).toBe('Bed');
    // A filter the chosen item still passes keeps it.
    buy.setFilter(COMFORT);
    expect(buy.chosen?.name).toBe('Bed');
    buy.setFilter(null);
    expect(buy.items.every((item) => buy.shows(item))).toBe(true);
    expect(buy.chosen?.name).toBe('Bed');
  });

  it('keeps the filter while a purchase is on its way', () => {
    const { buy } = tool();
    buy.enter();
    buy.choose(DESK.definition);
    buy.buy();
    buy.setFilter(ENERGY);
    expect([buy.filter, buy.chosen?.name]).toEqual([null, 'Desk']);
  });

  // Review finding [H1] on the catalogue branch.
  it('keeps the filter and the choice while another pause holds', () => {
    const { buy } = tool();
    buy.enter();
    buy.choose(DESK.definition);
    buy.setBlocked(true);
    buy.setFilter(ENERGY);
    expect([buy.filter, buy.chosen?.name]).toEqual([null, 'Desk']);
  });

  // Review finding [H10]: a filter that keeps the choice still redraws.
  it('redraws when the filter changes and the choice stays', () => {
    const { buy, changes } = tool();
    buy.enter();
    buy.choose(BED.definition);
    const before = changes();
    buy.setFilter(COMFORT);
    expect([buy.chosen?.name, changes()]).toEqual(['Bed', before + 1]);
  });

  // Review finding [H8]: leaving keeps the filter, a Load drops it.
  it('keeps the filter across leaving the tool and drops it on Load', () => {
    const { buy } = tool();
    buy.enter();
    buy.setFilter(FUN);
    buy.exit();
    buy.enter();
    expect(buy.filter).toBe(FUN);
    buy.resetAfterLoad(8, 6);
    expect(buy.filter).toBeNull();
  });

  // Review finding [H19]: the redraw a Load triggers already sees the whole
  // catalogue, so the panel never draws the old filter after a Load.
  it('clears the filter before the redraw a Load triggers', () => {
    const source = new FakeShop();
    const seen: (number | null)[] = [];
    const buy: BuyTool = new BuyTool(source, 8, 6, { changed: () => { seen.push(buy.filter); } });
    buy.enter();
    buy.setFilter(FUN);
    seen.length = 0;
    buy.resetAfterLoad(8, 6);
    expect(seen).toEqual([null]);
  });

  it('starts with nothing chosen and asks for a choice', () => {
    const { buy } = tool();
    buy.enter();
    expect([buy.active, buy.chosen, buy.preview, buy.status]).toEqual([true, null, null, CHOOSE_ITEM]);
    expect(buy.items.map((item) => item.name)).toEqual(['Bed', 'Chair', 'Desk']);
  });

  it('shows a new choice mid-lot in its own base direction, then keeps the ghost where it is', () => {
    const { buy } = tool();
    buy.enter();
    buy.choose(CHAIR.definition);
    expect([buy.preview?.x, buy.preview?.y, buy.preview?.facing, buy.status]).toEqual([4, 3, 1, 'Ready to buy.']);
    buy.moveTo(2, 1);
    buy.choose(BED.definition);
    expect([buy.chosen, buy.preview?.x, buy.preview?.y, buy.preview?.facing]).toEqual([BED, 2, 1, 0]);
  });

  it('ignores a choice that is not in the catalogue, and anything before the tool is entered', () => {
    const { buy } = tool();
    buy.choose(CHAIR.definition);
    expect(buy.chosen).toBeNull();
    buy.enter();
    buy.choose(99);
    expect(buy.chosen).toBeNull();
  });

  it('says why a position is refused, and cannot buy there', () => {
    const { buy, source } = tool();
    source.refused.set('5,3', 'That position overlaps other furniture.');
    buy.enter();
    buy.choose(CHAIR.definition);
    buy.moveTo(5, 3);
    expect([buy.status, buy.canBuy]).toEqual(['That position overlaps other furniture.', false]);
    buy.buy();
    expect(source.staged).toEqual([]);
  });

  it('draws a ghost pushed off the lot at its full size, in red', () => {
    const { buy } = tool();
    buy.enter();
    buy.choose(CHAIR.definition);
    buy.moveTo(-1, 3);
    expect(buy.preview).toMatchObject({ valid: false, x: -1, y: 3, width: 1, depth: 1, sprite: CHAIR.definition });
  });

  it('turns only through the directions the art has', () => {
    const { buy } = tool();
    buy.enter();
    buy.choose(BED.definition);
    expect(buy.canRotate).toBe(true);
    buy.rotate();
    expect(buy.preview?.facing).toBe(2);
    buy.rotate();
    expect(buy.preview?.facing).toBe(0);
    buy.choose(DESK.definition);
    expect(buy.canRotate).toBe(false);
    buy.rotate();
    expect(buy.preview?.facing).toBe(1);
  });

  it('stages exactly the purchase on screen, once, and waits for its result', () => {
    const { buy, source } = tool();
    buy.enter();
    buy.choose(CHAIR.definition);
    buy.moveTo(2, 2);
    buy.rotate();
    buy.buy();
    expect(source.staged).toEqual([[CHAIR.definition, 2, 2, 2]]);
    expect([buy.pending, buy.status, buy.canBuy]).toEqual([true, 'Buying…', false]);
    buy.buy();
    buy.moveTo(3, 3);
    buy.choose(BED.definition);
    expect(source.staged).toHaveLength(1);
    expect([buy.chosen, buy.preview?.x]).toEqual([CHAIR, 2]);
  });

  it('says so when a purchase could not be sent', () => {
    const { buy, source } = tool();
    source.accept = false;
    buy.enter();
    buy.choose(CHAIR.definition);
    buy.buy();
    expect([buy.pending, buy.status]).toEqual([false, 'The purchase could not be sent.']);
  });

  it('reports what was bought, keeps the choice for another, and re-reads the spot', () => {
    const { buy, source } = tool();
    buy.enter();
    buy.choose(CHAIR.definition);
    buy.buy();
    // Another purchase's result leaves this one waiting.
    source.result = { definition: CHAIR.definition, x: 1, y: 1, facing: 1, reason: null, object: 40 };
    buy.afterCommands();
    expect(buy.pending).toBe(true);
    source.result = { definition: CHAIR.definition, x: 4, y: 3, facing: 1, reason: null, object: 41 };
    source.refused.set('4,3', 'That position overlaps other furniture.');
    source.revision += 1;
    buy.afterCommands();
    expect([buy.pending, buy.chosen, buy.status]).toEqual([false, CHAIR, 'Chair bought.']);
    expect(buy.preview?.valid).toBe(false);
  });

  it('reports a refusal the drain gave', () => {
    const { buy, source } = tool();
    buy.enter();
    buy.choose(CHAIR.definition);
    buy.buy();
    source.result = { definition: CHAIR.definition, x: 4, y: 3, facing: 1,
      reason: 'The household cannot afford that.', object: null };
    buy.afterCommands();
    expect([buy.pending, buy.status]).toEqual([false, 'The household cannot afford that.']);
  });

  it('re-reads the ghost when something else changed the lot', () => {
    const { buy, source } = tool();
    buy.enter();
    buy.choose(CHAIR.definition);
    source.refused.set('4,3', 'That position overlaps other furniture.');
    buy.afterCommands();
    expect(buy.preview?.valid).toBe(true);
    source.revision += 1;
    buy.afterCommands();
    expect(buy.preview?.valid).toBe(false);
  });

  it('keeps a purchase on its way through leaving the tool, then forgets it once it lands', () => {
    const { buy, source } = tool();
    buy.enter();
    buy.choose(CHAIR.definition);
    buy.buy();
    buy.exit();
    expect([buy.active, buy.pending, buy.ghost()]).toEqual([false, true, null]);
    source.result = { definition: CHAIR.definition, x: 4, y: 3, facing: 1, reason: null, object: 41 };
    buy.afterCommands();
    expect([buy.pending, buy.chosen, buy.preview, buy.status]).toEqual([false, null, null, CHOOSE_ITEM]);
  });

  it('forgets an unbought choice on leaving', () => {
    const { buy } = tool();
    buy.enter();
    buy.choose(CHAIR.definition);
    buy.exit();
    buy.enter();
    expect([buy.chosen, buy.preview, buy.status]).toEqual([null, null, CHOOSE_ITEM]);
  });

  it('stages nothing while another pause holds', () => {
    const { buy, source } = tool();
    buy.enter();
    buy.choose(CHAIR.definition);
    buy.setBlocked(true);
    expect(buy.canBuy).toBe(false);
    buy.buy();
    buy.moveTo(1, 1);
    buy.cancel();
    expect(source.staged).toEqual([]);
    expect([buy.chosen, buy.preview?.x]).toEqual([CHAIR, 4]);
  });

  it('uses the keyboard: brackets choose, arrows move, R turns, Enter buys, Escape cancels', () => {
    const { buy, source } = tool();
    expect(buy.handleKey('ArrowLeft')).toBe(false);
    buy.enter();
    expect(buy.handleKey('Escape')).toBe(false);
    expect(buy.handleKey(']')).toBe(true);
    expect(buy.chosen).toBe(BED);
    buy.handleKey('[');
    expect(buy.chosen).toBe(DESK);
    buy.handleKey('[');
    buy.handleKey('ArrowLeft');
    buy.handleKey('ArrowUp');
    buy.handleKey('R');
    expect([buy.chosen, buy.preview?.x, buy.preview?.y, buy.preview?.facing]).toEqual([CHAIR, 3, 2, 2]);
    expect(buy.handleKey('q')).toBe(false);
    buy.handleKey('Enter');
    expect(source.staged).toEqual([[CHAIR.definition, 3, 2, 2]]);
    // Escape waits for a purchase on its way rather than losing its result.
    expect(buy.handleKey('Escape')).toBe(true);
    expect(buy.chosen).toBe(CHAIR);
    source.result = { definition: CHAIR.definition, x: 3, y: 2, facing: 2, reason: null, object: 41 };
    buy.afterCommands();
    expect(buy.handleKey('Escape')).toBe(true);
    expect([buy.chosen, buy.preview]).toEqual([null, null]);
  });

  // Review finding [F7] on PR 96: the keys skip what the list greys out.
  it('steps through only what the household can afford, and chooses nothing when it can afford nothing', () => {
    const { buy, source } = tool();
    source.money = 180;
    buy.enter();
    const seen: (string | undefined)[] = [];
    for (const key of [']', ']', ']', '[', '[']) {
      buy.handleKey(key);
      seen.push(buy.chosen?.name);
    }
    expect(seen).toEqual(['Chair', 'Desk', 'Chair', 'Desk', 'Chair']);
    const broke = tool();
    broke.source.money = 0;
    broke.buy.enter();
    broke.buy.handleKey(']');
    broke.buy.handleKey('ArrowDown');
    expect(broke.buy.chosen).toBeNull();
    const fresh = tool();
    fresh.source.money = 180;
    fresh.buy.enter();
    fresh.buy.handleKey('ArrowDown');
    expect(fresh.buy.chosen).toBe(CHAIR);
  });

  it('with nothing chosen, an arrow chooses the first item', () => {
    const { buy } = tool();
    buy.enter();
    buy.handleKey('ArrowDown');
    expect(buy.chosen).toBe(BED);
  });

  it('knows what the household can afford', () => {
    const { buy, source } = tool();
    source.money = 180;
    expect([BED, CHAIR, DESK].map((item) => buy.affordable(item))).toEqual([false, true, true]);
  });

  it('forgets everything on Load and takes the loaded lot size', () => {
    const { buy, source } = tool();
    buy.enter();
    buy.choose(CHAIR.definition);
    buy.buy();
    source.revision = 9;
    buy.resetAfterLoad(20, 10);
    expect([buy.pending, buy.chosen, buy.preview]).toEqual([false, null, null]);
    buy.choose(CHAIR.definition);
    expect([buy.preview?.x, buy.preview?.y]).toEqual([10, 5]);
  });

  it('keeps Build mode keys with the Buy tool while it is in use', () => {
    const { buy } = tool();
    const walls = { active: false, handleKey: () => true };
    const seen: string[] = [];
    const furniture = { handleKey: (key: string) => { seen.push(key); return true; } };
    buy.enter();
    expect(routeBuildKey(']', [walls, buy], furniture)).toBe(true);
    expect(buy.chosen).toBe(BED);
    expect(routeBuildKey('Escape', [walls, buy], furniture)).toBe(true);
    expect(seen).toEqual([]);
    expect(routeBuildKey('Escape', [walls, buy], furniture)).toBe(true);
    expect(seen).toEqual(['Escape']);
  });
});

describe('BuyToolControls', () => {
  class FakeElement {
    hidden = false;
    disabled = false;
    textContent = '';
    value = '';
    readonly children: FakeElement[] = [];
    readonly attributes = new Map<string, string>();
    readonly listeners = new Map<string, (() => void)[]>();
    setAttribute(name: string, value: string) { this.attributes.set(name, value); }
    addEventListener(type: string, listener: () => void) {
      this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
    }
    fire(type: string) { for (const listener of this.listeners.get(type) ?? []) listener(); }
    append(child: FakeElement) { this.children.push(child); }
    replaceChildren(...children: FakeElement[]) { this.children.splice(0, this.children.length, ...children); }
  }

  function controls() {
    const elements = new Map<string, FakeElement>();
    const doc = {
      querySelector: (selector: string) => {
        const id = selector.slice(1);
        if (!elements.has(id)) elements.set(id, new FakeElement());
        return elements.get(id);
      },
      createElement: () => new FakeElement(),
    } as unknown as Document;
    const { buy, source } = tool();
    const view = new BuyToolControls(doc, buy, NEEDS);
    return { buy, source, view, element: (id: string) => elements.get(id)! };
  }

  it('offers only the needs something serves, in need order, and narrows the list to one', () => {
    const { buy, view, element } = controls();
    buy.enter();
    view.render();
    const filter = element('buy-filter');
    expect(filter.children.map((option) => [option.value, option.textContent])).toEqual(
      [['', 'Everything'], ['1', 'Energy'], ['5', 'Fun'], ['6', 'Comfort']]);
    filter.value = String(ENERGY);
    filter.fire('change');
    expect(element('buy-object').children.map((option) => option.textContent)).toEqual(
      ['Choose something to buy', 'Bed (250)']);
    filter.value = '';
    filter.fire('change');
    expect(element('buy-object').children).toHaveLength(4);
  });

  it('says what the chosen item is good for', () => {
    const { buy, view, element } = controls();
    buy.enter();
    view.render();
    expect(element('buy-serves').textContent).toBe('');
    buy.choose(BED.definition);
    view.render();
    expect(element('buy-serves').textContent).toBe('Good for: Energy, Comfort');
    buy.choose(CHAIR.definition);
    view.render();
    expect(element('buy-serves').textContent).toBe('Good for: no need on its own');
  });

  // Review findings [H1] and [H10] on the catalogue branch.
  it('disables the Show list while another pause holds, and shows a filter set elsewhere', () => {
    const { buy, view, element } = controls();
    buy.enter();
    buy.setFilter(FUN);
    view.render();
    expect([element('buy-filter').value, element('buy-filter').disabled]).toEqual(['5', false]);
    buy.setBlocked(true);
    view.render();
    expect(element('buy-filter').disabled).toBe(true);
  });

  it('words what an item is good for from the need names', () => {
    expect(servesLabel((1 << 0) | (1 << 6), NEEDS)).toBe('Good for: Hunger, Comfort');
    expect(servesLabel(1 << 4, NEEDS)).toBe('Good for: Social');
    expect(servesLabel(0, NEEDS)).toBe('Good for: no need on its own');
  });

  it('lists every item with its price and greys out what the household cannot afford', () => {
    const { buy, source, view, element } = controls();
    const options = element('buy-object').children;
    expect(options.map((option) => option.textContent)).toEqual(
      ['Choose something to buy', 'Bed (250)', 'Chair (40)', 'Desk (180)']);
    source.money = 180;
    buy.enter();
    view.render();
    expect(options.slice(1).map((option) => option.disabled)).toEqual([true, false, false]);
    source.money = 250;
    view.render();
    expect(options.slice(1).map((option) => option.disabled)).toEqual([false, false, false]);
  });

  it('chooses from the list, shows the price, and presses buy, turn and cancel', () => {
    const { buy, source, view, element } = controls();
    buy.enter();
    element('buy-object').value = String(BED.definition);
    element('buy-object').fire('change');
    view.render();
    expect([element('buy-price').textContent, element('buy-facing').textContent])
      .toEqual(['Price: 250', 'Facing: South-east']);
    expect([element('buy-rotate').disabled, element('buy-confirm').disabled]).toEqual([false, false]);
    element('buy-rotate').fire('click');
    element('buy-confirm').fire('click');
    expect(source.staged).toEqual([[BED.definition, 4, 3, 2]]);
    view.render();
    expect([element('buy-object').disabled, element('buy-confirm').disabled, element('buy-cancel').disabled,
      element('buy-filter').disabled]).toEqual([true, true, true, true]);
    source.result = { definition: BED.definition, x: 4, y: 3, facing: 2, reason: null, object: 41 };
    buy.afterCommands();
    element('buy-cancel').fire('click');
    view.render();
    expect([buy.chosen, element('buy-status').textContent, element('buy-price').textContent,
      element('buy-serves').textContent]).toEqual([null, CHOOSE_ITEM, '', '']);
  });

  // Review finding [F6] on PR 96: the placeholder must not leave a buyable ghost.
  it('drops the choice when the list is set back to its placeholder', () => {
    const { buy, source, view, element } = controls();
    buy.enter();
    element('buy-object').value = String(CHAIR.definition);
    element('buy-object').fire('change');
    element('buy-object').value = '';
    element('buy-object').fire('change');
    expect([buy.chosen, buy.preview, element('buy-confirm').disabled, element('buy-price').textContent,
      element('buy-serves').textContent]).toEqual([null, null, true, '', '']);
    buy.buy();
    expect(source.staged).toEqual([]);
  });

  it('shows the touch help on a phone and the keyboard help elsewhere', () => {
    const { view, element } = controls();
    view.setCompact(true);
    expect([element('buy-keyboard-help').hidden, element('buy-touch-help').hidden]).toEqual([true, false]);
    view.setCompact(false);
    expect([element('buy-keyboard-help').hidden, element('buy-touch-help').hidden]).toEqual([false, true]);
  });

  it('writes a price the way the Funds line does, apart from a name with a comma in it', () => {
    expect(itemLabel('Chair, Standard Issue', 1_250)).toBe('Chair, Standard Issue (1,250)');
  });
});

describe('the Buy tool on real wasm', () => {
  // [B-rotated-lights] in docs/FEATURES.md, checked against what content
  // draws rather than against the lighting's own sprite names: every item
  // glows in each direction it can face exactly when it glows as drawn by
  // default, and only the floor lamp and the television glow at all.
  it('lights every direction of a light and nothing else', () => {
    const bridge = new SimBridge(SimHandle.from_lot(), wasmMemory);
    const lights: string[] = [];
    for (const item of bridge.catalogue()) {
      const glows = (facing: number) =>
        emissiveForSprite(bridge.purchasePreview(item.definition, 0, 0, facing).sprite);
      const drawn = glows(item.baseFacing);
      if (drawn > 0) lights.push(item.name);
      for (let facing = 0; facing < 4; facing++) {
        if ((item.facings & (1 << facing)) === 0) continue;
        expect(glows(facing), `${item.name} facing ${facing}`).toBe(drawn);
        // A foreground layer, such as a screen split from its cabinet, glows
        // with the picture it belongs to.
        const { foreground } = bridge.purchasePreview(item.definition, 0, 0, facing);
        if (foreground !== null) {
          expect(emissiveForSprite(foreground), `${item.name} facing ${facing} foreground`).toBe(drawn);
        }
      }
    }
    expect(lights.sort()).toEqual(['Cathode Companion', 'Illumination, Ambient']);
  });

  it('lists the whole catalogue and words the refusal a household with no money gets', () => {
    const bridge = new SimBridge(SimHandle.from_lot(), wasmMemory);
    const catalogue = bridge.catalogue();
    expect(catalogue.length).toBeGreaterThan(20);
    for (const item of catalogue) {
      expect(item.price).toBeGreaterThan(0);
      expect(item.name).not.toBe('');
      expect(item.facings & (1 << item.baseFacing)).not.toBe(0);
      expect(item.needs).toBeLessThan(1 << bridge.needNames().length);
    }
    // Review finding [H2]: each item carries the needs of its own row, as
    // the raw boundary lists them.
    const handle = SimHandle.from_lot();
    const words = handle.catalogue();
    const raw = handle.catalogue_needs();
    const rows = new Map<number, number>();
    for (let row = 0; row < raw.length; row += 1) rows.set(words[row * 4], raw[row]);
    const paired = new SimBridge(handle, wasmMemory).catalogue();
    expect(paired.map((item) => item.needs)).toEqual(paired.map((item) => rows.get(item.definition)));
    expect(new Set(raw).size).toBeGreaterThan(3);
    handle.free();
    // [CB-serves]: some things serve a need and some serve none; hunger is
    // need 0, and the fridge, the stove and the table all serve it.
    expect(catalogue.filter((item) => (item.needs & 1) !== 0).length).toBeGreaterThanOrEqual(3);
    expect(catalogue.some((item) => item.needs === 0)).toBe(true);
    expect(bridge.funds()).toBe(0);
    const buy = new BuyTool(bridge, 16, 12, { changed: () => undefined });
    buy.enter();
    const first = buy.items[0];
    buy.choose(first.definition);
    expect(buy.status).toBe('The household cannot afford that.');
    expect(bridge.buyObject(first.definition, 3, 3, first.baseFacing)).toBe(true);
    bridge.flushCommands();
    expect(bridge.lastPurchaseResult()).toEqual({ definition: first.definition, x: 3, y: 3,
      facing: first.baseFacing, reason: 'The household cannot afford that.', object: null });
  });
});

describe('the Buy tool in the page', () => {
  const IDS = ['build-tool-buy', 'buy-tool', 'buy-filter', 'buy-object', 'buy-facing', 'buy-rotate',
    'buy-price', 'buy-serves', 'buy-status', 'buy-confirm', 'buy-cancel', 'buy-keyboard-help',
    'buy-touch-help'];

  it.each(IDS)('declares #%s exactly once', (id) => {
    expect(INDEX_HTML.split(`id="${id}"`)).toHaveLength(2);
  });

  it('keeps the buy controls inside the build panel, hidden until the tool is chosen', () => {
    const panel = INDEX_HTML.slice(INDEX_HTML.indexOf('id="builder-controls"'),
      INDEX_HTML.indexOf('</section>', INDEX_HTML.indexOf('id="builder-controls"')));
    for (const id of IDS) expect(panel).toContain(`id="${id}"`);
    expect(panel).toContain('<div id="buy-tool" class="builder-tool" hidden>');
  });

  it('is wired into the frame, the click, Load and leaving Build', () => {
    for (const wiring of ['buyTool.afterCommands()', 'buyTool.moveTo(tile[0], tile[1])',
      'buyTool.resetAfterLoad(lotWidth, lotHeight)', 'buyTool.exit()',
      "buyTool.setBlocked(overlayPause.suspendedExcept('builder'))",
      'buyControls?.setCompact(event.matches)',
      'new BuyToolControls(document, buyTool, sim.needNames())']) {
      expect(MAIN_TS).toContain(wiring);
    }
    // The ghost reaches both the instance writer and the instance count.
    expect(MAIN_TS.split('buyTool.ghost() ?? builder.preview')).toHaveLength(3);
  });
});
