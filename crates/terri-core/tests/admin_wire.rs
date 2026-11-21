//! The admin panel's wire format (issue 312, [AP-cmd-wire] item 2 in
//! `docs/specs/2026-11-20-admin-panel.md`).
//!
//! Every `AdminEdit` code and the command's code 41 are pinned by a golden
//! byte vector. The vectors were read from this test's own failure output,
//! not computed by hand ([L33]). The same vectors live in
//! `tests/fixtures/admin-wire.json`, which `web/tests/admin-codec.test.ts`
//! reads, so the TypeScript encoder cannot drift from this decoder ([L13]).
//! This test writes the expected file text from the cases below and
//! requires the checked-in file to match it byte for byte; set
//! `TERRI_WRITE_ADMIN_WIRE_FIXTURE` to rewrite it after a deliberate change.

use terri_core::admin::{AdminChange, AdminEdit};
use terri_core::{SavedCommand, SimCommand};

fn admin(edits: Vec<AdminEdit>) -> SimCommand {
    SimCommand::Admin(Box::new(AdminChange { edits }))
}

/// One case per edit code in code order, both shapes of `SetJob`, and one
/// change of two edits. Field values are distinct and mostly nonzero
/// ([L34]); 300 and 200 need two varint bytes, so a field narrowed to a
/// byte fails here.
fn cases() -> Vec<(&'static str, Vec<AdminEdit>, Vec<u8>)> {
    use AdminEdit::*;
    vec![
        (
            "SetNeed",
            vec![SetNeed {
                sim: 300,
                need: 2,
                value: 50.5,
            }],
            vec![41, 1, 0, 172, 2, 2, 0, 0, 74, 66],
        ),
        (
            "SetSatisfaction",
            vec![SetSatisfaction {
                sim: 3,
                value: 72.25,
            }],
            vec![41, 1, 1, 3, 0, 128, 144, 66],
        ),
        (
            "SetRepetition",
            vec![SetRepetition {
                sim: 3,
                object: 9,
                row: 2,
                value: 1.5,
            }],
            vec![41, 1, 2, 3, 9, 2, 0, 0, 192, 63],
        ),
        (
            "EndTimedMoodlet",
            vec![EndTimedMoodlet { sim: 3, timer: 5 }],
            vec![41, 1, 3, 3, 5],
        ),
        (
            "SetAffinity",
            vec![SetAffinity {
                sim: 3,
                kind: 1,
                value: -0.75,
            }],
            vec![41, 1, 4, 3, 1, 0, 0, 64, 191],
        ),
        (
            "SetSkillPractice",
            vec![SetSkillPractice {
                sim: 3,
                skill: 2,
                practice: 12.5,
            }],
            vec![41, 1, 5, 3, 2, 0, 0, 72, 65],
        ),
        (
            "SetTraitState",
            vec![SetTraitState {
                sim: 3,
                trait_index: 7,
                state: 0.25,
            }],
            vec![41, 1, 6, 3, 7, 0, 0, 128, 62],
        ),
        (
            "AddTrait",
            vec![AddTrait {
                sim: 3,
                trait_index: 200,
            }],
            vec![41, 1, 7, 3, 200, 1],
        ),
        (
            "RemoveTrait",
            vec![RemoveTrait {
                sim: 3,
                trait_index: 4,
            }],
            vec![41, 1, 8, 3, 4],
        ),
        (
            "SetJob",
            vec![SetJob {
                sim: 3,
                job: Some(6),
                shift: 1,
            }],
            vec![41, 1, 9, 3, 1, 6, 1],
        ),
        (
            "SetJob no job",
            vec![SetJob {
                sim: 3,
                job: None,
                shift: 0,
            }],
            vec![41, 1, 9, 3, 0, 0],
        ),
        (
            "SetShift",
            vec![SetShift { sim: 3, shift: 2 }],
            vec![41, 1, 10, 3, 2],
        ),
        (
            "SetPay",
            vec![SetPay {
                sim: 3,
                dollars: 145,
            }],
            vec![41, 1, 11, 3, 145, 1],
        ),
        (
            "SetJobSatisfaction",
            vec![SetJobSatisfaction {
                sim: 3,
                value: 33.5,
            }],
            vec![41, 1, 12, 3, 0, 0, 6, 66],
        ),
        (
            "SetGoodWeeks",
            vec![SetGoodWeeks { sim: 3, weeks: 2 }],
            vec![41, 1, 13, 3, 2],
        ),
        (
            "SetPoorWeeks",
            vec![SetPoorWeeks { sim: 3, weeks: 15 }],
            vec![41, 1, 14, 3, 15],
        ),
        (
            "SetJobSearch",
            vec![SetJobSearch { sim: 3, on: true }],
            vec![41, 1, 15, 3, 1],
        ),
        (
            "SetFeeling",
            vec![SetFeeling {
                from: 3,
                to: 5,
                value: -0.5,
            }],
            vec![41, 1, 16, 3, 5, 0, 0, 0, 191],
        ),
        (
            "StartFight",
            vec![StartFight { from: 3, to: 5 }],
            vec![41, 1, 17, 3, 5],
        ),
        (
            "SetFunds",
            vec![SetFunds { cents: -231_840 }],
            vec![41, 1, 18, 191, 166, 28],
        ),
        (
            "AdjustFunds",
            vec![AdjustFunds { cents: 100_000 }],
            vec![41, 1, 19, 192, 154, 12],
        ),
        (
            "SetBill",
            vec![SetBill {
                due_day: 28,
                kind: 1,
                amount_cents: 6100,
                late_fee_cents: 305,
            }],
            vec![41, 1, 20, 28, 1, 168, 95, 226, 4],
        ),
        (
            "MoveBill",
            vec![MoveBill {
                due_day: 28,
                kind: 2,
                to_due_day: 56,
            }],
            vec![41, 1, 21, 28, 2, 56],
        ),
        (
            "PayBill",
            vec![PayBill {
                due_day: 28,
                kind: 3,
            }],
            vec![41, 1, 22, 28, 3],
        ),
        (
            "MarkBillPaid",
            vec![MarkBillPaid {
                due_day: 0,
                kind: 0,
            }],
            vec![41, 1, 23, 0, 0],
        ),
        (
            "DeleteBill",
            vec![DeleteBill {
                due_day: 84,
                kind: 1,
            }],
            vec![41, 1, 24, 84, 1],
        ),
        (
            "AddBill",
            vec![AddBill {
                due_day: 112,
                kind: 0,
                amount_cents: 1_000_000_000_000,
                late_fee_cents: 0,
            }],
            vec![41, 1, 25, 112, 0, 128, 192, 168, 202, 154, 58, 0],
        ),
        (
            "Two edits",
            vec![
                SetNeed {
                    sim: 3,
                    need: 0,
                    value: 100.0,
                },
                SetNeed {
                    sim: 3,
                    need: 6,
                    value: 100.0,
                },
            ],
            vec![41, 2, 0, 3, 0, 0, 0, 200, 66, 0, 3, 6, 0, 0, 200, 66],
        ),
    ]
}

