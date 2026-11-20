# Late book returns: verification record

Evidence for [late book returns and floor books](2026-11-19-late-book-returns.md), measured on 2026-11-17 and 2026-11-19 on the branch `twcl/late-departure-cap`, built on main at `e31afe285`. Machine: Windows 11, `CARGO_BUILD_JOBS=2`, release builds of the trace example. Logs are in the task's untracked log directory, named below.

## Contents

1. [Late departures before the change](#before-late-departures-before-the-change)
2. [The traced cause](#cause-the-traced-cause)
3. [Tests that failed first](#red-tests-that-failed-first)
4. [Targeted mutation checks](#mutations-targeted-mutation-checks)
5. [Pinned values](#pins-pinned-values)
6. [Trace figures after the change](#after-trace-figures-after-the-change)
7. [Open items](#open-open-items)

## [before] Late departures before the change

`cargo run --release -p terri-sim --example trace -- <ticks> [seed]` on main at `e31afe285`, one week (10080 ticks) on the default seed and seeds 1, 2, 3, 11, 22 and 33, and four weeks on the default seed (logs `trace-before-*.log`). The trace now prints a LATE DEPARTURE line for each late departure, with the minutes after the start and whether Hunger or Energy was critical at the start.

| Run | Late departures | With nothing critical at the start, longest | Over 60 minutes |
| --- | --- | --- | --- |
| One week, default seed | 3 | 25 | 0 |
| One week, seed 1 | 7 | 2 | 0 |
| One week, seed 2 | 2 | 25 | 0 |
| One week, seed 3 | 5 | 23 | 0 |
| One week, seed 11 | 6 | 66 (Casey, shift at tick 9960) | 1 |
| One week, seed 22 | 2 | 45 | 0 |
| One week, seed 33 | 5 | 14 | 0 |
| Four weeks, default seed | 12 | 45 | 0 |

Every departure with Hunger or Energy critical at the start left at most 60 minutes after it. The only departure past the limit was Casey's in seed 11.

## [cause] The traced cause

`TRACE_LATE_TICKS=1 TRACE_LATE_START=9960 trace 10080 11` (log `trace-before-seed-11-late-9960.log`) lists Casey's state on each late tick. Nothing was critical at the start (Hunger 20.9, Energy 66.8, Bladder 77.7; the critical level is 20). She was on a reading journey in the `Return` stage with a path to the bookshelf from tick 9961, walking from (10.25, 8.0) to the contact at (9, 0) at a quarter tile per tick, reached it at minute 61, shelved for four ticks and left at minute 66. Hunger reached 20.0 at minute 30, which would have kept her home only until minute 60. She had no order queued, was never blocked and nobody else held the contact, so this is not issue 339.

The code: `attendance::start_tick` sent a person on a reading journey to `reading::request_return` and skipped departure, before the lateness check, with no limit. The other long departures with nothing critical were traced the same way and were all book returns inside the hour: Tim at seed 11 tick 1800 (45 minutes), Bill at seed 22 tick 6600 (45), Casey at four weeks tick 24360 (45) and Tim at four weeks tick 13320 (25) (logs `trace-before-*-late-*.log`).

## [red] Tests that failed first

The tests in `crates/terri-sim/src/reading/tests/floor.rs` were run against the implementation with the cap predicate forced false and both floor systems returning at once (log `mutation-RED.log`):

| Test | Result with the stub |
| --- | --- |
| `a_reader_still_returning_at_the_limit_leaves_the_book_and_departs_at_the_limit` | failed |
| `the_book_is_still_in_hand_one_tick_before_the_limit` | failed |
| `an_idle_housemate_shelves_a_floor_book` | failed |
| `two_idle_housemates_never_race_for_one_floor_book` | failed |
| `a_sleeping_working_or_busy_housemate_never_picks_up_a_floor_book` | failed |
| `a_floor_book_with_no_home_is_given_a_slot_and_shelved` | failed |
| `a_book_dropped_by_a_death_is_shelved_by_a_housemate` | failed |
| `a_save_mid_walk_and_mid_return_continues_identically` | failed |
| `a_return_inside_the_limit_shelves_the_book_before_leaving` | passed, a guard of the old behavior |
| `a_limit_of_zero_keeps_the_book_return_unbounded` | passed, a guard of the old behavior |

`a_crisis_or_an_open_shift_comes_before_a_floor_book` and `a_reader_cut_off_mid_reading_keeps_the_satisfaction_earned` were added after the first mutation pass, because mutations M11, M12 and M13 below first survived; each fails under its mutation. The manual release test `seed_11_casey_leaves_at_the_limit_and_her_book_is_shelved` fails with the cap forced false (log `mutation-RED11.log`) and passes with it: Casey leaves at tick 10020, the start plus 60, and her book is back on its shelf at tick 10082 (log `green-seed11.log`).

The first version of the floor claim waited for selection to leave a housemate idle (`Restless`). The seed 11 test then failed: in a whole day after Casey left, nobody in the shipped household was idle on any tick, so the book stayed on the floor. The claim now runs directly before selection for a housemate between activities with no need critical; that is the rule in the spec.

## [mutations] Targeted mutation checks

`docs/testing-protocol.md` section 1. Each mutation was applied by a script that hashed each file with `git hash-object` first, ran the floor tests, wrote the file back and compared the hash; every file matched (`mutation-results.jsonl`, `mutation-<id>.log`). Each ran alone.

| Id | File | Mutation | Tests that failed |
| --- | --- | --- | --- |
| M1 | `lateness.rs` | the cap starts one tick late (`>=` made `>`) | `a_reader_still_returning_at_the_limit_...`, `the_book_is_still_in_hand_one_tick_before_the_limit` |
| M2 | `lateness.rs` | a limit of 0 caps too | `a_limit_of_zero_keeps_the_book_return_unbounded` |
| M3 | `attendance.rs` | the cap call replaced by the old return request | `a_reader_still_returning_at_the_limit_...`, `the_book_is_still_in_hand_...` |
| M4 | `reading/floor.rs` | the book is not put down at the cap | the same two |
| M5 | `reading/floor.rs` | a claimed book is offered again | `two_idle_housemates_never_race_for_one_floor_book` |
| M6 | `reading/floor.rs` | a claim is not recorded within the pass | `two_idle_housemates_never_race_for_one_floor_book` |
| M7 | `reading/floor.rs` | a sleeper counts as free | `a_sleeping_working_or_busy_housemate_...` |
| M8 | `reading/floor.rs` | a worker at work counts as free | `a_sleeping_working_or_busy_housemate_...` |
| M9 | `books/domain.rs` | a floor book with no home is not given a slot | `a_floor_book_with_no_home_is_given_a_slot_and_shelved` |
| M10 | `reading/floor.rs` | nobody picks up a book on arrival | `a_sleeping_working_or_busy_housemate_...` |
| M11 | `reading/floor.rs` | a critical need does not come first | `a_crisis_or_an_open_shift_comes_before_a_floor_book` |
| M12 | `reading/floor.rs` | an open shift does not come first | `a_crisis_or_an_open_shift_comes_before_a_floor_book` |
| M13 | `reading/floor.rs` | the cap skips the return request | survived the first pass; `a_reader_cut_off_mid_reading_keeps_the_satisfaction_earned` fails (M13b) |

## [pins] Pinned values

No pinned value moved. The shipped household's pins run for at most twenty days on the default seed, where nobody is still returning a book at the limit and no book is ever on the floor, so the cap and the floor rules do nothing and the worlds are identical. Checked on this tree: `SHIPPED_THURSDAY`, `STANDARD_ONLY_HASH`, the two-day activity-log fold and its work-knob guard, `GOLDEN` in `lib.rs` (whose web twin in `web/tests/bridge.test.ts` therefore stands) in the debug suite (`sim-suite-1.log`: 2166 passed, 4 ignored), and the twenty-day fold and its work-knob guard in the manual release tests (`release-ignored-1.log`, 3 passed). No tuning field and no saved field was added, so the appended-field rules and the inherited runtime fixture are untouched.

## [after] Trace figures after the change

The same runs on this tree (logs `trace-after-*.log`). A run whose world never reaches the cap or a floor book ends with the same world hash as before, which seven of the eight did.

| Run | Late departures | Longest, any cause | Over 60 minutes | Books left on the floor | World hash |
| --- | --- | --- | --- | --- | --- |
| One week, default seed | 3 | 60 | 0 | 0 | unchanged |
| One week, seed 1 | 7 | 60 | 0 | 0 | unchanged |
| One week, seed 2 | 2 | 25 | 0 | 0 | unchanged |
| One week, seed 3 | 5 | 60 | 0 | 0 | unchanged |
| One week, seed 11 | 6 | 60 | 0 | 1 | changed from tick 10020 |
| One week, seed 22 | 2 | 45 | 0 | 0 | unchanged |
| One week, seed 33 | 5 | 60 | 0 | 0 | unchanged |
| Four weeks, default seed | 12 | 60 | 0 | 0 | unchanged |

Every 60-minute departure other than Casey's in seed 11 is a start with Hunger or Energy critical, as before. Casey now leaves 60 minutes after the start with her book on the floor. The one-week run ends at tick 10080, while the book is being carried back; the same seed run to tick 10200 (`trace-after-seed-11-10200.log`) reports the book back on its shelf 62 minutes after it was left.

## [open] Open items

1. **A walk to a floor book looks like a stroll.** The activity shown while a housemate walks to a book on the floor is the one a stroll shows; once they pick it up they show the ordinary return. No new player-visible text was added.
2. **A floor book on an unreachable tile stays there.** A book whose tile nobody can reach is never claimed; the player's **Recover book** still puts it back.
3. **Not done here:** a played browser pass. The change is simulation timing with no rendering change; floor books already render as dropped books.
