//! Deliberate privacy choices and the state that keeps reconsideration bounded.
use bevy_ecs::prelude::*;
use std::collections::BTreeMap;
use terri_core::save::SavedBoundaryDecision;
use terri_core::{SimId, SimRng};

#[derive(Resource, Default)]
pub struct BoundaryDecisions(pub(crate) BTreeMap<u32, SavedBoundaryDecision>);

pub(crate) fn directed(world: &World, entity: Entity) -> bool {
    let ordered = world
        .get::<terri_core::Target>(entity)
        .zip(world.get::<terri_core::IntentQueue>(entity))
        .is_some_and(|(target, queue)| {
            queue.contains(terri_core::Intent {
                cleanup: None,
                chore: None,
                object: target.object,
                interaction: target.interaction,
            })
        });
    ordered
        || world
            .get_resource::<terri_core::chores::SavedChores>()
            .is_some_and(|s| {
                s.tasks
                    .iter()
                    .any(|t| t.person == entity.index_u32() && t.directed && !t.suspended)
            })
        || crate::targeted_cleanup::has_active(world, entity.index_u32())
        || world
            .get::<SimId>(entity)
            .and_then(|id| world.resource::<BoundaryDecisions>().0.get(&id.0))
            .and_then(|row| row.directed_chain)
            .zip(world.get::<terri_core::ChainState>(entity))
            .is_some_and(|(chain, state)| chain == state.chain)
}

impl BoundaryDecisions {
    fn lapse(
        &mut self,
        actor: SimId,
        tick: u64,
        shyness: u8,
        policy: terri_data::RelationshipTuning,
        rng: &mut SimRng,
    ) -> bool {
        let state = self.0.entry(actor.0).or_insert(SavedBoundaryDecision {
            actor: actor.0,
            expires: 0,
            lapse: false,
            waiting_since: None,
            goal: None,
            directed_chain: None,
        });
        if tick >= state.expires {
            let respect = policy.privacy_respect_chance
                + policy.shyness_respect_strength * (f32::from(shyness) - 50.0) / 50.0;
            state.lapse = rng.next_f32() >= respect.clamp(0.0, 1.0);
            state.expires = tick.saturating_add(u64::from(policy.privacy_decision_ticks));
        }
        state.lapse
    }
    #[allow(clippy::too_many_arguments)]
    pub(crate) fn permits(
        &mut self,
        actor: SimId,
        goal: Option<(u32, u32)>,
        tick: u64,
        relevant_need: f32,
        shyness: u8,
        tuning: terri_data::Tuning,
        rng: &mut SimRng,
    ) -> (bool, bool) {
        let policy = tuning.relationships;
        if policy.privacy_respect_chance == 0.0 {
            return (true, false);
        }
        let state = self.0.entry(actor.0).or_insert(SavedBoundaryDecision {
            actor: actor.0,
            expires: 0,
            lapse: false,
            waiting_since: None,
            goal: None,
            directed_chain: None,
        });
        if state.goal != goal {
            state.waiting_since = None;
            state.goal = goal;
        }
        let since = *state.waiting_since.get_or_insert(tick);
        let emergency = relevant_need <= policy.privacy_desperate_need_level
            || (relevant_need <= tuning.mood_critical_need_level
                && tick.saturating_sub(since) >= u64::from(policy.privacy_critical_wait_ticks));
        if emergency {
            return (true, true);
        }
        (self.lapse(actor, tick, shyness, policy, rng), false)
    }
}

