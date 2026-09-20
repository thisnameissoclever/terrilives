# Interior wall edges implementation plan

This follows the separately verified bathtub rotation. It is not implemented
by that release. The owner approved continuing without per-object reviews;
independent code and played visual reviews remain required.

## Placement and geometry

Keep the 16x12 lot and all furniture origins. Move interior architecture to
the east/south edge of its former blocked cells, reclaiming those cells as
floor. Do not move only the wall image and retain invisible blocked tiles.

Use integer edge coordinates. `V(k,y)` separates `(k-1,y)` from `(k,y)` and
draws at `x=k-0.5`. `H(x,k)` separates `(x,k-1)` from `(x,k)` and draws at
`y=k-0.5`. Each segment is one cell long. A door is an explicit passable
segment with its own visible frame, not a guessed gap in neighboring cells.

1. Kitchen/living: `V(8,y)` for y=0..5; door at y=2. The y=5 segment is
   required so the reclaimed former spine cannot bypass the divider.
2. Cross-house divider: `H(x,6)` for x=0..15; doors at x=3 and x=13.
3. Bedroom/study: `V(6,y)` for y=6..11; door at y=9.
4. Study/bathroom: `V(12,y)` for y=6..11; door at y=8.

The result has 34 segments: 29 solid and five doors. Exterior boundaries stay
at -0.5. Existing desk, bed and bathroom fixture origins then sit adjacent to
the wall plane without rewriting their saved positions.

## Navigation and compilation

1. Add symmetric boundary-crossing checks to `TileGrid`. Use them in A*,
   breadth-first distance fields and interaction adjacency. A Sim must not
   use an object or talk to a person through a solid wall.
2. Add explicit edge/door data to compiled content. Reject out-of-bounds,
   duplicate or conflicting segments and furniture spanning a solid boundary.
   Use the same crossing rule for compiler reachability and household spawns.
3. Test both crossing directions, each doorway, sealed rooms and the complete
   circulation loop. Removing either the path barrier or interaction barrier
   must fail its corresponding regression.

## Save transition

Save V1 lacks an architecture revision and separates neither wall ownership
nor object occupancy. Define a versioned saved-layout representation before
shipping the new geometry. Keep the existing V1 decoder, including its older
optional-tail handling, and recognize the exact frozen shipped source layout.
Do not treat the structural content fingerprint as a layout revision.

Preserve entity IDs, furniture positions, household state, time, random state,
queues and active counters. Repair paths affected by new boundaries, including
fractional first segments and contact across newly solid edges. Unsupported
custom historical worlds must never be silently reinterpreted or overwritten.

## Rendering and lighting

1. Expose authoritative edge/door geometry through the WASM bridge and
   refresh it after loading a save. Do not reinterpret the old `wall_tiles`
   array as a new format without updating its callers and tests.
2. Build wall joins from shared segment endpoints. The interior T-junctions
   are `(5.5,5.5)`, `(7.5,5.5)` and `(11.5,5.5)`. Assign each half-panel to
   one draw owner so full panels and joins do not overlap. Door apertures
   must remain unobstructed. Preserve existing sprite indices and pixels.
3. Make light propagation use the same solid boundaries and open doorways;
   furniture remains handled by its separate shadow model. Sample the two
   cells adjacent to each wall edge rather than indexing fractional cells.

## Acceptance and publication

Run affected tests red/green, targeted mechanism deletions, the full local
Rust/web suites, type/format/lint checks, atlas reproduction and release
builds. Inspect the actual room at normal and enlarged zoom in flat and night
lighting, then play navigation and interactions through every doorway. Obtain
independent visual and code review before publication. Preserve the approved
Sims, rigs, unrelated art and saves. Verify the deployed revision and atlas
bytes after publishing; a source push alone is not live acceptance.

## Implementation checkpoint

The boundary architecture, schema 2 compatibility transition, renderer and
lighting are implemented. The exact shipped migration needs no new path
repair: the old movement graph is a subset of the new one. New fractional
routes and loaded edge-world contact still receive explicit validation.
See `docs/assets/review-evidence/interior-wall-edges.md` for executable proof,
real-browser backup/load and doorway traversal, independent review, and the
remaining publication gate. Do not infer deployment from this plan.
