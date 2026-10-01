import { readFileSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';
import init, { SimHandle } from '../src/wasm/terri_wasm.js';
import { SimBridge, wallReason, windowReason, roomReason } from '../src/bridge.js';
import { WindowTool } from '../src/ui/window-tool.js';
import { WallTool } from '../src/ui/wall-tool.js';
import { coveredWindowLines, decodeWindowPlacements } from '../src/architecture/windows.js';
import { windowOwnerKey, windowPreviewLayout } from '../src/render/placement-preview.js';
import { buildArchitectureWallGeometry } from '../src/render/architecture-geometry.js';
import { buildStaticInstances } from '../src/render/tiles.js';
import { ARCHITECTURE } from '../src/render/architecture-data.js';

let memory: WebAssembly.Memory;
beforeAll(async () => { ({ memory } = await init({ module_or_path: readFileSync('src/wasm/terri_wasm_bg.wasm') })); });
function fixture() {
  const handle = SimHandle.from_lot(), bridge = new SimBridge(handle, memory);
  const tool = new WindowTool(bridge, 16, 16, { changed() {} });
  const walls = new WallTool(bridge, 16, 16, { changed() {} }, tool);
  return { handle, bridge, tool, walls };
}
describe('whole-window controller', () => {
  it('previews, fits, selects from middle/end, replaces and removes all nine models on both axes', () => {
    for (const axis of [0, 1] as const) for (let model = 1; model <= 9; model++) {
      const { handle, bridge, tool, walls } = fixture();
      try {
        walls.enter(); walls.handleKey('N'); tool.chooseModel(model as 1);
        const start = { axis, x: axis === 0 ? 0 : 10, y: axis === 0 ? 1 : 0 };
        tool.choose(start);
        const saved = bridge.saveBytes();
        expect(tool.canApply()).toBe(true);
        const preview = tool.preview()!;
        expect(preview.placement?.model).toBe(model);
        expect(tool.highlight()?.tiles.length).toBe(tool.catalogue[model - 1].width);
        expect(bridge.saveBytes()).toEqual(saved);
        tool.apply(); expect(tool.pending).toBe('fit'); expect(tool.status).toBe('Applying window change.');
        tool.afterCommands(); expect(tool.pending).toBe('fit');
        bridge.flushCommands(); tool.afterCommands(); expect(tool.status).toBe('Window fitted.');
        const owner = decodeWindowPlacements(bridge.windowPlacements())[0];
        for (const line of coveredWindowLines(owner, tool.catalogue)) {
          walls.selectWalls(); walls.choose(line);
          expect(tool.active).toBe(true); expect(tool.owner).toEqual(owner); expect(tool.line).toEqual(start);
        }
        tool.chooseModel(model === 1 ? 2 : 1); expect(tool.canApply()).toBe(true);
        expect(tool.preview()?.affectedLines).toHaveLength(tool.catalogue[model - 1].width);
        tool.apply(); bridge.flushCommands(); tool.afterCommands();
        tool.remove(); bridge.flushCommands(); tool.afterCommands();
        expect(tool.status).toBe('Window removed.'); expect(bridge.windowPlacements()).toHaveLength(0);
      } finally { handle.free(); }
    }
  });

  it('keeps pending ownership across exit and re-entry, ignores stale success on queue refusal, and retains last model', () => {
    const { handle, bridge, tool, walls } = fixture();
    try {
      walls.enter(); walls.selectWindows(); tool.chooseModel(7); tool.choose({ axis: 1, x: 10, y: 0 });
      tool.apply(); walls.exit(); walls.enter();
      expect(tool.active).toBe(true); expect(tool.pending).toBe('fit');
      tool.chooseModel(1); tool.handleKey('Escape'); tool.remove();
      expect(tool.chosen).toBe(7); expect(tool.line).toEqual({ axis: 1, x: 10, y: 0 });
      tool.afterCommands(); expect(tool.pending).toBe('fit');
      bridge.flushCommands(); tool.afterCommands(); expect(tool.pending).toBeNull();
      tool.chooseModel(1); tool.apply(); expect(bridge.lastWindowEditResult()).toBeNull();
      tool.afterCommands(); expect(tool.status).toBe('Applying window change.');
      bridge.flushCommands(); tool.afterCommands();
      const fit = bridge.fitWindow.bind(bridge);
      bridge.fitWindow = () => false;
      tool.chooseModel(7); tool.apply(); tool.afterCommands();
      expect(tool.pending).toBeNull(); expect(tool.status).toBe('That change could not be sent.');
      expect(tool.owner?.model).toBe(1); bridge.fitWindow = fit;
      walls.exit(); walls.enter(); walls.selectWindows(); expect(tool.chosen).toBe(7);
      tool.choose({ axis: 1, x: 10, y: 0 }); tool.apply(); walls.exit();
      bridge.flushCommands(); tool.afterCommands();
      expect(tool.pending).toBeNull(); expect(tool.line).toBeNull();
      walls.enter(); walls.selectWindows(); expect(tool.chosen).toBe(7);
    } finally { handle.free(); }
  });

  it('shows the authoritative refusal after a different queued change invalidates the preview', () => {
    const { handle, bridge, tool, walls } = fixture();
    try {
      bridge.fitWindow(1, 10, 0, 7); bridge.flushCommands();
      walls.enter(); walls.choose({ axis: 1, x: 11, y: 0 }); tool.chooseModel(1);
      // Removal first means the queued replacement must find a solid wall; occupy it with another owner first.
      bridge.removeWindow(1, 10, 0); bridge.fitWindow(1, 11, 0, 1);
      tool.chooseModel(8); tool.apply(); bridge.flushCommands(); tool.afterCommands();
      expect(tool.status).toBe(windowReason(18)); expect(tool.line).toEqual({ axis: 1, x: 10, y: 0 });
      expect(tool.canApply()).toBe(false);
    } finally { handle.free(); }
  });

  it('covers the invalid third line, model switches, touch coordinates, blocking and loaded lot dimensions', () => {
    const { handle, bridge, tool, walls } = fixture();
    try {
      walls.enter(); walls.selectWindows(); tool.chooseModel(7); tool.choosePoint(14, -.5);
      expect(tool.canApply()).toBe(false); expect(tool.highlight()?.valid).toBe(false);
      expect(tool.status).toBe(windowReason(5));
      tool.chooseModel(1); expect(tool.canApply()).toBe(true);
      tool.setBlocked(true); const line = tool.line; tool.choosePoint(10, -.5); tool.chooseModel(9); tool.apply();
      expect(tool.line).toEqual(line); expect(tool.chosen).toBe(1); expect(bridge.windowPlacements()).toHaveLength(0);
      tool.setBlocked(false); tool.handleKey('V'); expect(tool.line?.axis).toBe(0);
      tool.handleKey('H'); expect(tool.line?.axis).toBe(1);
      const beforeShortcut = tool.line; walls.handleKey('N'); expect(tool.line).toBe(beforeShortcut);
      const smaller = new SimHandle(3, 2);
      try {
        expect(bridge.loadBytes(new SimBridge(smaller, memory).saveBytes())).toBe(true);
      } finally { smaller.free(); }
      tool.resetAfterLoad(handle.lot_width(), handle.lot_height()); tool.handleKey('ArrowRight');
      expect(tool.line).toEqual({ axis: 0, x: 1, y: 1 });
      for (let i = 0; i < 8; i++) tool.handleKey('ArrowRight');
      expect(tool.line?.x).toBe(3); tool.handleKey('H'); expect(tool.line?.x).toBe(2);
      expect(tool.handleKey('Escape')).toBe(true); expect(tool.preview()).toBeNull();
    } finally { handle.free(); }
  });

  it('uses literal shared reasons for the new window refusal codes', () => {
    for (const [code, reason] of [[18, 'Fit the entire window into a solid wall.'],
      [19, 'A window cannot cross a wall junction.'], [20, 'Select the whole window to change it.']] as const) {
      expect(windowReason(code)).toBe(reason); expect(wallReason(code)).toBe(reason);
    }
    expect(roomReason(20)).toBe(windowReason(20));
  });
});

describe('window preview geometry', () => {
  it('hides the old owner, restores opaque tails, keeps adjacent arms, and leaves the lot unchanged', () => {
    const { handle, bridge, tool } = fixture();
    try {
      bridge.fitWindow(1, 10, 0, 7); bridge.flushCommands();
      const windows = decodeWindowPlacements(bridge.windowPlacements()), edges = bridge.wallEdges()!;
      const saved = bridge.saveBytes(), edgeCopy = edges.slice(), windowCopy = structuredClone(windows);
      tool.enter(); tool.choose({ axis: 1, x: 12, y: 0 }); tool.chooseModel(1);
      const preview = tool.preview()!;
      const candidate = windowPreviewLayout(edges, windows, tool.catalogue, preview);
      expect(candidate.windows).toEqual([{ axis: 1, x: 10, y: 0, model: 1 }]);
      expect([...candidate.edges]).toEqual(expect.arrayContaining([1, 11, 0, 0, 1, 12, 0, 0]));
      const base = { width: 16, height: 16, house: [16, 16] as const, catalogue: tool.catalogue, cutaway: false };
      const before = buildArchitectureWallGeometry({ ...base, windows, edges });
      const after = buildArchitectureWallGeometry({ ...base, ...candidate });
      expect(after.some(panel => panel.fadeKey === windowOwnerKey(windows[0]))).toBe(false);
      expect(after.filter(panel => panel.window)).toHaveLength(1);
      for (const key of ['arm/11/0/0', 'arm/12/0/0', 'arm/12/0/2', 'arm/13/0/2']) {
        expect(after.find(panel => panel.fadeKey === key)?.low).toBe(false);
      }
      for (const panel of before.filter(panel => panel.fadeKey?.startsWith('arm/2/'))) expect(after).toContainEqual(panel);
      const lot = { ...base, edges, walls: new Uint32Array(), architecture: { windows, catalogue: tool.catalogue },
        windowPreview: preview, showCutAwayWalls: true };
      const geometry = buildStaticInstances(lot, 0, 0, 16);
      const windowIds = new Set<number>(ARCHITECTURE.sprites.filter(sprite => sprite.kind === 'window').map(sprite => sprite.id));
      const rows = Array.from({ length: geometry.count }, (_, i) => [...geometry.instances.slice(i * 16, i * 16 + 16)])
        .filter(row => windowIds.has(row[3]));
      expect(rows).toHaveLength(1); expect(rows[0].slice(4, 7)).toEqual([.75, expect.closeTo(.9), 1]);
      tool.chooseModel(4); tool.handleKey('Escape');
      expect(bridge.saveBytes()).toEqual(saved); expect(edges).toEqual(edgeCopy); expect(windows).toEqual(windowCopy);
    } finally { handle.free(); }
  });
});
