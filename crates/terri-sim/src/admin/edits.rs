//! Every edit's checks against the world, its write and the post-condition
//! ([AP-cmd-drain] items 2 to 4). The edits are grouped by the tab that
//! sends them: the housemate's own state and career, relationships, and the
//! household's money. Each group owns its variants' refusals and writes; this
//! module only routes and gathers what a change touched for the
//! post-condition.
use super::*;
use std::collections::BTreeSet;

/// Which group of edits owns a variant.
enum Group {
    Housemate,
    Relationships,
    Household,
    Career,
}

fn group(edit: &AdminEdit) -> Group {
    match edit {
        AdminEdit::SetNeed { .. }
        | AdminEdit::SetSatisfaction { .. }
        | AdminEdit::SetRepetition { .. }
        | AdminEdit::EndTimedMoodlet { .. }
        | AdminEdit::SetAffinity { .. }
        | AdminEdit::SetSkillPractice { .. }
        | AdminEdit::SetTraitState { .. }
        | AdminEdit::AddTrait { .. }
        | AdminEdit::RemoveTrait { .. } => Group::Housemate,
        AdminEdit::SetFeeling { .. } | AdminEdit::StartFight { .. } => Group::Relationships,
        AdminEdit::SetFunds { .. }
        | AdminEdit::AdjustFunds { .. }
        | AdminEdit::SetBill { .. }
        | AdminEdit::MoveBill { .. }
        | AdminEdit::PayBill { .. }
        | AdminEdit::MarkBillPaid { .. }
        | AdminEdit::DeleteBill { .. }
        | AdminEdit::AddBill { .. } => Group::Household,
        AdminEdit::SetJob { .. }
        | AdminEdit::SetShift { .. }
        | AdminEdit::SetPay { .. }
        | AdminEdit::SetJobSatisfaction { .. }
        | AdminEdit::SetGoodWeeks { .. }
        | AdminEdit::SetPoorWeeks { .. }
        | AdminEdit::SetJobSearch { .. } => Group::Career,
    }
}

pub(super) fn validate(world: &World, edit: &AdminEdit) -> Result<(), AdminRefusal> {
    match group(edit) {
        Group::Housemate => super::housemate::validate(world, edit),
        Group::Relationships => super::relationships::validate(world, edit),
        Group::Household => super::household::validate(world, edit),
        Group::Career => super::career::validate(world, edit),
    }
}

/// Writes one validated edit. Only an edit that passed [`validate`] against
/// the world as the change began is applied, and no two edits of a change
/// share a unit, so the validation still holds when its turn comes.
pub(super) fn apply(world: &mut World, edit: &AdminEdit) {
    match group(edit) {
        Group::Housemate => super::housemate::apply(world, edit),
        Group::Relationships => super::relationships::apply(world, edit),
        Group::Household => super::household::apply(world, edit),
        Group::Career => super::career::apply(world, edit),
    }
}

/// What a change touched, so the post-condition checks exactly that.
#[derive(Default)]
pub(super) struct Touched {
    /// People whose needs, satisfaction, repetition, feelings, affinities,
    /// skills or traits changed, by `SimId`.
    pub(super) people: BTreeSet<u32>,
    /// A timed moodlet was ended.
    pub(super) timers: bool,
    pub(super) funds: bool,
    pub(super) bills: bool,
    /// People whose career changed, by `SimId`.
    pub(super) careers: BTreeSet<u32>,
}

fn touched(edits: &[AdminEdit]) -> Touched {
    let mut touched = Touched::default();
    for edit in edits {
        match *edit {
            AdminEdit::SetNeed { sim, .. }
            | AdminEdit::SetSatisfaction { sim, .. }
            | AdminEdit::SetRepetition { sim, .. }
            | AdminEdit::SetAffinity { sim, .. }
            | AdminEdit::SetSkillPractice { sim, .. }
            | AdminEdit::SetTraitState { sim, .. }
            | AdminEdit::AddTrait { sim, .. }
            | AdminEdit::RemoveTrait { sim, .. } => {
                touched.people.insert(sim);
            }
            AdminEdit::EndTimedMoodlet { .. } => touched.timers = true,
            AdminEdit::SetFeeling { from, .. } => {
                touched.people.insert(from);
            }
            AdminEdit::SetFunds { .. } | AdminEdit::AdjustFunds { .. } => touched.funds = true,
            AdminEdit::SetBill { .. }
            | AdminEdit::MoveBill { .. }
            | AdminEdit::MarkBillPaid { .. }
            | AdminEdit::DeleteBill { .. }
            | AdminEdit::AddBill { .. } => touched.bills = true,
            AdminEdit::PayBill { .. } => {
                touched.bills = true;
                touched.funds = true;
            }
            // A job or shift change settles an open shift, which pays it,
            // drains energy, rewards satisfaction and counts a trip for the
            // bills.
            AdminEdit::SetJob { sim, .. } | AdminEdit::SetShift { sim, .. } => {
                touched.careers.insert(sim);
                touched.people.insert(sim);
                touched.funds = true;
                touched.bills = true;
            }
            AdminEdit::SetPay { sim, .. }
            | AdminEdit::SetJobSatisfaction { sim, .. }
            | AdminEdit::SetGoodWeeks { sim, .. }
            | AdminEdit::SetPoorWeeks { sim, .. }
            | AdminEdit::SetJobSearch { sim, .. } => {
                touched.careers.insert(sim);
            }
            // A fight order waits in the queue; nothing it touches is saved
            // state the loader checks beyond the queue's own rules.
            AdminEdit::StartFight { .. } => {}
        }
    }
    touched
}

/// [AP-cmd-post]: the result must load. Runs the load validator of each
/// kind of state the change touched, on the live values, then schema
/// twenty-seven's need mood checks on every person: no edit writes that
/// balance, but a need edit changes what it accrues next, so the rows a save
/// would write are held to the loader's rules after every change. Schema
/// thirty-one's remembered topic preferences are held to them the same way.
pub(super) fn post_condition(world: &World, edits: &[AdminEdit]) -> Result<(), ()> {
    let touched = touched(edits);
    super::housemate::post_condition(world, &touched)?;
    super::career::post_condition(world, &touched)?;
    super::household::post_condition(world, &touched)?;
    crate::save::v27::validate_live(world).map_err(|_| ())?;
    crate::save::v31::validate_live(world).map_err(|_| ())?;
    #[cfg(test)]
    super::tests_stub::post_condition(world, edits)?;
    Ok(())
}
