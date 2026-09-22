# Buy mode: selling furniture

Status: [SL-slice-sell] is built, on branch `twcl/sell-furniture`. It is
[BM-slice-sell] in `docs/specs/2026-09-21-buy-mode.md`.

The Buy tool (PR 96) spends Funds on furniture. Nothing gives any back, and a
player who buys the wrong thing has to keep it. [BM-sell] in the buy-mode
design names selling as its next slice, and names two hazards that come with
it, because selling is the first thing in the game that removes an entity.

## What the player gets

* **Sell.** With a placed object chosen in the Furniture tool, a Sell button
  names what the sale pays back: "Sell for 120". Pressing it removes the
  object, frees its tiles, and adds that amount to Funds.
* **Refused in plain words** when the object is in use or promised to
  someone, as a move is: "Wait until nobody is using or approaching this
  object."

## What already exists, and is reused

* **Lot edits** drain in stream order between the orders around them
  (`systems/lot_edit.rs`), each with a preview and a commit that share one
  validator, a transient last result and a lot revision the shell watches.
* **The move rules' use check** (`InUse`): reserved, targeted, or named by any
  queued intent.
* **Prices** on objects in `content/objects.toml` ([BM-price]).

## Decisions

### [SL-command] One command, appended

`SimCommand::SellObject { object }` is appended to the wire enum after
`BuildRoom`, and `SavedCommand::SellObject { object }` after its saved form,
so every earlier code keeps its meaning. `object` is the raw entity index, as
`PlaceObject` names one. It drains as a lot edit, in stream order.

### [SL-rules] What is refused, in this order

1. `InvalidInput` at the boundary: an index that is not a whole number.
2. `UnknownObject` (the existing code 2, "That furniture is no longer
   available."): nothing placed carries that index.
3. `UnsupportedLayout`: the live grid does not match the saved layout plus the
   furniture, as for every lot edit.
4. `InUse`: reserved, targeted, or named by a queued intent.
5. `NotForSale`, a new code 15 appended after `CannotAfford`: the object has no
   price, so the catalogue does not list it and nothing says what it is worth.

A sale only opens tiles, so it cannot cut anyone off or leave furniture out of
reach, and the usability proofs are not run. The loader's grid checks are not
run either: they look at sims, their walks and what they are walking to, and a
sale of anything a sim is walking to or using is refused at step 4.

### [SL-pay] What a sale pays back

`resale_fraction` in `content/tuning.toml`, a fraction of the price between 0
and 1, appended with the other tunables. A sale pays `floor(price *
resale_fraction)`. Funds are a whole number, so the payout is too.

### [SL-despawn] Selling retires the object's entity index

This is the first despawn in the game. The ECS hands a freed index to the next
spawn, most recently freed first, and the loader rebuilds gaps in the saved
entity numbering by spawning placeholders and freeing them in ascending order.
The two orders differ, so after two sales, a Save and a Load the next purchase
could take a different index than in continuous play, and the world hash would
part ways ([BM-sell], second hazard).

The sale therefore despawns with `World::despawn_no_free`, which removes the
entity and its components without returning the index to the allocator, and
records the index in `RetiredIndices`. A sold index is never handed out again,
and a sale leaves the allocator's free list exactly as it was.

The first design saved only where fresh indices start and had the loader retire
every gap. Building it showed why that is wrong: the ECS allocates and frees
entities of its own, for a system run once in each command drain, and later
spawns reuse those indices. Those gaps must be freed after a Load, as the loader
has always freed them, and only the sold ones kept out of use. So the save
records which indices are retired, not a bound.

### [SL-save] Save V4: the retired indices

Save V4 is the V3 envelope with one field appended: `retired_indices`, every
index a sale has retired, ascending. The loader of a V4 save spawns
placeholders up to the highest saved or retired index, restores the saved
entities into their slots, retires the retired placeholders with
`despawn_no_free`, and frees every other gap in ascending order as it always
has. A retired index above every saved one is still reached, so it stays out
of use after the Load.

A V4 save whose retired list is out of order, repeats an index, or names an
index a saved entity holds is refused before the running world is replaced.
V1, V2 and V3 saves load exactly as before, with nothing retired: nothing
written before this slice can hold a sold index. The writer emits V4 from this
slice on, and a V3 body labelled V4 is refused for its missing list.

The world hash gains the retired list, its length then each index, as an
appended section, so two worlds that would hand the next spawn different
indices never hash alike. It moves the golden world hash from
0xA592_DBD9_C174_B14A to 0xDE84_3576_1360_3E8A, an encoding change: the
simulation computes exactly what it did.

### [SL-render] The render buffer reseeds on a changed entity set

The render buffer keeps each row's previous position for interpolation, and
reseeds only when the row count changes. A sale and a purchase in one drain
keep the count while shifting rows, so a row would interpolate from another
object's position. The buffer keeps the previous frame's sorted entity list
and reseeds whenever the new list differs, as its own comment asks of the
first despawn.

### [SL-shell] The Sell button

The Furniture tool's controls gain Sell, enabled while a chosen object would
sell and nothing is on its way. Its label names the payout, "Sell for 150".
The boundary gains `sale_preview(object)`, the refusal code and the payout,
for the label; `sell_object(object)` to stage the sale; and
`last_sale_result()`, the object, the refusal code and what it paid. While the
sale is on its way the status says "Selling…"; once it lands the choice clears
and the status says "{name} sold.", or the refusal. The Delete key sells from
the keyboard, and the keyboard help says so.

## Slices

* **[SL-slice-sell]** Everything above.

## What this does not do

Selling several objects at once, selling from the Buy tool, or undoing a sale.
