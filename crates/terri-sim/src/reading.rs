//! Owned reading uses ordinary admission and movement, with a mandatory return gate.
use crate::{
    books::{with_book_world, BookLibrary},
    Content,
};
use bevy_ecs::prelude::*;
use terri_core::{
    books::{BookCopyId, BookLocation},
    save_v6::{ReadingOutcome, ReadingRewardContext, ReadingStage},
    *,
};

mod accrual;
pub(crate) mod persistence;
pub(crate) mod placement;
mod planning;
pub(crate) use planning::{
    best_plan, choose_plan, effective_benefits, plans, prepare, publish_plan,
};
pub use planning::{Options, Plan};
#[cfg(test)]
mod tests;

#[derive(Component, Clone, Debug, PartialEq)]
pub struct ReadingJourney {
    pub origin: Target,
    pub order: Option<u64>,
    pub copy: BookCopyId,
    pub shelf: Entity,
    pub seat: Option<(Entity, String)>,
    pub stage: ReadingStage,
    pub transfer_contact: Option<(i32, i32)>,
    pub reach_remaining: u32,
    pub elapsed: u32,
    pub work: f32,
    pub earned_satisfaction: f32,
    pub destination: (i32, i32),
    pub outcome: Option<ReadingOutcome>,
    pub reward_contexts: Vec<ReadingRewardContext>,
}
#[derive(Component, Clone, Debug, PartialEq, Eq)]
pub struct PendingShift {
    pub scheduled_tick: u64,
    pub career: u32,
}

pub(crate) fn action(world: &World, target: Target) -> Option<&terri_data::CompiledInteraction> {
    let object = world.get::<SmartObject>(target.object)?;
    world
        .resource::<Content>()
        .0
        .object(object.0)
        .interactions
        .get(target.interaction as usize)
}
pub(crate) fn is_read(world: &World, target: Target) -> bool {
    action(world, target).is_some_and(|a| a.book_reading)
}

pub(crate) fn legal_shelf_contact(
    world: &World,
    grid: &TileGrid,
    shelf: Entity,
    contact: (i32, i32),
) -> bool {
    let Some(object) = world.get::<SmartObject>(shelf) else {
        return false;
    };
    let Some(at) = world.get::<Position>(shelf) else {
        return false;
    };
    let def = world.resource::<Content>().0.object(object.0);
    let facing = world
        .get::<ObjectFacing>(shelf)
        .map_or(def.base_facing, |f| f.0);
    let origin = (at.x.round() as i32, at.y.round() as i32);
    def.shelf_capacity > 0
        && def
            .shelf_approaches_at(facing)
            .iter()
            .any(|(x, y)| Some(contact) == crate::seating::contact_offset(origin, (*x, *y)))
        && grid.can_interact_with_rect(contact, origin, def.footprint_at(facing))
}
fn route_to(
    world: &World,
    person: Entity,
    object: Entity,
    occupancy: &crate::beds::Occupancy,
) -> Option<Vec<(i32, i32)>> {
    let p = *world.get::<Position>(person)?;
    let at = world.get::<Position>(object)?;
    let def = world
        .resource::<Content>()
        .0
        .object(world.get::<SmartObject>(object)?.0);
    let facing = world
        .get::<ObjectFacing>(object)
        .map_or(def.base_facing, |f| f.0);
    let grid = world.resource::<TileGrid>();
    def.shelf_approaches_at(facing)
        .into_iter()
        .filter_map(|offset| {
            crate::seating::contact_offset((at.x.round() as i32, at.y.round() as i32), offset)
        })
        .filter(|&contact| {
            legal_shelf_contact(world, grid, object, contact)
                && occupancy.endpoint_available(crate::seating::EndpointUse {
                    owner: person,
                    endpoint: contact,
                    kind: crate::seating::UseKind::ShelfTransfer,
                })
        })
        .filter_map(|contact| {
            grid.find_path((p.x.round() as i32, p.y.round() as i32), contact)
                .and_then(|steps| grid.anchor_path((p.x, p.y), steps))
        })
        .min_by_key(|steps| (steps.len(), steps.last().copied()))
}
fn path_open(world: &World, person: Entity) -> bool {
    let Some(path) = world.get::<Path>(person) else {
        return true;
    };
    let p = world.get::<Position>(person).unwrap();
    let grid = world.resource::<TileGrid>();
    let mut prev = (p.x, p.y);
    path.steps[path.cursor..].iter().all(|&(x, y)| {
        let ok = grid.is_walkable(x, y) && grid.segment_can_cross(prev, (x as f32, y as f32));
        prev = (x as f32, y as f32);
        ok
    })
}
fn endpoint(steps: &[(i32, i32)], p: Position) -> (i32, i32) {
    steps
        .last()
        .copied()
        .unwrap_or((p.x.round() as i32, p.y.round() as i32))
}

