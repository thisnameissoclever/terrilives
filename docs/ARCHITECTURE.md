# Architecture

Status: implemented through the playable-alpha systems. Later-scale sections
for multiple lots, synchronous multiplayer, ghosts, and backend services remain
architectural commitments rather than shipped features. Each section says what
exists and what is still planned. Section IDs are stable and are referenced
from other docs and from discussion. Do not renumber them.

## Summary of decisions

| Decision | Choice |
|---|---|
| Genre | Life simulation, Sims/Paralives lineage |
| Concept | Standard life sim core; dead sims become ghosts in other players' towns |
| Presentation | 2.5D, fixed isometric camera |
| Simulation core | Rust, compiled to `wasm32` and native from one source |
| Shell (first) | TypeScript + WebGPU renderer, DOM-based UI |
| Shell (later) | Native desktop, as a shell swap rather than a rewrite |
| Scale target | "Town" tier: ~1k-5k sims, ~100k objects |
| Multiplayer v1 | Layer 1 only (asynchronous, no time coupling) |
| Multiplayer later | Layer 2 (synchronous sessions), designed for but not built |

## Core principles

These hold regardless of engine or language, and most of the performance story
lives here rather than in the stack choice.

**[A1] The simulation core is a pure library with zero engine types in it.**
The shell is renderer, input, and audio; the sim knows nothing about it. This
makes the sim unit-testable without launching a game, allows headless runs at
1000x speed for balance work, and reduces an engine swap to a shell rewrite.
If the sim cannot run under `cargo test`, the boundary has already leaked.

**[A2] ECS with struct-of-arrays storage.** Entities are IDs, components are
flat contiguous arrays, systems sweep them linearly. Cache locality is why
10k entities can cost less than 500 pointer-chasing OOP objects.

**[A3] Tiered simulation LOD.** The single largest performance lever, larger
than all others combined. See [D3].

**[A4] Fixed-timestep simulation, decoupled render with interpolation.**

**[A5] Determinism.** Seeded RNG, stable iteration order, no wall-clock reads
inside sim code. Buys replayable bug reports, cheap saves, and keeps Layer 2
multiplayer viable.

**[A6] Smart objects: advertisement-based utility AI.** See [D6].

**[A7] Uniform spatial grid for neighbor queries.** A tile-based world makes
this O(1). Feeds both [D6] and [D7].

**[A8] Hierarchical pathfinding.** Full-map A* per agent per repath is the
classic thing that kills simulation games. See [D7].

**[A9] Job system for parallelism.** Need decay, utility scoring, and path
requests are embarrassingly parallel across agents.

**[A10] Fully data-driven content.** A life sim's depth is its content volume.
This is a content engine with a game attached, not the reverse.

**[A11] Instancing, atlasing, and aggressive culling on the render side.**
Largely orthogonal to [A1]-[A10], and where "very large number of assets" is
actually won or lost.

## [D1] Repository layout

The load-bearing rule: **`terri-core`, `terri-data` and `terri-sim` contain zero
`wasm-bindgen` and zero `web-sys`.** They compile natively and run under
`cargo test` at full speed. The CI job of the same name checks all three
against explicit targets; see [L4] for why the targets are named.

```
crates/
  terri-core/     ECS wiring, world types, time, stable save DTOs. No I/O.
  terri-data/     Content schema, validation, compiled pack (serde). No
                  runtime I/O: its build.rs reads content/ at build time
                  and the pack ships as embedded bytes.
  terri-sim/      Simulation systems, save validation and restore. No I/O.
  terri-ghost/    (later) Ghost record export/import. No network I/O.
  terri-wasm/     wasm-bindgen boundary. The ONLY crate that knows JS exists.
  terri-native/   (later) native shell entry point.
web/src/
  render/         WebGPU renderer
  ui/             DOM UI
  bridge.ts       Typed-array views into WASM memory
  storage/        Browser-owned OPFS worker and serialized save operations
  net/            (later) Ghost sync client. The ONLY network I/O location.
content/          Data files: objects, traits, careers, interactions
```

## [D2] Tick model

**Simulation runs at a fixed 10 Hz. One tick advances one sim-minute at 1x
speed.** A sim-hour is therefore 6 real seconds, roughly Sims pacing. Render
runs at display refresh and interpolates entity positions between the last two
simulation ticks.

**Speed controls run more ticks per frame. They never change `dt`.** Speed 3
means three ticks per rendered frame. Variable `dt` would destroy determinism
and take Layer 2 multiplayer with it. Cheap to honor now, near-impossible to
retrofit.

**The multiplier lives in the shell's `FixedStepDriver`, not in the
simulation.** Speed is a rate at which the shell asks for full steps, not a
property of the world. A paused frame runs only the command-drain schedule so
selection and order controls remain responsive. The clock, needs, autonomy,
movement, and interactions do not advance. Unpausing changes the driver
immediately; its serialised speed command drains at the next full tick. Speed
still crosses the boundary as a command so the command log can replay a
session's pauses ([D-2] in the M1b design), and the simulation deliberately
applies nothing for it.

Blocking shell surfaces are a separate case. Help and persistence
confirmations temporarily set only the `FixedStepDriver` to zero, remember the
player's selected speed, and restore it after the final modal owner releases.
They do not enqueue `SetSpeed(0)`: time spent reading browser UI is outside the
simulation and must not become replay input. A confirmed Load keeps this
suspension through its storage read and transactional world swap; New game
keeps it through clear and reload. See
`docs/specs/2026-08-01-modal-pause-and-focus-design.md`.

