//! The lot frame and the cents ride the schema-twelve envelope - issue 254.
use super::SaveError;
use crate::{lot_frame::LotFrame, portals::ActivePortals, Sim};
use terri_core::{save_v13::SavedLotFrame, Funds, SaveSnapshotV13, TileGrid};

pub(crate) fn capture(sim: &Sim) -> SaveSnapshotV13 {
    SaveSnapshotV13 {
        legacy: super::v12::capture(sim),
        lot_frame: crate::lot_frame::frame(sim.world()).map(|frame| SavedLotFrame {
            origin_x: frame.origin.0,
            origin_y: frame.origin.1,
            purchased_area: frame.purchased_area,
        }),
        funds_cents: sim.world().resource::<Funds>().0,
    }
}

/// The frame must keep the house on the grid, the purchased area must fit
/// the grid, and the cents must agree with the whole dollars the older
/// field carries; anything else refuses the whole save before the live
/// world is touched.
pub(crate) fn restore(
    snapshot: SaveSnapshotV13,
    content: &'static terri_data::ContentPack,
    portals: Option<ActivePortals>,
) -> Result<Sim, SaveError> {
    let saved_dollars = snapshot.legacy.legacy.legacy.legacy.legacy.world.funds;
    if Funds(snapshot.funds_cents).dollars() != saved_dollars {
        return Err(SaveError::InvalidValue);
    }
    let mut candidate = super::v12::restore(snapshot.legacy, content, portals)?;
    let (width, height) = {
        let grid = candidate.world().resource::<TileGrid>();
        (grid.width() as u32, grid.height() as u32)
    };
    match snapshot.lot_frame {
        Some(frame) => {
            let (house_width, house_height) = content.lot.house;
            let fits = frame
                .origin_x
                .checked_add(house_width)
                .is_some_and(|right| right <= width)
                && frame
                    .origin_y
                    .checked_add(house_height)
                    .is_some_and(|bottom| bottom <= height)
                && u64::from(frame.purchased_area) <= u64::from(width) * u64::from(height);
            if !fits {
                return Err(SaveError::InvalidValue);
            }
            candidate.world_mut().insert_resource(LotFrame {
                origin: (frame.origin_x, frame.origin_y),
                purchased_area: frame.purchased_area,
            });
        }
        None => {
            if crate::lot_frame::frame(candidate.world()).is_some() {
                // A saved absence on a grid shaped like the content lot
                // contradicts the shape rule every older save relies on.
                return Err(SaveError::InvalidValue);
            }
        }
    }
    candidate
        .world_mut()
        .insert_resource(Funds(snapshot.funds_cents));
    Ok(candidate)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn grown() -> Sim {
        let mut sim = crate::test_content::without_owned_books(Sim::new_from_shipped_lot());
        crate::chores::ensure(sim.world_mut());
        sim.world_mut().insert_resource(Funds(123_456_78));
        crate::land::buy(sim.world_mut(), crate::land::Side::Rear).expect("affordable");
        sim
    }

    /// Schema thirteen carries the frame and the cents through a save and
    /// load with the digest unchanged; the older funds field holds the
    /// dollars rounded down.
    #[test]
    fn schema_thirteen_round_trips_the_frame_and_the_cents() {
        let sim = grown();
        let snapshot = sim.save_snapshot_v13();
        assert_eq!(
            snapshot.lot_frame,
            Some(SavedLotFrame {
                origin_x: 10,
                origin_y: 0,
                purchased_area: 160
            })
        );
        let cents = 123_456_78 - 160 * 15_000;
        assert_eq!(snapshot.funds_cents, cents);
        assert_eq!(
            snapshot.legacy.legacy.legacy.legacy.legacy.world.funds,
            cents.div_euclid(100)
        );
        let mut restored = Sim::new_from_shipped_lot();
        restored.load_snapshot_v13(snapshot).expect("loads");
        assert_eq!(
            crate::lot_frame::frame(restored.world()),
            crate::lot_frame::frame(sim.world())
        );
        assert_eq!(restored.funds(), cents);
        assert_eq!(restored.world_hash(), sim.world_hash());
        assert_eq!(
            crate::lot_frame::house(restored.world()).map(|h| (h.x, h.y)),
            Some((10, 0))
        );
    }

    /// A schema-twelve payload loads with the frame its grid implies and
    /// its dollars times a hundred; a grown lot saved as schema twelve
    /// loads with no house, as the shape rule says.
    #[test]
    fn schema_twelve_loads_with_the_implied_frame_and_dollars_times_a_hundred() {
        let mut sim = Sim::new_from_shipped_lot();
        sim.world_mut().insert_resource(Funds(98_765));
        let mut restored = Sim::new_from_shipped_lot();
        restored
            .load_snapshot_v12(sim.save_snapshot_v12())
            .expect("loads");
        assert_eq!(restored.funds(), 987 * 100);
        assert_eq!(
            crate::lot_frame::frame(restored.world()).map(|f| f.origin),
            Some((0, 0))
        );
        let grown = grown();
        let mut old = Sim::new_from_shipped_lot();
        old.load_snapshot_v12(grown.save_snapshot_v12())
            .expect("loads");
        assert_eq!(crate::lot_frame::house(old.world()), None);
    }

    /// A frame that would push the house off the grid, a purchased area
    /// larger than the grid, cents that disagree with the dollars, or no
    /// frame on a content-shaped grid refuse the whole load.
    #[test]
    fn schema_thirteen_refuses_a_bad_frame_or_disagreeing_cents() {
        let sim = grown();
        let clean = sim.save_snapshot_v13();
        let cases: Vec<(&str, Box<dyn Fn(&mut SaveSnapshotV13)>)> = vec![
            (
                "house off the grid",
                Box::new(|s| s.lot_frame.as_mut().unwrap().origin_x = 15),
            ),
            (
                "house below the grid",
                Box::new(|s| s.lot_frame.as_mut().unwrap().origin_y = 5),
            ),
            (
                "area past the grid",
                Box::new(|s| s.lot_frame.as_mut().unwrap().purchased_area = 30 * 16 + 1),
            ),
            ("cents off by a dollar", Box::new(|s| s.funds_cents += 100)),
            (
                "cents below the dollars",
                Box::new(|s| s.funds_cents -= 100),
            ),
        ];
        for (case, change) in cases {
            let mut invalid = clean.clone();
            change(&mut invalid);
            let mut live = Sim::new_from_shipped_lot();
            let before = live.world_hash();
            assert!(live.load_snapshot_v13(invalid).is_err(), "{case}");
            assert_eq!(live.world_hash(), before, "{case}");
        }
        let mut no_frame = Sim::new_from_shipped_lot().save_snapshot_v13();
        no_frame.lot_frame = None;
        let mut live = Sim::new_from_shipped_lot();
        assert!(live.load_snapshot_v13(no_frame).is_err());
        // Cents within the dollar are fine, and a custom lot saves no frame.
        let mut within = clean.clone();
        within.funds_cents += 99 - within.funds_cents.rem_euclid(100);
        within.legacy.legacy.legacy.legacy.legacy.world.funds = Funds(within.funds_cents).dollars();
        let mut live = Sim::new_from_shipped_lot();
        assert!(live.load_snapshot_v13(within).is_ok());
        let custom = Sim::new_with_lot(6, 4);
        assert_eq!(custom.save_snapshot_v13().lot_frame, None);
    }
}
