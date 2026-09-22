use super::*;
use crate::{Content, Sim};
use terri_core::{
    Agent, CommandQueue, Facing, ObjectFacing, Path, Position, Reserved, SimCommand, SmartObject,
    TileGrid,
};

#[test]
fn footprint_fit_requires_nonzero_dimensions_and_checked_bounds() {
    let grid = TileGrid::new(4, 3);
    assert!(fits(&grid, (2, 1), Footprint { width: 2, depth: 2 }));
    for footprint in [
        Footprint { width: 0, depth: 1 },
        Footprint { width: 1, depth: 0 },
        Footprint { width: 0, depth: 0 },
    ] {
        assert!(!fits(&grid, (1, 1), footprint));
    }
    for origin in [(3, 1), (2, 2), (u32::MAX, 1), (1, u32::MAX)] {
        assert!(!fits(&grid, origin, Footprint { width: 2, depth: 2 }));
    }
}

#[test]
fn usable_approaches_include_every_side_and_exclude_blocked_contacts() {
    let mut world = World::new();
    let rect = Rectangle {
        entity: Some(world.spawn_empty().id()),
        origin: (2, 2),
        footprint: Footprint { width: 2, depth: 2 },
    };
    let mut grid = TileGrid::new(6, 6);
    for (x, y) in [(2, 2), (3, 2), (2, 3), (3, 3)] {
        grid.set_blocked(x, y, true);
    }
    let mut expected = HashSet::from([
        (2, 1),
        (3, 1),
        (2, 4),
        (3, 4),
        (1, 2),
        (1, 3),
        (4, 2),
        (4, 3),
    ]);
    let actual = approaches(rect, &grid);
    assert_eq!(actual.len(), expected.len());
    assert_eq!(actual.into_iter().collect::<HashSet<_>>(), expected);

    grid.set_edge_blocked((2, 1), (2, 2), true);
    grid.set_blocked(3, 4, true);
    expected.remove(&(2, 1));
    expected.remove(&(3, 4));
    assert_eq!(
        approaches(rect, &grid).into_iter().collect::<HashSet<_>>(),
        expected
    );
}

#[test]
fn architecture_dimensions_require_nonzero_signed_coordinate_bounds_on_each_axis() {
    let limit = i32::MAX as usize;
    for dimensions in [(1, 1), (limit, 1), (1, limit), (limit, limit)] {
        assert!(architecture_dimensions_valid(dimensions.0, dimensions.1));
    }
    for dimensions in [
        (0, 0),
        (0, 1),
        (1, 0),
        (limit + 1, 1),
        (1, limit + 1),
        (limit + 2, 1),
        (1, limit + 2),
        (usize::MAX, 1),
        (1, usize::MAX),
        (usize::MAX, usize::MAX),
    ] {
        assert!(!architecture_dimensions_valid(dimensions.0, dimensions.1));
    }
    let mut world = World::new();
    world.insert_resource(SavedLayout::LegacyCells { walls: vec![] });
    for dimensions in [(0, 0), (0, 1), (1, 0)] {
        assert!(matches!(
            fixed_architecture(&world, &TileGrid::new(dimensions.0, dimensions.1)),
            Err(PlacementRefusal::UnsupportedLayout)
        ));
    }
}

#[test]
fn legacy_architecture_rejects_each_invalid_coordinate_and_duplicate_wall_cell() {
    let mut world = World::new();
    let live = TileGrid::new(4, 3);
    for walls in [
        vec![(4, 0)],
        vec![(0, 3)],
        vec![(4, 3)],
        vec![(u32::MAX, 0)],
        vec![(0, u32::MAX)],
        vec![(i32::MAX as u32 + 1, 0)],
        vec![(0, i32::MAX as u32 + 1)],
        vec![(1, 1), (1, 1)],
    ] {
        world.insert_resource(SavedLayout::LegacyCells { walls });
        assert!(matches!(
            fixed_architecture(&world, &live),
            Err(PlacementRefusal::UnsupportedLayout)
        ));
        assert!(live.is_walkable(1, 1));
    }
    world.insert_resource(SavedLayout::LegacyCells {
        walls: vec![(0, 0), (3, 2)],
    });
    let rebuilt = fixed_architecture(&world, &live).unwrap();
    assert!(!rebuilt.is_walkable(0, 0));
    assert!(!rebuilt.is_walkable(3, 2));
    assert!(rebuilt.is_walkable(1, 1));
}

fn place(sim: &mut Sim, object: u32, origin: (u32, u32), facing: Facing) {
    sim.world_mut()
        .resource_mut::<CommandQueue>()
        .push(SimCommand::PlaceObject {
            object,
            x: origin.0,
            y: origin.1,
            facing,
        });
    sim.flush_commands();
}

fn valid_move(sim: &Sim, object: u32, facing: Facing) -> (u32, u32) {
    let entity = object_definition(sim.world(), object).unwrap().0;
    let pos = sim.world().get::<Position>(entity).unwrap();
    let lot = &sim.world().resource::<Content>().0.lot;
    (0..lot.height)
        .flat_map(|y| (0..lot.width).map(move |x| (x, y)))
        .find(|&(x, y)| {
            (x as f32, y as f32) != (pos.x, pos.y)
                && validate_placement(sim.world(), object, (x, y), facing).is_ok()
        })
        .expect("fixture has a movable object")
}

