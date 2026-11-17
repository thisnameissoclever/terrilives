# Verification record: slower need drain and full bathroom use

Dated verification for [the specification](2026-11-15-full-bathroom-use.md), issue 315. The sections headed Drain cover the drain change; the sections headed Fill cover the fill change stacked on it.

## Drain: measurements

The trace example runs the shipped household on the shipped lot for a week of game time. Command: `cargo run --release -p terri-sim --example trace -- 10080 <seed>`, with the default seed and seeds 1, 2 and 3. Both columns come from the same command on the same machine class (Windows 11, release build); "before" is main at 053ee52d3 and "after" is this change. A week of one household is a small sample, and the four seeds differ by far more than the drain does on any single need, so read the totals and the direction, not one cell.

Ticks spent with a need at or below the critical level (20), summed over the three housemates, from the trace line "living critical ticks by need":

| Seed | Before | After |
| --- | --- | --- |
| default (20260728) | 5249 | 4782 |
| 1 | 12142 | 2038 |
| 2 | 8568 | 3945 |
| 3 | 8788 | 2464 |
| All four | 34747 | 13229 |

Needs that reached 0 during the week (trace lines marked "hit zero", one per person and need): 2, 5, 4 and 2 before (13 in all) and 0, 0, 1 and 0 after (1 in all). No housemate died in any run.

Energy critical time rose in the default seed (398 to 1080 ticks) even though its drain fell. The household's choices differ from the first morning under the new rates, so one week of one seed can move a single need either way. The other three seeds, and the total, fell.

This change does not touch how long a bathroom use lasts: the rule that draws a use's length is unchanged. The means differ only because the household's histories differ. Mean toilet length was 20.1, 18.3, 20.6 and 21.2 ticks before and 19.9, 20.0, 21.7 and 19.6 after; mean shower length was 71.3, 71.8, 82.2 and 75.7 before and 80.2, 66.5, 72.0 and 74.8 after. Those differences are draws on different household histories, not a rule.

To reproduce the "before" column, build the trace example on main at 053ee52d3 (check `git rev-parse --short origin/main` first) and run the same command with each seed; the "after" column is this branch. The raw logs stay in ignored local storage next to the local check reports and are not part of the repository.

The trace line "unexplained disappearances" of conversation requests is 0, 1, 0 and 1 on main and 2, 0, 2 and 1 here. Main's baseline is not zero and no housemate died in any run, so this is recorded as run-to-run variation under different histories, not as a drain effect. It was not investigated further.

## Drain: pinned values that moved, and why

This change was merged with main at 54cf96b46, which added the wages and bills (issue 298, save schema 22) and stopped furniture presence lowering mood (issue 344). Each value below was recomputed on the merged tree from its own failing assertion, never by taking either side. The "Main" column is the value main at 54cf96b46 pins, which already includes the wages, the bills and the presence rule; the "This change" column adds one more cause. Each moved because each base need drain rate is three quarters of its old value, so needs cross their thresholds at different ticks and the household's choices, and the random draws they spend, differ from the first minutes. No digest encoding changed and no simulation code changed. Each new value was read from the failing assertion and then confirmed by a passing run.

| Value | Where | Main | This change |
| --- | --- | --- | --- |
| Fixed-scenario world hash `GOLDEN` | `crates/terri-sim/src/lib.rs` | 4733362429942472337 | 15287039064284998688 |
| Its release-WebAssembly twin | `web/tests/bridge.test.ts` | 4733362429942472337 | 15287039064284998688 |
| Shipped household through Thursday, `SHIPPED_THURSDAY` | `crates/terri-sim/src/job_search_tests.rs` | 13315179661733202479 | 5892717548701736568 |
| Standard-shift hash, `STANDARD_ONLY_HASH` | `crates/terri-sim/src/save/v21_tests.rs` | 3704503324967516506 | 16044876517331188252 |
| Two-day activity log fold | `crates/terri-sim/src/activity_log_tests.rs` | 0x06a6_5d89_3df7_7287 | 0xcb8f_9954_11cb_4102 |
| Twenty-day activity log fold (release, manual) | the same file | 0x4947_38f3_cd9d_3898 | 0xfe91_9131_6786_b7dc |

