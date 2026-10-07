use super::*;
use terri_core::books::*;
use terri_core::{Funds, SimId};

fn world(now: u64) -> BookWorld<'static> {
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
                slots: 1,
            },
        ],
        known_sims: &[SimId(1), SimId(2), SimId(3)],
        living_sims: &[SimId(1), SimId(2)],
        lot_width: 20,
        lot_height: 20,
        now,
    }
}

fn buy(library: &mut BookLibrary, title: &str) -> BookCopyId {
    library
        .purchase(title, Some(BookShelfId(7)), &mut Funds(100), &world(0))
        .unwrap()
}

fn borrow(library: &mut BookLibrary, copy: BookCopyId, person: SimId, now: u64) {
    library.reserve(copy, person, &world(now)).unwrap();
    library.pick_up(copy, person, &world(now)).unwrap();
}

fn standard() -> &'static str {
    "the_quiet_moon"
}

fn close(actual: f32, expected: f32) {
    assert!(
        (actual - expected).abs() < 0.00001,
        "{actual} != {expected}"
    );
}

#[test]
fn new_household_is_empty_and_migration_grants_five_distinct_titles_once() {
    let mut library = BookLibrary::new(43);
    assert!(library.state().copies.is_empty());
    assert!(!library.state().migration_granted);
    let mut context = world(0);
    context.shelves = &[];
    assert_eq!(library.grant_migration_starters(&context).unwrap().len(), 5);
    assert!(library
        .state()
        .copies
        .iter()
        .all(|copy| copy.location == BookLocation::Inventory));
    assert_eq!(
        library
            .state()
            .copies
            .iter()
            .map(|copy| &copy.title_id)
            .collect::<std::collections::BTreeSet<_>>()
            .len(),
        5
    );
    let saved = library.state().clone();
    assert!(library
        .grant_migration_starters(&context)
        .unwrap()
        .is_empty());
    assert_eq!(library.state(), &saved);
}

#[test]
fn migration_fills_shelves_before_inventory_and_rejects_partial_grants_atomically() {
    let mut library = BookLibrary::new(1);
    let mut context = world(0);
    context.shelves = &[ShelfCapacity {
        id: BookShelfId(8),
        slots: 2,
    }];
    library.grant_migration_starters(&context).unwrap();
    assert_eq!(
        library.shelf_slots(BookShelfId(8), 2),
        vec![Some(BookCopyId(0)), Some(BookCopyId(1))]
    );
    assert_eq!(
        library
            .state()
            .copies
            .iter()
            .filter(|copy| copy.location == BookLocation::Inventory)
            .count(),
        3
    );
    let mut empty = BookLibrary::new(1);
    context.books = &context.books[..1];
    let before = empty.state().clone();
    assert!(empty.grant_migration_starters(&context).is_err());
    assert_eq!(empty.state(), &before);
}

#[test]
fn purchases_charge_once_fallback_to_inventory_and_refuse_atomically() {
    let mut library = BookLibrary::new(1);
    let mut funds = Funds(20);
    let first = library
        .purchase(standard(), Some(BookShelfId(8)), &mut funds, &world(0))
        .unwrap();
    let second = library
        .purchase(standard(), Some(BookShelfId(8)), &mut funds, &world(0))
        .unwrap();
    assert_eq!(funds.0, 0);
    assert_ne!(first, second);
    assert_eq!(
        library.copy(second).unwrap().location,
        BookLocation::Inventory
    );
    assert_eq!(
        library.reserve(second, SimId(1), &world(0)),
        Err(BookError::NotReadable)
    );
    let before = library.state().clone();
    assert_eq!(
        library.purchase(standard(), None, &mut funds, &world(0)),
        Err(BookError::InsufficientFunds)
    );
    assert_eq!(library.state(), &before);
    assert_eq!(funds.0, 0);
    funds.0 = 100;
    assert!(library
        .purchase(standard(), Some(BookShelfId(99)), &mut funds, &world(0))
        .is_err());
    assert!(library
        .purchase("unknown", None, &mut funds, &world(0))
        .is_err());
    assert_eq!(library.state(), &before);
    assert_eq!(funds.0, 100);
}

