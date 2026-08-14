//! Simulation snapshot capture, validation, and reconstruction.

use crate::systems::chain::CHAIN_STEP;
use crate::{default_action_sockets, Content, ResolvedActionSockets, Sim};
use bevy_ecs::{
    entity::EntityIndex,
    prelude::{Entity, World},
};
use terri_core::{
    Agent, AtWork, Blocked, Career, Carrying, ChainState, CommandQueue, Commuting, Eating, Fumbled,
    Funds, Habituation, Hobbies, Intent, IntentQueue, Needs, Path, Personality, Position,
    Relationships, Reserved, Restless, Satisfaction, SaveSnapshotV1, SavedChainState, SavedCommand,
    SavedEating, SavedEntity, SavedHabituation, SavedIntent, SavedPath, SavedPersonality,
    SavedPosition, SavedSocialising, SavedTarget, SavedTraitState, Selected, SimClock, SimCommand,
    SimId, SimIdAllocator, SimName, SimRng, SmartObject, Socialising, SpriteVariant, StepWork,
    Target, TileGrid, Traits, Wander, NEED_MAX, NEED_MIN,
};
use terri_data::{ContentPack, ObjectDefId};

const MAX_TILES: usize = 1_048_576;
const MAX_ENTITIES: usize = 100_000;
const MAX_LIST_ENTRIES: usize = 100_000;
const MAX_TEXT_BYTES: usize = 1_024;
const LEGACY_HOUSEHOLD_NAMES: [&str; 3] = ["Terri", "Doug", "Nadia"];
const AQUARIUM_BIKE_PERSISTENCE_KEYS: [&str; 2] = ["moving_box", "reference_shelf"];

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SaveError {
    IncompatibleContent,
    InvalidGrid,
    TooManyEntities,
    InvalidEntityOrder,
    InvalidEntityReference,
    InvalidContentReference,
    InvalidValue,
    DuplicateSelection,
    InvalidSimIdAllocator,
    TooManyCommands,
}

pub(super) fn capture(sim: &Sim) -> SaveSnapshotV1 {
    let world = sim.world();
    let pack = world.resource::<Content>().0;
    let grid = world.resource::<TileGrid>();

    let mut blocked_tiles = Vec::with_capacity(grid.width() * grid.height());
    for y in 0..grid.height() {
        for x in 0..grid.width() {
            blocked_tiles.push(!grid.is_walkable(x as i32, y as i32));
        }
    }

    let mut entities = Vec::with_capacity(world.entities().count_spawned() as usize);
    for raw_index in 0..world.entities().len() {
        let index = EntityIndex::from_raw_u32(raw_index)
            .expect("world entity indices never use the u32::MAX placeholder");
        if world.entities().is_index_spawned(index) {
            let entity = world.entities().resolve_from_index(index);
            entities.push(capture_entity(world.entity(entity), pack));
        }
    }

    // Sparse: only the sims actually carrying pressure. Absent means
    // zero, so a rested household writes nothing.
    let mut sleep_pressure = Vec::new();
    for raw_index in 0..world.entities().len() {
        let index = EntityIndex::from_raw_u32(raw_index)
            .expect("world entity indices never use the u32::MAX placeholder");
        if !world.entities().is_index_spawned(index) {
            continue;
        }
        let entity = world.entities().resolve_from_index(index);
        if let Some(pressure) = world.entity(entity).get::<terri_core::SleepPressure>() {
            if pressure.ticks > 0 {
                sleep_pressure.push((raw_index, pressure.ticks));
            }
        }
    }

    SaveSnapshotV1 {
        sleep_pressure,
        content_fingerprint: terri_data::content_fingerprint(pack),
        tick: world.resource::<SimClock>().tick,
        rng: world.resource::<SimRng>().clone(),
        funds: world.resource::<Funds>().0,
        issued_sim_ids: world.resource::<SimIdAllocator>().issued(),
        grid_width: grid.width() as u32,
        grid_height: grid.height() as u32,
        blocked_tiles,
        entities,
        queued_commands: world
            .resource::<CommandQueue>()
            .as_slice()
            .iter()
            .map(capture_command)
            .collect(),
    }
}

fn capture_entity(entity: bevy_ecs::world::EntityRef<'_>, pack: &ContentPack) -> SavedEntity {
    let object_name = |id: ObjectDefId| {
        pack.objects
            .get(id.0 as usize)
            .expect("live SmartObject points inside its ContentPack")
            .id
            .clone()
    };

    SavedEntity {
        index: entity.id().index_u32(),
        position: entity
            .get::<Position>()
            .map(|p| SavedPosition { x: p.x, y: p.y }),
        agent: entity.get::<Agent>().is_some(),
        smart_object: entity.get::<SmartObject>().map(|o| object_name(o.0)),
        reserved: entity.get::<Reserved>().is_some(),
        path: entity.get::<Path>().map(|path| SavedPath {
            steps: path.steps.clone(),
            cursor: path.cursor as u32,
        }),
        target: entity.get::<Target>().map(|target| SavedTarget {
            object: target.object.index_u32(),
            interaction: target.interaction,
        }),
        eating: entity.get::<Eating>().map(|eating| SavedEating {
            object: object_name(eating.object),
            interaction: eating.interaction,
            remaining_ticks: eating.remaining_ticks,
        }),
        restless: entity.get::<Restless>().is_some(),
        blocked: entity.get::<Blocked>().is_some(),
        wander_pause_ticks: entity.get::<Wander>().map(|wander| wander.pause_ticks),
        selected: entity.get::<Selected>().is_some(),
        intents: entity.get::<IntentQueue>().map(|queue| {
            queue
                .as_slice()
                .iter()
                .map(|intent| SavedIntent {
                    object: intent.object.index_u32(),
                    interaction: intent.interaction,
                })
                .collect()
        }),
        needs: entity.get::<Needs>().map(|needs| *needs.as_slice()),
        habituation: entity.get::<Habituation>().map(|habituation| {
            habituation
                .entries()
                .iter()
                .map(|(object, interaction, value)| SavedHabituation {
                    object: object_name(*object),
                    interaction: *interaction,
                    value: *value,
                })
                .collect()
        }),
        sim_id: entity.get::<SimId>().map(|id| id.0),
        sim_name: entity.get::<SimName>().map(|name| name.0.clone()),
        personality: entity
            .get::<Personality>()
            .map(|personality| SavedPersonality {
                drain: personality.drain,
                satisfaction: personality.satisfaction,
                dispositions: personality
                    .dispositions()
                    .iter()
                    .map(|(object, interaction, value)| SavedHabituation {
                        object: object_name(*object),
                        interaction: *interaction,
                        value: *value,
                    })
                    .collect(),
            }),
        relationships: entity.get::<Relationships>().map(|relationships| {
            relationships
                .entries()
                .iter()
                .map(|(id, feeling)| (id.0, *feeling))
                .collect()
        }),
        socialising: entity.get::<Socialising>().map(|social| SavedSocialising {
            interaction: social.interaction,
            partner: social.partner.index_u32(),
            remaining_ticks: social.remaining_ticks,
        }),
        satisfaction: entity.get::<Satisfaction>().map(Satisfaction::value),
        hobbies: entity.get::<Hobbies>().map(|hobbies| hobbies.0.clone()),
        traits: entity.get::<Traits>().map(|traits| {
            traits
                .entries()
                .iter()
                .map(|(index, state)| SavedTraitState {
                    id: pack.traits[*index as usize].id.clone(),
                    state: *state,
                })
                .collect()
        }),
        fumbled_delta_scale: entity.get::<Fumbled>().map(|fumble| fumble.delta_scale),
        career: entity
            .get::<Career>()
            .map(|career| pack.careers[career.0 as usize].id.clone()),
        commuting: entity.get::<Commuting>().is_some(),
        at_work_ticks: entity.get::<AtWork>().map(|work| work.remaining_ticks),
        chain: entity.get::<ChainState>().map(|chain| SavedChainState {
            chain: pack.chains[chain.chain as usize].id.clone(),
            step: chain.step,
            fumble_scale: chain.fumble_scale,
        }),
        carrying: entity
            .get::<Carrying>()
            .map(|item| pack.item_kinds[item.0 as usize].clone()),
        step_work_ticks: entity.get::<StepWork>().map(|work| work.remaining_ticks),
    }
}

fn capture_command(command: &SimCommand) -> SavedCommand {
    match command {
        SimCommand::Select(entity) => SavedCommand::Select(*entity),
        SimCommand::UseObject {
            agent,
            object,
            interaction,
        } => SavedCommand::UseObject {
            agent: *agent,
            object: *object,
            interaction: *interaction,
        },
        SimCommand::CancelIntents { agent } => SavedCommand::CancelIntents { agent: *agent },
        SimCommand::SetSpeed(speed) => SavedCommand::SetSpeed(*speed),
        SimCommand::TalkTo {
            agent,
            target,
            interaction,
        } => SavedCommand::TalkTo {
            agent: *agent,
            target: *target,
            interaction: *interaction,
        },
    }
}

pub(super) fn restore(
    snapshot: SaveSnapshotV1,
    content: &'static ContentPack,
) -> Result<Sim, SaveError> {
    validate_snapshot(&snapshot, content)?;
    let migrate_legacy_household_names =
        terri_data::content_fingerprint_is_legacy(content, snapshot.content_fingerprint);

    let mut sim = Sim::new();
    sim.world.insert_resource(Content(content));
    sim.world.insert_resource(SimClock {
        tick: snapshot.tick,
    });
    sim.world.insert_resource(snapshot.rng);
    sim.world.insert_resource(Funds(snapshot.funds));

    let mut allocator = SimIdAllocator::default();
    for _ in 0..snapshot.issued_sim_ids {
        allocator.issue();
    }
    sim.world.insert_resource(allocator);

    let mut grid = TileGrid::new(snapshot.grid_width as usize, snapshot.grid_height as usize);
    for (index, blocked) in snapshot.blocked_tiles.into_iter().enumerate() {
        if blocked {
            grid.set_blocked(
                index % snapshot.grid_width as usize,
                index / snapshot.grid_width as usize,
                true,
            );
        }
    }
    sim.world.insert_resource(grid);

    let max_index = snapshot.entities.last().map(|entity| entity.index);
    let mut slots = vec![None; max_index.map_or(0, |index| index as usize + 1)];
    let mut holes = Vec::new();
    let mut saved_cursor = 0usize;
    if let Some(max_index) = max_index {
        for index in 0..=max_index {
            let spawned = sim.world.spawn_empty().id();
            if spawned.index_u32() != index {
                return Err(SaveError::InvalidEntityOrder);
            }
            if snapshot
                .entities
                .get(saved_cursor)
                .is_some_and(|saved| saved.index == index)
            {
                slots[index as usize] = Some(spawned);
                saved_cursor += 1;
            } else {
                holes.push(spawned);
            }
        }
    }

    for saved in &snapshot.entities {
        restore_entity(
            &mut sim.world,
            saved,
            &slots,
            content,
            migrate_legacy_household_names,
        )?;
    }

    // Sleep pressure, after every entity exists so an index can be
    // resolved. Restored rather than recomputed: it counts elapsed ticks,
    // and nothing in a loaded world remembers how long ago they were.
    for (index, ticks) in &snapshot.sleep_pressure {
        let Some(Some(entity)) = slots.get(*index as usize).copied() else {
            return Err(SaveError::InvalidContentReference);
        };
        sim.world
            .entity_mut(entity)
            .insert(terri_core::SleepPressure { ticks: *ticks });
    }

    for hole in holes {
        let removed = sim.world.despawn(hole);
        debug_assert!(removed, "placeholder entity was live before removal");
    }

    let commands = snapshot
        .queued_commands
        .into_iter()
        .map(restore_command)
        .collect();
    sim.world
        .insert_resource(CommandQueue::from_commands(commands));
    sim.sync_render_buffer();
    Ok(sim)
}

