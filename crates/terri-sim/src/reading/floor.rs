//! Books left on the floor, and the book a late worker puts down
//! (`docs/specs/2026-11-19-late-book-returns.md`).
//!
//! Owner ruling 2026-11-17: at the lateness limit a reader still returning
//! a book drops it where they stand and leaves; housemates pick up floor
//! books and shelve them on their own.
//!
//! A floor book is a copy whose location is `BookLocation::Lot` and that
//! nobody has claimed. A free housemate walks to the nearest one, picks it
//! up and puts it back through the ordinary return: the same `Return`,
//! `WaitingReturn` and `Shelve` stages, contact reservations and save rules
//! as a reader's return. A housemate between activities with no need
//! critical goes first. The walk to the book is a plain path with no
//! target, like a stroll, and the claim on the book is that path: a book
//! whose tile ends someone's target-less path is taken. Both are saved
//! facts, so the rule reads no new saved state and draws no random number.
use super::*;

/// Tidying requires a housemate identity for the book loan, a position
/// for pickup, and an awake person at home with nothing under way.
pub(super) fn free_to_tidy(world: &World, person: Entity, now: u64) -> bool {
    let entity = world.entity(person);
    entity.contains::<Agent>()
        && entity.contains::<SimId>()
        && entity.contains::<Position>()
        && !entity.contains::<Target>()
        && !entity.contains::<Eating>()
        && !entity.contains::<ReadingJourney>()
        && !entity.contains::<AtWork>()
        && !entity.contains::<Commuting>()
        && !entity.contains::<ChainState>()
        && !entity.contains::<Socialising>()
        && !entity.contains::<Carrying>()
        && !entity.contains::<StepWork>()
        && !entity.contains::<Reserved>()
        && !entity.contains::<terri_core::chores::ChoreWork>()
        && !entity.contains::<crate::social_episode::requests::CommittedConversation>()
        && !entity.contains::<PendingShift>()
        && entity.get::<IntentQueue>().is_none_or(|q| q.is_empty())
        && !crate::player_actions::has_player_work(world, person)
        && !has_chore_task(world, person)
        && !due_at_work(world, person, now)
        && !shift_starts_soon(world, person, now)
}

/// A housemate with a chore on the board finishes it first; a journey may
/// not coexist with an unsuspended chore task.
fn has_chore_task(world: &World, person: Entity) -> bool {
    world
        .get_resource::<terri_core::chores::SavedChores>()
        .is_some_and(|state| {
            state
                .tasks
                .iter()
                .any(|task| task.person == person.index_u32() && !task.suspended)
        })
}

/// A worker whose shift is open is on the way out; tidying never holds them.
fn due_at_work(world: &World, person: Entity, now: u64) -> bool {
    let Some(id) = world.get::<SimId>(person) else {
        return false;
    };
    world
        .get_resource::<crate::attendance::Attendance>()
        .and_then(|attendance| attendance.shifts.get(id).cloned())
        .is_some_and(|shift| !shift.settled && shift.start_tick <= now && now < shift.end_tick)
}

/// A worker whose next shift starts within `work_lateness_limit_ticks`
/// does not start tidying, so a floor book never adds to their lateness:
/// the walk and the return could otherwise run into the start ([LB-floor]).
fn shift_starts_soon(world: &World, person: Entity, now: u64) -> bool {
    let (Some(sim), Some(career)) = (world.get::<SimId>(person), world.get::<Career>(person))
    else {
        return false;
    };
    let pack = world.resource::<Content>().0;
    let limit = u64::from(pack.tuning.work_lateness_limit_ticks);
    (now..=now + limit).any(|tick| {
        crate::shifts::shift_today(world, pack, person, tick).is_some_and(|shift| {
            crate::shifts::starts_at(world, pack, *sim, career.0, &shift, tick)
        })
    })
}

/// The tile a floor copy lies on.
fn tile_of(x: f32, y: f32) -> (i32, i32) {
    (x.round() as i32, y.round() as i32)
}

/// Floor copies nobody has claimed, in copy order, with their tiles.
fn floor_copies(world: &World) -> Vec<(BookCopyId, (i32, i32))> {
    world
        .get_resource::<BookLibrary>()
        .map(|library| {
            library
                .state()
                .copies
                .iter()
                .filter(|copy| copy.borrower.is_none())
                .filter_map(|copy| match copy.location {
                    BookLocation::Lot { x, y } => Some((copy.id, tile_of(x, y))),
                    _ => None,
                })
                .collect()
        })
        .unwrap_or_default()
}

