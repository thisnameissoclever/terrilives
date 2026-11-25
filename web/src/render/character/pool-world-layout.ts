import type {Vec3} from './math.js';

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

export const POOL_DEPARTURE_TICKS = 6;
export const POOL_RETURN_TICKS = 8;
export const NO_POOL_SLOT = 0xffffffff;

export interface PoolPlacement {offset:Vec3;yaw:number}
type Waypoint = readonly [x:number,y:number,yaw:number];
const turn = Math.PI / 2;
const lodgeMouth = [.123,-.391,0] as const;
const basinMouth = [.623,1.929,0] as const;
const clearLodgeStairs = [.55,-.66,0] as const;

// The west route rounds the submerged stair before crossing toward its berth.
const lodgeRoutes:readonly (readonly Waypoint[])[] = [
  [lodgeMouth,clearLodgeStairs,[.55,-.66,turn],[.55,-.95,turn],[.03,-.95,turn],
    [.03,-1.35,turn],[-.18,-1.35,turn],[-.18,-2.17,.58]],
  [lodgeMouth,clearLodgeStairs,[.55,-.66,turn/2],[1.10,-.66,turn/2],[1.18,-2.16,-.90]],
];

// Turn down the Basin's center aisle before crossing to each berth's open diagonal.
function basinRoute(berth:Waypoint,aisleEntryYaw:number,aisleEndYaw:number):readonly Waypoint[] {
  return [basinMouth,[.623,1.77,0],[0,1.77,0],[0,1.77,aisleEntryYaw],[0,berth[1],aisleEndYaw],berth];
}

const basinRoutes = [
  basinRoute([-1.30,0,.47],turn/8,turn/2),
  basinRoute([1.30,0,-2.16],-turn/2,-turn*1.25),
  basinRoute([-1.28,-1.62,2.56],turn/8,turn*.75),
  basinRoute([1.30,-1.62,-.63],turn/8,turn*.75),
];

/** The live swimmer's pivot follows a reversible route in the authored pool frame. */
export function poolSwimPlacement(model:string|null,slot:number,progress:number):PoolPlacement|undefined {
  if(progress<=0)return undefined;
  const route=model===LODGE_POOL_MODEL?lodgeRoutes[slot]:model===IN_GROUND_POOL_MODEL?basinRoutes[slot]:undefined;
  if(!route)throw new Error('Shared swimmer has no berth in its pool model.');

  const segments=route.length-1,time=Math.min(1,progress)*segments;
  const segment=Math.min(Math.floor(time),segments-1),phase=time-segment;
  const smooth=phase*phase*(3-2*phase);
  const start=route[segment],end=route[segment+1],mouth=route[0];
  const x=start[0]+(end[0]-start[0])*smooth,y=start[1]+(end[1]-start[1])*smooth;
  const yaw=start[2]+(end[2]-start[2])*smooth,c=Math.cos(yaw),s=Math.sin(yaw);
  return {yaw,offset:[x-c*mouth[0]+s*mouth[1],y-s*mouth[0]-c*mouth[1],0]};
}
