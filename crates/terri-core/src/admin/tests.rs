//! [AP-tests-core] item 2: every structural refusal of [AP-cmd-admit].

use super::*;
use AdminEdit::*;

fn change(edits: Vec<AdminEdit>) -> AdminChange {
    AdminChange { edits }
}

fn check(edits: Vec<AdminEdit>) -> Result<(), AdminStructureError> {
    change(edits).validate_structure()
}

/// One valid edit of every code, each touching its own units, so the whole
/// list is a valid change and any single refusal below is the one tested
/// ([L-guard-mutations-need-isolation]).
fn one_of_each() -> Vec<AdminEdit> {
    vec![
        SetNeed {
            sim: 1,
            need: 0,
            value: 50.0,
        },
        SetSatisfaction {
            sim: 1,
            value: 50.0,
        },
        SetRepetition {
            sim: 1,
            object: 0,
            row: 0,
            value: 1.0,
        },
        EndTimedMoodlet { sim: 1, timer: 0 },
        SetAffinity {
            sim: 1,
            kind: 0,
            value: 0.5,
        },
        SetSkillPractice {
            sim: 1,
            skill: 0,
            practice: 2.0,
        },
        SetTraitState {
            sim: 2,
            trait_index: 0,
            state: 0.5,
        },
        AddTrait {
            sim: 3,
            trait_index: 1,
        },
        RemoveTrait {
            sim: 4,
            trait_index: 2,
        },
        SetJob {
            sim: 1,
            job: Some(0),
            shift: 0,
        },
        SetShift { sim: 2, shift: 1 },
        SetPay {
            sim: 3,
            dollars: 100,
        },
        SetJobSatisfaction {
            sim: 4,
            value: 50.0,
        },
        SetGoodWeeks { sim: 5, weeks: 1 },
        SetPoorWeeks { sim: 6, weeks: 1 },
        SetJobSearch { sim: 7, on: true },
        SetFeeling {
            from: 1,
            to: 2,
            value: 0.5,
        },
        StartFight { from: 1, to: 2 },
        SetFunds { cents: 100 },
        SetBill {
            due_day: 0,
            kind: 0,
            amount_cents: 100,
            late_fee_cents: 0,
        },
        MoveBill {
            due_day: 0,
            kind: 1,
            to_due_day: 28,
        },
        MarkBillPaid {
            due_day: 0,
            kind: 2,
        },
        DeleteBill {
            due_day: 0,
            kind: 3,
        },
        AddBill {
            due_day: 56,
            kind: 0,
            amount_cents: 100,
            late_fee_cents: 0,
        },
    ]
}

#[test]
fn a_valid_change_of_every_kind_is_admitted() {
    assert_eq!(check(one_of_each()), Ok(()));
    assert_eq!(check(vec![AdjustFunds { cents: -5 }]), Ok(()));
    assert_eq!(
        check(vec![PayBill {
            due_day: 0,
            kind: 0
        }]),
        Ok(())
    );
}

#[test]
fn an_empty_or_oversized_change_is_refused() {
    assert_eq!(check(Vec::new()), Err(AdminStructureError::Empty));
    let feelings = |count: u32| -> Vec<AdminEdit> {
        (0..count)
            .map(|to| SetFeeling {
                from: 0,
                to: to + 1,
                value: 0.0,
            })
            .collect()
    };
    assert_eq!(check(feelings(MAX_ADMIN_EDITS as u32)), Ok(()));
    assert_eq!(
        check(feelings(MAX_ADMIN_EDITS as u32 + 1)),
        Err(AdminStructureError::TooManyEdits)
    );
}

/// Every float field refuses NaN and both infinities, at the index of the
/// edit that holds it, after an earlier valid edit.
#[test]
fn every_float_field_must_be_finite() {
    let with = |value: f32| -> Vec<AdminEdit> {
        vec![
            SetNeed {
                sim: 1,
                need: 0,
                value,
            },
            SetSatisfaction { sim: 1, value },
            SetRepetition {
                sim: 1,
                object: 0,
                row: 0,
                value,
            },
            SetAffinity {
                sim: 1,
                kind: 0,
                value,
            },
            SetSkillPractice {
                sim: 1,
                skill: 0,
                practice: value,
            },
            SetTraitState {
                sim: 1,
                trait_index: 0,
                state: value,
            },
            SetJobSatisfaction { sim: 1, value },
            SetFeeling {
                from: 1,
                to: 2,
                value,
            },
        ]
    };
    for bad in [f32::NAN, f32::INFINITY, f32::NEG_INFINITY] {
        for edit in with(bad) {
            let edits = vec![SetFunds { cents: 0 }, edit.clone()];
            assert_eq!(
                check(edits),
                Err(AdminStructureError::NotFinite { edit: 1 }),
                "{edit:?}"
            );
        }
    }
}