pub(crate) fn commit_plan(
    world: &mut World,
    person: Entity,
    origin: Target,
    order: Option<u64>,
    plan: Plan,
) -> bool {
    if world.get::<ReadingJourney>(person).is_some() || world.get::<Carrying>(person).is_some() {
        return false;
    }
    if let Some(id) = order {
        let valid = world
            .get::<IntentQueue>(person)
            .and_then(|q| q.entries().first())
            .is_some_and(|entry| {
                entry.id == id
                    && entry.intent.object == origin.object
                    && entry.intent.interaction == origin.interaction
                    && entry.title_id.as_ref().is_none_or(|t| *t == plan.title)
            });
        if !valid {
            return false;
        }
    }
    let occupancy = crate::seating::occupancy(world);
    if plan
        .seat
        .is_some_and(|(e, n)| !occupancy.seat_available(person, e, n))
    {
        return false;
    }
    if !occupancy.endpoint_available(crate::seating::EndpointUse {
        owner: person,
        endpoint: plan.destination,
        kind: if plan.seat.is_some() {
            crate::seating::UseKind::Media
        } else {
            crate::seating::UseKind::Standing
        },
    }) {
        return false;
    }
    if !occupancy.endpoint_available(crate::seating::EndpointUse {
        owner: person,
        endpoint: plan.transfer_contact,
        kind: crate::seating::UseKind::ShelfTransfer,
    }) {
        return false;
    }
    let pack = world.resource::<Content>().0;
    let id = *world.get::<SimId>(person).unwrap();
    let mut library = world.resource::<BookLibrary>().clone();
    if with_book_world(world, |context| library.reserve(plan.copy, id, context)).is_err() {
        return false;
    }
    if let Some(target) = world.get::<Target>(person).copied() {
        crate::reservations::release_now(world, person, target);
    }
    crate::domestic::suspend_cleanup(world, person);
    let seat = plan.seat.map(|(e, n)| {
        (
            e,
            pack.object(world.get::<SmartObject>(e).unwrap().0).seats[n as usize]
                .id
                .clone(),
        )
    });
    world.insert_resource(library);
    world
        .entity_mut(person)
        .remove::<(
            Eating,
            Socialising,
            ConversationVoice,
            StepWork,
            Fumbled,
            SleepPlace,
            Restless,
            Wander,
            Blocked,
        )>()
        .insert((
            plan.target,
            Path {
                steps: plan.fetch,
                cursor: 0,
            },
            ReadingJourney {
                origin,
                order,
                copy: plan.copy,
                shelf: plan.shelf,
                transfer_contact: Some(plan.transfer_contact),
                reach_remaining: 0,
                seat,
                stage: ReadingStage::Fetch,
                elapsed: 0,
                work: 0.0,
                earned_satisfaction: 0.0,
                outcome: None,
                reward_contexts: vec![],
                destination: plan.destination,
            },
        ));
    if let Some((seat, ordinal)) = plan.seat {
        world.entity_mut(seat).insert(Reserved);
        crate::seating::install(world, person, seat, ordinal, false);
    }
    true
}
fn finish(world: &mut World, person: Entity) {
    let Some(j) = world.get::<ReadingJourney>(person).cloned() else {
        return;
    };
    if let Some(target) = world.get::<Target>(person).copied() {
        crate::reservations::release_now(world, person, target);
    }
    if let Some(order) = j.order {
        if let Some(mut q) = world.get_mut::<IntentQueue>(person) {
            q.remove_order(order);
        }
    }
    world
        .entity_mut(person)
        .remove::<(ReadingJourney, Target, Path, Eating, Blocked)>();
}
/// Every preemption converges here. A carried copy survives every later request.
pub(crate) fn request_return(world: &mut World, person: Entity) -> bool {
    let Some(j) = world.get::<ReadingJourney>(person).cloned() else {
        return false;
    };
    if matches!(
        j.stage,
        ReadingStage::Return | ReadingStage::WaitingReturn | ReadingStage::Shelve
    ) {
        return true;
    }
    settle_reward(world, person);
    let id = *world.get::<SimId>(person).unwrap();
    let mut library = world.resource::<BookLibrary>().clone();
    if matches!(j.stage, ReadingStage::Fetch | ReadingStage::Pickup) {
        with_book_world(world, |c| library.release_reservation(j.copy, id, c))
            .expect("live reservation");
        world.insert_resource(library);
        finish(world, person);
        return true;
    }
    if let Some(target) = world.get::<Target>(person).copied() {
        crate::reservations::release_now(world, person, target);
    }
    world.entity_mut(person).remove::<(Target, Path, Eating)>();
    world.get_mut::<ReadingJourney>(person).unwrap().stage = ReadingStage::WaitingReturn;
    route_return(world, person);
    true
}
fn route_return(world: &mut World, person: Entity) {
    let j = world.get::<ReadingJourney>(person).unwrap().clone();
    let home = j.shelf;
    let occupancy = crate::seating::occupancy(world);
    let Some(steps) = route_to(world, person, home, &occupancy) else {
        world
            .entity_mut(person)
            .remove::<(Path, Target)>()
            .insert(Blocked);
        let mut j = world.get_mut::<ReadingJourney>(person).unwrap();
        j.stage = ReadingStage::WaitingReturn;
        j.transfer_contact = None;
        j.reach_remaining = 0;
        return;
    };
    let destination = endpoint(&steps, *world.get::<Position>(person).unwrap());
    let row = world
        .resource::<Content>()
        .0
        .object(world.get::<SmartObject>(home).unwrap().0)
        .interactions
        .iter()
        .position(|a| a.book_reading)
        .unwrap();
    world
        .entity_mut(person)
        .insert((
            Target {
                object: home,
                interaction: row as u32,
            },
            Path { steps, cursor: 0 },
        ))
        .remove::<Blocked>();
    let mut j = world.get_mut::<ReadingJourney>(person).unwrap();
    j.stage = ReadingStage::Return;
    j.destination = destination;
    j.transfer_contact = Some(destination);
    j.reach_remaining = 0;
}
pub(crate) fn reconcile(world: &mut World) {
    let mut people: Vec<_> = world
        .query::<(Entity, &ReadingJourney)>()
        .iter(world)
        .map(|(e, _)| e)
        .collect();
    people.sort_by_key(|e| e.index_u32());
    for person in people {
        let j = world.get::<ReadingJourney>(person).unwrap().clone();
        let changed = j.order.is_some_and(|id| {
            world
                .get::<IntentQueue>(person)
                .is_none_or(|q| q.entries().first().is_none_or(|o| o.id != id))
        }) || (j.order.is_none()
            && world
                .get::<IntentQueue>(person)
                .is_some_and(|q| !q.is_empty()));
        let urgent = world.get::<Needs>(person).is_some_and(|n| {
            [NeedId::Hunger, NeedId::Bladder, NeedId::Energy]
                .iter()
                .any(|id| {
                    n.get(*id)
                        <= world
                            .resource::<Content>()
                            .0
                            .tuning
                            .mood_critical_need_level
                })
        });
        if changed
            || urgent
            || world.get_entity(j.origin.object).is_err()
            || (!matches!(
                j.stage,
                ReadingStage::Return | ReadingStage::WaitingReturn | ReadingStage::Shelve
            ) && world
                .get::<Target>(person)
                .is_none_or(|t| action(world, *t).is_none()))
        {
            request_return(world, person);
        }
        if let Some(j) = world.get::<ReadingJourney>(person).cloned() {
            if j.stage == ReadingStage::WaitingReturn {
                route_return(world, person);
                continue;
            }
            if matches!(
                j.stage,
                ReadingStage::Fetch
                    | ReadingStage::Pickup
                    | ReadingStage::Return
                    | ReadingStage::Shelve
            ) {
                let legal = j.transfer_contact.is_some_and(|p| {
                    legal_shelf_contact(world, world.resource::<TileGrid>(), j.shelf, p)
                }) && path_open(world, person);
                if !legal {
                    if matches!(j.stage, ReadingStage::Fetch | ReadingStage::Pickup) {
                        let occupancy = crate::seating::occupancy(world);
                        if let Some(steps) = route_to(world, person, j.shelf, &occupancy) {
                            let contact = endpoint(&steps, *world.get::<Position>(person).unwrap());
                            world.entity_mut(person).insert(Path { steps, cursor: 0 });
                            let mut live = world.get_mut::<ReadingJourney>(person).unwrap();
                            live.stage = ReadingStage::Fetch;
                            live.transfer_contact = Some(contact);
                            live.reach_remaining = 0;
                        } else {
                            request_return(world, person);
                        }
                    } else {
                        route_return(world, person);
                    }
                }
            } else if j.stage == ReadingStage::Travel && !path_open(world, person) {
                request_return(world, person);
            }
        }
    }
}
pub(crate) fn tick(world: &mut World) {
    let mut people: Vec<_> = world
        .query::<(Entity, &ReadingJourney)>()
        .iter(world)
        .map(|(e, _)| e)
        .collect();
    people.sort_by_key(|e| e.index_u32());
    for person in people {
        if world.get::<Path>(person).is_some() {
            continue;
        }
        let j = world.get::<ReadingJourney>(person).unwrap().clone();
        let id = *world.get::<SimId>(person).unwrap();
        match j.stage {
            ReadingStage::Fetch => {
                let ticks = world
                    .resource::<Content>()
                    .0
                    .reading
                    .as_ref()
                    .unwrap()
                    .pickup_ticks;
                let mut live = world.get_mut::<ReadingJourney>(person).unwrap();
                live.stage = ReadingStage::Pickup;
                live.reach_remaining = ticks;
            }
            ReadingStage::Pickup => {
                let remaining = {
                    let mut live = world.get_mut::<ReadingJourney>(person).unwrap();
                    live.reach_remaining -= 1;
                    live.reach_remaining
                };
                if remaining > 0 {
                    continue;
                }
                let mut library = world.resource::<BookLibrary>().clone();
                with_book_world(world, |c| library.pick_up(j.copy, id, c)).expect("live pickup");
                world.insert_resource(library);
                let p = *world.get::<Position>(person).unwrap();
                let path = world
                    .resource::<TileGrid>()
                    .find_path((p.x.round() as i32, p.y.round() as i32), j.destination)
                    .and_then(|steps| world.resource::<TileGrid>().anchor_path((p.x, p.y), steps));
                {
                    let mut live = world.get_mut::<ReadingJourney>(person).unwrap();
                    live.stage = ReadingStage::Travel;
                    live.transfer_contact = None;
                }
                if let Some(steps) = path {
                    world.entity_mut(person).insert(Path { steps, cursor: 0 });
                } else {
                    request_return(world, person);
                }
            }
            ReadingStage::Travel => {
                let pack = world.resource::<Content>().0;
                let target = *world.get::<Target>(person).unwrap();
                let tags = &action(world, target).unwrap().tags;
                let traits = world.get::<Traits>(person).cloned();
                let skills = world.get::<Skills>(person).cloned();
                let tags = tags.clone();
                let fumble = traits.and_then(|traits| {
                    crate::systems::trait_effects::roll_fumble(
                        &traits,
                        skills.as_ref(),
                        pack,
                        &tags,
                        &mut world.resource_mut::<SimRng>(),
                    )
                });
                let mut live = world.get_mut::<ReadingJourney>(person).unwrap();
                live.outcome =
                    Some(fumble.map_or(ReadingOutcome::Success, ReadingOutcome::Fumbled));
                live.stage = ReadingStage::Read;
            }
            ReadingStage::Read => read_tick(world, person),
            ReadingStage::Return => {
                let ticks = world
                    .resource::<Content>()
                    .0
                    .reading
                    .as_ref()
                    .unwrap()
                    .shelve_ticks;
                let mut live = world.get_mut::<ReadingJourney>(person).unwrap();
                live.stage = ReadingStage::Shelve;
                live.reach_remaining = ticks;
            }
            ReadingStage::Shelve => {
                let remaining = {
                    let mut live = world.get_mut::<ReadingJourney>(person).unwrap();
                    live.reach_remaining -= 1;
                    live.reach_remaining
                };
                if remaining > 0 {
                    continue;
                }
                let mut library = world.resource::<BookLibrary>().clone();
                with_book_world(world, |c| library.return_copy(j.copy, id, c))
                    .expect("live return");
                world.insert_resource(library);
                finish(world, person);
            }
            ReadingStage::WaitingReturn => {}
        }
    }
}
pub(crate) fn active_need_benefits(world: &World, person: Entity) -> Option<Vec<(u8, f32)>> {
    let journey = world.get::<ReadingJourney>(person)?;
    if journey.stage != ReadingStage::Read {
        return None;
    }
    let target = *world.get::<Target>(person)?;
    let action = action(world, target)?;
    let benefits = effective_benefits(world.resource::<Content>().0, action)?;
    let library = world.resource::<BookLibrary>();
    let title = &library.copy(journey.copy)?.title_id;
    let id = *world.get::<SimId>(person)?;
    let novelty = library
        .memory(id, title)
        .and_then(|m| m.pass_novelty)
        .unwrap_or_else(|| {
            let pack = world.resource::<Content>().0;
            let book = pack
                .books
                .iter()
                .find(|book| &book.id == title)
                .expect("validated title");
            let affinity =
                crate::books::title_affinity(library.state().taste_seed, id, &book.genre, title);
            with_book_world(world, |context| {
                library.estimate_interest(id, title, context)
            })
            .expect("validated reading context")
                / affinity
        });
    let taste = crate::books::taste_multiplier(world, person, target, title).ok()?;
    let failure = match journey.outcome? {
        ReadingOutcome::Success => 1.,
        ReadingOutcome::Fumbled(scale) => scale,
    };
    let personality = world.get::<Personality>(person);
    let scale = |need: NeedId| personality.map_or(1., |p| p.satisfaction[need.index()]);
    Some(vec![
        (
            NeedId::Fun.index() as u8,
            benefits.fun * benefits.work_per_tick / terri_data::books::READING_REFERENCE_TICKS
                * novelty
                * taste
                * failure
                * scale(NeedId::Fun),
        ),
        (
            NeedId::Comfort.index() as u8,
            benefits.comfort_for_ticks(1) * failure * scale(NeedId::Comfort),
        ),
    ])
}

