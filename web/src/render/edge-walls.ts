/** Half-panels meet at integer edge vertices, drawn half a tile northwest. */
export interface EdgeWallPanel {
  readonly x: number;
  readonly y: number;
  readonly mask: number;
  readonly spriteName: string;
  readonly lightSamples: readonly (readonly [number, number])[];
}

interface Vertex {
  x: number;
  y: number;
  mask: number;
  samples: Map<string, [number, number]>;
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
): EdgeWallPanel[] {
  const inHouse = (x: number, y: number): boolean => x < house[0] && y < house[1];
  // Edges never lie on the lot's own edge, so `x - 1` and `y - 1` are tiles.
  const cutAway = (axis: number, x: number, y: number): boolean => (axis === 0
    ? inHouse(x - 1, y) : inHouse(x, y - 1)) && !inHouse(x, y);
  const hingedAt = new Set<string>();
  for (let i = 0; i + 1 < hinged.length; i += 2) hingedAt.add(`${hinged[i]},${hinged[i + 1]}`);
  const vertices = new Map<string, Vertex>();
  const doors: EdgeWallPanel[] = [];
  const addArm = (x: number, y: number, arm: number, cells: [number, number][]): void => {
    const key = `${x},${y}`;
    let vertex = vertices.get(key);
    if (vertex === undefined) {
      vertex = { x, y, mask: 0, samples: new Map() };
      vertices.set(key, vertex);
    }
    vertex.mask |= arm;
    for (const cell of cells) vertex.samples.set(`${cell[0]},${cell[1]}`, cell);
  };
  const addSegment = (axis: number, x: number, y: number, door: boolean): void => {
    const vertical = axis === 0;
    const cells: [number, number][] = vertical ? [[x - 1, y], [x, y]] : [[x, y - 1], [x, y]];
    if (door) {
      if (vertical && hingedAt.has(`${x},${y}`)) return;
      doors.push({
        x: vertical ? x - 0.5 : x,
        y: vertical ? y : y - 0.5,
        mask: 0,
        spriteName: vertical ? 'doorwayJoinedNS' : 'doorwayJoinedEW',
        lightSamples: cells,
      });
      return;
    }
    addArm(x, y, vertical ? 4 : 2, cells);
    addArm(x + (vertical ? 0 : 1), y + (vertical ? 1 : 0), vertical ? 1 : 8, cells);
  };
  for (let y = 0; y < Math.min(height, house[1]); y++) addSegment(0, 0, y, false);
  for (let x = 0; x < Math.min(width, house[0]); x++) addSegment(1, x, 0, false);
  for (let i = 0; i + 3 < edges.length; i += 4) {
    if (!showCutAway && cutAway(edges[i], edges[i + 1], edges[i + 2])) continue;
    addSegment(edges[i], edges[i + 1], edges[i + 2], edges[i + 3] === 1);
  }
  const panels: EdgeWallPanel[] = [...vertices.values()]
    .sort((a, b) => a.y - b.y || a.x - b.x)
    .map((vertex) => ({
      x: vertex.x - 0.5,
      y: vertex.y - 0.5,
      mask: vertex.mask,
      spriteName: spriteForArms(vertex.mask),
      lightSamples: [...vertex.samples.values()].sort((a, b) => a[1] - b[1] || a[0] - b[0]),
    }));
  doors.sort((a, b) => a.y - b.y || a.x - b.x);
  return panels.concat(doors);
}
