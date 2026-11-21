import {add, scale, sub, type Vec3} from './math.js';
import {interpolateTransform} from './motion.js';
import type {PoolLimbState} from './pool-contact-evaluator.js';
import type {PoolChainReach} from './pool-entry-domain.js';
import type {PoolSurfaceCoefficient} from './pool-surface-coefficient.js';
import {fitPoolWaterTarget, type poolWaterBounds} from './pool-water-retarget.js';

export const poolWithdrawalStart = .6238;
export const poolWithdrawalEnd = .94;

interface DescentBody {
  hips: Vec3;
  hipPitch: number;
  trunkPitch: number;
  headPitch: number;
  trunkYaw?: number;
}

const fraction = (phase: number, start: number, end: number) =>
  Math.max(0, Math.min(1, (phase - start) / (end - start)));

function mixPosition(a: Vec3, b: Vec3, t: number): Vec3 {
  if (t === 0) return a;
  if (t === 1) return b;
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

/** Keep both wrists within reach through the second release, then cross into the basin as the feet leave the treads. */
export function poolWithdrawalBody(phase: number, landed: DescentBody, descent: DescentBody,
  corridor: {initialCentre: Vec3; finalCentre: Vec3}) {
  if (phase <= .656) return {intent: landed, freeFootShiftX: 0};
  let hips = mixPosition(landed.hips, descent.hips, fraction(phase, .656, .692));
  const crossing = fraction(phase, .80, poolWithdrawalEnd);
  const shiftX = crossing
    ? corridor.initialCentre[0] + crossing * (corridor.finalCentre[0] - corridor.initialCentre[0]) - hips[0]
    : 0;
  if (shiftX) hips = add(hips, [shiftX, 0, 0]);
  // At .88 the water-foot construction starts using the fitted pelvis directly.
  return {intent: {...descent, hips}, freeFootShiftX: phase < .88 ? shiftX : 0};
}

interface FreeHand {
  limb: 'handL' | 'handR';
  landedGrip: PoolLimbState;
  landedHipX: number;
  release: readonly [number, number];
  railRadius: number;
  shoulder: Vec3;
  reach: PoolChainReach;
  palm: readonly PoolSurfaceCoefficient[];
  bounds: ReturnType<typeof poolWaterBounds>;
  paddle: PoolLimbState;
}

/** Pull the wrist toward the space between the rails before turning the palm and lowering the elbow. */
export function poolFreeWithdrawalHand(phase: number, hand: FreeHand): PoolLimbState {
  if (phase === poolWithdrawalEnd) return hand.paddle;
  const {landedGrip, shoulder, reach, paddle, railRadius} = hand;
  const inward = Math.sign(hand.landedHipX - landedGrip.target[0]);
  const withdrawn = add(landedGrip.target, [inward * 4 * railRadius, -2 * railRadius, 0]);
  if (phase < hand.release[1]) {
    return {target: mixPosition(landedGrip.target, withdrawn, fraction(phase, ...hand.release)),
      pole: landedGrip.pole, orientation: landedGrip.orientation};
  }
  const orientation = interpolateTransform(landedGrip.orientation, paddle.orientation, fraction(phase, .656, .78));
  const forward = scale([inward * .25, -.55, -.36], reach.maximum);
  const free = fitPoolWaterTarget(hand.bounds, hand.limb, shoulder, reach, forward, orientation, hand.palm);
  const upper = reach.lengths[0];
  const elbow = add(shoulder, [inward * upper, -upper, -upper / 2]);
  const leaving = fraction(phase, hand.release[1], .692);
  const swimming = fraction(phase, .88, poolWithdrawalEnd);
  return {
    target: mixPosition(mixPosition(withdrawn, free, leaving), paddle.target, swimming),
    pole: mixPosition(mixPosition(landedGrip.pole, elbow, leaving), paddle.pole, swimming),
    orientation,
  };
}

export function poolHeldWithdrawalHand(actualGrip: PoolLimbState, landedGrip: PoolLimbState,
  landedShoulder: Vec3, currentShoulder: Vec3): PoolLimbState {
  return {...actualGrip, pole: add(landedGrip.pole, sub(currentShoulder, landedShoulder))};
}
