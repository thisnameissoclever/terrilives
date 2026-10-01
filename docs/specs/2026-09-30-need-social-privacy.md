# Unmet needs, conversations and bathroom privacy

Status: implemented locally; validation and release status are recorded below. Owner request and plan approval, 2026-09-30.

## Requested behavior

1. When A initiates a conversation with B before B can meet an unmet need, B loses affinity toward A.
2. When A enters the room after B has started using a toilet, shower or bathtub, B loses substantial affinity toward A.
3. When A is already in the room and B starts using a toilet, shower or bathtub, A loses substantial affinity toward B.
4. The relevant room is the room containing the furniture being used. Its name and intended purpose do not matter. A toilet in the living room carries the same privacy consequences.

Affinity means the existing directional relationship score, from -1 to +1. Each event changes only the offended person's opinion. Other ordinary relationship effects can still change either person's score.

## Approved balance and interpretation

The owner approved the thresholds and need exceptions with the implementation plan, then requested penalties about one third lower, mild avoidance and a shyness stat during implementation. A subsequent request to lower the penalties slightly more set the current 0.11/0.20/0.25 values.

1. Reuse the existing mood thresholds: a need at or below 40 is low; at or below 20 is critical. Read the authored thresholds rather than hardcoding those values.
2. A need that the selected conversation positively advertises does not cause the conversation penalty. The current Chat improves social and fun, so its eligible needs are hunger, energy, hygiene, bladder and comfort. Negative or zero advertisements do not count as helping.
3. Apply one penalty based on the worst eligible need, rather than multiplying the penalty by the number of unmet needs. Base magnitudes are 0.11 for a low need and 0.20 for a critical need.
4. Apply the penalty when a valid conversation actually starts, before it delivers need benefits. A reservation or failed approach alone does not count. The penalty survives cancellation because the conversation already happened.
5. A completed conversation has a base 0.17 affinity gain, scaled by compatibility and gated by hygiene and unhelped critical needs. At neutral compatibility, an eligible low-need conversation can recover its initial loss; a still-unhelped critical need prevents the positive reward. The start always incurs its loss. An aborted conversation receives no completion gain.
6. Bathroom base penalty: 0.25, equivalent to about 1.47 eligible completed chats at neutral compatibility and shyness, before any other effects. Use one common magnitude for both bathroom cases.
7. Each start or physical entry causes one event per offended person and responsible person. Remaining in the room causes no repeated penalties. Leaving and entering again during the same use is a new intrusion. Starting another private use is a new event.

All three magnitudes belong in `content/tuning.toml`; finite nonnegative values up to 1 are valid, and zero disables the respective affinity effect. Require the critical penalty to be at least the low penalty.

## Shyness and autonomous avoidance

Each Sim has a shyness value from 1 to 100, shown inside the selected person's personality disclosure. Higher means shyer. Initial values vary reproducibly by stable SimId using a separate generator; assigning the stat consumes no world decision draws. Old saves derive the same initial value from their saved identity. V5 saves append any deviation from that value, validate bounds and live identities, and include deviations in the world hash.

The four avoidance/response coefficients are authored in `content/tuning.toml`: `social_boundary_avoidance_cost`, `shyness_annoyance_strength`, `boundary_wander_reconsider_chance` and `shyness_wander_reconsider_strength`. Each is finite and between 0 and 1; the two wander coefficients together cannot exceed 1. Zero permits disabling each influence independently.

The offended person's shyness multiplies all three penalties by `1 + 0.005 * (shyness - 50)`. The range is 0.755 to 1.25, with 50 neutral. The responsible person's shyness affects avoidance, not the victim's response.

Autonomous scoring subtracts `0.01 + 0.0001 * (shyness - 50)` once for an inconvenient conversation, starting private use beside an occupant, or seeking an object in a room with someone already using private furniture. This modest cost remains separate from the need benefit: it changes choices without changing what the action delivers. It does not stack per occupant, prohibit an action, or alter player orders. The cost feeds the current grouped autonomy selector after its survival-risk adjustment; the resulting probability depends on the competing activities.

The deliberate avoidance policy now replaces the earlier one-off wander reconsideration for shipped content. Errands, wandering and chain routes prefer safe paths or suitable alternatives, then wait with a cached lapse decision. Movement rechecks privacy at the actual boundary and action start. Player orders, required commutes and relevant emergency needs retain access. See the [relationship development specification](2026-09-30-relationship-development.md) for the full policy, persistence and measurement contract. The old wander coefficients remain the fallback for content that disables the new policy.

## Rooms and active use

Derive regions from the current house architecture. Walls, windows and doorway boundaries separate regions, even though a doorway allows movement. An absent boundary joins neighboring tiles. Removing a separating wall can therefore merge rooms; leaving a genuine open gap can also make two areas one room.

Furniture occupancy must not split rooms. Include the furniture's occupied tiles in the architecture region; otherwise a large table or bathtub can manufacture a false wall. Use the furniture's region, not a nearby person's standing tile, as the privacy region. Existing placement rules prevent furniture from straddling a wall.

Room identity is a derived internal value, not a player-assigned room name or a new saved identifier. Iterate region seeds in tile order and use a bounded flood fill. Recompute from the current layout before autonomous selection and movement; no persistent room state is needed. Retained versions of the frozen cell-wall house use its five known doorway boundaries without changing the save. Custom legacy cell layouts have no doorway records, so their gaps remain open and can join regions. Edge-wall layouts use their explicit doorway and window records.

Classify private actions with the content tag `bathroom_privacy` on `relieve_self`, `take_shower` and `soak`. Do not infer privacy from a hygiene or bladder benefit: washing hands is not a private bathroom use. Do not check object display names or require an authored bathroom label.

