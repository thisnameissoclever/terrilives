# Burnt meals

Issue 243 defines this change. Recipes, stations, cooking fumbles and the
cooking skill remain the owners of everything else about meals.

## Intended behavior

Every meal cooked on the stove can burn. When the last hob step of a recipe
ends, the cook rolls once against a chance set by their cooking mastery. A
burnt meal is thrown away: the cook drops the food, the recipe returns to its
first step, and the cook walks back to the fridge and starts again. The cook
also carries a Burnt dinner moodlet for a while. Higher cooking mastery makes
burning less likely, down to one meal in five hundred at the top of the ladder.

## Rules

1. **When.** The roll happens when a hob step ends and no hob step follows it
   directly. The shipped dinner rolls at the end of Simmer and stir; Cook does
   not roll, because the food is still on the hob. The snack recipe never
   touches the hob and never burns. A terminal hob step would never roll,
   because there is nothing to restart; no shipped recipe ends on the hob.
2. **Chance.** `chance = burn_chance_novice + (burn_chance_master -
   burn_chance_novice) * mastery`, where mastery is the share of the cooking
   ladder climbed, from 0 to 1. Shipped: 0.12 with no practice, 0.002 at the
   top. A cook with no cooking skill entry counts as a novice.
3. **Draw.** One draw from the world's seeded generator per roll, in entity
   order inside the chain step system, so consumption is a function of world
   state and a replay burns on the same tick.
4. **Burnt.** The carried item is removed, the chain counter returns to step
   0 with a fresh fumble scale, the station is released as any completed step
   releases it, and the hob still counts as used for grime. The step still
   teaches the cooking skill, as a fumbled step does. The recipe's origin (a
   player-selected station) is kept, so the restart routes to the same stove.
5. **Mood.** A burn records the cook and an end tick, `now +
   burnt_meal_mood_ticks` (shipped 240, four game hours). While the end tick
   is ahead, the mood projection lists a Burnt dinner moodlet scoring
   `-burnt_meal_mood_penalty` (shipped 10). A second burn restarts the moodlet
   rather than stacking it. Expired entries are dropped at the start of each
   tick.
6. **Save.** Schema eleven appends the burnt-meal rows to the schema-ten
   envelope: one row per person, sorted by id, naming a living person. A
   schema-ten payload still loads, with no burnt meals. A schema-eleven
   payload whose rows name nobody living, repeat a person or arrive out of
   order is refused whole, and the live world is untouched. The list enters
   the world hash whenever it holds anything, so a household that never
   burnt a meal hashes as it did before.
7. **Tuning.** `burn_chance_novice`, `burn_chance_master`,
   `burnt_meal_mood_penalty` and `burnt_meal_mood_ticks` are root knobs in
   `content/tuning.toml`, appended to the compiled tuning after
   `hated_communal_chance`. The compiler refuses a chance outside 0 to 1, a
   master chance above the novice chance, a negative penalty, or a duration
   outside 1 to 10080 ticks. Packs published before the knobs existed
   reconstruct the shipped values.

## What this does not do

Burning does not change food quality, the dishes already created at the
preparation step, or any invited guest: plating, which invites friends, comes
after the roll. Starting again repeats the preparation step, so a burnt
attempt leaves another set of dishes on the counter. There is no burnt-food
smell, no stove damage and no visible smoke; those would be separate work.

## Verification

Unit tests pin the chance curve at both ends and its monotone slope, the
one-entry-per-person list with its expiry and digest, and which shipped
steps are last hob steps. Chain tests drive a three-step fixture recipe with
the chance pinned at one (every pass burns: food dropped, counter reset,
moodlet at the tuned score, a later burn restarts it, the table is never
reached, and the hob still teaches), at zero for a master cook (the meal
completes and feeds them with nothing recorded), the moodlet's end tick, and
the single seeded draw per meal (one seed gives one history, another seed
another). Save tests round-trip schema eleven with the digest unchanged, load
schema ten with no burnt meals, and refuse unknown, repeated or unsorted rows.
A wasm boundary test checks the public envelope writes schema eleven, reads
both schemas, and refuses a bad row without touching the live world.
