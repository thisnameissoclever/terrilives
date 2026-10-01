//! Deprivation, death records and cleanup for [DE-slice-neglect].
use crate::{Content, SaveError, Sim};
use bevy_ecs::prelude::*;
use terri_core::save::{DeathCause, DeathRecord, SavedMortality};
use terri_core::{
    Agent, ConversationVoice, Eating, IntentQueue, NeedId, Needs, Path, Reserved, SimClock, SimId,
    SimName, Socialising, Target,
};

pub(crate) fn snapshot(world: &World) -> Option<SavedMortality> {
    let state = world.resource::<SavedMortality>();
    (state.enabled || !state.counts.is_empty() || !state.deaths.is_empty()).then(|| state.clone())
}

impl Sim {
    pub fn death_enabled(&self) -> bool {
        self.world.resource::<SavedMortality>().enabled
    }
    pub fn death_records(&self) -> &[DeathRecord] {
        &self.world.resource::<SavedMortality>().deaths
    }
    pub fn deprivation_ticks(&self, index: u32) -> u32 {
        let counts = &self.world.resource::<SavedMortality>().counts;
        counts
            .binary_search_by_key(&index, |row| row.0)
            .map_or(0, |at| counts[at].1)
    }
    pub fn death_warning(&self, index: u32) -> Option<String> {
        let tuning = &self.world.resource::<Content>().0.tuning;
        if !self.death_enabled()
            || self.deprivation_ticks(index) < tuning.death_after_ticks - tuning.death_warning_ticks
        {
            return None;
        }
        let mut query = self
            .world
            .try_query_filtered::<(Entity, &SimName, &Needs), With<Agent>>()?;
        let (_, name, needs) = query
            .iter(&self.world)
            .find(|(e, ..)| e.index_u32() == index)?;
        let empty = match (
            needs.get(NeedId::Hunger) == 0.0,
            needs.get(NeedId::Energy) == 0.0,
        ) {
            (true, true) => "hunger and energy are empty. They will die if either stays empty.",
            (true, false) => "hunger is empty. They will die if it stays empty.",
            (false, true) => "energy is empty. They will die if it stays empty.",
            (false, false) => return None,
        };
        Some(format!("{}'s {empty}", name.0))
    }
}

/// Read final need levels after every source of recovery on this tick.
pub(crate) fn tick(world: &mut World) {
    let mut people: Vec<_> = world
        .query_filtered::<(Entity, &Needs, &SimId, &SimName), With<Agent>>()
        .iter(world)
        .map(|(e, n, id, name)| {
            (
                e,
                n.get(NeedId::Hunger) == 0.0 || n.get(NeedId::Energy) == 0.0,
                id.0,
                name.0.clone(),
            )
        })
        .collect();
    people.sort_unstable_by_key(|row| row.0.index_u32());
    let issued_sim_ids = world.resource::<terri_core::SimIdAllocator>().issued();
    let threshold = world.resource::<Content>().0.tuning.death_after_ticks;
    let now = world.resource::<SimClock>().tick;
    let mut state = world.resource::<SavedMortality>().clone();
    let previous = std::mem::take(&mut state.counts);
    let mut dead = Vec::new();
    for (entity, empty, id, name) in people {
        if !empty {
            continue;
        }
        let count = previous
            .binary_search_by_key(&entity.index_u32(), |row| row.0)
            .map_or(0, |at| previous[at].1)
            .saturating_add(1);
        if state.enabled && count >= threshold {
            state.deaths.push(DeathRecord {
                sim_id: id,
                name,
                tick: now,
                cause: DeathCause::Deprivation,
                issued_sim_ids,
            });
            dead.push(entity);
        } else {
            state.counts.push((entity.index_u32(), count));
        }
    }
    state
        .deaths
        .sort_by_key(|record| (record.tick, record.sim_id));
    world.insert_resource(state);
    for entity in dead {
        remove_person(world, entity);
    }
}

fn clear_action(world: &mut World, entity: Entity) {
    world.entity_mut(entity).remove::<(
        Target,
        Path,
        Eating,
        Socialising,
        ConversationVoice,
        terri_core::Fumbled,
        terri_core::StepWork,
    )>();
}

fn remove_person(world: &mut World, dead: Entity) {
    crate::domestic::remove_person(world, dead);
    let own_target = world.get::<Target>(dead).map(|t| t.object);
    let partner = world.get::<Socialising>(dead).map(|talk| talk.partner);
    for target in own_target.into_iter().chain(partner) {
        crate::domestic::release_station(world, target, dead);
    }
    let mut people: Vec<_> = world.query::<Entity>().iter(world).collect();
    people.sort_unstable_by_key(|e| e.index_u32());
    for entity in people {
        if world
            .get::<Target>(entity)
            .is_some_and(|t| t.object == dead)
        {
            clear_action(world, entity);
        } else if world
            .get::<Socialising>(entity)
            .is_some_and(|s| s.partner == dead)
        {
            world
                .entity_mut(entity)
                .remove::<(Socialising, ConversationVoice)>();
        }
        if let Some(mut queue) = world.get_mut::<IntentQueue>(entity) {
            let kept = queue
                .as_slice()
                .iter()
                .copied()
                .filter(|intent| intent.object != dead)
                .collect();
            *queue = IntentQueue::from_intents(kept);
        }
    }
    world
        .despawn_no_free(dead)
        .expect("death removes a living person");
    world
        .get_resource_or_insert_with(crate::placement::sale::RetiredIndices::default)
        .retire(dead.index_u32());
}

