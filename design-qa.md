# Aquarium and exercise bike design QA

Current review date: 2026-08-14

Current result: corrective redraw passed local source, generator, and played
review. Final product-owner acceptance and physical-device review remain open.

## 2026-08-14 corrective redraw

The product owner rejected the deployed PR 52 sprites. The aquarium looked like
a white display cube under a brown roof, the bike read as a tangled miniature,
and the current exercise pose was a standing body translation rather than a
seated pedal cycle. That rejection reopened visual acceptance even though the
objects, actions, save migration, and automated runtime contracts were already
working.

The correction was built after fetching `origin/main` at `f38c64a`. It changes
only procedural art, generator validation, generated atlas outputs, and this
evidence. The existing one-by-one footprints, persistence IDs, lot positions,
collision map, actions, sockets, simulation state, and Save V1 digest remain
unchanged.

### Current comparison evidence

| Evidence | What it proves |
| --- | --- |
| [Reference and runtime comparison](docs/assets/aquarium-exercise-bike/asset-redesign-reference-runtime-comparison.png) | Both selected source images were judged beside same-scale crops from the current game, rather than against isolated sprite sheets. |
| [Current generated contact sheet](docs/assets/aquarium-exercise-bike/asset-redesign-contact-3x.png) | Both aquarium frames, three bike facings, and two opposing pedal frames retain readable silhouettes inside the fixed envelopes. |
| [Aquarium action at 1x](docs/assets/aquarium-exercise-bike/asset-redesign-aquarium-action-1280x720.png) | The normal object menu reached `Watching fish`; the cabinet clears the divider wall and the watcher stays on the adjacent tile. |
| [Bike pedal frame zero](docs/assets/aquarium-exercise-bike/asset-redesign-bike-frame0-1280x720.png) and [frame one](docs/assets/aquarium-exercise-bike/asset-redesign-bike-frame1-1280x720.png) | The normal object menu reached `Exercising`; the torso and hands stay planted while the knees and feet exchange pedal positions. |
| [Dusk](docs/assets/aquarium-exercise-bike/asset-redesign-dusk-1280x720.png), [midnight](docs/assets/aquarium-exercise-bike/asset-redesign-midnight-1280x720.png), and [Flat](docs/assets/aquarium-exercise-bike/asset-redesign-flat-1280x720.png) | Water, fish, cabinet, flywheel, console, and floor contacts remain distinguishable across the shipped lighting states. |
| [Emulated reduced motion](docs/assets/aquarium-exercise-bike/asset-redesign-reduced-motion-1280x720.png) | The browser media query resolved to reduced motion and the current aquarium and watcher held frame zero. |

### Corrective findings and fixes

1. The aquarium keeps the exact 80 by 104 canvas and reviewed
   `(26, 15, 80, 104)` opaque envelope. Its brown furniture roof became a thin
   charcoal lid; the oversized near-white gravel diamond became a narrow
   substrate band; open water now dominates the tank; and paired cabinet doors
   and hardware make the lower half read as furniture. Only the three fish
   regions differ between its two frames.
2. The bike keeps the exact 80 by 88 canvas and one-tile placement. A larger
   left-biased flywheel, separated frame triangle, front post, saddle, swept
   handlebars, console, crank, pedals, stabilisers, mat, and towel now form an
   upright-bike silhouette. Its SE and NE opaque bounds end at x 55, inside the
   divider-wall boundary; the mirrored SW and NW bounds end at x 80 on the open
   side.
3. Exercise now uses a fixed saddle hip and fixed hands. Two bent-leg frames
   exchange high and low knees and feet. The upper 50 pixel rows are
   byte-identical between frames, so a whole-body bob cannot masquerade as
   pedalling again.
4. A new decoded-record digest pins both aquarium frames, all four bike
   facings, and every exercise body. The older complement digest deliberately
   excluded these art exceptions, which allowed a later shared character pass
   to regress the exercise pose without failing the generator.

Both actions were invoked through the normal object menu at 1x before speed was
used to shorten repeated setup. The second bike frame was then advanced at 1x
and frozen. Default and close desktop views retained wall and lot-edge
clearance. A 390 by 844 responsive render kept a 390-pixel document and stage
without horizontal overflow; the object and HUD layouts were unchanged because
the sprite canvases and simulation footprints did not change. The local browser
reported no warnings or errors during the corrective pass.

Physical safe-area behavior, a real phone long press, and operating-system
reduced motion remain outside this local correction. The generated selector
still pins reduced motion to frame zero; both local emulation and its automated
tests remain green.

