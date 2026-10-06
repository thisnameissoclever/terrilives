# Calendar verification

Status: implementation evidence for `2026-10-06-calendar.md`. Each guard-deletion row names a guard that was deleted, the tests that then failed, and the failing assertion, after which the source was restored byte for byte. The restore was proved by comparing `git hash-object` of the file before the deletion and after the restore.

## Contents

- [Shift tests](#shift-tests)
- [Guard deletions](#guard-deletions)
- [Boundary and HUD tests](#boundary-and-hud-tests)
- [Displayed browser](#displayed-browser)
- [Delivery](#delivery)

## Shift tests

Recorded on 2026-10-06 on branch `twcl/calendar`. The shift tests and the first five guard-deletion rows were run on the working tree that was committed as `63e3142b`. The shipped-lot test, the stricter weekend check in `a_shift_running_into_the_weekend_still_pays`, and the last two guard-deletion rows were run on `ddd2d3c5` with the fix that follows it applied, before that fix was committed. Each guard row's `git hash-object` value identifies the exact file it was run against.

The shift tests are in `crates/terri-sim/src/systems/career.rs`. They run on a 30-tick test day whose day 0 is a Monday, with careers that start a 6-tick shift at day-tick 3 unless a test says otherwise. Each test advances the clock with a counted loop and asserts the clock afterwards ([L-a-test-that-waits-must-be-bounded]). Departures are the ticks on which the worker goes from home to commuting or at work; the schedule owns those exact ticks. Pay and clock-in ticks depend on the walk to the door, so the tests observe them rather than predict them ([L-career-tests-follow-events-not-guessed-ticks]).

| Test | What it proves |
|---|---|
| `a_weekday_career_pays_five_times_in_seven_days_and_rests_on_the_weekend` | A Monday to Friday career departs on ticks 3, 33, 63, 93 and 123, pays five times, and the worker is neither commuting nor at work on any tick from 150 to 209 ([CAL-evidence] 3). |
| `a_sunday_only_career_pays_once_a_week` | A career working only `sun` departs on ticks 183 and 393 of two weeks and on no other day ([CAL-evidence] 3). |
| `a_shift_at_midnight_respects_the_weekday_of_the_new_day` | A shift starting at day-tick 0 does not depart on tick 150, the first tick of Saturday, and departs on tick 210, the first tick of Monday. |
| `a_shift_running_into_the_weekend_still_pays` | A Friday shift starting at day-tick 28 is still running at tick 149 and pays on Saturday, and the worker does not depart on any tick from 150 to 209. |
| `a_weekend_commute_loads_and_the_next_shift_waits_for_monday` | A Version 5 save written on Saturday as the worker walks home through the front door loads into a fresh world; the two worlds have equal world hashes and equal saved states on every tick to tick 268; no shift or pay happens before Monday's start at tick 238, and the worker departs on tick 238. |
| `first_weekday_six_moves_the_first_shift_to_day_two` | With `first_weekday` 6, day one (day index 0) is a Sunday and the Monday to Friday career first departs on day two, at tick 33. |
| `the_shift_fires_again_on_the_second_day` | Now uses the Monday to Friday career: days 1 and 2 are Monday and Tuesday and each pays. |
| `the_shipped_worker_leaves_on_day_one_and_stays_home_on_day_six` | On `Sim::new_from_shipped_lot()`, with the shipped 1440-tick day, the employed Sim leaves no earlier than the shift start and is observed commuting or at work during day 1, the shift pays before day 1 ends, Friday's shift is over at tick 7199, and on every tick of day 6 (ticks 7200 to 8639, a Saturday) the worker is neither commuting nor at work and the household's money does not change ([CAL-evidence] 3). |

In the save test the source world is itself loaded once at tick 0 before it runs. Loading draws a self-preservation instinct from the random generator for any person without one, and the test's hand-built worker has none, so without that first load the two worlds differ by that draw rather than by anything the calendar does.

## Guard deletions

| Guard | Tests | Failing assertion | `git hash-object` before and after |
|---|---|---|---|
| The working-day gate in `start_shift` in `crates/terri-sim/src/systems/career.rs`, `&& works_today(career, &clock, &content.0.tuning)`, deleted | `a_weekday_career_pays_five_times_in_seven_days_and_rests_on_the_weekend`, `a_sunday_only_career_pays_once_a_week`, `a_shift_at_midnight_respects_the_weekday_of_the_new_day`, `a_shift_running_into_the_weekend_still_pays`, `a_weekend_commute_loads_and_the_next_shift_waits_for_monday`, `first_weekday_six_moves_the_first_shift_to_day_two` | `weekday 5 is a rest day, but the worker was away on tick 153`; `one shift on each Sunday and none on any other day`, left `[3, 33, 63, 93, 123, 153, 183, 213, 243, 273, 303, 333, 363, 393]`, right `[183, 393]`; `no departure on Saturday's first tick`; `no weekend shift after the return, tick 178`; `no shift before Monday's start, tick 187`; left `[3, 33]`, right `[33]` | `a27b2deff32643c9f14777490334397def233a4b`, unchanged |
| The bit shift in `CompiledCareer::works_on` in `crates/terri-data/src/pack.rs`, `self.working_days & (1 << weekday) != 0`, replaced by `self.working_days != 0` | `works_on_reads_the_monday_first_mask`, and the same six career tests as the row above | left `[0, 1, 2, 3, 4, 5, 6]`, right `[0, 2, 6]`; the career tests fail with the same messages as the row above | `342ad37934c9a4f3910236cab63af5b3ed0a8413`, unchanged |
| The `first_weekday` term in `terri_core::clock::weekday` in `crates/terri-core/src/clock.rs`, `+ first_weekday as u64`, deleted | `weekday_counts_whole_days_of_any_length`, `first_weekday_six_moves_the_first_shift_to_day_two` | `weekday(0, 1440, 6)` read left `0`, right `6`; departures left `[3, 33]`, right `[33]` | `a8ee4301e00f70d00b149de125021e1cf0faae53`, unchanged |
| The weekday range check in `CompiledCareer::works_on`, `weekday < terri_core::clock::WEEKDAY_COUNT &&`, deleted | `works_on_refuses_a_weekday_past_sunday` | `assertion failed: !career.works_on(7)`: a mask of `0xFF` read its eighth bit for weekday 7 | `342ad37934c9a4f3910236cab63af5b3ed0a8413`, unchanged |
| The reduction of the day index before the offset in `terri_core::clock::weekday`, `tick / day_ticks as u64 % week + first_weekday as u64`, replaced by `tick / day_ticks as u64 + first_weekday as u64` | `weekday_counts_whole_days_of_any_length` | `attempt to add with overflow` on `weekday(u64::MAX, 1, 6)` | `a8ee4301e00f70d00b149de125021e1cf0faae53`, unchanged |
| The working-day gate in `start_shift`, `&& works_today(career, &clock, &content.0.tuning)`, deleted | `the_shipped_worker_leaves_on_day_one_and_stays_home_on_day_six` | `the worker stays home on Saturday, tick 7560`: the shipped job's 06:00 shift started on day 6 | `d651460a1c0372e23ff9d8370bc8b054a9763967`, unchanged |
| The same gate | `a_shift_running_into_the_weekend_still_pays` | `no departure on the weekend, tick 178` | `d651460a1c0372e23ff9d8370bc8b054a9763967`, unchanged |

## Boundary and HUD tests

These tests cover [CAL-evidence] item 5. The wasm boundary tests are in `crates/terri-wasm/src/calendar_boundary_tests.rs` and ran in both the debug and the release profile (`cargo test -p terri-wasm --release calendar_boundary`).

| Test | What it proves |
|---|---|
| `weekday_index_starts_on_monday_and_turns_over_with_the_day` | On the shipped lot `weekday_index` is 0 at tick 0 and still 0 after `day_ticks - 1` real ticks; one more tick makes it 1. |
| `weekday_index_reaches_sunday_and_wraps_to_monday` | With the clock set directly, the first and last ticks of day 7 read 6 and the first tick of day 8 reads 0; `u64::MAX` reads what `terri_core::clock::weekday` returns; the read leaves the save bytes unchanged. |
| `career_schedule_of_reports_working_days_and_hours` | Tim's schedule is `[31, 360, 480]`, the same three numbers as the compiled office job; Bill, who has no job, reads `[]`; the reads leave the save bytes and the world hash unchanged. |
| `career_schedule_of_rejects_non_people_in_release` | Index 0, a placed object, `u32::MAX` and `u32::MAX - 1` all read `[]`, and the save bytes and world hash are unchanged. |

The web tests are in `web/tests/game-hud.test.ts` and `web/tests/bridge.test.ts`. `formatSimTime(0, 1440, 0)` is `Day 1, Monday, 00:00`, `formatSimTime(1440 * 6, 1440, 6)` is `Day 7, Sunday, 00:00`, and a weekday of -1, 7, 1.5, NaN or infinity gives `Day and time unavailable`. The clock prints the weekday it is given rather than counting one from the day number, so `formatSimTime(1440 * 6, 1440, 5)` is `Day 7, Saturday, 00:00`. `formatCareerSchedule` gives `Office clerk, Monday to Friday, 06:00 to 14:00` for mask 31, `Office clerk, Monday, Sunday, 06:00 to 14:00` for `0b1000001`, `every day` for all seven days, a single day name for one day, and the label alone for a missing or malformed schedule. A shift past midnight ends on the next day's time, for example `22:00 to 06:00`. The assembled HUD shows the clock and the Career row together, asks for a schedule only for the selected person, and reads the tick and the weekday once per refresh. The bridge test reads weekday 0 and Tim's schedule through the release wasm artifact, and returns null for an object, a negative, fractional, NaN or out-of-range index.

## Displayed browser

Code checked: the working tree of `twcl/calendar` on top of `63e3142b`, with this task's changes, before they were committed. The bundle `assets/index-BwR1pszi.js` was built with `npm run build` after `wasm-pack build crates/terri-wasm --target web --out-dir ../../web/src/wasm`, and served with `npx vite preview --port 4173 --strictPort` from `web/` at `https://localhost:4173/`.

The in-app browser pane loaded the bundle but was hidden and delivered no animation frames in two seconds, so the check used the Playwright plugin's Chromium (Chrome 154 on Windows, with `navigator.gpu` present), which ran 58 frames a second. Sound was muted before the game ran by setting `terrilives.audio-preferences.v1` to `{"version":1,"muted":true,"effectsLevel":0,"voicesLevel":0}` and reloading; the Options flyout showed `Sound: off`. The first-run Help was already dismissed in that browser profile.

That profile held another session's saved household (3488 bytes, SHA-256 `1b47dbca...2a3eec`). It was copied to a backup file in the same browser storage, `New game` then `Start over` gave the shipped lot, and after the check the backup was written back over the save, compared byte for byte and found equal, with the same SHA-256, and the backup removed. The page was closed on Day 1 at 12:17, before the next day's autosave.

Tim was selected and Sim details opened on Overview.

1. [Desktop, 1280 by 800](../assets/review-evidence/calendar/desktop-clock.png): the clock reads `Day 1, Monday, 03:02` and the Career row reads `Office clerk, Monday to Friday, 06:00 to 14:00`.
2. [Phone, 375 by 812](../assets/review-evidence/calendar/phone-clock.png): the clock reads `Day 1, Monday, 10:03`, Tim's activity reads `At work`, and the Career row shows the same text on one line. The document's scroll width equalled its 375-pixel client width.

The clock wraps inside the household panel without overflowing it or splitting a word. Measured by setting the clock text in place: on desktop, where the panel is 144 pixels wide, `Day 1, Monday, 00:00` takes two lines and `Day 13, Wednesday, 23:59` three; on the phone viewport the panel is wider, and they take one and two lines. The panel therefore grows by one line on the days with longer names.

Console, across the three page loads: 57 entries, all periodic frame-timing logs except one error, the 404 for `favicon.ico`. No warnings.

Cleanup: the viewport was reset to 1280 by 800, the Playwright page was closed, the in-app pane's only tab was closed, the preview server was stopped, and `Get-NetTCPConnection -LocalPort 4173 -State Listen` then returned nothing.

Not checked: a weekend day in the browser (the shift tests and the boundary tests cover it); a physical phone; the phone check used a resized desktop viewport without a mobile user agent or touch input; light and dark theme variants.

## Delivery

The implementation and this record are on branch `twcl/calendar`. Push, merge and deployment are recorded separately in the delivery report.
