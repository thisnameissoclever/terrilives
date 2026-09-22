# Buy mode: selling furniture

Status: working design for [BM-slice-sell] in
`docs/specs/2026-09-21-buy-mode.md`. Nothing here is built yet.

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
entity and its components without returning the index to the allocator. A sold
index is never handed out again. New entities always take fresh indices, in
order, the same way in continuous play and after a Load, and there is no free
list whose order has to be saved.

### [SL-save] Save V4: where fresh indices start

After a sale the highest index ever used may be one no live entity holds, so
the saved entities no longer say where fresh indices start. Save V4 is the V3
envelope with one field appended: `index_bound`, the allocator's count of
indices ever handed out (`Entities::len`). The loader of a V4 save spawns
placeholders up to `index_bound`, restores the saved entities into their
slots, and retires every other placeholder with `despawn_no_free`, so the
loaded world hands out the same fresh index next.

V1, V2 and V3 saves load exactly as they do today: they have no field, their
holes are freed in ascending order as before, and nothing written before this
slice can hold a sold index. The writer emits V4 from this slice on. A V4 save
names a bound at least as large as every saved index; one that does not is
refused as corrupt.

The world hash gains `index_bound` as an appended section, so two worlds that
would hand the next purchase different indices never hash alike.

### [SL-render] The render buffer reseeds on a changed entity set

The render buffer keeps each row's previous position for interpolation, and
reseeds only when the row count changes. A sale and a purchase in one drain
keep the count while shifting rows, so a row would interpolate from another
object's position. The buffer keeps the previous frame's sorted entity list
and reseeds whenever the new list differs, as its own comment asks of the
first despawn.

### [SL-shell] The Sell button

The Furniture tool's controls gain Sell, enabled while a placed object with a
price is chosen and nothing is on its way. Its label names the payout. The
boundary gains `sale_value(object)` for the label and `sell_object(object)` to
stage the sale; the result comes back through the existing last-result
pattern. After a sale the choice clears and the status says "{name} sold."
The Delete key sells from the keyboard.

## Slices

* **[SL-slice-sell]** Everything above.

## What this does not do

Selling several objects at once, selling from the Buy tool, or undoing a sale.
