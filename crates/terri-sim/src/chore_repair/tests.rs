use super::*;
use crate::Sim;
use terri_core::{NeedId, Needs, Personality, Position, Relationships, SimRng};

fn fixture() -> (Sim, [Entity; 3], ChoreObligation) {
    let mut sim = Sim::new_with_lot(16, 8);
    let pack = sim.world().resource::<crate::Content>().0;
    let mut create = |name: &str, x: f32| {
        let e = crate::household::spawn_member(
            sim.world_mut(),
            &pack.personalities,
            &pack.traits,
            crate::household::Member {
                name: name.into(),
                personality: 0,
                position: Position { x, y: 1. },
                needs: [100.; 7],
                hobbies: vec![],
                traits: &[],
                career: None,
                instinct: Some(50),
            },
        );
        sim.world_mut().get_mut::<Personality>(e).unwrap().drain = [0.; 7];
        e
    };
    let people = [
        create("Initiator", 1.),
        create("Worker", 7.),
        create("Witness", 2.),
    ];
    crate::chores::ensure(sim.world_mut());
    let key = ChoreKey {
        kind: ChoreKind::Floors,
        target: crate::rooms::cleaning_area_at(sim.world(), (7, 1))
            .unwrap()
            .key(),
    };
    let owner = sim.world().get::<SimId>(people[1]).unwrap().0;
    let profiles = people
        .iter()
        .map(|e| ChoreProfile::neutral(sim.world().get::<SimId>(*e).unwrap().0))
        .collect();
    {
        let mut chores = sim.world_mut().resource_mut::<SavedChores>();
        chores.board_enabled = false;
        chores.assignments = vec![ChoreAssignment {
            key,
            owner,
            week: 0,
        }];
        chores.week = Some(0);
        chores.episodes.clear();
        chores.floors = vec![(23, 1000)];
        chores.rng = Some(SimRng::from_seed(0));
        chores.profiles = profiles;
    }
    sim.world_mut()
        .init_resource::<terri_core::save::SavedDomestic>();
    let clean: Vec<_> = people.iter().map(|e| (e.index_u32(), 0.5)).collect();
    sim.world_mut()
        .resource_mut::<terri_core::save::SavedDomestic>()
        .cleanliness = clean;
    sim.world_mut().resource_mut::<SimClock>().tick = 2000;
    crate::neglect::refresh(sim.world_mut());
    let scope = obligation(sim.world(), key, SimId(owner)).unwrap();
    (sim, people, scope)
}

fn remember_witness(sim: &mut Sim, people: [Entity; 3], scope: ChoreObligation) {
    let affected = *sim.world().get::<SimId>(people[2]).unwrap();
    crate::social_conflicts::remember(
        sim.world_mut(),
        affected,
        SimId(scope.owner),
        GrievanceKind::Chore,
        GrievanceSubject::Chore(scope),
        0.02,
    );
}

fn window(sim: &mut Sim, people: [Entity; 3], scope: ChoreObligation, accepted: bool) {
    let initiator = sim.world().get::<SimId>(people[0]).unwrap().0;
    let witness = sim.world().get::<SimId>(people[2]).unwrap().0;
    sim.world_mut()
        .resource_mut::<crate::social_conflicts::State>()
        .repairs
        .insert(
            (scope.owner, 2000, initiator),
            SavedChoreRepair {
                recipient: scope.owner,
                initiator,
                obligation: scope,
                fought_at: 2000,
                deadline: 2240,
                accepted,
                attempted: false,
                working: false,
                contributed_units: 0,
                witnesses: vec![initiator, witness],
            },
        );
}

#[test]
fn neutral_response_is_eighty_percent_and_each_factor_has_its_own_effect() {
    let tuning = &terri_data::pack().tuning;
    let neutral = ChoreProfile::neutral(0);
    let base = response_chance(tuning, 0.5, &neutral, ChoreKind::Floors, 0., 0.);
    assert!((base - 0.8).abs() < 0.000001);
    assert!(response_chance(tuning, 1., &neutral, ChoreKind::Floors, 0., 0.) > base);
    assert!(response_chance(tuning, 0., &neutral, ChoreKind::Floors, 0., 0.) < base);
    for profile in [
        ChoreProfile {
            responsibility: 100,
            ..neutral.clone()
        },
        ChoreProfile {
            commitment: 100,
            ..neutral.clone()
        },
        ChoreProfile {
            preferences: [0, 100, 0, 0],
            ..neutral.clone()
        },
    ] {
        assert!(response_chance(tuning, 0.5, &profile, ChoreKind::Floors, 0., 0.) > base);
    }
    assert!(response_chance(tuning, 0.5, &neutral, ChoreKind::Floors, 1., 0.) > base);
    assert!(response_chance(tuning, 0.5, &neutral, ChoreKind::Floors, 0., 1.) > base);
    assert!(response_chance(tuning, 0.5, &neutral, ChoreKind::Floors, -1., -1.) < base);
}