#[test]
fn every_admin_edit_keeps_its_golden_bytes_and_code_41() {
    let cases = cases();
    // One case per code, in code order, so a new edit cannot ship unpinned.
    let mut codes: Vec<u8> = cases
        .iter()
        .flat_map(|(_, edits, _)| edits.iter().map(AdminEdit::code))
        .collect();
    codes.dedup();
    assert_eq!(codes, (0..=25).chain([0]).collect::<Vec<u8>>());
    for (name, edits, expected) in cases {
        let command = admin(edits);
        let bytes = postcard::to_allocvec(&command).unwrap();
        assert_eq!(bytes, expected, "{name}: the admin wire bytes changed");
        assert_eq!(bytes[0], 41, "{name}");
        let (decoded, rest) = postcard::take_from_bytes::<SimCommand>(&bytes).unwrap();
        assert_eq!(decoded, command, "{name}");
        assert!(rest.is_empty(), "{name}");
        for cut in 0..bytes.len() {
            assert!(
                postcard::from_bytes::<SimCommand>(&bytes[..cut]).is_err(),
                "{name}: a prefix of {cut} bytes must not decode"
            );
        }
        // Code 41 is not a saved command: the published saved records stay
        // frozen, and an admin command is never saved.
        assert!(
            postcard::from_bytes::<SavedCommand>(&bytes).is_err(),
            "{name}: [41, ...] must not decode as a saved command"
        );
    }
}

