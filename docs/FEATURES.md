# Features

Status: M0 through M1c shipped; the alpha visual pass (A1-A5) shipped;
M2a footprints, M2a2 selection and input, M2b the five-room house, M2c
personalities and the household, and M2d relationships all shipped. Of
the A-11 visibility pass, PR 1 (the house looks right) and PR 2
(activity indicator bubbles, the ?debug=1 stats overlay, and the
right-click "Chat" talk command; see
docs/specs/2026-07-31-visibility-and-talk-design.md) are shipped;
PR 3 (camera pan and anchored zoom, wheel and pinch) shipped after the
owner's on-phone check. M2e shipped whole - the
satisfaction axis with hobbies (PR 1, [A-12]), the three trait
mechanisms (PR 2, [A-13]), and the career rabbit hole with the day
clock, the front door and household Funds (PR 3, [A-14]); see
docs/specs/2026-08-01-m2e-satisfaction-hobbies-career-design.md. M2f
shipped whole the same day - chains as content with station roles and
the hands rule (PR 1), the running chain with terminal-only payoff
and resume through every preemption (PR 2), and the carried-item
badges, flyout rows and errand line (PR 3, [A-15]); see
docs/specs/2026-08-01-m2f-multi-step-working-design.md. The M2g
code-owned slice is implemented: a versioned full-world snapshot,
transactional validation and restore, one OPFS save slot, daily autosave,
save/load/new-game controls, a readable normal-play HUD, first-run Help that
pauses game time and owns focus,
long-press actions, a visible Queue mode, keyboard world targeting,
clamped and focus-managed action menus, staging and post-drain queue-capacity
rejection feedback on keyboard and pointer routes, a dedicated command live
region that clears on the next order attempt and cannot be overwritten by
Save or autosave status, persistence-dialog focus recovery, and
responsive accessible controls. At phone portrait widths the existing HUD now
reflows into a safe-area-aware top-and-bottom dock around a pointer-transparent
canvas aperture instead of narrowing the desktop sidebar.
Queue-capacity feedback shipped in PR 46 at merge `abd2e736`, and the honest
generic object-use activity shipped in PR 47 at merge `38a03c15`. Their exact
Pages runs and deployed browser evidence are recorded in
[A-queue-capacity-feedback] and [A-object-use-activity-semantics].
The M1 household contract is now code-complete too: content accepts up to six
members, rejects a seventh, and normal play exposes every member through a
restore-safe accessible roster.
The shipped M2d relationship scalar is now visible in normal play too: a
responsive People panel merges the complete live household with the selected
person's sparse directional feelings, keyed by stable `SimId` across Load.
The M1 mood slice is implemented too: the selected-person HUD derives an
overall mood and ordered moodlets from needs, content-defined conditions, and
nearby directional relationships without adding cached or persisted state.
The owner's dark-comedy voice session remains open by design; see
docs/player-visible-strings.md. The alpha's eleven acceptance criteria live
in docs/alpha-goals.md.

The eleven were then run against the code-complete alpha systems rather than
against the milestone that shipped each one, and three did not hold: saving was
broken for 28.4% of ticks, the only sim with a job lived permanently at
zero on six of seven needs, and the reading chair was at zero uses over
the horizon criterion 3 names. All three are fixed; see
docs/specs/2026-08-01-alpha-acceptance-findings.md and [A-19] in
docs/alpha-feel-notes.md. **Criterion 11, the owner-authored voice, is
now the only one outstanding.**
Everything else is
proposed scope, not yet agreed in detail. Milestones exist primarily to
control [R6], which is the risk most likely to actually kill this project.

### Current priority guidance

On 2026-08-02, the owner asked to move visual quality, movement animation, and
action animation near the front of the next-work order. The grounded design and
renderer audit is complete, and the first movement slice now gives walking sims
a restrained, distance-driven footfall while keeping the ground ring and depth
planted. Carried-item badges follow the body, picking includes the lifted head,
and reduced-motion users retain smooth travel without the ornamental lift or
its otherwise useful picking headroom.

The first action-specific body animation is implemented for conversation.
`chat` authors a `talk / partner / toward_anchor` visual contract; the
simulation projects the real pair and four opposite lot-axis facings through
dedicated render-buffer columns. Each of the three Muted Line people has two
talk frames in every facing. Simulation tick drives the gesture, so Pause,
speed changes, replay, and Load agree; reduced motion keeps a static directional
talk pose.

