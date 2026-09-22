# Create-a-sim: a new housemate moves in

Status: [CS-slice-housemate] built on branch `twcl/housemate-pages`; its played check is [A-housemate].

This is the Create-a-sim bullet of M1 in `docs/FEATURES.md`, and the start of
[S-create-a-sim], [S-household-size] and [F-entity-lifecycle] in
`docs/GAME-SYSTEMS.md`. The household is fixed when a new game starts: three
people from `content/household.toml`, and nobody can join or leave. Every
system that wants people to come and go (visitors, a partner, a baby, a pet,
a death) needs the household to change during play first.

## What the player gets from the first slice

* **A New housemate button** in the Household section, off while the household
  already has six people.
* **A form in two pages** ([CS-pages]): a name and one of the three
  personalities, each described; then up to four traits from the trait
  library, each shown with its one sentence. Move in, Back, or Cancel.
* **They arrive from the street.** The newcomer appears on the street's exit
  ([OS-street] in `docs/specs/2026-09-22-the-outside.md`), walks in through
  the front door, and is a household member like the others: in the roster,
  selectable, served by their own needs, with their traits in the panel.
* **Saved with the game**, like everyone else.

## [CS-command] Moving in is one edit

`SimCommand::AddHousemate { name, personality, traits }` is appended as wire
code 14: the name as text, the personality and the traits as pack indices. It
drains with the lot edits, with the whole world to itself, and is checked
whole before anything is written:

* the household has fewer than six members, the ceiling content already
  enforces for `household.toml`;
* the name, trimmed, is not empty and is at most `housemate_name_max_chars`
  characters (`content/tuning.toml`), well inside the loader's limit on a
  saved name;
* the personality exists;
* there are at most `housemate_max_traits` traits (`content/tuning.toml`),
  each in the library and none twice;
* there is a way in: open floor on the street's exit or the front door's
  tile from which the tile inside the door can be reached ([CS-arrival]), or,
  on a lot with no front door, any open tile.

Only then is a sim id issued and the sim spawned, by the same function that
spawns the household from content: every need full, the personality's
numbers, no hobbies and no job, and each trait at its kind's starting state.
A refusal writes nothing and is reported with a code, as a purchase's is.
Each answer carries how many move-ins the world has handled, and the form
takes only an answer numbered after the one it saw when it staged its own, so
a form closed and reopened while a move-in is on its way cannot read an older
answer as its own. The boundary refuses a name or a trait list past the tuned
limits before queueing it, so a staged move-in is always small enough for the
loader's size checks if a save lands before the drain.

## [CS-pages] Two pages: who they are, then their traits

Added 2026-09-22 at the owner's request, after they found a drop-down of personality names told them nothing. Page 1 holds the name and the personalities as radio buttons, each with its name in bold and its description ([CS-personality]) below it, then Cancel and Next. Page 2 holds the traits, each with its label and sentence, under a legend saying how many may be chosen, then Back and Move in. The dialog pauses the game like Load does.

Next is off until the name is complete, and Move in is only on page 2, so a newcomer cannot be sent without a name. Back keeps every choice, and opening the form again starts on page 1, empty. Every button is `type="button"`: nothing submits the dialog's form, and Enter in the name box moves on to page 2 rather than closing the dialog. A page change moves keyboard focus onto the new page.

## [CS-personality] A personality says what it is like

Each archetype in `content/personalities.toml` gains a `description`, one or two plain sentences read from its numbers, appended last to the compiled personality. The compile step refuses a blank one. Its verbs follow [TL-affinity] in `docs/specs/2026-09-21-trait-library-and-traits-panel.md`: the correspondent's desk weight of 1.7 is "Loves", the settled's desk weight of 0.45 is "hates". Personalities are in no save and not in the save digest, so the new field changes neither. The names stay the content ids in words ("The correspondent") until the owner names them ([T22]).

## [CS-arrival] From the street, through the front door

The newcomer is spawned on the street's exit when it is open floor the
landing can be reached from, else on the front door's tile, and given a walk
to the door's landing. The walk is an ordinary one: the newcomer's own needs
may send it elsewhere as soon as it arrives, and from the street every way
into the house is through a doorway. A lot with no front door spawns the
newcomer on the first open tile, as a sim with nowhere to arrive from.

## [CS-save] Nothing new to save

The newcomer is an entity like the others, saved and restored by the records
that already exist, its sim id counted by the saved allocator. A move-in
staged just before a save is saved with the personality and the traits by id,
as a staged purchase saves its object; an id the content no longer has
restores as an index past the table, which the drain refuses. The world hash
reads a staged move-in by those ids, and not by the name, which is not in the
hash for anyone.

## [CS-look] Looks come from the sim id

Each person's shirt is chosen from their sim id, and only three shirts exist,
so every newcomer wears the green one until there are more looks
([T-sim-looks]). Choosing a look needs art and a saved field: [CS-slice-looks].

## Slices

* **[CS-slice-housemate]** Everything above, in one pull request.
* **[CS-slice-looks]** Choosing a look: face, hair, body and clothes. Waits on
  art, and saves each person's look in an appended save version.
* **[CS-slice-random]** A button that fills the form at random, from the
  seeded generator so a replay draws the same.
* **[CS-slice-move-out]** A housemate moves out: walks out to the street and
  leaves the household, the first time an entity leaves for good.

## What this does not do

Ages, babies, partners, visitors and pets. Each builds on people arriving and
leaving.
