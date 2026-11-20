# Work lateness: verification record

Evidence for [work lateness](2026-11-16-work-lateness.md) (issue 309), measured on 2026-11-16 on the branch `twcl/309-late-for-needs`, built on main at `67c988c33` and merged with main at `f58ddcf57` (see [Merge with main](#merge-merge-with-main)). Machine: Windows 11, `CARGO_BUILD_JOBS=2`, another full local check running beside it. Logs are in the task's untracked log directory, named below. The [before] and [trace] figures were remeasured on the merged tree at `00319418e` after main's slower need drain arrived, and say so where they appear.

## Contents

1. [How needs behaved at work before](#before-how-needs-behaved-at-work-before)
2. [Tests that failed first](#red-tests-that-failed-first)
3. [Moved and unchanged pinned values](#pins-moved-and-unchanged-pinned-values)
4. [Targeted mutation checks](#mutations-targeted-mutation-checks)
5. [Trace figures](#trace-trace-figures)
6. [Open items](#open-open-items)
7. [Merge with main](#merge-merge-with-main)

## [before] How needs behaved at work before

Read from the code before designing the Bladder relief. `AtWork` is set by `attendance::finish_tick` when the outbound walk ends. While it is set, `systems::needs::decay_needs` multiplies every need's decay by `at_work_decay_scale` (0.5) and nothing in the simulation restores any need, so a worker's needs only fall. The settled shift debits Energy by the job's cost. A trace of the shipped household for one week with the issue's two knobs at 0 (`trace 10080 --lateness-limit 0 --work-relief-threshold 0`, log `trace3-week-before.log`) shows the lowest Bladder seen at work. Measured on the merged tree at `00319418e` (after the slower drain and the full bathroom use of main at `f58ddcf57`; Windows 11, release build), it is Tim 58.77, Bill 63.63 and Casey 13.02, and Casey spent 85 ticks at work with Bladder critical. With the relief on (`trace3-week-new.log`) the lowest values are 58.36, 50.02 and 70.67, none critical. That is one seed and one week: it shows a worker can be critical at work with the relief off on the shipped household, not how often. Measured before the slower drain merged (`trace2-week-before.log`, at `54cf96b46`) the same trace gave 31.83, 45.53 and 25.08, with none critical.

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

Review fixes after the draft: `rejects_a_work_lateness_limit_that_could_cover_a_whole_shift` failed first because a limit equal to the shift's ticks still compiled (`red-limit-vs-shift.log`; an earlier red run failed for the wrong reason, the ramp rule, and was redone). The tests for the choice join, a housemate with no job, and Hunger with Bladder both critical (`select_action_gives_a_late_worker_the_ramped_remedy_share`, `a_housemate_without_a_job_gets_no_lateness_and_todays_share`, `hunger_and_bladder_both_critical_keep_the_worker_home_for_hunger_only`, `with_hunger_and_bladder_critical_only_hungers_relief_is_a_remedy_while_late`) pass on the current code, as guards of behavior that already existed; the join test is shown to bite by mutation M13.

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

Unchanged and asserted by the suite: the `GOLDEN` world hash in `lib.rs` and its twin in the web bridge test, the content fingerprint in `content_hierarchy.rs`, and every save fixture's bytes. The inherited runtime fixture gained exactly the ten bytes of the four appended `Tuning` fields: with those fields left out the writer reproduces the previous fixture (the fixture on main at `f58ddcf57`: 26136 bytes, SHA-256 `6f508934a4bdc377690acbd8162ed6286f93c2c60b2c863d032ce968de0afe3d`) byte for byte; the regenerated fixture is 26146 bytes, SHA-256 `32efc8ed836f8fc8fb73b27aff809fd2e432009b4a9b56aad856ea1462196c15` (see [Merge with main](#merge-merge-with-main)). The `MapU32` rule of the filtered writer served only the wage proof and is removed.

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
| M13 | `action.rs` | `select_action` passes `None` instead of `rhythm.lateness(...)` to the probabilities | `select_action_gives_a_late_worker_the_ramped_remedy_share` | alone, batch F (`mutation-batch-F.log`, `mutation-run-4.log`) |

Before this row was added nothing failed if the join in `select_action` became `None`; a reviewer found that, and the test above now drives the real decision and reads the shares it recorded. Every mutation made its named test fail, and every restored file's SHA-256 matched its snapshot (`mutation-results-batches-AtoD.json`, `mutation-run-3.log`). The first mutation ran alone and later ones in batches that share one compile, grouped so that each mutation's named tests cannot fail for another mutation in the batch. Three results of the first pass were wrong for reasons found by this check, and were rerun alone in batch E:

1. **M2 survived.** Removing the shift-end bound from the predicate changed no behavior, because `start_tick` already skips a shift that is not open, which stops at the end. The clause stays as a cheap guard that makes the predicate stand on its own, and `the_allowance_is_a_window_that_ends_at_the_limit_or_the_shift_end` now pins it directly.
2. **M7 and M4a were hidden.** In the first batches M7 shared a compile with M11, and M4a with M12; M11 and M12 each remove the code the other mutation changes, so their tests could not fail. Both were detected when run without them.

The ramp clamp had a gap too: the ramp test passed only progress values from 0 to 1, so removing the clamp in the cap survived (M5b) until the test also passed 2.0 and -1.0.

## [trace] Trace figures

`cargo run --release -p terri-sim --example trace -- <ticks> [seed] [flags]` on the merged branch, shipped household. Remeasured on 2026-11-16 on the merged tree at `00319418e` (Windows 11, release build, the example built once and run for each row), because the first measurement (logs `trace2-*.log`, at `54cf96b46`) predates the slower need drain and the full bathroom use that main added. The new logs are `trace3-*.log`; the build is `trace3-build.log`. The SHIFTS section's LATENESS lines report, for each worker, the shift starts with Hunger or Energy critical at the start tick and how many minutes after the start each left, and the other late departures separately, because another cause is not this issue's. Logs are `trace2-*.log`, measured after merging main at `54cf96b46`; the same runs before that merge gave identical figures.

| Run | Starts critical, minutes after the start they left | Longest other late departure | Left after the shift's end | Over the 60 minute limit for a need | Lowest Bladder at work |
| --- | --- | --- | --- | --- | --- |
| One week, default seed (`trace3-week-new.log`) | Tim 60 | Bill 25 | 0 | 0 | Tim 58.36, Bill 50.02, Casey 70.67 |
| Four weeks, default seed (`trace3-4weeks.log`) | Tim 60, 60; Bill 60 | Casey 45 | 0 | 0 | 50.01, 50.01, 52.41 |
| One week, `--night-worker` (`trace3-night.log`) | none | Bill 50 | 0 | 0 | 59.25, 50.02, 59.61 |
| One week, seed 11 (`trace3-seed-11.log`) | Tim 60; Casey 13 | Casey 66 | 0 | 0 | 50.32, 50.02, 57.34 |
| One week, seed 22 (`trace3-seed-22.log`) | none | Bill 45 | 0 | 0 | 50.00, 57.54, 50.02 |
| One week, seed 33 (`trace3-seed-33.log`) | Tim 60 | Bill 14 | 0 | 0 | 57.85, 50.01, 63.88 |

No worker who was critical at a shift start left later than 60 minutes after it, and nobody left after the shift's end. On the shipped household a critical start does happen within a week: it happened in the default seed (Tim), seed 11 (Tim and Casey) and seed 33 (Tim), and not in seed 22 or the night-worker run; over four weeks of the default seed it happened three times. That is six critical starts in five separate runs (the one-week default row is the first week of the four-week row and is not counted twice), too few to say how often it happens in ordinary play. Bladder at work stayed at or above 50 in every run with the relief on (the lowest printed value is 50.00) and no worker spent a tick at work with Bladder critical; with the relief off the default seed's week had Casey at 13.02 for 85 ticks at work, which is the case the relief exists for. Whether the relief itself fired in each other run is not recorded by the trace, only that Bladder never fell below the threshold; the dedicated tests in `lateness_tests.rs` carry the behavior.

The late departures in the third column are not this issue's: they are other causes, such as the walk home of a reading journey. The longest on the merged tree is Casey's 66 minutes in seed 11, which was not traced tick by tick after the merge. Before the slower drain merged the same kind of delay showed as 69 minutes for Casey in seed 22, a walk to the bookshelf with no critical need and no order (the behavior of issues 339 and earlier). This issue does not change it.

Of the six critical starts in the runs above, five used the whole hour and one (Casey, seed 11) left after 13 minutes. None was traced tick by tick on the merged tree. Before the slower drain merged, the case traced tick by tick (`TRACE_LATE_TICKS=1`, Bill, default seed, shift at tick 6600, at `54cf96b46`) was an Energy crisis: Energy 15.8 at the start, 23 minutes walking to the bed, asleep from tick 6624, Energy 20 at tick 6633, out of bed at tick 6660 with Energy near 33.

## [open] Open items

1. **The hour is almost always used up.** The sample is small. 5 of 6 critical starts on the merged tree left at exactly 60 minutes; before the slower drain merged it was 14 of 16, and the one traced in detail then was a sleep, which takes longer than the allowance. The owner's rule is working as decided, but the owner may want a shorter walk-and-nap or a longer allowance for Energy; that is a product decision this issue does not make.
2. **A late departure for another cause can still exceed the limit.** Not changed here; seed 11 shows 66 minutes on the merged tree, a cause not traced after the merge (seed 22 showed 69 before the slower drain merged, traced to a reading journey). Resolved on 2026-11-19: the seed 11 case was traced to a book return, and [late book returns](2026-11-19-late-book-returns.md) caps it at the same limit.
3. **Not done here:** a changelog-driven refresh of the player guide screenshots, which show no changed control. The player guide text and its numbers read from the compiled reference.

## [merge] Merge with main

On 2026-11-16 the branch merged main at `f58ddcf57`, which gained the wages and bills (save schema 22, starting funds), every need draining at three quarters of its old rate (#349) and a toilet, shower or bath use lasting until its need is full (#350, which appended `need_fill_max_ticks` to `Tuning`). Conflicts were in the tuning field lists, the inherited runtime fixture and its proof, the two pins files, the player guide and the changelog entry. Both sides were kept.

1. **Field order.** The four lateness knobs stay appended after main's last field: the compiled `Tuning` now ends `night_shift_premium_percent`, `need_fill_max_ticks`, then `work_lateness_limit_ticks`, `work_lateness_ramp_ticks`, `work_lateness_remedy_share`, `work_bladder_relief_threshold`. The slot test `the_appended_tuning_knobs_keep_their_slots` reads the lateness bytes as the last ten, the fill limit as the two before them and the night premium as the byte before that. The schema test now has 160 scalar knobs.
2. **Fixture.** The proof ran first against main's fixture (26136 bytes, SHA-256 `6f508934a4bdc377690acbd8162ed6286f93c2c60b2c863d032ce968de0afe3d`): leaving out the four lateness fields recovered every byte of it. The regenerated fixture is 26146 bytes (ten more), SHA-256 `32efc8ed836f8fc8fb73b27aff809fd2e432009b4a9b56aad856ea1462196c15`.
3. **Pins.** Each was re-read on the merged tree. At the slower drain nobody in the shipped household is critical at a shift start or below the Bladder threshold at work within the first days, so two of the three pins did not move:

| Value | Main at `f58ddcf57` | Merged tree |
| --- | --- | --- |
| `SHIPPED_THURSDAY` in `job_search_tests.rs` | 16800902046621430031 | 16800902046621430031 (unchanged) |
| `TWO_DAY_FOLD_WITHOUT_THE_LOG` | `0x6ed5_8e35_ffc8_2f8d` | `0x6ed5_8e35_ffc8_2f8d` (unchanged) |
| `TWENTY_DAY_FOLD_WITHOUT_THE_LOG` (manual, release) | `0xb6e3_d213_e72a_6360` | `0x9224_ed05_3053_97fc` (moved by the lateness knobs) |
| `GOLDEN` in `lib.rs` and its web twin | 15287039064284998688 | unchanged |
| `STANDARD_ONLY_HASH` | 10091986056830211033 | unchanged |

The three guards that assert main's values return with both knobs at 0 now compare against these main values. The two earlier tables in this record show the values measured before the merge.
