use super::*;
use terri_core::layout::{EdgeAxis, WallState};

fn edges(sim: &Sim) -> Vec<WallEdge> {
    match sim.world().resource::<SavedLayout>() {
        SavedLayout::EdgeWallsV1 { edges } => edges.clone(),
        other => panic!("not an edge-wall house: {other:?}"),
    }
}

fn size(sim: &Sim) -> (usize, usize) {
    let grid = sim.world().resource::<TileGrid>();
    (grid.width(), grid.height())
}

/// Every tile's walkability and every step's crossing, row by row.
fn floor_plan(sim: &Sim) -> Vec<(bool, bool, bool)> {
    let grid = sim.world().resource::<TileGrid>();
    let (width, height) = (grid.width() as i32, grid.height() as i32);
    (0..height)
        .flat_map(|y| (0..width).map(move |x| (x, y)))
        .map(|(x, y)| {
            (
                grid.is_walkable(x, y),
                grid.can_cross((x, y), (x + 1, y)),
                grid.can_cross((x, y), (x, y + 1)),
            )
        })
        .collect()
}

/// [OS-migrate] in `docs/specs/2026-09-22-the-outside.md`: a house saved
/// before the yard loads as the shipped house standing in its yard. The lot's
/// size, the saved walls then the house's outside walls, every tile and step
/// where the shipped lot has them, and the shipped world's own digest.
#[test]
fn a_house_saved_before_the_yard_loads_standing_in_it() {
    let saved = Sim::new_from_pre_yard_lot();
    assert_eq!(size(&saved), (16, 12), "precondition: the old lot");
    let mut loaded = Sim::new_from_shipped_lot();
    loaded.load_snapshot_v5(saved.save_snapshot_v5()).unwrap();
    let shipped = Sim::new_from_shipped_lot();
    assert_eq!(size(&loaded), (20, 16));
    assert_eq!(edges(&loaded), edges(&shipped));
    assert_eq!(floor_plan(&loaded), floor_plan(&shipped));
    assert_eq!(loaded.world_hash(), shipped.world_hash());
}

/// [OS-migrate]: the saved walls are kept as saved, a wall the player built
/// among them, and the content's outside walls follow them.
#[test]
fn a_grown_house_keeps_the_walls_it_was_saved_with() {
    let mut saved = Sim::new_from_pre_yard_lot();
    let before = edges(&saved);
    saved
        .world_mut()
        .resource_mut::<terri_core::CommandQueue>()
        .push(terri_core::SimCommand::SetWallEdge {
            axis: EdgeAxis::Horizontal,
            x: 9,
            y: 5,
            state: WallState::Wall,
        });
    saved.flush_commands();
    let built = edges(&saved);
    assert_eq!(
        built.len(),
        before.len() + 1,
        "precondition: the living room takes the wall"
    );
    let mut loaded = Sim::new_from_shipped_lot();
    loaded.load_snapshot_v5(saved.save_snapshot_v5()).unwrap();
    let outside: Vec<WallEdge> = terri_data::pack()
        .lot
        .wall_edges
        .iter()
        .filter(|edge| !edge.in_bounds(16, 12))
        .copied()
        .collect();
    assert_eq!(outside.len(), 28);
    assert_eq!(edges(&loaded), [built, outside].concat());
}

/// [OS-migrate]: a house already at the lot's size is not grown again, so
/// no outside wall is added twice.
#[test]
fn a_house_saved_in_its_yard_loads_as_saved() {
    let saved = Sim::new_from_shipped_lot();
    let mut loaded = Sim::new_from_shipped_lot();
    loaded.load_snapshot_v5(saved.save_snapshot_v5()).unwrap();
    assert_eq!(size(&loaded), (20, 16));
    assert_eq!(edges(&loaded), edges(&saved));
    assert_eq!(loaded.world_hash(), saved.world_hash());
}

/// [OS-migrate]: a house saved before edge walls keeps its frozen layout and
/// its size, as it always has.
#[test]
fn a_house_saved_before_edge_walls_is_not_grown() {
    let mut sim = Sim::new_from_pre_yard_lot();
    sim.world_mut()
        .insert_resource(SavedLayout::LegacyAuthoredV1);
    grow(&mut sim, terri_data::pack());
    assert_eq!(size(&sim), (16, 12));
    assert!(matches!(
        sim.world().resource::<SavedLayout>(),
        SavedLayout::LegacyAuthoredV1
    ));
}
