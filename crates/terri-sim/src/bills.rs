//! The household's monthly bills - issue 298
//! (`docs/specs/2026-10-18-wages-and-bills.md`).
//!
//! The bills system counts each day of a month once, on the first tick it
//! processes in that day: one day of each base charge, one day of rent from
//! the confirmed room layout, and one day of each placed object's daily
//! usage. Uses are counted when an action or chain step starts its physical
//! work, and trips to work when a shift with time worked is paid. On the
//! first day of the next month the month's four bills are issued, and every
//! tick the unpaid bills are paid from Funds, oldest first, never in part.
//! A bill unpaid after its grace gains a late fee each day up to a cap, and
//! while any bill is overdue every housemate is Behind on bills ([WB-paying]).
//!
//! Counts are kept rather than cents, so a retuned rate applies to the month
//! in progress. Nothing here draws from a random stream; every amount is
//! integer cents with the single rounding steps the spec states.
use bevy_ecs::prelude::*;
use terri_core::save_v22::{SavedBill, SavedBillCount, SavedBills, SavedPreviousUsage};
use terri_core::{FnvHasher, Funds, Position, SimClock, SmartObject};
use terri_data::{BillsTuning, ContentPack, ObjectDefId};

use crate::Content;

/// The four bills, numbered in payment order within a month ([WB-bills]).
pub const RENT: u8 = 0;
pub const ELECTRICITY: u8 = 1;
pub const WATER: u8 = 2;
pub const TRANSPORTATION: u8 = 3;
/// How many kinds of bill there are.
pub const BILL_KINDS: u8 = 4;

/// The most uses of one kind, or trips, a saved month may hold
/// ([WB-save]); far above what a seven-day month can produce.
pub const MAX_SAVED_COUNT: u32 = 100_000;
/// The largest amount a saved bill may carry, in cents: ten billion
/// dollars, far above any month and far inside `i64` for payment.
pub const MAX_SAVED_AMOUNT_CENTS: i64 = 1_000_000_000_000;

/// One issued bill ([WB-bills]).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Bill {
    /// The day index the bill is due: the first day of the month after the
    /// one it charges. The HUD shows day index `d` as `Day d + 1`.
    pub due_day: u32,
    /// [`RENT`], [`ELECTRICITY`], [`WATER`] or [`TRANSPORTATION`].
    pub kind: u8,
    pub amount_cents: i64,
    /// The late fees gathered so far, from 0 to the cap.
    pub late_fee_cents: i64,
    /// The day index it was paid, or `None` while unpaid.
    pub paid_day: Option<u32>,
}

impl Bill {
    /// Whether the bill is unpaid on day `today` with its grace over
    /// ([WB-paying]): a bill due on day `d` with `g` days' grace is overdue
    /// from day `d + g`.
    pub fn overdue_on(&self, today: u32, grace_days: u32) -> bool {
        self.paid_day.is_none() && today >= self.due_day.saturating_add(grace_days)
    }

    /// What paying it takes: the bill and its late fees.
    pub fn total_cents(&self) -> i64 {
        self.amount_cents + self.late_fee_cents
    }
}

/// The last issued month's usage, which the Bills panel's expected amounts
/// read ([WB-panel]).
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct PreviousUsage {
    pub electricity_cents: i64,
    pub water_cents: i64,
    pub commutes: u32,
}

/// Everything the bills keep between ticks, saved in schema twenty-two
/// ([WB-save]) and in the world hash once it is not pristine
/// ([WB-determinism]).
#[derive(Resource, Clone, Debug, Default, PartialEq, Eq)]
pub struct Bills {
    /// The day index last counted, or `None` before the first.
    pub last_counted_day: Option<u32>,
    /// Days counted in the current month.
    pub month_days: u32,
    /// The sum over counted days of the indoor and outdoor rent tiles.
    pub indoor_tile_days: u64,
    pub outdoor_tile_days: u64,
    /// The month's uses, by compiled use kind index; a short list means
    /// the rest are zero.
    pub uses: Vec<u32>,
    /// The month's object-days, by compiled daily kind index.
    pub daily: Vec<u32>,
    /// The month's trips to work.
    pub commutes: u32,
    pub previous: Option<PreviousUsage>,
    /// Every unpaid bill and the bills of the last issued month, ascending
    /// by due day and then kind.
    pub bills: Vec<Bill>,
}

