# Lower-shelf spine mechanics

This is a bounded mechanics proof for `Book 0 0`, the lowest-left slot. It is not accepted artwork or a complete fetch/return sequence. The original garment defect remains visible in the exact source checks; no raster, runtime asset or generic fallback was promoted.

## Source and phase contract

The unchanged source has 17 bones. `bookcase_layout.parts()` sets the resting book bottom to `.10 + row * .34 - .002`; the named-support checker requires actual contact with that support. The captured lowest-left book bottom is `0.09799999743700027`, and the base top is `0.10000000149011612`. The original supported state has 42 exact book/base surface crossings. Those indexed witnesses are preserved in `plan-02/witnesses.npz` and classified as declared resting support, not zero-contact physics.

The phase contract distinguishes that original support from clear motion:

1. **Stock contact:** preserve the original book geometry and declared named support. The intended distal hand patch contacts the exposed spine, with the palm core outside the complete cabinet front. An actual new actor replay for this initial contact remains pending.
2. **Upward release:** visibly release the book from its support. The first proved clear state lifts it `2.500004053` mm, producing an actual positive bottom/base gap of approximately `0.5` mm. The release transition itself still needs its authored frames and check.
3. **Clear pull:** translate the rigid book outward by the source-derived `225.000007629` mm. The exact endpoint convex hull represents the continuous translation corridor, with zero cabinet or adjacent-book contacts. The complete book ends `8` mm outside the cabinet front. A reading/carry grip may form only after that clearance.
4. **Return:** reverse the clear corridor, then explicitly set the book onto its unchanged named support. The reversed rigid-book corridor has the same geometric swept set; actual reverse actor frames and final setdown still require proof. No blanket book/cabinet exemption is allowed.

The hand patch consists of original source triangles wholly within the distal 25 mm of the saved wrist axis. The palm core is the original proximal hemisphere bounded by the source-axis midpoint. Both retain explicit source indices. The book target is its two original flat exposed-spine triangles. No color or world-nearest heuristic identifies the patches.

## Terminal outcomes

| Check | Outcome | Exact receipt |
| --- | --- | --- |
| Unchanged source capture | Exit 0; 17 bones; actual writer 29872 retained; inputs unchanged | `capture/render-process-exit.json`, `capture/proof.json` |
| First numerical route | Completed but mechanics rejected: the actual crown front is `y=0.20`, beyond the assumed side-panel front `y=0.22` | `plan-01-rejected/proof.json` |
| Source-derived orientation and corridor | Exit 0; mechanics pass; 19 support intervals; source indices and all input hashes preserved | `plan-02/proof.json` |
| Actual geometry-node rig replay | Exit 0; writer 63056 handle retained; 33.61 seconds; inputs unchanged | `author-01/render-process-exit.json`, `author-01/proof.json` |
| Durable preservation | 38 files retained; exact compressed-source roundtrips verified | `archive-index.json` |

The orientation solve maximizes the smaller of the exact palm/front clearance and unchanged arm reach margin over every source support interval. It chooses approximately `63.985678` degrees, with numerical margins of `1.291653` mm. Pull distance and lift derive from actual furniture/book extents.

| Actual source replay | Lift clear | Fully outside, spine contact |
| --- | ---: | ---: |
| Full-frame residual | 1.821 micrometres | 1.592 micrometres |
| Finite spine contact | 154.269 mm squared; 39 cells | 154.273 mm squared; 39 cells |
| Palm core gap from complete cabinet front | 1.29178 mm | 226.29175 mm |
| Book bottom/base gap | 0.49999 mm | 0.49999 mm |
| All skin/cloth versus cabinet contacts | 0 | 0 |
| Distal skin versus body contacts | 0 | 0 |
| Original right-sleeve self intersections | **371 pairs** | **337 pairs** |
| Raised-arm actual-source contact | 0 | 0 |
| Geometry error after negative-control restoration | 0 | 0 |

Both feet preserve finite support, each approximately 21,036.9 mm squared across 360 cells, with minimum height approximately 0.5 mm. Original hand triangle correspondence survives the actual replay.

Overall acceptance remains **false** because the original sleeve self intersections are unresolved. Initial contact, complete release/setdown frames, the outside carry-grip transition, every other slot, all four directions, garment acceptance and runtime visuals remain pending. The copied scenes and sources are evidence, not published assets. `archive-index.json` maps their original absolute paths to exact retained bytes; this report does not claim a portable rebuild.
