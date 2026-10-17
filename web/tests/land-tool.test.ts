import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { LandQuote, LandResult } from '../src/bridge.js';
import { CHOOSE_STRIP, LandTool, SIDES, describeConfirmation, describeQuote, dollars, dollarsDown, dollarsUp,
  stripOutline, stripTiles } from '../src/ui/land-tool.js';
import { LandToolControls } from '../src/ui/land-tool-controls.js';
import { landExtent, lotExtent } from '../src/render/camera.js';
import { shortcutGroups } from '../src/ui/shortcuts.js';

const INDEX_HTML = readFileSync(new URL('../index.html', import.meta.url), 'utf8');

/** The simulation the tool talks to, with every answer under the test's hand. */
class FakeLand {
  depth = 10;
  /** Cents per square; the shipped $150. */
  unit = 15_000;
  fundsCents = 10_000_000;
  width = 20;
  height = 16;
  accept = true;
  staged: number[] = [];
  result: LandResult | null = null;
  revision = 0;

  landQuote(side: number): LandQuote | null {
    if (side < 0 || side > 2) return null;
    const length = side === 0 ? this.height : this.width;
    const area = length * this.depth;
    const priceCents = area * this.unit;
    return { side: side as 0 | 1 | 2, length, depth: this.depth, area, priceCents,
      remainingCents: this.fundsCents - priceCents, affordable: this.fundsCents >= priceCents };
  }

  buyLand(side: number): boolean {
    if (!this.accept) return false;
    this.staged.push(side);
    return true;
  }

  lastLandResult(): LandResult | null {
    return this.result;
  }

  lotRevision(): number {
    return this.revision;
  }
}

function tool(): { land: LandTool; source: FakeLand; renders: number } {
  const source = new FakeLand();
  const state = { renders: 0 };
  const land = new LandTool(source as never, 20, 16, { changed: () => { state.renders += 1; } });
  land.enter();
  return { land, source, get renders() { return state.renders; } };
}

describe('whole dollars', () => {
  it('rounds prices up and funds down, and never shows pennies', () => {
    expect(dollarsUp(3_000_000)).toBe(30_000);
    expect(dollarsUp(3_000_001)).toBe(30_001);
    expect(dollarsDown(4_999_999)).toBe(49_999);
    expect(dollarsDown(5_000_000)).toBe(50_000);
    expect(dollars(30_000)).toBe('$30,000');
  });
});

describe('strips', () => {
  it('lies behind the house, to its left and to its right, with the lot untouched', () => {
    const rear = stripTiles(0, 20, 16, 10);
    expect(rear).toHaveLength(160);
    expect(rear.every(([x, y]) => x >= -10 && x < 0 && y >= 0 && y < 16)).toBe(true);
    const left = stripTiles(1, 20, 16, 10);
    expect(left.every(([x, y]) => x >= 0 && x < 20 && y >= 16 && y < 26)).toBe(true);
    const right = stripTiles(2, 20, 16, 10);
    expect(right.every(([x, y]) => x >= 0 && x < 20 && y >= -10 && y < 0)).toBe(true);
    const outline = stripOutline(0, 20, 16, 10);
    expect(outline).toHaveLength(2 * 16 + 2 * (10 - 2));
    expect(outline.every(([x, y]) => x === -10 || x === -1 || y === 0 || y === 15)).toBe(true);
  });

  it('gives the view room to pan to them', () => {
    const plain = lotExtent(20, 16, 100, 60, 1);
    const reach = landExtent(20, 16, 10, 100, 60, 1);
    expect(landExtent(20, 16, 0, 100, 60, 1)).toEqual(plain);
    expect(reach.left).toBeLessThan(plain.left);
    expect(reach.right).toBeGreaterThan(plain.right);
    expect(reach.top).toBeLessThan(plain.top);
    expect(reach.bottom).toBeGreaterThan(plain.bottom);
  });
});

