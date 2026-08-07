import { describe, expect, it } from 'vitest';
import { spriteIndex } from '../src/render/atlas.js';
import {
  buildLightField,
  emissiveForSprite,
  sampleLight,
  sampleWallLight,
  type LightingSource,
} from '../src/render/lighting.js';

const LAMP = spriteIndex('lampRoundFloor');
const TELEVISION = spriteIndex('televisionVintage');
const CHAIR = spriteIndex('chair');

class Rows implements LightingSource {
  readonly count: number;

  constructor(
    readonly positionRows: Float32Array,
    readonly kindRows: Uint32Array,
    readonly spriteRows: Uint32Array,
    readonly widthRows: Uint32Array,
    readonly depthRows: Uint32Array,
  ) {
    this.count = kindRows.length;
  }

  positions(): Float32Array {
    return this.positionRows;
  }

  kinds(): Uint32Array {
    return this.kindRows;
  }

  sprites(): Uint32Array {
    return this.spriteRows;
  }

  footprintWidths(): Uint32Array {
    return this.widthRows;
  }

  footprintDepths(): Uint32Array {
    return this.depthRows;
  }
}

function rows(
  entries: readonly (readonly [
    x: number,
    y: number,
    kind: number,
    sprite: number,
    width?: number,
    depth?: number,
  ])[],
): Rows {
  return new Rows(
    Float32Array.from(entries.flatMap(([x, y]) => [x, y])),
    Uint32Array.from(entries.map((entry) => entry[2])),
    Uint32Array.from(entries.map((entry) => entry[3])),
    Uint32Array.from(entries.map((entry) => entry[4] ?? 1)),
    Uint32Array.from(entries.map((entry) => entry[5] ?? 1)),
  );
}

const NO_WALLS = new Uint32Array(0);

describe('tile light profiles', () => {
  it('uses the complete lamp graph-distance profile', () => {
    const field = buildLightField(
      rows([[4, 3, 1, LAMP]]),
      10,
      7,
      NO_WALLS,
      true,
    );

    expect(sampleLight(field, 4, 3)).toBeCloseTo(0.35);
    expect(sampleLight(field, 3, 3)).toBeCloseTo(0.22);
    expect(sampleLight(field, 2, 3)).toBeCloseTo(0.1);
    expect(sampleLight(field, 1, 3)).toBeCloseTo(0.04);
    expect(sampleLight(field, 0, 3)).toBe(0);
  });

  it('uses the shorter television profile and keeps both sources emissive', () => {
    const field = buildLightField(
      rows([[4, 3, 1, TELEVISION]]),
      10,
      7,
      NO_WALLS,
      true,
    );

    expect(sampleLight(field, 4, 3)).toBeCloseTo(0.25);
    expect(sampleLight(field, 3, 3)).toBeCloseTo(0.12);
    expect(sampleLight(field, 2, 3)).toBeCloseTo(0.04);
    expect(sampleLight(field, 1, 3)).toBe(0);
    expect(emissiveForSprite(LAMP)).toBeCloseTo(0.85);
    expect(emissiveForSprite(TELEVISION)).toBeCloseTo(0.85);
    expect(emissiveForSprite(CHAIR)).toBe(0);
  });
});