#[test]
fn acceptance_is_one_saved_chore_draw_and_repeated_completion_cannot_reroll() {
    let (mut sim, people, scope) = fixture();
    remember_witness(&mut sim, people, scope);
    let initiator = *sim.world().get::<SimId>(people[0]).unwrap();
    let mut expected = sim.world().resource::<SavedChores>().rng.clone().unwrap();
    expected.next_f32();
    fight_completed(sim.world_mut(), initiator, SimId(scope.owner), scope);
    assert_eq!(
        sim.world().resource::<SavedChores>().rng.as_ref(),
        Some(&expected)
    );
    assert_eq!(
        sim.world()
            .resource::<crate::social_conflicts::State>()
            .repairs
            .len(),
        1
    );
    fight_completed(sim.world_mut(), initiator, SimId(scope.owner), scope);
    assert_eq!(
        sim.world().resource::<SavedChores>().rng.as_ref(),
        Some(&expected)
    );
}

#[test]
fn accepted_response_waits_for_player_orders_and_critical_needs_then_starts_ordinary_work() {
    let (mut sim, people, scope) = fixture();
    window(&mut sim, people, scope, true);
    sim.world_mut()
        .get_mut::<Needs>(people[1])
        .unwrap()
        .set(NeedId::Hunger, 0.);
    tick(sim.world_mut());
    assert!(sim.world().resource::<SavedChores>().tasks.is_empty());
    assert!(
        !sim.world()
            .resource::<crate::social_conflicts::State>()
            .repairs
            .values()
            .next()
            .unwrap()
            .attempted
    );
    sim.world_mut()
        .get_mut::<Needs>(people[1])
        .unwrap()
        .set(NeedId::Hunger, 100.);
    tick(sim.world_mut());
    let task = &sim.world().resource::<SavedChores>().tasks[0];
    assert_eq!(task.person, people[1].index_u32());
    assert!(!task.directed);
    assert!(
        sim.world()
            .resource::<crate::social_conflicts::State>()
            .repairs
            .values()
            .next()
            .unwrap()
            .working
    );
}

#[test]
fn actual_recipient_completion_rewards_prior_witness_and_both_fighters_once() {
    let (mut sim, people, scope) = fixture();
    window(&mut sim, people, scope, true);
    tick(sim.world_mut());
    let mut chores = sim.world_mut().remove_resource::<SavedChores>().unwrap();
    chores.floors.clear();
    completed_in(
        sim.world_mut(),
        &chores,
        people[1].index_u32(),
        scope.key,
        1000,
    );
    let effects = sim.relationship_effects().len();
    assert_eq!(
        effects, 3,
        "two observers and the worker's reciprocal repair"
    );
    assert!(sim
        .relationship_effects()
        .iter()
        .all(|effect| effect.requested >= 0.08));
    completed_in(
        sim.world_mut(),
        &chores,
        people[1].index_u32(),
        scope.key,
        1000,
    );
    assert_eq!(sim.relationship_effects().len(), effects);
    assert!(sim
        .world()
        .resource::<crate::social_conflicts::State>()
        .repairs
        .is_empty());
    sim.world_mut().insert_resource(chores);
}

#[test]
fn helper_or_canceled_work_cannot_pay_the_recipient_repair() {
    let (mut sim, people, scope) = fixture();
    window(&mut sim, people, scope, true);
    tick(sim.world_mut());
    let mut chores = sim.world_mut().remove_resource::<SavedChores>().unwrap();
    chores.floors.clear();
    completed_in(
        sim.world_mut(),
        &chores,
        people[2].index_u32(),
        scope.key,
        1000,
    );
    completed_in(
        sim.world_mut(),
        &chores,
        people[1].index_u32(),
        scope.key,
        0,
    );
    assert!(sim.relationship_effects().is_empty());
    canceled(sim.world_mut(), people[1]);
    chores.tasks.clear();
    sim.world_mut().insert_resource(chores);
    crate::neglect::refresh(sim.world_mut());
    tick(sim.world_mut());
    assert!(sim
        .world()
        .resource::<crate::social_conflicts::State>()
        .repairs
        .is_empty());
}

