//! The needs an unavailable item would satisfy. Decisions publish this once
//! per tick; mood reads current need levels rather than storing a penalty.

use bevy_ecs::prelude::*;
use terri_core::{Agent, NeedId, Needs};

#[derive(Component, Clone, Copy, Debug)]
pub(crate) struct WaitingNeeds(pub u8, pub Entity);

pub(crate) fn advertised_needs(object: Entity, advertises: &[(u8, f32)]) -> WaitingNeeds {
    WaitingNeeds(
        advertises
            .iter()
            .filter(|(_, delta)| *delta > 0.0)
            .fold(0, |bits, (need, _)| bits | (1 << need)),
        object,
    )
}

pub(crate) fn effective_needs(
    object: Entity,
    advertisements: &[(u8, f32)],
    social_available: bool,
) -> WaitingNeeds {
    let effective: Vec<_> = advertisements
        .iter()
        .copied()
        .filter(|&(n, d)| crate::social_company::effective_delta(n, d, social_available))
        .collect();
    advertised_needs(object, &effective)
}

pub(crate) fn clear(world: &mut World) {
    let people: Vec<_> = world
        .query_filtered::<Entity, With<WaitingNeeds>>()
        .iter(world)
        .collect();
    for person in people {
        world.entity_mut(person).remove::<WaitingNeeds>();
    }
}

pub(crate) fn penalty(world: &World, person: Entity, needs: &Needs) -> Option<f32> {
    let waiting = world.get::<WaitingNeeds>(person)?;
    world.get::<terri_core::Reserved>(waiting.1)?;
    world.get::<terri_core::SmartObject>(waiting.1)?;
    let entity = world.entity(person);
    if entity.contains::<terri_core::Target>()
        || entity.contains::<terri_core::Path>()
        || entity.contains::<terri_core::Eating>()
        || entity.contains::<terri_core::Socialising>()
        || entity.contains::<terri_core::StepWork>()
        || entity.contains::<terri_core::AtWork>()
        || entity.contains::<terri_core::Commuting>()
        || entity.contains::<terri_core::Restless>()
        || entity.contains::<terri_core::Reserved>()
    {
        return None;
    }
    let urgency = NeedId::ALL
        .into_iter()
        .filter(|need| waiting.0 & (1 << need.index()) != 0)
        .map(|need| needs.deficit(need))
        .fold(0.0_f32, f32::max);
    let tuning = world.resource::<crate::Content>().0.tuning;
    Some(
        tuning.waiting_mood_min_penalty
            + (tuning.waiting_mood_max_penalty - tuning.waiting_mood_min_penalty) * urgency,
    )
}

pub(crate) fn snapshot(world: &World) -> Vec<(u32, u32, u8)> {
    let mut rows: Vec<_> =
        world
            .try_query::<(Entity, &WaitingNeeds)>()
            .map_or_else(Vec::new, |mut q| {
                q.iter(world)
                    .filter(|(_, w)| world.get::<terri_core::SmartObject>(w.1).is_some())
                    .map(|(e, w)| (e.index_u32(), w.1.index_u32(), w.0))
                    .collect()
            });
    rows.sort_unstable_by_key(|row| row.0);
    rows
}

pub(crate) fn restore(
    world: &mut World,
    rows: Vec<(u32, u32, u8)>,
) -> Result<(), crate::SaveError> {
    if rows.windows(2).any(|p| p[0].0 >= p[1].0) {
        return Err(crate::SaveError::InvalidValue);
    }
    for (index, object, bits) in rows {
        let person = bevy_ecs::entity::EntityIndex::from_raw_u32(index)
            .map(|index| world.entities().resolve_from_index(index))
            .filter(|e| world.get::<Agent>(*e).is_some() && world.get::<Needs>(*e).is_some());
        let Some(person) = person else {
            return Err(crate::SaveError::InvalidValue);
        };
        if u32::from(bits) >= (1 << terri_core::NEED_COUNT) {
            return Err(crate::SaveError::InvalidValue);
        }
        let object = bevy_ecs::entity::EntityIndex::from_raw_u32(object)
            .map(|index| world.entities().resolve_from_index(index))
            .filter(|e| world.get::<terri_core::SmartObject>(*e).is_some());
        let Some(object) = object else {
            return Err(crate::SaveError::InvalidValue);
        };
        world.entity_mut(person).insert(WaitingNeeds(bits, object));
    }
    Ok(())
}

