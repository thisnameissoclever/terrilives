use super::*;
use terri_core::{layout::WallEdge, Agent, Footprint, Path, Position, Reserved, Target};

#[test]
fn furniture_rejects_internal_edges_and_accepts_its_outer_perimeter() {
    let mut source = Sim::new_with_lot(8, 8);
    let bed = terri_data::pack().find("double_bed").unwrap();
    assert_eq!(
        terri_data::pack().object(bed).footprint,
        Footprint { width: 2, depth: 2 }
    );
    source.spawn_object(Position { x: 3.0, y: 3.0 }, bed);
    for (from, to, internal) in [
        ((3, 3), (4, 3), true),
        ((3, 3), (3, 4), true),
        ((3, 2), (3, 3), false),
        ((3, 4), (3, 5), false),
        ((4, 3), (5, 3), false),
        ((3, 5), (4, 5), false),
    ] {
        let mut saved = source.save_snapshot_v2();
        saved.layout = SavedLayout::EdgeWallsV1 {
            edges: vec![WallEdge {
                axis: if from.0 == to.0 {
                    terri_core::layout::EdgeAxis::Horizontal
                } else {
                    terri_core::layout::EdgeAxis::Vertical
                },
                x: to.0 as u32,
                y: to.1 as u32,
                doorway: false,
            }],
        };
        let mut live = Sim::new_with_lot(2, 2);
        let before = live.save_snapshot_v2();
        let outcome = live.load_snapshot_v2(saved.clone());
        if internal {
            assert_eq!(
                outcome,
                Err(SaveError::InvalidGrid),
                "internal edge {from:?} -> {to:?}"
            );
            assert_eq!(live.save_snapshot_v2(), before);
        } else {
            assert_eq!(outcome, Ok(()), "perimeter edge {from:?} -> {to:?}");
            let mut expected = saved.clone();
            expected.world = super::super::tests::after_legacy_load_draws(expected.world);
            assert_eq!(live.save_snapshot_v2(), expected);
        }
    }
}

#[test]
fn repeated_path_tiles_are_valid_and_a_walking_target_need_not_be_in_contact_yet() {
    let mut source = Sim::new_with_lot(7, 5);
    let fridge = terri_data::pack().find("fridge").unwrap();
    let object = source.spawn_object(Position { x: 4.0, y: 2.0 }, fridge);
    source.world.entity_mut(object).insert(Reserved);
    source.world.spawn((
        Agent,
        Position { x: 1.0, y: 2.0 },
        Target {
            object,
            interaction: 0,
        },
        Path {
            steps: vec![(1, 2), (1, 2), (2, 2), (3, 2)],
            cursor: 0,
        },
    ));
    let mut saved = source.save_snapshot_v2();
    saved.layout = SavedLayout::EdgeWallsV1 { edges: vec![] };
    let mut live = Sim::new();
    live.load_snapshot_v2(saved.clone()).unwrap();
    let mut expected = saved.clone();
    expected.world = super::super::tests::after_legacy_load_draws(expected.world);
    assert_eq!(live.save_snapshot_v2(), expected);

    saved
        .world
        .entities
        .iter_mut()
        .find(|entity| entity.agent)
        .unwrap()
        .path = None;
    live.load_snapshot_v2(saved.clone()).unwrap();
    let mut expected = saved;
    expected.world = super::super::tests::after_legacy_load_draws(expected.world);
    assert_eq!(
        live.save_snapshot_v2(),
        expected,
        "an idle target is not an active contact"
    );
}

#[test]
fn legacy_wall_cells_must_be_unique_blocked_and_inside_each_grid_axis() {
    let mut grid = TileGrid::new(4, 3);
    grid.set_blocked(2, 1, true);
    assert_eq!(
        apply_layout(
            &mut grid,
            &SavedLayout::LegacyCells {
                walls: vec![(2, 1)]
            },
            (4, 3)
        ),
        Ok(())
    );
    for walls in [
        vec![(2, 1), (2, 1)],
        vec![(1, 1)],
        vec![(4, 1)],
        vec![(2, 3)],
    ] {
        assert_eq!(
            apply_layout(
                &mut grid,
                &SavedLayout::LegacyCells {
                    walls: walls.clone()
                },
                (4, 3)
            ),
            Err(SaveError::InvalidGrid),
            "walls {walls:?}"
        );
    }
}