`GOLDEN` is a fixed scenario that main's wages, bills and presence changes did not move: main pins the same 4733362429942472337 as before them. This change's own measurement of 15287039064284998688 still holds on the merged tree (the native assertion passes with it), so the merge added no second cause. Before the merge, the drain change alone had measured the other values as `SHIPPED_THURSDAY` 17769474122166916875 to 15679464342224380920, `STANDARD_ONLY_HASH` 1877760251232896320 to 12407989054242721803, the two-day fold 0xa0fb_785a_e3a4_7b1d to 0x1f5f_7875_d990_cea9 and the twenty-day fold 0x78e8_cb74_b70c_d742 to 0x9edb_b19f_679e_fd4b; those are superseded by the table above.

The draws and jobs in `SHIPPED_THURSDAY` (seven careers draws, two shift draws, the three jobs and shifts) did not change.

Unchanged on purpose, and asserted by their existing tests: the published schema-fifteen control hash 4676206450852028819 (it sets its own drain in `pre_balance_content`), the bare-agent hash, every save fixture's bytes, the content fingerprint, and `inherited-runtime.pack` with its pre-books pair. The inherited-runtime fixture compiles the live tuning and then overrides the drain with the published rates; its assertion of the live rates now reads the new numbers, and its bytes did not move.

Tests that encoded the old balance and were corrected:

1. `review_physical_terminal_reward_arrives_after_work_has_clamped_hunger_at_zero` starts hunger at 10 instead of 20. It needs 600 ticks of work to drain hunger to the floor, and at the new rate 600 ticks drain 18.6.
2. `review_physical_media_prediction_includes_the_actual_company_multiplier` uses a Social drain multiplier of 8/3 instead of 2. The test needs Social to fall faster than disliked company refills it; 8/3 times the new 0.013 is the 0.03467 a minute that 2 times the old 0.017333 gave, so the fixture's net Social decay is the same as before.
3. One seating test and one dining test read comfort, fun and energy decay from the shipped pack instead of a literal.
4. `conversation_balance_shipped_need_drain_is_two_thirds_of_previous_rates` is now `conversation_balance_shipped_need_drain_is_half_of_the_rates_before_2026_10_19` and checks half of those rates, since the shipped rates are two thirds and then three quarters of them.
5. The two-day activity log check no longer requires a nuisance episode in the household's first two days, because with slower drain there is none. The manual twenty-day check (release build, `--ignored`) requires one instead, and it passed with that requirement. The log-on and log-off worlds are still compared tick by tick in the two-day check. The ordinary suite keeps the guard: `the_nuisance_emitter_never_changes_the_world` runs one game day of a small world that provokes a nuisance episode (Bill hates the television, Casey watches it in the same room) with the log on and off, requires identical world hashes after every tick, and requires that the log recorded the episode, so the comparison cannot pass vacuously. It takes about 80 seconds in a debug build. The manual twenty-day test remains a release check for the shipped household; run it in a release build before merging a change to an emitter, as its comment says. The emitter is also tested by `a_nuisance_episode_closes_at_the_end_of_the_day` and `every_relationship_cause_is_logged_or_excluded`.
6. `content/careers.toml` quoted the energy cost of a shift as about 24 points of decay and about 40 all told. Those figures were already stale; the comment now gives the roughly 6 points and about 21 all told that the shipped rate and the work scale produce.

## Drain: red then green

`shipped_base_decay_is_three_quarters_of_the_balance_before_issue_315` was written first and failed on main's content with "hunger drains 0.041333333 a tick; three quarters of the old 0.041333333 is 0.031". It passes with the new rates. Mutation checks, each followed by a restore and a matching hash of `content/tuning.toml`: setting every rate to 0.8 times its old value fails with "hunger drains 0.033066668 a tick", and restoring only hunger to 0.0413333333 fails with "hunger drains 0.041333333 a tick".

## Drain: checks on the merged tree

The drain change was merged with main at 54cf96b46 and checked on the merged head 07171218f.

