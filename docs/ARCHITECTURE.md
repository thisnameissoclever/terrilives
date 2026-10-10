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

The relationship extension uses `interpersonal` for ordered start/entry consequences,
`privacy` for cached decisions and derived routes, `compatibility` for authored
preference comparison, and `relationship_dynamics` for minute-by-minute contact.
Movement checks current room occupancy before crossing a boundary or starting
private use. Contact then runs before interaction completion, so a final minute
of shared activity counts once and a conversation receives only its completion
reward. `relationship_effects` exposes a read-only causal journal for native
traces. Boundary decisions are saved and hashed; diagnostics and derived
compatibility are not. See the [relationship specification](specs/2026-09-30-relationship-development.md).

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

**Speed controls scale elapsed time before fixed-step accumulation. They
never change `dt`.** At 3x the shell requests 30 simulation ticks per real
second, independent of the display refresh rate. A rendered frame may consume
zero or several accumulated steps. Variable `dt` would break deterministic
simulation.

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

The compact HUD separates the upper-left world controls from a bottom Sim
dock. `CompactHud` owns only the chosen detail panel, collapse state, responsive
mode and Build presentation snapshot. Existing panel controllers retain their
simulation reads and commands. At 600 CSS pixels or narrower, or 480 CSS pixels
or shorter, the same needs DOM moves into the expandable Overview panel.
Desktop collapse uses that same route. Traits starts closed; one detail panel
opens at a time. Critical needs stay visible in the compact identity row.
Build suspends the dock and restores its presentation on exit. The current
contract is [CUI-world]-[CUI-build] in
`docs/specs/2026-09-30-control-layout-studies.md`; [CH1]-[CH4] describe the
superseded layout.

The Overview disclosure `PersonalDetailsPanel` reads only while that section
and its sheet are visible, at the existing need-bar cadence. Opening the
disclosure and loading a save force a refresh. `Sim::details_of` projects
Personality and Habituation without changing either. The WASM numeric copy
contains one signed sleep offset, seven drain factors, seven positive-refill
factors, then object-definition/activity-row/repetition triples; a parallel
text copy supplies object type and activity labels. Both calls are synchronous
with no tick between them. Numbers use f64 so signed offsets and u32 keys remain
exact. The bridge rejects malformed columns and out-of-range values. Keyed DOM
rows are reused, reordered and removed as the selected person changes. These
are personal factors, not effective drain rates or lifetime satisfaction.

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
   the WASM module for the rest of the page's life. An order command names
   its placement: `UseObject` and `TalkTo` go to the BACK of the sim's
   queue (Queue mode, or Ctrl or Cmd held) and `UseObjectFirst` and
   `TalkToFirst` go to the FRONT (a plain click or menu row), with the
   waiting orders kept behind the new one. Only `CancelIntents` empties a
   queue ([I-plain-order-goes-first] of the selection and input design).

When paused, the shell runs step 0 by itself once per rendered frame. It uses
the same queue and the same `drain_commands` system as a full tick; steps 1
through 15 do not run. This keeps input alive without creating a second
mutation path or allowing simulation time to leak through pause. The drain is
associative across batch boundaries: splitting an ordered command stream across
two rendered frames produces the same saved world as draining it in one batch.

Each completed full tick and paused drain is also a Bevy ECS update boundary.
After the schedule applies its deferred commands, `World::clear_trackers()`
retires older component-removal records and retains the just-finished update's
records. Standalone ECS does not perform this maintenance automatically. These
records are runtime bookkeeping, absent from saves and the world hash. A future
removal reader must run at every relevant boundary: a reader that runs only on
full ticks can miss removals after multiple paused drains.

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
5. `domestic::tick` - initialize saved cleanliness, attribute newly noticed foreign dishes once per room visit, claim prepared meals for idle hungry friends, and retain one pending needs-adjusted cleanup decision per room entry or genuinely new pile, including own old dishes. Player intents already have priority.
6. `select_action` - pick the winning interaction, **for sims with no queued
    intent**. That filter is what makes a directed action beat autonomy.
7. `advance_chains` - resume or begin the next station in a multi-step action.
8. `wander` - a sim who samples wandering among the eligible weighted choices
    walks to a random reachable LOCAL tile instead of standing still ([D-5] of
    the M1c design and [LW2] of the local-wandering spec). Both the endpoint's
    Manhattan distance and the actual A* path are capped by
    `wander_radius_tiles`, so a nearby tile behind a wall cannot become a
    cross-house detour. Failed candidates consume one of the bounded
    `wander_attempts`; the system never widens the search to the whole lot. It
    draws x then y and a pause length from the shared PRNG and
    processes sims in entity-index order before those draws.
9. `follow_path` - move one deterministic step along the chosen path.
10. `commute_and_work` - clock in at the street's exit or the door, run the shift, pay, and walk home.
11. `tick_interactions` - advance ordinary object interactions and need deltas.
12. `tick_chain_steps` - advance station work and terminal-only chain payoff.
13. `tick_social` - advance conversations and directional relationships.
14. `decay_habituation` - cool repeated-object memory.
15. `decay_relationships` - apply directional relationship decay.
16. `bleed_neglect` - reduce satisfaction when needs remain neglected.
17. `mortality::tick` - count consecutive final-tick zero hunger or energy, then remove eligible sims in entity-index order when death is enabled. Recovery earlier in the same tick prevents death.
18. `mood::accrue_satisfaction` - derive each survivor's mood and integrate its signed contribution into life satisfaction, including grief from this tick.

After the command drain and before advancing the clock, `mortality::cleanup` releases actions whose owner lost Needs or whose target lost SmartObject. Death releases its own claims before despawning without freeing the entity index. `waiting::clear` removes the previous item-wait decision before selection and chain scheduling publish the next one.

Death state is a sparse `SavedMortality` resource: a setting, positive counts ordered by living entity index, and permanent death records ordered by tick then SimId. It is hashed and appended to SaveSnapshotV5 as `Option<SavedMortality>`. None costs one zero byte, so the historical decoder can pad that field without changing earlier lists. A padded decode must re-encode exactly, and every field filled by padding must be zero-valued. Later V5 fields append a one-time death-default migration flag and sparse waiting rows containing person index, item index and relevant need bits. Older worlds enable death on load once; later saved off choices survive.

Death records include the issued-identity boundary, excluding later newcomers from grief. Survivors keep their affinity toward dead SimIds without decay. Grief strength and duration derive from that affinity and elapsed ticks; moodlets are never stored.

Mood is derived for the HUD and for the once-per-tick satisfaction contribution.
Moodlets remain unstored; the satisfaction ledger integrates their effects.
Occupied-item waiting contributes more strongly as the relevant need falls.
All balance inputs live in the validated tuning pack. Parallel advertisement scans,
a fixed per-tick path budget with an overflow queue, ghost injection, an event
dispatch phase, and Tier 2 story progression remain future scale work. The path
budget still matters when population grows: bounded work produces a harmless
one-tick wait instead of an unbounded hitch.

## [D6] Smart objects

Objects advertise what they satisfy; agents score the advertisements.

`content/objects.toml` defines categories, physical types, and purchasable models.
`crates/terri-data/src/hierarchy.rs` resolves that single inheritance chain before
`compile.rs` validates the complete objects. The simulation uses compiled objects
and does not resolve inheritance during play. A small authoring example:

```toml
[[category]]
id = "seating"
label = "Seating"

[[object_type]]
id = "armchair"
label = "Armchair"
category = "seating"
[object_type.properties]
rooms = { set = ["living_room", "office"] }

[[model]]
id = "reading_chair"
object_type = "armchair"
[model.properties]
name = { set = "Example model" }
# Supply the remaining required properties and actions before compilation.
```

Omitted properties inherit. Each field permits one applicable operation: `set`,
numeric `scale`, collection `extend` or `replace`, or removal of an optional value.
Required values cannot be removed. Actions have stable IDs independent of labels;
an override retains its inherited position, and a new action appends in authored
order. Removing an inherited action is explicit. Action templates share behavior
across unrelated types without additional category parents.

Secondary-seat Comfort is an inherited model property, with the same explicit
numeric set, scale and removal operations. It describes ordinary seated hardware
comfort for meals and media. Owned reading supplies its own resolved Comfort
rate; do not add secondary-seat Comfort again or derive it from a reading-only
specialization. Shared Social depends on actual liked company, not a terminal
reward from an activity label. Handwashing respects its configured Hygiene
ceiling. Purchase facts expose these conditions alongside base values.

Duration uses simulation ticks, each one game minute ([D2]). Scaling happens once
at each authored layer, followed by rounding the final duration to a positive whole
tick. Need names match `NeedId::as_str`; traits are defined in `content/traits.toml`.
The compiler rejects unknown references, invalid operations, missing required
properties and invalid final values, including unused action-template references.
Legacy flat `[[object]]` files remain supported for historical fixtures.
Hierarchical models author `description`; the compiler builds the resolved
presentation from that text and the canonical type label. Do not author a second
physical-type label in model presentation. Historical flat `ObjectPresentation`
retains its published shape. Browser model facts expose resolved actions and
usable station roles from the same compiled definitions used by the simulation.
Raw station tags remain compatible with saved chains; buying facts include only
roles current actions can use. Required cooking hardware is separate from
optional dining furniture, since a preparation counter supplies the tableless
fallback. Role eligibility is shared with execution rather than inferred from
the model's name.

