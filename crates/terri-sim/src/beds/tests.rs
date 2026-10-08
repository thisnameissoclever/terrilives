use super::*;
mod lifecycle;
mod navigation;
mod projection;
mod shipped;
use crate::{test_content, Sim};
use terri_core::{
    Agent, Blocked, CommandQueue, Intent, IntentQueue, NeedId, Needs, ObjectDefId, Position,
    Reserved, SimCommand, SmartObject,
};

fn content() -> &'static ContentPack {
    let mut sleep = test_content::interaction("sleep", &[(NeedId::Energy, 80.0)], 100);
    sleep.tags = vec![terri_data::pack().sleep_tag.clone()];
    sleep.slots = 2;
    let mut nap = sleep.clone();
    nap.id = "nap".into();
    nap.slots = 1;
    let sit = test_content::interaction("sit", &[(NeedId::Comfort, 20.0)], 20);
    let mut object = test_content::object_offering("bed", vec![sleep, nap, sit]);
    object.sleep_places = vec![
        terri_data::SleepPlaceAccess {
            id: "first".into(),
            approaches: vec![(0, -1)],
        },
        terri_data::SleepPlaceAccess {
            id: "second".into(),
            approaches: vec![(0, 1)],
        },
    ];
    test_content::pack(vec![object])
}

fn fixture() -> (Sim, Entity, [Entity; 3]) {
    let mut sim = test_content::sim_with(12, 12, content());
    let bed = sim
        .world_mut()
        .spawn((SmartObject(ObjectDefId(0)), Position { x: 7.0, y: 7.0 }))
        .id();
    sim.world_mut()
        .resource_mut::<terri_core::TileGrid>()
        .set_blocked(7, 7, true);
    sim.world_mut()
        .insert_resource(terri_core::SimIdAllocator::resumed(3));
    let agents = std::array::from_fn(|id| {
        sim.world_mut()
            .spawn((
                Agent,
                SimId(id as u32),
                terri_core::SimName(format!("Person {id}")),
                terri_core::SelfPreservation(50),
                terri_core::Personality::default(),
                Needs::all_at(70.0),
                Position {
                    x: 2.0,
                    y: id as f32 + 2.0,
                },
            ))
            .id()
    });
    (sim, bed, agents)
}

fn order(sim: &mut Sim, agent: Entity, bed: Entity, interaction: u32) {
    sim.world_mut()
        .entity_mut(agent)
        .insert(IntentQueue::from_intents(vec![Intent {
            cleanup: None,
            chore: None,
            object: bed,
            interaction,
        }]));
}

#[test]
fn alternate_sleep_actions_share_two_places_and_a_third_order_waits() {
    let (mut sim, bed, [first, second, third]) = fixture();
    order(&mut sim, first, bed, 0);
    order(&mut sim, second, bed, 1);
    order(&mut sim, third, bed, 0);
    sim.tick();
    assert_eq!(sim.world().get::<SleepPlace>(first), Some(&SleepPlace(0)));
    assert_eq!(sim.world().get::<SleepPlace>(second), Some(&SleepPlace(1)));
    assert_eq!(sim.world().get::<Target>(first).unwrap().object, bed);
    assert_eq!(sim.world().get::<Target>(second).unwrap().interaction, 1);
    assert!(sim.world().get::<Target>(third).is_none());
    assert!(sim.world().get::<Blocked>(third).is_some());
    assert_eq!(sim.world().get::<IntentQueue>(third).unwrap().len(), 1);
}

#[test]
fn cancelling_one_sleep_walk_releases_only_its_place() {
    let (mut sim, bed, [first, second, third]) = fixture();
    for person in [first, second, third] {
        order(&mut sim, person, bed, 0);
    }
    sim.tick();
    sim.world_mut()
        .resource_mut::<CommandQueue>()
        .push(SimCommand::CancelIntents {
            agent: first.index_u32(),
        });
    sim.flush_commands();
    assert!(sim.world().get::<SleepPlace>(first).is_none());
    assert_eq!(sim.world().get::<SleepPlace>(second), Some(&SleepPlace(1)));
    assert!(sim.world().get::<Reserved>(bed).is_some());
    sim.tick();
    assert_eq!(sim.world().get::<SleepPlace>(third), Some(&SleepPlace(0)));
    assert_eq!(sim.world().get::<SleepPlace>(second), Some(&SleepPlace(1)));
}