/// Reclaim reservations after an owner disappears or loses usable needs,
/// and stop walks whose object no longer exists as an interaction target.
pub(crate) fn cleanup(world: &mut World) {
    let invalid: Vec<_> = world
        .query::<(Entity, &Target)>()
        .iter(world)
        .filter(|(e, t)| {
            world.get::<Needs>(*e).is_none()
                || (world.get::<terri_core::SmartObject>(t.object).is_none()
                    && world.get::<Agent>(t.object).is_none())
        })
        .map(|(e, t)| (e, t.object))
        .collect();
    for (entity, target) in invalid {
        clear_action(world, entity);
        if let Ok(mut target) = world.get_entity_mut(target) {
            target.remove::<Reserved>();
        }
    }
}

pub(crate) fn hash(world: &World, hasher: &mut terri_core::FnvHasher) {
    if let Some(state) = snapshot(world) {
        hasher.write_bytes(b"mortality-v1");
        hasher.write_u64(u64::from(state.enabled));
        hasher.write_u64(state.counts.len() as u64);
        for (index, count) in state.counts {
            hasher.write_u64(index.into());
            hasher.write_u64(count.into());
        }
        hasher.write_u64(state.deaths.len() as u64);
        for record in state.deaths {
            hasher.write_u64(record.sim_id.into());
            hasher.write_u64(record.tick);
            hasher.write_u64(record.cause as u64);
            hasher.write_u64(record.issued_sim_ids.into());
            hasher.write_u64(record.name.len() as u64);
            hasher.write_bytes(record.name.as_bytes());
        }
    }
}

pub(crate) fn restore(world: &mut World, saved: Option<SavedMortality>) -> Result<(), SaveError> {
    let Some(state) = saved else {
        world.insert_resource(SavedMortality::default());
        return Ok(());
    };
    let now = world.resource::<SimClock>().tick;
    let issued = world.resource::<terri_core::SimIdAllocator>().issued();
    let live: Vec<_> = world
        .query_filtered::<(Entity, &SimId), With<Agent>>()
        .iter(world)
        .map(|(e, id)| (e.index_u32(), id.0))
        .collect();
    if state.counts.windows(2).any(|p| p[0].0 >= p[1].0)
        || state
            .counts
            .iter()
            .any(|(index, count)| *count == 0 || !live.iter().any(|row| row.0 == *index))
        || state
            .deaths
            .windows(2)
            .any(|p| (p[0].tick, p[0].sim_id) >= (p[1].tick, p[1].sim_id))
    {
        return Err(SaveError::InvalidValue);
    }
    let mut ids = std::collections::BTreeSet::new();
    for record in &state.deaths {
        if record.issued_sim_ids > issued
            || record.sim_id >= record.issued_sim_ids
            || record.tick > now
            || record.name.is_empty()
            || record.name.len() > 1024
            || live.iter().any(|row| row.1 == record.sim_id)
            || !ids.insert(record.sim_id)
        {
            return Err(SaveError::InvalidValue);
        }
    }
    world.insert_resource(state);
    Ok(())
}

#[cfg(test)]
mod tests {
    #[test]
    fn new_worlds_enable_death() {
        assert!(crate::Sim::new().death_enabled());
    }

    #[test]
    fn old_saves_enable_death_once_and_later_off_choices_survive() {
        let mut source = crate::Sim::new_from_shipped_lot();
        source
            .world_mut()
            .resource_mut::<terri_core::save::SavedMortality>()
            .enabled = false;
        let mut old = source.save_snapshot_v5();
        old.death_default_applied = false;
        let mut loaded = crate::Sim::new();
        loaded.load_snapshot_v5(old).unwrap();
        assert!(loaded.death_enabled());
        loaded
            .world_mut()
            .resource_mut::<terri_core::CommandQueue>()
            .push(terri_core::SimCommand::SetDeathEnabled(false));
        loaded.flush_commands();
        let current = loaded.save_snapshot_v5();
        assert!(current.death_default_applied);
        source.load_snapshot_v5(current).unwrap();
        assert!(!source.death_enabled());
    }

    use crate::{Content, Sim};
    use terri_core::{Agent, NeedId, Needs, Position, SimCommand, SimId, SimName};

