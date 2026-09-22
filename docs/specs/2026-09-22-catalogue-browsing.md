# Buy mode: the catalogue says what each thing is for

Status: [CB-slice-serves] is built, on branch `twcl/catalogue-browsing`.

This is [B-catalogue-browsing] in `docs/FEATURES.md`, found in the played check
[A-buy-mode]. The Buy tool (`docs/specs/2026-09-21-buy-mode.md`) lists thirty
objects by name and price, and the names say nothing about use: "Wall of
Intent" could be anything, and a chair bought on its own does nothing until it
stands at a table. The simulation already knows which needs each object
serves.

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
* and every need a chain advertises with a positive delta, when one of the
  chain's steps takes a role the object has. The stove, the counter and the
  dining table serve hunger through Cook dinner that way.

A zero delta or a cost serves nothing. The boundary gives one mask per
catalogue item, in catalogue order, with bit `i` for need index `i`
(`catalogue_needs`), beside the rows `catalogue` already gives.

### [CB-none] Items that serve no need

A chair, a lamp or a plant serves no need on its own, and the line says so:
"Good for: no need on its own." That is plain functional copy; a line of
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
purchase is on its way the Show list is disabled with the rest of the panel.

## Slices

* **[CB-slice-serves]** Everything above.
* **[CB-slice-descriptions]** A line of description per object, which is voice
  and waits on [T22].