#[test]
fn another_sleep_action_keeps_the_current_place_but_exclusive_use_waits() {
    let (mut sim, bed, [first, second, _]) = fixture();
    order(&mut sim, first, bed, 0);
    order(&mut sim, second, bed, 0);
    sim.tick();
    order(&mut sim, second, bed, 1);
    sim.tick();
    assert_eq!(sim.world().get::<SleepPlace>(second), Some(&SleepPlace(1)));
    assert_eq!(sim.world().get::<Target>(second).unwrap().interaction, 1);
    order(&mut sim, second, bed, 2);
    sim.tick();
    assert!(sim.world().get::<Blocked>(second).is_some());
    assert_eq!(sim.world().get::<SleepPlace>(second), Some(&SleepPlace(1)));
    assert_eq!(sim.world().get::<Target>(second).unwrap().interaction, 1);
}

#[test]
fn unowned_reserved_marker_still_blocks_the_entire_bed() {
    let (mut sim, bed, [first, _, _]) = fixture();
    sim.world_mut().entity_mut(bed).insert(Reserved);
    order(&mut sim, first, bed, 0);
    sim.tick();
    assert!(sim.world().get::<Target>(first).is_none());
    assert!(sim.world().get::<Blocked>(first).is_some());
}

#[test]
fn an_exclusive_action_blocks_all_sleep_places() {
    let (mut sim, bed, [first, second, _]) = fixture();
    order(&mut sim, first, bed, 2);
    order(&mut sim, second, bed, 0);
    sim.tick();
    assert_eq!(sim.world().get::<Target>(first).unwrap().interaction, 2);
    assert!(sim.world().get::<SleepPlace>(first).is_none());
    assert!(sim.world().get::<Target>(second).is_none());
    assert!(sim.world().get::<Blocked>(second).is_some());
}

#[test]
fn assignment_conflicts_are_atomic_and_clear_releases_only_that_assignment() {
    let (_, bed, _) = fixture();
    let mut assignments = BedAssignments::default();
    let left = BedPlace { bed, ordinal: 0 };
    let right = BedPlace { bed, ordinal: 1 };
    assert!(assignments.set(SimId(8), Some(left)));
    assert!(assignments.set(SimId(3), Some(right)));
    assert!(!assignments.set(SimId(8), Some(right)));
    assert_eq!(assignments.assigned_to(SimId(8)), Some(left));
    assert!(assignments.set(SimId(3), None));
    assert!(assignments.set(SimId(8), Some(right)));
    assert_eq!(assignments.assignee(left), None);
    assert_eq!(assignments.assignee(right), Some(SimId(8)));
    assignments.remove_bed(bed);
    assert_eq!(assignments.iter().count(), 0);
}

#[test]
fn orders_choose_an_unassigned_place_or_their_own_place() {
    let (mut sim, bed, [first, second, _]) = fixture();
    sim.world_mut()
        .resource_mut::<BedAssignments>()
        .set(SimId(1), Some(BedPlace { bed, ordinal: 0 }));
    order(&mut sim, first, bed, 0);
    sim.tick();
    assert_eq!(
        sim.world().get::<SleepPlace>(first),
        Some(&SleepPlace(1)),
        "unassigned place comes before another person's place"
    );
    order(&mut sim, second, bed, 0);
    sim.tick();
    assert_eq!(sim.world().get::<SleepPlace>(second), Some(&SleepPlace(0)));
}

#[test]
fn assigning_an_occupied_place_does_not_interrupt_and_its_owner_can_use_the_other_place() {
    let (mut sim, bed, [first, second, _]) = fixture();
    order(&mut sim, first, bed, 0);
    sim.tick();
    let target = *sim.world().get::<Target>(first).unwrap();
    let path = sim.world().get::<terri_core::Path>(first).unwrap().clone();
    sim.world_mut()
        .resource_mut::<CommandQueue>()
        .push(SimCommand::SetBedAssignment {
            agent: second.index_u32(),
            place: Some((bed.index_u32(), 0)),
        });
    sim.flush_commands();
    assert_eq!(sim.world().get::<Target>(first), Some(&target));
    let after = sim.world().get::<terri_core::Path>(first).unwrap();
    assert_eq!(after.steps, path.steps);
    assert_eq!(after.cursor, path.cursor);
    order(&mut sim, second, bed, 0);
    sim.tick();
    assert_eq!(sim.world().get::<SleepPlace>(second), Some(&SleepPlace(1)));
}

