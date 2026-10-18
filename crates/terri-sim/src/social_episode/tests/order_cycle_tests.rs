//! Issue 301: a person who only waits for their own conversation or fight is
//! not busy, so orders and pending chats cannot wait on each other forever.
use super::*;
use crate::fights::{Fights, FIGHT_TAG};
use std::collections::BTreeSet;
use terri_core::Intent;

const CHAT: u32 = 0;
const FIGHT: u32 = 1;

fn three_people() -> (Sim, Entity, Entity, Entity) {
    let mut fight = test_content::interaction("fight", &[], 40);
    fight.tags = vec![FIGHT_TAG.into()];
    let pack = test_content::pack_with_social(
        vec![test_content::object("fridge", &[(NeedId::Hunger, 20.)], 60)],
        vec![
            test_content::interaction("chat", &[(NeedId::Social, 30.)], 40),
            fight,
        ],
        test_content::tuning(),
    );
    let mut sim = test_content::sim_with(12, 8, pack);
    let mut create = |x, y| {
        let id = sim.world_mut().resource_mut::<SimIdAllocator>().issue();
        sim.world_mut()
            .spawn((
                Agent,
                id,
                Position { x, y },
                Needs::all_at(100.),
                Relationships::default(),
            ))
            .id()
    };
    let tim = create(1., 1.);
    let bill = create(7., 1.);
    let casey = create(4., 5.);
    (sim, tim, bill, casey)
}

/// The chore-fight trigger's order: pushed to the front and owned by the game.
fn game_fight(sim: &mut Sim, person: Entity, partner: Entity) -> u64 {
    let intent = Intent {
        cleanup: None,
        chore: None,
        object: partner,
        interaction: FIGHT,
    };
    let world = sim.world_mut();
    if world.get::<IntentQueue>(person).is_none() {
        world.entity_mut(person).insert(IntentQueue::default());
    }
    let id = world
        .get_mut::<IntentQueue>(person)
        .unwrap()
        .insert_order(intent, None, true)
        .expect("the queue has room");
    world.resource_mut::<Fights>().restore_order(person, id);
    id
}

fn player_fight(sim: &mut Sim, person: Entity, partner: Entity) {
    sim.world_mut()
        .resource_mut::<CommandQueue>()
        .push(SimCommand::TalkTo {
            agent: person.index_u32(),
            target: partner.index_u32(),
            interaction: FIGHT,
        });
}

fn pending_chat(sim: &mut Sim, person: Entity, partner: Entity) -> u64 {
    requests::enqueue(
        sim.world_mut(),
        person,
        partner,
        CHAT,
        requests::ConversationOrigin::Autonomous,
    )
    .expect("the chat is a valid request")
}

/// Ticks until every expected conversation has run, recording who ran what.
fn run(sim: &mut Sim, expected: &[(Entity, Entity, u32)]) -> BTreeSet<(Entity, Entity, u32)> {
    let mut seen = BTreeSet::new();
    for _ in 0..1_500 {
        sim.tick();
        let talks: Vec<_> = sim
            .world_mut()
            .query::<(Entity, &Socialising)>()
            .iter(sim.world())
            .map(|(person, talk)| (person, talk.partner, talk.interaction))
            .collect();
        seen.extend(talks);
        if expected.iter().all(|e| seen.contains(e)) {
            break;
        }
    }
    seen
}

