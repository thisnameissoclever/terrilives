//! The Housemate tab's edits ([T4], [AP-e-housemate]): every edit applies,
//! refuses each of its listed refusal codes and leaves the hash unchanged on
//! refusal, edge values at both ends apply and one step past is refused,
//! every kind moves the hash and survives a save, none draws a random
//! number, and Undo takes each back exactly ([AP-tests-sim] items 1 to 5
//! and 9).
use crate::admin::AdminRefusal::{self, *};
use crate::admin_test_support::*;
use crate::burnt_meals::BurntMeals;
use crate::careers::Careers;
use crate::fights::Fights;
use crate::skills::Ladder;
use crate::Sim;
use terri_core::admin::AdminEdit;
use terri_core::{
    Affinities, Habituation, NeedId, Needs, Satisfaction, SimId, Skills, Traits, NEED_COUNT,
};
use terri_data::{CompiledTraitKind, ContentPack, ObjectDefId};

fn pack() -> &'static ContentPack {
    terri_data::pack()
}

/// The first trait whose kind satisfies `wanted`.
fn trait_where(wanted: impl Fn(&terri_data::CompiledTrait) -> bool) -> u32 {
    pack()
        .traits
        .iter()
        .position(wanted)
        .expect("the shipped pack has this kind of trait") as u32
}

fn disposition() -> u32 {
    trait_where(|t| matches!(t.kind, CompiledTraitKind::Disposition { .. }))
}

fn condition() -> u32 {
    trait_where(|t| matches!(t.kind, CompiledTraitKind::Condition { .. }))
}

/// A capability whose tag names a skill, and that skill's index.
fn capability_with_skill() -> (u32, u32) {
    let index = trait_where(|t| {
        matches!(t.kind, CompiledTraitKind::Capability { .. })
            && crate::skills::skill_for_tag(pack(), &t.tag).is_some()
    });
    let skill = crate::skills::skill_for_tag(pack(), &pack().traits[index as usize].tag)
        .expect("checked")
        .0;
    (index, skill)
}

/// Half the top of `skill`'s ladder: a practice every skill can hold.
fn half_top(skill: u32) -> f32 {
    let levels = pack().skills[skill as usize].levels;
    0.5 * Ladder::from_tuning(&pack().tuning).max_practice(levels)
}

/// An object and one of its flyout rows, for a repetition entry.
fn object_row() -> (u32, u32) {
    let object = (0..pack().objects.len() as u32)
        .find(|&object| !crate::action_rows::rows(pack(), ObjectDefId(object)).is_empty())
        .expect("an object with a flyout row");
    (object, 0)
}

/// The shipped lot with its first person worn exactly `traits` (a state of
/// each), a repetition entry of `repetition` on the object row, and the
/// panel open. Set up before the panel opens, so Undo never drops it.
fn with(traits: &[(u32, f32)], repetition: f32) -> (Sim, u32) {
    let mut sim = Sim::new_from_shipped_lot();
    let first = people(&mut sim)[0];
    let entity = entity_of(&sim, first);
    let (object, row) = object_row();
    let mut held = Habituation::default();
    if repetition > 0.0 {
        held.set(ObjectDefId(object), row, repetition);
    }
    sim.world_mut()
        .entity_mut(entity)
        .insert((Traits::from_entries(traits.to_vec()), held));
    sim.begin_admin().expect("opens");
    (sim, first)
}

fn needs_of(sim: &Sim, id: u32) -> Needs {
    *sim.world().get::<Needs>(entity_of(sim, id)).expect("needs")
}

fn satisfaction_of(sim: &Sim, id: u32) -> f32 {
    sim.world()
        .get::<Satisfaction>(entity_of(sim, id))
        .expect("satisfaction")
        .value()
}

fn worn_of(sim: &Sim, id: u32) -> Vec<(u32, f32)> {
    sim.world()
        .get::<Traits>(entity_of(sim, id))
        .map(|worn| worn.entries().to_vec())
        .unwrap_or_default()
}