fn fixture() -> (Sim, u32) {
    let mut pack = terri_data::pack().clone();
    pack.lot.width = 7;
    pack.lot.height = 7;
    pack.lot.wall_edges.clear();
    pack.lot.walls = (0..7).filter(|&y| y != 3).map(|y| (3, y)).collect();
    pack.lot.placements.clear();
    pack.lot.front_door = Some((6, 3));
    pack.portals[0].position = (6, 3);
    pack.portals[0].inward = (5, 3);
    let pack = Box::leak(Box::new(pack));
    let mut sim = Sim::new_from_lot(&pack.lot, &pack.objects);
    sim.world_mut().insert_resource(Content(pack));
    let id = pack.find("fridge").unwrap();
    let entity = sim.spawn_object(Position { x: 0.0, y: 0.0 }, id);
    sim.world_mut()
        .resource_mut::<TileGrid>()
        .set_blocked(0, 0, true);
    (sim, entity.index_u32())
}

fn edge_fixture(edges: Vec<terri_core::layout::WallEdge>) -> (Sim, u32) {
    let (mut sim, object) = fixture();
    let mut grid = TileGrid::new(7, 7);
    grid.set_blocked(0, 0, true);
    for edge in &edges {
        let [a, b] = edge.cells();
        grid.set_edge_blocked(a, b, !edge.doorway);
    }
    sim.world_mut().insert_resource(grid);
    sim.world_mut()
        .insert_resource(terri_core::layout::SavedLayout::EdgeWallsV1 { edges });
    (sim, object)
}

fn vertical(x: u32, y: u32) -> terri_core::layout::WallEdge {
    terri_core::layout::WallEdge {
        axis: terri_core::layout::EdgeAxis::Vertical,
        x,
        y,
        doorway: false,
    }
}

/// Review finding [F8] on PR 96. A sim walking to the fridge along a walk that
/// ends out of its reach: the edge-wall loader refuses that save, the cell-wall
/// loader does not check it. A purchase elsewhere is held to the checks of the
/// loader that will read the save, so it goes ahead in the cell-wall house and
/// is refused in the edge-wall one.
#[test]
fn a_lot_edit_is_held_only_to_the_grid_checks_its_own_loader_runs() {
    use crate::placement::purchase::{validate_purchase, Purchase};
    let walker = |sim: &mut Sim, fridge: u32| {
        let fridge = object_definition(sim.world(), fridge).unwrap().0;
        sim.world_mut().spawn((
            terri_core::Agent,
            Position { x: 5.0, y: 5.0 },
            terri_core::Path {
                steps: vec![(5, 4)],
                cursor: 0,
            },
            Target {
                object: fridge,
                interaction: 0,
            },
        ));
        sim.world_mut().insert_resource(terri_core::Funds(1_000));
    };
    let pack = terri_data::pack();
    let chair = pack.find("chair").unwrap().0;
    let purchase = Purchase {
        definition: chair,
        x: 5,
        y: 1,
        facing: pack.objects[chair as usize].base_facing,
    };

    let (mut cells, fridge) = fixture();
    assert!(matches!(
        cells.world().resource::<SavedLayout>(),
        SavedLayout::LegacyCells { .. }
    ));
    walker(&mut cells, fridge);
    let (mut reader, _) = fixture();
    reader
        .load_snapshot_v3(cells.save_snapshot_v3())
        .expect("the cell-wall loader accepts the walk");
    assert!(validate_purchase(cells.world(), purchase).is_ok());

    let (mut edges, fridge) = edge_fixture(vec![]);
    walker(&mut edges, fridge);
    assert_eq!(
        validate_purchase(edges.world(), purchase).unwrap_err(),
        PlacementRefusal::BlockedRoute
    );
}

#[test]
fn placement_saved_architecture_overrides_current_content_and_preserves_edges() {
    let (mut sim, object) = edge_fixture(vec![vertical(3, 1)]);
    let f = facing(&sim, object);
    place(&mut sim, object, (3, 0), f);
    assert_eq!(
        sim.world()
            .resource::<LotEditState>()
            .last_result
            .unwrap()
            .reason,
        None
    );
    let grid = sim.world().resource::<TileGrid>();
    assert!(!grid.can_cross((2, 1), (3, 1)));
    assert!(
        grid.is_walkable(3, 2),
        "current content walls leaked into saved architecture"
    );
    assert!(validate_placement(sim.world(), object, (4, 0), f).is_ok());
    sim.world_mut()
        .resource_mut::<TileGrid>()
        .set_edge_blocked((1, 2), (2, 2), true);
    refusal(
        &mut sim,
        object,
        (4, 0),
        f,
        PlacementRefusal::UnsupportedLayout,
    );
}

