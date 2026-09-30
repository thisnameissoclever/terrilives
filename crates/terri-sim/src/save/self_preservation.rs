//! Instinct persistence and one-time migration of older people.
use super::SaveError;
use bevy_ecs::prelude::*;
use terri_core::{Agent, SelfPreservation, SimRng};

pub(crate) fn capture(world: &World) -> Vec<(u32, u8)> {
    let mut rows = world
        .try_query::<(Entity, &Agent, &SelfPreservation)>()
        .map_or_else(Vec::new, |mut query| {
            query
                .iter(world)
                .map(|(entity, _, instinct)| (entity.index_u32(), instinct.0))
                .collect()
        });
    rows.sort_unstable_by_key(|row| row.0);
    rows
}

pub(crate) fn restore(world: &mut World, rows: Vec<(u32, u8)>) -> Result<(), SaveError> {
    if rows.windows(2).any(|pair| pair[0].0 >= pair[1].0) {
        return Err(SaveError::InvalidValue);
    }
    let mut checked = Vec::with_capacity(rows.len());
    for (index, instinct) in rows {
        let entity = bevy_ecs::entity::EntityIndex::from_raw_u32(index)
            .map(|index| world.entities().resolve_from_index(index))
            .filter(|&entity| world.get::<Agent>(entity).is_some())
            .ok_or(SaveError::InvalidValue)?;
        if instinct > 100 {
            return Err(SaveError::InvalidValue);
        }
        checked.push((entity, instinct));
    }
    for (entity, instinct) in checked {
        world.entity_mut(entity).insert(SelfPreservation(instinct));
    }
    Ok(())
}

pub(crate) fn migrate(world: &mut World) {
    let mut query = world.query_filtered::<Entity, (With<Agent>, Without<SelfPreservation>)>();
    let mut people: Vec<_> = query.iter(world).collect();
    people.sort_unstable_by_key(|entity| entity.index_u32());
    for entity in people {
        let instinct = 30 + world.resource_mut::<SimRng>().range(41) as u8;
        world.entity_mut(entity).insert(SelfPreservation(instinct));
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::Sim;

    #[test]
    fn self_preservation_migration_draws_stably_then_persists_zero_without_redraw() {
        let mut source = Sim::new_from_shipped_lot_with_seed(91);
        let mut snapshot = source.save_snapshot_v5();
        let indices: Vec<_> = snapshot.self_preservation.iter().map(|row| row.0).collect();
        snapshot.self_preservation = vec![(indices[1], 0)];
        let mut reference = snapshot.world.rng.clone();
        let expected = vec![
            (indices[0], 30 + reference.range(41) as u8),
            (indices[1], 0),
            (indices[2], 30 + reference.range(41) as u8),
        ];
        source.load_snapshot_v5(snapshot).unwrap();
        assert_eq!(source.save_snapshot_v5().self_preservation, expected);
        assert_eq!(source.world().resource::<SimRng>(), &reference);
        let hash = source.world_hash();
        source.load_snapshot_v5(source.save_snapshot_v5()).unwrap();
        assert_eq!(source.world_hash(), hash);
        assert_eq!(source.world().resource::<SimRng>(), &reference);
    }

    #[test]
    fn self_preservation_all_legacy_versions_adopt_restored_rng_before_migration() {
        let source = Sim::new_from_shipped_lot_with_seed(1009);
        let saved = source.save_snapshot_v5();
        let mut reference = saved.world.rng.clone();
        let expected: Vec<_> = saved
            .self_preservation
            .iter()
            .map(|row| (row.0, 30 + reference.range(41) as u8))
            .collect();
        for version in 1..=4 {
            let mut loaded = Sim::new_from_shipped_lot_with_seed(777);
            match version {
                1 => loaded.load_snapshot(source.save_snapshot()).unwrap(),
                2 => loaded.load_snapshot_v2(source.save_snapshot_v2()).unwrap(),
                3 => loaded.load_snapshot_v3(source.save_snapshot_v3()).unwrap(),
                4 => loaded.load_snapshot_v4(source.save_snapshot_v4()).unwrap(),
                _ => unreachable!(),
            }
            assert_eq!(
                loaded.save_snapshot_v5().self_preservation,
                expected,
                "schema {version}"
            );
            assert_eq!(
                loaded.world().resource::<SimRng>(),
                &reference,
                "schema {version}"
            );
        }
    }

    #[test]
    fn self_preservation_corrupt_rows_refuse_transactionally() {
        let mut live = Sim::new_from_shipped_lot();
        let good = live.save_snapshot_v5();
        let (first, value) = good.self_preservation[0];
        let (last, _) = good.self_preservation[2];
        let object = good
            .world
            .entities
            .iter()
            .find(|row| !row.agent)
            .unwrap()
            .index;
        for rows in [
            vec![(first, value), (first, value)],
            vec![(last, 50), (first, 50)],
            vec![(object, 50)],
            vec![(u32::MAX, 50)],
            vec![(first, 101)],
        ] {
            let mut bad = good.clone();
            bad.self_preservation = rows;
            assert!(live.load_snapshot_v5(bad).is_err());
            assert_eq!(live.save_snapshot_v5(), good);
        }
    }

    #[test]
    fn self_preservation_invalid_staged_override_refuses_transactionally() {
        let mut live = Sim::new_from_shipped_lot();
        let good = live.save_snapshot_v5();
        let mut bad = good.clone();
        bad.world
            .queued_commands
            .push(terri_core::SavedCommand::AddHousemateWithInstinct {
                name: "Ann".into(),
                personality: Some("the_settled".into()),
                traits: vec![],
                instinct: 101,
            });
        assert!(live.load_snapshot_v5(bad).is_err());
        assert_eq!(live.save_snapshot_v5(), good);
    }
}
