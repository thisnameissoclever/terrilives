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
fn endpoint_media_users_can_share_an_approach_on_distinct_sofa_seats() {
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
    let a = super::claim(sim.world(), viewer.index_u32()).unwrap();
    let b = super::claim(sim.world(), listener.index_u32()).unwrap();
    assert_eq!(a.endpoint, (4, 4));
    assert_eq!(b.endpoint, (4, 4));
    assert_ne!(
        sim.world()
            .get::<super::PhysicalClaim>(viewer)
            .unwrap()
            .seat,
        sim.world()
            .get::<super::PhysicalClaim>(listener)
            .unwrap()
            .seat
    );
    let saved = sim.save_snapshot_v6();
    sim.load_snapshot_v6(saved.clone()).unwrap();
    assert_eq!(sim.save_snapshot_v6(), saved);
}