#[test]
fn completion_removes_the_departing_lease_after_target_removal() {
    let (mut sim, bed, [first, second, _]) = fixture();
    for person in [first, second] {
        order(&mut sim, person, bed, 0);
    }
    sim.tick();
    for (person, remaining_ticks) in [(first, 1), (second, 100)] {
        sim.world_mut()
            .entity_mut(person)
            .remove::<terri_core::Path>()
            .insert(terri_core::Eating {
                object: ObjectDefId(0),
                interaction: 0,
                remaining_ticks,
            });
    }
    sim.tick();
    assert!(sim.world().get::<SleepPlace>(first).is_none());
    assert!(sim.world().get::<Target>(first).is_none());
    assert_eq!(sim.world().get::<SleepPlace>(second), Some(&SleepPlace(1)));
    assert!(sim.world().get::<Reserved>(bed).is_some());
}

#[test]
fn assignment_commands_apply_conflict_clear_and_stale_refusal_in_order() {
    let (mut sim, bed, [first, second, _]) = fixture();
    let assign = |agent: Entity| SimCommand::SetBedAssignment {
        agent: agent.index_u32(),
        place: Some((bed.index_u32(), 1)),
    };
    for command in [assign(first), assign(second)] {
        sim.world_mut().resource_mut::<CommandQueue>().push(command);
    }
    sim.flush_commands();
    assert_eq!(
        sim.world()
            .resource::<AssignmentFeedback>()
            .last
            .unwrap()
            .refusal,
        Some(AssignmentRefusal::AlreadyAssigned)
    );
    assert_eq!(
        sim.world()
            .resource::<BedAssignments>()
            .assigned_to(SimId(0)),
        Some(BedPlace { bed, ordinal: 1 })
    );
    for command in [
        SimCommand::SetBedAssignment {
            agent: first.index_u32(),
            place: None,
        },
        assign(second),
    ] {
        sim.world_mut().resource_mut::<CommandQueue>().push(command);
    }
    sim.flush_commands();
    assert_eq!(
        sim.world()
            .resource::<AssignmentFeedback>()
            .last
            .unwrap()
            .refusal,
        None
    );
    assert_eq!(
        sim.world()
            .resource::<BedAssignments>()
            .assigned_to(SimId(0)),
        None
    );
    assert_eq!(
        sim.world()
            .resource::<BedAssignments>()
            .assigned_to(SimId(1)),
        Some(BedPlace { bed, ordinal: 1 })
    );
    let before = sim.world().resource::<BedAssignments>().clone();
    for (agent, place, reason) in [
        (u32::MAX, None, AssignmentRefusal::UnknownSim),
        (
            first.index_u32(),
            Some((u32::MAX, 0)),
            AssignmentRefusal::UnknownBed,
        ),
        (
            first.index_u32(),
            Some((bed.index_u32(), 2)),
            AssignmentRefusal::InvalidPlace,
        ),
    ] {
        sim.world_mut()
            .resource_mut::<CommandQueue>()
            .push(SimCommand::SetBedAssignment { agent, place });
        sim.flush_commands();
        assert_eq!(
            sim.world()
                .resource::<AssignmentFeedback>()
                .last
                .unwrap()
                .refusal,
            Some(reason)
        );
        assert_eq!(sim.world().resource::<BedAssignments>(), &before);
    }
}

#[test]
fn preferred_beds_preserve_safer_sleep_alternatives_and_other_needs() {
    let (mut sim, bed, [first, second, third]) = fixture();
    let other = sim.world_mut().spawn_empty().id();
    let mut rows = vec![
        (bed, 0, 1.0),
        (first, 0, 3.0),
        (second, 0, 5.0),
        (third, 0, 7.0),
        (other, 0, 10.0),
    ];
    let mut risks = vec![2.0, 2.0, 3.0, 1.0, 0.0];
    let admissions = HashMap::from([
        (
            (bed, 0),
            Admission::Sleep {
                ordinal: 0,
                preference: Preference::Assigned,
            },
        ),
        (
            (first, 0),
            Admission::Sleep {
                ordinal: 0,
                preference: Preference::Unassigned,
            },
        ),
        (
            (second, 0),
            Admission::Sleep {
                ordinal: 0,
                preference: Preference::SomeoneElses,
            },
        ),
        (
            (third, 0),
            Admission::Sleep {
                ordinal: 0,
                preference: Preference::SomeoneElses,
            },
        ),
        ((other, 0), Admission::Exclusive),
    ]);
    prefer_assignments(&mut rows, &mut risks, &admissions);
    assert_eq!(rows, vec![(bed, 0, 1.0), (third, 0, 7.0), (other, 0, 10.0)]);
    assert_eq!(risks, vec![2.0, 1.0, 0.0]);
}

