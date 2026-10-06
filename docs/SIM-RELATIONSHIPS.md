# Sim interpersonal relations

This document owns the cross-system account of how Sims help, inconvenience,
and resent one another. It separates implemented behavior from owner direction
that still needs a design or runtime change. Feature specifications own their
exact formulas and verification evidence.

## Directional affinity

Each Sim has a separate affinity toward another Sim, from -1 to 1. One Sim
liking another does not guarantee the feeling is mutual. Completed chats, pleasant
nearby time and recognized shared activities add affinity. Opposing authored
preferences create friction; time gradually moves living relationships toward neutral. Affinity
toward dead Sims remains available for grief. Family ties are a separate
relationship classification and do not replace affinity.

## Personality, needs and emotional consequences

| Input | Behavior and interpersonal consequence | Status |
| --- | --- | --- |
| Need drain and refill multipliers | Change how often a Sim wants furniture or company, creating different opportunities for contact and waiting | Implemented |
| Action preferences and trait dispositions | Change which activities a Sim chooses; the resulting reservations can inconvenience somebody else | Implemented |
| Shyness (1 to 100) | Higher values increase respect for private bathroom use and annoyance when boundaries are violated; shyness does not determine compatibility | Implemented |
| Authored interests | Shared interests help; opposing interests cause directional friction; unrelated interests and shared dislikes remain neutral | Implemented |
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

Social refill requires simultaneous participation with somebody the receiving
Sim likes. Affinity must be strictly above zero in that direction; the other
Sim need not return the feeling. Watching TV or listening to the radio counts
only while another Sim actively uses the same device.
Travelling toward it, standing nearby or using another device does not count.
Device capacity and each chair or standing destination remain exclusive to
their admitted owners.
The shared device or table defines communal participation. General room and
four-tile proximity rules affect affinity; they do not cancel otherwise valid
communal Social benefits.

Meals provide Social only while both Sims actually eat seated in separate chairs
facing the same table. They can eat food from different cooking batches.
Standing, tableless meals, preparation, gathering and empty-table sitting provide
no Social. The nominal meal benefit is 11 points over 90 eating minutes, scaled
by personality. Food quality affects the food rewards rather than the value of
the company. Rewards stop when eligible participation stops
and do not multiply with the number of other diners.

Chat Social also requires positive affinity toward the partner. Neutral chats
can still establish friendship; critical loneliness alone does not block that
completion reward or cause an inconvenience penalty. Actual Social delivery and
friendship development are separate effects. A lonely Sim can autonomously seek
a first friendship: selection estimates the chats needed to become positively
inclined, then values the subsequent chat that could actually refill Social.
Unavailable relationship rewards contribute no such future value.
Privacy routing and emergency checks use conditional benefits too: solo media
and meal preparation cannot claim to relieve critical loneliness. A media
alternative requires a valid proposed destination and active liked company
using the same device.
Waiting frustration counts Social only when the requested activity could
provide that company; an empty promise does not increase the need penalty.
Passive proximity retains its affinity effect without directly refilling Social.
Simultaneous reading, exercise and aquarium watching on different objects also
provide 0.12 Social per game minute when both Sims accept the activity, share
a room within four tiles, and the receiver likes the other participant.
Failed actions, travel and interruptions do not count.
The [needs interaction reference](NEEDS-INTERACTIONS.md) covers every reward,
cost, condition and justification.

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

## Privacy and relationship development

A conversation started while the recipient has an unhelped low or critical need
reduces the recipient's opinion of its initiator. Starting private use beside
an existing occupant annoys that occupant; entering after private use begins
annoys the user. These are separate incident directions. The room containing
the shower, bath or toilet defines the boundary, including open-plan placement.
Base penalties remain 0.11 for low needs, 0.20 for critical needs and 0.25 for
privacy, with shyness scaling the reaction.

Autonomous Sims prefer alternatives, detours or waiting. Respect decisions last
30 simulated minutes, reducing repeated random attempts. Relevant critical needs
can override after ten minutes without an alternative; levels at or below five
can override immediately. Player orders bypass avoidance, exits are permitted,
and necessary commute routes remain usable. Consequences still apply.
Domestic station claims and distinct dining seats also constrain privacy detours.

Awake housemates in the same room within four tiles can develop relationships.
Positive contact requires acceptable hygiene in the other Sim and no critical
need in the subject left unhelped by the current activity. Existing dislike or
relationship mood cannot prevent recovery. Simultaneous reading, exercise and
aquarium watching on separate objects earn ten times passive contact when both
participants enjoy the activity. Shared activities replace passive rewards and
suspend incompatibility friction. Conversations receive one completion reward.
Shared meals and TV currently do not earn this recognition bonus.

Compatibility uses personality interaction preferences, disposition traits and
hobbies, with each activity tag counted once. Recipe preferences use the recipe's
step tags rather than an ordinary-action index. Scores are directional. Capability,
conditions, skill deficiencies and shyness do not create incompatibility. Strongly
opposing preferences below -0.2 produce friction. Positive rewards scale with
compatibility. No timer automatically forgives an incident; ordinary interaction
and existing decay provide recovery. Affinity influences mood and sustained
satisfaction through their existing paths, without a second satisfaction charge.

The [relationship development spec](specs/2026-09-30-relationship-development.md)
records tuning and acceptance evidence. Historical measurements predate the
integrated meals runtime and are labeled accordingly. Significant privacy
consequences remain fixed; avoidance and contact rates are the balance controls.

## Owner direction awaiting implementation

| Interaction | Intended cause and consequence | Existing design |
| --- | --- | --- |
| Waiting for another Sim | A small directional affinity penalty toward the person occupying needed furniture, bounded per episode | Household relationships [H12] |
| Spontaneous social contact | Needs-ready Sims initiate friendly conversation with strongly liked people, or conflict with strongly disliked people | Household relationships [H14] |
| Extroversion | Changes the thresholds for initiating friendly and hostile contact independently | Household relationships [H15] |
| Hostility expression | Visible one-sided and mutual hostility, accessible reactions and possible animations, with mild directional activity avoidance that yields to urgent needs and player orders | [B-hostility-expression](FEATURES.md#b-hostility-expression-make-interpersonal-hostility-visible) |

General waiting mood is already implemented. Attributing that annoyance to
the occupying Sim requires holder identity and a separate bounded affinity
effect. Ordinary proximity mood and personality-based affinity drift are implemented.
Visible hostility and activity avoidance remain planned; that later avoidance
needs another pacing check because it will reduce contact.

## Rules for every new interpersonal effect

Household chore episodes identify an owner and the actual performer. Real
completion applies a small positive feeling toward the performer from each
other living housemate. A helper covering a consciously skipped duty also
receives a small negative feeling toward its owner. Midnight settlement applies
neglect once only when work was needed and the owner had an opportunity;
unavailable owners and no-work days are exempt. Active work retains its original
day across midnight. Settled episodes cannot receive another reaction.
Chore preferences separately generate enjoyment or dislike moodlets; those do
not directly rewrite another Sim's affinity. See the
[chores specification](specs/2026-10-04-chores-and-weekly-board.md).

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
