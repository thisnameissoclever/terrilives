# Architecture

Status: agreed in principle. Most of it is not yet implemented; the sections
that are say so and describe what exists rather than what was planned. As of
M1a that is [D1], [D2], [D6], [D9], [D10], [D11] and part of [D12]. Section IDs
are stable and are referenced from other docs and from discussion. Do not
renumber them.

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

Because the two are so easy to confuse, the driver exposes `stepDurationMs`
purely so the constraint is testable: scaling elapsed time by `k` and dividing
the step by `k` produce identical tick counts and identical interpolation
alphas, so a step count cannot tell [D2] from its violation. See [L44].

## [D3] Simulation LOD tiers

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

**`bevy_ecs` used as a standalone crate**, without the rest of Bevy. Mature,
archetypal, fast, and its scheduler derives parallelism automatically from
declared component access, delivering [A9] without hand-rolling a scheduler.

**Determinism caveat.** A parallel scheduler is a determinism hazard, and
archetypal iteration order shifts as archetypes change. The enforced rule:

> **Parallel systems must be commutative.** Each entity's update reads only its
> own components plus immutable shared state. Anything genuinely contended
> (two sims reaching for one chair) goes through a serialized phase over a
> command buffer sorted by entity ID.

Enforced from day one and verified by the determinism test in [D12]. Tracked
as [R2].

## [D5] Tick pipeline

Ordered, per tick. `||` marks parallel, `->` marks serialized.

0. `-> command_drain` - apply every queued player command, in the order the
   player issued them ([D-2] of the M1b design). Numbered zero rather than
   inserted as 1, so the step numbers other sections cite stay put, for the
   same reason 4a and 5a are lettered. It is **first**, and both halves of
   that matter: player input is asynchronous, so it has to land through one
   serialized system for a recorded command log to replay to the same world;
   and an
   intent pushed here has to be servable by step 4a on the same tick, or a
   click would take a tick to have any effect and the sim would spend that
   tick choosing for itself. Entity references arrive from JavaScript as raw
   `u32` indices, so resolution tolerates a stale one - a panic here traps
   the WASM module for the rest of the page's life.

When paused, the shell runs step 0 by itself once per rendered frame. It uses
the same queue and the same `command_drain` system as a full tick; steps 1
through 14 do not run. This keeps input alive without creating a second
mutation path or allowing simulation time to leak through pause. The drain is
associative across batch boundaries: splitting an ordered command stream across
two rendered frames produces the same saved world as draining it in one batch.
1. `|| time` - advance clock, fire calendar events
2. `|| need_decay`
3. `|| mood` - moodlets from needs, traits, environment
4. `|| advertisement_scan` - spatial query for nearby smart objects, score them
4a. `-> intent_serve` - turn each directed sim's front player-issued intent
    into a target ([D-3] of the M1b design). Serialized because it claims
    object slots, and it sits BEFORE selection because a directed action
    overrides autonomy rather than competing with it. It is the one step that
    sees sims which are already walking or already mid-interaction: a player
    intent **preempts** a running interaction rather than queueing behind it,
    since a sim asleep for 24 seconds would otherwise leave a click with no
    visible response for the whole of it. Lettered for the same reason 5a is.
5. `-> action_selection` - pick winning interaction, **for sims with no queued
    intent**. That filter is what makes a directed action beat autonomy.
5a. `-> idle_wander` - a sim whose best option scores below `idle_threshold`
    walks to a random reachable tile instead of standing still ([D-5] of the
    M1c design). Lettered rather than numbered so the step numbers other
    sections cite stay put. Serialized because it draws from the shared PRNG,
    and it sits here rather than earlier so that a sim which just found
    something worth doing never reaches it.
6. `-> reservation` - claim object slots, deterministic order by entity ID
7. `|| pathfinding_request`
8. `-> path_solve` - **budgeted: max N paths per tick, overflow queues**
9. `|| movement`
10. `|| interaction_tick` - advance interactions, apply need deltas
11. `-> social` - pairwise relationship updates
12. `-> ghost_injection` - drain the staging queue at day boundaries only ([D13])
13. `-> event_dispatch` - flush command buffer
14. `-> story_progression` - Tier 2, on the sim-hour only

Step 8's budget matters more than it appears. Path solving must never be
unbounded per tick. A fixed budget with an overflow queue keeps frame time
predictable; an agent idling one extra tick is invisible, a 400ms hitch is not.

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
build-time check in [D9] validates against. **`requires` and `trait_mods` are
not implemented yet** - predicates and traits are M1b, and adding the fields
before anything reads them would mean content that validates and lies.

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
wait". Nothing reads `Blocked` yet - the intended readers are the selection UI
and a local wander for blocked sims. See [L56] for how this arrived twice.

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

