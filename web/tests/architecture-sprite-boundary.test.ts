import { afterEach, expect, it, vi } from 'vitest';
import { loadArchitectureAtlas, validateArchitectureSpriteBoundary } from '../src/render/architecture-atlas.js';
import { ARCHITECTURE } from '../src/render/architecture-data.js';
import { SPRITES } from '../src/render/atlas.js';

afterEach(() => vi.unstubAllGlobals());

it('rejects stale generated IDs through the production loader before fetching resources', async () => {
  const original = Object.getOwnPropertyDescriptor(ARCHITECTURE, 'baseSpriteId')!;
  const fetch = vi.fn(() => { throw new Error('Unexpected resource fetch'); });
  vi.stubGlobal('fetch', fetch);
  try {
    Object.defineProperty(ARCHITECTURE, 'baseSpriteId', { ...original, value: SPRITES.length - 8 });
    await expect(loadArchitectureAtlas({} as GPUDevice['limits']))
      .rejects.toThrow('Architecture sprite boundary does not match the base atlas');
    expect(fetch).not.toHaveBeenCalled();
  } finally {
    Object.defineProperty(ARCHITECTURE, 'baseSpriteId', original);
  }
});

it('accepts architecture IDs directly after the combined base atlas', () => {
  expect(() => validateArchitectureSpriteBoundary({ baseSpriteId: 3,
    sprites: [{ id: 3 }, { id: 4 }] }, 3)).not.toThrow();
});

it('rejects a stale base offset that would draw a prop as a wall', () => {
  expect(() => validateArchitectureSpriteBoundary({ baseSpriteId: 2,
    sprites: [{ id: 2 }, { id: 3 }] }, 3)).toThrow('Architecture sprite boundary does not match the base atlas');
});

it('rejects a reordered architecture row before any upload', () => {
  expect(() => validateArchitectureSpriteBoundary({ baseSpriteId: 3,
    sprites: [{ id: 4 }, { id: 3 }] }, 3)).toThrow('Architecture sprite IDs are not a contiguous suffix');
});