impl Bills {
    /// No day counted, nothing used and no bill: the state of every world
    /// without a lot, which the world hash leaves out.
    pub fn is_pristine(&self) -> bool {
        *self == Self::default()
    }
}

/// The day index of `tick`: `tick / day_ticks`, saturated to `u32`.
pub fn day_index(tick: u64, day_ticks: u32) -> u32 {
    u32::try_from(tick / u64::from(day_ticks)).unwrap_or(u32::MAX)
}

/// Whether the day index `day` is the first day of a month.
pub fn is_month_start(day: u32, days_per_month: u32) -> bool {
    day.is_multiple_of(days_per_month)
}

/// Bills act only in a world with a lot: a lot frame and a confirmed room
/// map. A hand-built world without them stays pristine and hashes as it did
/// before bills existed ([WB-determinism]).
fn active(world: &World) -> bool {
    world.contains_resource::<crate::rooms::RoomMap>() && crate::lot_frame::frame(world).is_some()
}

fn ceil_div(numerator: i64, denominator: i64) -> i64 {
    (numerator + denominator - 1).div_euclid(denominator)
}

/// What the month's usage adds to the electricity and water bills, in
/// cents: each kind's count times its rate.
pub fn usage_cents(bills: &Bills, tuning: &BillsTuning) -> (i64, i64) {
    let mut electricity = 0;
    let mut water = 0;
    for (counts, kinds) in [(&bills.uses, &tuning.uses), (&bills.daily, &tuning.daily)] {
        for (count, kind) in counts.iter().zip(kinds) {
            electricity += i64::from(*count) * kind.electricity_cents;
            water += i64::from(*count) * kind.water_cents;
        }
    }
    (electricity, water)
}

/// The four bills the counted month comes to, in kind order ([WB-bills]),
/// each with its one rounding step.
pub fn month_amounts(bills: &Bills, tuning: &BillsTuning) -> [i64; BILL_KINDS as usize] {
    let days = i64::from(bills.month_days);
    let month = i64::from(tuning.days_per_month);
    let (electricity, water) = usage_cents(bills, tuning);
    let rent = ceil_div(
        tuning.rent_base_cents * days
            + tuning.rent_indoor_tile_cents * bills.indoor_tile_days as i64
            + tuning.rent_outdoor_tile_cents * bills.outdoor_tile_days as i64,
        month,
    );
    [
        rent,
        ceil_div(tuning.electricity_base_cents * days, month) + electricity,
        ceil_div(tuning.water_base_cents * days, month) + water,
        ceil_div(tuning.transportation_base_cents * days, month)
            + tuning.commute_cents * i64::from(bills.commutes),
    ]
}

/// The most late fees a bill of `amount_cents` gathers: the cap percentage
/// of it, rounded down to the cent ([WB-paying]).
pub fn late_fee_cap(amount_cents: i64, tuning: &BillsTuning) -> i64 {
    amount_cents * i64::from(tuning.late_fee_cap_percent) / 100
}

/// One day's late fee on a bill: the fee percentage of it, rounded up to
/// the cent, less whatever would pass the cap.
pub fn late_fee_today(bill: &Bill, tuning: &BillsTuning) -> i64 {
    let fee = ceil_div(bill.amount_cents * i64::from(tuning.late_fee_percent), 100);
    fee.min(late_fee_cap(bill.amount_cents, tuning) - bill.late_fee_cents)
        .max(0)
}

/// The rent tiles of the confirmed layout today, `(indoor, outdoor)`.
fn rent_tiles(world: &World) -> (u32, u32) {
    crate::rooms::rent_tiles(world).unwrap_or((0, 0))
}

/// The bills system, scheduled immediately after
/// `systems::career::commute_and_work`, so pay a shift settles this tick is
/// in Funds before the bills look ([WB-paying]).
pub(crate) fn tick(world: &mut World) {
    if !active(world) {
        return;
    }
    let pack = world.resource::<Content>().0;
    let now = world.resource::<SimClock>().tick;
    let today = day_index(now, pack.tuning.day_ticks);
    if world.resource::<Bills>().last_counted_day != Some(today) {
        start_day(world, pack, today);
    }
    pay(world, today);
}

