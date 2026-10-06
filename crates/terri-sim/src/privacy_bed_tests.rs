use super::*;
use crate::{test_content, Content, Sim};
use terri_core::{
    Agent, Eating, Facing, NeedId, Needs, ObjectDefId, ObjectFacing, Path, Personality, Position,
    Reserved, SimIdAllocator, SimName, SleepPlace, SmartObject, Target, TileGrid,
};

fn fixture() -> (Sim, Entity, Entity, [Entity; 3]) {
    let mut sleep = test_content::interaction("sleep", &[(NeedId::Energy, 80.0)], 100);
    sleep.tags = vec![terri_data::pack().sleep_tag.clone()];
    sleep.slots = 2;
    let mut bed = test_content::object_offering("bed", vec![sleep]);
    bed.facing_sprites = terri_data::FacingSprites([Some(bed.sprite); 4]);
    bed.sleep_places = vec![
        terri_data::SleepPlaceAccess {
            id: "first".into(),
            approaches: vec![(0, -1)],
        },
        terri_data::SleepPlaceAccess {
            id: "second".into(),
            approaches: vec![(0, 1)],
        },
    ];
    let food = test_content::object("food", &[(NeedId::Hunger, 60.0)], 20);
    let mut pack = test_content::pack(vec![bed, food]).clone();
    pack.tuning.relationships.privacy_respect_chance = 1.0;
    pack.tuning.relationships.shyness_respect_strength = 0.0;
    let mut sim = test_content::sim_with(12, 12, Box::leak(Box::new(pack)));
    let objects = [(0, 7.0, 7.0), (1, 3.0, 3.0)].map(|(id, x, y)| {
        let entity = sim
            .world_mut()
            .spawn((SmartObject(ObjectDefId(id)), Position { x, y }))
            .id();
        sim.world_mut()
            .resource_mut::<TileGrid>()
            .set_blocked(x as usize, y as usize, true);
        entity
    });
    sim.world_mut().insert_resource(SimIdAllocator::resumed(3));
    let people = std::array::from_fn(|id| {
        sim.world_mut()
            .spawn((
                Agent,
                SimId(id as u32),
                SimName(format!("Person {id}")),
                terri_core::SelfPreservation(50),
                Personality::default(),
                Needs::all_at(70.0),
                Position {
                    x: 2.25,
                    y: id as f32 + 2.0,
                },
            ))
            .id()
    });
    crate::systems::interpersonal::prepare(sim.world_mut());
    (sim, objects[0], objects[1], people)
}

fn substitute_need(sim: &mut Sim, actor: Entity, need: NeedId) -> bool {
    let grid = sim.world().resource::<TileGrid>().clone();
    substitute(sim.world_mut(), actor, need.index() as u8, &grid, false)
}

#[test]
fn privacy_substitutes_claim_distinct_places_and_preserve_fractional_approaches() {
    let endpoints = [
        ((7, 6), (7, 8)),
        ((8, 7), (6, 7)),
        ((7, 8), (7, 6)),
        ((6, 7), (8, 7)),
    ];
    for (facing, ends) in Facing::ALL.into_iter().zip(endpoints) {
        let (mut sim, bed, _, [first, second, third]) = fixture();
        sim.world_mut().entity_mut(bed).insert(ObjectFacing(facing));
        sim.world_mut()
            .resource_mut::<TileGrid>()
            .set_edge_blocked((10, 10), (11, 10), true);
        sim.world_mut()
            .insert_resource(terri_core::layout::SavedLayout::EdgeWallsV1 {
                edges: vec![terri_core::layout::WallEdge {
                    axis: terri_core::layout::EdgeAxis::Vertical,
                    x: 11,
                    y: 10,
                    doorway: false,
                }],
            });
        sim.world_mut()
            .resource_mut::<crate::beds::BedAssignments>()
            .set(SimId(0), Some(crate::beds::BedPlace { bed, ordinal: 0 }));
        for (actor, ordinal, end) in [(first, 0, ends.0), (second, 1, ends.1)] {
            assert!(substitute_need(&mut sim, actor, NeedId::Energy));
            assert_eq!(
                sim.world().get::<SleepPlace>(actor),
                Some(&SleepPlace(ordinal))
            );
            let path = sim.world().get::<Path>(actor).unwrap();
            assert_eq!(path.steps.last(), Some(&end), "{facing:?}");
            assert_eq!(
                path.steps.first(),
                Some(&(2, sim.world().get::<Position>(actor).unwrap().y as i32)),
                "edge-wall routes anchor the fractional start"
            );
            assert_eq!(sim.world().get::<Target>(actor).unwrap().object, bed);
        }
        assert!(!substitute_need(&mut sim, third, NeedId::Energy));
        assert!(sim.world().get::<Target>(third).is_none());
        let saved = sim.save_snapshot_v5();
        let pack = sim.world().resource::<Content>().0;
        let mut resumed = test_content::sim_with(12, 12, pack);
        resumed.load_snapshot_v5(saved).unwrap();
        assert_eq!(resumed.world_hash(), sim.world_hash());
        for _ in 0..25 {
            sim.tick();
            resumed.tick();
            assert_eq!(resumed.world_hash(), sim.world_hash());
        }
    }
}