Eating is the first complete object-action category. `Grab a snack` authors
`eat / object / toward_anchor`, and the terminal `Eat dinner` chain step authors
`eat / station / toward_anchor`. Render sync resolves the exact target and its
footprint centre, then the shell selects one of two directional hand-to-mouth
frames for the stable character look. The carried dinner follows the authored
hand side, and both authored eating paths keep the existing fork bubble.

Seated reading is the first object-socket action category. Only
`reading_chair.settle_in` authors `read / object_socket / socket`; the compiler
resolves its `seat` socket against the exact placement, and render sync projects
the active Sim's body to that socket without moving the gameplay position. The
shell maps action 3 to two fixed-envelope reading frames per look and facing and
activity 8 to a book indicator plus the HUD label `Reading`. Entry, exit,
paused cancellation, and Load reseed the presentation samples so the body does
not glide through the chair. Save V1, world hashes, bridge columns, and the GPU
instance contract remain unchanged.

Showers, toilets, television, bookshelf reading, washing, and other ordinary
object use instead report the appended `USING_OBJECT` activity. It is
deliberately text-only: one tiny generic glyph would misdescribe at least one of
those actions. Those actions remain unanimated until their own categories and
anchors are authored. Paid asset decisions remain outside this slice and off
the current critical path.

**The design language is decided: Muted Line, chosen 2026-08-03.** It is
original procedural art rather than a treatment of the borrowed sprites, so
the style is a palette, a shape language and a set of character-build
numbers that live in a generator. The plan is
`docs/specs/2026-08-03-muted-line-implementation.md` and the prototype it
was chosen against is `tools/art-prototype/`, which is wired into nothing.
The first options paper is superseded and kept for the record.

**Seven of its nine items are built.** The generator replaced every sprite
in the game ([ML-gen]), CI regenerates and diffs the atlas on every push so
it is a reproducible build output rather than a trusted blob ([ML-ci]), the
128-sprite cap is gone ([ML-sprites]), and **the day/night cycle is live**
([ML-ambient]) - the world tints with the simulation clock. Reduced motion
forces the same neutral flat-light mode available from the household status
panel without overwriting the player's saved lighting choice.

**Per-instance tint is in the contract** ([ML-tint]): an instance is two
`vec4`s now rather than one, the second carrying a colour and an emissive
strength. The lamp and the television are emissive, which is what stops
the two things lighting the room from going out as night falls - the
defect [ML-ambient] created by existing. The frame is still one draw and
one submit; the tint rides on data the vertex stage already carried.

**Nighttime light pools and cast shadows now use that channel** ([ML-pools]).
The floor lamp and television emit neutral stepped tile fields with different
profiles. Interior walls block the four-way flood, doorway gaps pass it, and
wall panels sample adjacent lit floor. Every smart object casts a one-tile
`+x` shadow from its compiled footprint; Sims retain their baked contact
shadows. Pools also reach Sims, objects, and carried badges on the affected
tile. They add no geometry, draw call, submit, pipeline, or simulation state.
The selected-Sim ring has its own full-emissive pale outer key, so nearby light
cannot wash out the command target. The watched midnight build measured that
key at 4.41:1 against the brightest adjacent lamp-lit floor and 5.50:1 against
the darkest sampled floor. PR #45 merged the slice at `ef9f86c`; the deployed
GitHub Pages revision then showed the same pools and Flat control at 1280 by
720, preserved the mobile HUD at 390 by 844, and reported no browser warning or
error. The remaining physical-phone daylight check is still open.

**The household is Tim, Bill, and Casey, three different people** ([ML-chars]),
keyed on each sim's stable entity id so a face survives a walk, a save and a reload.
Three baked looks rather than the three tinted instances per sim the spec
proposed - the reasoning, and what would flip it back, is written down in
`assets/sprites/gen/style.py` beside the palettes.

**Save V1 survives the patch classes it can identify honestly.** The old
fingerprint hashed the whole serialised pack, so every balance or art deploy
invalidated every save. The replacement hashes numeric meanings the snapshot
cannot validate by authored id: object footprints, station-role mappings and
interaction/flyout row order; social order; chain station and carried-item
transitions by step; trait state kind; and the front door a restored career
still reads from current content. Balance, labels, art, household names, and
declaration-order changes to string-addressed tables do not move it. Missing
string references still fail normal snapshot validation.

