# Wages and bills verification

This record holds the calibration measurements, moved test expectations, targeted mutation results and played findings for [wages and bills](2026-10-18-wages-and-bills.md) (issue 298). The figures were taken on 2026-10-24 on a Windows 11 desktop running other work at the same time, so the timings are noisy; each says which builds it compares.

## Contents

- [Calibration traces](#calibration-traces)
- [Acceptance bands](#acceptance-bands)
- [Measured estimates](#measured-estimates)
- [Trace cost](#trace-cost)
- [Moved test expectations](#moved-test-expectations)
- [Targeted mutation results](#targeted-mutation-results)
- [Played pass](#played-pass)

## Calibration traces

The branch merged main at `318da27c6`. Each run is `target/release/examples/trace.exe 40320 <seed>` for the three-earner household, or `trace.exe 40320 <seed> - solo` for the shipped worker alone, where the `solo` scenario turns job search off for Bill and Casey before the first tick. Seeds 20260728, 1, 2 and 3 each ran 28 game days, four billing months. On every seed the three-earner search hired Bill as a kitchen porter on the late shift and Casey on the night watch's `weekend_nights` shift; Tim kept the office day shift. In the solo runs Bill and Casey stayed unemployed. Nobody died.

The trace's `BILLS` section reports, for each issued month, the four bills, their late fees and payment days, the month's use counts, object-days and trips, and the income earned while the month ran. Income is every rise in Funds, with bills paid on the same tick added back.

| Run | Income a month | Bills a month | Bills as share of income | Electricity usage | Water usage |
| --- | --- | --- | --- | --- | --- |
| Three earners, seed 20260728 | $1,762.28 | $428.04 | 24.3% | 22 to 25% | 51 to 52% |
| Three earners, seed 1 | $1,731.39 | $428.99 | 24.8% | 23 to 29% | 47 to 54% |
| Three earners, seed 2 | $1,736.63 | $428.23 | 24.7% | 24 to 26% | 49 to 53% |
| Three earners, seed 3 | $1,744.96 | $427.43 | 24.5% | 20 to 28% | 49 to 50% |
| Tim alone, seed 20260728 | $762.56 | $404.02 | 53.0% | 27 to 29% | 52 to 57% |
| Tim alone, seed 1 | $752.43 | $404.93 | 53.8% | 24 to 29% | 55 to 56% |
| Tim alone, seed 2 | $748.87 | $403.23 | 53.8% | 25 to 27% | 51 to 57% |
| Tim alone, seed 3 | $747.27 | $403.67 | 54.0% | 25 to 28% | 54 to 56% |

Every bill in all 32 months was paid on its due day, and no late fee was added.

## Acceptance bands

[WB-numbers] accepts the shipped values when the three-earner household's bills are 18 to 26 percent of its income with every bill paid on its due day, the one-earner household's bills are 35 to 50 percent of Tim's pay with every bill paid within its grace period, water usage is 30 to 65 percent of the water bill and electricity usage 15 to 40 percent of the electricity bill.

- Three earners: 24.3 to 24.8 percent, every bill paid on its due day. Passes.
- Water usage 47 to 57 percent and electricity usage 20 to 29 percent of their bills in every month of every run. Passes.
- One earner: the bills are $403.23 to $404.93 a month, 44.8 to 45.0 percent of Tim's pay of five shifts at $180, the figure [WB-numbers] calls his pay. Passes on that reading. Tim's actual earnings were $747 to $763 a month, because pay follows office time and his commute uses part of each shift, so the bills are 53.0 to 54.0 percent of what he actually earned. On that reading the band fails by 3 to 4 points.

The shipped tuning was not changed. The band's own worked example divides by $900, and the owner's ruling was a calibrated weight to tune later. The difference between the two readings is recorded here and in the delivery report for the owner's decision.

## Measured estimates

[WB-numbers] gave three figures as estimates. Measured per seven-day month:

| Figure | Estimate | Three earners | Tim alone |
| --- | --- | --- | --- |
| Dish washing | 2 | 10 to 18 | 9 to 20 |
| Trips to work | 13.5 | 14 in the first month, 15 after | 5 |
| Usage with one earner | as three earners | electricity $38.57 to $39.99, water $40.45 to $41.30 | electricity about $41, water $41.50 to $44.25 |

Dish washing counts each Wash dishes step, which runs far more often than the estimate. At 2 cents of water each it adds about 30 cents a month. Housemates at home all day use slightly more water and electricity than housemates at work, as the spec expected.

## Trace cost

`trace.exe 12000` ran three times on main at `318da27c6` and three times on the branch at `824df5487`, alternating, each built in release with `cargo build --release -p terri-sim --example trace`. Main took 12.03, 12.38 and 12.09 seconds, a median of 12.09; the branch took 12.03, 12.12 and 12.23 seconds, a median of 12.12. The branch is 0.2 percent slower, inside the 5 percent the plan allows. The branch's trace also runs the new BILLS summary each tick.

## Moved test expectations

Every moved value belongs to one of the classes of [WB-determinism]. For the four hashes below, a classification run on the branch with the old wages in `content/careers.toml`, `night_shift_premium_percent = 0` and the bills system and its hash returning before they did anything reproduced main's value exactly; the files were then restored byte for byte.

| Test | Old value | New value | Class and cause |
| --- | --- | --- | --- |
| `activity_log_never_changes_the_world`, two-day fold | `0x77df_2117_a9d4_c4b1` | `0x77d9_1293_12d6_21e2` | Wages, premium and bills hash |
| `activity_log_never_changes_the_world_over_twenty_days` (release, ignored) | `0x2e8d_746e_12f8_fad2` | `0x61e4_7abc_b9c4_8ae2` | Wages, premium, bills hash, bills paid on days 7 and 14 |
| `the_shipped_household_hash_and_draws_through_thursday` | 18180649999092761866 | 12348020542178266038 | Wages, premium and bills hash; draws and jobs unchanged |
| `the_hash_is_unchanged_while_everyone_holds_the_standard_shift` | 3597462262917285100 | 4723876948823417287 | Wages and bills hash |
| `every_search_on_keeps_published_hires_schedules_and_career_randomness` | pay 120, 120, 80; open shifts 12000, 12000, 8000 cents | 180, 180, 120; 18000, 18000, 12000 | Wages |
| `the_shipped_careers_hold_eight_paths_with_the_first_twelve_rows_unchanged`, `the_five_new_paths_match_the_spec_tables` | issue 296's pay | the same rows raised by half | Wages |
| `the_shipped_household_keeps_living_around_its_jobs` | day pay for every shift; Funds equal to pay | night premium for the night watch; Funds plus the first month's paid bills equal to pay | Wages and bills |
| `a_weekend_commute_loads_and_the_next_shift_waits_for_monday` | no bills | runs with every charge at zero | Bills: its thirty-tick days end a month at tick 210, inside the window it checks |
| Three command submission round trips | schema 17 | schema 22 | Bills: the schema-17 projection has no bills record |
| `inherited-runtime.pack` fixture | 25,708 bytes | 26,131 bytes | Pack layout and wages; the proof omits the appended fields and maps old pay to new |
| Web: Tim's full pay in `bridge.test.ts` and `portal-bridge.test.ts` | 12000 cents | 18000 cents | Wages and migration |
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

The runner and its log are outside the repository.

## Played pass

The branch's production build was played in one muted Playwright Chromium page at 1280 by 800 and at 375 by 812, served on its own port. The selected captures, the saved states used and what each capture shows are in [the evidence folder](../evidence/2026-10-24-wages-and-bills/README.md). Every [WB-played] point was played:

1. The Bills row read `$354 due Day 8` on a new game's first day, `$427 due Day 8` on Day 7 at 23:31 and `$427 due Day 15` once Day 8's bills were paid, and `$428 overdue` in the danger color while the first month was overdue, at both widths. The bills are issued and paid on the same tick when Funds cover them, so the row never reads the due day itself before payment.
2. The panel showed keep aside, overdue bills with fees, the next bills line by line, last month and how bills work at both widths. On the phone the dialog's content was 334 pixels wide inside the 375-pixel viewport, with no sideways scroll, and every control was at least 44 pixels tall.
3. Funds fell from $1,708.34 on Day 7 at 23:31 to $1,282.23 at 00:00 on Day 8, exactly the $426.11 the panel showed, and Last month listed the four bills as paid Day 8.
4. Tim's mood list showed Behind on bills at minus 8 while the bills were overdue.
5. The schema-21 bed on the yard showed `Beds can only go inside a room.` when selected in Build; the bed moved into a room and confirmed; after a front wall was removed Confirm showed `A bed would be left outside. Move it into a room, or choose Cancel, before confirming.` and the draft stayed open; and the bed was then placed in a room built in the same session and the batch confirmed.
6. After that batch, expected rent fell from $293.60 to $277.40 with 171 indoor tiles instead of 192, and the next day's rent so far grew by the new size's daily charge.
7. The night watch worker's Career tab read `$105 per shift, from $105 to $128 at this level. Night shifts pay 15% more: $120.75 per shift.`
8. The schema-21 night-shift save loaded with the office clerk at $180, Casey, the night watch guard, at $105 with her open night shift at the raised pay; the schema-21 yard-bed save loaded with the double bed on its yard tile. The two are separate committed fixtures, and `the_authentic_schema_twenty_one_fixtures_load_with_migrated_pay` checks the raised pay in all three.

The phone row held `$10,000 due Day 1,000` on one line, 128 pixels wide within the 182-pixel panel.

**Findings fixed during the pass.**

- **F1, a new game's first projection.** Before a new game's first tick counted Day 1, the projection counted only the six days after it, so the row read `$304 due Day 8` under the opening guide and `$354` once the game ran. The month is now projected from today until a day is counted, and `the_first_month_is_projected_whole_before_the_first_tick` fails without the fix.
- **F2, `1 days`.** Daily lines read `Fridges: 1 days x $0.20` on the first day of a month; a single day now reads `1 day`.
- **F3, keep aside with unpaid bills.** With overdue bills the sentence read `Keep aside $816.34 for the bills due Day 15`, although the amount includes the overdue bills. It now reads `for the unpaid bills and the bills due Day 15` whenever a bill is unpaid.
- **F4, expandable bills.** The bill rows' grid layout hid the disclosure marker, so nothing showed that a bill opens into its lines. Each bill name now carries a marker that turns when the row opens.

**Findings recorded for the owner.**

- **O1.** The tile lines show today's tile counts at a monthly rate, as [WB-panel] specifies, so after a mid-month change they no longer add up to the rent shown, which still includes the days counted at the old size.
- **O2.** In a game's first month the expected electricity counts the fridge, lamps and aquarium only for the days so far, as [WB-panel] specifies for usage, so it rises by about 35 cents a day. Projecting daily objects like base charges would remove the drift.
- **O3.** A new game starts with $0, so the panel reads `Funds are $353.98 short.` in the danger color on Day 1, before Tim's first pay.
- **O4.** A bed already outdoors in an older save shows the refusal on its own tile when selected in Build, because the rule applies to every placement of it.
- **O5.** A settled shift keeps the pay it was settled at, so the office clerk's tab can read `Earned $85.00` from the old rate beside `$180 per shift` after loading an older save.

The player guide's text describes the Bills row and panel, but its existing screenshots of the household status panel predate the row; `overview`, `guide-shortcut`, `guide-shortcut-build`, `build-furniture` and `save-status` are listed under `pendingRefresh` in `docs/player/screenshots.json`.

An independent reviewer read the captures against the [WB-played] points with no expected verdict. It confirmed points 3, 4 and 7 and the overdue and new-game rows, and raised the findings above. It also found that point 8 combines two saves, which this record now says. It noted that the tile lines do not add up to the rent shown (O1), and that the first capture set omitted the middle of the Electricity card, which `d38` now shows. The reviewer's other notes concern earlier behavior outside this change: the Funds row has no dollar sign and rounds down, the Colour label, and the phone speed buttons' contrast over the scene.
