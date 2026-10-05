/** Additive visible ownership shared by occupied beds and neutral seats. */
export type VisibleSceneLayers = Readonly<Record<number, readonly [number, number, number, number]>>;

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