fn read_tick(world: &mut World, person: Entity) {
    let j = world.get::<ReadingJourney>(person).unwrap().clone();
    let target = *world.get::<Target>(person).unwrap();
    let Some(act) = action(world, target).cloned() else {
        request_return(world, person);
        return;
    };
    let pack = world.resource::<Content>().0;
    let tuning = pack.reading.as_ref().unwrap();
    let id = *world.get::<SimId>(person).unwrap();
    let mut library = world.resource::<BookLibrary>().clone();
    let copy = library.copy(j.copy).unwrap();
    let title = copy.title_id.clone();
    let taste =
        crate::books::taste_multiplier(world, person, target, &title).expect("live title taste");
    let fumble = match j.outcome.expect("reading outcome was sampled on arrival") {
        ReadingOutcome::Success => 1.0,
        ReadingOutcome::Fumbled(scale) => scale,
    };
    let work = with_book_world(world, |c| {
        library.read_fractional_work(
            j.copy,
            id,
            effective_benefits(pack, &act).unwrap().work_per_tick,
            c,
        )
    })
    .expect("live reading work");
    world.insert_resource(library);
    let personality = world
        .get::<Personality>(person)
        .cloned()
        .unwrap_or_default();
    if let Some(mut needs) = world.get_mut::<Needs>(person) {
        needs.fill(
            NeedId::Fun,
            work.reward_factor
                * taste
                * fumble
                * effective_benefits(pack, &act).unwrap().fun
                * personality.satisfaction[NeedId::Fun as usize],
        );
        needs.fill(
            NeedId::Comfort,
            effective_benefits(pack, &act).unwrap().comfort_for_ticks(1)
                * fumble
                * personality.satisfaction[NeedId::Comfort as usize],
        );
    }
    let payout = crate::systems::satisfaction::hobby_payout(
        work.satisfaction * taste,
        &act.tags,
        world.get::<Hobbies>(person),
        pack.tuning.hobby_multiplier,
    ) * crate::systems::trait_effects::condition_accrual_scale(
        world.get::<Traits>(person),
        pack,
    ) * if matches!(j.outcome, Some(ReadingOutcome::Fumbled(_))) {
        0.0
    } else {
        1.0
    };
    accrual::record(world, person, target, work.consumed_work);
    world
        .get_mut::<ReadingJourney>(person)
        .unwrap()
        .earned_satisfaction += payout;
    let done = {
        let mut live = world.get_mut::<ReadingJourney>(person).unwrap();
        live.elapsed += 1;
        live.work += work.consumed_work;
        live.elapsed >= tuning.session_ticks || work.completed
    };
    if done {
        let mut skills = world.get::<Skills>(person).cloned().unwrap_or_default();
        crate::skills::practise(&mut skills, pack, &act.tags);
        let model = world.get::<SmartObject>(target.object).unwrap().0;
        let mut repetition = world
            .get::<Habituation>(person)
            .cloned()
            .unwrap_or_default();
        repetition.bump(
            model,
            target.interaction,
            pack.tuning.habituation_per_use,
            pack.tuning.habituation_max,
        );
        world.entity_mut(person).insert((skills, repetition));
        if let Some(mut traits) = world.get_mut::<Traits>(person) {
            crate::systems::trait_effects::learn_and_manage(&mut traits, pack, &act.tags);
        }
        request_return(world, person);
    }
}
/// A queued Read yields only to the food already in this person's hands.
pub(crate) fn food_before_read(world: &World, person: Entity) -> bool {
    world.get::<Carrying>(person).is_some()
        && world
            .get::<IntentQueue>(person)
            .and_then(|q| q.front())
            .is_some_and(|i| {
                is_read(
                    world,
                    Target {
                        object: i.object,
                        interaction: i.interaction,
                    },
                )
            })
}

