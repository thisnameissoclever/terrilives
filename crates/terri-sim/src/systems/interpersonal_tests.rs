use crate::{Content, Sim};
use bevy_ecs::prelude::*;
use terri_core::layout::{EdgeAxis, SavedLayout, WallEdge};
use terri_core::{
    Agent, Eating, NeedId, Needs, Path, Position, Relationships, Reserved, Satisfaction, SimId,
    SimIdAllocator, Socialising, Target,
};

fn fixture() -> Sim {
    let mut sim = Sim::new_with_lot(6, 4);
    // Incident tests force the offending action; policy tests enable respect explicitly.
    let mut pack = sim.world().resource::<Content>().0.clone();
    pack.tuning.relationships.privacy_respect_chance = 0.0;
    sim.world_mut()
        .insert_resource(Content(Box::leak(Box::new(pack))));
    for y in [0, 2, 3] {
        sim.world_mut()
            .resource_mut::<terri_core::TileGrid>()
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
    sim
}

fn person(sim: &mut Sim, x: f32, y: f32) -> Entity {
    let id = sim.world_mut().resource_mut::<SimIdAllocator>().issue();
    sim.world_mut()
        .spawn((
            Agent,
            id,
            terri_core::SimName(format!("Person {}", id.0)),
            Position { x, y },
            Needs::all_at(100.0),
            Satisfaction::default(),
            terri_core::Shyness::new(50).unwrap(),
            terri_core::SelfPreservation(50),
        ))
        .id()
}

fn feeling(sim: &Sim, me: Entity, other: Entity) -> f32 {
    let id = *sim.world().get::<SimId>(other).unwrap();
    sim.world()
        .get::<Relationships>(me)
        .map_or(0.0, |r| r.feeling(id))
}

fn movement(sim: &mut Sim) {
    let mut schedule = Schedule::default();
    schedule.add_systems(
        (
            super::prepare,
            super::super::movement::follow_path,
            super::apply,
        )
            .chain(),
    );
    schedule.run(sim.world_mut());
}

fn deliberate(sim: &mut Sim) {
    let mut pack = sim.world().resource::<Content>().0.clone();
    pack.tuning.relationships.privacy_respect_chance = 1.0;
    pack.tuning.relationships.shyness_respect_strength = 0.0;
    sim.world_mut()
        .insert_resource(Content(Box::leak(Box::new(pack))));
}

#[test]
fn privacy_entry_waits_at_the_boundary_then_proceeds_when_the_room_clears() {
    let mut sim = fixture();
    deliberate(&mut sim);
    let a = person(&mut sim, 1.25, 1.0);
    let b = person(&mut sim, 3.0, 2.0);
    let toilet = object(&mut sim, "toilet");
    using(&mut sim, b, toilet);
    sim.world_mut().entity_mut(a).insert(Path {
        steps: vec![(2, 1)],
        cursor: 0,
    });
    movement(&mut sim);
    assert_eq!(sim.world().get::<Position>(a).unwrap().x, 1.25);
    assert_eq!(feeling(&sim, b, a), 0.0);
    let hash = sim.world_hash();
    let saved = sim.save_snapshot_v5();
    assert_eq!(saved.boundaries.len(), 1);
    let mut resumed = fixture();
    deliberate(&mut resumed);
    resumed.load_snapshot_v5(saved.clone()).unwrap();
    assert_eq!(resumed.world_hash(), hash);
    for _ in 0..4 {
        movement(&mut sim);
        movement(&mut resumed);
        assert_eq!(sim.world_hash(), resumed.world_hash());
    }
    for corrupt in [0, 1, 2] {
        let mut bad = saved.clone();
        match corrupt {
            0 => bad.boundaries[0].actor = 999,
            1 => bad.boundaries[0].expires = 9999,
            _ => bad.boundaries[0].waiting_since = Some(9999),
        }
        assert!(resumed.load_snapshot_v5(bad).is_err());
        assert_eq!(resumed.world_hash(), hash);
    }
    sim.world_mut().entity_mut(b).remove::<Eating>();
    movement(&mut sim);
    assert!(sim.world().get::<Position>(a).unwrap().x > 1.25);
}

#[test]
fn privacy_mid_wait_replay_crosses_cache_expiry_and_action_completion() {
    let mut sim = fixture();
    deliberate(&mut sim);
    let a = person(&mut sim, 1.25, 1.0);
    let b = person(&mut sim, 3.0, 2.0);
    let toilet = object(&mut sim, "toilet");
    using(&mut sim, b, toilet);
    enter(&mut sim, a);
    movement(&mut sim);
    let mut resumed = fixture();
    deliberate(&mut resumed);
    resumed.load_snapshot_v5(sim.save_snapshot_v5()).unwrap();
    for minute in 0..120 {
        sim.tick();
        resumed.tick();
        assert_eq!(sim.world_hash(), resumed.world_hash(), "minute {minute}");
    }
}

#[test]
fn privacy_commutes_can_take_a_required_route_and_exiting_is_always_allowed() {
    for commute in [false, true] {
        let mut sim = fixture();
        deliberate(&mut sim);
        let a = person(&mut sim, if commute { 1.25 } else { 1.75 }, 1.0);
        let b = person(&mut sim, 3.0, 2.0);
        let toilet = object(&mut sim, "toilet");
        using(&mut sim, b, toilet);
        sim.world_mut().entity_mut(a).insert(Path {
            steps: vec![(if commute { 2 } else { 1 }, 1)],
            cursor: 0,
        });
        if commute {
            sim.world_mut()
                .entity_mut(a)
                .insert(terri_core::Commuting::Outbound);
        }
        let mut schedule = Schedule::default();
        schedule.add_systems(
            (
                super::prepare,
                crate::privacy::route,
                super::super::movement::follow_path,
                super::apply,
            )
                .chain(),
        );
        schedule.run(sim.world_mut());
        let x = sim.world().get::<Position>(a).unwrap().x;
        assert!(if commute { x > 1.25 } else { x < 1.75 });
        assert_eq!(feeling(&sim, b, a), if commute { -0.25 } else { 0.0 });
    }
}

#[test]
fn privacy_player_chain_origin_survives_its_spent_order_and_save_load() {
    let mut sim = fixture();
    deliberate(&mut sim);
    let a = person(&mut sim, 1.25, 1.0);
    let b = person(&mut sim, 3.0, 2.0);
    let toilet = object(&mut sim, "toilet");
    using(&mut sim, b, toilet);
    let pack = sim.world().resource::<Content>().0;
    let fridge_def = pack.find("fridge").unwrap();
    let fridge = sim.spawn_object(Position { x: 4.0, y: 3.0 }, fridge_def);
    sim.world_mut()
        .entity_mut(a)
        .insert(terri_core::IntentQueue::from_intents(vec![
            terri_core::Intent {
                object: fridge,
                interaction: pack.object(fridge_def).interactions.len() as u32,
            },
        ]));
    let mut schedule = Schedule::default();
    schedule.add_systems(super::super::action::serve_intents);
    schedule.run(sim.world_mut());
    assert!(sim
        .world()
        .get::<terri_core::IntentQueue>(a)
        .unwrap()
        .is_empty());
    assert!(crate::privacy::directed(sim.world(), a));
    let saved = sim.save_snapshot_v5();
    let mut resumed = fixture();
    deliberate(&mut resumed);
    resumed.load_snapshot_v5(saved).unwrap();
    assert!(crate::privacy::directed(resumed.world(), a));
    assert_eq!(sim.world_hash(), resumed.world_hash());
    enter(&mut resumed, a);
    movement(&mut resumed);
    assert!(resumed.world().get::<Position>(a).unwrap().x > 1.25);
    assert!(resumed.relationship_effects().iter().any(|e| e.directed));
}

#[test]
fn privacy_start_waits_and_player_order_or_relevant_emergency_can_override() {
    for mode in ["wait", "critical", "desperate", "unrelated", "ordered"] {
        let mut sim = fixture();
        deliberate(&mut sim);
        let a = person(&mut sim, 3.0, 2.0);
        let b = person(&mut sim, 4.0, 2.0);
        let toilet = object(&mut sim, "toilet");
        start(&mut sim, a, toilet);
        if mode == "critical" || mode == "desperate" {
            sim.world_mut()
                .get_mut::<Needs>(a)
                .unwrap()
                .set(NeedId::Bladder, if mode == "critical" { 20.0 } else { 5.0 });
        }
        if mode == "unrelated" {
            sim.world_mut()
                .get_mut::<Needs>(a)
                .unwrap()
                .set(NeedId::Hunger, 0.0);
        }
        if mode == "ordered" {
            sim.world_mut()
                .entity_mut(a)
                .insert(terri_core::IntentQueue::from_intents(vec![
                    terri_core::Intent {
                        object: toilet,
                        interaction: 0,
                    },
                ]));
        }
        movement(&mut sim);
        if mode == "critical" {
            assert!(sim.world().get::<Eating>(a).is_none());
            sim.world_mut().resource_mut::<terri_core::SimClock>().tick = 10;
            movement(&mut sim);
        }
        let permitted = matches!(mode, "critical" | "desperate" | "ordered");
        assert_eq!(sim.world().get::<Eating>(a).is_some(), permitted, "{mode}");
        assert_eq!(
            feeling(&sim, b, a),
            if permitted { -0.25 } else { 0.0 },
            "{mode}"
        );
        if permitted {
            assert_eq!(sim.relationship_effects()[0].directed, mode == "ordered");
            assert_eq!(sim.relationship_effects()[0].emergency, mode != "ordered");
        }
    }
}

#[test]
fn privacy_route_switches_to_available_toilet_and_preserves_reservations() {
    let mut sim = fixture();
    deliberate(&mut sim);
    let a = person(&mut sim, 0.0, 1.0);
    let _b = person(&mut sim, 4.0, 2.0);
    sim.world_mut()
        .get_mut::<Needs>(a)
        .unwrap()
        .set(NeedId::Bladder, 10.0);
    let toilet = object(&mut sim, "toilet");
    start(&mut sim, a, toilet);
    let alternative = sim.spawn_object(
        Position { x: 0.0, y: 3.0 },
        sim.world().resource::<Content>().0.find("toilet").unwrap(),
    );
    super::prepare(sim.world_mut());
    crate::privacy::route(sim.world_mut());
    assert_eq!(sim.world().get::<Target>(a).unwrap().object, alternative);
    assert!(sim.world().get::<Reserved>(toilet).is_none());
    assert!(sim.world().get::<Reserved>(alternative).is_some());
    assert!(!sim.world().get::<Path>(a).unwrap().steps.is_empty());
}

#[test]
fn privacy_diagnostics_group_victims_and_report_clamped_loss_without_changing_hash() {
    let mut sim = fixture();
    let actor = person(&mut sim, 3.0, 2.0);
    let a = person(&mut sim, 4.0, 2.0);
    let b = person(&mut sim, 4.0, 3.0);
    let toilet = object(&mut sim, "toilet");
    let mut feelings = Relationships::default();
    feelings.bump(*sim.world().get::<SimId>(actor).unwrap(), -0.9);
    sim.world_mut().entity_mut(a).insert(feelings);
    super::prepare(sim.world_mut());
    sim.world_mut()
        .resource_mut::<super::InterpersonalPhase>()
        .private_start(actor, toilet, 0.25);
    super::apply(sim.world_mut());
    let events = sim.relationship_effects();
    assert_eq!(events.len(), 2, "one effect per observer");
    assert_eq!(events[0].event, events[1].event);
    assert_eq!(
        events[0].cause,
        crate::relationship_effects::RelationshipCause::PrivacyStart
    );
    assert_eq!(events[0].requested, -0.25);
    assert!((events[0].actual + 0.1).abs() < 0.000001);
    assert_eq!(events[1].affected, *sim.world().get::<SimId>(b).unwrap());
    let hash = sim.world_hash();
    sim.world_mut()
        .resource_mut::<crate::relationship_effects::RelationshipDiagnostics>()
        .effects
        .clear();
    assert_eq!(sim.world_hash(), hash);
}

#[test]
fn shyness_makes_boundary_avoidance_modest_and_directional() {
    let mut sim = fixture();
    let b = person(&mut sim, 3.0, 2.0);
    let a = person(&mut sim, 4.0, 2.0);
    let toilet = object(&mut sim, "toilet");
    sim.world_mut()
        .entity_mut(a)
        .insert(terri_core::Shyness::new(100).unwrap());
    sim.world_mut()
        .get_mut::<Needs>(b)
        .unwrap()
        .set(NeedId::Bladder, 20.0);
    super::prepare(sim.world_mut());
    let phase = sim.world().resource::<super::InterpersonalPhase>();
    let tags = vec![super::PRIVATE_USE_TAG.to_string()];
    assert!((phase.object_cost(a, toilet, &tags) - 0.015).abs() < 0.000001);
    assert_eq!(phase.object_cost(a, toilet, &[]), 0.0);
    assert!(
        (phase.social_cost(a, b, 0, sim.world().resource::<Content>().0) - 0.015).abs() < 0.000001
    );
    sim.world_mut()
        .get_mut::<Needs>(b)
        .unwrap()
        .set(NeedId::Bladder, 100.0);
    super::prepare(sim.world_mut());
    assert_eq!(
        sim.world()
            .resource::<super::InterpersonalPhase>()
            .social_cost(a, b, 0, sim.world().resource::<Content>().0),
        0.0
    );
    using(&mut sim, b, toilet);
    *sim.world_mut().get_mut::<Position>(a).unwrap() = Position { x: 1.25, y: 1.0 };
    super::prepare(sim.world_mut());
    let phase = sim.world().resource::<super::InterpersonalPhase>();
    assert!(phase.path_intrudes(a, &[(2, 1)]));
    assert!(!phase.path_intrudes(a, &[(1, 2)]));
    assert!((phase.object_cost(a, toilet, &[]) - 0.015).abs() < 0.000001);
}

#[test]
fn shyness_overrides_survive_save_hash_and_invalid_values_are_rejected_atomically() {
    let mut sim = fixture();
    let a = person(&mut sim, 0.0, 0.0);
    sim.world_mut()
        .entity_mut(a)
        .insert(terri_core::Shyness::new(100).unwrap());
    let snapshot = sim.save_snapshot_v5();
    assert_eq!(snapshot.shyness, vec![(0, 100)]);
    let hash = sim.world_hash();
    sim.load_snapshot_v5(snapshot.clone()).unwrap();
    assert_eq!(sim.shyness_of(a.index_u32()), Some(100));
    assert_eq!(sim.world_hash(), hash);
    for values in [
        vec![(0, 0)],
        vec![(0, 101)],
        vec![(0, 50), (0, 70)],
        vec![(90, 50)],
    ] {
        let mut bad = snapshot.clone();
        bad.shyness = values;
        assert!(sim.load_snapshot_v5(bad).is_err());
        assert_eq!(sim.world_hash(), hash);
    }
    let mut old = snapshot;
    old.shyness.clear();
    sim.load_snapshot_v5(old).unwrap();
    assert_eq!(
        sim.shyness_of(a.index_u32()),
        Some(terri_core::Shyness::initial(SimId(0)).value())
    );
    assert_ne!(sim.world_hash(), hash);
}

#[test]
fn shyness_autonomous_choice_prefers_privacy_but_player_orders_still_win() {
    let mut sim = fixture();
    let mut pack = sim.world().resource::<Content>().0.clone();
    pack.tuning.choice_temperature = 0.00001;
    sim.world_mut()
        .insert_resource(Content(Box::leak(Box::new(pack))));
    let a = person(&mut sim, 1.0, 1.0);
    let observer = person(&mut sim, 3.0, 3.0);
    sim.world_mut().entity_mut(observer).insert(Reserved);
    sim.world_mut()
        .get_mut::<Needs>(a)
        .unwrap()
        .set(NeedId::Bladder, 20.0);
    sim.world_mut()
        .entity_mut(a)
        .insert(terri_core::Shyness::new(100).unwrap());
    let def = sim.world().resource::<Content>().0.find("toilet").unwrap();
    let risky = sim.spawn_object(Position { x: 2.0, y: 2.0 }, def);
    let safe = sim.spawn_object(Position { x: 0.0, y: 2.0 }, def);
    let seed = (0..100)
        .find(|&seed| terri_core::SimRng::from_seed(seed).next_f32() < 0.5)
        .unwrap();
    sim.world_mut()
        .insert_resource(terri_core::SimRng::from_seed(seed));
    let mut schedule = Schedule::default();
    schedule.add_systems((super::prepare, super::super::action::select_action).chain());
    schedule.run(sim.world_mut());
    assert_eq!(sim.world().get::<Target>(a).unwrap().object, safe);
    sim.world_mut()
        .entity_mut(a)
        .insert(terri_core::IntentQueue::from_intents(vec![
            terri_core::Intent {
                object: risky,
                interaction: 0,
            },
        ]));
    let mut schedule = Schedule::default();
    schedule.add_systems(super::super::action::serve_intents);
    schedule.run(sim.world_mut());
    assert_eq!(sim.world().get::<Target>(a).unwrap().object, risky);
}

#[test]
fn shyness_scales_the_offended_person_in_both_bathroom_cases_and_conversations() {
    for (entry, shyness) in [(false, 1), (false, 100), (true, 1), (true, 100)] {
        let mut sim = fixture();
        let b = person(&mut sim, 3.0, 2.0);
        let a = person(
            &mut sim,
            if entry { 1.25 } else { 4.0 },
            if entry { 1.0 } else { 2.0 },
        );
        let offended = if entry { b } else { a };
        let responsible = if entry { a } else { b };
        let stat = terri_core::Shyness::new(shyness).unwrap();
        sim.world_mut().entity_mut(offended).insert(stat);
        sim.world_mut()
            .entity_mut(responsible)
            .insert(terri_core::Shyness::new(if shyness == 1 { 100 } else { 1 }).unwrap());
        let toilet = object(&mut sim, "toilet");
        if entry {
            using(&mut sim, b, toilet);
            enter(&mut sim, a);
        } else {
            start(&mut sim, b, toilet);
        }
        movement(&mut sim);
        assert!(
            (feeling(&sim, offended, responsible) + 0.25 * stat.annoyance_scale(0.25)).abs()
                < 0.000001
        );
        assert_eq!(feeling(&sim, responsible, offended), 0.0);
    }
    let mut sim = fixture();
    let a = person(&mut sim, 3.0, 2.0);
    let b = person(&mut sim, 4.0, 2.0);
    sim.world_mut()
        .entity_mut(a)
        .insert(terri_core::Shyness::new(1).unwrap());
    sim.world_mut()
        .entity_mut(b)
        .insert(terri_core::Shyness::new(100).unwrap());
    sim.world_mut()
        .get_mut::<Needs>(b)
        .unwrap()
        .set(NeedId::Bladder, 20.0);
    start(&mut sim, a, b);
    movement(&mut sim);
    assert!((feeling(&sim, b, a) + 0.25).abs() < 0.000001);
    assert_eq!(feeling(&sim, a, b), 0.0);
}

fn object(sim: &mut Sim, name: &str) -> Entity {
    let id = sim.world().resource::<Content>().0.find(name).unwrap();
    sim.spawn_object(Position { x: 3.0, y: 1.0 }, id)
}

fn start(sim: &mut Sim, user: Entity, object: Entity) {
    sim.world_mut().entity_mut(object).insert(Reserved);
    sim.world_mut().entity_mut(user).insert((
        Target {
            object,
            interaction: 0,
        },
        Path {
            steps: vec![],
            cursor: 0,
        },
    ));
}

fn using(sim: &mut Sim, user: Entity, object: Entity) {
    let def = sim
        .world()
        .get::<terri_core::SmartObject>(object)
        .unwrap()
        .0;
    sim.world_mut().entity_mut(object).insert(Reserved);
    sim.world_mut().entity_mut(user).insert((
        Target {
            object,
            interaction: 0,
        },
        Eating {
            object: def,
            interaction: 0,
            remaining_ticks: 50,
        },
    ));
}

fn enter(sim: &mut Sim, entrant: Entity) {
    sim.world_mut().entity_mut(entrant).insert(Path {
        steps: vec![(2, 1)],
        cursor: 0,
    });
}

#[test]
fn interpersonal_conversation_penalizes_only_the_recipient_and_helped_needs_are_exempt() {
    for (need, level, expected) in [
        (NeedId::Bladder, 20.0, -0.20),
        (NeedId::Hunger, 40.0, -0.11),
        (NeedId::Energy, 40.01, 0.0),
        (NeedId::Social, 0.0, 0.0),
        (NeedId::Fun, 0.0, 0.0),
    ] {
        let mut sim = fixture();
        let a = person(&mut sim, 3.0, 2.0);
        let b = person(&mut sim, 4.0, 2.0);
        sim.world_mut()
            .get_mut::<Needs>(b)
            .unwrap()
            .set(need, level);
        start(&mut sim, a, b);
        movement(&mut sim);
        assert!(sim.world().get::<Socialising>(a).is_some());
        assert_eq!(feeling(&sim, b, a), expected, "{need:?} at {level}");
        assert_eq!(feeling(&sim, a, b), 0.0);
        movement(&mut sim);
        assert_eq!(
            feeling(&sim, b, a),
            expected,
            "continued talk must not charge again"
        );
    }
}

#[test]
fn interpersonal_private_start_offends_existing_occupants_for_all_three_objects() {
    for name in ["toilet", "shower", "bathtub", "sink"] {
        let mut sim = fixture();
        let b = person(&mut sim, 3.0, 2.0);
        let a = person(&mut sim, 4.0, 2.0);
        let outside = person(&mut sim, 0.0, 2.0);
        let furniture = object(&mut sim, name);
        start(&mut sim, b, furniture);
        movement(&mut sim);
        assert!(sim.world().get::<Eating>(b).is_some());
        assert_eq!(
            feeling(&sim, a, b),
            if name == "sink" { 0.0 } else { -0.25 },
            "{name}"
        );
        assert_eq!(feeling(&sim, b, a), 0.0);
        assert_eq!(feeling(&sim, outside, b), 0.0);
        movement(&mut sim);
        assert_eq!(
            feeling(&sim, a, b),
            if name == "sink" { 0.0 } else { -0.25 }
        );
    }
}

#[test]
fn interpersonal_entry_offends_the_active_user_and_reentry_is_a_new_event() {
    let mut sim = fixture();
    let b = person(&mut sim, 3.0, 2.0);
    let a = person(&mut sim, 1.25, 1.0);
    let furniture = object(&mut sim, "toilet");
    using(&mut sim, b, furniture);
    enter(&mut sim, a);
    movement(&mut sim);
    assert_eq!(feeling(&sim, b, a), -0.25);
    assert_eq!(feeling(&sim, a, b), 0.0);
    movement(&mut sim);
    assert_eq!(feeling(&sim, b, a), -0.25);
    sim.world_mut().get_mut::<Position>(a).unwrap().x = 1.25;
    enter(&mut sim, a);
    movement(&mut sim);
    assert_eq!(feeling(&sim, b, a), -0.50);
}

#[test]
fn interpersonal_same_tick_events_observe_actual_entity_order() {
    for entrant_first in [true, false] {
        let mut sim = fixture();
        let (a, b) = if entrant_first {
            let a = person(&mut sim, 1.25, 1.0);
            (a, person(&mut sim, 3.0, 2.0))
        } else {
            let b = person(&mut sim, 3.0, 2.0);
            (person(&mut sim, 1.25, 1.0), b)
        };
        let furniture = object(&mut sim, "toilet");
        start(&mut sim, b, furniture);
        enter(&mut sim, a);
        movement(&mut sim);
        assert_eq!(feeling(&sim, a, b), if entrant_first { -0.25 } else { 0.0 });
        assert_eq!(feeling(&sim, b, a), if entrant_first { 0.0 } else { -0.25 });
    }
}

#[test]
fn privacy_guard_rechecks_room_occupancy_changed_earlier_in_the_same_tick() {
    for entrant_first in [true, false] {
        let mut sim = fixture();
        deliberate(&mut sim);
        let (a, b) = if entrant_first {
            let a = person(&mut sim, 1.25, 1.0);
            (a, person(&mut sim, 3.0, 2.0))
        } else {
            let b = person(&mut sim, 3.0, 2.0);
            (person(&mut sim, 1.25, 1.0), b)
        };
        let toilet = object(&mut sim, "toilet");
        start(&mut sim, b, toilet);
        enter(&mut sim, a);
        movement(&mut sim);
        assert_eq!(sim.world().get::<Eating>(b).is_some(), !entrant_first);
        assert_eq!(
            sim.world().get::<Position>(a).unwrap().x > 1.25,
            entrant_first
        );
        assert_eq!(feeling(&sim, a, b), 0.0);
        assert_eq!(feeling(&sim, b, a), 0.0);
    }
}

#[test]
fn privacy_late_occupancy_checks_alternatives_before_an_emergency_override() {
    let mut sim = fixture();
    deliberate(&mut sim);
    let entrant = person(&mut sim, 1.25, 1.0);
    let user = person(&mut sim, 3.0, 2.0);
    let toilet = object(&mut sim, "toilet");
    let alternate = sim.spawn_object(
        Position { x: 0.0, y: 3.0 },
        sim.world().resource::<Content>().0.find("toilet").unwrap(),
    );
    sim.world_mut()
        .get_mut::<Needs>(user)
        .unwrap()
        .set(NeedId::Bladder, 5.0);
    start(&mut sim, user, toilet);
    enter(&mut sim, entrant);
    let mut schedule = Schedule::default();
    schedule.add_systems(
        (
            super::prepare,
            crate::privacy::route,
            super::super::movement::follow_path,
            super::apply,
        )
            .chain(),
    );
    schedule.run(sim.world_mut());
    assert!(sim.world().get::<Eating>(user).is_none());
    assert_eq!(feeling(&sim, entrant, user), 0.0);
    schedule.run(sim.world_mut());
    assert_eq!(sim.world().get::<Target>(user).unwrap().object, alternate);
    assert!(sim.world().get::<Reserved>(toilet).is_none());
}

#[test]
fn privacy_two_critical_needs_keep_the_chosen_goal_until_its_emergency_wait_expires() {
    let mut sim = fixture();
    deliberate(&mut sim);
    let a = person(&mut sim, 1.25, 1.0);
    let b = person(&mut sim, 3.0, 2.0);
    let toilet = object(&mut sim, "toilet");
    using(&mut sim, b, toilet);
    let pack = sim.world().resource::<Content>().0;
    let fridge = sim.spawn_object(Position { x: 4.0, y: 3.0 }, pack.find("fridge").unwrap());
    sim.spawn_object(Position { x: 4.0, y: 0.0 }, pack.find("bed").unwrap());
    sim.world_mut().entity_mut(fridge).insert(Reserved);
    sim.world_mut().entity_mut(a).insert(Target {
        object: fridge,
        interaction: 0,
    });
    enter(&mut sim, a);
    for tick in 0..=10 {
        sim.world_mut()
            .get_mut::<Needs>(a)
            .unwrap()
            .set(NeedId::Hunger, 10.0);
        sim.world_mut()
            .get_mut::<Needs>(a)
            .unwrap()
            .set(NeedId::Energy, 10.0);
        sim.world_mut().resource_mut::<terri_core::SimClock>().tick = tick;
        let mut schedule = Schedule::default();
        schedule.add_systems(
            (
                super::prepare,
                crate::privacy::route,
                super::super::movement::follow_path,
                super::apply,
            )
                .chain(),
        );
        schedule.run(sim.world_mut());
        assert_eq!(
            sim.world().get::<Target>(a).unwrap().object,
            fridge,
            "minute {tick}"
        );
        assert_eq!(sim.world().get::<Position>(a).unwrap().x > 1.25, tick == 10);
    }
}

#[test]
fn privacy_wait_switches_to_an_urgent_goal_even_when_its_route_is_private_or_just_cleared() {
    for cleared in [false, true] {
        let mut sim = fixture();
        deliberate(&mut sim);
        let a = person(&mut sim, 1.25, 1.0);
        let b = person(&mut sim, 3.0, 2.0);
        let toilet = object(&mut sim, "toilet");
        using(&mut sim, b, toilet);
        let pack = sim.world().resource::<Content>().0;
        let tv = sim.spawn_object(
            Position { x: 4.0, y: 0.0 },
            pack.find("television").unwrap(),
        );
        let fridge = sim.spawn_object(Position { x: 4.0, y: 3.0 }, pack.find("fridge").unwrap());
        sim.world_mut().entity_mut(tv).insert(Reserved);
        sim.world_mut().entity_mut(a).insert(Target {
            object: tv,
            interaction: 0,
        });
        enter(&mut sim, a);
        movement(&mut sim);
        assert!(sim.world().get::<Eating>(a).is_none());
        sim.world_mut()
            .get_mut::<Needs>(a)
            .unwrap()
            .set(NeedId::Hunger, 5.0);
        if cleared {
            sim.world_mut().entity_mut(b).remove::<Eating>();
        }
        super::prepare(sim.world_mut());
        crate::privacy::route(sim.world_mut());
        assert_eq!(
            sim.world().get::<Target>(a).unwrap().object,
            fridge,
            "cleared={cleared}"
        );
        assert!(sim.world().get::<Reserved>(tv).is_none());
        // The emergency is now judged against hunger relief, not television.
        for _ in 0..4 {
            movement(&mut sim);
        }
        assert!(sim.world().get::<Position>(a).unwrap().x > 1.25);
    }
}

#[test]
fn privacy_wait_can_attend_to_a_different_critical_need_without_losing_chain_progress() {
    let mut sim = fixture();
    deliberate(&mut sim);
    let a = person(&mut sim, 3.0, 2.0);
    let _b = person(&mut sim, 4.0, 2.0);
    let toilet = object(&mut sim, "toilet");
    start(&mut sim, a, toilet);
    movement(&mut sim);
    assert!(sim.world().get::<Eating>(a).is_none());
    sim.world_mut()
        .get_mut::<Needs>(a)
        .unwrap()
        .set(NeedId::Hunger, 5.0);
    let fridge = sim.spawn_object(
        Position { x: 4.0, y: 3.0 },
        sim.world().resource::<Content>().0.find("fridge").unwrap(),
    );
    let chain = terri_core::ChainState::begin(0);
    sim.world_mut().entity_mut(a).insert(chain);
    super::prepare(sim.world_mut());
    crate::privacy::route(sim.world_mut());
    assert_eq!(sim.world().get::<Target>(a).unwrap().object, fridge);
    assert_eq!(
        *sim.world().get::<terri_core::ChainState>(a).unwrap(),
        chain
    );
    assert!(sim.world().get::<Reserved>(toilet).is_none());
    assert!(sim.world().get::<Reserved>(fridge).is_some());
}

#[test]
fn privacy_route_uses_the_house_loop_without_changing_walkability() {
    let mut sim = Sim::new_from_shipped_lot();
    deliberate(&mut sim);
    let a = person(&mut sim, 14.0, 5.0);
    let b = person(&mut sim, 13.0, 8.0);
    let toilet = sim
        .world_mut()
        .query::<(Entity, &terri_core::SmartObject)>()
        .iter(sim.world())
        .find(|(_, o)| terri_data::pack().object(o.0).id == "toilet")
        .unwrap()
        .0;
    using(&mut sim, b, toilet);
    let steps = sim
        .world()
        .resource::<terri_core::TileGrid>()
        .find_path((14, 5), (10, 7))
        .unwrap();
    sim.world_mut().entity_mut(a).insert(Path {
        steps: steps.clone(),
        cursor: 0,
    });
    super::prepare(sim.world_mut());
    assert!(sim
        .world()
        .resource::<super::InterpersonalPhase>()
        .path_intrudes(a, &steps));
    let walkable = sim
        .world()
        .resource::<terri_core::TileGrid>()
        .is_walkable(13, 7);
    crate::privacy::route(sim.world_mut());
    let after = &sim.world().get::<Path>(a).unwrap().steps;
    assert_eq!(after.last(), steps.last());
    assert!(!sim
        .world()
        .resource::<super::InterpersonalPhase>()
        .path_intrudes(a, after));
    assert_eq!(
        sim.world()
            .resource::<terri_core::TileGrid>()
            .is_walkable(13, 7),
        walkable
    );
    assert!(after.len() > steps.len());
}

#[test]
fn privacy_wander_detours_keep_the_entire_stroll_within_its_budget() {
    for (walked, spare) in [(0, 0), (0, 1), (1, 0), (1, 1)] {
        let mut sim = Sim::new_from_shipped_lot();
        deliberate(&mut sim);
        let a = person(&mut sim, 14.0, 5.0);
        let b = person(&mut sim, 13.0, 8.0);
        let toilet = sim
            .world_mut()
            .query::<(Entity, &terri_core::SmartObject)>()
            .iter(sim.world())
            .find(|(_, o)| terri_data::pack().object(o.0).id == "toilet")
            .unwrap()
            .0;
        using(&mut sim, b, toilet);
        super::prepare(sim.world_mut());
        let grid = sim.world().resource::<terri_core::TileGrid>();
        let direct = grid.find_path((14, 5), (10, 7)).unwrap();
        let safe = sim
            .world()
            .resource::<super::InterpersonalPhase>()
            .safe_grid(a, grid)
            .find_path((14, 5), (10, 7))
            .unwrap();
        assert!(safe.len() > direct.len());
        let cap = safe.len() + spare;
        let mut pack = sim.world().resource::<Content>().0.clone();
        pack.tuning.wander_radius_tiles = cap as u32;
        sim.world_mut()
            .insert_resource(Content(Box::leak(Box::new(pack))));
        let mut original = vec![(14, 5); walked];
        original.extend(direct);
        sim.world_mut().entity_mut(a).insert((
            Path {
                steps: original.clone(),
                cursor: walked,
            },
            terri_core::Wander { pause_ticks: 7 },
        ));
        crate::privacy::route(sim.world_mut());
        let after = sim.world().get::<Path>(a).unwrap();
        assert_eq!(
            after.cursor, walked,
            "rerouting must retain walked distance"
        );
        assert!(after.steps.len() <= cap);
        if walked > spare {
            assert_eq!(after.steps, original, "an over-budget detour must wait");
        } else {
            assert_eq!(&after.steps[walked..], safe.as_slice());
        }
        assert_eq!(
            sim.world()
                .get::<terri_core::Wander>(a)
                .unwrap()
                .pause_ticks,
            7
        );
    }
}

#[test]
fn interpersonal_open_plan_toilet_offends_all_occupants_and_accumulates_missing_components() {
    let mut sim = fixture();
    sim.world_mut()
        .insert_resource(SavedLayout::EdgeWallsV1 { edges: vec![] });
    let a = person(&mut sim, 0.0, 0.0);
    let b = person(&mut sim, 3.0, 2.0);
    let c = person(&mut sim, 4.0, 2.0);
    let toilet = object(&mut sim, "toilet");
    let shower = object(&mut sim, "shower");
    start(&mut sim, b, toilet);
    start(&mut sim, c, shower);
    movement(&mut sim);
    assert_eq!(feeling(&sim, a, b), -0.25);
    assert_eq!(feeling(&sim, a, c), -0.25);
    assert_eq!(feeling(&sim, b, c), -0.25);
    assert_eq!(feeling(&sim, c, b), -0.25);
}

#[test]
fn interpersonal_saved_starts_and_entries_replay_without_recharging_on_load() {
    for entry in [false, true] {
        let mut sim = fixture();
        let b = person(&mut sim, 3.0, 2.0);
        let a = person(
            &mut sim,
            if entry { 1.25 } else { 4.0 },
            if entry { 1.0 } else { 2.0 },
        );
        let furniture = object(&mut sim, "toilet");
        if entry {
            using(&mut sim, b, furniture);
            enter(&mut sim, a);
        } else {
            start(&mut sim, b, furniture);
        }
        let before = sim.save_snapshot_v5();
        movement(&mut sim);
        let after_hash = sim.world_hash();
        let after = sim.save_snapshot_v5();
        sim.load_snapshot_v5(before)
            .expect("pre-event save must load");
        movement(&mut sim);
        assert_eq!(sim.world_hash(), after_hash, "event must replay exactly");
        sim.load_snapshot_v5(after)
            .expect("post-event save must load");
        assert_eq!(
            sim.world_hash(),
            after_hash,
            "loading must not apply an event"
        );
        movement(&mut sim);
        assert_eq!(
            feeling(&sim, if entry { b } else { a }, if entry { a } else { b }),
            -0.25
        );
        assert!(!sim.world().contains_resource::<super::InterpersonalPhase>());
    }
}

#[test]
fn interpersonal_completion_and_cancellation_preserve_the_start_impression() {
    let mut sim = fixture();
    let a = person(&mut sim, 3.0, 2.0);
    let b = person(&mut sim, 4.0, 2.0);
    sim.world_mut()
        .get_mut::<Needs>(b)
        .unwrap()
        .set(NeedId::Bladder, 20.0);
    start(&mut sim, a, b);
    movement(&mut sim);
    let snapshot = sim.save_snapshot_v5();
    sim.load_snapshot_v5(snapshot.clone()).unwrap();
    assert_eq!(feeling(&sim, b, a), -0.20);
    sim.world_mut()
        .get_mut::<Socialising>(a)
        .unwrap()
        .remaining_ticks = 1;
    let mut schedule = Schedule::default();
    schedule.add_systems(super::super::social::tick_social);
    schedule.run(sim.world_mut());
    assert_eq!(
        feeling(&sim, b, a),
        -0.20,
        "a still-critical bladder prevents a positive completion reward"
    );
    assert_eq!(feeling(&sim, a, b), 0.17);
    sim.load_snapshot_v5(snapshot).unwrap();
    // Redirecting the partner disturbs the conversation; cleanup must not
    // erase the impression from when it began or add a completion gain.
    sim.world_mut().entity_mut(b).remove::<Reserved>();
    let mut schedule = Schedule::default();
    schedule.add_systems(super::super::social::tick_social);
    schedule.run(sim.world_mut());
    assert!(sim.world().get::<Socialising>(a).is_none());
    assert_eq!(feeling(&sim, b, a), -0.20);
    assert_eq!(feeling(&sim, a, b), 0.0);
}

#[test]
fn interpersonal_affinity_flows_through_mood_to_satisfaction_only_once() {
    let mut sim = fixture();
    let b = person(&mut sim, 3.0, 2.0);
    let a = person(&mut sim, 4.0, 2.0);
    let toilet = object(&mut sim, "toilet");
    for need in [NeedId::Hunger, NeedId::Energy, NeedId::Fun] {
        sim.world_mut().get_mut::<Needs>(a).unwrap().set(need, 30.0);
    }
    *sim.world_mut().get_mut::<Satisfaction>(a).unwrap() = Satisfaction::from_value(10.0);
    let before = sim.mood_of(a.index_u32()).unwrap().overall_score;
    start(&mut sim, b, toilet);
    movement(&mut sim);
    let after = sim.mood_of(a.index_u32()).unwrap().overall_score;
    assert!(after < before);
    assert_eq!(
        sim.world().get::<Satisfaction>(a).unwrap().value(),
        10.0,
        "affinity event must not directly charge satisfaction"
    );
    let t = sim.world().resource::<Content>().0.tuning;
    let expected = 10.0
        + (after + t.satisfaction_mood_neutral_band) / (100.0 - t.satisfaction_mood_neutral_band)
            * t.satisfaction_mood_per_tick;
    let mut schedule = Schedule::default();
    schedule.add_systems(crate::mood::accrue_satisfaction);
    schedule.run(sim.world_mut());
    assert!((sim.world().get::<Satisfaction>(a).unwrap().value() - expected).abs() < 0.00001);
    sim.world_mut().get_mut::<Position>(a).unwrap().x = 0.0;
    sim.world_mut().get_mut::<Position>(a).unwrap().y = 0.0;
    *sim.world_mut().get_mut::<Position>(b).unwrap() = Position { x: 5.0, y: 3.0 };
    assert_eq!(sim.mood_of(a.index_u32()).unwrap().overall_score, before);
}

#[test]
fn interpersonal_paused_layout_edits_spawns_and_reservations_do_not_count_as_entries_or_use() {
    let mut sim = fixture();
    let b = person(&mut sim, 3.0, 2.0);
    let a = person(&mut sim, 0.0, 2.0);
    let toilet = object(&mut sim, "toilet");
    using(&mut sim, b, toilet);
    sim.world_mut()
        .insert_resource(SavedLayout::EdgeWallsV1 { edges: vec![] });
    let newcomer = person(&mut sim, 4.0, 3.0);
    sim.flush_commands();
    movement(&mut sim);
    assert_eq!(feeling(&sim, b, a), 0.0);
    assert_eq!(feeling(&sim, b, newcomer), 0.0);
    assert_eq!(feeling(&sim, newcomer, b), 0.0);
    sim.world_mut().entity_mut(b).remove::<Eating>();
    sim.world_mut().entity_mut(b).insert(Path {
        steps: vec![(3, 3)],
        cursor: 0,
    });
    movement(&mut sim);
    assert_eq!(
        feeling(&sim, newcomer, b),
        0.0,
        "reserved approach is not use"
    );
}

#[test]
fn interpersonal_failed_approaches_and_absent_workers_receive_no_penalty() {
    let mut sim = fixture();
    let a = person(&mut sim, 0.0, 0.0);
    let b = person(&mut sim, 4.0, 2.0);
    sim.world_mut()
        .get_mut::<Needs>(b)
        .unwrap()
        .set(NeedId::Bladder, 0.0);
    start(&mut sim, a, b);
    movement(&mut sim);
    assert!(sim.world().get::<Socialising>(a).is_none());
    assert_eq!(feeling(&sim, b, a), 0.0);
    sim.world_mut().entity_mut(a).insert(terri_core::AtWork {
        remaining_ticks: 30,
    });
    sim.world_mut().get_mut::<Position>(a).unwrap().x = 3.0;
    let toilet = object(&mut sim, "toilet");
    start(&mut sim, b, toilet);
    movement(&mut sim);
    assert_eq!(feeling(&sim, a, b), 0.0);
}

#[test]
fn interpersonal_zero_penalty_and_clamping_use_the_authored_values() {
    for penalty in [0.0, 1.0] {
        let mut sim = fixture();
        let mut pack = sim.world().resource::<Content>().0.clone();
        pack.tuning.bathroom_privacy_penalty = penalty;
        sim.world_mut()
            .insert_resource(Content(Box::leak(Box::new(pack))));
        let b = person(&mut sim, 3.0, 2.0);
        let a = person(&mut sim, 4.0, 2.0);
        let mut feelings = Relationships::default();
        feelings.bump(*sim.world().get::<SimId>(b).unwrap(), -0.8);
        sim.world_mut().entity_mut(a).insert(feelings);
        let toilet = object(&mut sim, "toilet");
        start(&mut sim, b, toilet);
        movement(&mut sim);
        assert_eq!(
            feeling(&sim, a, b),
            if penalty == 0.0 { -0.8 } else { -1.0 }
        );
    }
}

#[test]
fn interpersonal_content_classification_and_tuning_preserve_save_fingerprint() {
    let pack = terri_data::pack();
    assert_eq!(pack.tuning.social_unmet_need_penalty, 0.11);
    assert!(pack.tuning.social_critical_need_penalty > pack.tuning.social_unmet_need_penalty);
    assert_eq!(pack.tuning.bathroom_privacy_penalty, 0.25);
    for name in ["toilet", "shower", "bathtub", "sink", "kitchen_sink"] {
        let object = pack.object(pack.find(name).unwrap());
        assert_eq!(
            object
                .interactions
                .iter()
                .any(|a| a.tags.iter().any(|t| t == super::PRIVATE_USE_TAG)),
            matches!(name, "toilet" | "shower" | "bathtub")
        );
    }
    let mut old = pack.clone();
    for object in &mut old.objects {
        for act in &mut object.interactions {
            act.tags.retain(|t| t != super::PRIVATE_USE_TAG);
        }
    }
    old.tuning.bathroom_privacy_penalty = 0.0;
    assert_eq!(
        terri_data::content_fingerprint(&old),
        terri_data::content_fingerprint(pack)
    );
}

#[test]
fn shyness_wander_reconsiders_once_and_keeps_a_valid_original_on_failure() {
    use super::super::idle::{roll_wander_path, wander};
    use terri_core::{Restless, Shyness, SimRng, TileGrid};
    for alternative_kind in 0..3 {
        let mut sim = fixture();
        let b = person(&mut sim, 3.0, 2.0);
        let a = person(&mut sim, 1.0, 1.0);
        let toilet = object(&mut sim, "toilet");
        using(&mut sim, b, toilet);
        let mut pack = sim.world().resource::<Content>().0.clone();
        pack.tuning.wander_radius_tiles = 3;
        pack.tuning.wander_attempts = 1;
        sim.world_mut()
            .insert_resource(Content(Box::leak(Box::new(pack))));
        sim.world_mut()
            .entity_mut(a)
            .insert((Restless, Shyness::new(100).unwrap()));
        super::prepare(sim.world_mut());
        let phase = sim.world().resource::<super::InterpersonalPhase>();
        let grid = sim.world().resource::<TileGrid>();
        let (seed, original, alternative) = (0..10000)
            .find_map(|seed| {
                let mut rng = SimRng::from_seed(seed);
                let first = roll_wander_path(grid, (1, 1), 3, 1, &mut rng)?;
                if !phase.path_intrudes(a, &first) {
                    return None;
                }
                let chance = rng.next_f32();
                if !(0.1015..0.25).contains(&chance) {
                    return None;
                }
                let second = roll_wander_path(grid, (1, 1), 3, 1, &mut rng);
                let kind = match &second {
                    Some(path) if !phase.path_intrudes(a, path) => 0,
                    Some(_) => 1,
                    None => 2,
                };
                (kind == alternative_kind).then_some((seed, first, second))
            })
            .expect("bounded fixture search must find each alternative outcome");
        for (stat, disable, reconsider) in
            [(100, false, true), (1, false, false), (100, true, false)]
        {
            sim.world_mut().entity_mut(a).remove::<Path>();
            sim.world_mut().entity_mut(a).remove::<terri_core::Wander>();
            sim.world_mut()
                .entity_mut(a)
                .insert(Shyness::new(stat).unwrap());
            let mut pack = sim.world().resource::<Content>().0.clone();
            pack.tuning.boundary_wander_reconsider_chance = if disable { 0.0 } else { 0.10 };
            pack.tuning.shyness_wander_reconsider_strength = if disable { 0.0 } else { 0.15 };
            sim.world_mut()
                .insert_resource(Content(Box::leak(Box::new(pack))));
            sim.world_mut().insert_resource(SimRng::from_seed(seed));
            let mut schedule = Schedule::default();
            schedule.add_systems((super::prepare, wander).chain());
            schedule.run(sim.world_mut());
            let expected = if reconsider && alternative_kind == 0 {
                alternative.as_ref().unwrap()
            } else {
                &original
            };
            assert_eq!(
                &sim.world().get::<Path>(a).unwrap().steps,
                expected,
                "stat={stat}, disabled={disable}, alternative={alternative_kind}"
            );
            assert_eq!(feeling(&sim, b, a), 0.0, "planning alone is not an entry");
        }
    }
}

#[test]
fn shyness_autonomous_conversation_choice_prefers_a_partner_without_urgent_needs() {
    let mut sim = fixture();
    sim.world_mut()
        .insert_resource(SavedLayout::EdgeWallsV1 { edges: vec![] });
    for y in [0, 2, 3] {
        sim.world_mut()
            .resource_mut::<terri_core::TileGrid>()
            .set_edge_blocked((1, y), (2, y), false);
    }
    let mut pack = sim.world().resource::<Content>().0.clone();
    pack.tuning.choice_temperature = 0.00001;
    sim.world_mut()
        .insert_resource(Content(Box::leak(Box::new(pack))));
    let a = person(&mut sim, 2.0, 2.0);
    let bad_time = person(&mut sim, 3.0, 2.0);
    let available = person(&mut sim, 1.0, 2.0);
    sim.world_mut()
        .entity_mut(a)
        .insert(terri_core::Shyness::new(100).unwrap());
    sim.world_mut()
        .get_mut::<Needs>(a)
        .unwrap()
        .set(NeedId::Social, 0.0);
    sim.world_mut()
        .get_mut::<Needs>(bad_time)
        .unwrap()
        .set(NeedId::Bladder, 20.0);
    let seed = (0..100)
        .find(|&seed| terri_core::SimRng::from_seed(seed).next_f32() < 0.5)
        .unwrap();
    sim.world_mut()
        .insert_resource(terri_core::SimRng::from_seed(seed));
    let mut schedule = Schedule::default();
    schedule.add_systems((super::prepare, super::super::action::select_action).chain());
    schedule.run(sim.world_mut());
    assert_eq!(sim.world().get::<Target>(a).unwrap().object, available);
}