#[test]
fn gradual_cleaning_retains_identity_but_reassignment_and_new_dirt_do_not() {
    let (mut sim, people, scope) = fixture();
    window(&mut sim, people, scope, true);
    tick(sim.world_mut());
    sim.world_mut().resource_mut::<SavedChores>().floors[0].1 = 1;
    crate::neglect::refresh(sim.world_mut());
    assert!(obligation(sim.world(), scope.key, SimId(scope.owner)).is_none());
    tick(sim.world_mut());
    assert_eq!(
        sim.world()
            .resource::<crate::social_conflicts::State>()
            .repairs
            .len(),
        1
    );
    let snapshot = sim.save_snapshot_v20();
    let mut restored = Sim::new_with_lot(16, 8);
    restored.load_snapshot_v20(snapshot.clone()).unwrap();
    assert_eq!(snapshot, restored.save_snapshot_v20());
    canceled(sim.world_mut(), people[1]);
    sim.world_mut().resource_mut::<SavedChores>().tasks.clear();
    sim.world_mut().resource_mut::<SavedChores>().floors[0].1 = 1000;
    sim.world_mut().resource_mut::<SimClock>().tick += 1;
    crate::neglect::refresh(sim.world_mut());
    tick(sim.world_mut());
    assert!(sim
        .world()
        .resource::<crate::social_conflicts::State>()
        .repairs
        .is_empty());
}

#[test]
fn deadline_is_elapsed_game_time_and_a_late_completion_has_no_bonus() {
    let (mut sim, people, scope) = fixture();
    window(&mut sim, people, scope, false);
    sim.world_mut().resource_mut::<SimClock>().tick = 2241;
    let mut chores = sim.world_mut().remove_resource::<SavedChores>().unwrap();
    chores.floors.clear();
    completed_in(
        sim.world_mut(),
        &chores,
        people[1].index_u32(),
        scope.key,
        1000,
    );
    assert!(sim.relationship_effects().is_empty());
    sim.world_mut().insert_resource(chores);
    tick(sim.world_mut());
    assert!(sim
        .world()
        .resource::<crate::social_conflicts::State>()
        .repairs
        .is_empty());
}

#[test]
fn repair_uses_family_scaling_once_and_later_witnesses_are_included() {
    let (mut sim, people, scope) = fixture();
    let initiator = sim.world().get::<SimId>(people[0]).unwrap().0;
    sim.world_mut()
        .init_resource::<terri_core::layout::FamilyTies>();
    sim.world_mut()
        .resource_mut::<terri_core::layout::FamilyTies>()
        .set(
            initiator,
            scope.owner,
            Some(terri_core::layout::Relation::Partner),
        );
    window(&mut sim, people, scope, true);
    sim.world_mut()
        .resource_mut::<crate::social_conflicts::State>()
        .repairs
        .values_mut()
        .next()
        .unwrap()
        .witnesses = vec![initiator];
    remember_witness(&mut sim, people, scope);
    tick(sim.world_mut());
    let mut chores = sim.world_mut().remove_resource::<SavedChores>().unwrap();
    chores.floors.clear();
    completed_in(
        sim.world_mut(),
        &chores,
        people[1].index_u32(),
        scope.key,
        1000,
    );
    let gains: Vec<_> = sim
        .relationship_effects()
        .iter()
        .map(|e| e.requested)
        .collect();
    assert_eq!(gains.len(), 3);
    assert_eq!(
        gains
            .iter()
            .filter(|gain| (**gain - 0.15).abs() < 0.00001)
            .count(),
        2
    );
    assert_eq!(
        gains
            .iter()
            .filter(|gain| (**gain - 0.10).abs() < 0.00001)
            .count(),
        1
    );
    sim.world_mut().insert_resource(chores);
    assert!(
        sim.world()
            .get::<Relationships>(people[2])
            .unwrap()
            .feeling(SimId(scope.owner))
            > 0.
    );
}

