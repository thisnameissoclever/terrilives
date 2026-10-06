use super::*;
use terri_core::{Hobbies, Position, SimId, SmartObject};

fn shared_fixture(first_kind: &str, second_kind: &str) -> (crate::Sim, Entity, Entity) {
    let mut sim = crate::Sim::new_with_lot(16, 16);
    let pack = sim.world().resource::<Content>().0;
    let mut people = vec![];
    for (i, kind) in [first_kind, second_kind].into_iter().enumerate() {
        let x = 2. + i as f32 * 3.;
        let definition = pack.find(kind).unwrap();
        let object = sim.spawn_object(Position { x, y: 2. }, definition);
        let person = crate::household::spawn_member(
            sim.world_mut(),
            &pack.personalities,
            &pack.traits,
            crate::household::Member {
                name: format!("Participant {i}"),
                personality: 0,
                position: Position { x, y: 3. },
                needs: [100.; 7],
                hobbies: vec![],
                traits: &[],
                career: None,
                instinct: Some(50),
            },
        );
        sim.world_mut().entity_mut(person).insert((
            Personality::neutral(),
            Hobbies(vec![]),
            Target {
                object,
                interaction: 0,
            },
            Eating {
                object: definition,
                interaction: 0,
                remaining_ticks: 1000,
            },
        ));
        sim.world_mut()
            .get_mut::<Needs>(person)
            .unwrap()
            .set(NeedId::Social, 30.);
        sim.world_mut()
            .entity_mut(object)
            .insert(terri_core::Reserved);
        people.push(person);
    }
    let first_id = *sim.world().get::<SimId>(people[0]).unwrap();
    let second_id = *sim.world().get::<SimId>(people[1]).unwrap();
    let mut likes = Relationships::default();
    likes.bump(second_id, 0.5);
    let mut dislikes = Relationships::default();
    dislikes.bump(first_id, -0.5);
    sim.world_mut().entity_mut(people[0]).insert(likes);
    sim.world_mut().entity_mut(people[1]).insert(dislikes);
    (sim, people[0], people[1])
}

fn contextual_minute(sim: &mut crate::Sim) {
    crate::social_company::refresh(sim.world_mut());
    tick(sim.world_mut());
}

#[test]
fn standing_food_cost_requires_consumption_without_travel_preparation_or_gathering() {
    use terri_core::save::{SavedDomestic, SavedMeal};
    let mut sim = crate::Sim::new_with_lot(8, 8);
    let pack = sim.world().resource::<Content>().0;
    let chain = pack
        .chains
        .iter()
        .position(|c| c.id == "cook_dinner")
        .unwrap() as u32;
    let dinner = pack.item_kinds.iter().position(|k| k == "dinner").unwrap() as u32;
    let table = sim.spawn_object(
        Position { x: 3., y: 3. },
        pack.find("dining_table").unwrap(),
    );
    let person = sim
        .world_mut()
        .spawn((
            Agent,
            SimId(0),
            Position { x: 3., y: 4. },
            Needs::all_at(30.),
            ChainState {
                step: 5,
                ..ChainState::begin(chain)
            },
            Carrying(dinner),
            StepWork {
                remaining_ticks: 10,
            },
            Target {
                object: table,
                interaction: crate::systems::chain::CHAIN_STEP,
            },
        ))
        .id();
    tick(sim.world_mut());
    let before = *sim.world().get::<Needs>(person).unwrap();
    assert!((before.get(NeedId::Comfort) - (30. - 2. / 90.)).abs() < 0.00001);
    sim.world_mut().entity_mut(person).insert(Path {
        steps: vec![(3, 4)],
        cursor: 0,
    });
    tick(sim.world_mut());
    assert_eq!(*sim.world().get::<Needs>(person).unwrap(), before);
    sim.world_mut()
        .entity_mut(person)
        .remove::<Path>()
        .remove::<Carrying>();
    tick(sim.world_mut());
    assert_eq!(*sim.world().get::<Needs>(person).unwrap(), before);
    sim.world_mut().entity_mut(person).insert(Carrying(dinner));
    sim.world_mut().get_mut::<ChainState>(person).unwrap().step = 4;
    tick(sim.world_mut());
    assert_eq!(*sim.world().get::<Needs>(person).unwrap(), before);
    sim.world_mut().get_mut::<ChainState>(person).unwrap().step = 5;
    sim.world_mut().insert_resource(SavedDomestic {
        serving_meals: vec![(0, 1)],
        meals: vec![SavedMeal {
            cook: 0,
            counter: table.index_u32(),
            table: Some(table.index_u32()),
            guests: vec![1],
            claimed: vec![1],
            collected: vec![],
            eaten: vec![],
            scale: 0.1,
            tick: 1,
            dining_started: false,
        }],
        ..Default::default()
    });
    tick(sim.world_mut());
    assert_eq!(*sim.world().get::<Needs>(person).unwrap(), before);
    sim.world_mut().resource_mut::<SavedDomestic>().meals[0].dining_started = true;
    tick(sim.world_mut());
    assert!(
        sim.world()
            .get::<Needs>(person)
            .unwrap()
            .get(NeedId::Comfort)
            < before.get(NeedId::Comfort)
    );
    let before = *sim.world().get::<Needs>(person).unwrap();
    sim.world_mut()
        .get_mut::<StepWork>(person)
        .unwrap()
        .remaining_ticks = 0;
    tick(sim.world_mut());
    assert_eq!(*sim.world().get::<Needs>(person).unwrap(), before);
}

