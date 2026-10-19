use super::*;
use crate::Sim;
use terri_core::{Needs, Position, Relationships, SimIdAllocator, SmartObject};

fn household() -> (Sim, Entity, Entity) {
    let mut sim = Sim::new_with_lot(8, 6);
    let mut spawn = |x| {
        let id = sim.world_mut().resource_mut::<SimIdAllocator>().issue();
        sim.world_mut()
            .spawn((
                Agent,
                id,
                Needs::all_at(90.),
                Position { x, y: 1. },
                Relationships::default(),
            ))
            .id()
    };
    let a = spawn(1.);
    let b = spawn(2.);
    (sim, a, b)
}

fn record(sim: &mut Sim, a: Entity, b: Entity) -> u64 {
    let a = *sim.world().get::<SimId>(a).unwrap();
    let b = *sim.world().get::<SimId>(b).unwrap();
    remember(
        sim.world_mut(),
        a,
        b,
        GrievanceKind::PrivacyStart,
        GrievanceSubject::None,
        0.25,
    )
    .unwrap()
}

#[test]
fn issue314_continuous_nuisance_coalesces_without_renewing_a_consumed_argument() {
    let (mut sim, a, b) = household();
    let a = *sim.world().get::<SimId>(a).unwrap();
    let b = *sim.world().get::<SimId>(b).unwrap();
    let definition = sim
        .world()
        .resource::<crate::Content>()
        .0
        .find("fridge")
        .unwrap();
    let object = sim
        .world_mut()
        .spawn((SmartObject(definition), Position { x: 4., y: 3. }))
        .id()
        .index_u32();
    let subject = GrievanceSubject::Nuisance {
        object,
        kind: NuisanceKind::Other,
    };
    let first = remember(
        sim.world_mut(),
        a,
        b,
        GrievanceKind::Nuisance,
        subject,
        0.01,
    )
    .unwrap();
    sim.world_mut().resource_mut::<State>().fought(first, 0);
    sim.world_mut().resource_mut::<SimClock>().tick = 1;
    assert_eq!(
        remember(
            sim.world_mut(),
            a,
            b,
            GrievanceKind::Nuisance,
            subject,
            0.01
        ),
        Some(first)
    );
    assert_eq!(
        sim.world()
            .resource::<State>()
            .grievance(first)
            .unwrap()
            .last_fought,
        Some(0)
    );
    sim.world_mut().resource_mut::<SimClock>().tick = 3;
    let second = remember(
        sim.world_mut(),
        a,
        b,
        GrievanceKind::Nuisance,
        subject,
        0.01,
    )
    .unwrap();
    assert_ne!(
        first, second,
        "a genuinely separate episode can supply another cause"
    );
    assert_eq!(
        sim.world()
            .resource::<State>()
            .grievance(second)
            .unwrap()
            .last_fought,
        None
    );
}

#[test]
fn issue314_retention_is_bounded_deterministic_and_preserves_referenced_incidents() {
    let (mut sim, a, b) = household();
    let first = record(&mut sim, a, b);
    let initiator = crate::player_actions::saved_actor(sim.world(), a).unwrap();
    let recipient = crate::player_actions::saved_actor(sim.world(), b).unwrap();
    sim.world_mut().resource_mut::<State>().fights.insert(
        a,
        SavedFightContext {
            initiator,
            recipient,
            grievance: Some(first),
            autonomous: true,
            started_at: 0,
            topic_code: 27,
            topic_tag: "fight-privacy".into(),
            legacy: false,
            order_id: Some(0),
        },
    );
    for _ in 0..MAX_GRIEVANCES_PER_PERSON + 10 {
        record(&mut sim, a, b);
    }
    let saved = snapshot(sim.world());
    assert_eq!(saved.grievances.len(), MAX_GRIEVANCES_PER_PERSON);
    assert_eq!(saved.grievances[0].id, first);
    assert_eq!(
        saved.grievances[1].id, 13,
        "the oldest unreferenced rows leave first"
    );
    sim.world_mut().resource_mut::<SimClock>().tick = 10081;
    tick(sim.world_mut());
    assert_eq!(
        snapshot(sim.world())
            .grievances
            .iter()
            .map(|r| r.id)
            .collect::<Vec<_>>(),
        vec![first]
    );
    cancel(sim.world_mut(), a);
    tick(sim.world_mut());
    assert!(snapshot(sim.world()).grievances.is_empty());
}

