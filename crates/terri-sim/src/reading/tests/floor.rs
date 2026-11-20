//! Late book returns and floor books
//! (`docs/specs/2026-11-19-late-book-returns.md`). Owner ruling 2026-11-17:
//! at the lateness limit a reader still returning a book drops it where they
//! stand and leaves; housemates pick up floor books and shelve them on their
//! own. Every test drives the real tick.
use super::*;
use terri_core::books::BookCopy;

/// The fixture's shift: a day shift starting at this tick, every day.
const START: u64 = 400;

/// The reading fixture with a far armchair, a front door and a job for the
/// reader, with the career's random events off. Returns the fixture's
/// values with the far armchair in place of the near seat.
fn working_reader(limit: u32) -> (Sim, Entity, Entity, Entity, String) {
    let (mut sim, person, shelf, _near, title) = fixture("armchair");
    let mut pack = sim.world().resource::<Content>().0.clone();
    pack.lot.front_door = Some((0, 0));
    pack.tuning.work_lateness_limit_ticks = limit;
    pack.tuning.work_lateness_ramp_ticks = pack.tuning.work_lateness_ramp_ticks.min(limit.max(1));
    pack.tuning.career_search_chance = 0.0;
    pack.tuning.career_review_noise = 0.0;
    pack.tuning.career_fire_base = 0.0;
    pack.tuning.career_demote_base = 0.0;
    pack.tuning.career_promote_base = 0.0;
    pack.tuning.career_raise_base = 0.0;
    pack.careers[0].shift_start = START as u32;
    pack.careers[0].shift_ticks = 480;
    pack.careers[0].working_days = 0b1111111;
    let content = Content(Box::leak(Box::new(pack)));
    sim.world_mut().insert_resource(content);
    let far = sim.spawn_object(
        Position { x: 17.0, y: 16.0 },
        content.0.find("armchair").unwrap(),
    );
    sim.world_mut().entity_mut(person).insert(Career(0));
    issue(
        &mut sim,
        SimCommand::SetCareerAutonomy {
            change: false,
            search: false,
        },
    );
    sim.flush_commands();
    (sim, person, shelf, far, title)
}

/// Turns a player's reading into the housemate's own: the journey loses its
/// order, as an autonomous reading has none, so nothing a player asked for
/// holds the departure.
fn make_autonomous(sim: &mut Sim, person: Entity) {
    let world = sim.world_mut();
    world.get_mut::<IntentQueue>(person).unwrap().clear();
    world
        .resource_mut::<crate::player_actions::PlayerActions>()
        .orders
        .retain(|(owner, _), _| *owner != person);
    world
        .entity_mut(person)
        .remove::<crate::player_actions::FrontOrder>();
    world.get_mut::<ReadingJourney>(person).unwrap().order = None;
}

/// Reads at `seat` until the reading has begun, makes it the housemate's
/// own, and runs to the tick before the shift starts.
fn reading_at_the_start(sim: &mut Sim, person: Entity, seat: Entity, title: &str) {
    read(sim, person, seat, title, false);
    until(sim, person, ReadingStage::Read);
    make_autonomous(sim, person);
    sim.world_mut().resource_mut::<SimClock>().tick = START - 1;
    assert_eq!(
        stage(sim, person),
        Some(ReadingStage::Read),
        "reading before the start"
    );
    sim.tick();
    assert_eq!(now(sim), START);
    assert!(
        matches!(
            stage(sim, person),
            Some(ReadingStage::Return | ReadingStage::WaitingReturn)
        ),
        "the shift start sent the reader back to the bookcase"
    );
}

fn now(sim: &Sim) -> u64 {
    sim.world().resource::<SimClock>().tick
}
fn away(sim: &Sim, person: Entity) -> bool {
    sim.world().get::<Commuting>(person).is_some() || sim.world().get::<AtWork>(person).is_some()
}
fn copy(sim: &Sim) -> BookCopy {
    sim.book_copies()[0].clone()
}

