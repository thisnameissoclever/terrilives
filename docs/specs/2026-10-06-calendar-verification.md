# Calendar verification

Status: implementation evidence for `2026-10-06-calendar.md`. Each guard-deletion row names a guard that was deleted, the tests that then failed, and the failing assertion, after which the source was restored byte for byte. The restore was proved by comparing `git hash-object` of the file before the deletion and after the restore.

## Contents

- [Shift tests](#shift-tests)
- [Guard deletions](#guard-deletions)

## Shift tests

The shift tests are in `crates/terri-sim/src/systems/career.rs`. They run on a 30-tick test day whose day 0 is a Monday, with careers that start a 6-tick shift at day-tick 3 unless a test says otherwise. Each test advances the clock with a counted loop and asserts the clock afterwards ([L-a-test-that-waits-must-be-bounded]). Departures are the ticks on which the worker goes from home to commuting or at work; the schedule owns those exact ticks. Pay and clock-in ticks depend on the walk to the door, so the tests observe them rather than predict them ([L-career-tests-follow-events-not-guessed-ticks]).

| Test | What it proves |
|---|---|
| `a_weekday_career_pays_five_times_in_seven_days_and_rests_on_the_weekend` | A Monday to Friday career departs on ticks 3, 33, 63, 93 and 123, pays five times, and the worker is neither commuting nor at work on any tick from 150 to 209 ([CAL-evidence] 3). |
| `a_sunday_only_career_pays_once_a_week` | A career working only `sun` departs on ticks 183 and 393 of two weeks and on no other day ([CAL-evidence] 3). |
| `a_shift_at_midnight_respects_the_weekday_of_the_new_day` | A shift starting at day-tick 0 does not depart on tick 150, the first tick of Saturday, and departs on tick 210, the first tick of Monday. |
| `a_shift_running_into_the_weekend_still_pays` | A Friday shift starting at day-tick 28 is still running at tick 149 and pays on Saturday, and no weekend shift follows. |
| `a_weekend_commute_loads_and_the_next_shift_waits_for_monday` | A Version 5 save written on Saturday as the worker walks home through the front door loads into a fresh world; the two worlds have equal world hashes and equal saved states on every tick to tick 268; no shift or pay happens before Monday's start at tick 238, and the worker departs on tick 238. |
| `first_weekday_six_moves_the_first_shift_to_day_two` | With `first_weekday` 6, day 0 is a Sunday and the Monday to Friday career first departs on tick 33. |
| `the_shift_fires_again_on_the_second_day` | Now uses the Monday to Friday career: days 1 and 2 are Monday and Tuesday and each pays. |

In the save test the source world is itself loaded once at tick 0 before it runs. Loading draws a self-preservation instinct from the random generator for any person without one, and the test's hand-built worker has none, so without that first load the two worlds differ by that draw rather than by anything the calendar does.

## Guard deletions

| Guard | Tests | Failing assertion | `git hash-object` before and after |
|---|---|---|---|
| The working-day gate in `start_shift` in `crates/terri-sim/src/systems/career.rs`, `&& works_today(career, &clock, &content.0.tuning)`, deleted | `a_weekday_career_pays_five_times_in_seven_days_and_rests_on_the_weekend`, `a_sunday_only_career_pays_once_a_week`, `a_shift_at_midnight_respects_the_weekday_of_the_new_day`, `a_shift_running_into_the_weekend_still_pays`, `a_weekend_commute_loads_and_the_next_shift_waits_for_monday`, `first_weekday_six_moves_the_first_shift_to_day_two` | `weekday 5 is a rest day, but the worker was away on tick 153`; `one shift on each Sunday and none on any other day`, left `[3, 33, 63, 93, 123, 153, 183, 213, 243, 273, 303, 333, 363, 393]`, right `[183, 393]`; `no departure on Saturday's first tick`; `no weekend shift after the return, tick 178`; `no shift before Monday's start, tick 187`; left `[3, 33]`, right `[33]` | `a27b2deff32643c9f14777490334397def233a4b`, unchanged |
| The bit shift in `CompiledCareer::works_on` in `crates/terri-data/src/pack.rs`, `self.working_days & (1 << weekday) != 0`, replaced by `self.working_days != 0` | `works_on_reads_the_monday_first_mask`, and the same six career tests as the row above | left `[0, 1, 2, 3, 4, 5, 6]`, right `[0, 2, 6]`; the career tests fail with the same messages as the row above | `342ad37934c9a4f3910236cab63af5b3ed0a8413`, unchanged |
| The `first_weekday` term in `terri_core::clock::weekday` in `crates/terri-core/src/clock.rs`, `+ first_weekday as u64`, deleted | `weekday_counts_whole_days_of_any_length`, `first_weekday_six_moves_the_first_shift_to_day_two` | `weekday(0, 1440, 6)` read left `0`, right `6`; departures left `[3, 33]`, right `[33]` | `a8ee4301e00f70d00b149de125021e1cf0faae53`, unchanged |
| The weekday range check in `CompiledCareer::works_on`, `weekday < terri_core::clock::WEEKDAY_COUNT &&`, deleted | `works_on_refuses_a_weekday_past_sunday` | `assertion failed: !career.works_on(7)`: a mask of `0xFF` read its eighth bit for weekday 7 | `342ad37934c9a4f3910236cab63af5b3ed0a8413`, unchanged |
| The reduction of the day index before the offset in `terri_core::clock::weekday`, `tick / day_ticks as u64 % week + first_weekday as u64`, replaced by `tick / day_ticks as u64 + first_weekday as u64` | `weekday_counts_whole_days_of_any_length` | `attempt to add with overflow` on `weekday(u64::MAX, 1, 6)` | `a8ee4301e00f70d00b149de125021e1cf0faae53`, unchanged |
