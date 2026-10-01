import { ARCHITECTURE } from './architecture-data.js';
import { BAKED_FLOORS } from './architecture-baked-floors.js';
import { architectureFloor } from './architecture.js';
import type { FinishCatalogue } from './architecture-finishes.js';

export type FloorZone = 'house' | 'yard' | 'street';
const defaultCatalogue: FinishCatalogue = ARCHITECTURE.catalogue;
const baked: Readonly<Record<string, { readonly finish: FinishCatalogue['finishes'][string];
  readonly pattern: FinishCatalogue['patterns'][string]; readonly palette: FinishCatalogue['palettes'][string];
  readonly patternSha256: string }>> = BAKED_FLOORS.finishes;
const resources: Readonly<Record<string, { readonly sha256: string }>> = ARCHITECTURE.patterns;

/** Saved covering IDs resolve through content metadata, independently of labels. */
export function floorMaterial(covering: number, zone: FloorZone, x: number, y: number,
  catalogue: FinishCatalogue = defaultCatalogue) {
  const finishKey = covering === 0 && zone !== 'house' ? `floor.${zone === 'yard' ? 'grass' : 'street'}`
    : catalogue.coverings[String(covering)];
  const finish = catalogue.finishes[finishKey];
  const pattern = finish && catalogue.patterns[finish.patternKey];
  const palette = finish && catalogue.palettes[finish.paletteKey];
  if (!finish || !pattern || pattern.role !== 'floor' || !palette) {
    throw new Error(`Missing floor finish for covering ${covering} in ${zone}`);
  }
  const baseline = finish.authoredContentLook;
  if (!baseline || baseline.length !== 3 || !baseline.every(Number.isFinite) || baseline[1] <= 0) {
    throw new Error(`Invalid authored floor look: ${finishKey}`);
  }
  const original = baked[finishKey];
  const accepted = BAKED_FLOORS.colorSha256 === ARCHITECTURE.hashes.color && original !== undefined
    && JSON.stringify(original.finish) === JSON.stringify(finish)
    && JSON.stringify(original.pattern) === JSON.stringify(pattern)
    && original.patternSha256 === resources[pattern.resource]?.sha256
    && JSON.stringify(original.palette) === JSON.stringify(palette);
  return { finishKey, pattern, palette, accepted, authoredContentLook: baseline,
    sprite: architectureFloor(accepted ? finish.patternKey : 'floor.neutral', x, y) };
}

export function floorSpriteName(covering: number, zone: FloorZone, x: number, y: number): string {
  return floorMaterial(covering, zone, x, y).sprite.name;
}

/** Compare float32 content with float32 baselines so unchanged data is exactly identity. */
export function relativeFloorLook(current: ArrayLike<number>, authored: readonly number[]): [number, number, number] {
  return [Math.fround(current[0]) - Math.fround(authored[0]), Math.fround(current[1]) / Math.fround(authored[1]),
    Math.fround(current[2]) - Math.fround(authored[2])];
}

/** Only placed coverings and the selected tool choice require GPU resources. */
export function activeFloorFinishKeys(floors: ArrayLike<number>, selected: number | null,
  catalogue: FinishCatalogue = defaultCatalogue): string[] {
  const coverings = new Set<number>([0]);
  for (let index = 2; index < floors.length; index += 3) coverings.add(floors[index]);
  if (selected !== null) coverings.add(selected);
  const keys = new Set<string>();
  for (const covering of coverings) {
    const material = floorMaterial(covering, 'house', 0, 0, catalogue);
    if (!material.accepted) keys.add(material.finishKey);
  }
  for (const zone of ['yard', 'street'] as const) {
    const material = floorMaterial(0, zone, 0, 0, catalogue);
    if (!material.accepted) keys.add(material.finishKey);
  }
  return [...keys].sort();
}
