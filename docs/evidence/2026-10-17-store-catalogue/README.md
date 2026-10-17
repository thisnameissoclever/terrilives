# Store catalogue played pass, 2026-10-17

A played check of the Buy tool's catalogue (issue 252) on the production bundle of branch `twcl/252-store`, served by `vite preview` on port 4173 and driven in the desktop app's built-in browser with the game's sound off, at the pane's desktop size and at the 375 by 812 phone preset. The household's money came from a schema-thirteen save of the shipped lot at 08:00 with $1,000,000, written into the page's save slot and loaded at startup. The frames are the browser tool's captures, 800 by 600 on desktop and 375 by 812 on the phone. Frames `02` and `03` come from a page session on the bundle before the second round of fixes, which changed only the layout below the grid, the phone card and the filters' pressed style; the other numbered frames come from the final bundle.

| Image | Moment | What it shows |
| --- | --- | --- |
| `01-catalogue-cards.jpg` | Buy chosen, the panel scrolled to the cards | Two columns of cards, each with the item's picture as drawn in the house, the type in bold, the model and the price, from Aquarium and Armchair down to Bookcase and Bunk bed; one scroll bar, the panel's. |
| `02-card-chosen-with-ghost.jpg` | The Standard Lounge card pressed | The card outlined as chosen; beneath the grid the identity line, the Colour list, the facing and Price: 140; the ghost on the lot with Buy $140, the two rotations, Choose item and Cancel beside it. |
| `03-kitchen-filter-after-purchase.jpg` | After Buy, then Kitchen | Funds 999,860 and the new armchair in the house; Kitchen and Everything pressed; Clear filters enabled; the grid narrowed to the nine kitchen items. |
| `04-phone-strip.jpg` | The phone preset, the dock scrolled to the cards | One row of cards, each with its picture beside its type, model and price (Aquarium, Stillwater Cabinet, 200; Armchair, Chapterhouse Wingback, 180), the second card cut by the edge to show the strip scrolls sideways; nothing overlaps. |
| `05-grid-end-no-colour-list.jpg` | The end of the grid, nothing chosen | The last cards (Television, Toilet, Trash can, Washer-dryer), then only the status Choose something to buy. and the hint; no Colour list; the Cancel and Confirm footer below the content, not over a card. |
| `06-filter-rows-pressed.jpg` | The filter rows | Every room and Everything pressed, drawn in blue with a blue border, the other buttons plain. |
| `07-phone-filter-rows.jpg` | The phone preset, the dock scrolled to its top | The Room label and row above the cards, Every room pressed. |
| `00-defect-squashed-cards.jpg` | The first desktop build | The cards squashed to 44 pixels, so only the pictures' tops showed: the scrolling grid gave its rows the cards' minimum height. Kept so the review can see it rejected. |
| `00-defect-phone-overlap.jpg` | The second phone build | The Colour list drawn over the card strip: the Buy tool's own grid shared the dock's height among its rows. |
| `00-defect-phone-cards-clipped.jpg` | The third phone build | Full-height cards in a dock too short to show them: only the pictures' tops, no names or prices. |

Checked in the page as well: thirty cards, all enabled with $1,000,000; Clear filters pressed Every room and Everything and showed all thirty cards again, and went disabled; the purchase reported Armchair bought.

The pass found six layout defects, all fixed before the final frames: the scrolling grid's rows took the cards' minimum height; the phone dock squeezed the strip shut; the Buy tool's rows in the dock shared the dock's height, so the Colour list overlapped the cards; the full-height cards did not fit the dock's short view, so phone cards now lay the picture beside the lines; the grid scrolled inside the scrolling panel, so the panel's pinned footer covered its last row and two scroll bars stood side by side, and now only the panel scrolls; and the Colour list showed with nothing chosen, against rule 4. The filters' pressed state is now drawn in the accent color.

## Independent visual review

REVIEW
