use super::*;
use crate::{Content, Sim};
use terri_core::windows::WindowModel;
use terri_core::{CommandQueue, Position, SimCommand};

fn line(axis: EdgeAxis, x: u32, y: u32) -> WallLine {
    WallLine { axis, x, y }
}
fn window(model: WindowModel) -> WindowPlacement {
    WindowPlacement {
        line: line(EdgeAxis::Vertical, 3, 1),
        model,
    }
}
fn house() -> Sim {
    let mut pack = terri_data::pack().clone();
    pack.lot.width = 7;
    pack.lot.height = 7;
    pack.lot.house = (7, 7);
    pack.lot.wall_edges.clear();
    pack.lot.walls.clear();
    pack.lot.placements.clear();
    pack.lot.front_door = Some((5, 3));
    pack.portals[0].position = (5, 3);
    pack.portals[0].inward = (4, 3);
    let pack = Box::leak(Box::new(pack));
    let mut sim = Sim::new_from_lot(&pack.lot, &pack.objects);
    sim.world_mut().insert_resource(Content(pack));
    sim.spawn_object(Position { x: 0.0, y: 0.0 }, pack.find("fridge").unwrap());
    let edges: Vec<_> = window(WindowModel::Picture)
        .lines()
        .into_iter()
        .map(|l| record(l, false))
        .collect();
    let mut grid = TileGrid::new(7, 7);
    grid.set_blocked(0, 0, true);
    for edge in &edges {
        let [a, b] = edge.cells();
        grid.set_edge_blocked(a, b, true);
    }
    sim.world_mut().insert_resource(grid);
    sim.world_mut()
        .insert_resource(SavedLayout::EdgeWallsV1 { edges });
    sim
}
fn fit(sim: &mut Sim, placed: WindowPlacement) {
    assert_eq!(
        apply_window_edit(sim.world_mut(), WindowEdit::Fit(placed)).reason,
        None
    );
}
fn revision(sim: &Sim) -> u64 {
    sim.world().resource::<LotEditState>().revision
}

#[test]
fn window_invalid_third_line_is_atomic() {
    let mut sim = house();
    let third = line(EdgeAxis::Vertical, 3, 3);
    super::super::walls::commit(
        sim.world_mut(),
        super::super::walls::WallEdit {
            axis: third.axis,
            x: third.x,
            y: third.y,
            state: WallState::Doorway,
        },
    );
    let before = sim.save_snapshot_v5();
    let rev = revision(&sim);
    let result = apply_window_edit(
        sim.world_mut(),
        WindowEdit::Fit(window(WindowModel::Picture)),
    );
    assert_eq!(result.reason, Some(PlacementRefusal::WindowRequiresWall));
    assert_eq!(
        sim.save_snapshot_v5(),
        before,
        "third-line refusal must leave layout and grid untouched"
    );
    assert_eq!(revision(&sim), rev);
}

#[test]
fn window_fit_commits_whole_span_once_and_same_model_is_noop() {
    let mut sim = house();
    let placed = window(WindowModel::Craftsman);
    fit(&mut sim, placed);
    assert_eq!(revision(&sim), 1);
    assert_eq!(
        sim.world().resource::<SavedLayout>().window_placements(),
        [placed]
    );
    assert!(sim.world().resource::<SavedLayout>().edges().is_empty());
    for segment in placed.lines() {
        assert_eq!(
            sim.world().resource::<SavedLayout>().state_of(segment),
            WallState::Window
        );
        let [a, b] = record(segment, false).cells();
        assert!(!sim.world().resource::<TileGrid>().can_cross(a, b));
    }
    let before = sim.save_snapshot_v5();
    fit(&mut sim, placed);
    assert_eq!(revision(&sim), 1);
    assert_eq!(sim.save_snapshot_v5(), before);
}

#[test]
fn window_removal_from_every_segment_restores_whole_span() {
    let placed = window(WindowModel::Picture);
    for clicked in placed.lines() {
        let mut sim = house();
        fit(&mut sim, placed);
        assert_eq!(
            apply_window_edit(sim.world_mut(), WindowEdit::Remove(clicked)).reason,
            None
        );
        let layout = sim.world().resource::<SavedLayout>();
        assert!(layout.window_placements().is_empty());
        for segment in placed.lines() {
            assert_eq!(layout.state_of(segment), WallState::Wall);
        }
        assert_eq!(revision(&sim), 2);
    }
}