Category describes a broad family, type describes a physical kind, and model
identifies a specific product. A reading specialization belongs to an Armchair
model. Bunk bed is a separate type because stacked sleeping places change its
structure and access requirements. Beds and bunk beds can reuse sleeping actions.
Room associations organize store browsing; they neither grant actions nor limit
placement. `Other` is a valid category with no implicit behavior. Use stable model
IDs in code and saves, never visible names or shared type labels.

Agent scoring (`crates/terri-sim/src/systems/advertise.rs`) weights each
advertised delta by the agent's current deficit on a **steeply nonlinear
curve** - the deficit is **cubed**, so a sim at 5% hunger wants food about 13x
more than one at 60%, not 2.4x - and divides by travel plus duration cost. An
advert is a sparse list of (need, delta) pairs and each pair is scored
separately before summing, so an object satisfying two needs modestly can beat
one satisfying a single need slightly better. Trait modifiers and weighted
selection are now shipped: `select_action` samples the sorted candidates with
utility weights mixed with positive exploration. Eligibility depends on physical
requirements, reachability and occupancy, not a score threshold. Targets are
normalized separately from their eligible interactions. Temperature and exploration
increase smoothly as the lowest need rises from 40 to 70; Fun and Social retain
baseline appeal even at full meters. Self-preservation scales low-need urgency and
penalties for delaying survival recovery. See [VA-choice] and [VA-instinct].

Ordinary actions and initial placement are data-driven. Supported specialized
behaviors have explicit inherited configuration. Media behavior grants the
viewing/listening rules and shared seating; an activity label or model name does
not. Cooking access uses authored physical contact data shared by route admission
and body presentation. `Sim::new_from_lot` reads the placements in
`content/lot.toml`. `select_action` currently scans objects for each idle agent;
the spatial query proposed in [A7] remains future work.

An action can bind to a shared multi-step procedure through a recipe record with
its ID and `selected_step`. The procedure supplies step order, station roles and
item transitions. The resolved model action supplies base work, terminal benefits,
costs and satisfaction. Compilation allocates that base work across the procedure's
steps with deterministic rounding. Execution, scoring and purchase facts consume
the same resolved values; inherited overrides must change actual behavior.

The selected step uses the concrete appliance on which the action began. Fridge
actions select their initial ingredient step; dish cleanup selects its later
washing step, allowing collection elsewhere first. The model must supply that
step's role. Repeated cleanup collection and managed communal dining are not
supported selected-appliance stages, and invitation-only shared meals cannot be
bound as public actions. Invalid bindings fail compilation.

`action_rows` resolves current public actions and explicit nonpublic accounting
aliases. Old saved chain keys map through reviewed aliases; an unbound procedure
does not acquire a public command merely because it names an advertiser.
`recipe_actions::Origin` retains the initiating model/action and the selected
entity generation until designated use completes. Later work retains the stable
model/action identity without depending on the appliance still existing. Start,
replacement, interruption and cleanup paths must preserve or clear this state
together with `ChainState`.

Privacy detours and safe-alternative probes use the same selected-appliance
eligibility as ordinary admission. Urgency follows the initiating action's
resolved positive benefits, not the recipe's internal defaults. An ordinary
urgent substitute may temporarily suspend a recipe. A procedural substitute
starts a complete replacement recipe after releasing its predecessor's domestic
commitments; it cannot run the public recipe row as an ordinary interaction.
Owned-book return obligations still precede either kind of replacement.

Bound cleanup repeats its resolved collection work as required. Washing adds
dish-dependent work scaled by the binding's resolved base total, with one checked
rounding for the whole load. Purchase facts distinguish base work, repeated work
and per-load additions from travel and waiting. Internal household cleanup and
shared-meal invitations retain their default procedure path. Using an appliance
as a station for another action does not apply its public action's modifiers;
per-station model modifiers require a separate contract.

Reserved objects remain visible to autonomy. Their activities contribute
waiting choices, attenuated by `contested_score_multiplier` and adjusted for
survival risk, to the same grouped probability draw as available activities
and wandering. Choosing one sets `Blocked` and records the relevant needs;
it does not begin using the occupied object. `stall_reason_of` exposes that
waiting state to the selected-person HUD. Distance fields are shared by agents
starting on the same rounded tile during one selection pass.

Reservation release checks current `Target` owners after preceding deferred
commands have applied. It excludes only the departing owner's exact target;
a replacement commitment and other owners keep the marker. Callers remove
their own action state. This applies to completion, cancellation, changed
orders, work departure, death and invalid-state cleanup. Sleeping places have
separate ownership and assignment rules; see
`docs/specs/2026-10-01-bed-assignment.md`.

Seating models author stable physical seat IDs, body positions, facing and
approaches. `seating::PhysicalClaim` reserves one place or the whole furniture
during travel and use. Ordinary sitting, reading, dining and seated media share the
same admission view. A full-sofa action excludes every individual seat; changing
the action does not create additional seating capacity.

A seat action's capacity therefore comes only from the furniture's seats: one
person per seat for `seat_use = "one"`, one person for the whole furniture for
`"all"`. Layered content does not author `slots` on a seat action; a later
layer may `remove` one inherited from a template. The resolver fills it from the
seats, and the build rejects an authored value or any value that disagrees with
the seats, because admission never reads it and an edited number would
otherwise change nothing. Bookcase reading follows the same rule, because
borrowed copies limit it. Every other layered action admits one person unless
it is television, radio or sleeping, so the build requires `slots = 1` there.
For television and radio, `slots` counts standing viewers only: each free seat
in view admits a further viewer, and a viewer who loses a seat stands only
within that count.

A type or model may name `default_action`, the action a left click starts;
otherwise a left click starts the first action. The sofa names Sit, keeping
the action order, and so every saved action position, unchanged.

Meal and media approach reservations are separate from physical seat ownership.
A meal keeps its approach clear. People using different seats for media may
share an approach, including the middle and end places on a sofa. Planning and
restoration use the same symmetric conflict rule, including reservations accepted
earlier in the same selection pass. Chair contact also checks the wall edge;
a reachable floor tile on the other side of a wall is not a valid approach.

Bookcases author `shelf_access` offsets at their base facing. The compiled
definition rotates those positions with the furniture. Fetching, returning,
saved journeys and lot edits share the same wall-aware contact check. A floor
tile beside the closed back is not access to the shelves. Short shelf-transfer
claims use the existing endpoint occupancy rules and end after pickup or
shelving; borrowing a copy does not reserve the whole bookcase for the session.

Owned reading runs through ordinary action selection and movement. `BookLibrary`
owns copy identity and location; `ReadingJourney` owns the person's fetch,
pickup, travel, reading and return stages. A seat order pins the furniture and
chooses an available shelved title. A bookcase order chooses a title and suitable
seating, with standing reading near the bookcase when no seat is available.
Household inventory cannot supply reading until a copy is shelved.

The journey reserves its copy and physical seat before travel. Pickup leaves
the copy on the shelf until its reach finishes; shelving leaves it carried
until that reach finishes. The return obligation survives interruption and
replacement orders, including urgent needs. A moved shelf changes the return
route; blocked access keeps the copy with its borrower while awaiting a route.
Death releases the claim and leaves the copy recoverable on the lot.

The render buffer projects active seated furniture, the current ordinal resolved
from its stable seat ID, and whole-furniture ownership. A travelling reservation
does not produce a seated body. Reading home shelf, slot and reach timing come
directly from the canonical journey and library. These are derived columns,
not additional saved ownership or browser timers.

The bookcase artwork stores each shelf row independently. Cabinet lighting uses
cabinet shadow blockers; each book row uses cabinet and same-row blockers. Books
do not cast shadows onto the cabinet or other rows. Actor lighting stays separate,
with fixed world-space shadow resolution. Exporters freeze evaluated pose meshes
before capture, compose stock and actor coverage before filtering, and verify
mixed inventories against independent complete renders. Pickup and shelving use
the same authored geometry with opposite phase order.

Generated coverage records retain their original numeric indices while identical
immutable payloads share one value. Identity includes dimensions, crop, encoding
and pixel bytes. This reduces generated-source size without changing picking or
alpha samples; consumers must not mutate shared coverage records.

Reading progress and familiarity belong to the Sim and title, independently
of the physical copy. Fractional work survives interruption. A reading pass
captures its novelty factor once and retains it across sessions. Entertainment
and satisfaction use that factor; physical seat comfort does not. The shared
effective-benefit calculation combines the authored action with reading tuning,
so scoring, reward delivery and browser facts use the same seat multiplier.
Earned satisfaction is retained with the journey until settlement, avoiding
loss from repeatedly adding tiny values to the meter.

