//! Floor coverings: what the player has laid on each tile - [FL-command] in
//! `docs/specs/2026-09-22-floors.md`.
//!
//! Coverings and base surfaces determine appearance, cleaning eligibility and
//! arrival destinations. Remove clears the covering and changes an indoor base
//! surface to grass; existing grass and street bases remain. Floor edits create
//! no physical barrier or reservation, so they do not need wall or furniture
//! placement proofs. Validation checks the lot bounds and covering identifier.

use super::{LotEditState, PlacementRefusal};
use bevy_ecs::prelude::*;
use terri_core::layout::SavedFloors;
use terri_core::TileGrid;

/// One requested change: this tile, this covering, with 0 for none.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct FloorEdit {
    pub x: u32,
    pub y: u32,
    pub covering: u8,
}

/// What the drain did with the most recent floor change. `reason` is `None`
/// when it was applied, including when the tile already had that covering.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct FloorEditResult {
    pub edit: FloorEdit,
    pub reason: Option<PlacementRefusal>,
}

/// The checks, shared by the preview and the commit so a player is never
/// offered a change the drain then refuses.
pub fn validate_floor_edit(world: &World, edit: FloorEdit) -> Result<(), PlacementRefusal> {
    let grid = world.resource::<TileGrid>();
    if edit.x >= grid.width() as u32 || edit.y >= grid.height() as u32 {
        return Err(PlacementRefusal::OutOfBounds);
    }
    let coverings = world.resource::<crate::Content>().0.coverings.len();
    if edit.covering as usize > coverings {
        return Err(PlacementRefusal::InvalidInput);
    }
    Ok(())
}

/// Revalidation and the write happen in one exclusive command drain.
pub(crate) fn commit(world: &mut World, edit: FloorEdit) {
    let reason = validate_floor_edit(world, edit).err();
    if reason.is_none() {
        let mut floors = world.get_resource_mut::<SavedFloors>();
        let mut changed = match floors.as_mut() {
            Some(floors) => floors.set(edit.x, edit.y, edit.covering),
            None => {
                let mut fresh = SavedFloors::default();
                let changed = fresh.set(edit.x, edit.y, edit.covering);
                world.insert_resource(fresh);
                changed
            }
        };
        if edit.covering == 0 {
            if let Some(mut surfaces) =
                world.get_resource_mut::<crate::world_geometry::WorldSurfaces>()
            {
                let index = (edit.y * surfaces.width + edit.x) as usize;
                if surfaces.tiles[index] == 0 {
                    surfaces.tiles[index] = 1;
                    changed = true;
                }
            }
        }
        if changed {
            let mut state = world.resource_mut::<LotEditState>();
            state.revision = state.revision.saturating_add(1);
        }
    }
    world.resource_mut::<LotEditState>().last_floor_result = Some(FloorEditResult { edit, reason });
}