#[test]
fn differing_or_failed_activities_do_not_supply_shared_social() {
    let (mut sim, first, _) = shared_fixture("bookshelf", "moving_box");
    contextual_minute(&mut sim);
    assert_eq!(
        sim.world().get::<Needs>(first).unwrap().get(NeedId::Social),
        30.
    );
    let (mut sim, first, second) = shared_fixture("bookshelf", "reading_chair");
    sim.world_mut()
        .entity_mut(second)
        .insert(terri_core::Fumbled { delta_scale: 0.5 });
    contextual_minute(&mut sim);
    assert_eq!(
        sim.world().get::<Needs>(first).unwrap().get(NeedId::Social),
        30.
    );
}

#[test]
fn shared_social_requires_actual_matching_activity_and_directional_liking() {
    for (a, b) in [
        ("bookshelf", "reading_chair"),
        ("moving_box", "moving_box"),
        ("reference_shelf", "reference_shelf"),
    ] {
        let (mut sim, first, second) = shared_fixture(a, b);
        contextual_minute(&mut sim);
        assert!(
            (sim.world().get::<Needs>(first).unwrap().get(NeedId::Social) - 30.12).abs() < 0.00001
        );
        assert_eq!(
            sim.world()
                .get::<Needs>(second)
                .unwrap()
                .get(NeedId::Social),
            30.
        );
        sim.world_mut().entity_mut(second).insert(Path {
            steps: vec![(5, 3)],
            cursor: 0,
        });
        let before = *sim.world().get::<Needs>(first).unwrap();
        contextual_minute(&mut sim);
        assert_eq!(
            *sim.world().get::<Needs>(first).unwrap(),
            before,
            "Travel is not shared participation"
        );
        sim.world_mut()
            .entity_mut(second)
            .remove::<Path>()
            .remove::<Eating>();
        contextual_minute(&mut sim);
        assert_eq!(
            *sim.world().get::<Needs>(first).unwrap(),
            before,
            "Idle proximity is not a pastime"
        );
    }
}

