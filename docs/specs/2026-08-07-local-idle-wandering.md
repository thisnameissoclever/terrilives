# Local idle wandering

Status: implemented and acceptance-tested after the talk and eating action
animations. Measured and watched evidence is recorded at
[A-local-idle-wandering]. Section ids are stable and must not be renumbered.

## [LW1] The problem is distance, not walking itself

Idle wandering already prevents a contented sim from reading as frozen. Its
destination roll covered the entire lot, however. [F2] of
`docs/alpha-feel-notes.md` measured the historical 14 by 10 alpha lot at 10.9
path tiles on average and 17 at the maximum. The current shipped lot is 16 by
12, so the same whole-lot rule still permits cross-house errands, but this
slice does not pretend the historical path-length distribution is a measurement
of the larger current house.

An idle sim should look as though they shifted around the part of the house
they already occupy. This slice keeps wandering, its pause, ordinary path
following, interruption by needs, and interruption by player commands. It
changes only where an idle stroll may go.

## [LW2] Locality is a cap on the walked path

`content/tuning.toml` owns a new positive `wander_radius_tiles`. The shipped
value is 3 tiles. Every successful wander must satisfy both:

1. The destination's Manhattan distance from the starting tile is at most the
   tuned radius and is not zero.
2. The path itself contains at most the tuned radius in steps.

The second rule is load-bearing. An endpoint on the other side of a wall can
be geometrically close while requiring a tour around the room. Capping only
the endpoint would preserve the exact long commute this feature exists to
remove.

The candidate roll draws an x offset and then a y offset from the square
around the start. Candidates outside the Manhattan radius, outside the lot,
on the starting tile, blocked or unreachable, or requiring a path longer than
the radius are failed attempts. The existing `wander_attempts` remains the
hard retry bound. A sim with no legal local destination stands still for that
tick and tries again later; it never widens the search to the whole lot.

## [LW3] Determinism and save behavior stay explicit

Each attempt consumes two bounded random draws, x then y. Restless agents are
still processed in entity-index order before they share `SimRng`. The new
sampling changes the future random sequence relative to the previous release,
so the world-hash golden may move after causal review, but two equivalent runs
must remain identical.

`wander_radius_tiles` is appended to the serialized `Tuning` record and must
be in `1..=i32::MAX`. The upper bound is representational rather than a second
gameplay opinion: the inclusive `-radius..=radius` draw has `2 * radius + 1`
values, which must fit the `u32` bound consumed by `SimRng::range` on wasm32.
Tuning is deliberately outside the Save V1 structural compatibility digest,
so this balance and presentation change must not reject an existing public
save. A restored in-progress path remains exactly the path the save carried;
the local rule applies when that sim next rolls a wander.

## [LW4] Existing ownership rules do not change

Wandering continues to insert the ordinary `Path` plus `Wander` marker. It
does not gain a second movement system. Selection and player intent may still
replace that path. Reserved conversation partners, working sims, commuters,
and sims in an interaction or chain remain excluded by the existing filters.

This slice does not add room interests, turning poses, a different idle gait,
blocked-object relationship effects, action-position sockets, light pools, or
new action animations. Those are separate systems rather than excuses to let
an idle stroll cross the house.

## [LW5] Evidence required before merge

1. Unit tests must prove the endpoint and actual path caps, rejection of a
   nearby endpoint with a longer detour, bounded retry behavior, preservation
   of entity-order determinism, and unchanged interruption by urgent needs.
2. Data tests must prove the authored value reaches the compiled pack, zero is
   rejected while one is legal, the field occupies the appended serialized
   slot, and changing it does not move the Save V1 compatibility digest.
3. The shipped 12,000-tick trace must report wander count plus minimum, mean,
   95th percentile, and maximum path lengths. Its maximum must be no greater
   than the shipped radius, while the ordinary behavior tables still show
   interactive-object use and no unexplained frozen regression.
4. Browser acceptance must observe several natural local strolls at 1x and
   3x, interrupt one with a player action, and verify the rendered WebGPU game
   at desktop and 390 by 844 layouts. Reduced-motion behavior remains a
   separate browser check because simulation movement is not decorative CSS
   motion.
5. Rust, web, atlas, documentation-id, formatting, lint, mutation, production
   build, PR review, merged Pages deployment, and public revision smoke gates
   must all pass. A loaded DOM without a rendered, advancing simulation is not
   browser evidence.
