use crate::{Content, Sim};
use terri_core::{Eating, Facing, Intent, IntentQueue, Path, Position, Target};

#[test]
fn needs_correction_media_gains_only_the_occupied_seats_comfort() {
    for kind in ["television", "radio"] {
        for (seat_x, seat_y, seated) in [(5., 3., true), (10., 12., false)] {
            let (mut sim, person, _, _) = fixture_at(kind, seat_x, seat_y, Facing::SouthWest);
            sim.world_mut()
                .entity_mut(person)
                .insert(terri_core::Personality::neutral());
            for _ in 0..120 {
                sim.tick();
                if sim.world().get::<Eating>(person).is_some() {
                    break;
                }
            }
            assert!(sim.world().get::<Eating>(person).is_some());
            assert_eq!(
                crate::seating::claim(sim.world(), person.index_u32()).is_some(),
                seated
            );
            sim.world_mut()
                .get_mut::<terri_core::Needs>(person)
                .unwrap()
                .set(terri_core::NeedId::Comfort, 30.);
            sim.world_mut()
                .get_mut::<terri_core::Needs>(person)
                .unwrap()
                .set(terri_core::NeedId::Energy, 30.);
            sim.world_mut()
                .get_mut::<terri_core::Needs>(person)
                .unwrap()
                .set(terri_core::NeedId::Fun, 30.);
            sim.tick();
            let expected = 30. - 0.032 + if seated { 29. / 41. } else { 0. };
            let actual = sim
                .world()
                .get::<terri_core::Needs>(person)
                .unwrap()
                .get(terri_core::NeedId::Comfort);
            assert!(
                (actual - expected).abs() < 0.00001,
                "{kind}, seated={seated}: {actual} != {expected}"
            );
            let levels = sim.world().get::<terri_core::Needs>(person).unwrap();
            let action = &sim
                .world()
                .resource::<Content>()
                .0
                .object(sim.world().resource::<Content>().0.find(kind).unwrap())
                .interactions[0];
            let fun = action
                .advertises
                .iter()
                .find(|(n, _)| *n as usize == terri_core::NeedId::Fun.index())
                .unwrap()
                .1;
            assert!(
                (levels.get(terri_core::NeedId::Fun)
                    - (30. - 0.048 + fun / action.duration_ticks as f32))
                    .abs()
                    < 0.00001
            );
            assert!((levels.get(terri_core::NeedId::Energy) - (30. - 0.051)).abs() < 0.00001);
            let endpoint = crate::seating::claim(sim.world(), person.index_u32())
                .map_or((0, 3), |lease| lease.endpoint);
            sim.world_mut().entity_mut(person).insert(Path {
                steps: vec![endpoint],
                cursor: 0,
            });
            let before = *sim.world().get::<terri_core::Needs>(person).unwrap();
            crate::need_interactions::tick(sim.world_mut());
            assert_eq!(
                *sim.world().get::<terri_core::Needs>(person).unwrap(),
                before,
                "A reserved seat supplies no Comfort while traveling"
            );
        }
    }
}

#[test]
fn secondary_seats_supply_their_own_rate_without_fun_or_reclining_energy() {
    use terri_core::{NeedId, Needs};
    for (kind, facing, rate) in [
        ("chair", Facing::SouthWest, 37. / 62.),
        ("desk_chair", Facing::SouthWest, 37. / 62.),
        ("armchair", Facing::SouthWest, 29. / 41.),
        ("reading_chair", Facing::NorthWest, 29. / 41.),
        ("long_sofa", Facing::SouthWest, 43. / 72.),
        ("sofa", Facing::SouthEast, 20. / 40.),
    ] {
        let (mut sim, person, _, _) = fixture_with_device(
            "television",
            Position { x: 2., y: 3. },
            Position { x: 5., y: 3. },
            Facing::SouthEast,
            facing,
            kind,
        );
        if kind == "sofa" {
            let pack = sim.world().resource::<Content>().0;
            let ottoman = pack.object(pack.find(kind).unwrap());
            assert_eq!(ottoman.metadata.as_ref().unwrap().type_id, "ottoman");
            let lounge = ottoman
                .interactions
                .iter()
                .find(|a| a.id == "lounge")
                .unwrap();
            assert!(!lounge.book_reading);
            assert_eq!(lounge.duration_ticks, 40);
            assert_eq!(lounge.advertises, [(NeedId::Comfort.index() as u8, 20.)]);
        }
        sim.world_mut()
            .entity_mut(person)
            .insert(terri_core::Personality::neutral());
        for _ in 0..120 {
            sim.tick();
            if sim.world().get::<Eating>(person).is_some() {
                break;
            }
        }
        assert!(
            crate::seating::claim(sim.world(), person.index_u32()).is_some(),
            "{kind} must actually be occupied"
        );
        *sim.world_mut().get_mut::<Needs>(person).unwrap() = Needs::all_at(30.);
        crate::need_interactions::tick(sim.world_mut());
        let needs = sim.world().get::<Needs>(person).unwrap();
        assert!(
            (needs.get(NeedId::Comfort) - (30. + rate)).abs() < 0.00001,
            "{kind}"
        );
        assert_eq!(
            needs.get(NeedId::Fun),
            30.,
            "A chair is not the entertainment source"
        );
        assert_eq!(needs.get(NeedId::Energy), 30., "Sitting is not reclining");
    }
}

#[test]
fn nuisance_crossing_zero_stops_social_that_minute_but_keeps_chair_comfort() {
    use terri_core::{Affinities, NeedId, Needs, Personality, Relationships, SimId};
    let (mut sim, first, device, _) = fixture_at("television", 5., 3., Facing::SouthWest);
    let mut pack = sim.world().resource::<Content>().0.clone();
    pack.tuning.relationships.proximity_per_hour = 0.;
    pack.tuning.relationships.friction_per_hour = 0.;
    let pack = Box::leak(Box::new(pack));
    sim.world_mut().insert_resource(Content(pack));
    sim.world_mut()
        .entity_mut(first)
        .insert(Personality::neutral());
    for _ in 0..120 {
        sim.tick();
        if sim.world().get::<Eating>(first).is_some() {
            break;
        }
    }
    assert!(crate::seating::claim(sim.world(), first.index_u32()).is_some());
    let second = crate::household::spawn_member(
        sim.world_mut(),
        &pack.personalities,
        &pack.traits,
        crate::household::Member {
            name: "Co-viewer".into(),
            personality: 0,
            position: Position { x: 3., y: 3. },
            needs: [100.; 7],
            hobbies: vec![],
            traits: &[],
            career: None,
            instinct: Some(50),
        },
    );
    sim.world_mut().entity_mut(second).insert((
        Personality::neutral(),
        Affinities::from_values(vec![0.; pack.affinities.len()]),
        Target {
            object: device,
            interaction: 0,
        },
        Eating {
            object: pack.find("television").unwrap(),
            interaction: 0,
            remaining_ticks: 1000,
        },
    ));
    let other = *sim.world().get::<SimId>(second).unwrap();
    let mut feelings = Relationships::default();
    feelings.bump(other, 0.0001);
    let mut likes = vec![0.; pack.affinities.len()];
    let television = pack
        .affinities
        .iter()
        .position(|a| a.id == "television")
        .unwrap();
    likes[television] = -1.;
    sim.world_mut().entity_mut(first).insert((
        feelings,
        Affinities::from_values(likes),
        Needs::all_at(30.),
    ));
    sim.tick();
    assert!(
        sim.world()
            .get::<Relationships>(first)
            .unwrap()
            .feeling(other)
            < 0.,
        "Nuisance must really cross zero"
    );
    let needs = sim.world().get::<Needs>(first).unwrap();
    assert!(
        (needs.get(NeedId::Social) - (30. - pack.decay_per_tick[NeedId::Social.index()])).abs()
            < 0.00001,
        "Social uses the current feeling after nuisance"
    );
    assert!(
        (needs.get(NeedId::Comfort)
            - (30. - pack.decay_per_tick[NeedId::Comfort.index()] + 29. / 41.))
            .abs()
            < 0.00001,
        "The chair remains physically comfortable"
    );
}

#[test]
fn solo_media_does_not_refill_social() {
    for kind in ["television", "radio"] {
        let (mut sim, person, _, _) = fixture_at(kind, 5., 3., Facing::SouthWest);
        sim.world_mut()
            .get_mut::<terri_core::Needs>(person)
            .unwrap()
            .set(terri_core::NeedId::Social, 30.);
        for _ in 0..120 {
            sim.tick();
            if sim.world().get::<Eating>(person).is_some() {
                break;
            }
        }
        assert!(
            sim.world().get::<Eating>(person).is_some(),
            "{kind} must actually start"
        );
        let before = sim
            .world()
            .get::<terri_core::Needs>(person)
            .unwrap()
            .get(terri_core::NeedId::Social);
        sim.tick();
        let after = sim
            .world()
            .get::<terri_core::Needs>(person)
            .unwrap()
            .get(terri_core::NeedId::Social);
        assert!(
            after < before,
            "Solo {kind} raised Social from {before} to {after}"
        );
    }
}

#[test]
fn waiting_for_media_without_liked_company_does_not_claim_social_relief() {
    let (mut sim, person, television, _) = fixture_at("television", 10., 12., Facing::SouthWest);
    let pack = sim.world().resource::<Content>().0;
    for (id, x) in [(101, 3.), (102, 4.)] {
        sim.world_mut().spawn((
            terri_core::Agent,
            terri_core::SimId(id),
            Position { x, y: 3. },
            terri_core::Needs::all_at(100.),
            Target {
                object: television,
                interaction: 0,
            },
            Eating {
                object: pack.find("television").unwrap(),
                interaction: 0,
                remaining_ticks: 100,
            },
        ));
    }
    sim.world_mut()
        .entity_mut(television)
        .insert(terri_core::Reserved);
    sim.world_mut()
        .get_mut::<terri_core::Needs>(person)
        .unwrap()
        .set(terri_core::NeedId::Social, 0.);
    sim.tick();
    let waiting = sim
        .world()
        .get::<crate::waiting::WaitingNeeds>(person)
        .expect("The queued request really waits for a slot");
    assert_eq!(waiting.0 & (1 << terri_core::NeedId::Social.index()), 0);
    assert_ne!(waiting.0 & (1 << terri_core::NeedId::Fun.index()), 0);
}

