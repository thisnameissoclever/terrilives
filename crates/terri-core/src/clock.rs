use bevy_ecs::prelude::Resource;

/// Simulation ticks per sim-hour. One tick is one sim-minute at 1x speed.
/// See ARCHITECTURE.md [D2]. Speed controls run MORE TICKS; they never
/// change dt, because variable dt would destroy determinism.
pub const TICKS_PER_SIM_HOUR: u64 = 60;

/// Ticks per real second at 1x speed.
pub const TICK_HZ: f64 = 10.0;

/// Days in a week. Weekday 0 is Monday and 6 is Sunday - [CAL-week] in
/// `docs/specs/2026-10-06-calendar.md`.
pub const WEEKDAY_COUNT: u8 = 7;

/// The weekday of the day `tick` falls in: 0 for Monday through 6 for
/// Sunday.
///
/// Day `d` is `tick / day_ticks`, the same day index the HUD shows as
/// "Day d + 1", and `first_weekday` names the weekday of day 0. Nothing
/// about the week is saved: the tick is already saved, and the weekday is
/// a pure function of it and content, so the simulation and the boundary
/// share this one definition rather than each deriving their own.
///
/// # Panics
///
/// Divides by `day_ticks`, so it panics if `day_ticks` is 0. The content
/// compiler rejects a zero-tick day, so a value read from a compiled
/// pack's tuning is never 0.
pub fn weekday(tick: u64, day_ticks: u32, first_weekday: u8) -> u8 {
    let week = WEEKDAY_COUNT as u64;
    // Reduced before the offset is added, so a one-tick day at the top of
    // the tick range cannot overflow.
    ((tick / day_ticks as u64 % week + first_weekday as u64) % week) as u8
}

/// Seasons in a year. Season 0 is Spring, 1 Summer, 2 Autumn and 3
/// Winter - [SEA-year] in `docs/specs/2026-10-17-seasons.md`.
pub const SEASON_COUNT: u8 = 4;

/// The season of the day `tick` falls in: 0 for Spring through 3 for
/// Winter.
///
/// Day `d` is `tick / day_ticks`, the day index [`weekday`] reads. Each
/// season lasts `days_per_season` days, and `first_season` names the
/// season of day 0, so the season is
/// `(d / days_per_season + first_season) % 4`. Like the weekday, nothing
/// about it is saved: it is a pure function of the saved tick and content,
/// so the boundary, and any simulation rule that later reads the season,
/// share this one definition.
///
/// # Panics
///
/// Divides by `day_ticks` and by `days_per_season`, so it panics if either
/// is 0. The content compiler refuses both, so values read from a compiled
/// pack's tuning are never 0.
pub fn season(tick: u64, day_ticks: u32, days_per_season: u32, first_season: u8) -> u8 {
    let year = SEASON_COUNT as u64;
    let day = tick / day_ticks as u64;
    // Reduced before the offset is added, so a one-tick day at the top of
    // the tick range cannot overflow, as in `weekday`.
    ((day / days_per_season as u64 % year + first_season as u64) % year) as u8
}

/// The billing month of the day `tick` falls in, counted from 0 -
/// [WB-calendar] in `docs/specs/2026-10-18-wages-and-bills.md`.
///
/// Day `d` is `tick / day_ticks`, the day index [`weekday`] reads, and each
/// month lasts `days_per_month` days, so the month is `d / days_per_month`.
/// Nothing about the month is saved: like the weekday and the season it is
/// a pure function of the saved tick and content. The day index is reduced
/// first and only divided, so the top of the tick range cannot overflow.
///
/// # Panics
///
/// Divides by `day_ticks` and by `days_per_month`, so it panics if either
/// is 0. The content compiler refuses both.
pub fn month(tick: u64, day_ticks: u32, days_per_month: u32) -> u64 {
    tick / day_ticks as u64 / days_per_month as u64
}

/// The day of the month the day `tick` falls in, from 1 to
/// `days_per_month` - [WB-calendar]. Day 1 is the first day of a month,
/// when the month just ended is billed.
///
/// # Panics
///
/// As [`month`].
pub fn day_of_month(tick: u64, day_ticks: u32, days_per_month: u32) -> u32 {
    // The remainder is below `days_per_month`, a u32, so the cast and the
    // addition cannot overflow.
    (tick / day_ticks as u64 % days_per_month as u64) as u32 + 1
}

#[derive(Resource, Default, Debug, Clone, Copy, PartialEq, Eq)]
pub struct SimClock {
    pub tick: u64,
}

impl SimClock {
    pub fn advance(&mut self) {
        self.tick += 1;
    }

    pub fn sim_minutes(&self) -> u64 {
        self.tick
    }

    pub fn sim_hours(&self) -> u64 {
        self.tick / TICKS_PER_SIM_HOUR
    }