#[test]
fn changing_a_bed_errand_preserves_the_other_sleeper_and_assignment() {
    let (mut sim, bed, food, [first, second, third]) = fixture();
    assert!(substitute_need(&mut sim, first, NeedId::Energy));
    assert!(substitute_need(&mut sim, second, NeedId::Energy));
    let endpoint = *sim
        .world()
        .get::<Path>(second)
        .unwrap()
        .steps
        .last()
        .unwrap();
    sim.world_mut().entity_mut(second).insert((
        Position {
            x: endpoint.0 as f32,
            y: endpoint.1 as f32,
        },
        Path {
            steps: Vec::new(),
            cursor: 0,
        },
    ));
    crate::systems::interpersonal::prepare(sim.world_mut());
    use bevy_ecs::system::RunSystemOnce;
    sim.world_mut()
        .run_system_once(crate::systems::movement::follow_path)
        .unwrap();
    sim.world_mut()
        .get_mut::<Eating>(second)
        .unwrap()
        .remaining_ticks = 37;
    let action = *sim.world().get::<Eating>(second).unwrap();
    let assignment = crate::beds::BedPlace { bed, ordinal: 1 };
    sim.world_mut()
        .resource_mut::<crate::beds::BedAssignments>()
        .set(SimId(1), Some(assignment));
    assert!(substitute_need(&mut sim, first, NeedId::Hunger));
    assert_eq!(sim.world().get::<Target>(first).unwrap().object, food);
    assert!(sim.world().get::<SleepPlace>(first).is_none());
    assert!(sim.world().get::<Reserved>(bed).is_some());
    assert_eq!(
        sim.world().get::<Target>(second),
        Some(&Target {
            object: bed,
            interaction: 0
        })
    );
    assert_eq!(sim.world().get::<SleepPlace>(second), Some(&SleepPlace(1)));
    assert_eq!(sim.world().get::<Eating>(second), Some(&action));
    assert_eq!(
        sim.world()
            .resource::<crate::beds::BedAssignments>()
            .assigned_to(SimId(1)),
        Some(assignment)
    );
    assert!(substitute_need(&mut sim, third, NeedId::Energy));
    assert_eq!(sim.world().get::<SleepPlace>(third), Some(&SleepPlace(0)));
}

#[test]
fn free_bed_place_requires_its_own_contact_edge_for_substitution_and_emergency_checks() {
    for blocked in [false, true] {
        let (mut sim, bed, _, [first, second, _]) = fixture();
        assert!(substitute_need(&mut sim, first, NeedId::Energy));
        sim.world_mut()
            .resource_mut::<TileGrid>()
            .set_edge_blocked((7, 8), (7, 7), blocked);
        sim.world_mut()
            .get_mut::<Needs>(second)
            .unwrap()
            .set(NeedId::Energy, 4.0);
        crate::systems::interpersonal::prepare(sim.world_mut());
        let occupancy = occupancy(sim.world_mut());
        let mut phase = sim
            .world_mut()
            .remove_resource::<crate::systems::interpersonal::InterpersonalPhase>()
            .unwrap();
        let pack = sim.world().resource::<Content>().0;
        let furniture = [crate::systems::interpersonal::BoundaryFurniture {
            entity: bed,
            position: Position { x: 7.0, y: 7.0 },
            definition: ObjectDefId(0),
            facing: Facing::default(),
        }];
        let target = Target {
            object: bed,
            interaction: 0,
        };
        let mut decisions = BoundaryDecisions::default();
        let mut rng = SimRng::from_seed(1);
        assert_eq!(
            phase.permit(
                second,
                Some(&target),
                pack,
                Some(ObjectDefId(0)),
                *sim.world().get::<Position>(second).unwrap(),
                sim.world().resource::<TileGrid>(),
                &furniture,
                &occupancy,
                sim.world().resource::<crate::beds::BedAssignments>(),
                0,
                &mut decisions,
                &mut rng
            ),
            blocked,
            "only an inaccessible alternative permits emergency"
        );
        sim.world_mut().insert_resource(phase);
        assert_eq!(substitute_need(&mut sim, second, NeedId::Energy), !blocked);
        if !blocked {
            assert_eq!(sim.world().get::<SleepPlace>(second), Some(&SleepPlace(1)));
        }
    }
}

