# Muted Line, the day/night cycle, and circadian sleep

Status: **seven of nine roadmap items shipped.** [ML-gen], [ML-ci],
[ML-sprites], [ML-ambient], [ML-tint], [ML-chars], and [ML-pools] are in the
running game. PR #45 merged [ML-pools] at `ef9f86c`; the corresponding GitHub
Pages deployment and public desktop and mobile browser pass succeeded.
The circadian schema and scoring mechanism are built but the authored curve is
**switched off** pending [ML-feel]. [B7] and [ML-feel] remain open. See
`docs/FEATURES.md` for the concise current-state account.

Originally: **implementation plan, agreed art direction, nothing built.** The
owner picked Muted Line on 2026-08-03 from the round-two directions, which
resolves [T-design-language]. Written the same day. The prototype the
decision was made against is committed at `tools/art-prototype/` and is
not wired into anything.

## Summary

Muted Line is procedural. Every sprite is drawn by a generator from a
palette, a shape language and a set of character-build numbers, so the art
is code and the style is a data structure. That single fact decides most of
this document, and it decides it in the cheap direction.

Three consequences worth stating before the detail:

**The lighting rig fits inside the existing single draw call.** [D10]'s one
draw and one submit per frame survives the whole day/night cycle. There is no
post-process pass or second pipeline. Light pools become the *tint of instances
already being drawn* rather than new geometry, because the pipeline alpha-tests
at 0.5 and writes depth. A soft additive quad would be discarded below half
alpha and would claim depth above it. The GPU counts still require a displayed
remeasurement after any renderer change; architecture is evidence about the
shape of the path, not permission to recycle old measurements.

**Circadian sleep needs no new mechanism.** The scoring path already has a
tag-keyed multiplier for trait dispositions, the clock already exists, and
`SimClock::is_hour_boundary()` has been sitting unused since M0 waiting for
its first consumer. Sleep drive is a curve over the day applied to
sleep-tagged candidates, plus a per-sim phase offset so the household does
not go to bed in lockstep.

**The total cash cost is zero, and Muted Line closes most of the open AI
questions rather than answering them.** No image model, no LoRA, no style
bible, no GPU, no pack, no subscription. [T10] and [T13] stop being
prerequisites for anything on the critical path.

---

## Part 1: The generator

### [ML-gen] Port the prototype to `assets/sprites/gen/`

`assets/sprites/build-atlas.ps1` is Windows-only `System.Drawing`, CI never
runs it, and the atlas is a committed blob nobody can verify. The prototype
is Python and Pillow, which fixes all three at once.

Structure, one concern per file:

- `style.py` - the Muted Line constants. Palette, 1 px `#3e3634` outline,
  the three face-shading multipliers, corner radius, the character build
  numbers. **This file is the style bible**, and it is executable rather
  than a folder of reference images.
- `iso.py` - `box`, `slab`, `cyl` and the projection. Must import
  `TILE_HALF_WIDTH 32` and `TILE_HALF_HEIGHT 21` from a single source
  shared with `web/src/render/iso.ts`, or the two drift and every sprite
  sits wrong on the grid.
- `objects.py` - the object vocabulary, one function per catalogue entry.
- `characters.py` - the parametric sim.
- `build.py` - packs the sheet and writes `atlas.png`, `atlas.toml` and
  `web/src/render/atlas.ts`.

**The output contract does not change.** Same three files, same shapes, so
`web/tests/atlas.test.ts` keeps working unmodified and nothing downstream
knows the art was replaced.

### [ML-ci] Make the atlas verifiable

Because the generator is now Python on Linux, CI can run it. The check
regenerates the atlas and compares decoded RGBA pixels, while the TOML and
TypeScript manifests remain exact text comparisons. That converts `atlas.png`
from a trusted blob into a reproducible visual build output without treating a
Pillow or zlib encoding change as different artwork. Byte comparison was the
first implementation and proved brittle on pixel-identical Pillow 12 output.

### [ML-chars] Three instances per sim, not one sprite per combination - SHIPPED, DIFFERENTLY

A sim needs per-character skin, hair and clothing. Baking every combination
into the atlas is combinatorial and absurd. Drawing the sim as three
stacked instances - body, head, hair - each with its own tint from
[ML-tint] below, gives full variety from three atlas entries.

Three instances per sim against one is irrelevant at this scale: 5,000 sims
is 15,000 instances, and M0 sustained 1,002 entities at 120 fps with a mean
frame time of 0.261 ms against a 16.6 ms budget.

