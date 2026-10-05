use crate::{Content, Sim};
use terri_core::{Eating, Facing, Intent, IntentQueue, Path, Position, Target};

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
            object: device,
            interaction: 0,
        }]));
    (sim, person, device, chair)
}

#[test]
fn television_order_routes_to_available_front_seat_but_keeps_device_target() {
    let (mut sim, person, device, _) = fixture();
    sim.tick();
    assert_eq!(sim.world().get::<Target>(person).unwrap().object, device);
    assert_eq!(
        sim.world().get::<Path>(person).unwrap().steps.last(),
        Some(&(4, 3)),
        "A suitable seat must replace the ordinary device-perimeter route"
    );
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