#[test]
fn placement_legacy_cells_own_walls_and_unknown_ownership_refuses() {
    use terri_core::layout::SavedLayout;
    let (mut sim, object) = edge_fixture(vec![]);
    sim.world_mut().insert_resource(SavedLayout::LegacyCells {
        walls: vec![(2, 2)],
    });
    sim.world_mut()
        .resource_mut::<TileGrid>()
        .set_blocked(2, 2, true);
    let f = facing(&sim, object);
    refusal(&mut sim, object, (2, 2), f, PlacementRefusal::WallOverlap);
    place(&mut sim, object, (3, 0), f);
    assert_eq!(
        sim.world()
            .resource::<LotEditState>()
            .last_result
            .unwrap()
            .reason,
        None
    );
    assert!(!sim.world().resource::<TileGrid>().is_walkable(2, 2));
    sim.world_mut()
        .insert_resource(SavedLayout::LegacyAuthoredV1);
    refusal(
        &mut sim,
        object,
        (4, 0),
        f,
        PlacementRefusal::UnsupportedLayout,
    );
}

#[test]
fn placement_invalid_saved_edges_refuse_without_panicking() {
    use terri_core::layout::SavedLayout;
    let (mut sim, object) = edge_fixture(vec![]);
    let f = facing(&sim, object);
    for edges in [
        vec![vertical(0, 1)],
        vec![vertical(7, 1)],
        vec![vertical(1, 7)],
        vec![vertical(2, 2), vertical(2, 2)],
        vec![
            vertical(2, 2),
            terri_core::layout::WallEdge {
                doorway: true,
                ..vertical(2, 2)
            },
        ],
    ] {
        sim.world_mut()
            .insert_resource(SavedLayout::EdgeWallsV1 { edges });
        refusal(
            &mut sim,
            object,
            (1, 0),
            f,
            PlacementRefusal::UnsupportedLayout,
        );
    }
}

#[test]
fn placement_rectangles_cannot_straddle_solid_edges_but_can_span_doorways() {
    let (mut sim, _) = edge_fixture(vec![vertical(3, 1)]);
    let desk = sim.spawn_object(
        Position { x: 0.0, y: 5.0 },
        terri_data::pack().find("desk").unwrap(),
    );
    for x in 0..2 {
        sim.world_mut()
            .resource_mut::<TileGrid>()
            .set_blocked(x, 5, true);
    }
    let object = desk.index_u32();
    let f = facing(&sim, object);
    refusal(&mut sim, object, (2, 1), f, PlacementRefusal::WallOverlap);
    sim.world_mut()
        .resource_mut::<TileGrid>()
        .set_edge_blocked((2, 1), (3, 1), false);
    sim.world_mut()
        .insert_resource(terri_core::layout::SavedLayout::EdgeWallsV1 {
            edges: vec![terri_core::layout::WallEdge {
                doorway: true,
                ..vertical(3, 1)
            }],
        });
    place(&mut sim, object, (2, 1), f);
    assert_eq!(
        sim.world()
            .resource::<LotEditState>()
            .last_result
            .unwrap()
            .reason,
        None
    );
    sim.world_mut()
        .resource_mut::<TileGrid>()
        .set_edge_blocked((2, 1), (3, 1), true);
    sim.world_mut()
        .insert_resource(terri_core::layout::SavedLayout::EdgeWallsV1 {
            edges: vec![vertical(3, 1)],
        });
    refusal(
        &mut sim,
        object,
        (0, 5),
        f,
        PlacementRefusal::UnsupportedLayout,
    );
}

#[test]
fn placement_remaining_continuous_route_cannot_cross_a_solid_edge() {
    let (mut sim, object) = edge_fixture(vec![vertical(2, 1)]);
    let f = facing(&sim, object);
    let agent = sim
        .world_mut()
        .spawn((
            Agent,
            Position { x: 1.25, y: 1.0 },
            Path {
                steps: vec![(2, 1)],
                cursor: 0,
            },
        ))
        .id();
    refusal(&mut sim, object, (0, 2), f, PlacementRefusal::BlockedRoute);
    sim.world_mut().entity_mut(agent).insert(Path {
        steps: vec![(1, 1), (1, 2), (2, 2)],
        cursor: 0,
    });
    assert!(validate_placement(sim.world(), object, (0, 2), f).is_ok());
    sim.world_mut().entity_mut(agent).insert(Path {
        steps: vec![(1, 1), (2, 1)],
        cursor: 0,
    });
    refusal(&mut sim, object, (0, 2), f, PlacementRefusal::BlockedRoute);
}