#[test]
fn replacing_a_sleep_goal_keeps_its_held_place() {
    let (mut sim, bed, _, [first, second, _]) = fixture();
    assert!(substitute_need(&mut sim, first, NeedId::Energy));
    assert!(substitute_need(&mut sim, second, NeedId::Energy));
    crate::reservations::release_now(
        sim.world_mut(),
        first,
        Target {
            object: bed,
            interaction: 0,
        },
    );
    sim.world_mut().entity_mut(first).remove::<Target>();
    assert!(substitute_need(&mut sim, second, NeedId::Energy));
    assert_eq!(sim.world().get::<SleepPlace>(second), Some(&SleepPlace(1)));
    assert!(sim.world().get::<Reserved>(bed).is_some());
}

#[test]
fn privacy_bed_substitution_prioritizes_survival_before_assignment() {
    for danger in [false, true] {
        let (mut sim, bed, _, [actor, _, _]) = fixture();
        sim.world_mut()
            .entity_mut(actor)
            .insert(Position { x: 7.0, y: 8.0 });
        let mut pack = sim.world().resource::<Content>().0.clone();
        pack.tuning.death_after_ticks = 100;
        sim.world_mut()
            .insert_resource(Content(Box::leak(Box::new(pack))));
        let mut needs = sim.world_mut().get_mut::<Needs>(actor).unwrap();
        needs.set(NeedId::Energy, 10.0);
        if danger {
            needs.set(NeedId::Hunger, 0.0);
        }
        sim.world_mut()
            .resource_mut::<terri_core::save::SavedMortality>()
            .enabled = danger;
        sim.world_mut()
            .resource_mut::<crate::beds::BedAssignments>()
            .set(SimId(0), Some(crate::beds::BedPlace { bed, ordinal: 0 }));
        assert!(substitute_need(&mut sim, actor, NeedId::Energy));
        assert_eq!(
            sim.world().get::<SleepPlace>(actor),
            Some(&SleepPlace(u8::from(danger)))
        );
    }
}

#[test]
fn privacy_bed_substitution_uses_the_authored_base_without_an_explicit_facing() {
    let (mut sim, bed, _, [actor, _, _]) = fixture();
    let mut pack = sim.world().resource::<Content>().0.clone();
    pack.objects[0].base_facing = Facing::SouthWest;
    sim.world_mut()
        .insert_resource(Content(Box::leak(Box::new(pack))));
    sim.world_mut()
        .resource_mut::<crate::beds::BedAssignments>()
        .set(SimId(0), Some(crate::beds::BedPlace { bed, ordinal: 0 }));
    assert!(sim.world().get::<ObjectFacing>(bed).is_none());
    assert!(substitute_need(&mut sim, actor, NeedId::Energy));
    assert_eq!(
        sim.world().get::<Path>(actor).unwrap().steps.last(),
        Some(&(7, 6))
    );
}

#[test]
fn privacy_substitution_preserves_assignment_preference_across_beds_when_safe() {
    for (danger, someone_elses) in [(false, false), (true, false), (false, true)] {
        let (mut sim, far, _, [actor, _, _]) = fixture();
        let near = sim
            .world_mut()
            .spawn((SmartObject(ObjectDefId(0)), Position { x: 4.0, y: 2.0 }))
            .id();
        sim.world_mut()
            .resource_mut::<TileGrid>()
            .set_blocked(4, 2, true);
        let mut pack = sim.world().resource::<Content>().0.clone();
        pack.tuning.death_after_ticks = 100;
        sim.world_mut()
            .insert_resource(Content(Box::leak(Box::new(pack))));
        let mut needs = sim.world_mut().get_mut::<Needs>(actor).unwrap();
        needs.set(NeedId::Energy, 10.0);
        if danger {
            needs.set(NeedId::Hunger, 0.0);
        }
        sim.world_mut()
            .resource_mut::<terri_core::save::SavedMortality>()
            .enabled = danger;
        let mut assignments = sim
            .world_mut()
            .resource_mut::<crate::beds::BedAssignments>();
        if someone_elses {
            assignments.set(
                SimId(1),
                Some(crate::beds::BedPlace {
                    bed: near,
                    ordinal: 0,
                }),
            );
            assignments.set(
                SimId(2),
                Some(crate::beds::BedPlace {
                    bed: near,
                    ordinal: 1,
                }),
            );
        } else {
            assignments.set(
                SimId(0),
                Some(crate::beds::BedPlace {
                    bed: far,
                    ordinal: 0,
                }),
            );
        }
        assert!(substitute_need(&mut sim, actor, NeedId::Energy));
        assert_eq!(
            sim.world().get::<Target>(actor).unwrap().object,
            if danger { near } else { far }
        );
    }
}