impl crate::Sim {
    /// Authoritative journey status, including return gates and per-title work.
    pub fn reading_status_of(&self, index: u32) -> Option<String> {
        let world = self.world();
        let person = crate::dining::entity(world, index)?;
        let status = status(world, person)?;
        let journey = world.get::<ReadingJourney>(person)?;
        let copy = world.resource::<BookLibrary>().copy(journey.copy)?;
        let pack = world.resource::<Content>().0;
        let title = pack.books.iter().find(|book| book.id == copy.title_id)?;
        let progress = self
            .reading_progress(index, &title.id)
            .map_or(0.0, |memory| {
                memory.progress_ticks as f32 + memory.progress_fraction
            });
        Some(format!(
            "{status}. Title progress: {:.0}% of {} baseline game minutes.",
            (progress / title.reading_minutes as f32 * 100.0).min(100.0),
            title.reading_minutes
        ))
    }

    /// Physical action capacity for browser facts, independently of authored advert slots.
    pub fn model_action_capacity(&self, model: &str, action_id: &str) -> Option<u32> {
        let pack = self.world.resource::<Content>().0;
        let Some(model) = pack.find(model).map(|id| pack.object(id)) else {
            return Some(0);
        };
        let Some(action) = model.interactions.iter().find(|a| a.id == action_id) else {
            return Some(0);
        };
        crate::beds::action_capacity(pack, model, action)
    }

