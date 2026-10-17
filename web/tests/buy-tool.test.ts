import { readFileSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';
import init, { SimHandle } from '../src/wasm/terri_wasm.js';
import { SimBridge, type CatalogueItem, type PlacementPreview, type PurchaseResult } from '../src/bridge.js';
import { emissiveForSprite } from '../src/render/lighting.js';
import { routeBuildKey } from '../src/ui/build-tools.js';
import { BuyTool, CHOOSE_ITEM, listed } from '../src/ui/buy-tool.js';
import { BuyToolControls, cardName, roomWord, servesLabel } from '../src/ui/buy-tool-controls.js';
import { drawCataloguePreviews, previewBox } from '../src/ui/catalogue-previews.js';
import { SPRITES } from '../src/render/atlas.js';

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

it('sorts models within their primary type without changing definition ids', () => {
  const first = { ...CHAIR, name: 'Armchair', details: { modelName: 'Lounge', description: 'Seat.' } };
  const second = { ...CHAIR, definition: 99, name: 'Armchair', details: { modelName: 'Early Retirement', description: 'Seat.' } };
  expect(listed([BED, first, second]).map(item => item.definition)).toEqual([99, CHAIR.definition, BED.definition]);
});

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

  colourwayNames(): string[] { return ['As drawn', 'Colour 2', 'Colour 3']; }
  inColourway: [number, number, number, number, number][] = [];
  buyObjectInColourway(definition: number, x: number, y: number, facing: number,
    colourway: number): boolean {
    this.inColourway.push([definition, x, y, facing, colourway]);
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
    buy.rotate(-1);
    expect(buy.preview?.facing).toBe(2);
    buy.rotate(-1);
    expect(buy.preview?.facing).toBe(0);
    buy.choose(DESK.definition);
    expect(buy.canRotate).toBe(false);
    buy.rotate();
    expect(buy.preview?.facing).toBe(1);
    buy.rotate(-1);
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

// [RC-slice-buy] in docs/specs/2026-09-22-colourways.md: the Buy tool keeps a
// colourway between purchases; as drawn buys through the plain purchase, any
// other through a purchase in that colourway, and the ghost is drawn in it.
describe('buying in a colourway', () => {
  it('buys in the chosen colourway and keeps it for the next purchase', () => {
    const { buy, source } = tool();
    buy.enter();
    buy.choose(CHAIR.definition);
    expect([buy.colourway, buy.ghostColourway()]).toEqual([0, 0]);
    buy.buy();
    expect([source.staged.length, source.inColourway.length]).toEqual([1, 0]);
    source.result = { definition: CHAIR.definition, x: source.staged[0][1], y: source.staged[0][2],
      facing: source.staged[0][3], reason: null, object: 40 };
    source.revision += 1;
    buy.afterCommands();
    buy.setColourway(2);
    expect([buy.colourway, buy.ghostColourway()]).toEqual([2, 2]);
    buy.choose(CHAIR.definition);
    buy.buy();
    expect(source.inColourway).toHaveLength(1);
    expect(source.inColourway[0][4]).toBe(2);
    // The purchase on its way is refused its colour change.
    buy.setColourway(1);
    expect(buy.colourway).toBe(2);
    source.result = { definition: CHAIR.definition, x: source.inColourway[0][1],
      y: source.inColourway[0][2], facing: source.inColourway[0][3], reason: null, object: 41 };
    source.revision += 1;
    buy.afterCommands();
    expect(buy.colourway).toBe(2);
    for (const refused of [-1, 3, 1.5]) {
      buy.setColourway(refused);
      expect(buy.colourway).toBe(2);
    }
    buy.setBlocked(true);
    buy.setColourway(1);
    expect(buy.colourway).toBe(2);
    buy.setBlocked(false);
    buy.exit();
    expect([buy.colourway, buy.ghostColourway()]).toEqual([2, 0]);
    buy.enter();
    expect(buy.ghostColourway()).toBe(2);
    buy.resetAfterLoad(8, 6);
    expect(buy.colourway).toBe(0);
    buy.exit();
    expect(buy.ghostColourway()).toBe(0);
  });
});

describe('BuyToolControls', () => {
  class FakeElement {
    ownerDocument!: Document;
    tagName = '';
    className = '';
    open = false;
    hidden = false;
    disabled = false;
    textContent = '';
    value = '';
    type = '';
    tabIndex = 0;
    width = 0;
    height = 0;
    readonly children: FakeElement[] = [];
    readonly attributes = new Map<string, string>();
    readonly listeners = new Map<string, ((event?: unknown) => void)[]>();
    setAttribute(name: string, value: string) { this.attributes.set(name, value); }
    getAttribute(name: string) { return this.attributes.get(name) ?? null; }
    addEventListener(type: string, listener: (event?: unknown) => void) {
      this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
    }
    removeEventListener(type: string, listener: (event?: unknown) => void) {
      this.listeners.set(type, (this.listeners.get(type) ?? []).filter(entry => entry !== listener));
    }
    fire(type: string, event?: unknown) { for (const listener of this.listeners.get(type) ?? []) listener(event); }
    append(...children: FakeElement[]) { this.children.push(...children); }
    replaceChildren(...children: FakeElement[]) { this.children.splice(0, this.children.length, ...children); }
    focus() { (this.ownerDocument as unknown as { activeElement: FakeElement }).activeElement = this; }
  }

  /** A model stub with rooms: `shows` reads only the rooms, and nothing chooses it. */
  const inRooms = (item: CatalogueItem, rooms: string[]): CatalogueItem =>
    ({ ...item, model: { rooms, width: 1, depth: 1, roles: [], actions: [], shelfCapacity: 0 } as unknown as CatalogueItem['model'] });

  function controls(items?: CatalogueItem[]) {
    const elements = new Map<string, FakeElement>();
    const doc = {
      activeElement: null as FakeElement | null,
      querySelector: (selector: string) => {
        const id = selector.slice(1);
        if (!elements.has(id)) elements.set(id, Object.assign(new FakeElement(), { ownerDocument: doc, tagName: 'div' }));
        return elements.get(id);
      },
      createElement: (tag: string) => Object.assign(new FakeElement(), { ownerDocument: doc, tagName: tag }),
    } as unknown as Document & { activeElement: FakeElement | null };
    const { buy, source } = tool();
    const pictures: { sprite: number; foreground: number | null }[] = [];
    const previews = (cards: readonly { canvas: HTMLCanvasElement; sprite: number; foreground: number | null }[]) => {
      for (const card of cards) pictures.push({ sprite: card.sprite, foreground: card.foreground });
    };
    if (items) {
      source.items = items;
      // The controller reads the catalogue once at construction.
      const describedBuy = new BuyTool(source, 10, 10, { changed() {} });
      const view = new BuyToolControls(doc, describedBuy, NEEDS, previews);
      return { buy: describedBuy, source, view, doc, pictures, element: (id: string) => elements.get(id)! };
    }
    const view = new BuyToolControls(doc, buy, NEEDS, previews);
    return { buy, source, view, doc, pictures, element: (id: string) => elements.get(id)! };
  }

  const cards = (element: (id: string) => FakeElement) => element('buy-object').children;
  const names = (element: (id: string) => FakeElement) => cards(element).map(card => card.getAttribute('aria-label'));
  const row = (element: (id: string) => FakeElement, id: string) => element(id).children;
  const pressed = (buttons: FakeElement[]) => buttons.map(button => button.getAttribute('aria-pressed') === 'true');

  it('names a card by its type, model and price', () => {
    expect(cardName(CHAIR)).toBe('Chair (40)');
    expect(cardName({ ...CHAIR, price: 1_250, details: { modelName: 'Soakster 9,001', description: 'Seat.' } })).toBe('Chair: Soakster 9,001 (1,250)');
    expect(roomWord('living_room')).toBe('Living Room');
  });

  it('builds one card per item in list order, with its picture, lines and price', () => {
    const chair = { ...CHAIR, name: 'Armchair', details: { modelName: 'Lounge', description: 'A chair for sitting.' } };
    const { element, pictures, source } = controls([chair, BED]);
    expect(names(element)).toEqual(['Armchair: Lounge (40)', 'Bed (250)']);
    const [first] = cards(element);
    expect(first.tagName).toBe('button');
    expect(first.children.map(child => child.className)).toEqual(['catalogue-picture', 'catalogue-type', 'catalogue-model', 'catalogue-price']);
    expect(first.children.map(child => child.textContent)).toEqual(['', 'Armchair', 'Lounge', '40']);
    expect([first.children[0].width, first.children[0].height, first.children[0].getAttribute('aria-hidden')]).toEqual([144, 144, 'true']);
    expect(cards(element)[1].children.map(child => child.className)).toEqual(['catalogue-picture', 'catalogue-type', 'catalogue-price']);
    // The pictures come from the ghost's query at the lot's corner, at the base facing.
    expect(pictures, 'nothing is drawn before the tool is shown').toEqual([]);
  });

  it('shows the chosen identity, retains expansion on redraw, and clears it when selection changes', () => {
    const chair = { ...CHAIR, name: 'Armchair', details: { modelName: 'Lounge', description: 'A chair for sitting.' } };
    const { buy, view, element } = controls([chair, BED]);
    buy.enter();
    buy.choose(chair.definition);
    view.render();
    const identity = element('buy-identity');
    expect(identity.hidden).toBe(false);
    const disclosure = identity.children[0];
    expect(disclosure.children[0].children.map(child => child.textContent)).toEqual(['Armchair', 'Lounge']);
    expect(disclosure.children[1].textContent).toBe('A chair for sitting.');
    disclosure.open = true;
    view.render();
    expect(identity.children[0]).toBe(disclosure);
    expect(identity.children[0].open).toBe(true);
    buy.choose(BED.definition);
    view.render();
    expect(identity.hidden).toBe(true);
    expect(identity.children).toHaveLength(0);
  });

  it('presses the chosen card, greys out what the household cannot afford, and chooses on a press', () => {
    const { buy, source, view, element } = controls();
    expect(names(element)).toEqual(['Bed (250)', 'Chair (40)', 'Desk (180)']);
    source.money = 180;
    buy.enter();
    view.render();
    const grayed = () => cards(element).map(card => card.getAttribute('aria-disabled') === 'true');
    expect(grayed()).toEqual([true, false, false]);
    // A grayed card stays in reach but a press on it chooses nothing.
    cards(element)[0].fire('click');
    expect(buy.chosen).toBeNull();
    cards(element)[1].fire('click');
    expect(buy.chosen).toBe(CHAIR);
    expect(pressed(cards(element))).toEqual([false, true, false]);
    expect([element('buy-price').textContent, element('buy-facing').textContent, element('buy-serves').textContent])
      .toEqual(['Price: 40', 'Facing: South-west', 'Good for: no need on its own']);
    // Pressing the chosen card again keeps its ghost and facing.
    buy.rotate();
    const facing = buy.preview?.facing;
    cards(element)[1].fire('click');
    expect(buy.preview?.facing).toBe(facing);
    source.money = 250;
    view.render();
    expect(grayed()).toEqual([false, false, false]);
  });

  it('offers the rooms any item belongs to and the needs any item serves, one pressed per row', () => {
    const kitchenChair = inRooms(CHAIR, ['kitchen', 'dining_room']);
    const { buy, view, doc, element } = controls([kitchenChair, inRooms(BED, ['bedroom']), DESK]);
    expect(row(element, 'buy-room-filter').map(button => button.textContent)).toEqual(['Every room', 'Bedroom', 'Dining Room', 'Kitchen']);
    expect(row(element, 'buy-filter').map(button => button.textContent)).toEqual(['Everything', 'Energy', 'Fun', 'Comfort']);
    expect(pressed(row(element, 'buy-room-filter'))).toEqual([true, false, false, false]);
    expect(element('buy-clear-filters').disabled).toBe(true);
    buy.enter();
    row(element, 'buy-room-filter')[3].fire('click');
    expect(buy.roomFilter).toBe('kitchen');
    expect(pressed(row(element, 'buy-room-filter'))).toEqual([false, false, false, true]);
    expect(cards(element).map(card => card.hidden)).toEqual([true, false, true]);
    expect(element('buy-clear-filters').disabled).toBe(false);
    row(element, 'buy-filter')[2].fire('click');
    expect(buy.filter).toBe(FUN);
    expect(cards(element).map(card => card.hidden), 'no kitchen item serves Fun').toEqual([true, true, true]);
    element('buy-clear-filters').focus();
    element('buy-clear-filters').fire('click');
    expect([buy.filter, buy.roomFilter]).toEqual([null, null]);
    expect(doc.activeElement, 'focus leaves the button it disables for Every room').toBe(row(element, 'buy-room-filter')[0]);
    expect(cards(element).map(card => card.hidden)).toEqual([false, false, false]);
    expect(pressed(row(element, 'buy-filter'))).toEqual([true, false, false, false]);
    expect(element('buy-clear-filters').disabled).toBe(true);
  });

  it('drops a choice the filter hides, and keeps one it still shows', () => {
    const { buy, view, element } = controls();
    buy.enter();
    cards(element)[2].fire('click');
    expect(buy.chosen).toBe(DESK);
    row(element, 'buy-filter')[1].fire('click');
    expect([buy.chosen, buy.preview, buy.canBuy, element('buy-price').textContent]).toEqual([null, null, false, '']);
    expect(pressed(cards(element))).toEqual([false, false, false]);
    cards(element)[0].fire('click');
    row(element, 'buy-filter')[3].fire('click');
    expect(buy.chosen).toBe(BED);
    view.render();
    expect(cards(element).map(card => card.hidden)).toEqual([false, true, true]);
  });

  // Review findings [H1] and [H10] on the catalogue branch.
  it('disables every control while a purchase is on its way or another pause holds', () => {
    const { buy, source, view, element } = controls();
    buy.enter();
    cards(element)[0].fire('click');
    buy.buy();
    view.render();
    expect(source.staged).toEqual([[BED.definition, 4, 3, 0]]);
    const everything = [...cards(element), ...row(element, 'buy-room-filter'), ...row(element, 'buy-filter'), element('buy-clear-filters')];
    expect(everything.every(button => button.disabled)).toBe(true);
    source.result = { definition: BED.definition, x: 4, y: 3, facing: 0, reason: null, object: 41 };
    buy.afterCommands();
    view.render();
    expect(cards(element).map(card => card.disabled)).toEqual([false, false, false]);
    buy.setBlocked(true);
    view.render();
    expect(everything.every(button => button.disabled)).toBe(true);
    buy.setBlocked(false);
    buy.cancel();
    view.render();
    expect([buy.chosen, element('buy-status').textContent, element('buy-price').textContent,
      element('buy-serves').textContent]).toEqual([null, CHOOSE_ITEM, '', '']);
  });

  it('offers the colourways and chooses one from the Colour list', () => {
    const { buy, view, element } = controls();
    buy.enter();
    view.render();
    const colour = element('buy-colour');
    expect(colour.children.map((option) => option.textContent)).toEqual(['As drawn', 'Colour 2', 'Colour 3']);
    expect([colour.value, colour.disabled]).toEqual(['0', false]);
    colour.value = '1';
    colour.fire('change');
    expect(buy.colourway).toBe(1);
    cards(element)[1].fire('click');
    buy.buy();
    view.render();
    expect([buy.pending, colour.disabled]).toEqual([true, true]);
    buy.setBlocked(true);
    view.render();
    expect(colour.disabled).toBe(true);
  });

  it('disables the Colour list when the art as drawn is the only colourway', () => {
    const elements = new Map<string, FakeElement>();
    const doc = {
      querySelector: (selector: string) => {
        const id = selector.slice(1);
        if (!elements.has(id)) elements.set(id, Object.assign(new FakeElement(), { ownerDocument: doc }));
        return elements.get(id);
      },
      createElement: (tag: string) => Object.assign(new FakeElement(), { ownerDocument: doc, tagName: tag }),
    } as unknown as Document;
    const source = new FakeShop();
    source.colourwayNames = () => ['As drawn'];
    const buy = new BuyTool(source, 8, 6, { changed: () => {} });
    const view = new BuyToolControls(doc, buy, NEEDS);
    buy.enter();
    view.render();
    expect(elements.get('buy-colour')!.disabled).toBe(true);
  });

  it('draws the pictures once, the first time the tool is shown, from the ghost query at the base facing', () => {
    const { buy, view, pictures, source } = controls();
    expect(pictures).toEqual([]);
    buy.enter();
    view.render();
    // FakeShop answers a preview with the definition as the sprite.
    expect(pictures).toEqual([BED, CHAIR, DESK].map(item => ({ sprite: item.definition, foreground: null })));
    for (const item of [BED, CHAIR, DESK]) expect(source.previews).toContainEqual([item.definition, 0, 0, item.baseFacing]);
    view.render();
    expect(pictures).toHaveLength(3);
  });

  it('shows the Colour list only while an item is chosen', () => {
    const { buy, view, element } = controls();
    buy.enter();
    view.render();
    expect([element('buy-colour').hidden, element('buy-colour-label').hidden]).toEqual([true, true]);
    cards(element)[1].fire('click');
    expect([element('buy-colour').hidden, element('buy-colour-label').hidden]).toEqual([false, false]);
    buy.cancel();
    view.render();
    expect(element('buy-colour').hidden).toBe(true);
  });

  it('keeps one card in the Tab order, and Choose item focuses the chosen card or the first shown', () => {
    const { buy, source, view, doc, element } = controls();
    buy.enter();
    expect(cards(element).map(card => card.tabIndex)).toEqual([0, -1, -1]);
    source.money = 100;
    view.render();
    expect(cards(element).map(card => card.tabIndex), 'a grayed card is still the first shown').toEqual([0, -1, -1]);
    view.focusCatalogue();
    expect(doc.activeElement).toBe(cards(element)[0]);
    source.money = 1_000;
    // A browser focuses a card it clicks.
    cards(element)[2].focus();
    cards(element)[2].fire('click');
    expect(cards(element).map(card => card.tabIndex)).toEqual([-1, -1, 0]);
    // The chosen card keeps Choose item's focus after the household can no longer afford it.
    source.money = 10;
    view.render();
    view.focusCatalogue();
    expect(doc.activeElement).toBe(cards(element)[2]);
  });

  it('moves focus between the shown cards with the arrow keys, Home and End', () => {
    const { buy, view, doc, element } = controls();
    buy.enter();
    row(element, 'buy-filter')[1].fire('click');
    view.render();
    const key = (name: string) => {
      let prevented = false;
      element('buy-object').fire('keydown', { key: name, preventDefault: () => { prevented = true; } });
      return prevented;
    };
    expect(key('ArrowRight')).toBe(true);
    expect(doc.activeElement).toBe(cards(element)[0]);
    expect(cards(element)[0].tabIndex).toBe(0);
    expect(key('ArrowRight')).toBe(true);
    expect(doc.activeElement, 'the Bed is the only card the Energy filter shows').toBe(cards(element)[0]);
    element('buy-clear-filters').fire('click');
    key('End');
    expect(doc.activeElement).toBe(cards(element)[2]);
    key('ArrowLeft');
    expect(doc.activeElement).toBe(cards(element)[1]);
    // The card moved to is the one Tab stop, so Tab leaves the grid from it.
    expect(cards(element).map(card => card.tabIndex)).toEqual([-1, 0, -1]);
    view.render();
    expect(cards(element).map(card => card.tabIndex), 'kept across a redraw').toEqual([-1, 0, -1]);
    // A click or Tab focusing a card makes it the Tab stop too, and the
    // focused card keeps it across a redraw even when another is chosen.
    cards(element)[0].fire('click');
    cards(element)[2].fire('focus');
    expect(cards(element).map(card => card.tabIndex)).toEqual([-1, -1, 0]);
    cards(element)[2].focus();
    view.render();
    expect(cards(element).map(card => card.tabIndex), 'the focused card over the chosen one').toEqual([-1, -1, 0]);
    key('Home');
    expect(doc.activeElement).toBe(cards(element)[0]);
    key('ArrowUp');
    expect(doc.activeElement, 'wraps around').toBe(cards(element)[2]);
    expect(key('Enter')).toBe(false);
    for (const modifier of ['altKey', 'ctrlKey', 'metaKey', 'shiftKey']) {
      let prevented = false;
      element('buy-object').fire('keydown', { key: 'ArrowLeft', [modifier]: true, preventDefault: () => { prevented = true; } });
      expect(prevented, `a browser shortcut with ${modifier} passes through`).toBe(false);
    }
  });

  it('keeps the last focused card as the Tab stop once focus leaves the grid', () => {
    const { buy, view, doc, element } = controls();
    buy.enter();
    view.render();
    cards(element)[2].focus();
    cards(element)[2].fire('focus');
    row(element, 'buy-room-filter')[0].focus();
    view.render();
    expect([buy.chosen, doc.activeElement === cards(element)[2]]).toEqual([null, false]);
    expect(cards(element).map(card => card.tabIndex)).toEqual([-1, -1, 0]);
  });

  it('words what an item is good for from the need names', () => {
    expect(servesLabel((1 << 0) | (1 << 6), NEEDS)).toBe('Good for: Hunger, Comfort');
    expect(servesLabel(1 << 4, NEEDS)).toBe('Good for: Social');
    expect(servesLabel(0, NEEDS)).toBe('Good for: no need on its own');
  });

  it('preserves catalogue selection, price and facing while actions live in the viewport', () => {
    const { buy, source, view, element } = controls();
    buy.enter();
    cards(element)[0].fire('click');
    expect([element('buy-price').textContent, element('buy-facing').textContent])
      .toEqual(['Price: 250', 'Facing: South-east']);
    buy.rotate(); buy.buy(); view.render();
    expect(source.staged).toEqual([[BED.definition, 4, 3, 2]]);
    source.result = { definition: BED.definition, x: 4, y: 3, facing: 2, reason: null, object: 41 };
    buy.afterCommands(); buy.cancel(); view.render();
    expect([buy.chosen, element('buy-status').textContent, element('buy-price').textContent,
      element('buy-serves').textContent]).toEqual([null, CHOOSE_ITEM, '', '']);
  });

  it('keeps the optional shortcuts available on desktop and phone', () => {
    const { view, element } = controls();
    view.setCompact(true);
    expect([element('buy-keyboard-help').hidden, element('buy-touch-help').hidden]).toEqual([false, false]);
    view.setCompact(false);
    expect([element('buy-keyboard-help').hidden, element('buy-touch-help').hidden]).toEqual([false, false]);
  });
});

describe('the catalogue pictures', () => {
  it('names a sprite the atlas has for every shipped item, with a box to draw', () => {
    const handle = SimHandle.from_lot();
    try {
      const bridge = new SimBridge(handle, wasmMemory);
      const buy = new BuyTool(bridge, 16, 12, { changed() {} });
      expect(buy.items.length).toBeGreaterThan(0);
      for (const item of buy.items) {
        const art = buy.art(item);
        expect(SPRITES[art.sprite], item.name).toBeDefined();
        if (art.foreground !== null) expect(SPRITES[art.foreground], item.name).toBeDefined();
        const box = previewBox(art);
        expect(box, item.name).not.toBeNull();
        expect(box![2] - box![0], item.name).toBeGreaterThan(0);
        expect(box![3] - box![1], item.name).toBeGreaterThan(0);
      }
    } finally { handle.free(); }
  });

  it('draws the base behind the foreground whichever page each lives on, and reports a failed page last', async () => {
    const order: string[] = [];
    const canvas = { width: 72, height: 72, getContext: () => {
      let mode = 'source-over';
      return {
        set imageSmoothingEnabled(_: boolean) {}, set imageSmoothingQuality(_: string) {},
        set globalCompositeOperation(value: string) { mode = value; }, get globalCompositeOperation() { return mode; },
        drawImage: (bitmap: { page: number }) => { order.push(`${bitmap.page}:${mode}`); },
        clearRect: () => {},
      };
    } } as unknown as HTMLCanvasElement;
    // Two real sprites on different pages, one standing for the base and
    // one for its foreground, tried both ways round.
    const indexOn = (page: number) => SPRITES.findIndex(sprite => (sprite.page ?? 0) === page);
    const low = indexOn(2);
    const high = indexOn(3);
    expect(low).toBeGreaterThanOrEqual(0);
    expect(high).toBeGreaterThanOrEqual(0);
    const loaded: number[] = [];
    const load = async (page: number) => { loaded.push(page); return { page, close: () => { loaded.push(-page); } } as unknown as ImageBitmap; };
    await drawCataloguePreviews([{ canvas, sprite: low, foreground: high }], load);
    expect(order).toEqual(['2:source-over', '3:source-over']);
    expect(loaded).toEqual([2, -2, 3, -3]);
    order.length = 0;
    // The foreground's page comes first: the base is drawn behind it.
    await drawCataloguePreviews([{ canvas, sprite: high, foreground: low }], load);
    expect(order).toEqual(['2:source-over', '3:destination-over']);
    const failures: number[] = [];
    await expect(drawCataloguePreviews([{ canvas, sprite: low, foreground: null }],
      async page => { failures.push(page); throw new Error('offline'); })).rejects.toThrow('offline');
    expect(failures).toEqual([2]);
  });

  it('draws every page that loads, blanks a card that lost a layer, and reports the failure last', async () => {
    const drawn: number[] = [];
    const cleared: string[] = [];
    const canvasNamed = (name: string) => ({ width: 72, height: 72, getContext: () => ({
      imageSmoothingEnabled: true, imageSmoothingQuality: 'high', globalCompositeOperation: 'source-over',
      drawImage: (bitmap: { page: number }) => { drawn.push(bitmap.page); },
      clearRect: () => { cleared.push(name); },
    }) }) as unknown as HTMLCanvasElement;
    const indexOn = (page: number) => SPRITES.findIndex(sprite => (sprite.page ?? 0) === page);
    const [first, second, third] = [indexOn(1), indexOn(2), indexOn(3)];
    expect(Math.min(first, second, third)).toBeGreaterThanOrEqual(0);
    const loaded: number[] = [];
    const load = async (page: number) => {
      if (page === 2) throw new Error('offline');
      loaded.push(page);
      return { page, close: () => { loaded.push(-page); } } as unknown as ImageBitmap;
    };
    await expect(drawCataloguePreviews([
      { canvas: canvasNamed('split'), sprite: first, foreground: second },
      { canvas: canvasNamed('whole'), sprite: third, foreground: null },
    ], load)).rejects.toThrow('offline');
    expect(loaded, 'the page after the failure is still drawn and released').toEqual([1, -1, 3, -3]);
    expect(drawn).toEqual([1, 3]);
    expect(cleared, 'the card whose foreground failed is blanked').toEqual(['split']);
  });
});

describe('the Buy tool on real wasm', () => {
  // [RC-slice-buy]: the bridge passes the facing and the colourway in their
  // own places, so the object faces its way and is drawn in its colourway.
  it('buys in a colourway through the real boundary', () => {
    const staged = (colourway: number) => {
      const handle = SimHandle.from_lot();
      const bridge = new SimBridge(handle, wasmMemory);
      // A colourway that is not the facing's code, so swapped arguments show.
      const item = bridge.catalogue().find((entry) => entry.baseFacing !== 3)!;
      expect(bridge.buyObjectInColourway(item.definition, 0, 0, item.baseFacing, colourway)).toBe(true);
      return { handle, bridge, item };
    };
    // The staged purchase carries its colourway: the digest sees it.
    const [second, third] = [staged(2), staged(3)];
    expect(second.bridge.worldHash()).not.toBe(third.bridge.worldHash());
    // The shipped house has no money, so the purchase is refused, but the
    // result echoes it exactly as the boundary received it.
    third.bridge.flushCommands();
    const result = third.bridge.lastPurchaseResult()!;
    expect([result.definition, result.facing]).toEqual([third.item.definition, third.item.baseFacing]);
    second.handle.free();
    third.handle.free();
  });

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
    expect(lights.sort()).toEqual(['Floor lamp', 'Television']);
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
  const IDS = ['build-tool-buy', 'buy-tool', 'buy-room-filter', 'buy-filter', 'buy-clear-filters', 'buy-object',
    'buy-facing', 'buy-price', 'buy-serves', 'buy-status', 'buy-keyboard-help',
    'buy-touch-help', 'buy-colour', 'buy-colour-label'];

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
      'new BuyToolControls(document, buyTool, sim.needNames(), cards => {',
      'drawCataloguePreviews(cards)',
      'focusCatalogue: () => buyControls?.focusCatalogue()']) {
      expect(MAIN_TS).toContain(wiring);
    }
    // The ghost reaches the one packer; its batch publishes the live count.
    expect(MAIN_TS.split('buyTool.ghost() ?? builder.preview')).toHaveLength(2);
    // [RC-render]: the ghost of a purchase is drawn in the Buy tool's colourway,
    // a moved object's in the object's own.
    expect(MAIN_TS).toContain('buyTool.ghost() ? buyTool.ghostColourway() : builder.colourway ?? 0,');
  });
});
