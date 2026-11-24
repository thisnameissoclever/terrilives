export const LODGE_POOL_MODEL = 'pool_above_ground_3x4';
export const RECTANGULAR_POOL_MODEL = 'pool_rectangular';
export const IN_GROUND_POOL_MODEL = 'pool_in_ground_5x7';

export const inGroundPoolWater = {
  minimum: [-1.94, -2.96],
  maximum: [1.94, 2.96],
  height: -.18,
} as const;

export type PoolPoseLayout = 'legacy' | 'lodge' | 'in-ground';

// Color and depth use the full purchase rectangle as their origin. The
// staircase and fitted swimmer stay in the smaller pool's contact frame.
const rectangularOrigin = [[-.5, 0], [0, -.5], [.5, 0], [0, .5]] as const;
const lodgeOrigin = [[-1, .5], [-.5, -1], [1, -.5], [.5, 1]] as const;

export function poolContactOffset(model: string, facing: number): readonly [number, number] {
  if (model === LODGE_POOL_MODEL) return lodgeOrigin[facing];
  if (model === RECTANGULAR_POOL_MODEL) return rectangularOrigin[facing];
  return [0, 0];
}
