use super::*;
use terri_core::{Eating, Facing, Path};

fn household() -> (Sim, Entity, Vec<Entity>) {
    let mut sim = Sim::new_from_shipped_lot_with_seed(2301);
    let bed_definition = terri_data::pack().find("double_bed").unwrap();
    let bed = sim
        .world_mut()
        .query::<(Entity, &SmartObject)>()
        .iter(sim.world())
        .find(|(_, object)| object.0 == bed_definition)
        .unwrap()
        .0;
    let mut people: Vec<_> = sim
        .world_mut()
        .query::<(Entity, &SimId)>()
        .iter(sim.world())
        .map(|(entity, id)| (id.0, entity))
        .collect();
    people.sort_unstable_by_key(|(id, _)| *id);
    (
        sim,
        bed,
        people.into_iter().map(|(_, entity)| entity).collect(),
    )
}

#[test]
fn shipped_double_bed_admits_two_walkers_and_sleepers_without_changing_the_household() {
    let (mut sim, bed, people) = household();
    let people = &people[..2];
    for (ordinal, person) in people.iter().enumerate() {
        let mut commands = sim.world_mut().resource_mut::<CommandQueue>();
        commands.push(SimCommand::SetBedAssignment {
            agent: person.index_u32(),
            place: Some((bed.index_u32(), ordinal as u8)),
        });
        commands.push(SimCommand::UseObjectFirst {
            agent: person.index_u32(),
            object: bed.index_u32(),
            interaction: 0,
        });
    }
    sim.tick();
    for (ordinal, person) in people.iter().enumerate() {
        assert_eq!(
            sim.world().get::<SleepPlace>(*person),
            Some(&SleepPlace(ordinal as u8))
        );
        assert!(sim.world().get::<Path>(*person).is_some());
        assert!(sim.world().get::<Eating>(*person).is_none());
    }
    let assignments = sim.world().resource::<BedAssignments>().clone();
    assert_eq!(assignments.iter().count(), 2);
    for (ordinal, person) in people.iter().enumerate() {
        assert_eq!(
            assignments.assigned_to(*sim.world().get::<SimId>(*person).unwrap()),
            Some(BedPlace {
                bed,
                ordinal: ordinal as u8
            })
        );
    }
    let mut loaded = Sim::new_from_shipped_lot();
    let walking = sim.save_snapshot_v5();
    loaded.load_snapshot_v5(walking.clone()).unwrap();
    assert_eq!(loaded.save_snapshot_v5(), walking);
    for _ in 0..600 {
        sim.tick();
        loaded.tick();
        assert_eq!(loaded.save_snapshot_v5(), sim.save_snapshot_v5());
        assert_eq!(loaded.world_hash(), sim.world_hash());
        assert_eq!(sim.world().resource::<BedAssignments>(), &assignments);
        if people
            .iter()
            .all(|person| sim.world().get::<Eating>(*person).is_some())
        {
            for (ordinal, person) in people.iter().enumerate() {
                assert_eq!(
                    sim.world().get::<SleepPlace>(*person),
                    Some(&SleepPlace(ordinal as u8))
                );
                assert_eq!(
                    sim.world().get::<Target>(*person),
                    Some(&Target {
                        object: bed,
                        interaction: 0
                    })
                );
                assert!(sim.world().get::<Path>(*person).is_none());
                let position = sim.world().get::<Position>(*person).unwrap();
                assert_eq!(position.y, if ordinal == 0 { 7.0 } else { 10.0 });
                if ordinal == 0 {
                    assert!(position.x == 0.0 || position.x == 1.0);
                } else {
                    assert_eq!(position.x, 1.0);
                }
            }
            let sleeping = sim.save_snapshot_v5();
            loaded.load_snapshot_v5(sleeping.clone()).unwrap();
            assert_eq!(loaded.save_snapshot_v5(), sleeping);
            let actions: Vec<_> = people
                .iter()
                .map(|person| *sim.world().get::<Eating>(*person).unwrap())
                .collect();
            assert!(actions.iter().all(|action| action.remaining_ticks > 20));
            for elapsed in 1..=20 {
                sim.tick();
                loaded.tick();
                assert_eq!(loaded.save_snapshot_v5(), sim.save_snapshot_v5());
                assert_eq!(loaded.world_hash(), sim.world_hash());
                assert_eq!(sim.world().resource::<BedAssignments>(), &assignments);
                for (ordinal, person) in people.iter().enumerate() {
                    assert_eq!(
                        sim.world().get::<SleepPlace>(*person),
                        Some(&SleepPlace(ordinal as u8))
                    );
                    assert_eq!(
                        sim.world().get::<Target>(*person),
                        Some(&Target {
                            object: bed,
                            interaction: 0
                        })
                    );
                    assert_eq!(
                        sim.world().get::<Eating>(*person),
                        Some(&Eating {
                            remaining_ticks: actions[ordinal].remaining_ticks - elapsed,
                            ..actions[ordinal]
                        })
                    );
                    assert!(sim.world().get::<Path>(*person).is_none());
                }
            }
            return;
        }
    }
    panic!("the shipped double bed never accommodated both assigned sleepers");
}

#[test]
fn saved_bed_position_survives_a_new_game_layout_change() {
    let (mut sim, bed, people) = household();
    sim.world_mut()
        .resource_mut::<CommandQueue>()
        .push(SimCommand::PlaceObject {
            object: bed.index_u32(),
            x: 0,
            y: 6,
            facing: Facing::SouthEast,
        });
    sim.flush_commands();
    let position = sim.world().get::<Position>(bed).unwrap();
    assert_eq!((position.x, position.y), (0.0, 6.0));
    commit(
        sim.world_mut(),
        people[0].index_u32(),
        Some((bed.index_u32(), 0)),
    );
    let assignments = sim.world().resource::<BedAssignments>().clone();
    assert_eq!(
        assignments.assigned_to(*sim.world().get::<SimId>(people[0]).unwrap()),
        Some(BedPlace { bed, ordinal: 0 })
    );
    let saved = sim.save_snapshot_v5();
    assert_eq!(saved.world.content_fingerprint, 0xb38e_71a1_23bb_8273);
    let mut loaded = Sim::new_from_shipped_lot();
    loaded.load_snapshot_v5(saved.clone()).unwrap();
    assert_eq!(loaded.save_snapshot_v5(), saved);
    assert_eq!(loaded.world_hash(), sim.world_hash());
    assert_eq!(loaded.world().resource::<BedAssignments>(), &assignments);
}
