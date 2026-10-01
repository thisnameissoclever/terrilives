# Sim interpersonal relations

This document owns the cross-system account of how Sims help, inconvenience,
and resent one another. It separates implemented behavior from owner direction
that still needs a design or runtime change. Feature specifications own their
exact formulas and verification evidence.

## Directional affinity

Each Sim has a separate affinity toward another Sim, from -1 to 1. One Sim
liking another does not guarantee the feeling is mutual. Completed chats add
affinity; time gradually moves living relationships toward neutral. Affinity
toward dead Sims remains available for grief. Family ties are a separate
relationship classification and do not replace affinity.

## Personality, needs and emotional consequences

| Input | Behavior and interpersonal consequence | Status |
| --- | --- | --- |
| Need drain and refill multipliers | Change how often a Sim wants furniture or company, creating different opportunities for contact and waiting | Implemented |
| Action preferences and trait dispositions | Change which activities a Sim chooses; the resulting reservations can inconvenience somebody else | Implemented |
| Social need | Makes an available person more attractive as a conversation partner; busy partners remain unavailable | Implemented |
| Positive and negative affinity | Nearby liked Sims comfort the subject; disliked Sims contribute unease | Implemented |
| Grief | Loss of a liked Sim creates a stronger, longer mood effect than loss of a weak acquaintance | Implemented |
| Sustained mood | Contributes to life satisfaction alongside activity rewards, conditions and neglect | Implemented |
| Cleanliness | Changes own-cleanup willingness and the annoyance caused by somebody else's dishes | Implemented |
| Urgent energy, hunger or bladder | Can outweigh cleanup even for a very clean Sim | Implemented |

Hygiene is a current need; cleanliness is a disposition. A tired, meticulous
Sim can leave a mess because sleep is urgent. A rested slob can leave the same
mess because its removal barely appeals to them. Observers respond to the mess
and its creator, not to an omniscient account of why it was left.

## Domestic support and friction

The [meal and cleanup spec](specs/2026-09-30-meals-and-cleanup.md) defines the
new domestic interactions. A cook with a strong positive relationship can
prepare an extra plate for a hungry friend, up to three friends per meal.
Friends collect real portions and eat together, sitting at usable chairs or standing near the table; a household without a table eats near the counter. The cook's competence
affects food quality for everyone; each eater leaves their own used dish.
Committed diners gather before their shared eating countdown begins. A busy
friend's player orders keep priority, and critical needs release the waiting
group. Occupied, missing, inaccessible or dirty seats make diners stand instead of waiting indefinitely. Late arrivals never restart a meal already underway. Cooking for friends
currently provides food and company; it does not invent a gratitude bonus.

Preparation also leaves dishes on the counter. Visible dishes lower mood,
including the observer's own old mess. Someone else's dishes also cause a small
directional loss of affinity toward their creator. Cleanlier Sims are more annoyed and more
likely to remove the nuisance. Room entry or a genuinely new visible pile arms one roll at 35% of the observer's own-cleanup probability, with current needs still reducing it. Busy Sims retain that opportunity until idle. Own old dishes can also prompt cleanup without self-directed affinity penalties.
Staying in the room does not generate repeated rolls or repeated penalties
for the same pile. A later visit can produce another reaction.

An average, comfortable Sim now has about a 66% own-cleanup chance. Critical
energy, hunger or bladder still reduces willingness sharply, and a very low
cleanliness score still seldom produces cleanup. A dirty setting that forces
standing adds annoyance and a small extra directional penalty toward its creator.
After eating, a separate blocker-cleanup response has a 30% base chance for
average cleanliness, increasing or decreasing with cleanliness. Urgent needs
reduce it. This is separate from cleaning the eater's own dishes; resuming an
interrupted meal does not repeat the same complaint.

Cleaning someone else's dishes currently removes the environmental nuisance.
It does not automatically grant gratitude, a permanent friendship bonus, or
credit toward the cook's hobby. Those would be separate authored interactions.

Collection transfers visibility from furniture to a plate held by the cleaner.
Taking another activity puts the dishes back and restores the nuisance until
cleanup resumes. The claim remains exclusive while interrupted, so two Sims
cannot claim the same cleanup. Cancellation releases that claim.

## Owner direction awaiting implementation

| Interaction | Intended cause and consequence | Existing design |
| --- | --- | --- |
| Waiting for another Sim | A small directional affinity penalty toward the person occupying needed furniture, bounded per episode | Household relationships [H12] |
| Sharing a room | Slow positive or negative drift based on compatible or incompatible personalities | Household relationships [H13] |
| Spontaneous social contact | Needs-ready Sims initiate friendly conversation with strongly liked people, or conflict with strongly disliked people | Household relationships [H14] |
| Extroversion | Changes the thresholds for initiating friendly and hostile contact independently | Household relationships [H15] |
| Unmet needs during social contact and bathroom privacy | Additional owner-requested interactions are being handled in the separate needs/bathroom workstream | Separate implementation workstream; not integrated in this checkout |

General waiting mood is already implemented. Attributing that annoyance to
the occupying Sim requires holder identity and a separate bounded affinity
effect. Ordinary proximity mood is already implemented; personality-based
affinity drift through shared-room time is still planned.

## Rules for every new interpersonal effect

1. Identify the subject, source, responsible Sim, and direction of the effect.
2. Separate need changes, mood reasons, sustained satisfaction, affinity, family
   classification and activity rewards. Record how they compose.
3. Specify an episode boundary or simulation-time rate. A small penalty charged
   every tick can become a household feud before breakfast.
4. Keep player orders, urgency, capability, pathing, reservations and interruption
   semantics explicit. Friendship does not authorize preempting a player's order.
5. Use stable SimIds for responsibility, seeded simulation randomness, and
   canonical saved state for persistent decisions and cooldowns.
6. Test asymmetric feelings, threshold edges, busy or unavailable partners,
   bounded retries, cancellation, death, save/load and causal hash mutations.

Source contracts: [household and relationships](specs/2026-07-30-household-and-relationships-design.md),
[mood and waiting](specs/2026-09-30-mood-and-waiting.md),
[multi-step runtime](specs/2026-08-01-m2f-multi-step-working-design.md), and
[game systems](GAME-SYSTEMS.md).