/// Ticks until the worker is away and returns the first tick seen away.
fn departure(sim: &mut Sim, person: Entity, within: u64) -> u64 {
    for _ in 0..within {
        sim.tick();
        if away(sim, person) {
            return now(sim);
        }
    }
    panic!("did not leave within {within} ticks of {}", now(sim));
}

/// A second housemate with nothing to do: every need full, no job.
fn idle_housemate(sim: &mut Sim, at: (f32, f32)) -> Entity {
    let id = sim.world_mut().resource_mut::<SimIdAllocator>().issue();
    sim.world_mut()
        .spawn((
            Agent,
            id,
            Position { x: at.0, y: at.1 },
            Needs::all_at(100.0),
            IntentQueue::default(),
            Personality::default(),
            Relationships::default(),
            Satisfaction::from_value(0.0),
        ))
        .id()
}

/// Rewrites the first copy in the library with `edit`, validated as a load
/// would, so a test can lay a book on the floor as a save may hold it.
fn edit_copy(sim: &mut Sim, edit: impl FnOnce(&mut BookCopy)) {
    let mut saved = sim.world().resource::<BookLibrary>().state().clone();
    edit(&mut saved.copies[0]);
    let library = with_book_world(sim.world(), |context| {
        BookLibrary::from_saved(saved, context)
    })
    .expect("a valid floor book");
    sim.world_mut().insert_resource(library);
}

fn on_the_floor(copy: &BookCopy) -> bool {
    matches!(copy.location, BookLocation::Lot { .. }) && copy.borrower.is_none()
}

/// [LB-cap]: the walk back to the bookcase is longer than the allowance.
/// The worker walks back from the start, and on the start plus the limit
/// leaves the book on the floor where they stand and departs that tick,
/// keeping the book's home.
#[test]
fn a_reader_still_returning_at_the_limit_leaves_the_book_and_departs_at_the_limit() {
    let (mut sim, person, shelf, far, title) = working_reader(60);
    purchase(&mut sim, Some(shelf), &title);
    let home = copy(&sim).home;
    reading_at_the_start(&mut sim, person, far, &title);
    let mut returning = false;
    let mut last_position = None;
    for _ in 0..200 {
        let before = *sim.world().get::<Position>(person).unwrap();
        sim.tick();
        if away(&sim, person) {
            last_position = Some(before);
            break;
        }
        returning |= matches!(
            stage(&sim, person),
            Some(ReadingStage::Return | ReadingStage::WaitingReturn)
        );
    }
    assert!(
        returning,
        "the case under test: the worker walked the book back first"
    );
    assert_eq!(now(&sim), START + 60, "left on the tick the allowance ends");
    let book = copy(&sim);
    assert!(
        on_the_floor(&book),
        "the book is left on the floor: {book:?}"
    );
    assert_eq!(book.home, home, "the floor book keeps its home");
    let at = last_position.unwrap();
    assert_eq!(
        book.location,
        BookLocation::Lot { x: at.x, y: at.y },
        "where the worker stood"
    );
    assert!(sim.world().get::<ReadingJourney>(person).is_none());
}

/// The cap is exact: one tick before the limit the worker is still at home
/// with the book in hand.
#[test]
fn the_book_is_still_in_hand_one_tick_before_the_limit() {
    let (mut sim, person, shelf, far, title) = working_reader(60);
    purchase(&mut sim, Some(shelf), &title);
    reading_at_the_start(&mut sim, person, far, &title);
    while now(&sim) < START + 59 {
        sim.tick();
    }
    assert!(!away(&sim, person));
    assert!(matches!(copy(&sim).location, BookLocation::Carried(_)));
    sim.tick();
    assert!(away(&sim, person));
    assert!(on_the_floor(&copy(&sim)));
}

