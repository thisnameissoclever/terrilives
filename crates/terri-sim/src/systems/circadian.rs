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

use terri_core::clock::SimClock;
use terri_data::pack::ContentPack;

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
) -> f32 {
    let Some(circadian) = pack.circadian.as_ref() else {
        return 1.0;
    };
    // Untagged candidates are unaffected. One entry covers every
    // bed-shaped route to sleeping, because objects already carry tags -
    // exactly as one authored fear covers every couch.
    if !tags.iter().any(|tag| tag == &circadian.sleep_tag) {
        return 1.0;
    }
    let day_ticks = pack.tuning.day_ticks;
    curve_at(
        &circadian.sleep_drive,
        day_ticks,
        phase(clock.tick, offset_ticks, day_ticks),
    )
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
/// step's guarantee, and the two degenerate lengths are answered rather
/// than asserted: a curve of nothing is no curve at all, and a curve of
/// one point is that point everywhere. A `debug_assert` here would read
/// as a second guard for an invariant [D9] already owns, and would make
/// these two lines the only ones in the module no test could reach.
pub fn curve_at(points: &[(u32, f32)], day_ticks: u32, phase: u32) -> f32 {
    match points {
        [] => return 1.0,
        [(_, only)] => return *only,
        _ => {}
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
        // carries none of the compile step's guarantees. These two lines
        // are what stops a caller that skipped [D9] from panicking on an
        // index instead of getting an answer.
        assert_eq!(curve_at(&[], DAY, 0), 1.0, "no curve means no effect");
        assert_eq!(
            curve_at(&[(500, 0.3)], DAY, 0),
            0.3,
            "one point is that point at every hour, not just at its own"
        );
        assert_eq!(curve_at(&[(500, 0.3)], DAY, 500), 0.3);
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
            sleep_drive(pack, &midnight, 0, &["sleep".to_string()]),
            4.0,
            "the tagged candidate reads the curve"
        );
        assert_eq!(
            sleep_drive(pack, &midnight, 0, &[]),
            1.0,
            "an untagged candidate is untouched"
        );
        assert_eq!(
            sleep_drive(pack, &midnight, 0, &["eat".to_string()]),
            1.0,
            "and so is one carrying some OTHER tag"
        );
        assert_eq!(
            sleep_drive(pack, &midnight, 0, &["eat".into(), "sleep".into()]),
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
        let at_noon = sleep_drive(pack, &SimClock { tick: 720 }, 0, &tag);
        let at_midnight = sleep_drive(pack, &SimClock { tick: 0 }, 0, &tag);
        assert!(
            at_midnight > at_noon,
            "midnight {at_midnight} must beat noon {at_noon}"
        );
        // Same tick, two sims: the offset has to reach the curve, or the
        // household goes to bed in lockstep.
        let owl = sleep_drive(pack, &SimClock { tick: 360 }, 360, &tag);
        let lark = sleep_drive(pack, &SimClock { tick: 360 }, -360, &tag);
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
            sleep_drive(pack, &clock, 0, &["sleep".to_string()]),
            1.0,
            "no [circadian] table means no effect at all"
        );
    }
}
