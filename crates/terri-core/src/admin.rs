//! The admin panel's command (issue 312, [AP-command] in
//! `docs/specs/2026-11-20-admin-panel.md`).
//!
//! One [`AdminChange`] is one player action in the panel and one Undo step:
//! a list of [`AdminEdit`]s applied together or not at all. It travels as
//! `SimCommand::Admin`, wire code 41, but it never sits in a saved queue:
//! the only path that stages one drains it in the same call ([AP-save-queue]).
//! Every edit names people by `SimId`, never by entity index, so a journal
//! of changes survives the world restore that Undo performs.
//!
//! **The variant order and the field order are wire format**, as for
//! `SimCommand`: variants are appended only at the end and fields only
//! after the last field. `crates/terri-core/tests/admin_wire.rs` pins every
//! code with a golden vector shared with the web codec.

use serde::{Deserialize, Serialize};

/// The most edits one change may hold: a representational bound, not
/// tuning, enough for "set every feeling to 0" in the largest household.
pub const MAX_ADMIN_EDITS: usize = 1024;

/// The most cents any admin funds, amount or fee value may name in either
/// direction: the bill loader's own ceiling, so dollars times 100 can never
/// overflow at load.
pub const MAX_ADMIN_FUNDS_CENTS: i64 = 1_000_000_000_000;

/// How many timed moodlet timers `EndTimedMoodlet` can name: 0 burnt
/// dinner, 1 had a fight, 2 promoted, 3 got a raise, 4 demoted, 5 fired.
pub const ADMIN_TIMER_COUNT: u8 = 6;

/// How many bill kinds a bill edit can name. Equal to `bills::BILL_KINDS`
/// in `terri-sim`, which a test there checks.
pub const ADMIN_BILL_KINDS: u8 = 4;

/// One player action in the admin panel: every edit applies, or none does.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct AdminChange {
    pub edits: Vec<AdminEdit>,
}

/// One edit of the world. The comment on each variant is its wire code.
/// Indices into content (`object`, `row`, `kind`, `skill`, `trait_index`,
/// `job`, `shift`) are safe because an admin command never outlives the
/// session that sent it.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum AdminEdit {
    /// 0. `need` is the `NeedId` order.
    SetNeed { sim: u32, need: u8, value: f32 },
    /// 1.
    SetSatisfaction { sim: u32, value: f32 },
    /// 2. `object` is the pack's object definition index, `row` the
    /// flyout action row.
    SetRepetition {
        sim: u32,
        object: u32,
        row: u32,
        value: f32,
    },
    /// 3. `timer` as [`ADMIN_TIMER_COUNT`] lists them.
    EndTimedMoodlet { sim: u32, timer: u8 },
    /// 4. `kind` is the pack's affinity index.
    SetAffinity { sim: u32, kind: u32, value: f32 },
    /// 5. `skill` is the pack's skill index.
    SetSkillPractice { sim: u32, skill: u32, practice: f32 },
    /// 6.
    SetTraitState {
        sim: u32,
        trait_index: u32,
        state: f32,
    },
    /// 7.
    AddTrait { sim: u32, trait_index: u32 },
    /// 8.
    RemoveTrait { sim: u32, trait_index: u32 },
    /// 9. `job` is a career row, `None` no job; `shift` an index into that
    /// row's shifts.
    SetJob {
        sim: u32,
        job: Option<u32>,
        shift: u32,
    },
    /// 10.
    SetShift { sim: u32, shift: u32 },
    /// 11.
    SetPay { sim: u32, dollars: u32 },
    /// 12.
    SetJobSatisfaction { sim: u32, value: f32 },
    /// 13.
    SetGoodWeeks { sim: u32, weeks: u32 },
    /// 14.
    SetPoorWeeks { sim: u32, weeks: u32 },
    /// 15.
    SetJobSearch { sim: u32, on: bool },
    /// 16. How `from` feels about `to`.
    SetFeeling { from: u32, to: u32, value: f32 },
    /// 17.
    StartFight { from: u32, to: u32 },
    /// 18.
    SetFunds { cents: i64 },
    /// 19.
    AdjustFunds { cents: i64 },
    /// 20.
    SetBill {
        due_day: u32,
        kind: u8,
        amount_cents: i64,
        late_fee_cents: i64,
    },
    /// 21.
    MoveBill {
        due_day: u32,
        kind: u8,
        to_due_day: u32,
    },
    /// 22.
    PayBill { due_day: u32, kind: u8 },
    /// 23.
    MarkBillPaid { due_day: u32, kind: u8 },
    /// 24.
    DeleteBill { due_day: u32, kind: u8 },
    /// 25.
    AddBill {
        due_day: u32,
        kind: u8,
        amount_cents: i64,
        late_fee_cents: i64,
    },
}

