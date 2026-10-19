use super::*;
use terri_core::{layout::WallEdge, Agent, Footprint, Path, Position, Reserved, Target};

/// A house of `width` by `height` at the grid's origin, as every test lot
/// stands.
fn house(width: u32, height: u32) -> crate::lot_frame::HouseRect {
    crate::lot_frame::HouseRect {
        x: 0,
        y: 0,
        width,
        height,
    }
}

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
            house(4, 3)
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
                house(4, 3)
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
            // V10 omits modern request identity and age. Compare continuations
            // from the same historical state on both sides of this boundary.
            let historical = source.save_snapshot_v10();
            source.load_snapshot_v10(historical).unwrap();
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
            let saved = source.save_snapshot_v10();
            let hash = source.world_hash();
            let mut restored =
                crate::test_content::without_owned_books(Sim::new_from_shipped_lot());
            restored.load_snapshot_v10(saved.clone()).unwrap();
            assert_eq!(restored.save_snapshot_v10(), saved, "model {id}, {axis:?}");
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
            assert_eq!(restored.save_snapshot_v10(), source.save_snapshot_v10());
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

#[test]
fn physical_perimeter_saves_accept_solids_but_reject_doors_and_outside_coordinates() {
    use terri_core::layout::EdgeAxis::{Horizontal, Vertical};
    for (axis, x, y) in [
        (Vertical, 0, 1),
        (Vertical, 4, 1),
        (Horizontal, 1, 0),
        (Horizontal, 1, 3),
    ] {
        let edge = WallEdge {
            axis,
            x,
            y,
            doorway: false,
        };
        for layout in [
            SavedLayout::EdgeWallsV1 { edges: vec![edge] },
            SavedLayout::from_window_placements(vec![edge], vec![]),
        ] {
            let mut grid = TileGrid::new(4, 3);
            assert_eq!(apply_layout(&mut grid, &layout, house(2, 2)), Ok(()));
            assert_eq!(grid.blocked_edges().count(), 0);
        }
        let mut grid = TileGrid::new(4, 3);
        let door = SavedLayout::EdgeWallsV1 {
            edges: vec![WallEdge {
                doorway: true,
                ..edge
            }],
        };
        assert_eq!(
            apply_layout(&mut grid, &door, house(2, 2)),
            Err(SaveError::InvalidGrid)
        );
    }
    for (axis, x, y) in [
        (Vertical, 5, 1),
        (Vertical, 0, 3),
        (Horizontal, 1, 4),
        (Horizontal, 4, 0),
        (Vertical, u32::MAX, 1),
        (Horizontal, 1, u32::MAX),
    ] {
        let layout = SavedLayout::EdgeWallsV1 {
            edges: vec![WallEdge {
                axis,
                x,
                y,
                doorway: false,
            }],
        };
        assert_eq!(
            apply_layout(&mut TileGrid::new(4, 3), &layout, house(2, 2)),
            Err(SaveError::InvalidGrid)
        );
    }
}

#[test]
fn a_window_edit_with_owned_reading_restores_the_complete_runtime_before_validation() {
    let mut sim = Sim::new_from_shipped_lot();
    let actor = sim
        .world_mut()
        .query_filtered::<bevy_ecs::entity::Entity, bevy_ecs::query::With<Agent>>()
        .iter(sim.world())
        .next()
        .unwrap();
    let pack = sim.world().resource::<crate::Content>().0;
    let (seat, action) = sim
        .world_mut()
        .query::<(bevy_ecs::entity::Entity, &terri_core::SmartObject)>()
        .iter(sim.world())
        .find_map(|(entity, object)| {
            pack.object(object.0)
                .interactions
                .iter()
                .find(|action| action.book_reading)
                .map(|action| (entity, action.id.clone()))
        })
        .expect("the shipped lot has a reading place");
    let title = sim
        .world()
        .resource::<crate::books::BookLibrary>()
        .state()
        .copies
        .first()
        .expect("the shipped household owns a book")
        .title_id
        .clone();
    sim.world_mut()
        .resource_mut::<terri_core::CommandQueue>()
        .push(terri_core::SimCommand::Book(
            terri_core::command::BookCommand::Read {
                agent: actor.index_u32(),
                object: seat.index_u32(),
                action,
                title,
                front: true,
            },
        ));
    sim.tick();
    assert!(sim
        .world_mut()
        .query::<&crate::reading::ReadingJourney>()
        .iter(sim.world())
        .next()
        .is_some());
    sim.world_mut()
        .resource_mut::<terri_core::CommandQueue>()
        .push(terri_core::SimCommand::FitWindow {
            axis: terri_core::layout::EdgeAxis::Vertical,
            x: 0,
            y: 1,
            model: terri_core::windows::WindowModel::Sash,
        });
    sim.flush_commands();
    assert_eq!(sim.take_build_error(), None);
    assert_eq!(
        sim.world()
            .resource::<crate::placement::LotEditState>()
            .last_window_result
            .as_ref()
            .map(|r| r.reason),
        Some(None)
    );
    let mut loaded = Sim::new_from_shipped_lot();
    loaded.load_current_v6_view(sim.current_v6_view()).unwrap();
    assert_eq!(loaded.world_hash(), sim.world_hash());
}
