use super::*;
use bevy_ecs::system::RunSystemOnce;
use terri_core::{Career, Commuting, Eating, Path, SimClock};

fn sleeping_pair() -> (Sim, Entity, [Entity; 2]) {
    let (mut sim, bed, [first, second, third]) = fixture();
    sim.world_mut().despawn(third);
    for person in [first, second] {
        order(&mut sim, person, bed, 0);
    }
    sim.world_mut()
        .run_system_once(crate::systems::action::serve_intents)
        .unwrap();
    for (person, y) in [(first, 6.0), (second, 8.0)] {
        sim.world_mut().entity_mut(person).insert((
            Position { x: 7.0, y },
            Path {
                steps: Vec::new(),
                cursor: 0,
            },
        ));
    }
    // Enter sleep through normal arrival, with both people at valid contact tiles.
    crate::systems::interpersonal::prepare(sim.world_mut());
    sim.world_mut()
        .run_system_once(crate::systems::movement::follow_path)
        .unwrap();
    for person in [first, second] {
        assert!(sim.world().get::<Eating>(person).is_some());
        assert!(sim.world().get::<Path>(person).is_none());
    }
    (sim, bed, [first, second])
}

#[test]
fn staggered_and_simultaneous_completions_release_only_active_use() {
    for second_duration in [1, 3] {
        let (mut sim, bed, [first, second]) = sleeping_pair();
        for (person, ordinal, remaining_ticks) in [(first, 0, 1), (second, 1, second_duration)] {
            sim.world_mut()
                .get_mut::<Eating>(person)
                .unwrap()
                .remaining_ticks = remaining_ticks;
            commit(
                sim.world_mut(),
                person.index_u32(),
                Some((bed.index_u32(), ordinal)),
            );
        }
        let assignments = sim.world().resource::<BedAssignments>().clone();
        assert_eq!(assignments.iter().count(), 2);
        let partner_target = *sim.world().get::<Target>(second).unwrap();
        let partner_action = *sim.world().get::<Eating>(second).unwrap();
        for elapsed in 1..=second_duration {
            sim.world_mut()
                .run_system_once(crate::systems::interact::tick_interactions)
                .unwrap();
            assert!(sim.world().get::<Target>(first).is_none());
            assert!(sim.world().get::<SleepPlace>(first).is_none());
            assert!(sim.world().get::<Eating>(first).is_none());
            let second_active = elapsed < second_duration;
            assert_eq!(sim.world().get::<Reserved>(bed).is_some(), second_active);
            assert_eq!(
                sim.world().get::<SleepPlace>(second),
                second_active.then_some(&SleepPlace(1))
            );
            assert_eq!(
                sim.world().get::<Target>(second),
                second_active.then_some(&partner_target)
            );
            let expected_action = Eating {
                remaining_ticks: second_duration - elapsed,
                ..partner_action
            };
            assert_eq!(
                sim.world().get::<Eating>(second),
                second_active.then_some(&expected_action)
            );
            assert_eq!(sim.world().resource::<BedAssignments>(), &assignments);
        }
        let status = sim.bed_places_of(first.index_u32()).unwrap();
        assert!(status
            .iter()
            .all(|place| place.occupant.is_none() && place.assignee.is_some()));
    }
}

