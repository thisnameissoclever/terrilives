/** Contributions already include visibility and outline attenuation. */
export function visibleSceneOwner(
  body: number, furniture: number, ink: number, bodyInk: number,
): 'body' | 'furniture' | null {
  if (body + furniture + ink < .5) return null;
  return body + bodyInk >= furniture + ink - bodyInk ? 'body' : 'furniture';
}