/// A return that ends inside the allowance shelves the book first, as
/// before: the near armchair's walk back is short.
#[test]
fn a_return_inside_the_limit_shelves_the_book_before_leaving() {
    let (mut sim, person, shelf, _far, title) = working_reader(60);
    let near = sim.spawn_object(
        Position { x: 5.0, y: 5.0 },
        sim.world()
            .resource::<Content>()
            .0
            .find("armchair")
            .unwrap(),
    );
    purchase(&mut sim, Some(shelf), &title);
    reading_at_the_start(&mut sim, person, near, &title);
    let left = departure(&mut sim, person, 200);
    assert!(left < START + 60, "left at {left}, inside the allowance");
    assert!(matches!(copy(&sim).location, BookLocation::Shelf(_)));
}

/// A limit of 0 keeps the return unbounded, as a world from a pack
/// published before the lateness knobs always had.
#[test]
fn a_limit_of_zero_keeps_the_book_return_unbounded() {
    let (mut sim, person, shelf, far, title) = working_reader(0);
    purchase(&mut sim, Some(shelf), &title);
    reading_at_the_start(&mut sim, person, far, &title);
    let left = departure(&mut sim, person, 300);
    assert!(
        left > START + 60,
        "the long walk back ran to the end: {left}"
    );
    assert!(matches!(copy(&sim).location, BookLocation::Shelf(_)));
}

/// [LB-floor]: an idle housemate walks to a book on the floor, picks it up
/// and puts it back in its home slot through the ordinary return.
#[test]
fn an_idle_housemate_shelves_a_floor_book() {
    let (mut sim, person, shelf, _seat, title) = fixture("armchair");
    purchase(&mut sim, Some(shelf), &title);
    sim.world_mut()
        .entity_mut(person)
        .insert(Needs::all_at(100.0));
    let home = copy(&sim).home;
    edit_copy(&mut sim, |book| {
        book.location = BookLocation::Lot { x: 15.0, y: 12.0 }
    });
    let mut picked = false;
    for _ in 0..1500 {
        sim.tick();
        picked |= stage(&sim, person) == Some(ReadingStage::Return);
        if matches!(copy(&sim).location, BookLocation::Shelf(_)) {
            break;
        }
    }
    assert!(picked, "the housemate carried it back");
    assert_eq!(copy(&sim).location, BookLocation::Shelf(home.unwrap()));
    assert!(copy(&sim).borrower.is_none());
    assert!(sim.world().get::<ReadingJourney>(person).is_none());
}

/// Two idle housemates and one floor book: only one ever sets off for it,
/// once, and the other never claims it, so there is no race and no back and
/// forth.
#[test]
fn two_idle_housemates_never_race_for_one_floor_book() {
    let (mut sim, first, shelf, seat, title) = fixture("armchair");
    purchase(&mut sim, Some(shelf), &title);
    // Nothing else to do: with the armchair gone both housemates are idle.
    sim.world_mut().despawn(seat);
    sim.world_mut()
        .entity_mut(first)
        .insert(Needs::all_at(100.0));
    let second = idle_housemate(&mut sim, (1.0, 2.0));
    edit_copy(&mut sim, |book| {
        book.location = BookLocation::Lot { x: 15.0, y: 12.0 }
    });
    let tile = (15, 12);
    let heading = |sim: &Sim, person: Entity| {
        sim.world().get::<Target>(person).is_none()
            && sim
                .world()
                .get::<Path>(person)
                .is_some_and(|path| path.steps.last() == Some(&tile))
    };
    let mut set_off = [0, 0];
    let mut was = [false, false];
    let mut carried_by = std::collections::BTreeSet::new();
    for _ in 0..1500 {
        sim.tick();
        for (n, person) in [first, second].into_iter().enumerate() {
            let now = heading(&sim, person);
            if now && !was[n] {
                set_off[n] += 1;
            }
            was[n] = now;
            if sim.world().get::<ReadingJourney>(person).is_some() {
                carried_by.insert(n);
            }
        }
        assert!(
            !(was[0] && was[1]),
            "both housemates headed for the one book"
        );
        if matches!(copy(&sim).location, BookLocation::Shelf(_)) {
            break;
        }
    }
    assert!(matches!(copy(&sim).location, BookLocation::Shelf(_)));
    assert_eq!(
        set_off.iter().sum::<u32>(),
        1,
        "one walk to the book: {set_off:?}"
    );
    assert_eq!(carried_by.len(), 1, "one housemate carried it");
}

