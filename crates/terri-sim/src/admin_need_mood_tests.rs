//! The admin panel against the accumulated need mood of issue 355
//! ([AP-cmd-post] and [AP-undo] in `docs/specs/2026-11-20-admin-panel.md`).
//! No edit writes a person's need mood balance. A need edit changes only
//! what accrues on later ticks, as refilling a need in play does. These
//! tests prove that every edit that writes a need keeps the balance, saves
//! at schema 28 and reloads with the same hash, and that Undo restores the
//! balance with the rest of the world. A schema 24 baseline would drop it,
//! so the rebuilt world would not match the hash recorded at open.
use crate::admin_test_support::*;
use crate::need_mood::NeedMood;
use crate::Sim;
use terri_core::admin::AdminEdit;
use terri_core::{NeedId, Needs, NEED_COUNT, NEED_MAX};

/// The shipped lot with a balance on every person, the first one negative
/// and the rest positive, then the panel open.
fn with_balances() -> (Sim, Vec<u32>) {
    let mut sim = Sim::new_from_shipped_lot();
    let ids = people(&mut sim);
    for (index, &id) in ids.iter().enumerate() {
        let units = if index == 0 { -90_000 } else { 30_000 };
        let entity = entity_of(&sim, id);
        sim.world_mut().entity_mut(entity).insert(NeedMood(units));
    }
    sim.begin_admin().expect("the shipped lot opens the panel");
    (sim, ids)
}

fn balances(sim: &Sim, ids: &[u32]) -> Vec<Option<NeedMood>> {
    ids.iter()
        .map(|&id| sim.world().get::<NeedMood>(entity_of(sim, id)).copied())
        .collect()
}

/// A need set to 0, a need set low but above 0, and Fill needs: the ways
/// the Housemate tab writes needs.
fn need_changes(sim: u32) -> Vec<Vec<AdminEdit>> {
    let set = |need: NeedId, value| AdminEdit::SetNeed {
        sim,
        need: need.index() as u8,
        value,
    };
    vec![
        vec![set(NeedId::Hunger, 0.0)],
        vec![set(NeedId::Energy, 1.0)],
        (0..NEED_COUNT)
            .map(|need| AdminEdit::SetNeed {
                sim,
                need: need as u8,
                value: NEED_MAX,
            })
            .collect(),
    ]
}

#[test]
fn need_edits_keep_each_balance_and_survive_a_schema_28_save() {
    let (mut sim, ids) = with_balances();
    let held = balances(&sim, &ids);
    assert!(held.iter().all(Option::is_some), "every person holds one");
    for edits in need_changes(ids[0]) {
        let depth = sim.admin_undo_depth();
        let before = sim.world_hash();
        assert_eq!(sim.admin_apply(change(edits.clone())), Ok(depth + 1));
        assert_ne!(sim.world_hash(), before, "{edits:?} moves the hash");
        assert_eq!(balances(&sim, &ids), held, "{edits:?} keeps every balance");
        let snapshot = sim.try_save_snapshot_v28().expect("saves");
        assert_eq!(snapshot.need_mood.len(), ids.len(), "{edits:?}");
        let mut loaded = Sim::new_from_shipped_lot();
        loaded.load_snapshot_v28(snapshot).expect("the save loads");
        assert_eq!(loaded.world_hash(), sim.world_hash(), "{edits:?}");
        assert_eq!(balances(&loaded, &ids), held, "{edits:?}");
    }
}

#[test]
fn undo_after_need_edits_restores_each_balance_and_hash_exactly() {
    let (mut sim, ids) = with_balances();
    let held = balances(&sim, &ids);
    let mut hashes = vec![sim.world_hash()];
    for edits in need_changes(ids[0]) {
        sim.admin_apply(change(edits)).expect("applies");
        hashes.push(sim.world_hash());
    }
    hashes.pop();
    while let Some(expected) = hashes.pop() {
        sim.admin_undo().expect("undoes");
        assert_eq!(sim.world_hash(), expected);
        assert_eq!(balances(&sim, &ids), held);
    }
    assert_eq!(sim.admin_undo_depth(), 0);
}

/// After the panel closes, an emptied need charges the balance from the next
/// minute, as a need emptied in play does, and a save taken right after the
/// edit continues identically.
#[test]
fn an_emptied_need_charges_the_balance_after_the_panel_closes() {
    let (mut live, ids) = with_balances();
    let first = ids[0];
    live.admin_apply(change(vec![AdminEdit::SetNeed {
        sim: first,
        need: NeedId::Hunger.index() as u8,
        value: 0.0,
    }]))
    .expect("applies");
    let snapshot = live.try_save_snapshot_v28().expect("saves");
    live.end_admin();
    let mut loaded = Sim::new_from_shipped_lot();
    loaded.load_snapshot_v28(snapshot).expect("loads");
    let start = balances(&live, &[first])[0].expect("a balance").0;
    let loss = live
        .world()
        .resource::<crate::Content>()
        .0
        .need_mood
        .empty_loss_units;
    live.tick();
    loaded.tick();
    let hunger = live
        .world()
        .get::<Needs>(entity_of(&live, first))
        .unwrap()
        .get(NeedId::Hunger);
    assert_eq!(hunger, 0.0, "Hunger stays empty for the minute");
    let after = balances(&live, &[first])[0].expect("a balance").0;
    let gain = live
        .world()
        .resource::<crate::Content>()
        .0
        .need_mood
        .high_gain_units;
    assert!(
        after < start && after >= start - loss,
        "the empty Hunger charged up to {loss} units, less up to {gain} per full need: {start} to {after}"
    );
    for tick in 0..120 {
        assert_eq!(live.world_hash(), loaded.world_hash(), "tick {tick}");
        live.tick();
        loaded.tick();
    }
}

/// [AP-cmd-post]: the post-condition holds the need mood rows to the
/// loader's checks, so a balance no load would accept refuses the change as
/// `WouldNotLoad` and the last good world comes back.
#[test]
fn the_post_condition_refuses_a_balance_the_loader_would_refuse() {
    use crate::admin::{AdminApplyRefusal, AdminRefusal};
    let (mut sim, ids) = with_balances();
    let baseline = sim.world_hash();
    let held = balances(&sim, &ids);
    assert_eq!(crate::save::v27::validate_live(sim.world()), Ok(()));
    let first = entity_of(&sim, ids[0]);
    sim.world_mut()
        .entity_mut(first)
        .insert(NeedMood(crate::need_mood::MAX_UNITS + 1));
    assert_eq!(
        crate::save::v27::validate_live(sim.world()),
        Err(crate::SaveError::InvalidValue)
    );
    assert_eq!(
        sim.admin_apply(change(vec![AdminEdit::SetNeed {
            sim: ids[0],
            need: NeedId::Fun.index() as u8,
            value: 10.0,
        }])),
        Err(AdminApplyRefusal {
            edit: 0,
            reason: AdminRefusal::WouldNotLoad,
        })
    );
    assert_eq!(sim.world_hash(), baseline, "the last good world is back");
    assert_eq!(balances(&sim, &ids), held);
    assert!(!sim.admin_broken());
}