#[test]
fn shared_social_obeys_room_radius_distinct_object_and_both_preferences() {
    let (mut sim, first, second) = shared_fixture("bookshelf", "reading_chair");
    let target = *sim.world().get::<Target>(second).unwrap();
    let reading = sim.world().get::<SmartObject>(target.object).unwrap().0;
    // Hold actual participation constant to isolate the four-tile boundary.
    sim.world_mut()
        .entity_mut(second)
        .insert(Position { x: 6., y: 3. });
    contextual_minute(&mut sim);
    let at_four = sim.world().get::<Needs>(first).unwrap().get(NeedId::Social);
    assert!(at_four > 30.);
    sim.world_mut()
        .entity_mut(second)
        .insert(Position { x: 6.01, y: 3. });
    contextual_minute(&mut sim);
    assert_eq!(
        sim.world().get::<Needs>(first).unwrap().get(NeedId::Social),
        at_four
    );
    sim.world_mut()
        .entity_mut(second)
        .insert(Position { x: 5., y: 3. });
    use terri_core::layout::{EdgeAxis, SavedLayout, WallEdge};
    sim.world_mut().insert_resource(SavedLayout::EdgeWallsV1 {
        edges: (0..16)
            .map(|y| WallEdge {
                axis: EdgeAxis::Vertical,
                x: 4,
                y,
                doorway: true,
            })
            .collect(),
    });
    contextual_minute(&mut sim);
    assert_eq!(
        sim.world().get::<Needs>(first).unwrap().get(NeedId::Social),
        at_four
    );
    sim.world_mut()
        .insert_resource(SavedLayout::EdgeWallsV1 { edges: vec![] });
    for subject in [first, second] {
        sim.world_mut()
            .entity_mut(subject)
            .insert(Personality::with_dispositions(
                [1.; 7],
                [1.; 7],
                vec![(reading, 0, 0.1)],
            ));
        contextual_minute(&mut sim);
        let first_target = *sim.world().get::<Target>(first).unwrap();
        assert!(
            !sim.world()
                .resource::<crate::social_company::SocialCompany>()
                .shared_allowed(
                    first,
                    first_target.object,
                    first_target.interaction,
                    sim.world().get::<Relationships>(first).unwrap(),
                    (2, 3)
                ),
            "A prospective offer must respect both activity preferences"
        );
        assert_eq!(
            sim.world().get::<Needs>(first).unwrap().get(NeedId::Social),
            at_four,
            "Either person's disliked activity excludes sharing"
        );
        sim.world_mut()
            .entity_mut(subject)
            .insert(Personality::neutral());
    }
    let first_target = *sim.world().get::<Target>(first).unwrap();
    sim.world_mut().entity_mut(second).insert(first_target);
    let eating = *sim.world().get::<Eating>(first).unwrap();
    sim.world_mut().entity_mut(second).insert(eating);
    contextual_minute(&mut sim);
    assert_eq!(
        sim.world().get::<Needs>(first).unwrap().get(NeedId::Social),
        at_four
    );
}

#[test]
fn shared_contact_radius_uses_both_actual_positions() {
    let (mut sim, first, second) = shared_fixture("bookshelf", "reading_chair");
    sim.world_mut()
        .entity_mut(first)
        .insert(Position { x: 2.49, y: 3. });
    sim.world_mut()
        .entity_mut(second)
        .insert(Position { x: 6.49, y: 3. });
    contextual_minute(&mut sim);
    assert!(
        sim.world().get::<Needs>(first).unwrap().get(NeedId::Social) > 30.,
        "Exactly four tiles between actual positions qualifies"
    );
}

#[test]
fn shared_activity_reload_rebuilds_context_before_first_payment() {
    // Exercise is an ordinary action; reading requires a physical owned copy.
    let (mut sim, first, _) = shared_fixture("moving_box", "moving_box");
    let mut restored = crate::Sim::new_from_shipped_lot();
    restored.load_snapshot_v6(sim.save_snapshot_v6()).unwrap();
    let before = sim.world().get::<Needs>(first).unwrap().get(NeedId::Social);
    for _ in 0..4 {
        sim.tick();
        restored.tick();
        assert_eq!(sim.world_hash(), restored.world_hash());
    }
    assert!(
        sim.world().get::<Needs>(first).unwrap().get(NeedId::Social) > before,
        "Replay must actually include Social payment"
    );
}

