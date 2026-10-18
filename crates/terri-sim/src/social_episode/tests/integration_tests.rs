use super::*;

#[test]
fn autonomous_admission_and_player_waiting_have_one_physical_owner() {
    let (mut sim, a, b) = chat_fixture();
    let identity = sim.world_mut().resource_mut::<SimIdAllocator>().issue();
    let c = sim
        .world_mut()
        .spawn((
            Agent,
            identity,
            Position { x: 2., y: 4. },
            Needs::all_at(90.),
        ))
        .id();
    let request = requests::enqueue(
        sim.world_mut(),
        a,
        b,
        0,
        requests::ConversationOrigin::Autonomous,
    )
    .unwrap();
    requests::before_movement(sim.world_mut());
    assert!(sim
        .world()
        .resource::<requests::ConversationRequests>()
        .admitted(a, b));
    talk(&mut sim, c, b);
    sim.flush_commands();
    let order = sim.world().get::<IntentQueue>(c).unwrap().entries()[0].id;
    for _ in 0..12 {
        let episodes = sim.world().resource::<SocialEpisodes>();
        assert!(!episodes.executions.contains_key(&a));
        assert!(episodes.executions.get(&c).is_none_or(|e| !e.admitted));
        assert!(sim
            .world()
            .resource::<requests::ConversationRequests>()
            .requests
            .contains_key(&request));
        assert!(sim
            .world()
            .get::<IntentQueue>(c)
            .unwrap()
            .order(order)
            .is_some());
        sim.tick();
    }
    for _ in 0..220 {
        sim.tick();
    }
    assert_eq!(
        sim.action_events_since(0)
            .events
            .iter()
            .filter(|e| e.actor == c.index_u32() && e.order_id == order && e.phase == "completed")
            .count(),
        1
    );
}

#[test]
fn published_player_request_mirrors_never_acquire_autonomous_markers() {
    let (mut sim, a, b) = chat_fixture();
    talk(&mut sim, a, b);
    talk(&mut sim, a, b);
    sim.flush_commands();
    let first = sim.world().get::<IntentQueue>(a).unwrap().entries()[0].id;
    let requests = requests::snapshot(sim.world());
    assert_eq!(
        requests
            .requests
            .values()
            .filter(|r| r.initiator == a
                && r.origin == requests::ConversationOrigin::Player { order_id: first })
            .count(),
        1
    );
    requests::before_choices(sim.world_mut());
    requests::before_movement(sim.world_mut());
    assert!(sim
        .world()
        .get::<requests::CommittedConversation>(a)
        .is_none());
    assert_eq!(execution_order(sim.world(), a), Some(first));
    assert_eq!(
        sim.world().resource::<SocialEpisodes>().rendezvous.get(&b),
        Some(&a)
    );
    assert_eq!(sim.world().get::<IntentQueue>(a).unwrap().len(), 2);
}

#[test]
fn current_save_rejects_disagreement_between_published_request_and_exact_execution() {
    let (mut sim, a, b) = chat_fixture();
    talk(&mut sim, a, b);
    talk(&mut sim, a, b);
    sim.flush_commands();
    let mut saved = sim.save_snapshot_v17();
    let second = sim.world().get::<IntentQueue>(a).unwrap().entries()[1].id;
    let request = saved
        .legacy
        .legacy
        .conversation_requests
        .requests
        .iter_mut()
        .find(|r| {
            matches!(
                r.origin,
                terri_core::save_v15::SavedConversationOrigin::Player { .. }
            )
        })
        .unwrap();
    request.origin = terri_core::save_v15::SavedConversationOrigin::Player { order_id: second };
    let before = sim.world_hash();
    assert!(sim.load_snapshot_v17(saved).is_err());
    assert_eq!(sim.world_hash(), before);
}

#[test]
fn retained_autonomous_admission_does_not_compete_with_itself() {
    let (mut sim, a, b) = chat_fixture();
    let request = requests::enqueue(
        sim.world_mut(),
        a,
        b,
        0,
        requests::ConversationOrigin::Autonomous,
    )
    .unwrap();
    requests::before_movement(sim.world_mut());
    assert!(sim
        .world()
        .resource::<requests::ConversationRequests>()
        .admitted(a, b));
    assert!(sim.world().get::<Reserved>(b).is_some());
    // Production maintenance retains this admission in the participant plan
    // before the next autonomy pass rechecks its original request.
    maintain(sim.world_mut());
    assert_eq!(
        sim.world().resource::<SocialEpisodes>().incoming.get(&b),
        Some(&a)
    );
    for _ in 0..4 {
        requests::before_choices(sim.world_mut());
        requests::before_movement(sim.world_mut());
        let state = sim.world().resource::<requests::ConversationRequests>();
        assert_eq!(
            state.requests[&request].phase,
            requests::RequestPhase::Approaching,
            "the retained autonomous owner must not be treated as its own competitor"
        );
        assert!(state.admitted(a, b));
        assert!(sim.world().get::<Reserved>(b).is_some());
        assert_eq!(
            sim.world().resource::<SocialEpisodes>().rendezvous.get(&b),
            Some(&a)
        );
    }
}