#[test]
fn shared_sleep_state_roundtrips_without_restart_and_rejects_missing_or_conflicting_rows() {
    let (mut sim, bed, [first, second, _]) = fixture();
    order(&mut sim, first, bed, 0);
    order(&mut sim, second, bed, 1);
    sim.tick();
    sim.world_mut()
        .resource_mut::<BedAssignments>()
        .set(SimId(2), Some(BedPlace { bed, ordinal: 1 }));
    let saved = sim.save_snapshot_v5();
    let mut loaded = test_content::sim_with(12, 12, sim.world().resource::<crate::Content>().0);
    loaded.load_snapshot_v5(saved.clone()).unwrap();
    assert_eq!(loaded.save_snapshot_v5(), saved);
    assert_eq!(loaded.world_hash(), sim.world_hash());
    for active in [
        vec![],
        vec![(first.index_u32(), 0)],
        vec![(first.index_u32(), 0), (second.index_u32(), 0)],
        vec![(first.index_u32(), 0), (second.index_u32(), 2)],
    ] {
        let mut bad = saved.clone();
        bad.sleeping_places.as_mut().unwrap().active_places = active;
        assert!(loaded.load_snapshot_v5(bad).is_err());
        assert_eq!(loaded.save_snapshot_v5(), saved);
    }
    for _ in 0..150 {
        sim.tick();
        loaded.tick();
    }
    assert_eq!(loaded.save_snapshot_v5(), sim.save_snapshot_v5());
    assert_eq!(loaded.world_hash(), sim.world_hash());
}

#[test]
fn capacity_counts_physical_places_once_and_ignores_non_sleep_actions() {
    let pack = content();
    let mut object = pack.objects[0].clone();
    object.interactions[2].slots = 20;
    assert_eq!(capacity(pack, &object), 2);
    object
        .interactions
        .retain(|interaction| !interaction.tags.contains(&pack.sleep_tag));
    assert_eq!(capacity(pack, &object), 0);
}

#[test]
fn malformed_nonperson_sleep_claim_is_exclusive() {
    let (mut sim, bed, [first, _, _]) = fixture();
    sim.world_mut().entity_mut(bed).insert(Reserved);
    sim.world_mut().spawn((
        Target {
            object: bed,
            interaction: 0,
        },
        SleepPlace(0),
    ));
    order(&mut sim, first, bed, 0);
    // Run admission directly: lifecycle cleanup would correctly remove this invalid owner.
    use bevy_ecs::system::RunSystemOnce;
    sim.world_mut()
        .run_system_once(crate::systems::action::serve_intents)
        .unwrap();
    assert!(sim.world().get::<Target>(first).is_none());
    assert!(sim.world().get::<Blocked>(first).is_some());
}

#[test]
fn all_historical_loaders_migrate_one_place_without_restarting_the_walk() {
    let (mut source, bed, [first, second, third]) = fixture();
    source.world_mut().despawn(second);
    source.world_mut().despawn(third);
    order(&mut source, first, bed, 0);
    source.tick();
    // Historical whole-bed access may end on the side now authored for place one.
    let position = *source.world().get::<Position>(first).unwrap();
    let grid = source.world().resource::<terri_core::TileGrid>();
    let steps = grid
        .find_path(
            (position.x.round() as i32, position.y.round() as i32),
            (7, 8),
        )
        .unwrap();
    let steps = grid.anchor_path((position.x, position.y), steps).unwrap();
    source
        .world_mut()
        .entity_mut(first)
        .insert(terri_core::Path { steps, cursor: 0 });
    let original = source.save_snapshot_v5();
    assert_eq!(
        original.sleeping_places.as_ref().unwrap().active_places,
        vec![(first.index_u32(), 0)],
        "the historical fixture must have only one whole-bed claimant"
    );
    for version in 1..=5 {
        let mut live =
            test_content::sim_with(12, 12, source.world().resource::<crate::Content>().0);
        match version {
            1 => live.load_snapshot(source.save_snapshot()).unwrap(),
            2 => live.load_snapshot_v2(source.save_snapshot_v2()).unwrap(),
            3 => live.load_snapshot_v3(source.save_snapshot_v3()).unwrap(),
            4 => live.load_snapshot_v4(source.save_snapshot_v4()).unwrap(),
            _ => {
                let mut old = original.clone();
                old.sleeping_places = None;
                live.load_snapshot_v5(old).unwrap();
            }
        }
        let actual = live.save_snapshot_v5();
        assert_eq!(actual.world.entities, original.world.entities, "V{version}");
        assert_eq!(actual.world.tick, original.world.tick, "V{version}");
        assert_eq!(
            actual.world.queued_commands, original.world.queued_commands,
            "V{version}"
        );
        assert_eq!(
            actual.sleeping_places.as_ref().unwrap().active_places,
            vec![(first.index_u32(), 0)]
        );
        // Older versions already perform a separate instinct migration; V5 preserves its RNG.
        if version == 5 {
            assert_eq!(actual.world.rng, original.world.rng);
        }
        let before_reload = actual.clone();
        live.load_snapshot_v5(actual).unwrap();
        assert_eq!(
            live.save_snapshot_v5(),
            before_reload,
            "V{version} modern re-save preserves the old-side route"
        );
    }
}