#[test]
fn placement_requires_usable_approaches_in_one_edge_connected_component() {
    use terri_core::layout::{EdgeAxis, WallEdge};
    let (mut sim, object) = edge_fixture(vec![
        vertical(4, 1),
        vertical(5, 1),
        WallEdge {
            axis: EdgeAxis::Horizontal,
            x: 4,
            y: 1,
            doorway: false,
        },
        WallEdge {
            axis: EdgeAxis::Horizontal,
            x: 4,
            y: 2,
            doorway: false,
        },
    ]);
    let f = facing(&sim, object);
    refusal(
        &mut sim,
        object,
        (4, 1),
        f,
        PlacementRefusal::InaccessibleInteraction,
    );
    let (mut sim, object) = edge_fixture((0..7).map(|y| vertical(3, y)).collect());
    sim.spawn_object(
        Position { x: 4.0, y: 4.0 },
        terri_data::pack().find("potted_plant").unwrap(),
    );
    sim.world_mut()
        .resource_mut::<TileGrid>()
        .set_blocked(4, 4, true);
    refusal(
        &mut sim,
        object,
        (1, 0),
        f,
        PlacementRefusal::InaccessibleInteraction,
    );
    sim.world_mut().spawn((Agent, Position { x: 4.0, y: 4.0 }));
    refusal(&mut sim, object, (1, 0), f, PlacementRefusal::SimOverlap);
    let (mut sim, object) = edge_fixture((0..7).map(|y| vertical(3, y)).collect());
    sim.world_mut().spawn((Agent, Position { x: 4.0, y: 4.0 }));
    refusal(&mut sim, object, (1, 0), f, PlacementRefusal::BlockedRoute);
}

#[test]
fn placement_hash_observes_every_command_field_and_stream_position() {
    let (mut sim, object) = fixture();
    let baseline = sim.world_hash();
    let f = facing(&sim, object);
    let command = SimCommand::PlaceObject {
        object,
        x: 1,
        y: 2,
        facing: f,
    };
    let variants = [
        command.clone(),
        SimCommand::PlaceObject {
            object: object + 1,
            x: 1,
            y: 2,
            facing: f,
        },
        SimCommand::PlaceObject {
            object,
            x: 2,
            y: 2,
            facing: f,
        },
        SimCommand::PlaceObject {
            object,
            x: 1,
            y: 3,
            facing: f,
        },
        SimCommand::PlaceObject {
            object,
            x: 1,
            y: 2,
            facing: f.turned(),
        },
    ];
    let mut hashes = HashSet::new();
    for variant in variants {
        sim.world_mut().resource_mut::<CommandQueue>().push(variant);
        let hash = sim.world_hash();
        assert_ne!(hash, baseline);
        assert!(
            hashes.insert(hash),
            "queued placement field absent from hash"
        );
        sim.world_mut()
            .resource_mut::<CommandQueue>()
            .drain()
            .for_each(drop);
        assert_eq!(sim.world_hash(), baseline);
    }
    let cancel = SimCommand::CancelIntents { agent: 99 };
    let mut order_hashes = HashSet::new();
    for commands in [
        vec![cancel.clone()],
        vec![cancel.clone(), command.clone()],
        vec![command, cancel],
    ] {
        for command in commands {
            sim.world_mut().resource_mut::<CommandQueue>().push(command);
        }
        assert!(
            order_hashes.insert(sim.world_hash()),
            "ordinary/edit stream order absent from hash"
        );
        sim.world_mut()
            .resource_mut::<CommandQueue>()
            .drain()
            .for_each(drop);
    }
    assert_eq!(sim.world_hash(), baseline);
}

#[test]
fn placement_scenery_blocks_and_moved_furniture_remains_usable() {
    let (mut sim, object) = fixture();
    let f = facing(&sim, object);
    let scenery = sim.spawn_object(
        Position { x: 2.0, y: 0.0 },
        terri_data::pack().find("potted_plant").unwrap(),
    );
    sim.world_mut()
        .resource_mut::<TileGrid>()
        .set_blocked(2, 0, true);
    refusal(
        &mut sim,
        object,
        (2, 0),
        f,
        PlacementRefusal::FurnitureOverlap,
    );
    assert!(sim.world().get::<SmartObject>(scenery).is_some());
    place(&mut sim, object, (1, 0), f);
    assert_eq!(
        sim.world()
            .resource::<LotEditState>()
            .last_result
            .unwrap()
            .reason,
        None
    );
    let agent = sim
        .world_mut()
        .spawn((
            Agent,
            Position { x: 1.0, y: 1.0 },
            terri_core::Needs::all_at(20.0),
            terri_core::IntentQueue::default(),
        ))
        .id();
    sim.world_mut()
        .resource_mut::<CommandQueue>()
        .push(SimCommand::UseObject {
            agent: agent.index_u32(),
            object,
            interaction: 0,
        });
    let mut used = false;
    for _ in 0..50 {
        sim.tick();
        if sim.world().get::<terri_core::Eating>(agent).is_some() {
            assert_eq!(
                sim.world().get::<Target>(agent).unwrap().object.index_u32(),
                object
            );
            used = true;
            break;
        }
    }
    assert!(
        used,
        "the moved fridge never began its existing interaction"
    );
    refusal(&mut sim, object, (0, 0), f, PlacementRefusal::InUse);
}

fn facing(sim: &Sim, object: u32) -> Facing {
    object_definition(sim.world(), object).unwrap().2
}

