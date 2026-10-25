//! The household's bills across the boundary - issue 298, [WB-panel] in
//! `docs/specs/2026-10-18-wages-and-bills.md`. Each export is a flat list
//! of cents, counts and day indices, empty in a world without a lot. A day
//! index `d` is the day the HUD shows as `Day d + 1`.
use super::*;
use terri_sim::bills;

/// Day indices and an unpaid bill's missing paid day, as numbers the shell
/// reads: -1 for none.
fn day(day: Option<u32>) -> f64 {
    day.map_or(-1.0, f64::from)
}

fn bill_rows(rows: &[bills::Bill]) -> Vec<f64> {
    rows.iter()
        .flat_map(|bill| {
            [
                f64::from(bill.kind),
                f64::from(bill.due_day),
                bill.amount_cents as f64,
                bill.late_fee_cents as f64,
                day(bill.paid_day),
            ]
        })
        .collect()
}

#[wasm_bindgen]
impl SimHandle {
    /// `[funds_cents, keep_aside_cents, shortfall_cents, next_due_day,
    /// overdue_cents, overdue_fee_cents, days_per_month, grace_days,
    /// late_fee_percent, late_fee_cap_percent, month_days]`; empty without
    /// a lot.
    pub fn bills_overview(&self) -> Vec<f64> {
        bills::overview(self.sim.world()).map_or_else(Vec::new, |o| {
            vec![
                o.funds_cents as f64,
                o.keep_aside_cents as f64,
                o.shortfall_cents as f64,
                f64::from(o.next_due_day),
                o.overdue_cents as f64,
                o.overdue_fee_cents as f64,
                f64::from(o.days_per_month),
                f64::from(o.grace_days),
                f64::from(o.late_fee_percent),
                f64::from(o.late_fee_cap_percent),
                f64::from(o.month_days),
            ]
        })
    }

    /// Per next bill, in payment order, `[kind, so_far_cents,
    /// expected_cents]`; kind 0 rent, 1 electricity, 2 water, 3
    /// transportation.
    pub fn bills_next(&self) -> Vec<f64> {
        bills::next_bills(self.sim.world())
            .iter()
            .flat_map(|bill| {
                [
                    f64::from(bill.kind),
                    bill.so_far_cents as f64,
                    bill.expected_cents as f64,
                ]
            })
            .collect()
    }

    /// Per line of next bill `kind`, `[line, kind_index, count, unit_cents,
    /// amount_cents, tile_days]`: line 0 the base charge (count is days
    /// counted), 1 indoor tiles, 2 outdoor tiles (count is today's tiles and
    /// tile_days the tiles summed over the days counted), 3 a use kind
    /// (kind_index into the use labels), 4 a daily kind (into the daily
    /// labels), 5 trips. A bill's line amounts add up to its amount so far.
    /// Empty for a kind past 3, a non-integer, or a world without a lot.
    pub fn bills_lines(&self, kind: f64) -> Vec<f64> {
        let Some(kind) = placement_u32(kind).and_then(|kind| u8::try_from(kind).ok()) else {
            return Vec::new();
        };
        bills::lines(self.sim.world(), kind)
            .iter()
            .flat_map(|line| {
                [
                    f64::from(line.line as u8),
                    f64::from(line.kind_index),
                    line.count as f64,
                    line.unit_cents as f64,
                    line.amount_cents as f64,
                    line.tile_days as f64,
                ]
            })
            .collect()
    }

    /// Per overdue bill, oldest first, `[kind, due_day, amount_cents,
    /// fee_cents, paid_day]` with `paid_day` -1.
    pub fn bills_overdue(&self) -> Vec<f64> {
        bill_rows(&bills::overdue_bills(self.sim.world()))
    }

    /// Per bill of the last issued month, `[kind, due_day, amount_cents,
    /// fee_cents, paid_day]` with `paid_day` -1 while unpaid.
    pub fn bills_last_month(&self) -> Vec<f64> {
        bill_rows(&bills::last_month(self.sim.world()))
    }

    /// The usage kinds' labels: the use kinds in compiled order, then the
    /// daily kinds, so a line's `kind_index` reads its label at that index,
    /// past the use kinds for a daily line. Read once at startup.
    pub fn bill_kind_labels(&self) -> Vec<String> {
        let pack = self.sim.world().resource::<terri_sim::Content>().0;
        pack.bills
            .uses
            .iter()
            .chain(&pack.bills.daily)
            .map(|kind| kind.label.clone())
            .collect()
    }

    /// How many use kinds there are, which is where the daily kinds' labels
    /// start in [`Self::bill_kind_labels`].
    pub fn bill_use_kind_count(&self) -> u32 {
        self.sim
            .world()
            .resource::<terri_sim::Content>()
            .0
            .bills
            .uses
            .len() as u32
    }

    /// One shift's pay with the night premium, in cents, for the person
    /// carrying `entity_index` while they hold a night shift; -1 for anyone
    /// else, an object or a stale index ([WB-panel], the Career tab's night
    /// pay line).
    pub fn night_pay_cents_of(&self, entity_index: u32) -> f64 {
        let world = self.sim.world();
        let Some(mut people) = world.try_query::<(terri_core::Entity, &terri_core::Agent)>() else {
            return -1.0;
        };
        people
            .iter(world)
            .map(|(entity, _)| entity)
            .find(|entity| entity.index_u32() == entity_index)
            .and_then(|person| terri_sim::shifts::night_pay_cents(world, person))
            .map_or(-1.0, |cents| cents as f64)
    }

    /// The night premium in percent, for the Career tab's sentence.
    pub fn night_shift_premium_percent(&self) -> u32 {
        self.sim
            .world()
            .resource::<terri_sim::Content>()
            .0
            .tuning
            .night_shift_premium_percent
    }
}