Work and reward rates use a fixed reference hour. `session_ticks` limits elapsed
reading time; it does not redefine reading speed, work units or physical comfort
per minute. Scoring uses the expected work and elapsed time within that cap.
Interchangeable copies share one choice per title and seat. The same helper
selects the best available route for both action scoring and execution, with
stable identity and coordinate tie-breaks.

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

## [D7] Pathfinding

The current one-lot alpha uses deterministic tile-grid A* over the complete
static lot. The room graph and lazy segment plan below is not built yet; it is
the route from that working alpha solver to the population targets in [D3].

Interior walls now occupy cell boundaries, not blocked floor cells. A* and
distance fields use the same symmetric edge-crossing rule as object and
conversation contact. Doors are explicit open edges. When an agent changes
route between cell centers, its new path first returns to the rounded center
before turning; this prevents a diagonal shortcut through a wall endpoint.

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
option, not the current format. Version 2 wraps the frozen V1 world snapshot
with explicit saved architecture. Version 3 adds runtime furniture directions
outside those frozen records. Continuation is tested across save/load.

Storage is **OPFS** (Origin Private File System), not `localStorage` - real
file handles from a worker, subject to the browser's storage quota.

The worker queue serializes file I/O, but the player operation begins one layer
higher. `PersistenceController` exclusively owns Save, Load, or clear before it
captures simulation bytes and until any loaded world has been applied. During
that interval the three persistence controls are disabled and autosave waits.
Serializing only the worker calls would leave snapshot capture outside the
lock, allowing Load or New game to finish and then be overwritten by older
intent queued behind them. A named Web Lock serializes file operations across
tabs. Missing Web Locks fail without writing. A failed load pauses manual
saving and autosave until a successful load or confirmed New game, so a
freshly initialized household cannot overwrite a rejected save.

The raw prefix is `TERRISAV` plus a little-endian schema version. New saves
use version 8; the version 1 decoder and its historical optional sleep-pressure
tail repair remain supported. V2 and V3 decoding require complete consumption
and never apply that repair. All versions carry a content-compatibility digest in the world
payload. It observes numeric meanings the
snapshot cannot validate by authored string id, including interaction and
flyout row order, social order, chain step structure, object station-role
mappings, footprints, trait state kind, and the current-content front door a
restored career still follows. Missing object, career, trait, chain, and
carried-item ids are validated directly. Known fingerprints from the retired
full-pack algorithm map only to the exact reviewed replacement shape; they do
not bypass normal snapshot validation. The local, unpublished bed-assignment
extension also hashes ordered sleep-place IDs and canonical approach tiles.
Only its pinned live and reconstructed pre-rotation shapes inherit the prior
bridges. Access rules apply to newly selected routes; valid saved paths retain
their geometry across migration and subsequent re-save/load cycles.
The one shipped household rename is
also gated by that legacy match rather than by a name string alone. The next
incompatible published wire shape must bump the version and make an explicit migration
decision.

V2 and V3 saves store either explicit cell walls, explicit wall/door edges, or the
frozen legacy authored-wall presentation. The latter preserves V1 custom
worlds whose collision bitmap does not identify wall ownership. Loading V2/V3
uses its saved architecture, not the latest `lot.toml`. Loading V1 upgrades
only the exact reviewed shipped layout: its 34 object placements and complete
28-wall collision bitmap must match. The edge conversion clears only those
28 wall cells and preserves all entity and activity state. Custom V1 layouts
that pass the existing content validator keep their old architecture. The
separate bathtub migration retains its narrower compatibility gate.

V3 contains `world: SaveSnapshotV1`, `layout: SavedLayout` and a required
`object_facings` list. Restored directions are resolved before saved-wall,
route and contact validation, so those checks see the actual rotated footprint.
An invalid candidate never replaces the running world. V1 and V2 cannot store
runtime directions and retain their historical authored-direction restoration.

Before replacing an older primary save, the storage worker retains its original
bytes in `terri-save-1.v1-backup.bin`, `terri-save-1.v2-backup.bin`,
`terri-save-1.v3-backup.bin`, `terri-save-1.v4-backup.bin`,
`terri-save-1.v5-backup.bin`, `terri-save-1.v6-backup.bin` or `terri-save-1.v7-backup.bin`, according to its
source version. It never replaces an existing recovery file. A backup
with the wrong header or a backup write failure blocks the primary overwrite.
New game clears only `terri-save-1.bin`. Recovery copies are retained for
deliberate recovery, not automatically restored over newer progress. Browser
storage clearing can still erase all copies; this is not an external backup.

The lock does not detect stale progress from another tab. Two supported game
tabs still use last-writer-wins storage; play a household in one tab. A cached
V2 writer rejects a primary V3 header instead of overwriting its directions,
a cached V3 writer rejects a primary V4 header instead of overwriting its
retired indices, and a cached V4 writer rejects a primary V5 header instead of
overwriting its colourways. A cached V5 writer rejects a primary V6 header. A cached V6 writer rejects a
primary V7 header. A cached V7 writer rejects a primary V8 header. The storage writer and load-status controller share the current
wire version; a regression test sends actual simulation saves through the storage
worker so fabricated header fixtures cannot conceal a version mismatch.
Earlier V1 workers do not have that protection or participate in the lock;
close stale game tabs before continuing. The worker checks file
headers, not full payload validity; recoverability is established by loading
the retained real fixture, not by the filesystem mock tests alone. An
unsupported or unreadable primary header discovered before a current write is
rejected without replacing the file.

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

The version 8 save envelope wraps an explicitly frozen version 5 layout with a stable action
manifest, the owned-book library, physical-seat claims, reading journeys,
deferred career departures, current order metadata, chain origins and active
recipe-order identity. `SaveSnapshotV6` retains its historical Rust API name;
the byte header identifies the current schema. New commerce commands append AutoPurchase, Sell and Recover after the three original book command tags. V6 and V7 decode their frozen three-variant command vocabulary and reject newer tags. V8 accepts household-wide book fetching while older envelopes retain their original shelf-origin validation. Commerce quotes include the exact price and copy or reserved slot identities; native execution rechecks the quote before changing ownership or Funds. Preview choice and slot allocation derive from saved taste seed and copy identity without consuming simulation randomness. Its `current_legacy` adapter uses
the exact `FrozenCurrentV5` field layout, so later additions to `SaveSnapshotV5`
cannot shift this envelope's boundary. Earlier version 6 book saves use
`FrozenSaveSnapshotV6` and `FrozenPreAffinityV5` explicitly before conversion.
The manifest maps saved object, social and
advertised-chain action rows to authored IDs. Loading checks the referenced
models' physical structure, active chain semantics, voices, trait state kinds
and required station roles before rebuilding runtime indices. Unrelated content
additions do not invalidate an otherwise compatible save.

Every active `ChainState` has one `SavedChainOrigin`, owned by a living Agent with
Needs. Public origins name the model, action, recipe and selected step; internal
origins name their procedure. Selected-use state records the concrete station,
completed use, or an explicit published-migration pending selection. Origin-only
models remain in the action manifest even after their placed appliance is sold.
Unknown, duplicate, missing, extra or mismatched origins reject before adoption.

Published saves did not retain an initiating appliance. Migration preserves a
validated designated-step target where available. Otherwise a known shipped
binding can enter explicit legacy-pending selection and retain the old deferred
station choice until that step is admitted. New starts require a concrete selected
entity. Current loading validates this saved state; it never infers a historical
origin merely because current origin data is missing.

Version 1 through version 5 imports first validate against the applicable
pinned published pre-books content pack. Source selection distinguishes the
pre-skills, skills and later affinity/chore contracts. Present empty tails
remain authoritative; skills alone cannot identify the later published layout. Only a
validated household is converted to current content. The book migration ends legacy reading without a physical book and grants
the starter titles once. It preserves Funds and simulation time without drawing
from the simulation's random state. Older field repairs retain their published
migration rules. The
retained inputs and representative saves live in
the `pre-books*` directories under `crates/terri-data/tests/fixtures/`.

The older false `dining_table.sit_properly` action has a narrow compatibility path.
Validate its exact known source model/action structure before removing its
active target, queued or pending orders, matching wait/boundary claims and
obsolete action memory. Preserve unrelated progress and grant no completion
reward. Compatibility validation temporarily uses a cached immutable compatibility
pack for that specific retired definition, then validates and adopts the cleaned
current state transactionally. Cache by immutable destination-pack identity;
do not leak a new pack per load or make arbitrary missing actions optional.
The later published chair-backed Sit action and contextual Eat prepared food
remain active. Do not apply the older retirement merely because an action has
the same ID; validate the source contract first.

