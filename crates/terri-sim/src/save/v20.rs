//! Current behavioral memory is validated after all frozen world records restore.
use super::SaveError;
use crate::Sim;
use terri_core::SaveSnapshotV20;

pub(crate) fn capture(sim: &Sim) -> SaveSnapshotV20 {
    SaveSnapshotV20 {
        legacy: super::v19::capture(sim),
        conflicts: crate::social_conflicts::snapshot(sim.world()),
    }
}
pub(crate) fn capture_without_commands(sim: &Sim) -> SaveSnapshotV20 {
    SaveSnapshotV20 {
        legacy: super::v19::capture_without_commands(sim),
        conflicts: crate::social_conflicts::snapshot(sim.world()),
    }
}
pub(crate) fn restore(
    snapshot: SaveSnapshotV20,
    content: &'static terri_data::ContentPack,
    mut carried: super::Carried,
) -> Result<Sim, SaveError> {
    carried.current_fight_topics = true;
    let mut candidate = super::v19::restore(snapshot.legacy, content, carried)?;
    crate::social_conflicts::restore(candidate.world_mut(), snapshot.conflicts)?;
    Ok(candidate)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn issue314_current_envelope_round_trips_without_invented_history() {
        let source = Sim::new_with_lot(7, 7);
        let snapshot = capture(&source);
        assert_eq!(snapshot.conflicts, Default::default());
        let restored = restore(
            snapshot.clone(),
            terri_data::pack(),
            super::super::Carried::for_load(source.world()),
        )
        .unwrap();
        assert_eq!(capture(&restored), snapshot);
        assert_eq!(restored.world_hash(), source.world_hash());
    }
    #[test]
    fn issue314_zero_conflict_allocator_refuses_atomically() {
        let mut source = Sim::new_with_lot(7, 7);
        let before = source.save_snapshot_v20();
        let mut invalid = before.clone();
        invalid.conflicts.next_id = 0;
        assert!(source.load_snapshot_v20(invalid).is_err());
        assert_eq!(source.save_snapshot_v20(), before);
    }
}
