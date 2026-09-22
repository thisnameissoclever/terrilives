import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { BARE, CHOOSE_TILE, FloorTool, coveringOf, tileAt } from '../src/ui/floor-tool.js';
import { FloorToolControls } from '../src/ui/floor-tool-controls.js';

const INDEX_HTML = readFileSync(new URL('../index.html', import.meta.url), 'utf8');

/** The simulation the tool talks to, with every answer under the test's hand. */
class FakeFloors {
  names = ['Boards', 'Tiles', 'Carpet'];
  tiles: number[] = [];
  /** The refusal each covering id would get, 0 for none. */
  refusals: number[] = [0, 0, 0, 0];
  accept = true;
  staged: [number, number, number][] = [];
  result: { x: number; y: number; covering: number; reason: number } | null = null;
  revision = 0;

  coveringNames(): string[] {
    return this.names;
  }

  floorTiles(): Uint32Array {
    return new Uint32Array(this.tiles);
  }

  floorEditPreview(_x: number, _y: number, covering: number): number {
    return this.refusals[covering] ?? 1;
  }

  setFloor(x: number, y: number, covering: number): boolean {
    if (!this.accept) return false;
    this.staged.push([x, y, covering]);
    return true;
  }

  lastFloorEditResult(): { x: number; y: number; covering: number; reason: number } | null {
    return this.result;
  }

  lotRevision(): number {
    return this.revision;
  }
}

function tool(): { floors: FloorTool; source: FakeFloors; renders: number } {
  const source = new FakeFloors();
  const state = { renders: 0 };
  const floors = new FloorTool(source as never, 4, 3, { changed: () => { state.renders += 1; } });
  floors.enter();
  return { floors, source, get renders() { return state.renders; } };
}

describe('tileAt', () => {
  it('rounds to the tile under a point and refuses one off the lot', () => {
    expect(tileAt(0.4, 1.6, 4, 3)).toEqual([0, 2]);
    expect(tileAt(-0.6, 0, 4, 3)).toBeNull();
    expect(tileAt(3.6, 0, 4, 3)).toBeNull();
    expect(tileAt(0, 2.6, 4, 3)).toBeNull();
    expect(tileAt(Number.NaN, 0, 4, 3)).toBeNull();
  });
});

describe('coveringOf', () => {
  it('reads the covering on a tile, and 0 for one nobody has painted', () => {
    const tiles = [1, 0, 2, 3, 2, 1];
    expect(coveringOf(tiles, 1, 0)).toBe(2);
    expect(coveringOf(tiles, 3, 2)).toBe(1);
    expect(coveringOf(tiles, 0, 0)).toBe(BARE);
    expect(coveringOf([], 0, 0)).toBe(BARE);
  });
});

describe('the Floors tool', () => {
  it('starts with nothing chosen and the first covering ready', () => {
    const { floors } = tool();
    expect(floors.status).toBe(CHOOSE_TILE);
    expect(floors.chosen).toBe(1);
    expect(floors.tile).toBeNull();
    expect(floors.highlight()).toBeNull();
  });

  it('lays the chosen covering where the player clicks, and says what is there', () => {
    const { floors, source } = tool();
    floors.choose(3);
    floors.choosePoint(1.1, 0.9);
    expect(source.staged).toEqual([[1, 1, 3]]);
    expect(floors.highlight()).toEqual({ tiles: [[1, 1]], valid: true });

    source.result = { x: 1, y: 1, covering: 3, reason: 0 };
    source.tiles = [1, 1, 3];
    source.revision += 1;
    floors.afterCommands();
    expect(floors.status).toBe('This floor is Carpet.');
  });

  it('lays nothing on a tile that already has that covering', () => {
    const { floors, source } = tool();
    source.tiles = [2, 0, 1];
    floors.choose(1);
    floors.choosePoint(2, 0);
    expect(source.staged).toEqual([]);
    expect(floors.status).toBe('This floor is Boards.');
  });

  it('takes a covering away with Remove', () => {
    const { floors, source } = tool();
    source.tiles = [2, 0, 1];
    floors.choose(BARE);
    floors.choosePoint(2, 0);
    expect(source.staged).toEqual([[2, 0, BARE]]);
    source.result = { x: 2, y: 0, covering: BARE, reason: 0 };
    source.tiles = [];
    floors.afterCommands();
    expect(floors.status).toBe('This floor is as the house came.');
  });

  it('refuses a covering the simulation will not have, and says so', () => {
    const { floors, source } = tool();
    source.refusals = [0, 0, 5, 0];
    floors.choose(2);
    floors.choosePoint(1, 1);
    expect(source.staged).toEqual([]);
    expect(floors.highlight()).toEqual({ tiles: [[1, 1]], valid: false });

    // A refusal the drain reports reaches the status line.
    floors.choose(1);
    floors.choosePoint(1, 1);
    source.result = { x: 1, y: 1, covering: 1, reason: 5 };
    floors.afterCommands();
    expect(floors.status).toBe('That tile is not on the lot.');
  });

  it('ignores a covering that is not one of the content, by button or key', () => {
    const { floors } = tool();
    floors.choose(4);
    expect(floors.chosen).toBe(1);
    floors.choose(-1);
    expect(floors.chosen).toBe(1);
    expect(floors.handleKey('3')).toBe(true);
    expect(floors.chosen).toBe(3);
    expect(floors.handleKey('0')).toBe(true);
    expect(floors.chosen).toBe(BARE);
    expect(floors.handleKey('9')).toBe(false);
    expect(floors.handleKey('q')).toBe(false);
  });

  it('stages nothing while another pause holds, or while a change is on its way', () => {
    const { floors, source } = tool();
    floors.setBlocked(true);
    floors.choosePoint(1, 1);
    expect(source.staged).toEqual([]);
    floors.setBlocked(false);

    floors.choosePoint(1, 1);
    expect(source.staged).toHaveLength(1);
    floors.choosePoint(2, 1);
    expect(source.staged).toHaveLength(1);
  });

  it('clears on Escape and after a Load, and keeps a change already on its way', () => {
    const { floors, source } = tool();
    floors.choosePoint(1, 1);
    source.result = { x: 1, y: 1, covering: 1, reason: 0 };
    floors.afterCommands();
    expect(floors.handleKey('Escape')).toBe(true);
    expect(floors.tile).toBeNull();

    floors.choosePoint(2, 1);
    expect(floors.pending).toBe(1);
    floors.exit();
    // An edit on its way is kept until its result arrives.
    expect(floors.pending).toBe(1);
    source.result = { x: 2, y: 1, covering: 1, reason: 0 };
    floors.afterCommands();
    expect(floors.pending).toBeNull();

    floors.enter();
    floors.choosePoint(1, 1);
    floors.resetAfterLoad(6, 6);
    expect(floors.tile).toBeNull();
    expect(floors.status).toBe(CHOOSE_TILE);
  });

  it('says when the change could not even be sent', () => {
    const { floors, source } = tool();
    source.accept = false;
    floors.choosePoint(1, 1);
    expect(floors.status).toBe('That change could not be sent.');
  });
});

