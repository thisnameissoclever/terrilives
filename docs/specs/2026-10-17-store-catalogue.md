# The store catalogue: previews and filters

Issue 252 defines this change. The Buy tool's three lists ([BM-shell] in `2026-09-21-buy-mode.md`, [CB-filter] in `2026-09-22-catalogue-browsing.md`) become a visual catalogue: every item for sale is a card with a picture of the item, and the filters are rows of buttons the player can clear with one control. The purchase itself, the ghost, the rotation, the colourway, the buying facts and the keys are unchanged.

## Contents

- [Intended behavior](#intended-behavior)
- [Rules](#rules)
- [What this does not do](#what-this-does-not-do)
- [Verification](#verification)

## Intended behavior

In Build mode's Buy tool the player sees a grid of cards, one per item for sale: the item's picture as it is drawn in the game, its type, its model name and its price. A card the household cannot afford is greyed out. Pressing a card chooses the item, as choosing it from the old list did: the ghost appears, the buying facts show beneath the grid, and Buy, the rotations and Cancel appear beside the ghost. Two rows of buttons narrow the grid, by room and by the need an item is good for, and Clear filters shows everything again. On a phone the grid is a strip the player scrolls sideways inside the Build panel.

## Rules

1. **Cards.** The catalogue shows one card per item in the order the old list used (type name, then model name, then content order). A card shows the item's picture, the type name as its primary line, the model name as its secondary line when the item has one, and the price as the Funds line writes it. A card is a button named `{type}: {model}, {price}` (or `{type}, {price}` without a model name) for assistive technology. The chosen item's card carries `aria-pressed="true"`. An item the household cannot afford has a disabled card; it stays visible so the player can see what to save for.
2. **Pictures.** A card's picture is the item's base-facing sprite as the game draws it, cropped to its content bounds, scaled to fit a 72 by 72 logical pixel canvas without smoothing, with its foreground layer drawn over it aligned by the sprites' anchors, in the art as drawn (colourway 0). The sprite comes from `purchasePreview` at tile (0, 0) and the base facing, the same query the ghost uses. The pictures are drawn once per catalogue, after the panel is built: the pages of the sprite atlas are fetched one at a time, each decoded once and released after every card on it is drawn, so a phone never holds two pages. A page that fails to load leaves its cards with their names and prices; nothing else changes.
3. **Filters.** The Room row holds Every room and then each room any item belongs to, in alphabetical order with the room's words capitalised; the Show row holds Everything and then each need some item serves, in need order. One button of each row is pressed at a time (`aria-pressed`). Clear filters presses Every room and Everything; it is disabled while both are pressed. The filter rules of [CB-filter] hold: a filter that hides the chosen item drops the choice and its ghost, the filters are kept while the tool is left and re-entered, and a Load presses Every room and Everything.
4. **Chosen item.** Beneath the grid, when an item is chosen, the panel shows what it showed before: the identity disclosure with the type, the model and its description, the Colour list, the facing, the price, what the item is good for and the buying facts. Nothing is shown there when nothing is chosen.
5. **Keys and focus.** `[` and `]` step through the visible, affordable cards in grid order, as they stepped through the list. Choose item beside the ghost focuses the chosen card, or the first visible card when nothing is chosen. Inside the grid the arrow keys move focus between visible cards in reading order and Enter or Space press the focused card; Tab leaves the grid. Every control is disabled while a purchase is on its way or another pause holds, as the lists were.
6. **Phone layout.** In the Build dock the grid is one row of cards that scrolls sideways; the filter rows wrap. Cards are at least 44 pixels tall. On a desktop the grid wraps to as many columns as the panel's width holds.
7. **Strings.** Room, Every room, Show, Everything, Clear filters, and the card names above; everything else keeps its current wording.

## What this does not do

No search box, no price filter, no sorting control, no category filter (categories stay hidden during play per the writing skill), no picture of a colourway other than the art as drawn, and no picture of the item at another facing. The Furniture tool's own list is unchanged.

## Verification

Unit tests cover the card order and names, the pressed states, the affordability greying, the two filter rows and Clear filters, the drop of a hidden choice, the disabling while a purchase is on its way, Choose item's focus target and the arrow keys. A real-runtime test checks that every shipped item's card names a sprite the atlas has. The picture drawing is checked by hand in the played pass, with the pictures compared against the placed objects, and the pass also shows the phone strip and the Clear filters control. The Build controls proof script drives the grid instead of the list.
