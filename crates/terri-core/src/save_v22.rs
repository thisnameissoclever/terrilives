//! Bills extend schema twenty-one: issue 298
//! (`docs/specs/2026-10-18-wages-and-bills.md`, [WB-save]).
use crate::SaveSnapshotV21;
use serde::{Deserialize, Serialize};

/// One usage kind's count for the month, by the kind's string id.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct SavedBillCount {
    pub kind: String,
    pub count: u32,
}

/// The last issued month's usage, which the Bills panel's expected amounts
/// read: what usage added to the electricity and water bills, in cents, and
/// the month's trips to work.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct SavedPreviousUsage {
    pub electricity_cents: i64,
    pub water_cents: i64,
    pub commutes: u32,
}

/// One issued bill.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct SavedBill {
    /// The day index it is due: the first day of a month.
    pub due_day: u32,
    /// 0 rent, 1 electricity, 2 water, 3 transportation.
    pub kind: u8,
    pub amount_cents: i64,
    pub late_fee_cents: i64,
    /// The day index it was paid, `None` while unpaid.
    pub paid_day: Option<u32>,
}

/// The bills record ([WB-save]).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct SavedBills {
    /// The day index last counted; `None` before the first, and in every
    /// save from before bills.
    pub last_counted_day: Option<u32>,
    /// Days counted in the current month.
    pub month_days: u32,
    pub indoor_tile_days: u64,
    pub outdoor_tile_days: u64,
    /// Ascending by kind id, nonzero counts only.
    pub uses: Vec<SavedBillCount>,
    /// Ascending by kind id, nonzero counts only.
    pub daily: Vec<SavedBillCount>,
    pub commutes: u32,
    pub previous: Option<SavedPreviousUsage>,
    /// Every unpaid bill and the bills of the last issued month, ascending
    /// by due day and then kind.
    pub bills: Vec<SavedBill>,
}

impl Default for SavedBills {
    /// The record of a world that has counted nothing, which every save
    /// from before bills loads as.
    fn default() -> Self {
        Self {
            last_counted_day: None,
            month_days: 0,
            indoor_tile_days: 0,
            outdoor_tile_days: 0,
            uses: Vec::new(),
            daily: Vec::new(),
            commutes: 0,
            previous: None,
            bills: Vec::new(),
        }
    }
}

/// Schema twenty-two: the schema-twenty-one envelope, then the bills.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct SaveSnapshotV22 {
    pub legacy: SaveSnapshotV21,
    pub bills: SavedBills,
}