A terminal startup failure owns a different boundary: there is no running
simulation to pause or opener to restore. The shell exposes the explanation as
a focused `alertdialog` and makes every body child left by partial startup
inert. Any native modal already in the browser's top layer is closed first, so
it cannot paint above or keep the terminal explanation unfocusable. The failed
canvas and HUD therefore cannot remain a second keyboard interface behind the
only useful surface.

At 600 CSS pixels or narrower, or 480 CSS pixels or shorter, the shell starts
with a safe-area-aware status strip containing Time, Funds, and Menu. The
roster, details, speed, and game actions are removed from layout until Menu is
opened. `MobileHud` owns only that responsive visibility state and closes the
two detail elements when the viewport first becomes compact. Existing DOM
nodes and controllers continue to own every game action, projection, label,
and focus target.

Phone portrait expands into a contiguous top sheet. Needs and People
independently cap and scroll their content, and the outer sheet scrolls if its
children exceed the viewport. Short screens wider than 360 pixels use the
established 220-pixel edge column, leaving the rest of the viewport as a direct
hit surface for the WebGPU canvas. Narrower short screens keep the horizontal
top strip. Desktop keeps the normal sidebar and does not render the Menu
button. See [CH1]-[CH4].

Because the two are so easy to confuse, the driver exposes `stepDurationMs`
purely so the constraint is testable: scaling elapsed time by `k` and dividing
the step by `k` produce identical tick counts and identical interpolation
alphas, so a step count cannot tell [D2] from its violation. See [L44].

## [D3] Simulation LOD tiers

The alpha runs one active lot at Tier 0. Tier 1, Tier 2, promotion, and
multi-lot population management below are scale architecture, not implemented
runtime modes.

| Tier | Population | Cadence | What runs |
|---|---|---|---|
| **0 Active** | Active lot plus on-camera, budget ~40 agents | Every tick | Everything |
| **1 Nearby** | Loaded adjacent lots | Every 10th tick | No animation; portal-graph pathing only |
| **2 Story** | Everyone else | Once per sim-hour | No ECS systems; closed-form updates |

Tier 2 is what makes the scale target reachable. Those sims do not step.
Needs resolve toward an equilibrium implied by household wealth, job, and
traits. Careers advance by expected value. Relationships decay on a curve.
Life events roll on a weighted table. Cost becomes O(what the player is
looking at) rather than O(world size).

**Promotion requirement:** Tier 2 to Tier 0 promotion must yield a *plausible*
state. Visiting a household unseen for three sim-years must produce coherent
needs, positions, and relationships. The Tier 2 model therefore emits the same
state shape Tier 0 consumes, and the two are designed together rather than
reconciled later. Tracked as [R3].

## [D4] ECS choice

**`bevy_ecs` is used as a standalone crate**, without the rest of Bevy. The
playable alpha explicitly configures `ExecutorKind::SingleThreaded` and chains
every full-tick system in one deterministic order. The scheduler can derive
parallelism from declared component access, but [A9] remains a scale plan rather
than shipped behavior.

**Determinism caveat.** A parallel scheduler is a determinism hazard, and
archetypal iteration order shifts as archetypes change. The enforced rule:

> **Parallel systems must be commutative.** Each entity's update reads only its
> own components plus immutable shared state. Anything genuinely contended
> (two sims reaching for one chair) goes through a serialized phase over a
> command buffer sorted by entity ID.

The alpha avoids this hazard by staying single-threaded and verifies replay
determinism in [D12]. Any future parallel schedule must first enforce the rule
above and keep the same deterministic evidence. Tracked as [R2].

## [D5] Tick pipeline

The shipped full tick is serialized in this exact order. Several operations
that the scale design originally separated, such as reservation and path solve,
currently happen inside the action or wander system that requests them.

0. `drain_commands` - apply every queued player command, in the order the
   player issued them ([D-2] of the M1b design). It is **first**, and both
   halves of that matter: player input is asynchronous, so it has to land through one
   serialized system so a future recorded command log can replay to the same
   world; and an intent pushed here has to be servable by step 4 on the same
   tick, or a click would take a tick to have any effect and the sim would
   spend that tick choosing for itself. Entity references arrive from JavaScript as raw
   `u32` indices, so resolution tolerates a stale one - a panic here traps
   the WASM module for the rest of the page's life.

When paused, the shell runs step 0 by itself once per rendered frame. It uses
the same queue and the same `drain_commands` system as a full tick; steps 1
through 15 do not run. This keeps input alive without creating a second
mutation path or allowing simulation time to leak through pause. The drain is
associative across batch boundaries: splitting an ordered command stream across
two rendered frames produces the same saved world as draining it in one batch.

1. `advance_clock` - advance the day clock.
2. `decay_needs` - apply content-defined need decay.
3. `start_shift` - begin a scheduled career commute after the clock advances.
4. `serve_intents` - turn each directed sim's front player-issued intent
    into a target ([D-3] of the M1b design). Serialized because it claims
    object slots, and it sits BEFORE selection because a directed action
    overrides autonomy rather than competing with it. It is the one step that
    sees sims which are already walking or already mid-interaction: a player
    intent **preempts** a running interaction rather than queueing behind it,
    since a sim asleep for 24 seconds would otherwise leave a click with no
    visible response for the whole of it.