fn refusal(
    sim: &mut Sim,
    object: u32,
    origin: (u32, u32),
    facing: Facing,
    expected: PlacementRefusal,
) {
    let before = sim.save_snapshot_v3();
    assert_eq!(
        validate_placement(sim.world(), object, origin, facing).unwrap_err(),
        expected
    );
    assert_eq!(sim.save_snapshot_v3(), before, "preview wrote state");
    sim.world_mut()
        .resource_mut::<CommandQueue>()
        .push(SimCommand::PlaceObject {
            object,
            x: origin.0,
            y: origin.1,
            facing,
        });
    sim.flush_commands();
    assert_eq!(
        sim.world().resource::<LotEditState>().last_result,
        Some(PlacementResult {
            object,
            reason: Some(expected)
        })
    );
    assert_eq!(
        sim.save_snapshot_v3(),
        before,
        "refused transaction wrote state"
    );
}

#[test]
fn placement_refuses_wall_and_furniture_without_writes() {
    let (mut sim, object) = fixture();
    let f = facing(&sim, object);
    refusal(&mut sim, object, (3, 0), f, PlacementRefusal::WallOverlap);
    let other = sim.spawn_object(
        Position { x: 2.0, y: 0.0 },
        terri_data::pack().find("fridge").unwrap(),
    );
    assert_ne!(other.index_u32(), object);
    sim.world_mut()
        .resource_mut::<TileGrid>()
        .set_blocked(2, 0, true);
    refusal(
        &mut sim,
        object,
        (2, 0),
        f,
        PlacementRefusal::FurnitureOverlap,
    );
}

#[test]
fn placement_refuses_unknown_bounds_direction_in_use_sim_and_path() {
    let (mut sim, object) = fixture();
    let f = facing(&sim, object);
    refusal(
        &mut sim,
        u32::MAX,
        (1, 0),
        f,
        PlacementRefusal::UnknownObject,
    );
    refusal(
        &mut sim,
        object,
        (u32::MAX, 0),
        f,
        PlacementRefusal::OutOfBounds,
    );
    let entity = object_definition(sim.world(), object).unwrap().0;
    sim.world_mut().entity_mut(entity).insert(Reserved);
    refusal(&mut sim, object, (1, 0), f, PlacementRefusal::InUse);
    sim.world_mut().entity_mut(entity).remove::<Reserved>();
    let person = sim
        .world_mut()
        .spawn((Agent, Position { x: 1.0, y: 0.0 }))
        .id();
    refusal(
        &mut sim,
        person.index_u32(),
        (1, 0),
        f,
        PlacementRefusal::UnknownObject,
    );
    refusal(&mut sim, object, (1, 0), f, PlacementRefusal::SimOverlap);
    sim.world_mut().entity_mut(person).insert((
        Position { x: 1.0, y: 1.0 },
        Path {
            steps: vec![(1, 0)],
            cursor: 0,
        },
    ));
    refusal(&mut sim, object, (1, 0), f, PlacementRefusal::BlockedRoute);
    let mut pack = sim.world().resource::<Content>().0.clone();
    let id = sim.world().get::<SmartObject>(entity).unwrap().0;
    pack.objects[id.0 as usize].facing_sprites.0[Facing::NorthEast.code() as usize] = None;
    sim.world_mut()
        .insert_resource(Content(Box::leak(Box::new(pack))));
    refusal(
        &mut sim,
        object,
        (1, 0),
        Facing::NorthEast,
        PlacementRefusal::UnsupportedFacing,
    );
}

#[test]
fn placement_refuses_disconnected_approaches_door_and_landing() {
    let (mut sim, object) = fixture();
    let f = facing(&sim, object);
    refusal(
        &mut sim,
        object,
        (3, 3),
        f,
        PlacementRefusal::InaccessibleInteraction,
    );
    refusal(&mut sim, object, (6, 3), f, PlacementRefusal::BlockedDoor);
    refusal(
        &mut sim,
        object,
        (5, 3),
        f,
        PlacementRefusal::BlockedLanding,
    );
}

#[test]
fn placement_refuses_unowned_grid_and_accepts_authored_wall_provenance() {
    let (mut sim, object) = fixture();
    let f = facing(&sim, object);
    assert!(validate_placement(sim.world(), object, (1, 0), f).is_ok());
    sim.world_mut()
        .resource_mut::<TileGrid>()
        .set_blocked(2, 2, true);
    refusal(
        &mut sim,
        object,
        (1, 0),
        f,
        PlacementRefusal::UnsupportedLayout,
    );
}

#[test]
fn placement_commits_atomically_preserves_identity_queues_and_wall_cells() {
    let (mut sim, object) = fixture();
    let f = facing(&sim, object);
    let (entity, definition, _) = object_definition(sim.world(), object).unwrap();
    let before = sim.save_snapshot();
    let plan = validate_placement(sim.world(), object, (1, 0), f).unwrap();
    assert_eq!(
        (plan.origin, plan.facing, plan.footprint),
        ((1, 0), f, definition.footprint_at(f))
    );
    place(&mut sim, object, (1, 0), f);
    assert_eq!(
        sim.world().get::<Position>(entity),
        Some(&Position { x: 1.0, y: 0.0 })
    );
    assert_eq!(
        sim.world().get::<SmartObject>(entity),
        Some(&SmartObject(terri_data::pack().find("fridge").unwrap()))
    );
    assert_eq!(sim.world().resource::<LotEditState>().revision, 1);
    assert!(sim.world().resource::<TileGrid>().is_walkable(0, 0));
    assert!(!sim.world().resource::<TileGrid>().is_walkable(1, 0));
    for &(x, y) in &sim.world().resource::<Content>().0.lot.walls {
        assert!(!sim
            .world()
            .resource::<TileGrid>()
            .is_walkable(x as i32, y as i32));
    }
    assert_eq!(sim.save_snapshot().rng, before.rng);
    let after = sim.save_snapshot();
    place(&mut sim, object, (1, 0), f);
    assert_eq!(
        sim.world().resource::<LotEditState>().revision,
        1,
        "no-op bumped revision"
    );
    assert_eq!(sim.save_snapshot(), after);
    assert!(
        validate_placement(sim.world(), object, (0, 0), f).is_ok(),
        "moved provenance stays editable"
    );
}

