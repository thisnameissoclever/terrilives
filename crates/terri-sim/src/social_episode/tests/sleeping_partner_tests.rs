//! Owner's ruling of 2026-10-23 (issue 338): a housemate never chooses a chat
//! with someone who is asleep, and a chat they chose gives up when its partner
//! falls asleep, so they may ask again once the partner wakes. A chat the
//! player ordered keeps waiting for a sleeping partner. "Asleep" is the
//! simulation's sleep state, `systems::circadian::is_asleep`: an interaction
//! under way whose tags include the pack's sleep tag.
use super::*;

const FRIDGE: &str = "fridge";
const BED: &str = "bed";

/// Two housemates and a pack with a fridge, a bed and one chat. A test puts
/// a partner to sleep by starting the bed's interaction on them, which is all
/// the sleep state reads. The first housemate is lonely, so a chat with the
/// second is the choice selection makes when it may.
fn household() -> (Sim, Entity, Entity) {
    let mut sleep = test_content::interaction("sleep", &[(NeedId::Energy, 60.)], 480);
    sleep.tags = vec![terri_data::pack().sleep_tag.clone()];
    let pack = test_content::pack_with_social(
        vec![
            test_content::object(FRIDGE, &[(NeedId::Hunger, 20.)], 60),
            test_content::object_offering(BED, vec![sleep]),
        ],
        vec![test_content::interaction(
            "chat",
            &[(NeedId::Social, 30.)],
            40,
        )],
        test_content::tuning(),
    );
    let mut sim = test_content::sim_with(12, 8, pack);
    let mut create = |x, needs| {
        let id = sim.world_mut().resource_mut::<SimIdAllocator>().issue();
        sim.world_mut()
            .spawn((
                Agent,
                id,
                terri_core::Position { x, y: 1. },
                needs,
                Relationships::default(),
            ))
            .id()
    };
    let mut lonely = Needs::all_at(90.);
    lonely.set(NeedId::Social, 0.);
    let a = create(1., lonely);
    let b = create(7., Needs::all_at(90.));
    (sim, a, b)
}

/// Places an `object` under `person` and starts its only interaction there
/// for `ticks` more ticks, as arrival does: the target and the interaction
/// under way. The interaction then counts down and ends as any other does.
fn start_using(sim: &mut Sim, person: Entity, object: &str, ticks: u32) {
    let definition = sim.world().resource::<Content>().0.find(object).unwrap();
    let at = *sim.world().get::<terri_core::Position>(person).unwrap();
    let placed = sim
        .world_mut()
        .spawn((at, terri_core::SmartObject(definition), Reserved))
        .id();
    sim.world_mut().entity_mut(person).insert((
        Target {
            object: placed,
            interaction: 0,
        },
        terri_core::Eating {
            object: definition,
            interaction: 0,
            remaining_ticks: ticks,
        },
    ));
}

/// Ticks while the partner sleeps, checking `each` after every tick, and
/// returns how many ticks that was. The bound keeps a sleep that never ends
/// from hanging the suite.
fn sleep_through(sim: &mut Sim, person: Entity, mut each: impl FnMut(&Sim)) -> u32 {
    let mut ticks = 0;
    while asleep(sim, person) {
        assert!(ticks < 1_000, "the sleep ends");
        sim.tick();
        each(sim);
        ticks += 1;
    }
    ticks
}

fn asleep(sim: &Sim, person: Entity) -> bool {
    crate::systems::circadian::is_asleep(
        sim.world().resource::<Content>().0,
        sim.world().get::<terri_core::Eating>(person),
    )
}

fn request_to(sim: &Sim, from: Entity, to: Entity) -> Option<requests::ConversationRequest> {
    sim.world()
        .resource::<requests::ConversationRequests>()
        .requests
        .values()
        .find(|r| r.initiator == from && r.recipient == to)
        .cloned()
}

fn talking(sim: &Sim, a: Entity, b: Entity) -> bool {
    sim.world()
        .get::<Socialising>(a)
        .is_some_and(|s| s.partner == b)
        || sim
            .world()
            .get::<Socialising>(b)
            .is_some_and(|s| s.partner == a)
}

/// Ticks until `done` holds, at most `limit` times; returns whether it did.
fn tick_until(sim: &mut Sim, limit: u32, mut done: impl FnMut(&Sim) -> bool) -> bool {
    for _ in 0..limit {
        sim.tick();
        if done(sim) {
            return true;
        }
    }
    false
}

/// The number of conversation requests ever created. A chat chosen with a
/// sleeper would be given up later in the same tick, so a test of selection
/// counts requests created rather than requests seen after a tick.
fn requests_created(sim: &Sim) -> u64 {
    sim.world()
        .resource::<requests::ConversationRequests>()
        .next_id
}

/// The partner is equally out of reach in both runs, for the same number of
/// ticks; only the sleep tag differs. Awake at the fridge, the lonely housemate
/// chooses to wait for them; asleep, they choose nothing involving them.
#[test]
fn a_housemate_never_chooses_a_chat_with_a_sleeping_partner() {
    for (object, sleeping) in [(FRIDGE, false), (BED, true)] {
        let (mut sim, a, b) = household();
        start_using(&mut sim, b, object, 120);
        assert_eq!(asleep(&sim, b), sleeping);
        let before = requests_created(&sim);
        let asked = tick_until(&mut sim, 60, |sim| request_to(sim, a, b).is_some());
        if sleeping {
            assert!(asleep(&sim, b), "the partner sleeps throughout");
            assert!(!asked, "nobody chooses a chat with a sleeper");
            assert_eq!(
                requests_created(&sim),
                before,
                "no chat is chosen, not even one given up at once"
            );
            assert!(
                sim.world().get::<Target>(a).is_none_or(|t| t.object != b),
                "the lonely housemate does not approach the sleeper"
            );
        } else {
            assert!(asked, "a busy, awake partner is still worth waiting for");
        }
    }
}