fn restore_entity(
    world: &mut World,
    saved: &SavedEntity,
    slots: &[Option<Entity>],
    pack: &ContentPack,
    migrate_legacy_household_names: bool,
) -> Result<(), SaveError> {
    let entity = slots[saved.index as usize].ok_or(SaveError::InvalidEntityReference)?;
    let mut target = world.entity_mut(entity);

    if let Some(position) = saved.position {
        target.insert(Position {
            x: position.x,
            y: position.y,
        });
    }
    if saved.agent {
        target.insert(Agent);
    }
    if let Some(id) = saved.smart_object.as_deref() {
        target.insert(SmartObject(resolve_object(pack, id)?));
    }
    if saved.reserved {
        target.insert(Reserved);
    }
    if let Some(path) = &saved.path {
        target.insert(Path {
            steps: path.steps.clone(),
            cursor: path.cursor as usize,
        });
    }
    if let Some(saved_target) = saved.target {
        target.insert(Target {
            object: resolve_entity(slots, saved_target.object)?,
            interaction: saved_target.interaction,
        });
    }
    if let Some(eating) = &saved.eating {
        target.insert(Eating {
            object: resolve_object(pack, &eating.object)?,
            interaction: eating.interaction,
            remaining_ticks: eating.remaining_ticks,
        });
    }
    if saved.restless {
        target.insert(Restless);
    }
    if saved.blocked {
        target.insert(Blocked);
    }
    if let Some(pause_ticks) = saved.wander_pause_ticks {
        target.insert(Wander { pause_ticks });
    }
    if saved.selected {
        target.insert(Selected);
    }
    if let Some(intents) = &saved.intents {
        let restored = intents
            .iter()
            .map(|intent| {
                Ok(Intent {
                    object: resolve_entity(slots, intent.object)?,
                    interaction: intent.interaction,
                })
            })
            .collect::<Result<Vec<_>, SaveError>>()?;
        target.insert(IntentQueue::from_intents(restored));
    }
    if let Some(levels) = saved.needs {
        let mut needs = Needs::all_at(NEED_MAX);
        for (id, level) in terri_core::NeedId::ALL.into_iter().zip(levels) {
            needs.set(id, level);
        }
        target.insert(needs);
    }
    if let Some(entries) = &saved.habituation {
        let mut habituation = Habituation::default();
        for entry in entries {
            habituation.bump(
                resolve_object(pack, &entry.object)?,
                entry.interaction,
                entry.value,
            );
        }
        target.insert(habituation);
    }
    if let Some(id) = saved.sim_id {
        target.insert(SimId(id));
    }
    if let Some(name) = restored_sim_name(saved, pack, migrate_legacy_household_names) {
        target.insert(SimName(name));
    }
    if let Some(personality) = &saved.personality {
        let dispositions = personality
            .dispositions
            .iter()
            .map(|entry| {
                Ok((
                    resolve_object(pack, &entry.object)?,
                    entry.interaction,
                    entry.value,
                ))
            })
            .collect::<Result<Vec<_>, SaveError>>()?;
        target.insert(Personality::with_dispositions(
            personality.drain,
            personality.satisfaction,
            dispositions,
        ));
    }
    if let Some(entries) = &saved.relationships {
        let mut relationships = Relationships::default();
        for &(other, feeling) in entries {
            relationships.bump(SimId(other), feeling);
        }
        target.insert(relationships);
    }
    if let Some(social) = saved.socialising {
        target.insert(Socialising {
            interaction: social.interaction,
            partner: resolve_entity(slots, social.partner)?,
            remaining_ticks: social.remaining_ticks,
        });
    }
    if let Some(value) = saved.satisfaction {
        let mut satisfaction = Satisfaction::default();
        satisfaction.add(value);
        target.insert(satisfaction);
    }
    if let Some(hobbies) = &saved.hobbies {
        target.insert(Hobbies(hobbies.clone()));
    }
    if let Some(entries) = &saved.traits {
        let states = entries
            .iter()
            .map(|entry| {
                let index = pack
                    .traits
                    .iter()
                    .position(|trait_def| trait_def.id == entry.id)
                    .ok_or(SaveError::InvalidContentReference)?;
                Ok((index as u32, entry.state))
            })
            .collect::<Result<Vec<_>, SaveError>>()?;
        target.insert(Traits::from_entries(states));
    }
    if let Some(delta_scale) = saved.fumbled_delta_scale {
        target.insert(Fumbled { delta_scale });
    }
    if let Some(career) = saved.career.as_deref() {
        let index = pack
            .careers
            .iter()
            .position(|definition| definition.id == career)
            .ok_or(SaveError::InvalidContentReference)?;
        target.insert(Career(index as u32));
    }
    if saved.commuting {
        target.insert(Commuting);
    }
    if let Some(remaining_ticks) = saved.at_work_ticks {
        target.insert(AtWork { remaining_ticks });
    }
    if let Some(chain) = &saved.chain {
        let index = pack
            .chains
            .iter()
            .position(|definition| definition.id == chain.chain)
            .ok_or(SaveError::InvalidContentReference)?;
        target.insert(ChainState {
            chain: index as u32,
            step: chain.step,
            fumble_scale: chain.fumble_scale,
        });
    }
    if let Some(item) = saved.carrying.as_deref() {
        let index = pack
            .item_kinds
            .iter()
            .position(|kind| kind == item)
            .ok_or(SaveError::InvalidContentReference)?;
        target.insert(Carrying(index as u32));
    }
    if let Some(remaining_ticks) = saved.step_work_ticks {
        target.insert(StepWork { remaining_ticks });
    }

    // Facing and action sockets are immutable authored presentation data
    // today, so both are derived from the current pack instead of widening
    // Save V1. This expires when build mode can move or rotate an object: that
    // schema must carry stable placement identity and authored facing.
    if let (Some(position), Some(object_name)) = (saved.position, saved.smart_object.as_deref()) {
        let object = resolve_object(pack, object_name)?;
        let placement = pack
            .lot
            .placements
            .iter()
            .find(|placement| placement_matches(placement, object, position));
        if let Some(placement) = placement {
            if placement.sprite != pack.object(object).sprite {
                target.insert(SpriteVariant(placement.sprite));
            }
            if !placement.action_sockets.is_empty() {
                target.insert(ResolvedActionSockets(placement.action_sockets.clone()));
            }
        } else {
            let sockets = default_action_sockets(
                pack.object(object),
                Position {
                    x: position.x,
                    y: position.y,
                },
            );
            if !sockets.is_empty() {
                target.insert(ResolvedActionSockets(sockets));
            }
        }
    }

    Ok(())
}

/// Applies the one household rename that predates player-authored names.
///
/// Save V1 owns a sim's displayed name because Create-a-Sim is future work.
/// The shipped alpha nevertheless renamed its three authored members after
/// saves existed. For a recognized legacy full-pack fingerprint, replace only
/// the exact old authored name at the matching stable `SimId`; an arbitrary
/// saved name is treated as player data and kept. A save already carrying the
/// current compatibility digest never enters this migration, so a future
/// player may deliberately choose an old cast name without Load undoing it.
fn restored_sim_name(
    saved: &SavedEntity,
    pack: &ContentPack,
    migrate_legacy_household_names: bool,
) -> Option<String> {
    let saved_name = saved.sim_name.as_deref()?;
    if !migrate_legacy_household_names {
        return Some(saved_name.to_string());
    }
    let Some(sim_id) = saved.sim_id.map(|id| id as usize) else {
        return Some(saved_name.to_string());
    };
    let Some(current_member) = pack.household.get(sim_id) else {
        return Some(saved_name.to_string());
    };
    let Some(legacy_name) = LEGACY_HOUSEHOLD_NAMES.get(sim_id) else {
        return Some(saved_name.to_string());
    };
    if saved_name == *legacy_name {
        Some(current_member.name.clone())
    } else {
        Some(saved_name.to_string())
    }
}

fn placement_matches(
    placement: &terri_data::CompiledPlacement,
    object: ObjectDefId,
    position: SavedPosition,
) -> bool {
    placement.object == object
        && placement.x.to_bits() == position.x.to_bits()
        && placement.y.to_bits() == position.y.to_bits()
}

fn restore_command(command: SavedCommand) -> SimCommand {
    match command {
        SavedCommand::Select(entity) => SimCommand::Select(entity),
        SavedCommand::UseObject {
            agent,
            object,
            interaction,
        } => SimCommand::UseObject {
            agent,
            object,
            interaction,
        },
        SavedCommand::CancelIntents { agent } => SimCommand::CancelIntents { agent },
        SavedCommand::SetSpeed(speed) => SimCommand::SetSpeed(speed),
        SavedCommand::TalkTo {
            agent,
            target,
            interaction,
        } => SimCommand::TalkTo {
            agent,
            target,
            interaction,
        },
    }
}

fn validate_snapshot(snapshot: &SaveSnapshotV1, pack: &ContentPack) -> Result<(), SaveError> {
    if !terri_data::content_fingerprint_matches(pack, snapshot.content_fingerprint) {
        return Err(SaveError::IncompatibleContent);
    }
    let pre_aquarium_bike =
        terri_data::content_fingerprint_is_pre_aquarium_bike(pack, snapshot.content_fingerprint);

    let width = snapshot.grid_width as usize;
    let height = snapshot.grid_height as usize;
    let Some(tile_count) = width.checked_mul(height) else {
        return Err(SaveError::InvalidGrid);
    };
    if width == 0 {
        return Err(SaveError::InvalidGrid);
    }
    if height == 0 {
        return Err(SaveError::InvalidGrid);
    }
    if exceeds_limit(tile_count, MAX_TILES) {
        return Err(SaveError::InvalidGrid);
    }
    if snapshot.blocked_tiles.len() != tile_count {
        return Err(SaveError::InvalidGrid);
    }

    if exceeds_limit(snapshot.entities.len(), MAX_ENTITIES) {
        return Err(SaveError::TooManyEntities);
    }
    if exceeds_limit(snapshot.issued_sim_ids as usize, MAX_ENTITIES) {
        return Err(SaveError::InvalidSimIdAllocator);
    }
    let mut previous_index = None;
    let mut selected_count = 0usize;
    let mut sim_ids = Vec::new();
    for entity in &snapshot.entities {
        if entity.index as usize >= MAX_ENTITIES {
            return Err(SaveError::InvalidEntityOrder);
        }
        if previous_index.is_some_and(|previous| entity.index <= previous) {
            return Err(SaveError::InvalidEntityOrder);
        }
        previous_index = Some(entity.index);
        selected_count += usize::from(entity.selected);
        if selected_count > 1 {
            return Err(SaveError::DuplicateSelection);
        }
        if let Some(id) = entity.sim_id {
            sim_ids.push(id);
        }
        validate_entity(
            entity,
            &snapshot.entities,
            pack,
            tile_count,
            pre_aquarium_bike,
        )?;
    }
    sim_ids.sort_unstable();
    if sim_ids.windows(2).any(|ids| ids[0] == ids[1]) {
        return Err(SaveError::InvalidSimIdAllocator);
    }
    if let Some(max_id) = sim_ids.into_iter().max() {
        if snapshot.issued_sim_ids <= max_id {
            return Err(SaveError::InvalidSimIdAllocator);
        }
    }
    if exceeds_limit(
        snapshot.queued_commands.len(),
        pack.tuning.max_queued_commands as usize,
    ) {
        return Err(SaveError::TooManyCommands);
    }
    for command in &snapshot.queued_commands {
        validate_command(command, &snapshot.entities, pack, pre_aquarium_bike)?;
    }
    Ok(())
}

fn validate_command(
    command: &SavedCommand,
    entities: &[SavedEntity],
    pack: &ContentPack,
    pre_aquarium_bike: bool,
) -> Result<(), SaveError> {
    match command {
        SavedCommand::Select(None) | SavedCommand::SetSpeed(_) => Ok(()),
        SavedCommand::Select(Some(index)) | SavedCommand::CancelIntents { agent: index } => {
            validate_agent_reference(entities, *index).map(|_| ())
        }
        SavedCommand::UseObject {
            agent,
            object,
            interaction,
        } => {
            validate_agent_reference(entities, *agent)?;
            // The same flyout rows `serve_intents` resolves, chains
            // included - a queued "Cook dinner" is a `UseObject` whose
            // row sits past the interactions ([K5]).
            //
            // Object-only, unlike the `Intent` it becomes: the drain
            // resolves this index against the objects query alone, so
            // a `UseObject` naming a person is dropped rather than
            // served, and `TalkTo` is how the wire says conversation.
            let entity = validate_entity_reference(entities, *object)?;
            let object = entity
                .smart_object
                .as_deref()
                .ok_or(SaveError::InvalidEntityReference)?;
            validate_flyout_row(pack, object, *interaction, pre_aquarium_bike)
        }
        SavedCommand::TalkTo {
            agent,
            target,
            interaction,
        } => {
            validate_agent_reference(entities, *agent)?;
            validate_agent_reference(entities, *target)?;
            if *interaction as usize >= pack.social.len() {
                return Err(SaveError::InvalidContentReference);
            }
            Ok(())
        }
    }
}

fn validate_entity(
    entity: &SavedEntity,
    entities: &[SavedEntity],
    pack: &ContentPack,
    tile_count: usize,
    pre_aquarium_bike: bool,
) -> Result<(), SaveError> {
    if let Some(position) = entity.position {
        if !position.x.is_finite() {
            return Err(SaveError::InvalidValue);
        }
        if !position.y.is_finite() {
            return Err(SaveError::InvalidValue);
        }
    }
    if let Some(name) = &entity.sim_name {
        if exceeds_limit(name.len(), MAX_TEXT_BYTES) {
            return Err(SaveError::InvalidValue);
        }
    }
    if let Some(path) = &entity.path {
        if exceeds_limit(path.steps.len(), tile_count) {
            return Err(SaveError::InvalidValue);
        }
        if exceeds_limit(path.cursor as usize, path.steps.len()) {
            return Err(SaveError::InvalidValue);
        }
    }
    if let Some(levels) = entity.needs {
        if !levels
            .iter()
            .all(|level| level.is_finite() && (NEED_MIN..=NEED_MAX).contains(level))
        {
            return Err(SaveError::InvalidValue);
        }
    }
    if let Some(value) = entity.satisfaction {
        if !value.is_finite() {
            return Err(SaveError::InvalidValue);
        }
        if value < 0.0 {
            return Err(SaveError::InvalidValue);
        }
    }
    if let Some(value) = entity.fumbled_delta_scale {
        if !value.is_finite() {
            return Err(SaveError::InvalidValue);
        }
        if !(0.0..=1.0).contains(&value) {
            return Err(SaveError::InvalidValue);
        }
    }
    // `career::work` decrements this countdown before checking for zero.
    // Restoring zero would underflow in release and keep the Sim at work for
    // u32::MAX ticks, or panic in a debug build.
    if entity.at_work_ticks == Some(0) {
        return Err(SaveError::InvalidValue);
    }
    if let Some(intents) = &entity.intents {
        if exceeds_limit(intents.len(), pack.tuning.max_queued_intents as usize) {
            return Err(SaveError::InvalidValue);
        }
        for intent in intents {
            validate_order_reference(
                entities,
                pack,
                intent.object,
                intent.interaction,
                pre_aquarium_bike,
            )?;
        }
    }
    if let Some(target) = entity.target {
        validate_target_reference(
            entities,
            pack,
            target.object,
            target.interaction,
            pre_aquarium_bike,
        )?;
    }
    if let Some(eating) = &entity.eating {
        validate_object_interaction(pack, &eating.object, eating.interaction, pre_aquarium_bike)?;
    }
    if let Some(entries) = &entity.habituation {
        validate_habituation(entries, pack, 0.0, 1.0, pre_aquarium_bike)?;
    }
    if let Some(personality) = &entity.personality {
        for value in personality
            .drain
            .iter()
            .chain(personality.satisfaction.iter())
        {
            if !value.is_finite() {
                return Err(SaveError::InvalidValue);
            }
            if *value < 0.0 {
                return Err(SaveError::InvalidValue);
            }
        }
        validate_habituation(
            &personality.dispositions,
            pack,
            0.0,
            f32::MAX,
            pre_aquarium_bike,
        )?;
    }
    if let Some(entries) = &entity.relationships {
        if exceeds_limit(entries.len(), MAX_LIST_ENTRIES) {
            return Err(SaveError::InvalidValue);
        }
        for (_, value) in entries {
            if !value.is_finite() {
                return Err(SaveError::InvalidValue);
            }
            if !(-1.0..=1.0).contains(value) {
                return Err(SaveError::InvalidValue);
            }
        }
        if !strictly_increasing(entries.iter().map(|(id, _)| *id)) {
            return Err(SaveError::InvalidValue);
        }
    }
    if let Some(social) = entity.socialising {
        validate_agent_reference(entities, entity.index)?;
        validate_agent_reference(entities, social.partner)?;
        if social.interaction as usize >= pack.social.len() {
            return Err(SaveError::InvalidContentReference);
        }
    }
    if let Some(hobbies) = &entity.hobbies {
        if exceeds_limit(hobbies.len(), MAX_LIST_ENTRIES) {
            return Err(SaveError::InvalidValue);
        }
        if hobbies
            .iter()
            .any(|hobby| exceeds_limit(hobby.len(), MAX_TEXT_BYTES))
        {
            return Err(SaveError::InvalidValue);
        }
    }
    if let Some(entries) = &entity.traits {
        if exceeds_limit(entries.len(), MAX_LIST_ENTRIES) {
            return Err(SaveError::InvalidValue);
        }
        for entry in entries {
            if !entry.state.is_finite() {
                return Err(SaveError::InvalidValue);
            }
            if !(0.0..=1.0).contains(&entry.state) {
                return Err(SaveError::InvalidValue);
            }
        }
        let mut ids = Vec::with_capacity(entries.len());
        for entry in entries {
            pack.traits
                .iter()
                .find(|definition| definition.id == entry.id)
                .ok_or(SaveError::InvalidContentReference)?;
            ids.push(entry.id.as_str());
        }
        ids.sort_unstable();
        if ids.windows(2).any(|pair| pair[0] == pair[1]) {
            return Err(SaveError::InvalidValue);
        }
    }
    if let Some(id) = entity.smart_object.as_deref() {
        resolve_object(pack, id)?;
    }
    if let Some(id) = entity.career.as_deref() {
        if !pack.careers.iter().any(|career| career.id == id) {
            return Err(SaveError::InvalidContentReference);
        }
    }
    if let Some(chain) = &entity.chain {
        let definition = pack
            .chains
            .iter()
            .find(|definition| definition.id == chain.chain)
            .ok_or(SaveError::InvalidContentReference)?;
        if chain.step as usize >= definition.steps.len() {
            return Err(SaveError::InvalidValue);
        }
        if !chain.fumble_scale.is_finite() {
            return Err(SaveError::InvalidValue);
        }
        if !(0.0..=1.0).contains(&chain.fumble_scale) {
            return Err(SaveError::InvalidValue);
        }
    }
    if let Some(item) = entity.carrying.as_deref() {
        if !pack.item_kinds.iter().any(|kind| kind == item) {
            return Err(SaveError::InvalidContentReference);
        }
    }
    Ok(())
}

