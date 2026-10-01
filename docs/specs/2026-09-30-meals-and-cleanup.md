# Meals, dishes and cleanup

Status: implemented; [delivery PR #193](https://github.com/thisnameissoclever/terrilives/pull/193).
Corrected art and final integration passed independent adversarial reviews.
Evidence: [local checks and screenshots](../assets/review-evidence/domestic/README.md).
Companion: [Sim interpersonal relations](../SIM-RELATIONSHIPS.md).

## [MC-actions] Food is station work

| Action | Stages | Station work, before walking |
| --- | --- | --- |
| Meal | Get ingredients, prepare food, cook, simmer and stir, plate meal, eat | 30 + 90 + 150 + 100 + 40 + 90 = 500 ticks |
| Snack | Get snack, prepare snack, eat snack | 20 + 30 + 35 = 85 ticks |
| Cleanup | Collect each pile, carry it to the kitchen sink, wash | 25 ticks per surface, then 25 + 8 ticks per dish unit |

At the current 10 ticks per real second, the authored durations total 50
seconds for a meal and 8.5 seconds for a snack. The existing duration variance
changes actual step lengths. Every tick also advances one game minute.
Walking, occupied stations and gathering for a shared meal add time.
Snacks remain the faster hunger remedy.
The meal grants hunger and comfort only after eating; intermediate work does
not feed a Sim. Cooking competence can reduce the whole meal's food benefit,
including friends' portions. Cooking practice occurs at the cooking step.
The cook's cooking hobby and condition still compose with activity satisfaction.

The fridge retains its existing snack command index. Its meal label reads
Cook breakfast before 11:00, Cook lunch from 11:00 through 16:59, and Cook dinner
from 17:00 onward. The underlying meal identity remains `cook_dinner` for saves.
Functional labels stay literal; this does not authorize an unrelated voice pass.

## [MC-dishes] Messes have a location and a creator

Meal preparation leaves three dish units on the preparation counter. Eating
leaves one on the dining surface per eater. Snack preparation and eating each
leave one on a counter. Furniture carries the pile's location; the creator's
permanent SimId carries responsibility, including after that Sim dies.

Cleanup claims particular pile identities before walking. Another Sim cannot
claim the same dishes. Collected dishes stop appearing on the furniture but
remain saved until washing finishes. A different activity returns collected
dishes to their original surfaces and frees the Sim's hands. The interrupted
chore retains its claim and resumes at collection. Abandoning it also releases
the claim.
Player-directed cleanup is available at the kitchen sink.

The render buffer derives `carried_dishes` from these saved collection claims.
Carry and wash clips contain a modeled plate with actual hand occlusion.
Surface props use the supporting furniture's exported camera and authored
top dimensions: one used plate for a diner, a bowl and spoon for cooking,
and separate food plates for waiting portions. Counter clutter and food have
separate slots. Tables show up to four occupied places, with paired plates
for accumulated mess. Surface props inherit local lighting and the owner's
projected depth field. The all-facing GPU fixture lives in
`web/review/domestic.html`.

## [MC-willingness] Cleanliness competes with needs

Cleanliness is a personality value from zero to one. Archetypes currently
provide 0.90, 0.08 and 0.55 for the correspondent, settled and flitting profiles.
It is separate from hygiene: wanting a shower does not imply washing a plate.

The base probability of cleaning one's own dishes is `0.01 + 0.89 * C²`, where
`C` is cleanliness. This spans 1% to 90% when needs are comfortable. A very low
score rarely initiates cleanup. The minimum of energy, hunger and bladder
determines readiness. At or below the critical-need level, the probability is
multiplied by 0.005, so even the cleanest Sim skips cleanup more than 99.5% of
the time. Readiness rises to full at 55. Other needs can reduce willingness
further. An autonomous chore yields before its next station when one of those
three urgent needs becomes critical. A player-directed chore respects the
player's order.

The cook or eater gets one own-mess roll after finishing their food. There is
no repeated per-tick roll on that same decision. Skipping leaves real dishes
for later visitors rather than an invisible chore debt.

## [MC-annoyance] Room entry is an episode

Room membership comes from saved wall boundaries. Doorways separate rooms
even though Sims can walk through them. Occupied furniture does not cut a room
in two. A Sim in a room containing another Sim's visible dishes gets a Dirty
dishes moodlet. More cleanliness increases its strength. Current needs, mood,
relationship environment and conditions continue to contribute independently.
The existing sustained-mood rule integrates the resulting mood into life
satisfaction; the dish system does not add a second direct satisfaction cost.

On each visit, a new pile causes a small directional affinity penalty toward
its creator. A room visit remembers the piles already noticed. Remaining in
the room does not repeatedly charge the penalty. A new pile can be noticed
during the visit; leaving and returning starts another visit. Own dishes do
not cause resentment toward oneself.

On entry with annoying dishes, an idle Sim gets one cleanup roll at 20% of
their needs-adjusted own-cleanup probability. Claims still prevent duplicate
chores. A busy Sim's entry does not become a per-tick retry after they finish.

## [MC-sharing] One cooked meal feeds at most four

At plating, the cook chooses up to three other living Sims whose directional
affinity from the cook is at least 0.60 and whose hunger is at or below 40.
Critical energy excludes a guest. Stable SimId order breaks ties. The cook
does not create extra portions for strangers merely because they are hungry.

Each invited friend has one claimable plate, keeps it visible until collection at the actual plating
counter, and eats at the cook's selected table. A friend already doing
something finishes or follows the player's queued orders before collecting
their plate. A portion is claimed once and feeds its claimant once. Meal
tables admit up to four eating Sims; unrelated interactions keep their normal
reservations. Each eater remains responsible for their own used dish.

Idle friends may claim a portion as soon as plating finishes, before a table
has been assigned. Collection uses the known counter. The first diner who
can select a table assigns it to the meal, and all other diners, including
the cook, use that same table. A busy table delays eating without discarding
the carried food. Cancelling the cook's activity does not strand the guests.
The cook's current batch is identified by SimId and plating tick. An older
unclaimed portion cannot bind a later meal to its table. Completion or
cancellation clears the cook's association while preserving guests' portions.

Present diners retain their full eating interval while committed guests come
to the table. The group starts its countdown together once those participants
have arrived. Unclaimed busy guests, ordinary player interruptions, queued
orders and Sims away at work do not hold the group. Critical hunger, energy
or bladder in a present diner releases gathering immediately. If other diners
occupy seats needed by the group, or furniture and walls leave too few
accessible places, the present diners also proceed, freeing
capacity as they finish. Once started, a meal never waits again for late guests.
This is saved meal state, so loading cannot restart the gathering decision.

## [MC-save] Persistent consequences survive loading

The V5 envelope appends an optional domestic-state field. Earlier payloads
default it to absent without changing their existing records. It records
cleanliness values, attributed piles, room-visit memory, cleanup claims, and
shared-plate claims, the cook's current batch identity and whether the shared
eating interval has started. Every
future-affecting value enters the world hash.
Load validation checks identity, finite ranges, ordering, references and
exclusive claims before replacing the running world.
Meal identities must be unique, and a serving cook's active dining target
must match its batch's table. Ordinary interruptions may target other objects.

Extending the old four-stage meal requires a reviewed structural content
bridge and explicit old-step mapping. A bridge is not permission to accept
arbitrary changed content. Prior save bytes, intermediate saves, interruption,
cancellation, table sharing, room-entry behavior, and causal hash mutations
are required verification cases.