5. `select_action` - pick the winning interaction, **for sims with no queued
    intent**. That filter is what makes a directed action beat autonomy.
6. `advance_chains` - resume or begin the next station in a multi-step action.
7. `wander` - a sim whose best option scores below `idle_threshold`
    walks to a random reachable LOCAL tile instead of standing still ([D-5] of
    the M1c design and [LW2] of the local-wandering spec). Both the endpoint's
    Manhattan distance and the actual A* path are capped by
    `wander_radius_tiles`, so a nearby tile behind a wall cannot become a
    cross-house detour. Failed candidates consume one of the bounded
    `wander_attempts`; the system never widens the search to the whole lot. It
    draws x then y from the shared PRNG after useful choices have failed and
    processes sims in entity-index order before those draws.
8. `follow_path` - move one deterministic step along the chosen path.
9. `commute_and_work` - clock in at the door, run the shift, pay, and return.
10. `tick_interactions` - advance ordinary object interactions and need deltas.
11. `tick_chain_steps` - advance station work and terminal-only chain payoff.
12. `tick_social` - advance conversations and directional relationships.
13. `decay_habituation` - cool repeated-object memory.
14. `decay_relationships` - apply directional relationship decay.
15. `bleed_neglect` - reduce satisfaction when needs remain neglected.

Mood is currently derived when the HUD asks rather than stored or scheduled,
so Save V1 cannot restore a stale display value. Parallel advertisement scans,
a fixed per-tick path budget with an overflow queue, ghost injection, an event
dispatch phase, and Tier 2 story progression remain future scale work. The path
budget still matters when population grows: bounded work produces a harmless
one-tick wait instead of an unbounded hitch.

## [D6] Smart objects

Objects advertise what they satisfy; agents score the advertisements.

Built in M1a. This is the shape `content/objects.toml` actually takes, and
`crates/terri-data/src/schema.rs` is the authority on it:

```toml
[[object]]
id   = "fridge"
name = "Chill-o-Matic 3000"

  [[object.interaction]]
  id             = "grab_snack"
  advertises     = { hunger = 40.0 }
  duration_ticks = 15
  slots          = 1
```

Three differences from the sketch this section used to carry, each a decision
rather than a simplification. **Duration is in ticks, not a `"15min"` string:**
a tick is a sim-minute ([D2]) so the two are the same number, and parsing a
duration grammar buys nothing while adding a way for content to be wrong.
**Need names are lower-case and match `NeedId::as_str`,** which is what the
build-time check in [D9] validates against. The original `trait_mods` sketch was
replaced by the shipped trait-definition system in `content/traits.toml`.
**`requires` is not implemented yet** - adding that field before anything reads
it would mean content that validates and lies.

Agent scoring (`crates/terri-sim/src/systems/advertise.rs`) weights each
advertised delta by the agent's current deficit on a **steeply nonlinear
curve** - the deficit is **cubed**, so a sim at 5% hunger wants food about 13x
more than one at 60%, not 2.4x - and divides by travel plus duration cost. An
advert is a sparse list of (need, delta) pairs and each pair is scored
separately before summing, so an object satisfying two needs modestly can beat
one satisfying a single need slightly better. Trait modifiers and weighted
selection are now shipped: `select_action` samples the sorted candidates with
softmax weights derived from `exp(score / choice_temperature)`. A low content
temperature approaches argmax while a higher temperature permits plausible
variation, and the simulation RNG makes the draw deterministic for a fixed seed.

Two properties matter. Adding content means adding a data file rather than
touching AI code, so a modder's new object is used correctly on day one. And
cost is bounded by the spatial query in [A7], not by world size.

The first is now literally true: the fridge is a row in a TOML file, and
nothing outside `content/` and the test fixtures names it at all - M1b's
`Sim::new_from_lot` reads `content/lot.toml` and spawns whatever it says, so
even the placement is content. No simulation code knows the word. **The second
is still a design claim.** `select_action` scans **every** object every
tick; [A7]'s uniform grid is not built, and until it is, selection is
O(agents x objects). That is fine at M1's one lot and is exactly the thing
[D3]'s scale target breaks, so it is tracked as work for M3 rather than as a
property the code already has.

Reserved objects are scanned rather than filtered out because an agent has to be
able to SEE a thing somebody else is using, or it cannot tell "beaten to it"
from "nothing here at all" - and it was getting the second answer ([C3]). It
still cannot be given one: a contested object is scored but never enters the
draw. What the agent does about it is `contested_score_multiplier`, which
attenuates the score a contested object contributes, so a sim that badly wants
the thing stands and waits while one that barely wants it strolls off. The
`Blocked` marker records that an agent's best option is somebody else's; it can
be set alongside `Restless`, and that pair means "wanted it, not enough to
wait". The simulation projects those markers through `stall_reason_of`, and the
normal selected-person HUD reads the result as the reason a sim is standing
still. A local wander for blocked sims remains a possible future behavior
change, not an unbuilt reader required for the marker to matter. See [L56] for
how this arrived twice.

The cost is one extra path search per reserved object per idle agent per tick,
which is nothing at eight objects and is part of what the M3 work above has to
address.