/// Why a change was refused at admission, before the world was consulted
/// ([AP-cmd-admit]). `edit` is the index of the first offending edit.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AdminStructureError {
    /// No edits at all.
    Empty,
    /// More than [`MAX_ADMIN_EDITS`] edits.
    TooManyEdits,
    /// A value that is not finite.
    NotFinite { edit: u32 },
    /// A value outside its static range.
    OutOfRange { edit: u32 },
    /// A need, timer or bill kind code that does not exist.
    UnknownCode { edit: u32 },
    /// An edit touching a unit an earlier edit of the change touches.
    Overlap { edit: u32 },
}

/// What one edit touches. No two edits of one change may share a unit, so
/// validating every edit against the world before applying any is exact.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
enum Unit {
    Need(u32, u8),
    Satisfaction(u32),
    Repetition(u32, u32, u32),
    Timer(u32, u8),
    Affinity(u32, u32),
    /// The person's skills: practice edits, and trait edits because adding
    /// a capability raises practice.
    Skills(u32),
    Traits(u32),
    Career(u32),
    Feeling(u32, u32),
    Fight(u32),
    Funds,
    Bill(u32, u8),
}

impl AdminEdit {
    /// The wire code of this edit, as the variant comments list.
    pub fn code(&self) -> u8 {
        match self {
            Self::SetNeed { .. } => 0,
            Self::SetSatisfaction { .. } => 1,
            Self::SetRepetition { .. } => 2,
            Self::EndTimedMoodlet { .. } => 3,
            Self::SetAffinity { .. } => 4,
            Self::SetSkillPractice { .. } => 5,
            Self::SetTraitState { .. } => 6,
            Self::AddTrait { .. } => 7,
            Self::RemoveTrait { .. } => 8,
            Self::SetJob { .. } => 9,
            Self::SetShift { .. } => 10,
            Self::SetPay { .. } => 11,
            Self::SetJobSatisfaction { .. } => 12,
            Self::SetGoodWeeks { .. } => 13,
            Self::SetPoorWeeks { .. } => 14,
            Self::SetJobSearch { .. } => 15,
            Self::SetFeeling { .. } => 16,
            Self::StartFight { .. } => 17,
            Self::SetFunds { .. } => 18,
            Self::AdjustFunds { .. } => 19,
            Self::SetBill { .. } => 20,
            Self::MoveBill { .. } => 21,
            Self::PayBill { .. } => 22,
            Self::MarkBillPaid { .. } => 23,
            Self::DeleteBill { .. } => 24,
            Self::AddBill { .. } => 25,
        }
    }