1. Full local check, `scripts/check-local-ci.py run`, all six groups (docs, scripts, art, rust, site, web), 29 steps, every step exit code 0. The report says state passed, complete true and source_changed false. Report: `D:/VIBES/.worktrees/twcl-315-logs/pr1-ci-final.json`, sha256 `f8bf6685b8115874c361c1b6765b98fdc525cdcf4e54f73f2071f0c909bacd3b`. The web steps rebuilt the release WebAssembly module and ran the `GOLDEN` twin in `web/tests/bridge.test.ts` against it.
2. The manual twenty-day activity log check, `cargo test --release -p terri-sim --lib -- activity_log_never_changes_the_world_over_twenty_days --ignored --test-threads=1`, passed on the same head: 1 passed, 0 failed, 122 seconds. It requires a nuisance episode in the twenty days and found one. Log: `D:/VIBES/.worktrees/twcl-315-logs/pr1-twenty-day-release-final.log`.

The report and log live in local storage next to the other evidence and are not part of the repository. Later commits on this branch changed documentation only.

## Fill: measurements

The trace example gained a bathroom tally (`crates/terri-sim/examples/trace/bathroom.rs`) that reads each toilet, shower and bath use off the household once a tick from outside the simulation, so the same harness measures a build from before the fill change and one after it. Commands: `cargo run --release -p terri-sim --example trace -- <ticks> <seed>` with the default seed (20260728) and seeds 1, 2 and 3, for 10080 ticks (a game week) and 36000 ticks (25 game days). "Before" is the head of the drain pull request (82283519f), which has the new drain and the old bathroom behavior, with only the example's tally added; "after" is this branch. Both were built and run on the same machine class (Windows 11, release build).

Bathroom uses over 36000 ticks, summed over the four seeds and the three housemates. A use counts as full when the need ended at 99.99 or more.

| Fixture | Uses | Ended full | Mean ticks | Shortest | Longest | Need at start | Need at end | Time occupied |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Toilet, before | 350 | 285 | 20.6 | 12 | 33 | 47.6 | 98.2 | 5.0% |
| Toilet, after | 360 | 357 | 12.0 | 7 | 15 | 50.4 | 100.0 | 3.0% |
| Shower, before | 151 | 63 | 74.8 | 9 | 124 | 43.3 | 88.8 | 7.9% |
| Shower, after | 166 | 164 | 19.2 | 9 | 34 | 53.5 | 100.0 | 2.2% |
| Bath, before | 111 | 48 | 65.0 | 47 | 109 | 52.3 | 89.5 | 5.0% |
| Bath, after | 123 | 123 | 19.0 | 12 | 38 | 62.1 | 100.0 | 1.6% |

After the change 644 of 649 uses ended at 99.99 or more. The five that did not were 3 toilet uses and 2 showers. The shortest toilet use was 7 ticks and the shortest shower 9, both below the 12 tick minimum, so those two were cut short by something else, such as an order or a shift start; the other three were not examined. "Time occupied" adds one tick for every housemate who is using that kind of fixture on a tick, as a share of the run's ticks, averaged over the four seeds, so with three housemates it can pass 100 percent. Typical uses are short because housemates go when a meter is about half full, so the fill takes 12 to 20 ticks; the 15, 37 and 43 tick figures are from an empty bar.

Net change over a use (it includes the drain over the use, so a longer use shows a larger drain):

| Fixture | Net Energy before | Net Energy after | Net Comfort before | Net Comfort after |
| --- | --- | --- | --- | --- |
| Toilet | -0.50 | -0.30 | -0.35 | -0.20 |
| Shower | -11.72 | -10.03 | -1.30 | -0.30 |
| Bath | -4.01 | -3.06 | 5.11 | 5.31 |

The shower's own per-use Energy cost, which is the net change less the drain over the use (0.0255 a tick times the mean length), is 9.8 before and 9.5 after, so the total stayed within about 3 percent. The bath's is 2.4 before and 2.6 after. The side rates in `content/objects.toml` (Energy -20 for the shower, Comfort 55 and Energy -5.5 for the bath) were set to give these, after a first guess that the same measurement showed to be too low.

Ticks spent with a need at or below the critical level (20), summed over the three housemates and the four seeds:

