//! The circadian rhythm: why a sim goes to bed rather than merely
//! collapsing when energy runs out.
//!
//! [ML-curve], [ML-tag] and [ML-chrono] in
//! `docs/specs/2026-08-03-muted-line-implementation.md`.
//!
//! **No new mechanism.** The scoring path already multiplies a tagged
//! candidate's benefits by a per-sim factor - that is what a trait
//! disposition is - so the sleep drive is another source into the same
//! multiplier, keyed the same way, composed in the same place. [S4]'s
//! one-mechanism rule, with its fifth source.
//!
//! The drive answers a question the need system cannot. Energy says HOW
//! TIRED a sim is and nothing in it knows what time it is, so a bed looks
//! identical at 14:00 and at 23:00 to a sim of the same tiredness.
//! Without the drive, sims sleep whenever energy happens to bottom out,
//! which over a few days drifts through every hour of the clock and reads
//! as a house full of shift workers.

use bevy_ecs::prelude::*;
use terri_core::clock::SimClock;
use terri_core::{Agent, Eating, NeedId, Needs, SleepPressure};
use terri_data::pack::ContentPack;

use crate::Content;

/// Counts how long each sim has been at rock bottom, and clears it once
/// the sim is actually asleep.
///
/// **Cleared on SLEEPING, not on waking.** Clearing when energy recovers
/// would work too, but it would keep the pressure high through the whole
/// first hour in bed, and pressure is what overrides the clock - so a sim
/// woken early would immediately be dragged back. Clearing the moment it
/// lies down means the bed has already won, and the rest is the need
/// system's job.
///
/// The counter saturates rather than wrapping. A sim left on empty for
/// seven weeks of game time would otherwise roll back to zero and cheer
/// up instantly.
/// What the accumulator reads per sim: who it is, how tired, whether it
/// is already in bed, and the counter to advance. Named because clippy
/// counts the tuple's arms, and because the list IS the whole input to
/// the only system that moves exhaustion.
type PressureRow<'a> = (
    Entity,
    &'a Needs,
    Option<&'a Eating>,
    Option<&'a mut SleepPressure>,
);

pub fn accumulate_sleep_pressure(
    mut commands: Commands,
    content: Res<Content>,
    mut query: Query<PressureRow, With<Agent>>,
) {
    let Some(circadian) = content.0.circadian.as_ref() else {
        // No rhythm authored means no pressure to accumulate, and no
        // component either: a pack without a table behaves exactly as it
        // did before this existed, which is what keeps every fixture and
        // golden vector predating the ramp still true.
        return;
    };
    for (entity, needs, eating, pressure) in &mut query {
        let current = pressure.as_deref().map_or(0, |p| p.ticks);
        let next = if is_asleep(content.0, eating) {
            // Cleared the moment the sim lies down. The bed has already
            // won; keeping the pressure high through the first hour would
            // drag a sim woken early straight back to it.
            0
        } else if needs.get(NeedId::Energy) <= circadian.exhaustion_energy {
            // Saturating, not wrapping: a sim left on empty for weeks of
            // game time would otherwise roll back to zero and cheer up.
            current.saturating_add(1)
        } else {
            // Above the line the count resets. Exhaustion is a CONTINUOUS
            // stretch on empty; a sim that found a coffee is no longer in
            // one.
            0
        };
        match pressure {
            Some(mut pressure) => {
                // Written only on change, so an untired household does not
                // dirty every agent's component every tick.
                if pressure.ticks != next {
                    pressure.ticks = next;
                }
            }
            // Inserted on demand rather than at spawn, so a sim restored
            // from a save that predates the ramp starts accumulating on
            // the tick it first needs to, without the restore path having
            // to invent a component for everybody.
            None if next != 0 => {
                commands
                    .entity(entity)
                    .insert(SleepPressure { ticks: next });
            }
            None => {}
        }
    }
}

/// How much longer at rock bottom multiplies a sim's pull toward bed.
///
/// Linear from 1.0 at no pressure to `exhaustion_bonus` at a full ramp,
/// then flat. Flat rather than unbounded because an unbounded term
/// eventually dwarfs every other factor in [S4]'s multiplier, and a sim
/// who has been awake for three days should be desperate for bed rather
/// than incapable of anything else.
pub fn exhaustion_multiplier(pack: &ContentPack, pressure: u32) -> f32 {
    let Some(circadian) = pack.circadian.as_ref() else {
        return 1.0;
    };
    let ramp = circadian.exhaustion_ramp_ticks.max(1);
    let along = (pressure.min(ramp) as f32) / (ramp as f32);
    1.0 + (circadian.exhaustion_bonus - 1.0) * along
}