pub(crate) fn restore(
    world: &mut World,
    values: Vec<SavedBoundaryDecision>,
) -> Result<(), crate::SaveError> {
    use terri_core::{Agent, ChainState, SimClock, Target};
    if values.windows(2).any(|w| w[0].actor >= w[1].actor) {
        return Err(crate::SaveError::InvalidValue);
    }
    let clock = world.resource::<SimClock>().tick;
    let max_expiry = clock.saturating_add(u64::from(
        world
            .resource::<crate::Content>()
            .0
            .tuning
            .relationships
            .privacy_decision_ticks,
    ));
    let people: BTreeMap<_, _> = world
        .query_filtered::<(Entity, &SimId), With<Agent>>()
        .iter(world)
        .map(|(e, id)| (id.0, e))
        .collect();
    for row in &values {
        let entity = *people
            .get(&row.actor)
            .ok_or(crate::SaveError::InvalidEntityReference)?;
        if row.expires > max_expiry
            || row.waiting_since.is_some_and(|since| since > clock)
            || row.goal.is_some_and(|goal| {
                world
                    .get::<Target>(entity)
                    .is_none_or(|t| (t.object.index_u32(), t.interaction) != goal)
            })
            || row.directed_chain.is_some_and(|chain| {
                world
                    .get::<ChainState>(entity)
                    .is_none_or(|s| s.chain != chain)
            })
        {
            return Err(crate::SaveError::InvalidValue);
        }
    }
    world.resource_mut::<BoundaryDecisions>().0 =
        values.into_iter().map(|row| (row.actor, row)).collect();
    Ok(())
}

pub(crate) fn hash(world: &World, hasher: &mut terri_core::FnvHasher) {
    let rows = &world.resource::<BoundaryDecisions>().0;
    if rows.is_empty() {
        return;
    }
    hasher.write_bytes(b"privacy-boundaries-v1");
    hasher.write_u64(rows.len() as u64);
    for row in rows.values() {
        hasher.write_u64(u64::from(row.actor));
        hasher.write_u64(row.expires);
        hasher.write_u64(u64::from(row.lapse));
        hasher.write_u64(u64::from(row.waiting_since.is_some()));
        if let Some(since) = row.waiting_since {
            hasher.write_u64(since);
        }
        hasher.write_u64(u64::from(row.goal.is_some()));
        if let Some((object, act)) = row.goal {
            hasher.write_u64(u64::from(object));
            hasher.write_u64(u64::from(act));
        }
        hasher.write_u64(u64::from(row.directed_chain.is_some()));
        if let Some(chain) = row.directed_chain {
            hasher.write_u64(u64::from(chain));
        }
    }
}

/// Clear stale action ownership without discarding an unexpired lapse decision.
pub(crate) fn maintain(world: &mut World) {
    use terri_core::{Agent, ChainState, SimClock, Target};
    let people: BTreeMap<_, _> = world
        .query_filtered::<(Entity, &SimId), With<Agent>>()
        .iter(world)
        .map(|(e, id)| (id.0, e))
        .collect();
    let tick = world.resource::<SimClock>().tick;
    let mut decisions = world.remove_resource::<BoundaryDecisions>().unwrap();
    decisions.0.retain(|id, row| {
        let Some(&e) = people.get(id) else {
            return false;
        };
        if row
            .directed_chain
            .is_some_and(|chain| world.get::<ChainState>(e).is_none_or(|s| s.chain != chain))
        {
            row.directed_chain = None;
        }
        if row.goal.is_some_and(|goal| {
            world
                .get::<Target>(e)
                .is_none_or(|t| (t.object.index_u32(), t.interaction) != goal)
        }) {
            row.goal = None;
            row.waiting_since = None;
        }
        row.expires > tick || row.waiting_since.is_some() || row.directed_chain.is_some()
    });
    world.insert_resource(decisions);
}