#[test]
fn mixed_sleep_and_exclusive_claims_reject_modern_and_legacy_loads_atomically() {
    let (mut source, bed, [first, second, _]) = fixture();
    order(&mut source, first, bed, 0);
    source.tick();
    source.world_mut().entity_mut(second).insert((
        Target {
            object: bed,
            interaction: 2,
        },
        terri_core::Path {
            steps: vec![],
            cursor: 0,
        },
    ));
    source.world_mut().entity_mut(second).remove::<SleepPlace>();
    let saved = source.save_snapshot_v5();
    let mut live = test_content::sim_with(12, 12, source.world().resource::<crate::Content>().0);
    let before = live.save_snapshot_v5();
    for legacy in [false, true] {
        let mut bad = saved.clone();
        if legacy {
            bad.sleeping_places = None;
        }
        assert!(live.load_snapshot_v5(bad).is_err());
        assert_eq!(live.save_snapshot_v5(), before);
    }
    assert!(live.load_snapshot(source.save_snapshot()).is_err());
    assert_eq!(live.save_snapshot_v5(), before);
}

#[test]
fn assignment_save_validation_rejects_duplicates_conflicts_invalid_owners_and_places() {
    let (source, bed, [first, _, _]) = fixture();
    let saved = source.save_snapshot_v5();
    let mut live = test_content::sim_with(12, 12, source.world().resource::<crate::Content>().0);
    let before = live.save_snapshot_v5();
    for rows in [
        vec![(0, bed.index_u32(), 0), (0, bed.index_u32(), 1)],
        vec![(1, bed.index_u32(), 0), (0, bed.index_u32(), 1)],
        vec![(0, bed.index_u32(), 0), (1, bed.index_u32(), 0)],
        vec![(999, bed.index_u32(), 0)],
        vec![(0, first.index_u32(), 0)],
        vec![(0, u32::MAX, 0)],
        vec![(0, bed.index_u32(), 2)],
    ] {
        let mut bad = saved.clone();
        bad.sleeping_places.as_mut().unwrap().assignments = rows;
        assert!(live.load_snapshot_v5(bad).is_err());
        assert_eq!(live.save_snapshot_v5(), before);
    }
}

fn load_historical(live: &mut Sim, source: &Sim, version: u8) -> Result<(), crate::SaveError> {
    match version {
        1 => live.load_snapshot(source.save_snapshot()),
        2 => live.load_snapshot_v2(source.save_snapshot_v2()),
        3 => live.load_snapshot_v3(source.save_snapshot_v3()),
        4 => live.load_snapshot_v4(source.save_snapshot_v4()),
        _ => {
            let mut saved = source.save_snapshot_v5();
            saved.sleeping_places = None;
            live.load_snapshot_v5(saved)
        }
    }
}

