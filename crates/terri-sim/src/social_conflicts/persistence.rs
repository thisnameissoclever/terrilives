use super::*;
use crate::save::SaveError;

fn actors(world: &World) -> BTreeMap<SavedOrderActor, Entity> {
    world
        .try_query_filtered::<(Entity, Option<&SimId>), With<Agent>>()
        .map_or_else(BTreeMap::new, |mut q| {
            q.iter(world)
                .map(|(entity, id)| {
                    (
                        id.map_or(SavedOrderActor::Entity(entity.index_u32()), |id| {
                            SavedOrderActor::Sim(id.0)
                        }),
                        entity,
                    )
                })
                .collect()
        })
}

pub(crate) fn restore(world: &mut World, saved: SavedConflictState) -> Result<(), SaveError> {
    let now = world.resource::<SimClock>().tick;
    let actors = actors(world);
    let person = |id| actors.get(&SavedOrderActor::Sim(id)).copied();
    if saved.next_id == 0
        || saved.grievances.len() > MAX_GRIEVANCES
        || saved.repairs.len() > MAX_REPAIRS
        || saved.fights.len() > actors.len().saturating_mul(2)
        || crate::fights::published_rules(world)
            && (saved.next_id != 1
                || !saved.grievances.is_empty()
                || !saved.repairs.is_empty()
                || !saved.dish_contributions.is_empty()
                || saved.fights.iter().any(|row| !row.legacy))
        || saved.dish_contributions.len() > MAX_DISH_CONTRIBUTIONS
        || saved.grievances.windows(2).any(|w| w[0].id >= w[1].id)
        || saved
            .fights
            .windows(2)
            .any(|w| (w[0].initiator, w[0].order_id) >= (w[1].initiator, w[1].order_id))
        || saved.repairs.windows(2).any(|w| {
            (w[0].recipient, w[0].fought_at, w[0].initiator)
                >= (w[1].recipient, w[1].fought_at, w[1].initiator)
        })
    {
        return Err(SaveError::InvalidValue);
    }
    let mut state = State {
        next_id: saved.next_id,
        ..State::default()
    };
    let player_pins: BTreeSet<_> = saved
        .fights
        .iter()
        .filter(|context| {
            !context.autonomous
                && actors
                    .get(&context.initiator)
                    .zip(actors.get(&context.recipient))
                    .is_some_and(|(&actor, &recipient)| {
                        world
                            .get::<Socialising>(actor)
                            .is_some_and(|s| s.partner == recipient)
                    })
        })
        .filter_map(|context| context.grievance)
        .collect();
    let valid_keys: BTreeMap<_, _> = saved
        .grievances
        .iter()
        .filter_map(|r| match r.subject {
            GrievanceSubject::Chore(o) => Some(o.key),
            _ => None,
        })
        .collect::<BTreeSet<_>>()
        .into_iter()
        .map(|key| (key, crate::chores::key_valid(world, key)))
        .collect();
    for row in saved.grievances {
        let valid_subject = match (row.kind, row.subject) {
            (GrievanceKind::Chore, GrievanceSubject::Chore(o)) => {
                (person(o.owner).is_some()
                    || player_pins.contains(&row.id)
                        && o.owner < world.resource::<terri_core::SimIdAllocator>().issued())
                    && o.actionable_since <= row.last_seen
                    && (valid_keys[&o.key] || player_pins.contains(&row.id))
            }
            (GrievanceKind::Nuisance, GrievanceSubject::Nuisance { object, .. }) => {
                crate::dining::entity(world, object)
                    .is_some_and(|e| world.get::<terri_core::SmartObject>(e).is_some())
                    || player_pins.contains(&row.id)
            }
            (
                GrievanceKind::PrivacyEntry
                | GrievanceKind::PrivacyStart
                | GrievanceKind::NeedInterruption
                | GrievanceKind::Chore,
                GrievanceSubject::None,
            ) => true,
            _ => false,
        };
        if row.id == 0
            || row.id >= saved.next_id
            || row.affected == row.responsible
            || person(row.affected).is_none()
            || person(row.responsible).is_none()
            || row.occurred_at > row.last_seen
            || row.last_seen > now
            || row.active_until < row.last_seen
            || row.active_until > row.last_seen.saturating_add(MAX_MEMORY_TICKS)
            || row.forget_at < row.active_until
            || row.forget_at > row.last_seen.saturating_add(MAX_MEMORY_TICKS)
            || row
                .last_fought
                .is_some_and(|tick| tick < row.occurred_at || tick > now)
            || !row.severity.is_finite()
            || !(0.0..=2.0).contains(&row.severity)
            || row.severity == 0.0
            || !valid_subject
            || state
                .affected
                .get(&row.affected)
                .is_some_and(|ids| ids.len() >= MAX_GRIEVANCES_PER_PERSON)
        {
            return Err(SaveError::InvalidValue);
        }
        state.index(&row);
        state.grievances.insert(row.id, row);
    }
    for row in saved.fights {
        let (&initiator, &recipient) = actors
            .get(&row.initiator)
            .zip(actors.get(&row.recipient))
            .ok_or(SaveError::InvalidEntityReference)?;
        let reason = if row.legacy {
            crate::fights::Reason::from_tag(&row.topic_tag)
        } else {
            crate::fights::Reason::from_tag_current(&row.topic_tag)
        }
        .ok_or(SaveError::InvalidValue)?;
        let execution = world
            .resource::<crate::social_episode::SocialEpisodes>()
            .executions
            .get(&initiator);
        let execution_matches = execution.is_some_and(|execution| {
            execution.recipient == recipient
                && match execution.owner {
                    crate::social_episode::ExecutionOwner::Player(id) => {
                        !row.autonomous && row.order_id == Some(id)
                    }
                    crate::social_episode::ExecutionOwner::System(Some(id)) => {
                        row.autonomous && row.order_id == Some(id)
                    }
                    _ => row.legacy && row.order_id.is_none(),
                }
        });
        let running = execution_matches
            && world.get::<Socialising>(initiator).is_some_and(|talk| {
                talk.partner == recipient
                    && world
                        .resource::<crate::Content>()
                        .0
                        .social
                        .get(talk.interaction as usize)
                        .is_some_and(crate::fights::is_fight)
            });
        let exact_order = row
            .order_id
            .and_then(|id| world.get::<terri_core::IntentQueue>(initiator)?.order(id))
            .is_some_and(|entry| {
                entry.intent.object == recipient
                    && world
                        .resource::<crate::Content>()
                        .0
                        .social
                        .get(entry.intent.interaction as usize)
                        .is_some_and(crate::fights::is_fight)
            });
        if initiator == recipient
            || row.started_at > now
            || u32::from(row.topic_code) != crate::fights::Reason::code(reason)
            || (!running && !row.autonomous)
            || (row.autonomous
                && (!exact_order
                    || !row.order_id.is_some_and(|id| {
                        world
                            .resource::<crate::fights::Fights>()
                            .owns_order(initiator, id)
                    })))
            || row.legacy && row.grievance.is_some()
            || !row.legacy && row.autonomous && row.grievance.is_none()
            || !row.legacy
                && row.grievance.is_none()
                && !matches!(reason, Some(crate::fights::Reason::Random(_)))
        {
            return Err(SaveError::InvalidValue);
        }
        if let Some(id) = row.grievance {
            let grievance = state.grievances.get(&id).ok_or(SaveError::InvalidValue)?;
            let pair = (
                SavedOrderActor::Sim(grievance.affected),
                SavedOrderActor::Sim(grievance.responsible),
            );
            if (pair != (row.initiator, row.recipient)
                && (row.autonomous || pair != (row.recipient, row.initiator)))
                || Some(crate::fights::reason_for(grievance)) != reason
                || row.started_at < grievance.occurred_at
                || row.autonomous
                    && !running
                    && !crate::fights::eligible_for(
                        world,
                        grievance,
                        now,
                        person(grievance.responsible),
                    )
                || row.autonomous
                    && matches!(grievance.subject,GrievanceSubject::Chore(o) if o.owner!=grievance.responsible || !crate::chore_repair::still_unfinished_for(world,o,recipient))
            {
                return Err(SaveError::InvalidValue);
            }
        }
        let destination = if running {
            let topic = world
                .resource::<crate::social_episode::SocialEpisodes>()
                .topics
                .get(&initiator)
                .ok_or(SaveError::InvalidValue)?;
            if topic.code != u32::from(row.topic_code) || topic.tag != row.topic_tag {
                return Err(SaveError::InvalidValue);
            }
            &mut state.fights
        } else {
            &mut state.pending_fights
        };
        if destination.insert(initiator, row).is_some() {
            return Err(SaveError::InvalidValue);
        }
    }
    let mut total_witnesses = 0usize;
    let mut recipients = BTreeMap::<u32, usize>::new();
    for row in saved.repairs {
        let recipient = person(row.recipient).ok_or(SaveError::InvalidEntityReference)?;
        let count = recipients.entry(row.recipient).or_default();
        *count += 1;
        total_witnesses = total_witnesses
            .checked_add(row.witnesses.len())
            .ok_or(SaveError::InvalidValue)?;
        if row.recipient == row.initiator
            || person(row.initiator).is_none()
            || row.obligation.owner != row.recipient
            || row.obligation.actionable_since > row.fought_at
            || row.fought_at > now
            || row.deadline < row.fought_at
            || row.deadline > row.fought_at.saturating_add(MAX_MEMORY_TICKS)
            || row.deadline < now
            || row.working && !row.attempted
            || row.contributed_units > 0
                && (!row.attempted
                    || row.obligation.key.kind != terri_core::chores::ChoreKind::Dishes)
            || *count > MAX_REPAIRS_PER_PERSON
            || total_witnesses > MAX_WITNESSES
            || row.witnesses.windows(2).any(|w| w[0] >= w[1])
            || row
                .witnesses
                .iter()
                .any(|id| person(*id).is_none() || *id == row.recipient)
            || !crate::chore_repair::valid_saved_repair(world, &row, recipient)
        {
            return Err(SaveError::InvalidValue);
        }
        state
            .repairs
            .insert((row.recipient, row.fought_at, row.initiator), row);
    }
    if saved
        .dish_contributions
        .windows(2)
        .any(|w| (w[0].obligation, w[0].person) >= (w[1].obligation, w[1].person))
    {
        return Err(SaveError::InvalidValue);
    }
    let mut contribution_scopes = BTreeMap::new();
    for row in saved.dish_contributions {
        let valid = *contribution_scopes
            .entry(row.obligation)
            .or_insert_with(|| {
                crate::chore_repair::valid_saved_contribution(world, row.obligation, &state.repairs)
            });
        if row.units == 0
            || person(row.person).is_none()
            || person(row.obligation.owner).is_none()
            || row.obligation.actionable_since > now
            || row.obligation.key.kind != terri_core::chores::ChoreKind::Dishes
            || row.obligation.key.target != 0
            || !valid
        {
            return Err(SaveError::InvalidValue);
        }
        state
            .dish_contributions
            .insert((row.obligation, row.person), row.units);
    }
    if state.repairs.values().any(|row| {
        row.contributed_units > 0
            && state
                .dish_contributions
                .get(&(row.obligation, row.recipient))
                .copied()
                .unwrap_or(0)
                < row.contributed_units
    }) {
        return Err(SaveError::InvalidValue);
    }
    let mut talks = world.query::<(Entity, &Socialising)>();
    if talks.iter(world).any(|(actor, talk)| {
        world
            .resource::<crate::Content>()
            .0
            .social
            .get(talk.interaction as usize)
            .is_some_and(crate::fights::is_fight)
            && !state.fights.contains_key(&actor)
    }) || world
        .resource::<crate::fights::Fights>()
        .saved_orders(world)
        .iter()
        .any(|(index, id)| {
            crate::dining::entity(world, *index).is_none_or(|actor| {
                state
                    .pending_fights
                    .get(&actor)
                    .or_else(|| state.fights.get(&actor).filter(|row| row.autonomous))
                    .is_none_or(|row| row.order_id != Some(*id))
            })
        })
    {
        return Err(SaveError::InvalidValue);
    }
    world.insert_resource(state);
    Ok(())
}