fn validate_habituation(
    entries: &[SavedHabituation],
    pack: &ContentPack,
    minimum: f32,
    maximum: f32,
    pre_aquarium_bike: bool,
) -> Result<(), SaveError> {
    if exceeds_limit(entries.len(), MAX_LIST_ENTRIES) {
        return Err(SaveError::InvalidValue);
    }
    let mut keys = Vec::with_capacity(entries.len());
    for entry in entries {
        // **Rows, not interactions.** `learn_and_manage` keys
        // habituation on the same flyout row scoring uses, so a sim
        // who has cooked dinner carries an entry on the fridge at row
        // 1 - its chain. Validating these as interactions rejected the
        // snapshot of any household that had ever eaten a cooked meal,
        // which by tick 1 770 of the shipped lot is all of them.
        validate_flyout_row(pack, &entry.object, entry.interaction, pre_aquarium_bike)?;
        if !entry.value.is_finite() {
            return Err(SaveError::InvalidValue);
        }
        if !(minimum..=maximum).contains(&entry.value) {
            return Err(SaveError::InvalidValue);
        }
        keys.push((entry.object.as_str(), entry.interaction));
    }
    keys.sort_unstable();
    if keys.windows(2).any(|pair| pair[0] == pair[1]) {
        return Err(SaveError::InvalidValue);
    }
    Ok(())
}

/// **A `Target` names one of THREE things, not one.** `follow_path`
/// dispatches on what it finds at the far end: the `CHAIN_STEP`
/// sentinel means a station in a running chain, a smart object means
/// that object's interaction, and an AGENT means a conversation whose
/// index addresses `pack.social` instead of the object's interactions.
///
/// This validator modelled only the middle case, and the two it missed
/// are ordinary play rather than corner cases: **28.4% of ticks in a
/// 36 000-tick shipped-lot run produced a snapshot that would not
/// load** - `InvalidContentReference` for every save taken while
/// somebody walked to a chain station (`u32::MAX` is not a valid
/// interaction index), `InvalidEntityReference` for every save taken
/// while somebody walked over to talk (a sim carries no
/// `smart_object`). The 173-tick seam test passed because the first
/// walk-to-talk of the shipped lot begins at tick 188.
///
/// The bounds are a SAFETY boundary rather than a formality: on
/// arrival `follow_path` indexes `interactions[..]` and `social[..]`
/// directly, so an out-of-range index restored from a file would
/// panic in the middle of a tick. Every arm here bounds the index the
/// arm it authorises will use.
fn validate_target_reference(
    entities: &[SavedEntity],
    pack: &ContentPack,
    index: u32,
    interaction: u32,
    pre_aquarium_bike: bool,
) -> Result<(), SaveError> {
    let entity = validate_entity_reference(entities, index)?;
    if let Some(object) = entity.smart_object.as_deref() {
        // A chain step: the step's own content is reached through
        // `ChainState`, which is validated on its own, so the target
        // carries no index to bound here.
        if interaction == CHAIN_STEP {
            return Ok(());
        }
        return validate_object_interaction(pack, object, interaction, pre_aquarium_bike);
    }
    validate_social_partner(entity, pack, interaction)
}

/// The same union for a QUEUED order - a front-of-queue `Intent` or a
/// `UseObject` in the saved command log. It differs from a live target
/// in one way: an order addresses an object by FLYOUT ROW, and the
/// rows past the interactions are that object's chains ([K5]), so a
/// legal row runs to `interactions.len() + chains advertised here`.
fn validate_order_reference(
    entities: &[SavedEntity],
    pack: &ContentPack,
    index: u32,
    interaction: u32,
    pre_aquarium_bike: bool,
) -> Result<(), SaveError> {
    let entity = validate_entity_reference(entities, index)?;
    let Some(object) = entity.smart_object.as_deref() else {
        return validate_social_partner(entity, pack, interaction);
    };
    validate_flyout_row(pack, object, interaction, pre_aquarium_bike)
}

/// An object's addressable ROWS: its interactions, then one per chain
/// it advertises ([K5]). This is the index space of a flyout click, of
/// a queued order, and of a habituation key - three callers that must
/// agree with `select_action`, which mints the rows.
fn validate_flyout_row(
    pack: &ContentPack,
    object: &str,
    row: u32,
    pre_aquarium_bike: bool,
) -> Result<(), SaveError> {
    reject_impossible_pre_aquarium_bike_row(object, row, pre_aquarium_bike)?;
    let id = resolve_object(pack, object)?;
    let rows = pack.object(id).interactions.len()
        + pack
            .chains
            .iter()
            .filter(|chain| chain.advertised_by == id)
            .count();
    if row as usize >= rows {
        return Err(SaveError::InvalidContentReference);
    }
    Ok(())
}

/// A reference whose far end is a person: it must BE a person, and the
/// index addresses the social table.
fn validate_social_partner(
    entity: &SavedEntity,
    pack: &ContentPack,
    interaction: u32,
) -> Result<(), SaveError> {
    if !entity.agent || entity.sim_id.is_none() {
        return Err(SaveError::InvalidEntityReference);
    }
    if interaction as usize >= pack.social.len() {
        return Err(SaveError::InvalidContentReference);
    }
    Ok(())
}

fn validate_entity_reference(
    entities: &[SavedEntity],
    index: u32,
) -> Result<&SavedEntity, SaveError> {
    entities
        .binary_search_by_key(&index, |entity| entity.index)
        .ok()
        .map(|position| &entities[position])
        .ok_or(SaveError::InvalidEntityReference)
}

fn validate_agent_reference(
    entities: &[SavedEntity],
    index: u32,
) -> Result<&SavedEntity, SaveError> {
    let entity = validate_entity_reference(entities, index)?;
    if !entity.agent {
        return Err(SaveError::InvalidEntityReference);
    }
    if entity.sim_id.is_none() {
        return Err(SaveError::InvalidEntityReference);
    }
    Ok(entity)
}

fn validate_object_interaction(
    pack: &ContentPack,
    id: &str,
    interaction: u32,
    pre_aquarium_bike: bool,
) -> Result<(), SaveError> {
    reject_impossible_pre_aquarium_bike_row(id, interaction, pre_aquarium_bike)?;
    let object = resolve_object(pack, id)?;
    if interaction as usize >= pack.object(object).interactions.len() {
        return Err(SaveError::InvalidContentReference);
    }
    Ok(())
}

fn reject_impossible_pre_aquarium_bike_row(
    object: &str,
    row: u32,
    pre_aquarium_bike: bool,
) -> Result<(), SaveError> {
    if pre_aquarium_bike && row == 0 && AQUARIUM_BIKE_PERSISTENCE_KEYS.contains(&object) {
        return Err(SaveError::InvalidContentReference);
    }
    Ok(())
}

fn resolve_object(pack: &ContentPack, id: &str) -> Result<ObjectDefId, SaveError> {
    pack.find(id).ok_or(SaveError::InvalidContentReference)
}

fn resolve_entity(slots: &[Option<Entity>], index: u32) -> Result<Entity, SaveError> {
    slots
        .get(index as usize)
        .copied()
        .flatten()
        .ok_or(SaveError::InvalidEntityReference)
}

fn strictly_increasing(values: impl IntoIterator<Item = u32>) -> bool {
    let mut previous = None;
    for value in values {
        if previous.is_some_and(|previous| value <= previous) {
            return false;
        }
        previous = Some(value);
    }
    true
}

fn exceeds_limit(value: usize, inclusive_maximum: usize) -> bool {
    value > inclusive_maximum
}

#[cfg(test)]
mod tests {
    use super::*;

    fn blank_entity(index: u32) -> SavedEntity {
        SavedEntity {
            index,
            position: None,
            agent: false,
            smart_object: None,
            reserved: false,
            path: None,
            target: None,
            eating: None,
            restless: false,
            blocked: false,
            wander_pause_ticks: None,
            selected: false,
            intents: None,
            needs: None,
            habituation: None,
            sim_id: None,
            sim_name: None,
            personality: None,
            relationships: None,
            socialising: None,
            satisfaction: None,
            hobbies: None,
            traits: None,
            fumbled_delta_scale: None,
            career: None,
            commuting: false,
            at_work_ticks: None,
            chain: None,
            carrying: None,
            step_work_ticks: None,
        }
    }

    fn rich_snapshot() -> SaveSnapshotV1 {
        let sim = Sim::new_from_shipped_lot();
        let pack = sim.world().resource::<Content>().0;
        let mut snapshot = sim.save_snapshot();

        let object = snapshot
            .entities
            .iter()
            .find(|entity| {
                entity.smart_object.as_deref().is_some_and(|id| {
                    pack.find(id)
                        .is_some_and(|def| !pack.object(def).interactions.is_empty())
                })
            })
            .expect("shipped lot has an interactive object")
            .clone();
        let agents: Vec<u32> = snapshot
            .entities
            .iter()
            .filter(|entity| entity.agent)
            .map(|entity| entity.index)
            .collect();
        assert!(agents.len() >= 2, "shipped household has at least two sims");

        for entity in &mut snapshot.entities {
            entity.selected = false;
        }
        let agent = snapshot
            .entities
            .iter_mut()
            .find(|entity| entity.index == agents[0])
            .expect("first agent remains live");
        let object_name = object
            .smart_object
            .clone()
            .expect("chosen object has a definition");
        agent.path = Some(SavedPath {
            steps: vec![(2, 3), (3, 3)],
            cursor: 1,
        });
        agent.target = Some(SavedTarget {
            object: object.index,
            interaction: 0,
        });
        agent.eating = Some(SavedEating {
            object: object_name.clone(),
            interaction: 0,
            remaining_ticks: 17,
        });
        agent.restless = true;
        agent.blocked = true;
        agent.wander_pause_ticks = Some(8);
        agent.selected = true;
        agent.intents = Some(vec![SavedIntent {
            object: object.index,
            interaction: 0,
        }]);
        agent.habituation = Some(vec![SavedHabituation {
            object: object_name,
            interaction: 0,
            value: 0.375,
        }]);
        agent.relationships = Some(vec![(1_000, -0.25), (2_000, 0.75)]);
        agent.socialising = Some(SavedSocialising {
            interaction: 0,
            partner: agents[1],
            remaining_ticks: 11,
        });
        agent.satisfaction = Some(123.5);
        agent.fumbled_delta_scale = Some(0.5);
        agent.commuting = true;
        agent.at_work_ticks = Some(19);
        agent.step_work_ticks = Some(23);
        if let Some(chain) = pack.chains.first() {
            agent.chain = Some(SavedChainState {
                chain: chain.id.clone(),
                step: 0,
                fumble_scale: 0.625,
            });
        }
        if let Some(item) = pack.item_kinds.first() {
            agent.carrying = Some(item.clone());
        }

        snapshot.queued_commands = vec![
            SavedCommand::Select(Some(agents[0])),
            SavedCommand::UseObject {
                agent: agents[0],
                object: object.index,
                interaction: 0,
            },
            SavedCommand::TalkTo {
                agent: agents[0],
                target: agents[1],
                interaction: 0,
            },
        ];
        snapshot
    }

