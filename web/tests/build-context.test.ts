import { readFileSync } from 'node:fs';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import init, { SimHandle } from '../src/wasm/terri_wasm.js';
import { SimBridge } from '../src/bridge.js';
import { FurnitureBuilder } from '../src/ui/builder.js';
import { BuyTool } from '../src/ui/buy-tool.js';
import { FloorTool } from '../src/ui/floor-tool.js';
import { WindowTool } from '../src/ui/window-tool.js';
import { RoomTool } from '../src/ui/room-tool.js';
import { WallTool, WALL, DOORWAY, WINDOW, OPEN } from '../src/ui/wall-tool.js';
import { OverlayPauseController } from '../src/ui/overlay-pause.js';
import { BuildContextActions, contextModel, contextPosition, type ContextTools } from '../src/ui/placement-actions.js';
import { shortcutGroups } from '../src/ui/shortcuts.js';

let memory: WebAssembly.Memory;
beforeAll(async () => {
  memory = (await init({ module_or_path: readFileSync('src/wasm/terri_wasm_bg.wasm') })).memory;
});

function fixture(singleFacing = false) {
  const handle = SimHandle.from_lot();
  const source = new SimBridge(handle, memory);
  if (singleFacing) {
    const catalogue = source.catalogue();
    vi.spyOn(source, 'catalogue').mockReturnValue(catalogue.map((item, index) =>
      index === 0 ? { ...item, facings: 1 << item.baseFacing } : item));
  }
  const hooks = { changed() {} };
  const furniture = new FurnitureBuilder(source,
    new OverlayPauseController({ setSpeed() {} }, () => {}, 1), { ...hooks, enter() {}, exit() {} });
  const tools: ContextTools = { furniture, buy: new BuyTool(source, 16, 12, hooks),
    walls: new WallTool(source, 16, 12, hooks), room: new RoomTool(source, 16, 12, hooks),
    floors: new FloorTool(source, 16, 12, hooks), focusCatalogue: vi.fn() };
  furniture.enter();
  return { handle, source, ...tools, tools };
}

