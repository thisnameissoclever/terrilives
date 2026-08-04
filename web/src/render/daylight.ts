/**
 * The hour of day, as a colour the whole frame is multiplied by.
 *
 * [ML-ambient] in docs/specs/2026-08-03-muted-line-implementation.md. This
 * is the cheapest useful thing in the renderer: one `vec4` in the uniform
 * struct and one multiply in the fragment shader, no extra draw call, no
 * per-instance data, and [D10]'s one draw and one submit per frame survive
 * untouched.
 *
 * **Lighting is presentation and must never enter the world hash.** It is
 * computed here from the clock the simulation already publishes and never
 * travels back, because [D12] hashes the world in CI and a lighting value
 * that leaked into it would make the hash depend on the renderer.
 * `daylight.test.ts` asserts the function is pure in the only sense that
 * matters: same tick in, same colour out.
 *
 * The curve lives in TypeScript rather than in `content/tuning.toml` on
 * purpose, and that is the same argument. Tuning numbers the SIMULATION
 * reads are content; this one is read by nobody but the shader. The sleep
 * curve, which the simulation does read, is authored in tuning.toml.
 */

/** Red, green, blue multipliers, and a spare to fill the 16-byte stride. */
export type Ambient = readonly [number, number, number, number];

interface Stop {
  /** Fraction of the day, 0 at midnight. */
  readonly at: number;
  readonly rgb: readonly [number, number, number];
}

/**
 * Keyframes, in order, wrapping from the last back to the first.
 *
 * Two rules held the whole curve together while tuning it against real
 * captures:
 *
 * **Night is cool and dim, never merely dim.** Scaling all three channels
 * down equally reads as a screenshot with the brightness slider pulled,
 * not as night. The blue channel staying high relative to red is what
 * makes the eye accept it.
 *
 * **Nothing goes below the floor.** See `AMBIENT_FLOOR`.
 */
const STOPS: readonly Stop[] = [
  { at: 0.0, rgb: [0.42, 0.46, 0.66] }, // 00:00 deep night, cool
  { at: 0.21, rgb: [0.46, 0.5, 0.7] }, // 05:00 still night
  { at: 0.29, rgb: [0.86, 0.82, 0.86] }, // 07:00 dawn, colour returning
  { at: 0.42, rgb: [1.0, 1.0, 1.0] }, // 10:00 neutral daylight
  { at: 0.62, rgb: [1.0, 0.99, 0.96] }, // 15:00 barely warm
  { at: 0.79, rgb: [1.0, 0.88, 0.72] }, // 19:00 low warm sun
  { at: 0.87, rgb: [0.72, 0.64, 0.72] }, // 21:00 dusk
  { at: 0.94, rgb: [0.48, 0.5, 0.7] }, // 22:30 into night
];

/**
 * How dark the world is ever allowed to get.
 *
 * [ML-a11y]. The worst case for this game is not a dark room, it is a dim
 * phone in daylight, and a night the player cannot read is a bug rather
 * than atmosphere. The HUD is DOM and sits outside the canvas, so the
 * readouts are unaffected either way - this only protects the world.
 */
export const AMBIENT_FLOOR = 0.42;

const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

/**
 * The ambient colour for a simulation tick.
 *
 * `dayTicks` comes from the content pack rather than being assumed, because
 * `tuning.toml` owns the length of a day and the tests run with much
 * shorter ones.
 */
export function ambientFor(tick: number, dayTicks: number): Ambient {
  // A zero-length day would divide by zero and a negative tick would index
  // backwards off the curve. Both mean the caller is confused rather than
  // that the sky is a particular colour, so answer neutral and let whatever
  // is actually wrong surface where it happens.
  if (!Number.isFinite(tick) || !Number.isFinite(dayTicks) || dayTicks <= 0) {
    return [1, 1, 1, 1];
  }

  // `%` in JavaScript keeps the sign of the dividend, so a negative tick
  // would land outside [0, 1) and clamp to the first stop rather than
  // wrapping. Normalising here means the curve below never has to care.
  const phase = (((tick % dayTicks) + dayTicks) % dayTicks) / dayTicks;

  let previous = STOPS[STOPS.length - 1]!;
  let next = STOPS[0]!;
  for (let i = 0; i < STOPS.length; i += 1) {
    if (STOPS[i]!.at > phase) {
      next = STOPS[i]!;
      previous = STOPS[(i - 1 + STOPS.length) % STOPS.length]!;
      break;
    }
    // Past the last stop, so the segment wraps to the first one.
    if (i === STOPS.length - 1) {
      previous = STOPS[i]!;
      next = STOPS[0]!;
    }
  }

  // The wrapping segment spans the end of the day and the start of the
  // next, so its length is measured the long way round.
  const span = next.at > previous.at ? next.at - previous.at : 1 - previous.at + next.at;
  const along = next.at > previous.at
    ? phase - previous.at
    : (phase >= previous.at ? phase - previous.at : 1 - previous.at + phase);
  const t = span === 0 ? 0 : along / span;

  return [
    Math.max(AMBIENT_FLOOR, lerp(previous.rgb[0], next.rgb[0], t)),
    Math.max(AMBIENT_FLOOR, lerp(previous.rgb[1], next.rgb[1], t)),
    Math.max(AMBIENT_FLOOR, lerp(previous.rgb[2], next.rgb[2], t)),
    1,
  ];
}

/** Noon, for callers that want the cycle off. Also the reduced-motion answer. */
export const AMBIENT_NEUTRAL: Ambient = [1, 1, 1, 1];
