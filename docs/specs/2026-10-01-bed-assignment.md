# Sleeping places and bed assignment

Status: implementation in progress. This document records the bounded plan for
the accepted `[S-bed-assignment]` roadmap item. Two-person sleeping and the
assignment interface are not shipped.

The local implementation now includes shared admission, assignment commands,
V1 through V5 save migration and validation, hashing, lifecycle cleanup and the
assignment control inside the existing Sim details disclosure. Its label is
now Personality, habits and bed. Keyboard focus, same-Sim Load and responsive
control checks have passed, as have the native and web suites. This remains
unpublished: per-place navigation is implemented locally; the occupied double-bed
composite is still required before shared sleeping can ship. See
`docs/assets/review-evidence/bed-assignment/runtime-ui.md` for this checkpoint.

The reservation-release foundation is implemented with 20 new tests. All
1,241 native tests, strict Clippy, formatting and the WASM build passed before
integrating door audio, which changed no simulation sources. Web typecheck,
1,535 web tests and the production build passed after integration.
Thirteen deliberate faults failed named assertions and were restored
byte-for-byte. Independent review
found no blockers in this foundation. See
`docs/assets/review-evidence/bed-assignment/reservation-release.md` for fault
evidence. Admission, persistence and visuals require separate implementation
and review.

## Player behavior

1. A double bed has two sleeping places. The supported lower bunk has one.
   Travelling to a place reserves it just as sleeping in it does.
2. Each living Sim can have one assigned place. Each place can have one
   assignee. Assigning an already assigned place refuses the change rather
   than silently taking it from somebody else.
3. A tired Sim prefers their available, reachable place. Other Sims prefer
   unassigned places when available. An occupied or unreachable assignment
   does not stop a Sim from sleeping elsewhere. Player orders take priority
   over these preferences.
4. Assignment is separate from current use. Changing an assignment does not
   interrupt an action. Moving a free bed preserves its assignments; selling
   it clears them. Death clears that person's assignment.
5. Assignment lives in the existing selected-Sim details sheet. The control
   identifies the bed, place, assignee and current occupant, with an explicit
   clear option. The closed dock gains no additional permanent controls.

## Runtime boundary

The existing `Reserved` marker claims an entire object. Authored `slots` and
the household bed-shortage count do not currently create separate runtime
places. First establish owner-aware release, then introduce place admission.
Do not enable two sleepers merely by ignoring the marker.

An active sleep place belongs to the Sim's current `Target`, including the
walk to it. Alternative sleep interactions on one bed share physical places.
Use one capacity definition throughout admission, assignment, shortage counting
and save validation: the maximum `slots` across the object's sleep-tagged
interactions, or zero when there are none. This preserves the existing
household shortage calculation. Validate the selected interaction's sleep tag;
validate the place against the bed's shared capacity. Renderer profiles do not
define capacity.
A place is occupied by at most one Sim; one Sim occupies at most one place.
Within-tick claims count immediately despite deferred ECS commands. Leaving,
cancellation, preemption, invalid-target cleanup and death release only the
departing Sim's commitment. Cleanup for an old conversation must not remove a
new sleeping commitment acquired earlier in that tick.

Keep ordinary furniture, cooking stations and conversations exclusive. Keep
one autonomous candidate per object and interaction so adding a second place
does not duplicate that bed's selection weight. Determine place availability
before waiting or scoring. Preserve normal reachability, needs and survival
calculations before applying assignment preference.

The existing occupied-object move and sale guards must cover every active
place. Permanent assignment alone does not count as current use.

### Place-specific navigation decision

The local implementation authors each place's perimeter approach tiles in the
object definition, independently of presentation sockets. Use integer offsets
from the definition's base-facing footprint and rotate with the object's
relative facing. Multi-place beds require an ordered record per physical
place; single-place beds without records retain whole-perimeter access.
Validate unique stable place IDs, nonempty cardinal perimeter approaches and
the shared capacity. Include the ordered IDs and access layout in the content
fingerprint, with the existing explicit historical compatibility route.

