import type { WallLine } from '../ui/wall-tool.js';

export type WindowModelId = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9;
export interface WindowPlacement extends WallLine {
  readonly model: WindowModelId;
}
export interface WindowDefinition {
  readonly id: WindowModelId;
  readonly label: string;
  readonly width: 1 | 2 | 3;
}
export interface WindowEditPreview {
  readonly valid: boolean;
  readonly reason: number;
  readonly affectedLines: readonly WallLine[];
  readonly placement: WindowPlacement | null;
}

function modelId(value: number): WindowModelId {
  if (!Number.isInteger(value) || value < 1 || value > 9) {
    throw new Error('Invalid window model ID.');
  }
  return value as WindowModelId;
}

function line(axis: number, x: number, y: number): WallLine {
  if ((axis !== 0 && axis !== 1) || !Number.isInteger(x) || !Number.isInteger(y)
      || x < 0 || y < 0 || x > 0xffffffff || y > 0xffffffff) {
    throw new Error('Invalid window line.');
  }
  return { axis, x, y };
}

/** Descriptors use four words; the historical expanded-line getter uses three. */
export function decodeWindowPlacements(rows: Uint32Array): readonly WindowPlacement[] {
  if (rows.length % 4 !== 0) throw new Error('Incomplete window descriptor.');
  const windows: WindowPlacement[] = [];
  for (let i = 0; i < rows.length; i += 4) {
    windows.push({ ...line(rows[i], rows[i + 1], rows[i + 2]), model: modelId(rows[i + 3]) });
  }
  return windows;
}

/** Widths and labels are decoded from Rust, without a second model table. */
export function decodeWindowCatalogue(rows: Uint32Array, names: readonly string[]): readonly WindowDefinition[] {
  if (rows.length !== names.length * 2) throw new Error('Incomplete window catalogue.');
  const seen = new Set<number>();
  return names.map((label, index) => {
    const id = modelId(rows[index * 2]);
    const width = rows[index * 2 + 1];
    if (seen.has(id) || (width !== 1 && width !== 2 && width !== 3) || label.length === 0) {
      throw new Error('Invalid window catalogue entry.');
    }
    seen.add(id);
    return Object.freeze({ id, label, width });
  });
}

export function coveredWindowLines(window: WindowPlacement,
  catalogue: readonly WindowDefinition[]): readonly WallLine[] {
  const start = line(window.axis, window.x, window.y);
  const definition = catalogue.find(entry => entry.id === window.model);
  if (!definition) throw new Error('Window model is absent from the catalogue.');
  const end = (start.axis === 0 ? start.y : start.x) + definition.width - 1;
  if (end > 0xffffffff) throw new Error('Window span exceeds its coordinate range.');
  return Array.from({ length: definition.width }, (_, offset) => ({
    axis: start.axis, x: start.x + (start.axis === 1 ? offset : 0),
    y: start.y + (start.axis === 0 ? offset : 0),
  }));
}

export function windowAt(windows: readonly WindowPlacement[], selected: WallLine,
  catalogue: readonly WindowDefinition[]): WindowPlacement | null {
  return windows.find(window => coveredWindowLines(window, catalogue).some(covered =>
    covered.axis === selected.axis && covered.x === selected.x && covered.y === selected.y)) ?? null;
}

export function decodeWindowPreview(rows: Uint32Array): WindowEditPreview {
  if (rows.length < 2 || rows[1] > 1) throw new Error('Invalid window preview.');
  const offset = 2 + rows[1] * 4;
  if (rows.length < offset || (rows.length - offset) % 3 !== 0) {
    throw new Error('Incomplete window preview.');
  }
  const placement = rows[1] === 1 ? decodeWindowPlacements(rows.slice(2, 6))[0] : null;
  const affectedLines: WallLine[] = [];
  for (let i = offset; i < rows.length; i += 3) affectedLines.push(line(rows[i], rows[i + 1], rows[i + 2]));
  return { valid: rows[0] === 0, reason: rows[0], placement, affectedLines };
}
