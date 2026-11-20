# Late book returns and floor books

Issue 309's lateness rule ([work lateness](2026-11-16-work-lateness.md)) bounds how long a critical Hunger or Energy keeps a worker home: at most `work_lateness_limit_ticks` (60) game minutes after the shift starts. Traces of the shipped household still showed workers leaving more than an hour late with nothing critical. Every such case traced was the walk home of a reading journey: a reader at the shift start must put the book back before leaving, and a walk across the house at a quarter tile per tick takes about an hour. The owner asked that nobody leave for work more than an hour late for a reason that is not urgent, and chose the fix below. The evidence is in the [verification record](2026-11-19-late-book-returns-verification.md).

This document amends [WL-depart] item 4 of the work lateness spec, which asked a reader on a journey home with no limit.

Owner ruling 2026-11-17: at the lateness limit a reader still returning a book drops it where they stand and leaves; housemates pick up floor books and shelve them on their own.

## Contents

1. [How the game behaved before](#lb-before-how-the-game-behaved-before)
2. [The cap on a book return](#lb-cap-the-cap-on-a-book-return)
3. [Floor books](#lb-floor-floor-books)
4. [Saves, tuning and hashes](#lb-save-saves-tuning-and-hashes)
5. [Verification](#lb-tests-verification)

## [LB-before] How the game behaved before

1. `attendance::start_tick` checks, in order: a player's order (`has_player_work`), then a reading journey, then the lateness predicate. A person on a reading journey was sent to `reading::request_return` and skipped departure, on the start tick and every tick after, with no limit. The lateness limit was read only after that check, so it never applied to a book return.
2. `request_return` ends a journey that has not picked its book up and sends every other one home: the reader walks to the home shelf's contact (`Return`), or waits there blocked (`WaitingReturn`), and shelves the copy (`Shelve`, four ticks). A walk from a reading seat across the shipped house to the bookcase's single contact takes about an hour.
3. A book on the floor (`BookLocation::Lot`) appeared only when a carrier died. Nobody picked it up on their own: reading plans skip floor copies, and only the player's **Recover book** put one back.

## [LB-cap] The cap on a book return

1. While the shift is open and unsettled, from its scheduled start plus `work_lateness_limit_ticks` on, a worker at home on a reading journey no longer returns the book. `request_return` runs first, so a journey that has not picked its copy up ends as it always did. A copy in hand (stages `Return`, `WaitingReturn` or `Shelve`) is left on the floor at the worker's position, keeping its home slot; the journey ends, its target reservation is released, and the worker departs on the same tick through the existing lateness check and `depart`. The predicate is `lateness::book_return_cap_reached`.
2. Before the limit nothing changes: a reader at the shift start is asked home and a return that finishes inside the allowance shelves the book before the worker leaves.
3. The limit is the same allowance a critical need has, measured from the scheduled start, so no reason the ordinary rules allow keeps a worker home past it. A player's order still delays departure without limit, as [WL-rulings] requires; the cap sits after that check.
4. A limit of 0 never caps. A world built from a pack published before the lateness knobs reconstructs 0 and keeps its unbounded return, as it keeps leaving on time for needs.
5. The floor copy is the state death already produces (`BookLibrary::put_down`, which `recover_on_death` now calls).

## [LB-floor] Floor books

A floor book is a copy on the floor that nobody has claimed. The rules are in `reading::floor`.

A floor book can be put back when it has a shelf slot to go to (its own, or the free slot **Recover book** would choose), that bookcase exists, has no seats and has a reading row for the return to target, and a legal contact of the bookcase can be reached on foot from the book's tile. Both steps below consider only such books, so nobody ever picks up a book they cannot shelve. This check runs once per book per tick, before any walk is planned, so a book nobody can shelve costs one check a tick and never a path search for each housemate.

1. **Who.** A housemate is free to tidy when they are an awake agent at home with nothing under way: no target, no interaction (sleep is an interaction on a bed, so a sleeper is never free), no reading journey, not at work or commuting, not in a recipe chain, a conversation, a carried item or a station step, not reserved by someone else, not in a committed conversation, with no queued or player order, no chore task on the board, no departure an older save deferred (`PendingShift`, which selection also skips), no open shift, and no shift starting within `work_lateness_limit_ticks`, so tidying never adds to a worker's lateness.
2. **Claim.** Directly before selection, each free housemate between activities, not already walking and with no need critical, sets off, in entity order, for the nearest unclaimed floor book that can be put back and that they can reach, nearest by path length with the lower copy id on a tie. The walk is a plain path with no target, like a stroll, and selection leaves it alone as it leaves a stroll. A book whose tile is the last step of anyone's target-less path is claimed and is not offered again, so two housemates never race for one book. A critical need comes first; otherwise putting the book away comes before the next ordinary choice, which is why it happens within minutes in the shipped household, where selection almost never leaves anyone idle (the first version waited for `Restless`, which nobody in the seed 11 household reached in a whole day). The claim is that path, which saves already carry, so no saved field is added. If the walk is replaced (a critical need or an order), the claim lapses with it and the book is offered again.
3. **Pickup.** After movement, a free housemate with no need critical standing on the tile of an unclaimed floor book that can be put back, with no walk left, picks it up; the lowest entity index wins a tile two reach together. The library claims and carries the copy in one step (`BookLibrary::pick_up_from_floor`), giving a copy with no home (one an older save left on the floor) a free slot chosen as **Recover book** chooses one. A copy with no home and no free slot cannot be put back, so it is never claimed.
4. **Return.** The housemate then puts the copy back through the ordinary return: a reading journey in `WaitingReturn` routed home, whose origin is the home shelf's own reading row, with no reading done. Contacts, reservations, waits, saves and the shift start treat it as any reader's return, so a worker tidying when their shift starts is bounded by the cap above.
5. **No randomness.** Neither step draws a random number, and both stop after one scan of the library when no book is on the floor, so a world with no floor book behaves exactly as before.

## [LB-save] Saves, tuning and hashes

No saved field and no tuning field is added. The cap reads the saved shift and the existing limit; the floor rules read the saved library, the saved paths and the saved journeys. A save taken on the way to a floor book or on the way back to the bookcase loads into the same world. No shipped-household pin moved: in the pinned runs nobody is still returning a book at the limit and no book reaches the floor. The verification record lists the values checked.

## [LB-tests] Verification

The tests are in `crates/terri-sim/src/reading/tests/floor.rs`:

1. A reader whose walk back is longer than the allowance walks back from the start and departs exactly on the start plus the limit, with the book on the floor at their position and its home kept; one tick before, the book is still in hand.
2. A return that ends inside the allowance shelves the book before the worker leaves, and a limit of 0 keeps the return unbounded.
3. An idle housemate shelves a floor book in its home slot; a floor book with no home is given a slot and shelved; a book dropped by a death is shelved by the housemate left.
4. Two idle housemates and one floor book: only one ever sets off for it, once, and the book is shelved.
5. A sleeper or a worker at work is never free to tidy, and neither a sleeper nor a person with a critical need standing on a floor book picks it up; a critical need or an open shift comes before claiming one, and so do a shift starting within the limit and a deferred departure.
6. A book whose bookcase cannot be reached from it is never picked up, and a book on a tile nobody can reach is never claimed.
7. A save on the way to the book and a save on the way back each load into a second world that runs beside an uninterrupted one with equal hashes every tick until after the book is shelved.
8. A reader cut off mid-reading at the limit keeps the satisfaction the reading earned.
9. The manual release test `seed_11_casey_leaves_at_the_limit_and_her_book_is_shelved` replays the traced case.