#[test]
fn window_narrower_replacement_uses_owner_start_and_restores_exposed_wall() {
    let mut sim = house();
    fit(&mut sim, window(WindowModel::Picture));
    fit(
        &mut sim,
        WindowPlacement {
            line: line(EdgeAxis::Vertical, 3, 3),
            model: WindowModel::Cottage,
        },
    );
    let layout = sim.world().resource::<SavedLayout>();
    assert_eq!(layout.window_placements(), [window(WindowModel::Cottage)]);
    for y in [2, 3] {
        assert_eq!(
            layout.state_of(line(EdgeAxis::Vertical, 3, y)),
            WallState::Wall
        );
    }
    assert_eq!(revision(&sim), 2);
}

#[test]
fn window_legacy_open_and_doorway_edits_never_leave_partial_windows() {
    for state in [WallState::Open, WallState::Wall, WallState::Doorway] {
        let mut sim = house();
        fit(&mut sim, window(WindowModel::Picture));
        super::super::walls::commit(
            sim.world_mut(),
            super::super::walls::WallEdit {
                axis: EdgeAxis::Vertical,
                x: 3,
                y: 2,
                state,
            },
        );
        let layout = sim.world().resource::<SavedLayout>();
        assert!(layout.window_placements().is_empty());
        for y in 1..=3 {
            let expected = if state == WallState::Doorway && y != 2 {
                WallState::Wall
            } else {
                state
            };
            assert_eq!(layout.state_of(line(EdgeAxis::Vertical, 3, y)), expected);
            let [a, b] = record(line(EdgeAxis::Vertical, 3, y), false).cells();
            assert_eq!(
                sim.world().resource::<TileGrid>().can_cross(a, b),
                !expected.blocks_movement()
            );
        }
        assert_eq!(revision(&sim), 2);
    }
}

#[test]
fn window_room_crossing_is_atomic_and_unrelated_room_preserves_model() {
    use super::super::rooms::{commit, RoomEdit};
    let mut sim = house();
    fit(&mut sim, window(WindowModel::Clerestory));
    let before = sim.save_snapshot_v5();
    commit(
        sim.world_mut(),
        RoomEdit {
            x0: 1,
            y0: 2,
            x1: 3,
            y1: 4,
            doorway: Some(line(EdgeAxis::Horizontal, 1, 2)),
        },
    );
    assert_eq!(
        sim.world()
            .resource::<LotEditState>()
            .last_room_result
            .unwrap()
            .reason,
        Some(PlacementRefusal::WindowJunction)
    );
    assert_eq!(sim.save_snapshot_v5(), before);
    assert_eq!(revision(&sim), 1);
    commit(
        sim.world_mut(),
        RoomEdit {
            x0: 4,
            y0: 4,
            x1: 5,
            y1: 5,
            doorway: Some(line(EdgeAxis::Horizontal, 4, 4)),
        },
    );
    assert_eq!(
        sim.world()
            .resource::<LotEditState>()
            .last_room_result
            .unwrap()
            .reason,
        None
    );
    assert_eq!(revision(&sim), 2);
    assert_eq!(
        sim.world().resource::<SavedLayout>().window_placements(),
        [window(WindowModel::Clerestory)]
    );
}

