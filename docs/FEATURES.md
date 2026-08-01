# Features

Status: M0 through M1c shipped; the alpha visual pass (A1-A5) shipped;
M2a footprints, M2a2 selection and input, M2b the five-room house, M2c
personalities and the household, and M2d relationships all shipped. Of
the A-11 visibility pass, PR 1 (the house looks right) and PR 2
(activity indicator bubbles, the ?debug=1 stats overlay, and the
right-click "Chat" talk command; see
docs/specs/2026-07-31-visibility-and-talk-design.md) are shipped;
PR 3 (camera reflow and wheel zoom) is next. The full alpha's eleven DONE criteria live in
docs/alpha-goals.md.
Everything else is
proposed scope, not yet agreed in detail. Milestones exist primarily to
control [R6], which is the risk most likely to actually kill this project.

**M1b closed with one item of its deliverable unmet, deliberately recorded
rather than quietly ticked.** Every definition-of-done line passes, and the
play session that is the milestone's actual payoff was run and written up -
but *instrumented* rather than watched, because the agent-driven browser
never composited a frame ([L14] once more). So the game's behaviour under
player control is measured and the game's *appearance* is not.

**Both visual complaints named here have since been fixed**, in the alpha pass
that followed:

- wall panels that could not sit flush have been, by switching to the kit's
  `wallHalf` piece and by correcting `TILE_HALF_HEIGHT` from 16 to 21 to match
  the ground-plane slope the art was actually drawn at;
- a sim standing on furniture rather than beside it is fixed by
  `TileGrid::find_path_adjacent`, and that was a movement bug wearing a
  rendering costume.

What remains unmet is narrower than it was: **nobody has judged how the game
looks.** The geometry is verified - flush wall runs, seamless floor, the atlas
matching its manifest - by reading pixels back off a canvas that draws but never
presents. Whether the room reads as a room is still unexamined.
`docs/alpha-feel-notes.md` [A-5] carries the distinction, and [A-6] records a
new one found on the way: objects have no footprint, so a sofa drawn 2.4 tiles
wide still occupies one.

The rule: **each milestone must end in something playable.** No milestone is
allowed to be pure infrastructure with a payoff deferred to the next one.

## v1 scope = M0 through M4

### M0 - Walking skeleton - COMPLETE

The most important milestone, because it de-risks the entire toolchain and
[R1] before any content exists.

One lot. One sim. One smart object. The sim's hunger decays, it paths to the
fridge, it eats, hunger recovers. Rendered isometrically in the browser.

- Rust sim core compiling to `wasm32`, running under `cargo test` natively
- `bevy_ecs` world with need, position, and interaction components
- Fixed 10 Hz tick loop with render interpolation ([D2])
- Zero-copy typed-array bridge into a WebGPU renderer ([D11])
- One instanced draw call, one texture atlas
- Tile grid plus single-room pathfinding
- Determinism test in CI from day one ([D12])

**Exit criterion:** sustained 16.6ms frame time (60fps) with 1,000 idle
entities on screen, measured in CI on a mid-range target machine. If the bridge
is going to be a problem, it must surface here and not in M3.

**Exit criterion met, by a wide margin, and measured in a visible browser
rather than inferred.** 1,002 entities at 1280x720 in a release build:
7,202 rAF frames in 60.02 s - a sustained 120 fps with no dropped frames -
mean 0.261 ms, p95 0.33 ms, max 0.805 ms, and **zero frames over 16.6 ms**.
One draw call and one queue submit per frame. Read [L19] before quoting any
of those numbers: an earlier hidden-tab harness reported a p95 five times
better *and* five times less meaningful, because driving frames flat out
sampled the tick frames out of the percentile. The headline number is the
visible-browser one for that reason. Full detail in `docs/gpu-verification.md`.

The one deliberate deviation from the list above: **M0 shipped no texture
atlas.** Sprites were flat-coloured instanced quads. The atlas was treated as a
content problem rather than an architecture one, and [D10]'s one-draw-call claim
was measured without it.

That was the right call for M0's exit gate and the wrong shape for M1b's, whose
deliverable is a play session rather than a number. **M1b Task 3c added the
atlas**: one CC0 texture, twelve sprites, the object-to-sprite mapping in
`content/objects.toml` rather than in the shell, and the floor and walls drawn
from the lot. The single instanced draw survived it - measured at
`instanceCount` 499 with one `draw` and one `submit` per frame, in
`docs/gpu-verification.md` [V14].

### M1a - Content pipeline - COMPLETE

Not in the original milestone list. Split out of M1 once it became clear that
authoring traits, moodlets and forty smart objects against Rust literals would
mean rewriting all of them when the content pipeline landed. Almost nothing
here is player-visible.

- **`Hunger(f32)` became `Needs([f32; 7])`** indexed by a `NeedId` enum, so all
  seven M1 needs exist and decay ([D6] scoring already sums over a sparse
  advert, so nothing had to change to feel more than one need)
- **`SmartObject` stopped naming a need** and became `SmartObject(ObjectDefId)`,
  an index into a content pack
