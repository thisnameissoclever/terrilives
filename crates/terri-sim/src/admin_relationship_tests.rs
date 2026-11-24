//! The Relationships tab's edits ([T6], [AP-e-rel]): feelings and fights.
//! Every edit applies, refuses each of its listed refusal codes with the hash
//! unchanged, moves the hash, survives a save, draws no random number and
//! Undo takes it back ([AP-tests-sim] items 1, 3, 4 and 12).
use crate::admin::AdminRefusal::{self, *};
use crate::admin_test_support::*;
use crate::fights::fight_index;
use crate::Sim;
use terri_core::admin::AdminEdit;
use terri_core::{AtWork, Commuting, IntentQueue, Path, Position, Relationships, Socialising};

fn feeling_of(sim: &Sim, from: u32, to: u32) -> f32 {
    sim.world()
        .get::<Relationships>(entity_of(sim, from))
        .map_or(0.0, |held| held.feeling(terri_core::SimId(to)))
}

fn entries_of(sim: &Sim, from: u32) -> Vec<(u32, f32)> {
    sim.world()
        .get::<Relationships>(entity_of(sim, from))
        .map(|held| held.entries().iter().map(|(id, v)| (id.0, *v)).collect())
        .unwrap_or_default()
}

/// The fight orders waiting in `id`'s queue, as the target entities.
fn fight_orders(sim: &Sim, id: u32) -> Vec<u32> {
    let fight = fight_index(sim.world().resource::<crate::Content>().0).expect("a fight");
    sim.world()
        .get::<IntentQueue>(entity_of(sim, id))
        .map(|queue| {
            queue
                .intents()
                .filter(|intent| intent.interaction == fight && intent.object != entity_of(sim, id))
                .map(|intent| intent.object.index_u32())
                .collect()
        })
        .unwrap_or_default()
}

fn set(from: u32, to: u32, value: f32) -> AdminEdit {
    AdminEdit::SetFeeling { from, to, value }
}

/// Three people, the panel open, and the first two ids and third.
fn trio() -> (Sim, u32, u32, u32) {
    let mut sim = Sim::new_from_shipped_lot();
    let ids = people(&mut sim);
    sim.begin_admin().expect("opens");
    (sim, ids[0], ids[1], ids[2])
}

/// [AP-e-feel]: -1 to 1 applies in either direction independently, one step
/// past is refused, and zero removes the entry.
#[test]
fn a_feeling_applies_within_its_range_and_zero_removes_the_entry() {
    let (mut sim, a, b, _) = trio();
    applied(&mut sim, set(a, b, 1.0));
    assert_eq!(feeling_of(&sim, a, b), 1.0);
    assert_eq!(
        feeling_of(&sim, b, a),
        0.0,
        "the other direction is its own"
    );
    applied(&mut sim, set(a, b, -1.0));
    assert_eq!(feeling_of(&sim, a, b), -1.0);
    applied(&mut sim, set(b, a, 0.25));
    assert_eq!(feeling_of(&sim, b, a), 0.25);
    for value in [-1.01, 1.01, f32::NAN, f32::NEG_INFINITY] {
        refused(&mut sim, set(a, b, value), OutOfRange);
    }
    applied(&mut sim, set(a, b, 0.0));
    assert!(
        !entries_of(&sim, a).iter().any(|&(id, _)| id == b),
        "zero removes the entry as decay does"
    );
    // Zero toward someone who holds no entry changes nothing.
    let hash = sim.world_hash();
    sim.admin_apply(change(vec![set(a, b, 0.0)]))
        .expect("a no-op is admitted");
    assert_eq!(sim.world_hash(), hash);
}

/// [AP-e-feel]: both people must be living members of the household, and
/// not the same one; the refusal names the edit and leaves the hash.
#[test]
fn a_feeling_refuses_a_stranger_a_dead_person_and_oneself() {
    let mut sim = Sim::new_from_shipped_lot();
    let ids = people(&mut sim);
    // A person who has died keeps their SimId in records but has no entity.
    let dead = entity_of(&sim, ids[2]);
    sim.world_mut().despawn(dead);
    sim.begin_admin().expect("opens");
    let (a, b, dead) = (ids[0], ids[1], ids[2]);
    refused(&mut sim, set(a, a, 0.5), SamePerson);
    refused(&mut sim, set(a, dead, 0.5), NotAPerson);
    refused(&mut sim, set(dead, a, 0.5), NotAPerson);
    refused(&mut sim, set(a, 99_999, 0.5), NotAPerson);
    refused(&mut sim, set(99_999, b, 0.5), NotAPerson);
    refused(&mut sim, set(dead, dead, 0.5), NotAPerson);
}