describe('context actions use the active controller', () => {
  it('shows nothing without a selection, outside Build, or while a dialog suspends it', () => {
    const f = fixture();
    try {
      expect(contextModel(f.tools)).toBeNull();
      f.furniture.select(7);
      expect(contextModel(f.tools)?.actions).toHaveLength(5);
      expect(contextModel({ ...f.tools, suspended: () => true })).toBeNull();
      f.furniture.setBlocked(true);
      expect(contextModel(f.tools)).toBeNull();
      f.furniture.setBlocked(false); f.furniture.exit();
      expect(contextModel(f.tools)).toBeNull();
    } finally { f.handle.free(); }
  });

  it('furniture uses actual payout, both supported rotations, Confirm, Sell and Cancel', () => {
    const f = fixture();
    try {
      f.furniture.select(7);
      const actions = contextModel(f.tools)!.actions;
      expect(actions.find(a => a.id === 'sell')!.label).toBe(`Sell for ${f.furniture.saleValue}`);
      const first = f.furniture.preview!.facing;
      actions.find(a => a.id === 'left')!.invoke();
      expect(f.furniture.preview!.facing).toBe((first + 3) % 4);
      actions.find(a => a.id === 'right')!.invoke();
      expect(f.furniture.preview!.facing).toBe(first);
      const confirm = vi.spyOn(f.furniture, 'confirm');
      actions.find(a => a.id === 'confirm')!.invoke();
      expect(confirm).toHaveBeenCalledOnce();
      const selected = f.furniture.selected;
      actions.find(a => a.id === 'cancel')!.invoke();
      expect(f.furniture.selected).toBe(selected); // A command on its way owns the selection.
      f.source.flushCommands(); f.furniture.afterCommands();
      f.furniture.select(7);
      const sale = vi.spyOn(f.furniture, 'sell');
      contextModel(f.tools)!.actions.find(a => a.id === 'sell')!.invoke();
      expect(sale).toHaveBeenCalledOnce();
      f.source.flushCommands(); f.furniture.afterCommands();
      f.furniture.select(8);
      contextModel(f.tools)!.actions.find(a => a.id === 'cancel')!.invoke();
      expect(f.furniture.selected).toBeNull();
    } finally { f.handle.free(); }
  });

  it('Buy retains actual prices and catalogue focus, and disables an unaffordable purchase', () => {
    const f = fixture();
    try {
      f.buy.enter();
      const item = f.buy.items.find(item => item.facings === 15)!;
      expect(item).toBeDefined(); f.buy.choose(item.definition);
      let model = contextModel(f.tools)!;
      expect(model.tool).toBe('buy');
      expect(model.actions.find(a => a.id === 'confirm')!.label).toBe(`Buy · ${item.price.toLocaleString('en-US')}`);
      expect(model.actions.find(a => a.id === 'confirm')!.enabled).toBe(false);
      const first = f.buy.preview!.facing;
      model.actions.find(a => a.id === 'left')!.invoke();
      expect(f.buy.preview!.facing).toBe((first + 3) % 4);
      model.actions.find(a => a.id === 'right')!.invoke();
      expect(f.buy.preview!.facing).toBe(first);
      model.actions.find(a => a.id === 'choose')!.invoke();
      expect(f.focusCatalogue).toHaveBeenCalledOnce();
      const saved = f.source.saveBytes();
      model.actions.find(a => a.id === 'confirm')!.invoke();
      f.source.flushCommands(); f.buy.afterCommands();
      expect(f.source.saveBytes()).toEqual(saved);
      model.actions.find(a => a.id === 'cancel')!.invoke();
      expect(contextModel(f.tools)).toBeNull();
    } finally { f.handle.free(); }
  });

  it('disables both rotation controls for an explicitly single-facing catalogue item', () => {
    const f = fixture(true);
    try {
      f.buy.enter();
      const fixed = f.buy.items.find(item => (item.facings & (item.facings - 1)) === 0)!;
      expect(fixed).toBeDefined();
      expect(fixed.facings).toBe(1 << fixed.baseFacing);
      f.buy.choose(fixed.definition);
      const rotations = contextModel(f.tools)!.actions.filter(a => a.id === 'left' || a.id === 'right');
      expect(rotations).toHaveLength(2);
      expect(rotations.every(action => !action.enabled)).toBe(true);
    } finally { f.handle.free(); }
  });

  it('Walls rotates only its selection and applies each state through its validator', () => {
    const f = fixture();
    try {
      f.walls.enter(); f.walls.choosePoint(1.6, 1);
      const model = contextModel(f.tools)!;
      const before = f.source.saveBytes(); const axis = f.walls.line!.axis;
      model.actions.find(a => a.id === 'left')!.invoke();
      expect(f.walls.line!.axis).toBe(1 - axis);
      model.actions.find(a => a.id === 'right')!.invoke();
      expect(f.walls.line!.axis).toBe(axis);
      f.source.flushCommands(); expect(f.source.saveBytes()).toEqual(before);
      for (const [id, state] of [['wall', WALL], ['doorway', DOORWAY], ['window', WINDOW], ['remove', OPEN]] as const) {
        expect(contextModel(f.tools)!.actions.find(a => a.id === id)!.enabled).toBe(f.walls.canApply(state));
        const apply = vi.spyOn(f.walls, 'apply');
        contextModel(f.tools)!.actions.find(a => a.id === id)!.invoke();
        expect(apply).toHaveBeenLastCalledWith(state);
        f.source.flushCommands(); f.walls.afterCommands(); apply.mockRestore();
      }
      f.walls.pending = WALL;
      const line = { ...f.walls.line! };
      f.walls.rotate(); f.walls.clearSelection();
      expect(f.walls.line).toEqual(line);
      expect(contextModel(f.tools)!.actions.every(a => !a.enabled)).toBe(true);
      f.walls.pending = null; f.walls.setBlocked(true); f.walls.rotate(); f.walls.clearSelection();
      expect(f.walls.line).toEqual(line);
      f.walls.setBlocked(false);
      contextModel(f.tools)!.actions.find(a => a.id === 'clear')!.invoke();
      expect(contextModel(f.tools)).toBeNull();
    } finally { f.handle.free(); }
  });

  it('Room offers outline editing without building and guards pending corner changes', () => {
    const f = fixture();
    try {
      f.room.enter(); f.room.choosePoint(2, 1); f.room.choosePoint(3, 2);
      const before = f.source.saveBytes();
      contextModel(f.tools)!.actions.find(a => a.id === 'doorway')!.invoke();
      expect(f.room.doorwayMode).toBe(true);
      f.room.choosePoint(7, 7); expect(f.room.second).toEqual([3, 2]);
      f.room.choosePoint(1.55, 1); expect(f.room.doorway).not.toBeNull();
      f.room.chooseDoorway(); f.room.choosePoint(1.55, 1); expect(f.room.doorway).toBeNull();
      const pending = vi.spyOn(f.room, 'pending', 'get').mockReturnValue(true);
      f.room.restartCorners(); f.room.chooseDoorway();
      expect(f.room.second).toEqual([3, 2]);
      expect(contextModel(f.tools)!.actions.every(a => !a.enabled)).toBe(true);
      pending.mockRestore();
      contextModel(f.tools)!.actions.find(a => a.id === 'corners')!.invoke();
      expect(f.room.first).toBeNull();
      f.source.flushCommands(); expect(f.source.saveBytes()).toEqual(before);
      f.room.choosePoint(2, 1); f.room.choosePoint(3, 2);
      const build = vi.spyOn(f.room, 'build');
      contextModel(f.tools)!.actions.find(a => a.id === 'build')!.invoke();
      expect(build).toHaveBeenCalledOnce();
      f.source.flushCommands(); f.room.afterCommands();
      f.room.choosePoint(2, 1);
      contextModel(f.tools)!.actions.find(a => a.id === 'cancel')!.invoke();
      expect(f.room.first).toBeNull();
    } finally { f.handle.free(); }
  });

  it('Floors reads content names and selection never paints, even after an application', () => {
    const f = fixture();
    try {
      f.floors.enter(); const saved = f.source.saveBytes();
      f.floors.handleKey('1'); expect(f.floors.status).toBe('Select a tile first.');
      f.floors.choosePoint(4, 4); f.source.flushCommands();
      expect(f.source.saveBytes()).toEqual(saved);
      const model = contextModel(f.tools)!;
      expect(model.actions.filter(a => a.id.startsWith('floor-')).map(a => a.label)).toEqual(f.source.coveringNames());
      for (const action of model.actions.filter(a => a.id.startsWith('floor-') || a.id === 'remove')) {
        const apply = vi.spyOn(f.floors, 'applyCovering');
        action.invoke(); expect(apply).toHaveBeenCalledOnce();
        f.source.flushCommands(); f.floors.afterCommands(); apply.mockRestore();
      }
      const after = f.source.saveBytes();
      f.floors.choosePoint(5, 4); f.source.flushCommands(); expect(f.source.saveBytes()).toEqual(after);
      f.floors.pending = 1; f.floors.clearSelection();
      expect(f.floors.tile).toEqual([5, 4]);
      expect(contextModel(f.tools)!.actions.every(a => !a.enabled)).toBe(true);
      f.floors.pending = null;
      f.floors.setBlocked(true);f.floors.handleKey('Escape');
      expect(f.floors.tile).toEqual([5, 4]);
      f.floors.setBlocked(false);
      contextModel(f.tools)!.actions.find(a => a.id === 'clear')!.invoke();
      expect(contextModel(f.tools)).toBeNull();
    } finally { f.handle.free(); }
  });
});