fn practice_of(sim: &Sim, id: u32, skill: u32) -> f32 {
    sim.world()
        .get::<Skills>(entity_of(sim, id))
        .map_or(0.0, |skills| skills.practice(skill))
}

fn repetition_of(sim: &Sim, id: u32) -> f32 {
    let (object, row) = object_row();
    sim.world()
        .get::<Habituation>(entity_of(sim, id))
        .map_or(0.0, |held| held.get(ObjectDefId(object), row))
}

fn affinity_of(sim: &Sim, id: u32, kind: u32) -> f32 {
    sim.world()
        .get::<Affinities>(entity_of(sim, id))
        .map_or(0.0, |held| held.value(kind))
}

/// A value different from `now`, so an edit to it is a change.
fn other_than(now: f32, low: f32, high: f32) -> f32 {
    if (now - low).abs() > (now - high).abs() {
        low
    } else {
        high
    }
}

/// Every edit refuses a person who is not a living member of the household.
#[test]
fn every_housemate_edit_refuses_someone_who_is_not_a_person() {
    let (mut sim, _) = with(&[], 0.0);
    let (object, row) = object_row();
    let nobody = 99_999;
    for edit in [
        AdminEdit::SetNeed {
            sim: nobody,
            need: 0,
            value: 5.0,
        },
        AdminEdit::SetSatisfaction {
            sim: nobody,
            value: 5.0,
        },
        AdminEdit::SetRepetition {
            sim: nobody,
            object,
            row,
            value: 1.0,
        },
        AdminEdit::EndTimedMoodlet {
            sim: nobody,
            timer: 0,
        },
        AdminEdit::SetAffinity {
            sim: nobody,
            kind: 0,
            value: 0.5,
        },
        AdminEdit::SetSkillPractice {
            sim: nobody,
            skill: 0,
            practice: 1.0,
        },
        AdminEdit::SetTraitState {
            sim: nobody,
            trait_index: 0,
            state: 0.5,
        },
        AdminEdit::AddTrait {
            sim: nobody,
            trait_index: 0,
        },
        AdminEdit::RemoveTrait {
            sim: nobody,
            trait_index: 0,
        },
    ] {
        refused(&mut sim, edit, NotAPerson);
    }
}

/// [AP-e-need], [AP-e-sat]: both ends of the range apply, one step past is
/// refused, and every need is its own edit.
#[test]
fn needs_and_satisfaction_apply_at_both_ends_and_refuse_past_them() {
    let (mut sim, first) = with(&[], 0.0);
    for need in 0..NEED_COUNT as u8 {
        let id = NeedId::ALL[usize::from(need)];
        let now = needs_of(&sim, first).get(id);
        let low_first = other_than(now, 0.0, 100.0);
        let high_first = 100.0 - low_first;
        for value in [low_first, high_first] {
            applied(
                &mut sim,
                AdminEdit::SetNeed {
                    sim: first,
                    need,
                    value,
                },
            );
            assert_eq!(needs_of(&sim, first).get(id), value, "{id:?} to {value}");
        }
        for value in [-0.5, 100.5] {
            refused(
                &mut sim,
                AdminEdit::SetNeed {
                    sim: first,
                    need,
                    value,
                },
                OutOfRange,
            );
        }
    }
    refused(
        &mut sim,
        AdminEdit::SetNeed {
            sim: first,
            need: NEED_COUNT as u8,
            value: 5.0,
        },
        UnknownContent,
    );
    let now = satisfaction_of(&sim, first);
    let low_first = other_than(now, 0.0, 100.0);
    for value in [low_first, 100.0 - low_first] {
        applied(&mut sim, AdminEdit::SetSatisfaction { sim: first, value });
        assert_eq!(satisfaction_of(&sim, first), value);
    }
    for value in [-0.5, 100.5, f32::NAN, f32::INFINITY] {
        refused(
            &mut sim,
            AdminEdit::SetSatisfaction { sim: first, value },
            OutOfRange,
        );
    }
}

