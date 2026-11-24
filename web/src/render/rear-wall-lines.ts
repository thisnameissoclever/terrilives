/** Backmost saved boundary on each row and column, independent of starting geometry. */
export function rearWallLines(edges: ArrayLike<number>, windows: ArrayLike<number> = []): ReadonlySet<string> {
  const vertical = new Map<number, number>(), horizontal = new Map<number, number>();
  const add = (axis: number, x: number, y: number): void => {
    if (axis === 0) vertical.set(y, Math.min(vertical.get(y) ?? Infinity, x));
    else if (axis === 1) horizontal.set(x, Math.min(horizontal.get(x) ?? Infinity, y));
  };
  for (let i = 0; i + 3 < edges.length; i += 4) add(edges[i], edges[i + 1], edges[i + 2]);
  for (let i = 0; i + 2 < windows.length; i += 3) add(windows[i], windows[i + 1], windows[i + 2]);
  return new Set([...vertical].map(([y, x]) => `0/${x}/${y}`).concat([...horizontal].map(([x, y]) => `1/${x}/${y}`)));
}