#[test]
fn player_retarget_finishes_the_current_fractional_segment_before_turning() {
    let (mut sim, a, b) = chat_fixture();
    talk(&mut sim, a, b);
    sim.tick();
    assert_eq!(sim.world().get::<Position>(a).unwrap().x, 1.25);
    assert_eq!(
        sim.world().get::<Path>(a).unwrap().next_step(),
        Some((2, 1))
    );
    sim.world_mut()
        .entity_mut(b)
        .insert(Position { x: 0., y: 1. });
    for expected in [1.5, 1.75, 2.] {
        crate::systems::interpersonal::prepare(sim.world_mut());
        maintain(sim.world_mut());
        assert_eq!(
            sim.world().get::<Path>(a).unwrap().next_step(),
            Some((2, 1)),
            "moving a player recipient cannot reverse the unfinished segment"
        );
        sim.world_mut()
            .run_system_once(crate::systems::movement::follow_path)
            .unwrap();
        assert_eq!(sim.world().get::<Position>(a).unwrap().x, expected);
    }
    maintain(sim.world_mut());
    assert_eq!(
        sim.world().get::<Path>(a).unwrap().next_step(),
        Some((1, 1)),
        "the player route turns after reaching its next tile"
    );
}

#[test]
fn current_save_rejects_shared_autonomous_and_fight_participants() {
    let (mut sim, a, b) = chat_fixture();
    let mut pack = sim.world().resource::<Content>().0.clone();
    pack.reading = terri_data::pack().reading;
    let mut fight = test_content::interaction("fight", &[], 40);
    fight.tags = vec![crate::fights::FIGHT_TAG.into()];
    pack.social.push(fight);
    sim.world_mut()
        .insert_resource(Content(Box::leak(Box::new(pack))));
    sim.world_mut().get_mut::<Position>(a).unwrap().x = 6.;
    let identity = sim.world_mut().resource_mut::<SimIdAllocator>().issue();
    let c = sim
        .world_mut()
        .spawn((
            Agent,
            identity,
            Position { x: 8., y: 1. },
            Needs::all_at(90.),
        ))
        .id();
    start(&mut sim, a, b, 30);
    sim.world_mut().entity_mut(c).insert((
        Target {
            object: b,
            interaction: 1,
        },
        Socialising {
            partner: b,
            interaction: 1,
            remaining_ticks: 30,
        },
    ));
    let invalid = sim.save_snapshot_v17();
    assert_eq!(
        invalid.legacy.legacy.conversation_requests.requests.len(),
        1
    );
    assert_eq!(invalid.social_executions.len(), 1);
    assert_eq!(invalid.social_executions[0].provenance, 2);
    let before = sim.world_hash();
    assert!(
        sim.load_snapshot_v17(invalid).is_err(),
        "individually valid autonomous and fight records cannot share a physical recipient"
    );
    assert_eq!(
        sim.world_hash(),
        before,
        "invalid mixed ownership must reject transactionally"
    );
}

#[test]
fn explicit_front_social_redirect_releases_autonomous_listener_and_retains_request() {
    let (mut sim, a, b) = chat_fixture();
    sim.world_mut().get_mut::<Position>(a).unwrap().x = 6.;
    let identity = sim.world_mut().resource_mut::<SimIdAllocator>().issue();
    let c = sim
        .world_mut()
        .spawn((
            Agent,
            identity,
            Position { x: 4., y: 4. },
            Needs::all_at(90.),
        ))
        .id();
    let original = requests::enqueue(
        sim.world_mut(),
        a,
        b,
        0,
        requests::ConversationOrigin::Autonomous,
    )
    .unwrap();
    crate::systems::interpersonal::prepare(sim.world_mut());
    requests::before_movement(sim.world_mut());
    sim.world_mut()
        .run_system_once(crate::systems::movement::follow_path)
        .unwrap();
    assert_eq!(
        sim.world().get::<Socialising>(a).map(|s| s.partner),
        Some(b)
    );
    assert_eq!(
        sim.world()
            .resource::<requests::ConversationRequests>()
            .requests[&original]
            .phase,
        requests::RequestPhase::Talking
    );
    sim.world_mut()
        .resource_mut::<CommandQueue>()
        .push(SimCommand::TalkToFirst {
            agent: b.index_u32(),
            target: c.index_u32(),
            interaction: 0,
        });
    sim.flush_commands();
    assert!(
        sim.world().get::<Socialising>(a).is_none(),
        "the passive autonomous listener can accept a new explicit front social order"
    );
    assert_eq!(
        sim.world().get::<Target>(b).map(|target| target.object),
        Some(c)
    );
    let state = sim.world().resource::<requests::ConversationRequests>();
    let retained = state
        .requests
        .get(&original)
        .expect("redirecting the listener retains the initiator's request identity");
    assert!(matches!(
        retained.phase,
        requests::RequestPhase::Waiting | requests::RequestPhase::Suspended
    ));
    assert!(!state.admitted(a, b));
    let mut resumed = false;
    for _ in 0..240 {
        sim.tick();
        if sim
            .world()
            .get::<Socialising>(a)
            .is_some_and(|talk| talk.partner == b)
        {
            let request = &sim
                .world()
                .resource::<requests::ConversationRequests>()
                .requests[&original];
            assert_eq!(request.phase, requests::RequestPhase::Talking);
            resumed = true;
            break;
        }
    }
    assert!(
        resumed,
        "the original autonomous request resumes after the listener's front order"
    );
}
