# Sleeping places and bed assignment

Status: implementation in progress. This document records the bounded plan for
the accepted `[S-bed-assignment]` roadmap item. Two-person sleeping and the
assignment interface are not shipped.

The reservation-release foundation is implemented with 20 new tests. All
1,241 native tests, strict Clippy, formatting, the WASM build, web typecheck,
1,494 web tests and the production build passed. Thirteen deliberate faults
failed named assertions and were restored byte-for-byte. Independent review
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