#[test]
fn reservations_leave_visible_books_until_pickup_and_hold_their_home_gap() {
    let mut library = BookLibrary::new(1);
    let copy = buy(&mut library, standard());
    library.reserve(copy, SimId(1), &world(0)).unwrap();
    assert_eq!(library.shelf_slots(BookShelfId(7), 24)[0], Some(copy));
    library.pick_up(copy, SimId(1), &world(0)).unwrap();
    assert_eq!(library.shelf_slots(BookShelfId(7), 24)[0], None);
    assert_eq!(library.reserved_slots(BookShelfId(7), 24)[0], Some(copy));
    assert_eq!(
        library.transfer(copy, None, &world(0)),
        Err(BookError::Borrowed(copy))
    );
    assert_eq!(
        library.remove_copy(copy, &world(0)),
        Err(BookError::Borrowed(copy))
    );
    assert_eq!(
        library.evacuate_shelf(BookShelfId(7), &world(0)),
        Err(BookError::Borrowed(copy))
    );
    assert_eq!(
        library.reserve(copy, SimId(2), &world(0)),
        Err(BookError::Borrowed(copy))
    );
    let other = buy(&mut library, standard());
    assert_eq!(library.copy(other).unwrap().home.unwrap().slot, 1);
    assert_eq!(
        library.reserve(other, SimId(1), &world(0)),
        Err(BookError::AlreadyBorrowing(SimId(1)))
    );
    library.return_copy(copy, SimId(1), &world(0)).unwrap();
    assert_eq!(library.shelf_slots(BookShelfId(7), 24)[0], Some(copy));
    borrow(&mut library, copy, SimId(2), 0);
    library.return_copy(copy, SimId(2), &world(0)).unwrap();
}

#[test]
fn transfer_release_and_sale_preserve_other_copy_identities() {
    let mut library = BookLibrary::new(1);
    let copy = buy(&mut library, standard());
    library.reserve(copy, SimId(1), &world(0)).unwrap();
    library
        .release_reservation(copy, SimId(1), &world(0))
        .unwrap();
    library
        .transfer(copy, Some(BookShelfId(8)), &world(0))
        .unwrap();
    assert_eq!(
        library.copy(copy).unwrap().home.unwrap().shelf,
        BookShelfId(8)
    );
    let another = buy(&mut library, standard());
    let before = library.state().clone();
    assert_eq!(
        library.transfer(another, Some(BookShelfId(8)), &world(0)),
        Err(BookError::ShelfFull(BookShelfId(8)))
    );
    assert_eq!(library.state(), &before);
    library.evacuate_shelf(BookShelfId(8), &world(0)).unwrap();
    assert_eq!(
        library.copy(copy).unwrap().location,
        BookLocation::Inventory
    );
    assert_eq!(library.remove_copy(copy, &world(0)).unwrap().id, copy);
    assert!(buy(&mut library, standard()).0 > another.0);
}

#[test]
fn three_sessions_complete_a_standard_title_with_full_first_pass_rewards() {
    let mut library = BookLibrary::new(1);
    let copy = buy(&mut library, standard());
    borrow(&mut library, copy, SimId(1), 0);
    for (now, complete) in [(60, false), (120, false), (180, true)] {
        let work = library.read_work(copy, SimId(1), 60, &world(now)).unwrap();
        assert_eq!(work.consumed_ticks, 60);
        close(work.novelty, 1.0);
        close(work.fun, 30.0);
        close(work.satisfaction, 3.0);
        assert_eq!(work.completed, complete);
    }
    let memory = library.memory(SimId(1), standard()).unwrap();
    assert_eq!(memory.completed_passes, 1);
    assert_eq!(memory.progress_ticks, 0);
    close(memory.familiarity, 1.0);
    close(
        library
            .read_work(copy, SimId(1), 60, &world(180))
            .unwrap()
            .novelty,
        0.2,
    );
}

#[test]
fn annual_recovery_uses_sim_time_and_queries_do_not_change_memory() {
    let mut library = BookLibrary::new(1);
    let copy = buy(&mut library, standard());
    borrow(&mut library, copy, SimId(1), 0);
    for now in [60, 120, 180] {
        library.read_work(copy, SimId(1), 60, &world(now)).unwrap();
    }
    let saved = library.state().clone();
    for (elapsed, expected) in [(0, 0.2), (525600, 0.6), (1051200, 1.0)] {
        let mut resumed = BookLibrary::from_saved(saved.clone(), &world(180 + elapsed)).unwrap();
        let before = resumed.state().clone();
        let interest = resumed
            .estimate_interest(SimId(1), standard(), &world(180 + elapsed))
            .unwrap();
        assert!(interest > 0.0);
        assert_eq!(resumed.state(), &before);
        close(
            resumed
                .read_work(copy, SimId(1), 60, &world(180 + elapsed))
                .unwrap()
                .novelty,
            expected,
        );
    }
}