#[test]
fn contact_rejects_each_outside_origin_even_without_solid_edges() {
    let grid = TileGrid::new(5, 5);
    for (from, x, y) in [
        ((0, 2), -1.0, 2.0),
        ((2, 0), 2.0, -1.0),
        ((4, 2), 5.0, 2.0),
        ((2, 4), 2.0, 5.0),
    ] {
        let at = terri_core::save::SavedPosition { x, y };
        assert!(
            !valid_contact(&grid, from, at, Footprint::SINGLE),
            "outside target {at:?}"
        );
    }
}

#[test]
fn contact_accepts_flush_rectangles_but_rejects_either_overhanging_extent() {
    let grid = TileGrid::new(7, 7);
    for (from, x, y, width, depth, expected) in [
        ((2, 3), 3.0, 3.0, 4, 2, true),
        ((3, 2), 3.0, 3.0, 2, 4, true),
        ((2, 3), 3.0, 3.0, 5, 2, false),
        ((3, 2), 3.0, 3.0, 2, 5, false),
        ((2, 3), 3.0, 3.0, 2, 2, true),
        ((3, 2), 3.0, 3.0, 2, 2, true),
    ] {
        let at = terri_core::save::SavedPosition { x, y };
        let footprint = Footprint { width, depth };
        assert_eq!(
            valid_contact(&grid, from, at, footprint),
            expected,
            "footprint {footprint:?}"
        );
    }
}

#[test]
fn window_save_all_models_axes_and_pending_commands_restore_before_any_drain() {
    use terri_core::{
        layout::{EdgeAxis, WallLine},
        windows::{WindowModel, WindowPlacement},
        CommandQueue, SimCommand,
    };
    for id in 1..=9 {
        for axis in [EdgeAxis::Vertical, EdgeAxis::Horizontal] {
            let mut source = crate::test_content::without_owned_books(Sim::new_from_shipped_lot());
            for _ in 0..13 {
                source.tick();
            }
            let line = if axis == EdgeAxis::Vertical {
                WallLine { axis, x: 0, y: 1 }
            } else {
                WallLine { axis, x: 10, y: 0 }
            };
            let model = WindowModel::from_id(id).unwrap();
            let placement = WindowPlacement { line, model };
            assert_eq!(
                crate::placement::windows::apply_window_edit(
                    source.world_mut(),
                    crate::placement::windows::WindowEdit::Fit(placement)
                )
                .reason,
                None
            );
            // A complete pair stays pending across the load and replays in order.
            source
                .world_mut()
                .resource_mut::<CommandQueue>()
                .push(SimCommand::RemoveWindow {
                    axis,
                    x: line.x,
                    y: line.y,
                });
            source
                .world_mut()
                .resource_mut::<CommandQueue>()
                .push(SimCommand::FitWindow {
                    axis,
                    x: line.x,
                    y: line.y,
                    model,
                });
            source.sync_render_buffer();
            let saved = source.save_snapshot_v5();
            let hash = source.world_hash();
            let mut restored =
                crate::test_content::without_owned_books(Sim::new_from_shipped_lot());
            restored.load_snapshot_v5(saved.clone()).unwrap();
            assert_eq!(restored.save_snapshot_v5(), saved, "model {id}, {axis:?}");
            assert_eq!(restored.world_hash(), hash);
            assert_eq!(
                restored
                    .world()
                    .resource::<SavedLayout>()
                    .window_placements(),
                [placement]
            );
            assert_eq!(restored.world().resource::<CommandQueue>().len(), 2);
            assert_eq!(
                restored.render_buffer().positions,
                source.render_buffer().positions
            );
            assert_eq!(
                restored.render_buffer().sprites,
                source.render_buffer().sprites
            );
            assert_eq!(
                restored.render_buffer().colourways,
                source.render_buffer().colourways
            );
            source.flush_commands();
            restored.flush_commands();
            assert_eq!(restored.world().resource::<CommandQueue>().len(), 0);
            assert_eq!(
                restored
                    .world()
                    .resource::<SavedLayout>()
                    .window_placements(),
                [placement]
            );
            assert_eq!(restored.world_hash(), source.world_hash());
            assert_eq!(restored.save_snapshot_v5(), source.save_snapshot_v5());
            for _ in 0..3 {
                source.tick();
                restored.tick();
            }
            assert_eq!(restored.world_hash(), source.world_hash());
        }
    }
}

