/** Additive visible ownership shared by occupied beds and neutral seats. */
export type VisibleSceneLayers = Readonly<Record<number, readonly [number, number, number, number]>>;

export type SharedSceneLayers = Readonly<Record<number, readonly [number, number, number, number, number]>>;

/** Two vec4 records retain old scenes and add a third body with shared ink. */
export function packPresentationLayers(count: number, layers: VisibleSceneLayers,
  shared: SharedSceneLayers = {}, jointAlpha: Readonly<Record<number, number>> = {}): Uint32Array<ArrayBuffer> {
  const legacy = packVisibleSceneLayers(count, layers);
  const table = new Uint32Array(Math.max(1, count) * 8);
  for (let row = 0; row < count; row++) table.set(legacy.subarray(row * 4, row * 4 + 4), row * 8);
  for (const [key, refs] of Object.entries(shared)) {
    const row = Number(key);
    if (!Number.isInteger(row) || row < 0 || row >= count || refs.length !== 5
        || refs[0] < 0 || refs[4] < 0
        || refs.some(ref => !Number.isInteger(ref) || ref < -1 || ref >= count)) {
      throw new Error('Shared scene layer reference is out of range');
    }
    table.set(refs.map(ref => ref + 1), row * 8);
    table[row * 8 + 6] = row + 1;
    table[row * 8 + 7] = (jointAlpha[row] ?? -1) + 1;
  }
  return table;
}

export function packVisibleSceneLayers(count: number, layers: VisibleSceneLayers): Uint32Array<ArrayBuffer> {
  if (!Number.isInteger(count) || count < 0) throw new Error('Visible scene count is out of range');
  const table = new Uint32Array(Math.max(1, count) * 4);
  for (const [key, references] of Object.entries(layers)) {
    const scene = Number(key);
    if (!Number.isInteger(scene) || scene < 0 || scene >= count || references.length !== 4
        || references[0] < 0 || references[3] < 0
        || references.some(index => !Number.isInteger(index) || index < -1 || index >= count)) {
      throw new Error('Visible scene layer reference is out of range');
    }
    table.set(references.map(index => index + 1), scene * 4);
  }
  return table;
}