## 2026-08-12 original implementation record

The following record describes the original PR 52 acceptance session. It is
retained as historical evidence for interaction, Save, responsive layout, and
lighting behavior, but its visual conclusion was superseded by the owner's
2026-08-14 rejection and the corrective pass above.

## Sources and captures

The selected source mockups were opened at native detail and compared in the
same visual-inspection pass with the corresponding game captures:

| Subject | Source | Source pixels | Implementation capture | Viewport and pixels | State |
| --- | --- | ---: | --- | ---: | --- |
| Aquarium | [selected aquarium mockup](docs/assets/aquarium-exercise-bike/reference-aquarium.png) | 1315 by 1196 | [played aquarium capture](docs/assets/aquarium-exercise-bike/aquarium-action-1280x720.jpg) | 1280 by 720 | Tim watching fish at 1x, default zoom, Auto light |
| Exercise bike | [selected exercise-bike mockup](docs/assets/aquarium-exercise-bike/reference-exercise-bike.png) | 1317 by 1194 | [played exercise-bike capture](docs/assets/aquarium-exercise-bike/exercise-bike-action-1280x720.jpg) | 1280 by 720 | Tim exercising at 1x, default zoom, Auto light |
| Aquarium menu | same aquarium source | 1315 by 1196 | [aquarium action flyout](docs/assets/aquarium-exercise-bike/aquarium-menu-1280x720.jpg) | 1280 by 720 | normal keyboard-target route and open action flyout |
| Bike menu | same bike source | 1317 by 1194 | [exercise-bike action flyout](docs/assets/aquarium-exercise-bike/exercise-bike-menu-1280x720.jpg) | 1280 by 720 | normal keyboard-target route and open action flyout |

Supporting captures:

1. [Phone-width flyout](docs/assets/aquarium-exercise-bike/mobile-390x844.jpg), 390 by 844.
2. [Enlarged-text flyout](docs/assets/aquarium-exercise-bike/mobile-enlarged-320x844.png), 320 by 844 device pixels, effective 160 by 422 CSS pixels at DPR 2.
3. [Reduced-motion aquarium](docs/assets/aquarium-exercise-bike/reduced-motion-aquarium.jpg), 220 by 280 focused clip held on frame zero.
4. [Dusk lighting](docs/assets/aquarium-exercise-bike/lighting-dusk-1280x720.jpg), 1280 by 720, Day 2 at 18:05.
5. [Midnight lighting](docs/assets/aquarium-exercise-bike/lighting-midnight-1280x720.jpg), 1280 by 720, Day 3 at 00:19.
6. [Native sprite contact sheet](docs/assets/aquarium-exercise-bike/sprite-contact-native.png), covering both objects and all 48 new body frames.
7. [Exercise-bike composite sheet](docs/assets/aquarium-exercise-bike/exercise-bike-composite-3x.png), nearest-neighbour 3x bike-and-rider alignment.

All implementation captures came from the production Vite build served at
`http://127.0.0.1:4174/` in the in-app browser. The final browser smoke pass
used the same URL after the last build and restored a 1280 by 720 viewport.

## Comparison and fixes

### Aquarium

The source is a wide built-in aquarium, while the shipped object must retain a
one-tile Save V1 footprint. The implementation preserves the source's defining
features inside that honest envelope: dark wood cabinet, pale aqua glass,
gravel, rocks, plants, several fish, lid, and small hardware. Its opaque
envelope is biased toward the room, so it no longer enters the west wall like
the retired 82-pixel shelf.

The initial animation guard measured only alpha changes and one broad vertical
range. Review found that RGB-only water or cabinet movement could escape. The
final generator compares all RGBA channels and allows differences only inside
three reviewed fish regions. Played frame clips showed subtle fish movement
without cabinet, tank, water, lid, plant, or gravel vibration. Reduced motion
held the object and watcher on frame zero.

### Exercise bike

The source is a larger freestanding upright bike. The implementation keeps the
recognisable silhouette while fitting the historical one-tile moving-box slot:
dark mat, slate frame, flywheel, crank, pedals, saddle, handlebars, console,
and towel. The compact art is biased away from the east wall and lot edge.

Both pedal frames were watched through the normal 1x route. The rider stayed on
the saddle socket; hands remained planted; knees and feet alternated around the
flywheel; selection ring, activity bubble, lighting, depth, and picking moved
with the displayed body. Native and 3x composite inspection found no clipping,
detached hands, or anatomy defect.

### Menus and responsive layout