describe('the Floors tool in the page', () => {
  const IDS = ['build-tool-floors', 'floor-tool', 'floor-status', 'floor-coverings',
    'floor-keyboard-help', 'floor-touch-help'];

  it.each(IDS)('declares #%s exactly once', (id) => {
    expect(INDEX_HTML.split(`id="${id}"`)).toHaveLength(2);
  });

  it('keeps the floor controls inside the build panel, hidden until the tool is chosen', () => {
    const panel = INDEX_HTML.slice(INDEX_HTML.indexOf('id="builder-controls"'),
      INDEX_HTML.indexOf('id="object-menu"'));
    expect(panel).toContain('id="floor-tool"');
    expect(INDEX_HTML).toContain('<div id="floor-tool" class="builder-tool" hidden>');
  });

  it('is wired into the page beside the other tools', () => {
    const MAIN_TS = readFileSync(new URL('../src/main.ts', import.meta.url), 'utf8');
    expect(MAIN_TS).toContain("{ tool: floorTool, button: 'build-tool-floors', panel: 'floor-tool' }");
    expect(MAIN_TS).toContain('floorTool.afterCommands();');
    expect(MAIN_TS).toContain('lot.floors = sim.floorTiles();');
    expect(MAIN_TS).toContain('coveringLooks: sim.coveringLooks(),');
  });

  it('builds one button per covering plus Remove, from the content', () => {
    const source = new FakeFloors();
    const floors = new FloorTool(source as never, 4, 3, { changed: () => {} });
    const elements = new Map<string, FakeElement>();
    const document = fakeDocument(elements);
    const view = new FloorToolControls(document as never, floors);
    expect(elements.get('floor-coverings')!.children.map((child) => child.textContent))
      .toEqual(['Boards', 'Tiles', 'Carpet', 'Remove']);

    floors.enter();
    elements.get('floor-coverings')!.children[2].listeners.click?.();
    expect(floors.chosen).toBe(3);
    view.render();
    expect(elements.get('floor-coverings')!.children.map((child) => child.attributes['aria-pressed']))
      .toEqual(['false', 'false', 'true', 'false']);
    expect(elements.get('floor-status')!.textContent).toBe(floors.status);

    view.setCompact(true);
    expect(elements.get('floor-keyboard-help')!.hidden).toBe(true);
    expect(elements.get('floor-touch-help')!.hidden).toBe(false);
  });
});

interface FakeElement {
  textContent: string;
  hidden: boolean;
  type: string;
  className: string;
  children: FakeElement[];
  attributes: Record<string, string>;
  listeners: Record<string, (() => void) | undefined>;
  addEventListener(name: string, handler: () => void): void;
  setAttribute(name: string, value: string): void;
  append(child: FakeElement): void;
}

function fakeElement(): FakeElement {
  const element: FakeElement = {
    textContent: '',
    hidden: false,
    type: '',
    className: '',
    children: [],
    attributes: {},
    listeners: {},
    addEventListener(name, handler) {
      this.listeners[name] = handler;
    },
    setAttribute(name, value) {
      this.attributes[name] = value;
    },
    append(child) {
      this.children.push(child);
    },
  };
  return element;
}

function fakeDocument(elements: Map<string, FakeElement>): {
  querySelector(selector: string): FakeElement;
  createElement(): FakeElement;
} {
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
    createElement: fakeElement,
  };
}
