# Interior layout and bathtub rotation

The owner authorized autonomous continuation after PR83, including bathtub
rotation and interior furniture placement while preserving existing saves.
Work happens in the isolated `bike-chair-four-facings` checkout. No paid
requests, dependency changes, save deletion or canonical-checkout edits.

## First release: bathtub quarter-turn

Use the existing reviewed SW art at the existing origin (14,9). Change the
definition footprint from 2x1 to 1x2. Both new and loaded games must block
(14,9)/(14,10), release (15,9), and render around (14,9.5). Preserve the
interaction, its duration and effects, and all other objects. General
per-instance rotation is outside this release.

Keep the Save V1 byte schema unchanged. Recognize only the reviewed source
content shape and exact frozen static house layout: dimensions, object IDs
and positions, and the complete blocked-cell bitmap. Validate the original
snapshot against that shape, then construct the migrated candidate. Do not
globally accept an old fingerprint
as if its collision grid already matched the new world. Existing legacy-name
and pre-aquarium interaction-reference rules still apply before migration.

Preserve entity indices, names, needs, funds, time, RNG, reservations, queues,
carried items and active action counters. Only collision cells, affected paths
and agent positions made invalid by the rotation may change. An active tub
user whose old approach is no longer adjacent must move to a deterministic
legal approach without restarting the action. Nonmatching old custom worlds
fail transactionally; the migration never overwrites the input bytes. Custom
worlds already saved under the destination fingerprint keep the existing
loader path. Save V1 has no separate wall ownership, so a wall-pattern
heuristic cannot establish that releasing an old object cell is safe.
Re-saving under the new structural fingerprint makes the migration idempotent.

Prove the public byte loader accepts a source-shape V1 payload, updates the
collision cells, resaves, and continues identically after another load. Add
negative tests for invalid original references and destination collisions.
Review the actual browser view and bathing interaction before publication.

## Second release: interior wall edges and furniture

The prior interior walls blocked whole tiles while their art occupied a thin
center plane. Moving only the picture would leave an invisible blocked strip.
The correct replacement stores blocked boundaries between cells, with doorways
as passable boundary segments. Rendering, pathfinding, distance fields,
compiler reachability and object interaction approaches must agree. Adjacent
objects on the other side of a wall must not be usable through it.

This requires a separately identified layout revision and explicit migration
of authored placements, occupancy and paths. Recognize the old layout using
its full placement/grid signature, not the structural fingerprint alone.
Preserve dynamic objects and existing household state. Keep general build mode
outside this scope. This second release is not implemented or implied complete
by the bathtub change.

The implementation uses Save V2 with explicit architecture, while retaining
the V1 decoder. Its 34 boundary segments reclaim the former 28 wall cells;
29 segments are solid and five are doors. Furniture origins remain unchanged.
The old navigation graph is a subset of the new graph, so this conversion
preserves existing valid paths and contacts rather than relocating Sims.
Fractional new routes return to their source cell center before turning.
The strict source-layout gate keeps custom V1 worlds on frozen legacy
architecture. V2 reloads its own saved geometry and never repeats migration.

An immutable V1 backup precedes the first V2 overwrite. Failed loads pause
saving so an unrecognized household cannot be replaced by an automatic save.
Local and played acceptance are recorded separately from deployment in
`docs/assets/review-evidence/interior-wall-edges.md`.
