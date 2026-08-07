/**
 * Deterministic tile lighting derived from the current render snapshot.
 *
 * The field stores one emissive strength per tile. RGB stays neutral, so the
 * existing ambient shader owns the time-of-day colour while local lights lift
 * nearby instances toward their authored palette. The one-tile ring around the
 * lot exists for boundary wall panels; floor propagation itself never leaves
 * the lot.
 */

import { spriteIndex } from './atlas.js';

/** Render-buffer entity kinds. Agents do not emit or cast extra tile shadows. */
const KIND_OBJECT = 1;

/** The frame activity code is intentionally absent: agents are ignored by kind. */
const LAMP_SPRITE = spriteIndex('lampRoundFloor');
const TELEVISION_SPRITE = spriteIndex('televisionVintage');

/** Graph-distance strengths, including the emitting object's own tile. */
const LAMP_PROFILE: readonly number[] = [0.35, 0.22, 0.1, 0.04];
const TELEVISION_PROFILE: readonly number[] = [0.25, 0.12, 0.04];

/** Both authored emitters retain their own colour after dark. */
const SOURCE_EMISSIVE = 0.85;

/** A defensive ceiling far above the shipped 16 by 12 lot. */
const MAX_FIELD_TILES = 1_000_000;

/** The render-buffer subset needed to derive presentation-only lighting. */
export interface LightingSource {
  readonly count: number;
  positions(): Float32Array;
  kinds(): Uint32Array;
  sprites(): Uint32Array;
  footprintWidths(): Uint32Array;
  footprintDepths(): Uint32Array;
}

/**
 * One packed emissive value per coordinate in `[-1, width] x [-1, height]`.
 *
 * `values` is reused and is valid only until the next `buildLightField` call,
 * matching the renderer's other scratch-buffer contracts.
 */
export interface TileLighting {
  readonly width: number;
  readonly height: number;
  readonly stride: number;
  readonly values: Float32Array<ArrayBuffer>;
}

interface MutableTileLighting {
  width: number;
  height: number;
  stride: number;
  values: Float32Array<ArrayBuffer>;
}

const field: MutableTileLighting = {
  width: 0,
  height: 0,
  stride: 0,
  values: new Float32Array(0),
};

let blocked = new Uint8Array(0);
let shadowed = new Uint8Array(0);
let distances = new Int32Array(0);
let queue = new Int32Array(0);

function validDimension(value: number): boolean {
  return Number.isSafeInteger(value) && value > 0;
}

function configureField(width: number, height: number): boolean {
  if (!validDimension(width) || !validDimension(height)) {
    field.width = 0;
    field.height = 0;
    field.stride = 0;
    if (field.values.length !== 0) field.values = new Float32Array(0);
    return false;
  }

  const stride = width + 2;
  const rows = height + 2;
  const fieldTiles = stride * rows;
  const lotTiles = width * height;
  if (
    !Number.isSafeInteger(fieldTiles) ||
    !Number.isSafeInteger(lotTiles) ||
    fieldTiles > MAX_FIELD_TILES
  ) {
    field.width = 0;
    field.height = 0;
    field.stride = 0;
    if (field.values.length !== 0) field.values = new Float32Array(0);
    return false;
  }

  field.width = width;
  field.height = height;
  field.stride = stride;
  if (field.values.length !== fieldTiles) {
    field.values = new Float32Array(fieldTiles);
  } else {
    field.values.fill(0);
  }

  if (blocked.length !== lotTiles) {
    blocked = new Uint8Array(lotTiles);
    shadowed = new Uint8Array(lotTiles);
    distances = new Int32Array(lotTiles);
    queue = new Int32Array(lotTiles);
  } else {
    blocked.fill(0);
    shadowed.fill(0);
  }
  return true;
}

function profileForSprite(sprite: number): readonly number[] | null {
  if (sprite === LAMP_SPRITE) return LAMP_PROFILE;
  if (sprite === TELEVISION_SPRITE) return TELEVISION_PROFILE;
  return null;
}

/** Emissive strength intrinsic to a sprite, independent of nearby tile light. */
export function emissiveForSprite(sprite: number): number {
  return profileForSprite(sprite) === null ? 0 : SOURCE_EMISSIVE;
}

function fieldIndex(x: number, y: number): number {
  return (y + 1) * field.stride + x + 1;
}

