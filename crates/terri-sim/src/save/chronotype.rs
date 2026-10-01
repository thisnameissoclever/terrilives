//! Exact per-person sleep schedules, without changing frozen entity records.
use super::SaveError;
use bevy_ecs::prelude::*;
use terri_core::{Agent, Personality};

pub(crate) fn capture(world: &World) -> Vec<(u32, i32)> {
    let mut rows = world
        .try_query::<(Entity, &Agent, &Personality)>()
        .map_or_else(Vec::new, |mut query| {
            query
                .iter(world)
                .filter(|(_, _, personality)| personality.chronotype_offset_ticks != 0)
                .map(|(entity, _, personality)| {
                    (entity.index_u32(), personality.chronotype_offset_ticks)
                })
                .collect()
        });
    rows.sort_unstable_by_key(|row| row.0);
    rows
}

pub(crate) fn restore(world: &mut World, rows: Vec<(u32, i32)>) -> Result<(), SaveError> {
    if rows.windows(2).any(|pair| pair[0].0 >= pair[1].0) {
        return Err(SaveError::InvalidValue);
    }
    let mut checked = Vec::with_capacity(rows.len());
    for (index, offset) in rows {
        let entity = bevy_ecs::entity::EntityIndex::from_raw_u32(index)
            .map(|index| world.entities().resolve_from_index(index))
            .filter(|&entity| world.get::<Agent>(entity).is_some())
            .filter(|&entity| world.get::<Personality>(entity).is_some())
            .ok_or(SaveError::InvalidValue)?;
        if offset == 0 {
            return Err(SaveError::InvalidValue);
        }
        checked.push((entity, offset));
    }
    for (entity, offset) in checked {
        world
            .get_mut::<Personality>(entity)
            .unwrap()
            .chronotype_offset_ticks = offset;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::Sim;

    #[test]
    fn chronotype_rows_reject_duplicates_disorder_zero_and_nonpeople_atomically() {
        let mut live = Sim::new_from_shipped_lot();
        let good = live.save_snapshot_v5();
        let people: Vec<_> = good.self_preservation.iter().map(|row| row.0).collect();
        let object = good
            .world
            .entities
            .iter()
            .find(|row| !row.agent)
            .unwrap()
            .index;
        for rows in [
            vec![(people[0], -90), (people[0], 180)],
            vec![(people[1], -90), (people[0], 180)],
            vec![(people[0], 0)],
            vec![(object, -90)],
            vec![(u32::MAX, -90)],
        ] {
            let mut bad = good.clone();
            bad.chronotype_offsets = rows.clone();
            assert_eq!(
                live.load_snapshot_v5(bad),
                Err(SaveError::InvalidValue),
                "{rows:?}"
            );
            assert_eq!(live.save_snapshot_v5(), good);
        }
    }

    #[test]
    fn chronotype_restore_requires_personality_and_agent_independently() {
        let mut world = World::new();
        let agent_only = world.spawn(Agent).id();
        let personality_only = world.spawn(Personality::default()).id();
        for entity in [agent_only, personality_only] {
            let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
                restore(&mut world, vec![(entity.index_u32(), -90)])
            }));
            assert!(
                matches!(result, Ok(Err(SaveError::InvalidValue))),
                "invalid references must return an error, not panic or load"
            );
        }
    }

    #[test]
    fn chronotype_capture_sorts_storage_order_and_omits_zero() {
        let mut world = World::new();
        let first = world.spawn(Agent).id();
        let second = world.spawn((Agent, Personality::default())).id();
        let zero = world.spawn((Agent, Personality::default())).id();
        let mut early = Personality::default();
        early.chronotype_offset_ticks = -90;
        world.entity_mut(first).insert(early);
        world
            .get_mut::<Personality>(second)
            .unwrap()
            .chronotype_offset_ticks = 180;
        assert_eq!(
            capture(&world),
            vec![(first.index_u32(), -90), (second.index_u32(), 180)]
        );
        assert_eq!(
            world
                .get::<Personality>(zero)
                .unwrap()
                .chronotype_offset_ticks,
            0
        );
    }

    #[test]
    fn chronotype_legacy_versions_keep_zero_instead_of_current_content() {
        let source = Sim::new_from_shipped_lot();
        assert!(!source.save_snapshot_v5().chronotype_offsets.is_empty());
        for version in 1..=5 {
            let mut loaded = Sim::new_from_shipped_lot();
            match version {
                1 => loaded.load_snapshot(source.save_snapshot()).unwrap(),
                2 => loaded.load_snapshot_v2(source.save_snapshot_v2()).unwrap(),
                3 => loaded.load_snapshot_v3(source.save_snapshot_v3()).unwrap(),
                4 => loaded.load_snapshot_v4(source.save_snapshot_v4()).unwrap(),
                _ => {
                    let mut old = source.save_snapshot_v5();
                    old.chronotype_offsets.clear();
                    let rng = old.world.rng.clone();
                    loaded.load_snapshot_v5(old).unwrap();
                    assert_eq!(loaded.save_snapshot_v5().world.rng, rng);
                }
            }
            assert!(capture(loaded.world()).is_empty(), "V{version}");
            let mut people = loaded
                .world()
                .try_query::<(&Agent, &Personality)>()
                .unwrap();
            assert_eq!(people.iter(loaded.world()).count(), 3);
            assert!(people
                .iter(loaded.world())
                .all(|(_, p)| p.chronotype_offset_ticks == 0));
        }
    }
}