**What shipped is three BAKED looks, picked by the sim's entity id.** The
performance argument above is sound and was never the obstacle. The
obstacle is `frame.ts`: two extra instances per sim shifts every slot in
the extras region, puts the indicator bubbles and the carried badges
behind two new depth nudges, and rewrites eight tests that name a slot by
its index - all to give a cast of three the variety a character creator
would need. Combinatorial is the right word for a creator and the wrong
one for a cast.

The reasoning and its expiry date are in `assets/sprites/gen/style.py`
beside `CHARACTER_PALETTES`. What flips it back: a player choosing a face,
or a cast large enough that the atlas grows faster than the shell would.
[ML-tint] landed anyway, so the hard half of the change is already done
when that day comes.

### [ML-sprites] Move the atlas table to a storage buffer first - SHIPPED

`MAX_SPRITES` is a fixed-size uniform array of 128 with 48 used. Muted Line
lands somewhere near 60 to 90 entries before facings, and WGSL **clamps** an
out-of-range index rather than trapping, so overrunning it draws every
sprite past the end as the last one in the table with no error from
anywhere. About 20 lines across `sprites.ts` and `sprites.wgsl`. Do it
before the sprite count grows, not after.

---

## Part 2: Lighting, in three tiers

Each tier is independently shippable and each one is visible on its own.
Ship them in order; stop whenever it looks right.

### [ML-ambient] Tier 1: a global ambient tint

The fragment shader currently ends `return colour;`. It becomes
`return colour * u.ambient;`, and `struct Uniforms` gains an
`ambient: vec4<f32>`, taking the uniform buffer from 32 bytes to 48.

The TypeScript side computes ambient from `tick % day_ticks` against a
curve authored in content. That is the entire day/night cycle as far as the
eye is concerned, and it is what produced the four-hour strip the direction
was chosen from.

**Cost: about half a day, no new draw call, no per-instance data, no change
to the instance contract.** This is by far the best ratio in the document.

### [ML-tint] Tier 2: per-instance tint - SHIPPED

An instance is one `vec4<f32>`: screen x, screen y, depth, sprite index.
All four slots are spent, so a second `vec4` vertex attribute is needed.
That is a contract change across `instances.ts`, `sprites.wgsl`,
`frame.ts`, `tiles.ts` and their tests, and the comment in `instances.ts`
is right that nothing in the type system connects them.

Instance size goes 16 to 32 bytes, so 1,000 entities cost 32 KB a frame
rather than 16 KB. Against the measured headroom this is not a performance
question.

What it buys, all at once:

- **Emissive surfaces.** A lamp shade, a television screen and a window
  need to *resist* the ambient multiply, or at night the room goes dark and
  so do its light sources, which is exactly backwards. A tint above 1.0 on
  those sprites is the whole fix.
- **Per-sim colour** for [ML-chars].
- **[G4] palette recolours for free.** One sofa mesh becomes fifty
  catalogue entries with no mask texture, which the art pipeline has wanted
  since it was written.

**As built, the fourth component is emissive rather than alpha**, and the
difference matters twice. Named alpha it would invite scaling the sprite's
own alpha, which the fragment shader alpha-TESTS at 0.5 before writing
depth - so the discard threshold would move with the light and every
sprite edge would erode as night fell. Named emissive it does the thing
the first bullet asked for: `mix(u.ambient.rgb, vec3f(1.0), tint.w)` lifts
one instance out of the hour without touching any other, which is a tint
resisting the ambient rather than a tint above 1.0 fighting it.

The lamp and the television carry 0.85 rather than 1.0. At 1.0 the whole
sprite ignores the hour - stand, base and outline included - and reads as
a cutout pasted over the night rather than as a light standing in a room.

### [ML-pools] Tier 3: light pools and cast shadows, with no new geometry

Light pools are per-tile tints on floor instances, computed CPU-side from a
list of lights, plus the same tint applied to whatever object or sim stands
on that tile. Cast shadows are the same thing with a darker value offset
along the key direction.

**As built,** the floor lamp uses the graph-distance profile
`[0.35, 0.22, 0.10, 0.04]`; the television uses the weaker
`[0.25, 0.12, 0.04]`. Values combine by maximum, so declaration order cannot
change the room. Interior wall tiles stop the four-way flood, doorway gaps pass
it, and wall panels sample the brightest reachable adjacent floor. The field
includes the one-tile boundary ring needed by the north and west wall panels.

