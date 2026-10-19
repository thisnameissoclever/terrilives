//! Write controlled current worlds for checking the real browser/WASM build.
#[path = "support/mod.rs"]
mod support;
use terri_core::layout::{EdgeAxis, SavedLayout, WallEdge};
use terri_core::*;
use terri_sim::{Content, Sim};

fn start_reading(sim: &mut Sim, targets: &[(Entity, Entity)]) {
    assert_eq!(targets.len(), 2);
    let ((standing, shelf), (seated, chair)) = (targets[0], targets[1]);
    let pack = sim.world().resource::<Content>().0;
    let shelf_model = pack.object(sim.world().get::<SmartObject>(shelf).unwrap().0);
    let chair_model = pack.object(sim.world().get::<SmartObject>(chair).unwrap().0);
    let shelf_at = *sim.world().get::<Position>(shelf).unwrap();
    let chair_at = *sim.world().get::<Position>(chair).unwrap();
    let pickups: Vec<_> = shelf_model
        .shelf_approaches_at(shelf_model.base_facing)
        .into_iter()
        .map(|(x, y)| (shelf_at.x.round() as i32 + x, shelf_at.y.round() as i32 + y))
        .collect();
    let approaches: Vec<_> = chair_model
        .seat_approaches_at(0, chair_model.base_facing)
        .unwrap()
        .into_iter()
        .map(|(x, y)| (chair_at.x.round() as i32 + x, chair_at.y.round() as i32 + y))
        .collect();
    assert_eq!(pickups, vec![(3, 2)], "authored shelf front");
    assert!(approaches.contains(&(5, 2)), "authored chair approach");
    let grid = sim.world().resource::<TileGrid>();
    assert!(grid.is_walkable(3, 2) && grid.is_walkable(5, 2));
    for (person, _) in targets {
        let position = sim.world().get::<Position>(*person).unwrap();
        assert!(grid
            .find_path(
                (position.x.round() as i32, position.y.round() as i32),
                (3, 2)
            )
            .is_some());
    }
    assert!(grid.find_path((3, 2), (5, 2)).is_some());
    let _ = support::capture(sim);
    let title = pack.books[0].id.clone();
    let budget = i64::from(pack.books[0].price) * targets.len() as i64;
    sim.world_mut().insert_resource(Funds::from_dollars(budget));
    let copies = sim.book_copies().len();
    for _ in targets {
        sim.world_mut()
            .resource_mut::<CommandQueue>()
            .push(SimCommand::Book(command::BookCommand::Purchase {
                title: title.clone(),
                shelf: Some(shelf.index_u32()),
            }));
    }
    sim.flush_commands();
    assert_eq!(sim.take_build_error(), None);
    assert_eq!(sim.book_copies().len(), copies + targets.len());
    let issue = |sim: &mut Sim, person: Entity, target: Entity| {
        let model = sim.world().get::<SmartObject>(target).unwrap().0;
        let action = pack
            .object(model)
            .interactions
            .iter()
            .find(|action| action.book_reading)
            .unwrap()
            .id
            .clone();
        let before = sim.save_snapshot_v18();
        let before_hash = sim.world_hash();
        let available =
            sim.reading_available_titles(person.index_u32(), target.index_u32(), &action);
        assert_eq!(
            sim.save_snapshot_v18(),
            before,
            "availability observation must preserve complete state"
        );
        assert_eq!(
            sim.world_hash(),
            before_hash,
            "availability observation must preserve hash and randomness"
        );
        let six = &before
            .legacy
            .legacy
            .legacy
            .legacy
            .legacy
            .legacy
            .legacy
            .legacy
            .legacy;
        eprintln!("reading availability: person={} target={} tick={} carrying={:?} target_state={:?} available={available:?}; journeys={:?}; copies={:?}; queue={:?}; claims={:?}",
            person.index_u32(), target.index_u32(), sim.world().resource::<SimClock>().tick,
            sim.world().get::<Carrying>(person), sim.world().get::<Target>(person), six.reading, six.books.copies,
            six.queues.iter().find(|queue| queue.owner == person.index_u32()), six.seats);
        assert!(
            available.contains(&title),
            "requested title needs an admitted route"
        );
        sim.world_mut()
            .resource_mut::<CommandQueue>()
            .push(SimCommand::Book(command::BookCommand::Read {
                agent: person.index_u32(),
                object: target.index_u32(),
                action,
                title: title.clone(),
                front: true,
            }));
    };
    let reading = |sim: &Sim, person: Entity, origin: Entity| {
        sim.reading_journeys().iter().any(|journey| {
            journey.owner == person.index_u32()
                && journey.origin == origin.index_u32()
                && journey.stage == save_v6::ReadingStage::Read
        })
    };
    let mut elapsed = 0;
    issue(sim, seated, chair);
    while elapsed < 500 && !reading(sim, seated, chair) {
        sim.tick();
        elapsed += 1;
    }
    assert!(
        reading(sim, seated, chair),
        "pinned chair reader must arrive within the shared bound"
    );
    let seated_tick = elapsed;
    let seated_state = support::capture(sim);
    let six = &seated_state
        .legacy
        .legacy
        .legacy
        .legacy
        .legacy
        .legacy
        .legacy
        .legacy
        .legacy;
    assert!(six.seats.iter().any(|claim| claim.person == seated.index_u32() && claim.furniture == chair.index_u32()), "B must own the actual chair before A chooses a destination");
    if let Some(admitted) = sim
        .reading_journeys()
        .into_iter()
        .find(|journey| journey.owner == standing.index_u32())
    {
        let action = shelf_model
            .interactions
            .iter()
            .find(|action| action.book_reading)
            .unwrap();
        assert_eq!(
            admitted.origin,
            shelf.index_u32(),
            "an existing journey must have the intended origin"
        );
        assert_eq!(admitted.action, action.id);
        assert!(
            admitted.seat.is_none(),
            "the existing A journey must be standing"
        );
        assert_eq!(admitted.destination, (3, 3));
        assert!(matches!(
            admitted.stage,
            save_v6::ReadingStage::Fetch
                | save_v6::ReadingStage::Pickup
                | save_v6::ReadingStage::Travel
                | save_v6::ReadingStage::Read
        ));
        let copy = sim
            .book_copies()
            .iter()
            .find(|copy| copy.id == admitted.copy)
            .cloned()
            .expect("the admitted journey owns a real copy");
        assert_eq!(copy.title_id, title);
        assert_eq!(copy.borrower, sim.world().get::<SimId>(standing).copied());
        println!(
            "reading A already admitted at {elapsed}: {:?}, copy {:?}, native order {:?}",
            admitted.stage, admitted.copy, admitted.order
        );
    } else {
        issue(sim, standing, shelf);
    }
    while elapsed < 500 && !(reading(sim, standing, shelf) && reading(sim, seated, chair)) {
        sim.tick();
        elapsed += 1;
    }
    assert!(
        reading(sim, standing, shelf) && reading(sim, seated, chair),
        "both readers must overlap within 500 total admission ticks"
    );
    let journeys = sim.reading_journeys();
    let a = journeys
        .iter()
        .find(|j| j.owner == standing.index_u32())
        .unwrap();
    let b = journeys
        .iter()
        .find(|j| j.owner == seated.index_u32())
        .unwrap();
    assert!(a.seat.is_none());
    assert!(b
        .seat
        .as_ref()
        .is_some_and(|(object, _)| *object == chair.index_u32()));
    assert_ne!(a.copy, b.copy);
    let pa = *sim.world().get::<Position>(standing).unwrap();
    let pb = *sim.world().get::<Position>(seated).unwrap();
    let rooms = sim.world().resource::<terri_sim::rooms::RoomMap>();
    let room = rooms.selection_at((pa.x.round() as u32, pa.y.round() as u32));
    assert!(matches!(
        room,
        Some(terri_core::rooms::RoomSelection::Room(_))
    ));
    assert_eq!(
        room,
        rooms.selection_at((pb.x.round() as u32, pb.y.round() as u32))
    );
    assert!((pa.x - pb.x).hypot(pa.y - pb.y) <= pack.tuning.relationships.contact_radius);
    let scene = support::capture(sim);
    let mut restored = Sim::new_with_lot(6, 4);
    restored.load_snapshot_v18(scene.clone()).unwrap();
    let mut overlap = 1;
    for tick in 0..120 {
        sim.tick();
        restored.tick();
        assert_eq!(
            sim.save_snapshot_v18(),
            restored.save_snapshot_v18(),
            "reading replay tick {tick}"
        );
        assert_eq!(sim.world_hash(), restored.world_hash());
        overlap += usize::from(reading(sim, standing, shelf) && reading(sim, seated, chair));
    }
    sim.load_snapshot_v18(scene).unwrap();
    println!("reading admitted B at {seated_tick}, A at {elapsed}; observed overlap {overlap} ticks including 120 replay updates");
}

