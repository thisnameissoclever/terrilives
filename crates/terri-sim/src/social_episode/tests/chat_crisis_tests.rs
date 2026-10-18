//! Owner's decision of 2026-10-18 (issue 301 follow-up): a chat a housemate
//! chose for themselves gives up when their own Hunger or Energy turns
//! critical and releases the partner. A chat the player ordered stays.
use super::*;

fn chat_partners() -> (Sim, Entity, Entity) {
    let (mut sim, a, b) = chat_fixture();
    for person in [a, b] {
        *sim.world_mut().get_mut::<Needs>(person).unwrap() = Needs::all_at(100.);
    }
    (sim, a, b)
}

fn autonomous_chat(sim: &mut Sim, a: Entity, b: Entity) -> u64 {
    requests::enqueue(
        sim.world_mut(),
        a,
        b,
        0,
        requests::ConversationOrigin::Autonomous,
    )
    .expect("the chat is a valid request")
}

fn outgoing(sim: &Sim, person: Entity) -> Option<u64> {
    sim.world()
        .resource::<requests::ConversationRequests>()
        .requests
        .values()
        .find(|r| r.initiator == person)
        .map(|r| r.id)
}

#[test]
fn a_chosen_chat_gives_up_when_the_initiator_turns_critically_hungry_or_tired() {
    for need in [NeedId::Hunger, NeedId::Energy] {
        let (mut sim, a, b) = chat_partners();
        let id = autonomous_chat(&mut sim, a, b);
        requests::before_movement(sim.world_mut());
        assert!(
            sim.world()
                .resource::<requests::ConversationRequests>()
                .admitted(a, b),
            "{need:?}: the free partner is claimed for the chat"
        );
        assert!(sim.world().get::<Reserved>(b).is_some());
        sim.world_mut().get_mut::<Needs>(a).unwrap().set(need, 5.);
        sim.tick();
        assert_eq!(outgoing(&sim, a), None, "{need:?}: chat {id} gives up");
        assert!(
            sim.world().get::<Target>(a).is_none_or(|t| t.object != b),
            "{need:?}: the initiator stops approaching"
        );
        assert!(
            sim.world().get::<Reserved>(b).is_none(),
            "{need:?}: the partner is released"
        );
        assert!(
            !sim.world()
                .resource::<SocialEpisodes>()
                .rendezvous
                .contains_key(&b),
            "{need:?}: no claim on the partner remains"
        );
        assert!(
            sim.world()
                .get::<requests::CommittedConversation>(a)
                .is_none(),
            "{need:?}: ordinary autonomy may choose care"
        );
    }
}

/// A partner who is still busy releases nothing, but the waiting chat gives
/// up just the same, so the hungry initiator is free to eat.
#[test]
fn a_waiting_chosen_chat_gives_up_too() {
    let (mut sim, a, b) = chat_partners();
    let fridge = sim.world().resource::<Content>().0.find("fridge").unwrap();
    sim.world_mut().entity_mut(b).insert(terri_core::Eating {
        object: fridge,
        interaction: 0,
        remaining_ticks: 500,
    });
    let id = autonomous_chat(&mut sim, a, b);
    requests::before_movement(sim.world_mut());
    assert_eq!(
        sim.world()
            .resource::<requests::ConversationRequests>()
            .requests
            .get(&id)
            .map(|r| r.phase),
        Some(requests::RequestPhase::Waiting),
        "the busy partner leaves the chat waiting"
    );
    sim.world_mut()
        .get_mut::<Needs>(a)
        .unwrap()
        .set(NeedId::Hunger, 5.);
    requests::before_movement(sim.world_mut());
    assert_eq!(outgoing(&sim, a), None);
    assert!(sim.world().get::<Target>(a).is_none_or(|t| t.object != b));
}