#[test]
fn a_worker_leaving_a_shared_bed_preserves_the_other_sleep_and_both_assignments() {
    let (mut sim, bed, [worker, partner]) = sleeping_pair();
    let partner_action = *sim.world().get::<Eating>(partner).unwrap();
    let partner_target = *sim.world().get::<Target>(partner).unwrap();
    let mut pack = sim.world().resource::<crate::Content>().0.clone();
    pack.careers = vec![terri_data::pack().careers[0].clone()];
    pack.careers[0].shift_start = 0;
    pack.lot.front_door = Some((0, 0));
    pack.lot.house = (12, 12);
    pack.lot.width = 12;
    pack.lot.height = 12;
    sim.world_mut()
        .insert_resource(crate::Content(Box::leak(Box::new(pack))));
    sim.world_mut().resource_mut::<SimClock>().tick = 0;
    sim.world_mut().entity_mut(worker).insert(Career(0));
    for (person, ordinal) in [(worker, 0), (partner, 1)] {
        commit(
            sim.world_mut(),
            person.index_u32(),
            Some((bed.index_u32(), ordinal)),
        );
    }
    let assignments = sim.world().resource::<BedAssignments>().clone();
    assert_eq!(assignments.iter().count(), 2);
    sim.world_mut()
        .run_system_once(crate::systems::career::start_shift)
        .unwrap();
    assert!(sim.world().get::<Commuting>(worker).is_some());
    assert!(sim.world().get::<Path>(worker).is_some());
    assert!(sim.world().get::<Target>(worker).is_none());
    assert!(sim.world().get::<Eating>(worker).is_none());
    assert!(sim.world().get::<SleepPlace>(worker).is_none());
    assert_eq!(sim.world().get::<Target>(partner), Some(&partner_target));
    assert_eq!(sim.world().get::<Eating>(partner), Some(&partner_action));
    assert_eq!(sim.world().get::<SleepPlace>(partner), Some(&SleepPlace(1)));
    assert!(sim.world().get::<Reserved>(bed).is_some());
    assert_eq!(sim.world().resource::<BedAssignments>(), &assignments);
    // An outstanding bed order cannot reclaim the worker during the commute.
    sim.world_mut()
        .run_system_once(crate::systems::action::serve_intents)
        .unwrap();
    assert!(sim.world().get::<Target>(worker).is_none());
}

#[test]
fn vanished_bed_cleanup_releases_every_travelling_place() {
    let (mut sim, bed, people) = fixture();
    for person in people {
        order(&mut sim, person, bed, 0);
    }
    sim.world_mut()
        .run_system_once(crate::systems::action::serve_intents)
        .unwrap();
    assert!(sim.world().get::<Reserved>(bed).is_some());
    for (ordinal, person) in people[..2].iter().enumerate() {
        assert_eq!(
            sim.world().get::<Target>(*person),
            Some(&Target {
                object: bed,
                interaction: 0,
            })
        );
        assert_eq!(
            sim.world().get::<SleepPlace>(*person),
            Some(&SleepPlace(ordinal as u8))
        );
        assert!(sim.world().get::<Path>(*person).is_some());
    }
    // Simulate loss of the target definition at arrival; it is no longer furniture.
    sim.world_mut().entity_mut(bed).remove::<SmartObject>();
    for person in &people[..2] {
        sim.world_mut().entity_mut(*person).insert(Path {
            steps: Vec::new(),
            cursor: 0,
        });
    }
    crate::systems::interpersonal::prepare(sim.world_mut());
    sim.world_mut()
        .run_system_once(crate::systems::movement::follow_path)
        .unwrap();
    for person in &people[..2] {
        assert!(sim.world().get::<Path>(*person).is_none());
        assert!(sim.world().get::<Target>(*person).is_none());
        assert!(sim.world().get::<SleepPlace>(*person).is_none());
    }
    assert!(sim.world().get::<Reserved>(bed).is_none());
}

#[test]
fn autonomous_claims_share_two_places_and_the_third_waits_in_the_same_pass() {
    let (mut sim, bed, [first, second, third]) = fixture();
    let mut pack = sim.world().resource::<crate::Content>().0.clone();
    pack.objects[0].interactions.truncate(1);
    pack.tuning.idle_threshold = 0.0;
    pack.tuning.choice_temperature = 0.0001;
    pack.tuning.choice_exploration = 0.0;
    sim.world_mut()
        .insert_resource(crate::Content(Box::leak(Box::new(pack))));
    for person in [first, second, third] {
        let mut needs = Needs::all_at(70.0);
        needs.set(NeedId::Energy, 10.0);
        sim.world_mut().entity_mut(person).insert(needs);
    }
    sim.world_mut()
        .run_system_once(crate::systems::action::select_action)
        .unwrap();
    for (person, ordinal) in [(first, 0), (second, 1)] {
        assert_eq!(
            sim.world().get::<SleepPlace>(person),
            Some(&SleepPlace(ordinal))
        );
        assert_eq!(sim.world().get::<Target>(person).unwrap().object, bed);
    }
    assert!(sim.world().get::<Target>(third).is_none());
    assert!(sim.world().get::<SleepPlace>(third).is_none());
    assert!(sim.world().get::<Blocked>(third).is_some());
}