describe('the quote', () => {
  it('reads the size, the price rounded up and what would remain rounded down', () => {
    const { land } = tool();
    land.choose(0);
    expect(land.status).toBe('Behind the house: 16 by 10 tiles, 160 squares, for $24,000. $76,000 would remain.');
    expect(describeConfirmation(land.chosenQuote()!)).toBe('160 squares behind the house for $24,000. $76,000 would remain.');
  });

  it('can still be read when the household cannot afford it', () => {
    const { land, source } = tool();
    source.fundsCents = 2_399_999;
    land.choose(0);
    expect(land.canBuy()).toBe(false);
    expect(land.status).toBe('Behind the house: 16 by 10 tiles, 160 squares, for $24,000. You have $23,999.');
    expect(describeQuote(land.chosenQuote()!)).toBe(land.status);
    expect(describeConfirmation(land.chosenQuote()!))
      .toBe('160 squares behind the house for $24,000. You have $23,999, so this land cannot be bought yet.');
    expect(land.highlight()?.valid).toBe(false);
  });
});

describe('the Land tool', () => {
  it('starts with nothing chosen and outlines all three strips', () => {
    const { land, source } = tool();
    expect(land.status).toBe(CHOOSE_STRIP);
    expect(land.side).toBeNull();
    expect(land.reach()).toBe(10);
    const highlight = land.highlight()!;
    expect(highlight.valid).toBe(true);
    expect(highlight.tiles).toHaveLength(stripOutline(0, 20, 16, 10).length + 2 * stripOutline(1, 20, 16, 10).length);
    expect(source.staged).toEqual([]);
  });

  it('fills the chosen strip and picks one from a point on it', () => {
    const { land } = tool();
    land.choosePoint(-3.2, 4.4);
    expect(land.side).toBe(0);
    expect(land.highlight()!.tiles).toHaveLength(160 + 2 * stripOutline(1, 20, 16, 10).length);
    land.choosePoint(5, 5);
    expect(land.side).toBe(0);
    land.choosePoint(4, 20.4);
    expect(land.side).toBe(1);
    land.choosePoint(4, -1);
    expect(land.side).toBe(2);
    land.choosePoint(Number.NaN, 0);
    expect(land.side).toBe(2);
  });

  it('chooses by the digits, confirms twice, and sends only on the second step', () => {
    const { land, source } = tool();
    expect(land.handleKey('2')).toBe(true);
    expect(land.side).toBe(1);
    expect(land.handleKey('Enter')).toBe(true);
    expect(land.confirming).toBe(true);
    expect(source.staged).toEqual([]);
    expect(land.handleKey('3')).toBe(false);
    expect(land.side).toBe(1);
    expect(land.handleKey('Escape')).toBe(true);
    expect(land.confirming).toBe(false);
    expect(source.staged).toEqual([]);
    land.requestBuy();
    land.confirmBuy();
    expect(source.staged).toEqual([1]);
    expect(land.pending).toBe(true);
    expect(land.status).toBe('Buying land…');
    land.choose(0);
    expect(land.side).toBe(1);
  });

  it('never sends a purchase the household cannot afford', () => {
    const { land, source } = tool();
    source.fundsCents = 100;
    land.choose(2);
    land.requestBuy();
    expect(land.confirming).toBe(true);
    land.confirmBuy();
    expect(source.staged).toEqual([]);
    expect(land.pending).toBe(false);
    expect(land.confirming).toBe(false);
  });

  it('reports what the drain did and reads the new lot', () => {
    const { land, source } = tool();
    land.choose(0);
    land.requestBuy(); land.confirmBuy();
    source.result = { side: 0, reason: 0, chargedCents: 2_400_000 };
    source.revision = 1;
    source.width = 30; source.fundsCents -= 2_400_000;
    land.afterCommands();
    expect(land.pending).toBe(false);
    expect(land.status).toBe('Bought 160 squares behind the house for $24,000.');
    land.setLotSize(30, 16);
    expect(land.highlight()!.tiles.some(([x]) => x === -10)).toBe(true);
    land.choose(0);
    expect(land.status).toBe('Behind the house: 16 by 10 tiles, 160 squares, for $24,000. $52,000 would remain.');
  });

  it('shows the refusal the simulation gave', () => {
    const { land, source } = tool();
    land.choose(1);
    land.requestBuy(); land.confirmBuy();
    source.result = { side: 1, reason: 4, chargedCents: 0 };
    land.afterCommands();
    expect(land.status).toBe('There is not enough money for this land.');
    source.accept = false;
    land.requestBuy(); land.confirmBuy();
    expect(land.status).toBe('The purchase could not be sent.');
  });

  it('keeps a purchase on its way through an exit and forgets it once it lands', () => {
    const { land, source } = tool();
    land.choose(0); land.requestBuy(); land.confirmBuy();
    land.exit();
    expect(land.pending).toBe(true);
    source.result = { side: 0, reason: 0, chargedCents: 2_400_000 };
    land.afterCommands();
    expect(land.pending).toBe(false);
    expect(land.side).toBeNull();
    expect(land.highlight()).toBeNull();
    land.enter();
    expect(land.status).toBe(CHOOSE_STRIP);
  });

  // Discarding the draft drops a purchase still on its way, and its result
  // never comes; main.ts resets the tool as a Load does, not just its size.
  it('waits forever for a dropped purchase after only a size change, and not after a reset', () => {
    const { land } = tool();
    land.choose(0); land.requestBuy(); land.confirmBuy();
    expect(land.pending).toBe(true);
    land.setLotSize(20, 16);
    land.afterCommands();
    expect(land.pending).toBe(true);
    land.resetAfterLoad(20, 16);
    expect([land.pending, land.side, land.confirming]).toEqual([false, null, false]);
    land.choose(1);
    expect(land.side).toBe(1);
  });

  it('is blocked while another pause holds and cleared by a Load', () => {
    const { land, source } = tool();
    land.choose(0); land.requestBuy();
    land.setBlocked(true);
    expect(land.confirming).toBe(false);
    land.choose(1);
    expect(land.side).toBe(0);
    land.requestBuy();
    expect(land.confirming).toBe(false);
    land.setBlocked(false);
    land.resetAfterLoad(20, 16);
    expect(land.side).toBeNull();
    expect(source.staged).toEqual([]);
  });

  it('lists its keys with the other tools', () => {
    const groups = shortcutGroups('land', []);
    expect(groups.flatMap(group => group.rows.map(row => row.label)))
      .toEqual(['Behind the house', 'Left side', 'Right side', 'Buy land', 'Clear selection']);
  });
});

