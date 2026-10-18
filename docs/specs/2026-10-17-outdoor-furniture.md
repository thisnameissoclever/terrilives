# Outdoor furniture: a pool, a pool lounger and a patio umbrella

This is the contract for issue 250, the first outdoor objects of [S-outside] in `docs/GAME-SYSTEMS.md`; swimming, lying back and shade are later slices. The art review is in `docs/assets/review-evidence/outdoor/2026-10-17/`, and the played evidence is in `docs/evidence/2026-10-17-outdoor-furniture/`.

## Contents

- [OF-objects] Three objects sold for the yard
- [OF-store] How the store lists them
- [OF-art] Where their art comes from
- [OF-rulings] Decisions taken without the owner
- [OF-evidence] Proof required before delivery

## [OF-objects] Three objects sold for the yard

1. **Pool**, model Backyard Square, $1,200: a square above-ground pool with a stone coping, wooden sides, blue water and a pair of chrome rails, on a 2 by 2 footprint. It has no action. Like every placed object it blocks the tiles it stands on, so nobody walks across it.
2. **Pool lounger**, model Sunstrip, $120: a wooden sun lounger with a teal cushion and a raised back, on a 1 by 2 footprint authored like the bathtub (long axis along the footprint's depth, base facing south-west). It has one action, Sit, from the shared `lounge` template (Comfort 20, 40 ticks, one sitter). Its one seat is authored at (0, 0.5) from the footprint's center, which is the center of the second tile, at the foot end away from the backrest. The seat faces south-east, toward the long side that its two approach tiles stand beside, so a housemate sits on that edge of the cushion with the shared chair-sitting pose; the cushion top stands 0.42 units high to match that pose.
3. **Patio umbrella**, model Shady Eight, $90: an eight-panel cream and coral canopy on a slim pole and a weighted base, on a 1 by 1 footprint. It has no action and casts no shade; the canopy overhangs the neighboring tiles.

All three are ordinary objects: they can be bought, placed, turned, moved and sold like any other, inside the house or out, because rooms classify the store and never limit placement. None of them is placed on the shipped lot; the store sells them.

## [OF-store] How the store lists them

The three types belong to a new Outdoor category and to a new room, `yard`, so the Buy tool's Room row gains a Yard button that shows exactly these three cards. The Show row lists the lounger under Comfort; the pool and the umbrella serve no need, so they show only under Everything. The yard has no room region, so liking or disliking an object there has no mood effect, as for anything else placed outdoors.

## [OF-art] Where their art comes from

Each object is a procedural Blender model in `assets/models/outdoor/` (layout numbers in `*_layout.py` with unit tests, geometry in `*_model.py`), rendered to four facings by the wide static exporter on the registered 160 by 176 logical canvas at density 8. The accepted candidates are pool `candidate-04`, lounger `candidate-01` and umbrella `candidate-02`; earlier candidates keep their renders and proofs as rejection evidence, with their authoring files ignored. `assets/models/static-props-07.json` binds the accepted proofs with an independent review status, `assets/sprites/gen/build.py` appends the twelve sprites after the conversation icons so no earlier sprite index moves, and `assets/models/architecture/architecture.json` pins that catalog as a historical extension.

## [OF-rulings] Decisions taken without the owner

The issue leaves the interactions undefined. These choices are the smallest coherent ones and are recorded for the owner to confirm or change:

1. The pool is decorative. Swimming needs a new activity, pose, animation and a way into water the movement grid treats as blocked, which is a feature of its own.
2. The lounger offers Sit only. The shared Lie down action plays the sofa's fitted recline, which would not match a lounger.
3. The umbrella is decorative and casts no shade; there is no sun or shade mechanic.
4. The pool is 2 by 2 rather than larger, because a 3 by 2 footprint does not fit the registered exporter canvas.
5. The model names and descriptions are proposed for the owner's review beside a running build, as [L58] requires. The descriptions cover the objects themselves and leave out what they cannot do yet, because the project writing skill keeps temporary limits out of store copy; this specification and the changelog record those limits. The umbrella's remark that it casts no actual shade is kept as a joke on its model name, Shady Eight, for the owner to keep or cut.

## [OF-evidence] Proof required before delivery

1. Layout unit tests for the three models pass, every render stays at least one logical pixel inside its canvas, and an independent visual review accepts each object before it enters the atlas.
2. The atlas regenerates with the twelve new sprites after every earlier sprite, and `build.py --check` passes.
3. Content compiles; the data tests name the three new objects, their footprints and the lounger's Sit, pin the lounger's seat and approach tiles in all four facings, and check that every declared object is either placed on the shipped lot or sold.
4. The store lists thirty-three items, with Yard in the Room row showing the three new cards.
5. A played check on the production bundle buys and places each object in the yard, turns the lounger, and has a housemate sit on it, with frames reviewed by a fresh reviewer.
