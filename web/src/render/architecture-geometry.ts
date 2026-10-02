import type { WindowDefinition, WindowPlacement } from '../architecture/windows.js';
import { coveredWindowLines } from '../architecture/windows.js';
import { architectureDirection, architectureJunction, architecturePieces, architectureSprite,
  type ArchitectureSide, type ArchitectureSprite } from './architecture.js';
import type { EdgeWallPanel } from './edge-walls.js';

type Cell = readonly [number, number];
interface Arm { height: number; cells: readonly Cell[] }
interface Vertex { x: number; y: number; arms: (Arm | undefined)[] }

export interface ArchitectureWalls {
  readonly width: number;
  readonly height: number;
  readonly house: readonly [number, number];
  readonly edges: Uint32Array;
  readonly windows: readonly WindowPlacement[];
  readonly catalogue: readonly WindowDefinition[];
  readonly hinged?: ArrayLike<number>;
  readonly horizontalHinged?: ArrayLike<number>;
  readonly cutaway: boolean;
  /** Both source faces are available without mirroring or stretching. */
  readonly side?: ArchitectureSide;
}

const lineKey = (axis: number, x: number, y: number): string => `${axis}/${x}/${y}`;
const cellsFor = (axis: number, x: number, y: number): readonly Cell[] =>
  axis === 0 ? [[x - 1, y], [x, y]] : [[x, y - 1], [x, y]];

/** Solid half-segments terminate at aperture endpoints, never inside their span. */
export function buildArchitectureWallGeometry(lot: ArchitectureWalls): EdgeWallPanel[] {
  const vertices = new Map<string, Vertex>();
  const apertures = new Set<string>();
  const panels: EdgeWallPanel[] = [];
  const side = lot.side ?? 'front';
  const isRearShell = (axis: number, x: number, y: number): boolean => axis === 0
    ? x === 0 && y >= 0 && y < Math.min(lot.height, lot.house[1])
    : y === 0 && x >= 0 && x < Math.min(lot.width, lot.house[0]);
  const hinged = new Set<string>();
  for (let i = 0; i + 1 < (lot.hinged?.length ?? 0); i += 2) {
    hinged.add(lineKey(0, lot.hinged![i], lot.hinged![i + 1]));
  }
  for (let i = 0; i + 1 < (lot.horizontalHinged?.length ?? 0); i += 2) {
    hinged.add(lineKey(1, lot.horizontalHinged![i], lot.horizontalHinged![i + 1]));
  }
  const emit = (sprite: ArchitectureSprite, x: number, y: number, low: boolean,
    cells: readonly Cell[], farTiles: readonly Cell[], fadeKey: string, window = false): void => {
    panels.push({ x, y, mask: 0, spriteName: sprite.name, architectureId: sprite.id,
      low, lightSamples: cells, farTiles, fadeKey, window });
  };
  for (const window of lot.windows) {
    const lines = coveredWindowLines(window, lot.catalogue);
    for (const line of lines) apertures.add(lineKey(line.axis, line.x, line.y));
    const low = lot.cutaway && !lines.every(line => isRearShell(line.axis, line.x, line.y));
    const pieces = architectureSprite(window.model, window.axis, side, low);
    if (pieces[0].width !== lines.length) throw new Error('Window art and simulation spans differ');
    const x = window.x - .5 + (window.axis === 1 ? lines.length / 2 : 0);
    const y = window.y - .5 + (window.axis === 0 ? lines.length / 2 : 0);
    const cells = lines.flatMap(line => cellsFor(line.axis, line.x, line.y));
    const far = lines.map(line => cellsFor(line.axis, line.x, line.y)[0]);
    const key = `window/${window.axis}/${window.x}/${window.y}/${window.model}`;
    for (const piece of pieces) emit(piece, x, y, low, cells, far, key, true);
  }
  const arm = (x: number, y: number, index: number, height: number, cells: readonly Cell[]): void => {
    const key = `${x}/${y}`;
    const vertex = vertices.get(key) ?? { x, y, arms: Array<Arm | undefined>(4).fill(undefined) };
    const existing = vertex.arms[index];
    if (existing && existing.height !== height) throw new Error('Conflicting wall arm heights');
    vertex.arms[index] = { height, cells };
    vertices.set(key, vertex);
  };
  const segments = new Set<string>();
  const segment = (axis: 0 | 1, x: number, y: number, door: boolean, low: boolean): void => {
    const key = lineKey(axis, x, y);
    if (apertures.has(key)) return;
    if (segments.has(key)) return;
    segments.add(key);
    const cells = cellsFor(axis, x, y);
    if (door) {
      if (hinged.has(key)) return;
      const pieces = architecturePieces(`doorway.${architectureDirection(axis, side)}.${low ? 'cut' : 'full'}`);
      for (const piece of pieces) emit(piece, x - (axis === 0 ? .5 : 0),
        y - (axis === 1 ? .5 : 0), low, cells, [cells[0]], `door/${key}`);
      return;
    }
    const height = low ? 1 : 2;
    arm(x, y, axis === 0 ? 1 : 0, height, cells);
    arm(x + (axis === 1 ? 1 : 0), y + (axis === 0 ? 1 : 0), axis === 0 ? 3 : 2, height, cells);
  };
  for (let y = 0; y < Math.min(lot.height, lot.house[1]); y++) segment(0, 0, y, false, false);
  for (let x = 0; x < Math.min(lot.width, lot.house[0]); x++) segment(1, x, 0, false, false);
  for (let i = 0; i + 3 < lot.edges.length; i += 4) {
    const axis = lot.edges[i];
    if (axis !== 0 && axis !== 1) throw new Error('Invalid wall axis');
    segment(axis, lot.edges[i + 1], lot.edges[i + 2], lot.edges[i + 3] === 1, lot.cutaway);
  }
  for (const vertex of vertices.values()) {
    const heights = vertex.arms.map(entry => entry?.height ?? 0) as [number, number, number, number];
    for (const sprite of architectureJunction(heights)) {
      if (typeof sprite.ownedSpan !== 'number') throw new Error('A junction piece needs an arm owner');
      const owner = vertex.arms[sprite.ownedSpan]!;
      emit(sprite, vertex.x - .5, vertex.y - .5, owner.height === 1,
        owner.cells, [owner.cells[0]], `arm/${vertex.x}/${vertex.y}/${sprite.ownedSpan}`);
    }
  }
  return panels;
}
