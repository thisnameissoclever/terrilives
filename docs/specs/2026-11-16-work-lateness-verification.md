# Work lateness: verification record

Evidence for [work lateness](2026-11-16-work-lateness.md) (issue 309), measured on 2026-11-16 on the branch `twcl/309-late-for-needs`, built on main at `67c988c33`. Machine: Windows 11, `CARGO_BUILD_JOBS=2`, another full local check running beside it. Logs are in the task's untracked log directory, named below.

## Contents

1. [How needs behaved at work before](#before-how-needs-behaved-at-work-before)
2. [Tests that failed first](#red-tests-that-failed-first)
3. [Moved and unchanged pinned values](#pins-moved-and-unchanged-pinned-values)
4. [Targeted mutation checks](#mutations-targeted-mutation-checks)
5. [Trace figures](#trace-trace-figures)
6. [Open items](#open-open-items)

## [before] How needs behaved at work before

Read from the code before designing the Bladder relief. `AtWork` is set by `attendance::finish_tick` when the outbound walk ends. While it is set, `systems::needs::decay_needs` multiplies every need's decay by `at_work_decay_scale` (0.5) and nothing in the simulation restores any need, so a worker's needs only fall. The settled shift debits Energy by the job's cost. A trace of the shipped household for one week with the issue's two knobs at 0 (`trace 10080 --lateness-limit 0 --work-relief-threshold 0`, log `trace-week-before.log`) shows the lowest Bladder seen at work: Tim 31.83, Bill 45.53, Casey 25.08. None was critical in that week, but a worker who arrives lower is. With the relief on (`trace-week-new.log`) the lowest values are 50.01, 50.02 and 50.02, so Bladder at work stays at or above the threshold.

## [red] Tests that failed first

Each new test was run before its implementation and failed for the reason stated, with a stub that kept the signatures and did nothing.

| Test | Failure before the implementation | Log |
| --- | --- | --- |
| The knob tests in the data crate | The four fields did not exist, so the tests did not compile: `no field work_lateness_limit_ticks on type pack::Tuning` and the same for the other three | `red-data-knobs.log` |
| `a_worker_in_a_hunger_crisis_at_shift_start_eats_then_leaves` | `no departure on the start tick`: the worker left on the start tick | `red-lateness.log` |
| `lateness_ends_at_the_limit_with_no_remedy_to_be_had` | `tick 61 is still inside the limit`: left at tick 61 | `red-lateness.log` |
| `lateness_ends_at_the_limit_even_mid_remedy` | left at 61, not 120 | `red-lateness.log` |
| `a_running_remedy_finishes_before_departure` | `the meal lifted hunger before it ended`: the worker was gone before the meal could lift Hunger | `red-lateness.log` |
| `lateness_never_outlasts_the_shift_end` | the worker departed on the start tick, still commuting at the shift's end | `red-lateness.log` |
| `a_save_mid_lateness_continues_identically` | `saved while still home and late`: the worker had left | `red-lateness.log` |
| `the_choice_parameter_reports_lateness_along_the_ramp` | `None` where progress 0.0 was expected | `red-lateness.log` |
| `a_worker_at_work_is_relieved_of_bladder_below_the_threshold`, `bladder_never_falls_below_the_threshold_during_a_shift` | Bladder stayed at 49.9 instead of full; the lowest Bladder at work fell under the threshold | `red-lateness.log` |
| `the_remedy_share_ramps_from_the_autonomy_cap_to_the_lateness_share` | at half the ramp the remedy share was 0.95, not 0.97 | `red-lateness.log` |
| `a_worker_who_is_not_critical_leaves_on_the_start_tick_even_mid_meal` | `left on the start tick`: the first implementation held back a worker who was merely mid-meal; the fix is that a running remedy counts only after the start tick | `red-midmeal.log` |

The negative controls pass before and after, as they must: `a_worker_without_a_crisis_leaves_on_the_start_tick`, `a_bladder_crisis_never_delays_departure`, `other_critical_needs_do_not_delay_work`, `limit_zero_leaves_on_time`, `a_player_order_still_delays_departure_past_the_limit`, `a_worker_on_the_way_to_work_or_at_work_is_not_turned_back_by_a_crisis` and `bladder_is_not_relieved_away_from_work`. `without_lateness_the_choice_probabilities_are_exactly_todays` pins the vector main returned. `relief_of_an_uncounted_critical_need_is_unrelated_while_late` and `a_late_housemate_with_no_counted_remedy_gets_the_ordinary_distribution` fail with the counted-need filter removed (mutation M9), which is the stub's behavior. `the_ramp_never_raises_the_unrelated_cap` is a guard that holds before and fails under mutation M5c.

The first full run of the simulation suite, before the fix above, failed `a_worker_leaving_a_shared_bed_preserves_the_other_sleep_and_both_assignments` and `leaving_for_work_preserves_the_other_occupant`: both leave a worker asleep or eating with nothing critical at the shift start, which exposed that rule.

Green runs: `green-lateness2.log` (19 lateness tests), `sim-suite-release-2.log` (2096 passed, 3 ignored) and `workspace-release-1.log` (the whole workspace, release build), then `cargo clippy --workspace --all-targets -- -D warnings` and `cargo fmt --all -- --check`.

## [pins] Moved and unchanged pinned values

Each moved value was re-measured from the tree after merging main at `54cf96b46`, which includes issue 344's presence change (#348), and each comment in the tests names this issue.

| Value | Main with #348 | With this issue | Cause |
| --- | --- | --- | --- |
| `SHIPPED_THURSDAY` in `job_search_tests.rs` | 13315179661733202479 | 17164534138135296707 | Bladder relief at work and workers critical at a shift start leaving late |
| `TWO_DAY_FOLD_WITHOUT_THE_LOG` | `0x06a6_5d89_3df7_7287` | `0x15a5_6cde_2cb1_8c2d` | the same |
| `TWENTY_DAY_FOLD_WITHOUT_THE_LOG` (manual, release) | `0x4947_38f3_cd9d_3898` | `0x1888_d727_b10c_00ee` | the same |

Three guards assert that main's values return with both knobs at 0, which is how the change is shown to move the household only through them: `without_the_work_lateness_knobs_the_shipped_thursday_is_unchanged`, `the_two_day_fold_without_the_work_knobs_is_unchanged` and the manual `the_twenty_day_fold_without_the_work_knobs_is_unchanged`. Before #348 was merged, on main at `67c988c33`, the Thursday run was also measured with each knob alone: with the threshold at 0 the old value 4873052259007802963 came back with the limit at 0 or 60, and with the threshold at 50 the value was 7333729248054006451 with either limit, so on that tree nobody in the shipped household was critical at a shift start before Thursday 10:00 and only the Bladder relief moved it. The split was not repeated after the merge, which changes the household's days.

Two tests keep their meaning by leaving on time: `every_search_on_keeps_published_hires_schedules_and_career_randomness` and the schema-21 test run under `test_content::pre_shift_careers`, which now also sets the limit and the threshold to 0, as a pack published before them reconstructs; and `a_kept_errand_is_not_shown_while_the_worker_is_away`, whose worker is critically hungry on purpose and now sets the limit to 0 because the test is about an errand kept across a departure.

Unchanged and asserted by the suite: the `GOLDEN` world hash in `lib.rs` and its twin in the web bridge test, the content fingerprint in `content_hierarchy.rs`, and every save fixture's bytes. The inherited runtime fixture gained exactly the ten bytes of the four appended `Tuning` fields: with those fields left out the writer reproduces the previous fixture (26134 bytes, SHA-256 `5e779fbb7a08c0693d2d76eafd20dffe9cb43bb5066dcf8654d321794b09afe8`) byte for byte (`fixture-prove.log`). The `MapU32` rule of the filtered writer served only the wage proof and is removed.

## [mutations] Targeted mutation checks

`docs/testing-protocol.md` section 1. Each mutation was applied to a hashed byte-exact snapshot, the lateness, critical-choice and fight tests were run, and the file was restored from the snapshot with its hash compared. Results are in `mutation-results.json` and `mutation-<id>.log`.

| Id | File | Mutation | Test that failed | Run |
| --- | --- | --- | --- | --- |
| M1 | `lateness.rs` | the limit comparison `late < limit` made `late <= limit` | `lateness_ends_at_the_limit_even_mid_remedy`, `lateness_ends_at_the_limit_with_no_remedy_to_be_had`, `limit_zero_leaves_on_time`, `the_choice_parameter_reports_lateness_along_the_ramp` | alone (`mutation-M1.log`) |
| M2 | `lateness.rs` | the shift-end bound removed from the allowance predicate | `the_allowance_is_a_window_that_ends_at_the_limit_or_the_shift_end` | batch E (`mutation-batch-E.log`) |
| M3 | `attendance.rs` | the player-work check removed from the departure gate | `a_player_order_still_delays_departure_past_the_limit` | batch B (`mutation-batch-B.log`) |
| M4a | `lateness.rs` | Bladder added to the counted needs | `a_bladder_crisis_never_delays_departure`, `other_critical_needs_do_not_delay_work` | batch E (`mutation-batch-E.log`) |
| M4b | `lateness.rs` | Energy dropped from the counted needs | `lateness_ends_at_the_limit_even_mid_remedy` | batch D (`mutation-batch-D.log`) |
| M5a | `lateness.rs` | the ramp progress not clamped to 1 | `the_choice_parameter_reports_lateness_along_the_ramp` | batch A (`mutation-batch-A.log`) |
| M5b | `critical_choices.rs` | the ramp clamp removed from the unrelated cap | `the_remedy_share_ramps_from_the_autonomy_cap_to_the_lateness_share` | batch A (`mutation-batch-A.log`) |
| M5c | `critical_choices.rs` | the ramp allowed to raise the cap | `the_ramp_never_raises_the_unrelated_cap` | batch D (`mutation-batch-D.log`) |
| M6 | `lateness.rs` | the Bladder relief comparator `<` made `<=` | `a_worker_at_work_is_relieved_of_bladder_below_the_threshold` | batch A (`mutation-batch-A.log`) |
| M7 | `lateness.rs` | the Bladder relief applied to every housemate, not only those at work | `bladder_is_not_relieved_away_from_work` | batch E (`mutation-batch-E.log`) |
| M8 | `lateness.rs` | the running-remedy wait removed | `a_running_remedy_finishes_before_departure` | batch C (`mutation-batch-C.log`) |
| M8b | `lateness.rs` | the running-remedy wait applied on the start tick too | `a_worker_who_is_not_critical_leaves_on_the_start_tick_even_mid_meal` | batch D (`mutation-batch-D.log`) |
| M9 | `critical_choices.rs` | relief of any critical need counted as a remedy while late | `relief_of_an_uncounted_critical_need_is_unrelated_while_late`, `a_late_housemate_with_no_counted_remedy_gets_the_ordinary_distribution` | batch A (`mutation-batch-A.log`) |
| M10 | `lateness.rs` | lateness reported with no counted need critical | `the_choice_parameter_reports_lateness_along_the_ramp` | batch B (`mutation-batch-B.log`) |
| M11 | `attendance.rs` | the Bladder relief never run | `a_worker_at_work_is_relieved_of_bladder_below_the_threshold`, `bladder_never_falls_below_the_threshold_during_a_shift` | batch B (`mutation-batch-B.log`) |
| M12 | `attendance.rs` | the lateness check removed from the departure gate | `a_worker_in_a_hunger_crisis_at_shift_start_eats_then_leaves`, `lateness_ends_at_the_limit_with_no_remedy_to_be_had` | batch C (`mutation-batch-C.log`) |

Every mutation made its named test fail, and every restored file's SHA-256 matched its snapshot (`mutation-results-batches-AtoD.json`, `mutation-run-3.log`). The first mutation ran alone and later ones in batches that share one compile, grouped so that each mutation's named tests cannot fail for another mutation in the batch. Three results of the first pass were wrong for reasons found by this check, and were rerun alone in batch E:

1. **M2 survived.** Removing the shift-end bound from the predicate changed no behavior, because `start_tick` already skips a shift that is not open, which stops at the end. The clause stays as a cheap guard that makes the predicate stand on its own, and `the_allowance_is_a_window_that_ends_at_the_limit_or_the_shift_end` now pins it directly.
2. **M7 and M4a were hidden.** In the first batches M7 shared a compile with M11, and M4a with M12; M11 and M12 each remove the code the other mutation changes, so their tests could not fail. Both were detected when run without them.

The ramp clamp had a gap too: the ramp test passed only progress values from 0 to 1, so removing the clamp in the cap survived (M5b) until the test also passed 2.0 and -1.0.

## [trace] Trace figures

`cargo run --release -p terri-sim --example trace -- <ticks> [seed] [flags]` on the branch head, shipped household. The SHIFTS section's LATENESS lines report, for each worker, the shift starts with Hunger or Energy critical at the start tick and how many minutes after the start each left, and the other late departures separately, because another cause is not this issue's. Logs are `trace-*.log`.

| Run | Starts critical, minutes after the start they left | Longest other late departure | Left after the shift's end | Over the 60 minute limit for a need |
| --- | --- | --- | --- | --- |
| One week, default seed | Bill 60 | Tim 27 | 0 | 0 |
| Four weeks, default seed | Tim 60, 60, 60, 60, 60; Bill 60, 60, 54 | Bill 61 | 0 | 0 |
| One week, `--night-worker` | Tim 60, 60; Bill 60 | Tim 45 | 0 | 0 |
| One week, seed 11 | Tim 60 | Casey 17 | 0 | 0 |
| One week, seed 22 | none | Casey 69 | 0 | 0 |
| One week, seed 33 | Tim 60; Bill 33, 60; Casey 60 | none | 0 | 0 |

No worker who was critical at a shift start left later than 60 minutes after it, and nobody left after the shift's end. The late departures in the fourth column of the other cause are the walk home of a reading journey: in seed 22 Casey spent 69 minutes walking to the bookshelf with no critical need and no order, which is the behavior of issues 339 and earlier and is the same kind of delay as the 26 minutes the same seed shows with the issue's knobs at 0. This issue does not change it.

Of the 16 critical starts in the runs above, 14 used the whole hour. The case traced tick by tick (`TRACE_LATE_TICKS=1`, Bill, default seed, shift at tick 6600) is an Energy crisis: Energy 15.8 at the start, 23 minutes walking to the bed, asleep from tick 6624, Energy 20 at tick 6633, out of bed at tick 6660 with Energy near 33. The other 13 were not traced tick by tick. Bladder at work never fell below 50 in these runs and no worker spent a tick at work with Bladder critical.

## [open] Open items

1. **The hour is almost always used up.** 14 of 16 critical starts left at exactly 60 minutes; the one traced in detail was a sleep, which takes longer than the allowance. The owner's rule is working as decided, but the owner may want a shorter walk-and-nap or a longer allowance for Energy; that is a product decision this issue does not make.
2. **A reading journey can still make a worker later than the limit.** Not changed here; seed 22 shows 69 minutes.
3. **Not done here:** a changelog-driven refresh of the player guide screenshots, which show no changed control. The player guide text and its numbers read from the compiled reference.