/// [AP-e-rep]: 0 to the tuned maximum, an entry that does not exist is
/// refused, and zero removes the entry.
#[test]
fn repetition_applies_within_its_range_and_zero_removes_the_entry() {
    let (mut sim, first) = with(&[], 1.5);
    let (object, row) = object_row();
    let max = pack().tuning.habituation_max;
    let set = |value| AdminEdit::SetRepetition {
        sim: first,
        object,
        row,
        value,
    };
    applied(&mut sim, set(max));
    assert_eq!(repetition_of(&sim, first), max);
    refused(&mut sim, set(max * 1.001), OutOfRange);
    refused(&mut sim, set(-0.01), OutOfRange);
    applied(&mut sim, set(0.25));
    assert_eq!(repetition_of(&sim, first), 0.25);
    applied(&mut sim, set(0.0));
    assert!(
        sim.world()
            .get::<Habituation>(entity_of(&sim, first))
            .expect("the component stays")
            .entries()
            .is_empty(),
        "zero removes the entry rather than pinning it at 0.0"
    );
    refused(&mut sim, set(1.0), NotFound);
    refused(
        &mut sim,
        AdminEdit::SetRepetition {
            sim: first,
            object: pack().objects.len() as u32,
            row,
            value: 1.0,
        },
        UnknownContent,
    );
    let rows = crate::action_rows::rows(pack(), ObjectDefId(object)).len() as u32;
    refused(
        &mut sim,
        AdminEdit::SetRepetition {
            sim: first,
            object,
            row: rows,
            value: 1.0,
        },
        UnknownContent,
    );
}

/// [AP-e-end]: each of the six timers ends for its person and is then
/// refused as not running, and a person who never had it is refused.
#[test]
fn ending_a_timed_moodlet_removes_only_that_persons_timer() {
    let mut sim = Sim::new_from_shipped_lot();
    let ids = people(&mut sim);
    let (first, second) = (SimId(ids[0]), SimId(ids[1]));
    for person in [first, second] {
        sim.world_mut()
            .resource_mut::<BurntMeals>()
            .record(person, 5_000);
        sim.world_mut()
            .resource_mut::<Fights>()
            .timers
            .record(person, 5_000);
        let mut careers = sim.world_mut().resource_mut::<Careers>();
        careers.promoted.record(person, 5_000);
        careers.raised.record(person, 5_000);
        careers.demoted.record(person, 5_000);
        careers.fired.record(person, 5_000);
    }
    sim.begin_admin().expect("opens");
    let running = |sim: &Sim, person: SimId, timer: u8| -> bool {
        let w = sim.world();
        match timer {
            0 => w.resource::<BurntMeals>().active(person, 0),
            1 => w.resource::<Fights>().timers.active(person, 0),
            2 => w.resource::<Careers>().promoted.active(person, 0),
            3 => w.resource::<Careers>().raised.active(person, 0),
            4 => w.resource::<Careers>().demoted.active(person, 0),
            _ => w.resource::<Careers>().fired.active(person, 0),
        }
    };
    for timer in 0..6u8 {
        assert!(running(&sim, first, timer));
        applied(
            &mut sim,
            AdminEdit::EndTimedMoodlet {
                sim: first.0,
                timer,
            },
        );
        assert!(!running(&sim, first, timer), "timer {timer} ended");
        assert!(
            running(&sim, second, timer),
            "timer {timer} is one person's"
        );
        refused(
            &mut sim,
            AdminEdit::EndTimedMoodlet {
                sim: first.0,
                timer,
            },
            NotFound,
        );
    }
    let third = ids[2];
    refused(
        &mut sim,
        AdminEdit::EndTimedMoodlet {
            sim: third,
            timer: 0,
        },
        NotFound,
    );
}

/// A timer that has already ended (its end tick has passed) is not running.
#[test]
fn a_timer_whose_end_has_passed_is_not_running() {
    let mut sim = Sim::new_from_shipped_lot();
    let first = people(&mut sim)[0];
    sim.world_mut()
        .resource_mut::<BurntMeals>()
        .record(SimId(first), 0);
    sim.begin_admin().expect("opens");
    refused(
        &mut sim,
        AdminEdit::EndTimedMoodlet {
            sim: first,
            timer: 0,
        },
        NotFound,
    );
}