fn dish_fixture() -> (Sim, [Entity; 3], ChoreObligation, Entity) {
    let (mut sim, people, _) = fixture();
    let pack = sim.world().resource::<crate::Content>().0;
    let counter = sim
        .world_mut()
        .spawn((
            terri_core::SmartObject(pack.find("counter").unwrap()),
            Position { x: 11., y: 1. },
        ))
        .id();
    let sink = sim
        .world_mut()
        .spawn((
            terri_core::SmartObject(pack.find("kitchen_sink").unwrap()),
            Position { x: 13., y: 1. },
        ))
        .id();
    let owner = sim.world().get::<SimId>(people[1]).unwrap().0;
    let key = ChoreKey {
        kind: ChoreKind::Dishes,
        target: 0,
    };
    {
        let mut chores = sim.world_mut().resource_mut::<SavedChores>();
        chores.floors.clear();
        chores.assignments = vec![ChoreAssignment {
            key,
            owner,
            week: 0,
        }];
    }
    {
        let mut domestic = sim
            .world_mut()
            .resource_mut::<terri_core::save::SavedDomestic>();
        domestic.next_dish = 2;
        domestic.dishes = vec![
            terri_core::save::SavedDishes {
                id: 0,
                surface: counter.index_u32(),
                owner,
                units: 1,
            },
            terri_core::save::SavedDishes {
                id: 1,
                surface: counter.index_u32(),
                owner,
                units: 6,
            },
        ];
    }
    crate::neglect::refresh(sim.world_mut());
    let scope = obligation(sim.world(), key, SimId(owner)).unwrap();
    (sim, people, scope, sink)
}

fn finish_washing(sim: &mut Sim, person: Entity, sink: Entity, dishes: Vec<u32>) {
    let key = ChoreKey {
        kind: ChoreKind::Dishes,
        target: 0,
    };
    sim.world_mut()
        .resource_mut::<terri_core::save::SavedDomestic>()
        .cleanup
        .push(terri_core::save::SavedCleanup {
            person: person.index_u32(),
            collected: dishes.clone(),
            dishes,
            directed: false,
        });
    sim.world_mut()
        .resource_mut::<terri_core::save::SavedDomestic>()
        .cleanup
        .sort_by_key(|row| row.person);
    started(sim.world_mut(), person, key);
    let chain = sim
        .world()
        .resource::<crate::Content>()
        .0
        .chains
        .iter()
        .position(|chain| chain.id == crate::domestic::CLEANUP)
        .unwrap() as u32;
    crate::domestic::completed(sim.world_mut(), person, chain, 1, Some(sink), None);
}

#[test]
fn board_free_real_washing_repairs_a_declined_fight_and_preserves_later_witnesses() {
    let (mut sim, people, scope, sink) = dish_fixture();
    window(&mut sim, people, scope, false);
    let initiator = sim.world().get::<SimId>(people[0]).unwrap().0;
    sim.world_mut()
        .resource_mut::<crate::social_conflicts::State>()
        .repairs
        .values_mut()
        .next()
        .unwrap()
        .witnesses = vec![initiator];
    remember_witness(&mut sim, people, scope);
    finish_washing(&mut sim, people[1], sink, vec![0, 1]);
    assert!(sim
        .world()
        .resource::<terri_core::save::SavedDomestic>()
        .dishes
        .is_empty());
    let repairs: Vec<_> = sim
        .relationship_effects()
        .iter()
        .filter(|effect| effect.requested >= 0.08)
        .collect();
    assert_eq!(
        repairs.len(),
        3,
        "both fighters and the newly annoyed witness reconcile after physical washing"
    );
    assert!(sim
        .world()
        .resource::<crate::social_conflicts::State>()
        .repairs
        .is_empty());
    assert!(sim
        .world()
        .resource::<crate::social_conflicts::State>()
        .dish_contributions
        .is_empty());
}

#[test]
fn old_board_contributions_cannot_award_a_fresh_load_to_the_wrong_washer() {
    let (mut sim, people, scope, sink) = dish_fixture();
    window(&mut sim, people, scope, false);
    {
        let mut chores = sim.world_mut().resource_mut::<SavedChores>();
        chores.episodes = vec![ChoreEpisode {
            id: 0,
            key: scope.key,
            owner: scope.owner,
            day: 1,
            decision: Some(true),
            outcome: DutyOutcome::Done,
            performer: Some(scope.owner),
            completed_at: Some(1900),
            settled: true,
            needed: true,
            unavailable: false,
        }];
        chores.next_episode = 1;
        chores.dish_contributions = vec![(0, scope.owner, 1000)];
    }
    finish_washing(&mut sim, people[1], sink, vec![0]);
    assert_eq!(
        sim.world()
            .resource::<crate::social_conflicts::State>()
            .repairs
            .values()
            .next()
            .unwrap()
            .contributed_units,
        1
    );
    finish_washing(&mut sim, people[2], sink, vec![1]);
    assert!(
        sim.relationship_effects()
            .iter()
            .all(|effect| effect.requested < 0.08),
        "one current unit cannot beat the helper's six because of old board totals"
    );
    assert!(sim
        .world()
        .resource::<crate::social_conflicts::State>()
        .dish_contributions
        .is_empty());
}