/// Whether a sim running `eating` is ASLEEP.
///
/// **One rule, three readers**, which is why it is a function rather than
/// three `if`s: the circadian drive that makes a bed attractive at night,
/// the decay scale that slows the other needs while a sim is in it, and
/// the Zzz bubble the shell draws over its head. Two of those three read
/// it through the render buffer and the third through `decay_needs`, and
/// a sim the bubble calls asleep has to be the sim whose hunger is
/// slowed, or the picture is lying about the simulation.
///
/// The rule is the TAG, and it replaced an inference. The render buffer
/// used to ask whether the interaction's biggest positive advert was
/// energy, which is true of a bed and would be equally true of a coffee
/// machine - a Zzz over an espresso, and a sim who stops getting hungry
/// while drinking it. Objects already declare tags, so the answer was
/// already authored; nothing needed inferring.
///
/// `None` is not asleep, and neither is an interaction without the tag.
/// A sim with no `Eating` is walking, waiting or deciding.
pub fn is_asleep(pack: &ContentPack, eating: Option<&Eating>) -> bool {
    let Some(eating) = eating else {
        return false;
    };
    let interaction = &pack.object(eating.object).interactions[eating.interaction as usize];
    interaction.tags.contains(&pack.sleep_tag)
}

/// The sleep-drive multiplier for one sim, at one tick, for one candidate.
///
/// `offset_ticks` is the sim's chronotype - where on the curve it samples
/// - so an early bird reaches the evening ramp before a night owl does.
///
/// Returns 1.0 when the pack authored no rhythm, which is exactly the
/// behaviour every pack had before this existed. That is what lets the
/// feature land without every test fixture growing a table.
pub fn sleep_drive(
    pack: &ContentPack,
    clock: &SimClock,
    offset_ticks: i32,
    tags: &[String],
    pressure: u32,
) -> f32 {
    let Some(circadian) = pack.circadian.as_ref() else {
        return 1.0;
    };
    // Untagged candidates are unaffected. One entry covers every
    // bed-shaped route to sleeping, because objects already carry tags -
    // exactly as one authored fear covers every couch.
    if !tags.iter().any(|tag| tag == &pack.sleep_tag) {
        return 1.0;
    }
    let day_ticks = pack.tuning.day_ticks;
    // The clock says WHEN a bed is appealing; the pressure says how long
    // this sim has been unable to act on that. Multiplied rather than
    // maxed, so a tired sim at midnight is more drawn than a tired sim at
    // noon - the rhythm still shapes the day, it just stops being able to
    // veto sleep outright.
    curve_at(
        &circadian.sleep_drive,
        day_ticks,
        phase(clock.tick, offset_ticks, day_ticks),
    ) * exhaustion_multiplier(pack, pressure)
}

/// Where in the day a sim is, in ticks, after its chronotype offset.
///
/// Public because the wrapping is the part that is easy to get wrong and
/// impossible to see. An offset that pushed the phase negative would
/// index off the front of the curve and pin the sim to the first control
/// point for as long as the offset lasted, which reads as "that one sim
/// never gets sleepy" rather than as an error.
pub fn phase(tick: u64, offset_ticks: i32, day_ticks: u32) -> u32 {
    debug_assert!(day_ticks > 0, "the compile step rejects a zero-tick day");
    if day_ticks == 0 {
        return 0;
    }
    let day = i64::from(day_ticks);
    // The offset is signed and the tick is not, so this happens in i64.
    // Rust's `%` keeps the sign of the dividend, like JavaScript's, hence
    // the double modulo rather than one.
    let raw = (tick % u64::from(day_ticks)) as i64 + i64::from(offset_ticks);
    (((raw % day) + day) % day) as u32
}

