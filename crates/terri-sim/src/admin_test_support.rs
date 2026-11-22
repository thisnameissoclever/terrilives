//! Helpers the admin edit tests share ([AP-tests-sim]): a session on the
//! shipped lot, the people in it, and the three checks every edit kind owes
//! (it applies and moves the hash, it survives a save, it draws nothing).
use crate::admin::AdminApplyRefusal;
use crate::Sim;
use bevy_ecs::prelude::*;
use terri_core::admin::{AdminChange, AdminEdit};
use terri_core::{Agent, CommandQueue, SimId, SimRng};

pub(crate) fn change(edits: Vec<AdminEdit>) -> AdminChange {
    AdminChange { edits }
}

/// The shipped lot with the panel open.
pub(crate) fn opened() -> Sim {
    let mut sim = Sim::new_from_shipped_lot();
    sim.begin_admin().expect("the shipped lot opens the panel");
    sim
}

/// Every living person's `SimId`, ascending.
pub(crate) fn people(sim: &mut Sim) -> Vec<u32> {
    let mut ids: Vec<u32> = sim
        .world_mut()
        .query::<(&Agent, &SimId)>()
        .iter(sim.world())
        .map(|(_, id)| id.0)
        .collect();
    ids.sort_unstable();
    ids
}

/// The living person's entity.
pub(crate) fn entity_of(sim: &Sim, id: u32) -> Entity {
    crate::edit::living_entity(sim.world(), id).expect("a living person")
}

/// Applies one edit as a change and checks it was admitted, moved the hash,
/// left the queue empty and added one journal entry.
pub(crate) fn applied(sim: &mut Sim, edit: AdminEdit) {
    let before = sim.world_hash();
    let depth = sim.admin_undo_depth();
    let result = sim.admin_apply(change(vec![edit.clone()]));
    assert_eq!(result, Ok(depth + 1), "{edit:?} applies");
    assert_ne!(sim.world_hash(), before, "{edit:?} moves the world hash");
    assert!(sim.world().resource::<CommandQueue>().is_empty());
}

/// Applies one edit and checks it was refused with `reason` at edit 0,
/// leaving the hash and the journal exactly as they were.
pub(crate) fn refused(sim: &mut Sim, edit: AdminEdit, reason: crate::admin::AdminRefusal) {
    let before = sim.world_hash();
    let depth = sim.admin_undo_depth();
    assert_eq!(
        sim.admin_apply(change(vec![edit.clone()])),
        Err(AdminApplyRefusal { edit: 0, reason }),
        "{edit:?} is refused"
    );
    assert_eq!(sim.world_hash(), before, "{edit:?} refused leaves the hash");
    assert_eq!(sim.admin_undo_depth(), depth);
    assert!(sim.world().resource::<CommandQueue>().is_empty());
}

/// [AP-tests-sim] item 3: a save of the world as it stands loads, and the
/// hash after the load equals the hash before.
pub(crate) fn assert_survives_save(sim: &Sim, what: &str) {
    let snapshot = sim
        .try_save_snapshot_v28()
        .unwrap_or_else(|error| panic!("{what}: nothing admin is queued ({error:?})"));
    let mut loaded = Sim::new_from_shipped_lot();
    loaded
        .load_snapshot_v28(snapshot)
        .unwrap_or_else(|error| panic!("{what}: the save loads ({error:?})"));
    assert_eq!(
        loaded.world_hash(),
        sim.world_hash(),
        "{what}: the loaded world hashes as the live one"
    );
}

/// Every random stream the world keeps: the world generator and the career
/// streams with their draw counts.
pub(crate) fn streams(sim: &Sim) -> (SimRng, SimRng, SimRng, u64, u64) {
    let careers = sim.world().resource::<crate::careers::Careers>();
    (
        sim.world().resource::<SimRng>().clone(),
        careers.rng.clone(),
        careers.shift_rng.clone(),
        careers.draws,
        careers.shift_draws,
    )
}

/// [AP-tests-sim] item 5 and the activity log: apply `changes` in a session,
/// Undo the last, and check the live activity log reads exactly as a twin's
/// that applied all but the last change and never undid anything.
pub(crate) fn assert_undo_keeps_the_activity_log_of_a_twin(
    build: impl Fn() -> Sim,
    changes: Vec<AdminChange>,
    what: &str,
) {
    let mut live = build();
    let mut twin = build();
    let last = changes.len() - 1;
    for (step, change) in changes.iter().enumerate() {
        live.admin_apply(change.clone())
            .unwrap_or_else(|refusal| panic!("{what}: change {step} applies ({refusal:?})"));
        if step < last {
            twin.admin_apply(change.clone()).unwrap();
        }
    }
    live.admin_undo().expect("the last change undoes");
    assert_eq!(
        live.world_hash(),
        twin.world_hash(),
        "{what}: the worlds agree"
    );
    let records = |sim: &Sim| -> Vec<[u32; crate::activity_log::RECORD_WORDS]> {
        sim.activity_log()
            .records()
            .map(|record| record.0)
            .collect()
    };
    assert_eq!(
        records(&live),
        records(&twin),
        "{what}: Undo leaves the live log as a never-undone twin's"
    );
    assert_eq!(
        live.activity_log().next_seq(),
        twin.activity_log().next_seq()
    );
    assert_eq!(live.activity_log().dropped(), twin.activity_log().dropped());
    live.end_admin();
    twin.end_admin();
    for tick in 0..60 {
        live.tick();
        twin.tick();
        assert_eq!(
            records(&live),
            records(&twin),
            "{what}: the logs stay together at tick {tick}"
        );
        assert_eq!(live.world_hash(), twin.world_hash(), "{what}: tick {tick}");
    }
}
