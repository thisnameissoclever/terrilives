use super::*;

#[test]
fn placement_boundary_rejects_hostile_numbers_before_coercion_in_release() {
    let mut handle = SimHandle::from_lot();
    let f = handle.object_facing(0.0).unwrap() as f64;
    for invalid in [
        f64::NAN,
        f64::INFINITY,
        f64::NEG_INFINITY,
        -1.0,
        0.5,
        u32::MAX as f64 + 1.0,
        1e30,
    ] {
        for index in 0..4 {
            let mut args = [0.0, 1.0, 1.0, f];
            args[index] = invalid;
            let before = handle.save_bytes();
            assert_eq!(
                handle.placement_preview(args[0], args[1], args[2], args[3])[0],
                1.0
            );
            assert!(!handle.place_object(args[0], args[1], args[2], args[3]));
            assert_eq!(handle.save_bytes(), before);
        }
        assert_eq!(handle.object_facing(invalid), None);
        assert_eq!(handle.object_facing_mask(invalid), 0);
    }
    for f in [4.0, 255.0, 256.0, u32::MAX as f64] {
        assert!(!handle.place_object(0.0, 1.0, 1.0, f));
    }
    assert!(handle.object_facing_mask(0.0) > 0);
    assert!(
        handle.place_object(0.0, 1.0, 1.0, f),
        "valid control must enqueue"
    );
    assert_eq!(handle.sim.world().resource::<CommandQueue>().len(), 1);
}

#[test]
fn placement_boundary_reports_refusal_separately_from_queue_acceptance() {
    use terri_core::layout::{EdgeAxis, SavedLayout, WallEdge};
    for edge_wall in [false, true] {
        let mut handle = SimHandle::new(7, 7);
        assert!(handle.spawn_object(0.0, 0.0, "desk"));
        handle
            .sim
            .world_mut()
            .resource_mut::<TileGrid>()
            .set_blocked(0, 0, true);
        handle
            .sim
            .world_mut()
            .resource_mut::<TileGrid>()
            .set_blocked(1, 0, true);
        let f = handle.object_facing(0.0).unwrap() as f64;
        let (x, y) = (2, 1);
        if edge_wall {
            handle
                .sim
                .world_mut()
                .insert_resource(SavedLayout::EdgeWallsV1 {
                    edges: vec![WallEdge {
                        axis: EdgeAxis::Vertical,
                        x: 3,
                        y: 1,
                        doorway: false,
                    }],
                });
            handle
                .sim
                .world_mut()
                .resource_mut::<TileGrid>()
                .set_edge_blocked((2, 1), (3, 1), true);
        } else {
            handle
                .sim
                .world_mut()
                .insert_resource(SavedLayout::LegacyCells {
                    walls: vec![(3, 1)],
                });
            handle
                .sim
                .world_mut()
                .resource_mut::<TileGrid>()
                .set_blocked(3, 1, true);
        }
        let before = handle.save_bytes();
        let preview = handle.placement_preview(0.0, x as f64, y as f64, f);
        assert_eq!(preview[0], 6.0);
        assert!(preview[4] > 0.0 && preview[5] > 0.0);
        assert!(handle.last_placement_result().is_empty());
        assert!(handle.place_object(0.0, x as f64, y as f64, f));
        handle.flush_commands();
        assert_eq!(handle.last_placement_result(), [0, 6]);
        assert_eq!(handle.lot_revision(), 0);
        assert_eq!(handle.save_bytes(), before);
    }
}

#[test]
fn placement_boundary_preserves_appended_wire_code_and_pending_save_replay() {
    let mut original = SimHandle::from_lot();
    let f = original.object_facing(0.0).unwrap();
    let mut chosen = None;
    for y in 0..original.lot_height() {
        for x in 0..original.lot_width() {
            if (x, y) != (0, 0)
                && original.placement_preview(0.0, x as f64, y as f64, f as f64)[0] == 0.0
            {
                chosen = Some((x, y));
                break;
            }
        }
        if chosen.is_some() {
            break;
        }
    }
    let (x, y) = chosen.unwrap();
    assert!(original.place_object(0.0, x as f64, y as f64, f as f64));
    assert_eq!(
        postcard::to_allocvec(&original.sim.world().resource::<CommandQueue>().as_slice()[0])
            .unwrap(),
        [7, 0, x as u8, y as u8, f as u8]
    );
    let saved = original.save_bytes();
    let mut restored = SimHandle::new(1, 1);
    assert!(restored.load_bytes(&saved));
    original.flush_commands();
    restored.flush_commands();
    assert_eq!(restored.save_bytes(), original.save_bytes());
    assert_eq!(restored.world_hash(), original.world_hash());
    assert_eq!(restored.last_placement_result(), [0, 0]);
}