/// [AP-e-both]: one change sets both directions, and one Undo takes both.
#[test]
fn one_change_sets_both_directions_as_one_undo_step() {
    let (mut sim, a, b, _) = trio();
    let before = sim.world_hash();
    sim.admin_apply(change(vec![set(a, b, 0.5), set(b, a, -0.5)]))
        .expect("applies");
    assert_eq!(
        (feeling_of(&sim, a, b), feeling_of(&sim, b, a)),
        (0.5, -0.5)
    );
    assert_eq!(sim.admin_undo_depth(), 1);
    sim.admin_undo().expect("one undo takes both");
    assert_eq!(sim.world_hash(), before);
    assert_eq!((feeling_of(&sim, a, b), feeling_of(&sim, b, a)), (0.0, 0.0));
}

/// [AP-e-both] and [AP-e-allzero]: a change of zeros clears every pair of
/// the household at once.
#[test]
fn setting_every_feeling_to_zero_is_one_change() {
    let (mut sim, a, b, c) = trio();
    let ids = [a, b, c];
    let mut edits = Vec::new();
    for from in ids {
        for to in ids.into_iter().filter(|&to| to != from) {
            edits.push(set(from, to, 0.4));
        }
    }
    sim.admin_apply(change(edits)).expect("applies");
    let zeros: Vec<AdminEdit> = ids
        .into_iter()
        .flat_map(|from| {
            ids.into_iter()
                .filter(move |&to| to != from)
                .map(move |to| set(from, to, 0.0))
        })
        .collect();
    sim.admin_apply(change(zeros)).expect("applies");
    for from in ids {
        assert!(entries_of(&sim, from).is_empty(), "{from} holds no feeling");
    }
    assert_eq!(sim.admin_undo_depth(), 2);
}

/// [AP-tests-sim] item 2 for these kinds: a refused second edit refuses the
/// whole change.
#[test]
fn a_change_with_a_refused_feeling_changes_nothing() {
    let (mut sim, a, b, _) = trio();
    let hash = sim.world_hash();
    assert_eq!(
        sim.admin_apply(change(vec![set(a, b, 0.5), set(b, b, 0.5)])),
        Err(crate::admin::AdminApplyRefusal {
            edit: 1,
            reason: AdminRefusal::SamePerson
        })
    );
    assert_eq!(sim.world_hash(), hash);
    assert_eq!(feeling_of(&sim, a, b), 0.0);
}

/// [AP-e-fight]: a fight order is queued for the person, behind what they
/// already hold, and nothing else changes until play resumes; refused toward
/// oneself and while either person is at work or commuting.
#[test]
fn a_started_fight_waits_in_the_queue_until_play_resumes() {
    let (mut sim, a, b, _) = trio();
    let draws = streams(&sim);
    assert!(fight_orders(&sim, a).is_empty());
    applied(&mut sim, AdminEdit::StartFight { from: a, to: b });
    assert_eq!(
        fight_orders(&sim, a),
        vec![entity_of(&sim, b).index_u32()],
        "the fight order waits in the first person's queue"
    );
    assert!(fight_orders(&sim, b).is_empty());
    assert_eq!(streams(&sim), draws, "the topic is not drawn at the drain");
    assert!(sim.world().get::<Socialising>(entity_of(&sim, a)).is_none());
    // Resume: the order is served, and the fight begins.
    sim.end_admin();
    let fight = fight_index(sim.world().resource::<crate::Content>().0).expect("a fight");
    let mut began = None;
    for tick in 0..3_000 {
        sim.tick();
        if sim
            .world()
            .get::<Socialising>(entity_of(&sim, a))
            .is_some_and(|social| social.interaction == fight)
        {
            began = Some(tick);
            break;
        }
    }
    assert!(began.is_some(), "the fight begins once play resumes");
    assert!(
        sim.world()
            .resource::<crate::social_episode::SocialEpisodes>()
            .topics
            .contains_key(&entity_of(&sim, a)),
        "the topic is drawn when the fight begins"
    );
}

#[test]
fn a_fight_is_refused_toward_oneself_a_stranger_and_while_at_work() {
    let mut sim = Sim::new_from_shipped_lot();
    let ids = people(&mut sim);
    let (a, b, c) = (ids[0], ids[1], ids[2]);
    let (b_entity, c_entity) = (entity_of(&sim, b), entity_of(&sim, c));
    sim.world_mut().entity_mut(b_entity).insert(AtWork {
        remaining_ticks: 90,
    });
    let position = *sim.world().get::<Position>(c_entity).unwrap();
    let steps = crate::world_geometry::route_to_boundary(sim.world(), position).unwrap();
    sim.world_mut()
        .entity_mut(c_entity)
        .insert((Commuting::Outbound, Path { steps, cursor: 0 }));
    sim.begin_admin().expect("opens");
    refused(
        &mut sim,
        AdminEdit::StartFight { from: a, to: a },
        SamePerson,
    );
    refused(
        &mut sim,
        AdminEdit::StartFight {
            from: a,
            to: 99_999,
        },
        NotAPerson,
    );
    refused(
        &mut sim,
        AdminEdit::StartFight {
            from: 99_999,
            to: a,
        },
        NotAPerson,
    );
    // Either side being busy refuses it, at work or on the way.
    refused(&mut sim, AdminEdit::StartFight { from: a, to: b }, Busy);
    refused(&mut sim, AdminEdit::StartFight { from: b, to: a }, Busy);
    refused(&mut sim, AdminEdit::StartFight { from: a, to: c }, Busy);
    refused(&mut sim, AdminEdit::StartFight { from: c, to: a }, Busy);
    assert!(fight_orders(&sim, a).is_empty());
}