/// Reuse the actor's goal and reservation while preferring an unoccupied route or equivalent item.
pub(crate) fn route(world: &mut World) {
    use terri_core::{
        Agent, NeedId, Needs, ObjectFacing, Path, Position, Reserved, SmartObject, Target, TileGrid,
    };
    let pack = world.resource::<crate::Content>().0;
    if pack.tuning.relationships.privacy_respect_chance == 0.0 {
        return;
    }
    let mut walkers: Vec<_> = world
        .query_filtered::<(Entity, &Position, &Path), With<Agent>>()
        .iter(world)
        .map(|(e, p, path)| (e, *p, path.clone()))
        .collect();
    walkers.sort_by_key(|(e, _, _)| e.index());
    for (actor, pos, path) in walkers {
        let domestic_occupants = crate::domestic::boundary_occupants(world);
        if directed(world, actor) {
            continue;
        }
        let target = world.get::<Target>(actor).copied();
        let phase = world.resource::<crate::systems::interpersonal::InterpersonalPhase>();
        let act = target.and_then(|t| {
            world
                .get::<SmartObject>(t.object)
                .and_then(|o| pack.object(o.0).interactions.get(t.interaction as usize))
        });
        let start_blocked = target.zip(act).is_some_and(|(t, a)| {
            a.tags
                .iter()
                .any(|tag| tag == crate::systems::interpersonal::PRIVATE_USE_TAG)
                && phase.start_blocked(actor, t.object)
        });
        let path_blocked = phase.path_intrudes(actor, &path.steps[path.cursor..]);
        let already_waiting = world
            .get::<SimId>(actor)
            .and_then(|id| world.resource::<BoundaryDecisions>().0.get(&id.0))
            .is_some_and(|row| row.waiting_since.is_some());
        if !start_blocked && !path_blocked && !already_waiting {
            continue;
        }
        let safe = phase.safe_grid(actor, world.resource::<TileGrid>());
        if world.get::<terri_core::Commuting>(actor).is_none() {
            let helps = target.map_or_else(Vec::new, |target| {
                crate::need_interactions::goal_benefits(world, actor, target)
            });
            let urgent = world.get::<Needs>(actor).and_then(|needs| {
                let current = helps.iter().filter(|(_, delta)| *delta > 0.0)
                    .map(|(n,_)| needs.get(NeedId::ALL[*n as usize])).fold(100.0,f32::min);
                NeedId::ALL
                    .into_iter()
                    .filter(|n| {
                        needs.get(*n) <= pack.tuning.mood_critical_need_level
                            // Keep an already-critical goal stable. Only a
                            // newly desperate need outranks that urgency class,
                            // so two critical needs cannot reset each other's wait.
                            && (current > pack.tuning.mood_critical_need_level
                                || (needs.get(*n) <= pack.tuning.relationships.privacy_desperate_need_level
                                    && current > pack.tuning.relationships.privacy_desperate_need_level))
                            && !helps
                                .iter()
                                .any(|&(i, d)| i as usize == n.index() && d > 0.0)
                    })
                    .min_by(|a, b| needs.get(*a).total_cmp(&needs.get(*b)))
            });
            if let Some(urgent) = urgent {
                if substitute(world, actor, urgent.index() as u8, &safe, false) {
                    continue;
                }
                // Choose the relevant urgent goal even when its only route is
                // private. Movement still applies the normal wait/emergency
                // policy against that new goal; an unrelated old errand must
                // not prevent access to essential furniture indefinitely.
                let ordinary = world.resource::<TileGrid>().clone();
                if substitute(world, actor, urgent.index() as u8, &ordinary, true) {
                    continue;
                }
            }
        }
        if !start_blocked && !path_blocked {
            if let Some(id) = world.get::<SimId>(actor).copied() {
                if let Some(row) = world.resource_mut::<BoundaryDecisions>().0.get_mut(&id.0) {
                    row.waiting_since = None;
                    row.goal = None;
                }
            }
            continue;
        }

        if world.get::<terri_core::Commuting>(actor).is_none() {
            if let Some(id) = world.get::<SimId>(actor).copied() {
                let tick = world.resource::<terri_core::SimClock>().tick;
                let shy = crate::shyness::of(world, actor).value();
                let mut decisions = world.remove_resource::<BoundaryDecisions>().unwrap();
                let lapse = decisions.lapse(
                    id,
                    tick,
                    shy,
                    pack.tuning.relationships,
                    &mut world.resource_mut::<SimRng>(),
                );
                world.insert_resource(decisions);
                if lapse {
                    continue;
                }
            }
        }
        let from = (pos.x.round() as i32, pos.y.round() as i32);
        if !start_blocked {
            let end = if let Some(place) = world.get::<terri_core::SleepPlace>(actor) {
                target.and_then(|target| {
                    let placed = world.get::<SmartObject>(target.object)?;
                    let position = world.get::<Position>(target.object)?;
                    let facing = world
                        .get::<ObjectFacing>(target.object)
                        .map_or(pack.object(placed.0).base_facing, |f| f.0);
                    let field = safe.distance_field(from)?;
                    let access = crate::beds::navigation::Access::new(
                        pack.object(placed.0),
                        &pack.sleep_tag,
                        facing,
                        (position.x.round() as i32, position.y.round() as i32),
                        &field,
                    );
                    let route = access.for_admission(crate::beds::Admission::Sleep {
                        ordinal: place.0,
                        preference: crate::beds::Preference::Unassigned,
                    })?;
                    route.route.path(&safe, from)?.last().copied()
                })
            } else {
                path.steps.last().copied()
            };
            if let Some(end) = end {
                let strolling = target.is_none()
                    && world.get::<terri_core::Wander>(actor).is_some()
                    && world.get::<terri_core::ChainState>(actor).is_none()
                    && world.get::<terri_core::Commuting>(actor).is_none();
                if let Some(mut steps) = safe
                    .find_path(from, end)
                    .and_then(|s| safe.anchor_path((pos.x, pos.y), s))
                    .filter(|s| {
                        !strolling
                            || path.cursor + s.len() <= pack.tuning.wander_radius_tiles as usize
                    })
                {
                    // Retain the completed prefix so repeated detours cannot
                    // reset a stroll's distance budget. Errands keep full routes.
                    let cursor = if strolling { path.cursor } else { 0 };
                    if strolling {
                        steps.splice(0..0, path.steps[..cursor].iter().copied());
                    }
                    world.entity_mut(actor).insert(Path { steps, cursor });
                    continue;
                }
            }
        }
        if let Some(chain) = world
            .get::<terri_core::ChainState>(actor)
            .filter(|_| target.is_some_and(|t| t.interaction == crate::systems::chain::CHAIN_STEP))
            .copied()
        {
            let mut choices = Vec::new();
            for (object, position, placed, facing) in world
                .query::<(Entity, &Position, &SmartObject, Option<&ObjectFacing>)>()
                .iter(world)
            {
                let exclusive = world.get::<Reserved>(object).is_none()
                    || target.is_some_and(|t| t.object == object);
                if let Some(steps) = crate::domestic::boundary_route(
                    pack,
                    world.get_resource::<terri_core::save::SavedDomestic>(),
                    actor,
                    world.get::<terri_core::SimId>(actor).copied(),
                    chain,
                    world.get::<crate::recipe_actions::Origin>(actor),
                    object,
                    placed.0,
                    facing,
                    *position,
                    pos,
                    &safe,
                    exclusive,
                    &domestic_occupants,
                ) {
                    choices.push((steps.len(), object.index_u32(), object, steps));
                }
            }
            choices.sort_by_key(|(len, index, _, _)| (*len, *index));
            if let Some((_, _, object, steps)) = choices.into_iter().next() {
                if let Some(t) = target {
                    if t.object != object {
                        crate::reservations::release_now(world, actor, t);
                    }
                }
                world.entity_mut(object).insert(Reserved);
                world.entity_mut(actor).insert((
                    Target {
                        object,
                        interaction: crate::systems::chain::CHAIN_STEP,
                    },
                    Path { steps, cursor: 0 },
                ));
            }
            continue;
        }
        // A substitute must satisfy the original action's most depleted need.
        // This permits a bath instead of a shower, without mistaking a chair for a toilet.
        let need = target.and_then(|target| {
            let needs = world.get::<Needs>(actor)?;
            crate::need_interactions::goal_benefits(world, actor, target)
                .into_iter()
                .filter(|(_, delta)| *delta > 0.)
                .min_by(|(a, _), (b, _)| {
                    needs
                        .get(NeedId::ALL[*a as usize])
                        .total_cmp(&needs.get(NeedId::ALL[*b as usize]))
                })
                .map(|(n, _)| n)
        });
        let Some(need) = need else {
            continue;
        };
        substitute(world, actor, need, &safe, false);
    }
}