- **New `terri-data` crate**: TOML schema, validation, and a `postcard`-encoded
  pack. Its `build.rs` compiles `content/*.toml` at build time and **aborts the
  build** on invalid content, which is [D9]'s dangling-reference guarantee
  working rather than planned
- **Decay rates and advertised deltas are content**, not constants. The fridge
  is a row in `content/objects.toml`
- **The WASM boundary spawns by content string id** (`spawn_object(x, y,
  "fridge")`), returning `false` for an unknown id rather than panicking

**Exit criterion:** a hungry sim still paths to the fridge and eats, and the
world hash moves only where the milestone intended it to. Met, and the second
half is worth stating precisely rather than as "behaviour is unchanged",
because the digest did move - twice, both times for a declared reason:

| Moved by | To | Why |
|---|---|---|
| Task 2 | `0x6C3757F1848175C1` | `world_hash` went from one need level per row to seven. A shape change, done once and deliberately early, so later needs coming alive would cost no further vector updates |
| Task 7 | `0x2FC669EFA7254F2D` | The other six needs started decaying, so they hold different values after 100 ticks |

Task 6, which moved the fridge itself out of Rust and into TOML, left the
vector **unmoved** - that is the reading which says the port changed no
behaviour. Every move was observed on native and on wasm32 separately rather
than assumed equal, once in a real browser ([L13]).

### M1c - Probabilistic behaviour - COMPLETE

Argmax selection made a sim read as a robot working down a priority list:
given the same state it always did the same thing, in the same order, and the
seams showed immediately. M1c makes urgency raise the *probability* that a
need is served next without making it certain.

- **`content/tuning.toml`**, the single home for every knob governing the
  system rather than a piece of content. `ACTION_THRESHOLD` and the seven need
  decay rates moved into it; the standing rule is that new tunables go there
  rather than into a Rust `const`. Build-validated like every other content
  file
- **Softmax-weighted selection** at a temperature read from tuning, with the
  max subtracted before exponentiating so a large score cannot overflow to
  `NaN` and silently stop a sim choosing anything forever
- **An in-repo seeded PCG** held as a world resource, rather than `rand`,
  because `rand` does not guarantee bit-identical algorithms across major
  versions and a routine bump would move every replay and golden hash with no
  way to tell that from a regression
- **Objects sorted before sampling.** Under argmax the score tie-break made
  iteration order irrelevant; under weighted sampling the order sets the
  cumulative-probability bucket boundaries, so archetype layout would have
  decided outcomes
- **Interaction durations sampled** around their content value, biased shorter,
  floored at a real-time minimum
- **Idle wandering** through the same intent path as any other action, so it
  stays overridable and reproducible

**Exit criterion:** the sim stops reading as a robot, judged by watching it
rather than by a test - no test can answer it. **Met, with two caveats that are
written down rather than smoothed over**, in `docs/alpha-feel-notes.md`:

- It does not dither, and structurally cannot, because `select_action` skips
  any sim that already holds a `Target`. It **over-commits** instead, which
  will read as obliviousness once anything in the balance becomes urgent.
- The self-regulating half of the design - desperate sims decisive, comfortable
  ones whimsical - is real in the code and **never reached in the shipped lot**,
  because with eight objects on a 14 x 10 lot no need ever gets low enough to
  produce a large score gap. That is a content problem, and raising
  `action_threshold` was tried and measured worse.

Three knobs were retuned against a measured behaviour trace rather than by
taste: `choice_temperature` 0.15 to 0.06, `idle_threshold` 0.02 to 0.04, and
`min_interaction_ticks` 25 to 12. The largest single finding is that the
interaction floor was above the *entire* sampled band of the three most-used
objects, so 61% of interactions ran for exactly the floor with no variance at
all and delivered up to three times their advertised benefit - the fridge gave
67 hunger instead of 40. A floor that binds is a duration, not a floor.

Frames were confirmed in a real, visible Chrome on the production build rather
than assumed: 7,859 draw calls and 7,859 submits in 91.4 s at `instanceCount`
182, `visibilityState` `visible`. See [L14] for why that sentence is necessary.

### M1 - Core loop

The point at which it starts being a game. M1a above is the first slice of
this milestone and is done; what follows is M1b onwards.

- ~~**Needs:** hunger, energy, hygiene, bladder, social, fun, comfort~~ - done
  in M1a. All seven exist and decay at content-declared rates. Only decay: the
  *behaviour* each need drives beyond scoring an advert is still M1b
- **Moods and moodlets** derived from needs, traits, and environment
- **Traits:** ~15 to start, affecting utility scoring ([D6])
- **Smart object library:** ~40 objects across the core need categories
- **Build mode:** walls, floors, doors, windows, roofs
- **Buy mode:** catalog, placement, rotation, palette recolors ([G4])
- **Create-a-sim:** body type, face, hair, clothing, trait selection
- **Household** of up to ~6 sims
- **Save/load** with schema versioning from the first commit ([D8])
- **Time controls:** pause, 1x, 2x, 3x, implemented as tick multipliers ([D2])