/// The chat is chosen while the partner is busy and awake, then waits. When
/// the partner falls asleep the chat gives up and releases the asker, who
/// chooses nothing with the sleeper, and asks again once the partner wakes.
#[test]
fn a_chosen_chat_gives_up_when_its_partner_falls_asleep_and_asks_again_after_waking() {
    let (mut sim, a, b) = household();
    start_using(&mut sim, b, FRIDGE, 200);
    assert!(
        tick_until(&mut sim, 60, |sim| request_to(sim, a, b)
            .is_some_and(|r| r.phase == requests::RequestPhase::Waiting)),
        "the lonely housemate chooses to wait for the busy partner"
    );
    let first = request_to(&sim, a, b).unwrap();
    assert_eq!(first.origin, requests::ConversationOrigin::Autonomous);
    let logged = sim.activity_log().records().count();
    start_using(&mut sim, b, BED, 90);
    sim.tick();
    assert!(asleep(&sim, b));
    assert_eq!(request_to(&sim, a, b), None, "chat {} gives up", first.id);
    assert!(
        sim.world().get::<Target>(a).is_none_or(|t| t.object != b),
        "the asker stops waiting beside the sleeper"
    );
    assert!(
        sim.world()
            .get::<requests::CommittedConversation>(a)
            .is_none(),
        "the asker is free to choose something else"
    );
    assert_eq!(
        sim.activity_log().records().count(),
        logged,
        "a chat that never ran logs nothing, as other given-up chats do"
    );
    let created = requests_created(&sim);
    sleep_through(&mut sim, b, |sim| {
        assert_eq!(
            requests_created(sim),
            created,
            "no chat is chosen while the partner sleeps"
        );
    });
    assert!(
        tick_until(&mut sim, 120, |sim| talking(sim, a, b)),
        "after the partner wakes, the asker chooses the chat again and it runs"
    );
    let again = sim
        .world()
        .resource::<requests::ConversationRequests>()
        .requests
        .values()
        .find(|r| r.initiator == a && r.recipient == b)
        .map(|r| r.id);
    assert!(again.is_some_and(|id| id > first.id), "a new request");
}

/// A player's order is exempt: it waits beside a partner who falls asleep and
/// beside one already asleep, and the chat runs once the partner wakes.
#[test]
fn a_player_ordered_chat_keeps_waiting_for_a_sleeping_partner() {
    for falls_asleep in [true, false] {
        let (mut sim, a, b) = household();
        *sim.world_mut().get_mut::<Needs>(a).unwrap() = Needs::all_at(90.);
        if falls_asleep {
            start_using(&mut sim, b, FRIDGE, 30);
        } else {
            start_using(&mut sim, b, BED, 60);
        }
        talk(&mut sim, a, b);
        sim.tick();
        let id = sim.world().get::<IntentQueue>(a).unwrap().entries()[0].id;
        if falls_asleep {
            for _ in 0..10 {
                sim.tick();
            }
            start_using(&mut sim, b, BED, 60);
        }
        let slept_beside = sleep_through(&mut sim, b, |sim| {
            assert!(
                sim.world()
                    .get::<IntentQueue>(a)
                    .unwrap()
                    .order(id)
                    .is_some(),
                "falls asleep {falls_asleep}: order {id} keeps waiting"
            );
        });
        assert!(slept_beside > 30, "falls asleep {falls_asleep}: it waited");
        assert!(
            tick_until(&mut sim, 120, |sim| sim
                .world()
                .get::<Socialising>(a)
                .is_some_and(|s| s.partner == b)),
            "falls asleep {falls_asleep}: the ordered chat runs after waking"
        );
    }
}

/// A waiting chat loaded from an older save without a recorded origin may
/// have come from a player's order, so, as with pull request 302's give-up,
/// it is exempt and keeps waiting. A chosen chat in the same position, waiting
/// or suspended, gives up.
#[test]
fn only_a_chosen_chat_gives_up_and_an_unattributed_legacy_chat_keeps_waiting() {
    for (origin, phase, stays) in [
        (
            requests::ConversationOrigin::LegacyUnattributed,
            requests::RequestPhase::Waiting,
            true,
        ),
        (
            requests::ConversationOrigin::Autonomous,
            requests::RequestPhase::Waiting,
            false,
        ),
        (
            requests::ConversationOrigin::Autonomous,
            requests::RequestPhase::Suspended,
            false,
        ),
    ] {
        let (mut sim, a, b) = household();
        start_using(&mut sim, b, BED, 200);
        let id = requests::enqueue(
            sim.world_mut(),
            a,
            b,
            0,
            requests::ConversationOrigin::Autonomous,
        )
        .unwrap();
        {
            let mut state = sim
                .world_mut()
                .resource_mut::<requests::ConversationRequests>();
            let request = state.requests.get_mut(&id).unwrap();
            request.origin = origin;
            request.phase = phase;
        }
        requests::before_movement(sim.world_mut());
        assert_eq!(
            request_to(&sim, a, b).is_some(),
            stays,
            "{origin:?} {phase:?} beside a sleeper"
        );
    }
}
