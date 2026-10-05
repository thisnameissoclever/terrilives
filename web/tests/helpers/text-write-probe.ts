/** Counts assignments to a leaf in the existing DOM test doubles. */
export function textWriteProbe(target: { textContent: string | null }): { writes: number } {
  const probe = { writes: 0 };
  let value = target.textContent;
  Object.defineProperty(target, 'textContent', {
    configurable: true,
    get: () => value,
    set: (next: string | null) => { probe.writes++; value = next; },
  });
  return probe;
}