    fn fixture() -> (Sim, terri_core::Entity) {
        let mut sim = Sim::new();
        sim.world_mut()
            .resource_mut::<terri_core::save::SavedMortality>()
            .enabled = false;
        sim.world_mut()
            .insert_resource(terri_core::SimIdAllocator::resumed(2));
        let mut pack = terri_data::pack().clone();
        pack.tuning.death_after_ticks = 3;
        pack.tuning.death_warning_ticks = 1;
        pack.tuning.grief_ticks = 10;
        pack.tuning.grief_min_ticks = 2;
        sim.world_mut()
            .insert_resource(Content(Box::leak(Box::new(pack))));
        let mut needs = Needs::all_at(100.0);
        needs.set(NeedId::Hunger, 0.0);
        let person = sim
            .world_mut()
            .spawn((
                Agent,
                SimId(0),
                SimName("Alex".into()),
                Position { x: 0.0, y: 0.0 },
                needs,
            ))
            .id();
        (sim, person)
    }

    #[test]
    fn deprivation_counts_while_disabled_resets_and_warns_only_when_enabled() {
        let (mut sim, person) = fixture();
        super::tick(sim.world_mut());
        super::tick(sim.world_mut());
        assert_eq!(sim.deprivation_ticks(person.index_u32()), 2);
        assert!(sim.death_warning(person.index_u32()).is_none());
        sim.world_mut()
            .resource_mut::<terri_core::CommandQueue>()
            .push(SimCommand::SetDeathEnabled(true));
        sim.flush_commands();
        assert_eq!(
            sim.death_warning(person.index_u32()).as_deref(),
            Some("Alex's hunger is empty. They will die if it stays empty.")
        );
        sim.world_mut()
            .get_mut::<Needs>(person)
            .unwrap()
            .set(NeedId::Hunger, 1.0);
        super::tick(sim.world_mut());
        assert_eq!(sim.deprivation_ticks(person.index_u32()), 0);
        assert!(sim.death_warning(person.index_u32()).is_none());
    }

    #[test]
    fn death_happens_at_the_threshold_and_retires_the_index() {
        let (mut sim, person) = fixture();
        sim.world_mut()
            .resource_mut::<terri_core::CommandQueue>()
            .push(SimCommand::SetDeathEnabled(true));
        sim.flush_commands();
        for _ in 0..2 {
            super::tick(sim.world_mut());
        }
        assert!(sim.world().get_entity(person).is_ok());
        super::tick(sim.world_mut());
        assert!(sim.world().get_entity(person).is_err());
        assert_eq!(sim.death_records().len(), 1);
        assert_eq!(sim.death_records()[0].name, "Alex");
        assert_eq!(
            sim.world()
                .resource::<crate::placement::sale::RetiredIndices>()
                .as_slice(),
            &[person.index_u32()]
        );
        assert_ne!(
            sim.world_mut().spawn_empty().id().index_u32(),
            person.index_u32()
        );
    }
    #[test]
    fn reservation_is_reclaimed_when_an_interacting_agent_is_despawned() {
        let (mut sim, person) = fixture();
        sim.world_mut()
            .entity_mut(person)
            .insert(terri_core::Eating {
                object: terri_core::ObjectDefId(0),
                interaction: 0,
                remaining_ticks: 5,
            });
        let object = sim
            .world_mut()
            .spawn((
                terri_core::SmartObject(terri_core::ObjectDefId(0)),
                terri_core::Reserved,
            ))
            .id();
        sim.world_mut()
            .entity_mut(person)
            .insert(terri_core::Target {
                object,
                interaction: 0,
            });
        super::remove_person(sim.world_mut(), person);
        assert!(sim.world().get::<terri_core::Reserved>(object).is_none());
    }

    #[test]
    fn losing_smart_object_mid_walk_releases_reservation_and_action() {
        let (mut sim, person) = fixture();
        sim.world_mut().entity_mut(person).insert(terri_core::Path {
            steps: vec![(1, 0)],
            cursor: 0,
        });
        let object = sim.world_mut().spawn(terri_core::Reserved).id();
        sim.world_mut()
            .entity_mut(person)
            .insert(terri_core::Target {
                object,
                interaction: 0,
            });
        super::cleanup(sim.world_mut());
        assert!(sim.world().get::<terri_core::Path>(person).is_none());
        assert!(sim.world().get::<terri_core::Reserved>(object).is_none());
        assert!(sim.world().get::<terri_core::Target>(person).is_none());
    }

    #[test]
    fn losing_needs_mid_interaction_releases_reservation_and_action() {
        let (mut sim, person) = fixture();
        sim.world_mut()
            .entity_mut(person)
            .insert(terri_core::Eating {
                object: terri_core::ObjectDefId(0),
                interaction: 0,
                remaining_ticks: 5,
            });
        let object = sim
            .world_mut()
            .spawn((
                terri_core::SmartObject(terri_core::ObjectDefId(0)),
                terri_core::Reserved,
            ))
            .id();
        sim.world_mut()
            .entity_mut(person)
            .insert(terri_core::Target {
                object,
                interaction: 0,
            })
            .remove::<Needs>();
        super::cleanup(sim.world_mut());
        assert!(sim.world().get::<terri_core::Eating>(person).is_none());
        assert!(sim.world().get::<terri_core::Reserved>(object).is_none());
        assert!(sim.world().get::<terri_core::Target>(person).is_none());
    }

