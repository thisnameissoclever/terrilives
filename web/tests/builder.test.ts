import { beforeAll, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import init, { SimHandle } from '../src/wasm/terri_wasm.js';
import { SimBridge } from '../src/bridge.js';
import { OverlayPauseController } from '../src/ui/overlay-pause.js';
import { FurnitureBuilder } from '../src/ui/builder.js';
import { buildInstances, instanceCount } from '../src/frame.js';
import { buildLightField, sampleLight } from '../src/render/lighting.js';
import { placementInstanceCount } from '../src/render/placement-preview.js';
import { spriteIndex } from '../src/render/atlas.js';
import { FLOATS_PER_INSTANCE as STRIDE } from '../src/render/instances.js';

let memory: WebAssembly.Memory;
beforeAll(async () => {
  memory = (await init({ module_or_path: readFileSync('src/wasm/terri_wasm_bg.wasm') })).memory;
});

it('commits a valid move before selecting another object without advancing time', () => {
  const { handle, source, builder } = fixture();
  builder.enter(); builder.select(15); builder.moveTo(7, 0);
  const tick = source.clockTick();
  builder.select(22);
  expect(builder.pending).toBe(true);
  expect(builder.selected).toBe(15);
  builder.select(7);
  source.flushCommands(); builder.afterCommands();
  expect(builder.selected).toBe(22);
  expect(source.lotRevision()).toBe(1);
  expect(source.clockTick()).toBe(tick);
  builder.select(15);
  expect(builder.preview).toMatchObject({ x: 7, y: 0 });
  expect(builder.pending).toBe(false);
  handle.free();
});

it('switches immediately after manual Confirm without queuing a duplicate placement', () => {
  const { handle, source, builder } = fixture();
  builder.enter(); builder.select(15); builder.moveTo(7, 0);
  builder.confirm(); source.flushCommands(); builder.afterCommands();
  builder.select(22);
  expect(builder.selected).toBe(22);
  expect(builder.pending).toBe(false);
  source.flushCommands(); builder.afterCommands();
  expect(source.lotRevision()).toBe(1);
  handle.free();
});

it('clears an automatic selection handoff on Load before subsequent placement', () => {
  const { handle, source, builder } = fixture();
  const saved = source.saveBytes();
  builder.enter(); builder.select(15); builder.moveTo(7, 0); builder.select(22);
  expect(builder.pending).toBe(true);
  expect(source.loadBytes(saved)).toBe(true);
  builder.resetAfterLoad();
  builder.select(15); builder.moveTo(7, 0); builder.confirm();
  source.flushCommands(); builder.afterCommands();
  expect(builder.selected).toBe(15);
  expect(builder.pending).toBe(false);
  handle.free();
});

it('cancels an invalid move on selection and keeps the original furniture unchanged', () => {
  const { handle, source, builder } = fixture();
  const saved = source.saveBytes();
  builder.enter(); builder.select(15); builder.moveTo(-1, 0);
  builder.select(22);
  expect(builder.selected).toBe(22);
  expect(builder.pending).toBe(false);
  source.flushCommands(); builder.afterCommands();
  expect(source.saveBytes()).toEqual(saved);
  handle.free();
});

it('commits rotation on keyboard selection but leaves same-object previews alone', () => {
  const { handle, source, builder } = fixture();
  builder.enter(); builder.select(7); builder.rotate(); builder.moveTo(2, 2);
  builder.select(7);
  expect(builder.preview).toMatchObject({ x: 2, y: 2, facing: 1 });
  expect(builder.pending).toBe(false);
  builder.handleKey(']');
  expect(builder.pending).toBe(true);
  source.flushCommands(); builder.afterCommands();
  expect(builder.selected).toBe(8);
  expect(source.objectFacing(7)).toBe(1);
  expect(source.lotRevision()).toBe(1);
  handle.free();
});

it('switches selection and reports cancellation if a valid preview is rejected during commit', () => {
  const { handle, source, builder } = fixture();
  builder.enter(); builder.select(15); builder.moveTo(7, 0);
  source.placeObject(22, 7, 0, source.objectFacing(22)!);
  builder.select(7);
  expect(builder.pending).toBe(true);
  source.flushCommands(); builder.afterCommands();
  expect(builder.selected).toBe(7);
  expect(builder.pending).toBe(false);
  expect(builder.preview?.valid).toBe(true);
  expect(builder.status).toMatch(/overlaps/);
  handle.free();
});

function fixture() {
  const handle = SimHandle.from_lot();
  const source = new SimBridge(handle, memory);
  const speeds: number[] = [];
  const pause = new OverlayPauseController({ setSpeed: speed => speeds.push(speed) }, () => {}, 2);
  const focus: string[] = [];
  let changes = 0;
  const builder = new FurnitureBuilder(source, pause, {
    changed() { changes += 1; }, enter: () => focus.push('canvas'), exit: () => focus.push('toggle'),
  });
  return { handle, source, builder, pause, speeds, focus, changes: () => changes };
}

// A purchase adds an object while nothing is selected here; the list the
// controls show must follow, or the new object cannot be chosen from it.
it('tells its controls when a lot change refreshes the object list with nothing selected', () => {
  const { handle, source, builder, changes } = fixture();
  builder.enter();
  const listed = builder.objects;
  const before = changes();
  expect(source.placeObject(15, 7, 0, source.objectFacing(15)!)).toBe(true);
  source.flushCommands();
  expect(builder.afterCommands()).toBe(true);
  expect(builder.objects).not.toBe(listed);
  expect(changes()).toBeGreaterThan(before);
  handle.free();
});

it('selects inert scenery by live identity and cancels without writing simulation state', () => {
  const { handle, source, builder, speeds, focus } = fixture();
  const before = source.saveBytes();
  builder.enter();
  expect(builder.objects.some(object => object.id === 15)).toBe(true);
  builder.select(15);
  expect(builder.name).toBe(source.objectName(15));
  builder.moveTo(7, 0);
  expect(builder.preview?.valid).toBe(true);
  expect(source.saveBytes()).toEqual(before);
  builder.cancel();
  expect(builder.selected).toBeNull();
  expect(builder.active).toBe(true);
  expect(source.saveBytes()).toEqual(before);
  builder.exit(); builder.exit();
  expect(speeds).toEqual([0, 2]);
  expect(focus).toEqual(['canvas', 'toggle']);
  handle.free();
});

it('waits for the drained result and refreshes a moved object on lot revision', () => {
  const { handle, source, builder } = fixture();
  builder.enter(); builder.select(15); builder.moveTo(7, 0);
  const oldLight = buildLightField(source, handle.lot_width(), handle.lot_height(), source.wallTiles(), true, source.wallEdges());
  const oldDestinationLight = sampleLight(oldLight, 7, 0);
  const before = source.lotRevision();
  expect(builder.confirm()).toBe(true);
  expect(builder.pending).toBe(true);
  expect(builder.status).toBe('Placing furniture…');
  expect(source.lotRevision()).toBe(before);
  expect(builder.confirm()).toBe(false);
  source.flushCommands();
  expect(builder.afterCommands()).toBe(true);
  expect(builder.pending).toBe(false);
  expect(builder.status).toBe('Furniture placed.');
  expect(source.lotRevision()).toBe(before + 1);
  expect(builder.afterCommands()).toBe(false);
  expect(builder.selected).toBe(15);
  expect(builder.preview).toMatchObject({ x: 7, y: 0, valid: true });
  const newLight = buildLightField(source, handle.lot_width(), handle.lot_height(), source.wallTiles(), true, source.wallEdges());
  expect(sampleLight(newLight, 7, 0)).toBeGreaterThan(oldDestinationLight);
  handle.free();
});

it('keeps invalid previews visible and handles refusal after a previously valid preview', () => {
  const { handle, source, builder } = fixture();
  builder.enter(); builder.select(15); builder.moveTo(15, 2);
  expect(builder.preview?.valid).toBe(false);
  expect(builder.status).toMatch(/door/);
  expect(builder.confirm()).toBe(false);
  builder.moveTo(-1, 0);
  expect(builder.preview).toMatchObject({ x: -1, y: 0, width: 1, depth: 1, valid: false });
  builder.moveTo(7, 0);
  // A second queued placement occupies the candidate after preview but before
  // the builder command. The real Rust drain must decide the latter's result.
  expect(source.placeObject(22, 7, 0, source.objectFacing(22)!)).toBe(true);
  expect(builder.confirm()).toBe(true);
  source.flushCommands(); builder.afterCommands();
  expect(builder.pending).toBe(false);
  expect(builder.preview?.valid).toBe(false);
  expect(builder.status).toBe('That position overlaps other furniture.');
  handle.free();
});

it('cycles supported facings and preserves the builder pause while another modal closes', () => {
  const { handle, builder, pause, speeds } = fixture();
  builder.enter(); builder.select(26);
  expect(builder.canRotate).toBe(true);
  expect(builder.preview?.facing).toBe(0);
  builder.rotate();
  expect(builder.preview?.facing).toBe(1);
  pause.suspend('help');
  builder.setBlocked(true);
  expect(builder.handleKey('Tab')).toBe(false);
  expect(builder.confirm()).toBe(false);
  builder.exit();
  expect(speeds).toEqual([0]);
  pause.resume('help');
  expect(speeds).toEqual([0, 2]);
  handle.free();
});

it('preserves a refused-load preview and resets a loaded world even when its revision is indistinguishable', () => {
  const { handle, source, builder } = fixture();
  const saved = source.saveBytes();
  const revision = source.lotRevision();
  // Normal loads increment Rust's u64 revision. Freeze the shell observation
  // to exercise the reset contract independently of that change notification.
  source.lotRevision = () => revision;
  builder.enter(); builder.select(15); builder.moveTo(7, 0);
  const preview = builder.preview;
  expect(source.loadBytes(new Uint8Array([0, 1, 2]))).toBe(false);
  expect(builder.afterCommands()).toBe(false);
  expect(builder.preview).toBe(preview);
  expect(source.loadBytes(saved)).toBe(true);
  expect(source.lotRevision()).toBe(revision);
  builder.resetAfterLoad();
  expect(builder.active).toBe(true);
  expect(builder.selected).toBeNull();
  expect(builder.preview).toBeNull();
  expect(builder.pending).toBe(false);
  expect(builder.status).toBe('Choose furniture to move or rotate.');
  handle.free();
});

it('routes keyboard edits once and appends preview instances without changing original render rows', () => {
  const { handle, source, builder } = fixture();
  builder.enter(); builder.select(26);
  const original = Array.from(source.positions());
  expect(builder.handleKey('r')).toBe(true);
  expect(builder.preview?.facing).toBe(1);
  const x = builder.preview!.x;
  builder.handleKey('ArrowRight');
  expect(builder.preview!.x).toBe(x + 1);
  const base = instanceCount(source, 26);
  const count = instanceCount(source, 26, undefined, builder.preview);
  expect(count).toBe(base + 2);
  const instances = buildInstances(source, 0.37, 100, 100, 16, 26, 1, true, 0, null, undefined, builder.preview);
  expect(instances.length).toBeGreaterThanOrEqual(count * STRIDE);
  expect(instances[(count - 1) * STRIDE + 3]).toBe(builder.preview!.sprite);
  expect(Array.from(source.positions())).toEqual(original);
  builder.handleKey('Escape');
  expect(builder.active).toBe(true);
  expect(builder.selected).toBeNull();
  builder.handleKey(']');
  expect(builder.selected).not.toBeNull();
  builder.handleKey('Escape'); builder.handleKey('Escape');
  expect(builder.active).toBe(false);
  handle.free();
});

it('replaces only valid in-place furniture presentation, retains its marker and restores it on Cancel', () => {
  const { handle, source, builder } = fixture();
  const saved = source.saveBytes();
  builder.enter();
  const foregroundObject = Array.from(source.ids()).find(id => {
    builder.select(id);
    return builder.preview?.valid && builder.preview.foreground !== null;
  });
  expect(foregroundObject).toBeDefined();
  for (const id of [26, foregroundObject!]) {
    builder.select(id);
    if (builder.canRotate) builder.rotate();
    const preview = builder.preview!;
    expect(preview.valid).toBe(true);
    const row = Array.from(source.ids()).indexOf(id);
    const baseCount = instanceCount(source, id);
    const original = Array.from(buildInstances(source, 0.37, 100, 100, 16, id, 1, true)
      .slice(0, baseCount * STRIDE));
    const extra = placementInstanceCount(preview);
    const count = instanceCount(source, id, undefined, preview);
    expect(count).toBe(baseCount + extra - (source.foregroundSprites()[row] === 0xffffffff ? 0 : 1));
    const rendered = buildInstances(source, 0.37, 100, 100, 16, id, 1, true, 0, null, undefined, preview);
    expect(Array.from(rendered.slice(row * STRIDE, row * STRIDE + 2))).toEqual([-1e6, -1e6]);
    for (let other = 0; other < source.count; other += 1) {
      if (other !== row) expect(Array.from(rendered.slice(other * STRIDE, (other + 1) * STRIDE)))
        .toEqual(original.slice(other * STRIDE, (other + 1) * STRIDE));
    }
    expect(rendered[(count - extra - 1) * STRIDE + 3]).toBe(spriteIndex('selectionRing'));
    expect(rendered[(count - 1) * STRIDE + 3]).toBe(preview.foreground ?? preview.sprite);
    const refused = { ...preview, valid: false };
    expect(instanceCount(source, id, undefined, refused)).toBe(baseCount + extra);
    const refusedRows = buildInstances(source, 0.37, 100, 100, 16, id, 1, true, 0, null, undefined, refused);
    expect(Array.from(refusedRows.slice(row * STRIDE, (row + 1) * STRIDE)))
      .toEqual(original.slice(row * STRIDE, (row + 1) * STRIDE));
    const moved = { ...preview, x: preview.x + source.footprintWidths()[row] };
    expect(instanceCount(source, id, undefined, moved)).toBe(baseCount + extra);
    const movedRows = buildInstances(source, 0.37, 100, 100, 16, id, 1, true, 0, null, undefined, moved);
    expect(Array.from(movedRows.slice(row * STRIDE, (row + 1) * STRIDE)))
      .toEqual(original.slice(row * STRIDE, (row + 1) * STRIDE));
    builder.cancel();
    expect(Array.from(buildInstances(source, 0.37, 100, 100, 16, id, 1, true)
      .slice(0, baseCount * STRIDE))).toEqual(original);
    expect(source.saveBytes()).toEqual(saved);
  }
  handle.free();
});

it('replaces the original table presentation when a valid rotated rectangle overlaps it only partly', () => {
  const { handle, source, builder } = fixture();
  const before = source.saveBytes();
  builder.enter(); builder.select(7);
  expect(builder.preview).toMatchObject({ x: 2, y: 3, width: 2, depth: 1 });
  builder.rotate(); builder.moveTo(2, 2);
  expect(builder.preview).toMatchObject({ valid: true, x: 2, y: 2, facing: 1, width: 1, depth: 2 });
  const row = Array.from(source.ids()).indexOf(7);
  const count = instanceCount(source, 7, undefined, builder.preview);
  const rendered = buildInstances(source, 0.5, 100, 100, 16, 7, 1, true, 0, null, undefined, builder.preview);
  expect(Array.from(rendered.slice(row * STRIDE, row * STRIDE + 2))).toEqual([-1e6, -1e6]);
  expect(rendered[(count - 1) * STRIDE + 3]).toBe(builder.preview!.sprite);
  expect(source.saveBytes()).toEqual(before);
  builder.cancel();
  const restored = buildInstances(source, 0.5, 100, 100, 16, 7, 1, true);
  expect(restored[row * STRIDE]).not.toBe(-1e6);
  expect(source.saveBytes()).toEqual(before);
  handle.free();
});