**The travel term is wall-aware, and that is a commitment rather than an
implementation detail.** M0 measured a straight line, which was fine in a
single open room and became wrong the moment M1b's lot grew a walled bathroom:
a sim scored the shower as one tile away through its wall and then walked round
to the door, so its ranking disagreed with its own movement. Selection now
costs travel at the **A\* path length**, so ranking and pathing measure the
same thing. The implementation is expected to change - [D7]'s room graph is
the plan at scale, and the same `O(agents x objects)` sentence above is what
will force it - but a room-graph length is wall-aware too, so balance tuned
against A\* length survives that swap. Balance tuned against a straight line
would survive neither, which is why the metric is the part written down here.
An object with **no** path is unavailable rather than free: it is skipped, and
the agent takes the best object it can actually reach.

This is roughly 200 lines of code and it is the entire personality of the game.

## [D7] Pathfinding

The current one-lot alpha uses deterministic tile-grid A* over the complete
static lot. The room graph and lazy segment plan below is not built yet; it is
the route from that working alpha solver to the population targets in [D3].

At scale, rooms are graph nodes, doors and
portals are edges; the graph is rebuilt on wall change. A path is A* over the
room graph, with **tile-level A* solved lazily per room segment as the agent
enters it**. Never a full-lot solve.

Agents are soft obstacles with simple steering and a repath after N blocked
ticks. No RVO or ORCA; it is overkill at indoor simulation pacing. Tier 1
agents skip tile A* entirely and slide along the room graph.

## [D8] Save model

**Implemented in M2g as a complete versioned snapshot.** The snapshot stores
the clock, funds, allocator, complete random-number-generator state, command
queue, grid, every live entity and every component needed to continue the
next tick. Loading validates into a fresh world and swaps only after the
candidate is complete, so corrupt bytes cannot half-mutate a running game.

The earlier snapshot-plus-command-log design remains a future compaction
option, not the current format. Version 1 deliberately chooses the smaller
failure surface: one complete snapshot whose continuation is directly tested.

Storage is **OPFS** (Origin Private File System), not `localStorage` - real
file handles from a worker with no meaningful quota ceiling.

The worker queue serializes file I/O, but the player operation begins one layer
higher. `PersistenceController` exclusively owns Save, Load, or clear before it
captures simulation bytes and until any loaded world has been applied. During
that interval the three persistence controls are disabled and autosave waits.
Serializing only the worker calls would leave snapshot capture outside the
lock, allowing Load or New game to finish and then be overwritten by older
intent queued behind them.

The raw prefix is `TERRISAV` plus a little-endian schema version. Version 1
also stores a content-compatibility digest. It observes numeric meanings the
snapshot cannot validate by authored string id, including interaction and
flyout row order, social order, chain step structure, object station-role
mappings, footprints, trait state kind, and the current-content front door a
restored career still follows. Missing object, career, trait, chain, and
carried-item ids are validated directly. Known fingerprints from the retired
full-pack algorithm map only to the exact reviewed replacement shape; they do
not bypass normal snapshot validation. The one shipped household rename is
also gated by that legacy match rather than by a name string alone. The next
incompatible wire shape must bump the version and make an explicit migration
decision.

The aquarium and exercise-bike slice adds a narrower second migration class.
It turns two formerly inert definitions into interactive objects while keeping
their persistence IDs, placements, one-tile footprints, and
therefore every old saved entity and blocked-grid bit unchanged. The previous
structural digest may enter only that exact reviewed current digest. It is not
a retired full-pack fingerprint and must not trigger the historical household
rename. A fingerprint exception does not reconstruct entities or collision;
this bridge is safe precisely because neither needs reconstruction. Object
declaration order remains free because snapshots store authored string IDs.
Before current-pack validation, every accepted pre-feature fingerprint is
classified by provenance. Row zero on either formerly inert object is
impossible in those source shapes, so `Target`, `Eating`, `Intent`, queued
`UseObject`, `Habituation`, and Personality disposition references to either
new action fail before reconstruction. The same rule covers the prior
structural digest and all four retired full-pack digests; accepting an old
fingerprint does not grant that snapshot rows it could never have authored.

## [D9] Content pipeline

Content is authored in TOML and compiled to a validated binary pack at build
time. **Built in M1a**, apart from hot reload, which is M1e.

`content/needs.toml`, `content/objects.toml`, `content/lot.toml` and
`content/tuning.toml` are the authored sources, plus the generated
`assets/sprites/atlas.toml`, which is an input here so that "this object names
a sprite the atlas holds" is a build failure rather than a blank quad.
`crates/terri-data/build.rs` parses them with `serde`/`toml`, runs the
validation below, encodes the result with `postcard`, and writes
`$OUT_DIR/content_pack.postcard`. `lib.rs` embeds those bytes with
`include_bytes!` and deserialises them once behind a `OnceLock`. So there is
**no runtime content I/O on any target** - which is what lets [D1] hold for a
crate whose whole job is reading data files, and what makes the pack available
under `wasm32` at all.

`build.rs` pulls the validator in with `#[path]` rather than depending on the
library, so one copy of `compile.rs` is both the build-time gate and a
unit-testable function. That is why the validation rules have direct tests
instead of only being observable as build failures.

The build **fails on dangling references and on content that is merely
nonsense**, with the message naming the offending id:

- a need name `NeedId::from_name` does not know
- a `NeedId` variant missing from `needs.toml`, or declared twice
- a need `needs.toml` declares that `tuning.toml`'s `[decay_per_tick]` gives no
  rate for, or a rate for a need nothing declares. The two files answer
  different questions - which needs exist, and how fast the simulation drains
  them - and the build fails unless they agree
- a duplicate object or interaction id
- a zero `duration_ticks` (an interaction that finishes before it starts) or
  zero `slots`
- an incomplete or unknown interaction or chain-step `visual` contract, or a
  known action and anchor in a combination the owning social, object, or chain
  step cannot legally resolve
- a non-finite or negative number anywhere
- a missing or incoherent tuning knob: an absent field, a `choice_temperature`
  of zero or below (selection divides by it), a `min_interaction_ticks` of
  zero, a `wander_radius_tiles` outside `1..=i32::MAX`, a
  `duration_variance` outside `[0, 1)`, or an `idle_threshold` above
  `action_threshold`, which would have a sim wander off while something is
  worth doing

**`content/tuning.toml` is the single home for every value that governs the
system**, as opposed to values describing one piece of content, and that is a
standing rule rather than one file's convention: **a new knob goes there rather
than into a Rust `const`.** See [D-1] in the M1c design. The person tuning game
feel iterates, and wants one file to open rather than a hunt through Rust; a
constant buried in a system is a knob nobody finds. `ACTION_THRESHOLD` was the
first migration, from ten places in `select_action`; the seven need decay rates
followed at M1c Task 3, out of `needs.toml`, which now declares only which
needs exist.

Predicates (`requires`) are not yet a content concept, so "an object requiring
an undefined predicate" is still a promise rather than a check. The shipped
trait system uses disposition weights, capability levels, and condition state
instead; a future predicate gate needs its own accepted design.

**Three consequences worth stating, because two of them are not obvious.**
First, this eliminates a category of runtime bug outright: a bad need name is a
failed `cargo build`, not a sim that silently never eats. Second, the pack is
serialised in iteration order and feeds the determinism hash, so every map in
the schema is a `BTreeMap` and the compiled advert list is a sorted `Vec`;
`HashMap` here would surface as a spurious content diff rather than as an
obvious bug (see [L24]). Third, and this one cost real evidence: **the build
gate converts mutants that tests used to catch into mutants that never
compile**, including six in `terri-core` whose methods the validator now calls.
They are still detected, by the build, but an unviable mutant says nothing
about the test suite. See [L21], [L28], and `docs/mutation-baseline.md`.

Mod support then falls out nearly free. A mod is another content pack merged
over the base - not built, and note that merging is the part the current
single-pack `OnceLock` does not anticipate.

## [D10] Renderer

WebGPU. One instanced draw call per texture atlas per layer. Depth comes from
world position via the depth buffer rather than painter's-algorithm sorting; at
100k objects, not sorting beats sorting well. The alpha uploads static geometry
for its one lot. Streaming visible lots in chunks remains future scale work.

The shipped art direction is **Muted Line**, an original procedural isometric
atlas generated from code. The renderer draws three stable baked character
looks and a generated prop vocabulary from that atlas; per-instance tint and
emissive strength carry the day/night treatment without a second draw. See
TECH_STACK.md for the pipeline and the superseded alternatives.

Nighttime pools are a presentation-only tile field built from the render
snapshot. The lamp and television spread neutral emissive strength by four-way
graph distance; walls block the flood, doorway gaps pass it, and static wall
panels sample adjacent floor. Smart-object footprint columns place one-tile
`+x` cast shadows without rebuilding content geometry in TypeScript. Static
floor and wall instances bake the field when the camera block is uploaded;
dynamic rows sample it at their interpolated tile. The field adds no instance,
pipeline, render pass, draw, submit, persisted state, or world-hash input.
Selection remains a semantic overlay: its planted ring uses a full-emissive
pale outer key rather than inheriting the world or local-light tint.

Walking uses append-only visual action 5 and two directional limb frames per
look and facing. Render sync projects a fallback facing from the next path
step, while the shell prefers the actual previous-to-current segment during
interpolation so a corner does not face the next leg early. Travel distance
selects the frame; wall time and render-frame count never participate. The
body, carried item, selection ring, and depth remain on the common planted
world anchor rather than receiving the rejected whole-body lift. This adds no
persisted animation state, bridge column, per-frame allocation, draw call, or
wall-clock phase; pause, speed changes, replay, and Load reproduce the pose
from position. `prefers-reduced-motion: reduce` pins directional frame zero
without disabling travel interpolation.

Conversation is the first authored body animation. The social interaction
declares `talk / partner / toward_anchor`; render sync resolves the actual pair
to opposite lot-axis facings and the shell selects one of two fixed-envelope
Muted Line frames for that look and facing. Simulation tick and stable entity
id choose the frame on an eight-tick hold, never wall time. Reduced motion
keeps frame zero, so the directional action remains legible without ornamental
alternation.

