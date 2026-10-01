# Sleeping places and bed assignment

Status: implementation in progress. This document records the bounded plan for
the accepted `[S-bed-assignment]` roadmap item. Two-person sleeping and the
assignment interface are not shipped.

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

## Saved state

Keep frozen entity, target and running-action records unchanged. Append V5
fields for active places and assignments after the published tail, coordinating
the order with other unpublished work before encoding. Include these facts and
queued assignment commands in the deterministic hash.

A historical save with an active whole-bed action receives a deterministic
place without restarting its walk, remaining duration or random outcome.
Historical absence must be distinguished from a malformed current payload;
an explicitly empty modern place list cannot erase a live sleeping lease.
Reject duplicate people, conflicting places, invalid owners, non-sleep beds,
out-of-range places and records inconsistent with live targets. Failed loads
leave the running world unchanged.

## Visual acceptance

The double bed has no existing two-place sleep projection. Its furniture
approval does not establish occupied fit. Before enabling the full feature,
provide distinct place-aware approach and pose mapping and verify all four
facings with one and two occupants. Reuse existing art only if its fit is
proved. Preserve the approved Sim body and furniture footprint.

Follow `[L-bed-body-envelope]`: inspect all body parts and animation samples
for mattress support, frame and body intersections, and walking-lane clearance,
then inspect the actual rendered game. Coordinate asset ownership with the
visual task. Do not mark two-person sleeping playable from runtime tests alone.

### Measured constraints and the next proof

The current lower-bunk body cannot simply be copied into both places. Its
full evaluated width, including sleeve cuffs, reaches 0.7918503 model units.
Two copies occupy 1.5837006 units before margins on the double bed's 1.50-unit
mattress. This is a bounding-envelope failure, not a measured mesh intersection.
The existing standalone contact probe omits the cuffs and sleeves and cannot
establish fit. Keep the approved body size and furniture footprint; prove a
narrower sleeping pose across every body part and animation sample.

The double bed also has different support heights. Its mattress is at 0.47,
duvet at 0.55, fold edge at 0.568 and pillow at 0.59. Raising the whole bunk
pose to clear the duvet would lift its existing head contacts above the pillow.
The new pose needs its own support and intersection measurements.

Existing occupied sprites use complementary visible contributions: the body
and furniture are each cut against the other, then their premultiplied colour
is added and one scene outline is overlaid. Furniture and outline visibility
depend on the pose. Drawing two existing composites would duplicate the bed;
ordinary alpha-over of their contributions does not preserve the established
reconstruction contract.

A candidate export contract separates body colour from joint visibility. Keep
body colour images per facing, place, animation sample and shirt palette, plus
an empty furniture colour image. Joint visibility and outline images depend
on both samples, with empty as an additional state. A small draw descriptor
references the images for one bed composite. This is a proposal to test, not
an accepted renderer format: another body could change surface shading, and
partial-pixel visibility may not factor cleanly at antialiased edges.

With four facings, four samples and three palettes, the conservative image
budget is 96 body images, four furniture images, 96 visibility images and 96
outlines, before deduplication. The visibility and outline counts cover the
64 double-occupied and 32 single-occupied states across all facings. There
are 676 small draw combinations including four fully empty states, which reuse
the existing complete empty-bed sprites. Measured
with the current shelf packer, the existing 1,370 sprites occupy 8192 by 4806
pixels. Adding 196 images at the current 320 by 352 double-bed canvas reaches
8192 by 7601; adding 260 exceeds the atlas height limit. Transparent-margin
cropping and reuse are therefore prerequisites for this candidate contract.
No occupied double-bed crop or mobile GPU budget has been proved.

Before changing the renderer, the visual task and runtime task must agree
ownership and attempt this bounded proof:

1. Establish disjoint local-X body lanes for every part and sample. Under the
   registered orthographic camera, the nearer lane is negative X for SE and
   NE, positive X for NW and SW. This ordering only holds after containment
   is proved and does not settle furniture visibility.
2. Choose a facing with maximum projected overlap. Independently render sample
   pairs (0, 0), (0, 3), (3, 0), (3, 3), contrasting palettes, either single
   occupant and the empty bed. Compare the candidate reconstruction against
   those joint renders. Inspect interior colour, partial coverage, outlines
   and contact regions separately; a global percentile can hide a narrow seam.
3. Swap the place-to-mask mapping, choose the wrong near-place picking priority
   and omit an outline contribution. Each deliberate fault must fail. Reverse
   compositing order only if the tested route depends on it; adding joint
   visibility contributions is commutative. Reject the factorization if it cannot
   reproduce the independent renders; do not conceal mismatches by clamping.
4. Prove the actual cropped atlas budget, then inspect fractional zoom,
   furniture colourways, both occupants' selection and one occupant leaving.
   Picking and indicators need explicit place identity and registered body
   bounds or visibility ownership. Entity order must not stand in for a place.

The source of the body envelope is the accepted lower-bunk full-scene proof at
`assets/models/bedroom/owner-review-pending/bunk/candidate-03/contributions-01/raw-proof.json`.
Atlas measurements use the existing pack function with added image dimensions;
they are capacity estimates, not generated-art or runtime acceptance.

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
