# The alpha acceptance pass - what running the whole game found

`docs/alpha-goals.md` says every criterion is "verified by RUNNING the
game and watching it, not by tests alone." Ten of the eleven were
shipped across M2a-M2g and each was measured when it landed. Nobody
had ever run the criteria against the FINISHED alpha, all systems
present at once, and three of them did not hold.

This is the working design for the three fixes, including what was
rejected.

Historical measurements below preserve the names used during the run. The
2026-08-05 roster rename maps Terri to Tim, Doug to Bill, and Nadia to Casey.

## [X1] A quarter of all saves could not be loaded

**Measured.** On the shipped lot, snapshotting at each of 36 000 ticks
and loading each into a fresh sim: **10 224 of them - 28.4% - failed
to load.** 8 499 `InvalidContentReference`, 1 725
`InvalidEntityReference`.

**Cause: `Target` names one of three things and the validator knew
one.** `follow_path` dispatches on what it finds at the far end of a
target - the `CHAIN_STEP` sentinel (`u32::MAX`) means a station in a
running chain, a smart object means that object's interaction, and an
AGENT means a conversation whose index addresses `pack.social`. The
save validator required every target to be a smart object with an
in-range interaction index, so:

- saving while anybody walked to a chain station rejected `u32::MAX`
  as an interaction index (`InvalidContentReference`),
- saving while anybody walked over to talk rejected the partner for
  carrying no `smart_object` (`InvalidEntityReference`),
- and habituation, which keys on the same flyout ROW that scoring
  uses, put an entry on the fridge at row 1 - its chain - the first
  time anyone cooked, which was rejected for the same reason as the
  first case. That one alone accounts for 15.0% of ticks and begins at
  tick 1 770, after which it never goes away.

**Why it survived M2g.** The seam test saves once, at tick 173. The
shipped lot's first walk-to-talk starts at tick 188. The test escaped
the bug by fifteen ticks.

**The fix** mirrors the runtime's dispatch instead of assuming one
case, and separates three index spaces that had been conflated:

| reference | legal index space |
| --- | --- |
| `Target` on an object | that object's interactions, or `CHAIN_STEP` |
| `Target` on a sim | `pack.social` |
| `Intent` on an object | flyout ROWS: interactions, then its chains |
| `Intent` on a sim | `pack.social` |
| `SavedCommand::UseObject` | flyout rows, objects only |
| habituation entry | flyout rows |

The bounds are a safety boundary, not a formality: on arrival
`follow_path` indexes `interactions[..]` and `social[..]` directly, so
an out-of-range index restored from a file would panic mid-tick. Every
arm bounds the index the arm it authorises will use.

`UseObject` stays object-only although the `Intent` it becomes may name
a person: the command drain resolves that index against the objects
query alone, so a `UseObject` naming a sim is dropped rather than
served, and `TalkTo` is how the wire says conversation.

**Rejected: widening `validate_object_entity_interaction` to accept a
missing `smart_object`.** It would have silenced both errors and
authorised nothing - a target on a sim would then pass with an
interaction index bounded by nothing at all, which is the panic the
validator exists to prevent.

**Verification.** All 36 000 ticks now produce a loadable save, and
142 seams spread across the hour each resume and stay hash-identical
to the uninterrupted run for 300 ticks after loading. Four permanent
tests replace the single early sample, and the walked one asserts
COVERAGE first - a run where nobody happened to walk to a chat would
pass vacuously and leave the same hole open.

## [X2] The one sim with a job lived permanently at zero

**Measured.** Over the same 36 000 ticks (25 game days), Terri - the
household's only worker - hits **0.0 on six of her seven needs**, and
her lowest need is at or below 5 on **every single one of the 25
days**. She spends 27.3% of her life with hunger at or under 5, 19.2%
with social there, 18.8% with fun. Doug and Nadia never touch it: 0
ticks in crisis on anything, floors of 23.6 and 6.1.

**Cause: the rabbit hole is a sensory-deprivation tank.** `decay_needs`
drains every entity holding `Needs` unconditionally, and an `AtWork`
sim is off the lot with nothing to reach. A 480-tick shift plus the
commute costs her 33 hunger a day that she cannot service at any price,
against a daily budget of 89 - so she comes home already underwater,
and the cubed-urgency scoring keeps whatever is worst pinned at the
floor.

The design intent of [E4] is that a career's antagonist is the TIME it
eats - the hobbies not done, the condition not managed, the
satisfaction not earned. That intent is intact and measured in [A-14].
Starving is not part of it. `content/tuning.toml` states the assumption
this violates in its own words, describing `neglect_floor = 15` as
sitting "beneath every self-serve equilibrium the traces have
measured", so that "an ordinarily functioning sim never touches it."
For the working sim that has not been true since M2e shipped.

**The fix: `at_work_decay_scale`, one knob in the tuning file.** Needs
decay at that fraction of their rate while `AtWork`. An office is a
building with a toilet and a kettle in it: you are not resting there,
but you are not in a void either. The commute is deliberately excluded
- walking to your own front door is ordinary life and already
serviceable.

**Rejected: raising the fridge's hunger delta.** It fixes the symptom
household-wide and undercuts the chain, whose entire claim is that a
cooked dinner is the fullest meal the game can express. The fridge
snack out-earning it per tick is what [A-15] had to tune away from.

**Rejected: shortening the shift.** The shift length is the career's
price and the thing [A-14] measured. Cutting it to fix a need-supply
problem would quietly refund the cost the design is charging.

**Rejected: a per-need table instead of one scalar.** Defensible -
social arguably should be SERVED at work rather than merely slowed,
since colleagues are people - but that is a content design question
about what a workplace IS, not a balance patch, and it wants the
per-career treatment a second job would force. Recorded as the
follow-up; the single scalar is the honest version of "not a void."

## [X3] The reading chair is furniture nobody sits in

**Measured.** Over 12 000 ticks - the horizon criterion 3 names - the
reading chair is used **zero** times. At 36 000 it reaches 3. Every
other interactive object clears both.

This is [C6] recurring: the bookshelf held exactly this position until
the alpha pass found the cause was neither its delta nor its duration
but the level its only advertised need sat at. The chair is a
duplicate of a need profile the house already serves better and closer,
and the fix belongs to the same family - the object needs a reason to
exist that another object does not already cover.

## Verification bar for all three

Full gate, a mutation sweep over the changed Rust, and a re-measured
36 000-tick session in `docs/alpha-feel-notes.md` [A-19] reporting each
of the eleven criteria against evidence rather than against its
milestone's memory. The world hash moves for [X2] - a decay rate
changing IS the simulation changing - and does not move for [X1],
which touches validation only.