Eating extends the same two-column contract without widening the bridge.
`Grab a snack` declares `eat / object / toward_anchor`; the terminal dinner
chain step declares `eat / station / toward_anchor`. Render sync requires the
exact active interaction or chain step, resolves its exact target object, and
faces toward the centre of that object's authored footprint. Malformed or
unauthored state emits no pose. The shell maps action code 2 to two
fixed-envelope hand-to-mouth frames per look and facing on a sixteen-tick,
stable-id phase. Exact snack eating draws the dedicated sandwich prop and a
valid terminal dinner draws the existing dinner prop; both follow the active
hand side and frame height. An exact authored snack and a valid authored dinner
work step project the existing `EATING` activity so the fork bubble remains visible. A
valid sleep-tagged interaction projects `SLEEPING`. Every other ordinary use
of the legacy shared `Eating` component projects the append-only
`USING_OBJECT` activity code 7. The shell gives that generic state a HUD label
but no indicator sprite because one 26-pixel glyph cannot honestly cover
washing, television, bathing, and toilet use. Generic object
use never selects eating body art.

Seated reading adds an exact object-local action position without widening the
bridge. An object definition may author named action sockets around its rendered
footprint centre; lot compilation rotates each socket with the placement and
stores the resolved absolute position and facing. `Sim::new_from_lot` attaches
those values to the exact placed object in a private presentation-only
component. The public dynamic-object path derives the same data in the default
SE orientation. Save V1 remains unchanged: restore reconstructs authored
placement sockets by exact object and position, or the default orientation for
a non-colliding dynamic object. A dynamic object that exactly collides with an
authored object id and position remains the documented Save V1 identity
boundary.

Only `reading_chair.settle_in` currently authors
`read / object_socket / socket`. Render sync requires matching `Eating` and
`Target` object and interaction identity, the exact target entity, its position,
its socket carrier, and an in-range compiled socket index. A valid match emits
visual action 3, activity 8, the socket facing, and the socket coordinates as the
row's displayed position while leaving ECS `Position` untouched. The shell
selects two seated-reading frames per look and facing on a 24-tick hold.
Conversation and eating keep precedence. Transition tracking uses full ECS
entity identities to reseed both interpolation samples on socket entry and
exit, including paused command refresh and Load, so the body never interpolates
through the chair. The fixed-envelope art keeps the lowered head joined to the
shoulder line rather than exposing the rejected long neck. Malformed or
unauthored state falls back to generic object use.

The aquarium and exercise bike append two more exact object-action contracts
without widening the bridge. `reference_shelf.watch_fish`, whose historical
object id remains a Save V1 persistence key, authors
`watch / object / toward_anchor`. It stays on the adjacent path tile, faces the
aquarium footprint centre, emits visual action 7 and activity 10, and uses a
slow two-pose watching cycle. The aquarium object itself swaps between two
same-envelope generated frames with only the fish moving; reduced motion pins
both object and body frame zero.

`moving_box.use_exercise_bike`, likewise retaining its historical persistence
id, authors `exercise / object_socket / socket`. It reuses the socket
projection and interpolation reseed built for seated reading, emits visual
action 6 and activity 9, and selects two cycling bodies with planted hands and
alternating knees and feet. Conversation and authored eating still outrank
both. Exact target, interaction, object definition, socket, and component
identity remain mandatory, so a broad status or malformed overlap cannot
invent either pose. Both features are presentation-only after the authored
interaction has been selected; their action and activity columns do not enter
the world hash.

`armchair.take_the_chair` appends the same exact socket pattern as
`sit / object_socket / socket`. A valid target emits visual action 8, activity
11, the compiled seat facing, and the seat coordinates. The shell chooses two
38 by 88 sitting bodies per look and facing on a 24-tick, stable-id phase;
reduced motion pins frame zero. Activity 11 maps to the HUD label `Sitting` and
has no indicator. The compiled visual enum, render action code, and activity
code are append-only. The presentation does not add a simulation component,
save field, bridge column, object reservation rule, or world-hash input.

`bed.sleep` adds the first horizontal socket body and the first authored object
foreground. The exact `sleep / object_socket / socket` contract emits visual
action 9 and existing sleeping activity 5. The shell selects two 104 by 72
sleeping frames per look and facing on a 32-tick, stable-id phase; reduced
motion pins frame zero. The optional foreground sprite is compiled and resolved
with the placement, then exposed as a render-buffer column with `u32::MAX` for
no layer. The renderer draws that row on foreground layer 3 after the sim, so
the upper bunk, near posts, rail, and ladder occlude the lower-mattress body.
No object-id lookup exists in TypeScript. Save V1 omits this reconstructed
presentation metadata and Load rebuilds it from current compiled content.

Standing bookshelf reading reuses the same compiled `Read` action without an
object socket. `bookshelf.read` authors the exact
`read / object / toward_anchor` combination. Render sync requires matching
active object and interaction identity, rejects social and chain work, keeps
the row's ordinary path-tile position, and faces toward the exact target
footprint centre. A valid match emits append-only visual action 4 plus existing
activity 8. The shell selects two upright, fixed-envelope reading frames per
look and facing on the same 24-tick, stable-id phase as seated reading. Reduced
motion pins frame zero. Conversation, eating, and seated socket reading retain
their existing precedence; every incomplete or surplus contract falls back to
generic object use.

Save records simulation tick state, not a fractional presentation sample. Load
therefore reconstructs the walk frame from the saved tick-end position after the
ordinary render buffer reseeds previous and current position. It does not
promise to preserve an unsaved interpolation alpha from the instant the player
pressed Save; that presentation boundary already exists for travel itself.

