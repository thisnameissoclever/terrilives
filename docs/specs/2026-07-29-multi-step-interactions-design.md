# Multi-Step Interactions - Forward Design

Status: **architectural intent, not scheduled.** Written down now because
retrofitting it later would be expensive and because several decisions already
in flight would otherwise foreclose it.

Nothing here is built. The purpose is to make sure nothing being built now
makes it harder.

## What was asked for

Standing on the fridge must not be what feeds a sim.

Feeding a sim should be: walk to the fridge, open it, take something out and be
visibly holding it, carry it to a counter or a table, and eat there. Possibly
longer - take ingredients out, cook them on the stove, plate the result, carry
the plate to a table, then eat.

**Only the last step satisfies the need.** The chain can be interrupted or
redirected at any point, but a sim that gets halfway through cooking and wanders
off has not eaten.

## [M-1] What this actually changes

Today an object advertises a need and a delta, a sim walks to it, and standing
there for a while fills the need a little each tick. The object is both the
advertiser and the satisfier, and satisfaction is continuous.

The requested model breaks all three of those apart:

- **An interaction becomes a sequence of steps**, each with its own location,
  duration, and eventually its own animation.
- **Satisfaction is terminal, not continuous.** Only the last step delivers.
- **The advertiser and the satisfier are different objects.** The fridge is what
  makes the chain available; the table is where the need is met.
- **State travels between steps.** A sim carrying food is holding something, and
  that something can change - ingredients become a cooked dish.

## [M-2] The substrate already exists, and that is not luck

Each sim already carries a **queue of intents**, and player commands already
push onto it while autonomy fills it when the queue is empty. That queue was
built so a player's order could beat the sim's own choice.

**A multi-step interaction is a sequence of intents pushed onto that same
queue.** The mechanism for "do this, then this, then this" is already there and
already tested, including the part where a player interrupting replaces what was
queued.

So the gap is not the execution model. It is four things layered on top.

## [M-3] The four gaps

### Content has to express chains

An object currently declares what it advertises and for how long. It will need
to declare a **sequence**: which step happens where, how long each takes, and
which step is terminal.

Steps refer to other objects by role rather than by identity - "a surface you
can eat at" rather than "table number three" - so a lot with a counter and no
table still works, and so build mode cannot author a lot where eating is
impossible. That is a **tagging system on objects**, and it is the piece most
likely to be underestimated.

### Scoring has to evaluate the chain, not the object

The fridge does not advertise "hunger, forty". It advertises "hunger, forty,
after roughly this much walking and this many seconds of faffing".

That means the cost side of the utility calculation becomes **the whole chain's
travel and duration**, resolved against the actual lot. A fridge across the room
from the only table is a worse meal than a fridge next to one, and the sim
should feel that.

This is the change with the widest blast radius, because scoring is the heart of
how sims choose and it is currently the most heavily tested code in the project.

### Carried items have to exist

A sim holding food is holding a thing. That thing has state, it can transform
(raw becomes cooked), and it has to be visible.

Whether it is a full entity or a component on the sim is an open question. A
component is cheaper and sufficient for one item; an entity is what a sim
putting a plate down on a table needs. **The second is where this is going**, so
the component version is a trap worth naming rather than a saving worth taking.

### Interruption needs defined semantics

If a sim is interrupted holding a plate, what happens? Plausible answers: it
keeps holding it and resumes later; it puts it down where it stands; it puts it
back. Each is defensible and they feel very different.

This also interacts with something already decided - see [M-4].

## [M-4] The tension this creates with what is already built

Today, needs fill **a little each tick during** an interaction. That was a
deliberate convenience: it means a player interrupting a sim mid-meal has
already banked part of the benefit, so interrupting is forgiving and there is
nothing to roll back.

**Terminal-only satisfaction removes that.** A sim interrupted at the last step
of a cooking chain has spent two minutes and gained nothing.

That is what was asked for and it is the more realistic model, but it makes
interruption **punishing** rather than forgiving, and it lands on a decision
already taken: a player's click currently **preempts** a running interaction
immediately, precisely so a click never feels ignored.

Those two together mean an impatient player can destroy real work with a
mis-click. Three ways out, none chosen yet:

1. **Confirm destructive preemption** - only prompt when the chain has real sunk
   cost. Adds interface surface.
2. **Partial credit** - a chain abandoned late gives some benefit. Softer, but
   it half-undoes the thing that made terminal satisfaction desirable.
3. **Resume instead of discard** - the sim keeps what it was carrying and
   returns to the chain when the interruption is done. Most forgiving and most
   like how a person actually behaves; also the most work.

**Three is the most likely right answer** and it is worth knowing that now,
because it implies the chain's progress is state that survives an interruption -
which is a storage decision, not a behaviour one, and storage decisions are the
ones that are expensive to change late.

## [M-5] What must not be foreclosed

Concrete constraints on work happening now:

- **Do not let need satisfaction stay welded to the advertising object.** The
  thing that advertises and the thing that satisfies must be allowed to differ,
  even while they happen to be the same object today.
- **Do not treat an interaction's duration as its only cost.** Travel is already
  part of scoring; a chain's cost will be several legs of travel plus several
  durations, and the shape of the calculation should tolerate that.
- **Do not assume a sim's business is one object.** Anything that reads "the
  object this sim is using" should be able to become "the step this sim is on".
- **Keep the intent queue general.** It is currently exercised with single
  intents; it must not acquire an assumption that a queue is ever one deep.
- **Keep interruption semantics in one place.** Cancelling currently releases
  the target, the path, the reservation, and any in-progress interaction. When
  chains exist, that is where "what happens to the plate" will live, and it
  should not be scattered.

## [M-6] What this is not

Not scheduled, not designed in detail, and not a reason to delay the current
milestone. Animation in particular is a separate problem: the visible arm
extending and the sprite appearing in a hand are presentation, and the chain
model has to work without them so that a step with no animation still reads
correctly.

The immediate value of this document is [M-5]. Everything else is thinking
ahead so that the thinking is not wasted.