| Run | Variant | Hunger | Energy | Hygiene | Bladder | Fun | Waiting for an occupied target |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 36000 ticks | before | 27551 | 11086 | 6796 | 3360 | 3915 | 12336 (2.9% of housemate time) |
| 36000 ticks | after | 29430 | 6707 | 2268 | 2118 | 1759 | 13811 (3.2%) |
| 10080 ticks | before | 9241 | 2422 | 1123 | 250 | 193 | 4085 (3.4%) |
| 10080 ticks | after | 6906 | 1555 | 280 | 1078 | 393 | 5526 (4.6%) |

Social critical time was 174 before and 7 after over 25 days, and Comfort never reached critical. Needs that reached 0: 11 before and 10 after over 25 days, 1 and 2 over a week. No housemate died in any run.

Reading the table, and what it does not show:

1. **Hygiene crisis time fell by two thirds over 25 days** (6796 to 2268), because every shower or bath now fills the bar.
2. **Bladder crisis time rose in the first week and fell over the rest.** The one-week runs are the first 10080 ticks of the 25-day runs, so these are one run read two ways, not two samples. Summed over the four seeds, Bladder critical ticks went from 250 to 1078 in week one (mostly seed 1, from 60 to 899) and from 3110 to 1040 over days 8 to 25 (the 25-day totals, 3360 and 2118, less the first week). Whether the change raises Bladder crises is an open question; the figures neither show nor exclude it. The cause of the week-one rise on seed 1 is in the next section.
3. **Waiting for an occupied target rose slightly** (2.9% to 3.2% of housemate time over 25 days, 3.4% to 4.6% over a week). This is the trace's existing tally for any object, not for bathrooms alone, and its cause was not investigated. Fixtures were occupied for about a third as long after the change, so the rise does not come from longer bathroom uses.
4. **How often each fixture is chosen** changed little: 350, 151 and 111 uses over 25 days before and 360, 166 and 123 after for the toilet, shower and bath. The authored rates of the three are higher, so their ordinary scores are higher, as the specification says; the measured effect is a rise of about 10 percent in showers and baths and 3 percent at the toilet.
5. Energy crisis time fell by about 40 percent over 25 days, Fun crisis time by 55 percent and Hunger crisis time rose 7 percent. These come from different household histories under the new rates and were not investigated; this record does not claim a cause.

## Fill: pinned values that moved, and why

The fill change was merged with the drain change as merged with main at 54cf96b46 (head f9b33b2ea), which carries the wages and bills (issue 298, save schema 22), the presence rule (issue 344) and the slower drain. Each value below was recomputed on that merged tree from its own failing assertion, never by taking a side, and confirmed by a passing run. "Before" is the value the drain change pins on the merged tree; each moved for one more cause, the fill.

| Value | Where | Before | After |
| --- | --- | --- | --- |
| Shipped household through Thursday, `SHIPPED_THURSDAY` | `crates/terri-sim/src/job_search_tests.rs` | 5892717548701736568 | 16800902046621430031 |
| Standard-shift hash, `STANDARD_ONLY_HASH` | `crates/terri-sim/src/save/v21_tests.rs` | 16044876517331188252 | 10091986056830211033 |
| Two-day activity log fold | `crates/terri-sim/src/activity_log_tests.rs` | 0xcb8f_9954_11cb_4102 | 0x6ed5_8e35_ffc8_2f8d |
| Twenty-day activity log fold (release, manual) | the same file | 0xfe91_9131_6786_b7dc | 0xb6e3_d213_e72a_6360 |
| Compiled runtime fixture `inherited-runtime.pack` | `crates/terri-data/tests/fixtures/` | 26134 bytes, SHA-256 5e779fbb7a08c0693d2d76eafd20dffe9cb43bb5066dcf8654d321794b09afe8 (main at 54cf96b46) | 26136 bytes, SHA-256 6f508934a4bdc377690acbd8162ed6286f93c2c60b2c863d032ce968de0afe3d |

