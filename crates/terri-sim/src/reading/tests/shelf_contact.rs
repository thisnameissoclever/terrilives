//! A shelf transfer contact is exclusive only while someone stands at it to
//! take or shelve a copy. A walk toward it plans the contact without holding
//! it, so a reader who must put a book back is never locked out for the length
//! of another reader's walk (issue 339).
use super::*;

/// A second reader spawned at `at`, with the components the fixture's reader has.
fn second_reader(sim: &mut Sim, at: (f32, f32)) -> Entity {
    let id = sim.world_mut().resource_mut::<SimIdAllocator>().issue();
    sim.world_mut()
        .spawn((
            Agent,
            id,
            Position { x: at.0, y: at.1 },
            Needs::all_at(80.0),
            IntentQueue::default(),
            Personality::default(),
            Relationships::default(),
            Satisfaction::from_value(0.0),
        ))
        .id()
}

fn cancel(sim: &mut Sim, person: Entity) {
    issue(
        sim,
        SimCommand::CancelIntents {
            agent: person.index_u32(),
        },
    );
    sim.flush_commands();
}

fn at_contact(stage: Option<ReadingStage>) -> bool {
    matches!(stage, Some(ReadingStage::Pickup | ReadingStage::Shelve))
}

fn carried(sim: &Sim, person: Entity) -> bool {
    let copy = sim.world().get::<ReadingJourney>(person).map(|j| j.copy);
    sim.book_copies()
        .iter()
        .any(|c| Some(c.id) == copy && matches!(c.location, BookLocation::Carried(_)))
}

/// Shelf uses of one tile: two transfers exclude each other, a walk shares
/// the tile with another walk or a transfer, and every longer use keeps
/// both kinds of shelf use off the tile, in either order and on current
/// content only.
#[test]
fn shelf_approach_shares_only_with_shelf_uses_and_transfer_is_exclusive() {
    use crate::seating::{endpoints_conflict, EndpointUse, UseKind};
    let mut world = World::new();
    let (a, b) = (world.spawn_empty().id(), world.spawn_empty().id());
    let at = |owner, kind| EndpointUse {
        owner,
        endpoint: (4, 3),
        kind,
    };
    let conflicts = |x: UseKind, y: UseKind| {
        let forward = endpoints_conflict(at(a, x), at(b, y), false);
        assert_eq!(
            forward,
            endpoints_conflict(at(b, y), at(a, x), false),
            "{x:?} against {y:?} must be symmetric"
        );
        forward
    };
    assert!(conflicts(UseKind::ShelfTransfer, UseKind::ShelfTransfer));
    assert!(!conflicts(UseKind::ShelfApproach, UseKind::ShelfApproach));
    assert!(!conflicts(UseKind::ShelfApproach, UseKind::ShelfTransfer));
    for other in [
        UseKind::Meal,
        UseKind::TableSeat,
        UseKind::Media,
        UseKind::MediaEndpoint,
        UseKind::Standing,
    ] {
        assert!(conflicts(UseKind::ShelfApproach, other), "{other:?}");
        assert!(conflicts(UseKind::ShelfTransfer, other), "{other:?}");
    }
    assert!(
        !endpoints_conflict(
            at(a, UseKind::ShelfTransfer),
            at(a, UseKind::ShelfTransfer),
            false
        ),
        "one person's own uses never conflict"
    );
    assert!(
        endpoints_conflict(
            at(a, UseKind::ShelfApproach),
            at(b, UseKind::ShelfApproach),
            true
        ),
        "packs from before books keep every shared endpoint exclusive"
    );
}