/// A sleeper, a worker at work and a housemate busy with an interaction
/// never pick up a book they stand on; a free housemate does.
#[test]
fn a_sleeping_working_or_busy_housemate_never_picks_up_a_floor_book() {
    let (mut sim, person, shelf, _seat, title) = fixture("armchair");
    purchase(&mut sim, Some(shelf), &title);
    let pack = sim.world().resource::<Content>().0;
    let bed = pack.find("bed").unwrap();
    let sleep = pack
        .object(bed)
        .interactions
        .iter()
        .position(|a| a.tags.iter().any(|t| t == "sleep"))
        .unwrap_or(0) as u32;
    let now = now(&sim);
    sim.world_mut().entity_mut(person).insert(Eating {
        object: bed,
        interaction: sleep,
        remaining_ticks: 100,
    });
    assert!(
        !super::super::floor::free_to_tidy(sim.world(), person, now),
        "asleep"
    );
    sim.world_mut()
        .entity_mut(person)
        .remove::<Eating>()
        .insert(AtWork {
            remaining_ticks: 100,
        });
    assert!(
        !super::super::floor::free_to_tidy(sim.world(), person, now),
        "at work"
    );
    sim.world_mut().entity_mut(person).remove::<AtWork>();
    assert!(
        super::super::floor::free_to_tidy(sim.world(), person, now),
        "free"
    );
    let at = *sim.world().get::<Position>(person).unwrap();
    edit_copy(&mut sim, |book| {
        book.location = BookLocation::Lot { x: at.x, y: at.y }
    });
    sim.world_mut().entity_mut(person).insert(Eating {
        object: bed,
        interaction: sleep,
        remaining_ticks: 100,
    });
    crate::reading::floor::pick_up_arrivals(sim.world_mut());
    assert!(on_the_floor(&copy(&sim)), "a sleeper leaves it");
    sim.world_mut().entity_mut(person).remove::<Eating>();
    crate::reading::floor::pick_up_arrivals(sim.world_mut());
    assert_eq!(
        stage(&sim, person),
        Some(ReadingStage::Return),
        "a free housemate takes it"
    );
}

/// A book an older save left on the floor with no home is given a free
/// slot and shelved.
#[test]
fn a_floor_book_with_no_home_is_given_a_slot_and_shelved() {
    let (mut sim, person, shelf, _seat, title) = fixture("armchair");
    purchase(&mut sim, Some(shelf), &title);
    sim.world_mut()
        .entity_mut(person)
        .insert(Needs::all_at(100.0));
    edit_copy(&mut sim, |book| {
        book.home = None;
        book.location = BookLocation::Lot { x: 12.0, y: 4.0 };
    });
    for _ in 0..1500 {
        sim.tick();
        if matches!(copy(&sim).location, BookLocation::Shelf(_)) {
            break;
        }
    }
    let book = copy(&sim);
    assert!(matches!(book.location, BookLocation::Shelf(_)), "{book:?}");
    assert_eq!(book.location, BookLocation::Shelf(book.home.unwrap()));
}

