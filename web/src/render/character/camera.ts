/** One physical envelope for every shape and facing, including forward feet and book. */
export const CHARACTER_FRAME = { width: 96, height: 128, groundY: 100 } as const;
/** Includes rotated furniture and tall reaching poses at the same two-pixel scale. */
export const WORLD_CHARACTER_FRAME = { size: 384, zoom: 2 / 3, groundFraction: .75 } as const;
export function characterPixelScale(width: number, height: number): number {
  return Math.min(width / CHARACTER_FRAME.width, height / CHARACTER_FRAME.height);
}