/// The give-up must not become a loop of choosing the same chat again: a
/// critically hungry, lonely housemate with food in reach goes to eat. A chat
/// chosen during selection would be cancelled before movement in the same
/// tick, so the test counts requests created rather than requests seen.
#[test]
fn a_critically_hungry_lonely_housemate_eats_instead_of_reselecting_a_chat() {
    let (mut sim, a, b) = chat_partners();
    let mut needs = Needs::all_at(100.);
    needs.set(NeedId::Hunger, 5.);
    needs.set(NeedId::Social, 0.);
    *sim.world_mut().get_mut::<Needs>(a).unwrap() = needs;
    let fridge = sim.world().resource::<Content>().0.find("fridge").unwrap();
    // A reserved partner makes no choices of their own, so every request
    // counted below is one the hungry housemate chose.
    sim.world_mut().entity_mut(b).insert(Reserved);
    sim.world_mut()
        .spawn((Position { x: 4., y: 5. }, terri_core::SmartObject(fridge)));
    let next_id = |sim: &Sim| {
        sim.world()
            .resource::<requests::ConversationRequests>()
            .next_id
    };
    let before = next_id(&sim);
    for _ in 0..200 {
        sim.tick();
        if sim.world().get::<terri_core::Eating>(a).is_some() {
            break;
        }
    }
    assert_eq!(
        next_id(&sim) - before,
        0,
        "no chat is chosen while it would give up"
    );
    assert!(
        sim.world().get::<terri_core::Eating>(a).is_some(),
        "the hungry housemate eats"
    );
}

#[test]
fn a_player_ordered_chat_stays_through_the_initiators_critical_needs() {
    for need in [NeedId::Hunger, NeedId::Energy] {
        let (mut sim, a, b) = chat_partners();
        talk(&mut sim, a, b);
        sim.tick();
        let id = sim.world().get::<IntentQueue>(a).unwrap().entries()[0].id;
        sim.world_mut().get_mut::<Needs>(a).unwrap().set(need, 5.);
        let mut talked = false;
        for _ in 0..200 {
            sim.tick();
            talked |= sim
                .world()
                .get::<Socialising>(a)
                .is_some_and(|s| s.partner == b);
            if talked {
                break;
            }
            assert!(
                sim.world()
                    .get::<IntentQueue>(a)
                    .unwrap()
                    .order(id)
                    .is_some(),
                "{need:?}: the order {id} stays"
            );
        }
        assert!(talked, "{need:?}: the ordered chat runs");
    }
}

/// A chat already under way finishes even if its initiator turns critical:
/// the give-up covers pending chats, not a running conversation.
#[test]
fn a_running_chosen_chat_finishes_through_the_initiators_crisis() {
    for need in [NeedId::Hunger, NeedId::Energy] {
        let (mut sim, a, b) = chat_partners();
        sim.world_mut()
            .get_mut::<Needs>(a)
            .unwrap()
            .set(NeedId::Social, 40.);
        let id = autonomous_chat(&mut sim, a, b);
        let talking = |sim: &Sim| {
            sim.world()
                .get::<Socialising>(a)
                .is_some_and(|s| s.partner == b && s.interaction == 0)
        };
        for _ in 0..200 {
            sim.tick();
            if talking(&sim) {
                break;
            }
        }
        assert!(talking(&sim), "{need:?}: the chat starts");
        let social = sim.world().get::<Needs>(a).unwrap().get(NeedId::Social);
        sim.world_mut().get_mut::<Needs>(a).unwrap().set(need, 5.);
        let mut ticks = 0;
        while talking(&sim) && ticks < 200 {
            sim.tick();
            ticks += 1;
            if talking(&sim) {
                assert!(
                    sim.world()
                        .resource::<requests::ConversationRequests>()
                        .requests
                        .contains_key(&id),
                    "{need:?}: the running chat keeps its request"
                );
            }
        }
        assert!(
            ticks > 1,
            "{need:?}: the chat runs on after the crisis begins"
        );
        assert!(
            sim.world().get::<Needs>(a).unwrap().get(NeedId::Social) > social + 10.,
            "{need:?}: the finished chat delivers its Social"
        );
    }
}