#[test]
fn standing_shared_media_saves_preserve_capacity_and_distinct_endpoints() {
    for kind in ["television", "radio"] {
        let (mut sim, first, device, _) = fixture_at(kind, 10., 12., Facing::SouthWest);
        let pack = sim.world().resource::<Content>().0;
        let mut spawn = |name: &str, position: Position| {
            crate::household::spawn_member(
                sim.world_mut(),
                &pack.personalities,
                &pack.traits,
                crate::household::Member {
                    name: name.into(),
                    personality: 0,
                    position,
                    needs: [100.; 7],
                    hobbies: vec![],
                    traits: &[],
                    career: None,
                    instinct: Some(50),
                },
            )
        };
        let second = spawn("Standing company", Position { x: 0., y: 4. });
        let third = spawn("Capacity probe", Position { x: 6., y: 3. });
        for person in [second, third] {
            sim.world_mut()
                .entity_mut(person)
                .insert(IntentQueue::from_intents(vec![Intent {
                    cleanup: None,
                    chore: None,
                    object: device,
                    interaction: 0,
                }]));
        }
        sim.tick();
        assert_eq!(sim.world().get::<Target>(first).unwrap().object, device);
        assert_eq!(sim.world().get::<Target>(second).unwrap().object, device);
        assert!(
            sim.world().get::<Target>(third).is_none(),
            "Two media slots must not admit a third viewer"
        );
        assert_ne!(
            sim.world().get::<Path>(first).unwrap().steps.last(),
            sim.world().get::<Path>(second).unwrap().steps.last(),
            "Standing viewers must claim distinct destinations"
        );
        let saved = sim.save_snapshot_v5();
        assert!(
            saved.dining.as_ref().unwrap().diners.is_empty(),
            "Standing destinations are reconstructed without adding save fields"
        );
        let mut restored = Sim::new_with_lot(16, 16);
        restored.load_snapshot_v5(saved).unwrap();
        for _ in 0..3 {
            sim.tick();
            restored.tick();
            assert_eq!(sim.world_hash(), restored.world_hash());
        }
        sim.world_mut()
            .entity_mut(third)
            .remove::<IntentQueue>()
            .remove::<Path>()
            .insert((
                Position { x: 6., y: 3. },
                Target {
                    object: device,
                    interaction: 0,
                },
                Eating {
                    object: pack.find(kind).unwrap(),
                    interaction: 0,
                    remaining_ticks: 20,
                },
            ));
        let before = restored.world_hash();
        assert_eq!(
            restored.load_snapshot_v5(sim.save_snapshot_v5()),
            Err(crate::SaveError::InvalidValue)
        );
        assert_eq!(restored.world_hash(), before);
        sim.world_mut()
            .entity_mut(third)
            .remove::<Target>()
            .remove::<Eating>()
            .remove::<terri_core::Agent>();
        let endpoint = *sim
            .world()
            .get::<Path>(first)
            .unwrap()
            .steps
            .last()
            .unwrap();
        sim.world_mut().get_mut::<Path>(second).unwrap().steps = vec![endpoint];
        assert_eq!(
            crate::media::validate_ownership(sim.world()),
            Err(crate::SaveError::InvalidValue)
        );
    }
}

#[test]
fn two_media_orders_share_the_device_but_reserve_distinct_positions() {
    let (mut sim, first, device, _) = fixture();
    let pack = sim.world().resource::<Content>().0;
    let second = crate::household::spawn_member(
        sim.world_mut(),
        &pack.personalities,
        &pack.traits,
        crate::household::Member {
            name: "Second viewer".into(),
            personality: 0,
            position: Position { x: 0., y: 4. },
            needs: [100.; 7],
            hobbies: vec![],
            traits: &[],
            career: None,
            instinct: Some(50),
        },
    );
    sim.world_mut()
        .entity_mut(second)
        .insert(IntentQueue::from_intents(vec![Intent {
            cleanup: None,
            chore: None,
            object: device,
            interaction: 0,
        }]));
    sim.tick();
    assert_eq!(sim.world().get::<Target>(first).unwrap().object, device);
    assert_eq!(
        sim.world().get::<Target>(second).map(|t| t.object),
        Some(device)
    );
    assert_ne!(
        sim.world().get::<Path>(first).unwrap().steps.last(),
        sim.world().get::<Path>(second).unwrap().steps.last()
    );
}

/// Every autonomous draw here is decisive: the television must be each Sim's
/// top score with a negligible exploration tail, so the count of watchers measures the
/// slot limit rather than one roll of the random stream. The seat at (10, 12)
/// is outside the television's view, so both viewers stand and only the
/// standing-place reservation keeps them apart.
#[test]
fn autonomous_viewers_fill_both_television_slots_and_a_third_is_refused() {
    for (seat_x, seat_y) in [(5., 3.), (10., 12.)] {
        let (mut sim, first, device, _) =
            fixture_at("television", seat_x, seat_y, Facing::SouthWest);
        let mut pack = sim.world().resource::<Content>().0.clone();
        pack.tuning.choice_temperature = 0.0001;
        pack.tuning.choice_comfort_temperature = 0.0001;
        pack.tuning.choice_exploration = 1e-8;
        pack.tuning.choice_comfort_exploration = 1e-8;
        let pack: &'static terri_data::ContentPack = Box::leak(Box::new(pack));
        sim.world_mut().insert_resource(Content(pack));
        let slots = pack.object(pack.find("television").unwrap()).interactions[0].slots as usize;
        sim.world_mut().entity_mut(first).remove::<IntentQueue>();
        let mut spawn = |name: &str, position: Position| {
            crate::household::spawn_member(
                sim.world_mut(),
                &pack.personalities,
                &pack.traits,
                crate::household::Member {
                    name: name.into(),
                    personality: 0,
                    position,
                    needs: [100.; 7],
                    hobbies: vec![],
                    traits: &[],
                    career: None,
                    instinct: Some(50),
                },
            )
        };
        let second = spawn("Second viewer", Position { x: 0., y: 4. });
        let third = spawn("Capacity probe", Position { x: 6., y: 3. });
        let people = [first, second, third];
        for person in people {
            sim.world_mut()
                .get_mut::<terri_core::Needs>(person)
                .unwrap()
                .set(terri_core::NeedId::Fun, 0.);
        }
        sim.tick();
        let (watching, refused): (Vec<_>, Vec<_>) = people.into_iter().partition(|person| {
            sim.world()
                .get::<Target>(*person)
                .is_some_and(|target| target.object == device)
        });
        assert_eq!(
            watching.len(),
            slots,
            "Autonomy must admit exactly the television's {slots} slots (seat at {seat_x}, {seat_y})"
        );
        assert_eq!(refused.len(), 1);
        assert!(
            sim.world().get::<terri_core::Blocked>(refused[0]).is_some()
                && sim.world().get::<Target>(refused[0]).is_none(),
            "The refused Sim must wait rather than act"
        );
        assert_eq!(
            sim.world()
                .get::<crate::waiting::WaitingNeeds>(refused[0])
                .map(|waiting| waiting.1),
            Some(device),
            "The refused Sim must wait for the full television, not for something else"
        );
        let seated = watching
            .iter()
            .filter(|person| crate::seating::claim(sim.world(), person.index_u32()).is_some())
            .count();
        assert_eq!(
            seated,
            usize::from(seat_x < 10.),
            "Only the in-view seat may hold a viewer (seat at {seat_x}, {seat_y})"
        );
        let endpoint = |person| {
            sim.world()
                .get::<Path>(person)
                .expect("an admitted viewer is walking to its viewing place")
                .steps
                .last()
                .copied()
        };
        assert_ne!(
            endpoint(watching[0]),
            endpoint(watching[1]),
            "Autonomous viewers must claim distinct positions (seat at {seat_x}, {seat_y})"
        );
    }
}

