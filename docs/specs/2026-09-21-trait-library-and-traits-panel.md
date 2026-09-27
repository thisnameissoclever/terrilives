# The trait library, and a Traits panel the player can read

Status: slice [TL-slice-library-and-panel] is built, tested and played locally
in PR 87. The played check is [A-trait-library] in `docs/alpha-feel-notes.md`.

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
the long sofa, the armchair and the reading chair. Tags are not part of any save and are not in
the compatibility digest.

Conditions stay on the managed and improvable side of the line [S4] draws.
Their labels and descriptions are plain and are played straight.

### [TL-description] A trait says what it does

`trait_def` gains a required `description`: one plain sentence. It is appended
to the end of `CompiledTrait`, so the pack grows at its end. The compile step
rejects an empty description the way it rejects an empty label.

The copy is functional and waits for the owner's voice pass like every other
label. It is listed in `docs/player-visible-strings.md`.

### [TL-affinity] A disposition says how strongly they feel

Added 2026-09-22 at the owner's request. A disposition's sentence opens with one of four verbs, chosen by its score multiplier: "Loves" at or above `affinity_loves_from`, "Likes" above 1, "Dislikes" below 1, and "Hates" at or below `affinity_hates_to`. Both lines are in `content/tuning.toml` (1.5 and 0.5), and the compiler holds `affinity_loves_from` above 1 and `affinity_hates_to` in `[0, 1)` so no multiplier earns two verbs.

The compile step refuses a disposition whose description does not open with its verb followed by a space, and refuses a multiplier of exactly 1, which changes no choice. The lines are read only by the compiler, so they add nothing to the compiled pack. The reworded descriptions do change the pack's bytes, as any description does; they are in no save and not in the save digest, which hashes each trait's id and kind. Capabilities and conditions carry no verb rule; their sentences say what practice or management does.

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

The panel sits in the selected person's HUD below the need bars, because the
bars are read far more often. It is hidden while nobody is selected: the panel
it sits in already says to select a person. For each trait it shows:

* the label;
* the description;
* for a capability, "Skill" and a whole percentage of the level;
* for a condition, "Severity" and a whole percentage.

A disposition has no state and shows no number. The panel refreshes on the
same interval as the Mood panel, because a level moves only when an activity
completes. It makes one bridge read per refresh, and that read returns its own
copy of the numbers. It shows "Traits unavailable" if the three startup columns
disagree in length, or if a read names a trait the library does not hold.

The panel must fit the compact HUD at 390 by 844 and 320 by 568 without
covering the action menu.

### [TL-determinism] What moves, and how it is pinned

The household's behaviour changes. No golden world hash moves, because the
golden vectors pin hand-built worlds and never the shipped household; that is
deliberate, so that rebalancing content is not a test edit.

Two digests do move, and both new values were read from failing assertions:
the save compatibility digest of the shipped content, and the digest of the
pre-rotation source the bathtub migration rebuilds from it at load time.

No command, no save field and no render buffer column changes.

### [TL-engine-fix] The freeze the new traits exposed

The first measured run with the new household froze Casey on the toilet at
tick 1799 and starved the whole house of it. The cause was already in the
engine. When a shift starts, the sweep that cancels walks toward the departing
worker also matches a sim already talking to them, and takes its target. That
sim could choose something new on the same tick, and the conversation's own
cleanup then removed the new target.

The fix is in the cleanup: a conversation that ends removes the target only
while it still names the partner. Three tests ship with it: the rule on
hand-built states, the shift-start scene beside the object and across the room,
and two invariants over the real shipped household.
[L-cleanup-removes-only-what-it-owns] in `docs/lessons-learned.md` has the
detail.

## Slices

* **[TL-slice-library-and-panel]** Everything above, in one pull request.

## What this does not do

* Create-a-sim, where a player chooses traits. That is its own M1 bullet.
* Rolled traits for spawned sims. That arrives with M3.
* Granting new traits to households in older saves. See [TL-old-saves].
