# M2e: satisfaction, hobbies, traits and the career - working design

The forward design (2026-07-29-satisfaction-and-traits-design.md,
[S0]-[S5]) set the constraints; this file makes the concrete decisions
and records what lost. IDs continue as [E*]. Goal items 4, 5 and 6 of
docs/alpha-goals.md are the deliverable: satisfaction and hobbies
consume idle time, the three trait mechanisms act, and a career exists.

## [E1] Satisfaction is one f32 per sim, and only three things write it

`Satisfaction(f32)`, non-negative, unbounded upward, in the world hash.
Writers, exhaustively:

1. **Hobby completions add** - the only upward path ([S1] DECIDED:
   needs never earn it).
2. **Neglect bleeds**: any need below `neglect_floor` (tuning) costs
   `neglect_bleed_per_tick` while it stays there. Keeping a sim alive
   is table stakes; failing to is a life quietly not worth living.
3. **Conditions scale** the accrual (never the bleed - a depressed sim
   who is also starving hurts twice, which is the honest reading).

**Rejected: a 0-100 bar.** A bar invites reading satisfaction as an
eighth need, which is exactly the blur [S1] forbids; an accumulator
reads as a LIFE going well, keeps "number goes up" the player's win
condition, and gives M2g's UI a lifetime score to draw. The cost is no
natural "full" - accepted, lives do not fill up.

## [E2] Hobbies are tags on interactions, loved by name

The advertisement vocabulary grows ([S3]'s extension point, spent
deliberately): an interaction gains optional `tags = ["reading"]` and
`satisfaction = f32` (base yield on COMPLETION - the same
completion-only rule habituation and relationships follow, so an
interrupted hobby pays nothing). A sim's `hobbies = ["reading", ...]`
in household.toml multiplies a tagged activity's yield by
`hobby_multiplier` (tuning); untagged or unloved activities pay their
base, usually zero.

Idle time is consumed by construction: hobby activities are ordinary
advertised interactions that autonomy picks when needs allow, so the
supply-and-spend loop of [S1] exists without a scheduler. **Rejected: a
distinct hobby-session system** (a planner that books idle blocks) -
it duplicates select_action for no observable difference at this scale,
and [S2]'s habituation already forces rotation between hobbies.

## [E3] Traits: one content file, three kinds, one multiplier slot

`content/traits.toml`; each trait names a `kind` and a `tag`:

- **disposition**: `score_multiplier` on candidates whose interaction
  carries the tag - composed MULTIPLICATIVELY in the same place
  habituation's `benefit_scale` and the relationship scale already
  compose, which is [S4]'s "one mechanism, several sources" cashed in.
  Dispositions weigh the CHOICE only, never the delivery: fearing the
  couch makes a sim avoid it, not fail to be comforted by it.
  **M2c already shipped a disposition source** - archetype
  `disposition` entries keyed by (object, interaction), "weight 0 IS
  the fear" - and it stays exactly as it is: trait dispositions are a
  SECOND source into the same composition point, keyed by TAG so one
  fear covers every couch-shaped thing without naming each. Two lookup
  keys, one multiplier slot, which is [S4]'s sentence verbatim.
- **capability**: gates by tag as MAY ATTEMPT, MAY FAIL. The attempt
  runs normally; at completion a `SimRng` roll against the sim's level
  decides success. Failure delivers `fail_delta_scale` (usually 0) of
  the advertised benefit and no satisfaction; every attempt raises the
  level by `learn_per_attempt` toward 1.0 - failure is a scene and a
  lesson, never a hidden option ([S4]: "a sim who never approaches the
  stove is not a scene").
- **condition**: `accrual_scale` on satisfaction plus a mutable
  `severity` in 0..=1 that FALLS by `manage_per_completion` whenever
  the sim completes an activity carrying the condition's tag - the
  resolving loop [S4] demands. Severity scales the condition's own
  effect, so a managed condition fades and a neglected one binds.

Per-sim state is a `Traits` component - sorted `(TraitId, f32)` pairs
(capability level or condition severity; dispositions carry no state) -
in the world hash. **v1 traits are AUTHORED in household.toml, not
rolled**: the household is authored content and a deterministic,
testable assignment beats a roll nobody chose; the SimRng roll [S4]
requires arrives with procedurally spawned sims (M3), and the schema
carries state from day one so nothing is rebuilt. Recorded as the
deliberate reading of "rolled from SimRng".

Framing per [S4]'s note: shipped v1 condition content stays on the
managed-and-improvable side of the line, labels plain ([L58] - the
voice pass happens WITH Tim in M2g).

## [E4] The career is a rabbit hole that eats the day

[D15] Tier 2 as FEATURES.md specifies. `content/careers.toml`: label,
`shift_start` (tick of day), `shift_ticks`, `pay`, `energy_cost`,
`satisfaction` (may be negative - a bad job is a real antagonist).
The day arrives with it: `day_ticks` in tuning, `tick % day_ticks` as
the clock - no calendar, no weekday, until something needs one.

At shift start a working sim drops what it holds (the same preemption
a player command gets), walks to the lot's doorway and enters
`AtWork { remaining_ticks }`: skipped by the render buffer (gone is
gone), invisible to selection and to other sims' people loops, its
reservation released. Return restores the sim at the door, debits
energy, credits `Funds` (an `i64` household resource, in the world
hash, displayed in the debug overlay now and the HUD in M2g), and
applies the career's satisfaction. **Rejected: paying in satisfaction
instead of money** (money is the build-mode hook and the satire needs
a number the job is FOR); **rejected: despawning the worker** (index
reuse aliases the world hash and the selection, [L47]'s trap, for no
saving over a component).

## [E5] What moves and what must not

- **World hash**: gains Satisfaction, Traits, AtWork and Funds rows -
  wholesale golden regeneration with the annotation note, per
  protocol. Personality stays immutable in M2e and therefore stays
  OUT of the hash; the M2c expiry note binds when something mutates
  it, and nothing here does.
- **Pack bytes**: schema grows additively (append-only fields, new
  files compile into the pack tail); golden pack vector regenerated
  from the failing assertion, annotated.
- **Command wire: untouched.** No new player verbs in M2e - the
  career is autonomous and traits act through existing choices. The
  first career command (quit, choose) belongs to the milestone that
  gives it a UI.
- **`score_advertisement` keeps its scalar shape**: every new source
  is a multiplier composed OUTSIDE it, exactly as habituation and
  relationships already are, so [S5]'s "nothing depends on the advert
  being a need delta" survives another milestone.

## PR sequence

1. **The second axis** (data + core): schema growth, Satisfaction with
   neglect bleed and completion yields, hobbies, hash rows, tuning,
   debug overlay lines, trace measurement.
2. **Traits**: the disposition multiplier, capability attempts with
   learning, conditions on the accrual, authored traits for the
   household.
3. **The career**: day clock, rabbit hole, Funds, balance pass, the
   measured session and the played watch.