The visual task checked the existing model's axis mapping: in the default SE
facing, world X runs from head to foot. Ordinal zero uses approach tiles
`(0, -1)` and `(1, -1)`, corresponding to the model-local positive-X lane;
ordinal one uses `(0, 2)` and `(1, 2)`, corresponding to model-local negative X.
Rotate those offsets with the placed footprint. The initial proposal used
the wrong world axis and was corrected before navigation implementation.
This establishes side correspondence only; occupied pose fit and compositing
remain unproved.

The new-game double bed moves from `(0, 6)` to `(0, 8)`, retaining its SE facing
and 2x2 footprint. At the former origin, place zero's approach crossed a solid
bedroom wall. The new position exposes row seven to place zero and `(1, 10)`
to place one, beside the one-tile dresser. Furniture, walls and household
spawns otherwise stay as authored. Existing saves retain their own positions;
the content fingerprint does not include these prefab placement coordinates.
See `docs/assets/review-evidence/bed-assignment/starting-layout.md`.

Four-day release-WASM runs at three seeds also verify autonomous assigned-place
use, shared sleeping across the seed set, and exact replay after rewinding a
second world. The old-layout counterfactual fails assigned-place use as intended.
See `docs/assets/review-evidence/bed-assignment/autonomy.md` for results and limits.

Resolve reachable free place options before scoring. Compute each option's
normal utility and survival risk using its actual distance. Collapse them to
one object/interaction candidate, prioritizing lower survival risk, then
assignment preference, utility and stable ordinal. A distant assigned side
must not hide a safer reachable side of the same bed. Reconstruct only the
winning route. The existing pathfinder, fractional-position anchoring and
contact-edge checks remain authoritative.

Apply this access policy when issuing new or replacement paths. Preserve
physically valid saved paths and running actions exactly, including historical
ordinal-zero commitments whose approach predates the new side mapping. Do not
silently repath a save or add an ordinal-side rejection to the loader. This
also applies after a historical walk is re-saved as modern V5; its second
load must remain valid. Physical reachability and ownership still validate.

The authored access extension hashes ordered place IDs and canonical approach
sets. Its integrated digest `cf787472e9e838f5` maps back to the released
domestic digest `85a2d1400dff9da1`. The reconstructed pre-meal shape
`b38e71a123bb8273` maps back to `c2cf291984ed61f7`; the reconstructed pre-rotation shape `9ac7e41e24d4c921`
maps back to `d396b3f39e3c6685`. Both then use the existing migration
classification. No arbitrary pack may obtain compatibility by stripping access
metadata, and old bathtub geometry still requires its physical migration.

## Saved state

Keep frozen entity, target and running-action records unchanged. Append one
V5 field, `sleeping_places: Option<SavedSleepingPlaces>`, after
`domestic`, preserving the released domestic wire order. Its record contains `active_places: Vec<(u32, u8)>`
(agent entity index, place ordinal), then `assignments: Vec<(u32, u32, u8)>`
(SimId, bed entity index, place ordinal). An active row gets its bed from the
agent's `Target`. New writers must emit `Some`, including empty lists.
These are implementation decisions, not fields shipped by this documentation
change. Released meal, dish and cleanup state must survive unchanged.

Grouping the lists leaves one historical absence boundary and no accepted
boundary between them. Its `Some` encoding matches the alternative of an
optional active-place list followed by an assignment list. Follow the existing
V5 decoder's unexpected-end-only padding, full consumption and canonical
reserialization checks. With this field appended after domestic state,
the maximum zero padding becomes ten:

| Padding added | Required result |
| --- | --- |
| None | The grouped field is `Some`; an explicitly encoded `None` rejects |
| One byte | The grouped field is `None`; physically complete domestic state survives |
| Two bytes | The grouped field and domestic are absent; domestic must be `None` |
| Three through ten bytes | The grouped field is `None`; apply the existing invented-data checks to the preceding fields using one fewer padding byte |

