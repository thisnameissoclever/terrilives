import { readFileSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';
import init, { SimHandle } from '../src/wasm/terri_wasm.js';
import { SimBridge, wallReason, type WallEditPreview } from '../src/bridge.js';
import { tileHighlightCount, writeTileHighlight } from '../src/render/placement-preview.js';
import { WallToolControls } from '../src/ui/wall-tool-controls.js';
import { BuildToolSwitch, routeBuildKey } from '../src/ui/build-tools.js';
import {
  CHOOSE_LINE,
  DOORWAY,
  OPEN,
  WALL,
  WallTool,
  nearestLine,
  stateOf,
  tilesBeside,
  type WallLine,
} from '../src/ui/wall-tool.js';

const INDEX_HTML = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const MAIN_TS = readFileSync(new URL('../src/main.ts', import.meta.url), 'utf8');

let wasmMemory: WebAssembly.Memory;
beforeAll(async () => {
  const wasm = await init({ module_or_path: readFileSync('src/wasm/terri_wasm_bg.wasm') });
  wasmMemory = wasm.memory;
});

/** A scripted source: fixed previews per state, a staging log, a result. */
class FakeWalls {
  edges: number[] = [];
  refusals: [number, number, number] = [0, 0, 0];
  accept = true;
  staged: [number, number, number, number][] = [];
  result: { axis: number; x: number; y: number; state: number; reason: string | null } | null = null;
  revision = 0;
  previewCalls = 0;

  wallEdges(): Uint32Array | undefined {
    return new Uint32Array(this.edges);
  }

  wallEditPreview(_axis: number, _x: number, _y: number, state: number): WallEditPreview {
    this.previewCalls += 1;
    const code = this.refusals[state];
    return { valid: code === 0, reason: wallReason(code), code };
  }

  setWallEdge(axis: number, x: number, y: number, state: number): boolean {
    this.staged.push([axis, x, y, state]);
    return this.accept;
  }

  lastWallEditResult() {
    return this.result;
  }

  lotRevision(): number {
    return this.revision;
  }
}

function tool(width = 7, height = 5) {
  const source = new FakeWalls();
  let changes = 0;
  const walls = new WallTool(source, width, height, { changed: () => { changes += 1; } });
  return { source, walls, changes: () => changes };
}

describe('nearestLine', () => {
  it('picks the nearer of the nearest vertical and horizontal line', () => {
    // Tile (2, 1) spans 1.5..2.5 by 0.5..1.5. Its left edge is x = 1.5.
    expect(nearestLine(1.6, 1.0, 7, 5)).toEqual({ axis: 0, x: 2, y: 1 });
    expect(nearestLine(2.4, 1.0, 7, 5)).toEqual({ axis: 0, x: 3, y: 1 });
    // Its top edge is y = 0.5, its bottom y = 1.5.
    expect(nearestLine(2.0, 0.6, 7, 5)).toEqual({ axis: 1, x: 2, y: 1 });
    expect(nearestLine(2.0, 1.4, 7, 5)).toEqual({ axis: 1, x: 2, y: 2 });
    // Exactly equidistant goes vertical, so the answer is never undecided.
    expect(nearestLine(1.75, 0.75, 7, 5)).toEqual({ axis: 0, x: 2, y: 1 });
  });

  it('offers the outer lines, so the simulation can say why they cannot change', () => {
    expect(nearestLine(-0.45, 2.0, 7, 5)).toEqual({ axis: 0, x: 0, y: 2 });
    expect(nearestLine(6.45, 2.0, 7, 5)).toEqual({ axis: 0, x: 7, y: 2 });
    expect(nearestLine(3.0, -0.45, 7, 5)).toEqual({ axis: 1, x: 3, y: 0 });
    expect(nearestLine(3.0, 4.45, 7, 5)).toEqual({ axis: 1, x: 3, y: 5 });
  });

  it('picks nothing for a point off the lot', () => {
    // The lot's tiles span -0.5 to width - 0.5, both ends included.
    for (const [wx, wy] of [[-0.51, 2], [6.51, 2], [3, -0.51], [3, 4.51], [40, -40]]) {
      expect(nearestLine(wx, wy, 7, 5)).toBeNull();
    }
  });

  // Copilot on PR 95: the far edges are on the lot exactly as the near ones
  // are, and each corner names a real outer line rather than one past the lot.
  it('treats all four edges of the lot alike, corners included', () => {
    expect(nearestLine(-0.5, 2.0, 7, 5)).toEqual({ axis: 0, x: 0, y: 2 });
    expect(nearestLine(6.5, 2.0, 7, 5)).toEqual({ axis: 0, x: 7, y: 2 });
    expect(nearestLine(3.0, -0.5, 7, 5)).toEqual({ axis: 1, x: 3, y: 0 });
    expect(nearestLine(3.0, 4.5, 7, 5)).toEqual({ axis: 1, x: 3, y: 5 });
    expect(nearestLine(-0.5, -0.5, 7, 5)).toEqual({ axis: 0, x: 0, y: 0 });
    expect(nearestLine(6.5, 4.5, 7, 5)).toEqual({ axis: 0, x: 7, y: 4 });
    expect(nearestLine(6.5, 4.4, 7, 5)).toEqual({ axis: 0, x: 7, y: 4 });
    expect(nearestLine(6.4, 4.5, 7, 5)).toEqual({ axis: 1, x: 6, y: 5 });
  });

  it.each([
    [Number.NaN, 1, 7, 5],
    [1, Number.POSITIVE_INFINITY, 7, 5],
    [1, 1, 0, 5],
    [1, 1, 7, 0],
  ])('has no line for (%s, %s) in a %s by %s lot', (wx, wy, width, height) => {
    expect(nearestLine(wx, wy, width, height)).toBeNull();
  });
});

describe('tilesBeside and stateOf', () => {
  it('names the two tiles each kind of line separates', () => {
    expect(tilesBeside({ axis: 0, x: 3, y: 2 })).toEqual([[2, 2], [3, 2]]);
    expect(tilesBeside({ axis: 1, x: 3, y: 2 })).toEqual([[3, 1], [3, 2]]);
  });

  it('reads a wall, a doorway and an open line from four words per record', () => {
    const edges = [0, 3, 2, 0, 1, 3, 2, 1];
    expect(stateOf(edges, { axis: 0, x: 3, y: 2 })).toBe(WALL);
    expect(stateOf(edges, { axis: 1, x: 3, y: 2 })).toBe(DOORWAY);
    expect(stateOf(edges, { axis: 0, x: 3, y: 3 })).toBe(OPEN);
    expect(stateOf(edges, { axis: 0, x: 4, y: 2 })).toBe(OPEN);
    expect(stateOf([0, 3, 2], { axis: 0, x: 3, y: 2 })).toBe(OPEN);
  });
});

describe('WallTool', () => {
  it('does nothing until entered, and asks the player to choose a line', () => {
    const { walls, source } = tool();
    walls.choosePoint(1.6, 1.0);
    expect(walls.line).toBeNull();
    expect(walls.handleKey('ArrowLeft')).toBe(false);
    walls.enter();
    expect(walls.status).toBe(CHOOSE_LINE);
    expect(source.previewCalls).toBe(0);
  });

  it('reads the chosen line and previews all three states for it', () => {
    const { walls, source } = tool();
    source.edges = [0, 2, 1, 1];
    walls.enter();
    walls.choosePoint(1.6, 1.0);
    expect(walls.line).toEqual({ axis: 0, x: 2, y: 1 });
    expect(walls.current).toBe(DOORWAY);
    expect(source.previewCalls).toBe(3);
    expect(walls.status).toBe('This line is a doorway.');
    expect(([OPEN, WALL, DOORWAY] as const).map((state) => walls.canApply(state))).toEqual([true, true, false]);
  });

  it('says why a wall is refused, and disables only the refused state', () => {
    const { walls, source } = tool();
    source.refusals = [0, 12, 0];
    walls.enter();
    walls.choosePoint(1.6, 1.0);
    expect(walls.status).toBe('No wall on this line. A wall there would cut off the front door.');
    expect(([OPEN, WALL, DOORWAY] as const).map((state) => walls.canApply(state))).toEqual([false, false, true]);
    expect(walls.highlight()).toEqual({ tiles: [[1, 1], [2, 1]], valid: false });
    walls.apply(WALL);
    expect(source.staged).toEqual([]);
  });

  it('stages an edit, waits for the drain, then reports it and reads the line again', () => {
    const { walls, source } = tool();
    walls.enter();
    walls.choosePoint(1.6, 1.0);
    walls.apply(WALL);
    expect(source.staged).toEqual([[0, 2, 1, WALL]]);
    expect(walls.pending).toBe(WALL);
    // Nothing more can be staged or chosen while one is in flight.
    walls.apply(DOORWAY);
    walls.choosePoint(3.4, 3.0);
    expect(source.staged).toHaveLength(1);
    expect(walls.line).toEqual({ axis: 0, x: 2, y: 1 });

    // A result for another line, or another state, is not this edit's.
    source.result = { axis: 0, x: 2, y: 2, state: WALL, reason: null };
    walls.afterCommands();
    expect(walls.pending).toBe(WALL);
    source.result = { axis: 0, x: 2, y: 1, state: DOORWAY, reason: null };
    walls.afterCommands();
    expect(walls.pending).toBe(WALL);

    source.edges = [0, 2, 1, 0];
    source.revision = 1;
    source.result = { axis: 0, x: 2, y: 1, state: WALL, reason: null };
    walls.afterCommands();
    expect(walls.pending).toBeNull();
    expect(walls.current).toBe(WALL);
    expect(walls.status).toBe('Wall built.');
    expect(walls.canApply(WALL)).toBe(false);
  });

  it('reports a refusal the drain found and leaves the line as it was', () => {
    const { walls, source } = tool();
    walls.enter();
    walls.choosePoint(1.6, 1.0);
    walls.apply(WALL);
    source.result = { axis: 0, x: 2, y: 1, state: WALL, reason: wallReason(9) };
    walls.afterCommands();
    expect(walls.pending).toBeNull();
    expect(walls.status).toBe('Someone is standing on that line.');
    expect(walls.current).toBe(OPEN);
  });

  it('says so when the boundary will not take the edit', () => {
    const { walls, source } = tool();
    source.accept = false;
    walls.enter();
    walls.choosePoint(1.6, 1.0);
    walls.apply(WALL);
    expect(walls.pending).toBeNull();
    expect(walls.status).toBe('That change could not be sent.');
  });

  it('reads the line again when somebody else changes the lot', () => {
    const { walls, source } = tool();
    walls.enter();
    walls.choosePoint(1.6, 1.0);
    const calls = source.previewCalls;
    walls.afterCommands();
    expect(source.previewCalls).toBe(calls);
    source.edges = [0, 2, 1, 1];
    source.revision = 4;
    walls.afterCommands();
    expect(source.previewCalls).toBe(calls + 3);
    expect(walls.current).toBe(DOORWAY);
  });

  it('moves and turns the line from the keyboard, inside the lot', () => {
    const { walls, source } = tool(7, 5);
    walls.enter();
    expect(walls.handleKey('ArrowRight')).toBe(true);
    expect(walls.line).toEqual({ axis: 0, x: 3, y: 2 });
    walls.handleKey('ArrowRight');
    walls.handleKey('ArrowDown');
    expect(walls.line).toEqual({ axis: 0, x: 4, y: 3 });
    walls.handleKey('h');
    expect(walls.line).toEqual({ axis: 1, x: 4, y: 3 });
    // The keys reach the outer lines a click can choose, and stop there.
    for (let i = 0; i < 9; i += 1) walls.handleKey('ArrowUp');
    expect(walls.line).toEqual({ axis: 1, x: 4, y: 0 });
    walls.handleKey('ArrowDown');
    walls.handleKey('V');
    for (let i = 0; i < 9; i += 1) walls.handleKey('ArrowLeft');
    expect(walls.line).toEqual({ axis: 0, x: 0, y: 1 });
    walls.handleKey('ArrowRight');
    expect(walls.line).toEqual({ axis: 0, x: 1, y: 1 });
    for (let i = 0; i < 9; i += 1) walls.handleKey('ArrowRight');
    expect(walls.line).toEqual({ axis: 0, x: 7, y: 1 });
    for (let i = 0; i < 6; i += 1) walls.handleKey('ArrowLeft');

    walls.handleKey('w');
    walls.handleKey('d');
    expect(source.staged).toEqual([[0, 1, 1, WALL]]);
    source.result = { axis: 0, x: 1, y: 1, state: WALL, reason: null };
    source.edges = [0, 1, 1, 0];
    walls.afterCommands();
    walls.handleKey('D');
    source.result = { axis: 0, x: 1, y: 1, state: DOORWAY, reason: null };
    source.edges = [0, 1, 1, 1];
    walls.afterCommands();
    walls.handleKey('Backspace');
    expect(source.staged.map((edit) => edit[3])).toEqual([WALL, DOORWAY, OPEN]);
    expect(walls.handleKey('q')).toBe(false);
  });

  it('keeps its choice through Escape while an edit is on its way, and reports it', () => {
    const { walls, source } = tool();
    walls.enter();
    walls.choosePoint(1.6, 1.0);
    walls.apply(DOORWAY);
    expect(walls.handleKey('Escape')).toBe(true);
    expect([walls.line, walls.pending]).toEqual([{ axis: 0, x: 2, y: 1 }, DOORWAY]);
    source.result = { axis: 0, x: 2, y: 1, state: DOORWAY, reason: null };
    source.edges = [0, 2, 1, 1];
    walls.afterCommands();
    expect(walls.status).toBe('Doorway made.');
    walls.handleKey('Escape');
    expect(walls.line).toBeNull();
  });

  it('keeps an edit on its way through leaving the tool, then forgets it once it lands', () => {
    const { walls, source } = tool();
    walls.enter();
    walls.choosePoint(1.6, 1.0);
    walls.apply(WALL);
    walls.exit();
    expect([walls.active, walls.pending]).toEqual([false, WALL]);
    expect(walls.highlight()).toBeNull();
    source.result = { axis: 0, x: 2, y: 1, state: WALL, reason: null };
    walls.afterCommands();
    expect([walls.pending, walls.line, walls.status]).toEqual([null, null, CHOOSE_LINE]);
    walls.enter();
    expect(walls.status).toBe(CHOOSE_LINE);
  });

  it('comes back to an edit still on its way without claiming nothing is chosen', () => {
    const { walls, source } = tool();
    walls.enter();
    walls.choosePoint(1.6, 1.0);
    const described = walls.status;
    walls.apply(WALL);
    walls.exit();
    walls.enter();
    expect([walls.status, walls.line, walls.pending]).toEqual([described, { axis: 0, x: 2, y: 1 }, WALL]);
    source.result = { axis: 0, x: 2, y: 1, state: WALL, reason: null };
    source.edges = [0, 2, 1, 0];
    walls.afterCommands();
    expect(walls.status).toBe('Wall built.');
  });

  it('says only that the outside wall cannot change, on an outer line', () => {
    const { walls, source } = tool();
    source.refusals = [5, 5, 5];
    walls.enter();
    walls.choosePoint(-0.45, 2.0);
    expect(walls.status).toBe('The outside wall cannot be changed here.');
    expect(([OPEN, WALL, DOORWAY] as const).map((state) => walls.canApply(state))).toEqual([false, false, false]);
    expect(walls.highlight()?.valid).toBe(false);
  });

  it('clears its choice on Escape, and leaves a second Escape to Build mode', () => {
    const { walls } = tool();
    walls.enter();
    walls.choosePoint(1.6, 1.0);
    expect(walls.handleKey('Escape')).toBe(true);
    expect(walls.line).toBeNull();
    expect(walls.highlight()).toBeNull();
    expect(walls.handleKey('Escape')).toBe(false);
  });

  it('stages nothing while another pause blocks Build mode', () => {
    const { walls, source } = tool();
    walls.enter();
    walls.choosePoint(1.6, 1.0);
    walls.setBlocked(true);
    expect(walls.canApply(WALL)).toBe(false);
    walls.apply(WALL);
    walls.handleKey('w');
    expect(source.staged).toEqual([]);
    walls.setBlocked(false);
    walls.apply(WALL);
    expect(source.staged).toHaveLength(1);
  });

  it('rings only lot tiles, and keeps one highlight until the line changes', () => {
    const { walls, source } = tool(7, 5);
    walls.enter();
    walls.choosePoint(-0.45, 2.0);
    expect(walls.highlight()?.tiles).toEqual([[0, 2]]);
    const shown = walls.highlight();
    expect(walls.highlight()).toBe(shown);
    source.revision = 2;
    walls.afterCommands();
    expect(walls.highlight()).not.toBe(shown);
    walls.exit();
    expect(walls.highlight()).toBeNull();
  });

  it('forgets everything on exit and on Load, and takes the loaded lot size', () => {
    const { walls, source } = tool(7, 5);
    walls.enter();
    walls.choosePoint(1.6, 1.0);
    walls.exit();
    expect([walls.active, walls.line, walls.pending]).toEqual([false, null, null]);

    walls.enter();
    walls.choosePoint(1.6, 1.0);
    source.revision = 9;
    walls.resetAfterLoad(20, 12);
    expect([walls.line, walls.pending, walls.status]).toEqual([null, null, CHOOSE_LINE]);
    walls.choosePoint(15.6, 1.0);
    expect(walls.line).toEqual({ axis: 0, x: 16, y: 1 });
  });
});

describe('the chosen line on screen', () => {
  it('rings exactly the tiles it counts, in the tint for its validity', () => {
    const out = new Float32Array(64);
    const tiles = tilesBeside({ axis: 1, x: 3, y: 2 } as WallLine);
    expect(tileHighlightCount(null)).toBe(0);
    expect(writeTileHighlight(out, 5, null, 0, 0, 16, 1)).toBe(5);
    expect(tileHighlightCount({ tiles, valid: true })).toBe(2);
    expect(writeTileHighlight(out, 0, { tiles, valid: true }, 0, 0, 16, 1)).toBe(2);
    const validTint = Array.from(out.slice(0, 16));
    writeTileHighlight(out, 0, { tiles, valid: false }, 0, 0, 16, 1);
    expect(Array.from(out.slice(0, 16))).not.toEqual(validTint);
  });
});

describe('the Walls tool on real wasm', () => {
  it('builds, turns into a doorway, and removes a wall in the shipped house', () => {
    const bridge = new SimBridge(SimHandle.from_lot(), wasmMemory);
    const size = { width: 16, height: 12 };
    const walls = new WallTool(bridge, size.width, size.height, { changed: () => undefined });
    walls.enter();
    // The first vertical line the house accepts a wall on, as the Rust
    // boundary test finds it.
    let line: WallLine | null = null;
    for (let x = 1; x < size.width && line === null; x += 1) {
      for (let y = 0; y < size.height && line === null; y += 1) {
        const candidate: WallLine = { axis: 0, x, y };
        if (stateOf(bridge.wallEdges() ?? [], candidate) === OPEN
          && bridge.wallEditPreview(0, x, y, WALL).valid) line = candidate;
      }
    }
    expect(line).not.toBeNull();
    walls.choose(line!);
    const before = bridge.lotRevision();
    for (const [state, text] of [[WALL, 'Wall built.'], [DOORWAY, 'Doorway made.'],
      [OPEN, 'Wall removed.']] as const) {
      walls.apply(state);
      bridge.flushCommands();
      walls.afterCommands();
      expect([walls.current, walls.status]).toEqual([state, text]);
    }
    expect(bridge.lotRevision()).toBe(before + 3);
  });

  it('words every refusal the validator can give, and has a plain fallback', () => {
    for (const code of [1, 4, 5, 6, 8, 9, 10, 11, 12, 13]) {
      expect(wallReason(code)).toMatch(/^[A-Z].*\.$/);
    }
    expect(wallReason(0)).toBeNull();
    expect(wallReason(99)).toBe('That change is not possible.');
    const bridge = new SimBridge(SimHandle.from_lot(), wasmMemory);
    expect(bridge.wallEditPreview(0, 0, 1, WALL)).toEqual({
      valid: false,
      reason: 'The outside wall cannot be changed here.',
      code: 5,
    });
    expect(bridge.wallEditPreview(7, 0, 1, WALL).reason).toBe('Choose a line between two floor tiles.');
  });
});

describe('the Walls tool in the page', () => {
  const IDS = ['build-tool-furniture', 'build-tool-walls', 'furniture-tool', 'wall-tool',
    'wall-status', 'wall-build', 'wall-doorway', 'wall-remove', 'wall-keyboard-help',
    'wall-touch-help'];

  it.each(IDS)('declares #%s exactly once', (id) => {
    expect(INDEX_HTML.split(`id="${id}"`)).toHaveLength(2);
  });

  it('keeps the wall controls inside the build panel, hidden until the tool is chosen', () => {
    const panel = INDEX_HTML.slice(INDEX_HTML.indexOf('id="builder-controls"'),
      INDEX_HTML.indexOf('</section>', INDEX_HTML.indexOf('id="builder-controls"')));
    for (const id of IDS) expect(panel).toContain(`id="${id}"`);
    expect(panel).toContain('<div id="wall-tool" class="builder-tool" hidden>');
    expect(panel).toContain('aria-pressed="true">Furniture</button>');
  });

  it('keeps the build panel spacing inside every tool wrapper', () => {
    expect(INDEX_HTML).toContain('#furniture-tool, #wall-tool, #room-tool, #buy-tool { display: grid; gap: 8px; }');
    expect(INDEX_HTML).toContain('#furniture-tool[hidden], #wall-tool[hidden], #room-tool[hidden], #buy-tool[hidden] { display: none; }');
  });

  it('is wired into the frame, the click and Load', () => {
    for (const wiring of ['wallTool.afterCommands()', 'wallTool.highlight()',
      'wallTool.choosePoint(world[0], world[1])',
      'wallTool.resetAfterLoad(lotWidth, lotHeight)', 'wallTool.exit()']) {
      expect(MAIN_TS).toContain(wiring);
    }
  });

  it('routes Build mode keys the same way in both key listeners, and blocks with Build', () => {
    // The canvas listener handles every key; the document listener catches
    // Escape wherever focus is.
    expect(MAIN_TS.split('routeBuildKey(event.key, buildTools, builder)')).toHaveLength(3);
    expect(MAIN_TS).toContain('const buildTools = [wallTool, roomTool, buyTool] as const;');
    expect(MAIN_TS).toContain("wallTool.setBlocked(overlayPause.suspendedExcept('builder'))");
  });
});

describe('routeBuildKey', () => {
  function furniture() {
    const seen: string[] = [];
    return { seen, handleKey: (key: string) => { seen.push(key); return true; } };
  }

  it('gives every key to the furniture tool while Walls is not the tool', () => {
    const { walls } = tool();
    const builder = furniture();
    expect(routeBuildKey(']', [walls], builder)).toBe(true);
    expect(builder.seen).toEqual([']']);
  });

  it('keeps furniture keys away from a furniture tool the player cannot see', () => {
    const { walls } = tool();
    walls.enter();
    const builder = furniture();
    for (const key of [']', '[', 'r', 'R', 'Enter']) {
      expect(routeBuildKey(key, [walls], builder)).toBe(false);
    }
    expect(routeBuildKey('ArrowLeft', [walls], builder)).toBe(true);
    expect(builder.seen).toEqual([]);
  });

  it('lets Escape through to leave Build mode only once no line is chosen', () => {
    const { walls } = tool();
    walls.enter();
    walls.choosePoint(1.6, 1.0);
    const builder = furniture();
    expect(routeBuildKey('Escape', [walls], builder)).toBe(true);
    expect(builder.seen).toEqual([]);
    expect(routeBuildKey('Escape', [walls], builder)).toBe(true);
    expect(builder.seen).toEqual(['Escape']);
  });
});

describe('WallToolControls', () => {
  class FakeElement {
    hidden = false;
    disabled = false;
    textContent = '';
    readonly attributes = new Map<string, string>();
    readonly listeners: (() => void)[] = [];
    setAttribute(name: string, value: string) { this.attributes.set(name, value); }
    addEventListener(_type: string, listener: () => void) { this.listeners.push(listener); }
    click() { for (const listener of this.listeners) listener(); }
  }

  function controls(leave: () => boolean) {
    const elements = new Map<string, FakeElement>();
    const doc = {
      querySelector: (selector: string) => {
        const id = selector.slice(1);
        if (!elements.has(id)) elements.set(id, new FakeElement());
        return elements.get(id);
      },
    } as unknown as Document;
    const { walls, source } = tool();
    const fake = () => ({ active: false, enter() { this.active = true; },
      exit() { this.active = false; }, handleKey: () => false });
    const room = fake();
    const buy = fake();
    const view = new WallToolControls(doc, walls);
    let focused = 0;
    const toolSwitch = new BuildToolSwitch(doc, [
      { tool: walls, button: 'build-tool-walls', panel: 'wall-tool' },
      { tool: room, button: 'build-tool-room', panel: 'room-tool' },
      { tool: buy, button: 'build-tool-buy', panel: 'buy-tool' },
    ], { leaveFurniture: leave, focusView: () => { focused += 1; } });
    return { walls, room, buy, source, view, toolSwitch, focused: () => focused,
      element: (id: string) => elements.get(id)! };
  }

  it('switches tools only when the furniture tool could let go, and shows one panel', () => {
    let free = false;
    const { walls, room, buy, toolSwitch, element, focused } = controls(() => free);
    const panels = ['furniture-tool', 'wall-tool', 'room-tool', 'buy-tool'];
    const shown = () => panels.filter((id) => !element(id).hidden);
    const pressed = () => ['build-tool-furniture', 'build-tool-walls', 'build-tool-room', 'build-tool-buy']
      .filter((id) => element(id).attributes.get('aria-pressed') === 'true');
    const active = () => [walls.active, room.active, buy.active];
    expect([shown(), pressed()]).toEqual([['furniture-tool'], ['build-tool-furniture']]);
    element('build-tool-walls').click();
    element('build-tool-room').click();
    element('build-tool-buy').click();
    expect([...active(), focused()]).toEqual([false, false, false, 0]);
    free = true;
    element('build-tool-walls').click();
    toolSwitch.render();
    expect(active()).toEqual([true, false, false]);
    expect([shown(), pressed()]).toEqual([['wall-tool'], ['build-tool-walls']]);
    element('build-tool-room').click();
    toolSwitch.render();
    expect(active()).toEqual([false, true, false]);
    expect([shown(), pressed()]).toEqual([['room-tool'], ['build-tool-room']]);
    element('build-tool-buy').click();
    toolSwitch.render();
    expect(active()).toEqual([false, false, true]);
    expect([shown(), pressed()]).toEqual([['buy-tool'], ['build-tool-buy']]);
    element('build-tool-walls').click();
    toolSwitch.render();
    expect(active()).toEqual([true, false, false]);
    element('build-tool-furniture').click();
    toolSwitch.render();
    expect(active()).toEqual([false, false, false]);
    expect([shown(), pressed()]).toEqual([['furniture-tool'], ['build-tool-furniture']]);
    // Copilot on PR 95: each switch that happened hands the game view the
    // keys; the three refused ones did not.
    expect(focused()).toBe(5);
  });

  it('disables the button for the current state and for a refused one, and presses apply', () => {
    const { walls, source, view, element } = controls(() => true);
    element('build-tool-walls').click();
    source.refusals = [0, 12, 0];
    source.edges = [0, 2, 1, 1];
    walls.choosePoint(1.6, 1.0);
    view.render();
    expect(['wall-build', 'wall-doorway', 'wall-remove'].map((id) => element(id).disabled))
      .toEqual([true, true, false]);
    expect(element('wall-status').textContent).toBe(walls.status);
    element('wall-remove').click();
    expect(source.staged).toEqual([[0, 2, 1, OPEN]]);
    element('wall-build').click();
    expect(source.staged).toHaveLength(1);
  });

  it('shows the touch help on a phone and the keyboard help elsewhere', () => {
    const { view, element } = controls(() => true);
    view.setCompact(true);
    expect([element('wall-keyboard-help').hidden, element('wall-touch-help').hidden]).toEqual([true, false]);
    view.setCompact(false);
    expect([element('wall-keyboard-help').hidden, element('wall-touch-help').hidden]).toEqual([false, true]);
  });
});