/// A book a reader dropped by dying is shelved by the housemate left.
#[test]
fn a_book_dropped_by_a_death_is_shelved_by_a_housemate() {
    let (mut sim, reader, shelf, seat, title) = fixture("armchair");
    purchase(&mut sim, Some(shelf), &title);
    let other = idle_housemate(&mut sim, (1.0, 2.0));
    read(&mut sim, reader, seat, &title, false);
    until(&mut sim, reader, ReadingStage::Read);
    sim.tick();
    sim.world_mut()
        .entity_mut(reader)
        .insert((SimName("Reader".into()), Needs::with(NeedId::Hunger, 0.0)));
    let threshold = sim.world().resource::<Content>().0.tuning.death_after_ticks;
    sim.world_mut()
        .resource_mut::<terri_core::save::SavedMortality>()
        .counts = vec![(reader.index_u32(), threshold - 1)];
    sim.tick();
    assert!(sim.world().get_entity(reader).is_err());
    assert!(on_the_floor(&copy(&sim)));
    for _ in 0..1500 {
        sim.tick();
        if matches!(copy(&sim).location, BookLocation::Shelf(_)) {
            break;
        }
    }
    assert!(matches!(copy(&sim).location, BookLocation::Shelf(_)));
    assert!(sim.world().get_entity(other).is_ok());
}

/// A save on the way to a floor book and a save on the way back to the
/// bookcase both load into the same world and continue identically.
#[test]
fn a_save_mid_walk_and_mid_return_continues_identically() {
    let (mut sim, person, shelf, _seat, title) = fixture("armchair");
    purchase(&mut sim, Some(shelf), &title);
    sim.world_mut()
        .entity_mut(person)
        .insert(Needs::all_at(100.0));
    edit_copy(&mut sim, |book| {
        book.location = BookLocation::Lot { x: 15.0, y: 12.0 }
    });
    let mut checked = [false, false];
    for _ in 0..1500 {
        sim.tick();
        let walking = sim.world().get::<Target>(person).is_none()
            && sim.world().get::<Path>(person).is_some()
            && on_the_floor(&copy(&sim));
        let returning = stage(&sim, person) == Some(ReadingStage::Return)
            && sim.world().get::<Path>(person).is_some();
        for (n, now) in [walking, returning].into_iter().enumerate() {
            if now && !checked[n] {
                checked[n] = true;
                let saved = sim.current_v19_view();
                let before = sim.world_hash();
                sim.load_current_v19_view(saved.clone()).unwrap();
                assert_eq!(sim.current_v19_view(), saved);
                assert_eq!(sim.world_hash(), before);
            }
        }
        if matches!(copy(&sim).location, BookLocation::Shelf(_)) {
            break;
        }
    }
    assert_eq!(checked, [true, true], "both states were saved and loaded");
    assert!(matches!(copy(&sim).location, BookLocation::Shelf(_)));
}

/// The traced case (`docs/specs/2026-11-19-late-book-returns-verification.md`):
/// in the shipped household at world seed 11 Casey is reading across the
/// house when her shift starts at tick 9960, walks the book back for an hour
/// and, before this change, left 66 minutes late. She now leaves on the
/// start plus the limit with the book on the floor, and a housemate shelves
/// it. Manual, like the other long shipped-household runs: about ten
/// thousand ticks. Run with `--release --ignored`.
#[test]
#[ignore = "manual check: about a game week; run with --release and --ignored"]
fn seed_11_casey_leaves_at_the_limit_and_her_book_is_shelved() {
    const CASEY_START: u64 = 9960;
    let mut sim = Sim::new_from_shipped_lot_with_seed(11);
    let casey = sim
        .world_mut()
        .query::<(Entity, &SimName)>()
        .iter(sim.world())
        .find(|(_, name)| name.0 == "Casey")
        .map(|(entity, _)| entity)
        .expect("the shipped household has Casey");
    let limit = u64::from(
        sim.world()
            .resource::<Content>()
            .0
            .tuning
            .work_lateness_limit_ticks,
    );
    while now(&sim) <= CASEY_START {
        sim.tick();
    }
    assert!(
        matches!(
            stage(&sim, casey),
            Some(ReadingStage::Return | ReadingStage::WaitingReturn)
        ),
        "the case under test: Casey walks a book back when her shift starts"
    );
    let left = departure(&mut sim, casey, 200);
    assert_eq!(left, CASEY_START + limit, "Casey left at the limit");
    let dropped = sim
        .book_copies()
        .iter()
        .find(|copy| on_the_floor(copy))
        .map(|copy| copy.id)
        .expect("her book is on the floor");
    let mut shelved = None;
    for _ in 0..1440 {
        sim.tick();
        let book = sim.book_copies().iter().find(|c| c.id == dropped).unwrap();
        if matches!(book.location, BookLocation::Shelf(_)) {
            shelved = Some(now(&sim));
            break;
        }
    }
    let shelved = shelved.expect("a housemate shelved the book within a day");
    eprintln!("Casey left at {left}; her book was shelved at tick {shelved}");
}

