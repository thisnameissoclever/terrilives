# Work lateness and Bladder at work

Issue 309 bounds how long critical needs may keep a housemate home from work. Only Hunger and Energy delay departure, for at most one hour. During that allowance, the chance of choosing relief rises to 99 percent. Once at work, Hunger, Bladder and Social receive automatic care before they become Critical.

This document amends the Work section of the [player orders spec](2026-10-17-player-orders.md) and [WS-systems] of the [shifts and careers spec](2026-10-18-shifts-and-careers.md). The implementation plan for the issue is the source of the questions answered in [WL-answers].

## Contents

1. [How the game behaved before](#wl-before-how-the-game-behaved-before)
2. [Owner decision and answers](#wl-answers-owner-decision-and-answers)
3. [Departure](#wl-depart-departure)
4. [The remedy share](#wl-ramp-the-remedy-share)
5. [Bladder at work](#wl-bladder-bladder-at-work)
6. [Tuning](#wl-tuning-tuning)
7. [Saves, hashes and pinned values](#wl-save-saves-hashes-and-pinned-values)
8. [Rulings that stay in force](#wl-rulings-rulings-that-stay-in-force)
9. [Verification](#wl-tests-verification)

## [WL-before] How the game behaved before

1. **Nothing kept a worker home for a critical need.** `attendance::start_tick` registers each shift on its start tick and, on that tick and every later tick while the shift is open and the person is at home, calls `depart` unless a player order is queued (`player_actions::has_player_work`) or the person is on a reading journey. No need was read on the way. A person asleep, on the toilet or halfway through a meal was pulled out on the start tick. The shift start is a command the clock issues, with the same priority as a player's click.
2. **A worker at work could not be served at all.** `AtWork` removes a person from the lot. While they are there, `decay_needs` drains every need at `at_work_decay_scale` (0.5) of the usual rate, and nothing restores any need: the office is treated as a building with a toilet and a kettle in it, but only in the rate. Over a 480-tick shift Bladder alone loses 16 points at the scaled rate (0.068 times 0.5 per tick), so a worker who left home at 35 percent Bladder was critical before the end of the shift, and one who left home critical stayed critical through it.
3. **Choices while a need is critical.** `critical_choices::critical_choice_probabilities` splits the candidates into those whose forecast relieves any critical need and the rest, and caps the unrelated share at `[autonomy] unrelated_single` (0.05) with one critical need or `unrelated_multiple` (0.01) with two or more. The cap is a ceiling: the unrelated share is the smaller of the cap and the unrelated group's own weight. Any critical need counted, including Fun, Social and Comfort.
4. **Lateness costs** are unchanged: pay is prorated by the minutes worked, and past 120 missed minutes each further hour costs 10 performance points. A commute counts as missed time.

## [WL-answers] Owner decision and answers

The owner's decision of 2026-11-15 is binding and replaces the plan's recommendations for Q2 and Q5.

| Question | Answer |
| --- | --- |
| Q1: does the issue add an allowance? | Yes. Nobody stayed home for a critical need before, so this adds a bounded one. |
| Q2: which needs count? | **Hunger and Energy only.** Bladder never delays a departure. Hygiene, Fun, Social and Comfort do not count. |
| Q3: how is the limit counted? | From the shift's scheduled start, **60 game minutes**, however the time was spent. It needs no saved state: the start is in `Attendance`. |
| Q4: when does lateness end once the need recovers? | When no counted need is critical **and** the person is not still running an activity that raises one; that activity finishes first, within the limit. |
| Q5: what does the chance ramp over? | Lateness so far. The share of choices that relieve the late need rises in a straight line from its usual cap to 99 percent, which it reaches `work_lateness_ramp_ticks` (30) minutes after the scheduled start, then holds. The owner asked that it ramp up to 99 percent and left the ramp's length to the implementer. |
| Q6: what is a remedy? | While late, only the relief of a counted critical need is a remedy. Relief of another critical need, such as Fun, is an unrelated choice. |
| Q7: what if no remedy is reachable? | The worker stays home anyway until the limit. The hour bounds the harm. |
| Q8: should the player see why someone is late? | No new text. The activity already shows what they are doing and the Career tab's attendance line reports missed minutes. |

## [WL-depart] Departure

1. At home with an open shift, a person does not depart while the allowance lasts and either a counted need is critical (at or under `mood_critical_need_level`) or, after the start tick, they are still running an ordinary activity that advertises Hunger or Energy. On the start tick only a critical need counts: a person who is not critical but happens to be mid-meal or asleep leaves on time, as before. A person still at home after the start tick was kept there by a need, so finishing what the need set going is part of the same lateness, and the rule reads no saved state. The allowance lasts from the scheduled start up to, not including, the start plus `work_lateness_limit_ticks`, so the latest departure tick is the start plus the limit. A limit of 0 leaves on time, as before.
2. The allowance never reaches the shift's end: at and after `end_tick` the shift is not open and nobody departs for it. The compiler refuses a limit that is not below the shift ticks of every job, standard or offered, so in compiled content the allowance can never cover a whole shift. The predicate and the departure still stop at the shift's end on their own, for a hand-built world: a shift shorter than the limit is never left for after its end, and settles once with no worked minutes and no pay.
3. When the allowance ends, or when no counted need is critical and nothing is running for one, the person departs through the existing `depart`, unchanged. `depart` removes the running interaction, target, reservation and the rest as it always has, so a meal or a sleep still running at the limit is cut off.
4. The check sits after the waiting game-made fight is withdrawn, after the player-work check and after the reading-journey check. A waiting game-made fight is still withdrawn at the shift start. A player's order still delays departure without limit; once it is gone the person leaves at once if the allowance is over, whatever their needs. A reader on a journey is asked home as before, until the limit: from 2026-11-19 a reader still returning a book at the limit leaves it on the floor and departs ([late book returns](2026-11-19-late-book-returns.md)).
5. A worker already commuting or at work is never turned around by a need.
6. The check is one predicate, `lateness::waits_for_needs`, so a later command that sends a person to work regardless of needs (issue 311) can bypass it without touching anything else.

## [WL-ramp] The remedy share

While a person is at home, inside the allowance, with a counted need critical, `select_action` asks `ShiftRhythm::lateness` for a `Lateness` value and passes it to `critical_choice_probabilities`. The value holds the progress along the ramp (the minutes since the scheduled start over `work_lateness_ramp_ticks`, at most 1), the counted needs and the remedy share.

1. The remedy group is the candidates whose forecast relieves a counted critical need. Relief of another critical need joins the unrelated group.
2. The cap on the unrelated group falls in a straight line from the autonomy cap in force (0.05 with one critical need, 0.01 with several) to `1 - work_lateness_remedy_share` (0.01). It never rises. With several critical needs the cap is already 0.01, so the ramp changes nothing.
3. The cap stays a ceiling, as before: the unrelated share is the smaller of the cap and the group's own weight. The share stays above 0, since the remedy share is below 1, so unrelated choices stay possible but rare.
4. When no candidate relieves a counted need, the distribution is the ordinary one, as it is today when nothing relieves a critical need.
5. Without lateness the function returns exactly the probabilities it returned before this change. The number of random draws per decision is one, as before; the ramp changes probabilities only.

## [WL-bladder] Bladder at work

A person at work has Hunger, Bladder and Social restored to 50 when their decay would cross `mood_critical_need_level`. Arrival restores those three needs when they are at or below `mood_low_need_level`. Ordinary decay continues, and Energy, Hygiene, Fun and Comfort receive no work refill. The shift's Energy cost still applies. Commuting and waiting outside for a route home receive no work refill.

The relief is instant and costs no minutes or money. It represents meals, toilet breaks and company during a shift.

## [WL-tuning] Tuning

Four root keys follow `night_shift_premium_percent` in `content/tuning.toml`, and the compiled `Tuning` appends them after it in the same order.

| Knob | Shipped | Range | Meaning |
| --- | --- | --- | --- |
| `work_lateness_limit_ticks` | 60 | 0 to 720, and below the shift ticks of every job | Longest a critical need may keep a worker home after the scheduled start. 0 leaves on time. |
| `work_lateness_ramp_ticks` | 30 | 1 to 720, and at most the limit when the limit is above 0 | Lateness at which the remedy share reaches its maximum. |
| `work_lateness_remedy_share` | 0.99 | above `1 - unrelated_single`, below 1 | The most the remedies of the late need can take. |
| `work_bladder_relief_threshold` | 50 | 0 to 100 | Retained in the published pack layout for compatibility. Current work care uses the Low and Critical need thresholds. |

The compiler refuses each out-of-range value by name and refuses non-finite values. A pack published before the knobs reconstructs a lateness limit and legacy bladder threshold of 0, with the ramp and share at their shipped values. The frozen pre-books sources are expanded the same way ([L-required-tuning-historical-expansion]). Current work care uses `mood_low_need_level` for arrival and `mood_critical_need_level` after decay. The 120-minute attendance grace and the 10-point deduction remain code literals.

## [WL-save] Saves, hashes and pinned values

**Save format: no change.** Lateness is derived from saved facts: the open scheduled shift, the person's needs and whether they are at home. A save taken mid-lateness loads into the same state and continues identically, which a test pins. The world hash gains no section.

Behavior changes move hashes in runs where a worker is critical at a shift start or at work. The shipped values this moved, with the old and new numbers, are in the [verification record](2026-11-16-work-lateness-verification.md).

## [WL-rulings] Rulings that stay in force

1. Player orders outrank everything and delay departure without limit.
2. A shift's end is never extended and nobody works two paid shifts in a day. The allowance only spends minutes of the original shift.
3. A waiting game-made fight is withdrawn for critical needs or for work; running fights finish.
4. Self-chosen chats give up on the initiator's critical Hunger or Energy.
5. Determinism is load-bearing: the allowance consumes no random draw, and the number of draws per decision is unchanged.
6. Every tunable lives in `content/tuning.toml`.

## [WL-tests] Verification

The tests are in `crates/terri-sim/src/lateness_tests.rs`, `crates/terri-sim/src/systems/critical_choices.rs`, `crates/terri-sim/src/social_episode/tests/order_cycle_tests.rs` and the data crate's knob tests. They cover:

1. A critically hungry worker eats and then leaves inside the limit, and no departure happens on the start tick.
2. A worker with nothing critical, with a critical Bladder, and with a critical Fun, Social, Hygiene or Comfort leaves on the start tick.
3. With no remedy the worker leaves exactly at the start plus the limit; with a sleep still running at the limit the departure cuts it off.
4. A meal that lifts Hunger above critical finishes before the departure.
5. A limit of 0 leaves on time. In a hand-built world a shift shorter than the limit is never left for after its end, and settles once with no pay. The compiler refuses a limit that is not below every job's shortest shift.
6. A player's order still delays departure past the limit, and the worker leaves as soon as it is gone.
7. A worker on the way to work or at work is not turned back by a crisis.
8. A waiting game-made fight is withdrawn although the initiator stays home late.
9. A save taken mid-lateness continues with the same world hash on every tick.
10. The choice parameter reports the lateness along the ramp, and nothing for Bladder or for an uncritical worker.
11. The unrelated share equals today's cap at the start, the exact linear value halfway and `1 - work_lateness_remedy_share` from the ramp on, and stays above 0; relief of an uncounted critical need is unrelated while late; with no lateness the probabilities are the pinned vector of before this change.
12. A worker receives half-full Hunger, Bladder and Social at Low or Critical arrival and before ongoing decay exposes Critical values. Home, commuting and waiting-to-return states receive no work care. The other four needs continue decaying.
13. A worker who is not critical but is mid-meal on the start tick leaves on the start tick, and the allowance predicate is pinned on its own: it opens at the start, closes at the limit or at the shift's end, whichever is first, and is shut for a settled shift or a limit of 0.
14. `select_action` gives a late worker the ramped remedy share: the same critical decision gives the remedy 95 percent on the start tick and 99 percent 45 minutes in, with the television that tempts the worker most scoring far above the weak snack, so the cap decides the shares. A housemate with no job gets no lateness and today's share. With Hunger and Bladder both critical, Hunger keeps the worker home and only the relief of Hunger is a remedy, while the relief of Bladder joins the unrelated choices.
15. The knob compile, published-pack, pre-books and fixture checks in the data crate.

## Merge with main

Merged with main at `f58ddcf57` on 2026-11-16, after the slower need drain (#349) and the full toilet, shower and bath uses (#350). Nothing in the rules above changed. The four lateness knobs stay the last fields of `Tuning`, after `need_fill_max_ticks`; the numbers and pins that moved are in [the verification record](2026-11-16-work-lateness-verification.md#merge-merge-with-main). At the slower drain the shipped household's first days no longer reach a critical need at a shift start, so the work lateness rules show only in longer runs.
