//! Pure candidate enumeration consumed by the existing action systems.
use super::*;
use std::collections::HashMap;

#[derive(Clone, Debug)]
pub struct Plan {
    pub copy: BookCopyId,
    pub shelf: Entity,
    pub title: String,
    pub target: Target,
    pub seat: Option<(Entity, u16)>,
    pub fetch: Vec<(i32, i32)>,
    pub transfer_contact: (i32, i32),
    pub destination: (i32, i32),
    pub score: f32,
    pub risk: f32,
    pub route_steps: usize,
}

#[derive(Resource, Default)]
pub struct Options(pub HashMap<(Entity, Entity, u32), Vec<Plan>>);

fn shelf(world: &World, copy: BookCopyId) -> Option<Entity> {
    let home = world.resource::<BookLibrary>().copy(copy)?.home?;
    crate::dining::entity(world, u32::try_from(home.shelf.0).ok()?)
}

fn disposition(world: &World, person: Entity, target: Target) -> f32 {
    let object = world.get::<SmartObject>(target.object).unwrap().0;
    world
        .get::<Personality>(person)
        .map_or(1.0, |p| p.disposition(object, target.interaction))
        * crate::systems::trait_effects::disposition_multiplier(
            world.get::<Traits>(person),
            world.resource::<Content>().0,
            &action(world, target).unwrap().tags,
        )
}

fn benefit(a: &terri_data::CompiledInteraction, need: NeedId) -> f32 {
    a.advertises
        .iter()
        .find(|(n, _)| *n == need as u8)
        .map_or(0.0, |(_, v)| *v)
}

