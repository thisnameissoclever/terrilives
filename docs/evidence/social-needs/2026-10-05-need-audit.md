# Need rewards audit

Source audit dated 2026-10-05, based on `1a138df6` and the accompanying Social
correction. This records authored rewards and runtime delivery rather than a
claim that every mapping has owner approval. No other need rewards were changed.

## Scope and reward inventory

Reviewed `content/objects.toml`, `content/chains.toml`, `content/social.toml`,
personality multipliers, ordinary and chain delivery, media and dining seating,
conversation delivery, need decay, relationship contact and career behavior.
Numbers below are nominal authored points; personality, action length, food
quality, interruption and the 100-point meter ceiling can change the result.
Negative values are costs.

| Action | Need rewards or costs |
| --- | --- |
| Snack | Hunger +40 after eating |
| Cook and eat a meal; collect and eat a prepared meal | Hunger +70 and Comfort +15 after eating; conditional Social +11 over 90 eating minutes |
| Sleep in a bunk | Energy +100 |
| Sleep in a double bed | Energy +108, Comfort +10 |
| Shower | Hygiene +70, Energy -12 |
| Bath | Hygiene +58, Comfort +31, Energy -3 |
| Toilet | Bladder +95 |
| Wash hands at a bathroom sink | Hygiene +32 |
| Wash hands at a kitchen sink | Hygiene +20, Comfort -6 |
| Watch TV | Fun +30; Social +24 over 55 minutes only with active liked company using the same device |
| Listen to the radio | Fun +22; Social +5 over 38 minutes only with active liked company using the same device |
| Sit on the ottoman | Comfort +34, Fun +18 |
| Stretch out on the long sofa | Comfort +43, Fun +13, Energy +9 |
| Sit in the armchair | Comfort +29 |
| Sit at the dining table without a meal | Comfort +37; no Social |
| Read at the bookshelf | Fun +26 |
| Read in the reading chair | Comfort +15, Fun +19 |
| Exercise on the bike | Fun +28, Energy -8, Hygiene -5 |
| Attend correspondence | Fun +36, Energy -7 |
| Watch the aquarium | Fun +25, Comfort +21 |
| Chat | Social +0.75 and Fun +0.15 per minute before personality and relationship scaling; Social requires positive affinity toward the partner |
| Clean dishes | No direct need reward; removes dish-related environmental mood penalties |

## Findings and recommendations

1. **Seated media misses chair comfort.** TV and radio delivery reads the
   device's rewards, while the secondary chair changes reservations and the
   visible pose. Neither action restores Comfort, even when the same armchair
   would restore +29 through its ordinary sitting action. Add comfort from the
   actual claimed seat during seated use; standing viewers should receive none.
   Do not copy the chair's entertainment or energy rewards onto the media action.

2. **Meal comfort does not distinguish seating.** Seated, standing and
   tableless meals all receive the same +15 Comfort at completion, scaled by
   food quality. The seat itself contributes nothing. Decide whether this
   reward represents pleasant food or physical comfort. If food comfort is
   intentional, keep it separate from comfort earned by using a real seat.

3. **The kitchen hand-washing cost reflects an obsolete chore description.**
   Its current label and activity are Wash hands, yet its comments justify
   Comfort -6 as the cost of washing dishes. Bathroom hand washing has no such
   cost. Remove that cost or document a physical reason for the difference;
   do not attribute dishwashing's effects to the current hand-washing action.

4. **Hand washing can substitute indefinitely for whole-body hygiene.**
   Both sink actions add to the same general Hygiene meter without a limit
   based on what washing hands can clean. Repeated hand washing can fill the
   meter completely and remove low-hygiene social consequences. If Hygiene
   includes body odor and general cleanliness, cap the effect or distinguish
   hand cleanliness. A sink should remain useful without replacing bathing.

5. **Plain sitting restores Fun.** The ottoman adds +18 Fun, and stretching
   out on the sofa adds +13 without reading, media or another active pastime.
   Resting can be pleasant, so this is a design decision rather than a confirmed
   defect. Define whether Fun includes quiet relaxation; otherwise give plain
   sitting Comfort and reserve Fun for an actual entertaining activity.

6. **Bunk and double-bed comfort differ categorically.** The bunk supplies
   no Comfort, while the double bed supplies +10. Bed quality can justify a
   different amount, but the current content does not define a general
   seat/bed comfort model. Resolve this alongside secondary-seat comfort
   rather than treating the sleeping animation as evidence of a reward.

7. **Recognized shared activities affect affinity but not Social.** Reading,
   exercise and aquarium watching already have shared-activity recognition.
   Their current effect is friendship development, not a Social refill.
   Adding Social would be a separate decision about which activities involve
   company rather than merely simultaneous individual activity.

The other reviewed mappings have a plausible direct cause: food restores
Hunger, sleep or reclining restores Energy, toilet use restores Bladder,
bathing and washing restore Hygiene, entertainment restores Fun, and resting
or a bath can restore Comfort. Exercise's energy/hygiene costs and bathing's
energy costs are authored tradeoffs; this audit did not establish that their
magnitudes are balanced. Cooking hobbies and cleaning improve life satisfaction
or mood through separate systems; those effects are not need-meter refills.

The recommended next correction is a consistent source for seat comfort.
Handle the kitchen hand-washing cost alongside the intended meaning of Comfort.
Changes to hygiene limits or relaxation rewards need an explicit design choice.