#[test]
fn running_sleep_migrates_without_restart_and_incompatible_states_fail_atomically() {
    let (mut source, bed, [first, second, third]) = fixture();
    source.world_mut().despawn(second);
    source.world_mut().despawn(third);
    order(&mut source, first, bed, 0);
    for _ in 0..200 {
        source.tick();
        if source.world().get::<terri_core::Eating>(first).is_some() {
            break;
        }
    }
    assert!(source.world().get::<terri_core::Eating>(first).is_some());
    let saved = source.save_snapshot_v5();
    for version in 1..=5 {
        let mut live = test_content::sim_with(12, 12, content());
        load_historical(&mut live, &source, version).unwrap();
        assert_eq!(live.save_snapshot_v5().world.entities, saved.world.entities);
        assert_eq!(live.world().get::<SleepPlace>(first), Some(&SleepPlace(0)));
    }
    let mut live = test_content::sim_with(12, 12, content());
    live.load_snapshot_v5(saved.clone()).unwrap();
    for corruption in 0..4 {
        let mut bad = saved.clone();
        let agent = bad
            .world
            .entities
            .iter_mut()
            .find(|row| row.index == first.index_u32())
            .unwrap();
        match corruption {
            0 => {
                agent.path = Some(terri_core::save::SavedPath {
                    steps: vec![],
                    cursor: 0,
                })
            }
            1 => agent.commuting = true,
            2 => agent.at_work_ticks = Some(10),
            _ => agent.step_work_ticks = Some(10),
        }
        assert!(
            live.load_snapshot_v5(bad).is_err(),
            "accepted corruption {corruption}"
        );
        assert_eq!(live.save_snapshot_v5(), saved);
    }
}

#[test]
fn historical_loaders_reject_assignment_commands_but_modern_saves_replay_stale_refusals() {
    let (mut source, bed, [first, _, _]) = fixture();
    for command in [
        SimCommand::SetBedAssignment {
            agent: first.index_u32(),
            place: Some((bed.index_u32(), 1)),
        },
        SimCommand::SetBedAssignment {
            agent: u32::MAX,
            place: Some((bed.index_u32(), 0)),
        },
    ] {
        source
            .world_mut()
            .resource_mut::<CommandQueue>()
            .push(command);
    }
    let saved = source.save_snapshot_v5();
    let mut live = test_content::sim_with(12, 12, content());
    let before = live.save_snapshot_v5();
    for version in 1..=5 {
        assert!(
            load_historical(&mut live, &source, version).is_err(),
            "V{version}"
        );
        assert_eq!(live.save_snapshot_v5(), before);
    }
    live.load_snapshot_v5(saved.clone()).unwrap();
    assert_eq!(live.save_snapshot_v5(), saved);
    live.flush_commands();
    assert_eq!(
        live.world()
            .resource::<BedAssignments>()
            .assigned_to(SimId(0)),
        Some(BedPlace { bed, ordinal: 1 })
    );
    assert_eq!(live.world().resource::<AssignmentFeedback>().sequence, 2);
    assert_eq!(
        live.world()
            .resource::<AssignmentFeedback>()
            .last
            .unwrap()
            .refusal,
        Some(AssignmentRefusal::UnknownSim)
    );
    assert!(live
        .world()
        .resource::<CommandQueue>()
        .as_slice()
        .is_empty());
}

#[test]
fn hashes_distinguish_place_bed_assignee_and_set_clear_command_order() {
    let (mut sim, bed, [first, _, _]) = fixture();
    let other = sim
        .world_mut()
        .spawn((SmartObject(ObjectDefId(0)), Position { x: 9.0, y: 7.0 }))
        .id();
    sim.world_mut().entity_mut(first).insert((
        Target {
            object: bed,
            interaction: 0,
        },
        SleepPlace(0),
    ));
    let active = sim.world_hash();
    sim.world_mut().entity_mut(first).insert(SleepPlace(1));
    assert_ne!(sim.world_hash(), active, "active ordinal is hashed");
    sim.world_mut().entity_mut(first).insert((
        Target {
            object: other,
            interaction: 0,
        },
        SleepPlace(0),
    ));
    assert_ne!(
        sim.world_hash(),
        active,
        "active bed is hashed independently of Target"
    );
    sim.world_mut()
        .entity_mut(first)
        .remove::<(Target, SleepPlace)>();
    let empty = sim.world_hash();
    let mut hashes = HashSet::new();
    for (person, target, ordinal) in [(0, bed, 0), (0, bed, 1), (0, other, 0), (1, bed, 0)] {
        sim.world_mut().insert_resource(BedAssignments::default());
        sim.world_mut().resource_mut::<BedAssignments>().set(
            SimId(person),
            Some(BedPlace {
                bed: target,
                ordinal,
            }),
        );
        assert_ne!(sim.world_hash(), empty);
        assert!(
            hashes.insert(sim.world_hash()),
            "each assignment identity is hashed"
        );
    }
    sim.world_mut().insert_resource(BedAssignments::default());
    hashes.clear();
    let set = SimCommand::SetBedAssignment {
        agent: first.index_u32(),
        place: Some((bed.index_u32(), 0)),
    };
    let clear = SimCommand::SetBedAssignment {
        agent: first.index_u32(),
        place: None,
    };
    for commands in [
        vec![set.clone()],
        vec![clear.clone()],
        vec![set.clone(), clear.clone()],
        vec![clear, set],
    ] {
        sim.world_mut().insert_resource(CommandQueue::default());
        for command in commands {
            sim.world_mut().resource_mut::<CommandQueue>().push(command);
        }
        assert!(
            hashes.insert(sim.world_hash()),
            "set, clear and their order are hashed"
        );
    }
    sim.world_mut().insert_resource(CommandQueue::default());
    sim.world_mut()
        .resource_mut::<AssignmentFeedback>()
        .sequence = 99;
    assert_eq!(
        sim.world_hash(),
        empty,
        "presentation feedback does not affect simulation identity"
    );
}

