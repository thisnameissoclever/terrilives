# Aquarium and exercise bike

Status: merged in [PR #52](https://github.com/thisnameissoclever/terrilives/pull/52)
at `080ff7e1` on 2026-08-13. [CI run
31705839013](https://github.com/thisnameissoclever/terrilives/actions/runs/31705839013)
and [Pages run
31705838967](https://github.com/thisnameissoclever/terrilives/actions/runs/31705838967)
completed successfully for that exact merge SHA. The public build then loaded
at 1280 by 720 with its stage and HUD present, no browser warnings or errors,
and the content-addressed atlas returning the expected 67,336 bytes and
SHA-256 digest. Action-specific played evidence remains local; physical-device,
operating-system reduced-motion, and final owner acceptance remain open. The
product owner selected the generated aquarium and exercise-bike mockups as the
visual targets. The aquarium replaces the inert personal reference shelf. The
exercise bike replaces the inert unpacked moving box. Neither object is
decorative-only: each gains one real player and autonomy interaction with a
distinct body animation. `design-qa.md` records the source comparisons, played
desktop and phone-width evidence, enlarged-text repair, and remaining device
proof boundaries.

The product owner rejected the deployed object art on 2026-08-14. A corrective
redraw now passes local generator and played review against the same selected
mockups. It retains the one-tile persistence and collision contracts while
replacing the aquarium silhouette, bike silhouette, and exercise body frames.
Final owner acceptance of those corrected pixels remains open until the
corrective branch is reviewed and deployed.

This slice deliberately preserves the existing Save V1 entity and collision
shape. It changes authored interactions, presentation metadata, generated art,
and renderer-only pose projection. It adds no dependency, save field, shader,
GPU instance field, draw call, or WASM bridge column.

## [AEB-scope] Two inert persistence slots become functional objects

The visible objects and actions are:

1. `Aquarium of Managed Expectations`, with `Watch the fish`.
2. `Wellness Initiative, Indoor`, with `Use the exercise bike`.

Both names were visible in the source mockups the product owner selected. That
is a narrow approval of these two object names, not completion of the separate
whole-pack dark-comedy voice session.

The internal object IDs remain `reference_shelf` and `moving_box`. Those names
are now persistence keys, not player-facing descriptions. They remain in their
existing persistence IDs, at their existing placements, with their existing
one-by-one footprints:

1. The aquarium remains at `(6, 10)` in the study.
2. The exercise bike remains at `(4, 11)` in the bedroom.

The historical IDs, positions, and footprints are load-bearing. Object
declaration order is deliberately free because Save V1 stores authored string
IDs rather than live numeric `ObjectDefId` values. Save V1 restores saved
entities and a saved blocked-tile grid; a fingerprint exception alone cannot
invent a newly added object or repair a changed footprint. The content and lot
comments must name this constraint so a future cleanup does not casually
rename the keys and reopen the migration.

The aquarium art is compact and biased away from the west wall. The bike art
is compact and biased away from the east wall and lot edge. The old shelf's
82-pixel visual width on a one-tile footprint is not inherited.

## [AEB-content] Authored interactions remain tunable and distinct

The aquarium interaction contract is:

```toml
id = "watch_fish"
label = "Watch the fish"
advertises = { fun = 25.0, comfort = 21.0 }
duration_ticks = 67
slots = 1
tags = ["aquarium"]
satisfaction = 1.0
visual = { action = "watch", anchor = "object", facing = "toward_anchor" }
```

The bike owns a `saddle` socket and this interaction:

```toml
id = "use_exercise_bike"
label = "Use the exercise bike"
advertises = { fun = 28.0, energy = -8.0, hygiene = -5.0 }
duration_ticks = 83
slots = 1
tags = ["exercise"]
satisfaction = 2.0
visual = { action = "exercise", anchor = "object_socket", facing = "socket", socket = "saddle" }
```

The values are authored starting points, not acceptance evidence. The shipped
12,000-tick and 120,000-tick traces must be rerun. Both new objects must receive
uses at the long horizon; the fragile reading chair must still receive uses;
critical needs and completed household chains must remain healthy. Tuning may
move only with recorded trace evidence, and duration and signed need deltas
must remain distinct from every shipped sibling interaction.

## [AEB-data] Visual contracts append without broad inference

`CompiledVisualAction` appends `Exercise`, then `Watch`. The compiler accepts
exactly two new combinations:

1. Object interaction, Exercise, ObjectSocket, Socket, named socket.
2. Object interaction, Watch, Object, TowardAnchor, no socket.

Every other owner, anchor, facing, or socket combination fails compilation.
Tags, labels, object IDs, need adverts, and broad activity states never invent
presentation art.

Render-buffer action codes remain append-only:

1. `0` none.
2. `1` talk.
3. `2` eat.
4. `3` seated read.
5. `4` standing read.
6. `5` walk.
7. `6` exercise.
8. `7` watch fish.

Activity codes remain append-only:

1. `0` none.
2. `1` walking.
3. `2` waiting.
4. `3` eating.
5. `4` talking.
6. `5` sleeping.
7. `6` at work.
8. `7` using object.
9. `8` reading.
10. `9` exercising.
11. `10` watching fish.

## [AEB-sim] Exact interaction identity owns the body pose

The bike reuses the existing presentation-only socket projection. The Sim's
logical ECS position stays on the reachable adjacent path tile; the rendered
body, selection ring, activity indicator, lighting sample, depth, and picking
position move together to the saddle. Entering and leaving the socket pose,
including Cancel, Pause, completion, and Load, reseeds both interpolation
samples so the body never glides through furniture.

Watching fish keeps the Sim on the adjacent path tile and faces the aquarium
footprint centre. It does not project the body into the tank.

The exact presentation precedence is:

1. Conversation.
2. Authored eating.
3. Authored socket action: seated reading or exercise.
4. Authored object-facing action: standing reading or watching fish.
5. No authored action.
6. Walking may replace only the final Walking activity.

Target identity, interaction index, component state, object definition,
socket ownership, and socket bounds all fail closed. A malformed overlap or a
passive conversation partner cannot acquire a bike, watch, eat, or read pose.
The selected authored pose carries its matching activity so pose and HUD text
cannot disagree.

These projections remain outside the deterministic world hash. The published
synthetic one-fridge hash golden must remain unchanged. The shipped autonomy
trace is expected to change because it gains two real candidates.

## [AEB-save] Structural compatibility is not a legacy-name migration

Adding the two interaction rows changes the structural content fingerprint.
The previous public structural digest receives a narrow migration to the new
compiled digest. This bridge is separate from the retired full-pack
fingerprints:

1. A save with the prior structural digest may load because its entity list,
   object IDs, positions, footprints, and blocked grid still match.
2. That prior structural digest is not `legacy` and must not run the historical
   Terri, Doug, and Nadia household-name migration.
3. The truly legacy full-pack fingerprints target the new reviewed digest and
   keep their existing name-migration behavior.
4. Changing either interaction ID, row count, or row order closes the bridge
   automatically because the current digest no longer matches its reviewed
   target. Balance values, tags, labels, durations, satisfaction, and visual
   metadata remain compatible by design.

Every accepted pre-feature fingerprint is classified before current-pack row
validation. Those snapshots cannot contain row zero for either formerly inert
object, so Load rejects such references across `Target`, `Eating`, `Intent`,
queued `UseObject`, `Habituation`, and Personality dispositions before it
reconstructs any world state. This applies to the prior structural digest and
all four retired full-pack digests. It prevents a corrupt historical snapshot
from quietly reinterpreting an impossible row as one of the newly authored
actions.

Saving a valid migrated snapshot emits the current digest and unchanged
persistence IDs. The public WASM byte loader must accept the prior structural
digest without running the household-name migration, then emit the current
digest on the next save.

## [AEB-art] Match the selected designs inside honest one-tile envelopes

The aquarium must read at native size as a dark wood cabinet, pale aqua glass
tank, water, gravel, rocks, plants, several fish, a lid, and small cabinet
hardware. Two same-envelope object frames move only fish and tails by a few
pixels. The entire cabinet must not vibrate. Reduced motion pins object frame
zero. The corrective art uses a thin charcoal lid, open water as the primary
field, a narrow substrate band, and two cabinet doors. A broad brown roof or a
large near-white gravel diamond is a regression, even if the dimensions and
fish animation remain technically valid.

The aquarium is not emissive in this slice. The renderer applies emissive
strength to a whole object quad; lighting the water that way would also make
the cabinet glow. Selective tank light requires a separate overlay or mask and
remains future work.

The bike must read at native size as an upright stationary bike with a dark
mat, slate frame, flywheel, crank, saddle, handlebars, console, pedals, and
towel. Its compact silhouette and one-tile footprint are intentional
deviations from the wider mockup. The rider's hip and hands remain fixed on the
saddle and bars while opposing knees and feet exchange pedal positions. Moving
the whole body vertically does not satisfy this action contract.

Both character actions provide three looks, four facings, and two genuinely
different frames. Watching fish uses a relaxed weight or head shift on a
24-tick hold. Exercise uses a seated torso, planted hands, and alternating
knees and feet on an 8-tick hold. Stable entity ID staggers the phase before
division. Pause freezes it; speed changes follow simulation ticks; reduced
motion pins frame zero while preserving placement and meaning.

The selected aquarium and bike source mockups remain the design targets for
the local comparison pass. Generated game art stays procedural Muted Line;
no source mock pixels are copied into the atlas.

## [AEB-atlas] Existing art stays fixed outside the two replacements

The atlas remains append-only. The two old inert-object sprite records may be
redrawn in place so compiled sprite indices remain stable. Every other record
through current index 171 must retain its name, dimensions, and decoded pixels.
A protected complement digest makes that requirement causal.

New object variants, indicators, and body frames append after index 171. The
generator pins exact names, dimensions, envelopes, non-empty pixels, object
frame stability, action-frame differences, and generated manifest parity. The
aquarium's two frames may differ only inside three reviewed fish-motion
regions; the all-channel comparison rejects RGB-only water, glass, lid, or
cabinet motion as well as alpha changes. Accepted conversation art and the
character animation repair remain unchanged.

The corrective subset has its own decoded-record digest covering both aquarium
frames, all four bike facings, and every exercise body. This closes the hole
left by the earlier complement digest, which correctly excluded intentional
replacement art but therefore could not detect a later regression inside those
exceptions.

The generated TypeScript manifest carries the SHA-256 digest and exact
content-addressed filename of the PNG bytes committed beside it. The renderer
requests that hashed pathname. GitHub Pages ignores query strings in its edge
cache key, so query-only cache busting is explicitly insufficient. The hashed
path keeps Vite's hashed JavaScript from being paired with a cached PNG from an
older deployment.

## [AEB-proof] Automated, mutation, trace, and played gates are required

Automated coverage must prove:

1. Both legal visual contracts compile and every near-miss rejects.
2. Existing enum discriminants and serialized field order remain stable.
3. Old structural saves load through the public byte boundary without household
   rename; legacy full-pack saves retain their name migration; current saves
   round-trip both active actions. Every impossible pre-feature reference to a
   new row fails transactionally in all six saved index spaces.
4. Exact render actions, activities, facings, socket coordinates, precedence,
   entry and exit reseeding, Save, Load, and world-hash isolation hold.
5. The existing bridge views preserve codes and coordinates across real WASM
   memory growth; no new accessor exists.
6. All looks, facings, frames, boundary ticks, phase staggering, Pause, speed,
   Load, and reduced motion select the correct object, body, and indicator art.
7. Ring, activity indicator, lighting sample, depth, and picking stay aligned
   with the body; aquarium watching remains outside the object footprint.
8. Atlas records outside the two intentional replacements retain decoded
   pixels, aquarium frame changes stay inside the reviewed fish mask, the
   public texture URL matches the PNG digest, and generated files reproduce
   exactly.
9. Deliberate production-seam mutations fail causally and every touched file
   restores byte-identically.
10. Full Rust, Web, WASM, TypeScript, production build, atlas, documentation,
    formatting, lint, diff, and prohibited-dash gates pass.

The shipped trace must be measured at 12,000 and 120,000 ticks. The final
played production WebGPU pass must use the normal player route at 1x before 2x
or 3x and inspect:

1. Aquarium wall clearance and bike wall and lot-edge clearance at minimum,
   default, and maximum zoom.
2. Aquarium readability, subtle fish movement, and watcher placement from
   every reachable side.
3. Bike saddle, hand, knee, foot, flywheel, and pedal alignment in both frames.
4. Pause, completion, Cancel, Save, and Load without glide or jump.
5. Daylight, dusk, midnight, Flat lighting, and reduced motion.
6. Desktop and phone-width flyouts, focus, touch targets, and exposed-canvas
   picking.
7. Zero unexpected browser warnings or errors.

Source tests and isolated atlas inspection do not satisfy played acceptance.
The implementation must end with `design-qa.md` recording both selected source
mockups, same-state implementation captures, comparison findings and fixes,
and a final pass or explicit remaining blocker.
