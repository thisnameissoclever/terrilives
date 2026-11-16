# Wages and bills verification

This record holds the calibration measurements, moved test expectations, mutation results and played findings for [wages and bills](2026-10-18-wages-and-bills.md) (issue 298). The figures were taken from 2026-10-24 to 2026-11-15 on a Windows 11 desktop running other work at the same time, so the timings are noisy; each says which builds it compares.

## Contents

- [Calibration traces](#calibration-traces)
- [Acceptance bands](#acceptance-bands)
- [Measured estimates](#measured-estimates)
- [Trace cost](#trace-cost)
- [Moved test expectations](#moved-test-expectations)
- [Targeted mutation results](#targeted-mutation-results)
- [Mutation sweep](#mutation-sweep)
- [Played pass](#played-pass)
- [Review dispositions](#review-dispositions)
- [Final review of `901cbf3fd`](#final-review-of-901cbf3fd)
- [Third round: the month length redesign](#third-round-the-month-length-redesign)
- [Fourth round: fixtures, overflow and the twin](#fourth-round-fixtures-overflow-and-the-twin)

## Calibration traces

Each run is `target/release/examples/trace.exe 40320 <seed>` for the three-earner household, or `trace.exe 40320 <seed> - solo` for the shipped worker alone, where the `solo` scenario turns job search off for Bill and Casey before the first tick. Seeds 20260728, 1, 2 and 3 each ran 28 game days, four billing months. On every seed the three-earner search hired Bill as a kitchen porter on the late shift and Casey on the night watch's `weekend_nights` shift; Tim kept the office day shift. In the solo runs Bill and Casey stayed unemployed. Nobody died.

The trace's `BILLS` section reports, for each issued month, the four bills, their late fees and payment days, the month's use counts, object-days and trips, and the income earned while the month ran. Income is every rise in Funds, with bills paid on the same tick added back; the starting funds are not a rise.

The calibration ran three times. The first two ran on the branch after it merged main at `318da27c6`, first with the indoor rent rate of $1.10 a tile and no starting funds, then with the owner's rulings 17 and 18 of 2026-10-24 applied, an indoor rate of $0.90 and $400 of starting funds. Those two behaved identically, because neither the rent rate nor Funds changes any choice. At $1.10 the shipped worker's bills were 53.0 to 54.0 percent of his actual earnings, 3 to 4 points over the band, which is why ruling 17 lowered the rate.

The third and final reading was taken on 2026-10-25 at `0d0fd3d1a`, after the review of the branch changed the month bookkeeping and the hash, and it contains main as of `afbe98af3`. The simulation of the final head is the simulation that ran: main has changed no Rust or content file since `afbe98af3`, and the branch changed after `0d0fd3d1a` only the overview's exported due-day fields (`pending_due_day` and `pending_overdue_from_day`), their boundary tests and the web shell, none of which a tick reads. The traces are saved in the local scratch folder and are not part of the repository. Every bill in all 32 months of the final reading was paid on its due day, and no late fee was added.

| Run | Income a month | Bills a month | Share of income | Share in each of the four months | Electricity usage | Water usage |
| --- | --- | --- | --- | --- | --- | --- |
| Three earners, seed 20260728 | $1,752.25 | $390.61 | 22.3% | 22.7, 22.3, 22.4, 21.7 | 23 to 25% | 48 to 54% |
| Three earners, seed 1 | $1,753.76 | $391.09 | 22.3% | 23.4, 21.7, 22.2, 22.0 | 24 to 27% | 48 to 55% |
| Three earners, seed 2 | $1,732.06 | $390.58 | 22.5% | 24.0, 21.8, 22.2, 22.3 | 19 to 26% | 51 to 53% |
| Three earners, seed 3 | $1,730.45 | $391.15 | 22.6% | 23.9, 21.8, 22.7, 22.1 | 23 to 26% | 50 to 53% |
| Tim alone, seed 20260728 | $749.53 | $366.73 | 48.9% | 47.9, 48.7, 50.2, 49.0 | 25 to 28% | 55 to 59% |
| Tim alone, seed 1 | $767.15 | $366.68 | 47.8% | 48.0, 46.7, 48.2, 48.3 | 27 to 30% | 53 to 56% |
| Tim alone, seed 2 | $766.40 | $366.47 | 47.8% | 48.2, 47.7, 46.9, 48.5 | 26 to 29% | 53 to 57% |
| Tim alone, seed 3 | $775.21 | $366.13 | 47.2% | 48.1, 47.0, 46.8, 46.9 | 25 to 29% | 53 to 59% |

The share of income is the four months' bills over the four months' income. The final reading replaces the second reading's table, which was taken before the branch merged main's sleeping-partner and fight changes and differs from it by up to two points (Tim alone on seed 1 read 48.7 percent then and 47.8 percent now, and on seed 3 48.9 then and 47.2 now). The raw figures, month by month, come from the traces' `BILLS` sections.

## Acceptance bands

[WB-numbers] accepts the shipped values when the three-earner household's bills are 18 to 26 percent of its income with every bill paid on its due day, the one-earner household's bills are 35 to 50 percent of Tim's actual earnings with every bill paid within its grace period, water usage is 30 to 65 percent of the water bill and electricity usage 15 to 40 percent of the electricity bill. Ruling 17 made actual earnings the reading for the one-earner band, and ruling 23, decided by the coordinator on 2026-10-25 following the owner's take-home-pay ruling of 2026-10-24 and confirmed by the owner on 2026-11-15, reads the band as the average over the measured months of a run.

- Three earners: 22.3 to 22.6 percent over the four months of each seed, and 21.7 to 24.0 percent in every single month, every bill paid on its due day. Passes on either reading.
- One earner: 47.2 to 48.9 percent of Tim's actual earnings of $750 to $775 a month over the four months of each seed, every bill paid on its due day. Passes on the average, which is ruling 23's reading. One month is outside 35 to 50 percent: the third month of seed 20260728 reads 50.2 percent, because Tim earned $735.37 that month, the least of any month of any solo run. The other fifteen solo months are 46.7 to 49.0 percent. At $1.10 the average was 53.0 to 54.0 percent; on the nominal reading of five shifts at $180 it is 40.7 percent.
- Water usage 48 to 59 percent and electricity usage 19 to 30 percent of their bills in every month of every run. Passes.

Condition 3 of [WB-numbers], a tiny house saving at least a third, is a design estimate rather than a trace: at $0.90 the 4 by 4 house of [WB-rent] saves the three-earner household 32 percent, just short of a third, as [WB-numbers] records.

## Measured estimates

[WB-numbers] gave three figures as estimates. Measured per seven-day month, identical in both calibration runs:

| Figure | Estimate | Three earners | Tim alone |
| --- | --- | --- | --- |
| Dish washing | 2 | 10 to 18 | 9 to 20 |
| Trips to work | 13.5 | 14 in the first month, 15 after | 5 |
| Usage with one earner | as three earners | electricity $37.57 to $42.10, water $37.90 to $43.65 | electricity $39.23 to $42.34, water $41.05 to $46.70 |

Dish washing counts each Wash dishes step, which runs far more often than the estimate. At 20 cents of water each, the three-earner household's 10 to 18 washes a month add $2.00 to $3.60 to the water bill. Housemates at home all day use slightly more water and electricity than housemates at work, as the spec expected. The final reading's counts stay close to these: dish washing 10 to 17 a month with three earners and 10 to 22 with Tim alone, 14 or 15 trips with three earners and 5 with Tim alone.

## Trace cost

`trace.exe 12000` ran three times on main at `318da27c6` and three times on the branch at `824df5487`, alternating, each built in release with `cargo build --release -p terri-sim --example trace`. Main took 12.03, 12.38 and 12.09 seconds, a median of 12.09; the branch took 12.03, 12.12 and 12.23 seconds, a median of 12.12. The branch is 0.2 percent slower, inside the 5 percent the plan allows. The branch's trace also runs the new BILLS summary each tick.

## Moved test expectations

Every moved value belongs to one of the classes of [WB-determinism]. The four hashes below were classified again on 2026-11-15 on the merged head `eabccaa65`, after the review's changes to the bills hash. The run set the old wages in `content/careers.toml`, `night_shift_premium_percent = 0`, `starting_funds_cents = 0` and the three bills functions that act on a tick or the hash (`begin_day`, `pay_due` and `hash`) to return before doing anything, and set the four pins to main's values. The two-day fold, shipped Thursday and standard shift tests passed in debug at optimization level 1, and the twenty-day test passed in release with `--ignored`, so with those edits the branch reproduces main's four values exactly. Main has changed no Rust or content file since `afbe98af3`, so these are also main's values at `053ee52d3`. All six edited files were then restored from copies, and their SHA-256 digests matched the originals. The run is `exp_classify2.py` in the local scratch folder, which is not part of the repository.

| Test | Main's value at `afbe98af3` | Branch value | Class and cause |
| --- | --- | --- | --- |
| `activity_log_never_changes_the_world`, two-day fold | `0xa0fb_785a_e3a4_7b1d` | `0xb953_34a8_9aca_0e2c` | Wages, premium, starting funds and bills hash, including the open month's length and start and each bill's terms |
| `activity_log_never_changes_the_world_over_twenty_days` (release, ignored) | `0x78e8_cb74_b70c_d742` | `0x9b22_0f1c_a448_e32c` | Wages, premium, starting funds, bills hash, bills paid on days 7 and 14 |
| `the_shipped_household_hash_and_draws_through_thursday` | 17769474122166916875 | 4873052259007802963 | Wages, premium, starting funds and bills hash; draws and jobs unchanged |
| `the_hash_is_unchanged_while_everyone_holds_the_standard_shift` | 1877760251232896320 | 3704503324967516506 | Wages, starting funds and bills hash |
| `every_search_on_keeps_published_hires_schedules_and_career_randomness` | pay 120, 120, 80; open shifts 12000, 12000, 8000 cents | 180, 180, 120; 18000, 18000, 12000 | Wages |
| `the_shipped_careers_hold_eight_paths_with_the_first_twelve_rows_unchanged`, `the_five_new_paths_match_the_spec_tables` | issue 296's pay | the same rows raised by half | Wages |
| `the_shipped_household_keeps_living_around_its_jobs` | day pay for every shift; Funds equal to pay | night premium for the night watch; Funds emptied first, then Funds plus the first month's paid bills equal to pay | Wages, starting funds and bills |
| `a_weekend_commute_loads_and_the_next_shift_waits_for_monday` | no bills | runs with every charge at zero | Bills: its thirty-tick days end a month at tick 210, inside the window it checks |
| Three command submission round trips | schema 17 | schema 22 | Bills: the schema-17 projection has no bills record |
| `inherited-runtime.pack` fixture | 25,708 bytes | 26,134 bytes | Pack layout, wages and starting funds; the proof omits the appended fields and maps old pay to new |
| WebAssembly tests that read the current save header or payload: character, job search, player order, room save, book, schema-3 and schema-6 tests | schema 21, and 22 as the future version | schema 22, and 23 as the future version | Schema 22 |
| WebAssembly move-in funds in `lib.rs` | 0 | 400 | Starting funds |
| `immutable_v14_rooms_preserve_source_state_and_current_continuation`, `review_authentic_land_careers_and_money_keep_their_actual_source_values` | the schema-14 fixtures' pay as saved | that pay raised by half | Migration |
| Web: Tim's full pay in `bridge.test.ts` and `portal-bridge.test.ts` | 12000 cents | 18000 cents | Wages and migration |
| Web: new-game Funds in `bridge.test.ts` | 0, then the pay | 40000 cents, then 40000 plus the pay | Starting funds |
| Web: the unaffordable item in `buy-tool.test.ts` and `build-context.test.ts` | any item, with Funds at 0 | an item dearer than the $400 a new household has | Starting funds |
| Web: the double bed's rotation check in `bed-sprites.test.ts` | yard tile (17, 8) | indoor tile (3, 8) | The bed rule |

One failure was a defect, not a moved value: after the room topology gained a variant that reads a layout an edit would produce, `RoomTopology::from_world` reported a missing layout before a missing grid. The original order is restored.

## Targeted mutation results

Each mechanism below was removed or disabled in the source, the test that guards it was run with `cargo test -p terri-sim --lib -- --test-threads=1 <test>`, and the file was restored and checked against its SHA-256. Every test failed with its mechanism gone and passes with it restored.

| Mechanism | Change | Test that failed |
| --- | --- | --- |
| A day is counted once, on its first processed tick | the day guard always true | `each_day_is_counted_once_on_its_first_processed_tick` |
| A pristine record stays out of the hash | the pristine check removed | `a_world_without_a_lot_stays_pristine_and_hashes_as_before` |
| Payment stops at the first bill Funds cannot cover | `break` replaced by `continue` | `payment_is_oldest_first_and_stops_at_the_first_unaffordable_bill` |
| The last late fee is reduced to meet the cap | the cap removed | `late_fees_round_up_to_the_cent_and_stop_exactly_at_the_cap` |
| Confirm refuses a bed left outside | the refusal removed | `confirm_refuses_a_batch_that_leaves_an_indoor_bed_outside` |
| A bed already outdoors in the baseline that did not move confirms | the exception removed | `confirm_ignores_a_bed_already_outside_in_the_baseline_that_did_not_move` |
| A schema-22 save is never migrated | the schema-22 guard forced on; removing it alone changes nothing, because the current loader never selects the migration | `a_schema_twenty_two_save_is_not_migrated_twice` |
| Open shifts' pay is migrated | the open-shift step removed | `loading_schema_twenty_one_migrates_pay_and_open_shift_cents` |
| A new game's first month is projected whole | the projection before the first tick removed | `the_first_month_is_projected_whole_before_the_first_tick` |
| An open month is never shorter than the days it has counted (S1) | the days-counted term removed from the month length | `a_save_from_mid_month_keeps_loading_and_building_after_a_month_length_change`, `a_save_loads_after_each_bills_tuning_change` |
| An open month keeps the longest length it was counted under (S3) | a plain assignment of the new month length | `a_shorter_month_keeps_the_open_months_length_and_the_next_takes_the_new`, and the two S1 tests |
| A month starts on its first counted day (S3) | the month start assignment removed | `a_month_starts_on_its_first_counted_day`, `a_shorter_month_keeps_the_open_months_length_and_the_next_takes_the_new` |
| An issued month's length is reset so the next one takes the new length (S3) | the reset removed | `a_shorter_month_keeps_the_open_months_length_and_the_next_takes_the_new` |
| The day start runs before payment in the real schedule (S3) | the day start moved beside payment | `a_trip_on_a_months_first_tick_is_billed_to_the_new_month` |

The last five rows ran on 2026-11-15 at `eabccaa65` with the same procedure, and every restored file matched its SHA-256. The runners and their logs are outside the repository.

The rows from "An open month is never shorter than the days it has counted (S1)" to "The day start runs before payment in the real schedule (S3)" above, and two mutants of the final review's first round (the panel's length and the projection's `max`, and the 730-day bound), tested the stored-maximum rule of the earlier review rounds. The month length redesign of 2026-11-15 removed that rule and its code, so those mutants no longer apply; the day-start schedule row still does. The redesign's own mutants are in [the third round](#third-round-the-month-length-redesign).

## Mutation sweep

`cargo mutants --in-place --in-diff` ran on 2026-10-25 against the branch's diff from `318da27c6` to `bdd6b65f1`, in this worktree only, with the test build at optimization level 1 so the whole `terri-sim` library suite ran in about 40 seconds per mutant (`CARGO_PROFILE_DEV_OPT_LEVEL=1`; tests ran with `--lib` for `terri-sim`). A driver ran small shards in priority order, recorded the SHA-256 of every tracked file under `crates/` and `content/` before the sweep, compared them after every shard, and started no new shard after 3 hours 40 minutes; the tree matched after every shard. It never used `git checkout`.

| Files and functions | Mutants | Caught | Missed | Unviable |
| --- | --- | --- | --- | --- |
| `bills.rs`: issuing, day start, payment, late fees, amounts, rent tiles, hash and terms | 144 | 136 | 7 | 1 |
| `attendance.rs` and `shifts.rs`: the night premium and the night pay line | 18 | 13 | 5 | 0 |
| `terri-data` `pack.rs`: `Tuning::shift_pay_cents` | 12 | 0 | 12 | 0 |
| `placement.rs`: the bed rule | 23 | 18 | 0 | 5 |
| `save/wage_migration.rs` | 27 | 24 | 3 | 0 |
| `mood.rs`: Behind on bills | 3 | 2 | 0 | 1 |
| `terri-data` `compile.rs`: the bills and tuning checks | 21 | 6 | 0 | 15 |
| `terri-core` `clock.rs`: billing months, tested with `terri-core` and `terri-sim` | 14 | 14 | 0 | 0 |
| `bills.rs`: `validate_saved` and `BillTerms::valid`, first of eight shards | 16 | 9 | 7 | 0 |

Three parts of the diff were not swept. The scope left out the display and projection code that the panel tests and the played pass cover (`lines`, `overview`, `next_bills`, `usage_cents`, `expected_month` and `last_month`) and the counting of uses and trips, which the counting tests cover. The deadline stopped the other seven `validate_saved` shards, about 106 mutants. The rest of the diff outside these files was not in scope.

Every survivor now has a test, added in `Test what the bills mutation sweep found untested` and `Refuse an open month counted past its own month length`, or a reason:

- `Bill::total_cents`: `an_overdue_bill_needs_its_amount_and_late_fees_to_be_paid`.
- `start_day`'s month issue on a skipped boundary: `bills_issued_after_a_skipped_boundary_are_due_on_the_months_first_day`; its two daily-list mutants: `a_month_without_daily_objects_keeps_an_empty_daily_list`.
- `start_day`'s `bills.daily.len() < daily.len()` replaced by `<=`: equivalent, because resizing a list to its own length changes nothing.
- The hash's paid day: the hash test now tells a bill paid on day 0 from an unpaid one.
- `BillTerms::valid` and the open month's range checks in `validate_saved`: `refuses_a_bill_with_terms_the_compiler_would_refuse`, `refuses_an_open_month_outside_the_compiler_range` and a two-day month with three counted days in `refuses_more_month_days_than_a_month_or_than_have_passed`.
- `migrated` and the record match in `migrate_attendance`: `only_an_old_pay_whose_raise_lands_in_the_range_migrates` and `migrate_attendance_raises_each_open_shift_to_its_own_persons_record`.
- `night_pay_cents`: `night_pay_is_the_held_pay_with_the_premium_and_absent_by_day`.
- `Tuning::shift_pay_cents`: the `terri-sim` premium tests exercise it, but a `terri-data` mutant runs only `terri-data`'s tests; `shift_pay_adds_the_night_premium_to_night_shifts_only` now covers it there.

The 34 survivors, with four field-deletion mutants the filter also selected, were then run again in place against the new tests: 36 of the 38 were caught. One of the two left is the equivalent `<=` mutant above. The other, an open month counted past its own length, gained the two-day month refusal, checked by applying its mutant by hand, running the test (it failed) and restoring the file by content with a matching SHA-256.

## Played pass

The branch's production build at `bdd6b65f1`, with the $0.90 indoor rate and $400 starting funds, was played on 2026-10-25 in headed, muted Google Chrome driven by Playwright, one browser at a time, served on its own port. Desktop captures are 1280 by 800 and phone captures 375 by 812 with touch; a landscape phone at 812 by 375 and a tablet at 1024 by 768, both with touch, were also checked. The selected captures, the saved states used and what each capture shows are in [the evidence folder](../evidence/2026-10-24-wages-and-bills/README.md). Every [WB-played] point was played:

1. The Bills row read `$316 due Day 8` on a new game's first day with Funds of 400, `$388 due Day 15` once Day 8's bills were paid, `$351 due Day 15` on Day 17 while the second month's bills were unpaid within their grace, and `$386 overdue` in the danger color on Day 21, at both widths. The bills are issued and paid on the same tick when Funds cover them, so the row never reads the due day itself before payment.
2. The panel showed keep aside, overdue bills with fees, the payment-order note, the next bills with every line open, last month and how bills work at both widths. On Day 17 it read `Unpaid bills due Day 15 are overdue from Day 20.` Each bill's lines add up to its amount so far in every capture. On the phone the dialog's content was 349 pixels wide inside the 375-pixel viewport with no sideways scroll; the Bills button, the Close button and the summary line that opens each bill measured 44 pixels tall on the phone, the landscape phone and the tablet.
3. Funds were $2,108.34 at 23:44 on Day 7, after a late shift's pay, and $1,720.63 at 00:00 on Day 8, exactly the $387.71 the panel showed, and Last month listed the four bills as paid Day 8.
4. Tim's mood list showed Behind on bills at minus 8 while the bills were overdue.
5. The schema-21 bed on the yard previewed in place with no refusal when selected in Build, and `Beds can only go inside a room.` when moved to another yard tile. It moved into Bedroom 1 and confirmed. After the wall between Bedroom 1 and the porch was removed, Confirm showed `The bed (Standard Double) would be left outside. Move it into a room, or choose Cancel, before confirming.` (retaken on 2026-11-15 with the final wording, which names the bed's type first and its model second) and the draft stayed open. A room then built on the yard in the same session, with a doorway, took the bed, and the batch confirmed.
6. From the yard-bed save, removing the same wall while Bedroom 1 was empty reached the room review and confirmed, because the bed already outdoors did not move. Expected rent fell from $255.20 to $233.60 with 156 indoor tiles instead of 192, and on Day 2 the tile lines read 174 indoor tiles a day on average and rent's lines added up to its $69.32 so far.
7. The night watch worker's Career tab read `$105 per shift, from $105 to $128 at this level. Night shifts pay 15% more: $120.75 per shift.`
8. The schema-21 night-shift save loaded with the office clerk at $180 and Casey, the night watch guard, at $105 with her open night shift at the raised pay; the schema-21 yard-bed save loaded with the double bed on its yard tile. The two are separate committed fixtures, and `the_authentic_schema_twenty_one_fixtures_load_with_migrated_pay` checks the raised pay in all three.

The phone row held `$10,000 due Day 1,000`, set into the live row by script to measure the longest value, on one line, 128 pixels wide within the 182-pixel panel. The player guide's overview, guide shortcut, Build, Furniture and save status captures were retaken on the same build with the Bills row, on a new game run to Day 1, 09:00. They were retaken once more on 2026-11-15 on the final head's build (headless, muted Chrome, one browser at a time, its own preview port, closed afterward), because the review found a housemate's bubble behind the phone speed buttons. The phone captures were taken only when a pixel check of the speed-button strip matched a strip known to be clear, which needed three tries and ended at Day 1, 09:22. The phone Furniture capture scrolls the panel so the Colour dropdown shows whole above the sticky Cancel and Confirm row, because that row covered the dropdown and left a bare Colour label at the panel's top position; the guide crop is the whole panel from that capture, and the desktop crop is unchanged. Every retaken capture was opened at full size and checked for bubbles over the controls, clipped text and the Bills row's value.

**Findings fixed during the passes.**

- **F1, a new game's first projection.** Before a new game's first tick counted Day 1, the projection counted only the six days after it, so the row read a smaller amount under the opening guide than once the game ran. The month is now projected from today until a day is counted, and `the_first_month_is_projected_whole_before_the_first_tick` fails without the fix.
- **F2, `1 days`.** Daily lines read `Fridges: 1 days x $0.20` on the first day of a month; a single day now reads `1 day`.
- **F3, keep aside with unpaid bills.** With overdue bills the sentence named only the next due day, although the amount includes the overdue bills. It now reads `for the unpaid bills and the bills due Day {n}` whenever a bill is unpaid.
- **F4, expandable bills.** The bill rows' grid layout hid the disclosure marker, so nothing showed that a bill opens into its lines. Each bill name now carries a marker that turns when the row opens.

**Behaviors decided in review.** Rulings 18 to 21 of [WB-rulings] settle what the first pass recorded for the owner: a new game starts with $400, so Day 1 shows no shortfall; every bill's lines add up to its amount so far; an outdoor bed from an older save is refused only when moved or turned, or at Confirm; and two behaviors stay as specified. In a game's first month the expected electricity counts the fridge, lamps and aquarium only for the days so far, so it rises by a few cents a day (`$30.35` on Day 1). A shift settled before the pay migration keeps the pay it was settled at, so the office clerk's tab can read `Earned $85.00` from the old rate beside `$180 per shift` after loading an older save.

A fresh independent reviewer read the final captures against the [WB-played] points and the guide entries with no expected verdict, checking the arithmetic each capture makes checkable. It confirmed the rows, panels, fees, totals, rent figures, refusals and crops. Its gaps, the Day 8 fall in Funds, the bed in a room built in the same session and phone captures with the bills open, are closed by `d08`, `d09`, `d28`, `d29` and `p15`; the Last month lines' fee clause is now in [WB-panel]. Its notes on earlier behavior are outside this change: the phone speed buttons are faint over the scene and can sit under a housemate's bubble, the Funds row has no dollar sign, Build's sticky footer covers the Shortcuts line and the phone sheet's Colour dropdown, and Build spells Colour in British English.

## Review dispositions

Two fresh reviewers read `fc6d02659` without being told what to expect, one the simulation and save side and one the web, documentation and visuals. Their findings are numbered S1 to S5 and W1 to W9 here. Every finding held up. The review of the first round, with its F and R numbers, is in the [played pass](#played-pass) and the commits before `fc6d02659`.

| Finding | What the reviewer found | Disposition | Commit |
| --- | --- | --- | --- |
| S1 | A month length changed from day 12 of a month made the game refuse its own saves and Build for lengths 4, 5, 6, 8, 9 and 10, and charged about 1.1 months of rent in the 10-day case | Fixed at the time: the open month's length was the longest it was counted under and at least the days it had counted. The [third round](#third-round-the-month-length-redesign) replaced that rule with a month length fixed when the month opens. The reviewer's probe of seven month lengths is a regression test, and the tuning-change test now saves and loads every day | `3c1736687` |
| S2 | The world hash left out the open month's length and start and each bill's issued-under terms | Fixed. They are hashed in saved order, the hash test changes each one, and the four pins moved again with the same classification, which the 2026-11-15 run above confirms | `9c5ff53e3` |
| S3 | Four mutants survived: the day start moved beside payment, a plain assignment of the month length, no month start, no length reset on issue | Fixed. Tests drive the real schedule and the month bookkeeping, and all five mutants, S1's included, are caught on 2026-11-15 (the [targeted mutation results](#targeted-mutation-results)) | `cd04aa9fa` |
| S4 | The ignored Build search failed at seed 16 on the bed rule's intended refusal | Fixed. The search cancels a batch the bed rule refuses and goes on; all 24 seeds pass and seed 16 cancels one batch | `0d0fd3d1a` |
| S5 | The calibration table did not match the final head, and one month of one seed read 50.2 percent | Re-recorded at the final head in [calibration traces](#calibration-traces). The one-earner band is read as the average over measured months (ruling 23, confirmed by the owner on 2026-11-15); the 50.2 percent month is named in [acceptance bands](#acceptance-bands) | the commit of this record |
| W1 | The player guide's Bills section lacked the unpaid row and the overdue-from note | Fixed in the guide | `606a48899` |
| W2 | The visible strings register held the old note and tile lines and lacked the new strings | Fixed. The register takes the current proposed rows for the owner's review | `606a48899` |
| W3 | The named-bed refusal was untested where it is wired: passing no name to the refusal kept every web test green | Fixed. A `BuildSession` test drives a refusal that carries the bed's entity and checks the message, so passing no name fails it | `fa5236520` |
| W4 | A bunk bed was named only by its model | Fixed. The refusal reads type first and model second, for example `The bunk bed (Basic Oak) would be left outside.`; `d27` shows `The bed (Standard Double) would be left outside.` | `fa5236520` |
| W5 | The overdue-from note disappeared once any bill was overdue | Fixed. The overview exports the earliest unpaid bill that is not yet overdue, and the panel says when it becomes overdue even while an older bill is | `33abebdc9` |
| W6 | The phone guide captures of the overview, save status and guide shortcut hid the 3x button behind a bubble | Fixed by recapture on 2026-11-15, with a pixel check that nothing sits behind the speed buttons | the commit of the captures |
| W7 | The phone Furniture crop ended on a bare `Colour` label | Fixed. The capture scrolls the panel so the Colour dropdown shows whole above the Cancel and Confirm row, and the guide crop is the whole panel. A reviewer of the first fix found the full-frame capture still ended on the bare label; it was retaken | the commit of the captures |
| W8 | Four mutants survived with no test: the month length passed to a bill row, the null-days check, the touch-size media query and the phone header offset | Fixed with fixtures where the month length differs from the tuning's, where unpaid cents disagree with the days, and stylesheet assertions for the query and the offset | `33abebdc9` |
| W9 | The tile lines never said "a tile" | Fixed. They read `at $0.90 a tile a month`. This is proposed copy for the owner's review | `33abebdc9` |

The `d27` capture was retaken for W4 and carries the same text as the record's played-pass point 5.

## Final review of `901cbf3fd`

A last fresh review of `901cbf3fd` found no blocker and these items, numbered as the coordinator sent them.

| Item | What the reviewer found | Disposition | Commit |
| --- | --- | --- | --- |
| 1 | After a month length change the panel disagreed with what is issued: a bill's lines divided by the tuning's month length, and the expected amounts left the month's length at its old value while adding the remaining days (a probe with the tuning at seven and nine days counted under ten showed 1,286 where 900 was so far, and 1,400 expected against 1,000 issued) | Fixed in `d7876bea6`, then replaced by the redesign of the [third round](#third-round-the-month-length-redesign), which divides by the stored length only and projects to the month's fixed end | `d7876bea6`, then the redesign |
| 2 | A saved open month longer than 365 days was refused, though the compiler accepts a month of 365 days and a month can run to the next boundary of another length | Fixed in `601c15784` with a 730-day bound, then replaced by the redesign of the [third round](#third-round-the-month-length-redesign), under which a month never counts past its own end and `month_length` stays within 1 to 365 | `601c15784`, then the redesign |
| 3 | The Build search's new bed arm counted refusals and asserted nothing | Fixed. The search asserts that at least one batch is cancelled for a bed left outside across the default 24 seeds. The 24 seeds ran once in release with `--ignored` on 2026-11-15 and passed, 524 seconds, and only seed 16 cancelled a batch (one). An earlier run of the same seeds was cut off by its time bound after seed 21 while the machine was busy, with seeds 1 to 21 passing; seeds 22 to 24 then passed alone | `82e85b0e9` |
| 4 | The V22 notes of `docs/ARCHITECTURE.md` omitted the open month's start and length and each bill's issued-under terms, and three pin comments named an older main commit | Fixed. The notes list them and the three comments name `053ee52d3`, main's current commit | `727b45bca` |
| 5 | Ruling 23 was not marked as unconfirmed | The owner confirmed it on 2026-11-15, so the spec records it as decided by the coordinator on 2026-10-25 and confirmed by the owner on 2026-11-15, with the 50.2 percent month accepted | the commit of this record |
| 6 | The full-frame phone Furniture capture still ended on a bare `Colour` label above Cancel and Confirm | Fixed. The panel is scrolled so the Colour dropdown shows whole above the row, and the guide crop is the whole panel. I opened the capture at full size | the commit of the captures |

## Third round: the month length redesign

The review of `ebe94f194` found two more edge cases in the stored-maximum design and one wrong claim of this record. This was the third round on one mechanism, so a separate reviewer was asked for a simpler design.

- **M1.** `expected_month` took the days left from the tuning's month length when that was longer than the stored one: stored 10, nine days counted, tuning 30, and the projection used a length of 28 where the issue uses 30, overstating Expected, keep aside and the shortfall by up to 2/30 until the next counted day.
- **M2.** Alternating tuning changes (7, then 365 on day 6, then 300, then 365, then 300) pushed an open month past 730 days, which the validator then refused.
- **L1.** This record said `a_month_length_of_365_after_seven_day_months_keeps_every_save_loadable` failed with the bound put back at 365. It did not: only `an_open_month_may_run_past_the_compilers_longest_month` did. The claim was wrong, and that test is rewritten below.

**Decision.** Coordinator decision of 2026-11-15, chosen from an independent design review (route R1) and awaiting the owner's confirmation; the owner has not ruled on it ([WB-rulings] ruling 24 in the spec): a content change to the month length applies from the next month, and a realigned first month is short and charged pro rata. A month's start and length are fixed when its first day is counted, its end is `start - start % length + length`, it is issued when today reaches that end, and the next month opens on that day under the tuning's length at that moment. The stored-maximum rule and the 730-day bound are gone, and every month has one length.

**Shipped behavior is unchanged.** With the shipped seven-day months and every day counted, a month starts on a multiple of 7, so its end is the same day as before. No saved value and no hash input changes for a game that never changes its month length, so no pinned hash moves; the full local CI run records that.

**Tests.** `an_open_month_may_run_past_the_compilers_longest_month` is deleted, and a refusal of `month_length` 366 replaces it. The new and rewritten tests are:

| Test | What it asserts |
| --- | --- |
| `a_shorter_month_runs_to_its_own_end_and_the_next_opens_under_the_new_length` | with the tuning at 4, a month saved under 7 runs to day index 14 under 7, issues there with its own length, and the next month opens on 14 under 4, ends on 16, and is charged two of four days |
| `the_panel_follows_a_months_own_length_after_a_month_length_change` | nine days under a length of ten with the tuning at seven: the lines add up, the expected amounts are a full month, and the next bills are due on day index 10 |
| `a_save_from_mid_month_keeps_loading_and_building_after_a_month_length_change` | the probe of a save on day 12 under 7 loaded under 4 to 10 and 30 now also asserts the issue day (14) and the next due day |
| `a_month_length_of_365_after_seven_day_months_issues_at_its_own_boundary` | the seven-day month issues at its own boundary and the next opens under 365 and aligns to it |
| `refuses_an_open_month_outside_the_compiler_range` | `month_length` 366 and 0 are refused |
| `refuses_a_month_counted_to_or_past_its_own_end` | a record counted to or past its end is refused |
| `refuses_a_bill_with_terms_the_compiler_would_refuse` | a grace of 365 is refused and a grace of 20, longer than the month, loads |
| `the_month_length_sequence_7_365_300_365_300_keeps_every_save_and_projection_right` | the sequence on fixed days, a save and a load every day for 1,000 days, every load succeeds, `month_days <= month_length <= 365`, no issued transportation base charge exceeds a full month, and on each month's last counted day the panel's Expected equals what is then issued |
| `month_lengths_changing_every_few_days_keep_every_save_and_projection_right` | the same over 150 days of lengths 7, 3, 10, 5, 30, 4, 1 and 9 |

**Against the old code.** The new tests were run on `ebe94f194`'s `bills.rs`, with a three-line `month_end` helper the tests call, on 2026-11-15. Eight of nine failed there: the shorter-month test, the panel test, the 365 test, the probe, both fixed-day runs, and both range refusals. The ninth, the bill-terms test, passed there because a grace of 365 was refused by the old rule too; it gained the grace-of-20 case afterwards, and a mutant (below) shows it now fails when the grace must stay under the month. The 365 test, whose old version did not fail with the bound back at 365 (L1), now fails on the old code.

**Mutants of the redesign.** Seven mechanisms were removed or changed in `bills.rs` and the targeted tests (`bills::` and `save::v22`, 75 tests, all passing on the unmutated design) were run; each mutant failed at least one test:

| Mechanism | Change | Tests that failed |
| --- | --- | --- |
| A month keeps the length it opened with | the length is not stored when a month opens | 13, among them the shorter-month test and the long run of debt and recovery |
| The projection counts to the month's own end | the days left use the tuning's length | the panel test and both fixed-day runs |
| A save counted at its end is refused | the `day >= end` refusal removed | `refuses_a_month_counted_to_or_past_its_own_end` |
| A month's bills are due on its end day | the due day is today | `bills_issued_after_a_skipped_boundary_are_due_on_the_months_first_day` |
| A bill carries the length of its own month | the tuning's length is used | six, among them the shorter-month test, the 365 test and the sequence run |
| A bill's grace need only stay under 365 | the grace must stay under the month | `refuses_a_bill_with_terms_the_compiler_would_refuse` and the every-few-days run |
| The next bills are due when the open month ends | the tuning's next first day | the shorter-month test and the panel test |

**The file was restored byte for byte.** One earlier run of these mutants was stopped partway through its first mutant to fix a wrong assertion in the probe test, which left `bills.rs` mutated. Before anything was committed, the restore was proven in two ways. The mutation's replacement text was present once and its original text absent, and I reversed that one replacement by hand. Then the design edit script was re-run on a temporary copy of `ebe94f194`'s `bills.rs`, and the copy's SHA-256, `d8302df3af998eeb5e3b4caebac13d4f898d0d5059c3316669eab7aee9312673`, equals the hand-restored file's and a saved known-good copy's. `git diff ebe94f194 -- crates/terri-sim/src/bills.rs` was then read line by line against the design and held no stray edit. The rerun script takes a snapshot of the file and checks its hash first, restores every mutant from that snapshot (never with `git checkout`), prints that the hash matches after each mutant, and checks it once more at the end; every check matched `d8302df3af998eeb`.

**The web panel on a short month.** A web test (`tests/bills-panel.test.ts`, 15 tests passing) renders the real panel code with a month opened under a four-day tuning, two days counted and the bills due on day index 16: it reads `Due Day 17, Wednesday`, `Base charge, 2 of 4 days`, tile lines of `2 of 4 days` and `A month is 4 days.`, and the row reads `$425 due Day 17`. The panel code needed no change: its lines already read the stored month length.

## Fourth round: fixtures, overflow and the twin

A fresh review of the redesign (`ebe94f194` to `3a6b8f0f5`) found one test that breaks and three changes worth making.

| Item | What the reviewer found | Disposition |
| --- | --- | --- |
| F1 | `bills_exports_mid_month_with_an_overdue_bill` in `terri-wasm` built a mid-month record with `month_start` 0 and `month_length` 0, so under the redesign the first tick of day 12 issued a month and its overview expectations broke | Fixed. The fixture now has `month_start` 7 and `month_length` 7, as its own comment says ("the sixth day of the second month"). No other hand-built `Bills` fixture in any crate or in the web tests ticks. The 75 targeted terri-sim tests had never touched `terri-wasm`; its eight bills tests now pass, with the terri-sim `bills::` and `save::v22` tests (76) |
| F2 | Check every checked-in schema 22 payload that has a bills record against the new `day >= end` refusal | Checked, none to re-pin. Every checked-in save and hex fixture was scanned by its header (`TERRISAV` and the schema number): 351 payloads of schemas 1 to 21, none of schema 22 or later. The newest three are the schema-21 fixtures of `bills-v21`, which load through the migration with an empty bills record, so `validate_saved` does not see an open month in them |
| F3 | `month_end` computed `start - start % length + length` in `u32`, so a crafted save with `month_start` near `u32::MAX` overflowed inside `validate_saved` and panicked debug and test builds on untrusted input | Fixed. `checked_month_end` returns `None` when the end would pass the largest day index and `validate_saved` refuses the save; `month_end` saturates so nothing in play can overflow. `a_month_starting_at_the_end_of_the_day_numbers_is_refused_not_panicked_on` refuses starts of `u32::MAX` under lengths 1, 7 and 365 and of `u32::MAX - 3` under 365, and loads `u32::MAX - 1` under 1, the largest start with room. Its first version assumed a saturating end would refuse `u32::MAX - 3`; it did not, which is why the check returns `None` |
| F4 | The save-and-reload-every-day tests checked only invariants | Fixed. `exercise_month_lengths` and the 365 test run a twin world under the same per-day tuning that is never saved or loaded, and each day assert that the reloaded world's bills record, saved bills, Funds and world hash equal the twin's |
| Doc | The `SavedBill.month_length` comment still described the month its due day falls on | Reworded in `crates/terri-core/src/save_v22.rs` to "the length of the month this bill charges" |

**The twin comparison was proven with throwaway mutations on 2026-11-15.** Each was applied to the restore function of `bills.rs`, the `save::v22` tests were run, and the file was restored from a snapshot taken first (never with `git checkout`), its SHA-256 `6fe0670c7722a87083b7e8e4c76d4566eddbe725dbe62766e8e2e1c2eb1c1e6f` checked after each mutant and at the end. Dropping `month_start` on restore failed the 365 test with "day index 364: the bills record differs from the unsaved twin's", among others; dropping a bill's late fee failed the twin comparison at day index 364 and at day index 10. Dropping a bill's paid day was caught by the older round-trip tests but not by the twin tests, which is not a gap in the request, since the dropped `month_start` and the late fee show the comparison working. A first run of this script stopped on patterns that matched two places in the file, and a second on a syntax error before it touched anything; both left the file as it was, which its hash showed.

**Two things were left as they are on purpose.**

- The clause `month_days > end - month_start` in `validate_saved` stays, because the requirement lists it. No mutant can kill it: a record that passes `day < end` and `month_days <= day - month_start + 1` already has `month_days <= end - month_start`, so removing the clause changes no result.
- The rules sentence "A month is N days" keeps the tuning's length. It states the rule for months that open from now on, while the bill lines show the open month's own length.

**Checks of this round.** `cargo fmt --all -- --check` is clean, `cargo clippy --workspace --all-targets -- -D warnings` passes, and the terri-sim tests named above (76) and the terri-wasm bills tests (8) pass.
