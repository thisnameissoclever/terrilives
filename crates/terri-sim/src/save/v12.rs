//! Fights ride the schema-eleven envelope - issue 248.
use super::SaveError;
use crate::{fights::Fights, moodlet_timers::MoodletTimers, Sim};
use terri_core::{save_v12::SavedFight, SaveSnapshotV12, SimId};

pub(crate) fn capture(sim: &Sim) -> SaveSnapshotV12 {
    SaveSnapshotV12 {
        legacy: super::v11::capture(sim),
        fights: sim
            .world()
            .resource::<Fights>()
            .entries()
            .iter()
            .map(|(id, until)| SavedFight {
                sim: id.0,
                until_tick: *until,
            })
            .collect(),
    }
}

/// Rows must name living people, once each, in id order, with end ticks no
/// further ahead than the longest moodlet allowed; anything else refuses
/// the whole save before the live world is touched.
pub(crate) fn restore(
    snapshot: SaveSnapshotV12,
    content: &'static terri_data::ContentPack,
    portals: super::Carried,
) -> Result<Sim, SaveError> {
    let rows = snapshot.fights;
    if rows.len() > super::MAX_ENTITIES || rows.windows(2).any(|pair| pair[0].sim >= pair[1].sim) {
        return Err(SaveError::InvalidValue);
    }
    let mut candidate = super::v11::restore(snapshot.legacy, content, portals)?;
    let now = candidate.world().resource::<terri_core::SimClock>().tick;
    if rows.iter().any(|row| {
        row.until_tick > now.saturating_add(super::v11::LONGEST_MOODLET_TICKS)
            || crate::edit::living_entity(candidate.world(), row.sim).is_none()
    }) {
        return Err(SaveError::InvalidValue);
    }
    candidate
        .world_mut()
        .insert_resource(Fights::from_timers(MoodletTimers::from_entries(
            rows.into_iter()
                .map(|row| (SimId(row.sim), row.until_tick))
                .collect(),
        )));
    Ok(candidate)
}

#[cfg(test)]
mod tests {
    use super::*;
    use terri_core::SimClock;

    fn shipped_with_a_fight() -> Sim {
        let mut sim = Sim::new_from_shipped_lot();
        sim.world_mut().resource_mut::<SimClock>().tick = 40;
        sim.world_mut()
            .resource_mut::<Fights>()
            .record(SimId(1), 300);
        sim
    }

    /// Schema twelve carries the fights through a save and load, with the
    /// world digest unchanged; a schema-eleven snapshot of the same world
    /// loads with none.
    #[test]
    fn schema_twelve_round_trips_fights_and_schema_eleven_loads_with_none() {
        let sim = shipped_with_a_fight();
        let snapshot = sim.save_snapshot_v12();
        assert_eq!(
            snapshot.fights,
            vec![SavedFight {
                sim: 1,
                until_tick: 300
            }]
        );
        let mut restored = Sim::new_from_shipped_lot();
        restored.load_snapshot_v12(snapshot).expect("loads");
        assert_eq!(
            restored.world().resource::<Fights>(),
            sim.world().resource::<Fights>()
        );
        assert_eq!(restored.world_hash(), sim.world_hash());
        assert!(restored
            .mood_of(
                crate::edit::living_entity(restored.world(), 1)
                    .unwrap()
                    .index_u32()
            )
            .unwrap()
            .moodlets
            .iter()
            .any(|m| m.label == crate::mood::HAD_A_FIGHT));

        let mut eleven = Sim::new_from_shipped_lot();
        eleven
            .load_snapshot_v11(sim.save_snapshot_v11())
            .expect("loads");
        assert!(eleven.world().resource::<Fights>().entries().is_empty());
        assert_ne!(
            eleven.world_hash(),
            sim.world_hash(),
            "the fight is in the digest"
        );
    }

    /// A person who dies takes their row with them, so a save taken after
    /// the death still loads.
    #[test]
    fn a_dead_persons_row_is_forgotten_so_the_save_still_loads() {
        let mut sim = shipped_with_a_fight();
        let person = crate::edit::living_entity(sim.world(), 1).unwrap();
        crate::mortality::remove_person(sim.world_mut(), person);
        assert!(sim.world().resource::<Fights>().entries().is_empty());
        let snapshot = sim.save_snapshot_v12();
        assert!(snapshot.fights.is_empty());
        let mut fresh = Sim::new_from_shipped_lot();
        assert_eq!(fresh.load_snapshot_v12(snapshot), Ok(()));
    }

    /// Rows that name nobody living, repeat a person, arrive out of order,
    /// or end further ahead than any moodlet can last refuse the whole
    /// load and leave the live world alone; the bound itself loads.
    #[test]
    fn schema_twelve_refuses_unknown_repeated_unsorted_or_endless_rows() {
        let sim = shipped_with_a_fight();
        let clean = sim.save_snapshot_v12();
        let bound = 40 + super::super::v11::LONGEST_MOODLET_TICKS;
        for rows in [
            vec![SavedFight {
                sim: 99,
                until_tick: 300,
            }],
            vec![SavedFight {
                sim: 1,
                until_tick: bound + 1,
            }],
            vec![
                SavedFight {
                    sim: 1,
                    until_tick: 300,
                },
                SavedFight {
                    sim: 1,
                    until_tick: 301,
                },
            ],
            vec![
                SavedFight {
                    sim: 2,
                    until_tick: 300,
                },
                SavedFight {
                    sim: 1,
                    until_tick: 300,
                },
            ],
        ] {
            let mut target = Sim::new_from_shipped_lot();
            let before = target.world_hash();
            let mut snapshot = clean.clone();
            snapshot.fights = rows;
            assert!(target.load_snapshot_v12(snapshot).is_err());
            assert_eq!(target.world_hash(), before);
        }
        let mut at_bound = clean.clone();
        at_bound.fights = vec![SavedFight {
            sim: 1,
            until_tick: bound,
        }];
        let mut target = Sim::new_from_shipped_lot();
        assert!(target.load_snapshot_v12(at_bound).is_ok());
    }
}
