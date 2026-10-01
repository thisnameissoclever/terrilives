//! Write controlled V5 worlds for checking the real browser/WASM build.
use terri_core::layout::{EdgeAxis, SavedLayout, WallEdge};
use terri_core::*;
use terri_sim::{Content, Sim};

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
                    sim.world_mut().entity_mut(object).insert(Reserved);
                    sim.world_mut().entity_mut(e).insert((
                        Target {
                            object,
                            interaction: 0,
                        },
                        Eating {
                            object: def,
                            interaction: 0,
                            remaining_ticks: 100,
                        },
                    ));
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
        let mut snapshot = sim.save_snapshot_v5();
        if scenario == "wait" {
            snapshot.boundaries.push(save::SavedBoundaryDecision {
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
        restored.load_snapshot_v5(snapshot.clone()).unwrap();
        let mut bytes = SAVE_MAGIC.to_vec();
        bytes.extend_from_slice(&SAVE_SCHEMA_VERSION.to_le_bytes());
        bytes.extend(postcard::to_allocvec(&snapshot).unwrap());
        std::fs::write(
            std::path::Path::new(&output).join(format!("{scenario}.save")),
            bytes,
        )
        .unwrap();
        println!("{scenario}: A={} B={}", a.index_u32(), b.index_u32());
    }
}
