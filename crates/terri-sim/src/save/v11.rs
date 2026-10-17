//! Burnt meals ride the schema-ten envelope - issue 243.
use super::SaveError;
use crate::{burnt_meals::BurntMeals, portals::ActivePortals, Sim};
use terri_core::{save_v11::SavedBurntMeal, SaveSnapshotV11, SimId};

pub(crate) fn capture(sim: &Sim) -> SaveSnapshotV11 {
    SaveSnapshotV11 {
        legacy: super::v10::capture(sim),
        burnt_meals: sim
            .world()
            .resource::<BurntMeals>()
            .entries()
            .iter()
            .map(|(id, until)| SavedBurntMeal {
                sim: id.0,
                until_tick: *until,
            })
            .collect(),
    }
}

/// The longest moodlet any tuning may set, so a saved end tick can be
/// bounded without trusting the pack the save was written with.
const LONGEST_MOODLET_TICKS: u64 = 10_080;

/// Rows must name living people, once each, in id order, with end ticks no
/// further ahead than the longest moodlet allowed; anything else refuses
/// the whole save before the live world is touched.
pub(crate) fn restore(
    snapshot: SaveSnapshotV11,
    content: &'static terri_data::ContentPack,
    portals: Option<ActivePortals>,
) -> Result<Sim, SaveError> {
    let rows = snapshot.burnt_meals;
    if rows.len() > super::MAX_ENTITIES || rows.windows(2).any(|pair| pair[0].sim >= pair[1].sim) {
        return Err(SaveError::InvalidValue);
    }
    let mut candidate = super::v10::restore(snapshot.legacy, content, portals)?;
    let now = candidate.world().resource::<terri_core::SimClock>().tick;
    if rows.iter().any(|row| {
        row.until_tick > now.saturating_add(LONGEST_MOODLET_TICKS)
            || crate::edit::living_entity(candidate.world(), row.sim).is_none()
    }) {
        return Err(SaveError::InvalidValue);
    }
    candidate
        .world_mut()
        .insert_resource(BurntMeals::from_entries(
            rows.into_iter()
                .map(|row| (SimId(row.sim), row.until_tick))
                .collect(),
        ));
    Ok(candidate)
}

#[cfg(test)]
mod tests {
    use super::*;
    use terri_core::SimClock;

    fn shipped_with_a_burn() -> Sim {
        let mut sim = Sim::new_from_shipped_lot();
        sim.world_mut().resource_mut::<SimClock>().tick = 40;
        sim.world_mut()
            .resource_mut::<BurntMeals>()
            .record(SimId(1), 300);
        sim
    }

    /// Schema eleven carries the burnt meals through a save and load, with
    /// the world digest unchanged; a schema-ten snapshot of the same world
    /// loads with none.
    #[test]
    fn schema_eleven_round_trips_burnt_meals_and_schema_ten_loads_with_none() {
        let sim = shipped_with_a_burn();
        let snapshot = sim.save_snapshot_v11();
        assert_eq!(
            snapshot.burnt_meals,
            vec![SavedBurntMeal {
                sim: 1,
                until_tick: 300
            }]
        );
        let mut restored = Sim::new_from_shipped_lot();
        restored.load_snapshot_v11(snapshot).expect("loads");
        assert_eq!(
            restored.world().resource::<BurntMeals>(),
            sim.world().resource::<BurntMeals>()
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
            .any(|m| m.label == crate::mood::BURNT_DINNER));

        let mut ten = Sim::new_from_shipped_lot();
        ten.load_snapshot_v10(sim.save_snapshot_v10())
            .expect("loads");
        assert!(ten.world().resource::<BurntMeals>().entries().is_empty());
        assert_ne!(
            ten.world_hash(),
            sim.world_hash(),
            "the burn is in the digest"
        );
    }

    /// A cook who dies takes their row with them, so a save taken after
    /// the death still loads.
    #[test]
    fn a_dead_cooks_row_is_forgotten_so_the_save_still_loads() {
        let mut sim = shipped_with_a_burn();
        let cook = crate::edit::living_entity(sim.world(), 1).unwrap();
        crate::mortality::remove_person(sim.world_mut(), cook);
        assert!(sim.world().resource::<BurntMeals>().entries().is_empty());
        let snapshot = sim.save_snapshot_v11();
        assert!(snapshot.burnt_meals.is_empty());
        let mut fresh = Sim::new_from_shipped_lot();
        assert_eq!(fresh.load_snapshot_v11(snapshot), Ok(()));
    }

    /// Rows that name nobody living, repeat a person, arrive out of order,
    /// or end further ahead than any moodlet can last refuse the whole
    /// load and leave the live world alone.
    #[test]
    fn schema_eleven_refuses_unknown_repeated_unsorted_or_endless_rows() {
        let sim = shipped_with_a_burn();
        let clean = sim.save_snapshot_v11();
        for rows in [
            vec![SavedBurntMeal {
                sim: 99,
                until_tick: 300,
            }],
            vec![SavedBurntMeal {
                sim: 1,
                until_tick: 40 + LONGEST_MOODLET_TICKS + 1,
            }],
            vec![
                SavedBurntMeal {
                    sim: 1,
                    until_tick: 300,
                },
                SavedBurntMeal {
                    sim: 1,
                    until_tick: 301,
                },
            ],
            vec![
                SavedBurntMeal {
                    sim: 2,
                    until_tick: 300,
                },
                SavedBurntMeal {
                    sim: 1,
                    until_tick: 300,
                },
            ],
        ] {
            let mut target = Sim::new_from_shipped_lot();
            let before = target.world_hash();
            let mut snapshot = clean.clone();
            snapshot.burnt_meals = rows;
            assert!(target.load_snapshot_v11(snapshot).is_err());
            assert_eq!(target.world_hash(), before);
        }
    }
}
