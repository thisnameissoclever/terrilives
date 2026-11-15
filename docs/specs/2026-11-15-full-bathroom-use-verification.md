# Verification record: slower need drain and full bathroom use

Dated verification for [the specification](2026-11-15-full-bathroom-use.md), issue 315. This record covers the drain change. The fill change adds its own section when it lands.

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

Bathroom use lengths are unchanged by this change, as expected: the drawn length does not depend on the drain. Mean toilet length was 20.1, 18.3, 20.6 and 21.2 ticks before and 19.9, 20.0, 21.7 and 19.6 after; mean shower length was 71.3, 71.8, 82.2 and 75.7 before and 80.2, 66.5, 72.0 and 74.8 after. Those differences are draws on different household histories, not a rule.

Full logs are kept outside the repository with the local check reports.

## Drain: pinned values that moved, and why

Every moved value below moved for one cause: each base need drain rate is three quarters of its old value, so needs cross their thresholds at different ticks and the household's choices, and the random draws they spend, differ from the first minutes. No digest encoding changed and no simulation code changed. Each new value was read from the failing assertion and then confirmed by a passing run.

| Value | Where | Old | New |
| --- | --- | --- | --- |
| Fixed-scenario world hash `GOLDEN` | `crates/terri-sim/src/lib.rs` | 4733362429942472337 | 15287039064284998688 |
| Its release-WebAssembly twin | `web/tests/bridge.test.ts` | 4733362429942472337 | 15287039064284998688 |
| Shipped household through Thursday, `SHIPPED_THURSDAY` | `crates/terri-sim/src/job_search_tests.rs` | 17769474122166916875 | 15679464342224380920 |
| Standard-shift hash, `STANDARD_ONLY_HASH` | `crates/terri-sim/src/save/v21_tests.rs` | 1877760251232896320 | 12407989054242721803 |
| Two-day activity log fold | `crates/terri-sim/src/activity_log_tests.rs` | 0xa0fb_785a_e3a4_7b1d | 0x1f5f_7875_d990_cea9 |
| Twenty-day activity log fold (release, manual) | the same file | 0x78e8_cb74_b70c_d742 | 0x9edb_b19f_679e_fd4b |

The draws and jobs in `SHIPPED_THURSDAY` (seven careers draws, two shift draws, the three jobs and shifts) did not change.

Unchanged on purpose, and asserted by their existing tests: the published schema-fifteen control hash 4676206450852028819 (it sets its own drain in `pre_balance_content`), the bare-agent hash, every save fixture's bytes, the content fingerprint, and `inherited-runtime.pack` with its pre-books pair. The inherited-runtime fixture compiles the live tuning and then overrides the drain with the published rates; its assertion of the live rates now reads the new numbers, and its bytes did not move.

Tests that encoded the old balance and were corrected:

1. `review_physical_terminal_reward_arrives_after_work_has_clamped_hunger_at_zero` starts hunger at 10 instead of 20. It needs 600 ticks of work to drain hunger to the floor, and at the new rate 600 ticks drain 18.6.
2. `review_physical_media_prediction_includes_the_actual_company_multiplier` uses a Social drain multiplier of 2.7 instead of 2. The test needs Social to fall faster than disliked company refills it; 2.7 times the new 0.013 is the 0.0351 that 2 times the old 0.0173 gave.
3. Two seating tests and one dining test read comfort, fun and energy decay from the shipped pack instead of a literal.
4. `conversation_balance_shipped_need_drain_is_two_thirds_of_previous_rates` now checks half of the original rates, since the rates are two thirds then three quarters of the original.
5. The two-day activity log check no longer requires a nuisance episode in the household's first two days, because with slower drain there is none. The manual twenty-day check requires one instead, and the emitter has its own test, `a_nuisance_episode_closes_at_the_end_of_the_day`. This moves one coverage assertion, it does not weaken the comparison: the log-on and log-off worlds are still compared tick by tick.

## Drain: red then green

`shipped_base_decay_is_three_quarters_of_the_balance_before_issue_315` was written first and failed on main's content with "hunger drains 0.041333333 a tick; three quarters of the old 0.041333333 is 0.031". It passes with the new rates. Mutation checks, each followed by a restore and a matching hash of `content/tuning.toml`: setting every rate to 0.8 times its old value fails with "hunger drains 0.033066668 a tick", and restoring only hunger to 0.0413333333 fails with "hunger drains 0.041333333 a tick".