#[test]
fn death_clears_only_the_deceased_assignment_and_active_place() {
    let (mut sim, bed, [first, second, _]) = fixture();
    for (agent, person, ordinal) in [(first, SimId(0), 0), (second, SimId(1), 1)] {
        sim.world_mut()
            .resource_mut::<BedAssignments>()
            .set(person, Some(BedPlace { bed, ordinal }));
        order(&mut sim, agent, bed, 0);
    }
    sim.tick();
    sim.world_mut()
        .get_mut::<Needs>(first)
        .unwrap()
        .set(NeedId::Hunger, 0.0);
    let threshold = sim
        .world()
        .resource::<crate::Content>()
        .0
        .tuning
        .death_after_ticks;
    let mut state = sim
        .world_mut()
        .resource_mut::<terri_core::save::SavedMortality>();
    state.enabled = true;
    state.counts = vec![(first.index_u32(), threshold - 1)];
    crate::mortality::tick(sim.world_mut());
    assert!(sim.world().get_entity(first).is_err());
    assert_eq!(
        sim.world()
            .resource::<BedAssignments>()
            .assigned_to(SimId(0)),
        None
    );
    assert_eq!(
        sim.world()
            .resource::<BedAssignments>()
            .assigned_to(SimId(1)),
        Some(BedPlace { bed, ordinal: 1 })
    );
    assert_eq!(sim.world().get::<SleepPlace>(second), Some(&SleepPlace(1)));
    assert_eq!(sim.world().get::<Target>(second).unwrap().object, bed);
    assert!(sim.world().get::<Reserved>(bed).is_some());
}

