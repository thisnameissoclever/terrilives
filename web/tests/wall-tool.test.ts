import { readFileSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';
import init, { SimHandle } from '../src/wasm/terri_wasm.js';
import { SimBridge, wallReason, type WallEditPreview } from '../src/bridge.js';
import { tileHighlightCount, writeTileHighlight } from '../src/render/placement-preview.js';
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
    return { valid: code === 0, reason: wallReason(code) };
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

  it('never offers the outside wall', () => {
    expect(nearestLine(-0.45, 2.0, 7, 5)).toEqual({ axis: 0, x: 1, y: 2 });
    expect(nearestLine(6.45, 2.0, 7, 5)).toEqual({ axis: 0, x: 6, y: 2 });
    expect(nearestLine(3.0, -0.45, 7, 5)).toEqual({ axis: 1, x: 3, y: 1 });
    expect(nearestLine(3.0, 4.45, 7, 5)).toEqual({ axis: 1, x: 3, y: 4 });
    expect(nearestLine(40, -40, 7, 5)).toEqual({ axis: 0, x: 6, y: 0 });
  });

  it('falls back to the only axis a one-tile-wide or one-tile-deep lot has', () => {
    expect(nearestLine(0.0, 1.45, 1, 5)).toEqual({ axis: 1, x: 0, y: 2 });
    expect(nearestLine(1.45, 0.0, 5, 1)).toEqual({ axis: 0, x: 2, y: 0 });
  });

  it.each([
    [Number.NaN, 1, 7, 5],
    [1, Number.POSITIVE_INFINITY, 7, 5],
    [1, 1, 1, 1],
    [1, 1, 0, 5],
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
    for (let i = 0; i < 9; i += 1) walls.handleKey('ArrowUp');
    expect(walls.line).toEqual({ axis: 1, x: 4, y: 1 });
    walls.handleKey('V');
    for (let i = 0; i < 9; i += 1) walls.handleKey('ArrowLeft');
    expect(walls.line).toEqual({ axis: 0, x: 1, y: 1 });

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

  it('clears its choice on Escape, and leaves a second Escape to Build mode', () => {
    const { walls } = tool();
    walls.enter();
    walls.choosePoint(1.6, 1.0);
    expect(walls.handleKey('Escape')).toBe(true);
    expect(walls.line).toBeNull();
    expect(walls.highlight()).toBeNull();
    expect(walls.handleKey('Escape')).toBe(false);
  });

  it('forgets everything on exit and on Load, and takes the loaded lot size', () => {
    const { walls, source } = tool(7, 5);
    walls.enter();
    walls.choosePoint(1.6, 1.0);
    walls.apply(WALL);
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
    });
    expect(bridge.wallEditPreview(7, 0, 1, WALL).reason).toBe('Choose a line between two floor tiles.');
  });
});

describe('the Walls tool in the page', () => {
  const IDS = ['build-tool-furniture', 'build-tool-walls', 'furniture-tool', 'wall-tool',
    'wall-status', 'wall-build', 'wall-doorway', 'wall-remove'];

  it.each(IDS)('declares #%s exactly once', (id) => {
    expect(INDEX_HTML.split(`id="${id}"`)).toHaveLength(2);
  });

  it('keeps the wall controls inside the build panel, hidden until the tool is chosen', () => {
    const panel = INDEX_HTML.slice(INDEX_HTML.indexOf('id="builder-controls"'),
      INDEX_HTML.indexOf('</section>', INDEX_HTML.indexOf('id="builder-controls"')));
    for (const id of IDS) expect(panel).toContain(`id="${id}"`);
    expect(panel).toContain('<div id="wall-tool" hidden>');
    expect(panel).toContain('aria-pressed="true">Furniture</button>');
  });

  it('is wired into the frame, the click and Load', () => {
    for (const wiring of ['wallTool.afterCommands()', 'wallTool.highlight()',
      'wallTool.choosePoint(world[0], world[1])',
      'wallTool.resetAfterLoad(lotWidth, lotHeight)', 'wallTool.exit()']) {
      expect(MAIN_TS).toContain(wiring);
    }
  });

  it('reads its keys first in both key listeners, before Build mode does', () => {
    // The canvas listener handles every key; the document listener catches
    // Escape wherever focus is. Missing from either, a key reaches the
    // furniture builder instead, and Escape would leave Build mode with a
    // line still chosen.
    const routing = '(wallTool.active && wallTool.handleKey(event.key)) || builder.handleKey(event.key)';
    expect(MAIN_TS.split(routing)).toHaveLength(3);
  });
});
