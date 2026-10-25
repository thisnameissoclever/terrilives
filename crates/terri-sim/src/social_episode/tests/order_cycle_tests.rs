//! Issue 301: a person who only waits for their own conversation or fight is
//! not busy, so orders and pending chats cannot wait on each other forever.
use super::*;
use crate::fights::FIGHT_TAG;
use std::collections::BTreeSet;

const CHAT: u32 = 0;
const FIGHT: u32 = 1;

fn three_people() -> (Sim, Entity, Entity, Entity) {
    three_people_on(12, 8)
}

/// `three_people` on a `width` by `height` lot. A lot of 16 by 12 reaches
/// the shipped front door at (15, 2), so a shift can start there.
fn three_people_on(width: usize, height: usize) -> (Sim, Entity, Entity, Entity) {
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
    let mut sim = test_content::sim_with(width, height, pack);
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
    attributed_system_fight(sim, person, partner)
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

type Talk = (Entity, Entity, u32);

/// Records every conversation seen and how many times each one started.
#[derive(Default)]
struct Recorder {
    current: BTreeSet<Talk>,
    seen: BTreeSet<Talk>,
    starts: std::collections::BTreeMap<Talk, u32>,
}

impl Recorder {
    fn tick(&mut self, sim: &mut Sim) {
        sim.tick();
        let now: BTreeSet<Talk> = sim
            .world_mut()
            .query::<(Entity, &Socialising)>()
            .iter(sim.world())
            .map(|(person, talk)| (person, talk.partner, talk.interaction))
            .collect();
        for talk in now.difference(&self.current) {
            *self.starts.entry(*talk).or_default() += 1;
        }
        self.seen.extend(now.iter().copied());
        self.current = now;
    }

    /// Ticks until every expected conversation has run.
    fn until(&mut self, sim: &mut Sim, expected: &[Talk]) {
        for _ in 0..1_500 {
            self.tick(sim);
            if expected.iter().all(|e| self.seen.contains(e)) {
                break;
            }
        }
    }
}

fn run(sim: &mut Sim, expected: &[Talk]) -> BTreeSet<Talk> {
    let mut recorder = Recorder::default();
    recorder.until(sim, expected);
    recorder.seen
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
        let expected = if player_ordered {
            vec![(bill, tim, FIGHT), (tim, bill, CHAT)]
        } else {
            vec![(tim, bill, CHAT)]
        };
        let mut recorder = Recorder::default();
        for _ in 0..1500 {
            recorder.tick(&mut sim);
            if expected.iter().all(|talk| recorder.seen.contains(talk))
                && [bill, casey].into_iter().all(|person| {
                    sim.world()
                        .get::<IntentQueue>(person)
                        .is_none_or(IntentQueue::is_empty)
                })
                && sim
                    .world()
                    .resource::<requests::ConversationRequests>()
                    .requests
                    .get(&chat)
                    .is_some_and(|r| r.phase == requests::RequestPhase::Talking)
            {
                break;
            }
        }
        let seen = recorder.seen.clone();
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
        // Long enough for a duplicated fight to start again after the first.
        for _ in 0..300 {
            recorder.tick(&mut sim);
        }
        for fight in [(bill, tim, FIGHT), (casey, bill, FIGHT)] {
            assert!(
                recorder.starts.get(&fight).is_none_or(|count| *count == 1),
                "player_ordered={player_ordered}: {fight:?} is never duplicated"
            );
        }
        let served = [(bill, tim, FIGHT), (casey, bill, FIGHT)]
            .into_iter()
            .filter(|fight| recorder.seen.contains(fight))
            .count();
        assert_eq!(served,1,"the first completed argument puts Bill on cooldown and withdraws the other automatic order");
        if player_ordered {
            assert!(
                !recorder.seen.contains(&(casey, bill, FIGHT)),
                "the protected player fight completes; Casey's automatic request is withdrawn"
            );
        }
        for person in [tim, bill, casey] {
            assert!(
                sim.world()
                    .get::<IntentQueue>(person)
                    .is_none_or(IntentQueue::is_empty),
                "player_ordered={player_ordered}: no order is left waiting"
            );
        }
    }
}