#[test]
fn placement_cancel_before_edit_flushes_deferred_release_and_joined_matches_split() {
    use terri_core::{Intent, IntentQueue, Target};
    let setup = || {
        let (mut sim, object) = fixture();
        let entity = object_definition(sim.world(), object).unwrap().0;
        let mut queue = IntentQueue::default();
        queue.push(Intent {
            object: entity,
            interaction: 0,
        });
        let agent = sim
            .world_mut()
            .spawn((
                Agent,
                Position { x: 1.0, y: 1.0 },
                Target {
                    object: entity,
                    interaction: 0,
                },
                queue,
            ))
            .id();
        sim.world_mut().entity_mut(entity).insert(Reserved);
        (sim, object, agent.index_u32())
    };
    let (mut joined, object, agent) = setup();
    let (mut split, _, _) = setup();
    let f = facing(&joined, object);
    let commands = [
        SimCommand::Select(Some(agent)),
        SimCommand::CancelIntents { agent },
        SimCommand::PlaceObject {
            object,
            x: 1,
            y: 0,
            facing: f,
        },
        SimCommand::UseObject {
            agent,
            object,
            interaction: 0,
        },
    ];
    for command in &commands {
        joined
            .world_mut()
            .resource_mut::<CommandQueue>()
            .push(command.clone());
    }
    joined.flush_commands();
    for command in &commands {
        split
            .world_mut()
            .resource_mut::<CommandQueue>()
            .push(command.clone());
        split.flush_commands();
    }
    assert_eq!(joined.save_snapshot(), split.save_snapshot());
    assert_eq!(
        joined
            .world()
            .resource::<LotEditState>()
            .last_result
            .unwrap()
            .reason,
        None
    );
    assert_eq!(joined.save_snapshot().tick, 0);
    let agent_entity = joined
        .world_mut()
        .query::<(Entity, &Agent)>()
        .iter(joined.world())
        .next()
        .unwrap()
        .0;
    assert_eq!(
        joined
            .world()
            .get::<IntentQueue>(agent_entity)
            .unwrap()
            .as_slice()[0]
            .object
            .index_u32(),
        object
    );
    let (mut reversed, object, agent) = setup();
    place(&mut reversed, object, (1, 0), f);
    assert_eq!(
        reversed
            .world()
            .resource::<LotEditState>()
            .last_result
            .unwrap()
            .reason,
        Some(PlacementRefusal::InUse)
    );
    reversed
        .world_mut()
        .resource_mut::<CommandQueue>()
        .push(SimCommand::CancelIntents { agent });
    reversed.flush_commands();
    assert_eq!(reversed.world().resource::<LotEditState>().revision, 0);
}

#[test]
fn placement_reseeds_only_edited_furniture_preserving_fractional_walking_sample() {
    let (mut sim, object) = fixture();
    let f = facing(&sim, object);
    let agent = sim
        .world_mut()
        .spawn((
            Agent,
            Position { x: 1.0, y: 1.0 },
            Path {
                steps: vec![(2, 1)],
                cursor: 0,
            },
        ))
        .id();
    sim.sync_render_buffer();
    sim.world_mut()
        .entity_mut(agent)
        .insert(Position { x: 1.25, y: 1.0 });
    sim.sync_render_buffer();
    let slot = sim
        .render_buffer()
        .ids
        .iter()
        .position(|&id| id == agent.index_u32())
        .unwrap()
        * 2;
    let before = (
        sim.render_buffer().prev_positions[slot],
        sim.render_buffer().positions[slot],
    );
    assert_eq!(before, (1.0, 1.25));
    place(&mut sim, object, (0, 1), f);
    assert_eq!(
        sim.world()
            .resource::<LotEditState>()
            .last_result
            .unwrap()
            .reason,
        None
    );
    sim.sync_render_buffer_after_commands();
    let render = sim.render_buffer();
    let moved = render.ids.iter().position(|&id| id == object).unwrap() * 2;
    assert_eq!(
        &render.prev_positions[moved..moved + 2],
        &render.positions[moved..moved + 2]
    );
    assert_eq!(render.positions[moved + 1], 1.0);
    assert_eq!(
        (render.prev_positions[slot], render.positions[slot]),
        before
    );
    let alpha = 0.37;
    assert_eq!(
        render.prev_positions[slot] * (1.0 - alpha) + render.positions[slot] * alpha,
        1.0 + 0.25 * alpha
    );
    assert!(sim
        .world()
        .resource::<LotEditState>()
        .discontinuities
        .is_empty());
}

