# Chores and weekly commitments

This specification covers physical household chores, targeted dish cleanup,
and weekly commitments.

## Household work

1. Indoor walkable floor tiles gain grime only when a Sim enters them. The
   chance ranges linearly from 2% for cleanliness 1 to 10% for cleanliness 0.
   Standing, spawning and loading do not create footsteps. Yard tiles remain
   outside the chore system. A successful roll adds 100 units, or ten percentage
   points of opacity, capped at 1000. Unused areas stay clean.
   Clean floor targets a room. Each stop cleans the standing tile and up to eight
   neighbors over 24 work ticks, plus travel. Eligible tiles must be walkable,
   in the same architectural room and reachable without crossing a wall edge or
   diagonal corner. The next stop uses the nearest reachable dirt, with stable
   tile-order ties. Dirty neighbors already cleaned are skipped.
2. Completed uses of counters and tables roll for grime at twice the floor
   probability. Preparation, plating, eating and ordinary table use each count
   once when completed. Cooking and washing also roll independently for counters
   sharing an unobstructed footprint edge with the stove or sink, within the same
   room. Missing neighbors produce no roll. Interrupted use and cleaning do not
   dirty the surface. Each success adds the same 100 units.
   Wipe surface removes that grime. Dish pile and surface-wide dish commands
   retain their approved scopes. Menus distinguish dish removal from wiping.
   The board groups wiping by room and type: counter surfaces or table surfaces.
   A group includes dirty members added during work and drops members sold or
   moved elsewhere. Buying the first surface creates its duty; removing the last
   retires it. Room partitions recalculate membership. Unchanged assignments keep
   their owners within the week. Removed dirt and inaccessible work do not count
   as neglect. Walls block both walking and cleaning contact.
3. Food preparation adds waste to an existing bin. Empty bin removes accumulated
   waste through a reachable, timed chore. Missing bins do not erase household
   waste; waste waits for a usable bin.
4. Chores use the existing path mover, player order queue and needs priorities.
   Claims prevent duplicate workers. Ordinary orders can interrupt a chore;
   cancellation releases it. Invalid targets and unusable routes end safely.
   Game pause advances neither dirt nor work.

## Personality and consequences

Cleanliness, responsibility, commitment history and per-chore preference are
separate values. Profiles belong to permanent SimIds. Preference ranges from
dislike to enjoyment and differs across dishes, floors, wiping and bins. Current
needs reduce autonomous willingness; explicit player instructions remain
predictable. Working on a liked or disliked chore affects mood. Actual completion
updates the performer, and observed commitments affect housemate relationships.

Defaults follow the existing personality archetypes without conflating their
need multipliers with responsibility. Profiles are saved once and editable in
the chore interface. Neutral custom Sims receive neutral defaults.

Responsibility and commitment history range from 0 to 100. History starts at
50. Preferences range from -100 to 100, in dishes/floors/surfaces/bins order.
The Correspondent defaults to responsibility 80 and [25, 55, 35, -15];
The Settled to 25 and [-60, -45, -50, -70]; The Flitting to 55 and
[10, -10, 5, 20]. Other profiles start at 50 and [0, 0, 0, 0].

Floor and surface grime have no passive aging. Grime uses a dedicated saved
random stream, independent of activity durations and weekly decisions. Events
follow stable entity/target order. Food preparation still creates 120 waste units
per meal and 50 per snack; it no longer adds unconditional surface grime.

Floor patches reduce every eligible tile's actual grime on each of 24 work ticks.
Surface wiping reduces actual grime over 45 ticks; emptying bins takes 60 ticks.
The per-tick reduction is the current amount divided by remaining ticks, rounded
up. Completion reaches zero, including new dirt within the active patch. Pausing
or suspension freezes work. Cancellation preserves the amount already removed.
Claims and completion credit refer to real work. Build edits revalidate the patch.

Grime mood effects use floor and surface averages separately within the current
room. Each effect is -(0.3 + cleanliness) times average intensity in 0..1, capped
at its fully dirty value. There is no minimum visible-grime threshold for mood;
clean floors do not suppress the surface effect. Daily chore decisions use
these same mood effects. Active work shows the fitted cleaning poses described
below.

## Weekly board