    fn rich_agent_mut(snapshot: &mut SaveSnapshotV1) -> &mut SavedEntity {
        snapshot
            .entities
            .iter_mut()
            .find(|entity| entity.target.is_some())
            .expect("rich fixture has the exercised agent")
    }

    fn assert_validation(snapshot: &SaveSnapshotV1, expected: Result<(), SaveError>, label: &str) {
        assert_eq!(
            validate_snapshot(snapshot, terri_data::pack()),
            expected,
            "{label}"
        );
    }

    fn assert_invalid_entity(
        label: &str,
        mutate: impl FnOnce(&mut SavedEntity),
        expected: SaveError,
    ) {
        let mut snapshot = rich_snapshot();
        mutate(rich_agent_mut(&mut snapshot));
        assert_validation(&snapshot, Err(expected), label);
    }

    #[test]
    fn a_rich_snapshot_restores_every_saved_field_exactly() {
        let snapshot = rich_snapshot();
        let mut restored = Sim::new_from_shipped_lot();
        restored
            .load_snapshot(snapshot.clone())
            .expect("valid rich snapshot restores");
        assert_eq!(restored.save_snapshot(), snapshot);
    }

    /// **Sparse means sparse**, and the capture side had no test at all.
    ///
    /// `sleep_pressure` is written as "only the sims actually carrying
    /// pressure", and absence is how a zero is stored. Nothing checked
    /// that, so the sweep rewrote the `> 0` filter three ways and all
    /// three lived: `< 0` never fires on a `u32` and silently saves
    /// nothing, `== 0` inverts it and saves exactly the sims with nothing
    /// to say, and `>= 0` saves everybody. The last is the sly one - it
    /// round-trips perfectly and only shows up as a save file carrying a
    /// row per sim forever.
    #[test]
    fn only_the_sims_actually_carrying_pressure_are_written_to_a_save() {
        let mut sim = Sim::new_from_shipped_lot();
        let mut agents: Vec<Entity> = sim
            .world_mut()
            .query_filtered::<Entity, bevy_ecs::prelude::With<terri_core::Agent>>()
            .iter(sim.world())
            .collect();
        agents.sort_by_key(|entity| entity.index());
        assert!(
            agents.len() >= 2,
            "this needs one tired sim and one rested one"
        );
        let (tired, rested) = (agents[0], agents[1]);

        sim.world_mut()
            .entity_mut(tired)
            .insert(terri_core::SleepPressure { ticks: 7 });
        // Explicitly zero rather than absent, which is the case that
        // separates "only non-zero" from "everyone who has the component".
        sim.world_mut()
            .entity_mut(rested)
            .insert(terri_core::SleepPressure { ticks: 0 });

        let snapshot = sim.save_snapshot();
        assert_eq!(
            snapshot.sleep_pressure.len(),
            1,
            "exactly the one sim on empty, and nobody else: {:?}",
            snapshot.sleep_pressure
        );
        assert_eq!(
            snapshot.sleep_pressure[0].1, 7,
            "and it is the tired sim's count, not the rested sim's zero"
        );

        // And it comes back, so the sparseness is a storage decision
        // rather than a loss.
        let mut restored = Sim::new_from_shipped_lot();
        restored
            .load_snapshot(snapshot)
            .expect("a snapshot carrying pressure restores");
        assert_eq!(
            restored
                .world()
                .get::<terri_core::SleepPressure>(tired)
                .map(|p| p.ticks),
            Some(7),
            "the counter has to survive the round trip - it counts elapsed \
             ticks and nothing in a loaded world can recompute it"
        );
    }

    #[test]
    fn a_running_sim_continues_identically_across_the_save_seam() {
        let mut uninterrupted = Sim::new_from_shipped_lot();
        for _ in 0..173 {
            uninterrupted.tick();
        }

        let state = uninterrupted.save_snapshot();
        let mut resumed = Sim::new_from_shipped_lot();
        resumed
            .load_snapshot(state.clone())
            .expect("own snapshot restores");
        assert_eq!(resumed.save_snapshot(), state);

        for tick_after_load in 1..=300 {
            uninterrupted.tick();
            resumed.tick();
            assert_eq!(
                resumed.world_hash(),
                uninterrupted.world_hash(),
                "world diverged {tick_after_load} ticks after load"
            );
        }
        assert_eq!(
            resumed.save_snapshot(),
            uninterrupted.save_snapshot(),
            "unhashed RNG, queues, and transient action state diverged"
        );
    }

    /// **Every tick of a played hour must produce a save that loads.**
    ///
    /// The seam test above saves once, at tick 173, and that single
    /// early sample is how three separate rejections shipped: the
    /// first walk-to-talk of the shipped lot begins at tick 188, the
    /// first chain-station walk later still, and the first habituation
    /// entry on a chain row at tick 1 770. Measured on the shipped lot
    /// before the fix, **28.4% of 36 000 ticks produced a snapshot
    /// that could not be loaded at all** - a player who saved at a
    /// random moment had better than a one-in-four chance of a file
    /// the game would refuse.
    ///
    /// So this walks ticks rather than sampling one, and it asserts
    /// COVERAGE first: a run where nobody ever walked to a chat would
    /// pass vacuously and leave the same hole open.
    #[test]
    fn every_tick_of_a_played_stretch_produces_a_loadable_save() {
        const TICKS: u64 = 2_000;
        let mut sim = Sim::new_from_shipped_lot();
        // **Start the household hungry rather than waiting for it to get
        // there.** The two arms below need a sim to use a chain station
        // enough times to habituate to one of its flyout rows, and a
        // household that starts full spends most of a short run merely
        // getting peckish. That made the tick budget a proxy for the decay
        // rates: this fixture went vacuous once when the circadian curve
        // was tuned and again when sleep slowed decay, both times because
        // a knob somewhere else moved how long "long enough" is.
        //
        // Hunger only, and set rather than nudged, so the state this
        // starts from is a fact about the fixture instead of a
        // consequence of every rate in `tuning.toml`. It also keeps the
        // run at 2 000 ticks, which matters: `ci.yml` bounds each mutant's
        // whole workspace test run at 60 s, and this test is one of the
        // slowest in it.
        let mut saw_walk_to_talk = false;
        let mut saw_chain_row_habituation = false;

        for tick in 1..=TICKS {
            // **Keep the household under pressure, rather than waiting
            // for the decay rates to put it there.**
            //
            // Both arms below need a specific thing to HAPPEN - somebody
            // walking over to talk, and somebody habituating to a chain's
            // flyout row - and left alone this fixture reached them only
            // because 2 000 ticks of shipped decay happened to be long
            // enough. That made the tick budget a proxy for every rate in
            // `tuning.toml`: it went vacuous once when the circadian curve
            // was tuned, and again when sleep slowed decay, both times for
            // a reason that had nothing to do with saving or loading.
            //
            // **Hunger only, and only every 500 ticks.** The talk arm
            // below reaches itself perfectly well on organic play and
            // always did; it was the chain arm that needed help. Three
            // attempts at helping both broke the talk arm instead, by
            // keeping the house hungry enough that eating outscored
            // company every time a sim chose. A fixture that leans on the
            // simulation should lean exactly as hard as it has to.
            if tick % 500 == 1 {
                let world = sim.world_mut();
                let agents: Vec<bevy_ecs::entity::Entity> = world
                    .query_filtered::<bevy_ecs::entity::Entity, bevy_ecs::query::With<terri_core::Agent>>()
                    .iter(world)
                    .collect();
                for agent in agents {
                    if let Some(mut needs) = world.get_mut::<terri_core::Needs>(agent) {
                        needs.set(terri_core::NeedId::Hunger, 12.0);
                    }
                }
            }
            // And company, staggered half a cycle away, with energy
            // topped up so the sim is awake to want it. The circadian
            // rhythm made this necessary: with the clock steering sleep,
            // 2 000 ticks of organic play no longer contained a walk over
            // to chat, because the tired half of the day is now spent in
            // bed rather than milling about.
            if tick % 500 == 251 {
                let world = sim.world_mut();
                let agents: Vec<bevy_ecs::entity::Entity> = world
                    .query_filtered::<bevy_ecs::entity::Entity, bevy_ecs::query::With<terri_core::Agent>>()
                    .iter(world)
                    .collect();
                for agent in agents {
                    if let Some(mut needs) = world.get_mut::<terri_core::Needs>(agent) {
                        needs.set(terri_core::NeedId::Social, 6.0);
                        needs.set(terri_core::NeedId::Energy, 100.0);
                    }
                }
            }
            sim.tick();
            let snapshot = sim.save_snapshot();

            // What this tick actually exercises, so the pass is not vacuous.
            for entity in &snapshot.entities {
                if let Some(target) = entity.target {
                    let far_end = snapshot
                        .entities
                        .iter()
                        .find(|other| other.index == target.object)
                        .expect("a target names a saved entity");
                    if far_end.agent {
                        saw_walk_to_talk = true;
                    }
                }
                if let Some(entries) = &entity.habituation {
                    let pack = sim.world().resource::<Content>().0;
                    for entry in entries {
                        let object = pack.find(&entry.object).expect("a saved object id");
                        if entry.interaction as usize >= pack.object(object).interactions.len() {
                            saw_chain_row_habituation = true;
                        }
                    }
                }
            }

            let mut fresh = Sim::new_from_shipped_lot();
            assert_eq!(
                fresh.load_snapshot(snapshot),
                Ok(()),
                "the snapshot taken at tick {tick} will not load"
            );
        }

        assert!(
            saw_walk_to_talk,
            "fixture is vacuous: nobody walked over to talk in {TICKS} ticks, \
             so the sim-target arm was never validated"
        );
        assert!(
            saw_chain_row_habituation,
            "fixture is vacuous: nobody habituated to a chain row in {TICKS} ticks, \
             so the flyout-row arm was never validated"
        );
    }

    /// A `Target` whose far end is a PERSON is a conversation being
    /// walked to, and its index addresses `pack.social` rather than
    /// any object's interactions. Held separately from the walked
    /// test above because that one proves the case occurs and this one
    /// pins what makes it legal - including the two ways it is not.
    #[test]
    fn a_target_on_another_sim_is_a_conversation_and_is_bounded_by_the_social_table() {
        let sim = Sim::new_from_shipped_lot();
        let social_count = sim.world().resource::<Content>().0.social.len();
        assert!(social_count > 0, "fixture needs a social table");
        let base = sim.save_snapshot();
        let agents: Vec<u32> = base
            .entities
            .iter()
            .filter(|entity| entity.agent)
            .map(|entity| entity.index)
            .collect();
        assert!(agents.len() >= 2, "fixture needs two sims");

        let with_target = |object: u32, interaction: u32| {
            let mut snapshot = base.clone();
            let agent = snapshot
                .entities
                .iter_mut()
                .find(|entity| entity.index == agents[0])
                .expect("first sim");
            agent.target = Some(SavedTarget {
                object,
                interaction,
            });
            snapshot
        };

        assert_validation(
            &with_target(agents[1], 0),
            Ok(()),
            "walking over to talk to a housemate",
        );
        assert_validation(
            &with_target(agents[1], social_count as u32),
            Err(SaveError::InvalidContentReference),
            "a social index past the table would panic on arrival",
        );

        // **Both halves of "is a person", each failing alone.** A
        // conversation partner has to be an `Agent` AND carry a
        // `SimId`; a file where only one holds describes a thing the
        // runtime has no name for. Testing them only together leaves
        // the `||` between them free to become `&&` - which is exactly
        // what the mutation sweep found when this test asserted the
        // happy path and the bounds and nothing else.
        let half_a_person = |strip_agent: bool, strip_id: bool| {
            let mut snapshot = base.clone();
            let partner = snapshot
                .entities
                .iter_mut()
                .find(|entity| entity.index == agents[1])
                .expect("second sim");
            if strip_agent {
                partner.agent = false;
            }
            if strip_id {
                partner.sim_id = None;
            }
            let agent = snapshot
                .entities
                .iter_mut()
                .find(|entity| entity.index == agents[0])
                .expect("first sim");
            agent.target = Some(SavedTarget {
                object: agents[1],
                interaction: 0,
            });
            snapshot
        };
        assert_validation(
            &half_a_person(true, false),
            Err(SaveError::InvalidEntityReference),
            "a target on a non-agent that still carries a SimId",
        );
        assert_validation(
            &half_a_person(false, true),
            Err(SaveError::InvalidEntityReference),
            "a target on an agent with no SimId",
        );
    }

    /// The `CHAIN_STEP` sentinel is not an interaction index and must
    /// not be bounded as one: the step's content is reached through
    /// `ChainState`, which carries its own validation.
    #[test]
    fn a_target_on_a_chain_station_carries_the_sentinel_rather_than_an_index() {
        let sim = Sim::new_from_shipped_lot();
        let base = sim.save_snapshot();
        let station = base
            .entities
            .iter()
            .find(|entity| entity.smart_object.is_some())
            .expect("shipped lot has objects")
            .index;
        let agent = base
            .entities
            .iter()
            .find(|entity| entity.agent)
            .expect("shipped household")
            .index;

        let mut snapshot = base.clone();
        snapshot
            .entities
            .iter_mut()
            .find(|entity| entity.index == agent)
            .expect("the sim")
            .target = Some(SavedTarget {
            object: station,
            interaction: CHAIN_STEP,
        });
        assert_validation(&snapshot, Ok(()), "mid-chain, walking to a station");
    }

