use super::*;
use terri_core::{books::*, Funds, SimId};

fn context() -> BookWorld<'static> {
    let pack = terri_data::pack();
    BookWorld {
        books: &pack.books,
        tuning: pack.reading.as_ref().unwrap(),
        shelves: &[
            ShelfCapacity {
                id: BookShelfId(7),
                slots: 24,
            },
            ShelfCapacity {
                id: BookShelfId(8),
                slots: 24,
            },
        ],
        known_sims: &[SimId(1), SimId(2)],
        living_sims: &[SimId(1), SimId(2)],
        lot_width: 20,
        lot_height: 20,
        now: 0,
    }
}

#[test]
fn quotes_are_stable_and_leave_ownership_unchanged() {
    let library = BookLibrary::new(43);
    let before = library.state().clone();
    let quote = library.quote_purchase(Funds(100), &context()).unwrap();
    assert_eq!(
        library.quote_purchase(Funds(100), &context()).unwrap(),
        quote
    );
    assert_eq!(*library.state(), before);
    assert_eq!(
        quote.price,
        context()
            .books
            .iter()
            .find(|b| b.id == quote.title)
            .unwrap()
            .price
    );
}

#[test]
fn purchase_uses_the_less_populated_case_even_when_books_are_borrowed() {
    let mut library = BookLibrary::new(43);
    let first = library
        .purchase(
            "the_locked_laundry",
            Some(BookShelfId(7)),
            &mut Funds(100),
            &context(),
        )
        .unwrap();
    library.reserve(first, SimId(1), &context()).unwrap();
    library.pick_up(first, SimId(1), &context()).unwrap();
    let quote = library.quote_purchase(Funds(100), &context()).unwrap();
    assert_eq!(quote.home.shelf, BookShelfId(8));
    let mut funds = Funds(100);
    let id = library
        .purchase_quoted(&quote, &mut funds, &context())
        .unwrap();
    assert_eq!(funds.0, 100 - i64::from(quote.price));
    assert_eq!(library.copy(id).unwrap().home, Some(quote.home));
    assert_eq!(
        library.copy(first).unwrap().home.unwrap().shelf,
        BookShelfId(7)
    );
}

#[test]
fn stale_purchase_cannot_charge_or_create_another_copy() {
    let mut library = BookLibrary::new(43);
    let quote = library.quote_purchase(Funds(100), &context()).unwrap();
    let mut funds = Funds(100);
    library
        .purchase_quoted(&quote, &mut funds, &context())
        .unwrap();
    let before = library.state().clone();
    let balance = funds;
    assert!(library
        .purchase_quoted(&quote, &mut funds, &context())
        .is_err());
    assert_eq!(*library.state(), before);
    assert_eq!(funds, balance);
}

#[test]
fn absent_or_full_cases_refuse_purchases_without_an_inventory_fallback() {
    let mut library = BookLibrary::new(43);
    let mut world = context();
    world.shelves = &[];
    assert!(library.quote_purchase(Funds(100), &world).is_err());
    world.shelves = &[ShelfCapacity {
        id: BookShelfId(7),
        slots: 1,
    }];
    library
        .purchase(
            "the_locked_laundry",
            Some(BookShelfId(7)),
            &mut Funds(100),
            &world,
        )
        .unwrap();
    assert!(library.quote_purchase(Funds(100), &world).is_err());
}

#[test]
fn sale_is_shelf_local_and_refuses_borrowed_and_forged_quotes() {
    let mut library = BookLibrary::new(43);
    let copy = library
        .purchase(
            "the_locked_laundry",
            Some(BookShelfId(7)),
            &mut Funds(100),
            &context(),
        )
        .unwrap();
    assert!(library.quote_sale(BookShelfId(8), &context(), 0.5).is_err());
    let quote = library.quote_sale(BookShelfId(7), &context(), 0.5).unwrap();
    assert_eq!(quote.copy, copy);
    assert_eq!(quote.price, 3);
    let mut wrong = quote.clone();
    wrong.price += 1;
    let mut funds = Funds(0);
    let before = library.state().clone();
    assert!(library
        .sell_quoted(&wrong, &mut funds, &context(), 0.5)
        .is_err());
    assert_eq!(*library.state(), before);
    assert_eq!(funds.0, 0);
    library.reserve(copy, SimId(1), &context()).unwrap();
    assert!(library.quote_sale(BookShelfId(7), &context(), 0.5).is_err());
    assert!(library
        .sell_quoted(&quote, &mut funds, &context(), 0.5)
        .is_err());
}

