import type { WindowDefinition, WindowPlacement } from '../architecture/windows.js';
import { coveredWindowLines } from '../architecture/windows.js';
import { architectureDirection, architectureJunction, architecturePieces, architectureSprite,
  type ArchitectureSide, type ArchitectureSprite } from './architecture.js';
import type { EdgeWallPanel } from './edge-walls.js';

type Cell = readonly [number, number];
interface Arm { height: number; cells: readonly Cell[]; line: string }
interface Vertex { x: number; y: number; arms: (Arm | undefined)[] }

export interface ArchitectureWalls {
  readonly width: number;
  readonly height: number;
  readonly house: readonly [number, number];
  /** The house's north-west tile; the origin unless land lies behind or beside it. */
  readonly houseOrigin?: readonly [number, number];
  readonly edges: Uint32Array;
  readonly windows: readonly WindowPlacement[];
  readonly catalogue: readonly WindowDefinition[];
  readonly hinged?: ArrayLike<number>;
  readonly horizontalHinged?: ArrayLike<number>;
  readonly cutaway: boolean;
  /**
   * Lines, as `axis/x/y`, drawn full height while the rest are cut away: the
   * Walls tool's selection in its low view ([WB-height]).
   */
  readonly raised?: ReadonlySet<string>;
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
  const raised = lot.raised ?? new Set<string>();
  const [houseX, houseY] = lot.houseOrigin ?? [0, 0];
  const isRearShell = (axis: number, x: number, y: number): boolean => axis === 0
    ? x === houseX && y >= houseY && y < Math.min(lot.height, houseY + lot.house[1])
    : y === houseY && x >= houseX && x < Math.min(lot.width, houseX + lot.house[0]);
  const hinged = new Set<string>();
  for (let i = 0; i + 1 < (lot.hinged?.length ?? 0); i += 2) {
    hinged.add(lineKey(0, lot.hinged![i], lot.hinged![i + 1]));
  }
  for (let i = 0; i + 1 < (lot.horizontalHinged?.length ?? 0); i += 2) {
    hinged.add(lineKey(1, lot.horizontalHinged![i], lot.horizontalHinged![i + 1]));
  }
  const emit = (sprite: ArchitectureSprite, x: number, y: number, low: boolean,
    cells: readonly Cell[], farTiles: readonly Cell[], fadeKey: string, lines: readonly string[],
    window = false): void => {
    panels.push({ x, y, mask: 0, spriteName: sprite.name, architectureId: sprite.id,
      low, lightSamples: cells, farTiles, fadeKey, window, lines });
  };
  for (const window of lot.windows) {
    const lines = coveredWindowLines(window, lot.catalogue);
    const keys = lines.map(line => lineKey(line.axis, line.x, line.y));
    for (const key of keys) apertures.add(key);
    const low = lot.cutaway && !lines.every(line => isRearShell(line.axis, line.x, line.y))
      && !keys.some(key => raised.has(key));
    const pieces = architectureSprite(window.model, window.axis, side, low);
    if (pieces[0].width !== lines.length) throw new Error('Window art and simulation spans differ');
    const x = window.x - .5 + (window.axis === 1 ? lines.length / 2 : 0);
    const y = window.y - .5 + (window.axis === 0 ? lines.length / 2 : 0);
    const cells = lines.flatMap(line => cellsFor(line.axis, line.x, line.y));
    const far = lines.map(line => cellsFor(line.axis, line.x, line.y)[0]);
    const key = `window/${window.axis}/${window.x}/${window.y}/${window.model}`;
    for (const piece of pieces) emit(piece, x, y, low, cells, far, key, keys, true);
  }
  const arm = (x: number, y: number, index: number, height: number, cells: readonly Cell[], line: string): void => {
    const key = `${x}/${y}`;
    const vertex = vertices.get(key) ?? { x, y, arms: Array<Arm | undefined>(4).fill(undefined) };
    const existing = vertex.arms[index];
    if (existing && existing.height !== height) throw new Error('Conflicting wall arm heights');
    vertex.arms[index] = { height, cells, line };
    vertices.set(key, vertex);
  };
  const segments = new Set<string>();
  const segment = (axis: 0 | 1, x: number, y: number, door: boolean, cut: boolean): void => {
    const key = lineKey(axis, x, y);
    if (apertures.has(key)) return;
    if (segments.has(key)) return;
    segments.add(key);
    const low = cut && !raised.has(key);
    const cells = cellsFor(axis, x, y);
    if (door) {
      if (hinged.has(key)) return;
      const pieces = architecturePieces(`doorway.${architectureDirection(axis, side)}.${low ? 'cut' : 'full'}`);
      for (const piece of pieces) emit(piece, x - (axis === 0 ? .5 : 0),
        y - (axis === 1 ? .5 : 0), low, cells, [cells[0]], `door/${key}`, [key]);
      return;
    }
    const height = low ? 1 : 2;
    arm(x, y, axis === 0 ? 1 : 0, height, cells, key);
    arm(x + (axis === 1 ? 1 : 0), y + (axis === 0 ? 1 : 0), axis === 0 ? 3 : 2, height, cells, key);
  };
  for (let y = houseY; y < Math.min(lot.height, houseY + lot.house[1]); y++) segment(0, houseX, y, false, false);
  for (let x = houseX; x < Math.min(lot.width, houseX + lot.house[0]); x++) segment(1, x, houseY, false, false);
  for (let i = 0; i + 3 < lot.edges.length; i += 4) {
    const axis = lot.edges[i];
    if (axis !== 0 && axis !== 1) throw new Error('Invalid wall axis');
    const x = lot.edges[i + 1];
    const y = lot.edges[i + 2];
    const rearPerimeter = axis === 0 ? x === houseX : y === houseY;
    segment(axis, x, y, lot.edges[i + 3] === 1, lot.cutaway && !rearPerimeter);
  }
  for (const vertex of vertices.values()) {
    const heights = vertex.arms.map(entry => entry?.height ?? 0) as [number, number, number, number];
    for (const sprite of architectureJunction(heights)) {
      if (typeof sprite.ownedSpan !== 'number') throw new Error('A junction piece needs an arm owner');
      const owner = vertex.arms[sprite.ownedSpan]!;
      emit(sprite, vertex.x - .5, vertex.y - .5, owner.height === 1,
        owner.cells, [owner.cells[0]], `arm/${vertex.x}/${vertex.y}/${sprite.ownedSpan}`, [owner.line]);
    }
  }
  return panels;
}
