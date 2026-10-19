//! Shifts - issue 296 (`docs/specs/2026-10-18-shifts-and-careers.md`). A
//! person holds one shift of their level, by index into the level's
//! shifts: 0 is the level's own standard shift. A hire draws it from the
//! level's weights on the shift stream, which nothing else draws, so a
//! player's shift choices never move a later search or review; a level
//! change keeps it when the new level offers it. Every reader of a job's
//! hours asks [`shift_of`].
use bevy_ecs::prelude::*;
use terri_core::SimId;
use terri_data::{CompiledCareer, ContentPack, ShiftView};

use crate::careers::{job_of, Careers};

/// The seed the shift stream starts from in a new game and in a save from
/// before shifts.
pub const SHIFTS_SEED: u64 = 0x5348_4946_5453_3031;

/// The shift a hire at `job` takes ([WS-choose] steps 4 and 5): with one
/// shift offered, that shift and no draw; otherwise one `range(total)` on
/// the shift stream over the offered shifts' weights, standard first, and
/// the first shift whose running sum of weights exceeds the draw.
pub fn draw(careers: &mut Careers, job: &CompiledCareer) -> u32 {
    let offered: Vec<ShiftView<'_>> = (0..job.shift_count())
        .filter_map(|index| job.shift(index))
        .filter(|shift| shift.weight > 0)
        .collect();
    let Some(first) = offered.first() else {
        // The compiler refuses a level that offers nothing; a hand-built
        // one holds its standard shift.
        return 0;
    };
    if offered.len() == 1 {
        return first.index as u32;
    }
    let total: u32 = offered.iter().map(|shift| shift.weight).sum();
    careers.shift_draws += 1;
    let draw = careers.shift_rng.range(total as usize) as u32;
    let mut running = 0;
    let mut chosen = first.index;
    for shift in &offered {
        chosen = shift.index;
        running += shift.weight;
        if draw < running {
            break;
        }
    }
    chosen as u32
}

/// The shift a person holding shift `held` of `from` takes at `to` on a
/// promotion or a demotion ([WS-choose] step 3): the same id when `to`
/// offers it, with `to`'s times, and otherwise a draw from `to`.
pub fn keep_or_draw(
    careers: &mut Careers,
    from: &CompiledCareer,
    held: u32,
    to: &CompiledCareer,
) -> u32 {
    let kept = from
        .shift(held as usize)
        .and_then(|shift| to.shift_index(shift.id))
        .filter(|index| to.offers(*index));
    match kept {
        Some(index) => index as u32,
        None => draw(careers, to),
    }
}

/// The shift `entity` works: the held shift of their level, or the
/// standard shift when they hold no record (a hand-built world, or a
/// household worker before their first shift). `None` for the unemployed.
pub fn shift_of<'a>(world: &World, pack: &'a ContentPack, entity: Entity) -> Option<ShiftView<'a>> {
    let job = job_of(world, pack, entity)?;
    let held = world
        .get::<SimId>(entity)
        .and_then(|sim| world.get_resource::<Careers>()?.record(*sim))
        .map_or(0, |record| record.shift);
    job.shift(held as usize).or_else(|| job.shift(0))
}

#[cfg(test)]
#[path = "shift_tests.rs"]
mod shift_tests;
