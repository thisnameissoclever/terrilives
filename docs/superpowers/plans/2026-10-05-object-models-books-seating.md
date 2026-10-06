# Object models, owned books, and shared seating

This is the implementation contract approved by the owner on 2026-10-05. Implementation is authorized; new product copy and visuals require review before publication. The previous object-copy draft was rejected. Preserve its independent click-to-open description fix, and replace that draft from scratch.

## Content contract

1. Category is a broad family, type is a familiar physical kind, and model is the purchasable product. Category -> type -> model is one inheritance chain, resolved at content compilation. The runtime receives complete definitions. Existing model IDs remain stable.
2. Omission inherits. Explicit operations set values, multiply numeric values, extend or replace collections, and remove inherited optional properties or actions. Reject unknown references, conflicting operations, invalid final values, and missing required fields. Scale duration once per layer and round the final positive tick count.
3. Action identity is independent of its label. Overrides retain inherited positions; new actions append in authored order. Reusable action templates support sharing across unrelated types without multiple inheritance. Do not reuse the existing Sim-skill term capability for this feature.
4. Models have multiple room associations. Office is a room association. Rooms neither grant actions nor restrict placement. Other is a category without implicit behavior. Categories remain hidden during ordinary play; room associations filter the store.
5. Seating includes Armchair, Sofa, Dining chair, Office chair, and Ottoman. The historical reading_chair model is an Armchair specialized for reading. Bunk bed remains a separate type because of its physical layout and access requirements, while sharing sleeping behavior with beds.
6. Browser metadata exposes stable model identity, type, category, rooms, and resolved actions. Type is primary and model secondary. Never identify a unique model by its shared visible type.

## Seating and reading contract

1. Physical seat IDs own body positions, facing, and approach positions. The sofa has three seats; each existing chair and the ottoman has one. Sitting, reading, and dining share those claims. Reclining claims the entire sofa. Sleeping places remain separate.
2. Reading requires an owned physical book. Reserve a copy, fetch it, travel to the selected seat, read, then return it. Read on a seat chooses an available title; Read on a bookcase chooses a title and suitable seat. The player can choose a specific title. Standing reading near the bookcase remains the fallback when no seat is available.
3. Autonomous choices score book taste, familiarity, benefits, seat comfort, travel, availability, and existing personality effects through seeded random selection. A specialist seat is preferred statistically, never unconditionally.
4. The specialist armchair initially provides 1.25 times standard-armchair reading comfort and entertainment gain rates, with unchanged reading speed. Ordinary sitting does not receive this modifier.
5. Completion, interruption, and replacement orders save the bookmark and return the book before the next activity, even for urgent needs. Reserve its home shelf slot while borrowed, recompute routes when furniture moves, and refuse sale of a bookcase with borrowed copies. Death preserves a recoverable copy.
6. All supported directions require correct occupied seating, including mixed actions on the sofa. Fetching, carrying, and returning must be visible. Use the existing rig and furniture sources. Activity labels and reservation counters are not visual acceptance.
7. Preserve existing TV/radio seating and integrate its claims with individual physical seats. Reading in bed and broader communal preferences remain roadmap work.

## Books contract

1. Titles and physical copies have separate stable identities. A title has name, description, genre, length, and price. Copies have persistent ownership and location. A second copy permits another reader but never resets title familiarity.
2. Launch with 24 titles in six genres: eight short, eight standard, eight long. Baseline reading takes approximately two, three, or four sessions. Each session lasts at most 60 game minutes; actual progress survives interruption. Prices are 6, 10, and 14 Funds. Existing daily work pay stays 120.
3. New households start with empty bookcases. Existing households receive five distinct starter books once on migration, without a charge. Shelf space is filled first; excess copies or copies without a bookcase enter visible household book inventory.
4. Build-mode book purchases show title, genre, price, approximate length, and selected-Sim estimated interest. Charging and creating one copy are atomic. A chosen shelf receives a purchase if space is available; otherwise it goes to household inventory. Inventory-only copies cannot supply reading until shelved.
5. Each bookcase has 24 slots in four rows of six. Empty furniture and book visuals are separate. Shelved copies fill positions; borrowed copies leave gaps; returning restores them. Transfers, purchases, moves, and load preserve identity.
6. Each Sim has stable genre tastes and title-specific variation combined with existing reading dispositions. Browsing consumes no simulation randomness. Renaming, reopening the store, loading, or adding another title cannot reroll existing preferences.
7. Taste is lasting; familiarity is temporary. Track progress and familiarity per Sim/title, independently of copy. An immediate complete reread earns 20% of fresh entertainment and satisfaction. With no further reading it recovers to 60% after 365 game days and 100% after 730 days. Use simulation time and content tuning, not wall-clock time.
8. Capture novelty at the beginning of a reading pass and retain it across sessions. Unread first-pass content retains full novelty. Increase familiarity in proportion to actual reading. Cancellation, changing seats or copies, and reloading cannot restart rewards.
9. Familiarity reduces interest, entertainment, and reading satisfaction, not physical seat comfort. Apply title effects, seat modifiers, and Sim traits once each.