#[test]
fn shared_media_refill_is_directional_and_stops_when_company_leaves() {
    for kind in ["television", "radio"] {
        let (mut sim, first, device, _) = fixture_at(kind, 5., 3., Facing::SouthWest);
        let pack = sim.world().resource::<Content>().0;
        let chair = sim.spawn_object(Position { x: 5., y: 4. }, pack.find("armchair").unwrap());
        crate::apply_object_placement(
            sim.world_mut(),
            chair,
            pack.object(pack.find("armchair").unwrap()),
            Position { x: 5., y: 4. },
            Facing::SouthWest,
        );
        let second = crate::household::spawn_member(
            sim.world_mut(),
            &pack.personalities,
            &pack.traits,
            crate::household::Member {
                name: "Company".into(),
                personality: 0,
                position: Position { x: 0., y: 4. },
                needs: [100.; 7],
                hobbies: vec![],
                traits: &[],
                career: None,
                instinct: Some(50),
            },
        );
        for (me, other, affinity) in [(first, second, 0.5), (second, first, -0.5)] {
            let mut feelings = terri_core::Relationships::default();
            feelings.bump(
                *sim.world().get::<terri_core::SimId>(other).unwrap(),
                affinity,
            );
            sim.world_mut().entity_mut(me).insert(feelings);
            sim.world_mut()
                .get_mut::<terri_core::Needs>(me)
                .unwrap()
                .set(terri_core::NeedId::Social, 30.);
        }
        sim.world_mut()
            .entity_mut(second)
            .insert(IntentQueue::from_intents(vec![Intent {
                cleanup: None,
                chore: None,
                object: device,
                interaction: 0,
            }]));
        for _ in 0..120 {
            sim.tick();
            if [first, second]
                .iter()
                .all(|p| sim.world().get::<Eating>(*p).is_some())
            {
                break;
            }
        }
        assert!(
            [first, second]
                .iter()
                .all(|p| sim.world().get::<Eating>(*p).is_some()),
            "{kind} must have two active participants"
        );
        let social = |sim: &Sim, p| {
            sim.world()
                .get::<terri_core::Needs>(p)
                .unwrap()
                .get(terri_core::NeedId::Social)
        };
        let before = (social(&sim, first), social(&sim, second));
        sim.tick();
        assert!(social(&sim, first) > before.0);
        assert!(
            social(&sim, second) < before.1,
            "Disliked company cannot refill Social"
        );
        let saved = sim.save_snapshot_v5();
        let mut replay = Sim::new_with_lot(16, 16);
        replay.load_snapshot_v5(saved.clone()).unwrap();
        for _ in 0..3 {
            sim.tick();
            replay.tick();
            assert_eq!(sim.world_hash(), replay.world_hash());
        }
        let other_device = sim.spawn_object(Position { x: 2., y: 4. }, pack.find(kind).unwrap());
        crate::apply_object_placement(
            sim.world_mut(),
            other_device,
            pack.object(pack.find(kind).unwrap()),
            Position { x: 2., y: 4. },
            Facing::SouthEast,
        );
        sim.world_mut()
            .entity_mut(other_device)
            .insert(terri_core::Reserved);
        sim.world_mut().get_mut::<Target>(second).unwrap().object = other_device;
        sim.world_mut()
            .resource_mut::<terri_core::save::SavedDining>()
            .diners
            .iter_mut()
            .find(|d| d.person == second.index_u32())
            .unwrap()
            .station = other_device.index_u32();
        let lease = crate::seating::claim(sim.world(), second.index_u32()).unwrap();
        assert!(
            crate::media::valid_lease(sim.world(), lease),
            "The second device is actually being used"
        );
        crate::social_company::refresh(sim.world_mut());
        assert!(
            !sim.world()
                .resource::<crate::social_company::SocialCompany>()
                .active_allowed(
                    first,
                    sim.world().get::<terri_core::Relationships>(first).unwrap()
                ),
            "Watching different devices is not communal use"
        );
        let before = social(&sim, first);
        sim.world_mut()
            .entity_mut(second)
            .remove::<Eating>()
            .remove::<Target>();
        crate::seating::release(sim.world_mut(), second.index_u32());
        crate::social_company::refresh(sim.world_mut());
        assert!(!sim
            .world()
            .resource::<crate::social_company::SocialCompany>()
            .active_allowed(
                first,
                sim.world().get::<terri_core::Relationships>(first).unwrap()
            ));
        sim.world_mut()
            .entity_mut(second)
            .remove::<terri_core::Agent>();
        sim.tick();
        assert!(social(&sim, first) < before);
        let mut invalid = saved;
        let endpoint = invalid
            .dining
            .as_ref()
            .unwrap()
            .diners
            .iter()
            .find(|d| d.person == first.index_u32())
            .unwrap()
            .endpoint;
        invalid
            .dining
            .as_mut()
            .unwrap()
            .diners
            .iter_mut()
            .find(|d| d.person == second.index_u32())
            .unwrap()
            .endpoint = endpoint;
        let hash = replay.world_hash();
        assert!(replay.load_snapshot_v5(invalid).is_err());
        assert_eq!(
            replay.world_hash(),
            hash,
            "Invalid shared ownership must be rejected transactionally"
        );
    }
}

fn fixture() -> (
    Sim,
    bevy_ecs::entity::Entity,
    bevy_ecs::entity::Entity,
    bevy_ecs::entity::Entity,
) {
    fixture_at("television", 5., 3., Facing::SouthWest)
}

fn fixture_at(
    device_kind: &str,
    x: f32,
    y: f32,
    facing: Facing,
) -> (
    Sim,
    bevy_ecs::entity::Entity,
    bevy_ecs::entity::Entity,
    bevy_ecs::entity::Entity,
) {
    fixture_with_device(
        device_kind,
        Position { x: 2., y: 3. },
        Position { x, y },
        Facing::SouthEast,
        facing,
        "armchair",
    )
}

fn fixture_with_device(
    device_kind: &str,
    device_position: Position,
    seat_position: Position,
    device_facing: Facing,
    seat_facing: Facing,
    seat_kind: &str,
) -> (
    Sim,
    bevy_ecs::entity::Entity,
    bevy_ecs::entity::Entity,
    bevy_ecs::entity::Entity,
) {
    let mut sim = Sim::new_with_lot(16, 16);
    let pack = sim.world().resource::<Content>().0;
    let device = sim.spawn_object(device_position, pack.find(device_kind).unwrap());
    crate::apply_object_placement(
        sim.world_mut(),
        device,
        pack.object(pack.find(device_kind).unwrap()),
        device_position,
        device_facing,
    );
    let chair = sim.spawn_object(seat_position, pack.find(seat_kind).unwrap());
    let definition = pack.object(pack.find(seat_kind).unwrap());
    crate::apply_object_placement(
        sim.world_mut(),
        chair,
        definition,
        seat_position,
        seat_facing,
    );
    let person = crate::household::spawn_member(
        sim.world_mut(),
        &pack.personalities,
        &pack.traits,
        crate::household::Member {
            name: "Viewer".into(),
            personality: 0,
            position: Position { x: 0., y: 3. },
            needs: [100.; 7],
            hobbies: vec![],
            traits: &[],
            career: None,
            instinct: Some(50),
        },
    );
    sim.world_mut()
        .entity_mut(person)
        .insert(IntentQueue::from_intents(vec![Intent {
            cleanup: None,
            chore: None,
            object: device,
            interaction: 0,
        }]));
    (sim, person, device, chair)
}

#[test]
fn television_order_routes_to_available_front_seat_but_keeps_device_target() {
    let (mut sim, person, device, chair) = fixture();
    sim.tick();
    sim.sync_render_buffer();
    let row = sim
        .render_buffer()
        .ids
        .iter()
        .position(|id| *id == person.index_u32())
        .unwrap();
    assert_eq!(sim.render_buffer().seated_furniture[row], u32::MAX);
    assert_eq!(sim.render_buffer().seated_places[row], u32::MAX);
    assert_eq!(sim.world().get::<Target>(person).unwrap().object, device);
    assert_eq!(
        sim.world().get::<Path>(person).unwrap().steps.last(),
        Some(&(4, 3)),
        "A suitable seat must replace the ordinary device-perimeter route"
    );
    for _ in 0..120 {
        sim.tick();
        if sim.world().get::<Eating>(person).is_some() {
            sim.sync_render_buffer();
            let row = sim
                .render_buffer()
                .ids
                .iter()
                .position(|id| *id == person.index_u32())
                .unwrap();
            assert_eq!(sim.render_buffer().seated_furniture[row], chair.index_u32());
            assert_eq!(sim.render_buffer().seated_places[row], 0);
            assert_eq!(sim.render_buffer().seated_whole[row], 0);
            return;
        }
    }
    panic!("Viewer never reached the seat");
}

#[test]
fn media_cone_includes_its_angle_and_radius_edges_but_excludes_outside_seats() {
    for (x, y, facing, wanted) in [
        (9., 3., Facing::SouthWest, (8, 3)),
        (5., 6., Facing::SouthWest, (4, 6)),
        (10., 3., Facing::SouthWest, (3, 3)),
        (7., 8., Facing::SouthWest, (3, 3)),
        (4., 6., Facing::SouthWest, (3, 3)),
        (1., 3., Facing::NorthEast, (3, 3)),
        (5., 3., Facing::SouthEast, (3, 3)),
    ] {
        let (mut sim, person, device, _) = fixture_at("television", x, y, facing);
        sim.tick();
        assert_eq!(sim.world().get::<Target>(person).unwrap().object, device);
        assert_eq!(
            sim.world().get::<Path>(person).unwrap().steps.last(),
            Some(&wanted),
            "Seat at {x},{y}, facing {facing:?}"
        );
    }
}

#[test]
fn radio_uses_the_same_seat_with_its_own_activity() {
    let (mut sim, person, device, chair) = fixture_at("radio", 5., 3., Facing::SouthWest);
    for _ in 0..120 {
        sim.tick();
        if sim.world().get::<Eating>(person).is_some() {
            sim.sync_render_buffer();
            let buffer = sim.render_buffer();
            let row = buffer
                .ids
                .iter()
                .position(|id| *id == person.index_u32())
                .unwrap();
            assert_eq!(buffer.activities[row], 18);
            assert_eq!(buffer.visual_actions[row], 8);
            assert_eq!(buffer.interaction_targets[row], chair.index_u32());
            assert_eq!(buffer.seated_furniture[row], chair.index_u32());
            assert_eq!(buffer.seated_places[row], 0);
            assert_eq!(buffer.seated_whole[row], 0);
            assert_eq!(sim.world().get::<Target>(person).unwrap().object, device);
            return;
        }
    }
    panic!("Radio listener never reached the seat");
}

