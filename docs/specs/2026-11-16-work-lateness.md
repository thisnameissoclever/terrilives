# Work lateness and Bladder at work

Issue 309 asks that a housemate stay home from work because of critical needs for a bounded time only, and that while a need is critical after the shift has started they have a rising chance, up to 99 percent, of doing something that relieves it. The owner decided on 2026-11-15 that the allowance is one hour, that only Hunger and Energy count, and that Bladder is instead relieved at work whenever it falls below about half, so it never becomes critical during a shift.

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
2. The allowance never reaches the shift's end: at and after `end_tick` the shift is not open and nobody departs for it. A shift shorter than the limit may be spent entirely at home, and then settles once with no worked minutes and no pay.
3. When the allowance ends, or when no counted need is critical and nothing is running for one, the person departs through the existing `depart`, unchanged. `depart` removes the running interaction, target, reservation and the rest as it always has, so a meal or a sleep still running at the limit is cut off.
4. The check sits after the waiting game-made fight is withdrawn, after the player-work check and after the reading-journey check. A waiting game-made fight is still withdrawn at the shift start. A player's order still delays departure without limit; once it is gone the person leaves at once if the allowance is over, whatever their needs. A reader on a journey is asked home as before.
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

A person at work has their Bladder restored to full whenever it is below `work_bladder_relief_threshold` (50). It runs at the end of every tick for each person at work, after the tick's decay, so a worker never sits at work with a Bladder under the threshold. Nothing else is relieved at work; Hunger, Energy and the rest still drain at `at_work_decay_scale`, and the energy cost of the shift is unchanged. A threshold of 0 relieves nobody. The commute is not at work, so Bladder drains normally while commuting and at home.

With the shipped rates a worker who arrives at 100 percent Bladder reaches about 84 over a whole shift, so the relief matters for people who arrive low. The relief is instant and costs no minutes and no money: it stands for a trip to the office toilet, as the doc comment of `decay_needs` already describes the office.

## [WL-tuning] Tuning

Four root keys follow `night_shift_premium_percent` in `content/tuning.toml`, and the compiled `Tuning` appends them after it in the same order.

| Knob | Shipped | Range | Meaning |
| --- | --- | --- | --- |
| `work_lateness_limit_ticks` | 60 | 0 to 720 | Longest a critical need may keep a worker home after the scheduled start. 0 leaves on time. |
| `work_lateness_ramp_ticks` | 30 | 1 to 720, and at most the limit when the limit is above 0 | Lateness at which the remedy share reaches its maximum. |
| `work_lateness_remedy_share` | 0.99 | above `1 - unrelated_single`, below 1 | The most the remedies of the late need can take. |
| `work_bladder_relief_threshold` | 50 | 0 to 100 | A worker at work is relieved of Bladder below this level. 0 is no relief. |

The compiler refuses each out-of-range value by name and refuses non-finite values. A pack published before the knobs reconstructs a limit of 0 and a threshold of 0, so a published world keeps leaving on time and is never relieved at work, with the ramp and share at their shipped values, which are inert. The frozen pre-books sources are expanded the same way ([L-required-tuning-historical-expansion]). The crisis level is not a new knob: it is `mood_critical_need_level`. The 120-minute grace and the 10-point deduction are still code literals, as they were; moving them to tuning is a follow-up.

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
5. A limit of 0 leaves on time. A shift shorter than the limit is never left for after its end, and settles once with no pay.
6. A player's order still delays departure past the limit, and the worker leaves as soon as it is gone.
7. A worker on the way to work or at work is not turned back by a crisis.
8. A waiting game-made fight is withdrawn although the initiator stays home late.
9. A save taken mid-lateness continues with the same world hash on every tick.
10. The choice parameter reports the lateness along the ramp, and nothing for Bladder or for an uncritical worker.
11. The unrelated share equals today's cap at the start, the exact linear value halfway and `1 - work_lateness_remedy_share` from the ramp on, and stays above 0; relief of an uncounted critical need is unrelated while late; with no lateness the probabilities are the pinned vector of before this change.
12. A worker at work is relieved of Bladder below the threshold and not at it, only Bladder is relieved, a worker at home is not relieved, and with the real decay rates Bladder never falls below the threshold during a shift.
13. A worker who is not critical but is mid-meal on the start tick leaves on the start tick, and the allowance predicate is pinned on its own: it opens at the start, closes at the limit or at the shift's end, whichever is first, and is shut for a settled shift or a limit of 0.
14. The knob compile, published-pack, pre-books and fixture checks in the data crate.