it('unchanged frames neither render nor measure; camera, buffer and invalidation each place again', () => {
  const f = fixture();
  try {
    f.furniture.select(7);
    const surface = { render: vi.fn(), place: vi.fn() };
    const art = vi.fn(() => ({ height: 40, offsetX: 3 }));
    const actions = new BuildContextActions(f.tools, surface, art);
    const camera = { scale: 1, originX: 400, originY: 60 };
    actions.frame(camera, 800, 600);
    for (let i = 0; i < 20; i++) actions.frame(camera, 800, 600);
    expect(surface.render).toHaveBeenCalledTimes(1); expect(surface.place).toHaveBeenCalledTimes(1); expect(art).toHaveBeenCalledTimes(1);
    camera.originX += 10; actions.frame(camera, 800, 600);
    expect(surface.render).toHaveBeenCalledTimes(1); expect(surface.place).toHaveBeenCalledTimes(2);
    camera.scale *= 1.12; actions.frame(camera, 800, 600);
    actions.frame(camera, 1600, 1200); actions.invalidate(); actions.frame(camera, 1600, 1200);
    expect(surface.place).toHaveBeenCalledTimes(5); expect(surface.render).toHaveBeenCalledTimes(2);
    f.furniture.cancel(); actions.invalidate(); actions.frame(camera, 1600, 1200);
    expect(surface.render).toHaveBeenLastCalledWith(null);
    expect(surface.place).toHaveBeenCalledTimes(5);
  } finally { f.handle.free(); }
});

it.each([1440, 1280, 701, 700, 390, 320, 844])('bounds the complete controls at %ipx, respecting the sidebar or bottom dock', width => {
  const compact = width <= 700 || width === 844;
  const bounds = { width, bottom: compact ? 380 : 800,
    keepOut: { left: compact ? 0 : 312, gearLeft: 8, gearRight: compact ? 312 : 312, gearBottom: 156 } };
  for (const x of [0, width / 2, width]) for (const y of [0, 200, 900]) {
    const rect = contextPosition(x, y, y + 80, bounds, 62, 44);
    expect(rect.x).toBeGreaterThanOrEqual(bounds.keepOut.left + 8);
    expect(rect.x + rect.width).toBeLessThanOrEqual(width - 8);
    expect(rect.y).toBeGreaterThanOrEqual(8);
    expect(rect.y + rect.height).toBeLessThanOrEqual(bounds.bottom - 8);
  }
});

