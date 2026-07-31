# A Household, Personality and Relationships - Decisions

Status: **[H1], [H2] and [H3] are built and measured; [H4] and [H5] are
decided and waiting on M2d.** Each decision carries the alternative rejected
and why.

The through-line: **three sims who differ because of their own data** (goal item
1), **social satisfied by each other rather than by a television** (item 2), and
one decision here - stable sim identity - that item 9's persistence needs anyway.

---

## [H1] A stable `SimId`, and it is not the entity index. BUILT.

Every sim gets a `SimId(u32)` from a monotonic counter held as a world resource
(`SimIdAllocator`), assigned at spawn and never reused. `issue` rather than
`next`, because an allocator is not an iterator and clippy rightly refuses the
collision.

**This is the load-bearing decision in this document**, because three separate
things need to name a sim and none of them can use an `Entity`:

- **relationships** are per-pair, so a sim has to be able to say "how I feel
  about *that* one" and have it survive;
- **the save file** cannot store an `Entity`, which is an index plus a generation
  meaningful only to one `World`;
- **the render buffer** already learned this lesson the hard way - it carries an
  `ids` column because a row is not an entity index, and [L47] records that a
  mapping which is the identity by coincidence is a bug with a scheduled arrival
  date. The coincidence expires when sims die, which M1d plans.

**Rejected: key relationships on `Entity`.** `bevy_ecs` reuses freed indices, so
a dead sim's index can be handed to a newborn and every relationship pointed at
the dead one silently transfers to the new one. That is not a crash; it is a sim
who inexplicably loves a stranger.

**Rejected: key on the sim's name.** Names are content and want to be editable;
two sims may share one.

## [H2] The household is content, not something the shell spawns. BUILT.

`content/household.toml` lists the sims: name, personality archetype, starting
needs, spawn tile. `Sim::new_from_shipped_lot` spawns them in declaration
order, which is what fixes each member's SimId, and `main.ts` spawns nobody
at all any more - the `spawnAgent(8, 6, 25)` it used to carry was the last
hardcoded copy of content in the shell.

The compile step validates a member the way it validates a placement, plus
one rule nothing else needed: the spawn tile must be CONNECTED to the rest of
the lot, by the same flood fill as [F5] rule 3. A sim born on a walkable tile
inside a sealed pocket is a failure no object-reachability rule can see - no
object is unreachable, the sim is what cannot get out.

`web/src/main.ts` currently calls `spawnAgent(8, 6, 25)` with coordinates and a
hunger value written in TypeScript. That is the same mistake the lot made before
M1b Task 3b - a hardcoded copy of content in the shell, which nothing keeps in
sync - and it gets worse with three sims, not better.

**Rejected: generate the household randomly at new-game time.** That is where
this ends up, and rolling personalities from `SimRng` is the plan. But a random
household cannot be *authored against*: the play sessions this goal demands
compare runs, and a shipped household that is the same every time is what makes
two traces comparable. Random generation becomes a *second* path later, seeded,
with the authored household as the fixture.

## [H3] Personality is two multiplier arrays plus a disposition list. BUILT.

```
Personality {
  drain: [f32; NEED_COUNT],        // how fast each need falls for this sim
  satisfaction: [f32; NEED_COUNT], // how much refilling it is worth to them
  dispositions: Vec<(ObjectDefId, u32, f32)>, // per-interaction weight
}
```

Two arrays and not one, because the request that started this was explicit: an
introvert's `social` should drain slowly **and** refill quickly. Those are
different numbers, and `tick_interactions` needs the second while `decay_needs`
needs the first.

The `dispositions` list is deliberately **the same shape as `Habituation`** -
sorted `Vec<(ObjectDefId, u32, f32)>`, keyed per interaction. Per
`2026-07-29-satisfaction-and-traits-design.md` [S4], dispositions, habituation
and affinities are one mechanism with several sources, and building three lookup
systems is the trap. Selection multiplies them together.

**Rejected: a bag of named traits with hardcoded effects.** "Fear of couches" as
a string that `select_action` matches on puts content in code and makes every new
trait a code change. A disposition is a number against an interaction; the
*flavour* lives in content.

Archetypes live in `content/personalities.toml` and are referenced by name from
the household. The uniqueness discipline applies: two archetypes whose arrays are
equal are untestable apart, which is [L26].

## [H4] A sim is an advertiser, and that is the real change. NOT YET BUILT - M2d.

Today `select_action` scores placed objects. To satisfy `social` from other sims,
it must also score **other sims** - so the candidate list becomes objects *and*
people.

