import { readFileSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';
import init, { SimHandle } from '../src/wasm/terri_wasm.js';
import { SimBridge } from '../src/bridge.js';
import { coveredWindowLines, decodeWindowCatalogue, decodeWindowPlacements,
  decodeWindowPreview, windowAt } from '../src/architecture/windows.js';
import { LightingMode } from '../src/ui/lighting-mode.js';

let memory: WebAssembly.Memory;
beforeAll(async () => {
  ({ memory } = await init({ module_or_path: readFileSync('src/wasm/terri_wasm_bg.wasm') }));
});

function game() {
  const handle = SimHandle.from_lot();
  return { handle, bridge: new SimBridge(handle, memory) };
}

function projection(bridge: SimBridge) {
  return { windows: [...bridge.windowPlacements()], lines: [...bridge.windowLines()],
    positions: [...bridge.positions()], sprites: [...bridge.sprites()],
    colourways: [...bridge.colourways()], floors: [...bridge.floorTiles()], hash: bridge.worldHash() };
}

describe('typed windows through release WASM', () => {
  it('decodes Rust catalogue widths and expands both axes with canonical ownership', () => {
    const { handle, bridge } = game();
    try {
      const catalogue = bridge.windowCatalogue();
      expect(catalogue.map(({ id, width }) => [id, width])).toEqual([
        [1,1],[2,1],[3,1],[4,2],[5,2],[6,2],[7,3],[8,3],[9,3],
      ]);
      expect(catalogue.map(entry => entry.label)).toEqual(['Sash','Cottage','Arched','Sliding',
        'Steel-grid','Twin casement','Picture','Craftsman','Clerestory']);
      for (const definition of catalogue) {
        for (const axis of [0, 1] as const) {
          const window = { axis, x: 10, y: 2, model: definition.id };
          const lines = coveredWindowLines(window, catalogue);
          expect(lines).toHaveLength(definition.width);
          expect(lines.at(-1)).toEqual({ axis, x: 10 + (axis === 1 ? definition.width - 1 : 0),
            y: 2 + (axis === 0 ? definition.width - 1 : 0) });
          for (const line of lines) expect(windowAt([window], line, catalogue)).toEqual(window);
          expect(windowAt([window], { axis, x: 50, y: 50 }, catalogue)).toBeNull();
        }
      }
      // The helpers consume supplied widths, not another table keyed on ID.
      expect(coveredWindowLines({ axis: 0, x: 1, y: 1, model: 1 },
        [{ id: 1, label: 'Test', width: 3 }])).toHaveLength(3);
    } finally { handle.free(); }
  });

  it('round-trips every model and both rear axes before draining saved commands', () => {
    for (let model = 1; model <= 9; model += 1) {
      for (const [axis, x, y] of [[0,0,1], [1,10,0]]) {
        const source = game(); const restored = game();
        try {
          for (let tick = 0; tick < 13; tick += 1) source.handle.tick();
          expect(source.bridge.windowEditPreview(axis,x,y,model).valid).toBe(true);
          expect(source.bridge.fitWindow(axis,x,y,model)).toBe(true);
          source.bridge.flushCommands();
          expect(source.bridge.lastWindowEditResult()).toEqual({ reason: 0 });
          for (const [fx, covering] of [[2,1],[3,2],[4,3]]) {
            expect(source.handle.set_floor(fx,2,covering)).toBe(true);
          }
          source.bridge.flushCommands();
          expect([...source.bridge.floorTiles()]).toEqual([2,2,1,3,2,2,4,2,3]);
          const expectedWindows = [axis,x,y,model];
          expect([...source.bridge.windowPlacements()]).toEqual(expectedWindows);
          const width = source.bridge.windowCatalogue().find(entry => entry.id === model)!.width;
          expect(source.bridge.windowLines()).toHaveLength(width * 3);
          expect(source.bridge.removeWindow(axis,x,y)).toBe(true);
          expect(source.bridge.fitWindow(axis,x,y,model)).toBe(true);
          const saved = source.bridge.saveBytes();
          const expected = projection(source.bridge);
          expect(restored.bridge.loadBytes(saved)).toBe(true);
          expect(restored.bridge.saveBytes()).toEqual(saved);
          expect(projection(restored.bridge)).toEqual(expected);
          expect(restored.bridge.lastWindowEditResult()).toBeNull();
          expect(restored.handle.sim_tick()).toBe(13n);
          source.bridge.flushCommands(); restored.bridge.flushCommands();
          expect(restored.bridge.lastWindowEditResult()).toEqual({ reason: 0 });
          expect([...restored.bridge.windowPlacements()]).toEqual(expectedWindows);
          expect(restored.bridge.saveBytes()).toEqual(source.bridge.saveBytes());
          expect(restored.bridge.worldHash()).toBe(source.bridge.worldHash());
          expect(restored.handle.sim_tick()).toBe(13n);
        } finally { source.handle.free(); restored.handle.free(); }
      }
    }
  });

  it('starts a fresh pending boundary for repeated success and refusal, then reports authoritative application', () => {
    const { handle, bridge } = game();
    try {
      for (let repeat = 0; repeat < 2; repeat += 1) {
        expect(bridge.fitWindow(1,10,0,7)).toBe(true);
        expect(bridge.lastWindowEditResult()).toBeNull();
        bridge.flushCommands();
        expect(bridge.lastWindowEditResult()).toEqual({ reason: 0 });
        expect(bridge.lastWindowEditResult()).toEqual({ reason: 0 });
      }
      const preview = bridge.windowRemovalPreview(1,11,0);
      expect(preview).toEqual({ valid: true, reason: 0, placement: null,
        affectedLines: [{axis:1,x:10,y:0},{axis:1,x:11,y:0},{axis:1,x:12,y:0}] });
      for (let repeat = 0; repeat < 2; repeat += 1) {
        expect(bridge.fitWindow(1,15,0,7)).toBe(true);
        expect(bridge.lastWindowEditResult()).toBeNull();
        bridge.flushCommands();
        expect(bridge.lastWindowEditResult()).toEqual({ reason: 5 });
      }
      expect(bridge.fitWindow(1,10,0,10)).toBe(false);
      expect(bridge.lastWindowEditResult()).toEqual({ reason: 5 });
      expect(bridge.removeWindow(1,11,0)).toBe(true); bridge.flushCommands();
      expect(bridge.windowEditPreview(1,10,0,7).valid).toBe(true);
      expect(bridge.fitWindow(1,11,0,1)).toBe(true);
      expect(bridge.fitWindow(1,10,0,7)).toBe(true);
      expect(bridge.lastWindowEditResult()).toBeNull();
      bridge.flushCommands();
      expect(bridge.lastWindowEditResult()).toEqual({ reason: 18 });
      expect([...bridge.windowPlacements()]).toEqual([1,11,0,1]);
    } finally { handle.free(); }
  });

  it('rejects hostile inputs before unsigned conversion without staging or replacing state', () => {
    const { handle, bridge } = game();
    try {
      const saved = bridge.saveBytes();
      for (const bad of [NaN, Infinity, -Infinity, -1, 0.5, 2 ** 32]) {
        for (let slot = 0; slot < 4; slot += 1) {
          const args: [number,number,number,number] = [1,10,0,7]; args[slot] = bad;
          expect(bridge.fitWindow(...args)).toBe(false);
          expect(bridge.windowEditPreview(...args)).toMatchObject({ valid: false, reason: 1 });
          if (slot < 3) {
            expect(bridge.removeWindow(args[0],args[1],args[2])).toBe(false);
            expect(bridge.windowRemovalPreview(args[0],args[1],args[2])).toMatchObject({ valid:false, reason:1 });
          }
          expect(bridge.saveBytes()).toEqual(saved);
        }
      }
      for (const model of [0,10,256]) expect(bridge.fitWindow(1,10,0,model)).toBe(false);
      expect(bridge.fitWindow(2,10,0,7)).toBe(false);
      expect(bridge.fitWindow(1,0xffffffff,0,7)).toBe(false);
      expect(bridge.saveBytes()).toEqual(saved);
      expect(bridge.lastWindowEditResult()).toBeNull();
    } finally { handle.free(); }
  });

  it('preserves legacy Sash and floor IDs, hashes model identity, and ignores lighting preferences', () => {
    const { handle, bridge } = game(); const restored = game();
    try {
      expect(bridge.setWallEdge(0,8,4,3)).toBe(true); bridge.flushCommands();
      expect([...bridge.windowPlacements()]).toEqual([0,8,4,1]);
      expect(bridge.coveringNames()).toEqual(['Boards','Tiles','Carpet']);
      const old = bridge.saveBytes();
      expect(restored.bridge.loadBytes(old)).toBe(true);
      expect(restored.bridge.saveBytes()).toEqual(old);
      expect(restored.bridge.windowPlacements()).toEqual(bridge.windowPlacements());
      expect(bridge.fitWindow(0,8,4,1)).toBe(true); bridge.flushCommands();
      const sash = bridge.worldHash();
      expect(bridge.fitWindow(0,8,4,2)).toBe(true); bridge.flushCommands();
      expect(bridge.worldHash()).not.toBe(sash);
      const cottage = bridge.worldHash();
      const mode = new LightingMode({ textContent: '', disabled: false, setAttribute() {} });
      expect(mode.toggle()).toBe(true);
      expect(bridge.worldHash()).toBe(cottage);
      expect(mode.toggle()).toBe(false);
      expect(bridge.worldHash()).toBe(cottage);
    } finally { handle.free(); restored.handle.free(); }
  });
});

it('rejects incomplete descriptors, unknown model IDs and malformed catalogue or preview rows', () => {
  for (const words of [[0], [0,1], [0,1,2], [0,1,2,0], [0,1,2,10], [2,1,2,1]]) {
    expect(() => decodeWindowPlacements(new Uint32Array(words))).toThrow();
  }
  expect(() => decodeWindowCatalogue(new Uint32Array([1,1,1,2]), ['a','b'])).toThrow();
  expect(() => decodeWindowCatalogue(new Uint32Array([1,4]), ['a'])).toThrow();
  expect(() => decodeWindowCatalogue(new Uint32Array([1]), ['a'])).toThrow();
  for (const words of [[],[0],[0,2],[0,1,0,1],[0,0,1]]) {
    expect(() => decodeWindowPreview(new Uint32Array(words))).toThrow();
  }
  expect(() => coveredWindowLines({axis:0,x:0,y:0xffffffff,model:7},
    [{id:7,label:'Picture',width:3}])).toThrow();
});