#[test]
fn privacy_detours_replace_historical_endpoints_with_the_held_places_current_approach() {
    for facing in Facing::ALL {
        let (mut sim, bed, food, [actor, _, private_user]) = fixture();
        sim.world_mut().entity_mut(bed).insert(ObjectFacing(facing));
        let mut pack = sim.world().resource::<Content>().0.clone();
        pack.objects[1].interactions[0]
            .tags
            .push(crate::systems::interpersonal::PRIVATE_USE_TAG.into());
        sim.world_mut()
            .insert_resource(Content(Box::leak(Box::new(pack))));
        sim.world_mut()
            .entity_mut(food)
            .insert(Position { x: 10.0, y: 4.0 });
        sim.world_mut().entity_mut(private_user).insert((
            Position { x: 10.0, y: 5.0 },
            Eating {
                object: ObjectDefId(1),
                interaction: 0,
                remaining_ticks: 50,
            },
            Target {
                object: food,
                interaction: 0,
            },
        ));
        let mut grid = sim.world_mut().resource_mut::<TileGrid>();
        grid.set_blocked(3, 3, false);
        grid.set_blocked(10, 4, true);
        for y in 0..12 {
            grid.set_edge_blocked((8, y), (9, y), y != 6);
        }
        sim.world_mut()
            .insert_resource(terri_core::layout::SavedLayout::EdgeWallsV1 {
                edges: (0..12)
                    .map(|y| terri_core::layout::WallEdge {
                        axis: terri_core::layout::EdgeAxis::Vertical,
                        x: 9,
                        y,
                        doorway: y == 6,
                    })
                    .collect(),
            });
        let pack = sim.world().resource::<Content>().0;
        let offset = pack.objects[0].sleep_approaches_at(0, facing).unwrap()[0];
        let old_end = (7 + offset.0, 7 + offset.1);
        let grid = sim.world().resource::<TileGrid>();
        let mut steps = grid.find_path((2, 2), (10, 6)).unwrap();
        steps.extend(grid.find_path((10, 6), old_end).unwrap());
        let steps = grid.anchor_path((2.25, 2.0), steps).unwrap();
        sim.world_mut().entity_mut(actor).insert((
            Target {
                object: bed,
                interaction: 0,
            },
            SleepPlace(1),
            Path { steps, cursor: 0 },
        ));
        sim.world_mut().entity_mut(bed).insert(Reserved);
        crate::systems::interpersonal::prepare(sim.world_mut());
        let before = sim.world().get::<Path>(actor).unwrap().clone();
        // Player ownership leaves even a historical approach untouched.
        sim.world_mut()
            .entity_mut(actor)
            .insert(terri_core::IntentQueue::from_intents(vec![
                terri_core::Intent {
                    cleanup: None,
                    chore: None,
                    object: bed,
                    interaction: 0,
                },
            ]));
        route(sim.world_mut());
        assert_eq!(sim.world().get::<Path>(actor).unwrap().steps, before.steps);
        assert_eq!(
            sim.world().get::<Path>(actor).unwrap().cursor,
            before.cursor
        );
        sim.world_mut()
            .entity_mut(actor)
            .remove::<terri_core::IntentQueue>();
        route(sim.world_mut());
        let new_path = sim.world().get::<Path>(actor).unwrap();
        let offset = pack.objects[0].sleep_approaches_at(1, facing).unwrap()[0];
        assert_eq!(new_path.steps.last(), Some(&(7 + offset.0, 7 + offset.1)));
        assert!(new_path.steps.iter().all(|(x, _)| *x < 9));
        assert_eq!(sim.world().get::<SleepPlace>(actor), Some(&SleepPlace(1)));
        assert!(sim.world().get::<Reserved>(bed).is_some());
    }
}
