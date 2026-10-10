# Radial object actions and automatic books

## Design authority

The owner approved the object and book mockups, then approved the revised around-the-object menu on 2026-10-09. The [radial mockup](../assets/review-evidence/radial-books/design/radial-approved.png) is the menu's visual reference. The [selected-bookcase view](../assets/review-evidence/radial-books/design/selected-bookcase.png) describes entering Build with that object selected. The [automatic-books view](../assets/review-evidence/radial-books/design/automatic-books.png) describes balanced placement and the unfinished-title preview. Preserve the real game's artwork and existing build-action arcs; the generated house geometry and example prices are not implementation targets.

This specification covers three distinct starter books in new households, automatic book commerce and placement, native reading priority, and radial context actions. It does not authorize changes to authored furniture art, unrelated store organization, dependencies or deployment credentials. Implementation and publication follow review of the [implementation plan](../superpowers/plans/2026-10-09-radial-object-actions-and-automatic-books.md).

## Object actions

Right-clicking any placed household furniture or appliance opens its actions, including objects with no Sim interactions. Enter build mode remains enabled without a selected Sim. Selecting it closes the menu, enters the existing Furniture tool, pauses through the existing Build owner, and selects the exact clicked object. Moving, rotating and selling furniture retain their native restrictions. A read-only object can still be selected; Enter build mode does not promise that it can be moved.

Sim-dependent actions remain visible but disabled without a selected Sim. Reading on a bookcase shows one automatic Read book action. Show title and progress only when the eligible priority group has one title; otherwise keep the ordinary weighted choice without a title preview. There is no title-selection list. Existing interaction indices, queue-mode behavior, social actions, chores and the Nothing order-cancellation action remain authoritative. Nothing appears only when there is a selected Sim; it is not the menu's close control.

Use separate dark buttons around the picked object's visible anchor, with open space in the center. Keep the type primary and model secondary. Preserve click-only descriptions. Buy and sell labels place their exact prices in smaller muted text on a second line inside the button. Apply that treatment to existing contextual furniture purchases as well as book commerce. Do not add a full-screen wheel, pie wedges, a surrounding card or explanatory paragraphs.

Keep native buttons, visible focus, keyboard activation and long-press input. Escape and outside activation dismiss the menu without sending a Sim order. Camera changes reposition the open menu from the existing rendered-object projection. Viewport placement avoids the world controls, dock and visible edges. Touch targets remain at least 44 pixels. Menus that exceed six action slots use five actions plus More actions; the next radial page includes Back and at most five actions. No action is discarded or reindexed. The small central Close control dismisses only the menu.

## Book rules

New-household construction grants one copy of each of the first three distinct titles in the existing migration-starter list, at no charge, after the authored lot and household exist. Low-level constructors and current-save restoration do not grant books. Existing households retain their ownership and reading memories. Historical pre-books conversion retains its established five-book grant.

The default price policy preserves authored title prices and the existing resale fraction. The mockup's $20 and $10 are examples. An automatic purchase prefers affordable titles the household does not own; after every title is owned it may choose another copy. When no candidate is affordable, show a stable next candidate's price and disable Buy book. There is no genre, title or destination selector.

Allocate incoming copies to the bookcase with the fewest home-slot reservations among bookcases with free capacity. Count borrowed books' retained home slots. Resolve equal counts with a deterministic seeded choice. Choose a free slot throughout the case using a separate seeded choice, rather than the first free index. Native quotes and commits use the same title, price, shelf, slot and expected next-copy id. Merely opening or refreshing a menu consumes no simulation randomness.

The default full-capacity policy disables purchases when no shelf space exists, including households without a bookcase. Initial gifts still exist if a custom starting lot has insufficient space; excess copies wait in inventory. Existing inventory and books displaced by a sold bookcase are automatically shelved when usable space becomes available. New purchases and these incoming copies fill the least-populated bookcase; adding another case does not move books that already have valid shelf homes. Preserve a borrowed book's home and return journey. This allocation policy fills the less-populated case over subsequent arrivals rather than reshuffling a reader's book.

Sell book automatically selects an unborrowed copy physically on the clicked bookcase. Prefer a duplicate title, then a title without recorded unfinished reading, then the lowest copy id. Exclude carried, dropped and inventory copies from that bookcase's sale action. If only unfinished titles are eligible, selling remains possible; title-level progress survives removal of a physical copy. Show the selected copy's exact payout before activation. Reject a stale or ineligible sale without removing a book or changing Funds.

Keep recovery of dropped copies as one contextual Recover book action. It uses automatic placement; when no capacity exists the action is disabled. Remove the old Books tool, purchase-destination selectors, transfer lists and title-specific reading rows. Build on a selected bookcase exposes only its book count, Buy book and Sell book alongside the existing furniture controls. Existing native explicit-title APIs remain available for historical commands and tests, but are no longer user choices.

## Reading priority

Choose among legally reachable, unclaimed copies before applying title preference. A selected reading chair remains the destination; clicking a bookcase may fetch the preferred title from another reachable bookcase. Preserve shelf access, seating, privacy, reservations and return constraints.

1. Prefer a title whose current pass has positive progress and is incomplete. If several are unfinished, prefer the one most recently read.
2. Otherwise prefer a title with no completed pass and no progress. Use existing interest and route scoring only within this group.
3. Otherwise prefer the title read longest ago. The default tie-breaker is the smaller current repeat penalty, then existing interest and route scoring.

These are hard priority groups for automatic book selection, shared by directed Read and autonomous reading. A lower-priority title cannot win through a larger utility score or a random floor probability. Ordinary autonomy still decides whether to read instead of eating, sleeping or doing another activity. Within the eligible best title group, preserve legal seat selection and the existing weighted-choice mechanism. Equivalent plans for the same title and seat must not gain extra probability merely because the household has more bookcases.

## Persistence and compatibility

Save schema 7 is current at the design base, `faed1ccb192a027f80fd41970b967c64c2ebbea5`. New queued automatic-purchase, sale and recovery commands require schema 8. Freeze the original Purchase, Transfer and Read variants for both historical schema-6 and schema-7 decoding. Their original codes and fields remain byte-identical. Schema 8 appends AutoPurchase, Sell and Recover variants; historical headers must reject those variants.

Keep the saved library fields and existing content prices unchanged. Quotes derive from the existing taste seed, monotonic next-copy id and sorted native identities. No new saved random stream is needed. Current schema-8 adoption is a validated direct adoption with no starter grant, rearrangement or random draw. Schema-7 conversion preserves all physical copies, memories, Funds, time, reservations and pending command order. The named automatic-inventory policy runs after a normal command drain, including while paused; it does not run inside save adoption. It has no effect when there are no unborrowed inventory copies or no capacity. No extra migration command is inserted into a full historical queue.

The storage worker retains the exact schema-7 primary bytes before the first schema-8 write, adding a V7 recovery file while retaining V1 through V6 recovery files. Validate aggregate ordinary and book command limits, complete payload consumption, quotes, ownership and references. Rejected loads leave the current world unchanged.

## Review defaults

Use existing variable prices and disable purchases without capacity. For finished-book ranking, use longest time since reading first and repeat penalty as a tie-breaker. These defaults are explicit review choices; do not replace them with the mockup prices or a different ranking during implementation.