function isFieldCoordinate(
  lighting: TileLighting,
  x: number,
  y: number,
): boolean {
  return (
    Number.isInteger(x) &&
    Number.isInteger(y) &&
    x >= -1 &&
    x <= lighting.width &&
    y >= -1 &&
    y <= lighting.height
  );
}

function sampleExact(lighting: TileLighting, x: number, y: number): number {
  if (!isFieldCoordinate(lighting, x, y) || lighting.stride <= 0) return 0;
  const value = lighting.values[(y + 1) * lighting.stride + x + 1];
  return Number.isFinite(value) && value >= 0 && value <= 1 ? value : 0;
}

/** Returns one tile's local emissive strength. Callers choose quantisation. */
export function sampleLight(
  lighting: TileLighting,
  x: number,
  y: number,
): number {
  return sampleExact(lighting, x, y);
}

/**
 * Lights a wall from its brightest cardinally adjacent floor tile.
 *
 * Wall tiles hold zero in the field and never participate in propagation, so
 * this makes the panel visible without allowing it to pass light through to
 * the floor on its far side.
 */
export function sampleWallLight(
  lighting: TileLighting,
  x: number,
  y: number,
): number {
  if (!isFieldCoordinate(lighting, x, y)) return 0;
  return Math.max(
    sampleExact(lighting, x - 1, y),
    sampleExact(lighting, x + 1, y),
    sampleExact(lighting, x, y - 1),
    sampleExact(lighting, x, y + 1),
  );
}

function markWalls(walls: Uint32Array, width: number, height: number): void {
  for (let i = 0; i + 1 < walls.length; i += 2) {
    const x = walls[i];
    const y = walls[i + 1];
    if (x < width && y < height) blocked[y * width + x] = 1;
  }
}

function validFootprint(
  originX: number,
  originY: number,
  footprintWidth: number,
  footprintDepth: number,
  width: number,
  height: number,
): boolean {
  return (
    Number.isInteger(originX) &&
    Number.isInteger(originY) &&
    Number.isInteger(footprintWidth) &&
    Number.isInteger(footprintDepth) &&
    footprintWidth > 0 &&
    footprintDepth > 0 &&
    originX >= 0 &&
    originY >= 0 &&
    originX + footprintWidth <= width &&
    originY + footprintDepth <= height
  );
}

function footprintIsClear(
  originX: number,
  originY: number,
  footprintWidth: number,
  footprintDepth: number,
  width: number,
): boolean {
  for (let y = originY; y < originY + footprintDepth; y += 1) {
    for (let x = originX; x < originX + footprintWidth; x += 1) {
      if (blocked[y * width + x] !== 0) return false;
    }
  }
  return true;
}

function markShadowBand(
  shadowX: number,
  originY: number,
  endY: number,
  width: number,
): void {
  if (shadowX >= width) return;
  for (let y = originY; y < endY; y += 1) {
    shadowed[y * width + shadowX] = 1;
  }
}

function markShadowsForEmitter(
  emitterRightEdge: number,
  count: number,
  positions: Float32Array,
  kinds: Uint32Array,
  footprintWidths: Uint32Array,
  footprintDepths: Uint32Array,
  width: number,
  height: number,
): void {
  shadowed.fill(0);
  for (let row = 0; row < count; row += 1) {
    if (kinds[row] !== KIND_OBJECT) continue;
    const centredX = positions[row * 2];
    const centredY = positions[row * 2 + 1];
    const footprintWidth = footprintWidths[row];
    const footprintDepth = footprintDepths[row];
    if (
      !Number.isFinite(centredX) ||
      !Number.isFinite(centredY) ||
      !Number.isInteger(footprintWidth) ||
      !Number.isInteger(footprintDepth)
    ) {
      continue;
    }
    const originX = Math.floor(centredX - (footprintWidth - 1) * 0.5);
    const originY = Math.floor(centredY - (footprintDepth - 1) * 0.5);
    const shadowX = originX + footprintWidth;
    if (
      emitterRightEdge <= shadowX &&
      validFootprint(
        originX,
        originY,
        footprintWidth,
        footprintDepth,
        width,
        height,
      ) &&
      footprintIsClear(
        originX,
        originY,
        footprintWidth,
        footprintDepth,
        width,
      )
    ) {
      markShadowBand(
        shadowX,
        originY,
        originY + footprintDepth,
        width,
      );
    }
  }
}

