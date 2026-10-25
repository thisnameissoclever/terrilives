//! The BILLS section of the trace: each issued month's four bills, the
//! month's counted use, its trips, when each bill was paid, late fees and
//! the household's income, for the calibration bands of [WB-numbers] in
//! `docs/specs/2026-10-18-wages-and-bills.md`.
use terri_core::{Funds, SimClock};
use terri_sim::bills::{Bill, Bills, BILL_KINDS};
use terri_sim::Sim;

const NAMES: [&str; 4] = ["rent", "electricity", "water", "transportation"];

/// One issued month: its bills as issued, the counts that produced them and
/// the income earned while it ran.
struct Month {
    due_day: u32,
    bills: Vec<Bill>,
    uses: Vec<u32>,
    daily: Vec<u32>,
    commutes: u32,
    days: u32,
    income_cents: i64,
}

pub struct Summary {
    months: Vec<Month>,
    /// The record as it stood after the previous tick: the closing month's
    /// counts are still in it on the tick that issues the bills.
    previous: Bills,
    funds: i64,
    /// Income earned in the month now running, credited to its bills when
    /// they are issued.
    running_income: i64,
}

impl Summary {
    pub fn new(sim: &Sim) -> Self {
        Self {
            months: Vec::new(),
            previous: sim.world().resource::<Bills>().clone(),
            funds: sim.world().resource::<Funds>().0,
            running_income: 0,
        }
    }

    pub fn observe(&mut self, sim: &Sim) {
        let world = sim.world();
        let now = world.resource::<Bills>().clone();
        let funds = world.resource::<Funds>().0;
        // Bills paid this tick took money the delta hides: add them back, so
        // a shift settling on a payment tick still counts as income.
        let paid: i64 = now
            .bills
            .iter()
            .filter(|bill| bill.paid_day.is_some())
            .filter(|bill| {
                !self.previous.bills.iter().any(|old| {
                    old.due_day == bill.due_day && old.kind == bill.kind && old.paid_day.is_some()
                })
            })
            .map(Bill::total_cents)
            .sum();
        let earned = funds - self.funds + paid;
        if earned > 0 {
            self.running_income += earned;
        }
        self.funds = funds;
        // A month is issued on the tick its due day first appears.
        let issued = now
            .bills
            .iter()
            .map(|bill| bill.due_day)
            .max()
            .filter(|day| !self.previous.bills.iter().any(|old| old.due_day == *day));
        if let Some(due_day) = issued {
            self.months.push(Month {
                due_day,
                bills: now
                    .bills
                    .iter()
                    .filter(|bill| bill.due_day == due_day)
                    .copied()
                    .collect(),
                uses: self.previous.uses.clone(),
                daily: self.previous.daily.clone(),
                commutes: self.previous.commutes,
                days: self.previous.month_days,
                income_cents: self.running_income,
            });
            self.running_income = 0;
        }
        for month in &mut self.months {
            for bill in &mut month.bills {
                if let Some(current) = now
                    .bills
                    .iter()
                    .find(|b| b.due_day == bill.due_day && b.kind == bill.kind)
                {
                    *bill = *current;
                }
            }
        }
        self.previous = now;
    }

    pub fn print(&self, sim: &Sim) {
        let pack = sim.world().resource::<terri_sim::Content>().0;
        let tuning = &pack.bills;
        let day_ticks = u64::from(pack.tuning.day_ticks);
        let today = (sim.world().resource::<SimClock>().tick / day_ticks) as u32;
        println!(
            "\nBILLS {} issued months; today is day index {today}",
            self.months.len()
        );
        let base = [
            tuning.rent_base_cents,
            tuning.electricity_base_cents,
            tuning.water_base_cents,
            tuning.transportation_base_cents,
        ];
        let mut shares = Vec::new();
        for month in &self.months {
            println!(
                "  month due day {} ({} days counted): income ${:.2}",
                month.due_day,
                month.days,
                month.income_cents as f64 / 100.0
            );
            let mut total = 0;
            for kind in 0..BILL_KINDS {
                let Some(bill) = month.bills.iter().find(|bill| bill.kind == kind) else {
                    println!("    {:<14} none", NAMES[kind as usize]);
                    continue;
                };
                total += bill.amount_cents;
                let paid = bill.paid_day.map_or_else(
                    || "unpaid".to_string(),
                    |day| format!("paid day {day} ({} after due)", day - bill.due_day),
                );
                let base_share =
                    base[kind as usize] * i64::from(month.days) / i64::from(tuning.days_per_month);
                let usage = (bill.amount_cents - base_share).max(0);
                println!(
                    "    {:<14} ${:>8.2}  late fees ${:.2}  {paid}  usage ${:.2} ({:.0}%)",
                    NAMES[kind as usize],
                    bill.amount_cents as f64 / 100.0,
                    bill.late_fee_cents as f64 / 100.0,
                    usage as f64 / 100.0,
                    100.0 * usage as f64 / bill.amount_cents.max(1) as f64
                );
            }
            let share = 100.0 * total as f64 / month.income_cents.max(1) as f64;
            shares.push(share);
            println!(
                "    total ${:.2}, {share:.1}% of the month's income",
                total as f64 / 100.0
            );
            let uses: Vec<String> = tuning
                .uses
                .iter()
                .zip(month.uses.iter().chain(std::iter::repeat(&0)))
                .map(|(kind, count)| format!("{} {count}", kind.id))
                .collect();
            let daily: Vec<String> = tuning
                .daily
                .iter()
                .zip(month.daily.iter().chain(std::iter::repeat(&0)))
                .map(|(kind, count)| format!("{} {count}", kind.id))
                .collect();
            println!("    uses: {}", uses.join(", "));
            println!("    object-days: {}", daily.join(", "));
            println!("    trips: {}", month.commutes);
        }
        if !shares.is_empty() {
            let mean = shares.iter().sum::<f64>() / shares.len() as f64;
            println!(
                "  mean share of income {mean:.1}% over {} months",
                shares.len()
            );
        }
        let bills = sim.world().resource::<Bills>();
        println!(
            "  open month: {} days counted, trips {}, overdue now {}",
            bills.month_days,
            bills.commutes,
            terri_sim::bills::any_overdue(sim.world())
        );
    }
}
