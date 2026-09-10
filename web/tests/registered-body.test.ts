import { describe, expect, it, vi } from 'vitest';

vi.mock('../src/render/atlas.js', async (importOriginal) => {
  const atlas = await importOriginal<typeof import('../src/render/atlas.js')>();
  const anchors: Record<number, readonly [number, number]> = {};
  const tops: Record<number, number> = {};
  const hands = { ...atlas.SPRITE_HAND_ANCHORS };
  atlas.SPRITES.forEach((sprite, index) => {
    if (sprite.name === 'sim2' || sprite.name.startsWith('rigSim')) {
      anchors[index] = [sprite.w / 2 - 0.5, sprite.h - 8];
    }
    // Deliberately distinct fixtures detect dropped identity arguments. Actual
    // palette geometry is identical, which would hide those wiring mistakes.
    if (sprite.name.startsWith('rigSimBlue')) {
      anchors[index] = [sprite.w / 2 - 3, sprite.h - 12];
      tops[index] = 7;
      if (sprite.name.includes('Eat')) hands[index] = [6, 50];
    }
    if (sprite.name.startsWith('rigSimRed')) {
      anchors[index] = [sprite.w / 2 + 2, sprite.h - 4];
      tops[index] = 3;
      if (sprite.name.includes('Eat')) hands[index] = [40, 60];
    }
  });
  return { ...atlas, SPRITE_ANCHORS: anchors, SPRITE_CONTENT_TOPS: tops, SPRITE_HAND_ANCHORS: hands };
});

import { buildInstances, simBodySprite, type RenderSource } from '../src/frame.js';
import { pickSprite } from '../src/input.js';
import { SPRITES, SPRITE_ANCHORS, SPRITE_CONTENT_TOPS, SPRITE_HAND_ANCHORS, spriteIndex } from '../src/render/atlas.js';
import {
  FLOATS_PER_INSTANCE, KIND_AGENT, OFFSET_DEPTH, OFFSET_SCREEN_X, OFFSET_SCREEN_Y,
} from '../src/render/instances.js';
import { LAYER_SIM, layeredDepth } from '../src/render/iso.js';

const source: RenderSource = {
  count: 1,
  positions: () => Float32Array.of(0, 0),
  prevPositions: () => Float32Array.of(0, 0),
  ids: () => Uint32Array.of(100),
  kinds: () => Uint32Array.of(KIND_AGENT),
  sprites: () => Uint32Array.of(48),
  foregroundSprites: () => Uint32Array.of(0xffffffff),
  activities: () => Uint32Array.of(2),
  visualActions: () => Uint32Array.of(0),
  facings: () => Uint32Array.of(0),
  carrying: () => Uint32Array.of(0xffffffff),
  itemKinds: () => [],
};

describe('registered body draw and pick', () => {
  it('shifts only the body and its bubble, leaving the selection ring and depth fixed', () => {
    for (const zoom of [0.5, 1, 2]) {
      const result = buildInstances(source, 1, 200, 150, 16, 100, zoom, false, 0);
      const body = SPRITES[simBodySprite(100, 0, 0, 0, false)];
      expect(result[OFFSET_SCREEN_X]).toBe(200 + 0.5 * zoom);
      expect(result[OFFSET_SCREEN_Y]).toBe(150 + 8 * zoom);
      expect(result[OFFSET_DEPTH]).toBeCloseTo(layeredDepth(0, 0, 16, LAYER_SIM));
      expect(result[FLOATS_PER_INSTANCE + OFFSET_SCREEN_Y]).toBe(150 - (body.h - 8 - 4) * zoom);
      expect(result[2 * FLOATS_PER_INSTANCE + OFFSET_SCREEN_X]).toBe(200);
      expect(result[2 * FLOATS_PER_INSTANCE + OFFSET_SCREEN_Y]).toBe(150);
    }
  });

  it('picks the shifted lower extension and rejects the old top strip', () => {
    for (const zoom of [0.5, 1, 2]) {
      const body = SPRITES[simBodySprite(100, 0, 0, 0, false)];
      expect(pickSprite(source, 200, 150 + 25 * zoom, 200, 150, zoom))
        .toEqual({ entity: 100, isAgent: true });
      expect(pickSprite(source, 200, 150 + 30 * zoom, 200, 150, zoom)).toBeNull();
      expect(pickSprite(source, 200, 150 + (21 - body.h + 1) * zoom, 200, 150, zoom))
        .toBeNull();
    }
  });

  it('forwards the selected palette to bubbles and picking', () => {
    for (const simId of [0, 2]) {
      const named = { ...source, simIds: () => Uint32Array.of(simId) };
      const index = simBodySprite(100, 0, 0, 0, false, 0, 0, simId);
      const body = SPRITES[index];
      const anchor = SPRITE_ANCHORS[index];
      const result = buildInstances(named, 1, 200, 150, 16);
      expect(result[FLOATS_PER_INSTANCE + OFFSET_SCREEN_Y])
        .toBe(150 - (anchor[1] - SPRITE_CONTENT_TOPS[index] - 4));
      const rightEdge = 200 + body.w - anchor[0];
      expect(pickSprite(named, rightEdge - 0.25, 150, 200, 150, 1))
        .toEqual({ entity: 100, isAgent: true });
      expect(pickSprite(named, rightEdge + 0.25, 150, 200, 150, 1)).toBeNull();
    }
  });

  it('forwards the selected eating palette to the held-food anchor', () => {
    for (const simId of [0, 2]) {
      const eating = { ...source, simIds: () => Uint32Array.of(simId),
        activities: () => Uint32Array.of(3),
        visualActions: () => Uint32Array.of(2), facings: () => Uint32Array.of(1) };
      const index = simBodySprite(100, 2, 1, 0, false, 0, 0, simId);
      const anchor = SPRITE_ANCHORS[index];
      const hand = SPRITE_HAND_ANCHORS[index];
      const result = buildInstances(eating, 1, 200, 150, 16);
      const foodSlot = 2 * FLOATS_PER_INSTANCE;
      expect(result[foodSlot + OFFSET_SCREEN_X]).toBe(200 + hand[0] - anchor[0]);
      expect(result[foodSlot + OFFSET_SCREEN_Y])
        .toBe(150 + hand[1] - anchor[1] + SPRITES[spriteIndex('heldSnack')].h / 2);
    }
  });
});