#[test]
fn static_ranges_hold_at_both_ends() {
    let out = |edit: AdminEdit| {
        assert_eq!(
            check(vec![edit.clone()]),
            Err(AdminStructureError::OutOfRange { edit: 0 }),
            "{edit:?}"
        )
    };
    let fine = |edit: AdminEdit| assert_eq!(check(vec![edit.clone()]), Ok(()), "{edit:?}");
    for value in [0.0, 100.0] {
        fine(SetNeed {
            sim: 1,
            need: 3,
            value,
        });
        fine(SetSatisfaction { sim: 1, value });
        fine(SetJobSatisfaction { sim: 1, value });
    }
    for value in [-0.01, 100.01] {
        out(SetNeed {
            sim: 1,
            need: 3,
            value,
        });
        out(SetSatisfaction { sim: 1, value });
        out(SetJobSatisfaction { sim: 1, value });
    }
    for value in [-1.0, 1.0] {
        fine(SetAffinity {
            sim: 1,
            kind: 0,
            value,
        });
        fine(SetFeeling {
            from: 1,
            to: 2,
            value,
        });
    }
    for value in [-1.01, 1.01] {
        out(SetAffinity {
            sim: 1,
            kind: 0,
            value,
        });
        out(SetFeeling {
            from: 1,
            to: 2,
            value,
        });
    }
    for state in [0.0, 1.0] {
        fine(SetTraitState {
            sim: 1,
            trait_index: 0,
            state,
        });
    }
    for state in [-0.01, 1.01] {
        out(SetTraitState {
            sim: 1,
            trait_index: 0,
            state,
        });
    }
    fine(SetRepetition {
        sim: 1,
        object: 0,
        row: 0,
        value: 0.0,
    });
    out(SetRepetition {
        sim: 1,
        object: 0,
        row: 0,
        value: -0.01,
    });
    fine(SetSkillPractice {
        sim: 1,
        skill: 0,
        practice: 0.0,
    });
    out(SetSkillPractice {
        sim: 1,
        skill: 0,
        practice: -0.01,
    });
    for cents in [-MAX_ADMIN_FUNDS_CENTS, MAX_ADMIN_FUNDS_CENTS] {
        fine(SetFunds { cents });
        fine(AdjustFunds { cents });
    }
    for cents in [-MAX_ADMIN_FUNDS_CENTS - 1, MAX_ADMIN_FUNDS_CENTS + 1] {
        out(SetFunds { cents });
        out(AdjustFunds { cents });
    }
    let bill = |amount_cents: i64, late_fee_cents: i64| SetBill {
        due_day: 0,
        kind: 0,
        amount_cents,
        late_fee_cents,
    };
    let added = |amount_cents: i64, late_fee_cents: i64| AddBill {
        due_day: 0,
        kind: 0,
        amount_cents,
        late_fee_cents,
    };
    for make in [bill, added] {
        fine(make(1, 0));
        fine(make(MAX_ADMIN_FUNDS_CENTS, MAX_ADMIN_FUNDS_CENTS));
        out(make(0, 0));
        out(make(MAX_ADMIN_FUNDS_CENTS + 1, 0));
        out(make(1, -1));
        out(make(1, MAX_ADMIN_FUNDS_CENTS + 1));
    }
}