fn main() {
    let output = std::env::args().nth(1).expect("output directory");
    std::fs::create_dir_all(&output).unwrap();
    for scenario in ["wait", "ordered", "proximity", "reading", "friction"] {
        let mut sim = Sim::new_with_lot(6, 4);
        let pack = sim.world().resource::<Content>().0;
        if scenario == "wait" {
            for y in [0, 2, 3] {
                sim.world_mut()
                    .resource_mut::<TileGrid>()
                    .set_edge_blocked((1, y), (2, y), true);
            }
            sim.world_mut().insert_resource(SavedLayout::EdgeWallsV1 {
                edges: (0..4)
                    .map(|y| WallEdge {
                        axis: EdgeAxis::Vertical,
                        x: 2,
                        y,
                        doorway: y == 1,
                    })
                    .collect(),
            });
        } else {
            let mut edges = Vec::new();
            if scenario == "reading" {
                for x in 0..6 {
                    for y in [0, 4] {
                        edges.push(WallEdge {
                            axis: EdgeAxis::Horizontal,
                            x,
                            y,
                            doorway: false,
                        });
                    }
                }
                for y in 0..4 {
                    for x in [0, 6] {
                        edges.push(WallEdge {
                            axis: EdgeAxis::Vertical,
                            x,
                            y,
                            doorway: false,
                        });
                    }
                }
                edges.sort_by_key(|edge| (edge.axis as u8, edge.y, edge.x));
            }
            sim.world_mut()
                .insert_resource(SavedLayout::EdgeWallsV1 { edges });
        }
        terri_sim::rooms::initialize(sim.world_mut())
            .expect("authored initial geometry has valid rooms");
        let mut people = Vec::new();
        for (name, x) in [
            ("A", if scenario == "wait" { 1.25 } else { 2.0 }),
            ("B", 3.0),
        ] {
            let id = sim.world_mut().resource_mut::<SimIdAllocator>().issue();
            people.push(
                sim.world_mut()
                    .spawn((
                        Agent,
                        id,
                        SimName(name.into()),
                        Shyness::new(50).unwrap(),
                        SelfPreservation(50),
                        Position { x, y: 1.0 },
                        Needs::all_at(100.0),
                        Satisfaction::default(),
                    ))
                    .id(),
            );
        }
        let a = people[0];
        let b = people[1];
        let mut reading_targets = Vec::new();
        if scenario == "wait" || scenario == "ordered" {
            let def = pack.find("toilet").unwrap();
            let toilet = sim.spawn_object(Position { x: 3.0, y: 2.0 }, def);
            sim.world_mut().entity_mut(toilet).insert(Reserved);
            sim.world_mut().entity_mut(b).insert(Target {
                object: toilet,
                interaction: 0,
            });
            if scenario == "wait" {
                sim.world_mut().entity_mut(b).insert(Eating {
                    object: def,
                    interaction: 0,
                    remaining_ticks: 50,
                });
                sim.world_mut().entity_mut(a).insert(Path {
                    steps: vec![(2, 1)],
                    cursor: 0,
                });
            } else {
                sim.world_mut().entity_mut(b).insert((
                    Path {
                        steps: vec![],
                        cursor: 0,
                    },
                    IntentQueue::from_intents(vec![Intent {
                        cleanup: None,
                        chore: None,
                        object: toilet,
                        interaction: 0,
                    }]),
                ));
            }
        } else {
            for (i, &e) in people.iter().enumerate() {
                if scenario == "reading" {
                    let def = pack
                        .find(if i == 0 { "bookshelf" } else { "reading_chair" })
                        .unwrap();
                    let object = sim.spawn_object(
                        Position {
                            x: if i == 0 { 2.0 } else { 4.0 },
                            y: 2.0,
                        },
                        def,
                    );
                    reading_targets.push((e, object));
                } else {
                    sim.world_mut().entity_mut(e).insert(Path {
                        steps: vec![(2 + i as i32, 1), (2 + i as i32, 0)],
                        cursor: 0,
                    });
                }
                if scenario == "friction" {
                    sim.world_mut()
                        .entity_mut(e)
                        .insert(Personality::with_dispositions(
                            [1.0; 7],
                            [1.0; 7],
                            vec![
                                (
                                    pack.find("bookshelf").unwrap(),
                                    0,
                                    if i == 0 { 2.0 } else { 0.0 },
                                ),
                                (
                                    pack.find("moving_box").unwrap(),
                                    0,
                                    if i == 0 { 0.0 } else { 2.0 },
                                ),
                            ],
                        ));
                }
            }
        }
        // Spawn helpers do not alter walkability. Give the saved lot the same
        // footprint occupancy that placement establishes in ordinary play.
        let furniture: Vec<_> = sim
            .world_mut()
            .query::<(&Position, &SmartObject)>()
            .iter(sim.world())
            .map(|(p, o)| (*p, pack.object(o.0).footprint))
            .collect();
        for (position, footprint) in furniture {
            for y in 0..footprint.depth {
                for x in 0..footprint.width {
                    sim.world_mut().resource_mut::<TileGrid>().set_blocked(
                        position.x as usize + x as usize,
                        position.y as usize + y as usize,
                        true,
                    );
                }
            }
        }
        if !reading_targets.is_empty() {
            start_reading(&mut sim, &reading_targets);
        }
        for &person in &people {
            if sim.world().get::<Eating>(person).is_some() {
                let pos = sim.world().get::<Position>(person).unwrap();
                let target = sim.world().get::<Target>(person).unwrap();
                let object_pos = sim.world().get::<Position>(target.object).unwrap();
                let definition = sim.world().get::<SmartObject>(target.object).unwrap();
                assert!(
                    sim.world().resource::<TileGrid>().can_interact_with_rect(
                        (pos.x.round() as i32, pos.y.round() as i32),
                        (object_pos.x.round() as i32, object_pos.y.round() as i32),
                        pack.object(definition.0).footprint
                    ),
                    "{scenario}: actor must touch their active furniture"
                );
            }
        }
        sim.world_mut()
            .resource_mut::<CommandQueue>()
            .push(SimCommand::SetSpeed(0));
        sim.flush_commands();
        let mut snapshot = sim.save_snapshot_v18();
        if scenario == "wait" {
            support::v5_mut(&mut snapshot)
                .boundaries
                .push(save::SavedBoundaryDecision {
                    actor: 0,
                    expires: 30,
                    lapse: false,
                    waiting_since: None,
                    goal: None,
                    directed_chain: None,
                });
        }
        // Validate the fixture through the production loader before publishing it.
        let mut restored = Sim::new();
        restored.load_snapshot_v18(snapshot.clone()).unwrap();
        let bytes = support::encode(&restored);
        std::fs::write(
            std::path::Path::new(&output).join(format!("{scenario}.save")),
            bytes,
        )
        .unwrap();
        println!("{scenario}: A={} B={}", a.index_u32(), b.index_u32());
    }
}