/// The day's work, once, on the first tick processed in it
/// ([WB-calendar]): issue the month just ended, count the day, and add a
/// day's late fee to every overdue bill.
fn start_day(world: &mut World, pack: &'static ContentPack, today: u32) {
    let tuning = &pack.bills;
    let month = tuning.days_per_month;
    let (indoor, outdoor) = rent_tiles(world);
    let daily = daily_counts(world, pack);
    let mut bills = world.resource_mut::<Bills>();
    if let Some(last) = bills.last_counted_day {
        // The month changed since the last counted day. With every tick
        // processed this is the first day of a month; comparing months
        // keeps a month from being counted into the next whatever happens.
        if last / month != today / month {
            issue(&mut bills, today - today % month, tuning);
        }
    }
    bills.last_counted_day = Some(today);
    bills.month_days += 1;
    bills.indoor_tile_days += u64::from(indoor);
    bills.outdoor_tile_days += u64::from(outdoor);
    // A month with no daily usage keeps an empty list, as a saved month
    // with none restores to one.
    if daily.iter().any(|count| *count > 0) {
        if bills.daily.len() < daily.len() {
            bills.daily.resize(daily.len(), 0);
        }
        for (count, add) in bills.daily.iter_mut().zip(&daily) {
            *count = count.saturating_add(*add);
        }
    }
    for bill in &mut bills.bills {
        if bill.overdue_on(today, tuning.grace_days) {
            bill.late_fee_cents += late_fee_today(bill, tuning);
        }
    }
}

/// How many placed objects carry each daily kind today. Sums are order
/// independent, so the objects are read in query order.
fn daily_counts(world: &mut World, pack: &ContentPack) -> Vec<u32> {
    let mut counts = vec![0u32; pack.bills.daily.len()];
    if counts.is_empty() {
        return counts;
    }
    let mut objects = world.query_filtered::<&SmartObject, With<Position>>();
    for object in objects.iter(world) {
        let Some(definition) = pack.objects.get(object.0 .0 as usize) else {
            continue;
        };
        for &kind in &definition.bill_daily {
            if let Some(count) = counts.get_mut(usize::from(kind)) {
                *count += 1;
            }
        }
    }
    counts
}

/// Issues the counted month's bills, due on `due_day`, and starts the next
/// month ([WB-bills]): zero bills are not issued, paid bills of earlier
/// months are dropped, and the month's usage becomes the last month's.
fn issue(bills: &mut Bills, due_day: u32, tuning: &BillsTuning) {
    let amounts = month_amounts(bills, tuning);
    let (electricity_cents, water_cents) = usage_cents(bills, tuning);
    bills.previous = Some(PreviousUsage {
        electricity_cents,
        water_cents,
        commutes: bills.commutes,
    });
    bills.bills.retain(|bill| bill.paid_day.is_none());
    for (kind, amount_cents) in (0..BILL_KINDS).zip(amounts) {
        if amount_cents > 0 {
            bills.bills.push(Bill {
                due_day,
                kind,
                amount_cents,
                late_fee_cents: 0,
                paid_day: None,
            });
        }
    }
    bills.month_days = 0;
    bills.indoor_tile_days = 0;
    bills.outdoor_tile_days = 0;
    bills.uses.clear();
    bills.daily.clear();
    bills.commutes = 0;
}

/// Pays unpaid bills from Funds, oldest first and in kind order within a
/// month, each in full with its fees, stopping at the first that Funds
/// cannot cover ([WB-paying]). Funds never go below zero.
fn pay(world: &mut World, today: u32) {
    if world
        .resource::<Bills>()
        .bills
        .iter()
        .all(|bill| bill.paid_day.is_some())
    {
        return;
    }
    let mut funds = world.resource::<Funds>().0;
    let mut bills = world.resource_mut::<Bills>();
    for bill in bills
        .bills
        .iter_mut()
        .filter(|bill| bill.paid_day.is_none())
    {
        if funds < bill.total_cents() {
            break;
        }
        funds -= bill.total_cents();
        bill.paid_day = Some(today);
    }
    world.resource_mut::<Funds>().0 = funds;
}

/// Counts one use of each kind in `uses` ([WB-usage]).
fn count_uses(world: &mut World, uses: &[u16]) {
    if uses.is_empty() || !active(world) {
        return;
    }
    let kinds = world.resource::<Content>().0.bills.uses.len();
    let mut bills = world.resource_mut::<Bills>();
    if bills.uses.len() < kinds {
        bills.uses.resize(kinds, 0);
    }
    for &kind in uses {
        if let Some(count) = bills.uses.get_mut(usize::from(kind)) {
            *count = count.saturating_add(1);
        }
    }
}

