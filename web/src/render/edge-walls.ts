/** Half-panels meet at integer edge vertices, drawn half a tile northwest. */
export interface EdgeWallPanel {
  readonly x: number;
  readonly y: number;
  readonly mask: number;
  readonly spriteName: string;
  readonly architectureId?: number;
  /** Stable physical ownership across camera rebuilds and split source pieces. */
  readonly fadeKey?: string;
  readonly lightSamples: readonly (readonly [number, number])[];
  /**
   * A window rather than a wall or doorway. Historical panels borrow tinted
   * wall art; architectureId selects the authored window on the new path.
   */
  readonly window?: boolean;
  readonly low?: boolean;
  /** Tiles behind this panel from the fixed southeast camera. */
  readonly farTiles?: readonly (readonly [number, number])[];
}

interface Vertex {
  x: number;
  y: number;
  mask: number;
  samples: Map<string, [number, number]>;
  low: boolean;
  farTiles: Map<string, [number, number]>;
}

function spriteForArms(mask: number): string {
  if (mask === 5) return 'wallNS';
  if (mask === 10) return 'wallEW';
  if (mask === 1 || mask === 2 || mask === 4 || mask === 8) return `wallHalf${mask}`;
  return `wallJoin${mask}`;
}

/**
 * Packed rows are [axis (0 vertical, 1 horizontal), x, y, door (0/1)].
 *
 * `house` is the house's `[width, height]` from the lot's north-west corner;
 * every other tile is yard ([OS-yard] in `docs/specs/2026-09-22-the-outside.md`).
 * The back walls run along the house's north and west sides only, so the
 * yard's edge has none. A wall or doorway with a house tile on its north or
 * west side and a yard tile on its south or east side faces the view, and is
 * cut away as the house's front sides always were ([OS-walls]); it still
 * stops sims and light, which read the edges, not this geometry.
 * Each solid half belongs to exactly one vertex. Doors own a full panel at
 * their midpoint and contribute no solid arms that could cover the aperture.
 * The far exterior runs participate in the same graph, without duplicate panels.
 * `hinged` lists vertical doorway lines as `[x, y]` pairs that hold a hinged
 * door ([DR-render]): the door draws its own frame there, so no panel is added.
 * `windows` lists the lines that are windows as `[axis, x, y]` triples
 * ([WN-state]). Each takes a full panel at its own midpoint, as a doorway
 * does, so it reads as its own thing in the wall line and no neighbouring
 * junction has to know about it.
 * `showCutAway` draws the cut-away walls too, as the Walls and Room tools do
 * so the player sees every line they can edit ([WB-draw] in
 * `docs/specs/2026-09-22-walls-in-build.md`).
 */
export function buildEdgeWallGeometry(
  width: number,
  height: number,
  edges: Uint32Array,
  hinged: ArrayLike<number> = [],
  house: readonly [number, number] = [width, height],
  showCutAway = false,
  windows: ArrayLike<number> = [],
  shortWalls = false,
): EdgeWallPanel[] {
  const inHouse = (x: number, y: number): boolean => x < house[0] && y < house[1];
  // Edges never lie on the lot's own edge, so `x - 1` and `y - 1` are tiles.
  const cutAway = (axis: number, x: number, y: number): boolean => (axis === 0
    ? inHouse(x - 1, y) : inHouse(x, y - 1)) && !inHouse(x, y);
  const hingedAt = new Set<string>();
  for (let i = 0; i + 1 < hinged.length; i += 2) hingedAt.add(`${hinged[i]},${hinged[i + 1]}`);
  const vertices = new Map<string, Vertex>();
  const doors: EdgeWallPanel[] = [];
  const addArm = (x: number, y: number, arm: number, cells: [number, number][], low: boolean): void => {
    const key = `${x},${y},${low}`;
    let vertex = vertices.get(key);
    if (vertex === undefined) {
      vertex = { x, y, mask: 0, samples: new Map(), low, farTiles: new Map() };
      vertices.set(key, vertex);
    }
    vertex.mask |= arm;
    for (const cell of cells) vertex.samples.set(`${cell[0]},${cell[1]}`, cell);
    if (low) vertex.farTiles.set(`${cells[0][0]},${cells[0][1]}`, cells[0]);
  };
  const addSegment = (axis: number, x: number, y: number, door: boolean, low = false): void => {
    const vertical = axis === 0;
    const cells: [number, number][] = vertical ? [[x - 1, y], [x, y]] : [[x, y - 1], [x, y]];
    if (door) {
      if (vertical && hingedAt.has(`${x},${y}`)) return;
      doors.push({
        x: vertical ? x - 0.5 : x,
        y: vertical ? y : y - 0.5,
        mask: 0,
        spriteName: low ? (vertical ? 'doorwayLowNS' : 'doorwayLowEW')
          : vertical ? 'doorwayJoinedNS' : 'doorwayJoinedEW',
        lightSamples: cells,
        ...(low ? { low: true, farTiles: [cells[0]] } : {}),
      });
      return;
    }
    addArm(x, y, vertical ? 4 : 2, cells, low);
    addArm(x + (vertical ? 0 : 1), y + (vertical ? 1 : 0), vertical ? 1 : 8, cells, low);
  };
  for (let y = 0; y < Math.min(height, house[1]); y++) addSegment(0, 0, y, false);
  for (let x = 0; x < Math.min(width, house[0]); x++) addSegment(1, x, 0, false);
  for (let i = 0; i + 3 < edges.length; i += 4) {
    if (!shortWalls && !showCutAway && cutAway(edges[i], edges[i + 1], edges[i + 2])) continue;
    addSegment(edges[i], edges[i + 1], edges[i + 2], edges[i + 3] === 1, shortWalls);
  }
  for (let i = 0; i + 2 < windows.length; i += 3) {
    const [axis, x, y] = [windows[i], windows[i + 1], windows[i + 2]];
    if (!shortWalls && !showCutAway && cutAway(axis, x, y)) continue;
    const vertical = axis === 0;
    doors.push({
      x: vertical ? x - 0.5 : x,
      y: vertical ? y : y - 0.5,
      mask: 0,
      spriteName: shortWalls ? (vertical ? 'wallLow5' : 'wallLow10') : vertical ? 'wallNS' : 'wallEW',
      lightSamples: vertical ? [[x - 1, y], [x, y]] : [[x, y - 1], [x, y]],
      window: true,
      ...(shortWalls ? { low: true, farTiles: [vertical ? [x - 1, y] as const : [x, y - 1] as const] } : {}),
    });
  }
  const panels: EdgeWallPanel[] = [...vertices.values()]
    .sort((a, b) => a.y - b.y || a.x - b.x)
    .map((vertex) => ({
      x: vertex.x - 0.5,
      y: vertex.y - 0.5,
      mask: vertex.mask,
      spriteName: vertex.low ? `wallLow${vertex.mask}` : spriteForArms(vertex.mask),
      lightSamples: [...vertex.samples.values()].sort((a, b) => a[1] - b[1] || a[0] - b[0]),
      ...(vertex.low ? { low: true, farTiles: [...vertex.farTiles.values()] } : {}),
    }));
  doors.sort((a, b) => a.y - b.y || a.x - b.x);
  return panels.concat(doors);
}

/** Play view: preserve the rear shell, lower every authored wall and sill. */
export function buildShortEdgeWallGeometry(
  width: number, height: number, edges: Uint32Array,
  hinged: ArrayLike<number> = [],
  house: readonly [number, number] = [width, height],
  windows: ArrayLike<number> = [],
): EdgeWallPanel[] {
  return buildEdgeWallGeometry(width, height, edges, hinged, house, true, windows, true);
}