/// Opposite fight orders between two people, with a third person waiting to
/// chat with one of them, all finish.
#[test]
fn mutual_fight_orders_beside_a_pending_chat_all_finish() {
    let (mut sim, tim, bill, casey) = three_people();
    player_fight(&mut sim, tim, bill);
    player_fight(&mut sim, bill, tim);
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
    player_fight(&mut sim, casey, bill);
    player_fight(&mut sim, bill, tim);
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
            let automatic = if player_ordered {
                player_fight(&mut sim, bill, tim);
                None
            } else {
                Some(game_fight(&mut sim, bill, tim))
            };
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
                        .is_none_or(|t| t.object != tim || t.interaction != FIGHT),
                    "{case}: the withdrawn fight releases its approach"
                );
                let automatic = automatic.unwrap();
                assert!(
                    !sim.world()
                        .resource::<crate::fights::Fights>()
                        .owns_order(bill, automatic),
                    "{case}: the exact system identity is retired"
                );
                let conflicts = sim.world().resource::<crate::social_conflicts::State>();
                assert!(
                    conflicts
                        .pending_fights
                        .get(&bill)
                        .is_none_or(|row| row.order_id != Some(automatic)),
                    "{case}: the exact pending cause is retired"
                );
                assert!(
                    conflicts
                        .fights
                        .get(&bill)
                        .is_none_or(|row| !row.autonomous || row.order_id != Some(automatic)),
                    "{case}: the exact running cause is retired"
                );
                let episodes = sim.world().resource::<SocialEpisodes>();
                assert!(episodes.executions.get(&bill).is_none_or(|execution|!matches!(execution.owner,ExecutionOwner::System(Some(id)) if id==automatic)),"{case}: the exact system fight owns no execution");
                if sim.world().get::<Reserved>(tim).is_some() {
                    let replacement = episodes.rendezvous.get(&tim).is_some_and(|owner| {
                        sim.world().get::<Target>(*owner).is_some_and(|target| {
                            target.object == tim && (*owner != bill || target.interaction != FIGHT)
                        })
                    }) || sim
                        .world_mut()
                        .query::<(Entity, &Socialising)>()
                        .iter(sim.world())
                        .any(|(owner, talk)| {
                            talk.partner == tim && (owner != bill || talk.interaction != FIGHT)
                        });
                    assert!(replacement,"{case}: a retained reservation must belong to another actual conversation, not the withdrawn fight");
                }
            }
        }
    }
}

/// Whether `person` is in the fight against `partner`.
fn fighting(sim: &Sim, person: Entity, partner: Entity) -> bool {
    sim.world()
        .get::<Socialising>(person)
        .is_some_and(|talk| talk.partner == partner && talk.interaction == FIGHT)
}

/// Starts a game-made fight from Bill against Tim and ticks until it has run
/// for a few ticks. Returns the fight's order id.
fn running_game_fight(sim: &mut Sim, bill: Entity, tim: Entity) -> u64 {
    let id = game_fight(sim, bill, tim);
    let mut ticks = 0;
    while !fighting(sim, bill, tim) {
        assert!(ticks < 200, "the fight starts");
        sim.tick();
        ticks += 1;
    }
    for _ in 0..5 {
        sim.tick();
    }
    assert!(fighting(sim, bill, tim), "the fight runs");
    id
}

/// Whether `person` holds the Had a fight moodlet, which only a finished
/// fight records.
fn had_a_fight(sim: &Sim, person: Entity) -> bool {
    let id = *sim.world().get::<SimId>(person).unwrap();
    sim.world()
        .resource::<crate::fights::Fights>()
        .entries()
        .iter()
        .any(|(who, _)| *who == id)
}