## [D11] WASM/JS bridge

The simulation owns all state in WASM linear memory. JS holds
`Float32Array`/`Uint32Array` **views** over render-relevant slices, including
positions, sprite IDs, optional foreground sprite IDs, activity codes,
presentation visual actions, and lot-axis facings, plus compiled footprint
width and depth, and feeds them directly into GPU buffers. Walking reuses the
action, facing, activity, and position columns.
Conversation, eating, sleeping, sitting, seated reading, standing reading,
aquarium watching, and exercise read the action and facing columns, so the broad status
vocabulary never becomes an art lookup by accident. Sitting, seated reading,
and exercise reuse the existing position columns for socket projection;
standing reading and aquarium watching retain the ordinary path-tile samples.
Sleep adds one foreground pointer and bridge accessor. Lighting reads
footprints only while rebuilding its static field and never retains a view
across a sync.

**Zero copy, and no per-entity JS objects, ever.**

JS to sim traffic is player commands only: small and infrequent, so a simple
serialized command channel suffices. UI reads are pull-based and throttled; the
needs panel does not need 60Hz.

The normal-play People panel follows the same projection rule. It gets the
complete live row set from the household roster, gets sparse directional
feelings from `relationships_of`, and joins them by stable `SimId`. It does not
cache selection, names, membership or feelings. Missing relationship entries
mean Stranger because the simulation intentionally drops entries after they
decay to exact zero. A successful Load force-refreshes both roster and People
before their next cadence interval, so replacement entity indices cannot leak
into visible identity.

Mood is another pure projection, but its boundary is two aligned copies:
`mood_snapshot_of` carries the overall and per-moodlet scores, while
`mood_summary_of` carries the corresponding labels. The HUD copies the numeric
half before the next bridge call and short-circuits without requesting labels
when that half is empty. A discriminated render state keeps no selection
distinct from invalid selected data, then rejects misaligned, blank, or
non-finite payloads and reconciles duplicate-safe rows at the ordinary need-bar
cadence. A successful Load force-refreshes Mood in the same callback as roster
and People, before a tick can advance or an old row can survive the restored
world.

**The discipline that makes this safe, in one rule: never cache a view.** WASM
linear memory grows, and growth detaches every typed-array view over the old
`ArrayBuffer`; a detached view reads as length 0 or throws. So `web/src/bridge.ts`
rebuilds buffer, pointer and length on every access. That is a pointer-plus-length
operation with no copying, so it is cheap - caching it is the classic bug in this
pattern, not an optimisation. See [L10] in `lessons-learned.md`.

That lifetime also ends at the next boundary call that may allocate. A
command-time projection that needs IDs or kinds while resolving strings first
copies the aligned primitive rows, then performs the string calls. Holding a
fresh zero-copy view across those calls is still holding a stale view; it just
manages to fail within one function instead of between frames. See [L72].

This is called out as its own section because it is the most likely place for
the design to quietly rot into slowness. It must be deliberate rather than
emergent. Tracked as [R1].

**"No per-entity JS objects, ever" is now measured rather than asserted, and
it had already been broken once.** `worldToScreen` returned a two-element
array per entity per frame, excused on the expectation that V8's escape
analysis would eliminate it. A sampling heap profile at 1,002 entities
attributed **57.8 MB over 2,394 frames** to that array - about 25 bytes per
entity per frame - so the expectation was simply wrong. The render loop now
calls scalar helpers and the same profile reads 0.38 MB, which is the three
typed-array views the bridge must rebuild every call and must never cache.
See [V11] in `docs/gpu-verification.md`, and [L20] for the profiler flag that
made the first run of that measurement report zero.

The general rule this leaves behind: **a frame-time budget and a JS heap
trend both pass while this rule is being broken.** Task 13's numbers were
green throughout the 57.8 MB period, because 2.9 MB/s of short-lived garbage
is invisible to a p95 and to a heap that the scavenger keeps flat. Only an
allocation profile can see it, so only an allocation profile counts as
evidence here.

## [D13] Ghost pipeline (Layer 1 multiplayer)

**Planned, not shipped.** There is no ghost record, death export, network
staging queue, injection system, or replay command log in the current game.
The rest of this section records the M4 contract.

When a sim dies, the game exports a **Ghost Record**: identity, appearance,
traits, notable life events, cause of death, key relationships, skills at time
of death, and any unfinished business. A few KB, versioned, portable.

Ghost Records sync to a service and are distributed into other players' towns,
where they haunt locations, appear as apparitions, and leave traces. The loop
is symmetric and always-on: your dead sims populate other towns, theirs
populate yours, and **no clock synchronization is required at any point.**

What ghosts do, so this is mechanics rather than decoration:

- **Teach skills posthumously.** A dead chef's ghost can teach cooking. This is
  the asymmetric-capability mechanism that gives players a genuine reason to
  engage with other players' content.
- **Carry unfinished business** as a quest hook, with a reward on resolution.
- **Cause events** appropriate to their traits and cause of death.
- **Leave heirlooms** as tangible objects entering your economy.

**Determinism constraint.** Ghosts will arrive over the network asynchronously,
which would break replay if injected directly. The planned design lands imports
in a **staging queue**, injects them only at a deterministic day boundary, and
records each injection in the future replay log. None of that infrastructure is
part of the alpha tick pipeline.