/// Nothing was inserted before the admin command: Go to work keeps 40.
#[test]
fn go_to_work_keeps_code_40() {
    assert_eq!(
        postcard::to_allocvec(&SimCommand::GoToWork { agent: 0 }).unwrap(),
        [40, 0]
    );
}

/// An unknown edit code after the last one is refused at decode.
#[test]
fn an_unknown_edit_code_does_not_decode() {
    assert!(postcard::from_bytes::<SimCommand>(&[41, 1, 26, 3]).is_err());
}

/// Equality compares floats by their bits, so `Eq` is sound even for a NaN
/// that admission would refuse, and different zeros are different edits.
#[test]
fn edit_equality_compares_float_bits() {
    let nan = AdminEdit::SetSatisfaction {
        sim: 1,
        value: f32::NAN,
    };
    assert_eq!(nan, nan.clone());
    assert_ne!(
        AdminEdit::SetSatisfaction { sim: 1, value: 0.0 },
        AdminEdit::SetSatisfaction {
            sim: 1,
            value: -0.0
        }
    );
    assert_ne!(
        AdminEdit::SetSatisfaction { sim: 1, value: 1.0 },
        AdminEdit::SetJobSatisfaction { sim: 1, value: 1.0 }
    );
}

fn json_fields(edit: &AdminEdit) -> Vec<(&'static str, String)> {
    use AdminEdit::*;
    let n = |value: u32| value.to_string();
    let b = |value: u8| value.to_string();
    let f = |value: f32| value.to_string();
    let c = |value: i64| value.to_string();
    match *edit {
        SetNeed { sim, need, value } => {
            vec![("sim", n(sim)), ("need", b(need)), ("value", f(value))]
        }
        SetSatisfaction { sim, value } | SetJobSatisfaction { sim, value } => {
            vec![("sim", n(sim)), ("value", f(value))]
        }
        SetRepetition {
            sim,
            object,
            row,
            value,
        } => vec![
            ("sim", n(sim)),
            ("object", n(object)),
            ("row", n(row)),
            ("value", f(value)),
        ],
        EndTimedMoodlet { sim, timer } => vec![("sim", n(sim)), ("timer", b(timer))],
        SetAffinity { sim, kind, value } => {
            vec![("sim", n(sim)), ("kind", n(kind)), ("value", f(value))]
        }
        SetSkillPractice {
            sim,
            skill,
            practice,
        } => vec![
            ("sim", n(sim)),
            ("skill", n(skill)),
            ("practice", f(practice)),
        ],
        SetTraitState {
            sim,
            trait_index,
            state,
        } => vec![
            ("sim", n(sim)),
            ("trait_index", n(trait_index)),
            ("state", f(state)),
        ],
        AddTrait { sim, trait_index } | RemoveTrait { sim, trait_index } => {
            vec![("sim", n(sim)), ("trait_index", n(trait_index))]
        }
        SetJob { sim, job, shift } => vec![
            ("sim", n(sim)),
            ("job", job.map_or_else(|| "null".to_string(), n)),
            ("shift", n(shift)),
        ],
        SetShift { sim, shift } => vec![("sim", n(sim)), ("shift", n(shift))],
        SetPay { sim, dollars } => vec![("sim", n(sim)), ("dollars", n(dollars))],
        SetGoodWeeks { sim, weeks } | SetPoorWeeks { sim, weeks } => {
            vec![("sim", n(sim)), ("weeks", n(weeks))]
        }
        SetJobSearch { sim, on } => vec![("sim", n(sim)), ("on", on.to_string())],
        SetFeeling { from, to, value } => {
            vec![("from", n(from)), ("to", n(to)), ("value", f(value))]
        }
        StartFight { from, to } => vec![("from", n(from)), ("to", n(to))],
        SetFunds { cents } | AdjustFunds { cents } => vec![("cents", c(cents))],
        SetBill {
            due_day,
            kind,
            amount_cents,
            late_fee_cents,
        }
        | AddBill {
            due_day,
            kind,
            amount_cents,
            late_fee_cents,
        } => vec![
            ("due_day", n(due_day)),
            ("kind", b(kind)),
            ("amount_cents", c(amount_cents)),
            ("late_fee_cents", c(late_fee_cents)),
        ],
        MoveBill {
            due_day,
            kind,
            to_due_day,
        } => vec![
            ("due_day", n(due_day)),
            ("kind", b(kind)),
            ("to_due_day", n(to_due_day)),
        ],
        PayBill { due_day, kind }
        | MarkBillPaid { due_day, kind }
        | DeleteBill { due_day, kind } => {
            vec![("due_day", n(due_day)), ("kind", b(kind))]
        }
    }
}