/// Linear interpolation across the control points, wrapping at midnight.
///
/// The compile step guarantees the points are strictly ascending, inside
/// the day, and finite and non-negative, so none of THAT is re-checked
/// here. That is [D9] paying for itself: the validation lives once at the
/// boundary and every reader downstream is simpler for it.
///
/// Length is the exception, and deliberately so. This is a `pub` function
/// over a plain slice, so nothing in its signature carries the compile
/// step's guarantee, and an empty curve is answered rather than asserted:
/// no curve is no effect. A `debug_assert` here would read as a second
/// guard for an invariant [D9] already owns, and would make that line the
/// only one in the module no test could reach.
///
/// A curve of ONE point needs no arm of its own, which is worth saying
/// because the obvious `[(_, only)] => return *only` was here and was
/// deleted. With one point `first` and `last` are the same point, so the
/// wrap segment runs from it to itself and the lerp interpolates between
/// two equal values - which is that value, at every phase, by every route
/// through the code below. The arm was a slower way of writing the same
/// answer, and a mutation sweep is what noticed: deleting it changed
/// nothing anywhere.
pub fn curve_at(points: &[(u32, f32)], day_ticks: u32, phase: u32) -> f32 {
    if points.is_empty() {
        return 1.0;
    }
    let first = points[0];
    let last = points[points.len() - 1];

    // `position` finds the first point STRICTLY after the phase.
    // `Some(0)` means the phase precedes every point and `None` means it
    // follows every point; both sit on the segment that wraps around
    // midnight, and they differ only in how far along it the phase is.
    let (a, b, span, along) = match points.iter().position(|(tick, _)| *tick > phase) {
        Some(0) | None => {
            let span = (day_ticks - last.0) + first.0;
            let along = if phase >= last.0 {
                phase - last.0
            } else {
                (day_ticks - last.0) + phase
            };
            (last, first, span, along)
        }
        Some(i) => {
            let a = points[i - 1];
            let b = points[i];
            (a, b, b.0 - a.0, phase - a.0)
        }
    };

    if span == 0 {
        return a.1;
    }
    // One lerp, written once and used everywhere, because [D12] hashes
    // the world in CI and the same arithmetic has to produce the same
    // bits on every target. No `mul_add`: it fuses on some targets and
    // not others, and the difference is a rounding bit.
    a.1 + (b.1 - a.1) * (along as f32 / span as f32)
}

#[cfg(test)]
mod tests {
    use super::*;

    const DAY: u32 = 1440;

    /// The shipped shape: low through the working day, high at night.
    fn shipped() -> Vec<(u32, f32)> {
        vec![(0, 1.6), (300, 1.4), (420, 0.25), (1020, 0.4), (1320, 1.5)]
    }

    /// **The whole point of the ramp**: at the same hour and the same
    /// energy, a sim who has been on empty longer is more drawn to bed.
    ///
    /// Asserted as a strict progression over four durations rather than
    /// as two endpoints, because a step function and a ramp agree at the
    /// ends and differ everywhere between.
    #[test]
    fn the_pull_toward_bed_grows_the_longer_a_sim_is_on_empty() {
        let pack = crate::test_content::pack_with_circadian(
            Vec::new(),
            crate::test_content::tuning(),
            "sleep",
            vec![(0, 1.0), (720, 1.0)],
        );
        let ramp = pack
            .circadian
            .as_ref()
            .expect("the fixture authors a rhythm")
            .exhaustion_ramp_ticks;
        let tag = ["sleep".to_string()];
        let at = |pressure: u32| sleep_drive(pack, &SimClock { tick: 0 }, 0, &tag, pressure);

        let fresh = at(0);
        let quarter = at(ramp / 4);
        let half = at(ramp / 2);
        let full = at(ramp);
        assert!(
            fresh < quarter && quarter < half && half < full,
            "the pull must grow with every stretch on empty: \
             {fresh} then {quarter} then {half} then {full}"
        );
        // And it STOPS growing, so exhaustion cannot eventually dwarf
        // every other factor in the [S4] multiplier.
        assert_eq!(at(ramp * 4), full, "past a full ramp it is flat");
    }