    /// Habituation, a queued intent and a saved `UseObject` all address
    /// an object by FLYOUT ROW, and the rows past its interactions are
    /// its chains ([K5]). One row past the last chain is out of range
    /// for all three.
    #[test]
    fn flyout_rows_run_through_the_chains_and_stop_after_them() {
        let sim = Sim::new_from_shipped_lot();
        let pack = sim.world().resource::<Content>().0;
        let base = sim.save_snapshot();

        let (advertiser, rows) = base
            .entities
            .iter()
            .find_map(|entity| {
                let id = entity.smart_object.as_deref()?;
                let object = pack.find(id)?;
                let chains = pack
                    .chains
                    .iter()
                    .filter(|chain| chain.advertised_by == object)
                    .count();
                (chains > 0).then(|| {
                    (
                        entity.index,
                        pack.object(object).interactions.len() + chains,
                    )
                })
            })
            .expect("shipped content advertises a chain from a placed object");
        let id = base
            .entities
            .iter()
            .find(|entity| entity.index == advertiser)
            .and_then(|entity| entity.smart_object.clone())
            .expect("the advertiser's id");
        let agent = base
            .entities
            .iter()
            .find(|entity| entity.agent)
            .expect("shipped household")
            .index;

        let last_chain_row = (rows - 1) as u32;
        let past_the_end = rows as u32;

        let habituated = |row: u32| {
            let mut snapshot = base.clone();
            snapshot
                .entities
                .iter_mut()
                .find(|entity| entity.index == agent)
                .expect("the sim")
                .habituation = Some(vec![SavedHabituation {
                object: id.clone(),
                interaction: row,
                value: 0.5,
            }]);
            snapshot
        };
        assert_validation(
            &habituated(last_chain_row),
            Ok(()),
            "habituated to a cooked dinner",
        );
        assert_validation(
            &habituated(past_the_end),
            Err(SaveError::InvalidContentReference),
            "habituated to a row no flyout can show",
        );

        let intended = |row: u32| {
            let mut snapshot = base.clone();
            snapshot
                .entities
                .iter_mut()
                .find(|entity| entity.index == agent)
                .expect("the sim")
                .intents = Some(vec![SavedIntent {
                object: advertiser,
                interaction: row,
            }]);
            snapshot
        };
        assert_validation(&intended(last_chain_row), Ok(()), "queued a cooked dinner");
        assert_validation(
            &intended(past_the_end),
            Err(SaveError::InvalidContentReference),
            "queued a row no flyout can show",
        );

        let commanded = |row: u32| {
            let mut snapshot = base.clone();
            snapshot.queued_commands = vec![SavedCommand::UseObject {
                agent,
                object: advertiser,
                interaction: row,
            }];
            snapshot
        };
        assert_validation(
            &commanded(last_chain_row),
            Ok(()),
            "a click on the chain row, still in the queue",
        );
        assert_validation(
            &commanded(past_the_end),
            Err(SaveError::InvalidContentReference),
            "a click on a row no flyout can show",
        );
    }

    #[test]
    fn live_entity_indices_on_both_sides_of_a_hole_are_preserved() {
        let mut source = Sim::new_from_shipped_lot();
        let trailing = source.world_mut().spawn_empty().id();
        let hole_index = source.save_snapshot().entities[2].index;
        let hole = source
            .world()
            .entities()
            .resolve_from_index(EntityIndex::from_raw_u32(hole_index).expect("ordinary index"));
        assert!(source.world_mut().despawn(hole));

        let snapshot = source.save_snapshot();
        assert!(
            snapshot
                .entities
                .iter()
                .any(|entity| entity.index == trailing.index_u32()),
            "fixture needs a live entity after the hole"
        );
        assert!(
            snapshot
                .entities
                .iter()
                .all(|entity| entity.index != hole_index),
            "fixture needs a real hole"
        );

        let mut restored = Sim::new_from_shipped_lot();
        restored
            .load_snapshot(snapshot.clone())
            .expect("a sparse live-entity index space restores");
        assert_eq!(restored.save_snapshot(), snapshot);
    }

    #[test]
    fn authored_facing_is_restored_only_for_an_exact_placement_match() {
        let pack = terri_data::pack();
        let placement = pack
            .lot
            .placements
            .iter()
            .find(|placement| placement.sprite != pack.object(placement.object).sprite)
            .expect("shipped lot has a faced object");
        let position = SavedPosition {
            x: placement.x,
            y: placement.y,
        };

        assert!(placement_matches(placement, placement.object, position));
        let other_object = pack
            .objects
            .iter()
            .enumerate()
            .map(|(index, _)| ObjectDefId(index as u32))
            .find(|object| *object != placement.object)
            .expect("shipped pack has another object");
        assert!(!placement_matches(placement, other_object, position));
        assert!(!placement_matches(
            placement,
            placement.object,
            SavedPosition {
                x: position.x + 0.25,
                y: position.y,
            }
        ));
        assert!(!placement_matches(
            placement,
            placement.object,
            SavedPosition {
                x: position.x,
                y: position.y + 0.25,
            }
        ));

        let snapshot = Sim::new_from_shipped_lot().save_snapshot();
        let saved = snapshot
            .entities
            .iter()
            .find(|entity| {
                entity.position == Some(position)
                    && entity
                        .smart_object
                        .as_deref()
                        .is_some_and(|id| pack.find(id) == Some(placement.object))
            })
            .expect("faced placement exists in the snapshot");
        let index = saved.index;
        let mut restored = Sim::new_from_shipped_lot();
        restored
            .load_snapshot(snapshot)
            .expect("shipped snapshot restores");
        let entity = restored
            .world()
            .entities()
            .resolve_from_index(EntityIndex::from_raw_u32(index).expect("ordinary saved index"));
        assert_eq!(
            restored.world().get::<SpriteVariant>(entity).copied(),
            Some(SpriteVariant(placement.sprite)),
            "the authored facing sprite must survive the save seam"
        );
    }

    #[test]
    fn authored_and_dynamic_action_sockets_reconstruct_without_entering_save_or_hash_state() {
        let pack = terri_data::pack();
        let chair = pack.find("reading_chair").expect("shipped reading chair");
        let placement = pack
            .lot
            .placements
            .iter()
            .find(|placement| placement.object == chair)
            .expect("the shipped reading chair is placed");
        assert!(!placement.action_sockets.is_empty());

        let mut source = Sim::new_from_shipped_lot();
        let authored = {
            let world = source.world_mut();
            let mut query = world.query::<(Entity, &Position, &SmartObject)>();
            query
                .iter(world)
                .find(|(_, position, object)| {
                    object.0 == chair && position.x == placement.x && position.y == placement.y
                })
                .map(|(entity, _, _)| entity)
                .expect("authored chair entity")
        };
        assert_eq!(
            source
                .world()
                .get::<ResolvedActionSockets>(authored)
                .map(|sockets| sockets.0.as_slice()),
            Some(placement.action_sockets.as_slice())
        );

        let dynamic_position = [
            Position { x: 1.25, y: 1.5 },
            Position { x: 2.25, y: 2.5 },
            Position { x: 3.25, y: 3.5 },
        ]
        .into_iter()
        .find(|position| {
            !pack.lot.placements.iter().any(|candidate| {
                candidate.object == chair && candidate.x == position.x && candidate.y == position.y
            })
        })
        .expect("one candidate is not the authored chair placement");
        let dynamic = source.spawn_object(dynamic_position, chair);
        let fridge = pack.find("fridge").expect("shipped fridge");
        let ordinary = source.spawn_object(Position { x: 4.25, y: 2.5 }, fridge);
        let expected_dynamic = default_action_sockets(pack.object(chair), dynamic_position);
        let snapshot_with_sockets = source.save_snapshot();
        let hash_with_sockets = source.world_hash();

        source
            .world_mut()
            .entity_mut(dynamic)
            .remove::<ResolvedActionSockets>();
        assert_eq!(
            source.save_snapshot(),
            snapshot_with_sockets,
            "the presentation carrier must not widen Save V1"
        );
        assert_eq!(
            source.world_hash(),
            hash_with_sockets,
            "the presentation carrier must not enter the deterministic digest"
        );

        let authored_index = authored.index_u32();
        let dynamic_index = dynamic.index_u32();
        let ordinary_index = ordinary.index_u32();
        let mut restored = Sim::new_from_shipped_lot();
        restored
            .load_snapshot(snapshot_with_sockets)
            .expect("socket-free Save V1 restores");
        let resolve = |index| {
            restored.world().entities().resolve_from_index(
                EntityIndex::from_raw_u32(index).expect("ordinary saved entity index"),
            )
        };
        assert_eq!(
            restored
                .world()
                .get::<ResolvedActionSockets>(resolve(authored_index))
                .map(|sockets| sockets.0.as_slice()),
            Some(placement.action_sockets.as_slice()),
            "the exact authored placement restores its compile-resolved sockets"
        );
        assert_eq!(
            restored
                .world()
                .get::<ResolvedActionSockets>(resolve(dynamic_index))
                .map(|sockets| sockets.0.as_slice()),
            Some(expected_dynamic.as_slice()),
            "a non-colliding dynamic chair restores default-SE sockets"
        );
        assert!(
            restored
                .world()
                .get::<ResolvedActionSockets>(resolve(ordinary_index))
                .is_none(),
            "an ordinary object restores no sentinel socket carrier"
        );
    }

    #[test]
    fn same_id_same_position_dynamic_save_collision_adopts_the_authored_rotated_socket() {
        let shipped = terri_data::pack();
        let shipped_chair = shipped
            .find("reading_chair")
            .expect("shipped reading chair");
        let mut chair = shipped.object(shipped_chair).clone();
        chair.action_sockets = vec![terri_data::CompiledActionSocket {
            id: "asymmetric_seat".to_string(),
            x: 0.25,
            y: -0.25,
            facing: terri_data::CompiledSocketFacing::PositiveX,
        }];
        let base = crate::test_content::pack(vec![chair]);
        let chair = base.find("reading_chair").expect("fixture reading chair");
        let position = Position { x: 6.5, y: 7.5 };
        let default_se = default_action_sockets(base.object(chair), position);
        assert_eq!(default_se.len(), 1);

        // The compiler's NW transform for the asymmetric local offset above:
        // (x, y) becomes (-x, -y), and +x facing becomes -x facing.
        let authored_nw = terri_data::CompiledPlacementSocket {
            x: 6.25,
            y: 7.75,
            facing: terri_data::CompiledSocketFacing::NegativeX,
        };
        assert_ne!(default_se[0].x, authored_nw.x, "rotation must change x");
        assert_ne!(default_se[0].y, authored_nw.y, "rotation must change y");
        assert_ne!(
            default_se[0].facing, authored_nw.facing,
            "rotation must change facing"
        );

        let fixture = Box::leak(Box::new(ContentPack {
            lot: terri_data::CompiledLot {
                width: 16,
                height: 16,
                walls: Vec::new(),
                placements: vec![terri_data::CompiledPlacement {
                    object: chair,
                    x: position.x,
                    y: position.y,
                    sprite: base.object(chair).sprite,
                    action_sockets: vec![authored_nw.clone()],
                }],
                front_door: None,
            },
            ..base.clone()
        }));

        // Deliberately spawn dynamically into the exact authored identity and
        // coordinates without constructing the lot's authored object.
        let mut source = crate::test_content::sim_with(16, 16, fixture);
        let dynamic = source.spawn_object(position, chair);
        assert_eq!(
            source
                .world()
                .get::<ResolvedActionSockets>(dynamic)
                .map(|sockets| sockets.0.as_slice()),
            Some(default_se.as_slice()),
            "before Save, the dynamic object must carry default-SE sockets"
        );
        let snapshot = source.save_snapshot();
        let saved_position = snapshot
            .entities
            .iter()
            .find(|saved| saved.index == dynamic.index_u32())
            .expect("the dynamic object is present in Save V1")
            .position
            .expect("the dynamic object has a saved position");
        assert!(placement_matches(
            &fixture.lot.placements[0],
            chair,
            saved_position
        ));

        let mut restored = crate::test_content::sim_with(16, 16, fixture);
        restored
            .load_snapshot(snapshot)
            .expect("same-position dynamic Save V1 restores");
        let restored_dynamic = restored.world().entities().resolve_from_index(
            EntityIndex::from_raw_u32(dynamic.index_u32()).expect("ordinary saved entity index"),
        );
        assert_eq!(
            restored
                .world()
                .get::<ResolvedActionSockets>(restored_dynamic)
                .map(|sockets| sockets.0.as_slice()),
            Some([authored_nw].as_slice()),
            "Save V1 cannot distinguish the collision, so Load must adopt the authored placement"
        );
    }

    #[test]
    fn load_during_settle_in_reconstructs_the_socketed_render_endpoint_before_another_tick() {
        use crate::render_buffer::{activity, facing, visual_action};

        let pack = terri_data::pack();
        let chair = pack.find("reading_chair").expect("shipped reading chair");
        let settle = pack
            .object(chair)
            .interactions
            .iter()
            .position(|interaction| interaction.id == "settle_in")
            .expect("shipped settle_in") as u32;
        let mut source = Sim::new_from_lot(&pack.lot, &pack.objects);
        source.world_mut().insert_resource(Content(pack));
        let target = {
            let world = source.world_mut();
            let mut query = world.query::<(Entity, &Position, &SmartObject)>();
            query
                .iter(world)
                .find(|(_, _, object)| object.0 == chair)
                .map(|(entity, _, _)| entity)
                .expect("shipped chair entity")
        };
        let socket = source
            .world()
            .get::<ResolvedActionSockets>(target)
            .expect("authored chair has a socket")
            .0[0]
            .clone();
        let path_position = Position { x: 2.5, y: 3.75 };
        let agent = source
            .world_mut()
            .spawn((
                Agent,
                path_position,
                Eating {
                    object: chair,
                    interaction: settle,
                    remaining_ticks: 10,
                },
                Target {
                    object: target,
                    interaction: settle,
                },
            ))
            .id();
        let snapshot = source.save_snapshot();
        let source_hash = source.world_hash();

        let mut restored = Sim::new_from_shipped_lot();
        restored
            .load_snapshot(snapshot)
            .expect("active reading save restores");
        assert_eq!(restored.world_hash(), source_hash);
        let restored_agent = restored.world().entities().resolve_from_index(
            EntityIndex::from_raw_u32(agent.index_u32()).expect("ordinary saved agent index"),
        );
        let row = restored
            .render_buffer()
            .ids
            .iter()
            .position(|&id| id == restored_agent.index_u32())
            .expect("restored reader has a render row");
        let position = row * 2;
        assert_eq!(
            (
                restored.render_buffer().visual_actions[row],
                restored.render_buffer().activities[row],
                restored.render_buffer().facings[row],
            ),
            (visual_action::READ, activity::READING, facing::POSITIVE_X)
        );
        assert_eq!(
            (
                restored.render_buffer().positions[position],
                restored.render_buffer().positions[position + 1],
                restored.render_buffer().prev_positions[position],
                restored.render_buffer().prev_positions[position + 1],
            ),
            (socket.x, socket.y, socket.x, socket.y),
            "Load must seed both displayed samples at the saved tick endpoint"
        );
        assert_eq!(
            restored.world().get::<Position>(restored_agent).copied(),
            Some(path_position)
        );

        for _ in 0..3 {
            source.tick();
            restored.tick();
            assert_eq!(restored.world_hash(), source.world_hash());
        }
    }

