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
}