    #[test]
    fn shipped_grief_fades_over_ten_to_sixty_game_days() {
        let mut sim = Sim::new();
        let death_tick = 123;
        sim.world_mut()
            .resource_mut::<terri_core::save::SavedMortality>()
            .deaths
            .push(terri_core::save::DeathRecord {
                sim_id: 0,
                name: "Alex".into(),
                tick: death_tick,
                cause: terri_core::save::DeathCause::Deprivation,
                issued_sim_ids: 2,
            });
        let survivor = sim
            .world_mut()
            .spawn((
                Agent,
                SimId(1),
                SimName("Jo".into()),
                Position { x: 0.0, y: 0.0 },
                Needs::all_at(100.0),
            ))
            .id();
        let day = u64::from(terri_data::pack().tuning.day_ticks);
        let grief = |sim: &Sim| {
            sim.mood_of(survivor.index_u32())
                .unwrap()
                .moodlets
                .into_iter()
                .find(|m| m.label == "Grieving Alex")
                .map(|m| m.score)
        };
        for (affinity, days, initial) in [(0.0, 10, -5.0), (0.5, 35, -17.5), (1.0, 60, -30.0)] {
            let mut feelings = terri_core::Relationships::default();
            feelings.bump(SimId(0), affinity);
            sim.world_mut().entity_mut(survivor).insert(feelings);
            sim.world_mut().resource_mut::<terri_core::SimClock>().tick = death_tick;
            assert_eq!(grief(&sim), Some(initial));
            sim.world_mut().resource_mut::<terri_core::SimClock>().tick =
                death_tick + days * day / 2;
            assert_eq!(
                grief(&sim),
                Some(initial / 2.0),
                "affinity {affinity}: halfway"
            );
            sim.world_mut().resource_mut::<terri_core::SimClock>().tick =
                death_tick + days * day - 1;
            assert!(
                grief(&sim).unwrap() < 0.0,
                "affinity {affinity}: final tick"
            );
            sim.world_mut().resource_mut::<terri_core::SimClock>().tick = death_tick + days * day;
            assert_eq!(grief(&sim), None, "affinity {affinity}: expired");
        }
    }

    #[test]
    fn grief_uses_the_survivors_relationship_and_fades_to_zero() {
        let (mut sim, dead) = fixture();
        let mut love = terri_core::Relationships::default();
        love.bump(SimId(0), 1.0);
        let survivor = sim
            .world_mut()
            .spawn((
                Agent,
                SimId(1),
                SimName("Jo".into()),
                Position { x: 0.0, y: 0.0 },
                Needs::all_at(100.0),
                love,
            ))
            .id();
        sim.world_mut()
            .resource_mut::<terri_core::save::SavedMortality>()
            .enabled = true;
        for _ in 0..3 {
            super::tick(sim.world_mut());
        }
        assert!(sim.world().get_entity(dead).is_err());
        let grief = |sim: &Sim| {
            sim.mood_of(survivor.index_u32())
                .unwrap()
                .moodlets
                .into_iter()
                .find(|m| m.label == "Grieving Alex")
                .map(|m| m.score)
        };
        assert_eq!(grief(&sim), Some(-30.0));
        sim.world_mut().resource_mut::<terri_core::SimClock>().tick = 5;
        assert_eq!(grief(&sim), Some(-15.0));
        sim.world_mut().resource_mut::<terri_core::SimClock>().tick = 10;
        assert_eq!(grief(&sim), None);
        assert_eq!(
            sim.world()
                .get::<terri_core::Relationships>(survivor)
                .unwrap()
                .feeling(SimId(0)),
            1.0
        );
    }

    #[test]
    fn count_setting_and_records_are_saved_and_hashed() {
        let mut sim = Sim::new_from_shipped_lot();
        sim.world_mut()
            .resource_mut::<terri_core::save::SavedMortality>()
            .enabled = false;
        let person = sim
            .world_mut()
            .query_filtered::<terri_core::Entity, bevy_ecs::prelude::With<Agent>>()
            .iter(sim.world())
            .next()
            .unwrap();
        sim.world_mut()
            .get_mut::<Needs>(person)
            .unwrap()
            .set(NeedId::Hunger, 0.0);
        let before = sim.world_hash();
        super::tick(sim.world_mut());
        assert_ne!(before, sim.world_hash());
        let mut loaded = Sim::new_from_shipped_lot();
        loaded.load_snapshot_v5(sim.save_snapshot_v5()).unwrap();
        assert_eq!(sim.world_hash(), loaded.world_hash());
        assert_eq!(loaded.deprivation_ticks(person.index_u32()), 1);
        let before = sim.world_hash();
        sim.world_mut()
            .resource_mut::<terri_core::save::SavedMortality>()
            .enabled = true;
        assert_ne!(before, sim.world_hash());
        loaded.load_snapshot_v5(sim.save_snapshot_v5()).unwrap();
        assert!(loaded.death_enabled());
    }