pub(crate) fn plans(
    world: &mut World,
    person: Entity,
    origin: Target,
    title: Option<&str>,
) -> Vec<Plan> {
    if !is_read(world, origin) || world.get::<Carrying>(person).is_some() {
        return vec![];
    }
    let Some(id) = world.get::<SimId>(person).copied() else {
        return vec![];
    };
    let Some(p) = world.get::<Position>(person).copied() else {
        return vec![];
    };
    let pack = world.resource::<Content>().0;
    let Some(tuning) = pack.reading.as_ref() else {
        return vec![];
    };
    let occupancy = crate::seating::occupancy(world);
    let pinned = !pack
        .object(world.get::<SmartObject>(origin.object).unwrap().0)
        .seats
        .is_empty();
    let mut seats = vec![];
    for (entity, at, object, facing) in world
        .query::<(Entity, &Position, &SmartObject, Option<&ObjectFacing>)>()
        .iter(world)
    {
        if pinned && entity != origin.object {
            continue;
        }
        let def = pack.object(object.0);
        let Some((row, _)) = def
            .interactions
            .iter()
            .enumerate()
            .find(|(_, a)| a.book_reading)
        else {
            continue;
        };
        let target = if pinned {
            origin
        } else {
            Target {
                object: entity,
                interaction: row as u32,
            }
        };
        let facing = facing.map_or(def.base_facing, |f| f.0);
        for (ordinal, _) in def.seats.iter().enumerate() {
            if !occupancy.seat_available(person, entity, ordinal as u16) {
                continue;
            }
            for (x, y) in def.seat_approaches_at(ordinal, facing).unwrap_or_default() {
                let Some(tile) = crate::seating::contact_offset(
                    (at.x.round() as i32, at.y.round() as i32),
                    (x, y),
                ) else {
                    continue;
                };
                if crate::seating::legal_contact(
                    world.resource::<TileGrid>(),
                    def,
                    facing,
                    (at.x.round() as i32, at.y.round() as i32),
                    Some(ordinal as u16),
                    tile,
                ) && occupancy.endpoint_available(crate::seating::EndpointUse {
                    owner: person,
                    endpoint: tile,
                    kind: crate::seating::UseKind::Media,
                }) {
                    seats.push((target, Some((entity, ordinal as u16)), tile));
                }
            }
        }
    }
    let copies = world.resource::<BookLibrary>().state().copies.clone();
    let needs = world
        .get::<Needs>(person)
        .copied()
        .unwrap_or(Needs::all_at(100.0));
    let personality = world
        .get::<Personality>(person)
        .cloned()
        .unwrap_or_default();
    let instinct = world.get::<SelfPreservation>(person).map_or(50, |s| s.0);
    let mut result: Vec<Plan> = vec![];
    for copy in copies {
        let BookLocation::Shelf(home) = copy.location else {
            continue;
        };
        if copy.borrower.is_some()
            || title.is_some_and(|t| t != copy.title_id)
            || (!pinned && home.shelf.0 != u64::from(origin.object.index_u32()))
        {
            continue;
        }
        let Some(shelf) = shelf(world, copy.id) else {
            continue;
        };
        let Some(fetch) = route_to(world, person, shelf, &occupancy) else {
            continue;
        };
        let fetched = endpoint(&fetch, p);
        let mut destinations: Vec<_> = seats
            .iter()
            .copied()
            .filter(|(_, _, destination)| {
                world
                    .resource::<TileGrid>()
                    .find_path(fetched, *destination)
                    .is_some()
            })
            .collect();
        if destinations.is_empty() && !pinned {
            let grid = world.resource::<TileGrid>();
            let at = world.get::<Position>(shelf).unwrap();
            let def = pack.object(world.get::<SmartObject>(shelf).unwrap().0);
            let facing = world
                .get::<ObjectFacing>(shelf)
                .map_or(def.base_facing, |f| f.0);
            let fp = def.footprint_at(facing);
            if let Some(standing) = [(1, 0), (0, 1), (-1, 0), (0, -1)]
                .into_iter()
                .map(|(x, y)| (fetched.0 + x, fetched.1 + y))
                .find(|&(x, y)| {
                    grid.can_step(fetched, (x, y))
                        && !shelf_contact_tile(world, (x, y))
                        && occupancy.endpoint_available(crate::seating::EndpointUse {
                            owner: person,
                            endpoint: (x, y),
                            kind: crate::seating::UseKind::Standing,
                        })
                        && !(x >= at.x.round() as i32
                            && y >= at.y.round() as i32
                            && x < at.x.round() as i32 + fp.width as i32
                            && y < at.y.round() as i32 + fp.depth as i32)
                })
            {
                destinations.push((origin, None, standing));
            }
        }
        let interest = with_book_world(world, |context| {
            world
                .resource::<BookLibrary>()
                .estimate_interest(id, &copy.title_id, context)
        })
        .unwrap_or(0.0);
        for (target, seat, destination) in destinations {
            let Some(travel) = world.resource::<TileGrid>().find_path(fetched, destination) else {
                continue;
            };
            let act = action(world, target).unwrap();
            // The selected activity includes fetching, reaching and returning the copy.
            let route_steps = fetch.len() + travel.len() * 2;
            let distance = route_steps as f32;
            let benefits = effective_benefits(pack, act).unwrap();
            let memory = world.resource::<BookLibrary>().memory(id, &copy.title_id);
            let completed = memory.map_or(0.0, |m| m.progress_ticks as f32 + m.progress_fraction);
            let length = pack
                .books
                .iter()
                .find(|b| b.id == copy.title_id)
                .unwrap()
                .reading_minutes as f32;
            let duration = ((length - completed) / benefits.work_per_tick)
                .ceil()
                .min(tuning.session_ticks as f32)
                .max(1.0) as u32;
            let expected_work = (duration as f32 * benefits.work_per_tick).min(length - completed);
            let fun = benefits.fun_for_work(expected_work)
                * interest
                * disposition(world, person, target);
            let comfort = benefits.comfort_for_ticks(duration);
            let model = world.get::<SmartObject>(target.object).unwrap().0;
            let repetition = world
                .get::<Habituation>(person)
                .map_or(0.0, |h| h.get(model, target.interaction));
            let appeal =
                crate::systems::advertise::benefit_scale(repetition, pack.tuning.habituation_floor);
            let mortality = world.get_resource::<terri_core::save::SavedMortality>();
            let deprivation = mortality
                .and_then(|m| m.counts.iter().find(|(e, _)| *e == person.index_u32()))
                .map_or(0, |(_, n)| *n);
            let activity_ticks = duration + tuning.pickup_ticks + tuning.shelve_ticks;
            let risk = crate::systems::autonomy::survival_penalty(
                pack,
                &needs,
                &personality,
                instinct,
                &act.advertises,
                activity_ticks,
                distance,
                false,
                deprivation,
                mortality.is_some_and(|m| m.enabled),
                false,
            );
            let score = [(NeedId::Fun, fun), (NeedId::Comfort, comfort)]
                .into_iter()
                .map(|(need, delta)| {
                    crate::systems::autonomy::need_score(
                        &needs,
                        need,
                        delta * personality.satisfaction[need as usize] * appeal,
                        activity_ticks,
                        distance,
                        instinct,
                        &pack.tuning,
                    )
                })
                .sum::<f32>()
                - risk;
            let plan = Plan {
                copy: copy.id,
                shelf,
                transfer_contact: fetched,
                title: copy.title_id.clone(),
                target,
                seat,
                fetch: fetch.clone(),
                destination,
                score,
                risk,
                route_steps,
            };
            result.push(plan);
        }
    }
    result.sort_by_key(|p| {
        (
            p.target.object.index_u32(),
            p.target.interaction,
            p.seat.map(|s| s.1),
            p.copy,
        )
    });
    result
}

