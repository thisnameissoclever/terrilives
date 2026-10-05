# Matched wall and door depth

Observed 2026-10-02 against production source `3c3d28ba`, with the subsequently
reviewed proof-only witness correction. The owner requested slightly thicker
walls and slimmer door frames that match. Both now use 0.14 game units, replacing
0.12 walls and 0.16 fixed casings. Openings, heights, material choices, model IDs,
content and save behavior remain unchanged.

## Source and transport

The shared dimension lives in `assets/models/architecture-depth.json`. Production
straight walls, all 80 junction combinations, window-wall cores, arched infill,
face surrounds, casing and flush threshold derive from it. The leaf hinge moves
to 0.465, preserving its 0.035 offset from the casing front. The historical room
corner helper remains part of the original checkpoint, not current production.

Fresh independent source-art review accepted architecture manifest
`7cb5c25769601f4c73541f87d7b2609283a27596a8ec10eaeeee19f89e48aa7a`
and door manifest
`ba66ad35bcefd23bb8b75401c4342d4fda9bb5a7912990054f817291ca676d22`.
It inspected all original/native window and door sheets, junctions, walls and
floors, and verified their source/output bindings. Architecture has 174 original
paired renders and 472 pieces; doors have 40 poses with color/depth outputs.
The editable scene was separately opened and measured by a read-only Blender
audit, with identical before/after bytes. This is not manual GUI acceptance.

The original 1700 logical sprite pixels remain exact. Only the expected 80 newer
door color/depth records change in the 2445-record historical prefix. All 96
floor pieces retain exact color, carrier, roles, depth and registration. See
[historical preservation](../../assets/review-evidence/architecture/depth-full-01/historical-preservation.json)
and [floor preservation](../../assets/review-evidence/architecture/depth-full-01/floor-packed-preservation.json).

Review found and corrected a receipt overwrite guard that ran after its first
status write. It also found 16 hash-bound files whose Windows bytes would change
under Git's text filter. Scoped `-text` rules preserve the accepted bytes. The
[123-file index import](../../assets/review-evidence/architecture/depth-full-01/git-index-portable-import.json)
passes production guards using exact staged Git bytes. No hashes were restamped
to conceal transport changes.

## Local checks

[Local check receipt](../../assets/review-evidence/architecture/depth-full-01/local-checks.json)
records exit 0 for 17 geometry tests, 167 generator tests, atlas freshness,
1953 web tests in 144 files, typecheck and production build. Three new depth
mechanisms and eleven existing architecture mechanisms were caught by causal
checks with exact restoration. The first mutation run failed during restoration
with Windows `OSError 22`; its partial results remain unrecorded rather than
claimed complete. Exact accepted bytes were restored before the separate strict
passing run. The isolated OS error's cause remains unproved.

Rust/content/save inputs are unchanged, including `atlas.toml`, so their passing
checks were not repeated. Root additionally passed proof JavaScript syntax,
changelog tests (12), changelog build, documentation ids and whitespace checks.
The existing chunk-size advisory remains; no dependency changes were made.

## Actual renderer and gameplay

[GPU and crossing receipt](runtime/gpu-and-crossings.json) records 12 joined
contact configurations across both axes, three scales and full/cut views. All
420 sampled pixels have visible coverage, with independent removal controls
showing both wall and frame producers affect the samples. Architecture depth,
apertures, blending, alternate finishes, floors, junction reconstruction and
cutaway composition also pass.

All 864 door-depth cases pass. The initial native-scale witness encountered
raised moulding instead of its assumed flat panel at one partly open pose.
The corrected witness uses the independently authored panel center at height
0.445. Its physical surface plane and depth bracket remain unchanged. Removing
only the portal surface-projection assignment fails 762 cases. Exact source
restoration to SHA-256
`c4970816119f37b477381f7a62adb69458a02b1cf50f1aa9cb2214111b916386`
restores all 864 passes. Initial failed observations remain in the receipt.

Normal player object orders carry Sims across both doorway axes, with nonzero
door openness and positions recorded before, at and beyond each plane. Actual
full/cut screenshots retain visible feet and coherent frame/leaf ordering.
No forced positions or private world changes were used. A failed combined
walkthrough tried a hidden original Build button; separate measured-state axis
cases completed and retain that failure honestly.

[Played views](runtime/played-views.json) show all nine windows and 192 applied
floor records at noon, full/cut walls, enlarged zoom, dusk and midnight. All nine
choices are reachable at 390 pixels with measured 14- and 28-pixel text and no
horizontal page overflow. Current daylight controls brighten daytime rooms and
add exactly zero nighttime light. All browser cases report no errors.
[Saved-image analysis](runtime/screenshot-pixels.json) verifies 494550 rendered
pixels outside the HUD, exceeding the unchanged 10000-pixel threshold. A
transient canvas copy remains diagnostic only.

Fresh final adversarial source/runtime review approved the branch with zero
material findings after inspecting all 11 screenshots and their hashes. All
task-owned browser contexts and servers are closed. Physical phones, other GPU
hardware, driver allocation padding and JavaScript heap profiling remain
unobserved. Earlier GPU timing is dated evidence; this change makes no new
performance claim.

The existing October 2 public note includes thicker walls and slimmer matching
frames. Creation and merge of the pull request are authorized without waiting
for duplicate GitHub checks or review. Automatic publication is verified
separately after merge.