    #[test]
    fn death_clears_selection_conversation_and_only_orders_naming_the_dead() {
        use terri_core::{Intent, IntentQueue, Reserved, Selected, Socialising, Target};
        for initiator_dies in [false, true] {
            let (mut sim, first) = fixture();
            let second = sim
                .world_mut()
                .spawn((
                    Agent,
                    SimId(1),
                    SimName("Jo".into()),
                    Position { x: 0.0, y: 0.0 },
                    Needs::all_at(100.0),
                    Reserved,
                ))
                .id();
            let unrelated = sim.world_mut().spawn_empty().id();
            sim.world_mut().entity_mut(first).insert((
                Target {
                    object: second,
                    interaction: 0,
                },
                Socialising {
                    partner: second,
                    interaction: 0,
                    remaining_ticks: 10,
                },
            ));
            let (dead, survivor) = if initiator_dies {
                (first, second)
            } else {
                (second, first)
            };
            sim.world_mut().entity_mut(dead).insert(Selected);
            sim.world_mut()
                .entity_mut(survivor)
                .insert(IntentQueue::from_intents(vec![
                    Intent {
                        object: dead,
                        interaction: 0,
                    },
                    Intent {
                        object: unrelated,
                        interaction: 0,
                    },
                    Intent {
                        object: dead,
                        interaction: 1,
                    },
                ]));
            super::remove_person(sim.world_mut(), dead);
            assert!(sim.world().get_entity(dead).is_err());
            assert!(sim.world().get::<Reserved>(survivor).is_none());
            assert!(sim.world().get::<Target>(survivor).is_none());
            assert!(sim.world().get::<Socialising>(survivor).is_none());
            assert_eq!(
                sim.world().get::<IntentQueue>(survivor).unwrap().as_slice(),
                &[Intent {
                    object: unrelated,
                    interaction: 0
                }]
            );
            assert_eq!(
                sim.world_mut()
                    .query_filtered::<terri_core::Entity, bevy_ecs::prelude::With<Selected>>()
                    .iter(sim.world())
                    .count(),
                0
            );
        }
    }

    #[test]
    fn dead_relationships_do_not_decay_while_living_relationships_do() {
        use bevy_ecs::system::RunSystemOnce;
        let (mut sim, _) = fixture();
        let mut feelings = terri_core::Relationships::default();
        feelings.bump(SimId(0), 0.5);
        feelings.bump(SimId(2), 0.5);
        let survivor = sim.world_mut().spawn(feelings).id();
        sim.world_mut()
            .resource_mut::<terri_core::save::SavedMortality>()
            .deaths
            .push(terri_core::save::DeathRecord {
                sim_id: 0,
                name: "Alex".into(),
                tick: 0,
                cause: terri_core::save::DeathCause::Deprivation,
                issued_sim_ids: 2,
            });
        sim.world_mut()
            .run_system_once(crate::systems::social::decay_relationships)
            .unwrap();
        let feelings = sim
            .world()
            .get::<terri_core::Relationships>(survivor)
            .unwrap();
        assert_eq!(feelings.feeling(SimId(0)), 0.5);
        assert!(feelings.feeling(SimId(2)) < 0.5);
    }

    #[test]
    fn energy_alone_and_alternating_empty_needs_count_as_one_crisis() {
        let (mut sim, person) = fixture();
        for _ in 0..4 {
            super::tick(sim.world_mut());
        }
        assert_eq!(sim.deprivation_ticks(person.index_u32()), 4);
        assert!(sim.world().get_entity(person).is_ok());
        let mut needs = sim.world_mut().get_mut::<Needs>(person).unwrap();
        needs.set(NeedId::Hunger, 100.0);
        needs.set(NeedId::Energy, 0.0);
        super::tick(sim.world_mut());
        assert_eq!(sim.deprivation_ticks(person.index_u32()), 5);
        sim.world_mut()
            .resource_mut::<terri_core::save::SavedMortality>()
            .enabled = true;
        assert!(sim
            .death_warning(person.index_u32())
            .unwrap()
            .contains("energy is empty"));
        super::tick(sim.world_mut());
        assert!(sim.world().get_entity(person).is_err());
    }

    #[test]
    fn death_round_trip_keeps_identity_family_grief_and_render_removal() {
        let mut sim = Sim::new_from_shipped_lot();
        let mut pack = terri_data::pack().clone();
        pack.tuning.death_after_ticks = 1;
        let pack = Box::leak(Box::new(pack));
        sim.world_mut().insert_resource(Content(pack));
        let people: Vec<_> = sim
            .world_mut()
            .query_filtered::<(terri_core::Entity, &SimId), bevy_ecs::prelude::With<Agent>>()
            .iter(sim.world())
            .map(|(e, id)| (e, *id))
            .collect();
        let (dead, id) = people[0];
        let (survivor, other_id) = people[1];
        let mut family = terri_core::layout::FamilyTies::default();
        assert!(family.set(
            id.0,
            other_id.0,
            Some(terri_core::layout::Relation::Sibling)
        ));
        sim.world_mut().insert_resource(family.clone());
        sim.world_mut()
            .get_mut::<Needs>(dead)
            .unwrap()
            .set(NeedId::Hunger, 0.0);
        sim.world_mut()
            .resource_mut::<terri_core::save::SavedMortality>()
            .enabled = true;
        super::tick(sim.world_mut());
        sim.flush_commands();
        assert!(sim.mood_of(dead.index_u32()).is_none());
        let saved = sim.save_snapshot_v5();
        assert_eq!(saved.family, family);
        assert_eq!(saved.mortality.as_ref().unwrap().deaths.len(), 1);
        assert!(saved
            .world
            .entities
            .iter()
            .all(|e| e.index != dead.index_u32()));
        let mut restored = Sim::new_from_shipped_lot();
        restored.world_mut().insert_resource(Content(pack));
        restored.load_snapshot_v5(saved.clone()).unwrap();
        assert_eq!(restored.save_snapshot_v5(), saved);
        assert_eq!(restored.world_hash(), sim.world_hash());
        assert_eq!(
            restored.mood_of(survivor.index_u32()),
            sim.mood_of(survivor.index_u32())
        );
    }