    /// **The ramp's actual numbers, not just their order.**
    ///
    /// The progression test above pins the SHAPE, and a shape is all it
    /// pins: the sweep rewrote `bonus - 1.0` to `bonus + 1.0` and to
    /// `bonus / 1.0`, and turned the `pressure / ramp` fraction into
    /// `pressure * ramp`, and every one of those is still monotonic, still
    /// 1.0 at rest, and still flat past a full ramp. Three survivors from
    /// one missing assertion.
    ///
    /// So this states the interpolation outright. The fixture's bonus is
    /// 2.5 over a 240-tick ramp, and every value below is exact in f32 -
    /// halves and quarters of 1.5 - so these are equalities rather than
    /// approximations.
    #[test]
    fn the_ramp_interpolates_linearly_from_neutral_to_the_authored_bonus() {
        let pack = crate::test_content::pack_with_circadian(
            Vec::new(),
            crate::test_content::tuning(),
            "sleep",
            vec![(0, 1.0), (720, 1.0)],
        );
        let circadian = pack.circadian.as_ref().expect("the fixture authors one");
        let ramp = circadian.exhaustion_ramp_ticks;
        assert_eq!((ramp, circadian.exhaustion_bonus), (240, 2.5));

        assert_eq!(exhaustion_multiplier(pack, 0), 1.0, "rested is neutral");
        assert_eq!(exhaustion_multiplier(pack, 60), 1.375, "a quarter along");
        assert_eq!(exhaustion_multiplier(pack, 120), 1.75, "half along");
        assert_eq!(
            exhaustion_multiplier(pack, 240),
            2.5,
            "a full ramp is the bonus"
        );
        assert_eq!(
            exhaustion_multiplier(pack, u32::MAX),
            2.5,
            "and it is CLAMPED there rather than continuing to climb"
        );
    }

    /// The ramp is what lets the curve say something strong.
    ///
    /// A sim at the curve's worst hour, fully exhausted, must end up
    /// MORE drawn to bed than a rested sim at that same hour - otherwise
    /// the trough can still veto sleep outright, which is the failure the
    /// ramp exists to prevent.
    #[test]
    fn exhaustion_overrides_the_curves_worst_hour() {
        let pack = crate::test_content::pack_with_circadian(
            Vec::new(),
            crate::test_content::tuning(),
            "sleep",
            // The shipped shape: a real trough, but one the ramp can
            // clear. `compile_tuning` refuses a curve it cannot - see
            // `rejects_a_trough_no_amount_of_exhaustion_can_beat`, which
            // is where the deeper case is pinned.
            vec![(0, 1.4), (420, 0.55), (1320, 1.3)],
        );
        let tag = ["sleep".to_string()];
        let morning = SimClock { tick: 420 };
        let ramp = pack.circadian.as_ref().unwrap().exhaustion_ramp_ticks;

        let rested = sleep_drive(pack, &morning, 0, &tag, 0);
        let wrecked = sleep_drive(pack, &morning, 0, &tag, ramp);
        assert!(
            wrecked > rested,
            "a wrecked sim must want bed more than a rested one at the \
             same hour: {wrecked} against {rested}"
        );
        assert!(
            wrecked > 1.0,
            "at the worst hour of the day, a fully exhausted sim must \
             still be pulled TOWARD bed rather than away from it; got {wrecked}"
        );
    }

    /// A pack with no rhythm has no ramp either, which is what keeps
    /// every fixture predating this unchanged.
    #[test]
    fn exhaustion_does_nothing_without_an_authored_rhythm() {
        let pack = crate::test_content::pack(Vec::new());
        assert_eq!(exhaustion_multiplier(pack, 0), 1.0);
        assert_eq!(exhaustion_multiplier(pack, 100_000), 1.0);
        assert_eq!(
            sleep_drive(pack, &SimClock { tick: 0 }, 0, &["sleep".into()], 99_999),
            1.0
        );
    }

    #[test]
    fn a_bed_is_more_attractive_at_night_than_at_noon() {
        // The whole point of the feature, stated as an assertion. If this
        // ever fails the sims are back to sleeping whenever energy
        // happens to run out, which is what the drive exists to stop.
        let noon = curve_at(&shipped(), DAY, 720);
        let midnight = curve_at(&shipped(), DAY, 0);
        assert!(
            midnight > noon,
            "midnight {midnight} must beat noon {noon} at equal tiredness"
        );
    }

    #[test]
    fn the_curve_wraps_across_midnight_rather_than_clamping() {
        // The last point is 22:00 and the first is midnight, so the
        // segment between them spans the wrap. Getting this wrong is
        // invisible: the drive would simply freeze for the last two hours
        // of every day rather than erroring.
        let before = curve_at(&shipped(), DAY, DAY - 1);
        let after = curve_at(&shipped(), DAY, 1);
        assert!(
            (before - after).abs() < 0.05,
            "the curve must be continuous across midnight: {before} then {after}"
        );
    }

