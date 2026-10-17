# Store catalogue played pass, 2026-10-17

A played check of the Buy tool's catalogue (issue 252) on the production bundle of branch `twcl/252-store`, served by `vite preview` on port 4173 and driven in the desktop app's built-in browser with the game's sound off, at the pane's desktop size and at the 375 by 812 phone preset. The household's money came from a schema-thirteen save of the shipped lot at 08:00 with $1,000,000, written into the page's save slot and loaded at startup. The frames are the browser tool's captures, 800 by 600 on desktop and 375 by 812 on the phone (the three defect frames from the phone are stored at twice that size). Frames `01` to `12` all come from the final bundle, which draws the pictures smoothed at twice their displayed size, marks a grayed card `aria-disabled`, and draws the pictures the first time the tool is shown.

| Image | Moment | What it shows |
| --- | --- | --- |
| `01-catalogue-cards.jpg` | Buy chosen, the panel scrolled to the cards | Two columns of cards, each with the item's picture as drawn in the house, the type in bold, the model and the price, from Aquarium and Armchair down to Bookcase and Bunk bed; one scroll bar, the panel's. |
| `02-card-chosen-with-ghost.jpg` | The Standard Lounge card pressed | The card outlined as chosen in the grid; the ghost on the lot with Buy $140, the two rotations, Choose item and Cancel beside it; one scroll bar. |
| `03-kitchen-filter-after-purchase.jpg` | After Buy, then Kitchen | Funds 999,860 and the new armchair in the house; Kitchen and Everything pressed in the accent color; Clear filters enabled; the first four of the nine kitchen cards, nothing covered by the footer. |
| `04-phone-strip.jpg` | The phone preset, the dock scrolled to the cards | One row of cards, each with its picture beside its type, model and price (Aquarium, Stillwater Cabinet, 200; Armchair, Chapterhouse Wingback, 180), the second card cut by the edge to show the strip scrolls sideways; nothing overlaps. |
| `05-grid-end-no-colour-list.jpg` | The end of the grid, nothing chosen | The last cards (Television, Toilet, Trash can, Washer-dryer), then only the status Choose something to buy. and the hint; no Colour list; the Cancel and Confirm footer below the content, not over a card. |
| `06-filter-rows-pressed.jpg` | The filter rows | Every room and Everything pressed, drawn in blue with a blue border, the other buttons plain. |
| `07-phone-filter-rows.jpg` | The phone preset, the dock scrolled to its top | The Room label and row above the cards, Every room pressed. |
| `08-chosen-item-details.jpg` | The panel scrolled below the grid with the armchair chosen | The identity line Armchair, Standard Lounge, then the Colour list (As drawn), Facing: South-east, Price: 140, Good for: Social, Fun, Comfort, and the buying facts. |
| `09-phone-card-chosen.jpg` | The phone preset, Bathroom sink pressed | The chosen card outlined in the strip, its whole picture, type, model and price visible; the ghost with Buy $80, the rotations, Choose item and Cancel. |
| `10-phone-identity-below-strip.jpg` | The dock scrolled just past the strip | The strip's scroll bar, then the identity line Bathroom sink, Standard Pedestal, and the top of the Colour label, each below the strip, not over it. |
| `12-phone-colour-list.jpg` | The dock scrolled to the Colour label | The Colour label and the As drawn list on their own rows. |
| `11-phone-grayed-at-zero.jpg` | The phone preset with $0 | Every card grayed out; the household status says a Load failed because the save file was removed under the page to reach a $0 game, which leaves the cards as a $0 household sees them. |
| `00-defect-squashed-cards.jpg` | The first desktop build | The cards squashed to 44 pixels, so only the pictures' tops showed: the scrolling grid gave its rows the cards' minimum height. Kept so the review can see it rejected. |
| `00-defect-phone-overlap.jpg` | The second phone build | The Colour list drawn over the card strip: the Buy tool's own grid shared the dock's height among its rows. |
| `00-defect-phone-cards-clipped.jpg` | The third phone build | Full-height cards in a dock too short to show them: only the pictures' tops, no names or prices. |

Checked in the page as well: thirty cards, all enabled with $1,000,000 and all thirty grayed at $0, where a press on a grayed card chose nothing; nine cards under Kitchen; Clear filters pressed Every room and Everything and showed all thirty cards again, and went disabled; the purchase reported Armchair bought. On the phone the Buy tool's scroll width equaled its client width, 343 pixels each, with nothing chosen, with a card chosen and at $0, so the dock does not scroll sideways.

The pass found seven layout defects, all fixed before the final frames: the scrolling grid's rows took the cards' minimum height; the phone dock squeezed the strip shut; the Buy tool's rows in the dock shared the dock's height, so the Colour list overlapped the cards; the full-height cards did not fit the dock's short view, so phone cards now lay the picture beside the lines; the grid scrolled inside the scrolling panel, so the panel's pinned footer covered its last row and two scroll bars stood side by side, and now only the panel scrolls; the Colour list showed with nothing chosen, against rule 4; and the strip's negative margin made the phone dock scroll 2 pixels sideways, so the focus ring now sits inside the card instead. The filters' pressed state is now drawn in the accent color.

## Independent visual review

REVIEW