pub(crate) fn hash(world: &World, hasher: &mut terri_core::FnvHasher) {
    let rows = snapshot(world);
    if !rows.is_empty() {
        hasher.write_bytes(b"waiting-needs-v1");
        hasher.write_u64(rows.len() as u64);
        for (index, object, bits) in rows {
            hasher.write_u64(index.into());
            hasher.write_u64(object.into());
            hasher.write_u64(bits.into());
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::Sim;
    use terri_core::{Position, Satisfaction};

    #[test]
    fn autonomous_waiting_uses_the_best_activity_and_first_tied_row() {
        use crate::test_content as tc;
        for (second_delta, expected) in [(40.0, NeedId::Hunger), (80.0, NeedId::Energy)] {
            let pack = tc::pack(vec![tc::object_offering(
                "item",
                vec![
                    tc::interaction("first", &[(NeedId::Hunger, 40.0)], 10),
                    tc::interaction("second", &[(NeedId::Energy, second_delta)], 10),
                ],
            )]);
            let mut sim = tc::sim_with(8, 8, pack);
            let person = sim
                .world_mut()
                .spawn((Agent, Position { x: 1.0, y: 1.0 }, Needs::all_at(0.0)))
                .id();
            let item = sim
                .world_mut()
                .spawn((
                    Position { x: 2.0, y: 1.0 },
                    terri_core::SmartObject(terri_core::ObjectDefId(0)),
                    terri_core::Reserved,
                ))
                .id();
            sim.tick();
            let waiting = sim.world().get::<WaitingNeeds>(person).unwrap();
            assert_eq!(waiting.0, 1 << expected.index());
            assert_eq!(waiting.1, item);
        }
    }

    #[test]
    fn an_available_equally_good_activity_remains_selectable_beside_waiting() {
        use crate::test_content as tc;
        let pack = tc::pack_tuned(
            vec![tc::object("item", &[(NeedId::Hunger, 40.0)], 10)],
            terri_data::Tuning {
                action_threshold: 100.0,
                idle_threshold: 0.001,
                contested_score_multiplier: 1.0,
                ..tc::tuning()
            },
        );
        let mut sim = tc::sim_with(8, 8, pack);
        let person = sim
            .world_mut()
            .spawn((Agent, Position { x: 1.0, y: 1.0 }, Needs::all_at(0.0)))
            .id();
        sim.world_mut().spawn((
            Position { x: 2.0, y: 1.0 },
            terri_core::SmartObject(terri_core::ObjectDefId(0)),
            terri_core::Reserved,
        ));
        sim.tick();
        assert!(sim.world().get::<WaitingNeeds>(person).is_some());
        let available = sim
            .world_mut()
            .spawn((
                Position { x: 2.0, y: 1.0 },
                terri_core::SmartObject(terri_core::ObjectDefId(0)),
            ))
            .id();
        sim.tick();
        let decisions = sim
            .world()
            .resource::<crate::systems::autonomy::DecisionTelemetry>();
        let decision = decisions
            .0
            .iter()
            .find(|row| row.agent == person.index_u32())
            .unwrap();
        assert!(decision
            .choices
            .iter()
            .any(|row| row.0 == available.index_u32() && row.4 > 0.0));
        if sim
            .world()
            .get::<terri_core::Target>(person)
            .is_some_and(|target| target.object == available)
        {
            assert!(sim.world().get::<WaitingNeeds>(person).is_none());
        }
    }

    #[test]
    fn waiting_for_a_person_does_not_claim_to_be_waiting_for_an_item() {
        let mut friendship = terri_core::Relationships::default();
        friendship.bump(terri_core::SimId(99), 0.5);
        use crate::test_content as tc;
        let pack = tc::pack_with_social(
            vec![tc::object("item", &[(NeedId::Hunger, 40.0)], 10)],
            vec![tc::interaction("talk", &[(NeedId::Social, 100.0)], 1)],
            tc::tuning(),
        );
        let mut sim = tc::sim_with(8, 8, pack);
        let person = sim
            .world_mut()
            .spawn((
                Agent,
                Position { x: 1.0, y: 1.0 },
                Needs::all_at(0.0),
                friendship,
            ))
            .id();
        sim.world_mut().spawn((
            Position { x: 2.0, y: 1.0 },
            terri_core::SmartObject(terri_core::ObjectDefId(0)),
            terri_core::Reserved,
        ));
        sim.tick();
        assert!(sim.world().get::<WaitingNeeds>(person).is_some());
        sim.world_mut().spawn((
            Agent,
            terri_core::SimId(99),
            Position { x: 2.0, y: 1.0 },
            Needs::all_at(100.0),
            terri_core::Reserved,
        ));
        sim.tick();
        assert!(sim.world().get::<WaitingNeeds>(person).is_none());
    }

    #[test]
    fn waiting_restore_requires_both_a_person_and_their_needs() {
        let mut sim = Sim::new();
        let item = sim
            .world_mut()
            .spawn(terri_core::SmartObject(terri_core::ObjectDefId(0)))
            .id();
        let not_a_person = sim.world_mut().spawn(Needs::all_at(50.0)).id();
        let no_needs = sim.world_mut().spawn(Agent).id();
        for person in [not_a_person, no_needs] {
            assert!(restore(
                sim.world_mut(),
                vec![(person.index_u32(), item.index_u32(), 1)]
            )
            .is_err());
        }
    }

    #[test]
    fn waiting_rows_are_saved_in_entity_order_not_archetype_order() {
        let mut sim = Sim::new();
        let item = sim
            .world_mut()
            .spawn(terri_core::SmartObject(terri_core::ObjectDefId(0)))
            .id();
        let people: Vec<_> = (0..3)
            .map(|_| {
                sim.world_mut()
                    .spawn((Agent, Needs::all_at(50.0), WaitingNeeds(1, item)))
                    .id()
            })
            .collect();
        sim.world_mut()
            .entity_mut(people[0])
            .insert(terri_core::Restless);
        sim.world_mut()
            .entity_mut(people[0])
            .remove::<terri_core::Restless>();
        let raw: Vec<_> = sim
            .world_mut()
            .query::<(Entity, &WaitingNeeds)>()
            .iter(sim.world())
            .map(|(e, _)| e.index_u32())
            .collect();
        assert!(
            raw.windows(2).any(|p| p[0] > p[1]),
            "fixture must disrupt query order"
        );
        assert_eq!(
            snapshot(sim.world()),
            people
                .iter()
                .map(|p| (p.index_u32(), item.index_u32(), 1))
                .collect::<Vec<_>>()
        );
    }

    #[test]
    fn freed_or_removed_items_stop_waiting_without_a_tick() {
        let mut sim = Sim::new_from_shipped_lot();
        let person = sim
            .world_mut()
            .query_filtered::<Entity, With<Agent>>()
            .iter(sim.world())
            .next()
            .unwrap();
        let item = sim
            .world_mut()
            .query_filtered::<Entity, With<terri_core::SmartObject>>()
            .iter(sim.world())
            .next()
            .unwrap();
        sim.world_mut()
            .entity_mut(item)
            .insert(terri_core::Reserved);
        sim.world_mut()
            .entity_mut(person)
            .insert(WaitingNeeds(1, item));
        let needs = Needs::all_at(50.0);
        assert!(penalty(sim.world(), person, &needs).is_some());
        sim.world_mut()
            .entity_mut(item)
            .remove::<terri_core::Reserved>();
        assert_eq!(penalty(sim.world(), person, &needs), None);
        sim.world_mut()
            .entity_mut(item)
            .insert(terri_core::Reserved);
        sim.world_mut()
            .entity_mut(item)
            .remove::<terri_core::SmartObject>();
        assert_eq!(penalty(sim.world(), person, &needs), None);
        assert!(
            snapshot(sim.world()).is_empty(),
            "a removed item must not leave an unloadable waiting reference"
        );
    }

    #[test]
    fn waiting_save_and_hash_preserve_person_item_and_need_bits() {
        let mut sim = Sim::new_from_shipped_lot();
        let people: Vec<_> = sim
            .world_mut()
            .query_filtered::<Entity, With<Agent>>()
            .iter(sim.world())
            .collect();
        let items: Vec<_> = sim
            .world_mut()
            .query_filtered::<Entity, With<terri_core::SmartObject>>()
            .iter(sim.world())
            .collect();
        let before = sim.world_hash();
        sim.world_mut()
            .entity_mut(people[0])
            .insert(WaitingNeeds(1, items[0]));
        let waiting = sim.world_hash();
        assert_ne!(before, waiting);
        sim.world_mut()
            .get_mut::<WaitingNeeds>(people[0])
            .unwrap()
            .0 = 2;
        assert_ne!(waiting, sim.world_hash());
        sim.world_mut()
            .get_mut::<WaitingNeeds>(people[0])
            .unwrap()
            .0 = 1;
        sim.world_mut()
            .get_mut::<WaitingNeeds>(people[0])
            .unwrap()
            .1 = items[1];
        assert_ne!(waiting, sim.world_hash());
        sim.world_mut()
            .get_mut::<WaitingNeeds>(people[0])
            .unwrap()
            .1 = items[0];
        assert_eq!(waiting, sim.world_hash());
        let saved = sim.save_snapshot_v5();
        let mut loaded = Sim::new();
        loaded.load_snapshot_v5(saved.clone()).unwrap();
        assert_eq!(loaded.world_hash(), waiting);
        assert_eq!(
            loaded.mood_of(people[0].index_u32()),
            sim.mood_of(people[0].index_u32())
        );
        for rows in [
            vec![(u32::MAX, items[0].index_u32(), 1)],
            vec![(items[0].index_u32(), items[1].index_u32(), 1)],
            vec![(people[0].index_u32(), u32::MAX, 1)],
            vec![(people[0].index_u32(), people[1].index_u32(), 1)],
            vec![(people[0].index_u32(), items[0].index_u32(), 128)],
            vec![(people[0].index_u32(), items[0].index_u32(), 1); 2],
            vec![
                (people[1].index_u32(), items[0].index_u32(), 1),
                (people[0].index_u32(), items[0].index_u32(), 1),
            ],
        ] {
            let mut bad = saved.clone();
            bad.waiting_needs = rows;
            assert!(loaded.load_snapshot_v5(bad).is_err());
            assert_eq!(loaded.world_hash(), waiting);
        }
    }

    #[test]
    fn only_positive_advertisements_raise_waiting_urgency() {
        let mut sim = Sim::new();
        let object = sim.world_mut().spawn_empty().id();
        let mask = advertised_needs(object, &[(0, -10.0), (1, 0.0), (2, 4.0), (5, 8.0)]);
        assert_eq!(mask.0, (1 << 2) | (1 << 5));
        assert_eq!(mask.1, object);
    }

    #[test]
    fn paused_cancel_clears_order_and_chain_waiting_but_keeps_autonomy() {
        for source in 0..5 {
            let mut sim = Sim::new_with_lot(8, 8);
            let item = sim
                .world_mut()
                .spawn((
                    terri_core::SmartObject(terri_core::ObjectDefId(0)),
                    terri_core::Reserved,
                ))
                .id();
            let person = sim
                .world_mut()
                .spawn((
                    Agent,
                    Position { x: 1.0, y: 1.0 },
                    Needs::all_at(50.0),
                    WaitingNeeds(1, item),
                ))
                .id();
            if source == 0 {
                sim.world_mut()
                    .entity_mut(person)
                    .insert(terri_core::IntentQueue::from_intents(vec![
                        terri_core::Intent {
                            cleanup: None,
                            chore: None,
                            object: item,
                            interaction: 0,
                        },
                    ]));
            }
            if source == 1 {
                sim.world_mut()
                    .entity_mut(person)
                    .insert(terri_core::ChainState::begin(0));
            }
            if source >= 3 {
                sim.world_mut()
                    .resource_mut::<terri_core::CommandQueue>()
                    .push(terri_core::SimCommand::UseObject {
                        agent: person.index_u32(),
                        object: item.index_u32(),
                        interaction: 0,
                    });
                if source == 4 {
                    sim.flush_commands();
                }
            }
            sim.world_mut()
                .resource_mut::<terri_core::CommandQueue>()
                .push(terri_core::SimCommand::CancelIntents {
                    agent: person.index_u32(),
                });
            sim.flush_commands();
            assert_eq!(
                sim.world().get::<WaitingNeeds>(person).is_some(),
                source == 2,
                "source {source}"
            );
        }
    }

    #[test]
    fn every_active_state_excludes_a_waiting_penalty() {
        for state in 0..9 {
            let mut sim = Sim::new();
            let item = sim
                .world_mut()
                .spawn((
                    terri_core::SmartObject(terri_core::ObjectDefId(0)),
                    terri_core::Reserved,
                ))
                .id();
            let person = sim
                .world_mut()
                .spawn((Agent, Needs::all_at(50.0), WaitingNeeds(1, item)))
                .id();
            let needs = Needs::all_at(50.0);
            assert_eq!(penalty(sim.world(), person, &needs), Some(16.0));
            let mut e = sim.world_mut().entity_mut(person);
            match state {
                0 => {
                    e.insert(terri_core::Target {
                        object: item,
                        interaction: 0,
                    });
                }
                1 => {
                    e.insert(terri_core::Path {
                        steps: vec![(1, 1)],
                        cursor: 0,
                    });
                }
                2 => {
                    e.insert(terri_core::Eating {
                        object: terri_core::ObjectDefId(0),
                        interaction: 0,
                        remaining_ticks: 1,
                    });
                }
                3 => {
                    e.insert(terri_core::Socialising {
                        partner: item,
                        interaction: 0,
                        remaining_ticks: 1,
                    });
                }
                4 => {
                    e.insert(terri_core::StepWork { remaining_ticks: 1 });
                }
                5 => {
                    e.insert(terri_core::AtWork { remaining_ticks: 1 });
                }
                6 => {
                    e.insert(terri_core::Commuting::Outbound);
                }
                7 => {
                    e.insert(terri_core::Restless);
                }
                _ => {
                    e.insert(terri_core::Reserved);
                }
            }
            assert_eq!(
                penalty(sim.world(), person, &needs),
                None,
                "active state {state}"
            );
        }
    }

    #[test]
    fn waiting_penalty_follows_the_relevant_need_and_stops_with_action() {
        let mut sim = Sim::new();
        let item = sim
            .world_mut()
            .spawn((
                terri_core::SmartObject(terri_core::ObjectDefId(0)),
                terri_core::Reserved,
            ))
            .id();
        let person = sim
            .world_mut()
            .spawn((
                Agent,
                Position { x: 1.0, y: 1.0 },
                Needs::all_at(100.0),
                WaitingNeeds(1 << NeedId::Hunger.index(), item),
            ))
            .id();
        let score = |sim: &Sim| {
            sim.mood_of(person.index_u32())
                .unwrap()
                .moodlets
                .into_iter()
                .find(|m| m.label == "Waiting for an item")
                .map(|m| m.score)
        };
        assert_eq!(score(&sim), Some(-2.0));
        sim.world_mut()
            .get_mut::<Needs>(person)
            .unwrap()
            .set(NeedId::Energy, 0.0);
        assert_eq!(
            score(&sim),
            Some(-2.0),
            "an unrelated need must not amplify waiting"
        );
        sim.world_mut()
            .get_mut::<Needs>(person)
            .unwrap()
            .set(NeedId::Hunger, 50.0);
        assert_eq!(score(&sim), Some(-16.0));
        sim.world_mut()
            .get_mut::<Needs>(person)
            .unwrap()
            .set(NeedId::Hunger, 0.0);
        assert_eq!(score(&sim), Some(-30.0));
        sim.world_mut()
            .entity_mut(person)
            .insert(terri_core::Target {
                object: person,
                interaction: 0,
            });
        assert_eq!(score(&sim), None);
    }

    #[test]
    fn waiting_reduces_satisfaction_through_mood_above_neglect_floor() {
        let mut sim = Sim::new();
        let mut ledger = Satisfaction::from_value(0.0);
        ledger.add(10.0);
        let item = sim
            .world_mut()
            .spawn((
                terri_core::SmartObject(terri_core::ObjectDefId(0)),
                terri_core::Reserved,
            ))
            .id();
        let person = sim
            .world_mut()
            .spawn((
                Agent,
                Position { x: 1.0, y: 1.0 },
                Needs::all_at(45.0),
                ledger,
                WaitingNeeds(1 << NeedId::Hunger.index(), item),
            ))
            .id();
        crate::mood::accrue_satisfaction(sim.world_mut());
        assert!(sim.world().get::<Satisfaction>(person).unwrap().value() < 10.0);
        sim.world_mut().entity_mut(person).remove::<WaitingNeeds>();
        let before = sim.world().get::<Satisfaction>(person).unwrap().value();
        crate::mood::accrue_satisfaction(sim.world_mut());
        assert_eq!(
            sim.world().get::<Satisfaction>(person).unwrap().value(),
            before
        );
    }
}