/// A critical need comes before a floor book, and so does an open shift:
/// neither housemate sets off for it, while the same housemate with every
/// need full and no shift does.
#[test]
fn a_crisis_or_an_open_shift_comes_before_a_floor_book() {
    let (mut sim, person, shelf, _seat, title) = fixture("armchair");
    purchase(&mut sim, Some(shelf), &title);
    edit_copy(&mut sim, |book| {
        book.location = BookLocation::Lot { x: 15.0, y: 12.0 }
    });
    let heads_for_the_book = |sim: &mut Sim| {
        crate::reading::floor::claim(sim.world_mut());
        let walking = sim
            .world()
            .get::<Path>(person)
            .is_some_and(|path| path.steps.last() == Some(&(15, 12)));
        sim.world_mut().entity_mut(person).remove::<Path>();
        walking
    };
    sim.world_mut()
        .entity_mut(person)
        .insert(Needs::with(NeedId::Hunger, 0.0));
    assert!(!heads_for_the_book(&mut sim), "a crisis comes first");
    sim.world_mut()
        .entity_mut(person)
        .insert(Needs::all_at(100.0));
    let id = *sim.world().get::<SimId>(person).unwrap();
    let tick = now(&sim);
    sim.world_mut()
        .resource_mut::<crate::attendance::Attendance>()
        .shifts
        .insert(
            id,
            terri_core::save_v17::SavedScheduledShift {
                sim: id.0,
                career: 0,
                start_tick: tick,
                end_tick: tick + 480,
                worked_ticks: 0,
                accounted_tick: tick,
                pay_cents: 0,
                settled: false,
                legacy: false,
            },
        );
    assert!(!heads_for_the_book(&mut sim), "an open shift comes first");
    sim.world_mut()
        .resource_mut::<crate::attendance::Attendance>()
        .shifts
        .remove(&id);
    assert!(heads_for_the_book(&mut sim), "a free housemate goes for it");
}

/// [LB-cap] item 1: a journey cut off at the limit ends through the same
/// request a shift start makes, so a reader stopped mid-reading keeps the
/// life satisfaction the reading had earned, and the book still ends on the
/// floor.
#[test]
fn a_reader_cut_off_mid_reading_keeps_the_satisfaction_earned() {
    let (mut sim, person, shelf, seat, title) = fixture("armchair");
    purchase(&mut sim, Some(shelf), &title);
    read(&mut sim, person, seat, &title, false);
    until(&mut sim, person, ReadingStage::Read);
    for _ in 0..30 {
        sim.tick();
    }
    let earned = sim
        .world()
        .get::<ReadingJourney>(person)
        .unwrap()
        .earned_satisfaction;
    assert!(earned > 0.0, "the reading has earned something");
    let before = sim.world().get::<Satisfaction>(person).unwrap().value();
    crate::reading::floor::put_down_and_end(sim.world_mut(), person);
    let after = sim.world().get::<Satisfaction>(person).unwrap().value();
    assert!(
        after > before,
        "the earned satisfaction was paid: {before} to {after}"
    );
    assert!(on_the_floor(&copy(&sim)));
    assert!(sim.world().get::<ReadingJourney>(person).is_none());
}