#[test]
fn every_media_rotation_uses_its_physical_front_and_seat_front() {
    for (device_facing, seat_facing, seat, endpoint) in [
        (Facing::SouthEast, Facing::SouthWest, (11., 8.), (10, 8)),
        (Facing::SouthWest, Facing::NorthWest, (8., 11.), (8, 10)),
        (Facing::NorthWest, Facing::NorthEast, (5., 8.), (6, 8)),
        (Facing::NorthEast, Facing::SouthEast, (8., 5.), (8, 6)),
    ] {
        let (mut sim, person, device, _) = fixture_with_device(
            "television",
            Position { x: 8., y: 8. },
            Position {
                x: seat.0,
                y: seat.1,
            },
            device_facing,
            seat_facing,
            "armchair",
        );
        sim.tick();
        assert_eq!(sim.world().get::<Target>(person).unwrap().object, device);
        assert_eq!(
            sim.world().get::<Path>(person).unwrap().steps.last(),
            Some(&endpoint)
        );
    }
}

#[test]
fn farther_available_seat_beats_a_nearer_occupied_or_unreachable_seat() {
    for occupied in [false, true] {
        let (mut sim, person, device, chair) = fixture();
        let pack = sim.world().resource::<Content>().0;
        let far = sim.spawn_object(Position { x: 6., y: 4. }, pack.find("armchair").unwrap());
        crate::apply_object_placement(
            sim.world_mut(),
            far,
            pack.object(pack.find("armchair").unwrap()),
            Position { x: 6., y: 4. },
            Facing::SouthWest,
        );
        if occupied {
            let other = sim
                .world_mut()
                .spawn((
                    terri_core::Agent,
                    Position { x: 4., y: 3. },
                    Target {
                        object: chair,
                        interaction: 0,
                    },
                    Eating {
                        object: pack.find("armchair").unwrap(),
                        interaction: 0,
                        remaining_ticks: 30,
                    },
                    terri_core::Needs::all_at(100.),
                ))
                .id();
            sim.world_mut()
                .entity_mut(chair)
                .insert(terri_core::Reserved);
            assert_ne!(other, person);
        } else {
            sim.world_mut()
                .resource_mut::<terri_core::TileGrid>()
                .set_blocked(4, 3, true);
        }
        sim.tick();
        assert_eq!(sim.world().get::<Target>(person).unwrap().object, device);
        assert_eq!(
            sim.world().get::<Path>(person).unwrap().steps.last(),
            Some(&(5, 4))
        );
    }
}

#[test]
fn every_fitted_seat_type_can_supply_a_media_place() {
    for (kind, facing) in [
        ("armchair", Facing::SouthWest),
        ("chair", Facing::SouthWest),
        ("desk_chair", Facing::SouthWest),
        ("long_sofa", Facing::SouthWest),
        ("reading_chair", Facing::NorthWest),
        ("sofa", Facing::SouthEast),
    ] {
        let (mut sim, person, device, chair) = fixture_with_device(
            "television",
            Position { x: 2., y: 3. },
            Position { x: 5., y: 3. },
            Facing::SouthEast,
            facing,
            kind,
        );
        sim.tick();
        let lease = sim
            .world()
            .resource::<terri_core::save::SavedDining>()
            .diners
            .iter()
            .find(|d| d.person == person.index_u32());
        assert_eq!(
            lease.and_then(|d| d.chair),
            Some(chair.index_u32()),
            "{kind}"
        );
        assert_eq!(sim.world().get::<Target>(person).unwrap().object, device);
        assert!(
            sim.load_snapshot_v5(sim.save_snapshot_v5()).is_ok(),
            "{kind} lease must load"
        );
    }
}

#[test]
fn autonomous_media_choice_uses_the_same_physical_seat_route() {
    let (mut sim, person, device, _) = fixture();
    sim.world_mut().entity_mut(person).remove::<IntentQueue>();
    sim.world_mut()
        .get_mut::<terri_core::Needs>(person)
        .unwrap()
        .set(terri_core::NeedId::Fun, 0.);
    sim.tick();
    assert_eq!(sim.world().get::<Target>(person).unwrap().object, device);
    assert_eq!(
        sim.world().get::<Path>(person).unwrap().steps.last(),
        Some(&(4, 3))
    );
}

#[test]
fn a_viewing_seat_does_not_require_reaching_the_device_perimeter() {
    for directed in [false, true] {
        let (mut sim, person, device, _) = fixture();
        for (x, y) in [(1, 3), (2, 2), (2, 4), (3, 3)] {
            sim.world_mut()
                .resource_mut::<terri_core::TileGrid>()
                .set_blocked(x, y, true);
        }
        if !directed {
            sim.world_mut().entity_mut(person).remove::<IntentQueue>();
            sim.world_mut()
                .get_mut::<terri_core::Needs>(person)
                .unwrap()
                .set(terri_core::NeedId::Fun, 0.);
        }
        sim.tick();
        assert_eq!(
            sim.world().get::<Target>(person).map(|t| t.object),
            Some(device),
            "directed={directed}"
        );
        assert_eq!(
            sim.world().get::<Path>(person).unwrap().steps.last(),
            Some(&(4, 3))
        );
    }
}

#[test]
fn cancellation_releases_media_seat_without_advancing_the_clock() {
    let (mut sim, person, _, chair) = fixture();
    sim.tick();
    let tick = sim.world().resource::<terri_core::SimClock>().tick;
    assert!(crate::seating::object_in_use(
        sim.world(),
        chair.index_u32()
    ));
    sim.world_mut()
        .resource_mut::<terri_core::CommandQueue>()
        .push(terri_core::SimCommand::CancelIntents {
            agent: person.index_u32(),
        });
    sim.flush_commands();
    assert_eq!(sim.world().resource::<terri_core::SimClock>().tick, tick);
    assert!(!crate::seating::object_in_use(
        sim.world(),
        chair.index_u32()
    ));
    assert!(sim.world().get::<Target>(person).is_none());
    assert!(sim.load_snapshot_v5(sim.save_snapshot_v5()).is_ok());
}

#[test]
fn an_invalidated_viewing_seat_replans_to_another_available_seat() {
    let (mut sim, person, device, chair) = fixture();
    let pack = sim.world().resource::<Content>().0;
    let other = sim.spawn_object(Position { x: 6., y: 4. }, pack.find("armchair").unwrap());
    crate::apply_object_placement(
        sim.world_mut(),
        other,
        pack.object(pack.find("armchair").unwrap()),
        Position { x: 6., y: 4. },
        Facing::SouthWest,
    );
    sim.tick();
    assert_eq!(
        crate::seating::claim(sim.world(), person.index_u32())
            .unwrap()
            .chair,
        Some(chair.index_u32())
    );
    sim.world_mut()
        .resource_mut::<terri_core::TileGrid>()
        .set_edge_blocked((4, 3), (5, 3), true);
    sim.tick();
    assert_eq!(
        crate::seating::claim(sim.world(), person.index_u32())
            .unwrap()
            .chair,
        Some(other.index_u32())
    );
    assert_eq!(sim.world().get::<Target>(person).unwrap().object, device);
    assert_eq!(
        sim.world().get::<Path>(person).unwrap().steps.last(),
        Some(&(5, 4))
    );
    assert!(sim.load_snapshot_v5(sim.save_snapshot_v5()).is_ok());
}

#[test]
fn media_seat_restores_during_travel_and_active_use() {
    let (mut sim, person, _, _) = fixture();
    let mut active = false;
    for tick in 0..120 {
        sim.tick();
        if tick == 0 || sim.world().get::<Eating>(person).is_some() {
            let snapshot = sim.save_snapshot_v5();
            let hash = sim.world_hash();
            assert!(
                sim.load_snapshot_v5(snapshot.clone()).is_ok(),
                "Exact media claims must restore at tick {tick}"
            );
            assert_eq!(sim.save_snapshot_v5(), snapshot);
            assert_eq!(sim.world_hash(), hash);
            if tick > 0 {
                active = true;
                break;
            }
        }
    }
    assert!(
        active,
        "The round-trip must include actual use, not only its path"
    );
}

#[test]
fn seated_viewer_projects_chair_contact_with_television_activity() {
    let (mut sim, person, device, chair) = fixture();
    for _ in 0..120 {
        sim.tick();
        if sim.world().get::<Eating>(person).is_some() {
            sim.sync_render_buffer();
            let buffer = sim.render_buffer();
            let row = buffer
                .ids
                .iter()
                .position(|id| *id == person.index_u32())
                .unwrap();
            assert_eq!(buffer.activities[row], 14);
            assert_eq!(buffer.visual_actions[row], 8);
            assert_eq!(buffer.interaction_targets[row], chair.index_u32());
            assert_eq!(sim.world().get::<Target>(person).unwrap().object, device);
            return;
        }
    }
    panic!("Viewer did not arrive within the bounded route");
}

#[test]
fn suspended_meal_cleanup_does_not_release_the_current_media_seat() {
    let (mut sim, person, device, chair) = fixture();
    let pack = sim.world().resource::<Content>().0;
    let chain = pack
        .chains
        .iter()
        .position(|c| c.id == "cook_dinner")
        .unwrap() as u32;
    sim.world_mut().entity_mut(person).insert((
        Target {
            object: device,
            interaction: 0,
        },
        terri_core::ChainState {
            step: 5,
            ..terri_core::ChainState::begin(chain)
        },
    ));
    let lease = terri_core::save::SavedDiner {
        person: person.index_u32(),
        station: device.index_u32(),
        chair: Some(chair.index_u32()),
        setting: None,
        endpoint: (4, 3),
        obstructing: vec![],
    };
    sim.world_mut()
        .insert_resource(terri_core::save::SavedDining {
            diners: vec![lease.clone()],
            ..Default::default()
        });
    crate::domestic::suspend_cleanup(sim.world_mut(), person);
    crate::dining::maintain(sim.world_mut());
    assert_eq!(
        sim.world()
            .resource::<terri_core::save::SavedDining>()
            .diners,
        vec![lease],
        "A suspended meal must not own the live television seat"
    );
    assert!(
        crate::dining::claim(sim.world(), person.index_u32()).is_none(),
        "Media ownership must not justify a meal station"
    );
}