Every smart object casts a one-tile shadow immediately beyond its compiled
footprint in the fixed `+x` key direction. Each light computes that attenuation
before maximum composition, so a television on the far side can still light a
tile shadowed from the lamp. Sims keep their baked contact shadows and do not
cast tile shadows. Object footprint width and depth cross [D11] as aligned
`Uint32Array` views; the shell does not reconstruct content geometry or create
per-entity JavaScript objects.

The field is rebuilt from the render snapshot at startup and after Load.
Camera moves rebuild the existing static instance block with the same field;
ordinary frames update only the existing dynamic prefix. Sims, smart objects,
and carried badges sample their interpolated tile. Selection and
activity indicators remain semantic overlays rather than inheriting pool tint.

Nothing new is drawn. These are instances the renderer already emits,
carrying a different tint, so the frame stays at one draw and one submit.

**Why not additive quads, which is the obvious approach.** The pipeline
discards fragments below 0.5 alpha and writes depth. A soft radial gradient
is mostly below 0.5 alpha, so most of it would vanish, and the part that
survived would claim depth for everything behind it. Making it work means a
second pipeline with additive blending and depth writes off, which is a
second draw call and the end of [D10].

**The honest cost of the tile approach** is that light is quantised to 64 px
tiles, so a pool has visible steps. Two mitigations, both cheap: tint the
objects and sims standing on a tile as well as the tile itself, which is
what makes a pool read as light rather than as a pattern on the floor; and
accept the stepping as style, which a flat palette-driven direction can
carry in a way a painterly one could not.

### [ML-hash] Lighting must not enter the world hash

Everything above is presentation. It is computed in TypeScript from the
clock and never travels back into the simulation, because [D12]'s
determinism test hashes the world and a lighting value that leaked into it
would make the hash depend on the renderer. State it as a rule, and assert
it: a determinism run with lighting disabled must produce the same hash as
one with it enabled.

The boundary test now runs two real shipped-lot WASM simulations for 20 ticks,
building a non-empty enabled field beside one and an exact-zero disabled field
beside the other. Their final world hashes are identical. This proves the
presentation calculation never writes back into simulation state; longer
simulation determinism remains owned by [D12].

### [ML-a11y] Night must stay playable

Two requirements, neither optional:

- **An ambient floor.** The darkest hour must still be legible on a dim
  phone in daylight, which is the actual worst case. Pick the floor by
  measuring against a real device, not by eye on a desktop monitor.
- **A flat-lighting toggle** that pins ambient to neutral daylight. This belongs with
  the existing reduced-motion handling rather than buried in a menu.

**As built,** `Light: auto` and `Light: flat` live in the household status
panel. The explicit preference is versioned in browser storage. Reduced motion
temporarily forces and disables the flat control without overwriting that saved
choice. Flat mode uses exact neutral ambient and removes local pools; it does
not pretend that a moving noon curve and a fixed accessibility mode are the
same state.

The HUD is DOM and sits outside the canvas, so none of this touches the
readouts. That is the [D-7] DOM-for-UI decision paying off again.

**Displayed acceptance.** The local production build was watched at noon,
dusk, and midnight. Auto showed the authored ambient transition and local
sources; Flat returned exact neutral lighting and survived reload; reduced
motion forced and disabled Flat without overwriting the saved choice, then
restored Auto live; and an explicit Load rebuilt the midnight pools. The shell
uses both the normal media-query event and a cached frame check because the
embedded Chromium path missed one observed event. The selected-Sim ring's pale
full-emissive outer key measured 4.41:1 against the brightest adjacent
lamp-lit floor and 5.50:1 against the darkest sampled floor. Desktop browser
acceptance does not close the required physical-phone daylight check.

---

## Part 3: Circadian sleep

### [ML-curve] Sleep drive as an authored curve

Add a `[circadian]` table to `content/tuning.toml` holding control points
over the 1440-tick day, linearly interpolated:

```toml
[circadian]
# (tick, multiplier). 360 is 06:00, 1320 is 22:00.
sleep_drive = [[0, 1.00], [300, 0.90], [420, 0.15], [1080, 0.30], [1320, 0.95], [1440, 1.00]]
energy_decay_scale = [[0, 1.25], [420, 0.85], [1140, 1.00], [1440, 1.25]]
```

Authored rather than hardcoded, for the same reason every other tuning
number is: the shape is a design question that wants iterating against
measured runs, not a recompile.

### [ML-tag] Apply it where dispositions already apply

