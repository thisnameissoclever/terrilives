# Features

Status: M0 shipped; M1a shipped. Everything from M1b onwards is proposed scope,
not yet agreed in detail. Milestones exist primarily to control [R6], which is
the risk most likely to actually kill this project.

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