#[test]
fn standing_media_routes_restore_away_from_the_device_perimeter() {
    let pack = terri_data::pack();
    let mut lot = pack.lot.clone();
    lot.walls.clear();
    lot.wall_edges.clear();
    let placement = |kind: &str, x, y| {
        let object = pack.find(kind).unwrap();
        let definition = pack.object(object);
        let facing = Facing::SouthEast;
        terri_data::CompiledPlacement {
            object,
            x,
            y,
            facing,
            sprite: definition.facing_sprites.get(facing).unwrap(),
            action_sockets: definition.sockets_at(x, y, facing),
            foreground_sprite: definition.facing_foreground_sprites.get(facing),
        }
    };
    lot.placements = vec![
        placement("television", 2., 3.),
        placement("armchair", 5., 3.),
    ];
    lot.placements.extend(
        [
            (1., 2.),
            (1., 3.),
            (1., 4.),
            (2., 2.),
            (2., 4.),
            (3., 2.),
            (3., 3.),
            (3., 4.),
        ]
        .into_iter()
        .map(|(x, y)| placement("trashcan", x, y)),
    );
    let mut sim = Sim::new_from_lot(&lot, &pack.objects);
    sim.world_mut()
        .insert_resource(terri_core::layout::SavedLayout::EdgeWallsV1 { edges: vec![] });
    let device = sim
        .world_mut()
        .query::<(bevy_ecs::entity::Entity, &terri_core::SmartObject)>()
        .iter(sim.world())
        .find(|(_, o)| o.0 == pack.find("television").unwrap())
        .unwrap()
        .0;
    let person = crate::household::spawn_member(
        sim.world_mut(),
        &pack.personalities,
        &pack.traits,
        crate::household::Member {
            name: "Viewer".into(),
            personality: 0,
            position: Position { x: 0., y: 3. },
            needs: [100.; 7],
            hobbies: vec![],
            traits: &[],
            career: None,
            instinct: Some(50),
        },
    );
    sim.world_mut()
        .entity_mut(person)
        .insert(IntentQueue::from_intents(vec![Intent {
            cleanup: None,
            chore: None,
            object: device,
            interaction: 0,
        }]));
    for tick in 0..120 {
        sim.tick();
        if tick == 0 || sim.world().get::<Eating>(person).is_some() {
            assert!(crate::seating::claim(sim.world(), person.index_u32()).is_none());
            let endpoint = sim
                .world()
                .get::<Path>(person)
                .and_then(|p| p.steps.last().copied())
                .unwrap_or_else(|| {
                    let p = sim.world().get::<Position>(person).unwrap();
                    (p.x.round() as i32, p.y.round() as i32)
                });
            assert!(
                endpoint.0 >= 4,
                "The test must exercise non-perimeter contact"
            );
            assert!(crate::media::valid_standing_contact(
                sim.world(),
                person.index_u32(),
                device.index_u32(),
                endpoint
            ));
            let saved = sim.save_snapshot_v5();
            assert!(
                sim.load_snapshot_v5(saved.clone()).is_ok(),
                "standing tick {tick}"
            );
            assert_eq!(sim.save_snapshot_v5(), saved);
            if tick > 0 {
                return;
            }
        }
    }
    panic!("Standing viewer never arrived");
}

#[test]
fn an_invalid_current_endpoint_releases_the_media_commitment() {
    let (mut sim, person, _, chair) = fixture();
    for _ in 0..120 {
        sim.tick();
        if sim.world().get::<Eating>(person).is_some() {
            let endpoint = crate::seating::claim(sim.world(), person.index_u32())
                .unwrap()
                .endpoint;
            sim.world_mut()
                .resource_mut::<terri_core::TileGrid>()
                .set_blocked(endpoint.0 as usize, endpoint.1 as usize, true);
            crate::media::maintain(sim.world_mut());
            assert!(sim.world().get::<Target>(person).is_none());
            assert!(sim.world().get::<Eating>(person).is_none());
            assert!(!crate::seating::object_in_use(
                sim.world(),
                chair.index_u32()
            ));
            return;
        }
    }
    panic!("Viewer never arrived");
}

#[test]
fn media_lease_cannot_share_a_chair_with_an_ordinary_sitter() {
    let (mut sim, person, _, chair) = fixture();
    sim.tick();
    let other = crate::household::spawn_member(
        sim.world_mut(),
        &terri_data::pack().personalities,
        &terri_data::pack().traits,
        crate::household::Member {
            name: "Sitter".into(),
            personality: 0,
            position: Position { x: 4., y: 3. },
            needs: [100.; 7],
            hobbies: vec![],
            traits: &[],
            career: None,
            instinct: Some(50),
        },
    );
    sim.world_mut().entity_mut(other).insert(Target {
        object: chair,
        interaction: 0,
    });
    let lease = crate::seating::claim(sim.world(), person.index_u32()).unwrap();
    assert!(!crate::media::valid_lease(sim.world(), lease));
    let snapshot = sim.save_snapshot_v5();
    let hash = sim.world_hash();
    assert!(sim.load_snapshot_v5(snapshot.clone()).is_err());
    assert_eq!(sim.save_snapshot_v5(), snapshot);
    assert_eq!(sim.world_hash(), hash);
}

#[test]
fn privacy_substitution_routes_directly_to_the_media_seat() {
    let (mut sim, person, device, chair) = fixture();
    sim.world_mut().entity_mut(person).remove::<IntentQueue>();
    sim.world_mut()
        .get_mut::<terri_core::Needs>(person)
        .unwrap()
        .set(terri_core::NeedId::Fun, 0.);
    let mut safe = sim.world().resource::<terri_core::TileGrid>().clone();
    for (x, y) in [(1, 3), (2, 2), (2, 4), (3, 3)] {
        safe.set_blocked(x, y, true);
    }
    assert!(crate::privacy::substitute(
        sim.world_mut(),
        person,
        terri_core::NeedId::Fun.index() as u8,
        &safe,
        false
    ));
    assert_eq!(sim.world().get::<Target>(person).unwrap().object, device);
    assert_eq!(
        sim.world().get::<Path>(person).unwrap().steps.last(),
        Some(&(4, 3))
    );
    assert_eq!(
        crate::seating::claim(sim.world(), person.index_u32())
            .unwrap()
            .chair,
        Some(chair.index_u32())
    );
}

#[test]
fn media_seats_refuse_move_rotation_and_sale_during_travel_and_use() {
    let pack = terri_data::pack();
    let mut lot = pack.lot.clone();
    lot.walls.clear();
    lot.wall_edges.clear();
    lot.placements = [
        ("television", 2., 3., Facing::SouthEast),
        ("armchair", 5., 3., Facing::SouthWest),
    ]
    .into_iter()
    .map(|(kind, x, y, facing)| {
        let object = pack.find(kind).unwrap();
        let def = pack.object(object);
        terri_data::CompiledPlacement {
            object,
            x,
            y,
            facing,
            sprite: def.facing_sprites.get(facing).unwrap(),
            action_sockets: def.sockets_at(x, y, facing),
            foreground_sprite: def.facing_foreground_sprites.get(facing),
        }
    })
    .collect();
    let mut sim = Sim::new_from_lot(&lot, &pack.objects);
    let objects: Vec<_> = sim
        .world_mut()
        .query::<(bevy_ecs::entity::Entity, &terri_core::SmartObject)>()
        .iter(sim.world())
        .map(|(e, o)| (e, o.0))
        .collect();
    let device = objects
        .iter()
        .find(|(_, o)| *o == pack.find("television").unwrap())
        .unwrap()
        .0;
    let chair = objects
        .iter()
        .find(|(_, o)| *o == pack.find("armchair").unwrap())
        .unwrap()
        .0;
    let person = crate::household::spawn_member(
        sim.world_mut(),
        &pack.personalities,
        &pack.traits,
        crate::household::Member {
            name: "Viewer".into(),
            personality: 0,
            position: Position { x: 0., y: 3. },
            needs: [100.; 7],
            hobbies: vec![],
            traits: &[],
            career: None,
            instinct: Some(50),
        },
    );
    assert!(crate::placement::validate_placement(
        sim.world(),
        chair.index_u32(),
        (6, 3),
        Facing::SouthWest
    )
    .is_ok());
    assert!(crate::placement::sale::validate_sale(sim.world(), chair.index_u32()).is_ok());
    sim.world_mut()
        .entity_mut(person)
        .insert(IntentQueue::from_intents(vec![Intent {
            cleanup: None,
            chore: None,
            object: device,
            interaction: 0,
        }]));
    for tick in 0..120 {
        sim.tick();
        if tick == 0 || sim.world().get::<Eating>(person).is_some() {
            let position = *sim.world().get::<Position>(chair).unwrap();
            for (origin, facing) in [
                ((6, 3), Facing::SouthWest),
                ((position.x as u32, position.y as u32), Facing::NorthWest),
            ] {
                let result = crate::placement::validate_placement(
                    sim.world(),
                    chair.index_u32(),
                    origin,
                    facing,
                );
                assert!(
                    matches!(result, Err(crate::placement::PlacementRefusal::InUse)),
                    "{result:?}"
                );
            }
            assert!(matches!(
                crate::placement::sale::validate_sale(sim.world(), chair.index_u32()),
                Err(crate::placement::PlacementRefusal::InUse)
            ));
            if tick > 0 {
                return;
            }
        }
    }
    panic!("Viewer never arrived");
}