/// An ordinary action starting its physical work: the object definition's
/// interaction `interaction` charges its use kinds once.
pub(crate) fn count_action(world: &mut World, object: ObjectDefId, interaction: u32) {
    let pack = world.resource::<Content>().0;
    let Some(uses) = pack
        .objects
        .get(object.0 as usize)
        .and_then(|definition| definition.interactions.get(interaction as usize))
        .map(|action| action.bill_uses.as_slice())
    else {
        return;
    };
    count_uses(world, uses);
}

/// A chain step starting its physical work: step `step` of chain `chain`
/// charges its use kinds once.
pub(crate) fn count_step(world: &mut World, chain: u32, step: u32) {
    let pack = world.resource::<Content>().0;
    let Some(uses) = pack
        .chains
        .get(chain as usize)
        .and_then(|chain| chain.steps.get(step as usize))
        .map(|step| step.bill_uses.as_slice())
    else {
        return;
    };
    count_uses(world, uses);
}

/// A shift with time worked has been paid: one trip to work ([WB-bills]).
pub(crate) fn count_trip(world: &mut World) {
    if !active(world) {
        return;
    }
    let mut bills = world.resource_mut::<Bills>();
    bills.commutes = bills.commutes.saturating_add(1);
}

/// Whether any bill is overdue now, which puts every housemate Behind on
/// bills ([WB-paying]). Derived on each read, with no timer of its own.
pub fn any_overdue(world: &World) -> bool {
    let Some(bills) = world.get_resource::<Bills>() else {
        return false;
    };
    let Some(content) = world.get_resource::<Content>() else {
        return false;
    };
    let pack = content.0;
    let today = day_index(world.resource::<SimClock>().tick, pack.tuning.day_ticks);
    bills
        .bills
        .iter()
        .any(|bill| bill.overdue_on(today, pack.bills.grace_days))
}

/// The bills record in the world hash, after every older section, only once
/// it is not pristine ([WB-determinism]). Kinds are hashed by id, as they
/// are saved.
pub(crate) fn hash(world: &World, hash: &mut FnvHasher) {
    let Some(bills) = world.get_resource::<Bills>() else {
        return;
    };
    if bills.is_pristine() {
        return;
    }
    let saved = to_saved(bills, world.resource::<Content>().0);
    hash.write_bytes(b"bills-v1");
    hash.write_u64(saved.last_counted_day.map_or(0, |day| u64::from(day) + 1));
    hash.write_u64(u64::from(saved.month_days));
    hash.write_u64(saved.indoor_tile_days);
    hash.write_u64(saved.outdoor_tile_days);
    for counts in [&saved.uses, &saved.daily] {
        hash.write_u64(counts.len() as u64);
        for row in counts {
            hash.write_u64(row.kind.len() as u64);
            hash.write_bytes(row.kind.as_bytes());
            hash.write_u64(u64::from(row.count));
        }
    }
    hash.write_u64(u64::from(saved.commutes));
    match saved.previous {
        None => hash.write_u64(0),
        Some(previous) => {
            hash.write_u64(1);
            hash.write_u64(previous.electricity_cents as u64);
            hash.write_u64(previous.water_cents as u64);
            hash.write_u64(u64::from(previous.commutes));
        }
    }
    hash.write_u64(saved.bills.len() as u64);
    for bill in &saved.bills {
        hash.write_u64(u64::from(bill.due_day));
        hash.write_u64(u64::from(bill.kind));
        hash.write_u64(bill.amount_cents as u64);
        hash.write_u64(bill.late_fee_cents as u64);
        hash.write_u64(bill.paid_day.map_or(0, |day| u64::from(day) + 1));
    }
}