#[test]
fn need_timer_and_bill_kind_codes_must_exist() {
    let unknown = |edit: AdminEdit| {
        assert_eq!(
            check(vec![edit.clone()]),
            Err(AdminStructureError::UnknownCode { edit: 0 }),
            "{edit:?}"
        )
    };
    assert_eq!(
        check(vec![SetNeed {
            sim: 1,
            need: 6,
            value: 1.0,
        }]),
        Ok(())
    );
    unknown(SetNeed {
        sim: 1,
        need: 7,
        value: 1.0,
    });
    assert_eq!(check(vec![EndTimedMoodlet { sim: 1, timer: 5 }]), Ok(()));
    unknown(EndTimedMoodlet { sim: 1, timer: 6 });
    let kind = 4;
    unknown(SetBill {
        due_day: 0,
        kind,
        amount_cents: 1,
        late_fee_cents: 0,
    });
    unknown(AddBill {
        due_day: 0,
        kind,
        amount_cents: 1,
        late_fee_cents: 0,
    });
    unknown(MoveBill {
        due_day: 0,
        kind,
        to_due_day: 28,
    });
    unknown(PayBill { due_day: 0, kind });
    unknown(MarkBillPaid { due_day: 0, kind });
    unknown(DeleteBill { due_day: 0, kind });
    assert_eq!(
        check(vec![DeleteBill {
            due_day: 0,
            kind: 3
        }]),
        Ok(())
    );
}

