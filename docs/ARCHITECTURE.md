# Architecture

Status: agreed in principle, not yet implemented. Section IDs are stable and
are referenced from other docs and from discussion. Do not renumber them.

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

The load-bearing rule: **`terri-core` and `terri-sim` contain zero
`wasm-bindgen` and zero `web-sys`.** They compile natively and run under
`cargo test` at full speed.

```
crates/
  terri-core/     ECS wiring, world types, time. No I/O.
  terri-data/     Content schema and loaders (serde). No I/O.
  terri-sim/      All simulation systems. No I/O.
  terri-save/     Snapshot and delta serialization.
  terri-ghost/    Ghost record export/import. No network I/O.
  terri-wasm/     wasm-bindgen boundary. The ONLY crate that knows JS exists.
  terri-native/   (later) native shell entry point.
web/
  render/         WebGPU renderer
  ui/             DOM UI
  bridge/         Typed-array views into WASM memory
  net/            Ghost sync client. The ONLY place network I/O happens.
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

1. `|| time` - advance clock, fire calendar events
2. `|| need_decay`
3. `|| mood` - moodlets from needs, traits, environment
4. `|| advertisement_scan` - spatial query for nearby smart objects, score them
5. `-> action_selection` - pick winning interaction
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

```toml
[fridge.interactions.grab_snack]
advertises = { Hunger = 35 }
duration   = "15min"
requires   = ["has_power", "stocked"]
slots      = 1
trait_mods = { Glutton = 1.4, Neat = 0.8 }
```

Agent scoring weights each advertised delta by the agent's current deficit on a
**steeply nonlinear curve** (a sim at 5% hunger wants food enormously more than
one at 60%, not 12x more), applies trait modifiers, divides by travel plus
duration cost, and takes the argmax with small seeded jitter for variety.

Two properties matter. Adding content means adding a data file rather than
touching AI code, so a modder's new object is used correctly on day one. And
cost is bounded by the spatial query in [A7], not by world size.

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

**Snapshot plus command log.** Because the sim is deterministic, a save is
`(seed, snapshot, commands_since_snapshot)` and loading is deserialize then
replay. Autosave writes a fresh snapshot and truncates the log.

Storage is **OPFS** (Origin Private File System), not `localStorage` - real
file handles from a worker with no meaningful quota ceiling.

**Schema versioning and migration hooks exist from the first commit.** Content
and save shape will change weekly; deferring versioning means breaking player
saves later.

## [D9] Content pipeline

Content is authored in TOML and compiled to a validated binary pack at build
time, with hot reload in development.

The build **fails on dangling references**: an interaction citing an undefined
need, an object requiring an undefined predicate. Cheap to write early, and it
eliminates an entire category of runtime bug.

Mod support then falls out nearly free. A mod is another content pack merged
over the base.

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

**The discipline that makes this safe, in one rule: never cache a view.** WASM
linear memory grows, and growth detaches every typed-array view over the old
`ArrayBuffer`; a detached view reads as length 0 or throws. So `web/src/bridge.ts`
rebuilds buffer, pointer and length on every access. That is a pointer-plus-length
operation with no copying, so it is cheap - caching it is the classic bug in this
pattern, not an optimisation. See [L10] in `lessons-learned.md`.

This is called out as its own section because it is the most likely place for
the design to quietly rot into slowness. It must be deliberate rather than
emergent. Tracked as [R1].

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