#[test]
fn window_save_preserves_insertion_order_but_hash_ignores_order_and_observes_model() {
    use terri_core::{
        layout::{EdgeAxis, WallLine},
        windows::{WindowModel, WindowPlacement},
    };
    let mut source = crate::test_content::without_owned_books(Sim::new_from_shipped_lot());
    let a = WindowPlacement {
        line: WallLine {
            axis: EdgeAxis::Vertical,
            x: 0,
            y: 1,
        },
        model: WindowModel::Sash,
    };
    let b = WindowPlacement {
        line: WallLine {
            axis: EdgeAxis::Horizontal,
            x: 10,
            y: 0,
        },
        model: WindowModel::Picture,
    };
    for placement in [b, a] {
        assert_eq!(
            crate::placement::windows::apply_window_edit(
                source.world_mut(),
                crate::placement::windows::WindowEdit::Fit(placement)
            )
            .reason,
            None
        );
    }
    let saved = source.save_snapshot_v5();
    let original_hash = source.world_hash();
    let mut restored = crate::test_content::without_owned_books(Sim::new_from_shipped_lot());
    restored.load_snapshot_v5(saved.clone()).unwrap();
    assert_eq!(restored.save_snapshot_v5(), saved);
    assert_eq!(
        restored
            .world()
            .resource::<SavedLayout>()
            .window_placements(),
        [b, a]
    );
    let mut reordered = saved.clone();
    if let SavedLayout::EdgeWallsV3 { windows, .. } = &mut reordered.layout {
        windows.reverse();
    }
    restored.load_snapshot_v5(reordered.clone()).unwrap();
    assert_eq!(restored.save_snapshot_v5(), reordered);
    assert_eq!(restored.world_hash(), original_hash);
    if let SavedLayout::EdgeWallsV3 { windows, .. } = &mut reordered.layout {
        windows[0].model = WindowModel::Cottage;
    }
    restored.load_snapshot_v5(reordered).unwrap();
    assert_ne!(restored.world_hash(), original_hash);
}

#[test]
fn window_save_refuses_duplicate_overlap_conflict_bounds_and_overflow_atomically() {
    use terri_core::{
        layout::{EdgeAxis, WallLine},
        windows::{WindowModel, WindowPlacement},
    };
    let mut live = Sim::new_from_shipped_lot();
    let original = live.save_snapshot_v5();
    let hash = live.world_hash();
    let a = WindowPlacement {
        line: WallLine {
            axis: EdgeAxis::Vertical,
            x: 0,
            y: 1,
        },
        model: WindowModel::Picture,
    };
    let cases = [
        vec![a, a],
        vec![
            a,
            WindowPlacement {
                line: WallLine { y: 2, ..a.line },
                model: WindowModel::Sash,
            },
        ],
        vec![WindowPlacement {
            line: WallLine { y: 11, ..a.line },
            ..a
        }],
        vec![WindowPlacement {
            line: WallLine {
                y: u32::MAX,
                ..a.line
            },
            ..a
        }],
        vec![WindowPlacement {
            line: WallLine {
                axis: EdgeAxis::Horizontal,
                x: 15,
                y: 0,
            },
            ..a
        }],
        vec![WindowPlacement {
            line: WallLine {
                axis: EdgeAxis::Vertical,
                x: 8,
                y: 0,
            },
            model: WindowModel::Sash,
        }],
    ];
    for windows in cases {
        let mut saved = original.clone();
        saved.layout = SavedLayout::EdgeWallsV3 {
            edges: original.layout.edges().to_vec(),
            windows,
        };
        assert_eq!(live.load_snapshot_v5(saved), Err(SaveError::InvalidGrid));
        assert_eq!(live.save_snapshot_v5(), original);
        assert_eq!(live.world_hash(), hash);
    }
}