    /// True on the tick that begins a new sim-hour. Tier 2 story
    /// progression will hang off this later.
    pub fn is_hour_boundary(&self) -> bool {
        self.tick.is_multiple_of(TICKS_PER_SIM_HOUR)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sixty_ticks_is_one_sim_hour() {
        let mut clock = SimClock::default();
        for _ in 0..60 {
            clock.advance();
        }
        assert_eq!(clock.sim_minutes(), 60);
        assert_eq!(clock.sim_hours(), 1);
    }

    #[test]
    fn clock_starts_at_zero() {
        let clock = SimClock::default();
        assert_eq!(clock.tick, 0);
        assert_eq!(clock.sim_hours(), 0);
    }

    #[test]
    fn hour_boundary_is_true_only_on_multiples_of_the_sim_hour() {
        // Nothing consumes `is_hour_boundary` yet - [D3]'s Tier 2 story
        // progression is the first thing that will - so until this test
        // existed, replacing the whole function with a constant `true`
        // or a constant `false` left the entire workspace green. Both
        // were surviving mutants for five milestones on that basis.
        //
        // Tick 0 IS a boundary, because tick 0 begins sim-hour 0. That
        // is deliberate rather than an off-by-one, and it is the half a
        // reader is most likely to "correct", so it is asserted first
        // and by itself.
        //
        // What this does NOT pin is the calling convention: whether a
        // consumer should ask before or after `advance()`. That is
        // undecidable without a consumer, and whichever task adds the
        // first one owes a test for it.
        let mut clock = SimClock::default();
        assert!(clock.is_hour_boundary(), "tick 0 begins sim-hour 0");

        clock.advance();
        assert!(!clock.is_hour_boundary(), "tick 1 is inside sim-hour 0");

        while clock.tick < TICKS_PER_SIM_HOUR {
            clock.advance();
        }
        assert_eq!(clock.tick, TICKS_PER_SIM_HOUR);
        assert!(clock.is_hour_boundary(), "tick 60 begins sim-hour 1");

        clock.advance();
        assert!(!clock.is_hour_boundary(), "tick 61 is inside sim-hour 1");
    }

    /// [CAL-week]: the weekday at both edges of a day, for both ends of the
    /// `first_weekday` range, and for a day length other than 1440, so a
    /// hardcoded day or a dropped offset moves an assertion. The last line
    /// pins that the largest tick neither overflows nor panics.
    #[test]
    fn weekday_counts_whole_days_of_any_length() {
        assert_eq!(weekday(0, 1440, 0), 0);
        assert_eq!(weekday(1439, 1440, 0), 0);
        assert_eq!(weekday(1440, 1440, 0), 1);
        assert_eq!(weekday(1440 * 6, 1440, 0), 6);
        assert_eq!(weekday(1440 * 7, 1440, 0), 0);
        assert_eq!(weekday(0, 1440, 6), 6);
        assert_eq!(weekday(1440, 1440, 6), 0);
        assert_eq!(weekday(99, 100, 0), 0);
        assert_eq!(weekday(100, 100, 0), 1);
        // u64::MAX / 1440 is 12810238940076077, and that plus 3 is
        // 6 mod 7.
        assert_eq!(weekday(u64::MAX, 1440, 3), 6);
        // A one-tick day at the top of the range: u64::MAX is 1 mod 7, and
        // 1 plus 6 is 0 mod 7. Adding the offset before the modulo would
        // overflow.
        assert_eq!(weekday(u64::MAX, 1, 6), 0);
    }

    /// [SEA-year]: the shipped year is four seven-day seasons from Spring.
    /// Both edges of every season boundary in the first year, and the turn
    /// into the second year, so a dropped division, a hardcoded season
    /// length or an off-by-one moves an assertion.
    #[test]
    fn season_counts_whole_seasons_of_seven_days_from_spring() {
        let day = 1440u64;
        for (season_index, first_day) in [(0u8, 0u64), (1, 7), (2, 14), (3, 21)] {
            assert_eq!(season(first_day * day, 1440, 7, 0), season_index);
            assert_eq!(
                season((first_day + 7) * day - 1, 1440, 7, 0),
                season_index,
                "the last tick of season {season_index}"
            );
        }
        assert_eq!(season(28 * day, 1440, 7, 0), 0, "day 29 is Spring again");
    }

    /// [SEA-year]: `first_season` 3 starts the year in Winter and wraps to
    /// Spring after one season; a one-day season changes every day; and a
    /// day length other than 1440 counts its own days.
    #[test]
    fn season_applies_the_offset_and_any_season_or_day_length() {
        let day = 1440u64;
        assert_eq!(season(0, 1440, 7, 3), 3);
        assert_eq!(season(7 * day - 1, 1440, 7, 3), 3);
        assert_eq!(season(7 * day, 1440, 7, 3), 0);
        assert_eq!(season(21 * day, 1440, 7, 3), 2);
        assert_eq!(season(28 * day, 1440, 7, 3), 3);
        // One-day seasons: the season is the day index, wrapped.
        for d in 0..9u64 {
            assert_eq!(season(d * day, 1440, 1, 0), (d % 4) as u8, "day index {d}");
            assert_eq!(season(d * day + 1439, 1440, 1, 3), ((d + 3) % 4) as u8);
        }
        // A 100-tick day: tick 699 is the last of day index 6, tick 700
        // the first of day index 7, the first day of Summer.
        assert_eq!(season(699, 100, 7, 0), 0);
        assert_eq!(season(700, 100, 7, 0), 1);
    }

    /// [SEA-year]: the largest tick neither overflows nor panics.
    #[test]
    fn season_is_defined_at_the_top_of_the_tick_range() {
        // u64::MAX / 1440 is 12810238940076077; divided by 7 that is
        // 1830034134296582, which is 2 mod 4, and 2 plus 3 is 1 mod 4.
        assert_eq!(season(u64::MAX, 1440, 7, 3), 1);
        // A one-tick day and a one-day season: u64::MAX is 3 mod 4, and 3
        // plus 3 is 2 mod 4. Adding the offset before the modulo would
        // overflow.
        assert_eq!(season(u64::MAX, 1, 1, 3), 2);
        // The longest season: u64::MAX / u32::MAX is 2^32 + 1, which is 1
        // mod 4.
        assert_eq!(season(u64::MAX, 1, u32::MAX, 0), 1);
    }

    /// [WB-calendar]: tick 0 is the first day of month 0, and the first tick
    /// of a day and its last both belong to that day's month.
    #[test]
    fn month_and_day_of_month_at_the_start_of_a_game() {
        assert_eq!(month(0, 1440, 7), 0);
        assert_eq!(day_of_month(0, 1440, 7), 1);
        assert_eq!(month(1439, 1440, 7), 0);
        assert_eq!(day_of_month(1439, 1440, 7), 1);
        assert_eq!(day_of_month(1440, 1440, 7), 2);
    }

    /// [WB-calendar]: with 1440-tick days and seven-day months, day index 6
    /// is day 7 of month 0 and day index 7 is day 1 of month 1. A month
    /// length other than seven and a day length other than 1440 count their
    /// own units, so a hardcoded week or day moves an assertion.
    #[test]
    fn the_last_day_of_a_month_and_the_first_of_the_next() {
        let day = 1440u64;
        assert_eq!(month(7 * day - 1, 1440, 7), 0);
        assert_eq!(day_of_month(7 * day - 1, 1440, 7), 7);
        assert_eq!(month(7 * day, 1440, 7), 1);
        assert_eq!(day_of_month(7 * day, 1440, 7), 1);
        assert_eq!(month(20 * day, 1440, 7), 2);
        assert_eq!(day_of_month(20 * day, 1440, 7), 7);
        assert_eq!(month(30 * day, 1440, 28), 1);
        assert_eq!(day_of_month(30 * day, 1440, 28), 3);
        assert_eq!(month(699, 100, 7), 0);
        assert_eq!(month(700, 100, 7), 1);
        assert_eq!(day_of_month(700, 100, 7), 1);
        // One-day months: every day is the first of its month.
        for d in 0..5u64 {
            assert_eq!(month(d * day, 1440, 1), d);
            assert_eq!(day_of_month(d * day + 1439, 1440, 1), 1);
        }
    }

    /// [WB-calendar]: the largest tick neither overflows nor panics.
    #[test]
    fn month_reduces_before_dividing_at_the_top_of_the_tick_range() {
        // A one-tick day: the day index is u64::MAX, which is 15 mod 16 and
        // 0 mod 5 (u64::MAX = 3 * 5 * 17 * 257 * 641 * 65537 * 6700417).
        assert_eq!(month(u64::MAX, 1, 16), u64::MAX / 16);
        assert_eq!(day_of_month(u64::MAX, 1, 16), 16);
        assert_eq!(day_of_month(u64::MAX, 1, 5), 1);
        // u64::MAX / 1440 is 12810238940076077, which is 3 mod 7.
        assert_eq!(day_of_month(u64::MAX, 1440, 7), 4);
        assert_eq!(month(u64::MAX, 1440, 7), 12810238940076077 / 7);
        // The longest month: u64::MAX / u32::MAX is 2^32 + 1.
        assert_eq!(month(u64::MAX, 1, u32::MAX), (1u64 << 32) + 1);
        assert_eq!(day_of_month(u64::MAX, 1, u32::MAX), 1);
    }

    /// [WB-calendar]: with the shipped seven-day months and Monday as day
    /// 0, the first day of every month is a Monday, so bills arrive every
    /// Monday; any other day of a month is not.
    #[test]
    fn a_seven_day_month_starts_on_the_first_weekday() {
        let day = 1440u64;
        for d in 0..=70u64 {
            let tick = d * day;
            let first = day_of_month(tick, 1440, 7) == 1;
            assert_eq!(first, weekday(tick, 1440, 0) == 0, "day index {d}");
        }
    }
}