/// The Monday case in miniature: one reader sits reading near the bookcase,
/// another sets out across the lot to fetch a book from the same one-contact
/// bookcase, and at that moment the first reader is told to put the book back.
#[test]
fn a_returning_reader_is_not_locked_out_by_another_readers_walk_to_the_only_contact() {
    let (mut sim, reader, shelf, seat, title) = fixture("armchair");
    purchase(&mut sim, Some(shelf), &title);
    purchase(&mut sim, Some(shelf), &title);
    read(&mut sim, reader, seat, &title, false);
    until(&mut sim, reader, ReadingStage::Read);
    let contact = sim
        .world()
        .get::<ReadingJourney>(reader)
        .map(|j| j.transfer_contact)
        .unwrap();
    assert_eq!(contact, None, "a seated reader holds no shelf contact");

    let fetcher = second_reader(&mut sim, (19.0, 19.0));
    read(&mut sim, fetcher, shelf, &title, false);
    until(&mut sim, fetcher, ReadingStage::Fetch);
    let walk = sim
        .world()
        .get::<Path>(fetcher)
        .map_or(0, |p| p.steps.len());
    assert!(
        walk >= 20,
        "the fetcher's walk must be long enough to matter: {walk} steps"
    );
    let shelf_contact = sim
        .world()
        .get::<ReadingJourney>(fetcher)
        .unwrap()
        .transfer_contact
        .unwrap();

    cancel(&mut sim, reader);
    assert_eq!(
        stage(&sim, reader),
        Some(ReadingStage::Return),
        "the return must route to the contact the fetcher is only walking toward"
    );
    assert_eq!(
        sim.world()
            .get::<ReadingJourney>(reader)
            .unwrap()
            .transfer_contact,
        Some(shelf_contact)
    );
    assert!(sim.world().get::<Blocked>(reader).is_none());

    // Two walks planning the same contact are a valid current save.
    let saved = sim.current_v19_view();
    sim.load_current_v19_view(saved.clone()).unwrap();
    assert_eq!(sim.current_v19_view(), saved);

    let mut shelved_at = None;
    let mut fetcher_arrived_at = None;
    for tick in 0..600 {
        let (r, f) = (stage(&sim, reader), stage(&sim, fetcher));
        assert_ne!(
            r,
            Some(ReadingStage::WaitingReturn),
            "tick {tick}: the returning reader waited on the fetcher's walk"
        );
        assert!(
            !(at_contact(r) && at_contact(f)),
            "tick {tick}: two people used the one contact at once"
        );
        if fetcher_arrived_at.is_none() && f == Some(ReadingStage::Pickup) {
            fetcher_arrived_at = Some(tick);
        }
        if shelved_at.is_none() && r.is_none() {
            shelved_at = Some(tick);
        }
        if shelved_at.is_some() && fetcher_arrived_at.is_some() {
            break;
        }
        sim.tick();
    }
    let shelved_at = shelved_at.expect("the reader shelved the book");
    let fetcher_arrived_at = fetcher_arrived_at.expect("the fetcher reached the shelf");
    assert!(
        shelved_at < fetcher_arrived_at,
        "the nearby reader shelved at tick {shelved_at}, after the fetcher arrived at tick \
         {fetcher_arrived_at}"
    );
    assert!(
        sim.book_copies()
            .iter()
            .all(|c| matches!(c.location, BookLocation::Shelf(_))),
        "the returned copy is home and the fetcher has not taken the other yet"
    );
}

/// Issue 339 in the shipped household: Tim is carrying a book when his shift
/// at 06:00 on Monday sends him back to the bookcase's only contact, and
/// another housemate is walking to the same contact. On the shipped seed,
/// before the fix, Tim took a book at 05:47, Bill set out at the same tick to
/// fetch one, and Tim stood waiting until about 07:10 and left at about
/// 07:25. Issue 338 changed Tim's first choice at 05:16 on Monday, so the
/// shipped seed no longer reaches that state. World seed 182 is the only one
/// of seeds 0 to 299 in which Tim, returning a book at his shift start, waits
/// to return it when a walk holds the contact again (the defect restored in
/// `endpoints_conflict`): there another housemate is walking back to the same
/// bookcase with a book of their own, and with the defect restored Tim waits
/// 40 ticks. With the fix he does not wait and leaves 25 minutes after his
/// shift starts.
#[test]
fn the_shipped_household_returns_tims_book_and_sends_him_to_his_first_shift() {
    let mut sim = Sim::new_from_shipped_lot_with_seed(182);
    let tim = sim
        .world_mut()
        .query::<(Entity, &SimName)>()
        .iter(sim.world())
        .find(|(_, name)| name.0 == "Tim")
        .map(|(entity, _)| entity)
        .expect("the shipped household has Tim");
    let pack = sim.world().resource::<Content>().0;
    let start = u64::from(
        crate::shifts::shift_of(sim.world(), pack, tim)
            .expect("Tim holds the office shift")
            .shift_start,
    );
    let mut returning_at_start = false;
    let mut contended_at_start = false;
    let mut waited = 0;
    let mut left = None;
    while sim.world().resource::<SimClock>().tick < start + 120 {
        sim.tick();
        let now = sim.world().resource::<SimClock>().tick;
        let journey = sim.world().get::<ReadingJourney>(tim).map(|j| j.stage);
        if now == start + 1 {
            returning_at_start = matches!(
                journey,
                Some(ReadingStage::Return | ReadingStage::WaitingReturn)
            );
            let shelf = sim.world().get::<ReadingJourney>(tim).map(|j| j.shelf);
            contended_at_start = sim
                .world_mut()
                .query::<(Entity, &ReadingJourney)>()
                .iter(sim.world())
                .any(|(other, j)| {
                    other != tim
                        && Some(j.shelf) == shelf
                        && matches!(j.stage, ReadingStage::Fetch | ReadingStage::Return)
                });
        }
        if journey == Some(ReadingStage::WaitingReturn) {
            waited += 1;
        }
        let away = sim.world().get::<AtWork>(tim).is_some()
            || sim.world().get::<Commuting>(tim) == Some(&Commuting::Outbound);
        if away {
            left = Some(now);
            break;
        }
    }
    assert!(
        returning_at_start,
        "the case under test: Tim is putting a book back when his shift starts"
    );
    assert!(
        contended_at_start,
        "the case under test: another reader is walking to the same bookcase"
    );
    assert_eq!(waited, 0, "Tim waited {waited} ticks to return his book");
    let left = left.expect("Tim left for work within two hours of his shift start");
    eprintln!(
        "Tim left at tick {left}, {} minutes after his shift start",
        left - start
    );
    assert!(
        left <= start + 30,
        "Tim left at tick {left}, {} minutes after his shift started",
        left - start
    );
}