describe('the Land tool in the page', () => {
  const IDS = ['build-tool-land', 'land-tool', 'land-status', 'land-shortcut-content', 'land-keyboard-help',
    'land-touch-help', 'land-side-0', 'land-side-1', 'land-side-2', 'land-buy', 'land-dialog', 'land-dialog-text',
    'land-dialog-cancel', 'land-dialog-confirm'];

  it.each(IDS)('declares #%s exactly once', (id) => {
    expect(INDEX_HTML.split(`id="${id}"`)).toHaveLength(2);
  });

  it('keeps the land controls inside the build panel, hidden until the tool is chosen', () => {
    const panel = INDEX_HTML.slice(INDEX_HTML.indexOf('id="builder-controls"'), INDEX_HTML.indexOf('id="object-menu"'));
    expect(panel).toContain('id="land-tool"');
    expect(INDEX_HTML).toContain('<div id="land-tool" class="builder-tool" hidden>');
  });

  it('is wired into the page beside the other tools', () => {
    const MAIN_TS = readFileSync(new URL('../src/main.ts', import.meta.url), 'utf8');
    expect(MAIN_TS).toContain("{ tool: landTool, button: 'build-tool-land', panel: 'land-tool' }");
    expect(MAIN_TS.split('landTool.afterCommands();')).toHaveLength(3);
    expect(MAIN_TS.split('if (adoptLotShape()) refreshLotPresentation();')).toHaveLength(3);
    expect(MAIN_TS).toContain('landTool.resetAfterLoad(lotWidth, lotHeight);');
    expect(MAIN_TS).toContain('landTool.highlight()');
    expect(MAIN_TS).toContain('houseOrigin: sim.houseOrigin()');
  });

  it('presses the chosen strip, offers Buy land once a strip is chosen, and asks before sending', () => {
    const source = new FakeLand();
    const land = new LandTool(source as never, 20, 16, { changed: () => { view?.render(); } });
    const elements = new Map<string, FakeElement>();
    let view: LandToolControls | undefined;
    view = new LandToolControls(fakeDocument(elements) as never, land);
    land.enter();
    const buy = elements.get('land-buy')!;
    const dialog = elements.get('land-dialog')!;
    expect(buy.disabled).toBe(true);
    elements.get('land-side-1')!.listeners.click?.();
    expect(land.side).toBe(1);
    expect(elements.get('land-side-1')!.attributes['aria-pressed']).toBe('true');
    expect(elements.get('land-side-0')!.attributes['aria-pressed']).toBe('false');
    expect(elements.get('land-status')!.textContent).toBe(land.status);
    expect(buy.disabled).toBe(false);
    buy.listeners.click?.();
    expect(dialog.open).toBe(true);
    expect(elements.get('land-dialog-text')!.textContent).toBe('200 squares on the left side for $30,000. $70,000 would remain.');
    expect(elements.get('land-dialog-confirm')!.hidden).toBe(false);
    expect(source.staged).toEqual([]);
    dialog.returnValue = 'confirm';
    dialog.close();
    expect(source.staged).toEqual([1]);
    expect(buy.disabled).toBe(true);
  });

  it('offers only Cancel when the household cannot afford the strip', () => {
    const source = new FakeLand();
    source.fundsCents = 5;
    const land = new LandTool(source as never, 20, 16, { changed: () => { view?.render(); } });
    const elements = new Map<string, FakeElement>();
    let view: LandToolControls | undefined;
    view = new LandToolControls(fakeDocument(elements) as never, land);
    land.enter();
    land.choose(0);
    expect(elements.get('land-status')!.attributes['data-valid']).toBe('false');
    elements.get('land-buy')!.listeners.click?.();
    const dialog = elements.get('land-dialog')!;
    expect(dialog.open).toBe(true);
    expect(elements.get('land-dialog-confirm')!.hidden).toBe(true);
    dialog.returnValue = 'cancel';
    dialog.close();
    expect(land.confirming).toBe(false);
    expect(source.staged).toEqual([]);
    view.setCompact(true);
    expect(elements.get('land-keyboard-help')!.hidden).toBe(false);
    expect(elements.get('land-touch-help')!.hidden).toBe(false);
  });
});