`score_advertisement(deficit, delta, duration_ticks, distance)` is the
shared scorer, and trait dispositions already multiply tagged candidates'
scores by a factor. Circadian drive is the same shape of thing keyed on the
`sleep` tag, so beds need no new fields - objects already declare tags, and
one multiplier covers every bed-shaped route to sleeping without naming
each object.

Two forces, deliberately separate. `energy_decay_scale` means staying up
late genuinely costs something. `sleep_drive` means a bed is more
attractive at 23:00 than at 14:00 *at the same energy level*, which is what
makes sims go to bed rather than merely collapse.

### [ML-chrono] A per-sim phase offset is what makes a household

One curve for everyone puts three sims in bed on the same tick, which reads
as a screensaver. Add `chronotype_offset_ticks` to `personalities.toml`,
shifting where a sim samples the curve: an early bird at -90, a night owl
at +180.

This is the single highest-value line in Part 3. A house where one person
is still up when the others have gone to bed is a house; a house where
everyone lies down together is a barracks.

### [ML-shift] Careers already invert it for free

`shift_start` and `shift_ticks` exist and are validated against `day_ticks`
at compile time. A night-shift job therefore inverts a sim's whole day
without any new machinery, purely as content. Worth an authored example, if
only because a sim asleep at noon is the fastest way to see that the system
is real.

### [ML-wake] Waking needs a rule of its own

A sleep drive with no counterpart produces a sim who sleeps fourteen hours.
Two rules:

- Sleep completes when energy is full, which the interaction system
  probably already does; verify rather than assume.
- **A shift alarm.** When a sim's `shift_start` is within some tuned
  distance, sleep's score collapses. Otherwise the first night-shift sim
  authored will sleep through work and the career system will look broken
  when the bug is here.

### [ML-det] Determinism

All of this is f32 arithmetic on the existing scoring path. `[D12]`'s CI
determinism test covers it, and the existing note about `score_advertisement`
cubing urgency identically on every target applies to the interpolation too:
one lerp helper, used everywhere, no target-dependent fused multiply-add.

### The rhythm is built and switched off, and why

Everything in Part 3 above ships except the authored curve: the schema,
the compile-time validation, `systems/circadian.rs` and its tests, the
per-sim chronotype offsets in `personalities.toml`, the `sleep` tags on
both beds, and the multiplier composed into selection beside the trait
dispositions. `content/tuning.toml` carries the `[circadian]` block
commented out, and uncommenting it is the only step remaining.

It is off because the CURVE is not tuned, and [ML-feel] below is the
reason rather than an excuse. The first draft ran a 6.4x peak-to-trough
swing and the household slept so much that `save.rs`'s fixture could no
longer get anyone to habituate to a kitchen chain row in 3 000 ticks; it
needed 12 000. That is the drive overpowering the needs rather than
weighting them. Softening to 2.5x helped and did not settle it.

**Widening that fixture is not available**, and the reason is worth
recording because it constrains any future tuning too: `ci.yml` runs
`cargo mutants --timeout 60`, and that timeout bounds each mutant's whole
workspace test run. The one test went from 10 s to 39 s at the wider
horizon, which would turn a large share of mutants into spurious
timeouts. **Any change to shipped content that materially slows the
simulation has to be measured against that 60 s ceiling, not just against
the wall clock.**

So the tuning is a separate, measured piece of work, and a milestone
whose payoff has not been watched does not get quietly ticked.

### [ML-feel] It is not done until it has been watched

The alpha acceptance findings are the precedent: three criteria that looked
fine were measured and did not hold. A seven-sim-day instrumented run
should report, per sim, when sleep started, how long it lasted, and how far
apart the household's bedtimes were. A cycle that looks right in a
screenshot and puts everyone to bed at 22:00 exactly is a failure that only
a measured run will catch.

---

## Part 4: Where AI is used, and what Muted Line closes

Picking a procedural art direction does not make AI more useful here. It
makes most of the AI questions unnecessary, which is a better outcome.

**Closed, or no longer on the critical path:**

- **[T10], choose an AI image tool.** Not needed for the art pipeline at
  all. It survives only as an option for the diegetic 2D layer below, and
  even there it is not the first choice.
- **[T13], approve the style bible.** Replaced by `style.py`. A style bible
  exists to keep generated assets consistent; a generator is consistent by
  construction.
- **[K1], a hard palette mechanically enforced.** Enforced by construction:
  the generator has no colours other than the palette. [K4]'s build-time
  off-palette rejection becomes trivial, because there is nothing to
  reject.
