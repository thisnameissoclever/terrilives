use super::*;
use terri_core::layout::{EdgeAxis, SavedLayout, WallEdge};

fn handle_with_edge(axis: EdgeAxis, x: u32, y: u32, doorway: bool) -> SimHandle {
    let mut handle = SimHandle::new(8, 8);
    let mut snapshot = handle.sim.save_snapshot_v2();
    snapshot.layout = SavedLayout::EdgeWallsV1 {
        edges: vec![WallEdge {
            axis,
            x,
            y,
            doorway,
        }],
    };
    handle.sim.load_snapshot_v2(snapshot).unwrap();
    assert_eq!(handle.wall_layout_kind(), 1);
    let content = handle.sim.world().resource::<Content>().0;
    let bed = content.find("double_bed").unwrap();
    assert_eq!(
        content.object(bed).footprint,
        terri_core::Footprint { width: 2, depth: 2 }
    );
    handle
}

#[test]
fn spawn_object_accepts_solid_edges_on_each_perimeter_side() {
    for (axis, x, y) in [
        (EdgeAxis::Vertical, 3, 3),
        (EdgeAxis::Vertical, 5, 3),
        (EdgeAxis::Horizontal, 3, 3),
        (EdgeAxis::Horizontal, 3, 5),
        (EdgeAxis::Vertical, 4, 5),
    ] {
        let mut handle = handle_with_edge(axis, x, y, false);
        assert!(
            handle.spawn_object(3.0, 3.0, "double_bed"),
            "perimeter {axis:?}({x},{y})"
        );
        assert_eq!(handle.entity_count(), 1);
        let snapshot = handle.sim.save_snapshot_v2();
        assert_eq!(snapshot.world.entities.len(), 1);
        assert_eq!(
            snapshot.world.entities[0].smart_object.as_deref(),
            Some("double_bed")
        );
        assert_eq!(
            snapshot.world.entities[0].position,
            Some(terri_core::SavedPosition { x: 3.0, y: 3.0 })
        );
        let bytes = handle.save_bytes();
        let mut restored = SimHandle::new(1, 1);
        assert!(restored.load_bytes(&bytes));
        assert_eq!(restored.save_bytes(), bytes);
    }
}

#[test]
fn spawn_object_refuses_each_internal_wall_without_changing_world_or_render_buffers() {
    for (axis, x, y) in [(EdgeAxis::Vertical, 4, 3), (EdgeAxis::Horizontal, 3, 4)] {
        let mut handle = handle_with_edge(axis, x, y, false);
        assert!(handle.spawn_object(0.0, 0.0, "fridge"));
        let before = handle.save_bytes();
        let count = handle.entity_count();
        let positions = handle.positions_ptr();
        let previous = handle.prev_positions_ptr();
        assert!(
            !handle.spawn_object(3.0, 3.0, "double_bed"),
            "internal {axis:?}({x},{y})"
        );
        assert_eq!(handle.save_bytes(), before);
        assert_eq!(handle.entity_count(), count);
        assert_eq!(handle.positions_ptr(), positions);
        assert_eq!(handle.prev_positions_ptr(), previous);

        let mut doorway = handle_with_edge(axis, x, y, true);
        assert!(doorway.spawn_object(3.0, 3.0, "double_bed"));
        assert_eq!(doorway.entity_count(), 1);
        let bytes = doorway.save_bytes();
        let mut restored = SimHandle::new(1, 1);
        assert!(restored.load_bytes(&bytes));
        assert_eq!(restored.save_bytes(), bytes);
    }
}
