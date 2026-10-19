use super::*;

#[test]
fn conversation_balance_doubles_social_for_both_participants_without_filling_them() {
    let (mut sim, a, b) = chat_fixture();
    let pack = terri_data::pack();
    sim.world_mut().insert_resource(Content(pack));
    for (person, level) in [(a, 10.), (b, 20.)] {
        sim.world_mut()
            .get_mut::<Needs>(person)
            .unwrap()
            .set(NeedId::Social, level);
    }
    start(&mut sim, a, b, 2);
    sim.world_mut()
        .run_system_once(crate::systems::social::tick_social)
        .unwrap();
    for (person, level) in [(a, 10.), (b, 20.)] {
        let social = sim
            .world()
            .get::<Needs>(person)
            .unwrap()
            .get(NeedId::Social);
        assert!(
            (social - level - 1.5).abs() < 0.0001,
            "both participants receive double the former 0.75 rate: {social}"
        );
        assert!(
            social < 100.,
            "a chat supplies a reward without forcing full Social"
        );
    }
}

#[test]
fn conversation_balance_shared_interest_rewards_both_despite_unmet_needs() {
    let (mut sim, a, b) = chat_fixture();
    for person in [a, b] {
        sim.world_mut()
            .entity_mut(person)
            .insert(Needs::all_at(10.));
    }
    crate::systems::interpersonal::prepare(sim.world_mut());
    let pack = sim.world().resource::<Content>().0;
    sim.world_mut()
        .resource_mut::<crate::systems::interpersonal::InterpersonalPhase>()
        .conversation_start(a, b, 0, pack);
    start(&mut sim, a, b, 1);
    sim.world_mut()
        .resource_mut::<SocialEpisodes>()
        .topics
        .insert(
            a,
            Topic {
                code: 1,
                tag: "reading".into(),
                initiator_preference: 0.5,
                listener_preference: 0.5,
            },
        );
    crate::systems::interpersonal::apply(sim.world_mut());
    sim.world_mut()
        .run_system_once(crate::systems::social::tick_social)
        .unwrap();
    for (person, other) in [(a, b), (b, a)] {
        let other_id = *sim.world().get::<SimId>(other).unwrap();
        assert!(
            sim.world()
                .get::<Relationships>(person)
                .unwrap()
                .feeling(other_id)
                > 0.,
            "a completed shared interest improves both opinions"
        );
    }
}

#[test]
fn conversation_balance_family_increases_positive_and_softens_negative_opinions() {
    use crate::relationship_effects::{record_opinion_change, RelationshipCause};
    use terri_core::layout::{FamilyTies, Relation};
    for relation in [
        Relation::Partner,
        Relation::Parent,
        Relation::Child,
        Relation::Sibling,
    ] {
        let (mut sim, a, b) = chat_fixture();
        let aid = *sim.world().get::<SimId>(a).unwrap();
        let bid = *sim.world().get::<SimId>(b).unwrap();
        let mut ties = FamilyTies::default();
        ties.set(aid.0, bid.0, Some(relation));
        sim.world_mut().insert_resource(ties);
        record_opinion_change(
            sim.world_mut(),
            bid.0,
            a,
            0.1,
            RelationshipCause::ChoreFulfilled,
        );
        assert!((sim.world().get::<Relationships>(a).unwrap().feeling(bid) - 0.15).abs() < 0.00001);
        record_opinion_change(
            sim.world_mut(),
            bid.0,
            a,
            -0.2,
            RelationshipCause::ChoreNeglected,
        );
        assert!((sim.world().get::<Relationships>(a).unwrap().feeling(bid) - 0.05).abs() < 0.00001);
    }
}

#[test]
fn conversation_balance_shipped_need_drain_is_two_thirds_of_previous_rates() {
    let before = [0.062, 0.051, 0.072, 0.102, 0.026, 0.048, 0.032];
    let rates = &terri_data::pack().decay_per_tick;
    for (index, old) in before.into_iter().enumerate() {
        assert!(
            (rates[index] - old * (2. / 3.)).abs() < 0.0000001,
            "need {index} retains two thirds of its former drain: {}",
            rates[index]
        );
    }
}

#[test]
fn conversation_balance_fights_cannot_deliver_an_accidental_social_advertisement() {
    let (mut sim, a, b) = chat_fixture();
    let mut pack = sim.world().resource::<Content>().0.clone();
    pack.social[0].tags.push(crate::fights::FIGHT_TAG.into());
    sim.world_mut()
        .insert_resource(Content(Box::leak(Box::new(pack))));
    start(&mut sim, a, b, 1);
    sim.world_mut()
        .run_system_once(crate::systems::social::tick_social)
        .unwrap();
    for person in [a, b] {
        assert_eq!(
            sim.world()
                .get::<Needs>(person)
                .unwrap()
                .get(NeedId::Social),
            90.
        );
    }
}

#[test]
fn conversation_balance_social_caps_at_100_for_both_sides() {
    let (mut sim, a, b) = chat_fixture();
    sim.world_mut().insert_resource(Content(terri_data::pack()));
    for person in [a, b] {
        sim.world_mut()
            .get_mut::<Needs>(person)
            .unwrap()
            .set(NeedId::Social, 99.75);
    }
    start(&mut sim, a, b, 2);
    sim.world_mut()
        .run_system_once(crate::systems::social::tick_social)
        .unwrap();
    for person in [a, b] {
        assert_eq!(
            sim.world()
                .get::<Needs>(person)
                .unwrap()
                .get(NeedId::Social),
            100.
        );
    }
}
