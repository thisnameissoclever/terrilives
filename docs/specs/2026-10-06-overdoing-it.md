# Overdoing it: repetition costs happiness, and too much food makes you sick

Status: implemented on branch `twcl/acclimation` on 2026-10-06; evidence is in [the verification record](2026-10-06-overdoing-it-verification.md). This is the implementation contract for part one of [S-acclimation] in `docs/GAME-SYSTEMS.md`, written on 2026-10-06 against main `297f2ea9` during autonomous roadmap work. Part two (novelty from purchases) is out of scope. The owner's direction (recorded in that entry): the 45% floor goes away for mood; a Sim who keeps repeating an action, even one they liked, loses happiness from it and loses more the longer they keep going; an action's effect on its need is unchanged; eating again and again when not hungry lowers happiness and eventually makes the Sim feel sick, a temporary condition with a moodlet.

## [OD-model] Repetition above saturation is overdoing

Today each completed use raises the person's habituation for that object and flyout row by `habituation_per_use` (0.34), capped at 1, and every tick lowers every entry by `habituation_decay_per_tick` (0.0011). Autonomy multiplies an action's advertised benefit by `benefit_scale`, which never falls below `habituation_floor` (45%). That mechanism stays as it is for appeal.

The cap rises: habituation now accumulates up to `habituation_max` (3.0), and the part above 1 is overdoing. Appeal still reads at most 1 (`benefit_scale` clamps its input), the Sim details repetition meter still shows at most 100%, and need delivery still ignores repetition, so the only new effect of the range above 1 is on mood, with one consequence for appeal: because decay has to bring the value back below 1 before appeal starts to recover, an activity pushed to the top keeps its appeal at the floor for about 30 game hours instead of recovering at once. A save written while anyone is above 1 does not open in builds older than this change, which is the same limit every appended save field already carries. Because decay is linear and continuous, an entry above 1 falls back below 1 on its own; that is the temporary condition's timer, and no new saved state is needed. Habituation is already saved, validated and hashed; the load validator's range widens to `0.0..=habituation_max`.

A person eating three spaced meals a day never crosses 1 (the decay between meals exceeds one use's rise). Ordering snacks back to back, each starting when the last ends, crosses 1 after the fourth snack, makes the Sim feel sick after about the tenth and reaches the top after about the twelfth.

## [OD-moodlets] Two derived moodlets

Mood is derived, never stored, so the new effects are moodlets computed from habituation when mood is read:

1. For every habituation entry above `overdoing_threshold` (1.0): `Overdoing {activity}` with score `-overdoing_penalty * (value - threshold) / (habituation_max - threshold)`, where `overdoing_penalty` is 20, so the penalty grows with each further use and cancels "Needs met" at the top. `{activity}` is the same label the Sim details repetition row uses (the interaction's label, or the chain's label for a chain row).
2. For every entry whose action advertises a positive Hunger delta (food) and whose value is at or above `sick_threshold` (2.5): `Feeling sick` with score `-sick_penalty` (25), once per person however many food entries qualify. It appears after the overdoing moodlets and lasts until decay brings every food entry below the threshold, about 455 ticks (seven and a half game hours) from the top.

From the top, with no further use, appeal stays at the floor for about 1818 ticks (30 game hours), and both moodlets have cleared after about 1820 ticks.

Both moodlets come after every existing moodlet (after `Dirty dishes`), in the order of the habituation entries (object, then row), so existing exact-list tests keep their order. Satisfaction follows mood through the shipped mood-to-satisfaction rule; nothing else reads the new moodlets. Autonomy does not read mood, so this slice does not stop a Sim choosing an action it is overdoing; that feedback remains [P-mood-feedback] work and is recorded as a limit.

## [OD-content] Tuning

New keys in `content/tuning.toml`, validated at compile time: `habituation_max` (finite, greater than 1), `overdoing_threshold` (finite, at least 1, below `habituation_max`), `overdoing_penalty` (finite, non-negative), `sick_threshold` (finite, above `overdoing_threshold`, at most `habituation_max`), `sick_penalty` (finite, non-negative). Shipped values: 3.0, 1.0, 20, 2.5, 25.

## [OD-evidence] Proof required before delivery

1. The cap: consecutive back-to-back snacks reach `habituation_max` and not beyond; `benefit_scale` at 1.5 equals `benefit_scale` at 1.0; the details repetition reads 1.0 at 2.0; need delivery at the cap equals delivery at 0.
2. The moodlets: exact labels, scores at the threshold (zero), midway and the top; the order after `Dirty dishes`; `Feeling sick` once per person; a non-food activity at the top shows overdoing but never sick.
3. A played scenario: a person ordered to snack repeatedly gains `Overdoing Grab a snack` after the fourth snack, `Feeling sick` when habituation reaches the sickness threshold (the exact snack moves with the generator's draws, because each chain's length is drawn), satisfaction falls while the moodlets stand, and both fade by decay with no further orders over a fixed tick count, with the clock asserted.
4. Save: a value above 1 round-trips exactly and loads through the public boundary; a value above `habituation_max` refuses the load; the world hash moves with the value (it already did) and the bare-agent golden vector is unchanged.
5. Guard deletions recorded for the cap, the appeal clamp, the threshold, the food gate, the once-per-person rule and the validator's upper bound.
6. A displayed check: order snacks until both moodlets show in the Mood panel at desktop and phone widths, with screenshots.
