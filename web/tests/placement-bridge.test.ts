import { beforeAll, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import init, { SimHandle } from '../src/wasm/terri_wasm.js';
import { SimBridge } from '../src/bridge.js';

let memory: WebAssembly.Memory;
beforeAll(async () => {
  memory = (await init({ module_or_path: readFileSync('src/wasm/terri_wasm_bg.wasm') })).memory;
});

it('validates hostile placement numbers at the actual WASM boundary', () => {
  const handle = SimHandle.from_lot();
  const bridge = new SimBridge(handle, memory);
  const facing = bridge.objectFacing(0)!;
  for (const invalid of [NaN, Infinity, -Infinity, -1, 0.5, 0x100000000]) {
    for (let slot = 0; slot < 4; slot += 1) {
      const args = [0, 1, 1, facing]; args[slot] = invalid;
      const before = handle.save_bytes();
      expect(handle.placement_preview(args[0], args[1], args[2], args[3])[0]).toBe(1);
      expect(bridge.placementPreview(args[0], args[1], args[2], args[3]).valid).toBe(false);
      expect(bridge.placeObject(args[0], args[1], args[2], args[3])).toBe(false);
      expect(handle.save_bytes()).toEqual(before);
    }
    expect(bridge.objectFacing(invalid)).toBeNull();
    expect(bridge.objectFacingMask(invalid)).toBe(0);
  }
  expect(bridge.objectFacingMask(0) & (1 << facing)).not.toBe(0);
  handle.free();
});

it('keeps preview observational, reports the drained result, and survives memory growth', () => {
  const handle = SimHandle.from_lot();
  const bridge = new SimBridge(handle, memory);
  const facing = bridge.objectFacing(0)!;
  const before = handle.save_bytes();
  const edges = bridge.wallEdges();
  expect(edges?.length).toBeGreaterThan(0);
  // Find a real multi-tile object crossing a solid boundary. Boundary walls
  // occupy no tile, so a single-tile fridge cannot overlap one.
  let wallCollision: { object: number; x: number; y: number; facing: number } | undefined;
  for (const object of Array.from(bridge.ids())) {
    const direction = bridge.objectFacing(object);
    if (direction === null) continue;
    for (let y = 0; y < handle.lot_height() && !wallCollision; y += 1) {
      for (let x = 0; x < handle.lot_width(); x += 1) {
        if (handle.placement_preview(object, x, y, direction)[0] === 6) {
          wallCollision = { object, x, y, facing: direction }; break;
        }
      }
    }
    if (wallCollision) break;
  }
  expect(wallCollision).toBeDefined();
  const collision = wallCollision!;
  const refused = bridge.placementPreview(collision.object, collision.x, collision.y, collision.facing);
  expect(refused.valid).toBe(false);
  expect(refused.reason).toBe('That position overlaps a wall.');
  expect(bridge.lastPlacementResult()).toBeNull();
  expect(handle.save_bytes()).toEqual(before);
  expect(bridge.placeObject(collision.object, collision.x, collision.y, collision.facing)).toBe(true);
  bridge.flushCommands();
  expect(bridge.lastPlacementResult()).toEqual({ object: collision.object, reason: refused.reason });
  expect(handle.save_bytes()).toEqual(before);
  expect(bridge.lotRevision()).toBe(0);
  let valid: ReturnType<SimBridge['placementPreview']> | undefined;
  for (let y = 0; y < handle.lot_height() && !valid; y += 1) {
    for (let x = 0; x < handle.lot_width(); x += 1) {
      const candidate = bridge.placementPreview(0, x, y, facing);
      if ((x !== 0 || y !== 0) && candidate.valid) { valid = candidate; break; }
    }
  }
  expect(valid).toBeDefined();
  const target = valid!;
  memory.grow(1);
  expect(bridge.placementPreview(0, target.x, target.y, facing)).toEqual(target);
  expect(bridge.placeObject(0, target.x, target.y, facing)).toBe(true);
  bridge.flushCommands();
  expect(bridge.lastPlacementResult()).toEqual({ object: 0, reason: null });
  expect(bridge.lotRevision()).toBe(1);
  expect(bridge.objectFacing(0)).toBe(facing);
  expect(bridge.placementPreview(0, target.x, target.y, facing)).toEqual(target);
  bridge.placeObject(0, target.x, target.y, facing); bridge.flushCommands();
  expect(bridge.lotRevision()).toBe(1);
  const moved = handle.save_bytes();
  expect(handle.load_bytes(moved)).toBe(true);
  expect(bridge.lotRevision()).toBe(2);
  expect(bridge.lastPlacementResult()).toBeNull();
  handle.free();
});