## Balance, copy, and documentation contract

1. Reassess every existing model's price, usable capacity, footprint, benefits, costs, duration, and specialization. Keep global need decay and wages fixed. Record intended trade-offs in a reviewable balance table.
2. A more expensive comparable product needs an advantage, including a clearly identified cosmetic premium where appropriate. It need not be superior in every dimension. Do not use a universal quality multiplier.
3. Rewrite all model names and descriptions after balancing, using Tim's and the corrected project writing guidance. Describe each product's construction, character, quality, and useful distinctions. Humor is optional. Development limitations and generic action summaries do not belong in flavor text. Claims must match actual model values.
4. Present material capacity, requirements, and costs as functional information. Do not promise two usable sleeping places on a bunk if only one exists. Supply resolved comparison metadata now; advanced side-by-side comparisons and expanded model ranges remain future work.
5. Update GAME-SYSTEMS, glossary, architecture, string inventory, and both mirrored project writing skills. Record the correction in lessons learned. The roadmap must explicitly cover many models per type, inherited and unique actions, trade-offs, room filters, model comparisons, seating, books, and long-term reading memory.
6. Present balance/copy and book tables with running-build screenshots for review. Preserve proposed/approved/published distinctions. Keep truthful public changelog notes with the delivery and preserve other contributors' notes.

## Compatibility and acceptance

1. Capture the published content definitions and representative old saves before changing actions. Version the save migration for copies, locations, progress, tastes, familiarity, reading journeys, and seat claims. New saves identify model/action references by stable IDs and resolve runtime indices on load.
2. Preserve people, relationships, Funds, furniture, layouts, and unrelated progress. Grant starter books only to households without new book state. Safely end old reading actions without a physical book, with a one-time explanation. New saves resume each reading stage without duplicating rewards or losing copies.
3. Test inheritance, all overrides, unique actions, missing/invalid references, stable order, and a Hygiene -> Shower -> model fixture with a faster added action.
4. Test concurrent and mixed seating, dining conflicts, in-transit claims, shelf capacity, duplicate copies, movement, blocked routes, interruptions, cancellation, death, and save/load at each stage. One copy has exactly one location; one physical seat has no conflicting occupants.
5. Test stable tastes, average three-session progress, full first-read novelty, rereading penalties, annual recovery, and absence of cancellation/load/copy exploits. Advance clocks directly for recovery tests.
6. Compare repeatable household traces for needs, choices, travel, queues, spending, and reading variety. Prove statistical seat specialization. Mutations removing ownership, novelty, or modifiers must fail their tests.
7. Run Rust/web suites, type checks, formatting, lint, content/save checks, production builds, and affected art tests. Inspect desktop, keyboard, touch, shelves, transport, and every seat arrangement. Keep click-only descriptions. Close owned browser pages and servers in cleanup.
8. After required content and visual review, commit and publish the approved work with documentation and changelog. Verify remote merge separately from deployment. Do not wait on duplicate remote checks already passed locally without a new reason.

No new dependencies, paid asset generation, unrelated calendar UI, or broad store redesign. A year is 365 simulation days. Use existing isolated work and do not modify another conversation's work or preserved browser data.