#[test]
fn a_standing_viewer_takes_a_seat_when_it_becomes_available() {
    let (mut sim, person, _, chair) = fixture();
    sim.world_mut()
        .entity_mut(chair)
        .insert(terri_core::ObjectFacing(Facing::SouthEast));
    for _ in 0..120 {
        sim.tick();
        if sim.world().get::<Eating>(person).is_some() {
            assert!(crate::seating::claim(sim.world(), person.index_u32()).is_none());
            sim.world_mut()
                .entity_mut(chair)
                .insert(terri_core::ObjectFacing(Facing::SouthWest));
            crate::media::maintain(sim.world_mut());
            assert_eq!(
                crate::seating::claim(sim.world(), person.index_u32())
                    .unwrap()
                    .chair,
                Some(chair.index_u32())
            );
            assert!(sim.world().get::<Eating>(person).is_none());
            assert!(sim.world().get::<Path>(person).is_some());
            return;
        }
    }
    panic!("Standing viewer never arrived");
}

#[test]
fn exact_release_does_not_remove_a_replacement_media_lease() {
    let (mut sim, person, device, _) = fixture();
    sim.tick();
    let pack = sim.world().resource::<Content>().0;
    let radio = sim.spawn_object(Position { x: 2., y: 4. }, pack.find("radio").unwrap());
    let previous = *sim.world().get::<Target>(person).unwrap();
    sim.world_mut().entity_mut(person).insert(Target {
        object: radio,
        interaction: 0,
    });
    sim.world_mut()
        .resource_mut::<terri_core::save::SavedDining>()
        .diners[0]
        .station = radio.index_u32();
    crate::reservations::release_now(sim.world_mut(), person, previous);
    assert_eq!(
        crate::seating::claim(sim.world(), person.index_u32())
            .unwrap()
            .station,
        radio.index_u32()
    );
    assert_eq!(sim.world().get::<Target>(person).unwrap().object, radio);
    assert_ne!(radio, device);
}

#[test]
fn exact_release_removes_the_live_media_lease_before_any_maintenance() {
    let (mut sim, person, _, _) = fixture();
    sim.tick();
    let expected = *sim.world().get::<Target>(person).unwrap();
    assert!(crate::seating::claim(sim.world(), person.index_u32()).is_some());
    crate::seating::release_exact(sim.world_mut(), person, expected);
    assert!(crate::seating::claim(sim.world(), person.index_u32()).is_none());
    assert_eq!(sim.world().get::<Target>(person), Some(&expected));
}

#[test]
fn media_completion_releases_its_secondary_chair() {
    let (mut sim, person, _, chair) = fixture();
    for _ in 0..120 {
        sim.tick();
        if sim.world().get::<Eating>(person).is_some() {
            sim.world_mut()
                .get_mut::<Eating>(person)
                .unwrap()
                .remaining_ticks = 1;
            sim.tick();
            assert!(crate::seating::claim(sim.world(), person.index_u32()).is_none());
            assert!(!crate::seating::object_in_use(
                sim.world(),
                chair.index_u32()
            ));
            return;
        }
    }
    panic!("Viewer never arrived");
}

#[test]
fn ordinary_ottoman_sitting_uses_the_fitted_body_without_a_media_lease() {
    let (mut sim, person, _, chair) = fixture_with_device(
        "television",
        Position { x: 2., y: 3. },
        Position { x: 5., y: 3. },
        Facing::SouthEast,
        Facing::SouthEast,
        "sofa",
    );
    sim.world_mut()
        .entity_mut(person)
        .insert(IntentQueue::from_intents(vec![Intent {
            cleanup: None,
            chore: None,
            object: chair,
            interaction: 0,
        }]));
    for _ in 0..120 {
        sim.tick();
        if sim.world().get::<Eating>(person).is_some() {
            sim.sync_render_buffer();
            let buffer = sim.render_buffer();
            let row = buffer
                .ids
                .iter()
                .position(|id| *id == person.index_u32())
                .unwrap();
            assert_eq!(buffer.visual_actions[row], 8);
            assert_eq!(buffer.interaction_targets[row], chair.index_u32());
            assert_eq!(
                buffer.activities[row],
                crate::render_buffer::activity::SITTING
            );
            assert!(crate::seating::claim(sim.world(), person.index_u32()).is_none());
            assert!(sim.load_snapshot_v5(sim.save_snapshot_v5()).is_ok());
            return;
        }
    }
    panic!("Sitter never arrived");
}

#[test]
fn explicit_ottoman_visual_keeps_its_authored_socket_instead_of_the_neutral_fallback() {
    let shipped = terri_data::pack();
    let mut pack = shipped.clone();
    let sofa = pack.find("sofa").unwrap();
    let armchair = pack.find("armchair").unwrap();
    pack.objects[sofa.0 as usize].interactions[0].visual =
        pack.object(armchair).interactions[0].visual;
    let pack = Box::leak(Box::new(pack));
    let mut sim = Sim::new_with_lot(16, 16);
    sim.world_mut().insert_resource(Content(pack));
    let chair = sim.spawn_object(Position { x: 5., y: 3. }, sofa);
    sim.world_mut()
        .entity_mut(chair)
        .insert(crate::ResolvedActionSockets(vec![
            terri_data::CompiledPlacementSocket {
                x: 7.25,
                y: 8.5,
                facing: terri_data::CompiledSocketFacing::NegativeX,
            },
        ]));
    let person = sim
        .world_mut()
        .spawn((
            terri_core::Agent,
            Position { x: 4., y: 3. },
            Target {
                object: chair,
                interaction: 0,
            },
            Eating {
                object: sofa,
                interaction: 0,
                remaining_ticks: 20,
            },
        ))
        .id();
    assert!(crate::seating::ordinary_projection(sim.world(), person).is_none());
    sim.sync_render_buffer();
    let b = sim.render_buffer();
    let row = b
        .ids
        .iter()
        .position(|id| *id == person.index_u32())
        .unwrap();
    assert_eq!(&b.positions[row * 2..row * 2 + 2], &[7.25, 8.5]);
    assert_eq!(b.facings[row], 2);
    assert_eq!(b.visual_actions[row], 8);
}

fn sitter(
    sim: &mut Sim,
    chair: bevy_ecs::entity::Entity,
    interaction: u32,
) -> bevy_ecs::entity::Entity {
    let pack = sim.world().resource::<Content>().0;
    let person = crate::household::spawn_member(
        sim.world_mut(),
        &pack.personalities,
        &pack.traits,
        crate::household::Member {
            name: "Sitter".into(),
            personality: 0,
            position: Position { x: 0., y: 0. },
            needs: [100.; 7],
            hobbies: vec![],
            traits: &[],
            career: None,
            instinct: Some(50),
        },
    );
    sim.world_mut()
        .entity_mut(person)
        .insert(IntentQueue::from_intents(vec![Intent {
            cleanup: None,
            chore: None,
            object: chair,
            interaction,
        }]));
    person
}

#[test]
fn physical_sofa_admits_three_travelling_sitters_and_refuses_fourth() {
    let mut sim = Sim::new_with_lot(16, 16);
    let pack = sim.world().resource::<Content>().0;
    let definition = pack.find("long_sofa").unwrap();
    let sit = pack
        .object(definition)
        .interactions
        .iter()
        .position(|a| a.id == "sit")
        .expect("Sofa has a Sit action") as u32;
    let chair = sim.spawn_object(Position { x: 5., y: 5. }, definition);
    let people: Vec<_> = (0..4).map(|_| sitter(&mut sim, chair, sit)).collect();
    sim.tick();
    assert_eq!(
        people
            .iter()
            .filter(|p| sim
                .world()
                .get::<Target>(**p)
                .is_some_and(|t| t.object == chair))
            .count(),
        3
    );
    assert!(people[..3]
        .iter()
        .all(|p| sim.world().get::<Path>(*p).is_some()));
    let saved = sim.save_snapshot_v6();
    assert!(sim.load_snapshot_v6(saved.clone()).is_ok());
    assert_eq!(sim.save_snapshot_v6(), saved);
}

/// The autonomy pass must record each seat as it is claimed, so Sims choosing
/// in one pass take distinct seats and the one left over waits. Only Sit
/// advertises here and every draw is decisive, so the count measures seat
/// admission rather than which sofa action scores highest.
#[test]
fn autonomous_sitters_take_one_seat_each_and_the_extra_sitter_waits() {
    let mut sim = Sim::new_with_lot(16, 16);
    let mut pack = sim.world().resource::<Content>().0.clone();
    pack.tuning.choice_temperature = 0.0001;
    pack.tuning.choice_comfort_temperature = 0.0001;
    pack.tuning.choice_exploration = 1e-8;
    pack.tuning.choice_comfort_exploration = 1e-8;
    let definition = pack.find("long_sofa").unwrap();
    for action in &mut pack.objects[definition.0 as usize].interactions {
        if action.id != "sit" {
            action.advertises.clear();
        }
    }
    let pack: &'static terri_data::ContentPack = Box::leak(Box::new(pack));
    sim.world_mut().insert_resource(Content(pack));
    let seats = pack.object(definition).seats.len();
    assert!(seats >= 2, "the long sofa must have several seats to share");
    let sofa = sim.spawn_object(Position { x: 5., y: 5. }, definition);
    let people: Vec<_> = (0..=seats)
        .map(|_| {
            let person = sitter(&mut sim, sofa, 0);
            sim.world_mut().entity_mut(person).remove::<IntentQueue>();
            sim.world_mut()
                .get_mut::<terri_core::Needs>(person)
                .unwrap()
                .set(terri_core::NeedId::Comfort, 0.);
            person
        })
        .collect();
    sim.tick();
    let (seated, refused): (Vec<_>, Vec<_>) = people.into_iter().partition(|person| {
        sim.world()
            .get::<Target>(*person)
            .is_some_and(|target| target.object == sofa)
    });
    assert_eq!(
        seated.len(),
        seats,
        "All want the sofa; autonomy must admit one sitter per seat"
    );
    let mut claimed: Vec<_> = seated
        .iter()
        .map(|person| {
            let claim = sim
                .world()
                .get::<super::PhysicalClaim>(*person)
                .expect("an admitted sitter holds a physical seat");
            assert!(!claim.all, "Sit claims one seat, not the whole sofa");
            claim.seat.clone()
        })
        .collect();
    claimed.sort();
    claimed.dedup();
    assert_eq!(
        claimed.len(),
        seats,
        "Each sitter must hold a different seat"
    );
    assert_eq!(refused.len(), 1);
    assert!(
        sim.world().get::<terri_core::Blocked>(refused[0]).is_some(),
        "The extra sitter must wait rather than act"
    );
    assert_eq!(
        sim.world()
            .get::<crate::waiting::WaitingNeeds>(refused[0])
            .map(|waiting| waiting.1),
        Some(sofa),
        "The extra sitter must wait for the full sofa"
    );
}

