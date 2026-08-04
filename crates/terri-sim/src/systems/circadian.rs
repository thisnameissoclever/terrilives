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
/// The compile step guarantees at least two points, all strictly
/// ascending, all inside the day, and all finite and non-negative, so
/// none of that is re-checked here. That is [D9] paying for itself: the
/// validation lives once at the boundary and every reader downstream is
/// simpler for it.
pub fn curve_at(points: &[(u32, f32)], day_ticks: u32, phase: u32) -> f32 {
    debug_assert!(points.len() >= 2, "the compile step rejects a curve of one");
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