it('shared shortcut definitions describe the changed floor workflow and separate wall actions', () => {
  const room = shortcutGroups('room', []).flatMap(group => group.rows);
  expect(room.filter(row => row.keys.includes('Enter')).map(row => row.label))
    .toEqual(['Set first corner', 'Build completed outline']);
  expect(room.find(row => row.label === 'Move corner')?.keys).toEqual(['↑', '↓', '←', '→']);
  const floors = shortcutGroups('floors', ['Boards', 'Tiles', 'Carpet']);
  expect(JSON.stringify(floors)).toContain('Boards');
  const walls = shortcutGroups('walls', []);
  expect(JSON.stringify(walls)).toContain('Doorway');
  expect(JSON.stringify(walls)).toContain('Window');
});

it('reports intrinsic row height when the available space cannot fit the controls', () => {
  const at = contextPosition(160, 40, 80, { width: 320, bottom: 100,
    keepOut: { left: 0, gearLeft: 0, gearRight: 320, gearBottom: 70 } }, 180, 80);
  expect(at.compact).toBe(true);
  expect(at.height).toBe(266);
});

it('typed window changes refresh cached contextual fit and removal capabilities', () => {
  const f = fixture();
  try {
    let actions: BuildContextActions | undefined;
    const main = readFileSync(new URL('../src/main.ts', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
    const start = main.indexOf('const windowTool = new WindowTool');
    const first = main.indexOf('changed: () => {', start) + 'changed: () => {'.length;
    const last = main.indexOf('    },', first);
    if (start < 0 || last < first) throw new Error('Missing production window change hook');
    const changed = new Function('ctx', `with(ctx) { ${main.slice(first, last)} }`);
    const ctx = { placementActions: undefined as BuildContextActions | undefined,
      windowTool: undefined as WindowTool | undefined, lot: { windowPreview: null as ReturnType<WindowTool['preview']> },
      cameraDirty: false, windowControls: undefined, wallControls: undefined };
    const windows = new WindowTool(f.source, f.handle.lot_width(), f.handle.lot_height(), {
      changed() { changed(ctx); },
    });
    ctx.windowTool = windows;
    const walls = new WallTool(f.source, f.handle.lot_width(), f.handle.lot_height(), {
      changed() { actions?.invalidate(); },
    }, windows);
    const surface = { render: vi.fn<(model: ReturnType<typeof contextModel>) => void>(), place: vi.fn() };
    actions = new BuildContextActions({ ...f.tools, walls }, surface, () => ({ height: 40, offsetX: 0 }));
    ctx.placementActions = actions;
    const camera = { scale: 1, originX: 400, originY: 60 };
    f.source.fitWindow(1, 10, 0, 7); f.source.flushCommands();
    walls.enter(); walls.choose({ axis: 1, x: 12, y: 0 }); windows.chooseModel(7);
    actions.frame(camera, 800, 600);
    let model = surface.render.mock.lastCall![0]!;
    expect(model.actions.find(a => a.id === 'fit-window')!.enabled).toBe(false);
    expect(model.actions.find(a => a.id === 'remove-window')!.enabled).toBe(true);
    windows.chooseModel(4); actions.frame(camera, 800, 600);
    model = surface.render.mock.lastCall![0]!;
    expect(model.actions.find(a => a.id === 'fit-window')!.enabled).toBe(true);
    model.actions.find(a => a.id === 'fit-window')!.invoke(); actions.frame(camera, 800, 600);
    expect(surface.render.mock.lastCall![0]!.actions.every(a => !a.enabled)).toBe(true);
    f.source.flushCommands(); windows.afterCommands(); walls.afterCommands(); actions.frame(camera, 800, 600);
    surface.render.mock.lastCall![0]!.actions.find(a => a.id === 'remove-window')!.invoke();
    f.source.flushCommands(); windows.afterCommands(); actions.frame(camera, 800, 600);
    expect(f.source.windowPlacements()).toHaveLength(0);
    expect(surface.render.mock.lastCall![0]!.actions.some(a => a.id === 'remove-window')).toBe(false);
    expect(ctx.cameraDirty).toBe(true);
    expect(ctx.lot.windowPreview).toEqual(windows.preview());
  } finally { f.handle.free(); }
});