/// The saved form ([WB-save]): kinds by id, ascending, nonzero counts only.
pub fn to_saved(bills: &Bills, pack: &ContentPack) -> SavedBills {
    let counts = |counts: &[u32], kinds: &[terri_data::BillKind]| -> Vec<SavedBillCount> {
        counts
            .iter()
            .zip(kinds)
            .filter(|(count, _)| **count > 0)
            .map(|(count, kind)| SavedBillCount {
                kind: kind.id.clone(),
                count: *count,
            })
            .collect()
    };
    SavedBills {
        last_counted_day: bills.last_counted_day,
        month_days: bills.month_days,
        indoor_tile_days: bills.indoor_tile_days,
        outdoor_tile_days: bills.outdoor_tile_days,
        uses: counts(&bills.uses, &pack.bills.uses),
        daily: counts(&bills.daily, &pack.bills.daily),
        commutes: bills.commutes,
        previous: bills.previous.map(|previous| SavedPreviousUsage {
            electricity_cents: previous.electricity_cents,
            water_cents: previous.water_cents,
            commutes: previous.commutes,
        }),
        bills: bills
            .bills
            .iter()
            .map(|bill| SavedBill {
                due_day: bill.due_day,
                kind: bill.kind,
                amount_cents: bill.amount_cents,
                late_fee_cents: bill.late_fee_cents,
                paid_day: bill.paid_day,
            })
            .collect(),
    }
}

/// The world's bills in saved form.
pub fn saved(world: &World) -> SavedBills {
    world
        .get_resource::<Bills>()
        .map(|bills| to_saved(bills, world.resource::<Content>().0))
        .unwrap_or_else(|| to_saved(&Bills::default(), world.resource::<Content>().0))
}

/// Refuses a saved bills record the loaded world cannot account for
/// ([WB-save]), before anything is restored. Every bound is checked before
/// any work proportional to a saved number ([L-restore-without-counting-up]).
pub fn validate_saved(world: &World, saved: &SavedBills) -> Result<(), crate::SaveError> {
    use crate::SaveError::InvalidValue;
    let pack = world.resource::<Content>().0;
    let tuning = &pack.bills;
    let month = tuning.days_per_month;
    let today = day_index(world.resource::<SimClock>().tick, pack.tuning.day_ticks);
    let tiles = world
        .get_resource::<terri_core::TileGrid>()
        .map_or(0, |grid| (grid.width() * grid.height()) as u64);
    match saved.last_counted_day {
        Some(day) => {
            if day > today || saved.month_days > month || saved.month_days > day % month + 1 {
                return Err(InvalidValue);
            }
        }
        None => {
            if saved.month_days != 0 {
                return Err(InvalidValue);
            }
        }
    }
    let tile_days = u64::from(saved.month_days) * tiles;
    if saved.indoor_tile_days > tile_days
        || saved.outdoor_tile_days > tile_days
        || saved.commutes > MAX_SAVED_COUNT
    {
        return Err(InvalidValue);
    }
    for (rows, limit) in [
        (&saved.uses, u64::from(MAX_SAVED_COUNT)),
        (&saved.daily, tile_days),
    ] {
        if rows.len() > 10_000
            || rows.windows(2).any(|pair| pair[0].kind >= pair[1].kind)
            || rows
                .iter()
                .any(|row| row.count == 0 || u64::from(row.count) > limit)
        {
            return Err(InvalidValue);
        }
    }
    if let Some(previous) = saved.previous {
        if !(0..=MAX_SAVED_AMOUNT_CENTS).contains(&previous.electricity_cents)
            || !(0..=MAX_SAVED_AMOUNT_CENTS).contains(&previous.water_cents)
            || previous.commutes > MAX_SAVED_COUNT
        {
            return Err(InvalidValue);
        }
    }
    if saved.bills.len() > 10_000
        || saved
            .bills
            .windows(2)
            .any(|pair| (pair[0].due_day, pair[0].kind) >= (pair[1].due_day, pair[1].kind))
    {
        return Err(InvalidValue);
    }
    let last_issued = saved.bills.iter().map(|bill| bill.due_day).max();
    for bill in &saved.bills {
        let grace_over = today >= bill.due_day.saturating_add(tuning.grace_days);
        if bill.kind >= BILL_KINDS
            || bill.due_day > today
            || !is_month_start(bill.due_day, month)
            || bill.amount_cents <= 0
            || bill.amount_cents > MAX_SAVED_AMOUNT_CENTS
            || bill.late_fee_cents < 0
            || bill.late_fee_cents > late_fee_cap(bill.amount_cents, tuning)
            || (bill.late_fee_cents > 0 && !grace_over)
            || bill
                .paid_day
                .is_some_and(|paid| paid < bill.due_day || paid > today)
            || (bill.paid_day.is_some() && Some(bill.due_day) != last_issued)
        {
            return Err(InvalidValue);
        }
    }
    Ok(())
}

