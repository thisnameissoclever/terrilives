# The trait library, and a Traits panel the player can read

Status: working design. Slice [TL-slice-library-and-panel] is in progress on
branch `twcl/traits-affect-choices`. Nothing here is shipped yet.

This design finishes the M1 scope bullet "Traits: ~15 to start, affecting
utility scoring ([D6])". It adds no new mechanism. [E3] in
`2026-08-01-m2e-satisfaction-hobbies-career-design.md` already ships the three
kinds of trait: a disposition multiplies a choice's score, a capability may
fail an attempt and learns from every attempt, and a condition scales
satisfaction and eases when the sim does the thing that manages it. Three
traits use them today, one per household member, and a player can see them only
in the developer overlay.

## What the player gets

* Every household member has three or four traits, so the three people differ
  in more ways than one.
* The selected person's panel lists their traits in plain words: the label,
  one sentence saying what the trait does, and for a capability or a condition
  a percentage that moves as the sim practises or manages it.

## Decisions

### [TL-library] Fifteen traits, appended

`content/traits.toml` grows from three traits to fifteen. The twelve new
traits are appended after the existing three, in a fixed order. Order matters:
a sim's `Traits` component stores pack trait indices, the world hash observes
them, and a capability roll draws from the seeded generator in index order.
Appending leaves the indices of the three existing traits alone.

Nine are dispositions, three are capabilities and three are conditions,
counting the existing three among them. Every number is pairwise distinct from
every other trait number, per [L26] and [L29], so a test can tell a multiplier
from a learning rate.

A trait keys on an activity tag, and the compile step rejects a trait whose
tag no interaction carries. One new tag is needed: `lounging`, on the sofa,
the long sofa and the armchair. Tags are not part of any save and are not in
the compatibility digest.

Conditions stay on the managed and improvable side of the line [S4] draws.
Their labels and descriptions are plain and are played straight.

### [TL-description] A trait says what it does

`trait_def` gains a required `description`: one plain sentence. It is appended
to the end of `CompiledTrait`, so the pack grows at its end. The compile step
rejects an empty description the way it rejects an empty label.

The copy is functional and waits for the owner's voice pass like every other
label. It is listed in `docs/player-visible-strings.md`.

### [TL-household] Who wears what

Traits stay authored in `content/household.toml`, as [E3] decided. A roll from
the seeded generator arrives with procedurally spawned sims in M3.

Each member keeps the trait they have and gains two or three. The choice
follows each archetype, so the measured differences between the three people
widen. Four traits are worn by nobody yet. They are tested at the mechanism
level and wait for create-a-sim.

### [TL-old-saves] Every existing save still loads, and loads as it was saved

The compatibility digest in `crates/terri-data/src/lib.rs` hashes every trait
id with its kind, so that a saved capability level can never be read back as a
condition severity. Adding a trait therefore moves the digest, and without a
bridge the new build would refuse every existing save.

The bridge is safe for a reason that can be tested. A save names traits by
string id, and the loader checks each id against the current pack. The new
trait list contains every old id with its old kind. So nothing an old save can
say changes meaning.

The rule, following [L-migration-pins-both-endpoints]:

* A test removes the twelve appended traits from the shipped pack and requires
  the digest to equal the previous public digest exactly. That pins the source.
* The new exact digest is pinned as a golden value. That pins the destination.
* The bridge accepts a save carrying the previous public digest, and everything
  that digest itself accepted, only while the current digest is that exact
  reviewed destination. Any later structural change closes it.

A sim loaded from an older save keeps exactly the traits it was saved with. The
loader does not grant the new traits. A load that changes what was saved is a
bigger promise than this slice needs, and a player who wants the new household
can start a new game. If the owner wants old households to gain the traits,
that is a separate, named change.

Two real saves written by the last public build before this change, at tick
600 and tick 2400, are checked in as fixtures. The new build must load both,
keep every saved trait, and replay deterministically after a second save and
load.

### [TL-panel] The Traits panel

The shell already reads `traitsOf`, `traitLabels` and `traitKinds` for the
developer overlay. The bridge gains one more startup read,
`traitDescriptions`, aligned with the other two.

The panel sits in the selected person's HUD below Mood. With nobody selected it
says so in the same words the Mood panel uses. For each trait it shows:

* the label;
* the description;
* for a capability, "Skill" and a whole percentage of the level;
* for a condition, "Severity" and a whole percentage.

A disposition has no state and shows no number. The panel refreshes on the
same interval as the Mood panel, because a level moves only when an activity
completes. It copies bridge arrays before the next bridge call, as the Mood
panel does, and shows "Traits unavailable" if the arrays disagree.

The panel must fit the compact HUD at 390 by 844 and 320 by 568 without
covering the action menu.

### [TL-determinism] What moves, and how it is pinned

The household's behaviour changes, so every golden world hash for the shipped
lot changes. Each new value is read from a failing assertion on native and
confirmed identical on release `wasm32`, never computed by hand.

No command, no save field and no render buffer column changes.

## Slices

* **[TL-slice-library-and-panel]** Everything above, in one pull request.

## What this does not do

* Create-a-sim, where a player chooses traits. That is its own M1 bullet.
* Rolled traits for spawned sims. That arrives with M3.
* Granting new traits to households in older saves. See [TL-old-saves].