#[test]
fn declined_then_natural_work_survives_current_save() {
    let (mut sim, people, scope) = fixture();
    window(&mut sim, people, scope, false);
    let mut chores = sim.world_mut().remove_resource::<SavedChores>().unwrap();
    assert!(crate::chores::start_response(
        sim.world_mut(),
        &mut chores,
        people[1],
        scope.key,
        false
    ));
    sim.world_mut().insert_resource(chores);
    let row = sim
        .world()
        .resource::<crate::social_conflicts::State>()
        .repairs
        .values()
        .next()
        .unwrap();
    assert!(!row.accepted && row.working && row.attempted);
    let saved = sim.save_snapshot_v20();
    let hash = sim.world_hash();
    let mut loaded = Sim::new_with_lot(16, 8);
    loaded.load_snapshot_v20(saved.clone()).unwrap();
    assert_eq!(saved, loaded.save_snapshot_v20());
    assert_eq!(hash, loaded.world_hash());
}

#[test]
fn player_orders_and_work_hold_an_accepted_response_without_spending_its_attempt() {
    let (mut sim, people, scope) = fixture();
    window(&mut sim, people, scope, true);
    sim.world_mut()
        .resource_mut::<terri_core::CommandQueue>()
        .push(terri_core::SimCommand::TalkTo {
            agent: people[1].index_u32(),
            target: people[0].index_u32(),
            interaction: 0,
        });
    sim.flush_commands();
    tick(sim.world_mut());
    assert!(sim.world().resource::<SavedChores>().tasks.is_empty());
    assert!(
        !sim.world()
            .resource::<crate::social_conflicts::State>()
            .repairs
            .values()
            .next()
            .unwrap()
            .attempted
    );
    sim.world_mut()
        .resource_mut::<terri_core::CommandQueue>()
        .push(terri_core::SimCommand::CancelIntents {
            agent: people[1].index_u32(),
        });
    sim.flush_commands();
    sim.world_mut()
        .entity_mut(people[1])
        .insert(terri_core::AtWork {
            remaining_ticks: 100,
        });
    tick(sim.world_mut());
    assert!(sim.world().resource::<SavedChores>().tasks.is_empty());
    assert!(
        !sim.world()
            .resource::<crate::social_conflicts::State>()
            .repairs
            .values()
            .next()
            .unwrap()
            .attempted
    );
    sim.world_mut()
        .entity_mut(people[1])
        .remove::<terri_core::AtWork>();
    tick(sim.world_mut());
    assert!(!sim.world().resource::<SavedChores>().tasks.is_empty());
}

#[test]
fn multiple_valid_windows_pay_each_observer_once_at_the_exact_deadline() {
    let (mut sim, people, scope) = fixture();
    window(&mut sim, people, scope, true);
    let other = sim.world().get::<SimId>(people[2]).unwrap().0;
    let original = sim
        .world()
        .resource::<crate::social_conflicts::State>()
        .repairs
        .values()
        .next()
        .unwrap()
        .clone();
    let second = SavedChoreRepair {
        initiator: other,
        ..original
    };
    sim.world_mut()
        .resource_mut::<crate::social_conflicts::State>()
        .repairs
        .insert((scope.owner, 2000, other), second);
    tick(sim.world_mut());
    sim.world_mut().resource_mut::<SimClock>().tick = 2240;
    let mut chores = sim.world_mut().remove_resource::<SavedChores>().unwrap();
    chores.floors.clear();
    completed_in(
        sim.world_mut(),
        &chores,
        people[1].index_u32(),
        scope.key,
        1000,
    );
    assert_eq!(
        sim.relationship_effects().len(),
        4,
        "two unique observers plus one reciprocal effect per initiator"
    );
    assert!(sim
        .world()
        .resource::<crate::social_conflicts::State>()
        .repairs
        .is_empty());
    sim.world_mut().insert_resource(chores);
}