/// Installs a validated saved record. A count for a kind the current
/// content no longer defines is dropped: a usage count is only a billing
/// input, and a retired kind should stop costing ([WB-save]).
pub fn restore(world: &mut World, saved: SavedBills) {
    let pack = world.resource::<Content>().0;
    let dense = |rows: &[SavedBillCount], kinds: &[terri_data::BillKind]| -> Vec<u32> {
        let mut counts = vec![0u32; kinds.len()];
        for row in rows {
            if let Some(index) = kinds.iter().position(|kind| kind.id == row.kind) {
                counts[index] = row.count;
            }
        }
        if counts.iter().all(|count| *count == 0) {
            counts.clear();
        }
        counts
    };
    world.insert_resource(Bills {
        last_counted_day: saved.last_counted_day,
        month_days: saved.month_days,
        indoor_tile_days: saved.indoor_tile_days,
        outdoor_tile_days: saved.outdoor_tile_days,
        uses: dense(&saved.uses, &pack.bills.uses),
        daily: dense(&saved.daily, &pack.bills.daily),
        commutes: saved.commutes,
        previous: saved.previous.map(|previous| PreviousUsage {
            electricity_cents: previous.electricity_cents,
            water_cents: previous.water_cents,
            commutes: previous.commutes,
        }),
        bills: saved
            .bills
            .into_iter()
            .map(|bill| Bill {
                due_day: bill.due_day,
                kind: bill.kind,
                amount_cents: bill.amount_cents,
                late_fee_cents: bill.late_fee_cents,
                paid_day: bill.paid_day,
            })
            .collect(),
    });
}

// ------------------------------------------------- the Bills panel ---

/// What the household status panel and the top of the Bills panel read
/// ([WB-panel]). Amounts are cents.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Overview {
    pub funds_cents: i64,
    /// Every unpaid bill with its fees, and the next bills as expected.
    pub keep_aside_cents: i64,
    /// What Funds lack of `keep_aside_cents`, 0 when they cover it.
    pub shortfall_cents: i64,
    /// The day index the next bills are due: the next month's first day.
    pub next_due_day: u32,
    /// The overdue bills and their fees.
    pub overdue_cents: i64,
    pub overdue_fee_cents: i64,
    pub days_per_month: u32,
    pub grace_days: u32,
    pub late_fee_percent: u32,
    pub late_fee_cap_percent: u32,
    /// Days counted in the current month.
    pub month_days: u32,
}

/// One of the next bills: what the month has come to so far and what it is
/// expected to come to by its end ([WB-panel]).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct NextBill {
    pub kind: u8,
    pub so_far_cents: i64,
    pub expected_cents: i64,
}

/// What one line of a next bill is ([WB-panel]).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum LineKind {
    /// The base charge: `count` days counted of a month, `unit` the month's
    /// charge.
    Base = 0,
    /// Rent's indoor tiles today, `unit` a tile's monthly rent.
    IndoorTiles = 1,
    /// Rent's outdoor tiles today.
    OutdoorTiles = 2,
    /// A use kind's uses this month, `unit` one use's charge to this bill.
    Use = 3,
    /// A daily kind's object-days this month, `unit` one object-day's charge.
    Daily = 4,
    /// Trips to work this month, `unit` the fare.
    Trips = 5,
}

/// One line of a next bill. `kind_index` is the use or daily kind's compiled
/// index for [`LineKind::Use`] and [`LineKind::Daily`], and 0 otherwise.
/// `amount_cents` is the line's share of the bill so far, and a bill's lines
/// add up to its amount so far exactly: rent's base and tile lines split its
/// one rounding by largest remainder. For a tile line `count` is today's
/// tiles and `tile_days` the tiles summed over the days counted, which
/// differs from `count` times those days once the layout changed this month;
/// for every other line `tile_days` is 0.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Line {
    pub line: LineKind,
    pub kind_index: u16,
    pub count: u64,
    pub unit_cents: i64,
    pub amount_cents: i64,
    pub tile_days: u64,
}