### M2 - Life

What makes it a *life* sim rather than a needs sim.

- **Life stages:** baby, toddler, child, teen, adult, elder, with aging
- **Relationships:** friendship and romance axes, sparse storage capped ~150/sim
- **Skills:** learned through interaction, gating better outcomes
- **Careers:** rabbit-hole model for the beta - the sim leaves the lot and
  returns with an outcome. **Simulated workplaces are a near-term post-v1
  goal and are architected for now** ([D15]); careers are expected to be
  critical to the production version, so the rabbit hole is the Tier 2
  implementation of a real system rather than a throwaway.
- **Pregnancy, birth, genetics** for inherited appearance and traits
- **Death** from several causes, each with distinct fiction and consequence

Death is load-bearing here rather than a fail state, because M4 depends on it.

### M3 - Town

Where the architecture in [D3] earns its keep.

- Multiple lots, a neighborhood map, lot loading and unloading
- **Tier 1** coarse simulation for adjacent lots
- **Tier 2** story progression for the rest of town ([D3])
- Autonomous NPC households living their own lives
- Visiting other lots, community venues
- Town-wide events and a calendar

**Exit criterion:** ~1,000 simulated sims town-wide at sustained 16.6ms frame
time, under 500MB total memory, plus a Tier 2 to Tier 0 promotion that yields
plausible state ([R3]).

### M4 - Ghosts (Layer 1 multiplayer)

The signature feature, and asynchronous throughout, so no clock coupling.

- **Ghost Record** export on death: identity, appearance, traits, life events,
  cause of death, skills, unfinished business ([D13])
- Sync service and import into other players' towns ([D14])
- Ghosts **haunt** locations, appear as apparitions, leave traces
- Ghosts **teach skills** posthumously, the asymmetric-capability hook that
  gives players a real reason to engage with each other's content
- **Unfinished business** as resolvable quest hooks with rewards
- **Heirlooms** left behind as tangible objects
- Deterministic staging-queue injection at day boundaries ([D13])
- **Report, ban, and purge shipped before sync goes live** ([R7]). Report-driven
  and retroactive, not filter-based: chat/text logging attributable to a player
  ID, an in-context report action, an operator ban tool, and purge of a banned
  player's already-distributed records.

**The game remains fully playable offline. Ghosts are strictly additive.**

M4 also has non-code prerequisites that take longer than expected and block
launch rather than development: a privacy policy [T14], published moderation
rules [T15], and storage plus upload identity [T16]. See TIM-TODO.md.

## Explicitly out of scope for v1

Listed so the boundary is a decision rather than a drift. Each is designed for
in ARCHITECTURE.md but deliberately unbuilt.

| Feature | Why deferred |
|---|---|
| **Layer 2 synchronous multiplayer** | Needs netcode plus a time-authority model. Determinism keeps it viable; nothing else is needed yet. |
| **Real-world-calendar festivals** | Depends on Layer 2 |
| **Shared civic projects** | Depends on a backend beyond content sync |
| **Cross-player economy** | Depends on trust and moderation infrastructure |
| **Player-built house sharing** | Valuable and cheap-ish, but M4 is the higher-value use of the same sync plumbing |
| **Native desktop build** | Shell swap, deferred by choice, not blocked |
| **Pets, weather, seasons, vehicles** | Classic expansion-pack material |
| **Simulated workplaces** | **Near-term post-v1, not deferred indefinitely.** Rabbit holes in M2 are the Tier 2 implementation; [D15] specifies what v1 must get right so this drops in cleanly |

## Design tone

**Agreed:** dark comedy, pitched between subtle and moderate. Not the warm
optimism of The Sims. Deaths are varied and blackly funny, unfinished business
is petty as often as it is poignant, and the ghost layer reads more wry than
mournful.

**The register is absurdist satire of institutions** - global and particularly
American political absurdity, as though the stories in The Onion were simply
how the world worked inside the game. Bureaucracy that defeats itself, news
that covers nothing at enormous length, workplaces with sincerely deranged
policies.

### Craft guidance (recommendation, not yet a hard rule)

Two failure modes to design against, because both are expensive to fix once a
content library exists:

**Satirize institutional *form*, not named people or parties.** This is the
actual mechanism behind why The Onion works: the joke is the shape of the
institution and the deadpan delivery, not the target's name. A city council
that renames the same park fourteen times, a news channel covering a missing
spoon for six weeks, a performance review conducted by a horse, a mandatory
wellness seminar that leaves everyone measurably less well. This is funnier,
and it does not require the player to share your politics to laugh.

**Prefer evergreen absurdity over current events.** Content pinned to specific
2026 events will read as stale by 2029 and confusing by 2032. Institutional
absurdity is perennial; news cycles are not.

Neither rule is about being timid. Subtle and structural is a sharper knife
than explicit and topical, and it keeps the audience twice as large.

Tone should be locked before serious content authoring begins in M1.