#[test]
fn placement_save_reload_keeps_rotated_rectangles_sockets_foregrounds_and_pending_commands() {
    let mut sim = Sim::new_from_shipped_lot();
    for name in ["desk", "bathtub", "reading_chair"] {
        let definition = sim.world().resource::<Content>().0.find(name).unwrap();
        let entity = sim
            .world_mut()
            .query::<(Entity, &SmartObject)>()
            .iter(sim.world())
            .find(|(_, o)| o.0 == definition)
            .unwrap()
            .0;
        let (_, def, base) = object_definition(sim.world(), entity.index_u32()).unwrap();
        let direction = def.next_supported_facing(base).unwrap();
        let origin = valid_move(&sim, entity.index_u32(), direction);
        let before = sim.world_hash();
        place(&mut sim, entity.index_u32(), origin, direction);
        assert_eq!(
            sim.world()
                .resource::<LotEditState>()
                .last_result
                .unwrap()
                .reason,
            None
        );
        assert_ne!(sim.world_hash(), before);
        assert_eq!(
            crate::placed_footprint(
                sim.world().resource::<Content>().0,
                definition,
                sim.world().get::<ObjectFacing>(entity)
            ),
            def.footprint_at(direction)
        );
        let expected = def.sockets_at(origin.0 as f32, origin.1 as f32, direction);
        assert_eq!(
            sim.world()
                .get::<crate::ResolvedActionSockets>(entity)
                .map(|s| s.0.as_slice())
                .unwrap_or(&[]),
            expected
        );
        assert_eq!(
            sim.world()
                .get::<crate::ForegroundSprite>(entity)
                .map(|s| s.0),
            def.facing_foreground_sprites.get(direction)
        );
    }
    let object = sim
        .save_snapshot()
        .entities
        .iter()
        .find(|e| e.smart_object.is_some())
        .unwrap()
        .index;
    let f = facing(&sim, object);
    let origin = valid_move(&sim, object, f);
    let hash = sim.world_hash();
    sim.world_mut()
        .resource_mut::<CommandQueue>()
        .push(SimCommand::PlaceObject {
            object,
            x: origin.0,
            y: origin.1,
            facing: f,
        });
    assert_ne!(sim.world_hash(), hash, "hash ignores queued placement");
    let snapshot = sim.save_snapshot_v3();
    let mut loaded = Sim::new();
    loaded.load_snapshot_v3(snapshot.clone()).unwrap();
    assert_eq!(loaded.save_snapshot_v3(), snapshot);
    assert_eq!(loaded.world_hash(), sim.world_hash());
    loaded.flush_commands();
    sim.flush_commands();
    assert_eq!(loaded.save_snapshot_v3(), sim.save_snapshot_v3());
    assert_eq!(loaded.world_hash(), sim.world_hash());
    assert!(
        validate_placement(loaded.world(), object, origin, f).is_ok(),
        "headless restore keeps gameplay editing"
    );
}

#[test]
fn placement_revalidates_preview_after_an_intervening_reservation() {
    let (mut sim, object) = fixture();
    let f = facing(&sim, object);
    assert!(validate_placement(sim.world(), object, (1, 0), f).is_ok());
    let entity = object_definition(sim.world(), object).unwrap().0;
    sim.world_mut().entity_mut(entity).insert(Reserved);
    refusal(&mut sim, object, (1, 0), f, PlacementRefusal::InUse);
}

#[test]
fn placement_rejects_overlap_in_current_layout_and_uses_nonnegative_truncation() {
    let (mut sim, object) = fixture();
    let f = facing(&sim, object);
    let entity = object_definition(sim.world(), object).unwrap().0;
    sim.world_mut()
        .entity_mut(entity)
        .insert(Position { x: 0.75, y: 0.75 });
    assert!(validate_placement(sim.world(), object, (1, 0), f).is_ok());
    sim.spawn_object(
        Position { x: 0.0, y: 0.0 },
        terri_data::pack().find("fridge").unwrap(),
    );
    refusal(
        &mut sim,
        object,
        (1, 0),
        f,
        PlacementRefusal::UnsupportedLayout,
    );
}