While this record is the final field, any padded decode that produces `Some`
rejects. This covers an incomplete grouped record even when padding could
finish its lists. After later fields are appended, padding confined to those
fields permits the physically present `Some`; padding that reaches or completes
the sleeping-place record must not manufacture `Some`. An empty modern
active-place list is valid only when no sleep target needs a place; it never
requests legacy migration. Later appended fields must preserve this presence
boundary. A byte stream ending exactly at an authentic historical boundary
cannot be distinguished from an authentic historical save.

A historical save with an active whole-bed action receives a deterministic
place without restarting its walk, remaining duration or random outcome.
Historical absence must be distinguished from a malformed current payload;
an explicitly empty modern place list cannot erase a live sleeping lease.
Use explicit migration routes for V1 through V4 and for a V5 record whose
grouped field was historically absent. Give each valid historical whole-bed
commitment ordinal zero; reject conflicting claimants rather than moving them
to another place. Keep paths, remaining action durations, fumble outcomes,
random-generator state, tick and queued commands intact. At the native typed
load interface, `None` explicitly means legacy state; the byte decoder proves
whether the field was physically absent. Do not infer missing places for every
world adopted by the simulation. Restore all V5 state before refreshing its
rendered projections.

Validate sorted, unique active rows against exactly every living agent's sleep
target, including agents travelling to the bed. Reject conflicting bed/place
claims, invalid owners, non-sleep interactions, out-of-range places and rows
inconsistent with running actions. Assignment rows require unique living
SimIds and unique valid bed/place pairs. An assignee may differ from the current
occupant. Failed loads leave the running world unchanged.

Append `SetBedAssignment { agent: u32, place: Option<(u32, u8)> }` as command
19 in both command enums, preserving codes 0 through 18. `None` clears the
assignment. Validate wire shape, trailing bytes and queue bounds at enqueue;
resolve the agent to SimId and validate the bed, capacity and conflicts when
the command drains in order. Preserve stale pending commands in modern saves
so they replay as refusals, as existing placement commands do. Historical
loads with absent sleeping-place state must reject command 19: no historical
writer could have emitted it.

Hash sorted active `(agent, bed, ordinal)` rows and assignments
`(SimId, bed, ordinal)` with separate tags and lengths. Bed identity must be
explicit because the existing hash does not include `Target`. Hash assignment
commands in queue order, distinguishing set from clear. Pin exact command byte
vectors and test changes to only the bed, ordinal or assignee. Derive historical
fixture boundaries from serialized field lengths; test every interior
grouped-record truncation, all legacy migration routes, exact continuation,
atomic failure and stale-command refusal.

## Visual acceptance

The owner approved the covered static double-bed pose and requested publication.
The bed-only Sim scale is 0.88; standing and walking bodies remain unchanged.
The occupied model uses one continuous duvet and covered feet. The art owner
completed all 64 facing, occupancy and active-shirt combinations. The committed
production manifest and receipt are retained in
`docs/assets/review-evidence/bed-assignment/covered-double-bed.md`.

The accepted encoding is `scene-linear-premultiplied-visible-additive`.
Each registered scene references furniture, shared ink, and one visible body
contribution plus separate raw visible fill coverage for each active place.
Identical decoded pixels alone may be deduplicated. All layers share the
232 by 218 crop at density 2 and logical anchor
`[58.000009536743164, 93.00043869018555]`; registration is already applied.
The static sample is zero. Independent breathing is outside this release.

Sample these linear premultiplied bytes without automatic sRGB decoding.
Furniture recolour operates after sampling: unpremultiply furniture, convert
linear RGB to sRGB, apply the existing recolour, return to linear and
premultiply by its effective alpha. Sum furniture, active bodies and ink;
source-resolution ink attenuation is already present in the fills. Do not
apply ink-over again. Unpremultiply by actual summed alpha, clamp output alpha
separately and apply the sRGB transfer once, followed by scene ambient/tint.
Keep the established non-bed pair path unchanged.

CPU picking uses the separate raw visible owner-fill masks. Reconstruction
weights, lane rectangles and shared outlines do not define Sim ownership.
Furniture-only pixels select the bed; outline-only pixels do not select a Sim.
Actual fractional-zoom GPU colourways, distinct owner picking, a sleeper leaving,
played sleeping and publication require runtime proof. The approved export and
its CPU comparisons do not establish those runtime gates.