    pub fn reading_journeys(&self) -> Vec<terri_core::save_v6::SavedReadingJourney> {
        persistence::capture(self.world())
    }
    pub fn reading_progress(
        &self,
        person: u32,
        title: &str,
    ) -> Option<terri_core::books::TitleMemory> {
        let entity = crate::dining::entity(self.world(), person)?;
        let id = *self.world().get::<SimId>(entity)?;
        self.world()
            .resource::<BookLibrary>()
            .memory(id, title)
            .cloned()
    }
}
pub(crate) fn stage_code(world: &World, person: Entity) -> u32 {
    world
        .get::<ReadingJourney>(person)
        .map_or(0, |j| match j.stage {
            ReadingStage::Fetch => 1,
            ReadingStage::Travel => 2,
            ReadingStage::Read => 3,
            ReadingStage::Return => 4,
            ReadingStage::WaitingReturn => 5,
            ReadingStage::Pickup => 6,
            ReadingStage::Shelve => 7,
        })
}
pub(crate) fn status(world: &World, person: Entity) -> Option<String> {
    let j = world.get::<ReadingJourney>(person)?;
    let copy = world.resource::<BookLibrary>().copy(j.copy)?;
    let title = &world
        .resource::<Content>()
        .0
        .books
        .iter()
        .find(|b| b.id == copy.title_id)?
        .title;
    let verb = match j.stage {
        ReadingStage::Fetch => "Fetching",
        ReadingStage::Travel => "Going to read",
        ReadingStage::Read => "Reading",
        ReadingStage::Return => "Returning",
        ReadingStage::WaitingReturn => "Waiting to return",
        ReadingStage::Pickup => "Picking up",
        ReadingStage::Shelve => "Shelving",
    };
    Some(format!("{verb}: {title}"))
}
pub(crate) fn projection(world: &World, person: Entity) -> Option<crate::SocketActionProjection> {
    let j = world.get::<ReadingJourney>(person)?;
    if j.stage != ReadingStage::Read {
        return None;
    }
    let target = *world.get::<Target>(person)?;
    let (x, y, facing) = if j.seat.is_some() {
        let body = crate::seating::body(world, person)?;
        (body.x, body.y, crate::seating::wire_facing(body.facing))
    } else {
        let p = world.get::<Position>(person)?;
        (
            p.x,
            p.y,
            crate::facing_toward(
                person,
                p,
                target.object,
                world.get::<Position>(target.object)?,
            ),
        )
    };
    Some(crate::SocketActionProjection {
        x,
        y,
        facing,
        target_entity: target.object.index_u32(),
        visual_action: if j.seat.is_some() {
            crate::render_buffer::visual_action::READ
        } else {
            crate::render_buffer::visual_action::STANDING_READ
        },
        activity: crate::render_buffer::activity::READING,
    })
}