interface FakeElement {
  textContent: string;
  hidden: boolean;
  disabled: boolean;
  open: boolean;
  returnValue: string;
  attributes: Record<string, string>;
  listeners: Record<string, (() => void) | undefined>;
  addEventListener(name: string, handler: () => void): void;
  setAttribute(name: string, value: string): void;
  focus(): void;
  showModal(): void;
  close(value?: string): void;
}

function fakeElement(): FakeElement {
  return {
    textContent: '',
    hidden: false,
    disabled: false,
    open: false,
    returnValue: '',
    attributes: {},
    listeners: {},
    addEventListener(name, handler) {
      this.listeners[name] = handler;
    },
    setAttribute(name, value) {
      this.attributes[name] = value;
    },
    focus() {},
    showModal() {
      this.open = true;
    },
    close(value?: string) {
      if (!this.open) return;
      this.open = false;
      if (value !== undefined) this.returnValue = value;
      this.listeners.close?.();
    },
  };
}

function fakeDocument(elements: Map<string, FakeElement>): { querySelector(selector: string): FakeElement } {
  return {
    querySelector(selector: string): FakeElement {
      const id = selector.slice(1);
      let element = elements.get(id);
      if (!element) {
        element = fakeElement();
        elements.set(id, element);
      }
      return element;
    },
  };
}