#[test]
fn window_rear_shell_is_bounded_and_removal_restores_implicit_shell() {
    for axis in [EdgeAxis::Vertical, EdgeAxis::Horizontal] {
        let mut sim = house();
        let start = if axis == EdgeAxis::Vertical {
            line(axis, 0, 1)
        } else {
            line(axis, 1, 0)
        };
        let placed = WindowPlacement {
            line: start,
            model: WindowModel::Picture,
        };
        let grid = sim.world().resource::<TileGrid>().clone();
        fit(&mut sim, placed);
        assert_eq!(
            grid_view(sim.world().resource::<TileGrid>()),
            grid_view(&grid)
        );
        assert!(!grid.is_walkable(-1, 1));
        assert!(!grid.is_walkable(1, -1));
        super::super::walls::commit(
            sim.world_mut(),
            super::super::walls::WallEdit {
                axis,
                x: start.x,
                y: start.y,
                state: WallState::Open,
            },
        );
        assert_eq!(
            sim.world()
                .resource::<LotEditState>()
                .last_wall_result
                .unwrap()
                .reason,
            Some(PlacementRefusal::OutOfBounds)
        );
        assert_eq!(
            apply_window_edit(sim.world_mut(), WindowEdit::Remove(placed.lines()[2])).reason,
            None
        );
        assert!(sim
            .world()
            .resource::<SavedLayout>()
            .window_placements()
            .is_empty());
        assert_eq!(
            grid_view(sim.world().resource::<TileGrid>()),
            grid_view(&grid)
        );
        assert!(sim
            .world()
            .resource::<SavedLayout>()
            .edges()
            .iter()
            .all(|e| e.x > 0));
        let invalid = WindowPlacement {
            line: if axis == EdgeAxis::Vertical {
                line(axis, 0, 6)
            } else {
                line(axis, 6, 0)
            },
            model: WindowModel::Picture,
        };
        assert_eq!(
            validate_window_edit(sim.world(), WindowEdit::Fit(invalid)).unwrap_err(),
            PlacementRefusal::OutOfBounds
        );
    }
}

#[test]
fn window_new_commands_drain_in_order_and_capture_model() {
    let mut sim = house();
    sim.world_mut()
        .resource_mut::<CommandQueue>()
        .push(SimCommand::FitWindow {
            axis: EdgeAxis::Vertical,
            x: 3,
            y: 1,
            model: WindowModel::SteelGrid,
        });
    let pending = sim.save_snapshot_v5();
    assert!(matches!(
        pending.world.queued_commands.last(),
        Some(terri_core::save::SavedCommand::FitWindow {
            model: WindowModel::SteelGrid,
            ..
        })
    ));
    sim.flush_commands();
    assert_eq!(
        sim.world().resource::<SavedLayout>().window_placements(),
        [window(WindowModel::SteelGrid)]
    );
    sim.world_mut()
        .resource_mut::<CommandQueue>()
        .push(SimCommand::RemoveWindow {
            axis: EdgeAxis::Vertical,
            x: 3,
            y: 2,
        });
    sim.flush_commands();
    assert!(sim
        .world()
        .resource::<SavedLayout>()
        .window_placements()
        .is_empty());
    assert_eq!(revision(&sim), 2);
}

#[test]
fn window_replacement_cannot_consume_another_owner_and_front_door_is_protected() {
    let mut sim = house();
    fit(&mut sim, window(WindowModel::Cottage));
    fit(
        &mut sim,
        WindowPlacement {
            line: line(EdgeAxis::Vertical, 3, 3),
            model: WindowModel::Arched,
        },
    );
    let before = sim.save_snapshot_v5();
    assert_eq!(
        apply_window_edit(
            sim.world_mut(),
            WindowEdit::Fit(window(WindowModel::Picture))
        )
        .reason,
        Some(PlacementRefusal::WindowRequiresWall)
    );
    assert_eq!(sim.save_snapshot_v5(), before);
    let front = crate::portals::front_door_lines(sim.world());
    let &(x, y) = front.first().expect("fixture front door");
    let placed = WindowPlacement {
        line: line(EdgeAxis::Vertical, x, y),
        model: WindowModel::Sash,
    };
    assert_eq!(
        apply_window_edit(sim.world_mut(), WindowEdit::Fit(placed)).reason,
        Some(PlacementRefusal::BlockedDoor)
    );
    assert_eq!(sim.save_snapshot_v5(), before);
}