Current loads reject historical migration markers rather than silently treating
a malformed current envelope as an older save. All owned copies, home slots,
borrowers and title memories are validated in the candidate world before adoption.
Current adoption does not run historical repairs or draw new random values.
Pending reading satisfaction is bounded by recorded work, captured novelty and
permissible payout modifiers. A person's current condition cannot serve as proof
of its severity throughout the earlier reading period. An accepted housemate edit
can also change disposition and trait membership. Preserve the relevant earlier
reward contexts with their actual work intervals instead of validating all earned
reward against the person's latest traits. Record contexts only while reading
advances, coalesce unchanged contexts and bound their count by the session's
elapsed ticks; paused edits must not grow a history without work.
Historical snapshot helper methods remain available for compatibility tests; use
the current versioned byte API for complete household persistence.

Each player order has an ID within its Sim's queue and may name a book title.
Two orders for different titles on the same object/action remain distinct.
Clearing or filtering a queue keeps its allocator, so a later order cannot reuse
an ID still held by an in-progress activity. Current persistence stores the
ordered entries and allocator separately from frozen historical intent records.
Survivor cleanup retains complete entries rather than rebuilding them from bare
object/action pairs.

Book commands share the serialized command drain. Version 7 records their exact
positions among ordinary commands without extending frozen `SavedCommand`
records. A historical structural snapshot cannot preserve this new state;
current replay tests use the complete current envelope, while historical wire tests start from the
explicit source-era constructors.

Published ordinary chore commands retain wire numbers 23 through 28; Book
follows them at 29. Complete queue annotations include ordinary, book, cleanup
and chore entries, retaining their IDs and order. A zero queue limit means
unlimited. Mandatory book returns also block automatic chores and suspended
chore resumption, including waiting for a blocked return route.

Saved reading state includes the exact originating order, copy, seat, shelf
contact, reach timing, fractional work and unsettled satisfaction. Install that
state before spatial validation so a fetch path is checked against the shelf
instead of the eventual seat. A deferred career departure retains the original
scheduled shift and starts the normal full shift after the return obligation
ends. It cannot depend on encountering the original start tick again.

An owned-reading session samples its success or fumble once when reading starts.
Save that outcome through edits, interruptions and reloads. A completed session
or title awards one tagged practice attempt under the shared skill rules;
interrupted reading, fetching and returning award none. Title familiarity records
actual reading separately. General repetition changes appeal and mood, while
title novelty can reduce book enjoyment and satisfaction. Neither mechanism may
accidentally apply the other's penalty a second time.

Physical-seat records use saved entity indices and stable seat/action IDs.
Current saves must supply complete claims; only historical migration can derive
them. Aggregate ownership is checked before cleanup can remove evidence of a
conflict. A compatible old reclining action keeps its remaining time. An old
travel route can be changed to a legal approach without changing personal state.
A valid active meal with blocked chair contact can continue standing; a traveller
without a free approach retains food, chain progress and queued orders for retry.

Historical test constructors choose `Content::pre_books()` before creating
objects or people. They also use that content's seed and lot definitions.
Constructing a current household and swapping its content afterward does not
establish historical test data. Retained published save bytes provide separate
evidence from synthetic fixtures created by the current runtime.

## [D9] Content pipeline

Content is authored in TOML and compiled to a validated binary pack at build
time. **Built in M1a**, apart from hot reload, which is M1e.

`content/needs.toml`, `content/objects.toml`, `content/books.toml`, `content/lot.toml` and
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
- a `slots` value on a layered seat action or bookcase reading action, one
  that disagrees with the furniture's seats, or a count other than one on any
  other layered action except television, radio and sleeping
- a `default_action` that names none of the object's actions
- an incomplete or unknown interaction or chain-step `visual` contract, or a
  known action and anchor in a combination the owning social, object, or chain
  step cannot legally resolve
- a non-finite or negative number anywhere
- a missing or incoherent tuning knob: an absent field, a `choice_temperature`
  of zero or below (selection divides by it), a `min_interaction_ticks` of
  zero, a `wander_radius_tiles` outside `1..=i32::MAX`, a
  `duration_variance` outside `[0, 1)`, or an `idle_threshold` above
  `action_threshold` (a retained historical tuning-validation contract; these
  thresholds no longer exclude ordinary autonomous candidates)

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
trait system uses disposition weights, capability traits backed by skill mastery,
and condition state instead. A capability without a matching skill retains its
saved trait-state fallback. A future predicate gate needs its own accepted design.

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

`buildInstanceBatch` packs dynamic instances once and publishes the actual written
row count, including floor-tool highlights. Main draws `batch.instances` with
`batch.count`; it does not repeat interaction selection or traverse entities to
reconstruct that count. The batch object and its high-water-mark array are borrowed,
module-owned storage, valid only until the next call through `buildInstanceBatch`
or the legacy `buildInstances` wrapper. Only the first `count` rows are live;
unused capacity is neither cleared nor inspected. `instanceCount` remains a legacy
verification helper, outside the production frame loop. The 16-float row layout
and renderer draw interface are unchanged.

Short walls form a second atlas draw after opaque geometry, in the same render
pass and submission. This small batch is sorted at geometry rebuild, tests the
opaque depth buffer without writing it, and updates only its local fade opacity
each frame. The entity buffer is never sorted. See
`docs/specs/2026-09-30-cutaway-walls.md` for adjacency and build-mode rules.

Edge-wall pixels use depth from the authored wall plane. Rectangular furniture
uses the midpoint of the viewing column's intersection with its oriented
collision footprint. Its occupied composite, foreground and indicator share
that geometry; placement previews use the candidate footprint. Square footprints
retain constant depth. This is a 2.5D ordering model for disjoint footprints,
not a reconstruction of each sprite's 3D surfaces or overhangs. See
`docs/assets/review-evidence/wall-clipping.md` for pixel and mutation checks.

The shipped art direction is **Muted Line**. Its isometric atlas combines
historical procedural sprites with reviewed offline Blender renders. Current
explicit-edge architecture uses its own paired colour/depth resources.
The approved rig supplies character animation frames in three shirt colours;
furniture exports supply consistent facings and, where implemented, matched
occupied layers. Those models are authoring sources, not live 3D objects.
Per-instance colour shifts and emissive strength apply to the sprite atlas
without an extra draw. See TECH_STACK.md and the asset review evidence for
the pipelines and their visual acceptance limits.

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

Floor coverings retain stable IDs and sparse saved tile records ([FL-save]). All loaded layouts use authored boards, tiles and carpet; shared world diamond vertices own coverage, and pattern phase is anchored to world coordinates. Existing content colour values apply relative to the baked art baseline. The finish catalogue separates geometry, pattern and palette; active patterns alone consume resident texture slots. Unpainted house floors use pale tile, yard uses grass and street uses asphalt. Historical sprite data and the architecture-disabled renderer path remain compatible, but the game enables authored floors after Load.

Whole windows store a model and canonical start in appended layout variants. The nine models span one, two or three lines on either axis. Historical window lines decode as Sash placements. Shared validation handles fit, replacement, removal, Room edits and load; it rejects partial spans, junctions, overlap and coordinate overflow before committing layout/grid changes. Historical command and layout encodings remain unchanged. The bridge exposes whole-window preview/result APIs while preserving the old expanded-line getter.

The architecture renderer uses accepted colour and paired R16Float local depth. Finish alternatives add carrier/role data and bounded pattern textures; unchanged surfaces retain accepted pixels. Wall pieces share physical depth across splits, and floor tiles share canonical vertices. Geometry rebuilds on layout, camera and lighting changes; local cutaway fading updates retained rows without rebuilding architecture. See the [source guide](../assets/models/architecture/README.md) and [verification record](assets/review-evidence/architecture/verification.md) for resources, proof boundaries and current acceptance status.

Daylight indoors works the same way ([OS-daylight] in
`docs/specs/2026-09-22-the-outside.md`). `render/sky.ts` floods sky exposure
in from every tile outside the house, losing `daylight_reach_per_tile` per
step, passing doorways and stopping at walls, and is rebuilt with the lamp
field. Each instance carries its tile's shade (one minus its exposure) in the
spare fourth float of its colourway attribute, instance slot 15; static rows
bake it with the camera block, and people, furniture, doors and the placement
preview sample it per frame. Markers (the selection and footprint rings, the
tile highlight and activity bubbles) stay unshaded. The sprite
uniform grows by one vec4, `sky`, whose first float is
`interior_daylight_shade` times the sun's strength, or 0 in flat light. The
shader multiplies the ambient by one minus that times the instance's shade
before a lamp's lift, so a lamp still lights a shaded room. Like the lamp
field, it adds no draw, persisted state or world-hash input.

The shell recognises a light by any of its four directional sprites, a set it
builds by appending each turn's suffix to the light's base sprite name. That
is the rule the content compiler follows for a sprite drawn facing south-east,
as the lamp and the television are, so a turned lamp or television keeps its
pool and glow ([B-rotated-lights] in FEATURES.md) while each light is named
once, by its base sprite. A new kind of light is still added by hand, to
`lighting.ts` and to the expected lights in `buy-tool.test.ts`. That test, on
the real simulation, checks that every catalogue item, and any foreground
layer it has, glows in each facing it supports exactly as in its default
facing, and that only the lamp and the television glow; `lighting.test.ts`
checks each turned light's pool.