/// When the contact is in use, an arriving reader waits there for the short
/// transfer to finish instead of giving up its place in the queue.
#[test]
fn an_arriving_reader_waits_at_the_contact_only_while_another_transfer_finishes() {
    // Long enough that the reader, about 30 ticks away, arrives mid-pickup,
    // and within the content check's limit of one reference hour.
    let pickup = 50;
    let (mut sim, reader, shelf, _seat, title) = fixture_with("armchair", |pack| {
        pack.reading.as_mut().unwrap().pickup_ticks = pickup;
    });
    purchase(&mut sim, Some(shelf), &title);
    purchase(&mut sim, Some(shelf), &title);
    read(&mut sim, reader, shelf, &title, false);
    until(&mut sim, reader, ReadingStage::Read);
    let destination = sim
        .world()
        .get::<ReadingJourney>(reader)
        .unwrap()
        .destination;

    let fetcher = second_reader(&mut sim, (destination.0 as f32, destination.1 as f32));
    read(&mut sim, fetcher, shelf, &title, false);
    until(&mut sim, fetcher, ReadingStage::Pickup);
    let contact = sim
        .world()
        .get::<ReadingJourney>(fetcher)
        .unwrap()
        .transfer_contact
        .unwrap();
    cancel(&mut sim, reader);
    assert_eq!(stage(&sim, reader), Some(ReadingStage::Return));
    assert!(carried(&sim, reader));

    let mut waited = 0;
    let mut lag = 0;
    let mut left_on_arrival = None;
    let mut checked_save = false;
    for tick in 0..400 {
        let (r, f) = (stage(&sim, reader), stage(&sim, fetcher));
        if r.is_none() {
            break;
        }
        assert_ne!(r, Some(ReadingStage::WaitingReturn), "tick {tick}");
        assert!(
            !(at_contact(r) && at_contact(f)),
            "tick {tick}: two people used the one contact at once"
        );
        let here = sim.world().get::<Position>(reader).unwrap();
        let arrived = sim.world().get::<Path>(reader).is_none()
            && (here.x.round() as i32, here.y.round() as i32) == contact;
        if r == Some(ReadingStage::Return) && arrived && f != Some(ReadingStage::Pickup) {
            // The reader came earlier in this tick's pass than the fetcher's
            // last pickup tick, so it starts shelving on the next tick.
            lag += 1;
            assert!(lag <= 1, "tick {tick}: the reader idled at a free contact");
        } else if r == Some(ReadingStage::Return) && arrived {
            waited += 1;
            left_on_arrival.get_or_insert(
                sim.world()
                    .get::<ReadingJourney>(fetcher)
                    .unwrap()
                    .reach_remaining,
            );
            if !checked_save {
                // Waiting at an occupied contact is a valid current save.
                let saved = sim.current_v19_view();
                sim.load_current_v19_view(saved.clone()).unwrap();
                assert_eq!(sim.current_v19_view(), saved);
                checked_save = true;
            }
        }
        sim.tick();
    }
    assert!(stage(&sim, reader).is_none(), "the reader shelved the book");
    assert!(
        waited > 0,
        "the reader must reach the contact while the fetcher is still taking a copy"
    );
    let left = left_on_arrival.unwrap();
    assert!(
        waited <= left,
        "the wait of {waited} ticks outlasted the {left} ticks left of the other transfer"
    );
}
