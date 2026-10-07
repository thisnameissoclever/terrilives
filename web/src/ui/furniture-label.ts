import type { ObjectDetails } from './object-identity.js';
export interface FurnitureLabelSource {
  objectName(entity: number): string;
  objectDetails?(entity: number): ObjectDetails | undefined;
  ids(): Uint32Array;
  positions?(): Float32Array;
}
/** Stable values select the object; visible location distinguishes repeated models. */
export function furnitureLabel(source: FurnitureLabelSource, entity: number,
  geometry?: { ids: readonly number[]; positions: readonly number[] }): string {
  const ids = geometry?.ids ?? Array.from(source.ids());
  const positions = geometry?.positions ?? (source.positions ? Array.from(source.positions()) : []);
  const row = ids.indexOf(entity);
  const type = source.objectName(entity);
  const model = source.objectDetails?.(entity)?.modelName;
  const location = row >= 0 && positions.length > row * 2 + 1 ? ` at (${positions[row * 2]}, ${positions[row * 2 + 1]})` : '';
  return `${type}${model ? `: ${model}` : ''}${location}`;
}
