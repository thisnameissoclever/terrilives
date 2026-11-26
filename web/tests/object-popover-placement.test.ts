import { expect, it } from 'vitest';
import { placeObjectMenu } from '../src/ui/object-menu-layout.js';

const desktop = { width: 1280, height: 800 };
const phone = { width: 320, height: 568 };
const keepouts = [
  { left: 8, right: 178, top: 8, bottom: 202 },
  { left: 8, right: 312, top: 411, bottom: 560 },
];

it('places the list beside the target and flips it at the right edge', () => {
  expect(placeObjectMenu({ x: 600, y: 360 }, { width: 242, height: 180 }, desktop, [])?.left).toBe(624);
  const left = placeObjectMenu({ x: 1240, y: 360 }, { width: 242, height: 180 }, desktop, []);
  expect(left?.left).toBe(974);
  expect(left?.height).toBe(180);
});

it('keeps a tall phone menu between the HUD and dock and gives its list room to scroll', () => {
  const result = placeObjectMenu({ x: 298, y: 280 }, { width: 224, height: 380 }, phone, keepouts)!;
  expect(result.top).toBeGreaterThanOrEqual(210);
  expect(result.top + result.height).toBeLessThanOrEqual(403);
  expect(result.height).toBe(193);
  expect(result.left).toBeGreaterThanOrEqual(8);
  expect(result.left + 224).toBeLessThanOrEqual(312);
});

it('fits the captured 320 by 568 bookcase band, including a long expanded description', () => {
  const result = placeObjectMenu({ x: 210, y: 140 }, { width: 224, height: 400 }, phone, [
    { left: 8, top: 8, right: 190, bottom: 285.578125 },
    { left: 8, top: 386.578125, right: 312, bottom: 560 },
  ]);
  expect(result?.top).toBe(293.578125);
  expect(result?.height).toBe(85);
});

it('stays near a target when its menu can scroll within the nearby gap', () => {
  const result = placeObjectMenu({ x: 70, y: 314 }, { width: 224, height: 248 }, { width: 450, height: 568 }, [
    { left: 8, top: 8, right: 190, bottom: 279 },
    { left: 8, top: 386, right: 442, bottom: 560 },
  ]);
  expect(result).toEqual({ left: 94, top: 287, height: 91 });
});

it('leaves the target visible when a narrow viewport can fit a scroller above or below it', () => {
  const result = placeObjectMenu({ x: 160, y: 312 }, { width: 224, height: 380 }, phone, keepouts)!;
  expect(Math.max(result.top - 312, 312 - result.top - result.height)).toBeGreaterThanOrEqual(24);
  expect(result.height).toBe(78);
});

it('uses an open side band even if a tall HUD occupies most of the left half', () => {
  const room = placeObjectMenu({ x: 260, y: 77 }, { width: 224, height: 250 }, { width: 410, height: 400 }, [
    { left: 8, right: 159, top: 8, bottom: 345 },
  ])!;
  expect(room.left).toBeGreaterThanOrEqual(167);
  expect(room.height).toBe(250);
});

it('keeps a separately positioned top-right control clear', () => {
  const log = { left: 1224, top: 8, right: 1272, bottom: 40 };
  const placement = placeObjectMenu({ x: 1006, y: 32 }, { width: 242, height: 180 }, desktop, [log])!;
  expect(placement.left + 242 <= log.left - 8 || placement.top >= log.bottom + 8).toBe(true);
});

it('preserves a 44 pixel view where only a short strip is free', () => {
  const blocked = [{ left: 0, right: 320, top: 0, bottom: 500 }];
  expect(placeObjectMenu({ x: 160, y: 540 }, { width: 224, height: 330 }, phone, blocked)?.height).toBe(52);
  expect(placeObjectMenu({ x: 160, y: 540 }, { width: 224, height: 330 }, phone, [
    { ...blocked[0], bottom: 510 },
  ])).toBeNull();
});