function spreadEmitter(
  profile: readonly number[],
  originX: number,
  originY: number,
  footprintWidth: number,
  footprintDepth: number,
  width: number,
  height: number,
  count: number,
  positions: Float32Array,
  kinds: Uint32Array,
  footprintWidths: Uint32Array,
  footprintDepths: Uint32Array,
): void {
  distances.fill(-1);
  const emitterRightEdge = originX + footprintWidth;
  // A light on the east side of a caster illuminates the band from behind;
  // only sources at or west of the caster's far edge see its +x shadow.
  markShadowsForEmitter(
    emitterRightEdge,
    count,
    positions,
    kinds,
    footprintWidths,
    footprintDepths,
    width,
    height,
  );
  let head = 0;
  let tail = 0;

  for (let y = originY; y < originY + footprintDepth; y += 1) {
    for (let x = originX; x < originX + footprintWidth; x += 1) {
      const index = y * width + x;
      distances[index] = 0;
      queue[tail] = index;
      tail += 1;
    }
  }

  while (head < tail) {
    const index = queue[head];
    head += 1;
    const x = index % width;
    const y = Math.floor(index / width);
    const distance = distances[index];
    const inShadowBand = distance > 0 && shadowed[index] !== 0;
    const profileIndex = distance + (inShadowBand ? 1 : 0);
    const strength = profile[profileIndex] ?? 0;
    const outputIndex = fieldIndex(x, y);
    if (strength > field.values[outputIndex]) {
      field.values[outputIndex] = strength;
    }

    const nextDistance = distance + 1;
    if (nextDistance >= profile.length) continue;

    if (x > 0) {
      const next = index - 1;
      if (blocked[next] === 0 && distances[next] < 0) {
        distances[next] = nextDistance;
        queue[tail] = next;
        tail += 1;
      }
    }
    if (x + 1 < width) {
      const next = index + 1;
      if (blocked[next] === 0 && distances[next] < 0) {
        distances[next] = nextDistance;
        queue[tail] = next;
        tail += 1;
      }
    }
    if (y > 0) {
      const next = index - width;
      if (blocked[next] === 0 && distances[next] < 0) {
        distances[next] = nextDistance;
        queue[tail] = next;
        tail += 1;
      }
    }
    if (y + 1 < height) {
      const next = index + width;
      if (blocked[next] === 0 && distances[next] < 0) {
        distances[next] = nextDistance;
        queue[tail] = next;
        tail += 1;
      }
    }
  }
}

/**
 * Rebuilds the reusable local-light field from smart-object rows.
 *
 * Source columns and `walls` are consumed during this call and never retained.
 * Contributions combine with `max`, making the result independent of row
 * order. Disabled lighting still resets the reused field so old pools cannot
 * survive the flat-lighting toggle.
 */
export function buildLightField(
  source: LightingSource,
  width: number,
  height: number,
  walls: Uint32Array,
  enabled: boolean,
): TileLighting {
  if (!configureField(width, height)) return field;
  if (!enabled) return field;

  markWalls(walls, width, height);
  const count = source.count;
  if (!Number.isSafeInteger(count) || count <= 0) return field;

  const positions = source.positions();
  const kinds = source.kinds();
  const sprites = source.sprites();
  const footprintWidths = source.footprintWidths();
  const footprintDepths = source.footprintDepths();

  for (let row = 0; row < count; row += 1) {
    if (kinds[row] !== KIND_OBJECT) continue;
    const profile = profileForSprite(sprites[row]);
    if (profile === null) continue;

    const centredX = positions[row * 2];
    const centredY = positions[row * 2 + 1];
    const footprintWidth = footprintWidths[row];
    const footprintDepth = footprintDepths[row];
    if (
      !Number.isFinite(centredX) ||
      !Number.isFinite(centredY) ||
      !Number.isInteger(footprintWidth) ||
      !Number.isInteger(footprintDepth)
    ) {
      continue;
    }

    const originX = Math.floor(centredX - (footprintWidth - 1) * 0.5);
    const originY = Math.floor(centredY - (footprintDepth - 1) * 0.5);
    if (
      !validFootprint(
        originX,
        originY,
        footprintWidth,
        footprintDepth,
        width,
        height,
      ) ||
      !footprintIsClear(
        originX,
        originY,
        footprintWidth,
        footprintDepth,
        width,
      )
    ) {
      continue;
    }

    spreadEmitter(
      profile,
      originX,
      originY,
      footprintWidth,
      footprintDepth,
      width,
      height,
      count,
      positions,
      kinds,
      footprintWidths,
      footprintDepths,
    );
  }

  return field;
}