/// [AP-cmd-admit] item 4: each pair below shares a unit, so the second edit
/// is refused; each paired with an edit of a neighbouring unit is admitted.
#[test]
fn two_edits_touching_one_unit_are_refused() {
    let overlapping: Vec<(AdminEdit, AdminEdit)> = vec![
        (
            SetNeed {
                sim: 1,
                need: 2,
                value: 1.0,
            },
            SetNeed {
                sim: 1,
                need: 2,
                value: 2.0,
            },
        ),
        (
            SetSatisfaction { sim: 1, value: 1.0 },
            SetSatisfaction { sim: 1, value: 2.0 },
        ),
        (
            SetRepetition {
                sim: 1,
                object: 2,
                row: 3,
                value: 1.0,
            },
            SetRepetition {
                sim: 1,
                object: 2,
                row: 3,
                value: 0.0,
            },
        ),
        (
            EndTimedMoodlet { sim: 1, timer: 2 },
            EndTimedMoodlet { sim: 1, timer: 2 },
        ),
        (
            SetAffinity {
                sim: 1,
                kind: 2,
                value: 0.1,
            },
            SetAffinity {
                sim: 1,
                kind: 2,
                value: 0.2,
            },
        ),
        (
            SetSkillPractice {
                sim: 1,
                skill: 0,
                practice: 1.0,
            },
            SetSkillPractice {
                sim: 1,
                skill: 1,
                practice: 1.0,
            },
        ),
        (
            AddTrait {
                sim: 1,
                trait_index: 2,
            },
            SetSkillPractice {
                sim: 1,
                skill: 0,
                practice: 1.0,
            },
        ),
        (
            SetSkillPractice {
                sim: 1,
                skill: 0,
                practice: 1.0,
            },
            RemoveTrait {
                sim: 1,
                trait_index: 2,
            },
        ),
        (
            AddTrait {
                sim: 1,
                trait_index: 2,
            },
            SetTraitState {
                sim: 1,
                trait_index: 3,
                state: 0.5,
            },
        ),
        (
            SetJob {
                sim: 1,
                job: None,
                shift: 0,
            },
            SetPay { sim: 1, dollars: 5 },
        ),
        (
            SetShift { sim: 1, shift: 0 },
            SetJobSearch { sim: 1, on: false },
        ),
        (
            SetGoodWeeks { sim: 1, weeks: 1 },
            SetPoorWeeks { sim: 1, weeks: 1 },
        ),
        (
            SetJobSatisfaction { sim: 1, value: 1.0 },
            SetJob {
                sim: 1,
                job: Some(1),
                shift: 0,
            },
        ),
        (
            SetFeeling {
                from: 1,
                to: 2,
                value: 0.1,
            },
            SetFeeling {
                from: 1,
                to: 2,
                value: 0.2,
            },
        ),
        (StartFight { from: 1, to: 2 }, StartFight { from: 1, to: 3 }),
        (SetFunds { cents: 1 }, AdjustFunds { cents: 1 }),
        (
            PayBill {
                due_day: 0,
                kind: 0,
            },
            AdjustFunds { cents: 1 },
        ),
        (
            SetBill {
                due_day: 0,
                kind: 1,
                amount_cents: 5,
                late_fee_cents: 0,
            },
            DeleteBill {
                due_day: 0,
                kind: 1,
            },
        ),
        (
            MoveBill {
                due_day: 0,
                kind: 1,
                to_due_day: 28,
            },
            AddBill {
                due_day: 28,
                kind: 1,
                amount_cents: 5,
                late_fee_cents: 0,
            },
        ),
        (
            MarkBillPaid {
                due_day: 0,
                kind: 1,
            },
            MoveBill {
                due_day: 56,
                kind: 1,
                to_due_day: 0,
            },
        ),
    ];
    // A leading edit of a person no pair names, so the reported index proves
    // the second edit of the pair is the one refused.
    let lead = SetSatisfaction {
        sim: 999,
        value: 0.0,
    };
    for (first, second) in overlapping {
        assert_eq!(
            check(vec![first.clone()]),
            Ok(()),
            "{first:?} alone is valid"
        );
        assert_eq!(
            check(vec![second.clone()]),
            Ok(()),
            "{second:?} alone is valid"
        );
        assert_eq!(
            check(vec![lead.clone(), first.clone(), second.clone()]),
            Err(AdminStructureError::Overlap { edit: 2 }),
            "{first:?} then {second:?}"
        );
    }

    let independent: Vec<(AdminEdit, AdminEdit)> = vec![
        (
            SetNeed {
                sim: 1,
                need: 2,
                value: 1.0,
            },
            SetNeed {
                sim: 1,
                need: 3,
                value: 1.0,
            },
        ),
        (
            SetNeed {
                sim: 1,
                need: 2,
                value: 1.0,
            },
            SetNeed {
                sim: 2,
                need: 2,
                value: 1.0,
            },
        ),
        (
            SetRepetition {
                sim: 1,
                object: 2,
                row: 3,
                value: 0.0,
            },
            SetRepetition {
                sim: 1,
                object: 2,
                row: 4,
                value: 0.0,
            },
        ),
        (
            EndTimedMoodlet { sim: 1, timer: 2 },
            EndTimedMoodlet { sim: 1, timer: 3 },
        ),
        (
            SetFeeling {
                from: 1,
                to: 2,
                value: 0.0,
            },
            SetFeeling {
                from: 2,
                to: 1,
                value: 0.0,
            },
        ),
        (
            SetSkillPractice {
                sim: 1,
                skill: 0,
                practice: 1.0,
            },
            SetSkillPractice {
                sim: 2,
                skill: 0,
                practice: 1.0,
            },
        ),
        (
            MarkBillPaid {
                due_day: 0,
                kind: 1,
            },
            MarkBillPaid {
                due_day: 0,
                kind: 2,
            },
        ),
        (
            SetBill {
                due_day: 0,
                kind: 1,
                amount_cents: 5,
                late_fee_cents: 0,
            },
            SetBill {
                due_day: 28,
                kind: 1,
                amount_cents: 5,
                late_fee_cents: 0,
            },
        ),
        (
            SetNeed {
                sim: 1,
                need: 0,
                value: 1.0,
            },
            SetSatisfaction { sim: 1, value: 1.0 },
        ),
    ];
    for (first, second) in independent {
        assert_eq!(
            check(vec![first.clone(), second.clone()]),
            Ok(()),
            "{first:?} then {second:?}"
        );
    }
}

/// The first failure in edit order is the one reported.
#[test]
fn the_first_offending_edit_is_reported() {
    assert_eq!(
        check(vec![
            SetSatisfaction { sim: 1, value: 1.0 },
            SetSatisfaction {
                sim: 2,
                value: f32::NAN,
            },
            SetNeed {
                sim: 1,
                need: 9,
                value: 1.0,
            },
        ]),
        Err(AdminStructureError::NotFinite { edit: 1 })
    );
}

#[test]
fn hash_words_carry_the_count_and_every_field() {
    let change = change(vec![
        SetJob {
            sim: 3,
            job: Some(6),
            shift: 1,
        },
        SetJob {
            sim: 3,
            job: None,
            shift: 1,
        },
        SetFunds { cents: -1 },
        SetFeeling {
            from: 1,
            to: 2,
            value: 0.5,
        },
    ]);
    assert_eq!(
        change.hash_words(),
        vec![
            4,
            9,
            3,
            1,
            6,
            1,
            9,
            3,
            0,
            1,
            18,
            u64::MAX,
            16,
            1,
            2,
            u64::from(0.5f32.to_bits()),
        ]
    );
}