/// Issue 342: the issue 301 ruling withdraws a game-made fight for a crisis
/// only while it waits. That ruling, as `docs/specs/2026-10-16-fights.md`
/// records it, lets a fight already under way run to its end, so when either side's Hunger,
/// Energy or Bladder turns critical mid-fight the fight keeps its order,
/// finishes, and records its outcome on both sides.
#[test]
fn a_running_game_made_fight_finishes_through_either_sides_crisis() {
    for need in [NeedId::Hunger, NeedId::Energy, NeedId::Bladder] {
        for critical_recipient in [false, true] {
            let case = format!("{need:?} critical_recipient={critical_recipient}");
            let (mut sim, tim, bill, _casey) = three_people();
            let id = running_game_fight(&mut sim, bill, tim);
            let critical = if critical_recipient { tim } else { bill };
            sim.world_mut()
                .get_mut::<Needs>(critical)
                .unwrap()
                .set(need, 5.);
            assert!(
                crate::social_episode::urgent(sim.world(), critical),
                "{case}: the crisis is real"
            );
            let mut ticks = 0;
            while fighting(&sim, bill, tim) {
                assert!(ticks < 200, "{case}: the fight ends");
                sim.tick();
                ticks += 1;
                if fighting(&sim, bill, tim) {
                    assert!(
                        sim.world()
                            .resource::<crate::fights::Fights>()
                            .owns_order(bill, id),
                        "{case}: the running fight keeps its order"
                    );
                }
            }
            assert!(ticks > 1, "{case}: the fight runs on after the crisis");
            for person in [bill, tim] {
                assert!(
                    had_a_fight(&sim, person),
                    "{case}: the finished fight records its outcome"
                );
            }
        }
    }
}

/// Gives `worker` a job whose shift starts two ticks from now, every day.
fn employ_from_two_ticks_on(sim: &mut Sim, worker: Entity) {
    let now = sim.world().resource::<crate::SimClock>().tick;
    let mut pack = sim.world().resource::<Content>().0.clone();
    let day_ticks = u64::from(pack.tuning.day_ticks);
    pack.careers = vec![terri_data::CompiledCareer {
        id: "office_job".into(),
        label: "Office clerk".into(),
        shift_start: ((now + 2) % day_ticks) as u32,
        shift_ticks: 60,
        pay: 130,
        energy_cost: 0.,
        satisfaction: 0.,
        working_days: 0b111_1111,
        path: 0,
        level: 0,
        pay_max: 130,
        advance_weeks: 1,
        social_demand: 0.,
        skill_tag: None,
        trait_fit: Vec::new(),
        standard_kind: terri_data::SHIFT_DAY,
        standard_weight: 1,
        shifts: Vec::new(),
    }];
    sim.world_mut()
        .insert_resource(Content(Box::leak(Box::new(pack))));
    sim.world_mut()
        .entity_mut(worker)
        .insert(terri_core::Career(0));
}

/// Whether `worker` is commuting or at work.
fn away(sim: &Sim, worker: Entity) -> bool {
    sim.world().get::<terri_core::Commuting>(worker).is_some()
        || sim.world().get::<terri_core::AtWork>(worker).is_some()
}

/// Leaving for work is the crisis that can begin mid-fight without a need.
/// When the recipient's shift starts, the departure ends the conversation,
/// as it ends a chat: the game-made fight stops with no outcome, its order
/// is retired and it does not start again while the recipient is away. So
/// letting a running fight finish through a crisis never strands it.
#[test]
fn a_recipients_shift_start_ends_a_running_game_made_fight() {
    let (mut sim, tim, bill, _casey) = three_people_on(16, 12);
    let id = running_game_fight(&mut sim, bill, tim);
    employ_from_two_ticks_on(&mut sim, tim);
    let mut ticks = 0;
    while !away(&sim, tim) {
        assert!(ticks < 5, "the shift starts");
        assert!(fighting(&sim, bill, tim), "the fight runs until then");
        sim.tick();
        ticks += 1;
    }
    sim.tick();
    for _ in 0..30 {
        assert!(away(&sim, tim), "the recipient is still away");
        assert!(!fighting(&sim, bill, tim), "the departure ends the fight");
        assert!(
            !sim.world()
                .resource::<crate::fights::Fights>()
                .owns_order(bill, id),
            "the fight's order is retired"
        );
        assert!(
            sim.world()
                .get::<IntentQueue>(bill)
                .is_none_or(|q| q.entries().iter().all(|e| e.id != id)),
            "the fight's order leaves the queue"
        );
        sim.tick();
    }
    for person in [bill, tim] {
        assert!(
            !had_a_fight(&sim, person),
            "a fight ended by a departure records no outcome"
        );
    }
}