#[test]
fn window_room_partial_outline_refuses_and_complete_outline_can_make_doorway() {
    use super::super::rooms::{commit, RoomEdit};
    let mut sim = house();
    fit(&mut sim, window(WindowModel::Sliding));
    let before = sim.save_snapshot_v5();
    commit(
        sim.world_mut(),
        RoomEdit {
            x0: 3,
            y0: 2,
            x1: 4,
            y1: 3,
            doorway: Some(line(EdgeAxis::Vertical, 3, 2)),
        },
    );
    assert_eq!(
        sim.world()
            .resource::<LotEditState>()
            .last_room_result
            .unwrap()
            .reason,
        Some(PlacementRefusal::PartialWindow)
    );
    assert_eq!(sim.save_snapshot_v5(), before);
    commit(
        sim.world_mut(),
        RoomEdit {
            x0: 3,
            y0: 1,
            x1: 4,
            y1: 2,
            doorway: Some(line(EdgeAxis::Vertical, 3, 2)),
        },
    );
    assert_eq!(
        sim.world()
            .resource::<LotEditState>()
            .last_room_result
            .unwrap()
            .reason,
        None
    );
    let layout = sim.world().resource::<SavedLayout>();
    assert!(layout.window_placements().is_empty());
    assert_eq!(
        layout.state_of(line(EdgeAxis::Vertical, 3, 1)),
        WallState::Wall
    );
    assert_eq!(
        layout.state_of(line(EdgeAxis::Vertical, 3, 2)),
        WallState::Doorway
    );
    assert_eq!(revision(&sim), 2);
}

#[test]
fn window_overflow_is_refused_without_panicking_or_writing() {
    let mut sim = house();
    let before = sim.save_snapshot_v5();
    for axis in [EdgeAxis::Vertical, EdgeAxis::Horizontal] {
        let placed = WindowPlacement {
            line: line(axis, u32::MAX, u32::MAX),
            model: WindowModel::Picture,
        };
        assert_eq!(
            apply_window_edit(sim.world_mut(), WindowEdit::Fit(placed)).reason,
            Some(PlacementRefusal::OutOfBounds)
        );
        assert_eq!(sim.save_snapshot_v5(), before);
    }
}

#[test]
fn window_hash_distinguishes_model_and_new_queued_fields() {
    let mut sim = house();
    fit(&mut sim, window(WindowModel::Picture));
    let picture = sim.world_hash();
    fit(&mut sim, window(WindowModel::Craftsman));
    assert_ne!(sim.world_hash(), picture);
    let base = sim.world_hash();
    let mut hashes = std::collections::BTreeSet::new();
    for command in [
        SimCommand::FitWindow {
            axis: EdgeAxis::Vertical,
            x: 3,
            y: 1,
            model: WindowModel::Picture,
        },
        SimCommand::FitWindow {
            axis: EdgeAxis::Horizontal,
            x: 3,
            y: 1,
            model: WindowModel::Picture,
        },
        SimCommand::FitWindow {
            axis: EdgeAxis::Vertical,
            x: 4,
            y: 1,
            model: WindowModel::Picture,
        },
        SimCommand::FitWindow {
            axis: EdgeAxis::Vertical,
            x: 3,
            y: 2,
            model: WindowModel::Picture,
        },
        SimCommand::FitWindow {
            axis: EdgeAxis::Vertical,
            x: 3,
            y: 1,
            model: WindowModel::Craftsman,
        },
        SimCommand::RemoveWindow {
            axis: EdgeAxis::Vertical,
            x: 3,
            y: 1,
        },
        SimCommand::RemoveWindow {
            axis: EdgeAxis::Horizontal,
            x: 3,
            y: 1,
        },
        SimCommand::RemoveWindow {
            axis: EdgeAxis::Vertical,
            x: 4,
            y: 1,
        },
        SimCommand::RemoveWindow {
            axis: EdgeAxis::Vertical,
            x: 3,
            y: 2,
        },
    ] {
        sim.world_mut().resource_mut::<CommandQueue>().push(command);
        assert_ne!(sim.world_hash(), base);
        assert!(
            hashes.insert(sim.world_hash()),
            "each field must change the queued-command digest"
        );
        sim.world_mut()
            .resource_mut::<CommandQueue>()
            .drain()
            .for_each(drop);
    }
}

