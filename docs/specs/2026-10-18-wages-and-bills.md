# Wages and bills

Issue 298 asks for three things. Every job pays 1.5 times what it pays today. The household pays four monthly bills, for rent, electricity, water and transportation, each with a base charge and small increases from what the household does. Beds may only stand on tiles inside rooms. A Bills panel shows what is coming, how much money to keep aside and when each bill is due: the first day of each month, with five days' grace before late fees start. The owner asked that the numbers be calibrated so the bills are neither overwhelming nor pointless.

This document amends the [careers spec](2026-10-17-careers.md) for pay, the [calendar spec](2026-10-06-calendar.md) by adding months, and the Build mode rules of the [placement](2026-09-21-buy-mode.md), [wall tool](2026-09-21-wall-tool.md), [room tool](2026-09-22-room-tool.md) and [build confirmation](2026-10-13-build-confirmation.md) specs for beds. It builds on [shifts and more career paths](2026-10-18-shifts-and-careers.md) (issue 296, pull request 304, merged to main as `44f5fb271`) ([WB-scope]). Rulings taken without the owner are listed in [WB-rulings], each marked **For confirmation**.

## Contents

1. [Scope and dependencies](#wb-scope-scope-and-dependencies)
2. [Wages and the night premium](#wb-wages-wages-and-the-night-premium)
3. [Months and the billing calendar](#wb-calendar-months-and-the-billing-calendar)
4. [The four bills](#wb-bills-the-four-bills)
5. [Rent from indoor and outdoor tiles](#wb-rent-rent-from-indoor-and-outdoor-tiles)
6. [Counting usage from content](#wb-usage-counting-usage-from-content)
7. [Calibration and typical totals](#wb-numbers-calibration-and-typical-totals)
8. [Paying, grace, late fees and running out of money](#wb-paying-paying-grace-late-fees-and-running-out-of-money)
9. [Beds go inside rooms](#wb-beds-beds-go-inside-rooms)
10. [The Bills panel](#wb-panel-the-bills-panel)
11. [Strings proposed for review](#wb-strings-strings-proposed-for-review)
12. [Tuning and content layout](#wb-tuning-tuning-and-content-layout)
13. [Saves and older saves](#wb-save-saves-and-older-saves)
14. [Determinism and pinned values](#wb-determinism-determinism-and-pinned-values)
15. [Bills and the activity log](#wb-hooks-bills-and-the-activity-log)
16. [Performance](#wb-performance-performance)
17. [Verification](#wb-tests-verification)
18. [Played evidence](#wb-played-played-evidence)
19. [Changelog and documentation](#wb-docs-changelog-and-documentation)
20. [Rulings for confirmation](#wb-rulings-rulings-for-confirmation)

## [WB-scope] Scope and dependencies

This work builds on issue 296, pull request 304, which merged to main as `44f5fb271`. That change added five career paths whose pay is stated in the units before this change, the shift kinds day, early, late and night with a held shift for each employed person, and save schema twenty-one. The 1.5 multiplier covers all eight paths, the night premium reads the kind of the shift a person works, and the save layout here follows schema twenty-one. Issue 296's owner rulings stay in force and bills respect them: nobody works two paid shifts in one day, a shift change takes effect on a day after the day the person's last shift ended, and a shift that a change cuts short stays unscored.

The activity log of issue 275 (pull request 291) is on main. [WB-hooks] records how bills relate to it.

Nothing here adds a random draw, a player command, a new action or a new object. Laundry stays unimplemented; [WB-usage] records what its bill charges will be when it exists.

## [WB-wages] Wages and the night premium

**The multiplier.** Every `pay` and `pay_max` in `content/careers.toml` is multiplied by 1.5 and rounded half up to the whole dollar, because pay is authored in whole dollars per shift. Rounding half up keeps every careers rule 1 constraint: each level's pay is at least the previous level's, and each `pay_max` stays strictly above the previous level's, because 1.5 times a difference of at least one dollar rounds to at least one dollar. The content edit is the whole change; there is no runtime wage multiplier, so the numbers in the file are the numbers the player reads.

| Path | Level pay and pay maximum after the change, in dollars per shift |
| --- | --- |
| Office | 180 to 225; 240 to 300; 330 to 420; 480 to 600 |
| Cafe | 120 to 150; 135 to 180; 195 to 255; 300 to 390 |
| Night watch | 105 to 128; 128 to 158; 158 to 195; 195 to 240 |
| Hospital | 143 to 180; 188 to 240; 255 to 330; 353 to 450 |
| Warehouse | 135 to 165; 165 to 210; 225 to 285; 315 to 405 |
| Library | 128 to 158; 158 to 195; 210 to 263; 285 to 360 |
| Restaurant kitchen | 113 to 143; 150 to 195; 225 to 293; 345 to 450 |
| Buses | 165 to 203; 195 to 248; 248 to 308; 308 to 383 |

Raises, promotions and demotions keep their rules. A raise still adds a quarter of the level's range, so it grows with the range. A promotion still pays at least one dollar more than the old pay.

**The night premium.** Issue 296's owner decision left any shift premium to this issue. A shift of the night kind pays `night_shift_premium_percent` more, shipped at 15. The premium is applied when a scheduled shift is registered: `attendance::start_tick` records `pay_cents = record.pay * 100 * (100 + premium) / 100` for a night shift, with integer division, and `record.pay * 100` for every other kind. The kind is that of the shift being registered, which `shifts::shift_today` returns: the held shift, or on the day of a shift change the shift held when the day began, whose schedule still runs that day. So a person who changes from nights to days works and is paid that day's night shift at the night rate, and the day rate starts with the first day shift. The order preflight behind the Proceed and Cancel prompt, `attendance::work_conflicts`, reports a due shift's pay with the same rule. Proration by minutes worked, settlement and the deduction for missed time are unchanged and act on that amount. The person's saved pay, the level's range, raises and the Career tab's range stay in level terms without the premium.

The premium exists because night work costs the worker the household's waking hours: issue 296's sleep offset moves a night worker's sleep to the day, so they eat and talk at odd hours. Early and late shifts get no premium; their offsets are one or two hours. Fifteen percent is the middle of the range of ordinary night differentials, and it puts the night watch guard's $120.75 level with a lowly barista's $120, so night pay compensates the cost rather than leading the board. The shipped worker's office day shift is unaffected.

Validation follows. The saved-attendance validator already accepts a scheduled shift whose start time, weekday and length match any one shift its level lists. It now accepts an open scheduled shift whose `pay_cents` lies from `pay * 100` to `pay_max * 100 * (100 + premium) / 100` when one of the matching listed shifts is of the night kind, and from `pay * 100` to `pay_max * 100` otherwise; a settled shift outcome's pay may reach the same night bound. A settled shift record keeps the pay it was settled at and is checked against the outcome it produced, not against the level's starting pay, so a save from before the raise keeps its last settled shift as it was paid ([WB-save]). The compiler refuses a premium above 100.

## [WB-calendar] Months and the billing calendar

The game has weeks and seasons but no months. This change adds one tuning number, `bills.days_per_month`, shipped at 7. Day index `d` is `tick / day_ticks` (the HUD shows Day `d + 1`). The month is `d / days_per_month`, and the day of the month is `d % days_per_month + 1`. The functions `terri_core::clock::month` and `terri_core::clock::day_of_month` sit beside `weekday` and `season` and use the same overflow-safe arithmetic. Nothing new is saved for the calendar: the tick is already saved.

With the shipped values a month is seven days, so the first day of each month is Day 1, 8, 15, 22 and so on, always a Monday, and each month coincides with one week and one season. The HUD clock does not change; due dates are written as the HUD writes days, for example `Day 8, Monday`.

A seven-day month gives the player a bill roughly every 17 real minutes at 1x speed, about as often as a week's career review. A 28-day month would match the length of the shipped year, so a player would see one bill an hour at 1x and twelve bills would not fit in a year. This is the main pacing choice in the design and is a ruling for confirmation ([WB-rulings] ruling 1).

**What happens on a day.** The bills system acts on the first tick it processes in each day, tracked by a saved `last_counted_day`, so day 1 of a new game and the day an older save is loaded are counted like every other day. On that tick, in this order:

1. If the day is the first day of a month and an earlier day was counted, the bills for the month just ended are issued ([WB-bills]) and the month's counters reset.
2. The day is counted toward the current month: one day of each base charge, one day of rent from the confirmed layout ([WB-rent]), and one day of each placed object's daily usage ([WB-usage]).
3. Every bill past its grace period gains its day's late fee ([WB-paying]).

Bills are paid on any tick, not only on the first tick of a day ([WB-paying]).

**Grace.** `bills.grace_days`, shipped at 5, is the number of days a bill may stay unpaid without a fee, counting the due day. A bill due on the first of the month is overdue from the first tick of the sixth day: Day 13, Saturday, for a bill due Day 8. The compiler refuses `days_per_month` below 1 or above 365 and a grace of `days_per_month` or more, so a bill can always become overdue before the next one is issued.

## [WB-bills] The four bills

Each bill has a base charge and usage charges. The base charge is a whole month's amount, accrued one day at a time, so a month the household lived through completely pays it in full and a partial month pays its share.

| Bill | Base charge per month | Usage |
| --- | --- | --- |
| Rent | $60.00 | Indoor tiles at $1.10 and outdoor tiles at $0.20 per tile per month ([WB-rent]) |
| Electricity | $30.00 | Electricity charges of the actions and objects in [WB-usage] |
| Water | $20.00 | Water charges of the actions and objects in [WB-usage] |
| Transportation | $10.00 | $3.00 for each trip to work |

**Amounts.** At issue, with `days` the number of days counted in the month and `D` the shipped `days_per_month`, each bill is computed in whole cents with one rounding:

- Rent: `ceil((rent_base_cents * days + rent_indoor_tile_cents * indoor_tile_days + rent_outdoor_tile_cents * outdoor_tile_days) / D)`.
- Electricity: `ceil(electricity_base_cents * days / D)` plus, for each usage kind, its count times its electricity cents.
- Water: the same with the water base and water cents.
- Transportation: `ceil(transportation_base_cents * days / D)` plus `commute_cents` times the month's trips to work.

Counts are stored, not cents, so a retuned rate applies to the month in progress, as a retuned need delta applies to an action in progress. A bill of zero cents is not issued. The four bills of one month are issued together in the order rent, electricity, water, transportation, and that order is also the payment order within a month.

**Trips to work.** A trip is counted when a scheduled shift settles with at least one minute worked, in `attendance::settle`. Settlement happens exactly once per scheduled shift, so a worker sent home by a player order and returned to the same shift still counts one trip, and a shift missed entirely counts none. Because nobody works two paid shifts in one day (issue 296's ruling 16), a person makes at most one trip a day. A shift that a shift change or a career change cuts short still settles with the minutes worked, so a worker who went in counts the trip. A worker from a save older than schema fifteen, whose shift is a saved countdown rather than a scheduled shift, counts one trip when that countdown ends and the shift is paid. The career path does not change the fare.

## [WB-rent] Rent from indoor and outdoor tiles

**Which tiles count.** The room topology of the confirmed layout (`RoomMap` and its `RoomTopology` from the room identity work) classifies every tile. An **indoor tile** is a tile in an enclosed room (`TopologyCell::Enclosed`). An **outdoor tile** is a floor tile outside every room (`TopologyCell::Outside`), excluding the street column by the same rule `rooms::runtime::cleaning_area_at` uses. Tiles that are not floor do not count. Doorways, windows and furniture do not change the classification, because they do not change the topology.

**Shipped house.** The shipped lot is 20 by 16 tiles. The house's five rooms hold 192 indoor tiles; the yard holds 112 outdoor tiles after the 16 street tiles are left out. A month's rent is $60.00 + 192 x $1.10 + 112 x $0.20 = **$293.60**.

**A tiny house.** If the player removes the interior and exterior walls and builds one 4 by 4 room, 16 tiles are indoor and 288 outdoor, and rent is $60.00 + $17.60 + $57.60 = **$135.20**, 54 percent less. With every wall removed, rent is $60.00 + 304 x $0.20 = $120.80. Outdoor tiles always pay, as the issue requires; an outdoor tile costs less than a fifth of an indoor one.

**Bought land.** A strip bought with the Land tool is outdoor tiles. The first rear strip adds 160 tiles and $32.00 a month. The purchase price stays as it is.

**When rent is measured.** Rent is measured once per day, on the day's first processed tick, from the confirmed layout. Build mode pauses the game, and its draft is not the confirmed layout, so the tiles a player is still arranging never count until Confirm. Removing walls on Day 10 lowers that month's rent from Day 11. A wall edit made outside a Build session counts from the next day as well.

## [WB-usage] Counting usage from content

Usage is declared in content and costed in tuning, so the simulation has no per-object rule.

**Usage kinds.** `content/tuning.toml` gains a `[bills.uses]` table and a `[bills.daily]` table. Each entry is a usage kind with an id, a label the Bills panel shows, and its water and electricity cents. A use kind is charged once each time an action or chain step carrying it starts its physical work. A daily kind is charged once per day for each placed object carrying it.

**Declaring usage.** Two content properties carry the kinds, each a list of kind ids:

- `bill_uses` on an action template, an object type's action or a model's action, and on a chain step in `content/chains.toml`. It resolves through the category, type and model layers like every other action property.
- `bill_daily` on a category, type or model, resolved through the same layers.

The compiler refuses an id not defined in the matching table, an empty or repeated id, and a defined kind that no action, step or object uses. The compiled interaction rows, chain steps and object definitions hold indices into the compiled kind lists, so the simulation never compares strings at run time. These are separate properties from `tags`, so traits, hobbies, skills and habituation, which read `tags`, cannot notice them.

**When a use is counted.** A use is counted at the physical start of work, the site that already calls `player_actions::record_physical_work_start` for an ordinary action in `systems/movement.rs`, and the site that inserts `StepWork` for a chain step. An interrupted shower has already run its water and still counts. A walk abandoned before the person reaches the object counts nothing. A loaded save does not count an action already in progress again, because loading does not dispatch work. Each person's action counts separately, so two people watching one television count two uses; the charge is per viewer session, which is simpler and close enough at 20 cents.

**Shipped kinds.**

| Kind | Label | Water | Electricity | Carried by |
| --- | --- | --- | --- | --- |
| `shower` (use) | Showers | 60 | 15 | `take_shower` template |
| `bath` (use) | Baths | 90 | 25 | `soak` template |
| `hand_wash` (use) | Hand washing | 5 | 0 | `wash_hands` and `wash_up` templates |
| `toilet` (use) | Toilet flushes | 10 | 0 | `relieve_self` template |
| `dishes` (use) | Dish washing | 20 | 0 | the Wash dishes step of `clean_dishes` |
| `television` (use) | Television | 0 | 20 | `watch_tv` template |
| `radio` (use) | Radio | 0 | 3 | `listen` template |
| `stove` (use) | Stove cooking | 0 | 40 | the Cook step of `cook_dinner` |
| `fridge` (daily) | Fridges | 0 | 20 | `fridge` type |
| `lamp` (daily) | Lamps | 0 | 5 | `lighting` category |
| `aquarium` (daily) | Aquariums | 0 | 10 | `aquarium` type |
| `pool` (daily) | Pools | 50 | 60 | `pool` type |

Amounts are cents. The shower and bath carry electricity for hot water. A bath costs more than a shower, as the issue asks. The stove is charged on the Cook step only, so Simmer and stir does not charge a second time.

**Lights.** The game has no light switch: the renderer draws every lamp as lit, and the simulation has no light state. Until a switch exists, "lights left on" is charged as standing use: each placed lamp costs 5 cents a day. A later light-switch feature replaces the daily kind with a charge per hour lit. This keeps the issue's "very slightly": one lamp adds $0.35 a month.

**Objects considered and left without usage.** The exercise bike (pedal power), the desk (its action is paper correspondence), every seat, bed, table, bookcase and storage object, the plants, the coat rack, the nightstand, the dresser, the trash can, the patio umbrella and the pool lounger. Grabbing a snack opens the fridge, whose cost is in its daily charge. The counter and the stove's other steps are covered by the Cook charge. The washer-dryer has no actions; when laundry is implemented, its action carries a `laundry` use kind at 40 cents of water and 30 cents of electricity per load, added to the tuning table in that change.

## [WB-numbers] Calibration and typical totals

**Target.** The owner asked for bills that are neither overwhelming nor pointless. The design reads that as four measurable conditions:

1. A household whose shipped worker is the only earner keeps a positive margin every month in the shipped house, but loses part of what the 1.5 multiplier gave it.
2. A household with all three housemates employed pays about a fifth of its income in bills and ends better off than before this change.
3. A smaller house is a real saving: the tiny house of [WB-rent] lowers the shipped household's bills by at least a third.
4. Usage is visible: it is at least a quarter of each utility bill for the shipped household, and a bath shows up as dearer than a shower.

Rent is set first, at roughly two thirds of the total, like a typical household's housing share of its fixed costs. The tile rates were then chosen so that walls matter more than land, which gives condition 3. Utility bases were set near half of each utility bill, and the per-use cents were set from measured counts so that usage supplies the other half of water and about a quarter of electricity.

**Measured usage.** The shipped household was traced headlessly for 28 game days (40,320 ticks) on four seeds with `cargo run --release -p terri-sim --example trace -- 40320 <seed>`, seeds 20260728 (the shipped seed), 1, 2 and 3, on main at commit `7b45ac301`, before issue 296. In every run Tim worked as an office clerk, the search hired Bill as an office clerk and Casey as a lowly barista, and nobody died. Per seven-day month, the means and ranges were:

| Use | Mean per month | Range over the seeds |
| --- | --- | --- |
| Showers | 14.3 | 13.8 to 14.8 |
| Baths | 7.1 | 6.0 to 9.0 |
| Hand washing, both sinks | 23.1 | 21.8 to 24.5 |
| Toilet uses | 33.9 | 32.8 to 35.8 |
| Television sessions | 10.6 | 9.8 to 11.5 |
| Radio sessions | 15.9 | 13.8 to 18.0 |
| Dinners cooked | 4.7 | 3.8 to 6.5 |

Funds rose by $5,219 to $5,284 over the 28 days at today's pay, a mean of $1,317 a week. At 1.5 times, that is about **$1,975 a month** of seven days.

Three figures are estimates, not measurements: dish washing (the trace does not report the clean-dishes chain separately; estimated at 2 per month), trips to work (estimated at 13.5 per month from the trace's at-work time, because Bill and Casey are hired during the first week), and the usage of a single-earner household (assumed equal to the three-earner household's, though housemates at home all day probably use more). The plan's calibration task measures all three after the change. These figures predate issue 296, after which the job search spreads hires over eight paths and their shifts (on the shipped seed Bill became a kitchen porter and Casey a night watch guard), so the household's income and trips differ from the table below; the calibration task's measurement with shifts in place decides the acceptance bands.

**Typical monthly totals for the shipped household, three earners.**

| Bill | Base | Usage | Total |
| --- | --- | --- | --- |
| Rent | $60.00 | $233.60 for tiles | $293.60 |
| Electricity | $30.00 | $10.84: hot water $3.91, television $2.12, stove $1.88, fridge $1.40, aquarium $0.70, radio $0.48, lamp $0.35 | $40.84 |
| Water | $20.00 | $19.89: showers $8.55, baths $6.39, toilet $3.39, hand washing $1.16, dishes $0.40 | $39.89 |
| Transportation | $10.00 | $40.50 for 13.5 trips | $50.50 |
| **All four** | | | **$424.83** |

That is 21.5 percent of the household's $1,975. After bills the household keeps about $1,550 a month, against $1,317 before this change.

**The shipped household with one earner.** If only Tim works, his office clerk pay is 5 x $180 = $900 a month. Transportation falls to $25.00 and the total to about $399.33, 44 percent of his pay. He keeps about $501, against $600 before this change.

**A tiny house.** In the 4 by 4 house of [WB-rent], the three-earner household pays about $266.43, 37 percent less than in the shipped house, and the one-earner household about $240.93, 27 percent of Tim's pay, keeping $659.

**What usage costs.** A month of baths for one person at one a day costs $8.05 in water and electricity, against $5.25 for a daily shower. Usage is half the water bill and a quarter of the electricity bill.

**The first bill.** A new game starts with no money. Tim's five shifts in the first week pay $900 by Day 5, so the first bills on Day 8 are paid on the day they arrive. A new game in which nobody works cannot pay them, and [WB-paying] says what follows.

**Acceptance bands.** The plan's calibration task re-measures with the implemented bills and accepts the shipped values when, over four seeds: the three-earner household's bills are 18 to 26 percent of its income and every bill is paid on its due day; the one-earner household's bills are 35 to 50 percent of Tim's pay and every bill is paid within its grace period; water usage is 30 to 65 percent of the water bill and electricity usage 15 to 40 percent of the electricity bill. If a band fails, the implementer adjusts the tuning values only, records the old and new values and the measurement in the verification record, and reports the change to the owner.

## [WB-paying] Paying, grace, late fees and running out of money

**Automatic payment.** Bills are paid from Funds automatically. On every tick on which an unpaid bill exists, the bills system walks the unpaid bills oldest first, and within a month in the order rent, electricity, water, transportation. It pays each bill whose amount plus late fees Funds cover in full, and stops at the first bill Funds cannot cover. A bill is never paid in part. Bills never take Funds below zero.

The bills system runs in the schedule immediately after `systems::career::commute_and_work`, so pay from a shift that settles in a tick is available to the bills in the same tick. The order also means a player cannot spend money already owed to a bill that Funds could cover: by the time a command is drained on the next tick, that bill is paid.

**Late fees.** On the first processed tick of each day from the end of the grace period, every unpaid bill gains a late fee of `bills.late_fee_percent` (shipped 5) percent of its amount, rounded up to the cent, until its fees reach `bills.late_fee_cap_percent` (shipped 50) percent of its amount. The last fee is reduced to meet the cap exactly. A rent of $293.60 left unpaid gains $14.68 a day and at most $146.80.

**Behind on bills.** While any bill is overdue, every living housemate has the moodlet **Behind on bills**, worth minus `bills.overdue_mood` (shipped 8) mood points, the same weight as disliking one's job. It is derived from the bills state each time moods are computed, like Warned at work, so it needs no timer and no save of its own. It ends on the tick the last overdue bill is paid. Bills still within their grace period do not cause it.

**Running out of money.** The game has no game over for money, and this change adds none. When Funds cannot cover a bill, the bill waits unpaid and gains late fees up to the cap, the next month's bills arrive on top of it, and the household lives with the Behind on bills moodlet. Mood feeds the shift score, so debt slowly hurts the employed at work. Nothing is shut off or repossessed. The player's ways out are the existing ones: an unemployed housemate looking for work, a better job, selling furniture for half its price, or a smaller house. Utility shut-offs and repossession, which [S-money] in `docs/GAME-SYSTEMS.md` lists as later escalations, stay later work.

## [WB-beds] Beds go inside rooms

**The rule.** A bed may only be placed with every tile of its footprint indoors, in an enclosed room as [WB-rent] defines it. The content property `indoor_only = { set = true }` marks the objects the rule covers; the shipped content sets it on the `sleeping` category, so the bunk bed and the double bed, and any later sleeping model, inherit it. No other category sets it.

**Where it is checked.**

1. **Buying and moving.** `validate_purchase` and `validate_placement` refuse an `indoor_only` object whose footprint would include a tile that is not indoor, with the new refusal `PlacementRefusal::OutsideRoom = 21`, after the existing overlap checks. Inside a Build session the rooms of the confirmed layout are not current, so the check computes `RoomTopology::from_world` on the draft world; a bed can therefore go into a room built earlier in the same session. The placement preview shows the refusal as it shows any other.
2. **Confirm.** Removing a wall in a draft can leave a bed outside without moving it. The Confirm step, `prepare_build_commit_projected_validated`, already computes the final topology; it refuses the whole batch with the new `BuildCommitError::BedOutside { object }` when an `indoor_only` object stands outside every room in the final layout and either was indoors in the baseline or was bought or moved in this session. The draft stays open and unchanged.
3. **Single edits outside a session.** A wall or room command applied outside a Build session is refused, with the new wall refusal `BedOutside`, when it would leave such a bed outside.

A rule checked only at Confirm lets a player remove a wall, move the bed and rebuild without being stopped halfway, which a per-edit check would prevent.

**Older saves.** A save from before this rule may hold a bed outdoors. That bed stays where it is, keeps working and can be sold. A batch that leaves it where it is confirms normally; only moving it is subject to the rule, so it can be moved into a room but not to another outdoor tile. Loading does not move, sell or flag it, following [L-a-new-rule-meets-old-saves]. Both beds of the shipped lot are already indoors, in the bedroom and the study.

## [WB-panel] The Bills panel

**The Bills row.** The household status panel, which holds Time and Funds on desktop and on the phone layout, gains a third row, **Bills**, below Funds. Its value is a button that opens the Bills panel. It reads `${amount} due Day {n}`, with the amount to keep aside rounded up to the dollar, for example `$425 due Day 8`. While any bill is overdue it reads `${amount} overdue` in the panel's danger color, with the overdue total including fees. The button's accessible name repeats the visible text and adds `, open bills`. The phone layout's status panel is 182 pixels wide; a long value such as `$10,000 due Day 1,000` must fit on one line at the panel's 12-pixel value size or wrap without clipping, and the played pass measures it.

**Opening and pausing.** The Bills panel is a modal dialog in the pattern of the Chores dialog: opening it pauses the game through `overlayPause.suspend('bills')`, it closes with Close or Escape, and the Bills row is disabled while Build mode is active. It is read-only: there is no Pay button, because payment is automatic. Its width is `min(560px, calc(100vw - 24px))` and it scrolls vertically within 85 percent of the viewport height.

**What it shows, in order.**

1. **Keep aside.** `Funds: ${funds}` and `Keep aside ${amount} for the bills due Day {n}, {Weekday}.` The amount is the overdue total plus the expected total of the next bills. Below it, either `Funds cover these bills.` or `Funds are ${shortfall} short.`
2. **Overdue**, only when a bill is overdue: one line per bill, `{Bill} due Day {n}: ${amount} plus ${fees} in late fees`, and the note `Overdue bills are paid automatically as soon as Funds cover them, oldest first.`
3. **Next bills**, headed `Due Day {n}, {Weekday}`: one row per bill with its name, its amount so far and its expected amount. Each row expands to its lines:
   - Rent: `Base charge, {d} of {m} days: ${x}`, `Indoor tiles: {n} at ${rate} a month`, `Outdoor tiles: {n} at ${rate} a month`.
   - Electricity and water: the base charge line, then one line per usage kind with a nonzero count, `{label}: {count} x ${unit}`, for example `Showers: 14 x $0.60`, or `{label}: {days} days x ${unit}` for a daily kind.
   - Transportation: the base charge line and `Trips to work: {n} x $3.00`.
4. **Last month**: each bill of the last issued month with its amount and `paid Day {n}` or `unpaid`.
5. **How bills work**, a short fixed text: `Bills arrive on the first day of each month. A month is {m} days. Bills are paid automatically from Funds. A bill still unpaid after {g} days is overdue: a late fee of {p}% of the bill is added each day, up to {c}%, and every housemate is Behind on bills until it is paid.` The numbers come from the tuning.

**Expected amounts.** Rent and base charges are projected exactly for the rest of the month from the current confirmed layout and day count. Usage is projected as the larger of the month's usage so far and the last month's usage, for each utility and for trips. In a game's first month, with no last month, the expected usage is the usage so far.

**Money display.** The panel shows cents, because its job is to show arithmetic that adds up. The Bills row shows whole dollars rounded up, like prices elsewhere; Funds stay rounded down, as they are today.

**Phone layout.** Below 600 pixels wide the dialog fills the width less 12 pixels a side. Each bill row puts its name and expected amount on one line and its so-far amount and details below in 12-pixel text; no table scrolls sideways, and every control is at least 44 pixels tall, as the phone layout requires elsewhere.

**Career tab.** For a person holding a night shift, the pay line gains a sentence: `Night shifts pay {p}% more: ${amount} per shift.`, with the amount in dollars and cents.

## [WB-strings] Strings proposed for review

All strings below are functional text: labels, values, explanations and refusals. They are proposed for the owner's review and join `docs/player-visible-strings.md` as proposed. Per [L58], none is a joke.

| Surface | Strings |
| --- | --- |
| Household status | Bills; ${amount} due Day {n}; ${amount} overdue; {visible text}, open bills |
| Bills panel | Bills; Close; Funds: ${funds}; Keep aside ${amount} for the bills due Day {n}, {Weekday}.; Funds cover these bills.; Funds are ${shortfall} short.; Overdue; {Bill} due Day {n}: ${amount} plus ${fees} in late fees; Overdue bills are paid automatically as soon as Funds cover them, oldest first.; Next bills; Due Day {n}, {Weekday}; So far; Expected; Last month; paid Day {n}; unpaid; How bills work, with its paragraph in [WB-panel] |
| Bill names | Rent; Electricity; Water; Transportation |
| Bill lines | Base charge, {d} of {m} days: ${x}; Indoor tiles: {n} at ${rate} a month; Outdoor tiles: {n} at ${rate} a month; {label}: {count} x ${unit}; {label}: {days} days x ${unit}; Trips to work: {n} x $3.00 |
| Usage labels, from tuning | Showers; Baths; Hand washing; Toilet flushes; Dish washing; Television; Radio; Stove cooking; Fridges; Lamps; Aquariums; Pools |
| Mood | Behind on bills |
| Career tab | Night shifts pay {p}% more: ${amount} per shift. |
| Buy and move refusal | Beds can only go inside a room. |
| Confirm refusal | A bed would be left outside. Move it into a room, or choose Cancel, before confirming. |
| Wall and room refusal | That change would leave a bed outside. |

The usage labels live in `content/tuning.toml` beside their rates, so a new usage kind brings its label with it.

## [WB-tuning] Tuning and content layout

Every number above is in `content/tuning.toml`. The root knob `night_shift_premium_percent = 15` is appended after issue 296's `career_search_temperature`. A new `[bills]` section holds the rest:

```toml
[bills]
days_per_month = 7
grace_days = 5
late_fee_percent = 5
late_fee_cap_percent = 50
overdue_mood = 8.0
rent_base_cents = 6000
rent_indoor_tile_cents = 110
rent_outdoor_tile_cents = 20
electricity_base_cents = 3000
water_base_cents = 2000
transportation_base_cents = 1000
commute_cents = 300

[bills.uses]
shower = { label = "Showers", water_cents = 60, electricity_cents = 15 }
bath = { label = "Baths", water_cents = 90, electricity_cents = 25 }
hand_wash = { label = "Hand washing", water_cents = 5, electricity_cents = 0 }
toilet = { label = "Toilet flushes", water_cents = 10, electricity_cents = 0 }
dishes = { label = "Dish washing", water_cents = 20, electricity_cents = 0 }
television = { label = "Television", water_cents = 0, electricity_cents = 20 }
radio = { label = "Radio", water_cents = 0, electricity_cents = 3 }
stove = { label = "Stove cooking", water_cents = 0, electricity_cents = 40 }

[bills.daily]
fridge = { label = "Fridges", water_cents = 0, electricity_cents = 20 }
lamp = { label = "Lamps", water_cents = 0, electricity_cents = 5 }
aquarium = { label = "Aquariums", water_cents = 0, electricity_cents = 10 }
pool = { label = "Pools", water_cents = 50, electricity_cents = 60 }
```

The compiler refuses a `days_per_month` outside 1 to 365, every percentage outside 0 to 100 (the premium too), a grace of `days_per_month` or more, a negative or non-finite mood, a cent amount below 0 or above 1,000,000, a kind id that is empty, uses anything but lowercase ASCII letters, digits and underscores, or repeats across the two tables, a blank label or one longer than 32 characters, and a missing or unknown key in the section or any row. Kinds compile in id order. The compiled `Tuning` appends `night_shift_premium_percent` after `career_search_temperature`, the last field issue 296 appended. The bills section compiles to its own record, `ContentPack::bills`, appended after `career_paths`, the pack's last field: `Tuning` is `Copy` because every system reads it through a borrowed pack, and the kind lists own their labels, as `Circadian` is a sibling of `Tuning` for the same reason. Packs published before this change, and the frozen pre-books content sources, reconstruct the shipped premium and the shipped scalar bills values with empty usage lists, per [L-required-tuning-historical-expansion]; their content declares no usage, so in such a pack only base charges, rent and trips cost anything.

The content properties are `bill_uses` (actions and chain steps), `bill_daily` and `indoor_only` (category, type and model layers). They are appended to the compiled interaction, chain step and object records, with empty lists and `false` for published packs. None of them enters `content_fingerprint`, whose rule already excludes tags, tuning, careers and labels, so the fingerprint and the saved action manifest do not change ([WB-determinism]).

## [WB-save] Saves and older saves

**Schema twenty-two.** `SaveSnapshotV22` is the complete `SaveSnapshotV21` followed by `SavedBills`:

- `last_counted_day: Option<u32>`;
- `month_days: u32`, the days counted in the current month;
- `indoor_tile_days: u64` and `outdoor_tile_days: u64`;
- `uses` and `daily`, each a list of `{ kind, count }` with the kind's string id, ascending by id, nonzero counts only;
- `commutes: u32`;
- `previous: Option<SavedPreviousUsage>`, the last month's usage cents for electricity and water and its trip count, read by the panel's expected amounts;
- `bills`, a list of `{ due_day, kind, amount_cents, late_fee_cents, paid_day }`, where `kind` is 0 for rent, 1 for electricity, 2 for water and 3 for transportation, and `paid_day` is `None` for an unpaid bill. The list holds every unpaid bill and the bills of the last issued month, ascending by due day and then kind.

A schema-twenty-two payload refuses to load, leaving the running game unchanged, when: `last_counted_day` is ahead of the clock's day; `month_days` exceeds `days_per_month` or the days elapsed in the current month; a tile-day count exceeds `month_days` times the grid's tile count; a use or trip count exceeds 100,000; a list is out of order or repeats a kind; a bill is due after the current day or on a day that is not the first of a month; a bill repeats its due day and kind; an amount is not positive; a late fee is negative or above the cap; a fee is nonzero on a bill whose grace has not ended; a paid day precedes the due day or follows the current day; or a paid bill is older than the last issued month. Usage kinds are named by id. A count for a kind the current content no longer defines is dropped on load, because a usage count is only a billing input and a retired kind should stop costing. Every bound is checked before restoration, per [L-restore-without-counting-up].

**The current writer.** `SAVE_SCHEMA_VERSION` and the shell's `CURRENT_SAVE_VERSION` become 22. Every build transaction and the browser save worker write schema twenty-two. The save worker keeps `terri-save-1.v21-backup.bin` when a current write replaces a schema-twenty-one save, and a frozen copy of the schema-twenty-one worker joins `web/tests/fixtures/`, as issue 296 added the schema-twenty one. The historical projections to schema twenty-one and earlier drop the bills record, which those envelopes cannot hold, and are not used to write saves for current content.

**Older saves.** A save from schema twenty-one or earlier loads with these changes:

1. **Pay.** Every career record's pay becomes `round_half_up(pay * 1.5)` clamped into the level's new range, and every open scheduled shift's `pay_cents` becomes the migrated record pay times 100, or the migrated dollars of its own `pay_cents` when the person has no career record. The older save's pay was valid against the old range, and without this step the new range would refuse it ([WB-wages]). The loaders validate saved careers and attendance against the current content's ranges, so the migration rewrites the saved records after the world they refer to has restored and before those records are validated; every other check of the older payload is unchanged. Settled shift records and shift outcomes keep the pay they were settled at, because that pay is history the household already received. A migrated open night shift does not gain the premium; the next one does. The factor 1.5 is the historical size of this change, not a tunable: a later wage change in `content/careers.toml` does not repeat it.
2. **Bills.** The bills record starts empty with `last_counted_day` unset. The first processed tick counts the load day as the first day of the current month, so that month's base charges and rent cover only the days the household lives through after loading, and its first bills arrive on the next first of the month.
3. **Beds.** Nothing changes ([WB-beds]).

The pay migration runs exactly once, at the version boundary: only the loaders of schemas fourteen to twenty-one select it, and a schema-twenty-two save, like every build transaction's own baseline, holds pay in the new range and loads unchanged.

## [WB-determinism] Determinism and pinned values

**No random draws.** Bills, payment, late fees, the moodlet and the bed rule draw nothing from any stream. Every amount is integer cents with the single rounding steps stated above. Iteration is in fixed orders: usage kinds in compiled id order, bills by due day then kind, objects by entity order when counting daily kinds, and people in sim id order for the moodlet.

**Hash.** The world hash appends, after issue 296's career shift data (its `career-shift-changes-v2` section), the tag `bills-v1` and every field of the bills record in its saved order, only when the record is not pristine. Pristine means no day counted and no bill. The bills system acts only in a world with a lot (a `LotFrame` and a `RoomMap`); a hand-built world without one stays pristine, so worlds that never build a lot hash exactly as before.

**Movement of pinned values.** Each pinned value falls into one class, and the plan records every test whose expectation moves with its class and cause. A movement that fits no class is a defect.

1. **Unchanged.** The bare-agent golden hash 4661132544113609906 and its release-wasm twin in `web/tests/bridge.test.ts`, if their worlds have no lot. The content fingerprint pinned in `crates/terri-data/tests/content_hierarchy.rs` and the saved action manifest, because no property added here is fingerprinted and no action is added. The published schema-fifteen boundary values in `crates/terri-wasm/src/published_v15_tests.rs` for worlds with no employed person.
2. **Wages, intended.** Every test that pins funds or the world hash after a paid shift: each shift pays 1.5 times as much, and night shifts 1.15 times more again. This includes issue 296's `the_shipped_household_hash_and_draws_through_thursday` and pull request 303's `every_search_on_plays_out_exactly_as_the_global_setting_did`, which keeps its cut-down pack but now pays the new wages; each is re-pinned with a comment naming this issue.
3. **Bills, intended.** Every shipped-household run of at least one tick moves its hash through the bills record, because the first processed tick counts the first day, and every run that crosses a month start moves Funds by the bills paid. The moodlet moves mood only in a run with an overdue bill.
4. **Migration, intended.** Tests that load an older save holding an employed person and compare the loaded world's hash or bytes now see migrated pay and an empty bills record in a schema-twenty-two envelope.
5. **Pack layout.** `GOLDEN_PACK_BYTES` in `compile.rs` and the `inherited-runtime.pack` fixture change by the appended fields only, per the fixture's existing proof that only appended bytes changed.

The trace example's output changes and is not pinned.

## [WB-hooks] Bills and the activity log

The activity log of issue 275 ([its specification](2026-10-18-activity-log.md)) is on main. Bills add nothing to it: a month's bills being issued, a bill being paid, a late fee and the Behind on bills moodlet are money and mood events, and the owner chose the log's seven filters without a Money or Mood filter ([AL-decisions] item 1). [AL-sources] already lists moodlets, money and purchases as unlogged for that reason, and this change adds bills to that list as unlogged source 9. The Bills panel ([WB-panel]) is where the player reads what was issued, what was paid and when. A later Money filter can report bills from the saved bills record without changing the bills system. Bills therefore keep no event ring; nothing session-local is added.

## [WB-performance] Performance

Per tick, the bills system checks whether any bill is unpaid and whether the day has changed: two comparisons in the common case. Once a day it counts the cells of the confirmed topology (320 for the shipped lot, without a new flood fill) and walks the placed objects once for daily kinds. A use costs one push of a small index list at the start of an action. The bed check computes one topology only when an `indoor_only` object is placed or moved, and once at Confirm, which already computes it. No per-tick allocation is added. The panel's exports run only while the panel is open; the Bills row reads one small export per HUD refresh.

The plan measures the shipped household's trace for 12,000 ticks in release mode three times before and after the change and accepts a median difference within 5 percent.

## [WB-tests] Verification

**Compiler** (`crates/terri-data`): the shipped wages equal the table in [WB-wages] for all 32 levels; every bills refusal in [WB-tuning]; an action or chain step naming an unknown use kind, an object naming an unknown daily kind, and a defined kind nobody uses are refused; `indoor_only` resolves through the layers and is set on both shipped bed models and no other model; published packs and pre-books sources reconstruct the shipped bills tuning with no usage; and the content fingerprint is unchanged.

**Calendar** (`crates/terri-core`): `month` and `day_of_month` at day 0, the last day of a month, the first day of the next, and the top of the tick range.

**Simulation** (`crates/terri-sim`): the night premium's exact cents on a night shift and its absence on day, early and late shifts, with proration; each shipped use kind counted once at the physical start of its action or step, not at a walk that is abandoned, once per viewer, and not again after a save and load mid-action; daily kinds counted per placed object per day; trips counted once per settled shift with time worked and never for a missed shift; rent from the shipped lot equal to $293.60, and from the tiny house and the wall-free lot equal to [WB-rent]'s figures; rent unaffected by an unconfirmed Build draft and changed from the day after a confirmed one; bills issued on the first day of the month with the exact amounts of a fixture month; a partial first month after loading an older save prorated by days counted; payment in order, never partial, never below zero, in the tick pay arrives; late fees from the first tick after grace, rounded up, capped exactly; the Behind on bills moodlet present only while a bill is overdue and gone on payment; the hash unchanged for a world with no lot and moved by a counted day; the bed rule's purchase and move refusals, the draft topology inside a session, the Confirm refusal and its exceptions for a bed already outside in the baseline, the wall and room command refusals outside a session, and an older save with an outdoor bed that loads, works and confirms unrelated batches; the schema-twenty-two round trip; every refusal in [WB-save]; and loading schemas fourteen to twenty-one with migrated pay and an empty bills record, while a build session's baseline is never migrated.

**Boundary** (`crates/terri-wasm`): the bills exports for a new game, mid-month, with an overdue bill, and after a load; the new refusal codes; the night pay line's value; schema twenty-two through the save bytes; and the published schema-fourteen to schema-twenty-one inputs, including the authentic schema-twenty-one saves in `crates/terri-wasm/tests/fixtures/bills-v21/`, written by main at `44f5fb271` before this change: the shipped household with Tim at work, a night watch worker with an open night shift, and a double bed on a yard tile.

**Shell** (`web/tests`): the Bills row's text in both states, its accessible name and its disabled state in Build mode; the panel's sections, expansion, rounding and expected amounts; the dialog's pause and close; the Career tab's night line; the three bed refusal texts; and the save worker's version 22 with the schema-twenty-one backup.

**Calibration** (trace example): a `BILLS` section in the trace output reporting each month's four bills, the usage counts behind them, the payment day and the household's income, for the shipped household and for a one-earner scenario in which Bill's and Casey's job search is off, over four seeds, against the bands in [WB-numbers].

## [WB-played] Played evidence

Per [Testing Protocol, section 9](../testing-protocol.md#9-every-milestone-ends-with-a-played-visual-pass), the change is played in a displayed browser at desktop width and at 375 by 812 before delivery. The pass shows, with retained screenshots, written findings and no video:

1. the Bills row on a new game's first day, on the first bills' due day and while a bill is overdue, at both widths;
2. the Bills panel with every section open, including an overdue bill and a last month, at both widths, with no sideways scrolling on the phone;
3. the first bills issued and paid on Day 8, with Funds falling by the amount shown;
4. a housemate with the Behind on bills moodlet in the Mood tab;
5. a bed refused on a yard tile with the refusal text, a bed placed in a room built in the same session, and a Confirm refused after a wall removal leaves a bed outside;
6. rent falling in the Bills panel the day after confirming a smaller house;
7. the Career tab of a night worker showing the night pay line;
8. an older schema-twenty-one save loading with its pay migrated and its outdoor bed in place.

A fresh independent reviewer inspects the captures against these points; the coordinating agent inspects the same images. Task-owned pages and preview servers are closed when the pass ends.

## [WB-docs] Changelog and documentation

The delivery adds a public note in `docs/player/changelog/` for its delivery date, written for players: every job pays half as much again; night shifts pay 15% more; the household now pays rent, electricity, water and transportation on the first day of each month, with five days' grace before late fees; rent depends on how much of the lot is indoors; showers, baths, cooking, television and other use add to the bills; the Bills row and panel show what is due, what to keep aside and when; overdue bills upset the household; beds must go inside a room; and older saved games keep working, with wages raised to match. It names no implementation detail.

The delivery also updates: the careers spec's rules 1, 2 and 8 to point here for pay; the calendar spec for months; [S-money], [S-calendar] and [S-careers] in `docs/GAME-SYSTEMS.md`; `docs/player-visible-strings.md`; the save schema in `docs/ARCHITECTURE.md`; the comments in `content/careers.toml` that describe pay in shifts and object prices; the player guide articles in `docs/player/` that describe money, careers, the household status panel and Build mode, per [the guide authoring rules](../player-guide-authoring.md); [AL-sources] in the activity log specification, which gains bills as unlogged source 9 ([WB-hooks]); and a dated verification record, `docs/specs/2026-10-18-wages-and-bills-verification.md`, holding the calibration measurements and the played findings.

## [WB-rulings] Rulings for confirmation

Rulings 1 to 14 were taken during design on 2026-10-18 and rulings 15 and 16 during implementation on 2026-10-24, each without the owner, and each is marked **For confirmation** except rulings 1, 2 and 7, which the owner confirmed on 2026-10-18. The owner's earlier decision that issue 298 decides any shift premium is the reason ruling 6 exists.

1. **Confirmed by the owner on 2026-10-18:** a month is seven days (`bills.days_per_month = 7`), so bills arrive every Monday. Cost if wrong: one tuning number, plus recalibrating every monthly amount by the same factor.
2. **Confirmed by the owner on 2026-10-18:** the calibration target of [WB-numbers]: bills of about a fifth of a three-earner household's income and about 44 percent of the shipped worker's pay alone, with rent about two thirds of the total. Cost if wrong: tuning numbers only.
3. **For confirmation:** wages are multiplied by 1.5 in `content/careers.toml` and rounded half up to the whole dollar, and older saves' pay is migrated the same way. Cost if wrong: content edits and the migration rule.
4. **For confirmation:** bills are paid automatically, oldest first, never in part and never below zero, with no Pay button. Cost if wrong: a new command and panel control.
5. **For confirmation:** a late fee is 5 percent of the bill per day after five days' grace, capped at 50 percent. Cost if wrong: tuning numbers.
6. **For confirmation:** night shifts pay 15 percent more; early and late shifts pay no premium; the premium is applied to each shift's pay, not to the saved pay or range. Cost if wrong: one tuning number, or a premium per kind.
7. **Confirmed by the owner on 2026-10-18:** overdue bills give every housemate Behind on bills at minus 8 mood, and nothing is shut off or repossessed. Cost if wrong: one tuning number, or later work for shut-offs.
8. **For confirmation:** usage is charged per use at the start of physical work, per viewer for the television, and lamps are charged per day placed until a light switch exists. Cost if wrong: the counting site or the kind type.
9. **For confirmation:** the shower and the bath also cost electricity for hot water. Cost if wrong: two tuning numbers.
10. **For confirmation:** rent counts outdoor tiles excluding the street, bought land included, and is measured once a day from the confirmed layout. Cost if wrong: the counting rule.
11. **For confirmation:** base charges and rent accrue one day at a time, so the month after loading an older save is prorated. Cost if wrong: the amount formula.
12. **For confirmation:** the bed rule is checked when a bed is bought or moved and at Confirm, not on each wall edit inside a session, and beds already outdoors in older saves stay where they are. Cost if wrong: one more validation site, or a load-time step.
13. **For confirmation:** the Bills row lives in the household status panel and opens a read-only modal dialog that pauses the game. The panel shows cents; the row shows whole dollars rounded up. Cost if wrong: shell layout only.
14. **For confirmation:** usage labels live in `content/tuning.toml` with their rates, and a count for a usage kind that content no longer defines is dropped on load. Cost if wrong: moving the labels, or refusing such saves.
15. **For confirmation:** bills are not reported in the activity log, because the owner's seven filters have no Money or Mood filter; they join the log's unlogged sources ([WB-hooks]). Cost if wrong: a Money filter and a line kind for bills.
16. **For confirmation:** on the day of a shift change the night premium follows the shift actually worked that day, and the pay migration leaves settled shift records and outcomes at the pay they were settled at ([WB-wages], [WB-save]). Cost if wrong: one condition in the shift register, or a rewrite of settled history.