/// The tiles already claimed: the last step of every target-less path.
fn claimed_tiles(world: &mut World) -> std::collections::BTreeSet<(i32, i32)> {
    world
        .query_filtered::<&Path, (With<Agent>, Without<Target>)>()
        .iter(world)
        .filter_map(|path| path.steps.last().copied())
        .collect()
}

/// Whether the floor copy at `tile` can be put back: it has a shelf slot
/// to go to (its own, or a free one), that bookcase exists, has no seats
/// and has a reading row for the return to target, and some legal contact
/// of the bookcase can be reached on foot from the book's tile. A tidier
/// therefore never picks up a book it cannot shelve ([LB-floor]).
fn shelvable(world: &World, copy: BookCopyId, tile: (i32, i32)) -> bool {
    let library = world.resource::<BookLibrary>();
    let Ok(Some(home)) =
        with_book_world(world, |context| Ok(library.floor_copy_home(copy, context)))
    else {
        return false;
    };
    let Some(shelf) = u32::try_from(home.shelf.0)
        .ok()
        .and_then(|index| crate::dining::entity(world, index))
    else {
        return false;
    };
    if shelf_reading_row(world, shelf).is_none() {
        return false;
    }
    let (Some(object), Some(at)) = (
        world.get::<SmartObject>(shelf),
        world.get::<Position>(shelf),
    ) else {
        return false;
    };
    let def = world.resource::<Content>().0.object(object.0);
    let facing = world
        .get::<ObjectFacing>(shelf)
        .map_or(def.base_facing, |f| f.0);
    let origin = (at.x.round() as i32, at.y.round() as i32);
    let grid = world.resource::<TileGrid>();
    def.shelf_approaches_at(facing)
        .into_iter()
        .filter_map(|offset| crate::seating::contact_offset(origin, offset))
        .filter(|&contact| legal_shelf_contact(world, grid, shelf, contact))
        .any(|contact| contact == tile || grid.find_path(tile, contact).is_some())
}

/// The reading row a return to `shelf` targets: the bookcase's own reading
/// interaction, when it has no seats (a seated origin needs a seat claim).
fn shelf_reading_row(world: &World, shelf: Entity) -> Option<usize> {
    let pack = world.resource::<Content>().0;
    let def = pack.object(world.get::<SmartObject>(shelf)?.0);
    if !def.seats.is_empty() {
        return None;
    }
    def.interactions.iter().position(|a| a.book_reading)
}

/// Floor copies that can be put back, checked once per pass before any
/// walk is planned, so a book nobody can shelve costs one check a tick and
/// never a path search per housemate.
fn shelvable_floor(world: &World) -> Vec<(BookCopyId, (i32, i32))> {
    floor_copies(world)
        .into_iter()
        .filter(|&(copy, tile)| shelvable(world, copy, tile))
        .collect()
}

/// Whether any need is at or under the critical level every crisis rule
/// uses; a crisis comes before tidying.
fn any_need_critical(world: &World, person: Entity) -> bool {
    let level = world
        .resource::<Content>()
        .0
        .tuning
        .mood_critical_need_level;
    world
        .get::<Needs>(person)
        .is_some_and(|needs| NeedId::ALL.iter().any(|&id| needs.get(id) <= level))
}

/// Runs directly before selection: each free housemate between activities
/// with no need critical, in entity order, sets off for the nearest
/// unclaimed floor book they can reach and that can be shelved,
/// nearest by path length with the lower copy id first on a tie. A book
/// someone is already walking to is not offered again, so two housemates
/// never race for one. Does nothing, and costs one scan, when no book is on
/// the floor.
pub(crate) fn claim(world: &mut World) {
    if floor_copies(world).is_empty() {
        return;
    }
    let mut claimed = claimed_tiles(world);
    let floor: Vec<_> = shelvable_floor(world)
        .into_iter()
        .filter(|(_, tile)| !claimed.contains(tile))
        .collect();
    if floor.is_empty() {
        return;
    }
    let now = world.resource::<SimClock>().tick;
    let mut idle: Vec<Entity> = world
        .query_filtered::<Entity, (With<Agent>, Without<Path>)>()
        .iter(world)
        .collect();
    idle.sort_by_key(|e| e.index_u32());
    for person in idle {
        if !free_to_tidy(world, person, now) || any_need_critical(world, person) {
            continue;
        }
        let position = *world.get::<Position>(person).unwrap();
        let from = tile_of(position.x, position.y);
        let grid = world.resource::<TileGrid>();
        let best = floor
            .iter()
            .filter(|(_, tile)| !claimed.contains(tile))
            .filter_map(|&(copy, tile)| {
                let steps = if tile == from {
                    Vec::new()
                } else {
                    grid.find_path(from, tile)
                        .and_then(|steps| grid.anchor_path((position.x, position.y), steps))?
                };
                Some((steps.len(), copy, tile, steps))
            })
            .min_by_key(|(length, copy, _, _)| (*length, *copy));
        let Some((_, copy, tile, steps)) = best else {
            continue;
        };
        claimed.insert(tile);
        if steps.is_empty() {
            start_return(world, person, copy);
        } else {
            world
                .entity_mut(person)
                .insert(Path { steps, cursor: 0 })
                .remove::<Wander>();
        }
    }
}