Every distinct full-pack fingerprint emitted since Save V1 launched has an
explicit bridge to this one reviewed shape, so deployed saves migrate rather
than being discarded. The old household names migrate to Tim, Bill, and Casey;
that rename runs only for a recognized legacy fingerprint, and an arbitrary
saved name is preserved. A current-format save may even reuse an old cast name
without Load rewriting it. This is still one global digest, so a new object or
trait changes it even when one particular save never used that definition.
Fixing that false rejection belongs to a future schema that stores stable ids
beside every numeric row, not to a hash pretending it knows more than it does.

**Sleep costs less than being awake.** Needs decay at
`asleep_decay_scale` of the usual rate while a sim is asleep, the same
knob shape as `at_work_decay_scale` beside it and for the same reason:
sleeping is the longest thing a sim does, so at the full rate the sim who
finally goes to bed wakes starving and filthy, punished for doing the one
thing every other system was pushing it toward. 0.4 rather than 0, because
a bed that suspended the simulation would be a place to hide from it.

**What counts as asleep is a TAG**, `sleep_tag` in `tuning.toml`, read by
three things: the drive that makes a bed attractive at night, that decay
scale, and the Zzz bubble. It used to be an inference - whether the
interaction's biggest positive advert was energy - which is true of a bed
and equally true of a coffee machine, so the first espresso in the
catalogue would have drawn a Zzz over a sim whose hunger had stopped
moving. Objects already declare tags; the answer was authored all along.

**The circadian rhythm is built and switched off**, which is a deliberate
state rather than an unfinished one. Schema, validation, curve, tests,
chronotype offsets, `sleep` tags and the selection multiplier all ship;
`content/tuning.toml` carries the `[circadian]` block commented out.
Turning it on needs the measured run [ML-feel] requires, because the first
draft's curve had the household asleep enough to starve an unrelated test
fixture of kitchen activity. That is the drive overpowering the needs
rather than weighting them, and it is a tuning question, not a code one.

**Still unbuilt:** the measured tuning run the circadian curve needs
([ML-feel]) and walls on tile edges ([B7]). The lighting field remains
deliberately presentation-only; a 20-tick real-WASM enabled-versus-disabled
run ends at the same world hash.

One finding from building it constrains every future content change:
`ci.yml` runs `cargo mutants --timeout 60`, and that timeout bounds each
mutant's WHOLE workspace test run. A shipped content change that materially
slows the simulation therefore has to be measured against that ceiling
rather than against the wall clock - the circadian curve's first draft
pushed one save test from 10 s to 39 s, which would have turned a large
share of mutants into spurious timeouts.

Three findings from building it constrain future renderer work. The lighting
rig fits inside the existing single instanced draw call because pools change
instances already being drawn. Additive light quads would NOT work because the
pipeline alpha-tests at 0.5 and writes depth. The static light field does not
need `SimClock::is_hour_boundary()` at all: source geometry is rebuilt only at
startup and Load, while the existing ambient uniform continues to read the
clock each frame. The final displayed pass recorded one draw and one submit per
frame, no steady static upload, and one 9,056-byte static upload when Flat
changed. Those numbers belong to this build, not to future renderer changes;
an unchanged design target is not an unchanged measurement.

### Next engineering slices

This is the current restart point, separate from the historical milestone
checklists below:

1. Continue the authored visual-action contract one coherent category at a
   time. Conversation, eating, and `reading_chair.settle_in` now prove social,
   ordinary-object, chain-step, and exact object-socket anchors end to end; the
   next category still needs its own real anchor and pose. Broad activity labels
   must not stand in for authored content, and shared sitting, sleeping,
   showering, and toilet poses still require explicit sockets and occlusion
   decisions before they can align without clipping or floating.
2. Run the remaining physical-device check on the merged revision: verify the
   new portrait HUD reflow, inspect the darkest floor in daylight, then
   long-press an object and confirm its action menu remains reachable. The 390
   by 844 and 320 by 568 browser layouts are watched evidence in
   [A-mobile-hud-reflow], and reduced motion and lighting are watched in
   [A-local-idle-wandering] and [A-night-light-pools]; none substitutes for
   touch hardware, sunlight, or a safe-area check on the actual phone.