- **[K3], a LoRA trained on approved assets.** Not needed.
- **Copyright ambiguity.** Gone. The art is the output of a program, not of
  a model, so the note about purely AI-generated work being uncopyrightable
  in the US stops applying to the sprites.
- **[R4], art as the memory budget.** Procedural sprites in one small atlas
  are a rounding error.

**Where AI still earns its place, in order of value:**

1. **[AI5] text.** Unchanged and still the largest content multiplier in
   the project: object names, moodlet copy, news headlines, death notices,
   career flavour. Generate offline, commit as TOML, ship in the pack. No
   runtime call, no API key, no per-player cost, and the content pipeline
   already validates it.
2. **Writing the code.** Including this generator, which is the honest
   answer to "how does AI help my art pipeline" for a developer who does
   not draw.
3. **Diegetic 2D** - paintings, posters, book covers. This is the one place
   an image model still fits. **My recommendation is to try procedural
   first**, generating abstract compositions from the same palette, because
   it keeps the zero-consistency-problem and zero-licensing-question
   properties that make the rest of this direction cheap. Reach for a model
   only if procedural posters look thin.
4. **Palette and curve exploration.** Cheap, low stakes, and the sort of
   thing that is faster to ask for than to tweak by hand.

**Still fenced off:** nothing needs fencing, because nothing in the art
pipeline is generated by a model any more. That is the point.

---

## Part 5: What it costs in money

**Zero.**

- The generator is Python and Pillow.
- Fonts are the one download worth making, and the ones named in the round
  one sheet are all SIL Open Font License, which permits self-hosting a
  woff2 in the web build. The shell currently asks for `system-ui`, so the
  game looks like whatever operating system it runs on, and two self-hosted
  faces change the read of every screen for the price of two files.
- No pack, no subscription, no GPU, no image-model credits.

The one line item that might still be worth money someday is a commissioned
character set, and Muted Line pushes that decision much further out than
any other direction would have, because the parametric build already gives
skin, hair, clothing and proportion variety without a modelling pipeline.

Audio is the remaining place where free third-party assets matter, and it
is out of scope here.

---

## Part 6: The order to build it in

The order is not arbitrary. Ambient light comes before circadian sleep
because tuning a sleep curve you cannot see is guesswork.

| # | Work | Current state | Why here | Rough |
|---|---|---|---|---|
| 1 | [ML-gen] port the generator, keep the atlas contract | Shipped | Everything downstream is the new art | ~2 days |
| 2 | [ML-ci] regenerate-and-diff in CI | Shipped | Cheapest while the generator is fresh | ~half day |
| 3 | [ML-sprites] atlas table to a storage buffer | Shipped | Before the sprite count grows past 128 | ~half day |
| 4 | [ML-ambient] tier 1 ambient tint | Shipped | Day/night visible for half a day's work | ~half day |
| 5 | [ML-curve] [ML-tag] [ML-chrono] [ML-wake] circadian sleep | Mechanism shipped; curve off pending item 9 | Now tunable against something you can see | ~3 days |
| 6 | [ML-tint] per-instance tint | Shipped | Unlocks emissives, sim colour and [G4] | ~2 days |
| 7 | [ML-pools] pools and cast shadows | Shipped | Needs 6 | ~2 days |
| 8 | [B7] walls on tile edges | Open | The picket-fence read; independent of the rest | ~3 days |
| 9 | [ML-feel] measured seven-day run | Open | Nothing above counts until this is watched | ~1 day |

Roughly three weeks of evenings, no purchases, and playable at every step
after item 4.

## What this plan does not cover

Animation and facings. When this plan was authored, the single sim pose was
unchanged by all of the above and the broad `EATING` activity still covered
showers, television, and reading. Mapping it to a pose would have confidently
animated the wrong fiction. Muted Line's parametric character made the missing
system cheaper rather than solving it: a facing is another draw of the same
parts in a different arrangement, not new art.

Status update, 2026-08-06: conversation now supplies the first honest slice of
that missing system. Its authored visual contract names talk, partner anchor,
and facing rule; twenty-four appended character frames cover two poses, four
lot-axis facings, and three stable looks. Generic object activity remains
deliberately unmapped. See
`docs/specs/2026-08-06-conversation-action-animation.md`.

Status correction, 2026-08-08: authored snack and terminal dinner now own
activity code 3 and their exact eating art. Generic object use moved to the
append-only activity code 7, with player-facing text and no vague bubble. The
historical warning above remains the reason broad activity never selects art.