Tile grid at roughly 1m per tile, per lot. Rooms are graph nodes, doors and
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
also stores a compiled-content fingerprint and rejects changed content rather
than silently deleting a job, object, chain or trait. The next incompatible
shape must bump the version and make an explicit migration decision.

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
- a non-finite or negative number anywhere
- a missing or incoherent tuning knob: an absent field, a `choice_temperature`
  of zero or below (selection divides by it), a `min_interaction_ticks` of
  zero, a `duration_variance` outside `[0, 1)`, or an `idle_threshold` above
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
an undefined predicate" is still a promise rather than a check; it lands with
[D6]'s M1b work.

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
100k objects, not sorting beats sorting well. Lot geometry streams in chunks so
only visible lots are uploaded.

Art direction: **low-poly 3D characters plus instanced sprites for props.**
Characters need deep customization, which pre-rendered sprites make
combinatorially painful. A chair does not. See TECH_STACK.md for the asset
pipeline.

## [D11] WASM/JS bridge

The simulation owns all state in WASM linear memory. JS holds
`Float32Array`/`Int32Array` **views** over render-relevant slices (positions,
sprite IDs, animation state) and feeds them directly into GPU buffers.

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

**The discipline that makes this safe, in one rule: never cache a view.** WASM
linear memory grows, and growth detaches every typed-array view over the old
`ArrayBuffer`; a detached view reads as length 0 or throws. So `web/src/bridge.ts`
rebuilds buffer, pointer and length on every access. That is a pointer-plus-length
operation with no copying, so it is cheap - caching it is the classic bug in this
pattern, not an optimisation. See [L10] in `lessons-learned.md`.

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

**Determinism constraint.** Ghosts arrive over the network asynchronously,
which would break replay if injected directly. Imported ghosts therefore land
in a **staging queue** and are injected only at a deterministic boundary (start
of a sim-day, step 12 in [D5]), and each injection is recorded in the command
log so that replays reproduce it exactly.

**Offline-first.** The game is fully playable with no network connection.
Ghosts are strictly additive.

## [D15] Careers and workplaces

v1 ships rabbit-hole careers (M2): the sim leaves the lot and returns with an
outcome. **Simulated workplaces are a near-term post-v1 goal and the system is
architected for them now**, because careers are expected to be critical to the
production version.

The key realization: **a rabbit-hole career is the Tier 2 simulation of a
workplace, and a simulated workplace is the Tier 0 case.** That is the same
distinction as [D3] applied to work, which means the upgrade path already
exists in the tier machinery rather than needing a new subsystem later.

Requirements this places on v1:

- **Careers are data, not code.** Shift schedules, skill requirements,
  promotion ladders, and pay curves live in content files ([D9]).
- **A workplace is always a lot reference.** In v1 it resolves to a
  non-instantiated stub lot; later it resolves to a real lot with objects and
  coworkers. No consumer of the career system may assume "offsite."
- **Shift outcome is computed behind a single interface.** The Tier 2
  implementation rolls against skills, mood, and traits. The Tier 0
  implementation derives the same outcome from actual on-lot performance. Both
  emit the same `ShiftOutcome`, so nothing downstream changes.
- **A working sim's location is explicit state, not absent state.** Model it as
  `AtWork { workplace, tier }`. Never despawn the sim.
- **Coworker NPCs exist as entities from v1**, even while unsimulated, so that
  workplace relationships accrue from the start.

The last two are the ones that would be genuinely painful to retrofit.
Despawning working sims, or having no coworker identities to attach history to,
both bake in assumptions that a real workplace breaks.

## [D14] Backend services

Deliberately minimal. This is content sync, not a game server, and there is no
real-time or authoritative simulation anywhere in it.

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

- Simulation core runs under `cargo test`, natively, with no browser.
- **Determinism test in CI: run N ticks from a fixed seed twice, assert an
  identical world hash.** The highest-value test in the project. It is what
  stops the Layer 2 multiplayer option from decaying unnoticed.
- **Soak test:** headless 10-sim-year run. Assert no panics, no need
  starvation, no unbounded memory growth. Catches balance and leak bugs cheaply.
- Property tests on scoring, e.g. a starving sim with reachable food always eats.
- Renderer: frame-time budgets in CI, plus eyeballs.

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