Using means the action has actually begun. Reserving the toilet, walking toward it, waiting for it and standing beside it do not count. Only living, present Sims count as occupants; away-at-work, retired and missing entities do not.

## Event timing and direction

Movement already processes walkers in entity-index order. Preserve that order and record events at the exact accepted conversation start, accepted private-use start and room crossing. Capture enough context at each event to retain what happened first within one tick. A single scan after all movement cannot distinguish someone who entered before use started from someone who entered afterward.

Maintain an in-phase snapshot of positions and active private uses as movement progresses. Update it when each walker moves or starts an action, including starts whose ECS component insertions are deferred. Record directed affinity effects in event order and apply them immediately after movement, before action completion and mood-to-satisfaction accrual. New missing relationship components must accumulate all effects on the same person rather than overwrite one another through deferred insertions.

At private-use start, every other Sim already in the furniture's region loses affinity toward the user. At entry into a region with an active private user, each such user loses affinity toward the entrant. Starting use and later moving inside that same region must not accidentally charge both cases for the same encounter.

Room construction, furniture relocation, loading a save and spawning a housemate are not physical entry events. They must not retroactively charge privacy effects. A later genuine entry or new private-use start uses the current room layout.

## Needs, social, mood and satisfaction

| Cause | Direct effect | Existing downstream behavior |
| --- | --- | --- |
| Low or critical needs | Existing negative need moodlets; new recipient-to-initiator conversation penalty | Lower mood and changed social preference |
| Occupied-item waiting | Existing mood penalty scaled by the relevant need | Sustained mood changes satisfaction |
| Bathroom intrusion or starting use beside someone | New directional affinity penalty | The offended Sim can become uneasy near that person |
| Changed affinity | Existing social scoring and benefit scaling; existing proximity mood | Mood contributes to satisfaction once per tick |
| Completed conversation | Existing social/fun delivery, affinity gain and hobby satisfaction payout | These still compose with the new start penalty |

Do not add a second direct satisfaction charge for these events. Affinity feeds the existing nearby-relationship mood projection, and that mood feeds life satisfaction through [MW-satisfaction]. Needs and waiting retain their existing independent contributions. Do not add timed incident moodlets or incident history in this slice; those would require a separate duration, save and display design.

The existing Relationships component already saves and hashes the consequences. Phase-local event data must be empty at public save/hash boundaries. Resuming a saved conversation or private use must not replay its start event.

## Documentation and scope

The implementation updates the relationship design, the mood/waiting/satisfaction spec, the relevant game-system entries and the feature ledger with actual status and evidence. A parallel meal/cleanliness feature intends to introduce `docs/SIM-RELATIONSHIPS.md`; incorporate its merged documentation and add these rules there when it is available. Until then, this specification owns this feature's behavioral contract. Do not duplicate or contradict that chat's planned proximity or cleanup mechanics.

Object-user waiting affinity, fights, refusing conversations and family privacy exemptions remain separate work. Compatibility drift, shared-time/activity effects and deliberate privacy avoidance are implemented by the relationship development extension.

## Requested balance extension, 2026-09-30

Status: implemented locally under the [approved extension](2026-09-30-relationship-development.md); calibration and final verification are in progress. The following targets supersede blanket reductions of annoyance as the balancing approach.

1. Privacy violations should be rare and carry a significant, recoverable
   interpersonal consequence. Reduce how often autonomous Sims violate privacy
   while retaining a meaningful affinity loss when they do.
2. The owner's target is approximately one violation committed per normal Sim
   per simulated week, averaged over ordinary household play. Both entering
   during private use and starting private use beside an existing occupant count.
   This is a population balance target, not a quota that forces weekly incidents.
3. For average-compatibility Sims, an ordinary incident should take approximately
   two simulated days of generally living together and interacting to recover
   from, on average. Recovery means regaining the pre-incident affinity through
   ordinary play, not erasing an incident after a timer. Record additional
   incidents separately when measuring recovery.
4. Pleasant shared time should give very little affinity. Smell and incompatible
   personalities prevent that passive positive effect. Actually doing the same
   activity together should give a substantially larger gain than simply being
   nearby for the same duration. See [H13] in the
   [relationship design](2026-07-30-household-and-relationships-design.md).
5. Personality incompatibility must be able to increase hostility through
   autonomous contact without relying on frequent privacy violations. Shyness
   remains a separate influence on avoidance and the offended person's response.
6. Validate incident frequency, individual relationship effects, recovery times
   and compatibility outcomes across several deterministic seeds and household
   layouts. Count one offending action once for the actor-rate measure, even
   when several people receive separate directional affinity losses. Report the
   conditions used to define a normal Sim and an ordinary household; the target
   does not promise the same rate for a toilet placed in a busy living room.

The scope assessment must distinguish recognizing existing simultaneous activity
from adding shared furniture use. Object content declares slot counts, but the
current reservation marker does not provide concurrent object users. A complete
group-activity scheduler and shared-object reservations are additional work, not
an automatic consequence of adding affinity for activity overlap. The separate
meal/cleanliness work must be reconciled before claiming its shared meals or
odor behavior are available in this branch.

## Validation and delivery status

[Original verification evidence](../evidence/need-social-privacy/verification.md) records the original feature's checks and numerical tuning. [Relationship-development evidence](../evidence/relationship-development/verification.md) preserves its subsequent historical results. [Publication evidence](../evidence/relationship-development/publication/verification.md) records the combined sleeping-place and domestic implementation, current tuning, controlled browser cases and balance matrix.
