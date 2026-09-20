//! Frozen public source layout for the bathtub migration, not the live lot.
//!
//! Save V1 combines wall and furniture collision in one bitmap. Only this
//! reviewed layout has enough provenance to release the bathtub's old cell.
//! Future destination lot edits must not change what this migration accepts.

use super::SaveError;
use terri_core::SaveSnapshotV1;
use terri_data::ContentPack;

const WIDTH: usize = 16;
const HEIGHT: usize = 12;
const WALLS: [(usize, usize); 28] = [
    (7, 0),
    (7, 1),
    (7, 3),
    (7, 4),
    (0, 5),
    (1, 5),
    (2, 5),
    (4, 5),
    (5, 5),
    (6, 5),
    (7, 5),
    (8, 5),
    (9, 5),
    (10, 5),
    (11, 5),
    (12, 5),
    (14, 5),
    (15, 5),
    (5, 6),
    (5, 7),
    (5, 8),
    (5, 10),
    (5, 11),
    (11, 6),
    (11, 7),
    (11, 9),
    (11, 10),
    (11, 11),
];
const OBJECTS: [(&str, usize, usize); 34] = [
    ("fridge", 0, 0),
    ("counter", 1, 0),
    ("stove", 2, 0),
    ("counter", 3, 0),
    ("kitchen_sink", 4, 0),
    ("counter", 5, 0),
    ("trashcan", 6, 0),
    ("dining_table", 2, 3),
    ("chair", 1, 3),
    ("chair", 4, 3),
    ("bookshelf", 8, 0),
    ("long_sofa", 10, 0),
    ("armchair", 13, 0),
    ("potted_plant", 15, 0),
    ("coat_rack", 15, 1),
    ("floor_lamp", 14, 2),
    ("radio", 8, 3),
    ("television", 10, 3),
    ("sofa", 12, 3),
    ("double_bed", 0, 6),
    ("nightstand", 2, 6),
    ("dresser", 0, 10),
    ("moving_box", 4, 11),
    ("desk", 6, 6),
    ("desk_chair", 6, 7),
    ("bed", 9, 6),
    ("reading_chair", 9, 9),
    ("reference_shelf", 6, 10),
    ("potted_plant", 10, 11),
    ("toilet", 12, 6),
    ("shower", 14, 6),
    ("bathtub", 14, 9),
    ("sink", 12, 10),
    ("laundry", 12, 11),
];

pub(super) fn validate(snapshot: &SaveSnapshotV1, source: &ContentPack) -> Result<(), SaveError> {
    if snapshot.grid_width as usize != WIDTH || snapshot.grid_height as usize != HEIGHT {
        return Err(SaveError::InvalidGrid);
    }
    let mut saved = Vec::new();
    for entity in &snapshot.entities {
        if let Some(id) = entity.smart_object.as_deref() {
            let position = entity.position.ok_or(SaveError::InvalidGrid)?;
            saved.push((id, position.x.to_bits(), position.y.to_bits()));
        }
    }
    let mut expected: Vec<_> = OBJECTS
        .iter()
        .map(|&(id, x, y)| (id, (x as f32).to_bits(), (y as f32).to_bits()))
        .collect();
    saved.sort_unstable();
    expected.sort_unstable();
    if saved != expected {
        return Err(SaveError::InvalidGrid);
    }

    let mut blocked = vec![false; WIDTH * HEIGHT];
    for (x, y) in WALLS {
        blocked[y * WIDTH + x] = true;
    }
    for (id, x, y) in OBJECTS {
        let object = source.find(id).ok_or(SaveError::InvalidContentReference)?;
        let footprint = source.object(object).footprint;
        for yy in y..y + footprint.depth as usize {
            for xx in x..x + footprint.width as usize {
                blocked[yy * WIDTH + xx] = true;
            }
        }
    }
    if snapshot.blocked_tiles != blocked {
        return Err(SaveError::InvalidGrid);
    }
    Ok(())
}