fn occupancy(world: &mut World) -> crate::beds::Occupancy {
    crate::seating::occupancy(world)
}

/// Probe the first real recipe stage before replacing an interrupted goal.
fn replacement_recipe_route(
    world: &mut World,
    actor: Entity,
    selected: Entity,
    row: u32,
    safe: &terri_core::TileGrid,
    furniture: &[crate::systems::interpersonal::BoundaryFurniture],
    occupancy: &crate::beds::Occupancy,
) -> Option<Vec<(i32, i32)>> {
    let pack = world.resource::<crate::Content>().0;
    let model = world.get::<terri_core::SmartObject>(selected)?.0;
    let (recipe, chain) = crate::action_rows::resolve(pack, model, row)?.recipe?;
    if chain.steps.iter().enumerate().any(|(i, step)| {
        !crate::dining::managed_step(pack, chain, i as u32)
            && !furniture
                .iter()
                .any(|item| pack.object(item.definition).roles.contains(&step.role))
    }) {
        return None;
    }
    let (state, origin) = crate::recipe_actions::begin(pack, model, row, recipe, selected);
    let mut domestic = world
        .get_resource::<terri_core::save::SavedDomestic>()
        .cloned()
        .unwrap_or_default();
    // A replacement releases the actor's old dish claim before acquiring the new one.
    domestic
        .cleanup
        .retain(|task| task.person != actor.index_u32());
    if chain.id == crate::domestic::CLEANUP {
        let dishes = crate::domestic::available_cleanup_dishes(world, actor);
        if dishes.is_empty() {
            return None;
        }
        domestic.cleanup.push(terri_core::save::SavedCleanup {
            person: actor.index_u32(),
            dishes,
            collected: Vec::new(),
            directed: true,
        });
    }
    let from = *world.get::<terri_core::Position>(actor)?;
    let id = world.get::<SimId>(actor).copied();
    let occupants = crate::domestic::boundary_occupants(world);
    furniture
        .iter()
        .filter_map(|item| {
            crate::domestic::boundary_route(
                pack,
                Some(&domestic),
                actor,
                id,
                state,
                Some(&origin),
                item.entity,
                item.definition,
                Some(&terri_core::ObjectFacing(item.facing)),
                item.position,
                from,
                safe,
                occupancy.exclusive_available(actor, item.entity),
                &occupants,
            )
            .map(|steps| (steps.len(), item.entity.index_u32(), steps))
        })
        .min_by_key(|(length, index, _)| (*length, *index))
        .map(|(_, _, steps)| steps)
}