/// Called exclusively while upgrading a source older than schema twenty.
pub(crate) fn adopt_legacy(world: &mut World) {
    let now = world.resource::<SimClock>().tick;
    let system_orders: BTreeMap<_, _> = world
        .resource::<crate::fights::Fights>()
        .saved_orders(world)
        .into_iter()
        .filter_map(|(index, id)| Some((crate::dining::entity(world, index)?, id)))
        .collect();
    let talks: Vec<_> = world
        .query::<(Entity, &Socialising)>()
        .iter(world)
        .filter(|(_, talk)| {
            world
                .resource::<crate::Content>()
                .0
                .social
                .get(talk.interaction as usize)
                .is_some_and(crate::fights::is_fight)
        })
        .map(|(actor, talk)| (actor, talk.partner))
        .collect();
    let mut running = BTreeMap::new();
    let mut pending = BTreeMap::new();
    for (actor, recipient) in talks {
        let order = crate::social_episode::request_order_id(world, actor);
        let autonomous = order.is_some() && system_orders.get(&actor).copied() == order;
        if let Some(row) = legacy_context(world, actor, recipient, autonomous, order, now, true) {
            running.insert(actor, row);
        }
    }
    for (actor, id) in system_orders {
        if running
            .get(&actor)
            .is_some_and(|row| row.autonomous && row.order_id == Some(id))
        {
            continue;
        }
        let Some(entry) = world
            .get::<terri_core::IntentQueue>(actor)
            .and_then(|q| q.order(id))
        else {
            continue;
        };
        if let Some(row) = legacy_context(
            world,
            actor,
            entry.intent.object,
            true,
            Some(id),
            now,
            false,
        ) {
            pending.insert(actor, row);
        }
    }
    let mut state = world.get_resource_or_insert_with(State::default);
    state.fights = running;
    state.pending_fights = pending;
}