#[test]
fn late_recipient_can_finish_original_dishes_below_tolerance_after_partial_reload() {
    let (mut sim, people, scope, sink) = dish_fixture();
    sim.world_mut()
        .resource_mut::<terri_core::save::SavedDomestic>()
        .dishes[1]
        .units = 2;
    {
        let mut domestic = sim
            .world_mut()
            .resource_mut::<terri_core::save::SavedDomestic>();
        domestic
            .cleanliness
            .iter_mut()
            .find(|row| row.0 == people[1].index_u32())
            .unwrap()
            .1 = 0.;
    }
    window(&mut sim, people, scope, false);
    finish_washing(&mut sim, people[2], sink, vec![0]);
    crate::neglect::refresh(sim.world_mut());
    reconcile(sim.world_mut());
    assert!(obligation(sim.world(), scope.key, SimId(scope.owner)).is_none());
    assert_eq!(
        sim.world()
            .resource::<crate::social_conflicts::State>()
            .repairs
            .len(),
        1
    );
    let saved = sim.save_snapshot_v20();
    let mut loaded = Sim::new_with_lot(16, 8);
    loaded.load_snapshot_v20(saved.clone()).unwrap();
    assert_eq!(saved, loaded.save_snapshot_v20());
    finish_washing(&mut loaded, people[1], sink, vec![1]);
    assert_eq!(
        loaded
            .relationship_effects()
            .iter()
            .filter(|effect| effect.requested >= 0.08)
            .count(),
        3
    );
    assert!(loaded
        .world()
        .resource::<crate::social_conflicts::State>()
        .repairs
        .is_empty());
}

#[test]
fn maximum_authored_response_window_writes_a_loadable_current_save() {
    let (mut sim, people, scope) = fixture();
    let mut pack = sim.world().resource::<crate::Content>().0.clone();
    pack.tuning.chore_fight_response_ticks = 100800;
    let pack = Box::leak(Box::new(pack));
    sim.world_mut().insert_resource(crate::Content(pack));
    let initiator = *sim.world().get::<SimId>(people[0]).unwrap();
    fight_completed(sim.world_mut(), initiator, SimId(scope.owner), scope);
    let saved = sim.save_snapshot_v20();
    let mut loaded = Sim::new_with_lot(16, 8);
    loaded.world_mut().insert_resource(crate::Content(pack));
    loaded.load_snapshot_v20(saved.clone()).unwrap();
    assert_eq!(saved, loaded.save_snapshot_v20());
}

#[test]
fn work_before_the_argument_cannot_pay_for_a_recipient_who_does_nothing_afterward() {
    let (mut sim, people, scope, sink) = dish_fixture();
    sim.world_mut()
        .resource_mut::<terri_core::save::SavedDomestic>()
        .dishes[0]
        .units = 4;
    finish_washing(&mut sim, people[1], sink, vec![1]);
    crate::neglect::refresh(sim.world_mut());
    assert!(still_unfinished(sim.world(), scope));
    crate::relationship_effects::reset(sim.world_mut());
    window(&mut sim, people, scope, false);
    finish_washing(&mut sim, people[2], sink, vec![0]);
    assert!(sim
        .relationship_effects()
        .iter()
        .all(|effect| effect.requested < 0.08));
    assert!(sim
        .world()
        .resource::<crate::social_conflicts::State>()
        .dish_contributions
        .is_empty());
}

#[test]
fn published_partial_washing_keeps_a_loadable_current_envelope_without_new_receipts() {
    for published in [true, false] {
        let (mut sim, people, _, sink) = dish_fixture();
        let mut pack = sim.world().resource::<crate::Content>().0.clone();
        pack.tuning.fight_rules = if published {
            terri_data::FightRules::Published
        } else {
            terri_data::FightRules::Attributed
        };
        let pack = Box::leak(Box::new(pack));
        sim.world_mut().insert_resource(crate::Content(pack));
        finish_washing(&mut sim, people[1], sink, vec![1]);
        assert_eq!(
            sim.world()
                .resource::<terri_core::save::SavedDomestic>()
                .dishes
                .len(),
            1
        );
        let saved = sim.save_snapshot_v20();
        assert_eq!(
            saved.conflicts.dish_contributions.is_empty(),
            published,
            "published partial work retains no new receipt; current work retains its actual units"
        );
        let mut loaded = Sim::new_with_lot(16, 8);
        loaded.world_mut().insert_resource(crate::Content(pack));
        loaded.load_snapshot_v20(saved.clone()).unwrap();
        assert_eq!(saved, loaded.save_snapshot_v20());
        assert_eq!(sim.world_hash(), loaded.world_hash());
    }
}
