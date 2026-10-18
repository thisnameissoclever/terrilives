# Outdoor furniture art review, 2026-10-17

The art for issue 250's pool, pool lounger and patio umbrella, as accepted into the sprite atlas. The models are in `assets/models/outdoor/`; the renders are the four-facing sets in `assets/models/outdoor/owner-review-pending/`, bound by `assets/models/static-props-07.json`.

## Candidates

| Object | Accepted | Rejected and why |
| --- | --- | --- |
| Pool | `pool/candidate-04` | `candidate-01`: plain water with no surface detail. `candidate-02`: ripple highlights as separate meshes drew dark outlines around each one. `candidate-03`: ripples painted into one water grid lost the outlines but showed stair steps at full size. |
| Pool lounger | `lounger/candidate-01` | None. |
| Patio umbrella | `umbrella/candidate-02` | `candidate-01`: the collar on the base matched the base color and read as an open U shape. |

Every accepted render is a complete Blender 4.5.14 LTS batch, and its visible pixels stay well inside the canvas: at least 104 source pixels from any edge for the pool, 220 for the lounger and 270 for the umbrella, against the importer's minimum of 8. The layout unit tests (`py -3 -B -m unittest discover -s assets/models/outdoor`) pass with 16 tests.

## Independent visual review

A reviewer with a fresh context, who had not seen the work, opened all twelve accepted renders at full size, at a quarter size and composited on the game's grass color (about RGB 71, 95, 43, measured from the grass pattern), measured margins, connectivity and scale with an image library, compared them with the accepted bathtub and potted plant, and accepted all three objects.

- The pool fits its 2 by 2 tile diamond, measures 988 source pixels across against about 1,002 expected from its 1.92 by 2.00 size, and its rails land on the expected edge in every facing.
- The lounger fits a 1 by 2 footprint with its long axis set like the bathtub's in every facing, measures 624 source pixels against about 620 expected, and its backrest lands on the expected end in every facing.
- The umbrella reads clearly at game size; its four facings are pixel-identical, as an eight-panel canopy on a round pole and base should be.
- Every facing of every object is one connected shape, with no floating parts or stray pixels.

The reviewer listed only minor points, none needing a fix before import: faint soft streaks on the pool's outside wall beside the rails in two facings, rails that read as grab rails rather than a ladder, a slightly soft ripple fringe at full size, a weakly marked front corner on the pool walls (the convention the accepted props share), a soft darker wedge at the lounger's hinge in its two rear facings, a one-pixel wood tip at one backrest corner in one facing, a partly outlined finial on the umbrella, and an umbrella collar close to the outline color.
