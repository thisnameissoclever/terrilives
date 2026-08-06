import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  ATLAS_HEIGHT,
  ATLAS_WIDTH,
  SPRITES,
  spriteIndex,
} from '../src/render/atlas.js';

// The atlas manifest exists TWICE: `assets/sprites/atlas.toml`, which
// `terri-data`'s build script validates content against and resolves
// sprite names to indices with, and `web/src/render/atlas.ts`, which the
// renderer reads the rects out of. `gen/build.py` writes both in one
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

  it('declares the dimensions the atlas.png file actually has', () => {
    // **Both manifests agreeing with each other is not the same as either
    // agreeing with the texture.** They are written in one pass so they cannot
    // disagree, and the test above pins that - but nothing checked either
    // against the PNG, and every UV in the shader is computed as
    // `x / ATLAS_WIDTH`. A regenerated texture with a stale manifest, or the
    // reverse, would place every sprite at the wrong fraction of the sheet:
    // recognisable art, all of it sliced wrong, no error anywhere.
    //
    // That is not hypothetical - the atlas was regenerated at the alpha pass
    // and went from 256 x 343 to 256 x 282 when the wall sprites changed.
    //
    // The PNG header is read directly rather than decoded. A PNG begins with
    // an 8-byte signature and then the IHDR chunk, whose width and height are
    // big-endian u32s at byte offsets 16 and 20. No image decoder needed, and
    // nothing to add to the dependency list for one assertion.
    // `public/`, not `assets/`. The image moved under the Vite root so the
    // dev server, `preview` and the build all serve it from the app's own
    // origin; importing it from outside the root made Vite hand out a
    // dev-only `/@fs/<absolute path>` URL. The MANIFEST stays in `assets/`,
    // because terri-data's build script reads it.
    const png = readFileSync('public/atlas.png');
    expect(
      png.subarray(1, 4).toString('ascii'),
      'the file must actually be a PNG for the offsets below to mean anything',
    ).toBe('PNG');
    expect(png.subarray(12, 16).toString('ascii')).toBe('IHDR');

    expect([png.readUInt32BE(16), png.readUInt32BE(20)]).toEqual([
      ATLAS_WIDTH,
      ATLAS_HEIGHT,
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

  it('is not empty, which is the one size the shader cannot take', () => {
    // The atlas used to have a fixed 128-entry ceiling to fit under; it
    // does not any more ([ML-sprites], a runtime-sized storage array), so
    // the only illegal length left is zero. A zero-length storage buffer
    // is invalid in WebGPU, and an empty manifest means every sprite
    // index is out of range and nothing draws at all.
    //
    // `sprites.ts` throws at start-up on this; asserting it here catches
    // it in CI, which has no GPU and would otherwise never reach that
    // code path.
    expect(SPRITES.length).toBeGreaterThan(0);
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

  it('appends the fixed-size conversation frames without renumbering sims', () => {
    const talkSprites = [
      'simTalkSE0', 'simTalkSE1', 'simTalkNW0', 'simTalkNW1',
      'simTalkSW0', 'simTalkSW1', 'simTalkNE0', 'simTalkNE1',
      'sim2TalkSE0', 'sim2TalkSE1', 'sim2TalkNW0', 'sim2TalkNW1',
      'sim2TalkSW0', 'sim2TalkSW1', 'sim2TalkNE0', 'sim2TalkNE1',
      'sim3TalkSE0', 'sim3TalkSE1', 'sim3TalkNW0', 'sim3TalkNW1',
      'sim3TalkSW0', 'sim3TalkSW1', 'sim3TalkNE0', 'sim3TalkNE1',
    ];

    expect(spriteIndex('sim')).toBe(1);
    expect(spriteIndex('sim2')).toBe(48);
    expect(spriteIndex('sim3')).toBe(49);
    expect(SPRITES.slice(50).map((sprite) => sprite.name)).toEqual(talkSprites);
    for (const name of talkSprites) {
      const sprite = SPRITES[spriteIndex(name)];
      expect([sprite.w, sprite.h], name).toEqual([38, 88]);
    }
  });
});
