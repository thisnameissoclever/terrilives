// The house's implicit shell as wall rows for the light field and the sky
// flood (land expansion, issue 254, rule 3). The content never records the
// house's west and north lines as walls because they were the lot's edge;
// once bought land lies beyond them they are still walls, and the daylight
// flood and the lamp pools must stop at them as the wall art and the
// simulation already do.

/**
 * `edges` with one solid `[axis, x, y, 0]` row appended for each shell line
 * whose outer tile lies on the grid: the west line at `x = houseX` for the
 * house's rows when `houseX > 0`, the north line at `y = houseY` for the
 * house's columns when `houseY > 0`. A null edge list (a save older than
 * edge walls) stays null, as both consumers read it.
 */
export function edgesWithShell(
  edges: Uint32Array | null | undefined,
  house: readonly [number, number] | null | undefined,
  houseOrigin: readonly [number, number] | null | undefined,
  width: number,
  height: number,
): Uint32Array | null {
  if (edges == null) return null;
  if (!house) return edges;
  const [houseX, houseY] = houseOrigin ?? [0, 0];
  const rows: number[] = [];
  if (houseX > 0 && houseX < width) {
    for (let y = houseY; y < Math.min(height, houseY + house[1]); y++) rows.push(0, houseX, y, 0);
  }
  if (houseY > 0 && houseY < height) {
    for (let x = houseX; x < Math.min(width, houseX + house[0]); x++) rows.push(1, x, houseY, 0);
  }
  if (rows.length === 0) return edges;
  const out = new Uint32Array(edges.length + rows.length);
  out.set(edges);
  out.set(rows, edges.length);
  return out;
}