Both objects expose one real action and `Nothing`; neither presents the old
inert-object menu. At 390 by 844, the aquarium menu stayed inside the viewport,
the stage remained exposed, and both entries measured at least 44 CSS pixels
high.

Review found a deterministic enlarged-text failure in the old no-wrap flyout.
At an effective 160 by 422 CSS viewport, its 150-pixel content width plus border
and padding could not preserve the required margins. The final flyout uses
border-box sizing, a viewport-bounded width and height, independent vertical
scroll, and wrapping titles and rows. The replay measured a 144 by 170.39 CSS
pixel menu at x 8, right edge 152, zero document overflow, and two 44-pixel
rows. The full object title wrapped without clipping.

## Interaction and state checks

1. Aquarium and bike were reached through keyboard target selection, not a
   debug-only command route.
2. Aquarium watching kept the Sim on an adjacent walkable tile, facing the
   footprint centre. Bike use projected the body to the saddle without moving
   logical world state.
3. Pause froze both actions. Speed changes followed simulation ticks. Cancel
   and completion returned the body without an interpolation jump.
4. Save during fish watching, clear orders, then Load restored `Watching fish`
   without a visible glide or jump.
5. Minimum, default, and close zoom retained object recognition and avoided
   wall or lot-edge clipping.
6. Daylight, dusk, midnight, Flat light, Auto light, and reduced motion were
   observed. Flat was restored to Auto and reduced-motion emulation was reset.
7. The final desktop session recorded no horizontal overflow. The complete
   played session contained 389 browser diagnostic entries, all ordinary log
   or performance messages, with zero warnings and zero errors.

## Remaining proof boundaries

The local browser pass is strong enough for this implementation gate, but it is
not a physical-phone or operating-system accessibility test. Physical safe-area
insets, long-press behavior, and a real device reduced-motion setting remain
future device acceptance. PR #52 merged at `080ff7e1`, and [Pages run
31705838967](https://github.com/thisnameissoclever/terrilives/actions/runs/31705838967)
successfully deployed that exact SHA. The public build loaded at 1280 by 720
with the stage and HUD present and no browser warnings or errors. Its
content-addressed atlas pathname returned exactly 67,336 bytes with SHA-256
`b0c49344544cdf49e5688973cb8a70c7df5dd2c3c11015f5342e7235bd9c4bdf`.
The `?rev=080ff7e1...` used for that browser session is only a mutable
SHA-labelled session URL, not an immutable deployment. The public smoke pass
did not replay the aquarium or exercise-bike actions; action-specific played
evidence remains the local production capture above.

## Armchair seating design QA

Current review date: 2026-08-16

Current result: the exact single-slot armchair interaction passed a local
production WebGPU review. Merge, public replay, physical-device review,
operating-system reduced motion, and final product-owner acceptance remain
open.

The built-in image generator produced
`docs/assets/armchair-seating/reference-armchair-seating.png` from the current
Muted Line action sheet and armchair. The prompt requested four isometric
facings with two calm seated frames each, hips on the cushion, planted shoes,
believable joints, no vertical body bob, and a restrained hand and shoulder
adjustment. The image was a pose and contact reference only; the deterministic
Python generator owns every runtime pixel.

The first runtime composite failed the visual review because its straight legs
made the body read as standing in front of the chair. A second version bent the
knees but spread the feet too far apart. The accepted local candidate keeps a
visible knee angle, draws the shoes close to the chair base, leaves the chair
arms readable, and keeps torso and hips fixed while the hand changes subtly.
The exact 24 decoded sprite records are pinned by
`SITTING_PIXELS_SHA256`.

The real `Sit down` menu route was played at 1280 by 720 in the production
build. Bill walked to `The Chair That Is His`, projected to the seat, reported
`Sitting` in the normal HUD, and remained planted while paused. The action was
resumed in two short samples so both restrained animation phases could be
inspected before completion returned the standing body beside the chair. The
reference, first accepted frame, and later phase were inspected together.
Saving while paused in the seated state, completing the interaction, and
confirming Load restored `Saved game loaded`, `Sitting`, the paused speed, and
the socket pose. The browser surface showed no application failure.

Retained local evidence lives outside the feature commit at
`.playwright-mcp/round-02-armchair-seating/05-local-bill-sitting-final-frame-a.png`
and
`.playwright-mcp/round-02-armchair-seating/07-local-bill-sitting-final-frame-c.png`.
This review does not claim a phone-width replay, a physical safe-area pass, a
real operating-system reduced-motion setting, or owner approval.