**Offline-first requirement.** The game remains fully playable with no network
connection; ghosts will be strictly additive.

## [D15] Careers and workplaces

### Shipped rabbit-hole career

The alpha ships one content-defined rabbit-hole career. `Career(u32)` names a
pack row containing label, shift start, duration, pay, energy cost, and
satisfaction. At shift time, `Commuting` sends the sim to the front door;
`AtWork { remaining_ticks }` keeps the off-lot countdown in deterministic world
state; completion pays household Funds, applies the authored costs and reward,
and returns the sim to the lot. The normal HUD exposes the career, activity,
clock, and Funds.

The alpha does **not** contain workplace lot references, promotion ladders,
skill requirements, coworker entities, or a shared `ShiftOutcome` interface.

### Planned simulated-workplace contract

Simulated workplaces are a near-term post-v1 goal because careers are expected
to be critical to the production version. The requirements below are a target
for that extension, not claims about the current component shape.

The key realization: **a rabbit-hole career is the Tier 2 simulation of a
workplace, and a simulated workplace is the Tier 0 case.** That is the same
conceptual distinction as [D3] applied to work. Neither the tier machinery nor
the workplace implementation exists yet; the mapping is a design constraint
for building them without two unrelated career systems.

Planned requirements:

- **Careers are data, not code.** Shift schedules, skill requirements,
  promotion ladders, and pay curves live in content files ([D9]).
- **A workplace becomes a lot reference.** It may first resolve to a
  non-instantiated stub lot, then later to a real lot with objects and
  coworkers. The shipped career does not carry this reference yet.
- **Shift outcome is computed behind a single interface.** The Tier 2
  implementation rolls against skills, mood, and traits. The Tier 0
  implementation derives the same outcome from actual on-lot performance. Both
  emit the same `ShiftOutcome`, so nothing downstream changes.
- **A working sim's location becomes explicit workplace state.** Extend the
  shipped countdown rather than despawning the sim.
- **Coworker NPCs become stable entities** so workplace relationships can
  accrue once that system exists.

The last two are the ones that would be genuinely painful to retrofit.
Despawning working sims, or having no coworker identities to attach history to,
both bake in assumptions that a real workplace breaks.

## [D14] Backend services

**Planned, not shipped.** There is no backend crate, ghost storage, network
client, report flow, ban tool, or purge implementation. The intended service is
deliberately minimal content sync, not a real-time or authoritative game server.

- Object storage for Ghost Records, plus a small API to upload and to fetch a
  curated set. Account setup and the upload-identity decision are TIM-TODO
  [T16]; the privacy policy and published moderation rules that must ship
  alongside are [T14] and [T15].
- Reading ghosts requires no account. **Uploading requires a lightweight
  identity**, so that bans have something durable to attach to. See [R9].
- **Moderation is report-driven and retroactive, not filter-based.** No
  automated content filtering. The requirements this creates:
  - Every piece of player-authored text crossing between players (sim names,
    epitaphs, unfinished-business text, and later any Layer 2 chat) is
    **attributable to a stable player ID and logged**.
  - Players can **report** another player from the context where they
    encountered the content.
  - An operator can **ban** a player ID.
  - **Banning purges that player's already-distributed records**, not just
    future uploads. This is the requirement most easily forgotten and most
    annoying to add later.

  Tracked as [R7]. The accepted tradeoff is that objectionable content reaches
  some players before it is removed. For a free solo project that is
  defensible, but it is a choice rather than an oversight.

## [D12] Testing

- **Shipped:** the native simulation core runs under `cargo test` with no
  browser; fixed-seed determinism and save continuation compare world hashes;
  mutation shards exercise Rust behavior; Vitest covers the shell; production
  builds and watched browser passes cover the renderer and player flows.
- **Planned:** a headless 10-sim-year soak that asserts no panics, need
  starvation, or unbounded memory growth. Shorter instrumented balance runs
  exist, but the ten-year soak is not a current CI gate.
- Property tests on scoring remain useful future coverage, for example that a
  starving sim with reachable food always eats.

## Risks

| ID | Risk | Mitigation |
|---|---|---|
| **[R1]** | WASM/JS bridge degrading if [D11] discipline slips | Frame-time budgets in CI |
| **[R2]** | `bevy_ecs` parallel scheduler vs determinism | [D4] commutativity rule, [D12] determinism test |
| **[R3]** | Tier 2 to Tier 0 promotion yielding implausible states | Co-design both tiers against one state shape |
| **[R4]** | Art assets, not simulation state, consume the ~2GB budget | Per-lot texture budget enforced at build time |
| **[R5]** | Rust review burden on a maintainer who does not currently work in it | Keep sim core small and heavily commented; lean on the type system |
| **[R6]** | Scope. This genre is a content treadmill; the engine is the easy half | Milestone gating in FEATURES.md |
| **[R7]** | Player-authored text crossing between players ([D13]) | Report-driven retroactive banning, plus purge of a banned player's distributed records. Bad content reaching some players first is an accepted tradeoff |
| **[R8]** | Backend cost scaling with player count | Ghost Records are KB-scale; storage-only design keeps cost near-linear and low |
| **[R9]** | Anonymous player IDs are trivially reset, weakening retroactive bans | Reading stays anonymous; **uploading** requires a lightweight durable identity |