/// [AP-e-aff]: -1 to 1 for every kind in pack order.
#[test]
fn affinities_apply_for_every_kind_and_refuse_past_the_range() {
    let (mut sim, first) = with(&[], 0.0);
    let kinds = pack().affinities.len() as u32;
    assert!(kinds > 0);
    for kind in 0..kinds {
        let now = affinity_of(&sim, first, kind);
        let low_first = other_than(now, -1.0, 1.0);
        for value in [low_first, -low_first, 0.0, 0.5] {
            if affinity_of(&sim, first, kind) == value {
                continue;
            }
            applied(
                &mut sim,
                AdminEdit::SetAffinity {
                    sim: first,
                    kind,
                    value,
                },
            );
            assert_eq!(affinity_of(&sim, first, kind), value);
        }
        for value in [-1.01, 1.01, f32::NAN] {
            refused(
                &mut sim,
                AdminEdit::SetAffinity {
                    sim: first,
                    kind,
                    value,
                },
                OutOfRange,
            );
        }
    }
    refused(
        &mut sim,
        AdminEdit::SetAffinity {
            sim: first,
            kind: kinds,
            value: 0.5,
        },
        UnknownContent,
    );
}

/// [AP-e-skill]: practice from 0 to the top of the skill's ladder.
#[test]
fn skill_practice_applies_to_the_top_of_the_ladder_and_refuses_past_it() {
    let (mut sim, first) = with(&[], 0.0);
    let ladder = Ladder::from_tuning(&pack().tuning);
    for (skill, definition) in pack().skills.iter().enumerate() {
        let skill = skill as u32;
        let top = ladder.max_practice(definition.levels);
        for practice in [top, 0.5 * top, 0.0] {
            if practice_of(&sim, first, skill) == practice {
                continue;
            }
            applied(
                &mut sim,
                AdminEdit::SetSkillPractice {
                    sim: first,
                    skill,
                    practice,
                },
            );
            assert_eq!(practice_of(&sim, first, skill), practice);
        }
        refused(
            &mut sim,
            AdminEdit::SetSkillPractice {
                sim: first,
                skill,
                practice: top + 1.0,
            },
            OutOfRange,
        );
        refused(
            &mut sim,
            AdminEdit::SetSkillPractice {
                sim: first,
                skill,
                practice: -0.5,
            },
            OutOfRange,
        );
    }
    refused(
        &mut sim,
        AdminEdit::SetSkillPractice {
            sim: first,
            skill: pack().skills.len() as u32,
            practice: 1.0,
        },
        UnknownContent,
    );
}

/// [AP-e-tval]: a worn condition's or capability's state, 0 to 1; refused
/// for a trait not worn, for a disposition and for an unknown trait.
#[test]
fn a_trait_state_applies_to_worn_traits_with_a_value_only() {
    let (capability, _) = capability_with_skill();
    let (condition, disposition) = (condition(), disposition());
    let (mut sim, first) = with(
        &[(capability, 0.4), (condition, 0.5), (disposition, 0.0)],
        0.0,
    );
    for trait_index in [capability, condition] {
        for state in [0.0, 1.0, 0.25] {
            applied(
                &mut sim,
                AdminEdit::SetTraitState {
                    sim: first,
                    trait_index,
                    state,
                },
            );
            let held = worn_of(&sim, first)
                .into_iter()
                .find(|(index, _)| *index == trait_index)
                .expect("still worn");
            assert_eq!(held.1, state);
        }
        for state in [-0.01, 1.01] {
            refused(
                &mut sim,
                AdminEdit::SetTraitState {
                    sim: first,
                    trait_index,
                    state,
                },
                OutOfRange,
            );
        }
    }
    refused(
        &mut sim,
        AdminEdit::SetTraitState {
            sim: first,
            trait_index: disposition,
            state: 0.5,
        },
        NoValue,
    );
    let unworn = (0..pack().traits.len() as u32)
        .find(|index| ![capability, condition, disposition].contains(index))
        .expect("an unworn trait");
    refused(
        &mut sim,
        AdminEdit::SetTraitState {
            sim: first,
            trait_index: unworn,
            state: 0.5,
        },
        NotWorn,
    );
    refused(
        &mut sim,
        AdminEdit::SetTraitState {
            sim: first,
            trait_index: pack().traits.len() as u32,
            state: 0.5,
        },
        UnknownContent,
    );
}

