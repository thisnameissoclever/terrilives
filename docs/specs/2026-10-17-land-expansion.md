# Land expansion

Issue 254 defines this change. The outside spec (`2026-09-22-the-outside.md`)
remains the owner of the yard, the street and the front door; the build
confirmation spec (`2026-10-13-build-confirmation.md`) remains the owner of
the build-mode draft and its Confirm and Cancel.

## Contents

- [Intended behavior](#intended-behavior)
- [Rules](#rules)
- [What this does not do](#what-this-does-not-do)
- [Verification](#verification)

## Intended behavior

The household can buy more land along the three sides of the lot that do not
face the street. Each purchase adds a strip ten tiles deep along the whole of
one side, so the owned land stays a rectangle, and land gets dearer the more
of it has been bought. In build mode the player picks one of three outlined
strips, sees its size and price and what would be left, confirms twice, and
the lot grows. Money is kept to the cent from now on, shown as whole dollars:
prices rounded up, funds rounded down.

## Rules

1. **Sides.** The street is the lot's east column, the one the front door
   faces across the yard ([OS-street]). The rear is therefore the west side,
   and the two remaining sides are north and south. In the interface the
   three are named from the street looking at the house: Behind the house
   (west), Left side (south) and Right side (north). No expansion is offered
   toward the street, and nothing but these three whole-side strips is
   offered.
2. **Strips.** A strip is `land_strip_depth` tiles deep (shipped 10) and
   runs the full current length of its side, earlier purchases included. On
   the shipped 20 by 16 lot the rear strip is 10 by 16 and a side strip is
   10 by 20; after a side purchase the lot is 20 by 26, so the rear strip
   becomes 10 by 26.
3. **Growth and the frame.** A south strip extends the grid; every existing
   tile keeps its coordinates. A west or north strip grows the grid at its
   origin, and every coordinate in the world moves by the strip's depth: the
   grid's blocked tiles and edge barriers, every entity's position, every
   path step, every wall edge, window and painted floor, every chore cell,
   patch and traffic count, room membership tiles and anchors, every diner's endpoint,
   and the content-derived house and front door, including the landing the
   walk home from work ends on. Stable room IDs, names and duty owners do not
   change because the coordinate frame moves. Outside remains one shared room.
   Historical room seeds are translated only under their frozen save semantics;
   current IDs are not tile indexes. The [room identity spec](2026-10-17-room-identities.md)
   owns matching and the final Confirm reconciliation.
   The world keeps a `LotFrame` resource, `{ origin: (x, y) }`, the tile where
   the content lot's north-west corner now stands; the house rectangle is
   `origin + content house size`, the front door and its landing are
   `origin + content door`, and the street exit is still the last column on
   the door's row. A world with no frame (test lots, and saves from before
   this change whose grid is not the content lot's size) keeps its old rule:
   the whole grid is house. A save whose grid is exactly the content lot's
   size loads with origin (0, 0). The house's implicit north and west shell
   blocks movement wherever bought land lies beyond it; a purchase, a lot
   edit and a load each rebuild the movement grid through that one shell
   rule, and a load reads the frame before it rebuilds anything. Records
   keyed by a person or an object (traffic counts, surface and bin tasks,
   the grime board's legacy floor list) keep their ids; only the tiles
   among them move.
4. **Yard.** New land is yard: walkable, painted with the yard shift, no
   walls. The former lot edge becomes ordinary lines outside the house;
   along the house the implicit shell stays the shell: a wall, doorway or
   opening on it is refused as it was at the grid's edge, by the Walls tool
   and the Room tool alike, and only glazing and restoring glass touch it. Explicit perimeter solids the player built
   against the old edge stay as walls; the new edge is the implicit
   perimeter, and a room against it still needs its far wall
   ([BC-perimeter] in the build confirmation spec).
5. **Price.** Money is held in cents. With `A` the number of squares bought
   so far (excluding the original lot) and `N` the strip's area, a strip
   costs `N * (land_price_cents + land_price_step_cents * A)`: shipped 15000
   cents a square plus 15 cents for every square already bought, so the first
   10 by 20 strip costs $30,000 and makes the next square $180. The price of
   the whole strip uses one unit price. A quote changes nothing; only a
   completed purchase adds to `A`.
6. **Funds.** Household funds are kept in cents (`Funds` holds cents).
   Everything that pays or charges whole dollars multiplies by 100. The
   browser shows funds rounded down to the dollar and every price rounded up
   to the dollar, with no pennies anywhere in the interface; affordability
   uses the stored cents. A save from before this change multiplies its
   dollars by 100 on load.
7. **Commands.** `SimCommand::BuyLand { side }` (sides 0 rear, 1 left, 2
   right) is a build command. The drain refuses it, recording the refusal in
   `LotEditState`, when funds are short, when the side is unknown, or when
   the grid would pass 1024 tiles on a side; otherwise it charges the quoted
   cents once, grows the lot, and adds the strip's area to the purchased
   total. The runtime exposes `land_quote(side)` as
   `[width, depth, area, price_cents, remaining_cents, affordable]` for the
   interface, computed from the same tuning and totals as the purchase.
   The drain applies commands in order, so a command queued behind a
   purchase names the lot before it grew; the interface sends a purchase
   on its own.
8. **Build mode.** Land is a build tool like Walls or Floors. Choosing it
   draws the three strips as outlines; picking one shows its dimensions,
   area, price and the funds that would remain, using the display rules
   above. Buy opens a dialog that repeats the total and asks the player to
   confirm the land purchase; only Confirm in that dialog sends the command.
   With too little money the strip can still be picked and read, and the
   dialog offers only Cancel. The purchase joins the build draft: Cancel or
   Exit build before Confirm restores the old lot, funds and purchased total
   through the native transaction's confirmed baseline, and Confirm keeps them.
   A west or north purchase translates the confirmed room selection into the
   draft frame. Room membership and chore consequences are reconciled only
   when the whole Build batch is confirmed. Saving during the draft writes
   the confirmed baseline.
9. **Save.** Schema thirteen appends to the schema-twelve envelope: the lot
   frame origin, the purchased area, and funds in cents. The schema-one
   funds field keeps the whole dollars (rounded down) so every frozen reader
   still decodes; the cents field is authoritative when present. A
   schema-twelve or older payload loads with the frame derived from its grid
   size, no purchased area, and its dollars times 100. A frame whose house
   would leave the grid, a purchased area other than the grid's squares
   beyond the content lot, cents that disagree with the dollars by a dollar
   or more, or a missing frame on a grid shaped like the content lot refuse
   the load. The frame, the
   purchased area and the cents enter the world hash.
10. **Tuning.** `land_strip_depth`, `land_price_cents` and
    `land_price_step_cents` are root knobs in `content/tuning.toml`, appended
    to the compiled tuning after `fight_mood_ticks`. The compiler refuses a
    depth outside 1 to 100 or a price or step above 10^9 cents. Packs
    published before the knobs existed reconstruct the shipped values.

## What this does not do

No land is sold back, no strip is partial, and no plot is detached. The
street does not move and gains no art. Objects keep their prices in whole
dollars. The price of furniture is unchanged; only its display rounds.

## Verification

Simulation tests grow the shipped lot on each side and check the grid, the
frame, the house, the front door, the street exit, every entity's position,
every path, wall, window, floor, chore cell, room membership tile, anchor, patch and diner
endpoint against the same world translated by hand, that records keyed by a
person or an object keep their ids, that stable room IDs, names and duty owners
survive translation, that the shell blocks between house and
new land, that lot edits still find the layout they expect and that the
Walls tool and the Room tool refuse a doorway on the shell, that the walk
home from work ends on the moved landing, and that the moved world ticks
on without a panic;
they check the left-then-rear geometry (10 by 26), the three pricing
examples of the issue, the refusals, and that a quote changes nothing. Save
tests round-trip schema thirteen with the same barriers, load schema twelve
with the derived frame and dollars times 100, refuse a bad frame, and keep
the digest across a round trip. A book test buys with cents against whole
dollars. Browser tests cover the tool's outlines, the quote text,
the two-step confirmation, the Cancel-only state, display rounding of prices
and funds, and the shell lines the light field and the sky stop at once land
lies beyond them; the played pass recorded in
`docs/evidence/2026-10-17-land-tool/` shows the build draft's Cancel
restoring the old lot.