#[test]
fn inventory_arrivals_balance_and_keep_existing_homes() {
    let mut library = BookLibrary::new(43);
    let existing = library
        .purchase(
            "the_locked_laundry",
            Some(BookShelfId(7)),
            &mut Funds(100),
            &context(),
        )
        .unwrap();
    let home = library.copy(existing).unwrap().home;
    let arrival = library
        .purchase("a_second_cup", None, &mut Funds(100), &context())
        .unwrap();
    assert_eq!(library.shelve_inventory(&context()).unwrap(), vec![arrival]);
    assert_eq!(library.copy(existing).unwrap().home, home);
    assert_eq!(
        library.copy(arrival).unwrap().home.unwrap().shelf,
        BookShelfId(8)
    );
}

#[test]
fn fresh_household_has_three_unique_scattered_books() {
    let sim = crate::Sim::new_from_shipped_lot_with_seed(43);
    let copies = sim.book_copies();
    assert_eq!(copies.len(), 3);
    assert_eq!(
        copies
            .iter()
            .map(|copy| &copy.title_id)
            .collect::<std::collections::BTreeSet<_>>()
            .len(),
        3
    );
    let slots: Vec<_> = copies.iter().map(|copy| copy.home.unwrap().slot).collect();
    assert_ne!(slots, vec![0, 1, 2]);
}

#[test]
fn starter_overflow_keeps_unique_copies_without_charging() {
    let mut library = BookLibrary::new(43);
    let mut world = context();
    world.shelves = &[ShelfCapacity {
        id: BookShelfId(7),
        slots: 1,
    }];
    assert_eq!(
        library.grant_new_household_starters(&world).unwrap().len(),
        3
    );
    assert_eq!(
        library
            .state()
            .copies
            .iter()
            .filter(|copy| copy.location == BookLocation::Inventory)
            .count(),
        2
    );
    assert!(library.grant_new_household_starters(&world).is_err());
    assert!(!library.state().migration_granted);
}

#[test]
fn reading_rank_orders_unfinished_unread_and_oldest_completed() {
    let mut world = context();
    world.now = 30;
    let mut saved = BookLibrary::new(43).state().clone();
    for (title, progress, passes, tick) in [
        ("the_locked_laundry", 10, 0, 20),
        ("a_second_cup", 0, 1, 4),
        ("the_quiet_moon", 0, 1, 18),
    ] {
        saved.memories.push(TitleMemory {
            sim_id: SimId(1),
            title_id: title.into(),
            progress_ticks: progress,
            progress_fraction: 0.0,
            pass_novelty: (progress > 0).then_some(1.0),
            familiarity: if passes > 0 { 0.5 } else { 0.0 },
            last_read_tick: tick,
            completed_passes: passes,
        });
    }
    let library = BookLibrary::from_saved(saved, &world).unwrap();
    let unfinished = library
        .reading_priority(SimId(1), "the_locked_laundry", &world)
        .unwrap();
    let unread = library
        .reading_priority(SimId(1), "the_minor_dragon", &world)
        .unwrap();
    let oldest = library
        .reading_priority(SimId(1), "a_second_cup", &world)
        .unwrap();
    let newer = library
        .reading_priority(SimId(1), "the_quiet_moon", &world)
        .unwrap();
    assert!(unfinished < unread);
    assert!(unread < oldest);
    assert!(oldest < newer);
}