/// [AP-e-tadd]: a new trait starts at its authored state, the kept traits
/// keep theirs, a capability raises its skill, and the trait caches' revision
/// moves; refused at the limit, when worn and when unknown.
#[test]
fn adding_a_trait_starts_it_at_its_authored_state_and_keeps_the_rest() {
    let (capability, skill) = capability_with_skill();
    let condition = condition();
    let (mut sim, first) = with(&[(condition, 0.8)], 0.0);
    let revision = sim
        .world()
        .resource::<crate::placement::LotEditState>()
        .revision;
    assert_eq!(practice_of(&sim, first, skill), 0.0);
    applied(
        &mut sim,
        AdminEdit::AddTrait {
            sim: first,
            trait_index: capability,
        },
    );
    let worn = worn_of(&sim, first);
    let start = match pack().traits[capability as usize].kind {
        CompiledTraitKind::Capability { start_level, .. } => start_level,
        _ => unreachable!("chosen as a capability"),
    };
    assert!(worn.contains(&(capability, start)), "starts at {start}");
    assert!(
        worn.contains(&(condition, 0.8)),
        "the kept trait keeps its state"
    );
    assert!(
        practice_of(&sim, first, skill) > 0.0 || start == 0.0,
        "a capability raises its skill to the start level"
    );
    assert!(
        sim.world()
            .resource::<crate::placement::LotEditState>()
            .revision
            > revision,
        "the trait caches refresh"
    );
    refused(
        &mut sim,
        AdminEdit::AddTrait {
            sim: first,
            trait_index: capability,
        },
        AlreadyWorn,
    );
    refused(
        &mut sim,
        AdminEdit::AddTrait {
            sim: first,
            trait_index: pack().traits.len() as u32,
        },
        UnknownContent,
    );
}

/// [AP-e-tadd]: the fifth trait is refused, and a trait already worn is
/// reported as worn even at the limit.
#[test]
fn a_fifth_trait_is_refused() {
    let max = pack().tuning.housemate_max_traits as usize;
    let worn: Vec<(u32, f32)> = (0..max as u32).map(|index| (index, 0.0)).collect();
    let (mut sim, first) = with(&worn, 0.0);
    refused(
        &mut sim,
        AdminEdit::AddTrait {
            sim: first,
            trait_index: max as u32,
        },
        TooManyTraits,
    );
    refused(
        &mut sim,
        AdminEdit::AddTrait {
            sim: first,
            trait_index: 0,
        },
        AlreadyWorn,
    );
    assert_eq!(worn_of(&sim, first).len(), max);
}

/// [AP-e-tremove]: removing a trait leaves the skill's practice where it
/// is; refused when not worn or unknown.
#[test]
fn removing_a_trait_leaves_practice_where_it_is() {
    let (capability, skill) = capability_with_skill();
    let (mut sim, first) = with(&[(capability, 0.6)], 0.0);
    applied(
        &mut sim,
        AdminEdit::SetSkillPractice {
            sim: first,
            skill,
            practice: half_top(skill),
        },
    );
    applied(
        &mut sim,
        AdminEdit::RemoveTrait {
            sim: first,
            trait_index: capability,
        },
    );
    assert!(worn_of(&sim, first).is_empty());
    assert_eq!(practice_of(&sim, first, skill), half_top(skill));
    refused(
        &mut sim,
        AdminEdit::RemoveTrait {
            sim: first,
            trait_index: capability,
        },
        NotWorn,
    );
    refused(
        &mut sim,
        AdminEdit::RemoveTrait {
            sim: first,
            trait_index: pack().traits.len() as u32,
        },
        UnknownContent,
    );
}