#[test]
fn bookmark_and_pass_novelty_survive_interruptions_save_and_copy_switches() {
    let mut library = BookLibrary::new(19);
    let copy = buy(&mut library, standard());
    let second = buy(&mut library, standard());
    borrow(&mut library, copy, SimId(1), 0);
    library.read_work(copy, SimId(1), 25, &world(25)).unwrap();
    library.return_copy(copy, SimId(1), &world(25)).unwrap();
    let mut library = BookLibrary::from_saved(library.state().clone(), &world(4000)).unwrap();
    borrow(&mut library, second, SimId(1), 4000);
    let work = library
        .read_work(second, SimId(1), 60, &world(4060))
        .unwrap();
    close(work.novelty, 1.0);
    assert_eq!(
        library.memory(SimId(1), standard()).unwrap().progress_ticks,
        85
    );
    borrow(&mut library, copy, SimId(2), 4060);
    library.read_work(copy, SimId(2), 10, &world(4070)).unwrap();
    assert_eq!(
        library.memory(SimId(2), standard()).unwrap().progress_ticks,
        10
    );
    assert_eq!(
        library.memory(SimId(1), standard()).unwrap().progress_ticks,
        85
    );
}

#[test]
fn work_is_limited_by_book_end_not_session_time_and_zero_work_cannot_start_a_pass() {
    let mut library = BookLibrary::new(1);
    let copy = buy(&mut library, standard());
    borrow(&mut library, copy, SimId(1), 0);
    assert_eq!(
        library
            .read_work(copy, SimId(1), 0, &world(0))
            .unwrap()
            .consumed_ticks,
        0
    );
    assert!(library.state().memories.is_empty());
    assert_eq!(
        library
            .read_work(copy, SimId(1), 90, &world(90))
            .unwrap()
            .consumed_ticks,
        90
    );
    library.read_work(copy, SimId(1), 60, &world(120)).unwrap();
    library.read_work(copy, SimId(1), 20, &world(170)).unwrap();
    let work = library.read_work(copy, SimId(1), 60, &world(180)).unwrap();
    assert_eq!(work.consumed_ticks, 10);
    close(work.fun, 5.0);
    close(work.satisfaction, 0.5);
    assert!(work.completed);
    assert_eq!(
        library.read_work(copy, SimId(2), 60, &world(180)),
        Err(BookError::NotBorrower)
    );
}

#[test]
fn taste_is_stable_under_rename_catalogue_order_addition_and_query_repetition() {
    let library = BookLibrary::new(987);
    let mut context = world(0);
    let value = library
        .estimate_interest(SimId(1), standard(), &context)
        .unwrap();
    let mut books = context.books.to_vec();
    books.reverse();
    for book in &mut books {
        book.title = "Renamed".into();
    }
    let mut added = books[0].clone();
    added.id = "new_title".into();
    books.push(added);
    context.books = &books;
    for _ in 0..10 {
        close(
            library
                .estimate_interest(SimId(1), standard(), &context)
                .unwrap(),
            value,
        );
    }
    assert!(value > 0.0);
    assert_ne!(
        library
            .estimate_interest(SimId(2), standard(), &context)
            .unwrap(),
        value
    );
    assert_ne!(
        title_affinity(987, SimId(1), "mystery", "the_locked_laundry"),
        title_affinity(987, SimId(1), "mystery", "one_spoon_missing")
    );
    assert_ne!(
        title_affinity(987, SimId(1), "mystery", "same_title"),
        title_affinity(987, SimId(1), "horror", "same_title")
    );
    assert_ne!(
        title_affinity(987, SimId(1), "mystery", "same_title"),
        title_affinity(988, SimId(1), "mystery", "same_title")
    );
    assert_eq!(library.state(), BookLibrary::new(987).state());
}

