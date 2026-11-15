# Slower need drain and full bathroom use

Issue 315 asks for two things. Every need drains on average 25 percent slower, and a toilet, shower or bath used for its full duration fills its need to 100. This specification records the rulings for both. The drain change ships first, in its own pull request, because it moves every world hash and balance figure in the game and keeping it apart lets each moved value be attributed to one cause. The fill change is stacked on it. Rulings the owner made on 2026-11-15 are marked **Owner**. Rulings the implementer chose are marked **For confirmation**.

## Contents

1. [Drain](#fb-drain-drain)

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

## Verification

Every moved pinned value, with its cause, is recorded in [the verification record](2026-11-15-full-bathroom-use-verification.md).