#[test]
fn critical_social_relationship_help_requires_actual_successful_sharing() {
    for failed in [false, true] {
        let (mut sim, first, second) = shared_fixture("bookshelf", "reading_chair");
        sim.world_mut()
            .get_mut::<Needs>(first)
            .unwrap()
            .set(NeedId::Social, 10.);
        if failed {
            sim.world_mut()
                .entity_mut(first)
                .insert(terri_core::Fumbled { delta_scale: 0.5 });
        }
        let other_id = *sim.world().get::<SimId>(second).unwrap();
        let before = sim
            .world()
            .get::<Relationships>(first)
            .unwrap()
            .feeling(other_id);
        crate::relationship_dynamics::tick(sim.world_mut());
        let after = sim
            .world()
            .get::<Relationships>(first)
            .unwrap()
            .feeling(other_id);
        assert_eq!(
            after > before,
            !failed,
            "Failed sharing cannot claim to relieve critical Social"
        );
        tick(sim.world_mut());
        assert_eq!(
            sim.world().get::<Needs>(first).unwrap().get(NeedId::Social) > 10.,
            !failed
        );
    }
}

#[test]
fn autonomous_washing_scores_only_hygiene_available_below_the_cap() {
    let mut hands = crate::test_content::interaction("wash_hands", &[(NeedId::Hygiene, 32.)], 21);
    hands.activity = Some(terri_data::CompiledActivity::WashingHands);
    let mut pack = crate::test_content::pack(vec![
        crate::test_content::object_offering("hands", vec![hands]),
        crate::test_content::object("body", &[(NeedId::Hygiene, 2.)], 21),
    ])
    .clone();
    pack.tuning.choice_temperature = 0.000001;
    pack.tuning.choice_comfort_temperature = 0.000001;
    pack.tuning.choice_exploration = 0.;
    pack.tuning.choice_comfort_exploration = 0.;
    pack.tuning.action_threshold = 0.;
    pack.tuning.idle_threshold = 0.;
    let pack = Box::leak(Box::new(pack));
    let mut sim = crate::test_content::sim_with(8, 8, pack);
    let hands = sim.spawn_object(Position { x: 2., y: 2. }, terri_core::ObjectDefId(0));
    let body = sim.spawn_object(Position { x: 2., y: 4. }, terri_core::ObjectDefId(1));
    let mut needs = Needs::all_at(100.);
    needs.set(NeedId::Hygiene, 39.);
    let person = sim
        .world_mut()
        .spawn((Agent, Position { x: 2., y: 3. }, needs))
        .id();
    sim.tick();
    let target = sim
        .world()
        .get::<Target>(person)
        .expect("The better available wash must start");
    assert_ne!(
        target.object, hands,
        "The advertised 32 points cannot escape the one-point ceiling gap"
    );
    assert_eq!(
        target.object, body,
        "The two-point body wash wins over at most one point from hands"
    );
}

#[test]
fn handwashing_benefits_and_cap_track_personality_scaled_delivery() {
    let pack = terri_data::pack();
    let act = &pack.object(pack.find("sink").unwrap()).interactions[0];
    let mut needs = Needs::all_at(100.);
    needs.set(NeedId::Hygiene, 39.);
    assert_eq!(
        cap_delta(pack, act, &needs, NeedId::Hygiene.index() as u8, 64.),
        1.
    );
    needs.set(NeedId::Hygiene, 40.);
    assert!(benefits(pack, act, &needs, false, 0., false).is_empty());
    assert!(
        !crate::relationship_dynamics::positive_allowed(
            &Needs::all_at(100.),
            &needs,
            &[],
            &pack.tuning
        ),
        "Hands alone do not remove body-odor consequences"
    );
}