    /// The edit as its code followed by every field in declaration order,
    /// each as a `u64`: an `f32` by `to_bits`, an `i64` as its two's
    /// complement, a `bool` as 0 or 1, an `Option` as 0, or 1 then the
    /// value. The code fixes the layout, so the words name the edit exactly:
    /// equality and the queue hash both read them.
    pub fn words(&self) -> Vec<u64> {
        let f = |value: f32| u64::from(value.to_bits());
        let i = |value: i64| value as u64;
        let u = u64::from;
        let mut words = vec![u64::from(self.code())];
        match *self {
            Self::SetNeed { sim, need, value } => words.extend([u(sim), u64::from(need), f(value)]),
            Self::SetSatisfaction { sim, value } | Self::SetJobSatisfaction { sim, value } => {
                words.extend([u(sim), f(value)])
            }
            Self::SetRepetition {
                sim,
                object,
                row,
                value,
            } => words.extend([u(sim), u(object), u(row), f(value)]),
            Self::EndTimedMoodlet { sim, timer } => words.extend([u(sim), u64::from(timer)]),
            Self::SetAffinity { sim, kind, value } => words.extend([u(sim), u(kind), f(value)]),
            Self::SetSkillPractice {
                sim,
                skill,
                practice,
            } => words.extend([u(sim), u(skill), f(practice)]),
            Self::SetTraitState {
                sim,
                trait_index,
                state,
            } => words.extend([u(sim), u(trait_index), f(state)]),
            Self::AddTrait { sim, trait_index } | Self::RemoveTrait { sim, trait_index } => {
                words.extend([u(sim), u(trait_index)])
            }
            Self::SetJob { sim, job, shift } => {
                words.push(u(sim));
                match job {
                    Some(job) => words.extend([1, u(job)]),
                    None => words.push(0),
                }
                words.push(u(shift));
            }
            Self::SetShift { sim, shift } => words.extend([u(sim), u(shift)]),
            Self::SetPay { sim, dollars } => words.extend([u(sim), u(dollars)]),
            Self::SetGoodWeeks { sim, weeks } | Self::SetPoorWeeks { sim, weeks } => {
                words.extend([u(sim), u(weeks)])
            }
            Self::SetJobSearch { sim, on } => words.extend([u(sim), u64::from(on)]),
            Self::SetFeeling { from, to, value } => words.extend([u(from), u(to), f(value)]),
            Self::StartFight { from, to } => words.extend([u(from), u(to)]),
            Self::SetFunds { cents } | Self::AdjustFunds { cents } => words.push(i(cents)),
            Self::SetBill {
                due_day,
                kind,
                amount_cents,
                late_fee_cents,
            }
            | Self::AddBill {
                due_day,
                kind,
                amount_cents,
                late_fee_cents,
            } => words.extend([
                u(due_day),
                u64::from(kind),
                i(amount_cents),
                i(late_fee_cents),
            ]),
            Self::MoveBill {
                due_day,
                kind,
                to_due_day,
            } => words.extend([u(due_day), u64::from(kind), u(to_due_day)]),
            Self::PayBill { due_day, kind }
            | Self::MarkBillPaid { due_day, kind }
            | Self::DeleteBill { due_day, kind } => words.extend([u(due_day), u64::from(kind)]),
        }
        words
    }

    /// The units this edit touches, at most two.
    fn units(&self) -> [Option<Unit>; 2] {
        match *self {
            Self::SetNeed { sim, need, .. } => [Some(Unit::Need(sim, need)), None],
            Self::SetSatisfaction { sim, .. } => [Some(Unit::Satisfaction(sim)), None],
            Self::SetRepetition {
                sim, object, row, ..
            } => [Some(Unit::Repetition(sim, object, row)), None],
            Self::EndTimedMoodlet { sim, timer } => [Some(Unit::Timer(sim, timer)), None],
            Self::SetAffinity { sim, kind, .. } => [Some(Unit::Affinity(sim, kind)), None],
            Self::SetSkillPractice { sim, .. } => [Some(Unit::Skills(sim)), None],
            Self::SetTraitState { sim, .. }
            | Self::AddTrait { sim, .. }
            | Self::RemoveTrait { sim, .. } => [Some(Unit::Traits(sim)), Some(Unit::Skills(sim))],
            Self::SetJob { sim, .. }
            | Self::SetShift { sim, .. }
            | Self::SetPay { sim, .. }
            | Self::SetJobSatisfaction { sim, .. }
            | Self::SetGoodWeeks { sim, .. }
            | Self::SetPoorWeeks { sim, .. }
            | Self::SetJobSearch { sim, .. } => [Some(Unit::Career(sim)), None],
            Self::SetFeeling { from, to, .. } => [Some(Unit::Feeling(from, to)), None],
            Self::StartFight { from, .. } => [Some(Unit::Fight(from)), None],
            Self::SetFunds { .. } | Self::AdjustFunds { .. } => [Some(Unit::Funds), None],
            Self::SetBill { due_day, kind, .. }
            | Self::MarkBillPaid { due_day, kind }
            | Self::DeleteBill { due_day, kind }
            | Self::AddBill { due_day, kind, .. } => [Some(Unit::Bill(due_day, kind)), None],
            // Paying from funds changes the funds too, so it may not share a
            // change with a funds edit whose result it would have to read.
            Self::PayBill { due_day, kind } => [Some(Unit::Bill(due_day, kind)), Some(Unit::Funds)],
            Self::MoveBill {
                due_day,
                kind,
                to_due_day,
            } => [
                Some(Unit::Bill(due_day, kind)),
                Some(Unit::Bill(to_due_day, kind)),
            ],
        }
    }

