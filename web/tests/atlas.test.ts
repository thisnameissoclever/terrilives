import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  ATLAS_HEIGHT,
  ATLAS_WIDTH,
  SPRITES,
  spriteIndex,
} from '../src/render/atlas.js';
import { MAX_SPRITES } from '../src/render/instances.js';

// The atlas manifest exists TWICE: `assets/sprites/atlas.toml`, which
// `terri-data`'s build script validates content against and resolves
// sprite names to indices with, and `web/src/render/atlas.ts`, which the
// renderer reads the rects out of. `build-atlas.ps1` writes both in one
// pass from one list, so they cannot disagree unless somebody edits one
// by hand - and if they ever did, every object in the game would draw as
// the wrong picture with nothing raising an error, because both sides
// would be internally consistent.
//
// So this reads the TOML as text and compares. Same mechanism as
// `iso.test.ts` reading `sprites.ts` and `instances.test.ts` reading the
// WGSL, and for the same reason: the contract spans two files that no
// type system connects, and `number` is `number`.
//
// The parse is deliberately strict rather than a general TOML reader.
// The file is machine-written with a fixed shape, so anything that does
// not match it is a reason to fail rather than a case to handle.
const MANIFEST = '../assets/sprites/atlas.toml';

interface ManifestSprite {
  name: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

function readManifest(): {
  width: number;
  height: number;
  sprites: ManifestSprite[];
} {
  const text = readFileSync(MANIFEST, 'utf8');
  const scalar = (key: string): number => {
    const found = text.match(new RegExp(`^${key} = (\\d+)\\r?$`, 'm'));
    if (!found) throw new Error(`atlas.toml has no ${key}`);
    return Number(found[1]);
  };
  // `\r?` throughout, because git may hand CI a CRLF checkout of a file
  // this repository writes with LF.
  const sprites = [...text.matchAll(/\[\[sprite\]\]\r?\n((?:\w+ = .*\r?\n?)+)/g)].map(
    (block) => {
      const field = (key: string): string => {
        const found = block[1].match(new RegExp(`^${key} = (.*?)\r?$`, 'm'));
        if (!found) throw new Error(`a [[sprite]] block has no ${key}`);
        return found[1].replace(/"/g, '');
      };
      return {
        name: field('name'),
        x: Number(field('x')),
        y: Number(field('y')),
        w: Number(field('w')),
        h: Number(field('h')),
      };
    },
  );
  return { width: scalar('width'), height: scalar('height'), sprites };
}

describe('the atlas manifest', () => {
  const manifest = readManifest();

  it('parses something, so the comparisons below are not vacuous', () => {
    // Rule 5. A regex that stopped matching after a formatting change
    // would leave every assertion here comparing two empty lists, which
    // is the failure this whole file exists to prevent, arriving through
    // the door it came to guard.
    expect(manifest.sprites.length).toBeGreaterThanOrEqual(10);
    expect(manifest.width).toBeGreaterThan(0);
    expect(manifest.height).toBeGreaterThan(0);
  });

  it('agrees with the generated TypeScript module, rect for rect and in order', () => {
    // Order is the load-bearing part. A sprite's INDEX is its position in
    // this list on both sides - Rust resolves an object's `sprite` name
    // to a position, and the render buffer carries that number straight
    // into the shader's uniform array - so a reordering on one side alone
    // silently redraws the whole lot with the furniture shuffled.
    expect(SPRITES.map((s) => s.name)).toEqual(
      manifest.sprites.map((s) => s.name),
    );
    expect(
      SPRITES.map((s) => [s.x, s.y, s.w, s.h]),
    ).toEqual(manifest.sprites.map((s) => [s.x, s.y, s.w, s.h]));
    expect([ATLAS_WIDTH, ATLAS_HEIGHT]).toEqual([
      manifest.width,
      manifest.height,
    ]);
  });

  it('holds the three sprites the shell draws itself, and the sim', () => {
    // Object sprites deliberately do NOT appear here. They come from
    // content, resolved before they ever reach TypeScript, so naming one
    // in a test would be the first line of the second copy of the object
    // list that this design exists to avoid.
    //
    // `sim` is the exception on the Rust side rather than this one: a sim
    // is not an authored object, so `terri-data`'s SIM_SPRITE names it.
    for (const name of ['floor', 'wallNS', 'wallEW', 'sim']) {
      expect(() => spriteIndex(name)).not.toThrow();
    }
    expect(() => spriteIndex('no_such_sprite')).toThrow();
  });

  it('keeps every sprite inside the texture it is packed into', () => {
    // A rect running off the edge samples clamped texels rather than
    // erroring, so it draws a smear of the last column instead of the
    // sprite. Nothing else would catch a packer that mis-measured.
    let checked = 0;
    for (const sprite of SPRITES) {
      expect(sprite.w).toBeGreaterThan(0);
      expect(sprite.h).toBeGreaterThan(0);
      expect(sprite.x + sprite.w).toBeLessThanOrEqual(ATLAS_WIDTH);
      expect(sprite.y + sprite.h).toBeLessThanOrEqual(ATLAS_HEIGHT);
      checked += 1;
    }
    expect(checked).toBe(SPRITES.length);
  });

  it('fits the fixed-size uniform array the shader declares', () => {
    // WGSL clamps an out-of-range uniform-array index instead of
    // trapping, so an atlas longer than MAX_SPRITES would draw every
    // sprite past the end as the last one in the table, with no error.
    // `sprites.ts` throws at start-up on this; here it fails in CI, which
    // has no GPU and would otherwise never see it.
    expect(SPRITES.length).toBeLessThanOrEqual(MAX_SPRITES);
  });

  it('returns each sprite its own index', () => {
    // `spriteIndex` is a linear search over a list whose entries all have
    // the same shape, so the mutation that matters is returning 0, or the
    // length, or the first partial match. Several names, each checked
    // against its own position, is what excludes those.
    SPRITES.forEach((sprite, index) => {
      expect(spriteIndex(sprite.name)).toBe(index);
    });
    expect(new Set(SPRITES.map((s) => s.name)).size).toBe(SPRITES.length);
  });
});