#[test]
fn issue314_restore_rejects_corrupt_incidents_atomically_and_roundtrips_hashes() {
    let (mut sim, a, b) = household();
    record(&mut sim, a, b);
    let saved = snapshot(sim.world());
    let hash = sim.world_hash();
    restore(sim.world_mut(), saved.clone()).unwrap();
    assert_eq!(sim.world_hash(), hash);
    let cases: [fn(&mut SavedConflictState); 5] = [
        |s| s.grievances[0].severity = f32::NAN,
        |s| s.grievances[0].last_seen = 1,
        |s| s.grievances[0].affected = s.grievances[0].responsible,
        |s| s.next_id = s.grievances[0].id,
        |s| s.grievances.push(s.grievances[0].clone()),
    ];
    for corrupt in cases {
        let mut invalid = saved.clone();
        corrupt(&mut invalid);
        assert!(restore(sim.world_mut(), invalid).is_err());
        assert_eq!(snapshot(sim.world()), saved);
        assert_eq!(sim.world_hash(), hash);
    }
}

#[test]
fn issue314_unscoped_chore_history_is_player_relevant_without_autonomous_eligibility() {
    let (mut sim, a, b) = household();
    let a = *sim.world().get::<SimId>(a).unwrap();
    let b = *sim.world().get::<SimId>(b).unwrap();
    let id = remember(
        sim.world_mut(),
        a,
        b,
        GrievanceKind::Chore,
        GrievanceSubject::None,
        0.25,
    )
    .unwrap();
    let row = sim.world().resource::<State>().grievance(id).unwrap();
    assert_eq!(
        crate::fights::reason_for(row),
        crate::fights::Reason::OtherChore
    );
    assert!(!crate::fights::eligible(sim.world(), row, 0));
    assert_eq!(sim.world().resource::<State>().for_pair(a, b).count(), 1);
    let saved = snapshot(sim.world());
    restore(sim.world_mut(), saved).unwrap();
}

#[test]
fn issue314_saved_incident_expiry_survives_compatible_content_retuning() {
    let (mut sim, a, b) = household();
    record(&mut sim, a, b);
    let saved = snapshot(sim.world());
    let mut pack = sim.world().resource::<crate::Content>().0.clone();
    pack.tuning.fight_grievance_ticks = 720;
    pack.tuning.fight_history_ticks = 20160;
    sim.world_mut()
        .insert_resource(crate::Content(Box::leak(Box::new(pack))));
    restore(sim.world_mut(), saved.clone()).unwrap();
    assert_eq!(
        snapshot(sim.world()),
        saved,
        "a retained incident keeps its saved expiry"
    );
    let mut invalid = saved;
    invalid.grievances[0].forget_at = MAX_MEMORY_TICKS + 1;
    assert!(restore(sim.world_mut(), invalid).is_err());
}