    /// The static checks of one edit: finite values in their ranges and
    /// known codes. Nothing here reads the world.
    fn validate_values(&self, edit: u32) -> Result<(), AdminStructureError> {
        let finite_within = |value: f32, low: f32, high: f32| {
            if !value.is_finite() {
                Err(AdminStructureError::NotFinite { edit })
            } else if !(low..=high).contains(&value) {
                Err(AdminStructureError::OutOfRange { edit })
            } else {
                Ok(())
            }
        };
        let cents_within = |cents: i64, low: i64| {
            if (low..=MAX_ADMIN_FUNDS_CENTS).contains(&cents) {
                Ok(())
            } else {
                Err(AdminStructureError::OutOfRange { edit })
            }
        };
        let bill_kind = |kind: u8| {
            if kind < ADMIN_BILL_KINDS {
                Ok(())
            } else {
                Err(AdminStructureError::UnknownCode { edit })
            }
        };
        match *self {
            Self::SetNeed { need, value, .. } => {
                if usize::from(need) >= crate::NEED_COUNT {
                    return Err(AdminStructureError::UnknownCode { edit });
                }
                finite_within(value, crate::NEED_MIN, crate::NEED_MAX)
            }
            Self::SetSatisfaction { value, .. } | Self::SetJobSatisfaction { value, .. } => {
                finite_within(value, 0.0, 100.0)
            }
            Self::SetRepetition { value, .. } => finite_within(value, 0.0, f32::MAX),
            Self::EndTimedMoodlet { timer, .. } => {
                if timer < ADMIN_TIMER_COUNT {
                    Ok(())
                } else {
                    Err(AdminStructureError::UnknownCode { edit })
                }
            }
            Self::SetAffinity { value, .. } | Self::SetFeeling { value, .. } => {
                finite_within(value, -1.0, 1.0)
            }
            Self::SetSkillPractice { practice, .. } => finite_within(practice, 0.0, f32::MAX),
            Self::SetTraitState { state, .. } => finite_within(state, 0.0, 1.0),
            Self::AddTrait { .. }
            | Self::RemoveTrait { .. }
            | Self::SetJob { .. }
            | Self::SetShift { .. }
            | Self::SetPay { .. }
            | Self::SetGoodWeeks { .. }
            | Self::SetPoorWeeks { .. }
            | Self::SetJobSearch { .. }
            | Self::StartFight { .. } => Ok(()),
            Self::SetFunds { cents } | Self::AdjustFunds { cents } => {
                cents_within(cents, -MAX_ADMIN_FUNDS_CENTS)
            }
            Self::SetBill {
                kind,
                amount_cents,
                late_fee_cents,
                ..
            }
            | Self::AddBill {
                kind,
                amount_cents,
                late_fee_cents,
                ..
            } => {
                bill_kind(kind)?;
                cents_within(amount_cents, 1)?;
                cents_within(late_fee_cents, 0)
            }
            Self::MoveBill { kind, .. }
            | Self::PayBill { kind, .. }
            | Self::MarkBillPaid { kind, .. }
            | Self::DeleteBill { kind, .. } => bill_kind(kind),
        }
    }
}

impl PartialEq for AdminEdit {
    /// Two edits are equal when their words are: every float compared by
    /// its bits, so equality is reflexive even for a value admission would
    /// refuse, which is what makes `Eq` sound.
    fn eq(&self, other: &Self) -> bool {
        self.words() == other.words()
    }
}

impl Eq for AdminEdit {}

impl AdminChange {
    /// [AP-cmd-admit]: every check that does not depend on the world. One
    /// to [`MAX_ADMIN_EDITS`] edits, every value finite and inside its
    /// static range, every code known, and no two edits touching one unit.
    /// The first failure in edit order is reported.
    pub fn validate_structure(&self) -> Result<(), AdminStructureError> {
        if self.edits.is_empty() {
            return Err(AdminStructureError::Empty);
        }
        if self.edits.len() > MAX_ADMIN_EDITS {
            return Err(AdminStructureError::TooManyEdits);
        }
        let mut touched: Vec<Unit> = Vec::with_capacity(self.edits.len() * 2);
        for (index, edit) in self.edits.iter().enumerate() {
            let index = index as u32;
            edit.validate_values(index)?;
            for unit in edit.units().into_iter().flatten() {
                if touched.contains(&unit) {
                    return Err(AdminStructureError::Overlap { edit: index });
                }
                touched.push(unit);
            }
        }
        Ok(())
    }

    /// The change as the queue hash writes it: the edit count, then each
    /// edit's [`AdminEdit::words`].
    pub fn hash_words(&self) -> Vec<u64> {
        let mut words = vec![self.edits.len() as u64];
        for edit in &self.edits {
            words.extend(edit.words());
        }
        words
    }
}

#[cfg(test)]
mod tests;