pub(crate) fn settle_reward(world: &mut World, person: Entity) {
    let Some(mut journey) = world.get_mut::<ReadingJourney>(person) else {
        return;
    };
    let earned = std::mem::take(&mut journey.earned_satisfaction);
    journey.reward_contexts.clear();
    if earned > 0.0 {
        if let Some(mut ledger) = world.get_mut::<Satisfaction>(person) {
            ledger.reward(earned);
        }
    }
}
impl crate::Sim {
    /// The same effective reading facts for a model that has not been placed.
    pub fn reading_model_benefits(&self, model: &str, action_id: &str) -> Vec<f32> {
        let pack = self.world.resource::<Content>().0;
        let Some(definition) = pack.find(model) else {
            return vec![];
        };
        let Some(action) = pack
            .object(definition)
            .interactions
            .iter()
            .find(|a| a.id == action_id)
        else {
            return vec![];
        };
        effective_benefits(pack, action).map_or_else(Vec::new, |b| {
            vec![b.fun, b.comfort, b.satisfaction, b.work_per_tick]
        })
    }

    /// Fun/satisfaction per reference hour of work, Comfort per elapsed hour, and work per tick.
    /// The maximum session length does not change these reference values.
    pub fn reading_action_benefits(&self, object: u32, action_id: &str) -> Vec<f32> {
        let world = self.world();
        let Some(object) =
            crate::dining::entity(world, object).and_then(|e| world.get::<SmartObject>(e))
        else {
            return vec![];
        };
        let pack = world.resource::<Content>().0;
        let Some(action) = pack
            .object(object.0)
            .interactions
            .iter()
            .find(|a| a.id == action_id)
        else {
            return vec![];
        };
        effective_benefits(pack, action).map_or_else(Vec::new, |b| {
            vec![b.fun, b.comfort, b.satisfaction, b.work_per_tick]
        })
    }
}

