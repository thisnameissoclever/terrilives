# Mood, waiting and life satisfaction

Owner direction, 2026-09-30: death is enabled for new and existing worlds. Sustained high or low mood is a major contributor to life satisfaction. Waiting for an occupied item lowers mood, more strongly when the relevant need is low.

## [MW-death-default] Enable existing worlds once

New worlds enable death. V5 appends `death_default_applied`, a boolean whose missing value is false. Loading a world from before this change enables death while preserving its deprivation counts and death records. Every new save writes true. Once migrated, the player's saved death setting wins, including an explicit off choice. Earlier save versions also start with death enabled. Loading does not advance the clock or kill anyone; the next simulation tick applies the existing deprivation rule.

## [MW-waiting] Occupied items lower mood

Directed orders, autonomous choices and chain stations publish the occupied object and the needs its activity benefits. Negative or zero advertised changes do not count as benefits. An activity that benefits several needs uses the greatest current deficit among them. Waiting at a cooking station uses the whole meal's advertised needs, rather than confusing a preparation step with the purpose of cooking.

The penalty increases linearly from `waiting_mood_min_penalty` with those needs full to `waiting_mood_max_penalty` with a relevant need empty. It appears as `Waiting for an item`. Active actions, walking, work and conversations do not receive it. Giving up and wandering does not count as waiting. An unreachable item is not an occupied item the sim can wait for. A free or removed object contributes nothing, including during paused command processing.

The waiting identity is saved and hashed in entity-index order. The score itself remains derived. Each simulation tick clears the previous decision before publishing the next one.

## [MW-satisfaction] Sustained mood changes satisfaction

Once per simulation tick, after recovery, neglect and death processing, living sims' derived moods contribute to their existing satisfaction ledger. All mood sources participate, including needs, conditions, nearby relationships, grief and waiting.

Scores inside `satisfaction_mood_neutral_band` contribute zero. Beyond it, contribution scales linearly to `satisfaction_mood_per_tick` at either end of the mood scale. Positive mood adds and negative mood subtracts. Satisfaction remains within 0-100. The ledger integrates duration: a brief fluctuation has a small effect, while a day at the same mood accumulates the corresponding daily change. Paused frames and read-only mood queries do not apply contributions.

The rate is 0.00038580247 at either extreme, about 0.556 points over a 1,440-tick day. A comfortable mood of +20 earns about 0.0327 per day with the neutral band at 15. The owner approved month-to-year pacing under [life satisfaction](2026-10-01-life-satisfaction.md). Hobby and career payouts and direct neglect costs remain. This replaces the earlier rule that meeting needs could never earn satisfaction.

Every mood input that now affects simulation outcomes is authored in `content/tuning.toml`. The browser continues to display Rust's projection and sends serialized commands for player actions.

## [MW-save] Keep historical envelopes readable

V5 appends the default migration boolean and a sparse waiting list after mortality. Each missing field is one zero byte. The decoder checks ten appended fields, accepts only canonical re-encoding, and permits padding to fill only the final missing fields. Cuts inside a list length or record remain invalid. Earlier floors, family ties and mortality records must survive migration.

The seventh and eighth appended fields retain the published self-preservation and exact chronotype offsets. The ninth stores shyness deviations; older saves derive the stat from saved identity. The tenth stores sparse privacy decisions, wait timing and player-directed chain origin. See [the interaction spec](2026-09-30-need-social-privacy.md) and [relationship development](2026-09-30-relationship-development.md).

## [MW-social-privacy] Frustration affects relationships, then mood

The locally implemented [unmet-needs and bathroom-privacy slice](2026-09-30-need-social-privacy.md) changes the offended Sim's directional affinity once at the relevant start or entry. Each Sim also has shyness from 1 to 100: higher values amplify their annoyance and increase deliberate privacy avoidance. Player orders remain available.

Existing nearby-relationship mood reads that opinion, and sustained mood reaches life satisfaction through [MW-satisfaction]. There is no extra direct incident charge to satisfaction and no new timed incident moodlet. Needs, occupied-item waiting, ordinary conversation gains and hobby payouts keep their existing independent effects.

[Relationship development](2026-09-30-relationship-development.md) adds pleasant-company gains, larger gains from recognized shared activities, and directional personality friction. Positive affinity requires the other person's hygiene above the low threshold and no critical need left unhelped by the subject's active interaction, chain work or live conversation. Existing dislike and low relationship-derived mood do not block recovery. Conversations keep one completion reward, and shared activities replace proximity and suspend friction during that contact. These affinity changes feed the same mood and satisfaction projection; they add no second payout or charge.

Privacy waits retain their path and reservation. Their diagnostic wait time is distinct from the occupied-item mood marker, which excludes walking. This slice does not add a second waiting mood penalty.