#[test]
fn death_preserves_copy_and_historical_memory_and_recovery_restores_home() {
    let mut library = BookLibrary::new(1);
    let copy = buy(&mut library, standard());
    borrow(&mut library, copy, SimId(1), 0);
    library.read_work(copy, SimId(1), 15, &world(15)).unwrap();
    library
        .recover_on_death(SimId(1), (4.0, 5.0), &world(15))
        .unwrap();
    assert_eq!(
        library.copy(copy).unwrap().location,
        BookLocation::Lot { x: 4.0, y: 5.0 }
    );
    assert_eq!(library.copy(copy).unwrap().borrower, None);
    let mut context = world(15);
    context.living_sims = &[SimId(2)];
    let mut library = BookLibrary::from_saved(library.state().clone(), &context).unwrap();
    assert_eq!(
        library
            .memory(SimId(1), standard())
            .unwrap()
            .completed_passes,
        0
    );
    library.reserve(copy, SimId(2), &context).unwrap();
    library.pick_up(copy, SimId(2), &context).unwrap();
    library.return_copy(copy, SimId(2), &context).unwrap();
    assert_eq!(library.shelf_slots(BookShelfId(7), 24)[0], Some(copy));
}

#[test]
fn malformed_candidates_are_rejected_without_mutating_the_current_library() {
    let mut library = BookLibrary::new(1);
    let copy = buy(&mut library, standard());
    let second = buy(&mut library, standard());
    borrow(&mut library, copy, SimId(1), 0);
    library.read_work(copy, SimId(1), 25, &world(25)).unwrap();
    let original = library.state().clone();
    let cases: Vec<fn(&mut SavedBookLibrary)> = vec![
        |s| s.copies.push(s.copies[0].clone()),
        |s| s.copies[0].title_id = "unknown".into(),
        |s| s.next_copy_id = 1,
        |s| s.copies[0].home.as_mut().unwrap().slot = 24,
        |s| s.copies[0].home.as_mut().unwrap().shelf = BookShelfId(999),
        |s| s.copies[1].home = s.copies[0].home,
        |s| s.copies[0].borrower = None,
        |s| s.copies[0].home = None,
        |s| s.copies[1].borrower = Some(SimId(1)),
        |s| s.copies[0].location = BookLocation::Inventory,
        |s| {
            s.copies[0].location = BookLocation::Lot {
                x: f32::NAN,
                y: 0.0,
            }
        },
        |s| s.copies[0].borrower = Some(SimId(3)),
        |s| s.memories.push(s.memories[0].clone()),
        |s| s.memories[0].title_id = "missing".into(),
        |s| s.memories[0].sim_id = SimId(99),
        |s| s.memories[0].familiarity = f32::NAN,
        |s| s.memories[0].familiarity = 1.1,
        |s| s.memories[0].last_read_tick = 26,
        |s| s.memories[0].progress_ticks = 180,
        |s| s.memories[0].pass_novelty = None,
        |s| s.memories[0].pass_novelty = Some(0.0),
    ];
    for (index, corrupt) in cases.into_iter().enumerate() {
        let mut candidate = original.clone();
        corrupt(&mut candidate);
        assert!(
            BookLibrary::from_saved(candidate, &world(25)).is_err(),
            "corruption {index}"
        );
        assert_eq!(library.state(), &original);
    }
    assert!(library.copy(second).is_some());
}

#[test]
fn allocator_exhaustion_refuses_purchase_and_grant_without_charging_or_partial_books() {
    let mut saved = BookLibrary::new(1).state().clone();
    saved.next_copy_id = u32::MAX;
    let mut library = BookLibrary::from_saved(saved.clone(), &world(0)).unwrap();
    let mut funds = Funds(100);
    assert_eq!(
        library.purchase(standard(), None, &mut funds, &world(0)),
        Err(BookError::CopyIdsExhausted)
    );
    assert_eq!(
        library.grant_migration_starters(&world(0)),
        Err(BookError::CopyIdsExhausted)
    );
    assert_eq!(funds.0, 100);
    assert_eq!(library.state(), &saved);
}

#[test]
fn reread_novelty_survives_a_long_pause_and_restoring_saved_state() {
    let mut library = BookLibrary::new(1);
    let copy = buy(&mut library, standard());
    borrow(&mut library, copy, SimId(1), 0);
    for now in [60, 120, 180] {
        library.read_work(copy, SimId(1), 60, &world(now)).unwrap();
    }
    close(
        library
            .read_work(copy, SimId(1), 10, &world(180))
            .unwrap()
            .novelty,
        0.2,
    );
    library.return_copy(copy, SimId(1), &world(180)).unwrap();
    let decoded = library.state().clone();
    let mut library = BookLibrary::from_saved(decoded, &world(1051380)).unwrap();
    borrow(&mut library, copy, SimId(1), 1051380);
    close(
        library
            .read_work(copy, SimId(1), 60, &world(1051440))
            .unwrap()
            .novelty,
        0.2,
    );
    assert_eq!(
        library.memory(SimId(1), standard()).unwrap().progress_ticks,
        70
    );
}