    #[test]
    fn the_phase_never_leaves_the_day_whatever_the_chronotype() {
        // A negative phase would index off the front of the curve and pin
        // that sim to the first control point forever.
        for offset in [-2000, -180, -1, 0, 1, 180, 5000] {
            for tick in [0u64, 1, 719, 1439, 1440, 100_000] {
                let p = phase(tick, offset, DAY);
                assert!(p < DAY, "phase {p} outside the day for offset {offset}");
            }
        }
    }

    #[test]
    fn a_chronotype_offset_actually_moves_the_sim_on_the_curve() {
        // [ML-chrono]. One curve for everyone puts the whole household in
        // bed on the same tick, which reads as a screensaver. If the
        // offset stopped being applied, this is what would notice.
        let early = phase(600, -180, DAY);
        let owl = phase(600, 180, DAY);
        assert_ne!(early, owl);
        assert_eq!(early, 420);
        assert_eq!(owl, 780);
    }

    #[test]
    fn the_offset_wraps_a_night_owl_past_midnight() {
        // 23:00 plus three hours is 02:00 the next day, not 26:00.
        assert_eq!(phase(1380, 180, DAY), 120);
    }

    #[test]
    fn interpolation_is_linear_between_two_points() {
        let points = vec![(0, 0.0), (100, 1.0)];
        assert_eq!(curve_at(&points, 200, 0), 0.0);
        assert_eq!(curve_at(&points, 200, 50), 0.5);
        assert_eq!(curve_at(&points, 200, 100), 1.0);
    }

    /// A curve whose numbers are all off zero and all divide exactly.
    ///
    /// Every value below is a decimal an f32 holds without rounding, so
    /// the assertions can be `==` rather than a tolerance. A tolerance is
    /// what let the arithmetic in `curve_at` drift unwatched: the wrap
    /// test above passes with a span computed almost any way at all,
    /// because 0.05 is wider than most of the ways to get it wrong.
    ///
    /// Nothing here starts at tick zero or at value zero, and that is the
    /// point. With `a.0 == 0`, `phase - a.0` and `phase + a.0` are the
    /// same number; with `a.1 == 0`, so are `b.1 - a.1` and `b.1 + a.1`.
    /// A fixture anchored at the origin cannot see a sign flip.
    const OFF_ORIGIN: [(u32, f32); 2] = [(20, 0.5), (80, 2.0)];
    const OFF_ORIGIN_DAY: u32 = 100;

    #[test]
    fn the_interior_segment_interpolates_between_its_own_endpoints() {
        // Halfway from 20 to 80, so halfway from 0.5 to 2.0.
        assert_eq!(curve_at(&OFF_ORIGIN, OFF_ORIGIN_DAY, 50), 1.25);
        // And the endpoints themselves, exactly.
        assert_eq!(curve_at(&OFF_ORIGIN, OFF_ORIGIN_DAY, 20), 0.5);
        assert_eq!(curve_at(&OFF_ORIGIN, OFF_ORIGIN_DAY, 80), 2.0);
    }

    #[test]
    fn the_wrap_segment_spans_the_gap_at_both_ends_of_the_day() {
        // The wrap runs from 80 forward to 100, then from 0 to 20: a span
        // of 40 ticks, in two pieces. Both pieces are asserted, because
        // they are computed by different arithmetic - one counts up from
        // the last point, the other counts the leftover of the day and
        // then adds the phase - and a test on only one of them leaves the
        // other free.
        //
        // A quarter of the way in, on the far side of midnight:
        assert_eq!(curve_at(&OFF_ORIGIN, OFF_ORIGIN_DAY, 90), 1.625);
        // Three quarters of the way in, on the near side:
        assert_eq!(curve_at(&OFF_ORIGIN, OFF_ORIGIN_DAY, 10), 0.875);
    }

    #[test]
    fn a_curve_too_short_to_interpolate_is_answered_rather_than_indexed() {
        // `curve_at` is `pub` and takes a plain slice, so its signature
        // carries none of the compile step's guarantees. The empty guard
        // is what stops a caller that skipped [D9] from panicking on an
        // index instead of getting an answer.
        assert_eq!(curve_at(&[], DAY, 0), 1.0, "no curve means no effect");
        // One point has no guard and needs none: the wrap segment runs
        // from the point to itself, and a lerp between two equal values
        // is that value. Asserted at three phases, including the point's
        // own tick and the two sides of it, because "it happens to fall
        // out of the general path" is exactly the kind of claim that
        // stops being true quietly.
        assert_eq!(
            curve_at(&[(500, 0.3)], DAY, 0),
            0.3,
            "one point is that point at every hour, not just at its own"
        );
        assert_eq!(curve_at(&[(500, 0.3)], DAY, 500), 0.3);
        assert_eq!(curve_at(&[(500, 0.3)], DAY, DAY - 1), 0.3);
    }

