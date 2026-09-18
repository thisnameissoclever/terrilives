# Bunk replacement and occupied fit

Continue the authorized offline-model-to-2D workflow. The primary editor owns
this worktree; an independent read-only reviewer checks geometry, integration
and actual room evidence. Keep the approved Sim, action transforms, household
colors, 2x1 footprint, placement (9,6), centered socket and save schema.

1. Build an oak bunk consistent with the reviewed bedroom furniture. Keep
   named supported parts and a lower mattress top near 0.4674. Render four
   empty rotations without changing world scale. Empty approval cannot
   authorize replacing the existing sleeping presentation.
2. Start the occupied probe by translating the unchanged folded sleep pose
   by canonical (0,-0.50151527,0), then rotate the full assembly. This centers
   the historically measured body bounds; remeasure every visible part in
   all four samples before accepting contact. Confirm pillow/torso support,
   frame and bedding clearance and sufficient upper-bunk headroom.
3. Keep runtime socket offset (0,0). Moving only the socket would change Sim
   world depth relative to the object and could draw the sleeper over the
   upper frame. Use the existing one-owner, object-centered composite path
   with separate visible Sim/furniture contributions and one shared outline.
4. After occupied pilot review, export four empty views and 48 occupied
   groups: four facings, four frames, three shirt colors. Each group includes
   an independent full-scene image for reconstruction verification. Preserve
   signed bike/chair exporters; add a bounded bunk importer for the larger
   registered canvas and existing action-9 timing (32 ticks per half-cycle).
5. Append records after the reviewed static props. Remove the old bunk
   foreground from its content mapping, rather than combining incompatible
   old and new furniture. Retain generic foreground coverage elsewhere.
6. Verify exact target binding, picking, pause/reduced motion, save/load,
   palette-stable geometry, unchanged previous sprite pixels, every sampled
   facing and the actual room. Require independent review and green checks
   before merging and independently verifying publication.

SW/NE are source/composite review views, not valid rotated 2x1 gameplay
placements while the simulation footprint remains unrotated. Do not claim
that new artwork fixes that separate build-mode limitation.

The double bed's two-slot sleep presentation remains separate. Reusing this
one-owner path without adding per-slot positions would stack its two sleepers.

## Contact pilot

Candidate 01 was rejected: its flat lower duvet intersected the body, and
the upper access guard needed a support at its free end. Original sources,
renders and rejection evidence remain in the candidate directory.

Candidate 02 uses a sage fitted-sheet mattress on the lower bunk in both
empty and occupied states. It adds the guard support. The unchanged folded
sleep pose is a clothed nap atop the sheet, not an animated body-shaped duvet.
The pilot evaluates all visible mesh vertices in all four samples, rejects
any body/frame bounding overlap for further inspection, and ray-checks torso,
both soles and a defined underside head region against bedding. Its support
gap tolerance is -0.025 to +0.01 world units for soft bedding compression and
sampling; this is not a general collision tolerance for wooden parts.

All four samples and sixteen occupied views passed primary and independent
review (91/100, subjective). Exact structural inventory and evaluated mesh
bounds cover thirty obstacles. Ray checks record 149 torso contacts, 82 per
sole and 305 head/pillow contacts, with minimum contact footprints. Three
deliberate bedding/platform displacements and four separate saved-scene
support mutations fail; clean originals pass unchanged.

The first complete contribution batch passed all 48 reconstruction comparisons.
It was superseded after review found that resume did not reject a changed
Blender build. Its original source helpers remain beside its evidence.
`contributions-02` uses the corrected resume guard and was rendered afresh.
The production import requires a reviewed catalog binding the full raw proof,
manifest, comparison report and their files. Local runtime checks and independent
played-room/GPU review now pass. Publication remains separate and pending;
`docs/assets/review-evidence/bedroom/bunk.md` records the exact evidence.
