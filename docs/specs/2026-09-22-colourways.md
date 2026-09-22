# Buy mode: colourways for furniture

Status: [RC-slice-furniture] is built, on branch `twcl/colourways`.
[RC-slice-buy] is next.

This is [BM-slice-recolour] of `docs/specs/2026-09-21-buy-mode.md`, the last
part of the M1 Buy mode bullet ("catalog, placement, rotation, palette
recolors"). The player picks a colourway for a placed piece of furniture, and
the game draws its existing art in those colours. Which colourways each object
comes in, and their names, are the owner's: [T-recolour-palettes] in
`docs/TIM-TODO.md`. This slice ships the mechanism with plain placeholders.

## Why not a palette map

The buy-mode design said the renderer would apply a colourway through a
palette map. The art does not allow one. Of the thirty objects, sixteen are
Blender renders with hundreds to thousands of colours each and smoothed
edges, and none of their pixels sit exactly on the approved palette. The
other fourteen are drawn by the procedural generator from shades of the
palette rather than the palette itself. The sampler filters linearly, so even
exact colours arrive blended at edges, and a lookup by exact colour would miss
most pixels.

Baking each colourway as extra sprites is out for now too: the atlas is 7,928
of its 8,192 pixel limit, and each colourway would multiply every direction
and frame of every object. It would also add sprites that the shell's tables
keyed on sprite numbers must learn, the mistake behind
[L-sprite-keyed-tables-miss-new-directions].

## [RC-shift] A colourway is a colour shift in the shader

A colourway turns the object's hues and scales their strength, in a
perceptual colour space, before lighting. Near-grey pixels (the ink outline,
metal, white, black) have almost no hue to turn or colour to scale, so they
keep their colour; the coloured materials, such as upholstery, paint and
wood, change. A colourway with a lightness shift, such as Rich, still lightens
or darkens them a little: Rich takes white 255 to 242. Shading is kept
because lightness is kept, apart from that small shift. This
works on every object's existing art with no new assets, and the same shift
applies to every direction and animation frame.

## [RC-content] Colourways are content

Colourways are declared in `content/objects.toml` as `[[colourway]]` entries,
beside the objects they apply to: an id, a plain name, a hue turn in degrees,
a colour strength factor and a lightness shift. The first entry must be the
art as drawn, which changes nothing. The placeholders are a few shifts named
for what they do rather than for a colour, since a hue turn changes each
object differently. Every placed object takes every colourway until the owner
says otherwise. The compiled table is appended to the content pack.

## [RC-command] Choosing a colourway is a lot edit

`SimCommand::SetColourway { object, colourway }` is appended as wire code 12,
with `colourway` an index into the compiled table. It is refused for an
unknown object or an unknown colourway, the latter with a new refusal code 17.
It changes no tile, reservation or route, so it is not refused while the
object is in use, and it costs nothing. It bumps the lot revision and reports
a result the shell reads, like the other lot edits.

## [RC-save] Saved by id, hashed only when used

Save V5 appends `object_colourways`: for each placed object not in the first
colourway, its index and the colourway's id, ascending by index. Ids rather
than indices keep a save meaning the same colours when colourways are added or
reordered, and an id the content no longer has loads as drawn, so retiring or
renaming a colourway id never stops a save loading. The loader refuses an
entry that names no saved object, repeats or breaks the order, before the
running world is replaced; an id naming the first colourway loads as drawn,
like an unknown one. V1 to V4 load with every object as drawn. The world hash
gains a colourway section written only when some object has one, so every
existing golden hash stands. The browser's storage worker writes V5 and keeps
the V4 bytes in a recovery backup on the first V5 write over a V4 slot.

## [RC-render] The shift reaches every picture of the object

The render buffer gains a colourway column. The shell passes each row's shift
to the shader with its instance, and the shader applies it to that object's
pixels before lighting. Two pictures of an object are not its own row and
carry its shift too: the foreground layer (the bunk's upper parts), and the
furniture layer drawn inside a sim's picture while the sim uses the object
(the exercise bike, the reading chair, the bunk), where only the furniture
layer turns, never the sim or the outline over it. The placement ghost
stands in for a chosen object, so it is drawn in the object's colourway under
its valid and invalid tints; a purchase's ghost is drawn as drawn until
[RC-slice-buy].

## [RC-ui] A Colour list in the Furniture tool

With a placed object chosen, the Furniture tool shows a Colour list of the
colourways under its facing row, with the object's current one selected; with
nothing chosen the list is disabled. Choosing one sends the edit at once and
keeps the object chosen; while it is on its way the status says
"Recolouring…", and then "{name} recoloured." or the refusal.

## Slices

* **[RC-slice-furniture]** Everything above: content, command, save V5,
  hash, render column, shader shift including the foreground and in-use
  layers, and the Colour list for placed furniture.
* **[RC-slice-buy]** Choosing the colourway when buying, in the Buy tool.
* The owner's colourways and names replace the placeholders when
  [T-recolour-palettes] is answered; content only, since a save naming a
  colourway id the content no longer has loads that object as drawn.

## Review record

A fresh-context review of [RC-slice-furniture] found the placement ghost took
the object's colourway only while it stood valid on the object's own tiles,
because it was read from the row the ghost replaced; main now passes the
chosen object's colourway, and 0 for a purchase, to the frame. It also found
the render column's pointer untested, which the mutation sweep would have
failed; the hash section's sort untested; a staged change naming no
colourway hashing differently across a Load; saves refusing to load once a
colourway id was retired, now loading that object as drawn; the Colour list
dropping keyboard focus and sending a change per arrow press, now kept
enabled with the latest choice waiting for the change on its way; an
untested version-0 guard in the storage worker, now a lookup that refuses any
version it has no backup name for; stale docs on the instance size and on
ink and white under a lightness shift; and a divide in the in-use layer when
there is nothing to shift. Each is fixed with a test.

A second round found that a colour change queued behind another could be
taken for a finished move, since an earlier move's result for the same object
was still there; moves now have their own marker, as sales and colour changes
do. It also found the Colour list jumping back to the old colour while a
change was on its way, now showing the latest choice; the staged-command hash
guard and both in-use shader conditions untested, now pinned; and a saved id
naming the first colourway still refused, now loading as drawn like an
unknown one.
