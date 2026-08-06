# M2f: the multi-step chain, end to end - working design

The forward design (2026-07-29-multi-step-interactions-design.md,
[M-1]-[M-6]) set the constraints; this file makes the concrete
decisions and records what lost. IDs are [K*]. Goal item 7 of
docs/alpha-goals.md is the deliverable: fridge to counter to stove to
table, terminal-only satisfaction, resume after interruption.

## [K1] A chain is content, in its own file, keyed by station ROLE

`content/chains.toml`. One chain ships:

- id `cook_dinner`, label plain per [L58] ("Cook dinner").
- `advertised_by` names the object DEFINITION whose flyout and adverts
  carry it - the fridge, [M-1]'s "advertiser and satisfier differ".
- `steps`: an ordered list, each `{ role, label, duration_ticks }`,
  with optional `tags` (the activity-tag space hobbies and traits
  already key on), `yields`/`transforms` (see [K3]) and the LAST step
  implicitly terminal. The shipped chain: get ingredients at
  `cold_storage`, prepare at `prep_surface`, cook at `hob` (tagged
  `cooking`), eat at `eating_surface`.
- `advertises` and `satisfaction` live on the CHAIN, delivered whole
  at the terminal step's completion and nowhere else - [M-1]'s
  terminal-only rule, which also keeps the completion-only precedent
  habituation, hobbies and relationships already follow.

Objects gain an optional `roles = [...]` list - a NEW vocabulary,
deliberately not the activity tags: "this is a surface you can eat
at" is a fact about furniture, "this is cooking" is a fact about an
activity, and one word meaning both would be [S3]'s vocabulary
collapse. Shipped roles: fridge `cold_storage`; counter and
kitchen_sink `prep_surface`; stove `hob`; dining_table and desk
`eating_surface` (the desk doubling keeps a one-table lot from
funnelling every meal through one tile, and eating at the desk is a
life the game should be able to depict).

**Compile rules** ([D9], all build failures): a chain step's role
must be worn by at least one object ON THE SHIPPED LOT and every
station must be reachable (the flood-fill machinery the front door
already uses); duplicate chain ids, blank labels, empty step lists,
zero durations and unknown roles reject; a chain's terminal
`advertises` obeys the same finiteness and clipping rules as any
interaction. "Build mode cannot author a lot where eating is
impossible" ([M-3]) is this rule doing its job early.

**Rejected: steps on the interaction schema.** A chain is not an
interaction with extra fields - its steps span OBJECTS, and welding
it to one object's interaction list would rebuild [M-5]'s "the
advertiser and satisfier must be allowed to differ" wart one layer
down.

## [K2] Scoring: the chain is a candidate at its advertiser, costed whole

`select_action` scores `cook_dinner` as a candidate anchored at the
fridge: the terminal deltas through the same
`score_advertisement` scalar (unchanged shape, [S5]/[M-5]), against a
cost of travel-to-fridge plus EVERY step's duration plus an estimate
of every inter-station leg. Legs are estimated as straight-line
distance between each station and the NEAREST object wearing the
next role (per-lot role lists resolved once at spawn), speed-scaled
exactly as today's travel term; real pathing happens per leg at
execution. The estimate is deliberately cheap and deliberately
per-lot: a fridge across the house from the only table IS a worse
dinner ([M-3]), and the trace can verify the preference.