The main bottom bar opens the Chores panel with the current week, chores, assignees,
daily decisions and outcomes. Automatic weekly assignments default to enabled.
The panel pauses game time and states that explicitly. It creates one owner per chore target each week,
using chore preference, balanced workload and seeded randomness. Responsibility
changes follow-through rather than rewarding the least responsible person with
less assigned work. New or departed housemates and changed targets reconcile
assignments without duplicating completion credit.

Each assigned chore gets one saved daily decision when there is work and its
owner has an opportunity to act. Responsibility, preference, commitment history,
mood and needs influence the chance; the decision is never rerolled each tick or
on load. Busy owners retain a pending opportunity. Urgent needs keep priority.
Days with no work are not neglect and do not earn fabricated completion credit.

Credit belongs to the actual performer. The board can show a duty covered by a
different housemate. Fulfillment and missed duties produce bounded, directional
relationship reactions, at most once per observation episode. Missed duties do
not blame dead or unavailable owners. Commitment history records actual outcomes.
Late completion retains its original episode rather than becoming a second
on-time fulfillment.

The daily chance is clamp(0.04 + 0.45 responsibility + 0.18 history +
0.18 cleanliness + 0.14 preference + 0.05 mood, 0.01, 0.98), multiplied by
needs readiness. Responsibility, history and cleanliness are scaled to 0..1;
preference and mood to -1..1. Readiness reaches zero at a critical energy,
hunger or bladder need and reaches one at level 45. Autonomous thresholds are
any dishes, the dirtiest room tile at 250, surface grime 150 and bin fill 600. Explicit
orders can clean lower amounts. Assignment estimates walking-independent
workload and weights eligible Sims by 1.2 + preference, using a separately
saved random stream. It does not consume the activity-duration stream.

History uses (4 previous + outcome)/5. On-time completion counts as 100;
late completion or a helper covering a consciously skipped duty counts as 50;
avoidable missed work counts as zero. Other housemates gain 0.006 + 0.006
cleanliness affinity toward a real performer. Avoidable neglect loses 0.008 +
0.012 cleanliness affinity toward its owner; a helper covering a skipped duty
also loses 0.004 toward that owner. No Sim applies these effects to itself.
The panel retains eight days of episodes and identifies actual performers.

## Persistence and boundaries

Append targeted cleanup after the published V5 skill field, then append chores
after targeted cleanup. Keep every published command tag, including EditHousemate.
An additional optional grime field stores its random stream, active patch members
and legacy floor-task markers. Historical active floor tasks finish their saved
single tile before adopting patches. Existing grime amounts are preserved.
Preserve all published nested layouts and command tags. Store grime, profiles,
claims, queued chore scopes, task progress, assignments, daily decisions and
settled episodes. Hash every value that affects future simulation. Validate
references, numeric bounds, ordering and exclusive claims before adoption.
Older saves adopt clean surfaces and neutral history without rerolling existing
work or changing existing dish responsibility.

Use the existing renderer and assets where they support the behavior. Grime
uses localized transparent stain, scuff, dust and grease sprites. Amount controls
opacity continuously. Each tile or surface retains a stable stain pattern. A separate transparent draw tests existing depth without writing depth. Floor
marks sit behind furniture; surface marks share
the supporting furniture depth. Grime preserves material colors, floor coverings,
lighting and furniture depth. Do not depict floor
cleaning as washing a plate. Functional controls remain literal. No dependency
changes are authorized.

Cleaning has distinct rigged motions: a two-handed mop stroke for floors,
a cloth wipe at counter or table height, and a bin reach, bag lift, tie and
release with an opening lid. Each supports all four directions and household
shirt colours. Dish pickup, carrying and washing retain their existing clips.
Tools appear during active stationary work. Walking, waiting, suspension and
cancellation use their ordinary poses. Work progress selects the animation
sample, so pause and save/load preserve the pose; reduced motion holds a useful
middle pose. Hand and tool masks keep contact visible over the supporting
furniture without drawing the Sim's legs through it.

## Verification

Native tests cover dirt aging, traffic, indoor boundaries, work conservation,
claims, interruption, cancellation, target removal, save/load during each stage,
daily decision stability, week transitions, roster changes, preferences,
responsibility and relationship direction. Causal hash and fault tests remove
the corresponding mechanisms and must fail. Browser tests exercise pointer,
keyboard, touch emulation, the board and profile edits. Played captures establish
visible grime and cleanup. Full native and web gates, release boundary tests,
builds and changelog checks precede delivery.