/// [AP-tests-sim] item 2 for these kinds: a change whose last edit is refused
/// changes nothing, whichever kinds come before it.
#[test]
fn a_change_with_a_refused_housemate_edit_changes_nothing() {
    let (capability, _) = capability_with_skill();
    let (mut sim, first) = with(&[], 1.0);
    let (object, row) = object_row();
    let hash = sim.world_hash();
    assert_eq!(
        sim.admin_apply(change(vec![
            AdminEdit::SetNeed {
                sim: first,
                need: 2,
                value: 7.0
            },
            AdminEdit::SetRepetition {
                sim: first,
                object,
                row,
                value: 0.0
            },
            AdminEdit::AddTrait {
                sim: first,
                trait_index: capability
            },
            AdminEdit::SetAffinity {
                sim: first,
                kind: pack().affinities.len() as u32,
                value: 0.5
            },
        ])),
        Err(crate::admin::AdminApplyRefusal {
            edit: 3,
            reason: AdminRefusal::UnknownContent
        }),
        "the last edit is refused and the three before it are not applied"
    );
    assert_eq!(sim.world_hash(), hash);
    assert_eq!(sim.admin_undo_depth(), 0);
}

/// One change per edit kind, each of which moves the hash from the world
/// `with` builds, for the tests that run them all.
fn every_kind(sim: &Sim, first: u32) -> Vec<AdminEdit> {
    let (capability, skill) = capability_with_skill();
    let (object, row) = object_row();
    let now_need = needs_of(sim, first).get(NeedId::Fun);
    let now_affinity = affinity_of(sim, first, 0);
    vec![
        AdminEdit::SetNeed {
            sim: first,
            need: NeedId::Fun.index() as u8,
            value: other_than(now_need, 3.0, 97.0),
        },
        AdminEdit::SetSatisfaction {
            sim: first,
            value: other_than(satisfaction_of(sim, first), 11.0, 88.0),
        },
        AdminEdit::SetRepetition {
            sim: first,
            object,
            row,
            value: 2.75,
        },
        AdminEdit::EndTimedMoodlet {
            sim: first,
            timer: 0,
        },
        AdminEdit::SetAffinity {
            sim: first,
            kind: 0,
            value: other_than(now_affinity, -0.9, 0.9),
        },
        AdminEdit::SetSkillPractice {
            sim: first,
            skill,
            practice: half_top(skill),
        },
        AdminEdit::SetTraitState {
            sim: first,
            trait_index: condition(),
            state: 0.2,
        },
        AdminEdit::AddTrait {
            sim: first,
            trait_index: capability,
        },
        AdminEdit::RemoveTrait {
            sim: first,
            trait_index: disposition(),
        },
    ]
}

/// A world with every kind's precondition: a repetition entry, a running
/// burnt dinner, one condition and one disposition worn.
fn ready() -> (Sim, u32) {
    let mut sim = Sim::new_from_shipped_lot();
    let first = people(&mut sim)[0];
    let entity = entity_of(&sim, first);
    let (object, row) = object_row();
    let mut held = Habituation::default();
    held.set(ObjectDefId(object), row, 1.5);
    sim.world_mut().entity_mut(entity).insert((
        Traits::from_entries(vec![(condition(), 0.7), (disposition(), 0.0)]),
        held,
    ));
    sim.world_mut()
        .resource_mut::<BurntMeals>()
        .record(SimId(first), 9_000);
    sim.begin_admin().expect("opens");
    (sim, first)
}

/// [AP-tests-sim] items 3 and 4: after each kind a save of the world loads
/// and hashes as the live one, and each kind moved the hash.
#[test]
fn every_housemate_edit_kind_moves_the_hash_and_survives_a_save() {
    let (mut sim, first) = ready();
    for edit in every_kind(&sim, first) {
        let what = format!("{edit:?}");
        applied(&mut sim, edit);
        assert_survives_save(&sim, &what);
    }
}