### Runtime identity before visual integration

The local render buffer now carries aligned `sleeping_beds` and
`sleeping_places` columns. Each row contains the exact bed entity index and
physical place for a running sleep-tagged action, or two `u32::MAX` sentinels.
Both pointers and bridge getters refresh after sync, Load and memory growth.
This is derived state, with no new save field or command.

The projection validates the full target entity, object definition, interaction,
sleep tag and shared physical capacity. It excludes walkers, active chain work,
commuters, workers and both conversation participants. Resumable background
chain progress and an action awaiting its zero-tick completion remain valid.
Assignments alone do not project occupancy. Tags and visual metadata are
independent, so this pair does not override the existing activity or body art.

The double bed currently has no authored body-art socket. Keeping this pair
separate from socket-only `interaction_targets` preserves existing positions,
facings and visual-action codes while occupied-art verification continues.
See `docs/assets/review-evidence/bed-assignment/projection.md` for native,
release-bridge, mutation and replay evidence.

### Renderer integration after the visual proof

A read-only impact review identified the following seams. These preserve
runtime identity and do not approve an unproved image format.

1. Use the validated bed/place pair alongside the accepted body-art contract.
   Travelling leases remain walking; permanent assignment alone must never
   create a sleeping visual. Keep action 9, activity 5 and facing codes stable.
2. `InteractionSelection.update` currently picks one owner per target by raw
   entity ID. Add a bed-specific group beside that path, keyed by exact target
   and physical place. Preserve both logical Sim rows, stable shirt identities
   while drawing shared furniture once. The approved static sample is zero.
   Keep duplicate-owner rejection for ordinary single-user furniture.
3. `buildInstances` returns the reusable instance array and exact packed count
   together. Preserve that boundary; do not revive a second count traversal. The proven asset contract must define any
   changes to sprite pairs, the instance layout and shader together; ordinary
   alpha-over of two existing paired sprites is not an acceptable substitute.
4. `pickSprite` needs occupant-specific visible coverage and ordering rather
   than identical whole-bed bounds or row order. The bed remains clickable
   outside the occupied body coverage. Give each person's bubble and selection
   ring a distinct anchor, separate from shared-composite registration. Joint
   owner coverage requires registered CPU picking data, a declared deterministic
   rule for partial pixels, and an explicit outline-picking policy. No lane
   shortcut may replace that evidence when bodies cross the assumed intervals.

A three-owner contribution route must combine both bodies and furniture in
premultiplied colour, then apply the shared outline once. The current shader
supports only one body with its furniture and outline. Neither three-owner
composition nor CPU owner-map picking is implemented yet. Their atlas, memory
and rendering costs belong in the bounded pilot before runtime integration.

Regression coverage must include empty, either single occupant and both;
independent palettes/samples; all facings; furniture colourways; both selections;
one departure; paused commands; immediate post-Load projection; sparse or
reordered rows; memory growth; reduced motion; and unchanged non-bed visuals.

## Verification

1. Prove two simultaneous claims choose distinct places and a third waits.
   Exercise both player orders and autonomous decisions, including alternate
   sleep interactions and same-tick claims.
2. Exercise independent and simultaneous completion, cancellation, changed
   orders, work departure, death and invalid-owner cleanup. One departure must
   preserve the other's action and occupied marker; the last must free it.
3. Check assignment preference, occupied and unreachable fallback, explicit
   orders, conflicts, moving, sale and death. No assignment may fabricate a
   reachable route or hide a survival-critical alternative.
4. Round-trip walking and sleeping occupants with exact places, durations,
   command order and subsequent simulation. Test authentic historical prefixes
   and malformed modern payloads through the release-mode load boundary.
5. Delete load-bearing mechanisms and require named assertion failures,
   restoring original bytes after every fault. Run the applicable full local
   gates and independent adversarial review before publication.
6. Verify desktop, phone and short-screen controls in the displayed game,
   including keyboard use and selection/load transitions. Close owned pages
   and stop owned preview servers afterwards.