The fridge's `grab_snack` SURVIVES beside the chain: hunger 40 in 30
ticks against the chain's larger terminal payoff over ~200. A
desperate sim snacks, a comfortable one cooks - the choice is the
feature, and the stove's standalone `cook_meal` interaction is
RETIRED in its favour (two cooking verbs in one kitchen is a menu
lie; its `cooking` tag, Bill's hobby and Casey's capability all move
onto the chain's hob step).

## [K3] The carried thing is a COMPONENT this milestone, and the trap is named

`Carrying(u32)` on the sim - an index into the pack's item kinds
(`ingredients`, `dinner`; a step's `yields` creates it, `transforms`
rewrites it, the terminal step consumes it). Hashed. Rendered as a
small sprite riding the carrier, the indicator-bubble mechanism at a
lower lift.

[M-3] warns the component is a trap versus a full entity, and the
warning is real ONLY when a sim can put something DOWN as a world
object. No shipped step does: the plate travels hand to table to
mouth inside the terminal step. The entity upgrade lands with
whatever first drops an item (build mode furniture-moving, M3
toddlers), and going entity NOW would ship the project's first
despawn - [L47]'s index-reuse minefield and the render buffer's
slot-stability caveat - for a state nothing can observe. Recorded as
the deliberate spend of [M-3]'s named trap.

## [K4] Execution rides the intent queue; resume is a component

[M-2] is cashed in: a chain executes as ordinary steps through the
existing Target/Path/Eating machinery, one station at a time, with
`ChainState { chain: u32, step: u32 }` on the sim as the program
counter (hashed - it is the resume state). Step completion advances
the counter and targets the nearest wearing object of the next role;
the terminal completion pays the chain's deltas, satisfaction (times
hobby and condition multipliers, as today), habituation against the
ADVERTISER, and clears `ChainState` and `Carrying`.

**Interruption is RESUME, [M-4]'s option three, decided.**

- A player command preempts the current STEP exactly as it preempts
  a meal today; `ChainState` and `Carrying` survive, and a sim whose
  queue empties resumes its chain BEFORE considering adverts - the
  half-cooked dinner outranks a fresh decision, which is what makes
  the sunk cost safe from the sim's own restlessness too. The
  interrupted step restarts from zero (a re-chopped onion is not a
  rollback problem).
- The career's shift start preempts the same way; the worker comes
  home and finishes cooking, which the measured session should show.
- An explicit `CancelIntents` ABANDONS the chain: `ChainState` and
  `Carrying` removed, nothing paid. Stop means stop; the forgiving
  path is the default one, the destructive one is the deliberate one.
- A station contested at arrival waits through the standing [C3]
  machinery, unchanged.
- Traits ([E3]): the capability roll fires at the start of any TAGGED
  step (the hob), the fumble rides to the terminal delivery scaling
  benefits only, and learning and managing land at the tagged step's
  own completion - so Casey can ruin a dinner she still serves, and
  still learn from it.

**Rejected: expanding the chain into N queued intents up front.**
The queue's cap is player-facing budget ([D-3] family), the stations
must resolve at step time (the nearest free table when the plate is
ready, not when the fridge was opened), and a queue-resident chain
would collide with the player's own clicks. One program counter, one
component, one resume rule.

## [K5] What moves and what must not

- **World hash**: rows gain `ChainState` and `Carrying` - wholesale
  golden regeneration with annotation, both goldens, per protocol.
- **Pack bytes**: roles on objects, the chains list, item kinds -
  appends; golden regenerated from the failing assertion, annotated.
- **Command wire: untouched.** A chain occupies the rows AFTER the
  advertiser's interactions in its flyout, so `UseObject`'s existing
  interaction index addresses it - index >= interactions.len() means
  chain (interactions.len() - index). No new verb.
- **`score_advertisement` keeps its scalar shape** - the chain's cost
  aggregation happens OUTSIDE it, exactly where habituation,
  relationships and dispositions already compose ([S4]/[M-5]).
- **Terminal-only stays terminal.** No partial credit ([M-4] option
  two stays rejected); the resume rule is what makes that humane.

## PR sequence

1. **Chains as content**: roles, chains.toml, item kinds, compile
   rules, pack growth, goldens, fixtures.
2. **The chain runs**: ChainState/Carrying, scoring, execution,
   resume, preemption integration (player, career, cancel), trait
   touchpoints, hash goldens, trace instrumentation.
3. **The chain is visible and measured**: carried-item sprite, flyout
   rows, overlay line, the 36 000-tick session against [A-14], the
   watched session, balance, milestone wrap (goal item 7).