pub(crate) fn substitute(
    world: &mut World,
    actor: Entity,
    need: u8,
    safe: &terri_core::TileGrid,
    allow_private_start: bool,
) -> bool {
    if crate::reading::request_return(world, actor) {
        return true;
    }
    use terri_core::{ObjectFacing, Path, Position, Reserved, SmartObject, Target};
    let pack = world.resource::<crate::Content>().0;
    let pos = *world.get::<Position>(actor).unwrap();
    let from = (pos.x.round() as i32, pos.y.round() as i32);
    let target = world.get::<Target>(actor).copied();
    let occupancy = occupancy(world);
    let person = world.get::<SimId>(actor).copied();
    let needs = world
        .get::<terri_core::Needs>(actor)
        .copied()
        .unwrap_or(terri_core::Needs::all_at(100.0));
    let personality = world
        .get::<terri_core::Personality>(actor)
        .cloned()
        .unwrap_or_default();
    let instinct = world
        .get::<terri_core::SelfPreservation>(actor)
        .map_or(50, |value| value.0);
    let mortality = world.resource::<terri_core::save::SavedMortality>();
    let death_enabled = mortality.enabled;
    let deprivation = mortality
        .counts
        .binary_search_by_key(&actor.index_u32(), |row| row.0)
        .map_or(0, |at| mortality.counts[at].1);
    let held = world.get::<terri_core::SleepPlace>(actor).copied();
    let Some(field) = safe.distance_field(from) else {
        return false;
    };
    let mut candidates = Vec::new();
    let mut objects = world.query::<(Entity, &Position, &SmartObject, Option<&ObjectFacing>)>();
    let furniture: Vec<_> = objects
        .iter(world)
        .map(|(entity, position, object, facing)| {
            crate::systems::interpersonal::BoundaryFurniture {
                entity,
                position: *position,
                definition: object.0,
                facing: facing.map_or(pack.object(object.0).base_facing, |f| f.0),
            }
        })
        .collect();
    for item in &furniture {
        let object = item.entity;
        let position = &item.position;
        let definition = pack.object(item.definition);
        let access = crate::beds::navigation::Access::new(
            definition,
            &pack.sleep_tag,
            item.facing,
            (position.x.round() as i32, position.y.round() as i32),
            &field,
        );
        for (interaction, a) in definition.interactions.iter().enumerate() {
            if a.book_reading {
                continue;
            }
            if !a
                .advertises
                .iter()
                .any(|&(n, delta)| n == need && delta > 0.0)
            {
                continue;
            }
            if !allow_private_start
                && a.tags
                    .iter()
                    .any(|tag| tag == crate::systems::interpersonal::PRIVATE_USE_TAG)
                && world
                    .resource::<crate::systems::interpersonal::InterpersonalPhase>()
                    .start_blocked(actor, object)
            {
                continue;
            }
            let next = Target {
                object,
                interaction: interaction as u32,
            };
            let recipe_path = if a.recipe.is_some() {
                let Some(path) = replacement_recipe_route(
                    world,
                    actor,
                    object,
                    interaction as u32,
                    safe,
                    &furniture,
                    &occupancy,
                ) else {
                    continue;
                };
                Some(path)
            } else {
                None
            };
            let media =
                crate::seating::media_activity(pack, item.definition, next.interaction).is_some();
            let seated =
                crate::seating::seated_activity(pack, item.definition, next.interaction).is_some();
            let media_plan = seated
                .then(|| {
                    crate::media::plan(
                        crate::media::Planning {
                            pack,
                            grid: safe,
                            field: &field,
                            objects: &furniture,
                            occupancy: &occupancy,
                        },
                        actor,
                        item,
                    )
                })
                .flatten();
            let social_available = media_plan.as_ref().is_some_and(|_| {
                world
                    .resource::<crate::social_company::SocialCompany>()
                    .media_allowed(
                        actor,
                        object,
                        next.interaction,
                        &world
                            .get::<terri_core::Relationships>(actor)
                            .cloned()
                            .unwrap_or_default(),
                    )
            });
            let destination = access
                .nearest(false)
                .and_then(|r| r.route.path(safe, from))
                .map(|steps| steps.last().copied().unwrap_or(from));
            let shared = a.shared_activity.is_some()
                && destination.is_some_and(|end| {
                    world
                        .resource::<crate::social_company::SocialCompany>()
                        .shared_allowed(
                            actor,
                            object,
                            next.interaction,
                            &world
                                .get::<terri_core::Relationships>(actor)
                                .cloned()
                                .unwrap_or_default(),
                            end,
                        )
                });
            let seat = media_plan
                .as_ref()
                .and_then(|plan| plan.lease.as_ref())
                .and_then(|lease| lease.chair)
                .and_then(|id| furniture.iter().find(|item| item.entity.index_u32() == id))
                .map_or(0., |seat| pack.object(seat.definition).seat_comfort_rate());
            let benefits =
                crate::need_interactions::benefits(pack, a, &needs, social_available, seat, shared);
            if !benefits.iter().any(|&(n, d)| n == need && d > 0.) {
                continue;
            }
            if !allow_private_start
                && a.tags
                    .iter()
                    .any(|tag| tag == crate::systems::interpersonal::PRIVATE_USE_TAG)
                && world
                    .resource::<crate::systems::interpersonal::InterpersonalPhase>()
                    .start_blocked(actor, object)
            {
                continue;
            }
            let available = match media_plan.as_ref().and_then(|plan| plan.seat) {
                Some(_) if media => occupancy.viewer_admissions(actor, next, a.slots, true),
                _ => occupancy.admissions(
                    pack,
                    definition,
                    actor,
                    person,
                    next,
                    world.resource::<crate::beds::BedAssignments>(),
                ),
            };
            // Compare actual travel risk before assignment, as ordinary autonomy does.
            // Retain the held place among equally safe options and keep one candidate per interaction.
            let chosen = available
                .into_iter()
                .filter_map(|admission| {
                    // A viewing use needs its planned place; seated work
                    // without a chair keeps the ordinary standing route.
                    let route = match (media, media_plan.as_ref()) {
                        (_, Some(plan)) => plan.access,
                        (true, None) => return None,
                        (false, None) => access.for_admission(admission)?,
                    };
                    let steps = if let Some(path) = &recipe_path {
                        path.clone()
                    } else {
                        let steps = route.route.path(safe, from)?;
                        safe.anchor_path((pos.x, pos.y), steps)?
                    };
                    let risk = crate::systems::autonomy::survival_penalty(
                        pack,
                        &needs,
                        &personality,
                        instinct,
                        &benefits,
                        a.duration_ticks,
                        if recipe_path.is_some() {
                            steps.len() as f32
                        } else {
                            route.distance as f32
                        },
                        a.tags.contains(&pack.sleep_tag),
                        deprivation,
                        death_enabled,
                        false,
                    );
                    let (preference, ordinal) = match admission {
                        crate::beds::Admission::Sleep {
                            preference,
                            ordinal,
                        } => (preference, ordinal),
                        crate::beds::Admission::Exclusive | crate::beds::Admission::Seat { .. } => {
                            (crate::beds::Preference::Unassigned, 0)
                        }
                    };
                    let retain = target.is_some_and(|t| t.object == object)
                        && held == Some(terri_core::SleepPlace(ordinal));
                    Some((
                        risk,
                        !retain,
                        preference,
                        steps.len(),
                        ordinal,
                        admission,
                        steps,
                        media_plan.clone(),
                    ))
                })
                .min_by(|a, b| {
                    a.0.total_cmp(&b.0)
                        .then_with(|| (a.1, a.2, a.3, a.4).cmp(&(b.1, b.2, b.3, b.4)))
                })
                .map(|(risk, _, _, _, _, admission, steps, lease)| (risk, admission, steps, lease));
            if let Some((risk, admission, steps, lease)) = chosen {
                candidates.push((
                    steps.len(),
                    object.index_u32(),
                    interaction as u32,
                    object,
                    admission,
                    steps,
                    risk,
                    lease,
                ));
            }
        }
    }
    let mut choices = candidates.iter().map(|row| (row.3, row.2, 0.0)).collect();
    let mut risks = candidates.iter().map(|row| row.6).collect();
    let admissions = candidates
        .iter()
        .map(|row| ((row.3, row.2), row.4))
        .collect();
    crate::beds::prefer_assignments(&mut choices, &mut risks, &admissions);
    let eligible: std::collections::HashSet<_> =
        choices.into_iter().map(|row| (row.0, row.1)).collect();
    candidates.retain(|row| eligible.contains(&(row.3, row.2)));
    candidates.sort_by_key(|(length, index, act, _, _, _, _, _)| (*length, *index, *act));
    if let Some((_, _, interaction, object, admission, steps, _, lease)) =
        candidates.into_iter().next()
    {
        let model = world
            .get::<SmartObject>(object)
            .expect("candidate object")
            .0;
        if let Some((recipe, chain)) =
            crate::action_rows::resolve(pack, model, interaction).and_then(|row| row.recipe)
        {
            if let Some(t) = target {
                crate::reservations::release_now(world, actor, t);
            }
            crate::domestic::abandon(world, actor);
            world
                .entity_mut(actor)
                .remove::<(
                    Target,
                    Path,
                    terri_core::Eating,
                    terri_core::StepWork,
                    terri_core::Carrying,
                    terri_core::Fumbled,
                    terri_core::SleepPlace,
                )>()
                .insert(crate::recipe_actions::begin(
                    pack,
                    model,
                    interaction,
                    recipe,
                    object,
                ));
            if chain.id == crate::domestic::CLEANUP {
                crate::domestic::directed_cleanup(world, actor);
            }
            maintain(world);
            return true;
        }
        crate::domestic::suspend_cleanup(world, actor);
        if let Some(t) = target {
            crate::reservations::release_now(world, actor, t);
        }
        match admission {
            crate::beds::Admission::Exclusive | crate::beds::Admission::Seat { .. } => {
                world.entity_mut(actor).remove::<terri_core::SleepPlace>();
            }
            crate::beds::Admission::Sleep { ordinal, .. } => {
                world
                    .entity_mut(actor)
                    .insert(terri_core::SleepPlace(ordinal));
            }
        }
        world.entity_mut(object).insert(Reserved);
        world.entity_mut(actor).insert((
            Target {
                object,
                interaction,
            },
            Path { steps, cursor: 0 },
        ));
        crate::seating::apply_admission(world, actor, admission);
        if let Some(plan) = lease {
            crate::seating::replace_media(world, actor, plan);
        }
        return true;
    }
    false
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn every_boundary_field_changes_the_hash_and_diagnostics_do_not() {
        let mut sim = crate::Sim::new();
        let original = SavedBoundaryDecision {
            actor: 0,
            expires: 30,
            lapse: false,
            waiting_since: Some(0),
            goal: Some((4, 0)),
            directed_chain: Some(0),
        };
        sim.world_mut()
            .resource_mut::<BoundaryDecisions>()
            .0
            .insert(0, original.clone());
        let baseline = sim.world_hash();
        for field in 0..7 {
            let mut changed = original.clone();
            match field {
                0 => changed.actor = 1,
                1 => changed.expires = 31,
                2 => changed.lapse = true,
                3 => changed.waiting_since = Some(1),
                4 => changed.goal = Some((5, 0)),
                5 => changed.goal = Some((4, 1)),
                _ => changed.directed_chain = Some(1),
            }
            sim.world_mut()
                .resource_mut::<BoundaryDecisions>()
                .0
                .insert(0, changed);
            assert_ne!(sim.world_hash(), baseline, "field {field}");
            sim.world_mut()
                .resource_mut::<BoundaryDecisions>()
                .0
                .insert(0, original.clone());
            assert_eq!(sim.world_hash(), baseline);
        }
        sim.world_mut()
            .resource_mut::<BoundaryDecisions>()
            .0
            .clear();
        assert_ne!(sim.world_hash(), baseline);
    }

    #[test]
    fn shyness_reduces_lapses_and_expiry_allows_one_new_draw() {
        let mut policy = terri_data::pack().tuning.relationships;
        policy.privacy_respect_chance = 0.7;
        policy.shyness_respect_strength = 0.2;
        let mut counts = [0, 0, 0];
        for seed in 0..1000 {
            for (index, shy) in [1, 50, 100].into_iter().enumerate() {
                let mut state = BoundaryDecisions::default();
                let mut rng = SimRng::from_seed(seed);
                if state.lapse(SimId(0), 0, shy, policy, &mut rng) {
                    counts[index] += 1;
                }
                let before = rng.clone();
                state.lapse(SimId(0), 29, shy, policy, &mut rng);
                assert_eq!(rng, before);
                state.lapse(SimId(0), 30, shy, policy, &mut rng);
                assert_ne!(rng, before);
            }
        }
        assert!(counts[0] > counts[1] && counts[1] > counts[2]);
    }
    #[test]
    fn cached_respect_waits_without_rerolls_and_only_relevant_emergencies_override() {
        let mut tuning = terri_data::pack().tuning;
        tuning.relationships.privacy_respect_chance = 1.0;
        tuning.relationships.shyness_respect_strength = 0.0;
        let mut state = BoundaryDecisions::default();
        let mut rng = SimRng::from_seed(1);
        assert_eq!(
            state.permits(SimId(0), Some((2, 0)), 0, 100.0, 50, tuning, &mut rng),
            (false, false)
        );
        let after = rng.clone();
        for tick in 1..30 {
            assert_eq!(
                state.permits(SimId(0), Some((2, 0)), tick, 100.0, 50, tuning, &mut rng),
                (false, false)
            );
        }
        assert_eq!(rng, after);
        assert_eq!(
            state.permits(SimId(0), Some((2, 0)), 30, 20.0, 50, tuning, &mut rng),
            (true, true)
        );
        assert_eq!(
            state.permits(SimId(1), Some((2, 0)), 30, 5.0, 50, tuning, &mut rng),
            (true, true)
        );
        assert_eq!(
            state.permits(SimId(2), Some((2, 0)), 30, 20.0, 50, tuning, &mut rng),
            (false, false)
        );
    }
}

#[cfg(test)]
#[path = "privacy_bed_tests.rs"]
mod bed_tests;