    #[test]
    fn corrupt_mortality_is_rejected_without_replacing_the_world() {
        let mut sim = Sim::new_from_shipped_lot();
        let before = sim.save_snapshot_v5();
        let live = before
            .world
            .entities
            .iter()
            .find(|e| e.agent)
            .unwrap()
            .index;
        for counts in [
            vec![(live, 0)],
            vec![(u32::MAX, 1)],
            vec![(live, 1), (live, 2)],
            vec![(live + 1, 1), (live, 1)],
        ] {
            let mut saved = before.clone();
            saved.mortality = Some(terri_core::save::SavedMortality {
                enabled: false,
                counts,
                deaths: vec![],
            });
            assert!(sim.load_snapshot_v5(saved).is_err());
            assert_eq!(sim.save_snapshot_v5(), before);
        }
        for (id, name, tick) in [
            (u32::MAX, "Alex".to_string(), 0),
            (0, "Alex".to_string(), 0),
            (0, "".to_string(), 0),
            (0, "x".repeat(1025), 0),
            (0, "Alex".to_string(), 1),
        ] {
            let mut saved = before.clone();
            saved.mortality = Some(terri_core::save::SavedMortality {
                enabled: true,
                counts: vec![],
                deaths: vec![terri_core::save::DeathRecord {
                    sim_id: id,
                    name,
                    tick,
                    cause: terri_core::save::DeathCause::Deprivation,
                    issued_sim_ids: 2,
                }],
            });
            assert!(sim.load_snapshot_v5(saved).is_err());
            assert_eq!(sim.save_snapshot_v5(), before);
        }
    }

    #[test]
    fn a_dead_conversation_partner_does_not_cancel_a_new_object_action() {
        use terri_core::{Reserved, Socialising, Target};
        let (mut sim, person) = fixture();
        let dead = sim
            .world_mut()
            .spawn((Agent, Needs::all_at(100.0), Reserved))
            .id();
        let object = sim
            .world_mut()
            .spawn((
                terri_core::SmartObject(terri_core::ObjectDefId(0)),
                Reserved,
            ))
            .id();
        sim.world_mut().entity_mut(person).insert((
            Target {
                object,
                interaction: 0,
            },
            Socialising {
                partner: dead,
                interaction: 0,
                remaining_ticks: 4,
            },
        ));
        super::remove_person(sim.world_mut(), dead);
        assert_eq!(sim.world().get::<Target>(person).unwrap().object, object);
        assert!(sim.world().get::<Reserved>(object).is_some());
        assert!(sim.world().get::<Socialising>(person).is_none());
    }
    #[test]
    fn newcomers_do_not_grieve_a_person_who_died_before_they_existed() {
        let (mut sim, _) = fixture();
        sim.world_mut()
            .resource_mut::<terri_core::save::SavedMortality>()
            .enabled = true;
        for _ in 0..3 {
            super::tick(sim.world_mut());
        }
        let newcomer = sim
            .world_mut()
            .spawn((
                Agent,
                SimId(2),
                SimName("New".into()),
                Position { x: 0.0, y: 0.0 },
                Needs::all_at(100.0),
            ))
            .id();
        assert!(sim
            .mood_of(newcomer.index_u32())
            .unwrap()
            .moodlets
            .iter()
            .all(|m| !m.label.starts_with("Grieving")));
    }