#[test]
fn assigned_beds_move_freely_but_active_places_block_edits_and_sale_clears_assignments() {
    use crate::placement::{sale::validate_sale, validate_placement, PlacementRefusal};
    use terri_core::Facing;
    let mut sim = Sim::new_from_shipped_lot();
    let saved = sim.save_snapshot_v5();
    let bed_index = saved
        .world
        .entities
        .iter()
        .find(|row| row.smart_object.as_deref() == Some("double_bed"))
        .unwrap()
        .index;
    let people: Vec<_> = saved
        .world
        .entities
        .iter()
        .filter(|row| row.agent)
        .map(|row| row.index)
        .collect();
    let (person, assignment) =
        validate_assignment(sim.world(), people[0], Some((bed_index, 0))).unwrap();
    let bed = assignment.unwrap().bed;
    commit(sim.world_mut(), people[0], Some((bed_index, 0)));
    let lot = &sim.world().resource::<crate::Content>().0.lot;
    let original = *sim.world().get::<Position>(bed).unwrap();
    let position = (0..lot.height)
        .flat_map(|y| (0..lot.width).map(move |x| (x, y)))
        .find(|&(x, y)| {
            (x as f32, y as f32) != (original.x, original.y)
                && validate_placement(sim.world(), bed_index, (x, y), Facing::SouthEast).is_ok()
                && {
                    let mut grid = sim.world().resource::<terri_core::TileGrid>().clone();
                    for dx in 0..2 {
                        for dy in 0..2 {
                            grid.set_blocked((x + dx) as usize, (y + dy) as usize, true);
                        }
                    }
                    let definition =
                        terri_data::pack().object(terri_data::pack().find("double_bed").unwrap());
                    people[..2].iter().all(|person| {
                        let pos = saved
                            .world
                            .entities
                            .iter()
                            .find(|row| row.index == *person)
                            .unwrap()
                            .position
                            .as_ref()
                            .unwrap();
                        let field = grid
                            .distance_field((pos.x.round() as i32, pos.y.round() as i32))
                            .unwrap();
                        let access = super::navigation::Access::new(
                            definition,
                            &terri_data::pack().sleep_tag,
                            Facing::SouthEast,
                            (x as i32, y as i32),
                            &field,
                        );
                        (0..2).all(|ordinal| {
                            access
                                .for_admission(Admission::Sleep {
                                    ordinal,
                                    preference: Preference::Unassigned,
                                })
                                .is_some()
                        })
                    })
                }
        })
        .unwrap();
    sim.world_mut()
        .resource_mut::<CommandQueue>()
        .push(SimCommand::PlaceObject {
            object: bed_index,
            x: position.0,
            y: position.1,
            facing: Facing::SouthEast,
        });
    sim.flush_commands();
    assert_eq!(
        (
            sim.world().get::<Position>(bed).unwrap().x,
            sim.world().get::<Position>(bed).unwrap().y
        ),
        (position.0 as f32, position.1 as f32)
    );
    assert_eq!(
        sim.world().resource::<BedAssignments>().assigned_to(person),
        assignment
    );
    for agent in &people[..2] {
        sim.world_mut()
            .resource_mut::<CommandQueue>()
            .push(SimCommand::UseObjectFirst {
                agent: *agent,
                object: bed_index,
                interaction: 0,
            });
    }
    sim.tick();
    let status = sim.bed_places_of(people[0]).unwrap();
    let bed_rows: Vec<_> = status.iter().filter(|row| row.bed == bed_index).collect();
    assert_eq!(bed_rows.len(), 2);
    assert_eq!(bed_rows[0].assignee, Some(people[0]));
    assert_eq!(
        bed_rows.iter().filter(|row| row.occupant.is_some()).count(),
        2
    );
    assert_eq!(
        validate_placement(sim.world(), bed_index, position, Facing::SouthEast).unwrap_err(),
        PlacementRefusal::InUse
    );
    assert_eq!(
        validate_sale(sim.world(), bed_index).unwrap_err(),
        PlacementRefusal::InUse
    );
    for agent in &people[..2] {
        sim.world_mut()
            .resource_mut::<CommandQueue>()
            .push(SimCommand::CancelIntents { agent: *agent });
    }
    sim.world_mut()
        .resource_mut::<CommandQueue>()
        .push(SimCommand::SellObject { object: bed_index });
    sim.flush_commands();
    assert!(sim.world().get_entity(bed).is_err());
    assert_eq!(
        sim.world().resource::<BedAssignments>().assigned_to(person),
        None
    );
    assert!(sim
        .bed_places_of(people[0])
        .unwrap()
        .iter()
        .all(|row| row.bed != bed_index));
}

/// The device's count limits standing viewers only: seated viewers do not use
/// it up, and a newcomer planned onto a free seat is admitted when it is full.
#[test]
fn viewer_admission_counts_only_standing_viewers() {
    let mut world = World::new();
    let device = world.spawn_empty().id();
    let sofa = world.spawn_empty().id();
    let [first, second, seated, newcomer] = [(); 4].map(|_| world.spawn_empty().id());
    let watch = Target {
        object: device,
        interaction: 0,
    };
    let other_use = Target {
        object: device,
        interaction: 1,
    };
    let occupancy = |targets: Vec<(Entity, Target)>, seats: &[Entity]| {
        let mut view = Occupancy::new(
            targets
                .into_iter()
                .map(|(owner, target)| (owner, target, None)),
            std::iter::empty(),
        );
        for (ordinal, owner) in seats.iter().enumerate() {
            view.physical_seat_claim(*owner, sofa, ordinal as u16, false);
        }
        view
    };
    let full = occupancy(vec![(first, watch), (second, watch)], &[]);
    assert!(full.viewer_admissions(newcomer, watch, 2, false).is_empty());
    assert_eq!(
        full.viewer_admissions(newcomer, watch, 2, true),
        vec![Admission::Exclusive],
        "a free seat admits a viewer while the standing count is full"
    );
    let one_seated = occupancy(vec![(first, watch), (seated, watch)], &[seated]);
    assert_eq!(
        one_seated.viewer_admissions(newcomer, watch, 2, false),
        vec![Admission::Exclusive],
        "a seated viewer does not use up the standing count"
    );
    let mixed = occupancy(vec![(first, other_use)], &[]);
    assert!(
        mixed.viewer_admissions(newcomer, watch, 2, true).is_empty(),
        "a device in use for another action admits no viewer, seated or not"
    );
}
