import { ARCHITECTURE } from './architecture-data.js';
import type { WindowModelId } from '../architecture/windows.js';

export type ArchitectureSprite = (typeof ARCHITECTURE.sprites)[number];
export type ArchitectureSide = 'front' | 'back';
export type ArmHeights = readonly [number, number, number, number];

const geometry = new Map<string, ArchitectureSprite[]>();
for (const sprite of ARCHITECTURE.sprites) {
  const pieces = geometry.get(sprite.geometryKey) ?? [];
  pieces.push(sprite);
  geometry.set(sprite.geometryKey, pieces);
}

/** Axis 0 extends along Y; axis 1 extends along X. Neither view mirrors the art. */
export function architectureDirection(axis: 0 | 1, side: ArchitectureSide): string {
  return `${axis === 0 ? 'y' : 'x'}-${side}`;
}

/** All ownership pieces belong to one authored span and share its ground origin. */
export function architectureSprite(modelId: WindowModelId, axis: 0 | 1,
  side: ArchitectureSide, cutaway: boolean): readonly ArchitectureSprite[] {
  const direction = architectureDirection(axis, side);
  const mode = cutaway ? 'cut' : 'full';
  const first = ARCHITECTURE.sprites.find(sprite => sprite.kind === 'window'
    && sprite.model === modelId && sprite.direction === direction && sprite.heightMode === mode);
  if (!first) throw new Error(`Missing window geometry: ${modelId}/${direction}/${mode}`);
  return geometry.get(first.geometryKey)!;
}

export function architectureJunction(heights: ArmHeights): readonly ArchitectureSprite[] {
  if (!heights.every(value => value === 0 || value === 1 || value === 2) || !heights.some(Boolean)) {
    throw new Error('A wall junction needs four absent, cut or full arm heights');
  }
  return architecturePieces(`junction.${heights.join('')}`);
}

export function architecturePieces(key: string): readonly ArchitectureSprite[] {
  const pieces = geometry.get(key);
  if (!pieces) throw new Error(`Missing architecture geometry: ${key}`);
  return pieces;
}

/** Floor phase selection is independent of finish and uses mathematical modulo. */
export function architectureFloor(patternKey: string, x: number, y: number): ArchitectureSprite {
  const phaseX = ((x % 4) + 4) % 4, phaseY = ((y % 4) + 4) % 4;
  const sprite = ARCHITECTURE.sprites.find(entry => entry.kind === 'floor-patch'
    && entry.patternKey === patternKey && entry.phase[0] === phaseX && entry.phase[1] === phaseY);
  if (!sprite) throw new Error(`Missing architecture floor: ${patternKey}/${phaseX}/${phaseY}`);
  return sprite;
}