pub(crate) fn prepare(world: &mut World) {
    if world
        .resource::<BookLibrary>()
        .state()
        .copies
        .iter()
        .all(|c| c.borrower.is_some() || !matches!(c.location, BookLocation::Shelf(_)))
    {
        world.insert_resource(Options::default());
        return;
    }
    let people: Vec<_> = world
        .query_filtered::<Entity, (
            With<Agent>,
            Without<ReadingJourney>,
            Without<AtWork>,
            Without<Commuting>,
        )>()
        .iter(world)
        .collect();
    let mut targets = vec![];
    for (e, o) in world.query::<(Entity, &SmartObject)>().iter(world) {
        for (i, a) in world
            .resource::<Content>()
            .0
            .object(o.0)
            .interactions
            .iter()
            .enumerate()
        {
            if a.book_reading {
                targets.push(Target {
                    object: e,
                    interaction: i as u32,
                });
            }
        }
    }
    targets.sort_by_key(|t| (t.object.index_u32(), t.interaction));
    let mut options = Options::default();
    for person in people {
        let directed = world
            .get::<IntentQueue>(person)
            .and_then(|q| q.front())
            .filter(|i| {
                is_read(
                    world,
                    Target {
                        object: i.object,
                        interaction: i.interaction,
                    },
                )
            });
        if directed.is_none() && world.get::<Target>(person).is_some() {
            continue;
        }
        for target in &targets {
            if directed
                .is_some_and(|i| i.object != target.object || i.interaction != target.interaction)
            {
                continue;
            }
            let choices = plans(world, person, *target, None);
            if !choices.is_empty() {
                options
                    .0
                    .insert((person, target.object, target.interaction), choices);
            }
        }
    }
    world.insert_resource(options);
}

/// Higher utility wins; equal utility prefers less travel, then stable identities/contacts.
fn preference(a: &Plan, b: &Plan) -> std::cmp::Ordering {
    a.score
        .total_cmp(&b.score)
        .then_with(|| b.route_steps.cmp(&a.route_steps))
        .then_with(|| b.copy.cmp(&a.copy))
        .then_with(|| b.shelf.index_u32().cmp(&a.shelf.index_u32()))
        .then_with(|| b.transfer_contact.cmp(&a.transfer_contact))
        .then_with(|| b.destination.cmp(&a.destination))
}