Walking uses append-only visual action 5 and eight model-rendered limb frames per
facing. Render sync projects a fallback facing from the next path
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
to opposite lot-axis facings and the shell selects one of four rig-rendered
frames for that facing. Simulation tick and stable entity id choose the frame
on a four-tick hold, preserving the earlier sixteen-tick full cycle. Reduced motion
keeps frame zero, so the directional action remains legible without ornamental
alternation.

Eating extends the same two-column contract without widening the bridge.
The current snack and meal eating stages declare `eat / station / toward_anchor`. Historical in-flight standalone snacks retain their `eat / object / toward_anchor` contract. Render sync requires the
exact active interaction or chain step, resolves its exact target object, and
faces toward the centre of that object's authored footprint. Malformed or
unauthored state emits no pose. The shell maps action code 2 to four
rig-rendered hand-to-mouth frames per facing on an eight-tick,
stable-id phase. Exact snack eating draws the dedicated sandwich prop and a
valid terminal dinner draws the existing dinner prop; both follow the active
exported hand anchor of the same selected body frame. An exact authored snack and a valid authored dinner
work step project the existing `EATING` activity so the fork bubble remains visible. A
valid sleep-tagged interaction projects `SLEEPING`. Every other ordinary use
of the legacy shared `Eating` component projects the append-only
`USING_OBJECT` activity code 7 when no narrower activity is authored. Ordinary
interactions and chain steps may author presentation-only `activity` metadata.
Render sync validates the exact running target, interaction or chain station
before publishing that code. Codes 12 through 23 distinguish showering, toilet
use, television, lying down, handwashing, dishwashing, radio, correspondence,
bathing, ingredients, preparation and cooking. Existing body-action precedence
remains authoritative. Generic object use never selects eating body art.

Activities and waiting have distinct 26-pixel bubbles, exported at texture
density two. Walking toward an activity has no bubble; unauthored generic use
has a gear. Idle Sims draw no bubble, and at-work Sims remain off the lot.
Actual blocked waits and reserved conversation waits share the clock.
The icons append after the historical atlas and use the displayed body's
content top and its occupied owner's footprint depth projection. See
`docs/specs/2026-10-01-activity-bubbles.md` for the complete pairing inventory.

Seated reading adds an object-local action position without widening the
render bridge. Definitions author sockets relative to their base-facing
footprint centre. `ObjectFacing` stores runtime direction with stable codes
SE=0, SW=1, NW=2, NE=3. `CompiledObject::footprint_at` and `sockets_at`
apply the turn relative to `base_facing`; the bathtub and desk already use SW
as their base. Every current authored placement retains its art and geometry.
Dynamic desks use the SW default art with their existing 2x1 collision shape.
`apply_object_placement` updates origin, direction, sprite, foreground and
resolved sockets together. Runtime geometry readers use `placed_footprint`.
Unsupported directions lack matching primary or required foreground art and
cannot be applied. The compiler checks sockets for every supported direction.
Authored and rotated sockets use the same bounds predicate, after resolving
their coordinates against the appropriate footprint. The authored check stays
before interaction compilation so invalid content keeps its existing diagnostics.

Save V4 ([SL-save] in `docs/specs/2026-09-22-selling-furniture.md`) is V3 with
`retired_indices` appended: the entity indices sales have retired. A sale
despawns without freeing its index (`despawn_no_free`), so no later spawn can
take it, and records it in `RetiredIndices`. The loader keeps those indices out
of use and frees every other gap in the saved numbering as before, as older
saves and test worlds with holes rely on. The retired list is bounded like
saved entity indices and hashed. V1, V2 and V3 still load, with nothing
retired.

Save V5 ([RC-save] in `docs/specs/2026-09-22-colourways.md`) is V4 with
`object_colourways` appended: each placed object not in the first colourway,
as its entity index and the colourway's content id, ascending. A colourway is
a `Colourway` component holding an index into the content pack's colourways,
never stored for the first, so the world hash gains its colourway section only
when some object has one. The render buffer carries a colourway column, and
each GPU instance a colourway shift the shader applies before lighting. The
writer emits V5, and the browser's storage worker keeps a V4 recovery backup
on the first V5 write; V1 to V4 still load, with every object as drawn. A
colourway is set by `SetColourway` (wire code 12) or bought with the object by
`BuyObjectInColourway` (code 13), each a lot edit.

`AddHousemate` (wire code 14) drains with the lot edits too, though it edits
the household rather than the lot ([CS-command] in
`docs/specs/2026-09-22-create-a-sim.md`). It is checked whole, and only then
issues a sim id and spawns the newcomer through `household::spawn_member`, the
same function that spawns the shipped household from content, so a newcomer
is made exactly as the others were. Its result is `last_housemate_result` on
`LotEditState`. A staged move-in saves as `SavedCommand::AddHousemate`, its
personality and traits by content id, and the world hash reads it by those
ids and never by the name. The newcomer needs no save change: every field it
has is one every household member already saves.

Save V3's required `object_facings` list sits outside the frozen V1 world and
V2 architecture records. Explicit entries preserve direction even when a
dynamic object shares an authored placement's id and position. Historical V1
and V2 payloads still load; absent directions use the matching authored
placement or the definition's base. Duplicate, invalid, non-object and unsupported entries
refuse before the live world is replaced. Sockets and sprite indices remain
derived presentation. Non-base direction changes enter the deterministic hash.
Base directions enter the content digest, so changing their geometry meaning
closes the old compatibility bridges. The exact new destination digest
`4dab6950757c1f15` inherits the published D and B shapes; the frozen bathtub
source `93b0a49525ce6e0c` retains A's distinct migration and legacy row rules.

The trait library moved that destination once more, without touching the wire
format. Trait ids and kinds are in the digest, so appending twelve traits
produced `c2cf291984ed61f7`, and the bathtub source rebuilt from it became
`d396b3f39e3c6685`. Both accept every published digest their three-trait
predecessors accepted, and a save carrying `4dab6950757c1f15` loads into the
new shape unchanged. One unpublished value is no longer accepted: the old
rebuilt source's own exact digest `93b0a49525ce6e0c`, which no public build
ever wrote into a save. The
bridge is sound because a save names traits by string id and every old id keeps
its old kind; tests pin both ends of it, so any other structural edit closes
it. Adding another trait needs the same bridge again: see [TL-old-saves] in
`docs/specs/2026-09-21-trait-library-and-traits-panel.md`.

Furniture preview and commit share `validate_placement`. It reconstructs the
fixed architecture from `SavedLayout`, then proves the live occupancy and wall
edges match that architecture plus every placed object. It does not infer walls
from blocked cells or replace saved architecture with the current content lot.
The candidate must preserve usable interaction approaches, continuous Sim routes,
and the front door and return landing. Reserved or targeted furniture cannot move.

`PlaceObject` is an appended command variant. The single command drain validates
again against the then-current world before replacing geometry atomically.
Queue acceptance is not placement success: the shell reads `lastPlacementResult`
after draining. Nonempty command queues contribute their complete ordered contents
to the world hash; empty queues retain the historical hash behavior. Save V3
preserves pending placement commands as well as applied directions.

`SetWallEdge` is the second lot edit, appended after `PlaceObject`
([WT-command] in `docs/specs/2026-09-21-wall-tool.md`). It makes one boundary
between two tiles open, a wall or a doorway, and changes only the saved
`EdgeWallsV1` list and the grid's edge barrier, so the save record does not
change; the command enums gain an appended variant. `validate_wall_edit` and
`validate_placement` share `current_layout` and `prove_lot_usable`, so a wall is
held to every proof a furniture move is. Those proofs flood the floor from the
front door's tile, or from the first walkable tile on a lot with no front door
([RD-root] in `docs/specs/2026-09-22-reach-from-the-door.md`), so on a lot
with a front door, floor that nobody and nothing needs may be sealed off. A
wall must then pass the V3
loader's own grid checks on the candidate (`save::candidate_grid_loads`), so an
accepted wall can never leave a save that refuses to load. A legacy layout is
refused rather than given a guessed edge list. The world hash includes the
saved edges of every edge-wall world, sorted by line with their doorway flag.

`BuyObject` is the third lot edit, appended after `SetWallEdge` ([BM-buy] in
`docs/specs/2026-09-21-buy-mode.md`). It spawns one object at a validated
rectangle and takes its price from Funds in the same drain. Moves and
purchases share `plan_rectangle`, which takes the object being moved or none,
so a bought chair is held to every rule a moved one is, the loader's grid
checks included. A purchase staged at save time is saved by object id rather
than pack index, because the save digest does not cover object order, and the
world hash reads it by the same id. The world hash also reads which object
every placed entity is, by the same id digest ([BM-hash]), because buying made
that a player's choice.