3. Hold criterion 11 open for the owner-authored dark-comedy voice session
   tracked by [T22]. Functional UI copy is intentionally plain until then.

Local idle wandering is now shipped rather than a restart item. Its radius is
compiled content, the endpoint and actual walked path are both capped at three
tiles, the choice remains deterministic and retry-bounded, and the measured and
watched acceptance evidence is recorded at [A-local-idle-wandering].

The mobile HUD reflow is shipped as a CSS-only presentation change rather than a
second controller. At 600 CSS pixels or narrower, Time and Funds, the roster,
the two folded detail panels, speed, and actions dock around a transparent
canvas aperture; expanded details scroll inside a bounded panel. Desktop keeps
the existing sidebar, and short phone landscape uses that scrollable edge shape
instead of crushing the portrait dock vertically. The contract and browser
evidence are [MH1]-[MH5] and [A-mobile-hud-reflow].

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

That visual gap has since been closed. The five-room house, furniture placement,
selection states, command menus, HUD, and mobile layout have all been judged in
a real, visible Chrome session. `docs/alpha-feel-notes.md` [A-5] records the
original geometry-only proof, [A-6] records the object-footprint limitation found
on the way, [A-16] records the original player-facing shell pass, and
[A-mobile-hud-reflow] records the current responsive pass after later HUD
features outgrew that first phone layout.

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

- ~~**Needs:** hunger, energy, hygiene, bladder, social, fun, comfort~~ - done.
  All seven exist, decay at content-declared rates, and are served by the
  compiled smart-object and social interaction library.
- ~~**Moods and moodlets** derived from needs, traits, and environment~~ -
  done as a pure Rust projection. Need thresholds, generic condition-trait
  severity, and nearby directional feelings produce deterministic signed
  moodlets and a bounded overall label in the normal selected-person HUD.
  Save V1 is unchanged; Load force-refreshes the projection before another
  tick.
- **Traits:** ~15 to start, affecting utility scoring ([D6])
- **Smart object library:** ~40 objects across the core need categories
- **Build mode:** walls, floors, doors, windows, roofs
- **Buy mode:** catalog, placement, rotation, palette recolors ([G4])
- **Create-a-sim:** body type, face, hair, clothing, trait selection
- ~~**Household** of up to ~6 sims~~ - done. Content preserves declaration
  order, enforces a six-member ceiling, and the normal HUD provides one
  keyboard-operable selection button per live household member. Buttons key
  on stable `SimId`, then resolve the current entity after Load.
- ~~**Save/load** with schema versioning from the first commit ([D8])~~ - done.
  A validated versioned snapshot covers the complete world, and one OPFS slot
  supports startup restore, manual save/load, daily autosave, and New game.
- ~~**Time controls:** pause, 1x, 2x, 3x, implemented as tick multipliers
  ([D2])~~ - done.
  Blocking Help, Load, and New game surfaces temporarily suspend the shell
  driver without replacing the player's chosen speed or recording browser
  reading time as a replay command.

### M2 - Life

What makes it a *life* sim rather than a needs sim.

- **Life stages:** baby, toddler, child, teen, adult, elder, with aging
- **Relationships:** friendship and romance axes, sparse storage capped ~150/sim.
  The shipped ordered relationship scalar is also intended to gain slower
  household-scale causes and consequences: a slight tunable penalty when one sim
  waits for an object another is using; compatible or incompatible personality
  drift while sims share a room; and needs-gated autonomous conversations or
  fights outside positive or negative relationship thresholds. Extroversion
  modifies initiation thresholds, with friendly and hostile curves tuned
  independently. These dynamics are planned rather than shipped; [H12] through
  [H16] in
  `docs/specs/2026-07-30-household-and-relationships-design.md` record the detailed
  constraints.
- **Skills:** learned through interaction, gating better outcomes
- **Careers:** rabbit-hole model for the beta - the sim leaves the lot and
  returns with an outcome. **Simulated workplaces are a near-term post-v1
  goal with a recorded compatibility target** ([D15]); the shipped rabbit hole
  is deliberately smaller and does not already contain workplace lots,
  promotion ladders, coworker entities, or a shared outcome interface.
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
| **Simulated workplaces** | **Near-term post-v1, not deferred indefinitely.** Rabbit holes ship now; [D15] separates their actual state from the planned workplace contract |

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
