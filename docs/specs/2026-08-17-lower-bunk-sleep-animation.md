# Lower-bunk sleep animation

Status: implemented and locally played. Merge, exact-head CI, public Pages
deployment and replay, physical-phone review, operating-system reduced motion,
and final owner acceptance remain open.

This slice gives `bed.sleep` an honest horizontal body in the lower bunk. It
does not change the interaction's adverts, duration, reservation, pathing,
need effects, label, Save V1 format, or world hash.

## [BS-contract] One exact interaction owns the pose

`CompiledVisualAction::Sleep` appends after `Sit`. The compiler accepts only
`sleep / object_socket / socket` with a named socket on the same object. The
shipped bed owns `lower_bunk` at its footprint centre with `SE` facing.

The renderer-facing values are append-only:

1. Visual action `9` is lower-bunk sleep.
2. Existing activity `5` remains sleeping and keeps the normal `Sleeping` HUD
   label and sleep bubble.

Exact target, object, interaction, socket, component, and facing identity are
required. Other sleep-tagged uses keep their existing broad sleeping activity
without inventing this lower-bunk body.

## [BS-art] The body is horizontal and the bunk has two depth pieces

Each of the three shipped looks gains two 104 by 72 frames for all four
facings, for 24 append-only sprites at indices 336 through 359. Frame zero is
a planted sleeping pose. Frame one moves only the exposed hand and shoulder
region. Head, hips, duvet, and shoes stay fixed. Each frame holds for 32
simulation ticks; stable entity id staggers nearby Sims; reduced motion pins
frame zero.

The existing `bedBunk` art is split without changing its final empty-bed
pixels. Index 11 contains the background and lower mattress. New index 335,
`bedBunkForeground`, contains the upper bunk, near posts, rail, and ladder.
The renderer draws the body between them on a new foreground depth layer. The
foreground atlas column uses `u32::MAX` when a row has no second layer.

The compiled content pack, lot placement, render buffer, and WASM bridge own
the optional foreground sprite. TypeScript does not contain an object-id table
or special-case the bunk. Save V1 remains unchanged; Load reconstructs the
socket and foreground from the current compiled object and placement.

## [BS-input] Picking follows the visible body

Agent picking resolves the same action, facing, stable id, simulation tick,
motion preference, and world position as rendering. A sleeping Sim therefore
uses the visible 104 by 72 envelope rather than the content placeholder's
standing envelope. The activity bubble lift follows the displayed body's
height minus four pixels, so the standing position remains 84 pixels and sleep
moves to 68 pixels.

## [BS-reference] Generated art is reference-only

The built-in image generator produced
`docs/assets/lower-bunk-sleep/reference-lower-bunk-sleep.png`. The prompt asked
for a stylized isometric pixel-art reference sheet with one adult sleeping in
the lower bunk, correct occlusion by the upper bunk, near posts, ladder, rail,
and duvet, four facings, two restrained breathing frames, a planted head and
body, no bob, and no text, logos, or watermark.

The image guided contact and occlusion only. The deterministic Python
generator owns every runtime pixel. The first generated composite was rejected
because it read as crouching out of bed. The accepted revision puts the cheek
on the pillow, runs the body along the mattress, tucks the hand near the face,
and lets the authored furniture foreground cover the body naturally.

## [BS-acceptance] Automated and played gates

Automated coverage proves the append-only enum and wire values, exact legal
and illegal compiler contracts, foreground resolution and bridge access,
socket projection, Save and Load reconstruction, all looks, facings, frames,
reduced motion, atlas order and dimensions, body-aware picking, dynamic bubble
placement, and foreground depth ordering.

The production browser pass must use normal controls from a clean household to
run `Sleepeazy Deluxe > Sleep`, then inspect ordinary and close zoom. It must
show a horizontal body on the lower mattress with the upper bunk, near posts,
rail, and ladder in front. Pause must freeze the pose. Save during sleep,
advance past it, and Load must restore `Sleeping` and the same layered display.
The browser must remain free of warnings and errors.

## [BS-exclusions] Adjacent work remains separate

This slice does not add the double-bed pose, upper-bunk choice, enter-bed or
leave-bed transitions, multi-slot ownership, autonomous sleep tuning, new
sounds, new dependencies, a shader, or another draw call. Those are separate
gameplay and presentation slices.