`BuildRoom` is the fourth lot edit, appended after `BuyObject` ([RT-command]
in `docs/specs/2026-09-22-room-tool.md`). It walls the outline of a rectangle
of tiles in one edit, with an optional doorway, and changes only the saved
`EdgeWallsV1` list and the grid's edge barriers, as a wall does. The
single-wall rules live in one function, `check_new_walls`, which a wall calls
with one pair of tiles and a room with its whole outline; the usability proofs
and the loader's checks run once, on the finished room.

Interior doors ([DR-derived] in `docs/specs/2026-09-22-interior-doors.md`)
are presentation only. `portals::interior_door_lines` and
`interior_horizontal_door_lines` derive them on both axes of an edge-wall house
with the authored front-door style. `sync_portals` appends vertical then
horizontal rows after the front door, deriving state and openness from saved
positions and walks. Previous openness is retained only for interpolation and
reset on load or a changed doorway list. Nothing is added to the save, digest
or world hash. The shell selects one of nine model poses in four orientations.
Paired surface-depth textures sort the solid leaf and joined casing per pixel;
the flush threshold follows floor ordering. See `assets/models/doors/README.md`.

The lot has a house and a yard ([OS-grow] in
`docs/specs/2026-09-22-the-outside.md`). `CompiledLot::house` is the house's
size from the lot's north-west corner, and every other tile is yard: walkable
floor to the simulation, drawn by the shell as the floor under the lot's
`yard_look` colour shift. Neither is saved. The house's east and south walls are
ordinary wall edges, and the front door stands on the east one, its line a
doorway that `portals::front_door_lines` names from the content, never from the
presentation-only portal rows: the front door swings for a sim walking through
it as an interior door does, no interior door is derived on it, the Walls and
Room tools never make it a wall, and every lot edit keeps the yard tile beyond
it open floor the door reaches. A save whose grid is exactly
the house, with edge walls, grows into the lot as it is adopted
(`save::yard::grow`, [OS-migrate]): the grid takes the lot's size with every
saved tile where it was, and the content's walls outside the house follow the
saved ones. No coordinate moves, and the save digest does not cover the lot's
size or walls, so every existing save still loads.

`LotEditState` carries a transient revision and the last result, outside saves
and deterministic hashes. A successful edit marks only that object's render
samples discontinuous, so a paused furniture move snaps into place without
resetting other Sims' walking interpolation. The shell uses the revision to
invalidate geometry-derived caches; successful Load must reset selection even
when the replacement revision happens to equal the previous one.

Only `reading_chair.settle_in` currently authors
`read / object_socket / socket`. Render sync requires matching `Eating` and
`Target` object and interaction identity, the exact target entity, its position,
its socket carrier, and an in-range compiled socket index. A valid match emits
visual action 3, activity 8, the socket facing, and the socket coordinates as the
row's displayed position while leaving ECS `Position` untouched. The shell
selects four seated-reading frames per facing on a 12-tick hold.
Conversation and eating keep precedence. Transition tracking uses full ECS
entity identities to reseed both interpolation samples on socket entry and
exit, including paused command refresh and Load, so the body never interpolates
through the chair. Physical pixel anchors preserve model scale and ground
registration despite padded image canvases. Malformed or
unauthored state falls back to generic object use.

The aquarium and exercise bike append two more exact object-action contracts
without widening the bridge. `reference_shelf.watch_fish`, whose historical
object id remains a Save V1 persistence key, authors
`watch / object / toward_anchor`. It stays on the adjacent path tile, faces the
aquarium footprint centre, emits visual action 7 and activity 10, and uses a
slow four-pose watching cycle. The aquarium object samples an eight-pose
swimming loop with independently phased fish bodies and tails. Each sample
holds for six simulation ticks; the cabinet, glass and registration remain
fixed. Reduced motion holds the quiet first object and body samples. The
historical two-frame aquarium records remain unchanged in the atlas.

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
11, the compiled seat facing, and the seat coordinates. The shell chooses four
52 by 104 sitting bodies per facing on a 12-tick, stable-id phase;
reduced motion pins frame zero. Activity 11 maps to the HUD label `Sitting` and
has a chair indicator. The compiled visual enum, render action code, and activity
code are append-only. The presentation does not add a simulation component,
save field, bridge column, object reservation rule, or world-hash input.

`bed.sleep` adds the first horizontal socket body and the first authored object
foreground. The exact `sleep / object_socket / socket` contract emits visual
action 9 and existing sleeping activity 5. The shell selects four 104 by 76
sleeping frames per facing on a 16-tick, stable-id phase; reduced
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
activity 8. The shell selects four upright reading frames per
facing on the same 12-tick, stable-id phase as seated reading. Reduced
motion pins frame zero. Conversation, eating, and seated socket reading retain
their existing precedence; every incomplete or surplus contract falls back to
generic object use.

The shipped Sim shares one approved face, hairstyle and body across
all Sims. Three material-only shirt palettes are selected from the persistent
render-buffer Sim ID: Tim (0) blue, Bill (1) green, Casey (2) red. Unnamed Sims
default to green. Entity IDs remain animation-phase inputs, not color choices.
`RIGGED_SIM_VARIANTS` holds each palette's clips; drawing, picking, bubble
placement and food attachment use the same selected body sample. No save
schema change is needed because persistent identity already exists.
Nine clips come from the preserved editable rig; a separate exercise source
adds two held poses per facing without replacing that source. The importer
requires all nine base clips and the exercise supplement for each of the three
palettes. The generated atlas tables are authoritative for sprite counts and
texture dimensions. Logical sprite dimensions and anchors remain independent
of texture density; a 2x texture does not double a Sim's size in the world.
The atlas compiler shares texture rectangles only when their dimensions and
decoded colour and alpha bytes match. Sprite identities remain separate.
New domestic animation clips remove empty borders using one envelope across
every frame, facing and shirt palette. Anchors, hand positions and content
height move with the crop so drawing, picking and activity bubbles retain
their world positions. Source exports remain unchanged. Packing chooses the
shorter valid result from shelf packing and maximal free-rectangle packing
at each supported width, without rotating artwork or exceeding the portable
texture limit. Published sprite canvases and registration remain intact.
The old two-pose exercise supplement used a mirrored bike whose non-SE
contacts failed review. The approved replacement bike and reading chair use
real four-direction furniture renders and matched visible contributions;
the bike has eight cycling phases and the chair four reading phases. The
historical mismatch is not a limitation of those replacement assets. See
`assets/models/furniture/README.md` and the furniture release evidence for the
export, contact and played checks. Runtime rotation controls are a separate
builder feature and must retain those direction-specific contracts.
CI runs the sprite-import and model-export unit tests before checking atlas
reproducibility, including the bike's actual neighboring-wall clearance.
`SPRITE_ANCHORS` controls both draw and pick offsets;
`SPRITE_CONTENT_TOPS` keeps transparent padding from lifting activity bubbles,
and `SPRITE_HAND_ANCHORS` attaches food to the selected eating sample. These are
presentation tables, not new save or simulation state. Near-surface chair
foregrounds use the existing object foreground path. The ordinary armchair's
socket faces SW in its default placement, matching its actual opening.

Save records simulation tick state, not a fractional presentation sample. Load
therefore reconstructs the walk frame from the saved tick-end position after the
ordinary render buffer reseeds previous and current position. It does not
promise to preserve an unsaved interpolation alpha from the instant the player
pressed Save; that presentation boundary already exists for travel itself.

## [D11] WASM/JS bridge

The simulation owns all state in WASM linear memory. JS holds
`Float32Array`/`Uint32Array` **views** over render-relevant slices, including
positions, sprite IDs, optional foreground sprite IDs, activity codes,
presentation visual actions, exact active socket target IDs, lot-axis facings,
authored object-sound actions, and their exact source entity indices, plus
compiled footprint width and depth, and feeds them directly into GPU buffers.
Walking reuses the
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
needs panel does not need 60Hz. Repeated text refreshes compare against the
actual DOM value before assigning `textContent`: an unchanged assignment still
replaces its text child and creates avoidable garbage. This is a write guard,
not another cache of simulation state.

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

## [D16] Audio shell

Audio is presentation owned by the TypeScript shell. The Rust simulation has
no browser audio types, nodes, volume settings, or playback state. The shell
translates observed outcomes into a small semantic event vocabulary:
`command.staged`, `command.rejected`, `ui.confirmed`, stable-identity
`sim.footstep`, recorded conversation start/end and household sleep cadence, personal eating,
reading, and exercise cadence, source-owned object sound start and stop edges,
and geometry-keyed door open and close events. Opening remains an observed state
transition but creates no voice; closing plays only `audio/doors/close-thunk.wav`.
The closing clip retains bounded demand loading, retry and lifecycle cleanup.
Staged means accepted into the command
channel; it does not overclaim that the simulation later started the intent.
Door audio samples the simulation-owned portal columns after fixed ticks, not
the renderer. First observations anchor silently; closed-boundary transitions
play bounded recorded cues. Semantic events do not imply audible feedback. Routine staged
commands and completed controls remain silent; `command.rejected` is the only
current routine-interface event mapped to a sound.