impl crate::Sim {
    /// Per journey: person, home shelf, home slot, reach ticks remaining, reach ticks total.
    pub fn reading_transfer_details(&self) -> Vec<u32> {
        let world = self.world();
        let tuning = world.resource::<Content>().0.reading.as_ref();
        self.reading_journeys()
            .into_iter()
            .flat_map(|j| {
                let home = world
                    .resource::<BookLibrary>()
                    .copy(j.copy)
                    .and_then(|c| c.home);
                let total = tuning.map_or(0, |t| match j.stage {
                    ReadingStage::Pickup => t.pickup_ticks,
                    ReadingStage::Shelve => t.shelve_ticks,
                    _ => 0,
                });
                [
                    j.owner,
                    home.map_or(u32::MAX, |h| h.shelf.0 as u32),
                    home.map_or(u32::MAX, |h| u32::from(h.slot)),
                    j.reach_remaining,
                    total,
                ]
            })
            .collect()
    }
}

impl crate::Sim {
    /// Reachable, shelved titles in this action context. No RNG or gameplay writes.
    pub fn reading_available_titles(
        &mut self,
        person: u32,
        object: u32,
        action_id: &str,
    ) -> Vec<String> {
        let Some(person) = crate::dining::entity(&self.world, person)
            .filter(|e| self.world.get::<Agent>(*e).is_some())
        else {
            return vec![];
        };
        let Some(object) = crate::dining::entity(&self.world, object) else {
            return vec![];
        };
        let Some(def) = self.world.get::<SmartObject>(object) else {
            return vec![];
        };
        let Some(row) = self
            .world
            .resource::<Content>()
            .0
            .object(def.0)
            .interactions
            .iter()
            .position(|a| a.id == action_id && a.book_reading)
        else {
            return vec![];
        };
        let mut titles: Vec<_> = plans(
            &mut self.world,
            person,
            Target {
                object,
                interaction: row as u32,
            },
            None,
        )
        .into_iter()
        .map(|p| p.title)
        .collect();
        titles.sort();
        titles.dedup();
        titles
    }
}