/// One available route per title/seat ticket, shared by advertising and execution.
fn representatives<'a>(
    choices: &'a [Plan],
    person: Entity,
    title: Option<&str>,
    occupancy: &crate::beds::Occupancy,
    used: &std::collections::BTreeSet<BookCopyId>,
) -> Vec<&'a Plan> {
    let available = choices.iter().filter(|p| {
        !used.contains(&p.copy)
            && occupancy.endpoint_available(crate::seating::EndpointUse {
                owner: person,
                endpoint: p.transfer_contact,
                kind: crate::seating::UseKind::ShelfTransfer,
            })
            && occupancy.endpoint_available(crate::seating::EndpointUse {
                owner: person,
                endpoint: p.destination,
                kind: if p.seat.is_some() {
                    crate::seating::UseKind::Media
                } else {
                    crate::seating::UseKind::Standing
                },
            })
            && title.is_none_or(|t| t == p.title)
            && p.seat
                .is_none_or(|(e, n)| occupancy.seat_available(person, e, n))
    });
    let mut indices = std::collections::BTreeMap::new();
    let mut result: Vec<&Plan> = Vec::new();
    for plan in available {
        let key = (
            plan.title.as_str(),
            plan.target.object,
            plan.target.interaction,
            plan.seat,
        );
        if let Some(&index) = indices.get(&key) {
            if preference(plan, result[index]).is_gt() {
                result[index] = plan;
            }
        } else {
            indices.insert(key, result.len());
            result.push(plan);
        }
    }
    result
}

pub(crate) fn best_plan<'a>(
    choices: &'a [Plan],
    person: Entity,
    occupancy: &crate::beds::Occupancy,
    used: &std::collections::BTreeSet<BookCopyId>,
) -> Option<&'a Plan> {
    representatives(choices, person, None, occupancy, used)
        .into_iter()
        .max_by(|a, b| preference(a, b))
}

pub(crate) fn choose_plan(
    choices: &[Plan],
    person: Entity,
    title: Option<&str>,
    occupancy: &crate::beds::Occupancy,
    used: &std::collections::BTreeSet<BookCopyId>,
    rng: &mut SimRng,
    pack: &terri_data::ContentPack,
) -> Option<Plan> {
    let available = representatives(choices, person, title, occupancy, used);
    if available.is_empty() {
        return None;
    }
    let rows: Vec<_> = available
        .iter()
        .map(|p| (p.target.object, p.target.interaction, p.score))
        .collect();
    let probabilities = crate::systems::autonomy::grouped_probabilities(
        &rows,
        &available.iter().map(|p| p.risk).collect::<Vec<_>>(),
        pack.tuning.choice_temperature,
        0.0,
        pack.tuning.choice_probability_floor,
    );
    Some(available[crate::systems::autonomy::sample(&probabilities, rng)].clone())
}

pub(crate) fn publish_plan(occupancy: &mut crate::beds::Occupancy, person: Entity, plan: &Plan) {
    if let Some((seat, ordinal)) = plan.seat {
        occupancy.claim(
            person,
            plan.target,
            crate::beds::Admission::Seat {
                ordinal,
                all: false,
            },
        );
        occupancy.physical_seat_claim(person, seat, ordinal, false);
    }
    occupancy.claim_endpoint(crate::seating::EndpointUse {
        owner: person,
        endpoint: plan.transfer_contact,
        kind: crate::seating::UseKind::ShelfTransfer,
    });
    occupancy.claim_endpoint(crate::seating::EndpointUse {
        owner: person,
        endpoint: plan.destination,
        kind: if plan.seat.is_some() {
            crate::seating::UseKind::Media
        } else {
            crate::seating::UseKind::Standing
        },
    });
}

pub(crate) fn effective_benefits(
    pack: &terri_data::ContentPack,
    action: &terri_data::CompiledInteraction,
) -> Option<Benefits> {
    let tuning = pack.reading.as_ref()?;
    action.book_reading.then_some(Benefits {
        fun: tuning.fun_per_session * benefit(action, NeedId::Fun) / tuning.action_fun_reference,
        comfort: benefit(action, NeedId::Comfort),
        satisfaction: tuning.satisfaction_per_session,
        work_per_tick: terri_data::books::READING_REFERENCE_TICKS / action.duration_ticks as f32,
    })
}

#[derive(Clone, Copy)]
pub(crate) struct Benefits {
    pub fun: f32,
    pub comfort: f32,
    pub satisfaction: f32,
    pub work_per_tick: f32,
}

impl Benefits {
    pub(crate) fn fun_for_work(self, work: f32) -> f32 {
        self.fun * work / terri_data::books::READING_REFERENCE_TICKS
    }
    pub(crate) fn comfort_for_ticks(self, ticks: u32) -> f32 {
        self.comfort * ticks as f32 / terri_data::books::READING_REFERENCE_TICKS
    }
}