fn grid_view(grid: &TileGrid) -> Vec<(bool, bool, bool)> {
    (0..grid.height() as i32)
        .flat_map(|y| (0..grid.width() as i32).map(move |x| (x, y)))
        .map(|(x, y)| {
            (
                grid.is_walkable(x, y),
                grid.can_cross((x, y), (x + 1, y)),
                grid.can_cross((x, y), (x, y + 1)),
            )
        })
        .collect()
}

#[test]
fn window_loader_refuses_front_door_without_employed_sims() {
    let mut sim = house();
    let mut snapshot = sim.save_snapshot_v5();
    assert!(snapshot.world.entities.iter().all(|e| !e.agent));
    let &(x, y) = crate::portals::front_door_lines(sim.world())
        .first()
        .unwrap();
    snapshot.layout = SavedLayout::from_window_placements(
        snapshot.layout.edges().to_vec(),
        vec![WindowPlacement {
            line: line(EdgeAxis::Vertical, x, y),
            model: WindowModel::Cottage,
        }],
    );
    let before = sim.save_snapshot_v5();
    assert_eq!(
        sim.load_snapshot_v5(snapshot),
        Err(crate::save::SaveError::InvalidGrid)
    );
    assert_eq!(sim.save_snapshot_v5(), before);
}

#[test]
fn window_typed_restore_preserves_identity_and_rear_grid() {
    let mut sim = house();
    fit(&mut sim, window(WindowModel::Craftsman));
    fit(
        &mut sim,
        WindowPlacement {
            line: line(EdgeAxis::Horizontal, 1, 0),
            model: WindowModel::SteelGrid,
        },
    );
    let saved = sim.save_snapshot_v5();
    let hash = sim.world_hash();
    sim.load_snapshot_v5(saved.clone()).unwrap();
    assert_eq!(sim.save_snapshot_v5(), saved);
    assert_eq!(sim.world_hash(), hash);
}

#[test]
fn window_unrelated_floor_and_room_edits_keep_legacy_and_typed_storage() {
    for typed in [false, true] {
        let mut sim = house();
        if typed {
            fit(&mut sim, window(WindowModel::Cottage));
        } else {
            super::super::walls::commit(
                sim.world_mut(),
                super::super::walls::WallEdit {
                    axis: EdgeAxis::Vertical,
                    x: 3,
                    y: 1,
                    state: WallState::Window,
                },
            );
        }
        let before = sim.world().resource::<SavedLayout>().clone();
        sim.world_mut()
            .resource_mut::<CommandQueue>()
            .push(SimCommand::SetFloor {
                x: 6,
                y: 6,
                covering: 1,
            });
        sim.flush_commands();
        assert_eq!(*sim.world().resource::<SavedLayout>(), before);
        super::super::rooms::commit(
            sim.world_mut(),
            super::super::rooms::RoomEdit {
                x0: 4,
                y0: 4,
                x1: 5,
                y1: 5,
                doorway: Some(line(EdgeAxis::Horizontal, 4, 4)),
            },
        );
        assert_eq!(
            sim.world()
                .resource::<LotEditState>()
                .last_room_result
                .unwrap()
                .reason,
            None
        );
        let after = sim.world().resource::<SavedLayout>();
        assert_eq!(after.window_placements(), before.window_placements());
        assert_eq!(matches!(after, SavedLayout::EdgeWallsV3 { .. }), typed);
        assert_eq!(matches!(after, SavedLayout::EdgeWallsV2 { .. }), !typed);
    }
}

#[test]
fn released_bed_assignment_and_window_queues_have_distinct_hashes() {
    let mut sim = house();
    sim.world_mut()
        .resource_mut::<CommandQueue>()
        .push(SimCommand::SetBedAssignment {
            agent: 1,
            place: Some((5, 1)),
        });
    let bed = sim.world_hash();
    sim.world_mut()
        .resource_mut::<CommandQueue>()
        .drain()
        .for_each(drop);
    sim.world_mut()
        .resource_mut::<CommandQueue>()
        .push(SimCommand::FitWindow {
            axis: EdgeAxis::Horizontal,
            x: 1,
            y: 5,
            model: WindowModel::Sash,
        });
    assert_ne!(
        bed,
        sim.world_hash(),
        "released bed and appended window tags must not collide"
    );
}