    #[test]
    fn top_level_size_and_order_boundaries_are_enforced_independently() {
        assert!(!exceeds_limit(MAX_LIST_ENTRIES, MAX_LIST_ENTRIES));
        assert!(exceeds_limit(MAX_LIST_ENTRIES + 1, MAX_LIST_ENTRIES));

        let mut empty = rich_snapshot();
        empty.entities.clear();
        empty.issued_sim_ids = 0;
        empty.queued_commands.clear();
        assert_validation(&empty, Ok(()), "empty world is valid");

        let mut zero_width = empty.clone();
        zero_width.grid_width = 0;
        zero_width.blocked_tiles.clear();
        assert_validation(&zero_width, Err(SaveError::InvalidGrid), "zero width");

        let mut zero_height = empty.clone();
        zero_height.grid_height = 0;
        zero_height.blocked_tiles.clear();
        assert_validation(&zero_height, Err(SaveError::InvalidGrid), "zero height");

        let mut maximum_grid = empty.clone();
        maximum_grid.grid_width = 1_024;
        maximum_grid.grid_height = 1_024;
        maximum_grid.blocked_tiles = vec![false; MAX_TILES];
        assert_validation(&maximum_grid, Ok(()), "maximum grid is inclusive");

        maximum_grid.grid_height += 1;
        maximum_grid.blocked_tiles =
            vec![false; maximum_grid.grid_width as usize * maximum_grid.grid_height as usize];
        assert_validation(
            &maximum_grid,
            Err(SaveError::InvalidGrid),
            "one tile row above the cap",
        );

        let mut allocator = empty.clone();
        allocator.issued_sim_ids = MAX_ENTITIES as u32;
        assert_validation(&allocator, Ok(()), "allocator cap is inclusive");
        allocator.issued_sim_ids += 1;
        assert_validation(
            &allocator,
            Err(SaveError::InvalidSimIdAllocator),
            "allocator above cap",
        );

        let mut valid_last_index = empty.clone();
        valid_last_index.entities = vec![blank_entity((MAX_ENTITIES - 1) as u32)];
        assert_validation(
            &valid_last_index,
            Ok(()),
            "last representable entity index is valid",
        );
        valid_last_index.entities[0].index = MAX_ENTITIES as u32;
        assert_validation(
            &valid_last_index,
            Err(SaveError::InvalidEntityOrder),
            "entity index at the cap is invalid",
        );

        let mut duplicate = empty.clone();
        duplicate.entities = vec![blank_entity(7), blank_entity(7)];
        assert_validation(
            &duplicate,
            Err(SaveError::InvalidEntityOrder),
            "duplicate entity index",
        );
        duplicate.entities[1].index = 6;
        assert_validation(
            &duplicate,
            Err(SaveError::InvalidEntityOrder),
            "descending entity index",
        );

        let command = SavedCommand::Select(None);
        let mut commands = empty;
        commands.queued_commands =
            vec![command.clone(); terri_data::pack().tuning.max_queued_commands as usize];
        assert_validation(&commands, Ok(()), "command cap is inclusive");
        commands.queued_commands.push(command);
        assert_validation(
            &commands,
            Err(SaveError::TooManyCommands),
            "command count above cap",
        );
    }

    #[test]
    fn scalar_and_path_boundaries_reject_each_malformed_field() {
        assert_invalid_entity(
            "non-finite x",
            |entity| entity.position.as_mut().expect("position").x = f32::NAN,
            SaveError::InvalidValue,
        );
        assert_invalid_entity(
            "non-finite y",
            |entity| entity.position.as_mut().expect("position").y = f32::INFINITY,
            SaveError::InvalidValue,
        );

        let mut maximum_name = rich_snapshot();
        rich_agent_mut(&mut maximum_name).sim_name = Some("n".repeat(MAX_TEXT_BYTES));
        assert_validation(&maximum_name, Ok(()), "name cap is inclusive");
        rich_agent_mut(&mut maximum_name).sim_name = Some("n".repeat(MAX_TEXT_BYTES + 1));
        assert_validation(
            &maximum_name,
            Err(SaveError::InvalidValue),
            "name above cap",
        );

        let mut path = rich_snapshot();
        let tile_count = path.blocked_tiles.len();
        rich_agent_mut(&mut path).path = Some(SavedPath {
            steps: vec![(0, 0); tile_count],
            cursor: tile_count as u32,
        });
        assert_validation(&path, Ok(()), "path and cursor caps are inclusive");
        rich_agent_mut(&mut path)
            .path
            .as_mut()
            .expect("path")
            .steps
            .push((0, 0));
        assert_validation(
            &path,
            Err(SaveError::InvalidValue),
            "path above grid tile count",
        );

        let mut cursor = rich_snapshot();
        let path = rich_agent_mut(&mut cursor).path.as_mut().expect("path");
        path.cursor = path.steps.len() as u32 + 1;
        assert_validation(
            &cursor,
            Err(SaveError::InvalidValue),
            "cursor beyond path end",
        );

        let mut need_limits = rich_snapshot();
        rich_agent_mut(&mut need_limits).needs = Some([NEED_MIN; terri_core::NEED_COUNT]);
        assert_validation(&need_limits, Ok(()), "need minimum is inclusive");
        rich_agent_mut(&mut need_limits).needs = Some([NEED_MAX; terri_core::NEED_COUNT]);
        assert_validation(&need_limits, Ok(()), "need maximum is inclusive");
        assert_invalid_entity(
            "need below minimum",
            |entity| entity.needs.as_mut().expect("needs")[0] = NEED_MIN - 0.25,
            SaveError::InvalidValue,
        );
        assert_invalid_entity(
            "need above maximum",
            |entity| entity.needs.as_mut().expect("needs")[0] = NEED_MAX + 0.25,
            SaveError::InvalidValue,
        );
        assert_invalid_entity(
            "non-finite need",
            |entity| entity.needs.as_mut().expect("needs")[0] = f32::NAN,
            SaveError::InvalidValue,
        );

        let mut satisfaction_zero = rich_snapshot();
        rich_agent_mut(&mut satisfaction_zero).satisfaction = Some(0.0);
        assert_validation(&satisfaction_zero, Ok(()), "zero satisfaction is valid");
        assert_invalid_entity(
            "negative satisfaction",
            |entity| entity.satisfaction = Some(-f32::EPSILON),
            SaveError::InvalidValue,
        );
        assert_invalid_entity(
            "non-finite satisfaction",
            |entity| entity.satisfaction = Some(f32::INFINITY),
            SaveError::InvalidValue,
        );

        for (label, value, expected) in [
            ("fumble minimum", 0.0, Ok(())),
            ("fumble maximum", 1.0, Ok(())),
            (
                "fumble below minimum",
                -f32::EPSILON,
                Err(SaveError::InvalidValue),
            ),
            (
                "fumble above maximum",
                1.0 + f32::EPSILON,
                Err(SaveError::InvalidValue),
            ),
            ("non-finite fumble", f32::NAN, Err(SaveError::InvalidValue)),
        ] {
            let mut snapshot = rich_snapshot();
            rich_agent_mut(&mut snapshot).fumbled_delta_scale = Some(value);
            assert_validation(&snapshot, expected, label);
        }

        let mut positive_work = rich_snapshot();
        rich_agent_mut(&mut positive_work).at_work_ticks = Some(1);
        assert_validation(&positive_work, Ok(()), "one remaining work tick is valid");
        assert_invalid_entity(
            "zero remaining work ticks",
            |entity| entity.at_work_ticks = Some(0),
            SaveError::InvalidValue,
        );

        let mut valid_personality_zero = rich_snapshot();
        let personality = rich_agent_mut(&mut valid_personality_zero)
            .personality
            .as_mut()
            .expect("personality");
        personality.drain.fill(0.0);
        personality.satisfaction.fill(0.0);
        assert_validation(
            &valid_personality_zero,
            Ok(()),
            "zero personality weights are valid",
        );
        assert_invalid_entity(
            "negative personality drain",
            |entity| entity.personality.as_mut().expect("personality").drain[0] = -f32::EPSILON,
            SaveError::InvalidValue,
        );
        assert_invalid_entity(
            "non-finite personality satisfaction",
            |entity| {
                entity
                    .personality
                    .as_mut()
                    .expect("personality")
                    .satisfaction[0] = f32::NAN
            },
            SaveError::InvalidValue,
        );
    }

    #[test]
    fn collection_caps_ranges_and_ordering_are_enforced() {
        let pack = terri_data::pack();
        let mut intents = rich_snapshot();
        let target = rich_agent_mut(&mut intents).target.expect("target");
        rich_agent_mut(&mut intents).intents = Some(vec![
            SavedIntent {
                object: target.object,
                interaction: target.interaction,
            };
            pack.tuning.max_queued_intents as usize
        ]);
        assert_validation(&intents, Ok(()), "intent cap is inclusive");
        rich_agent_mut(&mut intents)
            .intents
            .as_mut()
            .expect("intents")
            .push(SavedIntent {
                object: target.object,
                interaction: target.interaction,
            });
        assert_validation(
            &intents,
            Err(SaveError::InvalidValue),
            "intent count above cap",
        );

        let mut relationships = rich_snapshot();
        rich_agent_mut(&mut relationships).relationships =
            Some((0..MAX_LIST_ENTRIES as u32).map(|id| (id, 0.0)).collect());
        assert_validation(&relationships, Ok(()), "relationship cap is inclusive");
        rich_agent_mut(&mut relationships)
            .relationships
            .as_mut()
            .expect("relationships")
            .push((MAX_LIST_ENTRIES as u32, 0.0));
        assert_validation(
            &relationships,
            Err(SaveError::InvalidValue),
            "relationship count above cap",
        );
        assert_invalid_entity(
            "non-finite relationship",
            |entity| entity.relationships = Some(vec![(1, f32::NAN)]),
            SaveError::InvalidValue,
        );
        assert_invalid_entity(
            "relationship below minimum",
            |entity| entity.relationships = Some(vec![(1, -1.0 - f32::EPSILON)]),
            SaveError::InvalidValue,
        );
        assert_invalid_entity(
            "relationship above maximum",
            |entity| entity.relationships = Some(vec![(1, 1.0 + f32::EPSILON)]),
            SaveError::InvalidValue,
        );
        assert_invalid_entity(
            "duplicate relationship id",
            |entity| entity.relationships = Some(vec![(1, 0.0), (1, 0.5)]),
            SaveError::InvalidValue,
        );
        assert_invalid_entity(
            "descending relationship id",
            |entity| entity.relationships = Some(vec![(2, 0.0), (1, 0.5)]),
            SaveError::InvalidValue,
        );

        let mut hobbies = rich_snapshot();
        rich_agent_mut(&mut hobbies).hobbies = Some(vec![String::new(); MAX_LIST_ENTRIES]);
        assert_validation(&hobbies, Ok(()), "hobby cap is inclusive");
        rich_agent_mut(&mut hobbies)
            .hobbies
            .as_mut()
            .expect("hobbies")
            .push(String::new());
        assert_validation(
            &hobbies,
            Err(SaveError::InvalidValue),
            "hobby count above cap",
        );

        let mut hobby_name = rich_snapshot();
        rich_agent_mut(&mut hobby_name).hobbies = Some(vec!["h".repeat(MAX_TEXT_BYTES)]);
        assert_validation(&hobby_name, Ok(()), "hobby text cap is inclusive");
        rich_agent_mut(&mut hobby_name).hobbies = Some(vec!["h".repeat(MAX_TEXT_BYTES + 1)]);
        assert_validation(
            &hobby_name,
            Err(SaveError::InvalidValue),
            "hobby text above cap",
        );
    }