The minimal honest shape: another sim advertises a small fixed set of social
interactions (talk, and later more), with the delta scaled by the relationship
and by both sims' personalities. The advertisement vocabulary was already
identified as the extension point that must not be foreclosed
(`2026-07-29-satisfaction-and-traits-design.md` [S3]); this is the first thing to
actually need it.

**Rejected: a "socialise" pseudo-object placed on the lot.** Cheap - it needs no
change to selection at all - and wrong in a way that would have to be undone: a
sim would walk to a fixed spot to be sociable rather than to a person, so
relationships could not depend on *who* was there, which is item 2's whole point.

**Rejected: making the television's social advert bigger.** That is the
placeholder this replaces, and its own comment in `content/objects.toml` says so.

### The contention question this forces

Two sims choosing to talk to each other is not the same as two sims choosing a
fridge. Reservation is currently a marker on the object; a conversation needs
*both* parties, and the second one is choosing at the same moment. **Decision:
the initiator reserves the target sim exactly as it reserves an object**, and the
target's own selection sees itself as reserved and stands still. That reuses the
whole existing mechanism, including the [C3] fix that stops a reserved-out sim
being told nothing is worth doing.

**Rejected: symmetric agreement, where both sims must choose each other.** More
realistic and much worse: two sims would have to independently pick each other on
the same tick, which at the shipped softmax temperature is rare, so conversations
would almost never happen.

## [H5] Relationships are one number per ordered pair. NOT YET BUILT - M2d.

`Relationships { Vec<(SimId, f32)> }` on each sim, sorted, same container shape
as `Habituation` and for the same reason - `world_hash` iterates it.

**Ordered, not symmetric**: A's feeling about B is stored separately from B's
about A. Unrequited is a real state and the asymmetry is free.

**One number, not a vector of dimensions** (friendship, romance, respect). One is
enough to change behaviour, which is what item 2 asks for, and the design of the
others should wait until there is something in the game that distinguishes them.
Widening a single `f32` to a struct later is a mechanical change; guessing at
three dimensions now and finding two are unused is not.

Relationships enter the world hash, because they change choice.

---

## Build order, and why

1. **`SimId`** - [H1]. Nothing else can be keyed without it.
2. **Personality and the authored household** - [H2], [H3]. This alone satisfies
   item 1, and it is verifiable by watching three sims behave differently.
3. **Sims as advertisers, then relationships** - [H4], [H5]. Item 2.

Deliberately NOT in this document: satisfaction, hobbies, capabilities,
conditions and the career. Those are
`2026-07-29-satisfaction-and-traits-design.md`, and they all sit on top of
personality, so personality goes first.

---

## What the build settled that the decisions left open

- **Where each multiplier acts.** `drain` in `decay_needs`; `satisfaction` in
  BOTH `tick_interactions` (delivery) and `select_action` (scoring), reading
  one array so a sim seeks exactly what delivery gives it; `dispositions` in
  scoring only, composed into the same benefit multiplier as habituation per
  [S4] - one multiplication point, three sources. Costs are never scaled by
  any of the three: a sim that fears the couch is not exempt from the couch's
  costs, per [S2]'s rule.
- **A disposition of 0 refuses autonomy and obeys commands.** Scoring zeroes
  the benefits so the sim never chooses it, and `serve_intents` does not
  score, so a player order still works. The authored fear is a preference,
  not a physical inability.
- **Different floors for the two maps.** A drain of 0 compiles - a need that
  never troubles this sim is a placid trait. A satisfaction of 0 is rejected:
  it makes a need dynamically unsatisfiable for one sim, which is [C2] with a
  face on it and invisible to the static satisfiability check.
- **Absence means neutral, and that is what held the golden vectors still.**
  Every consumer treats a missing `Personality` as all-ones, so every fixture
  and both world-hash vectors predating M2c behave identically. Measured: the
  native and wasm32 vectors both pass untouched.
- **The needs panel captions itself with the selected sim's name**, re-read
  through the same throttle as the bars, because "which sim is selected"
  (goal item 10) stopped being answerable by the ring alone the moment there
  were three of them.

Measured over 36 000 ticks, three sims, shipped content - the full session
is `docs/alpha-feel-notes.md` [A-9]: desk Terri 30 / Doug 0 / Nadia 0;
television Nadia 69 / Doug 42 / Terri 34; armchair Doug 11 / Nadia 1 /
Terri 0; Nadia's social band 27.0 to 70.1, the only need in the household
that never reaches full - the authored M2d demand, working.