#[test]
fn issue314_only_a_running_player_fight_preserves_a_removed_nuisance_source() {
    let (mut sim, a, b) = household();
    let a_id = *sim.world().get::<SimId>(a).unwrap();
    let b_id = *sim.world().get::<SimId>(b).unwrap();
    let definition = sim
        .world()
        .resource::<crate::Content>()
        .0
        .find("fridge")
        .unwrap();
    let object = sim
        .world_mut()
        .spawn((SmartObject(definition), Position { x: 4., y: 3. }))
        .id();
    let id = remember(
        sim.world_mut(),
        a_id,
        b_id,
        GrievanceKind::Nuisance,
        GrievanceSubject::Nuisance {
            object: object.index_u32(),
            kind: NuisanceKind::Other,
        },
        0.25,
    )
    .unwrap();
    let fight = crate::fights::fight_index(sim.world().resource::<crate::Content>().0).unwrap();
    sim.world_mut().entity_mut(a).insert(Socialising {
        partner: b,
        interaction: fight,
        remaining_ticks: 40,
    });
    let mut episodes = sim
        .world_mut()
        .resource_mut::<crate::social_episode::SocialEpisodes>();
    episodes.executions.insert(
        a,
        crate::social_episode::Execution {
            recipient: b,
            interaction: fight,
            owner: crate::social_episode::ExecutionOwner::Player(7),
            phase: crate::social_episode::ExecutionPhase::Running,
            admitted: true,
        },
    );
    episodes.topics.insert(
        a,
        crate::social_episode::Topic {
            code: 31,
            tag: "fight-nuisance".into(),
            initiator_preference: -1.,
            listener_preference: -1.,
        },
    );
    let context = SavedFightContext {
        initiator: SavedOrderActor::Sim(a_id.0),
        recipient: SavedOrderActor::Sim(b_id.0),
        grievance: Some(id),
        autonomous: false,
        started_at: 0,
        topic_code: 31,
        topic_tag: "fight-nuisance".into(),
        legacy: false,
        order_id: Some(7),
    };
    sim.world_mut()
        .resource_mut::<State>()
        .fights
        .insert(a, context);
    sim.world_mut().despawn(object);
    assert!(!crate::fights::eligible(
        sim.world(),
        sim.world().resource::<State>().grievance(id).unwrap(),
        0
    ));
    tick(sim.world_mut());
    let saved = snapshot(sim.world());
    assert_eq!(saved.grievances.len(), 1);
    restore(sim.world_mut(), saved).unwrap();
    cancel(sim.world_mut(), a);
    tick(sim.world_mut());
    assert!(snapshot(sim.world()).grievances.is_empty());
}

#[test]
fn issue314_dish_receipts_cross_validate_and_both_counters_affect_hashes() {
    let (mut sim, a, b) = household();
    let a = sim.world().get::<SimId>(a).unwrap().0;
    let b = sim.world().get::<SimId>(b).unwrap().0;
    let key = ChoreKey {
        kind: terri_core::chores::ChoreKind::Dishes,
        target: 0,
    };
    let scope = ChoreObligation {
        key,
        owner: b,
        actionable_since: 0,
    };
    sim.world_mut()
        .insert_resource(terri_core::chores::SavedChores {
            assignments: vec![terri_core::chores::ChoreAssignment {
                key,
                owner: b,
                week: 0,
            }],
            ..Default::default()
        });
    sim.world_mut()
        .insert_resource(terri_core::save_v19::SavedNeglect {
            duties: vec![terri_core::save_v19::DutyTimer {
                key,
                owner: b,
                actionable_since: 0,
                maximum_since: None,
            }],
            ..Default::default()
        });
    let mut saved = SavedConflictState::default();
    saved.repairs.push(SavedChoreRepair {
        recipient: b,
        initiator: a,
        obligation: scope,
        fought_at: 0,
        deadline: 240,
        accepted: false,
        attempted: true,
        working: false,
        witnesses: vec![a],
        contributed_units: 1,
    });
    saved.dish_contributions.push(SavedDishContribution {
        obligation: scope,
        person: b,
        units: 2,
    });
    restore(sim.world_mut(), saved.clone()).unwrap();
    let hash = sim.world_hash();
    let mut changed = saved.clone();
    changed.repairs[0].contributed_units = 2;
    restore(sim.world_mut(), changed).unwrap();
    assert_ne!(sim.world_hash(), hash);
    let mut changed = saved.clone();
    changed.dish_contributions[0].units = 3;
    restore(sim.world_mut(), changed).unwrap();
    assert_ne!(sim.world_hash(), hash);
    let mut missing = saved.clone();
    missing.dish_contributions.clear();
    assert!(restore(sim.world_mut(), missing).is_err());
    let mut exaggerated = saved.clone();
    exaggerated.repairs[0].contributed_units = 3;
    assert!(restore(sim.world_mut(), exaggerated).is_err());
    let mut zero = saved.clone();
    zero.dish_contributions[0].units = 0;
    assert!(restore(sim.world_mut(), zero).is_err());
    let mut duplicate = saved;
    duplicate
        .dish_contributions
        .push(duplicate.dish_contributions[0]);
    assert!(restore(sim.world_mut(), duplicate).is_err());
}