/// The initiator does not leave for work mid-fight in the current rules: a
/// shift start waits while its worker's queue holds any order
/// (`player_actions::has_player_work`), and a game-made fight is a queued
/// order. The fight finishes with its outcome and the initiator leaves
/// afterwards. This records how the two rules meet today; a later ruling on
/// whether a game-made order may delay a shift would change it.
#[test]
fn an_initiators_shift_start_waits_for_a_running_game_made_fight() {
    let (mut sim, tim, bill, _casey) = three_people_on(16, 12);
    running_game_fight(&mut sim, bill, tim);
    employ_from_two_ticks_on(&mut sim, bill);
    let mut ticks = 0;
    while fighting(&sim, bill, tim) {
        assert!(ticks < 200, "the fight ends");
        assert!(!away(&sim, bill), "the initiator stays for the fight");
        sim.tick();
        ticks += 1;
    }
    assert!(ticks > 2, "the shift fell due while the fight ran");
    for person in [bill, tim] {
        assert!(had_a_fight(&sim, person), "the fight finishes");
    }
    let mut ticks = 0;
    while !away(&sim, bill) {
        assert!(ticks < 5, "the initiator then leaves for the shift");
        sim.tick();
        ticks += 1;
    }
}

/// A chat the cycle fix suspended for an order gives up cleanly when its
/// initiator turns critically hungry: the order's claim on the initiator and
/// its conversation are untouched, and the chat does not come back.
#[test]
fn a_chat_suspended_by_an_order_gives_up_cleanly_in_a_crisis() {
    let (mut sim, tim, bill, _casey) = three_people();
    let chat = pending_chat(&mut sim, tim, bill);
    player_fight(&mut sim, bill, tim);
    let phase = |sim: &Sim| {
        sim.world()
            .resource::<requests::ConversationRequests>()
            .requests
            .get(&chat)
            .map(|r| r.phase)
    };
    for _ in 0..50 {
        sim.tick();
        if phase(&sim) == Some(requests::RequestPhase::Suspended) {
            break;
        }
    }
    assert_eq!(
        phase(&sim),
        Some(requests::RequestPhase::Suspended),
        "the order suspends the waiting chat"
    );
    assert!(
        sim.world().get::<Reserved>(tim).is_some(),
        "the order claims Tim"
    );
    sim.world_mut()
        .get_mut::<Needs>(tim)
        .unwrap()
        .set(NeedId::Hunger, 5.);
    sim.tick();
    assert_eq!(phase(&sim), None, "the suspended chat gives up");
    assert!(
        sim.world().get::<Reserved>(tim).is_some(),
        "the order keeps its claim on Tim through the give-up"
    );
    assert!(
        sim.world()
            .get::<requests::CommittedConversation>(tim)
            .is_none(),
        "no commitment marker is left behind"
    );
    let mut recorder = Recorder::default();
    recorder.until(&mut sim, &[(bill, tim, FIGHT)]);
    assert!(
        recorder.seen.contains(&(bill, tim, FIGHT)),
        "the player's fight still runs"
    );
    // A suspended chat would normally resume once the fight ends, so keep
    // watching past the fight's end before checking that it never returns.
    for _ in 0..1_500 {
        recorder.tick(&mut sim);
        if !recorder.current.contains(&(bill, tim, FIGHT)) {
            break;
        }
    }
    assert!(
        !recorder.current.contains(&(bill, tim, FIGHT)),
        "the fight ends"
    );
    for _ in 0..300 {
        recorder.tick(&mut sim);
    }
    assert!(
        !recorder.seen.contains(&(tim, bill, CHAT)),
        "the abandoned chat does not resume"
    );
}