/// [AP-tests-sim] item 9: no edit draws from any random stream, and two
/// worlds given the same changes hash equal.
#[test]
fn housemate_edits_draw_nothing_and_are_deterministic() {
    let (mut a, first) = ready();
    let (mut b, _) = ready();
    let before = streams(&a);
    for edit in every_kind(&a, first) {
        a.admin_apply(change(vec![edit.clone()])).expect("applies");
        b.admin_apply(change(vec![edit])).expect("applies");
        assert_eq!(streams(&a), before, "no stream moved");
    }
    assert_eq!(a.world_hash(), b.world_hash());
}

/// [AP-tests-sim] item 9: a world with edits applied, saved and reloaded
/// continues identically to the live one for two game days.
#[test]
fn an_edited_world_saved_and_reloaded_continues_identically_for_two_days() {
    let (mut live, first) = ready();
    for edit in every_kind(&live, first) {
        live.admin_apply(change(vec![edit])).expect("applies");
    }
    let snapshot = live.try_save_snapshot_v27().expect("saves");
    live.end_admin();
    let mut loaded = Sim::new_from_shipped_lot();
    loaded.load_snapshot_v27(snapshot).expect("loads");
    assert_eq!(loaded.world_hash(), live.world_hash());
    for tick in 0..2 * 1440 {
        live.tick();
        loaded.tick();
        assert_eq!(live.world_hash(), loaded.world_hash(), "tick {tick}");
    }
}

/// [AP-tests-sim] item 5 for these kinds: every kind in one session, then
/// Undo back through them. After each Undo the hash and the readings equal
/// those before the undone change.
#[test]
fn undo_takes_back_every_housemate_edit_exactly() {
    let (mut sim, first) = ready();
    let mut before = Vec::new();
    let read = |sim: &Sim| {
        (
            sim.world_hash(),
            needs_of(sim, first),
            satisfaction_of(sim, first).to_bits(),
            worn_of(sim, first)
                .into_iter()
                .map(|(i, s)| (i, s.to_bits()))
                .collect::<Vec<_>>(),
            repetition_of(sim, first).to_bits(),
            affinity_of(sim, first, 0).to_bits(),
        )
    };
    let baseline = read(&sim);
    for edit in every_kind(&sim, first) {
        before.push(read(&sim));
        applied(&mut sim, edit);
    }
    while let Some(expected) = before.pop() {
        assert_eq!(sim.admin_undo(), Ok(()));
        assert_eq!(sim.admin_undo_depth(), before.len());
        assert_eq!(read(&sim), expected, "undo to depth {}", before.len());
    }
    assert_eq!(read(&sim), baseline);
}

/// [AP-tests-sim] item 5: Undo after adding a capability restores the
/// skill's practice, which the add raised.
#[test]
fn undoing_a_capability_restores_the_skills_practice() {
    let (capability, skill) = capability_with_skill();
    let (mut sim, first) = with(&[], 0.0);
    let before = practice_of(&sim, first, skill);
    let hash = sim.world_hash();
    applied(
        &mut sim,
        AdminEdit::AddTrait {
            sim: first,
            trait_index: capability,
        },
    );
    sim.admin_undo().expect("undoes");
    assert_eq!(practice_of(&sim, first, skill), before);
    assert_eq!(sim.world_hash(), hash);
    assert!(worn_of(&sim, first).is_empty());
}

/// The coordinator's ruling: edits that touch what the activity log reads
/// leave Undo's live log as a never-undone twin's.
#[test]
fn undo_keeps_the_activity_log_of_a_never_undone_twin() {
    let (capability, skill) = capability_with_skill();
    let first = people(&mut Sim::new_from_shipped_lot())[0];
    assert_undo_keeps_the_activity_log_of_a_twin(
        opened,
        vec![
            change(vec![AdminEdit::SetNeed {
                sim: first,
                need: 0,
                value: 3.0,
            }]),
            change(vec![AdminEdit::SetSkillPractice {
                sim: first,
                skill,
                practice: half_top(skill),
            }]),
            change(vec![AdminEdit::AddTrait {
                sim: first,
                trait_index: capability,
            }]),
        ],
        "housemate edits",
    );
}
