//! Land expansion extends the frozen schema-twelve envelope without changing
//! its records - issue 254.
use crate::SaveSnapshotV12;
use serde::{Deserialize, Serialize};

/// Where the content lot stands on the grid and how much land was bought.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct SavedLotFrame {
    pub origin_x: u32,
    pub origin_y: u32,
    pub purchased_area: u32,
}

/// Schema thirteen: the schema-twelve envelope, then the lot frame (absent
/// for a lot with no house, such as a custom lot) and the household's funds
/// in cents. The schema-one funds field inside still carries the whole
/// dollars, rounded down, so every frozen reader decodes; the cents win
/// when present. A schema-twelve payload is still read as schema twelve and
/// loads with the frame its grid implies and its dollars times a hundred.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct SaveSnapshotV13 {
    pub legacy: SaveSnapshotV12,
    pub lot_frame: Option<SavedLotFrame>,
    pub funds_cents: i64,
}
