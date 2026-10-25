# Wages and bills verification

This record holds the calibration measurements, moved test expectations, mutation results and played findings for [wages and bills](2026-10-18-wages-and-bills.md) (issue 298). The figures were taken on 2026-10-24 and 2026-10-25 on a Windows 11 desktop running other work at the same time, so the timings are noisy; each says which builds it compares.

## Contents

- [Calibration traces](#calibration-traces)
- [Acceptance bands](#acceptance-bands)
- [Measured estimates](#measured-estimates)
- [Trace cost](#trace-cost)
- [Moved test expectations](#moved-test-expectations)
- [Targeted mutation results](#targeted-mutation-results)
- [Mutation sweep](#mutation-sweep)
- [Played pass](#played-pass)

## Calibration traces

Each run is `target/release/examples/trace.exe 40320 <seed>` for the three-earner household, or `trace.exe 40320 <seed> - solo` for the shipped worker alone, where the `solo` scenario turns job search off for Bill and Casey before the first tick. Seeds 20260728, 1, 2 and 3 each ran 28 game days, four billing months. On every seed the three-earner search hired Bill as a kitchen porter on the late shift and Casey on the night watch's `weekend_nights` shift; Tim kept the office day shift. In the solo runs Bill and Casey stayed unemployed. Nobody died.

The trace's `BILLS` section reports, for each issued month, the four bills, their late fees and payment days, the month's use counts, object-days and trips, and the income earned while the month ran. Income is every rise in Funds, with bills paid on the same tick added back; the starting funds are not a rise.

The calibration ran twice on the branch after it merged main at `318da27c6`: first with the indoor rent rate of $1.10 a tile and no starting funds, then with the owner's rulings 17 and 18 of 2026-10-24 applied, an indoor rate of $0.90 and $400 of starting funds. The two runs behaved identically, because neither the rent rate nor Funds changes any choice: income, usage, trips and electricity and water bills match month for month, and only rent and the totals differ.

| Run | Income a month | Bills a month at $1.10 | Share at $1.10 | Bills a month at $0.90 | Share at $0.90 | Electricity usage | Water usage |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Three earners, seed 20260728 | $1,762.28 | $428.04 | 24.3% | $389.64 | 22.1% | 22 to 25% | 51 to 52% |
| Three earners, seed 1 | $1,731.39 | $428.99 | 24.8% | $390.59 | 22.6% | 23 to 29% | 47 to 54% |
| Three earners, seed 2 | $1,736.63 | $428.23 | 24.7% | $389.83 | 22.4% | 24 to 26% | 49 to 53% |
| Three earners, seed 3 | $1,744.96 | $427.43 | 24.5% | $389.03 | 22.3% | 20 to 28% | 49 to 50% |
| Tim alone, seed 20260728 | $762.56 | $404.02 | 53.0% | $365.62 | 47.9% | 27 to 29% | 52 to 57% |
| Tim alone, seed 1 | $752.43 | $404.93 | 53.8% | $366.53 | 48.7% | 24 to 29% | 55 to 56% |
| Tim alone, seed 2 | $748.87 | $403.23 | 53.8% | $364.83 | 48.7% | 25 to 27% | 51 to 57% |
| Tim alone, seed 3 | $747.27 | $403.67 | 54.0% | $365.27 | 48.9% | 25 to 28% | 54 to 56% |

In both runs every bill in all 32 months was paid on its due day, and no late fee was added.

## Acceptance bands

[WB-numbers] accepts the shipped values when the three-earner household's bills are 18 to 26 percent of its income with every bill paid on its due day, the one-earner household's bills are 35 to 50 percent of Tim's actual earnings with every bill paid within its grace period, water usage is 30 to 65 percent of the water bill and electricity usage 15 to 40 percent of the electricity bill. Ruling 17 made actual earnings the reading for the one-earner band.

- Three earners: 22.1 to 22.6 percent at $0.90, every bill paid on its due day. Passes. At $1.10 it was 24.3 to 24.8 percent.
- One earner: 47.9 to 48.9 percent of Tim's actual earnings of $747 to $763 a month at $0.90, every bill paid on its due day. Passes. At $1.10 it was 53.0 to 54.0 percent, which failed the band by 3 to 4 points; on the nominal reading of five shifts at $180 it was 44.8 to 45.0 percent, and at $0.90 it is 40.5 to 40.7 percent.
- Water usage 47 to 57 percent and electricity usage 20 to 29 percent of their bills in every month of every run. Passes.

Condition 3 of [WB-numbers], a tiny house saving at least a third, is a design estimate rather than a trace: at $0.90 the 4 by 4 house of [WB-rent] saves the three-earner household 32 percent, just short of a third, as [WB-numbers] records.

## Measured estimates

[WB-numbers] gave three figures as estimates. Measured per seven-day month, identical in both calibration runs:

| Figure | Estimate | Three earners | Tim alone |
| --- | --- | --- | --- |
| Dish washing | 2 | 10 to 18 | 9 to 20 |
| Trips to work | 13.5 | 14 in the first month, 15 after | 5 |
| Usage with one earner | as three earners | electricity $37.57 to $42.10, water $37.90 to $43.65 | electricity $39.23 to $42.34, water $41.05 to $46.70 |

Dish washing counts each Wash dishes step, which runs far more often than the estimate. At 20 cents of water each, the three-earner household's 10 to 18 washes a month add $2.00 to $3.60 to the water bill. Housemates at home all day use slightly more water and electricity than housemates at work, as the spec expected.

## Trace cost

`trace.exe 12000` ran three times on main at `318da27c6` and three times on the branch at `824df5487`, alternating, each built in release with `cargo build --release -p terri-sim --example trace`. Main took 12.03, 12.38 and 12.09 seconds, a median of 12.09; the branch took 12.03, 12.12 and 12.23 seconds, a median of 12.12. The branch is 0.2 percent slower, inside the 5 percent the plan allows. The branch's trace also runs the new BILLS summary each tick.

## Moved test expectations

Every moved value belongs to one of the classes of [WB-determinism]. For the four hashes below, a classification run on the branch after it merged main at `afbe98af3`, with the old wages in `content/careers.toml`, `night_shift_premium_percent = 0`, `starting_funds_cents = 0` and the bills system and its hash returning before they did anything, reproduced main's value exactly; the files were then restored byte for byte.

| Test | Main's value at `afbe98af3` | Branch value | Class and cause |
| --- | --- | --- | --- |
| `activity_log_never_changes_the_world`, two-day fold | `0xa0fb_785a_e3a4_7b1d` | `0x981f_c7f5_1465_4aa4` | Wages, premium, starting funds and bills hash |
| `activity_log_never_changes_the_world_over_twenty_days` (release, ignored) | `0x78e8_cb74_b70c_d742` | `0x0572_5884_b65c_1246` | Wages, premium, starting funds, bills hash, bills paid on days 7 and 14 |
| `the_shipped_household_hash_and_draws_through_thursday` | 17769474122166916875 | 14978728520623758854 | Wages, premium, starting funds and bills hash; draws and jobs unchanged |
| `the_hash_is_unchanged_while_everyone_holds_the_standard_shift` | 1877760251232896320 | 12629721401771819137 | Wages, starting funds and bills hash |
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

The runner and its log are outside the repository.

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
5. The schema-21 bed on the yard previewed in place with no refusal when selected in Build, and `Beds can only go inside a room.` when moved to another yard tile. It moved into Bedroom 1 and confirmed. After the wall between Bedroom 1 and the porch was removed, Confirm showed `The Standard Double bed would be left outside. Move it into a room, or choose Cancel, before confirming.` and the draft stayed open. A room then built on the yard in the same session, with a doorway, took the bed, and the batch confirmed.
6. From the yard-bed save, removing the same wall while Bedroom 1 was empty reached the room review and confirmed, because the bed already outdoors did not move. Expected rent fell from $255.20 to $233.60 with 156 indoor tiles instead of 192, and on Day 2 the tile lines read 174 indoor tiles a day on average and rent's lines added up to its $69.32 so far.
7. The night watch worker's Career tab read `$105 per shift, from $105 to $128 at this level. Night shifts pay 15% more: $120.75 per shift.`
8. The schema-21 night-shift save loaded with the office clerk at $180 and Casey, the night watch guard, at $105 with her open night shift at the raised pay; the schema-21 yard-bed save loaded with the double bed on its yard tile. The two are separate committed fixtures, and `the_authentic_schema_twenty_one_fixtures_load_with_migrated_pay` checks the raised pay in all three.

The phone row held `$10,000 due Day 1,000`, set into the live row by script to measure the longest value, on one line, 128 pixels wide within the 182-pixel panel. The player guide's overview, guide shortcut, Build, Furniture and save status captures were retaken on the same build with the Bills row, on a new game run to Day 1, 09:00.

**Findings fixed during the passes.**

- **F1, a new game's first projection.** Before a new game's first tick counted Day 1, the projection counted only the six days after it, so the row read a smaller amount under the opening guide than once the game ran. The month is now projected from today until a day is counted, and `the_first_month_is_projected_whole_before_the_first_tick` fails without the fix.
- **F2, `1 days`.** Daily lines read `Fridges: 1 days x $0.20` on the first day of a month; a single day now reads `1 day`.
- **F3, keep aside with unpaid bills.** With overdue bills the sentence named only the next due day, although the amount includes the overdue bills. It now reads `for the unpaid bills and the bills due Day {n}` whenever a bill is unpaid.
- **F4, expandable bills.** The bill rows' grid layout hid the disclosure marker, so nothing showed that a bill opens into its lines. Each bill name now carries a marker that turns when the row opens.

**Behaviors decided in review.** Rulings 18 to 21 of [WB-rulings] settle what the first pass recorded for the owner: a new game starts with $400, so Day 1 shows no shortfall; every bill's lines add up to its amount so far; an outdoor bed from an older save is refused only when moved or turned, or at Confirm; and two behaviors stay as specified. In a game's first month the expected electricity counts the fridge, lamps and aquarium only for the days so far, so it rises by a few cents a day (`$30.35` on Day 1). A shift settled before the pay migration keeps the pay it was settled at, so the office clerk's tab can read `Earned $85.00` from the old rate beside `$180 per shift` after loading an older save.

A fresh independent reviewer read the final captures against the [WB-played] points and the guide entries with no expected verdict, checking the arithmetic each capture makes checkable. It confirmed the rows, panels, fees, totals, rent figures, refusals and crops. Its gaps, the Day 8 fall in Funds, the bed in a room built in the same session and phone captures with the bills open, are closed by `d08`, `d09`, `d28`, `d29` and `p15`; the Last month lines' fee clause is now in [WB-panel]. Its notes on earlier behavior are outside this change: the phone speed buttons are faint over the scene and can sit under a housemate's bubble, the Funds row has no dollar sign, Build's sticky footer covers the Shortcuts line and the phone sheet's Colour dropdown, and Build spells Colour in British English.