The `AudioContext` is created or resumed only from a trusted pointer or keyboard
gesture. Events before activation are dropped; emission never creates or resumes
the context. The master gain is mute-only and the effects gain owns procedural cues, object
recordings, and recorded conversation volume. A separate Voices gain feeds into
Effects for conversations only. Its saved default is one, including when loading
an older v1 preference record without that field. Changing Voices does not reset
transport or other schedulers; even at zero, conversation playback stays bounded and
advances normally. The simulation chooses two clip indices and
derives their duration from compiled voice metadata; the shell owns playback.
Each conversation has independent ownership: initiator ID, both words of its
derived completion token, and clip indices. Both participant rows project the
same identity. Ending one pair cancels only its playback and pending library
start, while global lifecycle boundaries still clear all pairs. See
`docs/specs/2026-09-30-conversation-audio-ownership.md`.
Failed voice downloads or decoding leave retryable slots. A new conversation
needing a missing slot may retry after a five-second monotonic cooldown; one
batch runs at a time, and successful clips remain cached. Pending replay never
triggers another fetch. Ended or globally invalidated conversations cannot start
when a late download completes. See
`docs/specs/2026-10-01-voice-download-recovery.md`.
Interrupted voice envelopes retain their current level before fading, bounded
by natural sample completion. Failed construction disconnects every created
node immediately, even if that node never started. See
`docs/specs/2026-09-30-conversation-audio.md` for rendered-sample proof.
Crossing either master mute or zero Effects clears footstep, shared-activity,
personal-activity, and object-sound scheduler state on both edges. The first
audible fixed tick therefore describes the current action instead of waiting
on cadence that advanced while silent or replaying motion accumulated there.
Visibility changes synchronously gate emission, stop voices, clear walking
phase, and serialize `suspend()` or `resume()` so the latest foreground state
wins an asynchronous race. Both visibility edges clear stride history. A later
trusted gesture remains armed in case an automatic foreground resume is denied.
While globally inaudible, fixed-tick audio frames still begin and end, but no
observations reach their schedulers. Their normal absence handling releases
object/conversation ownership and drops activity, stride and door history.
An unavailable frame boundary also disposes unfinished procedural, door and toilet
cues if they still have active sources, without resetting any open frame.
Recording cleanup uses retained counts so object and conversation releases
whose active owners already ended cannot survive the unavailable interval.
Automatic return to running therefore starts only current actions, without
requiring another gesture or replaying old motion. Fixed-tick boundaries sample
availability. A browser audio-context state event also stops every player and
resets schedulers immediately when the context stops running, including while
the world is paused. This observes browser state, not operating-system events
directly. See
`docs/specs/2026-10-01-automatic-audio-recovery.md`.
Pause stops fixed ticks, fades object loops and stops an active toilet flush.
It does not suspend the context or stop an already-playing short cue or
conversation. A successful Load reads
identity from the replacement world's aligned
render rows and clears transient audio only after the world was actually
replaced.

Footsteps follow travelled world distance after each fixed simulation tick.
They never follow render count or wall time, so 1x, 2x, and 3x preserve the
same stride phase. A retained typed-array scheduler keys tracks by stable
`SimId`, caps a burst at two steps, and discards overflow rather than replaying
it later. Stable identity travels in a `sim_ids` render column aligned with IDs,
kinds, positions, and actions. Household rows carry authored `SimId`; non-Sim
rows carry `u32::MAX`. The shell re-reads the zero-copy column after every fixed
tick under [D11]. Runtime topology may change the row set without rebuilding a
separate lookup, and no steady tick calls `simIdOf`.

Personal eating, reading, and exercise cadence uses the same retained-storage
rule: aligned typed arrays plus one Sim-ID-to-slot map, with dense in-place
removal and geometric growth. A normal fixed tick creates no per-Sim track
object, and the stress handle reports both active personal tracks and retained
capacity.

The release performance gate uses a visible production build on a display
configured at 120 Hz. A five-second paused calibration must achieve 118 to 122
animation frames per second with median interval from 8.0 to 8.7 ms; the active
cadence is then reported rather than inferred. `?stress=1000` runs 600 fixed
ticks with the first 60 discarded. Sampler p95 is at most 0.25 ms, sampler
maximum at most 1 ms, application-work p95 regression is at most 1 ms against
`&audio=0`, no application-work frame exceeds 16.6 ms, and steady `simIdOf`
calls remain zero.

Object and appliance audio cannot be inferred from broad activity or body pose.
Content authors a closed sound action on the exact ordinary interaction or
chain step. Rust validates the active `Target`, exports the action and exact
SmartObject entity index in two aligned columns, and writes none plus
`u32::MAX` on every inactive or invalid row. The shell observes these columns
before the stable-Sim-ID gate because source ownership does not depend on the
actor having a `SimId`. A retained typed-array scheduler uses one
source-ID-to-slot map, emits one start/change/stop edge per source, collapses
duplicates, and fails conflicting same-frame actions closed. It creates no
per-source JavaScript track object and grows no capacity after warm-up. Load,
backgrounding, first unlock, mute changes, and Effects crossing zero reset its
phase. Shower, stove and sink actions feed a source-owned recording
player with at most four active loops and eight retained records including
fades. Prepared recordings specify valid loop boundaries and gain. Its
production catalog shares one provisional flowing-water WAV between showers
(gain 0.6) and sinks (gain 0.35). Bathroom handwashing and kitchen washing-up
author sink action 3; existing action codes stay unchanged. Stove action 2 plays
a provisional first-party cooking texture at gain 0.6. Water and stove have
independent demand-driven fetches, decoded caches and five-second failure
cooldowns. New demand or an explicit load can retry; fixed ticks cannot.
Late completion reconciles only still-owned sources. Every effective pause stops object loops,
including blocking overlays; resume waits for a new fixed-tick observation.
Short cues and conversations retain their existing finish-on-pause behavior.

Ordinary interaction completion uses a separate transient presentation buffer.
Authored `completion_sound` metadata currently selects only toilet flushing.
`tick_interactions` emits on a positive-to-zero timer transition after validating
the exact live target and active interaction, before action state is removed.
An ordinary toilet action can interrupt a recipe. Retained `ChainState` stores
the suspended recipe and does not suppress its completion sound. Active
`StepWork` and the chain-step target sentinel remain ineligible.
Cancellation and active-sound disappearance cannot emit completion. The buffer
holds at most 64 packed action/source pairs, deduplicates within one tick and is
excluded from saves, hashes and RNG. Tick start, paused commands and world
replacement clear it. The browser drains it after every fixed tick and clears it
in `finally`, even when audio sampling is disabled. Missing or inaudible clips
drop that event; finishing a decode never replays it.

One cached flush recording preloads after an unmuted unlock gesture, including
while Help or Options still pauses the simulation, with
in-flight deduplication and five-second, demand-driven failure recovery. Flushes
run at their original rate, gain 0.08 before Effects, with four voices maximum
and one voice per physical source. Unlike the shorter door cues, an active flush
stops on effective pause as well as Load, mute, Effects zero and backgrounding.
See `docs/specs/2026-10-01-toilet-completion-audio.md` for verification status.

Fresh bridge wrappers are expected under [D11]. The allocation rule is no
allocation proportional to entity count and no scheduler capacity growth after
warm-up. Three alternating enabled/disabled memory pairs compare quiescent
paused endpoints after explicit garbage collection. Preparation exercises flush
playback, waits for expiry and verifies pause cleanup, then restores a shared
measurement fixture before the baseline. Matching baseline world hashes, ticks and loaded JS/WASM
response hashes are required. No world reset occurs during measurement; heap
snapshot callbacks mark a run diagnostic-only. The median audio-enabled
retained-JavaScript differential must stay within a predeclared 64 KiB allowance
while voices, tracks, capacity, DOM nodes, and listeners remain bounded. Broader
page and WASM growth is reported separately. A production 40-walker, 600-tick
scheduler run exercises retained audio state directly.

The voice-count getter can sweep expired records. Its zero result proves an
empty observed player, not natural `onended` cleanup without assistance. That
narrower claim requires passive inspection before a getter, pause, stop or later
play can release the record.

The stress-only browser handle exposes cumulative successful cue starts by
semantic cue name. The ordinary-Chrome listening harness pairs that counter
with the exact live visual action and Chrome DevTools Web Audio node creation.
No one signal is accepted alone: a queued command is not a started action, a
semantic event is not proof of a browser node, and an oscillator does not name
the sound that created it.

The first full run exposed a separate application bottleneck: 1,000 idle agents
and 34 placed objects triggered roughly 34,000 A* searches during one selection
tick. `select_action` now builds one breadth-first distance field per occupied
source tile, scores every candidate from that field, and reconstructs the chosen
route with the existing A* only once. Exhaustive tests pin field distances to
the old adjacent-A* lengths, so the optimization changes cost rather than
choice or route shape.

