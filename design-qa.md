# Aquarium and exercise bike design QA

Date: 2026-08-12

final result: passed

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