fn legacy_context(
    world: &World,
    actor: Entity,
    recipient: Entity,
    autonomous: bool,
    order_id: Option<u64>,
    now: u64,
    running: bool,
) -> Option<SavedFightContext> {
    let (initiator, recipient) = crate::player_actions::saved_actor(world, actor)
        .zip(crate::player_actions::saved_actor(world, recipient))?;
    let topic = running
        .then(|| {
            world
                .resource::<crate::social_episode::SocialEpisodes>()
                .topics
                .get(&actor)
        })
        .flatten();
    let (topic_code, topic_tag) =
        topic.map_or((26, "fight".into()), |t| (t.code as u8, t.tag.clone()));
    Some(SavedFightContext {
        initiator,
        recipient,
        grievance: None,
        autonomous,
        started_at: now,
        topic_code,
        topic_tag,
        legacy: true,
        order_id,
    })
}
pub(crate) fn hash(world: &World, hash: &mut FnvHasher) {
    if crate::fights::published_rules(world) {
        return;
    }
    let saved = snapshot(world);
    if saved == SavedConflictState::default() {
        return;
    }
    hash.write_bytes(b"social-conflicts-v20");
    hash.write_u64(saved.next_id);
    hash.write_u64(saved.grievances.len() as u64);
    for row in saved.grievances {
        for value in [
            row.id,
            u64::from(row.affected),
            u64::from(row.responsible),
            row.kind as u64,
            row.occurred_at,
            row.last_seen,
            row.active_until,
            row.forget_at,
            u64::from(row.severity.to_bits()),
        ] {
            hash.write_u64(value);
        }
        optional(hash, row.last_fought);
        subject(hash, row.subject);
    }
    hash.write_u64(saved.fights.len() as u64);
    let pending: BTreeSet<_> = world
        .get_resource::<State>()
        .into_iter()
        .flat_map(|s| s.pending_fights.values())
        .map(|row| (row.initiator, row.order_id))
        .collect();
    for row in saved.fights {
        hash.write_u64(u64::from(pending.contains(&(row.initiator, row.order_id))));
        actor(hash, row.initiator);
        actor(hash, row.recipient);
        for value in [
            u64::from(row.autonomous),
            row.started_at,
            u64::from(row.topic_code),
            u64::from(row.legacy),
        ] {
            hash.write_u64(value);
        }
        optional(hash, row.grievance);
        optional(hash, row.order_id);
        hash.write_u64(row.topic_tag.len() as u64);
        hash.write_bytes(row.topic_tag.as_bytes());
    }
    hash.write_u64(saved.repairs.len() as u64);
    for row in saved.repairs {
        for value in [
            u64::from(row.recipient),
            u64::from(row.initiator),
            row.fought_at,
            row.deadline,
            u64::from(row.accepted),
            u64::from(row.attempted),
            u64::from(row.working),
            u64::from(row.contributed_units),
        ] {
            hash.write_u64(value);
        }
        subject(hash, GrievanceSubject::Chore(row.obligation));
        hash.write_u64(row.witnesses.len() as u64);
        for id in row.witnesses {
            hash.write_u64(u64::from(id));
        }
    }
    hash.write_u64(saved.dish_contributions.len() as u64);
    for row in saved.dish_contributions {
        subject(hash, GrievanceSubject::Chore(row.obligation));
        hash.write_u64(u64::from(row.person));
        hash.write_u64(u64::from(row.units));
    }
}
fn actor(hash: &mut FnvHasher, actor: SavedOrderActor) {
    match actor {
        SavedOrderActor::Sim(id) => {
            hash.write_u64(0);
            hash.write_u64(u64::from(id));
        }
        SavedOrderActor::Entity(id) => {
            hash.write_u64(1);
            hash.write_u64(u64::from(id));
        }
    }
}
fn optional(hash: &mut FnvHasher, value: Option<u64>) {
    hash.write_u64(u64::from(value.is_some()));
    if let Some(value) = value {
        hash.write_u64(value);
    }
}
fn subject(hash: &mut FnvHasher, subject: GrievanceSubject) {
    match subject {
        GrievanceSubject::None => hash.write_u64(0),
        GrievanceSubject::Chore(o) => {
            hash.write_u64(1);
            hash.write_u64(o.key.kind as u64);
            hash.write_u64(u64::from(o.key.target));
            hash.write_u64(u64::from(o.owner));
            hash.write_u64(o.actionable_since);
        }
        GrievanceSubject::Nuisance { object, kind } => {
            hash.write_u64(2);
            hash.write_u64(u64::from(object));
            hash.write_u64(kind as u64);
        }
    }
}
