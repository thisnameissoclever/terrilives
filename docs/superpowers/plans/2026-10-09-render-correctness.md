# Render Correctness Plan: per-pixel depth, one position owner, and an automatic gate

> **For agentic workers:** Use `superpowers:subagent-driven-development` or
> `superpowers:executing-plans` task by task. Each task is its own pull
> request with the full local gate list and an independent adversarial
> review.

**Goal:** Stop the recurring class of defects where a Sim or object is cut
off by, or drawn through, walls, doors and furniture, and where the
selection marker or activity bubble is not on the Sim. The owner does not
want to catch these one by one; the renderer must be correct by
construction, and a gate must fail the build when it is not.

**Why it keeps happening (observed 2026-10-08 on the fridge reach):** most
sprites decide what covers them from one depth per instance (their tile)
or from a rectangular footprint shortcut, which `web/src/render/sprites.wgsl`
itself describes as "a 2.5D footprint proxy, not an inferred per-pixel 3D
model". Any sprite that reaches outside its tile (a Sim leaning into a
fridge, an open door, a body on a two-tile sofa) then sorts wrongly
against walls and neighbours, and each new animation has received its own
depth patch: dining foreground and background masks, the bunk foreground
layer, the reach projection. Separately, a Sim drawn in a fixture scene has
taken its position from the fixture's row, so the marker and bubble landed
on the fixture.

**What already exists:** per-pixel depth. A companion depth sprite encodes
each pixel's game-space X+Y losslessly in red and green, and the shader's
`SURFACE_DEPTH_PROJECTION` branch compares it per pixel. Doors use it
(`web/src/render/portals.ts`), walls have exact architecture depth, and the
fridge reach scenes use it since PR 235 (`assets/models/kitchen/actions/`
exporter and `docs/assets/review-evidence/kitchen/fridge-reach-2026-10-08.md`).

## Task 1: per-pixel depth for every pre-rendered sprite

1. Add a depth pass to every offline exporter (furniture, Sim body clips,
   occupied toilet, bath, seating, bunk and dining scenes), encoded exactly
   like the door and fridge depth sprites, and import it with each sprite.
2. Draw every pre-rendered sprite through the per-pixel depth branch.
   Remove the per-feature depth modes one at a time (footprint projection,
   reach projection, dining foreground and background, bunk foreground
   layer), each removal proven by the gate in Task 3 on the shipped house.
3. Keep published sprites byte-preserved: the depth sprites are appended
   records; check with `docs/assets/review-evidence/bathroom/verify-sprite-preservation.py origin/main`.

## Task 2: one position owner per Sim

The selection marker, activity bubble, click target and Sim draw order come
from the Sim's own displayed position (the drawn feet), never from a
fixture's row. A fixture scene carries its art offset from the fixture
separately. Search `web/src/frame.ts` and `web/src/input.ts` for
`targetRows` and `positionRow` consumers. Picking still ranks a fetching
Sim at the fridge's depth (known limit from PR 235).

## Task 3: an automatic gate on the shipped house

1. Authoring: every pose solver checks clearance of the complete body
   against the shipped room context (walls, floor, neighbouring furniture
   at the shipped placement), not only the fixture.
2. Game frames: a test renders actual frames of the shipped house through
   the real renderer for every animated action and sample and fails if any
   sprite loses pixels to something that is not nearer, if the marker is
   not under the drawn feet, if the bubble is not whole above the drawn
   head, or if a fixture's empty position moves.
3. Run it in CI. Played checks remain, enlarged at least four times
   against an empty-fixture frame from the same camera.

## Known constraints

- Check the size of `web/src/render/atlas.ts` with
  `wc -c web/src/render/atlas.ts`; if it is within about 5 MiB of 104,857,600
  bytes (GitHub's per-file limit), shrink it before adding art. Observed
  2026-10-09: 100,038,988 bytes. The generator writes one number per line;
  a compact encoding or a further split (as PR 235 did for the click
  masks) is needed.
- The fetch route assumes the fridge door faces the station's (1, 0) side;
  a second fridge model needs a content property like the stove's
  `cooking_front`.

## Remaining animation scope from the 2026-10-06 handoff

Owner decisions of 2026-10-07: the long sofa's Lie down needs a fitted
lying pose (never an upright seated substitute); the shower uses thin
translucent falling water in front of the body with the bath's skin
appearance and no steam (render code 20 is reserved for it). Both should
start after Tasks 1 and 3 so they ship with per-pixel depth and pass the
gate. Recovery material for the earlier shower attempts is at commit
ba38c907 under `docs/handoffs/animation-resume/`.