/// A journey explicitly owns its future approach and its short shelf-transfer contact.
/// Physical-seat ownership remains a separate claim.
pub(crate) fn endpoints(
    owner: Entity,
    j: &ReadingJourney,
) -> impl Iterator<Item = crate::seating::EndpointUse> {
    let approach = matches!(
        j.stage,
        ReadingStage::Fetch | ReadingStage::Pickup | ReadingStage::Travel | ReadingStage::Read
    )
    .then_some(crate::seating::EndpointUse {
        owner,
        endpoint: j.destination,
        kind: if j.seat.is_some() {
            crate::seating::UseKind::Media
        } else {
            crate::seating::UseKind::Standing
        },
    });
    [
        approach,
        j.transfer_contact
            .map(|endpoint| crate::seating::EndpointUse {
                owner,
                endpoint,
                kind: crate::seating::UseKind::ShelfTransfer,
            }),
    ]
    .into_iter()
    .flatten()
}
pub(crate) fn shelf_contact_tile(world: &World, tile: (i32, i32)) -> bool {
    world
        .try_query::<(&Position, &SmartObject, Option<&ObjectFacing>)>()
        .is_some_and(|mut q| {
            q.iter(world).any(|(at, o, f)| {
                let def = world.resource::<Content>().0.object(o.0);
                let facing = f.map_or(def.base_facing, |f| f.0);
                def.shelf_capacity > 0
                    && def.shelf_approaches_at(facing).iter().any(|&(x, y)| {
                        Some(tile)
                            == crate::seating::contact_offset(
                                (at.x.round() as i32, at.y.round() as i32),
                                (x, y),
                            )
                    })
            })
        })
}