    #[test]
    fn entity_and_content_references_are_validated_before_reconstruction() {
        let pack = terri_data::pack();
        let baseline = rich_snapshot();
        let exercised = baseline
            .entities
            .iter()
            .find(|entity| entity.target.is_some())
            .expect("exercised agent");
        let target = exercised.target.expect("target");
        let partner = exercised.socialising.expect("socialising").partner;

        assert_invalid_entity(
            "target missing entity",
            |entity| entity.target.as_mut().expect("target").object = u32::MAX - 1,
            SaveError::InvalidEntityReference,
        );
        // **A target on a PERSON is a conversation, not a corruption.**
        // This case asserted rejection until the alpha acceptance pass
        // measured what that cost: a save taken while anybody walked
        // over to talk was unloadable, and the shipped lot's first such
        // walk is at tick 188. What stays invalid is the far end being
        // absent, which the case above this one still pins.
        {
            let mut snapshot = rich_snapshot();
            rich_agent_mut(&mut snapshot)
                .target
                .as_mut()
                .expect("target")
                .object = partner;
            assert_validation(&snapshot, Ok(()), "target points at a housemate to talk to");
        }

        let target_object = baseline
            .entities
            .iter()
            .find(|entity| entity.index == target.object)
            .and_then(|entity| entity.smart_object.as_deref())
            .and_then(|id| pack.find(id))
            .expect("target object definition");
        // A live TARGET on an object names one of its interactions
        // directly, so the first invalid index is the count itself -
        // a chain in progress is `CHAIN_STEP`, not a row.
        let invalid_interaction = pack.object(target_object).interactions.len() as u32;
        assert_invalid_entity(
            "target interaction outside its object",
            |entity| entity.target.as_mut().expect("target").interaction = invalid_interaction,
            SaveError::InvalidContentReference,
        );
        // A queued INTENT names a flyout row, and the rows past the
        // interactions are the object's chains ([K5]), so its boundary
        // sits further out than the target's above.
        let invalid_row = invalid_interaction
            + pack
                .chains
                .iter()
                .filter(|chain| chain.advertised_by == target_object)
                .count() as u32;
        assert_invalid_entity(
            "intent row outside its object's flyout",
            |entity| entity.intents.as_mut().expect("intents")[0].interaction = invalid_row,
            SaveError::InvalidContentReference,
        );
        assert_invalid_entity(
            "eating names an unknown object",
            |entity| entity.eating.as_mut().expect("eating").object = "missing-object".into(),
            SaveError::InvalidContentReference,
        );
        assert_invalid_entity(
            "eating interaction outside its object",
            |entity| entity.eating.as_mut().expect("eating").interaction = invalid_interaction,
            SaveError::InvalidContentReference,
        );
        assert_invalid_entity(
            "smart object id is unknown",
            |entity| entity.smart_object = Some("missing-object".into()),
            SaveError::InvalidContentReference,
        );
        assert_invalid_entity(
            "career id is unknown",
            |entity| entity.career = Some("missing-career".into()),
            SaveError::InvalidContentReference,
        );
        assert_invalid_entity(
            "chain id is unknown",
            |entity| entity.chain.as_mut().expect("chain").chain = "missing-chain".into(),
            SaveError::InvalidContentReference,
        );
        assert_invalid_entity(
            "carried item kind is unknown",
            |entity| entity.carrying = Some("missing-item".into()),
            SaveError::InvalidContentReference,
        );

        for (label, mutate) in [
            ("social owner must be an agent", 0u8),
            ("social owner needs a stable id", 1),
            ("social partner must be an agent", 2),
            ("social partner needs a stable id", 3),
        ] {
            let mut snapshot = rich_snapshot();
            let partner = rich_agent_mut(&mut snapshot)
                .socialising
                .expect("socialising")
                .partner;
            match mutate {
                0 => rich_agent_mut(&mut snapshot).agent = false,
                1 => rich_agent_mut(&mut snapshot).sim_id = None,
                2 => {
                    snapshot
                        .entities
                        .iter_mut()
                        .find(|entity| entity.index == partner)
                        .expect("partner")
                        .agent = false;
                }
                3 => {
                    snapshot
                        .entities
                        .iter_mut()
                        .find(|entity| entity.index == partner)
                        .expect("partner")
                        .sim_id = None;
                }
                _ => unreachable!(),
            }
            assert_validation(&snapshot, Err(SaveError::InvalidEntityReference), label);
        }

        assert_invalid_entity(
            "social interaction outside vocabulary",
            |entity| {
                entity
                    .socialising
                    .as_mut()
                    .expect("socialising")
                    .interaction = pack.social.len() as u32
            },
            SaveError::InvalidContentReference,
        );
    }

    #[test]
    fn queued_commands_validate_every_reference_and_content_index() {
        let pack = terri_data::pack();
        let baseline = rich_snapshot();
        let exercised = baseline
            .entities
            .iter()
            .find(|entity| entity.target.is_some())
            .expect("exercised agent");
        let agent = exercised.index;
        let object = exercised.target.expect("target").object;
        let partner = exercised.socialising.expect("socialising").partner;
        let object_id = baseline
            .entities
            .iter()
            .find(|entity| entity.index == object)
            .and_then(|entity| entity.smart_object.as_deref())
            .and_then(|id| pack.find(id))
            .expect("target object");
        // **Past the CHAINS, not merely past the interactions.** The
        // rows after an object's interactions are the chains it
        // advertises ([K5]), so the first index this fixture may call
        // invalid is the one after those - picking the old boundary
        // now names a legitimate "Cook dinner" row.
        let invalid_object_interaction = (pack.object(object_id).interactions.len()
            + pack
                .chains
                .iter()
                .filter(|chain| chain.advertised_by == object_id)
                .count()) as u32;

        let valid = vec![
            SavedCommand::Select(None),
            SavedCommand::Select(Some(agent)),
            SavedCommand::UseObject {
                agent,
                object,
                interaction: 0,
            },
            SavedCommand::CancelIntents { agent },
            SavedCommand::SetSpeed(u8::MAX),
            SavedCommand::TalkTo {
                agent,
                target: partner,
                interaction: 0,
            },
        ];
        for command in valid {
            let mut snapshot = baseline.clone();
            snapshot.queued_commands = vec![command];
            assert_validation(&snapshot, Ok(()), "valid queued command");
        }

        let invalid = vec![
            (
                SavedCommand::Select(Some(object)),
                SaveError::InvalidEntityReference,
                "Select must name an agent",
            ),
            (
                SavedCommand::CancelIntents { agent: object },
                SaveError::InvalidEntityReference,
                "CancelIntents must name an agent",
            ),
            (
                SavedCommand::UseObject {
                    agent: object,
                    object,
                    interaction: 0,
                },
                SaveError::InvalidEntityReference,
                "UseObject agent must be an agent",
            ),
            (
                SavedCommand::UseObject {
                    agent,
                    object: partner,
                    interaction: 0,
                },
                SaveError::InvalidEntityReference,
                "UseObject target must be an object",
            ),
            (
                SavedCommand::UseObject {
                    agent,
                    object,
                    interaction: invalid_object_interaction,
                },
                SaveError::InvalidContentReference,
                "UseObject interaction must belong to its object",
            ),
            (
                SavedCommand::TalkTo {
                    agent: object,
                    target: partner,
                    interaction: 0,
                },
                SaveError::InvalidEntityReference,
                "TalkTo owner must be an agent",
            ),
            (
                SavedCommand::TalkTo {
                    agent,
                    target: object,
                    interaction: 0,
                },
                SaveError::InvalidEntityReference,
                "TalkTo target must be an agent",
            ),
            (
                SavedCommand::TalkTo {
                    agent,
                    target: partner,
                    interaction: pack.social.len() as u32,
                },
                SaveError::InvalidContentReference,
                "TalkTo interaction must belong to social vocabulary",
            ),
        ];
        for (command, expected, label) in invalid {
            let mut snapshot = baseline.clone();
            snapshot.queued_commands = vec![command];
            assert_validation(&snapshot, Err(expected), label);
        }
    }

    #[test]
    fn habituation_and_disposition_entries_require_valid_unique_content_rows() {
        let pack = terri_data::pack();
        let rows: Vec<SavedHabituation> = pack
            .objects
            .iter()
            .enumerate()
            .flat_map(|(object_index, object)| {
                object
                    .interactions
                    .iter()
                    .enumerate()
                    .map(move |(interaction, _)| SavedHabituation {
                        object: pack.objects[object_index].id.clone(),
                        interaction: interaction as u32,
                        value: 0.5,
                    })
            })
            .take(2)
            .collect();
        assert_eq!(rows.len(), 2, "fixture needs two authored interactions");

        let mut ordered = rich_snapshot();
        rich_agent_mut(&mut ordered).habituation = Some(rows.clone());
        assert_validation(&ordered, Ok(()), "ordered habituation rows");

        let mut duplicate = rich_snapshot();
        rich_agent_mut(&mut duplicate).habituation = Some(vec![rows[0].clone(), rows[0].clone()]);
        assert_validation(
            &duplicate,
            Err(SaveError::InvalidValue),
            "duplicate habituation key",
        );

        let mut descending = rich_snapshot();
        rich_agent_mut(&mut descending).habituation = Some(vec![rows[1].clone(), rows[0].clone()]);
        assert_validation(&descending, Ok(()), "save order is not content order");

        for (label, value) in [
            ("negative habituation", -f32::EPSILON),
            ("habituation above one", 1.0 + f32::EPSILON),
            ("non-finite habituation", f32::NAN),
        ] {
            assert_invalid_entity(
                label,
                |entity| entity.habituation.as_mut().expect("habituation")[0].value = value,
                SaveError::InvalidValue,
            );
        }
        assert_invalid_entity(
            "habituation object is unknown",
            |entity| {
                entity.habituation.as_mut().expect("habituation")[0].object =
                    "missing-object".into()
            },
            SaveError::InvalidContentReference,
        );

        let too_many = vec![rows[0].clone(); MAX_LIST_ENTRIES + 1];
        assert_invalid_entity(
            "habituation count above cap",
            |entity| entity.habituation = Some(too_many),
            SaveError::InvalidValue,
        );

        let mut disposition_ordered = rich_snapshot();
        rich_agent_mut(&mut disposition_ordered)
            .personality
            .as_mut()
            .expect("personality")
            .dispositions = rows.clone();
        assert_validation(
            &disposition_ordered,
            Ok(()),
            "ordered non-negative dispositions",
        );
        assert_invalid_entity(
            "negative disposition",
            |entity| {
                entity
                    .personality
                    .as_mut()
                    .expect("personality")
                    .dispositions[0]
                    .value = -f32::EPSILON
            },
            SaveError::InvalidValue,
        );
        assert_invalid_entity(
            "non-finite disposition",
            |entity| {
                entity
                    .personality
                    .as_mut()
                    .expect("personality")
                    .dispositions[0]
                    .value = f32::INFINITY
            },
            SaveError::InvalidValue,
        );
        let too_many = vec![rows[0].clone(); MAX_LIST_ENTRIES + 1];
        assert_invalid_entity(
            "disposition count above cap",
            |entity| {
                entity
                    .personality
                    .as_mut()
                    .expect("personality")
                    .dispositions = too_many
            },
            SaveError::InvalidValue,
        );
    }

    #[test]
    fn trait_and_chain_state_enforce_unique_ids_and_numeric_ranges() {
        let pack = terri_data::pack();
        assert!(pack.traits.len() >= 2, "fixture needs two traits");
        let first = SavedTraitState {
            id: pack.traits[0].id.clone(),
            state: 0.0,
        };
        let second = SavedTraitState {
            id: pack.traits[1].id.clone(),
            state: 1.0,
        };

        let mut traits = rich_snapshot();
        rich_agent_mut(&mut traits).traits = Some(vec![first.clone(), second.clone()]);
        assert_validation(
            &traits,
            Ok(()),
            "trait order and range boundaries are valid",
        );
        rich_agent_mut(&mut traits).traits = Some(vec![second.clone(), first.clone()]);
        assert_validation(&traits, Ok(()), "trait save order is not content order");
        rich_agent_mut(&mut traits).traits = Some(vec![first.clone(), first.clone()]);
        assert_validation(
            &traits,
            Err(SaveError::InvalidValue),
            "duplicate trait definition",
        );
        assert_invalid_entity(
            "unknown trait definition",
            |entity| {
                entity.traits = Some(vec![SavedTraitState {
                    id: "missing-trait".into(),
                    state: 0.5,
                }])
            },
            SaveError::InvalidContentReference,
        );
        let too_many = vec![first.clone(); MAX_LIST_ENTRIES + 1];
        assert_invalid_entity(
            "trait count above cap",
            |entity| entity.traits = Some(too_many),
            SaveError::InvalidValue,
        );
        for (label, state) in [
            ("trait below zero", -f32::EPSILON),
            ("trait above one", 1.0 + f32::EPSILON),
            ("non-finite trait", f32::NAN),
        ] {
            assert_invalid_entity(
                label,
                |entity| {
                    entity.traits = Some(vec![SavedTraitState {
                        id: pack.traits[0].id.clone(),
                        state,
                    }])
                },
                SaveError::InvalidValue,
            );
        }

        let chain = pack.chains.first().expect("shipped dinner chain");
        assert!(!chain.steps.is_empty(), "chain has steps");
        let mut chain_boundary = rich_snapshot();
        rich_agent_mut(&mut chain_boundary).chain = Some(SavedChainState {
            chain: chain.id.clone(),
            step: chain.steps.len() as u32 - 1,
            fumble_scale: 0.0,
        });
        assert_validation(
            &chain_boundary,
            Ok(()),
            "last chain step and zero fumble are valid",
        );
        rich_agent_mut(&mut chain_boundary)
            .chain
            .as_mut()
            .expect("chain")
            .step = chain.steps.len() as u32;
        assert_validation(
            &chain_boundary,
            Err(SaveError::InvalidValue),
            "chain step at length is invalid",
        );

        for (label, scale, expected) in [
            ("chain fumble maximum", 1.0, Ok(())),
            (
                "chain fumble below zero",
                -f32::EPSILON,
                Err(SaveError::InvalidValue),
            ),
            (
                "chain fumble above one",
                1.0 + f32::EPSILON,
                Err(SaveError::InvalidValue),
            ),
            (
                "non-finite chain fumble",
                f32::NAN,
                Err(SaveError::InvalidValue),
            ),
        ] {
            let mut snapshot = rich_snapshot();
            rich_agent_mut(&mut snapshot).chain = Some(SavedChainState {
                chain: chain.id.clone(),
                step: 0,
                fumble_scale: scale,
            });
            assert_validation(&snapshot, expected, label);
        }
    }

    #[test]
    fn every_public_full_pack_save_loads_and_migrates_the_old_household_names() {
        let source = Sim::new_from_shipped_lot();
        let mut legacy = source.save_snapshot();
        for entity in legacy.entities.iter_mut().filter(|entity| entity.agent) {
            let id = entity.sim_id.expect("shipped agents have stable ids") as usize;
            entity.sim_name = Some(
                LEGACY_HOUSEHOLD_NAMES
                    .get(id)
                    .expect("the shipped alpha has three authored sims")
                    .to_string(),
            );
        }

        for fingerprint in [
            0x9d22_8822_6933_d3c7,
            0x263e_ed3b_bdcb_a7d0,
            0x08ec_6011_bc11_7ad8,
            0x2eb2_02fa_e70e_4939,
        ] {
            let mut snapshot = legacy.clone();
            snapshot.content_fingerprint = fingerprint;
            let mut restored = Sim::new_from_shipped_lot();
            assert_eq!(
                restored.load_snapshot(snapshot),
                Ok(()),
                "public Save V1 fingerprint {fingerprint:#018x} must migrate"
            );
            let mut names: Vec<_> = {
                let mut query = restored.world_mut().query::<(&SimId, &SimName)>();
                query
                    .iter(restored.world())
                    .map(|(id, name)| (id.0, name.0.clone()))
                    .collect()
            };
            names.sort_unstable_by_key(|(id, _)| *id);
            assert_eq!(
                names,
                vec![
                    (0, "Tim".to_string()),
                    (1, "Bill".to_string()),
                    (2, "Casey".to_string()),
                ],
                "legacy names must not survive the household rename"
            );
        }
    }

