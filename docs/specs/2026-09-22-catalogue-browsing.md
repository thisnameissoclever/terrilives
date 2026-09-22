# Buy mode: the catalogue says what each thing is for

Status: [CB-slice-serves] is built, on branch `twcl/catalogue-browsing`.

This is [B-catalogue-browsing] in `docs/FEATURES.md`, found in the played check
[A-buy-mode]; its own played check is [A-catalogue-browsing]. The Buy tool
(`docs/specs/2026-09-21-buy-mode.md`) lists thirty objects by name and price,
and the names say nothing about use: "Wall of Intent" could be anything, and a
chair bought on its own does nothing until it stands at a table. The simulation
already knows which needs each object serves.

## What the player gets

* **What it is good for.** Under the chosen item's price, a line names the
  needs it serves, in the need bars' words: "Good for: Hunger, Comfort".
* **A filter.** A Show list above the catalogue narrows it to the items that
  serve one need.

## Decisions

### [CB-serves] Which needs an object serves

Derived from content by `ContentPack::needs_served`, so nothing is saved and
every save loads as before:

* every need one of the object's own interactions advertises with a positive
  delta;
* and every need a chain advertises with a positive delta, when the object
  offers the chain or one of the chain's steps takes a role the object has.
  The stove, the counter, the kitchen sink, the dining table and the desk serve
  hunger through Cook dinner that way.

A zero delta or a cost serves nothing. A chain's needs are listed on every
object that fills a role the chain needs, on purpose: a household that has one
can use it to get what the chain gives. So the kitchen sink reads Hunger,
Hygiene and Comfort, though washing up there costs comfort, because it is a
prep surface for Cook dinner, whose comfort comes through it too. The boundary
gives one mask per catalogue item, in catalogue order, with bit `i` for need
index `i` (`catalogue_needs`), beside the rows `catalogue` already gives.

### [CB-none] Items that serve no need

A chair, a lamp or a plant serves no need on its own, and the line says so:
"Good for: no need on its own", with no full stop, like "Good for: Hunger,
Comfort" and "Price: 40". That is plain functional copy; a line of
description per object is voice, and waits on [T22].

### [CB-filter] The Show list

"Everything", then each need at least one catalogue item serves, in need
order; a need nothing serves is left out, though today every need has
something. Choosing a
need rebuilds the catalogue list with only the items that serve it, keeping
their order; the list is rebuilt rather than its options hidden, because some
phone browsers still list a hidden option. Keyboard cycling with [ and ] skips
what the filter hides, as it skips what the household cannot afford. A chosen
item the filter hides is dropped, as the list's placeholder drops it. While a
purchase is on its way, or another pause such as a Load holds, the Show list is
disabled with the rest of the panel.

Leaving the tool and coming back keeps the filter, as a convenience; a Load
starts the panel afresh with Everything shown. On Windows and Linux a closed
select changes with each arrow key press, so arrowing through the Show list
past a need the chosen item does not serve drops the choice on the way; that is
the drop rule working, and a mouse, a Mac's picker or a phone's picker changes
it only once.

The Show list stacks above the catalogue at every width. Side by side on a
phone they saved only a few pixels and cut off about half the item names, which
a phone player reads nowhere else before buying. When this slice was built, a
phone's Build dock scrolled to reach Buy and Cancel once an item was chosen,
and this slice's rows moved them further down. [B-phone-build-dock] in
`docs/FEATURES.md` has since given each tool a footer of its status and
buttons that stays in view on a phone at least 481 pixels tall.

## Review record

A fresh-context review of [CB-slice-serves] found no must-fix issue. Fixed:
the blocked guards had no test [H1]; nothing pinned how the shell pairs each
item with its row's needs [H2]; nothing checked the Good for line empties
[H3]; an object that offers a chain without taking a step was not counted
[H4]; the phone layout was not checked [H5]; the played check and the
commit message undercounted what Cook dinner adds to Hunger [H6]; what the
filter does on leaving and on Load was unstated [H8]; two lines had no test
[H10]; the three catalogue exports each filtered the pack themselves [H11]; and
the strings list, the feature entry and a full stop were inconsistent [H12]. A
second round found the side-by-side phone lists cut item names off [H13], so
they stack again; and fixed notes on how far Buy and Cancel moved [H14], this
design's wording [H15] [H16], the label spacing the side-by-side rows changed
[H17], the previous commit message [H18], and the order of the Load reset,
now tested [H19].
Recorded above as decisions rather than changed: listing a chain's needs on
every object it takes [H7], and the drop while arrowing through the closed
Show list [H9].

Copilot's review of PR 100 suggested an unsigned shift in the test that bounds
each item's need mask, on the view that a mask with its top bit set would read
as negative. It was not changed: the mask arrives in a `Uint32Array`, so it is
always read unsigned, and a stray top bit makes it larger and fails the check.

## Slices

* **[CB-slice-serves]** Everything above.
* **[CB-slice-descriptions]** A line of description per object, which is voice
  and waits on [T22].