The cause of the four hashes is one: a toilet, shower or bath now lasts until its need is full and its authored rates were raised, so the household's days differ from the first bathroom visit. The draw counts, jobs and shifts in `SHIPPED_THURSDAY` are unchanged. The fixture changes by two things and the test proves it: with the fill limit's two bytes removed from the tuning (the filtered postcard writer omits the `Tuning` field `need_fill_max_ticks`, after proving that the unfiltered writer reproduces postcard) and the three actions put back to their old authored numbers, the current pack encodes to exactly the 26134 bytes on main at 54cf96b46. On the merged tree `TERRI_PROVE_RUNTIME_FIXTURE=1` ran that proof against main's file before it was regenerated, and it passed. The fill limit is the last field of `Tuning`, after main's night premium, so the premium keeps its place and `the_appended_tuning_knobs_keep_their_slots` pins both.

The trace measurements, the mutation checks and the scoring and week-one tables in this record were taken before main's wages and bills were merged. The merge changes pay, starting funds and bills, not the fill, and those measurements were not repeated.

Unchanged and asserted unchanged: `GOLDEN` and its release-WebAssembly twin (the scenario has only a fridge), the published schema-fifteen control hash, the bare-agent hash, every save fixture's bytes, and the content fingerprint, which `the_shipped_content_fingerprint_is_the_one_main_had` pins at 5841475410324663844, read from main.

Tests corrected because they encoded the old behavior:

1. `critical_social_does_not_create_phantom_media_emergencies` occupied a bathroom with a person whose toilet use had 1000 ticks left and whose Bladder was already 100. The use now ends on the tick the need is full, so the room emptied and the actor walked in. The fixture's occupant now gets nothing from the toilet (their Bladder satisfaction multiplier is 0 and the need starts at 50), so the use lasts for the whole test, which is what the test needs.
2. `the_shipped_toilet_declares_presentation_only_seat_metadata` and `the_shipped_bathtub_declares_presentation_only_basin_metadata` read the new durations 20 and 40.
3. `shipped_migration_scopes_retirement_balance_and_seating_changes` lists the three actions' retuned rates among its intended differences from the frozen legacy content.
4. `the_appended_tuning_knobs_keep_their_slots` and the schema test learned the new last field, and the premium of issue 298 keeps the byte before it.
5. `published_domestic_prefix_preserves_nonempty_state_and_current_recipe_step` (`crates/terri-wasm/src/save_v3_tests.rs`) failed on the merged tree, the first full run that reached the terri-wasm suite on this branch. It runs the published household until one housemate's cooking reaches step 3 and takes its snapshot there, and which housemate is doing what at that tick depends on the household's choices, which every balance value moves. With this change a housemate was walking to the armchair (and, one tick later in the same run, sitting in it) when the snapshot was taken. Loading a published save then re-plans such a walker and ends such a seated use, because the armchair's place is not a legal contact under current content (`seating::migrate`); that migration is covered by the seating tests, and `current_world`, the test's expected value, does not model it. The cause is the test's timing, not the fill: the loader behaved as designed. The test now also waits until nobody is walking to or sitting at an object that offers a communal seat in current content, and says why in a comment; the domestic group and the cooking step it checks are unchanged, and the test passes.
6. Two tests in `web/tests/shower-motion.test.ts` encoded the old shower: one required 53 to 126 active ticks (the authored 90 with its variance), the other saved and reloaded 17 ticks into a shower. Both failed on the first full web run on this branch (the earlier runs of this change did not run the web suite). The first now asserts the rule: the active time is at least the minimum use, at most `need_fill_max_ticks`, and Hygiene is full when it ends. A new household starts with every need full, so that run is the 12-tick minimum, not a measurement of a typical shower. The second saves and reloads 5 ticks in, which any shower outlasts. The clip tests in the same file still check that the washing motion itself moves both wrists. Consequence for the owner: a typical shower now lasts about 19 ticks (the trace's mean, 74.8 before), so the washing animation repeats fewer times than it did; the full shower from empty lasts 37.

## Fill: red then green

The fill tests were written first, against a stub whose length was still the drawn one. Of 20, 15 failed for the stated reason (the toilet from an empty bar ended at 58.661 instead of 100, a use ran its drawn length, the activity filter found nothing) and 5 passed, each by design: the net-rate-at-or-below-zero fallback, a resumed use with a short drawn length, an interrupted shower, the other actions' lengths and the kept draw all describe behavior the stub already had, and each is exercised by a mutation below. Both forecast tests failed against a stub that planned the authored length (a forecast of 21 ticks against a played use of 16).

The first run against the implementation, with the rates still at their old values, passed 15 of 20. The pinned 15, 37 and 43 tick lengths failed as they should (26 ticks for the toilet), and four of my own expectations were wrong and were corrected, not the implementation: a tolerance of two ticks on a halved length, a shower length that reached the limit, a save test that ran too few ticks, and a drain counted one tick short. Retuning the content turned the pinned lengths green. The full terri-sim suite then had four failures, the three hashes above and the phantom media fixture in item 1 of the corrected tests.

## Fill: mutation checks

Each mutation was applied alone to the file named, the fill tests were run, the file was restored from a byte copy and its hash compared. One mutation survived the first time (the drain on the arrival tick), and a test was added that kills it; the others failed at least one test on the first run. Every restore was identical.

| Mutation | Tests that failed |
| --- | --- |
| Delete the fill branch in `follow_path` | `a_full_use_ends_with_the_need_at_exactly_100`, `a_use_never_ends_one_tick_short_of_full`, `the_forecast_of_a_fill_agrees_with_what_delivery_produces`, `a_floor_bound_use_still_lasts_the_floor_and_stays_full` |
| Delete the stop-at-full check in `tick_interactions` | `a_use_resumed_from_a_save_with_a_long_drawn_length_ends_when_full` |
| Remove the minimum length | `a_full_use_ends_with_the_need_at_exactly_100`, `a_full_use_takes_the_closed_form_number_of_ticks_from_any_start`, `the_floor_applies_near_full_and_the_cap_applies_for_a_tiny_rate`, `a_floor_bound_use_still_lasts_the_floor_and_stays_full` |
| Ignore the limit | `the_floor_applies_near_full_and_the_cap_applies_for_a_tiny_rate` |
| Let any action fill (drop the activity filter) | `only_the_three_bathroom_activities_fill_and_both_sinks_do_not`, `any_other_action_has_no_fill_length`, `a_forecast_plans_the_fill_length_for_a_fill_and_the_authored_length_otherwise` |
| Skip the duration draw for a fill | `the_duration_draw_is_still_taken_for_a_fill` |
| Drain on the arrival tick too | Survived the first run: no start level the tests used sits within one tick of drain of a whole number of ticks, so both conventions gave the same length. `the_arrival_tick_delivers_without_a_drain_before_it` was added with starts chosen to sit there, and it then fails alone |
| Stop early even below the minimum | `a_full_use_ends_with_the_need_at_exactly_100`, `a_floor_bound_use_still_lasts_the_floor_and_stays_full`, `the_forecast_of_a_fill_agrees_with_what_delivery_produces` |
| Plan forecasts at the authored length | `a_forecast_plans_the_fill_length_for_a_fill_and_the_authored_length_otherwise`, `the_forecast_of_a_fill_agrees_with_what_delivery_produces` |

| `select_action` plans the authored length again (the call site in `action.rs` put back to the old inline construction) | `the_decision_forecast_plans_a_shower_at_its_fill_length`, alone; the file restored identically |

`the_decision_forecast_plans_a_shower_at_its_fill_length` pins that wiring. It stands a shower with a slow Hygiene rate (a fill of about 104 ticks against an authored 10) and a Comfort rate just above Comfort's drain ten tiles from a person with Hygiene 0 and Comfort 15. After the walk Comfort is net negative at the authored length and net positive at the fill length, so only the fill length puts the fixture in Comfort's critical-relief group in the decision telemetry. An earlier version of this record said no test covered that call site, because the relief mask depends only on the sign of the net change; the slow-rate fixture is what makes the sign differ.

## Fill: what the faster shower does to scoring

Ordinary scoring weighs the authored delta over the authored duration and does not cap the delta at the need's deficit, so raising the authored rates raised the three actions' per-tick scores (about 3.5 times for the shower's Hygiene and 3.7 times for its Energy cost, 3.2 times for the bath, 1.7 times for the toilet). Two scenario tests on the shipped content check that this does not let a shower beat a more urgent need; both pass and stay as regression tests. They assert thresholds (the more urgent need's actions above 50 percent of the choice and the shower below 10 percent); the exact figures below come from a run of the same two tests with the chances printed, saved as `pr2-scoring-scenarios-chances.log` in the local evidence directory (the printing was temporary and is not in the repository):

1. `a_person_with_critical_energy_and_low_hygiene_sleeps_rather_than_showers`: with Energy 8 and Hygiene 30, the double bed gets 99.2 percent of the choice and the shower 0.08 percent.
2. `a_starving_dirty_person_who_gets_little_from_showers_eats_first`: with Hunger 8, Hygiene 30 and a Hygiene satisfaction multiplier of 0.5, the fridge gets 95 percent and the shower 2.3 percent.

These cover critical needs, where the critical-need policy keeps unrelated actions to a few percent. They do not cover a person whose needs are all merely low, where a shower now competes harder with every other action; that is the 10 percent rise in showers and baths in the measurements above.

## Fill: the week-one Bladder rise on seed 1

Bladder critical ticks on seed 1 over the first 10080 ticks went from 60 to 899. To find a cause, the trace tally gained a line that classifies what a housemate was doing on each tick their Bladder was at or below 20 (`BLADDER CRITICAL, what housemates were doing on those ticks`). Seed 1, 10080 ticks:

| What they were doing | Before | After |
| --- | --- | --- |
| Walking | 60 | 20 |
| At work or commuting | 0 | 500 |
| Blocked, waiting for an occupied target | 0 | 377 |
| Using a bathroom fixture | 0 | 2 |

The 899 ticks are one housemate: Casey's Bladder reached 0 and the other two stayed above 20 (per-person need bands in the same trace). A bit over half of the critical time (500 ticks) was at work or commuting, where a person cannot reach a bathroom and drains at half rate, so she went into a shift with a low Bladder. The rest (377 ticks) was the trace's blocked state, waiting for an occupied target. The trace does not record which target, so it is not established that the wait was for a bathroom fixture, nor why she started the shift low. The wait tally for all objects on seed 1 rose from 795 ticks to 1514 (2.6 to 5.0 percent of housemate time). This is a description of one housemate's one stretch in one seed. It is not evidence for or against the change raising Bladder crises in general. Coordinator decision, 2026-11-15: most of this stretch is time at work, which issue 309 addresses; seed 1 is to be measured again after 309 ships. The 377 blocked ticks remain unattributed.


## Fill: checks on the merged tree

The fill change was merged with the drain change at f9b33b2ea (itself merged with main at 54cf96b46) and checked on head f2cafffdc.

1. Full local check, `scripts/check-local-ci.py run`, all six groups (docs, scripts, art, rust, site, web), 29 steps, every step exit code 0. The report says state passed, complete true and source_changed false. Report: `D:/VIBES/.worktrees/twcl-315-logs/pr2-ci-final.json`, sha256 `80049e4fc87c8d67844d2cdd0003df8d644e239e03dc5054cbcab6261c08b5aa`. Three earlier full runs on this branch failed on real findings and are kept beside it: `pr2-ci-failed-1-e3b43f5b8.json` (the terri-wasm domestic prefix test), `pr2-ci-failed-2-ce880b374.json` (the player reference review of that test's new hash) and `pr2-ci-failed-3.json` (the type check could not run because the new worktree had no web dependencies, then two shower tests encoded the old shower length). Each is described above or in the commit that fixed it.
2. The manual twenty-day activity log check, `cargo test --release -p terri-sim --lib -- activity_log_never_changes_the_world_over_twenty_days --ignored --test-threads=1`, passed on the same head: 1 passed, 0 failed, 61 seconds. It requires a nuisance episode in the twenty days and found one. Log: `D:/VIBES/.worktrees/twcl-315-logs/pr2-twenty-day-release-final.log`.
3. The inherited-runtime fixture proof ran on the merged tree before the fixture was regenerated: with the fill limit left out of the tuning and the three bathroom actions put back to their authored numbers, the current pack encoded to exactly main's 26134 bytes (SHA-256 5e779fbb7a08c0693d2d76eafd20dffe9cb43bb5066dcf8654d321794b09afe8). Logs: `pr2m-fixture-prove-2.log`, `pr2m-fixture-write.log`.

The reports and logs live in local storage next to the other evidence and are not part of the repository. Later commits on this branch changed documentation only.