/// The shape seed 20260728 reached on day 12: Tim waits to chat with Bill,
/// Bill holds a fight order against Tim, and Casey holds one against Bill.
/// Each waited for a partner who was only waiting in turn, so nobody moved.
#[test]
fn a_pending_chat_and_chained_fight_orders_cannot_wait_on_each_other() {
    for player_ordered in [false, true] {
        let (mut sim, tim, bill, casey) = three_people();
        let chat = pending_chat(&mut sim, tim, bill);
        if player_ordered {
            player_fight(&mut sim, bill, tim);
        } else {
            game_fight(&mut sim, bill, tim);
        }
        game_fight(&mut sim, casey, bill);
        let expected = [(bill, tim, FIGHT), (casey, bill, FIGHT), (tim, bill, CHAT)];
        let seen = run(&mut sim, &expected);
        for (initiator, partner, interaction) in expected {
            assert!(
                seen.contains(&(initiator, partner, interaction)),
                "player_ordered={player_ordered}: {initiator:?} never ran {interaction} \
                 with {partner:?}; seen {seen:?}"
            );
        }
        assert_eq!(
            sim.world()
                .resource::<requests::ConversationRequests>()
                .requests
                .get(&chat)
                .map(|r| r.phase),
            Some(requests::RequestPhase::Talking),
            "player_ordered={player_ordered}: the suspended chat resumes with its identity"
        );
        for person in [tim, bill, casey] {
            assert!(
                sim.world()
                    .get::<IntentQueue>(person)
                    .is_none_or(IntentQueue::is_empty),
                "player_ordered={player_ordered}: every order is served once"
            );
        }
    }
}

/// Opposite fight orders between two people, with a third person waiting to
/// chat with one of them, all finish.
#[test]
fn mutual_fight_orders_beside_a_pending_chat_all_finish() {
    let (mut sim, tim, bill, casey) = three_people();
    game_fight(&mut sim, tim, bill);
    game_fight(&mut sim, bill, tim);
    pending_chat(&mut sim, casey, tim);
    let expected = [(tim, bill, FIGHT), (bill, tim, FIGHT), (casey, tim, CHAT)];
    let seen = run(&mut sim, &expected);
    for e in expected {
        assert!(seen.contains(&e), "{e:?} never ran; seen {seen:?}");
    }
}

/// A chain of three people, each waiting on the next, that closes through a
/// pending chat: Tim chats to Casey, Casey fights Bill, Bill fights Tim.
#[test]
fn a_three_person_cycle_mixing_a_chat_and_fights_breaks() {
    let (mut sim, tim, bill, casey) = three_people();
    pending_chat(&mut sim, tim, casey);
    game_fight(&mut sim, casey, bill);
    game_fight(&mut sim, bill, tim);
    let expected = [(bill, tim, FIGHT), (casey, bill, FIGHT), (tim, casey, CHAT)];
    let seen = run(&mut sim, &expected);
    for e in expected {
        assert!(seen.contains(&e), "{e:?} never ran; seen {seen:?}");
    }
}

/// Ruling for issue 301, pending the owner's confirmation: a fight the game
/// made up yields when either side's Hunger, Energy or Bladder is critical,
/// and releases its waiting partner. A fight the player ordered stays queued.
#[test]
fn a_game_made_fight_yields_to_a_crisis_but_a_player_fight_does_not() {
    for player_ordered in [false, true] {
        for critical_recipient in [false, true] {
            let (mut sim, tim, bill, _casey) = three_people();
            if player_ordered {
                player_fight(&mut sim, bill, tim);
            } else {
                game_fight(&mut sim, bill, tim);
            }
            sim.tick();
            let critical = if critical_recipient { tim } else { bill };
            sim.world_mut()
                .get_mut::<Needs>(critical)
                .unwrap()
                .set(NeedId::Hunger, 5.);
            sim.tick();
            let queued = sim
                .world()
                .get::<IntentQueue>(bill)
                .is_some_and(|q| q.entries().iter().any(|e| e.intent.interaction == FIGHT));
            let case =
                format!("player_ordered={player_ordered} critical_recipient={critical_recipient}");
            assert_eq!(
                queued, player_ordered,
                "{case}: only the player's order stays"
            );
            if !player_ordered {
                assert!(
                    sim.world()
                        .get::<Target>(bill)
                        .is_none_or(|t| t.object != tim),
                    "{case}: the withdrawn fight releases its approach"
                );
                assert!(
                    sim.world().get::<Reserved>(tim).is_none(),
                    "{case}: the partner is free to look after themselves"
                );
            }
        }
    }
}
