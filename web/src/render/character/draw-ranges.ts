import type { MeshPart } from './bundle.js';

/** Combine adjacent outline draws without adding triangles from unoutlined parts. */
export function outlineDrawRanges(parts: readonly Pick<MeshPart, 'start' | 'count' | 'outline'>[]): { start: number; count: number }[] {
  const ranges: { start: number; count: number }[] = [];
  for (const part of parts) {
    if (!part.outline) continue;
    const previous = ranges.at(-1);
    if (previous && previous.start + previous.count === part.start) previous.count += part.count;
    else ranges.push({ start: part.start, count: part.count });
  }
  return ranges;
}