#[test]
fn physical_sit_is_available_on_each_seating_type() {
    let pack = terri_data::pack();
    for model in [
        "armchair",
        "reading_chair",
        "chair",
        "desk_chair",
        "sofa",
        "long_sofa",
    ] {
        assert!(
            pack.object(pack.find(model).unwrap())
                .interactions
                .iter()
                .any(|a| a.label == "Sit" && a.seat_use == terri_data::SeatUse::One),
            "{model}"
        );
    }
}

#[test]
fn physical_sofa_recline_blocks_all_places_and_sitting_blocks_recline() {
    for recline_first in [false, true] {
        let mut sim = Sim::new_with_lot(16, 16);
        let pack = sim.world().resource::<Content>().0;
        let def = pack.find("long_sofa").unwrap();
        let sit = pack
            .object(def)
            .interactions
            .iter()
            .position(|a| a.id == "sit")
            .expect("Sit") as u32;
        let recline = pack
            .object(def)
            .interactions
            .iter()
            .position(|a| a.id == "stretch_out")
            .unwrap() as u32;
        let sofa = sim.spawn_object(Position { x: 5., y: 5. }, def);
        let first = sitter(&mut sim, sofa, if recline_first { recline } else { sit });
        let second = sitter(&mut sim, sofa, if recline_first { sit } else { recline });
        sim.tick();
        assert!(sim.world().get::<Target>(first).is_some());
        assert!(sim.world().get::<Target>(second).is_none());
    }
}

#[test]
fn physical_sitting_round_trips_and_a_missing_claim_rolls_back() {
    let mut sim = Sim::new_with_lot(16, 16);
    let pack = sim.world().resource::<Content>().0;
    let chair = sim.spawn_object(Position { x: 5., y: 5. }, pack.find("armchair").unwrap());
    let person = sitter(&mut sim, chair, 0);
    sim.tick();
    let good = sim.save_snapshot_v6();
    assert!(sim.load_snapshot_v6(good.clone()).is_ok());
    assert!(sim.world().get::<Path>(person).is_some());
    assert_eq!(sim.save_snapshot_v6(), good);
    assert_eq!(good.seats.len(), 1);
    let hash = sim.world_hash();
    let mut missing = good.clone();
    missing.seats.clear();
    let mut unknown = good.clone();
    unknown.seats[0].seat = "unknown".into();
    let mut duplicate = good.clone();
    duplicate.seats.push(good.seats[0].clone());
    let mut wrong_target = good.clone();
    wrong_target.seats[0].action = "wrong".into();
    let mut unreserved = good.clone();
    unreserved
        .legacy
        .world
        .entities
        .iter_mut()
        .find(|e| e.index == chair.index_u32())
        .unwrap()
        .reserved = false;
    for corrupt in [missing, unknown, duplicate, wrong_target, unreserved] {
        assert!(sim.load_snapshot_v6(corrupt).is_err());
        assert_eq!(sim.save_snapshot_v6(), good);
        assert_eq!(sim.world_hash(), hash);
    }
}

#[test]
fn physical_sit_uses_authored_front_in_every_direction() {
    for facing in Facing::ALL {
        let mut sim = Sim::new_with_lot(16, 16);
        let pack = sim.world().resource::<Content>().0;
        let def = pack.find("armchair").unwrap();
        let chair = sim.spawn_object(Position { x: 5., y: 5. }, def);
        crate::apply_object_placement(
            sim.world_mut(),
            chair,
            pack.object(def),
            Position { x: 5., y: 5. },
            facing,
        );
        let person = sitter(&mut sim, chair, 0);
        sim.tick();
        let (dx, dy) = facing.rotate_axis(0, 1);
        assert_eq!(
            sim.world().get::<Path>(person).unwrap().steps.last(),
            Some(&(5 + dx, 5 + dy))
        );
    }
}

#[test]
fn physical_sofa_places_are_reused_after_completion_cancellation_and_death() {
    for reason in 0..3 {
        let mut sim = Sim::new_with_lot(16, 16);
        let pack = sim.world().resource::<Content>().0;
        let def = pack.find("long_sofa").unwrap();
        let sit = pack
            .object(def)
            .interactions
            .iter()
            .position(|a| a.id == "sit")
            .unwrap() as u32;
        let chair = sim.spawn_object(Position { x: 5., y: 5. }, def);
        let people: Vec<_> = (0..4).map(|_| sitter(&mut sim, chair, sit)).collect();
        sim.tick();
        let expected = sim
            .world()
            .get::<super::PhysicalClaim>(people[0])
            .unwrap()
            .seat
            .clone();
        match reason {
            0 => {
                for _ in 0..180 {
                    if sim.world().get::<Eating>(people[0]).is_some() {
                        break;
                    }
                    sim.tick();
                }
                sim.world_mut()
                    .get_mut::<Eating>(people[0])
                    .unwrap()
                    .remaining_ticks = 1;
                sim.tick();
            }
            1 => {
                let target = *sim.world().get::<Target>(people[0]).unwrap();
                crate::reservations::release_now(sim.world_mut(), people[0], target);
                sim.world_mut()
                    .entity_mut(people[0])
                    .remove::<Target>()
                    .remove::<Path>()
                    .remove::<IntentQueue>();
            }
            _ => {
                sim.world_mut()
                    .get_mut::<terri_core::Needs>(people[0])
                    .unwrap()
                    .set(terri_core::NeedId::Hunger, 0.);
                let threshold = pack.tuning.death_after_ticks;
                let mut state = sim
                    .world_mut()
                    .resource_mut::<terri_core::save::SavedMortality>();
                state.enabled = true;
                state.counts = vec![(people[0].index_u32(), threshold - 1)];
                crate::mortality::tick(sim.world_mut());
            }
        }
        assert!(
            !sim.world()
                .get::<IntentQueue>(people[3])
                .unwrap()
                .is_empty(),
            "waiting order survives reason {reason}"
        );
        sim.tick();
        assert_eq!(
            sim.world()
                .get::<super::PhysicalClaim>(people[3])
                .unwrap_or_else(|| panic!("no replacement claim after reason {reason}"))
                .seat,
            expected
        );
    }
}

#[test]
fn physical_media_and_sitting_admission_share_one_chair_in_both_orders() {
    for viewer_first in [true, false] {
        let (mut sim, first, device, chair) = fixture();
        if !viewer_first {
            sim.world_mut()
                .entity_mut(first)
                .insert(IntentQueue::from_intents(vec![Intent {
                    cleanup: None,
                    chore: None,
                    object: chair,
                    interaction: 0,
                }]));
        }
        let other = sitter(&mut sim, if viewer_first { chair } else { device }, 0);
        sim.tick();
        assert_eq!(
            sim.world()
                .get::<super::PhysicalClaim>(first)
                .unwrap()
                .furniture,
            chair
        );
        assert!(sim.world().get::<super::PhysicalClaim>(other).is_none());
        if viewer_first {
            assert!(sim.world().get::<Target>(other).is_none());
        } else {
            assert_eq!(sim.world().get::<Target>(other).unwrap().object, device);
        }
    }
}

#[test]
fn physical_published_media_lease_migrates_to_stable_current_seat() {
    let frozen = Content::pre_books().0;
    let mut sim = Sim::new_with_lot_and_content(16, 16, Content::pre_books());
    let device = sim.spawn_object(
        Position { x: 2., y: 3. },
        frozen.find("television").unwrap(),
    );
    let chair = sim.spawn_object(Position { x: 5., y: 3. }, frozen.find("armchair").unwrap());
    crate::apply_object_placement(
        sim.world_mut(),
        chair,
        frozen.object(frozen.find("armchair").unwrap()),
        Position { x: 5., y: 3. },
        Facing::SouthWest,
    );
    let person = sitter(&mut sim, device, 0);
    sim.world_mut()
        .entity_mut(person)
        .insert(Position { x: 0., y: 3. });
    sim.world_mut()
        .entity_mut(person)
        .remove::<IntentQueue>()
        .insert((
            Target {
                object: device,
                interaction: 0,
            },
            Path {
                steps: vec![(0, 3), (1, 3), (1, 4), (2, 4), (3, 4), (4, 4), (4, 3)],
                cursor: 0,
            },
        ));
    sim.world_mut()
        .entity_mut(device)
        .insert(terri_core::Reserved);
    sim.world_mut()
        .insert_resource(terri_core::save::SavedDining {
            diners: vec![terri_core::save::SavedDiner {
                person: person.index_u32(),
                station: device.index_u32(),
                chair: Some(chair.index_u32()),
                setting: None,
                endpoint: (4, 3),
                obstructing: vec![],
            }],
            ..Default::default()
        });
    let saved = sim.save_snapshot_v5();
    let mut current = Sim::new_with_lot(16, 16);
    current
        .load_legacy_snapshot(crate::LegacySnapshot::V5(Box::new(saved)))
        .unwrap();
    let claims = current.save_snapshot_v6().seats;
    assert_eq!(claims.len(), 1);
    assert_eq!(claims[0].seat, "seat");
    assert_eq!(claims[0].furniture, chair.index_u32());
    let saved = current.save_snapshot_v6();
    assert!(current.load_snapshot_v6(saved.clone()).is_ok());
    assert_eq!(current.save_snapshot_v6(), saved);
}