    #[test]
    fn the_phase_survives_an_offset_of_more_than_two_days() {
        // `chronotype_offset_ticks` is a signed content number with no
        // authored range, so "three days early" is content rather than a
        // bug. One wrap of the modulo is not enough to bring that back
        // into the day, and a phase that stayed negative would come out
        // of the `as u32` as roughly four billion and index nothing.
        for offset in [-3000, -6000, 3000, 6000] {
            let p = phase(0, offset, DAY);
            assert!(p < DAY, "phase {p} outside the day for offset {offset}");
        }
        // 3000 ticks early from midnight is 2 days and 120 ticks early,
        // which is 22:00 the previous evening.
        assert_eq!(phase(0, -3000, DAY), 1320);
    }

    #[test]
    fn the_phase_is_defined_at_every_tick_the_clock_can_hold() {
        // The clock counts in `u64` and the offset is `i32`, so the tick
        // is reduced into the day BEFORE it is widened to a signed
        // integer. Without that reduction a tick past `i64::MAX` would
        // cast to a negative number, and the sim would run backwards
        // through the curve. Nothing reaches these ticks in play; the
        // reduction is here so that the function is total, and this is
        // the assertion that says so.
        for tick in [u64::MAX, u64::MAX - 1, i64::MAX as u64, 1 << 40] {
            let p = phase(tick, -180, DAY);
            assert!(p < DAY, "phase {p} outside the day at tick {tick}");
        }
    }

    #[test]
    fn only_a_candidate_carrying_the_sleep_tag_feels_the_rhythm() {
        // The tag is the whole targeting mechanism: one authored entry
        // covers every bed-shaped route to sleeping, and must cover
        // nothing else. Inverted, the drive would apply to eating,
        // showering and chatting instead - every sim in the house would
        // do its chores strictly at night and refuse to go to bed.
        let pack = crate::test_content::pack_with_circadian(
            Vec::new(),
            crate::test_content::tuning(),
            "sleep",
            vec![(0, 4.0), (720, 0.25)],
        );
        let midnight = SimClock { tick: 0 };
        assert_eq!(
            sleep_drive(pack, &midnight, 0, &["sleep".to_string()], 0),
            4.0,
            "the tagged candidate reads the curve"
        );
        assert_eq!(
            sleep_drive(pack, &midnight, 0, &[], 0),
            1.0,
            "an untagged candidate is untouched"
        );
        assert_eq!(
            sleep_drive(pack, &midnight, 0, &["eat".to_string()], 0),
            1.0,
            "and so is one carrying some OTHER tag"
        );
        assert_eq!(
            sleep_drive(pack, &midnight, 0, &["eat".into(), "sleep".into()], 0),
            4.0,
            "the tag counts wherever in the list it sits"
        );
    }

    #[test]
    fn the_drive_actually_changes_with_the_hour_and_with_the_chronotype() {
        // Without this, `sleep_drive` returning a constant is invisible:
        // every other assertion about it names one tick.
        let pack = crate::test_content::pack_with_circadian(
            Vec::new(),
            crate::test_content::tuning(),
            "sleep",
            vec![(0, 4.0), (720, 0.25)],
        );
        let tag = ["sleep".to_string()];
        let at_noon = sleep_drive(pack, &SimClock { tick: 720 }, 0, &tag, 0);
        let at_midnight = sleep_drive(pack, &SimClock { tick: 0 }, 0, &tag, 0);
        assert!(
            at_midnight > at_noon,
            "midnight {at_midnight} must beat noon {at_noon}"
        );
        // Same tick, two sims: the offset has to reach the curve, or the
        // household goes to bed in lockstep.
        let owl = sleep_drive(pack, &SimClock { tick: 360 }, 360, &tag, 0);
        let lark = sleep_drive(pack, &SimClock { tick: 360 }, -360, &tag, 0);
        assert_ne!(owl, lark, "the chronotype must move the sim on the curve");
    }