See `docs/specs/2026-08-19-audio-foundation.md` for the complete first-slice
contract and acceptance boundary.

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
satisfaction. At shift time, `Commuting` sends the sim to the street's exit,
the lot's last column across the yard from the front door, or to the front
door on a lot with no yard beyond it (`portals::street_exit`, [OS-street] in
`docs/specs/2026-09-22-the-outside.md`); `AtWork { remaining_ticks }` keeps the
off-lot countdown in deterministic world state; completion pays household
Funds, applies the authored costs and reward, and returns the sim to the lot,
walking home along a path to the door's landing. Which way a commuter is going
is read from where its walk ends, so the street added no save field, and the
exit is worked out from the content's door and the lot's width, so it added
nothing to the save digest. The normal HUD exposes the career, activity,
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


## [VA-seeds] Fresh new games and saved autonomy

The browser draws two words through `crypto.getRandomValues` and supplies the
64-bit seed to `SimHandle.from_lot_with_seed` before household creation. Fixed-seed
constructors remain for tests. Save V5 appends living-person self-preservation rows
outside the frozen V1 snapshot. Loading validates before adopting the world;
missing values draw from 30 through 70, inclusive, in stable entity order using
the restored RNG. Explicit zero is preserved. Both values and generator state
participate in the world hash. Details and tunables are in
`docs/specs/2026-09-30-varied-autonomy.md`.

## [Sleep-schedule-state] Per-person sleep timing

Household creation copies the selected personality's signed chronotype offset
into runtime state. Sleep scoring samples the daily curve at `clock - offset`:
negative values bring the schedule forward, positive values delay it. This is
a preference weight, not a forced bedtime.

V5 appends sparse `chronotype_offsets` rows after self-preservation. Each row
contains a living person's entity index and exact nonzero signed offset. The
loader validates ordering, uniqueness and ownership before adopting the candidate
world. Older saves omit the field and retain zero offsets. Frozen entity records
remain unchanged. The world hash includes nonzero offsets and their owners in
entity order; zero-only historical worlds retain their previous hash layout.
See `docs/specs/2026-09-30-sleep-schedules.md` for the verification contract.
## Domestic state and presentation

Queued generic chains retain their own order until completion. Active targeted
cleanup and directed timed chores own separate saved records, so the generic
order waits rather than adopting, replacing or being settled by their work.
First cleanup requests validate their target and route before releasing current
work. Serving, resumption and queue display use the same ownership distinction.

The published V5 skill and affinity fields follow dining. Targeted cleanup, `SavedChores`
and `SavedGrime` append after that published tail in this order.
`SavedChores` follows targeted cleanup.
It owns indoor grime, surface grime, bin contents and pending unbinned waste,
permanent-SimId profiles, scoped order records, timed work, weekly assignments,
daily decisions and settled outcomes. Its separate seeded random stream,
allocators and all future-affecting state enter deterministic hashing. Historical
nested save records and ordinary intent encodings remain unchanged.

The chores scheduler runs through normal ticks. Floor work captures reachable
dirty cells in one architectural room; surface and bin work claim one real
object and approach its footprint through the existing path mover. ChoreWork
suppresses ordinary autonomous selection while work is active. Other orders
and urgent needs can suspend work; cancellation releases its owned path and
marker. Room edits cancel invalid floor plans. Object movement refreshes
contacts, and selling a bin moves its contents to unbinned waste. Load validation
rejects unsupported work variants and contacts before world adoption.

Weekly assignments balance estimated work and sample chore preferences. Saved
daily opportunities separate willingness from enjoyment. Actual work completion
identifies its performer, updates commitment history and publishes bounded,
directional relationship effects once per episode. Active work crossing midnight
retains its original episode. The browser receives owned board/history arrays
and aligned grime columns. `grime-decals.ts` adds transparent stain sprites in a
separate atlas page, behind props on floors and at supporting surface depth.
Material colors remain unchanged. Grime has a separate opacity vertex buffer
and transparent draw between opaque geometry and cutaway walls, with depth tests
but no depth writes. The optional `SavedGrime` V5 tail owns its independent random
stream and exact active floor patches. Actual grime decreases during work; the
renderer, board and mood calculations read that same value. Movement emits dirt
opportunities only on real tile transitions; completed interactions provide the
surface and adjacent-counter opportunities. Passive aging is disabled.
Group kinds 4 and 5 append room-scoped counter
and table wiping; legacy kind 2 retains individual-surface orders. Group tasks
save visited and pending object identities and reconcile live room membership.
Claims cover the current member, with edge-aware contact checks after build edits.
Unavailable routes remain unavailable in daily history.

`chores/presentation.rs` derives actions 14 through 17 and progress in thousandths
from validated stationary work. The aligned `chore_progress` render column is
derived, not saved. Active bins receive the same progress as their cleaner.
`cleaning-animation.ts` samples mopping and wiping loops or the single bin lift
from that progress. Drawing and picking share the bin-frame selector. The
offline cleaning extension uses the approved Sim rig, registered anchors and
geometry-owned hand/tool masks in the existing complementary furniture-depth
passes. The historical `mealRows` support mapping also carries cleaning contacts.

Table action queries distinguish ordinary chair-backed sitting from claiming an
eligible prepared meal. Ordinary sitting reuses saved dining claims and appends
quiet paired sprites from the existing fitted dining pose; eating sprites and
published sprite indices remain unchanged. See the
[chores specification](specs/2026-10-04-chores-and-weekly-board.md).

Targeted dish cleanup adds explicit `CleanDishes` and `CleanDishesFirst` commands
after the published command variants. Runtime intents carry a scoped request
identity; the request contains a fixed dish selection or a continuing surface
target. The optional V5 `targeted_cleanup` tail restores scoped intents at their
original positions among ordinary orders, preserving published nested records.
Its allocator, target, selection, queue position and active state enter the
world hash. Command-boundary cancellation removes unused requests immediately.
Active surface chores refresh claims during collection and restart collection
after washing when dishes remain. Empty claims wait through simulation ticks
for another cleaner to collect or release the remaining dishes.

The browser reads surface, visual-setting and dish-identity triples from the
simulation. Pointer picking uses the renderer's surface layouts, prop sprites,
camera projection and furniture depth ordering. Dish menus dispatch captured
identities through the command bridge; surface menus dispatch continuing scope.
Prepared portions and carried dishes are excluded from surface picking.
Dish picking samples alpha from the same decoded atlas bitmap used by the
renderer. Transparent corners therefore remain furniture pixels. Pointer and
keyboard targeting share menu construction; keyboard cycling exposes each pile
as a separate target.
The copied dish projection is read before zero-copy render views, because its
boundary allocation can grow simulation memory and detach earlier views.

[Meals and cleanup](specs/2026-09-30-meals-and-cleanup.md) uses the ordinary chain counter, pathing, station work, terminal payoff, tagged skill practice and seeded RNG. Preparation excludes dish sinks; `meal_table` identifies dining tables and `dish_sink` identifies washing stations. Dining claims resolve exact physical chairs, clean settings and approach endpoints before generic chain targeting. Other diners stand near the table, or a preparation counter when no table is reachable. Claims publish synchronously, with ownership-aware reservation release. Other uses remain exclusive.

`SavedDomestic` is the appended optional V5 tail. It records cleanliness profiles, monotonically issued dish identities and their surfaces and responsible SimIds, canonical room-visit memory, exclusive cleanup claims, and shared-meal invite/claim/collection/completion state. Cancellation, chain replacement, washing, furniture sales and death maintain those references at their own transition. Loading validates both directions between claims and chains before adoption, then refreshes the render projection. Older bytes default the tail to absent. The exact structural bridge reconstructs the old four-step recipe and roles, validates the source, maps its terminal step 3 to 5, and preserves prior geometry migrations. Unreviewed structural destinations close the bridge.

Room membership is a flood fill across open saved wall edges; doorways separate rooms while furniture never does. Annoyance is a derived moodlet, and existing sustained mood integrates its effect into satisfaction. Directional resentment is charged once per creator newly noticed during a visit. [Sim interpersonal relations](SIM-RELATIONSHIPS.md) documents the composition with other social effects.

The render bridge adds aligned `dirty_dishes` and `meal_portions` columns. Surface stacks and up to three prepared plate sprites disappear on actual collection, rather than on a reservation. Visual action codes 10, 11 and 12 append prepare, cook and wash; four rig frames per facing and shirt color use a ten-tick phase. Reduced motion holds frame zero. Existing action codes, sprite-name prefix order and approved rig source stay stable.


`SavedDining` appends a separate optional V5 tail after the published domestic, sleeping-place, shyness and boundary fields; published
nested domestic records remain unchanged. It saves exact seats and settings,
stand locations, deferred cleanup opportunities, episode complaints and tableless
gathering decisions. The loader validates permitted contacts through these claims,
then validates every claim transactionally. Rendering exposes four dirty-setting
nibbles and a seated-eating action; the cooking prop follows the exact sound-source
station rather than the logical carried item. See [MC-dining](specs/2026-09-30-meals-and-cleanup.md#mc-dining-physical-chairs-and-dirty-settings).