/// Splits `ceil(sum(numerators) / denominator)` into one whole amount per
/// numerator that add up to it exactly: each takes its floor, and the cents
/// left go to the largest remainders, the earlier line first on a tie.
fn split_rounded(numerators: &[i64], denominator: i64) -> Vec<i64> {
    let total = ceil_div(numerators.iter().sum(), denominator);
    let mut amounts: Vec<i64> = numerators
        .iter()
        .map(|n| n.div_euclid(denominator))
        .collect();
    let mut order: Vec<usize> = (0..numerators.len()).collect();
    order.sort_by_key(|&i| std::cmp::Reverse(numerators[i].rem_euclid(denominator)));
    let left = total - amounts.iter().sum::<i64>();
    for &i in order.iter().take(left.max(0) as usize) {
        amounts[i] += 1;
    }
    amounts
}

fn counted(world: &World) -> Option<(&Bills, &'static ContentPack, u32)> {
    if !active(world) {
        return None;
    }
    let pack = world.resource::<Content>().0;
    let today = day_index(world.resource::<SimClock>().tick, pack.tuning.day_ticks);
    Some((world.get_resource::<Bills>()?, pack, today))
}

/// The record the month will hold on its last day if the house keeps
/// today's layout and the usage keeps the larger of this month's so far and
/// last month's ([WB-panel]): rent and base charges are projected exactly
/// from the days left, usage is projected by that larger amount.
fn expected_month(world: &World, bills: &Bills, tuning: &BillsTuning, today: u32) -> Bills {
    let month = tuning.days_per_month;
    // The days still to count in this month: after the last counted one,
    // or from today on before a game's first tick has counted anything.
    let left = u64::from(match bills.last_counted_day {
        Some(day) => month - 1 - day % month,
        None => month - today % month,
    });
    let (indoor, outdoor) = rent_tiles(world);
    Bills {
        month_days: bills.month_days + left as u32,
        indoor_tile_days: bills.indoor_tile_days + u64::from(indoor) * left,
        outdoor_tile_days: bills.outdoor_tile_days + u64::from(outdoor) * left,
        ..bills.clone()
    }
}

/// The next bills, each with its amount so far and expected, in payment
/// order. A bill expected to come to nothing is left out.
pub fn next_bills(world: &World) -> Vec<NextBill> {
    let Some((bills, pack, today)) = counted(world) else {
        return Vec::new();
    };
    let tuning = &pack.bills;
    let so_far = month_amounts(bills, tuning);
    let projected = expected_month(world, bills, tuning, today);
    let mut expected = month_amounts(&projected, tuning);
    // Usage at the larger of so far and last month: electricity and water
    // by what usage adds to each, transportation by trips.
    let (electricity, water) = usage_cents(bills, tuning);
    if let Some(previous) = bills.previous {
        expected[ELECTRICITY as usize] += (previous.electricity_cents - electricity).max(0);
        expected[WATER as usize] += (previous.water_cents - water).max(0);
        expected[TRANSPORTATION as usize] +=
            tuning.commute_cents * i64::from(previous.commutes.saturating_sub(bills.commutes));
    }
    (0..BILL_KINDS)
        .filter(|kind| expected[*kind as usize] > 0)
        .map(|kind| NextBill {
            kind,
            so_far_cents: so_far[kind as usize],
            expected_cents: expected[kind as usize],
        })
        .collect()
}

