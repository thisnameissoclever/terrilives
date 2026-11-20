# Slower need drain and full bathroom use

Issue 315 asks for two things. Every need drains on average 25 percent slower, and a toilet, shower or bath used for its full duration fills its need to 100. This specification records the rulings for both. The drain change ships first, in its own pull request, because it moves every world hash and balance figure in the game and keeping it apart lets each moved value be attributed to one cause. The fill change is stacked on it. Rulings the owner made on 2026-11-15 are marked **Owner**. Rulings the implementer chose are marked **For confirmation**.

## Contents

1. [Drain](#fb-drain-drain)
2. [What a bathroom use does](#fb-fill-what-a-bathroom-use-does)
3. [The length of a use](#fb-length-the-length-of-a-use)
4. [Stopping](#fb-stop-stopping)
5. [Authored numbers](#fb-content-authored-numbers)
6. [Other effects during a use](#fb-effects-other-effects-during-a-use)
7. [Forecasts](#fb-forecast-forecasts)
8. [The tuning knob](#fb-tuning-the-tuning-knob)
9. [Saves, hashes and fixtures](#fb-save-saves-hashes-and-fixtures)
10. [Overlap with other work](#fb-overlap-overlap-with-other-work)
11. [Questions the owner's rulings settle](#fb-rulings-questions-the-owners-rulings-settle)
12. [Verification](#fb-verify-verification)

## [FB-drain] Drain

**Owner:** every need's base rate in `[decay_per_tick]` of `content/tuning.toml` is multiplied by 0.75, which is what "25 percent slower" says. A bar therefore lasts a third longer. Personality drain multipliers, `asleep_decay_scale` and `at_work_decay_scale` multiply the new base rates as they multiplied the old ones, so a sleeping or working person is 25 percent slower too.

| Need | Before | After |
| --- | --- | --- |
| Hunger | 0.0413333333 | 0.031 |
| Energy | 0.034 | 0.0255 |
| Hygiene | 0.048 | 0.036 |
| Bladder | 0.068 | 0.051 |
| Social | 0.0173333333 | 0.013 |
| Fun | 0.032 | 0.024 |
| Comfort | 0.0213333333 | 0.016 |

The rates are points lost per game minute before modifiers. They stay pairwise distinct, which `needs_decay_at_different_rates` requires so that a need read from another need's slot is visible. The balance before 2026-10-19 was twice these values; the pass of that date to two thirds and this one to three quarters of that leave half.

The change needs no new knob and no schema. Rates are content, so a saved game picks up the new ones when it loads and the stored need values are untouched. A pack published before the change keeps the rates it was compiled with, which is why the published control in the world-hash test is unchanged.

Comments in `content/tuning.toml` that quote a balance measurement, such as those for `at_work_decay_scale` and `asleep_decay_scale`, were measured under the rates before 2026-10-19. They now say so. They are not re-measured: the knobs they explain still do what they did, and each is a fraction of whatever the base rate is.

## [FB-fill] What a bathroom use does

**Owner:** a toilet, shower or bath used for its full duration fills its need to 100 percent. The toilet fills Bladder; the shower and the bath fill Hygiene. "Full duration" is however long it takes to fill the bar at the rate the person and the fixture already define, so a better model of a fixture that authors a higher rate fills faster with no new field.

**Owner:** only these three activities fill, identified by their compiled activity (`using_toilet`, `showering` and `bathing`), as hand washing's ceiling is identified by `washing_hands`. Both sinks are not fills: hand washing still stops at its own ceiling and cannot remove body odor, and its tests are unchanged. Any future model of a fixture with one of the three activities fills automatically.

**Owner:** stopping a use early leaves the need partly filled. An order that sends the person elsewhere keeps only the minutes already spent. A player-ordered use fills the same way as a chosen one, and critical needs still never override player orders.

## [FB-length] The length of a use

A use of one of the three used to last a length drawn around the authored duration. It now lasts the number of ticks the need takes to reach 100 at the person's net rate for that fixture, where the net rate is the delivery rate for the need less the drain the person has during the use. The delivery rate is the same arithmetic as before: the authored delta over the authored duration, scaled by the person's satisfaction multiplier for that need and, for a fumbled attempt, by the fumble scale. No new rate is introduced.

The length is found once, when the person arrives, by running the use's own arithmetic ahead of time: `need_interactions::fill::fill_ticks` copies the person's needs, then for each tick drains the need (every tick but the first, because the arrival tick's drain ran before the person arrived) and delivers, with the same `Needs` methods, `ordinary_rate` and drain amount (`systems::needs::drain_amount`) that play uses, until the need reaches 100. It is a loop and not a closed form so that float rounding cannot leave a use at 99.9 or one tick past full. It runs at arrival only, is bounded by the limit below, and draws no random numbers.

Bounds:

1. At least `min_interaction_ticks` (12), so a person who is nearly full still visibly uses the fixture. For a typical toilet use, which starts around half full, this floor is the length of the use.
2. At most `need_fill_max_ticks` (240), so a person who gets very little from the activity cannot hold the bathroom for hours. A use that reaches the limit ends with the need partly filled.
3. If the person's net rate is not above zero the length is not computed and the use keeps its drawn length, so it cannot hold the room for the limit.

**Determinism.** The drawn length is still sampled, and its fumble roll still follows it, in the same place and order, so the random stream consumes the same numbers as before for every action. For the three fills the draw's result is discarded when a length is computed. `the_duration_draw_is_still_taken_for_a_fill` pins this.

## [FB-stop] Stopping

A use that began on this version already has the length that fills its need, so it ends when that length runs out, which is the tick the need reaches exactly 100. A use resumed from a save made before the change has a drawn length that may be far longer than the need takes to fill. `tick_interactions` ends a bathroom use on the tick its need is full when more than `min_interaction_ticks` of the length is still to run. It never cuts off the final minimum-length stretch of a use, so a nearly full person who arrives now still stays for the floor (a use resumed from an older save is the one exception, because elapsed time is not saved). A use resumed from a save made before the change can end sooner than the minimum, because how long it has already run is not saved: a resumed use with 14 ticks left and a full need ends within two ticks. A resumed use whose drawn length is shorter than the need takes ends then with the need partly filled, as an interruption does.

## [FB-content] Authored numbers

**Owner:** raise the toilet, shower and bath rates so a full use from an empty bar takes about 15 game minutes at the toilet and 30 to 45 at the shower and bath. Every authored number lives in `content/objects.toml`.

| Action | Advertises | Duration | Rate for the filled need | From empty, neutral person |
| --- | --- | --- | --- | --- |
| Use the toilet | Bladder 135 | 20 | 6.75 a minute | 15 minutes |
| Take a shower | Hygiene 110, Energy -20 | 40 | 2.75 a minute | 37 minutes |
| Take a bath | Hygiene 95, Comfort 55, Energy -5.5 | 40 | 2.375 a minute | 43 minutes |

Before the change the authored rates were Bladder 95 over 24 ticks, Hygiene 70 and Energy -12 over 90, and Hygiene 58, Comfort 31 and Energy -3 over 78. The deltas are deliveries over the authored duration, not caps, so they can exceed 100. The toilet's duration is 20, not shorter, because the build refuses an interaction whose duration times `1 - duration_variance` falls below `min_interaction_ticks`; that refusal is why the toilet's rate comes from its delta. The three numbers 15, 37 and 43 are pinned by `shipped_full_uses_from_an_empty_bar_take_15_37_and_43_ticks`, and the player guide's activity article describes them in prose.

## [FB-effects] Other effects during a use

**Owner:** the shower's Energy cost and the bath's Comfort stay per minute, so they follow the time spent, and the total shower Energy cost stays close to what it was. The authored side rates were therefore raised with the fill rate, so a typical use, which starts around half full and now lasts 15 to 20 minutes, costs about what a typical use cost before. They were chosen by measurement: with the trace example the mean net Energy change of a shower over a week was about -10.8 before and is about -8.4 after; the figures are in [the verification record](2026-11-15-full-bathroom-use-verification.md). A shower from an empty bar takes 37 minutes and costs 18.5 Energy.

Positive multipliers still scale benefits and costs arrive in full: a person who gets little from showers still pays the whole per-minute Energy price for as long as their use lasts.

## [FB-forecast] Forecasts

Prediction and delivery share physical reward scaling and now share length. For a toilet, shower or bath, the critical-need forecast (`systems::critical_choices::forecast::object_outcome`) plans the use at the length that fills the need for that person, found from the needs they would have after the walk. Every other action is planned at its authored duration, as before. `the_forecast_of_a_fill_agrees_with_what_delivery_produces` compares the forecast with a played use for every need, within one tick of that need's drain, which is the one-tick difference every forecast already has from play.

**For confirmation (designer's choice):** ordinary scoring, `score_advertisement`, and the survival risk of the time spent keep the authored delta and duration for these actions. An advertisement can honestly promise only what the content declares, and the risk term matters only while death is enabled and Hunger or Energy is critical. The risk estimates the time as the authored duration, 40 ticks for a shower, times one plus the duration variance. That undercounts a person who gets little from the activity: with a satisfaction multiplier of 0.5 a shower from an empty bar takes about 75 ticks, and it can reach the 240 tick limit for a lower one. The privacy alternative has no forecast of its own, only that risk, so it is unchanged. Because the authored rate of the three actions rose, their ordinary scores rose with it, and they compete more strongly with other actions for a person who needs them; the measured effect is in the verification record.

## [FB-tuning] The tuning knob

`need_fill_max_ticks` in `content/tuning.toml`, appended after the last root knob and to the compiled `Tuning`: shipped value 240, valid from `min_interaction_ticks` to 1440. A neutral person from an empty bar needs about 15 ticks at the toilet and under 45 in the shower or bath, so from an empty bar the limit only binds for a satisfaction multiplier below about 0.07 at the toilet and about 0.2 in the shower or bath. Packs published before the knob existed reconstruct 240. Their worlds still change behavior with the fill, because the fill is a rule, not a knob a pack opts into.

## [FB-save] Saves, hashes and fixtures

**Save format: no change.** The length lives in the already saved `Eating.remaining_ticks`, and the rule is derived from the compiled activity. A save taken mid-use on the previous version loads with its drawn remaining ticks and finishes at that length or, when more than the minimum is left, on the tick the need is full. `a_use_resumed_from_a_save_with_a_long_drawn_length_ends_when_full` and `a_save_taken_mid_fill_continues_identically` cover both.

**Content fingerprint: unchanged.** It deliberately leaves out tuning numbers, advert deltas, durations and activities, so neither the retuned rates nor the new knob moves it or the saved action manifest. `the_shipped_content_fingerprint_is_the_one_main_had` pins the value read from main.

The compiled runtime fixture `crates/terri-data/tests/fixtures/inherited-runtime.pack` changes by exactly two things: the fill limit appended to the tuning and the three bathroom actions' authored numbers. The fixture test proves this by rebuilding the previous bytes from the current pack and comparing them with the file on main before regenerating (26134 bytes, SHA-256 `5e779fbb7a08c0693d2d76eafd20dffe9cb43bb5066dcf8654d321794b09afe8`, main at 54cf96b46, which already holds the wages and bills of issue 298). The other pinned values that moved, and why, are in the verification record.

## [FB-overlap] Overlap with other work

Pull request 306 (wages and bills) edits these three actions in `content/objects.toml`, appends tuning knobs and charges a use once when its physical work starts, at the `movement.rs` site this change also edits. A longer shower costs the same per-use fee under its design. When the second of the two lands, merge main and keep both sides: the knobs are appended after each other, the action edits touch different keys, and the charge stays exactly once per start.

Issue 309 (lateness for critical needs) should be measured after this change lands: a fill-to-full shower is short in practice, but the allowance is longer than it was.

## [FB-rulings] Questions the owner's rulings settle

| Question | Ruling |
| --- | --- |
| Q9: does "full duration" change how long a use lasts | **Owner:** yes, a use lasts until its bar is full. |
| Q10: keep today's rates or raise them | **Owner:** raise them, so a full use from empty takes about 15 minutes at the toilet and 30 to 45 in the shower or bath. |
| Q11: what happens to the other effects | **Owner:** they stay per minute, with the side rates raised so the total shower Energy cost stays close to today's. |
| Q12: how better models express speed | Through the model's own authored rate; no new field. A test model that authors twice the rate fills in about half the ticks. |
| Q13: which actions fill | **Owner:** exactly the three, identified by their compiled activity. |
| Q14: what "25 percent slower" means | **Owner:** multiply each base rate by 0.75. |
| Q15: one pull request or two | **Owner:** two, the drain first, the fill stacked on it. |

## [FB-verify] Verification

Every moved pinned value, with its cause, the measurements and the mutation checks are recorded in [the verification record](2026-11-15-full-bathroom-use-verification.md).
