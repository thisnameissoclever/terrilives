# M1b Playable Alpha - Design

Status: agreed. Section IDs are stable; do not renumber.

## Why this replaces the planned M1b

The original M1 order was moods, then save/load, then art, then build mode, then
character creation. That is **four milestones before anything is evaluable**.

Today the app runs and shows one orange diamond moving toward one blue diamond,
with no input, no readout, and no way to tell why anything happened. There is
nothing there to have an opinion about.

**The purpose of this milestone is to make the game's feel judgeable as early as
possible**, so that a subtle problem which would change the design is found now
rather than after three more milestones are built on top of it. The explicit
constraint is that it must not buy that speed with architecture we would have to
undo.

## [D-1] What "feel" actually requires

The feel of a life sim is **watching a sim make a choice you did not script, and
understanding why**. That needs four things:

1. **Competing needs.** Only hunger advertises today, so there is never a
   decision - one option and a threshold. With five needs pulling at once you
   get the thing the genre is about: a sim who is tired *and* filthy *and* needs
   the toilet, picking one. **If the utility curve makes sims read as robotic or
   erratic, this is where it shows**, and no amount of art or build mode would
   reveal it.
2. **Enough objects to choose between**, roughly eight.
3. **Need bars.** Without them you cannot tell whether a decision was sensible,
   which is the difference between debugging the sim and feeling it.
4. **Pause and speed**, which is genre-fundamental.

Plus, agreed during scoping: **click to select a sim, click an object to direct
it.** Player agency is part of the feel, not a separate feature.

## [D-2] The one decision that would be expensive to get wrong

**Player commands must be serialisable data processed at a deterministic point
in the tick. JavaScript must never mutate simulation state directly.**

This is the whole anti-corner requirement of the milestone. [A5] and [D2]
establish that the simulation is deterministic, and [D13] already uses the
pattern for ghost injection: asynchronous input lands in a staging queue and is
drained at a fixed point, with each injection recorded so replays reproduce it.

Player input is exactly the same shape. If a click instead reached in and set a
`Target` component, then:

- Replay would diverge, because clicks arrive at arbitrary real times.
- The command log in [D8]'s save model would have nothing to record.
- Layer 2 multiplayer would be foreclosed, because the thing you send over a
  wire is precisely a serialised command.

So: `enqueue_command(cmd)` crosses the boundary, commands drain at a fixed step
in the tick pipeline, and nothing else in the shell can touch the world. It
costs almost nothing now and is a rewrite later.

## [D-3] Interaction queue and the autonomy override

A directed action needs to beat autonomy, or clicking would feel ignored.

Each agent gains a small **queue of intents**. `select_action` only runs for
agents whose queue is empty, so a player-issued intent suppresses autonomy until
it completes or is cancelled. That is the Sims model and it is also the honest
one: autonomy is what a sim does when you have not told it anything.

**The queue is a real simulation structure, not UI scaffolding.** M1c's moodlets
and M2's careers both need it, so building it here is not a detour.

Cancellation is a command like any other, so it inherits determinism for free.

## [D-4] Picking

Selecting a sim needs screen-to-world hit testing, which is the inverse of
`worldToScreen`. The isometric transform is invertible in closed form:

```
wx = (sx / TILE_HALF_WIDTH + sy / TILE_HALF_HEIGHT) / 2
wy = (sy / TILE_HALF_HEIGHT - sx / TILE_HALF_WIDTH) / 2
```

**Do not hit-test against the rendered quads.** Invert the projection to a world
tile, then ask the simulation what is on that tile. Quad-space picking would
couple input to the renderer's current sprite size, which is exactly the
coupling that makes art changes break input later.

The inverse has an exact-round-trip property worth pinning with a test, since a
sign error there is easy to write and produces picking that is subtly off rather
than obviously broken.

## [D-5] Where UI state lives

**The DOM renders simulation state and sends commands. It never owns game
state.** This is [D11]'s discipline extended one layer up, and it is the
standard way a project like this paints itself into a corner: UI starts caching
"the selected sim's hunger", then that cache becomes the source of truth for
something, and then the simulation cannot be replayed without the UI.

Concretely, the need-bar panel reads from the bridge each frame at a throttled
rate and holds nothing but the selected entity id, which is itself a projection
of a simulation-owned selection.

Selection lives in the simulation, not the shell, for that reason: it is part of
the state a replay must reproduce.

## [D-6] Content

Five needs advertise. Roughly eight objects, all authored in
`content/objects.toml`:

| Object | Advertises |
|---|---|
| fridge | hunger |
| bed | energy |
| shower | hygiene |
| toilet | bladder |
| television | fun |
| sofa | fun, comfort |
| sink | hygiene |
| bookshelf | fun |

`sofa` advertising two needs is deliberate: [D6]'s scoring sums across advertised
deltas, and this milestone is the first time that behaviour is observable rather
than merely tested.

**The lot is hand-authored in TOML**, including walls. That is not a shortcut
around build mode; it is the precursor. Build mode later becomes an editor that
writes the same format, so the format is the thing worth getting right now.

**Deliberately reconsidered:** M1a rejects negative advertised deltas, which
forecloses a shower that costs energy. Trade-off interactions are a real part of
how this genre feels. This milestone should allow negative deltas and let
scoring weigh them, or record explicitly why not.

## [D-7] Out of scope

- **Build mode**, character creation, save/load, careers, relationships, aging.
- **Art.** Flat shapes with a coherent palette convey enough to judge feel. Art
  answers a different question and it is the expensive one; it also needs [T3]
  and [T12] from the owner first.
- **Moodlets.** Needs drive behaviour here; how needs make a sim *feel* is M1c.
- **Multiple sims.** One is enough to judge decision-making. A household is M1c.

## [D-8] Definition of done

- Five needs drive behaviour; a sim visibly changes priority as they compete.
- Around eight objects, all content-authored.
- Need bars show every need for the selected sim.
- Pause, 1x, 2x, 3x, implemented as tick multipliers per [D2], never as `dt`.
- Clicking a sim selects it; clicking an object directs the sim to use it.
- **Every player action crosses the boundary as a serialised command** and is
  drained at a fixed point in the tick.
- **The determinism test still passes**, and a recorded command sequence replays
  to the same world hash.
- The lot, including walls, is authored in `content/`.
- `cargo test --workspace`, the web suite, clippy, fmt, and the mutation gate
  all pass.