    #[test]
    fn the_prior_structural_save_keeps_names_entities_positions_and_collision() {
        let mut prior = Sim::new_from_shipped_lot().save_snapshot();
        prior.content_fingerprint = 0x26d5_982c_9af8_3de8;
        prior
            .entities
            .iter_mut()
            .find(|entity| entity.sim_id == Some(0))
            .expect("the shipped household has SimId 0")
            .sim_name = Some("Terri".to_string());

        for (id, x, y) in [("moving_box", 4.0, 11.0), ("reference_shelf", 6.0, 10.0)] {
            let entity = prior
                .entities
                .iter()
                .find(|entity| entity.smart_object.as_deref() == Some(id))
                .expect("the prior lot carries both persistence-key entities");
            assert_eq!(entity.position, Some(SavedPosition { x, y }));
        }

        let expected_blocked = prior.blocked_tiles.clone();
        let expected_entities = prior.entities.clone();
        let mut restored = Sim::new_from_shipped_lot();
        assert_eq!(restored.load_snapshot(prior), Ok(()));

        let current = restored.save_snapshot();
        assert_eq!(current.content_fingerprint, 0xb8d0_2015_e030_64d9);
        assert_eq!(current.blocked_tiles, expected_blocked);
        assert_eq!(current.entities, expected_entities);
        let name = current
            .entities
            .iter()
            .find(|entity| entity.sim_id == Some(0))
            .and_then(|entity| entity.sim_name.as_deref());
        assert_eq!(
            name,
            Some("Terri"),
            "a structural interaction migration is not a legacy household rename"
        );
        assert_eq!(
            restored.save_snapshot(),
            current,
            "a second capture must stay canonical rather than preserving the source digest"
        );
    }

    #[test]
    fn pre_feature_fingerprints_reject_every_impossible_aquarium_and_bike_row_transactionally() {
        let source = Sim::new_from_shipped_lot().save_snapshot();
        let agent_index = source
            .entities
            .iter()
            .find(|entity| entity.agent)
            .expect("the shipped lot has an agent")
            .index;

        for fingerprint in [
            0x26d5_982c_9af8_3de8,
            0x9d22_8822_6933_d3c7,
            0x263e_ed3b_bdcb_a7d0,
            0x08ec_6011_bc11_7ad8,
            0x2eb2_02fa_e70e_4939,
        ] {
            for object in AQUARIUM_BIKE_PERSISTENCE_KEYS {
                let target_index = source
                    .entities
                    .iter()
                    .find(|entity| entity.smart_object.as_deref() == Some(object))
                    .expect("the shipped lot retains both persistence-key entities")
                    .index;

                let mut cases: Vec<(&str, SaveSnapshotV1)> = Vec::new();

                let mut target = source.clone();
                target.content_fingerprint = fingerprint;
                target
                    .entities
                    .iter_mut()
                    .find(|entity| entity.index == agent_index)
                    .expect("agent remains in target fixture")
                    .target = Some(SavedTarget {
                    object: target_index,
                    interaction: 0,
                });
                cases.push(("Target", target));

                let mut eating = source.clone();
                eating.content_fingerprint = fingerprint;
                eating
                    .entities
                    .iter_mut()
                    .find(|entity| entity.index == agent_index)
                    .expect("agent remains in eating fixture")
                    .eating = Some(SavedEating {
                    object: object.to_string(),
                    interaction: 0,
                    remaining_ticks: 1,
                });
                cases.push(("Eating", eating));

                let mut intent = source.clone();
                intent.content_fingerprint = fingerprint;
                intent
                    .entities
                    .iter_mut()
                    .find(|entity| entity.index == agent_index)
                    .expect("agent remains in intent fixture")
                    .intents = Some(vec![SavedIntent {
                    object: target_index,
                    interaction: 0,
                }]);
                cases.push(("Intent", intent));

                let mut command = source.clone();
                command.content_fingerprint = fingerprint;
                command.queued_commands = vec![SavedCommand::UseObject {
                    agent: agent_index,
                    object: target_index,
                    interaction: 0,
                }];
                cases.push(("queued UseObject", command));

                let mut habituation = source.clone();
                habituation.content_fingerprint = fingerprint;
                habituation
                    .entities
                    .iter_mut()
                    .find(|entity| entity.index == agent_index)
                    .expect("agent remains in habituation fixture")
                    .habituation = Some(vec![SavedHabituation {
                    object: object.to_string(),
                    interaction: 0,
                    value: 0.25,
                }]);
                cases.push(("Habituation", habituation));

                let mut personality = source.clone();
                personality.content_fingerprint = fingerprint;
                personality
                    .entities
                    .iter_mut()
                    .find(|entity| entity.index == agent_index)
                    .expect("agent remains in personality fixture")
                    .personality
                    .get_or_insert_with(|| SavedPersonality {
                        drain: [1.0; terri_core::NEED_COUNT],
                        satisfaction: [1.0; terri_core::NEED_COUNT],
                        dispositions: Vec::new(),
                    })
                    .dispositions = vec![SavedHabituation {
                    object: object.to_string(),
                    interaction: 0,
                    value: 1.25,
                }];
                cases.push(("Personality disposition", personality));

                for (space, impossible) in cases {
                    let mut live = Sim::new_from_shipped_lot();
                    for _ in 0..31 {
                        live.tick();
                    }
                    let before = live.save_snapshot();
                    assert_eq!(
                        live.load_snapshot(impossible),
                        Err(SaveError::InvalidContentReference),
                        "pre-feature {fingerprint:#018x} {object} {space} must not reinterpret the new row"
                    );
                    assert_eq!(
                        live.save_snapshot(),
                        before,
                        "rejected pre-feature {object} {space} mutated the running simulation"
                    );
                }
            }
        }
    }

    #[test]
    fn current_saves_round_trip_each_new_action_in_progress() {
        for (object, remaining_ticks) in [("moving_box", 47), ("reference_shelf", 31)] {
            let mut snapshot = Sim::new_from_shipped_lot().save_snapshot();
            let target = snapshot
                .entities
                .iter()
                .find(|entity| entity.smart_object.as_deref() == Some(object))
                .expect("the shipped lot places each new action owner")
                .index;
            snapshot
                .entities
                .iter_mut()
                .find(|entity| entity.index == target)
                .expect("the target entity remains in the snapshot")
                .reserved = true;
            let agent = snapshot
                .entities
                .iter_mut()
                .find(|entity| entity.agent)
                .expect("the shipped lot has an agent");
            agent.target = Some(SavedTarget {
                object: target,
                interaction: 0,
            });
            agent.eating = Some(SavedEating {
                object: object.to_string(),
                interaction: 0,
                remaining_ticks,
            });

            let mut restored = Sim::new_from_shipped_lot();
            assert_eq!(
                restored.load_snapshot(snapshot.clone()),
                Ok(()),
                "current {object} action must restore"
            );
            assert_eq!(
                restored.save_snapshot(),
                snapshot,
                "current {object} action must retain its row and remaining duration"
            );
        }
    }

    #[test]
    fn a_saved_custom_name_is_not_overwritten_by_the_household_migration() {
        let mut snapshot = Sim::new_from_shipped_lot().save_snapshot();
        snapshot.content_fingerprint = 0x2eb2_02fa_e70e_4939;
        snapshot
            .entities
            .iter_mut()
            .find(|entity| entity.sim_id == Some(0))
            .expect("the shipped household has SimId 0")
            .sim_name = Some("Player Name".to_string());

        let mut restored = Sim::new_from_shipped_lot();
        assert_eq!(restored.load_snapshot(snapshot), Ok(()));
        let name = {
            let mut query = restored.world_mut().query::<(&SimId, &SimName)>();
            query
                .iter(restored.world())
                .find(|(id, _)| id.0 == 0)
                .map(|(_, name)| name.0.clone())
                .expect("SimId 0 was restored")
        };
        assert_eq!(name, "Player Name");
    }

    #[test]
    fn the_current_fingerprint_never_rewrites_a_deliberately_reused_legacy_name() {
        let mut snapshot = Sim::new_from_shipped_lot().save_snapshot();
        snapshot
            .entities
            .iter_mut()
            .find(|entity| entity.sim_id == Some(0))
            .expect("the shipped household has SimId 0")
            .sim_name = Some("Terri".to_string());

        let mut restored = Sim::new_from_shipped_lot();
        assert_eq!(restored.load_snapshot(snapshot), Ok(()));
        let name = {
            let mut query = restored.world_mut().query::<(&SimId, &SimName)>();
            query
                .iter(restored.world())
                .find(|(id, _)| id.0 == 0)
                .map(|(_, name)| name.0.clone())
                .expect("SimId 0 was restored")
        };
        assert_eq!(name, "Terri");
    }

    /// A save takes a snapshot against one pack and loads it against a
    /// second that differs in the ways an ordinary patch actually differs.
    /// Every numeric row the snapshot holds still means what it meant.
    #[test]
    fn a_save_loads_into_content_that_was_only_retuned_or_redrawn() {
        let objects = || {
            vec![
                crate::test_content::object("fridge", &[(terri_core::NeedId::Hunger, 40.0)], 15),
                crate::test_content::object("bed", &[(terri_core::NeedId::Energy, 60.0)], 30),
            ]
        };
        let before = crate::test_content::pack(objects());

        let mut sim = crate::test_content::sim_with(8, 8, before);
        sim.world_mut()
            .spawn((Agent, Position { x: 2.0, y: 2.0 }, Needs::all_at(50.0)));
        for _ in 0..30 {
            sim.tick();
        }
        let snapshot = sim.save_snapshot();
        assert!(
            snapshot.entities.iter().any(|e| e.agent),
            "the snapshot has to carry the agent it is about"
        );

        // A balance pass and a new sprite cannot move an index the snapshot
        // holds, so neither may cost a player the save.
        let patched = Box::leak(Box::new(terri_data::ContentPack {
            tuning: terri_data::Tuning {
                action_threshold: before.tuning.action_threshold + 0.02,
                asleep_decay_scale: 1.0,
                ..before.tuning
            },
            sim_sprite: before.sim_sprite + 1,
            ..before.clone()
        }));
        assert_ne!(
            patched.tuning.action_threshold, before.tuning.action_threshold,
            "the fixture must actually differ, or this asserts nothing"
        );

        let mut fresh = crate::test_content::sim_with(8, 8, patched);
        assert_eq!(
            fresh.load_snapshot(snapshot),
            Ok(()),
            "a save must survive a patch that moves no index it points at"
        );
    }

    /// And the other half: content that DOES move an index is still
    /// refused. A save naming interaction 0 of an object that no longer
    /// offers one is nonsense, and loading it would be worse than
    /// starting over.
    #[test]
    fn a_save_is_still_refused_when_the_vocabulary_it_names_has_moved() {
        let before = crate::test_content::pack(vec![crate::test_content::object(
            "fridge",
            &[(terri_core::NeedId::Hunger, 40.0)],
            15,
        )]);
        let mut sim = crate::test_content::sim_with(8, 8, before);
        sim.world_mut()
            .spawn((Agent, Position { x: 2.0, y: 2.0 }, Needs::all_at(50.0)));
        sim.tick();
        let snapshot = sim.save_snapshot();

        let renamed = Box::leak(Box::new(terri_data::ContentPack {
            objects: vec![crate::test_content::object(
                "fridge",
                &[(terri_core::NeedId::Hunger, 40.0)],
                15,
            )]
            .into_iter()
            .map(|mut object| {
                object.interactions[0].id = "moved".to_string();
                object
            })
            .collect(),
            ..before.clone()
        }));
        let mut fresh = crate::test_content::sim_with(8, 8, renamed);
        assert_eq!(
            fresh.load_snapshot(snapshot),
            Err(SaveError::IncompatibleContent),
            "an interaction id is what pins an index to a meaning"
        );
    }

    #[test]
    fn invalid_snapshots_are_rejected_without_touching_the_running_sim() {
        let mut cases: Vec<(SaveSnapshotV1, SaveError)> = Vec::new();
        let baseline = rich_snapshot();

        let mut wrong_content = baseline.clone();
        wrong_content.content_fingerprint ^= 1;
        cases.push((wrong_content, SaveError::IncompatibleContent));

        let mut bad_grid = baseline.clone();
        bad_grid.blocked_tiles.pop();
        cases.push((bad_grid, SaveError::InvalidGrid));

        let mut duplicate_selection = baseline.clone();
        duplicate_selection
            .entities
            .iter_mut()
            .find(|entity| entity.agent && !entity.selected)
            .expect("another agent exists")
            .selected = true;
        cases.push((duplicate_selection, SaveError::DuplicateSelection));

        let mut bad_allocator = baseline.clone();
        bad_allocator.issued_sim_ids = baseline
            .entities
            .iter()
            .filter_map(|entity| entity.sim_id)
            .max()
            .expect("household has ids");
        cases.push((bad_allocator, SaveError::InvalidSimIdAllocator));

        let mut absurd_allocator = baseline.clone();
        absurd_allocator.issued_sim_ids = u32::MAX;
        cases.push((absurd_allocator, SaveError::InvalidSimIdAllocator));

        let mut bad_reference = baseline.clone();
        bad_reference
            .entities
            .iter_mut()
            .find(|entity| entity.target.is_some())
            .expect("rich fixture has a target")
            .target
            .as_mut()
            .expect("target remains present")
            .object = u32::MAX - 1;
        cases.push((bad_reference, SaveError::InvalidEntityReference));

        for (invalid, expected) in cases {
            let mut live = Sim::new_from_shipped_lot();
            for _ in 0..31 {
                live.tick();
            }
            let before = live.save_snapshot();
            assert_eq!(live.load_snapshot(invalid), Err(expected));
            assert_eq!(
                live.save_snapshot(),
                before,
                "failed load mutated the running simulation"
            );
        }
    }
}