/// The lines of next bill `kind` so far, in the panel's order
/// ([WB-panel]).
pub fn lines(world: &World, kind: u8) -> Vec<Line> {
    let Some((bills, pack, _)) = counted(world) else {
        return Vec::new();
    };
    if kind >= BILL_KINDS {
        return Vec::new();
    }
    let tuning = &pack.bills;
    let month = i64::from(tuning.days_per_month);
    let days = i64::from(bills.month_days);
    let base = [
        tuning.rent_base_cents,
        tuning.electricity_base_cents,
        tuning.water_base_cents,
        tuning.transportation_base_cents,
    ][kind as usize];
    let mut out = vec![Line {
        line: LineKind::Base,
        kind_index: 0,
        count: bills.month_days.into(),
        unit_cents: base,
        amount_cents: ceil_div(base * days, month),
        tile_days: 0,
    }];
    match kind {
        RENT => {
            let (indoor, outdoor) = rent_tiles(world);
            let tiles = [
                (
                    LineKind::IndoorTiles,
                    indoor,
                    bills.indoor_tile_days,
                    tuning.rent_indoor_tile_cents,
                ),
                (
                    LineKind::OutdoorTiles,
                    outdoor,
                    bills.outdoor_tile_days,
                    tuning.rent_outdoor_tile_cents,
                ),
            ];
            // Rent rounds once over all its parts, so the base and tile
            // lines share that rounding and add up to it exactly.
            let numerators: Vec<i64> = std::iter::once(base * days)
                .chain(
                    tiles
                        .iter()
                        .map(|(_, _, tile_days, rate)| rate * *tile_days as i64),
                )
                .collect();
            let amounts = split_rounded(&numerators, month);
            out[0].amount_cents = amounts[0];
            for ((line, count, tile_days, rate), amount) in tiles.into_iter().zip(&amounts[1..]) {
                out.push(Line {
                    line,
                    kind_index: 0,
                    count: count.into(),
                    unit_cents: rate,
                    amount_cents: *amount,
                    tile_days,
                });
            }
        }
        ELECTRICITY | WATER => {
            for (line, counts, kinds) in [
                (LineKind::Use, &bills.uses, &tuning.uses),
                (LineKind::Daily, &bills.daily, &tuning.daily),
            ] {
                for (index, (count, kind_row)) in counts.iter().zip(kinds).enumerate() {
                    let unit = if kind == ELECTRICITY {
                        kind_row.electricity_cents
                    } else {
                        kind_row.water_cents
                    };
                    if *count > 0 && unit > 0 {
                        out.push(Line {
                            line,
                            kind_index: index as u16,
                            count: (*count).into(),
                            unit_cents: unit,
                            amount_cents: i64::from(*count) * unit,
                            tile_days: 0,
                        });
                    }
                }
            }
        }
        _ => out.push(Line {
            line: LineKind::Trips,
            kind_index: 0,
            count: bills.commutes.into(),
            unit_cents: tuning.commute_cents,
            amount_cents: tuning.commute_cents * i64::from(bills.commutes),
            tile_days: 0,
        }),
    }
    out
}

/// The overdue bills, oldest first ([WB-panel]).
pub fn overdue_bills(world: &World) -> Vec<Bill> {
    let Some((bills, pack, today)) = counted(world) else {
        return Vec::new();
    };
    bills
        .bills
        .iter()
        .filter(|bill| bill.overdue_on(today, pack.bills.grace_days))
        .copied()
        .collect()
}

/// The bills of the last issued month, paid or not ([WB-panel]).
pub fn last_month(world: &World) -> Vec<Bill> {
    let Some((bills, _, _)) = counted(world) else {
        return Vec::new();
    };
    let Some(last) = bills.bills.iter().map(|bill| bill.due_day).max() else {
        return Vec::new();
    };
    bills
        .bills
        .iter()
        .filter(|bill| bill.due_day == last)
        .copied()
        .collect()
}

/// The household status panel's numbers ([WB-panel]); `None` in a world
/// without a lot, where there are no bills.
pub fn overview(world: &World) -> Option<Overview> {
    let (bills, pack, today) = counted(world)?;
    let tuning = &pack.bills;
    let funds_cents = world.resource::<Funds>().0;
    let unpaid: i64 = bills
        .bills
        .iter()
        .filter(|bill| bill.paid_day.is_none())
        .map(Bill::total_cents)
        .sum();
    let expected: i64 = next_bills(world)
        .iter()
        .map(|bill| bill.expected_cents)
        .sum();
    let overdue = overdue_bills(world);
    let keep_aside_cents = unpaid + expected;
    let month = tuning.days_per_month;
    Some(Overview {
        funds_cents,
        keep_aside_cents,
        shortfall_cents: (keep_aside_cents - funds_cents.max(0)).max(0),
        next_due_day: today - today % month + month,
        overdue_cents: overdue.iter().map(|bill| bill.amount_cents).sum(),
        overdue_fee_cents: overdue.iter().map(|bill| bill.late_fee_cents).sum(),
        days_per_month: month,
        grace_days: tuning.grace_days,
        late_fee_percent: tuning.late_fee_percent,
        late_fee_cap_percent: tuning.late_fee_cap_percent,
        month_days: bills.month_days,
    })
}

#[cfg(test)]
#[path = "bills_tests.rs"]
mod tests;