describe('occlusion and wall sampling', () => {
  it('does not cross a solid wall and does pass through an authored gap', () => {
    const source = rows([[0, 2, 1, LAMP]]);
    const solidWall = Uint32Array.from([
      2, 0,
      2, 1,
      2, 2,
      2, 3,
      2, 4,
    ]);
    let field = buildLightField(source, 5, 5, solidWall, true);
    expect(sampleLight(field, 3, 2)).toBe(0);
    expect(sampleLight(field, 2, 2)).toBe(0);

    const doorway = Uint32Array.from([
      2, 0,
      2, 1,
      2, 3,
      2, 4,
    ]);
    field = buildLightField(source, 5, 5, doorway, true);
    expect(sampleLight(field, 3, 2)).toBeCloseTo(0.04);
    expect(sampleLight(field, 2, 1)).toBe(0);
    expect(sampleWallLight(field, 2, 1)).toBeCloseTo(0.1);
  });

  it('lights boundary panels from the nearest floor without leaving the ring', () => {
    const field = buildLightField(
      rows([[6, 2, 1, LAMP]]),
      7,
      3,
      NO_WALLS,
      true,
    );

    expect(sampleLight(field, 6, 2)).toBeCloseTo(0.35);
    // World (6, 2) is raw packed index (2 + 1) * (7 + 2) + (6 + 1).
    // Reading the backing directly keeps this from becoming a test where a
    // transposed writer and a transposed sampler politely agree on the lie.
    expect(field.values[34]).toBeCloseTo(0.35);
    expect(sampleLight(field, 2, 6)).toBe(0);
    expect(sampleLight(field, 7, 2)).toBe(0);
    expect(sampleWallLight(field, 7, 2)).toBeCloseTo(0.35);
    expect(sampleWallLight(field, 6, 3)).toBeCloseTo(0.35);
    expect(sampleWallLight(field, 8, 2)).toBe(0);
  });
});

describe('footprints and deterministic composition', () => {
  it('recovers a multi-tile origin and casts only the immediate +x band', () => {
    // A 3 by 2 object whose origin is (3, 2) is exported at (4, 2.5).
    const field = buildLightField(
      rows([[4, 2.5, 1, LAMP, 3, 2]]),
      10,
      7,
      NO_WALLS,
      true,
    );

    expect(sampleLight(field, 3, 2)).toBeCloseTo(0.35);
    expect(sampleLight(field, 5, 3)).toBeCloseTo(0.35);
    expect(sampleLight(field, 2, 2)).toBeCloseTo(0.22);
    expect(sampleLight(field, 3, 4)).toBeCloseTo(0.22);
    expect(sampleLight(field, 6, 2)).toBeCloseTo(0.1);
    expect(sampleLight(field, 6, 3)).toBeCloseTo(0.1);
  });

  it('casts the footprint-correct shadow of ordinary furniture', () => {
    const withoutFurniture = buildLightField(
      rows([[1, 2, 1, LAMP]]),
      8,
      5,
      NO_WALLS,
      true,
    );
    const unshadowed = sampleLight(withoutFurniture, 4, 2);

    // The non-emissive 2 by 2 object occupies x=2..3 and y=1..2, so its
    // immediate +x band is x=4 at both y coordinates. A source-only shadow
    // implementation leaves this at the ordinary distance-three strength.
    const withFurniture = buildLightField(
      rows([
        [1, 2, 1, LAMP],
        [2.5, 1.5, 1, CHAIR, 2, 2],
      ]),
      8,
      5,
      NO_WALLS,
      true,
    );

    expect(unshadowed).toBeCloseTo(0.04);
    expect(sampleLight(withFurniture, 4, 2)).toBe(0);
    expect(sampleLight(withFurniture, 3, 3)).toBeCloseTo(0.04);
  });

  it('does not turn an agent row into a tile-shadow caster', () => {
    const field = buildLightField(
      rows([
        [1, 2, 1, LAMP],
        [2, 2, 0, CHAIR],
      ]),
      8,
      5,
      NO_WALLS,
      true,
    );

    // The lamp's own shadow is x=2. If the agent at x=2 were accepted as a
    // caster, its x=3 band would demote this distance-two value to 0.04.
    expect(sampleLight(field, 3, 2)).toBeCloseTo(0.1);
  });

  it('uses max composition so row order and a shadowed overlap cannot win', () => {
    const forward = rows([
      [2, 2, 1, LAMP],
      [4, 2, 1, TELEVISION],
    ]);
    const reverse = rows([
      [4, 2, 1, TELEVISION],
      [2, 2, 1, LAMP],
    ]);
    const first = buildLightField(forward, 8, 5, NO_WALLS, true);
    const firstValues = Array.from(first.values);
    const second = buildLightField(reverse, 8, 5, NO_WALLS, true);

    expect(Array.from(second.values)).toEqual(firstValues);
    // Lamp's +x shadow contributes 0.10 here; TV contributes 0.12.
    expect(sampleLight(second, 3, 2)).toBeCloseTo(0.12);
  });
});

