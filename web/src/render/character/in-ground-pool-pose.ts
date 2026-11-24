import {interpolateTransform} from './motion.js';
import {properPoolRotation, solvePoolHierarchyLimb, translatePoolRoot, type PoolHierarchy} from './pool-canonical-pose.js';
import {poolSurfacePoint, type PoolEntryAnatomy} from './pool-entry-anatomy.js';
import {composeSkeletonPose} from './pose-joints.js';
import {add, length, scale, sub, type Vec3} from './math.js';

type PoolAction = 'entry' | 'paddle' | 'exit';
type SamplePool = (action: PoolAction, phase: number, freeArms: boolean) => PoolHierarchy;

const ladderShift = [.5, 3, -1] as const;
const approachShift = [.5, 2.5, 0] as const;
const swimInset = .68;
const takeoff = .6;
const deckReached = .76;
const lastCrestPose = .64;

function move(pose: PoolHierarchy, shift: Vec3): PoolHierarchy {
  const root = pose.bundle.bones.findIndex(bone => bone.name === 'root');
  const previous = pose.basis[root];
  const basis = properPoolRotation(previous);
  basis.splice(12, 3, ...position(previous));
  pose.basis[root] = basis;
  translatePoolRoot(pose, shift);
  return pose;
}

function smooth(progress: number): number {
  const t = Math.max(0, Math.min(1, progress));
  return t * t * (3 - 2 * t);
}

function position(matrix: readonly number[]): Vec3 {
  return [matrix[12], matrix[13], matrix[14]];
}

function inBasin(pose: PoolHierarchy, swim: number): PoolHierarchy {
  return move(pose, [ladderShift[0], ladderShift[1] - swimInset * swim, ladderShift[2]]);
}

function gripBasinLadder(pose: PoolHierarchy, phase: number, anatomy: PoolEntryAnatomy): PoolHierarchy {
  const grasp = smooth((phase - .245) / .065) * smooth((.58 - phase) / .09);
  if (grasp === 0) return pose;
  const {basis, world, rest} = pose;
  const original = basis.slice();
  const hips = pose.bundle.bones.findIndex(bone => bone.name === 'hips');
  for (const [limb, railZ] of [['handL', .30], ['handR', .165]] as const) {
    const {upper, lower, end, completeHandCoefficients} = anatomy[limb];
    const shoulder = position(world[upper]);
    const side = Math.sign(shoulder[0] - world[hips][12]);
    const orientation = properPoolRotation(world[end]);
    // These are two holds on the interior stem and bend exported by
    // export_in_ground_pool.py. Register the actual shaped palm to the
    // inside face of the tube, leaving the fingers clear of the steel.
    const railY = railZ <= .21 ? 2.85 : 3.03 - Math.sqrt(.18 ** 2 - (railZ - .21) ** 2);
    const palm = completeHandCoefficients!.map(point => poolSurfacePoint(orientation, point))
      .reduce((outer, point) => side * point[0] > side * outer[0] ? point : outer);
    const wrist = sub([side * (.405 - .024 - .002), railY, railZ], palm);
    const delta = sub(wrist, shoulder);
    const reach = length(sub(position(rest[lower]), position(rest[upper])))
      + length(sub(position(rest[end]), position(rest[lower]))) - .005;
    const target = add(shoulder, scale(delta, Math.min(1, reach / length(delta))));
    solvePoolHierarchyLimb(pose, upper, lower, end, target, position(world[lower]), orientation);
    for (const bone of [upper, lower, end]) basis[bone] = interpolateTransform(original[bone], basis[bone], grasp);
  }
  pose.world = composeSkeletonPose(pose.bundle.bones, rest, basis);
  return pose;
}

function crossDeck(start: PoolHierarchy, finish: PoolHierarchy, phase: number, lead: 'L' | 'R'): PoolHierarchy {
  if (phase === 0) return start;
  if (phase === 1) return finish;
  const {bundle, rest, inverse} = start;
  const basis = start.basis.map((matrix, index) => interpolateTransform(matrix, finish.basis[index], smooth(phase)));
  const pose = {bundle, rest, inverse, basis, world: composeSkeletonPose(bundle.bones, rest, basis)};
  // During each step the other foot stays at its dry contact. Use the two
  // fitted endpoints so the hop and ladder share the exact same poses here.
  const steps = (['L', 'R'] as const).map(side => {
    const [thigh, shin, foot] = ['thigh', 'shin', 'foot'].map(name =>
      bundle.bones.findIndex(bone => bone.name === name + '.' + side));
    const step = side === lead ? phase / .58 : (phase - .42) / .58;
    const orientation = interpolateTransform(start.world[foot], finish.world[foot], smooth(step));
    const lift = step > 0 && step < 1 ? .10 * Math.sin(Math.PI * step) ** 2 : 0;
    const target: Vec3 = [orientation[12], orientation[13], orientation[14] + lift];
    const reach = length(sub(position(rest[shin]), position(rest[thigh])))
      + length(sub(position(rest[foot]), position(rest[shin])));
    return {thigh, shin, foot, target, orientation, reach};
  });
  // Lower the hips over a planted foot when the configured legs are shorter
  // than the stride. Both heel targets stay where the step puts them.
  const crouch = Math.min(0, ...steps.map(({thigh, target, reach}) => {
    const delta = sub(target, position(pose.world[thigh]));
    const usableReach = reach - .003 * Math.sin(Math.PI * phase);
    return delta[2] + Math.sqrt(Math.max(0, usableReach ** 2 - delta[0] ** 2 - delta[1] ** 2));
  }));
  if (crouch < 0) move(pose, [0, 0, crouch]);
  for (const {thigh, shin, foot, target, orientation} of steps) {
    solvePoolHierarchyLimb(pose, thigh, shin, foot, target, position(pose.world[shin]), orientation);
  }
  return pose;
}

/**
 * The submerged treads and the deck at their top are registered to the
 * original climb. Only the steps across the ground need a new path.
 */
export function sampleInGroundPool(action: PoolAction, phase: number, sample: SamplePool, anatomy?: PoolEntryAnatomy): PoolHierarchy {
  if (action === 'paddle') return inBasin(sample(action, phase, false), 1);
  if (action === 'entry') {
    if (phase >= takeoff) {
      const flight = smooth((phase - takeoff) / .33);
      return inBasin(sample(action, phase, false), flight);
    }
    return crossDeck(
      move(sample('entry', 0, false), approachShift),
      move(sample('entry', takeoff, false), ladderShift),
      phase / takeoff, 'L',
    );
  }
  if (phase <= .1) return inBasin(sample('exit', phase, false), 1);
  if (phase <= deckReached) {
    const climbPhase = .1 + (lastCrestPose - .1) * (phase - .1) / (deckReached - .1);
    const swim = 1 - smooth((climbPhase - .1) / .13);
    const pose = inBasin(sample('exit', climbPhase, true), swim);
    return anatomy ? gripBasinLadder(pose, climbPhase, anatomy) : pose;
  }
  return crossDeck(
    move(sample('exit', lastCrestPose, true), ladderShift),
    move(sample('exit', 1, false), approachShift),
    (phase - deckReached) / (1 - deckReached), 'R',
  );
}
