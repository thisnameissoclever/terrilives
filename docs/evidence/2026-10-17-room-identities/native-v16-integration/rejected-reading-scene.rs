//! Write controlled current worlds for checking the real browser/WASM build.
#[path = "support/mod.rs"]
mod support;
use terri_core::layout::{EdgeAxis, SavedLayout, WallEdge};
use terri_core::*;
use terri_sim::{Content, Sim};

fn start_reading(sim: &mut Sim, targets: &[(Entity, Entity)]) {
    let _ = support::capture(sim);
    let pack = sim.world().resource::<Content>().0;
    let title = pack.books[0].id.clone();
    let shelf = targets[0].1;
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
    for &(person, target) in targets {
        let model = sim.world().get::<SmartObject>(target).unwrap().0;
        let action = pack
            .object(model)
            .interactions
            .iter()
            .find(|action| action.book_reading)
            .expect("review target offers reading")
            .id
            .clone();
        sim.world_mut()
            .resource_mut::<CommandQueue>()
            .push(SimCommand::Book(command::BookCommand::Read {
                agent: person.index_u32(),
                object: target.index_u32(),
                action,
                title: title.clone(),
                front: true,
            }));
    }
    let ready = |sim: &Sim| {
        targets.iter().all(|(person, target)| {
            sim.reading_journeys().iter().any(|journey| {
                journey.owner == person.index_u32()
                    && journey.origin == target.index_u32()
                    && journey.stage == save_v6::ReadingStage::Read
            })
        })
    };
    let mut observed = Vec::new();
    let mut last = Vec::new();
    for tick in 0..500 {
        sim.tick();
        let phases: Vec<_> = sim
            .reading_journeys()
            .iter()
            .map(|journey| (journey.owner, journey.stage))
            .collect();
        if phases != last {
            observed.push((tick, phases.clone()));
            last = phases;
        }
        if ready(sim) {
            break;
        }
    }
    if !ready(sim) {
        eprintln!("reading admission results: {:?}", sim.take_book_results());
        eprintln!("reading copies: {:?}", sim.book_copies());
        eprintln!("reading journeys: {:?}", sim.reading_journeys());
    }
    assert!(
        ready(sim),
        "both real readers must arrive at their own targets: {observed:?}"
    );
    let _ = support::capture(sim);
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
            sim.world_mut()
                .insert_resource(SavedLayout::EdgeWallsV1 { edges: vec![] });
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
                            x: 2.0 + i as f32,
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
        let mut snapshot = sim.save_snapshot_v16();
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
        restored.load_snapshot_v16(snapshot.clone()).unwrap();
        let bytes = support::encode(&restored);
        std::fs::write(
            std::path::Path::new(&output).join(format!("{scenario}.save")),
            bytes,
        )
        .unwrap();
        println!("{scenario}: A={} B={}", a.index_u32(), b.index_u32());
    }
}