    #[test]
    fn the_drive_is_flat_when_the_pack_authored_no_rhythm() {
        // Every pack that predates this feature, and every test fixture
        // that does not care about sleep. The absence of a table must be
        // indistinguishable from the feature not existing.
        let pack = crate::test_content::pack(Vec::new());
        let clock = SimClock { tick: 0 };
        assert_eq!(
            sleep_drive(pack, &clock, 0, &["sleep".to_string()], 0),
            1.0,
            "no [circadian] table means no effect at all"
        );
    }

    /// Runs `accumulate_sleep_pressure` and NOTHING else, so what is
    /// asserted afterwards is what the accumulator did rather than what
    /// the rest of the tick did in response.
    ///
    /// The `ApplyDeferred` a schedule run ends with is what makes the
    /// system's `Commands` visible, so this is not the same as calling
    /// the function directly - the on-demand insert would be invisible.
    fn accumulate_only(sim: &mut crate::Sim) {
        let mut schedule = Schedule::default();
        schedule.add_systems(accumulate_sleep_pressure);
        schedule.run(sim.world_mut());
    }

    fn any_agent(sim: &mut crate::Sim) -> Entity {
        let mut state = sim.world_mut().query_filtered::<Entity, With<Agent>>();
        let found = state.iter(sim.world()).next();
        found.expect("the shipped lot has sims in it")
    }

    fn set_energy(sim: &mut crate::Sim, agent: Entity, level: f32) {
        sim.world_mut()
            .entity_mut(agent)
            .get_mut::<Needs>()
            .expect("every agent has needs")
            .set(NeedId::Energy, level);
    }

    fn pressure_of(sim: &crate::Sim, agent: Entity) -> Option<u32> {
        sim.world().get::<SleepPressure>(agent).map(|p| p.ticks)
    }

    /// **The counter has to actually count**, and nothing tested that.
    ///
    /// Everything else about the ramp is tested through `sleep_drive`,
    /// which takes the pressure as an argument - so the system that
    /// PRODUCES that number had no coverage at all. The sweep deleted its
    /// whole body, inverted its write-on-change check, and forced its
    /// insert guard both ways, and all five survived.
    #[test]
    fn a_sim_on_empty_accumulates_pressure_a_tick_at_a_time() {
        let mut sim = crate::Sim::new_from_shipped_lot();
        let agent = any_agent(&mut sim);
        let floor = sim
            .world()
            .resource::<Content>()
            .0
            .circadian
            .as_ref()
            .expect("the shipped pack authors a rhythm")
            .exhaustion_energy;

        // Rock bottom, which is what the accumulator is watching for.
        set_energy(&mut sim, agent, floor);

        accumulate_only(&mut sim);
        assert_eq!(
            pressure_of(&sim, agent),
            Some(1),
            "one tick on empty is one tick of pressure, and the component \
             is inserted on demand"
        );

        // The second run is the one with teeth: the component now EXISTS,
        // so this exercises the write-on-change branch rather than the
        // insert. A counter that only ever inserts looks correct after
        // one tick and is frozen forever after.
        accumulate_only(&mut sim);
        accumulate_only(&mut sim);
        assert_eq!(
            pressure_of(&sim, agent),
            Some(3),
            "the counter must keep climbing once the component exists"
        );

        // Above the line it resets, because exhaustion is a CONTINUOUS
        // stretch on empty rather than a lifetime total.
        set_energy(&mut sim, agent, floor + 1.0);
        accumulate_only(&mut sim);
        assert_eq!(
            pressure_of(&sim, agent),
            Some(0),
            "finding a coffee ends the stretch"
        );
    }

    /// A rested household carries no counters at all.
    ///
    /// The insert is on demand so that a save predating the ramp does not
    /// need one invented for everybody, and so an untired house does not
    /// pay a component per sim. An insert guard forced to `true` gives
    /// every sim a zero, which is invisible in every other assertion here
    /// because a zero and an absence mean the same thing to `sleep_drive`.
    #[test]
    fn a_rested_sim_is_given_no_counter_to_carry() {
        let mut sim = crate::Sim::new_from_shipped_lot();
        let agent = any_agent(&mut sim);
        set_energy(&mut sim, agent, 100.0);

        accumulate_only(&mut sim);
        accumulate_only(&mut sim);

        assert_eq!(
            pressure_of(&sim, agent),
            None,
            "a sim who was never on empty must not carry a counter"
        );
    }
}
