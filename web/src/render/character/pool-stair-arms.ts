import {interpolateTransform} from './motion.js';
import {add, multiply, transform, type Vec3} from './math.js';
import {composePoolCandidate, solvePoolHierarchyLimb, type PoolHierarchy} from './pool-canonical-pose.js';

const smooth = (value: number) => {
  const u = Math.max(0, Math.min(1, value));
  return u * u * (3 - 2 * u);
};

/** Preserve the standing, hop and paddle transitions of the prepared track. */
export function poolStairArmBlend(mode: 'entry' | 'paddle' | 'exit', phase: number): number {
  if (mode === 'entry') {
    return smooth(phase / .18) * smooth((.72 - phase) / .12);
  }
  if (mode === 'exit') {
    return smooth((phase - .1) / .12) * smooth((1 - phase) / .08);
  }
  return 0;
}

export function blendPoolStairArms(pose: PoolHierarchy, phase: number, amount: number, descending: boolean): void {
  const {bundle, basis, inverse, world} = pose;
  const boneIndex = (name: string) => bundle.bones.findIndex(bone => bone.name === name);
  const spine = boneIndex('spine');
  const torso = multiply(world[spine], inverse[spine]);
  torso.splice(12, 3, 0, 0, 0);
  const original = basis.slice();
  const changed: number[] = [];
  const lift = descending ? smooth((phase - .78) / .08) * smooth((.97 - phase) / .05) : 0;
  for (const side of ['L', 'R'] as const) {
    const [upper, forearm, hand] = ['upper_arm', 'forearm', 'hand'].map(name => boneIndex(name + '.' + side));
    const shoulder: Vec3 = [world[upper][12], world[upper][13], world[upper][14]];
    const outside = Math.sign(pose.rest[upper][12] - pose.rest[spine][12]);
    const swing = (side === 'L' ? 1 : -1) * Math.sin(phase * Math.PI * 6);
    // Carry the hands just forward of the ribs, inside the narrow stairs.
    // The shoulders and elbows follow the torso through the turn.
    const wrist = add(shoulder, transform(torso, [-outside * (.095 + .035 * lift), -.22 + .04 * swing, -.26]));
    const elbow = add(shoulder, transform(torso, [outside * .015, .06, -.34]));
    wrist[2] += .22 * lift;
    elbow[2] += .12 * lift;
    solvePoolHierarchyLimb(pose, upper, forearm, hand, wrist, elbow, world[hand]);
    changed.push(upper, forearm, hand);
  }
  for (const index of changed) basis[index] = interpolateTransform(original[index], basis[index], amount);
  composePoolCandidate(pose);
}