describe('boundary safety and scratch reuse', () => {
  it('ignores agents, malformed footprints, non-finite positions and off-lot rows', () => {
    const source = rows([
      [1, 1, 0, LAMP],
      [Number.NaN, 1, 1, LAMP],
      [-20, 1, 1, TELEVISION],
      [3, 2, 1, LAMP, 100, 1],
    ]);
    const field = buildLightField(source, 6, 4, NO_WALLS, true);

    expect(Array.from(field.values).every((value) => value === 0)).toBe(true);
    expect(sampleLight(field, Number.NaN, 0)).toBe(0);
    expect(sampleLight(field, Number.POSITIVE_INFINITY, 0)).toBe(0);
    expect(sampleLight(field, -2, 0)).toBe(0);
  });

  it('resets disabled and empty rebuilds without replacing the scratch storage', () => {
    const source = rows([[2, 2, 1, LAMP]]);
    const first = buildLightField(source, 6, 5, NO_WALLS, true);
    const backing = first.values;
    expect(sampleLight(first, 2, 2)).toBeGreaterThan(0);

    const disabled = buildLightField(source, 6, 5, NO_WALLS, false);
    expect(disabled).toBe(first);
    expect(disabled.values).toBe(backing);
    expect(Array.from(disabled.values).every((value) => value === 0)).toBe(true);

    const empty = buildLightField(rows([]), 6, 5, NO_WALLS, true);
    expect(empty).toBe(first);
    expect(empty.values).toBe(backing);
    expect(Array.from(empty.values).every((value) => value === 0)).toBe(true);
  });

  it('copies effects into the field without mutating or retaining source views', () => {
    const source = rows([[2, 2, 1, LAMP, 1, 1]]);
    const walls = Uint32Array.from([5, 4]);
    const before = {
      positions: Array.from(source.positionRows),
      kinds: Array.from(source.kindRows),
      sprites: Array.from(source.spriteRows),
      widths: Array.from(source.widthRows),
      depths: Array.from(source.depthRows),
    };
    const field = buildLightField(source, 6, 5, walls, true);
    const strength = sampleLight(field, 2, 2);

    expect(Array.from(source.positionRows)).toEqual(before.positions);
    expect(Array.from(source.kindRows)).toEqual(before.kinds);
    expect(Array.from(source.spriteRows)).toEqual(before.sprites);
    expect(Array.from(source.widthRows)).toEqual(before.widths);
    expect(Array.from(source.depthRows)).toEqual(before.depths);
    expect(Array.from(walls)).toEqual([5, 4]);

    source.positionRows.fill(99);
    source.spriteRows.fill(CHAIR);
    expect(sampleLight(field, 2, 2)).toBe(strength);
    expect(
      Array.from(field.values).every(
        (value) => Number.isFinite(value) && value >= 0 && value <= 1,
      ),
    ).toBe(true);
  });

  it('returns an empty safe field for invalid or unreasonable lot dimensions', () => {
    const source = rows([[0, 0, 1, LAMP]]);
    for (const [width, height] of [
      [Number.NaN, 4],
      [4, Number.POSITIVE_INFINITY],
      [0, 4],
      [4, -1],
      [2_000_000, 2_000_000],
    ]) {
      const field = buildLightField(source, width, height, NO_WALLS, true);
      expect(field.width).toBe(0);
      expect(field.height).toBe(0);
      expect(field.values.length).toBe(0);
      expect(sampleLight(field, 0, 0)).toBe(0);
    }
  });
});