    #[test]
    fn save_validation_isolates_each_death_record_guard() {
        let mut sim = Sim::new_from_shipped_lot();
        let mut people: Vec<_> = sim
            .world_mut()
            .query_filtered::<(terri_core::Entity, &SimId), bevy_ecs::prelude::With<Agent>>()
            .iter(sim.world())
            .map(|(e, id)| (e, *id))
            .collect();
        people.sort_by_key(|(e, _)| e.index_u32());
        let (dead, id) = people[0];
        let issued = sim
            .world()
            .resource::<terri_core::SimIdAllocator>()
            .issued();
        super::remove_person(sim.world_mut(), dead);
        sim.world_mut().resource_mut::<terri_core::SimClock>().tick = 10;
        sim.world_mut()
            .resource_mut::<terri_core::save::SavedMortality>()
            .deaths
            .push(terri_core::save::DeathRecord {
                sim_id: id.0,
                name: "Alex".into(),
                tick: 5,
                cause: terri_core::save::DeathCause::Deprivation,
                issued_sim_ids: issued,
            });
        let good = sim.save_snapshot_v5();
        sim.load_snapshot_v5(good.clone()).unwrap();
        for field in 0..8 {
            let mut bad = good.clone();
            let state = bad.mortality.as_mut().unwrap();
            let record = &mut state.deaths[0];
            match field {
                0 => record.issued_sim_ids = issued + 1,
                1 => record.issued_sim_ids = id.0,
                2 => record.tick = 11,
                3 => record.name.clear(),
                4 => record.name = "x".repeat(1025),
                5 => record.sim_id = people[1].1 .0,
                6 => {
                    let mut duplicate = record.clone();
                    duplicate.tick += 1;
                    state.deaths.push(duplicate);
                }
                _ => {
                    let mut earlier = record.clone();
                    earlier.tick -= 1;
                    state.deaths.push(earlier);
                }
            }
            assert!(
                sim.load_snapshot_v5(bad).is_err(),
                "accepted bad death field {field}"
            );
            assert_eq!(sim.save_snapshot_v5(), good);
        }
        let mut maximum = good;
        maximum.mortality.as_mut().unwrap().deaths[0].name = "x".repeat(1024);
        sim.load_snapshot_v5(maximum).unwrap();
    }

