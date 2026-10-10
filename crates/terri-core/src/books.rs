//! Saveable book identities and state, independent of authored content.

use crate::SimId;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
pub struct BookCopyId(pub u32);

/// The caller maps this opaque key to furniture and validates that mapping after load.
/// A saved entity index may be used when its restore contract preserves identity.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
pub struct BookShelfId(pub u64);

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
pub struct ShelfSlot {
    pub shelf: BookShelfId,
    pub slot: u16,
}

/// A native preview that a purchase must match before charging.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct BookPurchaseQuote {
    pub title: String,
    pub price: u32,
    pub home: ShelfSlot,
    pub next_copy_id: u32,
}

/// A shelf-local sale preview; title memory belongs to the household.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct BookSaleQuote {
    pub copy: BookCopyId,
    pub shelf: BookShelfId,
    pub price: u32,
}

#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
pub enum BookLocation {
    Inventory,
    Shelf(ShelfSlot),
    Carried(SimId),
    Lot { x: f32, y: f32 },
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct BookCopy {
    pub id: BookCopyId,
    pub title_id: String,
    pub location: BookLocation,
    /// Kept while borrowed so a return always has its original place.
    pub home: Option<ShelfSlot>,
    /// Includes the reservation before pickup, while the copy is still visible.
    pub borrower: Option<SimId>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct TitleMemory {
    pub sim_id: SimId,
    pub title_id: String,
    pub progress_ticks: u32,
    pub progress_fraction: f32,
    pub pass_novelty: Option<f32>,
    pub familiarity: f32,
    pub last_read_tick: u64,
    pub completed_passes: u32,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct SavedBookLibrary {
    /// IDs below this value were issued, even when their copies were sold.
    pub next_copy_id: u32,
    pub migration_granted: bool,
    pub taste_seed: u64,
    pub copies: Vec<BookCopy>,
    pub memories: Vec<TitleMemory>,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn saving_preserves_copy_home_claims_and_title_memory_separately() {
        let home = ShelfSlot {
            shelf: BookShelfId(47),
            slot: 23,
        };
        let saved = SavedBookLibrary {
            next_copy_id: 19,
            migration_granted: true,
            taste_seed: 912,
            copies: vec![
                BookCopy {
                    id: BookCopyId(8),
                    title_id: "a_title".into(),
                    location: BookLocation::Carried(SimId(31)),
                    home: Some(home),
                    borrower: Some(SimId(31)),
                },
                BookCopy {
                    id: BookCopyId(18),
                    title_id: "a_title".into(),
                    location: BookLocation::Inventory,
                    home: None,
                    borrower: None,
                },
            ],
            memories: vec![TitleMemory {
                sim_id: SimId(31),
                title_id: "a_title".into(),
                progress_ticks: 51,
                progress_fraction: 0.25,
                pass_novelty: Some(0.4),
                familiarity: 0.8,
                last_read_tick: 781,
                completed_passes: 2,
            }],
        };
        let bytes = postcard::to_allocvec(&saved).unwrap();
        let decoded: SavedBookLibrary = postcard::from_bytes(&bytes).unwrap();
        assert_eq!(decoded, saved);
    }
}