/// Runs after movement: a free housemate with no need critical standing on
/// an unclaimed floor book that can be shelved, with no walk left, picks it
/// up and starts putting it back. The
/// lowest entity index wins a tile two people reach together.
pub(crate) fn pick_up_arrivals(world: &mut World) {
    if floor_copies(world).is_empty() {
        return;
    }
    let floor = shelvable_floor(world);
    let now = world.resource::<SimClock>().tick;
    let mut people: Vec<(Entity, (i32, i32))> = world
        .query_filtered::<(Entity, &Position), (With<Agent>, Without<Path>)>()
        .iter(world)
        .map(|(e, p)| (e, tile_of(p.x, p.y)))
        .collect();
    people.sort_by_key(|(e, _)| e.index_u32());
    for (copy, tile) in floor {
        let Some(&(person, _)) = people.iter().find(|(person, at)| {
            *at == tile && free_to_tidy(world, *person, now) && !any_need_critical(world, *person)
        }) else {
            continue;
        };
        start_return(world, person, copy);
    }
}

/// Picks the copy up and starts the ordinary return to its home shelf. The
/// journey's origin is the shelf's own reading row, so it is a valid saved
/// journey in the `Return` stage with no reading done.
fn start_return(world: &mut World, person: Entity, copy: BookCopyId) {
    let id = *world.get::<SimId>(person).unwrap();
    let mut library = world.resource::<BookLibrary>().clone();
    if with_book_world(world, |context| {
        library.pick_up_from_floor(copy, id, context)
    })
    .is_err()
    {
        return;
    }
    let Some(home) = library.copy(copy).and_then(|c| c.home) else {
        return;
    };
    let Some(shelf) = u32::try_from(home.shelf.0)
        .ok()
        .and_then(|index| crate::dining::entity(world, index))
    else {
        return;
    };
    let Some(row) = shelf_reading_row(world, shelf) else {
        return;
    };
    world.insert_resource(library);
    let position = *world.get::<Position>(person).unwrap();
    world
        .entity_mut(person)
        .remove::<Wander>()
        .insert(ReadingJourney {
            origin: Target {
                object: shelf,
                interaction: row as u32,
            },
            order: None,
            copy,
            shelf,
            seat: None,
            stage: ReadingStage::WaitingReturn,
            transfer_contact: None,
            reach_remaining: 0,
            elapsed: 0,
            work: 0.0,
            earned_satisfaction: 0.0,
            destination: tile_of(position.x, position.y),
            outcome: None,
            reward_contexts: Vec::new(),
        });
    route_return(world, person);
}

/// [LB-cap]: a worker still on a reading journey when the lateness
/// allowance ends. A journey that has not picked its copy up ends at once,
/// as it does at a shift start; a carried copy is left on the floor where
/// the worker stands, keeping its home, and the journey ends so the worker
/// can leave.
pub(crate) fn put_down_and_end(world: &mut World, person: Entity) {
    request_return(world, person);
    if world.get::<ReadingJourney>(person).is_none() {
        return;
    }
    let id = *world.get::<SimId>(person).unwrap();
    let position = *world.get::<Position>(person).unwrap();
    let mut library = world.resource::<BookLibrary>().clone();
    with_book_world(world, |context| {
        library.put_down(id, (position.x, position.y), context)
    })
    .expect("a living reader at home has a valid floor position");
    world.insert_resource(library);
    finish(world, person);
}