    #[test]
    fn count_rows_are_in_entity_order_not_archetype_order() {
        #[derive(bevy_ecs::prelude::Component)]
        struct Extra;
        let (mut sim, first) = fixture();
        let second = sim
            .world_mut()
            .spawn((
                Agent,
                SimId(1),
                SimName("Jo".into()),
                Position { x: 0.0, y: 0.0 },
                Needs::with(NeedId::Energy, 0.0),
            ))
            .id();
        sim.world_mut().entity_mut(first).insert(Extra);
        sim.world_mut().entity_mut(first).remove::<Extra>();
        let raw: Vec<_> = sim
            .world_mut()
            .query_filtered::<terri_core::Entity, bevy_ecs::prelude::With<Agent>>()
            .iter(sim.world())
            .collect();
        assert_eq!(raw, vec![second, first], "fixture must oppose entity order");
        super::tick(sim.world_mut());
        assert_eq!(
            sim.world()
                .resource::<terri_core::save::SavedMortality>()
                .counts,
            vec![(first.index_u32(), 1), (second.index_u32(), 1)]
        );
    }
    #[test]
    fn hash_observes_each_mortality_field() {
        let (mut sim, _) = fixture();
        let base = terri_core::save::SavedMortality {
            enabled: true,
            counts: vec![(0, 2)],
            deaths: vec![terri_core::save::DeathRecord {
                sim_id: 1,
                name: "Jo".into(),
                tick: 4,
                cause: terri_core::save::DeathCause::Deprivation,
                issued_sim_ids: 2,
            }],
        };
        sim.world_mut().insert_resource(base.clone());
        let expected = sim.world_hash();
        for field in 0..8 {
            let mut state = base.clone();
            match field {
                0 => state.enabled = false,
                1 => state.counts[0].0 = 1,
                2 => state.counts[0].1 = 3,
                3 => state.deaths[0].sim_id = 2,
                4 => state.deaths[0].tick = 5,
                5 => state.deaths[0].name = "Lee".into(),
                6 => state.deaths[0].issued_sim_ids = 3,
                _ => state.deaths.clear(),
            }
            sim.world_mut().insert_resource(state);
            assert_ne!(sim.world_hash(), expected, "hash ignores field {field}");
            sim.world_mut().insert_resource(base.clone());
            assert_eq!(sim.world_hash(), expected);
        }
    }
    #[test]
    fn affinity_at_death_controls_grief_strength_duration_and_absence() {
        let (mut sim, _) = fixture();
        sim.world_mut()
            .resource_mut::<terri_core::save::SavedMortality>()
            .deaths
            .push(terri_core::save::DeathRecord {
                sim_id: 0,
                name: "Alex".into(),
                tick: 0,
                cause: terri_core::save::DeathCause::Deprivation,
                issued_sim_ids: 2,
            });
        let survivor = sim
            .world_mut()
            .spawn((
                Agent,
                SimId(1),
                SimName("Jo".into()),
                Position { x: 0.0, y: 0.0 },
                Needs::all_at(100.0),
            ))
            .id();
        for (affinity, initial, lasts) in [
            (-1.0, None, 0),
            (-0.5, None, 0),
            (-0.25, Some(-2.5), 2),
            (0.0, Some(-5.0), 2),
            (0.5, Some(-17.5), 6),
            (1.0, Some(-30.0), 10),
        ] {
            let mut feelings = terri_core::Relationships::default();
            feelings.bump(SimId(0), affinity);
            sim.world_mut().entity_mut(survivor).insert(feelings);
            sim.world_mut().resource_mut::<terri_core::SimClock>().tick = 0;
            let grief = |sim: &Sim| {
                sim.mood_of(survivor.index_u32())
                    .unwrap()
                    .moodlets
                    .into_iter()
                    .find(|m| m.label == "Grieving Alex")
                    .map(|m| m.score)
            };
            assert_eq!(grief(&sim), initial, "affinity {affinity}");
            if lasts > 0 {
                sim.world_mut().resource_mut::<terri_core::SimClock>().tick = lasts - 1;
                assert!(grief(&sim).unwrap() < 0.0);
                sim.world_mut().resource_mut::<terri_core::SimClock>().tick = lasts;
                assert_eq!(grief(&sim), None, "expired affinity {affinity}");
            }
        }
    }
    #[test]
    fn removing_a_redirected_conversation_initiator_releases_both_reservations() {
        let (mut sim, person) = fixture();
        let partner = sim.world_mut().spawn((Agent, terri_core::Reserved)).id();
        let object = sim.world_mut().spawn(terri_core::Reserved).id();
        sim.world_mut().entity_mut(person).insert((
            terri_core::Target {
                object,
                interaction: 0,
            },
            terri_core::Socialising {
                partner,
                remaining_ticks: 3,
                interaction: 0,
            },
        ));
        super::remove_person(sim.world_mut(), person);
        assert!(sim.world().get::<terri_core::Reserved>(object).is_none());
        assert!(sim.world().get::<terri_core::Reserved>(partner).is_none());
    }
    #[test]
    fn death_record_order_is_validated_independently_of_identity() {
        let mut sim = Sim::new_from_shipped_lot();
        let people: Vec<_> = sim
            .world_mut()
            .query::<(terri_core::Entity, &SimId)>()
            .iter(sim.world())
            .map(|(e, id)| (e, *id))
            .collect();
        assert!(people.len() >= 2);
        let issued = sim
            .world()
            .resource::<terri_core::SimIdAllocator>()
            .issued();
        sim.world_mut().resource_mut::<terri_core::SimClock>().tick = 10;
        let mut records = Vec::new();
        for (e, id) in people.into_iter().take(2) {
            super::remove_person(sim.world_mut(), e);
            records.push(terri_core::save::DeathRecord {
                sim_id: id.0,
                name: "Past member".into(),
                tick: 9,
                cause: terri_core::save::DeathCause::Deprivation,
                issued_sim_ids: issued,
            });
        }
        records.sort_by_key(|r| r.sim_id);
        let mut good = sim.save_snapshot_v5();
        good.mortality = Some(terri_core::save::SavedMortality {
            enabled: false,
            counts: vec![],
            deaths: records,
        });
        sim.load_snapshot_v5(good.clone()).unwrap();
        let mut bad = good.clone();
        bad.mortality.as_mut().unwrap().deaths.reverse();
        assert!(sim.load_snapshot_v5(bad).is_err());
        let mut bad = good.clone();
        bad.mortality.as_mut().unwrap().deaths[0].tick = 10;
        assert!(sim.load_snapshot_v5(bad).is_err());
        assert_eq!(sim.save_snapshot_v5(), good);
    }
    #[test]
    fn recovery_on_the_threshold_tick_prevents_death_in_the_full_schedule() {
        let (mut sim, person) = fixture();
        let object = sim
            .world_mut()
            .spawn((
                terri_core::SmartObject(terri_core::ObjectDefId(0)),
                terri_core::Reserved,
            ))
            .id();
        sim.world_mut().entity_mut(person).insert((
            terri_core::Target {
                object,
                interaction: 0,
            },
            terri_core::Eating {
                object: terri_core::ObjectDefId(0),
                interaction: 0,
                remaining_ticks: 5,
            },
        ));
        sim.world_mut()
            .insert_resource(terri_core::save::SavedMortality {
                enabled: true,
                counts: vec![(person.index_u32(), 2)],
                deaths: vec![],
            });
        sim.tick();
        assert!(
            sim.world()
                .get::<Needs>(person)
                .unwrap()
                .get(NeedId::Hunger)
                > 0.0
        );
        assert_eq!(sim.deprivation_ticks(person.index_u32()), 0);
        assert!(sim.death_records().is_empty());
    }

    #[test]
    fn simultaneous_death_records_use_identity_order_even_when_entities_disagree() {
        let (mut sim, first) = fixture();
        sim.world_mut().entity_mut(first).insert(SimId(1));
        let second = sim
            .world_mut()
            .spawn((
                Agent,
                SimId(0),
                SimName("Jo".into()),
                Needs::with(NeedId::Energy, 0.0),
            ))
            .id();
        sim.world_mut()
            .insert_resource(terri_core::save::SavedMortality {
                enabled: true,
                counts: vec![(first.index_u32(), 2), (second.index_u32(), 2)],
                deaths: vec![],
            });
        super::tick(sim.world_mut());
        assert_eq!(
            sim.death_records()
                .iter()
                .map(|d| d.sim_id)
                .collect::<Vec<_>>(),
            vec![0, 1]
        );
    }
}