#[test]
fn placement_rejects_nonfinite_or_negative_existing_coordinates_independently() {
    let (mut sim, object) = fixture();
    let entity = object_definition(sim.world(), object).unwrap().0;
    let f = facing(&sim, object);
    for position in [
        Position {
            x: f32::NAN,
            y: 0.0,
        },
        Position {
            x: 0.0,
            y: f32::NAN,
        },
        Position {
            x: f32::INFINITY,
            y: 0.0,
        },
        Position {
            x: 0.0,
            y: f32::INFINITY,
        },
        Position {
            x: f32::NEG_INFINITY,
            y: 0.0,
        },
        Position {
            x: 0.0,
            y: f32::NEG_INFINITY,
        },
        Position { x: -0.5, y: 0.0 },
        Position { x: 0.0, y: -0.5 },
    ] {
        sim.world_mut().entity_mut(entity).insert(position);
        let before = sim.world_hash();
        assert_eq!(
            validate_placement(sim.world(), object, (1, 0), f).unwrap_err(),
            PlacementRefusal::UnsupportedLayout
        );
        assert_eq!(sim.world_hash(), before);
        place(&mut sim, object, (1, 0), f);
        assert_eq!(
            sim.world()
                .resource::<LotEditState>()
                .last_result
                .unwrap()
                .reason,
            Some(PlacementRefusal::UnsupportedLayout)
        );
        assert_eq!(sim.world_hash(), before);
        let after = sim.world().get::<Position>(entity).unwrap();
        assert_eq!(
            (after.x.to_bits(), after.y.to_bits()),
            (position.x.to_bits(), position.y.to_bits())
        );
    }
    for position in [Position { x: 0.0, y: -0.0 }, Position { x: 0.75, y: 0.75 }] {
        sim.world_mut().entity_mut(entity).insert(position);
        assert!(validate_placement(sim.world(), object, (1, 0), f).is_ok());
    }
}

#[test]
fn placement_protects_the_targeted_object_without_requiring_a_reservation() {
    let (mut sim, object) = fixture();
    let entity = object_definition(sim.world(), object).unwrap().0;
    let f = facing(&sim, object);
    let other = sim.spawn_object(
        Position { x: 2.0, y: 0.0 },
        terri_data::pack().find("fridge").unwrap(),
    );
    sim.world_mut()
        .resource_mut::<TileGrid>()
        .set_blocked(2, 0, true);
    let agent = sim
        .world_mut()
        .spawn((
            Agent,
            Position { x: 1.0, y: 1.0 },
            Target {
                object: entity,
                interaction: 0,
            },
        ))
        .id();
    assert!(sim.world().get::<Reserved>(entity).is_none());
    refusal(&mut sim, object, (1, 0), f, PlacementRefusal::InUse);
    sim.world_mut().entity_mut(agent).insert(Target {
        object: other,
        interaction: 0,
    });
    assert!(
        validate_placement(sim.world(), object, (1, 0), f).is_ok(),
        "another object's target must not prevent moving this furniture"
    );
}

#[test]
fn placement_preserves_clear_remaining_routes_with_repeated_waypoints() {
    let (mut sim, object) = fixture();
    let f = facing(&sim, object);
    let agent = sim
        .world_mut()
        .spawn((Agent, Position { x: 1.0, y: 1.0 }))
        .id();
    assert!(!sim.world().resource::<TileGrid>().can_step((1, 2), (1, 2)));
    for steps in [vec![(1, 2), (1, 3)], vec![(1, 2), (1, 2), (1, 3)]] {
        sim.world_mut()
            .entity_mut(agent)
            .insert(Path { steps, cursor: 0 });
        let before = sim.save_snapshot_v3();
        assert!(
            validate_placement(sim.world(), object, (1, 0), f).is_ok(),
            "an already-reached waypoint is not a blocked move"
        );
        assert_eq!(sim.save_snapshot_v3(), before);
    }
    let path = sim.world().get::<Path>(agent).unwrap().clone();
    place(&mut sim, object, (1, 0), f);
    assert_eq!(
        sim.world()
            .resource::<LotEditState>()
            .last_result
            .unwrap()
            .reason,
        None
    );
    let after = sim.world().get::<Path>(agent).unwrap();
    assert_eq!(after.steps, path.steps);
    assert_eq!(after.cursor, path.cursor);
}

#[test]
fn placement_keeps_returning_worker_on_door_landing_without_second_pay() {
    use terri_core::{AtWork, Career, Commuting};
    let mut sim = Sim::new_from_shipped_lot();
    let object = sim
        .save_snapshot()
        .entities
        .iter()
        .find(|e| e.smart_object.as_deref() == Some("fridge"))
        .unwrap()
        .index;
    let f = facing(&sim, object);
    let origin = valid_move(&sim, object, f);
    place(&mut sim, object, origin, f);
    assert_eq!(
        sim.world()
            .resource::<LotEditState>()
            .last_result
            .unwrap()
            .reason,
        None
    );
    let worker = sim
        .world_mut()
        .query_filtered::<Entity, (With<Agent>, With<Career>)>()
        .iter(sim.world())
        .next()
        .unwrap();
    sim.world_mut()
        .entity_mut(worker)
        .insert((Position { x: 15.0, y: 2.0 }, AtWork { remaining_ticks: 1 }));
    sim.tick();
    let paid = sim.funds();
    assert!(sim.world().get::<Commuting>(worker).is_some());
    let mut arrived = false;
    for _ in 0..20 {
        sim.tick();
        assert_eq!(sim.funds(), paid);
        if sim.world().get::<Commuting>(worker).is_none() {
            arrived = true;
            break;
        }
    }
    assert!(arrived);
    assert_eq!(
        sim.world().get::<Position>(worker),
        Some(&Position { x: 15.0, y: 3.0 })
    );
}