#[test]
fn a_full_shelf_sends_every_starter_copy_to_inventory() {
    let mut library = BookLibrary::new(1);
    let mut context = world(0);
    context.shelves = &[ShelfCapacity {
        id: BookShelfId(8),
        slots: 1,
    }];
    let existing = library
        .purchase(standard(), Some(BookShelfId(8)), &mut Funds(100), &context)
        .unwrap();
    let granted = library.grant_migration_starters(&context).unwrap();
    assert_eq!(granted.len(), 5);
    assert_eq!(library.shelf_slots(BookShelfId(8), 1), [Some(existing)]);
    for copy in granted {
        assert_eq!(
            library.copy(copy).unwrap().location,
            BookLocation::Inventory
        );
    }
}

#[test]
fn a_copy_is_unreadable_until_its_reserved_owner_has_picked_it_up() {
    let mut library = BookLibrary::new(1);
    let copy = buy(&mut library, standard());
    assert_eq!(
        library.read_work(copy, SimId(1), 60, &world(0)),
        Err(BookError::NotBorrower)
    );
    library.reserve(copy, SimId(1), &world(0)).unwrap();
    assert_eq!(
        library.read_work(copy, SimId(1), 60, &world(0)),
        Err(BookError::NotReadable)
    );
    library.pick_up(copy, SimId(1), &world(0)).unwrap();
    assert_eq!(
        library.release_reservation(copy, SimId(1), &world(0)),
        Err(BookError::Borrowed(copy))
    );
    assert!(library.state().memories.is_empty());
}

#[test]
fn familiarity_rises_only_with_actual_work_and_browsing_does_not_postpone_recovery() {
    let mut library = BookLibrary::new(1);
    let copy = buy(&mut library, standard());
    borrow(&mut library, copy, SimId(1), 0);
    library.read_work(copy, SimId(1), 30, &world(30)).unwrap();
    close(
        library.memory(SimId(1), standard()).unwrap().familiarity,
        1.0 / 6.0,
    );
    let before = library.state().clone();
    library
        .estimate_interest(SimId(1), standard(), &world(10000))
        .unwrap();
    library.read_work(copy, SimId(1), 0, &world(10000)).unwrap();
    assert_eq!(library.state(), &before);
    assert_eq!(
        library.memory(SimId(1), standard()).unwrap().last_read_tick,
        30
    );
}

#[test]
fn death_cancels_an_uncollected_reservation_without_removing_the_shelved_book() {
    let mut library = BookLibrary::new(1);
    let copy = buy(&mut library, standard());
    library.reserve(copy, SimId(1), &world(0)).unwrap();
    let mut context = world(0);
    context.living_sims = &[SimId(2)];
    library
        .recover_on_death(SimId(1), (3.0, 4.0), &context)
        .unwrap();
    assert_eq!(library.shelf_slots(BookShelfId(7), 24)[0], Some(copy));
    assert_eq!(library.copy(copy).unwrap().borrower, None);
}

#[test]
fn interest_queries_reject_invalid_requested_people_titles_tuning_and_bookmarks() {
    let mut library = BookLibrary::new(1);
    let copy = buy(&mut library, standard());
    borrow(&mut library, copy, SimId(1), 0);
    library.read_work(copy, SimId(1), 30, &world(30)).unwrap();
    assert!(library
        .estimate_interest(SimId(3), standard(), &world(30))
        .is_err());
    assert!(library
        .estimate_interest(SimId(1), "missing", &world(30))
        .is_err());
    assert!(library
        .estimate_interest(SimId(1), standard(), &world(29))
        .is_err());
    let mut context = world(30);
    let mut tuning = *context.tuning;
    tuning.recovery_ticks = 0;
    context.tuning = &tuning;
    assert!(library
        .estimate_interest(SimId(1), standard(), &context)
        .is_err());
    let mut context = world(30);
    context.known_sims = &[SimId(2), SimId(3)];
    assert!(library
        .estimate_interest(SimId(1), standard(), &context)
        .is_err());
    let mut books = world(30).books.to_vec();
    books
        .iter_mut()
        .find(|book| book.id == standard())
        .unwrap()
        .reading_minutes = 0;
    let mut context = world(30);
    context.books = &books;
    assert!(library
        .estimate_interest(SimId(1), standard(), &context)
        .is_err());
}