/// A full order queue cannot take the fight order, so the edit is refused
/// rather than applied and silently dropped.
#[test]
fn a_fight_is_refused_when_the_order_queue_is_full() {
    let mut pack = terri_data::pack().clone();
    pack.tuning.max_queued_intents = 1;
    let pack: &'static terri_data::ContentPack = Box::leak(Box::new(pack));
    let mut sim = Sim::new_household_with_content(crate::Content(pack), 7);
    let ids = people(&mut sim);
    let (a, b) = (ids[0], ids[1]);
    sim.begin_admin().expect("opens");
    applied(&mut sim, AdminEdit::StartFight { from: a, to: b });
    refused(&mut sim, AdminEdit::StartFight { from: a, to: b }, Busy);
    applied(&mut sim, AdminEdit::StartFight { from: b, to: a });
}

/// Every kind survives a save and moves the hash.
#[test]
fn every_relationship_edit_moves_the_hash_and_survives_a_save() {
    let (mut sim, a, b, c) = trio();
    for edit in [
        set(a, b, 0.75),
        set(b, a, -0.5),
        set(a, c, 0.5),
        set(a, b, 0.0),
        AdminEdit::StartFight { from: c, to: b },
    ] {
        let what = format!("{edit:?}");
        applied(&mut sim, edit);
        assert_survives_save(&sim, &what);
    }
}

/// [AP-tests-sim] item 9: no relationship edit draws from a stream, and two
/// worlds given the same changes hash equal.
#[test]
fn relationship_edits_draw_nothing_and_are_deterministic() {
    let (mut x, a, b, c) = trio();
    let (mut y, ..) = trio();
    let before = streams(&x);
    for edit in [
        set(a, b, 0.75),
        set(b, c, -0.25),
        AdminEdit::StartFight { from: a, to: c },
    ] {
        x.admin_apply(change(vec![edit.clone()])).expect("applies");
        y.admin_apply(change(vec![edit])).expect("applies");
        assert_eq!(streams(&x), before);
    }
    assert_eq!(x.world_hash(), y.world_hash());
}

/// A world with feelings and a fight order applied, saved and reloaded,
/// continues identically to the live one for two game days.
#[test]
fn an_edited_world_saved_and_reloaded_continues_identically_for_two_days() {
    let (mut live, a, b, c) = trio();
    for edit in [
        set(a, b, 0.6),
        set(c, a, -0.8),
        AdminEdit::StartFight { from: b, to: c },
    ] {
        live.admin_apply(change(vec![edit])).expect("applies");
    }
    let snapshot = live.try_save_snapshot_v28().expect("saves");
    live.end_admin();
    let mut loaded = Sim::new_from_shipped_lot();
    loaded.load_snapshot_v28(snapshot).expect("loads");
    assert_eq!(loaded.world_hash(), live.world_hash());
    for tick in 0..2 * 1440 {
        live.tick();
        loaded.tick();
        assert_eq!(live.world_hash(), loaded.world_hash(), "tick {tick}");
    }
}

/// [AP-tests-sim] item 5: Undo after `StartFight` removes the queued order
/// and the world hashes as before; the feelings undo as well.
#[test]
fn undo_takes_back_a_started_fight_and_every_feeling() {
    let (mut sim, a, b, c) = trio();
    let start = sim.world_hash();
    let mut before = vec![start];
    for edit in [
        set(a, b, 0.5),
        AdminEdit::StartFight { from: a, to: c },
        set(c, a, -0.5),
        AdminEdit::StartFight { from: b, to: a },
    ] {
        applied(&mut sim, edit);
        before.push(sim.world_hash());
    }
    before.pop();
    while let Some(expected) = before.pop() {
        sim.admin_undo().expect("undoes");
        assert_eq!(sim.world_hash(), expected, "depth {}", before.len());
    }
    assert!(fight_orders(&sim, a).is_empty());
    assert!(fight_orders(&sim, b).is_empty());
    assert_eq!(sim.world_hash(), start);
}

/// The coordinator's ruling: Undo of an edit that queues an order leaves the
/// live activity log as a never-undone twin's.
#[test]
fn undo_keeps_the_activity_log_of_a_never_undone_twin() {
    let ids = people(&mut Sim::new_from_shipped_lot());
    let (a, b) = (ids[0], ids[1]);
    assert_undo_keeps_the_activity_log_of_a_twin(
        opened,
        vec![
            change(vec![set(a, b, 0.5)]),
            change(vec![AdminEdit::StartFight { from: a, to: b }]),
        ],
        "relationship edits",
    );
}