#[test]
fn physical_media_and_ordinary_users_share_distinct_sofa_places() {
    let (mut sim, viewer, _, sofa) = fixture_with_device(
        "television",
        Position { x: 2., y: 3. },
        Position { x: 5., y: 3. },
        Facing::SouthEast,
        Facing::SouthWest,
        "long_sofa",
    );
    let pack = sim.world().resource::<Content>().0;
    let sit = pack
        .object(pack.find("long_sofa").unwrap())
        .interactions
        .iter()
        .position(|a| a.id == "sit")
        .unwrap() as u32;
    let others: Vec<_> = (0..3).map(|_| sitter(&mut sim, sofa, sit)).collect();
    sim.tick();
    assert!(sim.world().get::<super::PhysicalClaim>(viewer).is_some());
    assert_eq!(
        others
            .iter()
            .filter(|p| sim.world().get::<super::PhysicalClaim>(**p).is_some())
            .count(),
        2
    );
    let good = sim.save_snapshot_v6();
    assert_eq!(good.seats.len(), 3);
    let mut duplicate = good.clone();
    duplicate.seats[1].seat = duplicate.seats[0].seat.clone();
    assert!(sim.load_snapshot_v6(duplicate).is_err());
    assert_eq!(sim.save_snapshot_v6(), good);
    let hash = sim.world_hash();
    sim.load_snapshot_v6(good.clone()).unwrap();
    assert_eq!(sim.save_snapshot_v6(), good);
    assert_eq!(sim.world_hash(), hash);
}

#[test]
fn physical_claims_survive_entity_generation_reuse_and_seat_definition_reordering() {
    let mut sim = Sim::new_with_lot(16, 16);
    let unused = sim.world_mut().spawn_empty().id();
    sim.world_mut().despawn(unused);
    let pack = sim.world().resource::<Content>().0;
    let def = pack.find("long_sofa").unwrap();
    let sofa = sim.spawn_object(Position { x: 5., y: 5. }, def);
    assert_eq!(sofa.index_u32(), unused.index_u32());
    assert_ne!(sofa, unused);
    let sit = pack
        .object(def)
        .interactions
        .iter()
        .position(|a| a.id == "sit")
        .unwrap() as u32;
    let people: Vec<_> = (0..3).map(|_| sitter(&mut sim, sofa, sit)).collect();
    sim.tick();
    let saved = sim.save_snapshot_v6();
    let hash = sim.world_hash();
    let mut changed = pack.clone();
    changed.objects[def.0 as usize].seats.reverse();
    let changed = Box::leak(Box::new(changed));
    sim.world_mut().insert_resource(Content(changed));
    sim.load_snapshot_v6(saved.clone()).unwrap();
    assert_eq!(sim.save_snapshot_v6(), saved);
    assert_eq!(sim.world_hash(), hash);
    for _ in 0..180 {
        if people
            .iter()
            .all(|p| sim.world().get::<Eating>(*p).is_some())
        {
            sim.sync_render_buffer();
            let buffer = sim.render_buffer();
            let positions: std::collections::BTreeSet<_> = people
                .iter()
                .map(|p| {
                    let row = buffer
                        .ids
                        .iter()
                        .position(|id| *id == p.index_u32())
                        .unwrap();
                    assert_eq!(
                        buffer.visual_actions[row],
                        crate::render_buffer::visual_action::SIT
                    );
                    (
                        buffer.positions[2 * row].to_bits(),
                        buffer.positions[2 * row + 1].to_bits(),
                    )
                })
                .collect();
            assert_eq!(positions.len(), 3);
            let active = sim.save_snapshot_v6();
            sim.load_snapshot_v6(active.clone()).unwrap();
            assert_eq!(sim.save_snapshot_v6(), active);
            return;
        }
        sim.tick();
    }
    panic!("All three admitted sitters must reach their individual body positions");
}

#[test]
fn regression_stale_seat_release_preserves_a_reused_person_generation() {
    let (mut sim, person, device, chair) = fixture();
    sim.tick();
    let old_target = *sim.world().get::<Target>(person).unwrap();
    crate::reservations::release_now(sim.world_mut(), person, old_target);
    sim.world_mut().despawn(person);
    let replacement = sitter(&mut sim, device, 0);
    assert_eq!(replacement.index_u32(), person.index_u32());
    assert_ne!(replacement, person);
    sim.tick();
    assert_eq!(
        sim.world()
            .get::<super::PhysicalClaim>(replacement)
            .unwrap()
            .furniture,
        chair
    );
    let before = sim.save_snapshot_v6();
    let hash = sim.world_hash();
    crate::reservations::release_now(sim.world_mut(), person, old_target);
    assert_eq!(sim.save_snapshot_v6(), before);
    assert_eq!(sim.world_hash(), hash);
}

#[test]
fn media_users_keep_distinct_destinations_when_sofa_seats_share_one_approach() {
    let (mut sim, first, tv, sofa) = fixture_with_device(
        "television",
        Position { x: 2., y: 3. },
        Position { x: 5., y: 3. },
        Facing::SouthEast,
        Facing::SouthWest,
        "long_sofa",
    );
    let pack = sim.world().resource::<Content>().0;
    let sit = pack
        .object(pack.find("long_sofa").unwrap())
        .interactions
        .iter()
        .position(|a| a.id == "sit")
        .unwrap() as u32;
    sim.world_mut()
        .entity_mut(first)
        .insert(IntentQueue::from_intents(vec![Intent {
            cleanup: None,
            chore: None,
            object: sofa,
            interaction: sit,
        }]));
    sim.tick();
    let radio = sim.spawn_object(Position { x: 2., y: 4. }, pack.find("radio").unwrap());
    let viewer = sitter(&mut sim, tv, 0);
    let listener = sitter(&mut sim, radio, 0);
    sim.tick();
    let viewer_place = super::claim(sim.world(), viewer.index_u32())
        .unwrap()
        .clone();
    assert_eq!(viewer_place.chair, Some(sofa.index_u32()));
    let places = super::physical_places(sim.world_mut());
    let listener_place = places
        .iter()
        .find(|p| p.person == listener.index_u32())
        .unwrap();
    assert_ne!(viewer_place.endpoint, listener_place.endpoint);
    assert_eq!(sim.world().get::<Target>(listener).unwrap().object, radio);
    assert!(
        super::claim(sim.world(), listener.index_u32()).is_none(),
        "a conflicting sofa approach uses a distinct standing endpoint"
    );
    let saved = sim.save_snapshot_v6();
    sim.load_snapshot_v6(saved.clone()).unwrap();
    assert_eq!(sim.save_snapshot_v6(), saved);
}

#[test]
fn media_destinations_are_exclusive_while_reading_seat_approaches_can_be_shared() {
    use super::{endpoints_conflict, EndpointUse, UseKind};
    let mut world = bevy_ecs::world::World::new();
    let first = world.spawn_empty().id();
    let second = world.spawn_empty().id();
    let reading = EndpointUse {
        owner: first,
        endpoint: (4, 4),
        kind: UseKind::Media,
    };
    let other_reading = EndpointUse {
        owner: second,
        ..reading
    };
    assert!(!endpoints_conflict(reading, other_reading, false));
    let viewer = EndpointUse {
        owner: second,
        kind: UseKind::MediaEndpoint,
        ..reading
    };
    assert!(endpoints_conflict(reading, viewer, false));
    assert!(endpoints_conflict(
        EndpointUse {
            kind: UseKind::MediaEndpoint,
            ..reading
        },
        viewer,
        false
    ));
}

#[test]
fn a_larger_book_reading_comfort_bonus_cannot_leak_into_media_seating() {
    use terri_core::{NeedId, Needs, Personality};
    let (mut sim, person, _, chair) = fixture_with_device(
        "television",
        Position { x: 2., y: 3. },
        Position { x: 5., y: 3. },
        Facing::SouthEast,
        Facing::NorthWest,
        "reading_chair",
    );
    sim.world_mut()
        .entity_mut(person)
        .insert(Personality::neutral());
    for _ in 0..120 {
        sim.tick();
        if sim.world().get::<Eating>(person).is_some() {
            break;
        }
    }
    let lease = super::claim(sim.world(), person.index_u32()).unwrap();
    assert_eq!(lease.chair, Some(chair.index_u32()));
    assert!(crate::media::valid_lease(sim.world(), lease));
    let ordinary_read = sim.reading_model_benefits("reading_chair", "settle_in")[1];
    let mut amplified = sim.world().resource::<Content>().0.clone();
    let id = amplified.find("reading_chair").unwrap();
    let reading = amplified.objects[id.0 as usize]
        .interactions
        .iter_mut()
        .find(|action| action.book_reading)
        .unwrap();
    reading
        .advertises
        .iter_mut()
        .find(|(need, _)| *need as usize == NeedId::Comfort.index())
        .unwrap()
        .1 = 100.;
    assert!(
        100. / reading.duration_ticks as f32 > 29. / 41.,
        "the counterfactual reading rate exceeds ordinary physical sitting"
    );
    sim.world_mut()
        .insert_resource(Content(Box::leak(Box::new(amplified))));
    assert!(sim.reading_model_benefits("reading_chair", "settle_in")[1] > ordinary_read);
    *sim.world_mut().get_mut::<Needs>(person).unwrap() = Needs::all_at(30.);
    crate::need_interactions::tick(sim.world_mut());
    let needs = sim.world().get::<Needs>(person).unwrap();
    assert!((needs.get(NeedId::Comfort) - 30. - 29. / 41.).abs() < 0.00001);
    assert_eq!(needs.get(NeedId::Fun), 30.);
    assert_eq!(needs.get(NeedId::Energy), 30.);
}