/// The edit's variant name, as the fixture and the web codec spell it.
fn edit_name(edit: &AdminEdit) -> String {
    let debug = format!("{edit:?}");
    debug
        .split([' ', '{', '('])
        .next()
        .expect("a variant name")
        .to_string()
}

fn fixture_text() -> String {
    let mut out = String::from(
        "{\n  \"about\": \"Admin panel wire vectors (issue 312). Written by crates/terri-core/tests/admin_wire.rs; every float is exact as an f32.\",\n  \"command_code\": 41,\n  \"cases\": [\n",
    );
    let cases = cases();
    for (index, (name, edits, bytes)) in cases.iter().enumerate() {
        out.push_str(&format!(
            "    {{\n      \"name\": \"{name}\",\n      \"edits\": [\n"
        ));
        for (edit_index, edit) in edits.iter().enumerate() {
            let fields: Vec<String> = json_fields(edit)
                .into_iter()
                .map(|(key, value)| format!("\"{key}\": {value}"))
                .collect();
            out.push_str(&format!(
                "        {{ \"edit\": \"{}\", \"code\": {}, {} }}{}\n",
                edit_name(edit),
                edit.code(),
                fields.join(", "),
                if edit_index + 1 < edits.len() {
                    ","
                } else {
                    ""
                }
            ));
        }
        let bytes: Vec<String> = bytes.iter().map(u8::to_string).collect();
        out.push_str(&format!(
            "      ],\n      \"bytes\": [{}]\n    }}{}\n",
            bytes.join(", "),
            if index + 1 < cases.len() { "," } else { "" }
        ));
    }
    out.push_str("  ]\n}\n");
    out
}

#[test]
fn the_shared_fixture_holds_these_vectors() {
    let path =
        std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/admin-wire.json");
    let expected = fixture_text();
    if std::env::var_os("TERRI_WRITE_ADMIN_WIRE_FIXTURE").is_some() {
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        std::fs::write(&path, &expected).unwrap();
    }
    let actual = std::fs::read_to_string(&path).unwrap_or_default();
    assert!(
        actual == expected,
        "tests/fixtures/admin-wire.json does not hold these vectors; \
         rewrite it with TERRI_WRITE_ADMIN_WIRE_FIXTURE=1 after a deliberate change"
    );
}
