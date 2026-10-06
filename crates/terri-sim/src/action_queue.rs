//! Action labels are projected from the same targets and intents the simulation serves.
use crate::{Content, Sim};
use bevy_ecs::prelude::*;
use terri_core::{
    Agent, AtWork, Commuting, Eating, Intent, IntentQueue, Path, SimName, SmartObject, Socialising,
    Target,
};

impl Sim {
    /// Current action, then waiting orders. An empty first entry means no current action.
    /// Remove only the served occurrence: repeated orders remain separate cards.
    pub fn action_queue_of(&self, index: u32) -> Vec<String> {
        self.action_queue_window_of(index, usize::MAX)
    }

    /// Format only the requested display prefix, leaving stored orders untouched.
    pub fn action_queue_window_of(&self, index: u32, max_rows: usize) -> Vec<String> {
        if max_rows == 0 {
            return vec![];
        }
        let Some(mut people) = self.world.try_query_filtered::<Entity, With<Agent>>() else {
            return vec![];
        };
        let Some(person) = people.iter(&self.world).find(|e| e.index_u32() == index) else {
            return vec![];
        };
        let Some(content) = self.world.get_resource::<Content>() else {
            return vec![];
        };
        let pack = content.0;
        let label = |intent: Intent| -> Option<String> {
            if let Some(object) = self.world.get::<SmartObject>(intent.object) {
                let definition = pack.objects.get(object.0 .0 as usize)?;
                let row = intent.interaction as usize;
                let action = if row < definition.interactions.len() {
                    &definition.interactions[row].label
                } else {
                    let chain = pack
                        .chains
                        .iter()
                        .filter(|chain| !crate::domestic::hidden_chain(&chain.id))
                        .filter(|chain| chain.advertised_by == object.0)
                        .nth(row - definition.interactions.len())?;
                    if chain.id == "cook_dinner" {
                        crate::domestic::meal_label(
                            self.world.resource::<terri_core::SimClock>().tick,
                            pack.tuning.day_ticks,
                        )
                    } else {
                        &chain.label
                    }
                };
                Some(format!("{}: {}", action, definition.display_name()))
            } else if self.world.get::<Agent>(intent.object).is_some() {
                let interaction = pack.social.get(intent.interaction as usize)?;
                let name = self.world.get::<SimName>(intent.object)?;
                Some(format!("{}: {}", interaction.label, name.0))
            } else {
                None
            }
        };
        let target = self.world.get::<Target>(person).map(|t| Intent {
            object: t.object,
            interaction: t.interaction,
        });
        let social = self.world.get::<Socialising>(person);
        let partner_action =
            self.world
                .try_query::<(Entity, &Socialising)>()
                .and_then(|mut talks| {
                    talks
                        .iter(&self.world)
                        .find(|(_, s)| s.partner == person)
                        .map(|(initiator, s)| Intent {
                            object: initiator,
                            interaction: s.interaction,
                        })
                });
        let served = if partner_action.is_some() {
            None
        } else {
            social
                .map(|s| Intent {
                    object: s.partner,
                    interaction: s.interaction,
                })
                .or(target)
        };
        // A running chain's own order stays queued until the chain ends,
        // and the current row already describes that chain, so the order
        // is the served one while the sim is carrying the chain out: at a
        // station, walking to one, or idle between steps. An ordinary
        // action, a conversation started or received, a commute or a
        // shift has interrupted the chain - then the chain is waiting and
        // its order is listed.
        let carrying_out_chain = social.is_none()
            && partner_action.is_none()
            && self.world.get::<AtWork>(person).is_none()
            && self.world.get::<Commuting>(person).is_none()
            && target.is_none_or(|intent| intent.interaction == crate::systems::chain::CHAIN_STEP);
        let served = if carrying_out_chain {
            self.world
                .get::<terri_core::ChainState>(person)
                .and_then(|state| {
                    self.world
                        .get::<IntentQueue>(person)?
                        .as_slice()
                        .iter()
                        .copied()
                        .find(|order| {
                            self.world
                                .get::<SmartObject>(order.object)
                                .and_then(|placed| {
                                    crate::systems::chain::ordered_chain(
                                        pack,
                                        placed.0,
                                        order.interaction,
                                    )
                                })
                                == Some(state.chain)
                        })
                })
        } else {
            served
        };
        let current = if self.world.get::<AtWork>(person).is_some() {
            Some("At work".to_string())
        } else if let Some(intent) = social
            .map(|s| Intent {
                object: s.partner,
                interaction: s.interaction,
            })
            .or(partner_action)
        {
            label(intent)
        } else if let Some(intent) = target {
            if intent.interaction == crate::systems::chain::CHAIN_STEP {
                self.chain_status_of(index)
            } else {
                label(intent)
            }
        } else if let Some(eating) = self.world.get::<Eating>(person) {
            pack.objects
                .get(eating.object.0 as usize)
                .and_then(|o| o.interactions.get(eating.interaction as usize))
                .map(|i| i.label.clone())
        } else if self.world.get::<Commuting>(person).is_some() {
            Some("Going to work".to_string())
        } else if self.world.get::<terri_core::StepWork>(person).is_some() {
            self.chain_status_of(index)
        } else if self.world.get::<Path>(person).is_some() {
            Some("Walking".to_string())
        } else {
            self.chain_status_of(index)
        };
        let mut result = vec![current.unwrap_or_default()];
        let mut removed = false;
        if let Some(queue) = self.world.get::<IntentQueue>(person) {
            for &intent in queue.as_slice() {
                if result.len() >= max_rows {
                    break;
                }
                if !removed && Some(intent) == served {
                    removed = true;
                    continue;
                }
                result.push(label(intent).unwrap_or_else(|| "Unavailable action".to_string()));
            }
        }
        result
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_content;
    use terri_core::{NeedId, ObjectDefId};

    #[test]
    fn current_order_is_shown_once_without_losing_repeats_or_reordering_waiters() {
        let object = test_content::object_with_two_interactions(
            "fixture",
            (NeedId::Fun, 20.0, 30),
            (NeedId::Comfort, 10.0, 40),
        );
        let mut sim = test_content::sim_with(8, 8, test_content::pack(vec![object]));
        let object = sim.world_mut().spawn(SmartObject(ObjectDefId(0))).id();
        let first = Intent {
            object,
            interaction: 0,
        };
        let second = Intent {
            object,
            interaction: 1,
        };
        let person = sim
            .world_mut()
            .spawn((
                Agent,
                Target {
                    object,
                    interaction: 0,
                },
                IntentQueue::from_intents(vec![second, first, first]),
            ))
            .id();
        assert_eq!(
            sim.action_queue_of(person.index_u32()),
            ["first: fixture", "second: fixture", "first: fixture"]
        );
        for limit in 0..=4 {
            let full = ["first: fixture", "second: fixture", "first: fixture"];
            assert_eq!(
                sim.action_queue_window_of(person.index_u32(), limit),
                full[..limit.min(full.len())]
            );
        }
        sim.world_mut().entity_mut(person).remove::<Target>();
        assert_eq!(
            sim.action_queue_of(person.index_u32()),
            ["", "second: fixture", "first: fixture", "first: fixture"]
        );
        assert!(sim.action_queue_of(object.index_u32()).is_empty());
        assert!(sim.action_queue_of(u32::MAX).is_empty());
        sim.world_mut().despawn(object);
        assert_eq!(
            sim.action_queue_of(person.index_u32()),
            [
                "",
                "Unavailable action",
                "Unavailable action",
                "Unavailable action"
            ]
        );
    }

    #[test]
    fn both_conversation_participants_see_the_current_action() {
        let mut sim = Sim::new_from_shipped_lot();
        let people: Vec<Entity> = sim
            .world_mut()
            .query_filtered::<Entity, With<Agent>>()
            .iter(sim.world())
            .collect();
        let a = people[0];
        let b = people[1];
        sim.world_mut().entity_mut(a).insert(Socialising {
            partner: b,
            interaction: 0,
            remaining_ticks: 10,
        });
        // A conversation owns the partner even if another order is waiting.
        sim.world_mut().entity_mut(b).insert((
            Target {
                object: a,
                interaction: 0,
            },
            IntentQueue::from_intents(vec![Intent {
                object: a,
                interaction: 0,
            }]),
        ));
        assert_eq!(sim.action_queue_of(b.index_u32()).len(), 2);
        let a_name = sim.world().get::<SimName>(a).unwrap().0.clone();
        let b_name = sim.world().get::<SimName>(b).unwrap().0.clone();
        assert!(sim.action_queue_of(a.index_u32())[0].ends_with(&b_name));
        assert!(sim.action_queue_of(b.index_u32())[0].ends_with(&a_name));
    }

    #[test]
    fn queued_recipes_use_the_same_rows_as_the_action_menu() {
        let mut sim = Sim::new_from_shipped_lot();
        let pack = terri_data::pack();
        let fridge = sim
            .world_mut()
            .query::<(Entity, &SmartObject)>()
            .iter(sim.world())
            .find(|(_, object)| pack.objects[object.0 .0 as usize].id == "fridge")
            .unwrap()
            .0;
        let person = sim
            .world_mut()
            .query_filtered::<Entity, With<Agent>>()
            .iter(sim.world())
            .next()
            .unwrap();
        let row = sim
            .interaction_labels(fridge.index_u32())
            .unwrap()
            .iter()
            .position(|label| *label == "Cook breakfast")
            .unwrap() as u32;
        sim.world_mut()
            .entity_mut(person)
            .insert(IntentQueue::from_intents(vec![
                Intent {
                    object: fridge,
                    interaction: row,
                },
                Intent {
                    object: fridge,
                    interaction: 0,
                },
                Intent {
                    object: fridge,
                    interaction: u32::MAX - 1,
                },
            ]));
        let before = sim.save_snapshot_v5();
        let labels = sim.action_queue_of(person.index_u32());
        assert!(labels[1].starts_with("Cook breakfast: "));
        assert!(labels[2].starts_with("Grab a snack: "));
        assert_eq!(labels[3], "Unavailable action");
        assert_eq!(sim.save_snapshot_v5(), before);
    }

    #[test]
    fn a_suspended_recipe_does_not_hide_the_active_target_or_commute() {
        let mut sim = Sim::new_from_shipped_lot();
        let pack = terri_data::pack();
        let recipe = pack
            .chains
            .iter()
            .position(|chain| chain.id == "cook_dinner")
            .unwrap();
        let bookcase = sim
            .world_mut()
            .query::<(Entity, &SmartObject)>()
            .iter(sim.world())
            .find(|(_, object)| pack.objects[object.0 .0 as usize].id == "bookshelf")
            .unwrap()
            .0;
        let person = sim
            .world_mut()
            .query_filtered::<Entity, With<Agent>>()
            .iter(sim.world())
            .next()
            .unwrap();
        sim.world_mut().entity_mut(person).insert((
            terri_core::ChainState::begin(recipe as u32),
            Target {
                object: bookcase,
                interaction: 0,
            },
        ));
        assert!(sim.action_queue_of(person.index_u32())[0].starts_with("Read a book: "));
        sim.world_mut()
            .entity_mut(person)
            .remove::<Target>()
            .insert(Commuting::Outbound);
        assert_eq!(sim.action_queue_of(person.index_u32())[0], "Going to work");
        sim.world_mut()
            .entity_mut(person)
            .remove::<Commuting>()
            .insert(Target {
                object: bookcase,
                interaction: crate::systems::chain::CHAIN_STEP,
            });
        assert!(sim.action_queue_of(person.index_u32())[0].starts_with("Cook breakfast - step: "));
    }

    /// A running recipe's own order stays queued until the recipe ends,
    /// and the current row already describes the recipe, so that order
    /// is not listed again - while an ordinary action interrupting the
    /// recipe puts the whole waiting recipe back in the list.
    #[test]
    fn a_running_recipes_own_order_is_listed_once() {
        let mut sim = Sim::new_from_shipped_lot();
        let pack = terri_data::pack();
        let snack = pack
            .chains
            .iter()
            .position(|chain| chain.id == crate::domestic::SNACK)
            .unwrap() as u32;
        let find = |sim: &mut Sim, id: &str| {
            sim.world_mut()
                .query::<(Entity, &SmartObject)>()
                .iter(sim.world())
                .find(|(_, object)| pack.objects[object.0 .0 as usize].id == id)
                .unwrap()
                .0
        };
        let fridge = find(&mut sim, "fridge");
        let bookcase = find(&mut sim, "bookshelf");
        let person = sim
            .world_mut()
            .query_filtered::<Entity, With<Agent>>()
            .iter(sim.world())
            .next()
            .unwrap();
        let row = sim
            .interaction_labels(fridge.index_u32())
            .unwrap()
            .iter()
            .position(|label| *label == "Grab a snack")
            .unwrap() as u32;
        let order = Intent {
            object: fridge,
            interaction: row,
        };
        sim.world_mut().entity_mut(person).insert((
            terri_core::ChainState::begin(snack),
            IntentQueue::from_intents(vec![order, order]),
        ));
        let labels = sim.action_queue_of(person.index_u32());
        assert_eq!(
            labels.len(),
            2,
            "the running snack once, the waiting snack once"
        );
        assert!(labels[1].starts_with("Grab a snack: "));

        sim.world_mut().entity_mut(person).insert(Target {
            object: bookcase,
            interaction: 0,
        });
        let labels = sim.action_queue_of(person.index_u32());
        assert_eq!(
            labels.len(),
            3,
            "the interrupted snack waits with its order"
        );
        assert!(labels[0].starts_with("Read a book: "));
        assert!(labels[1].starts_with("Grab a snack: "));
        assert!(labels[2].starts_with("Grab a snack: "));

        // Talked to by somebody else: the chain waits for the talk to
        // end, so its order is listed just as during the read.
        sim.world_mut().entity_mut(person).remove::<Target>();
        let other = sim
            .world_mut()
            .query_filtered::<Entity, With<Agent>>()
            .iter(sim.world())
            .find(|candidate| *candidate != person)
            .unwrap();
        sim.world_mut().entity_mut(other).insert(Socialising {
            partner: person,
            interaction: 0,
            remaining_ticks: 10,
        });
        let labels = sim.action_queue_of(person.index_u32());
        assert_eq!(labels.len(), 3, "a received talk interrupts the snack too");
        assert!(labels[1].starts_with("Grab a snack: "));
        assert!(labels[2].starts_with("Grab a snack: "));

        // Called to work: the chain waits for the return, so its order
        // is listed beneath the commute.
        sim.world_mut().entity_mut(other).remove::<Socialising>();
        sim.world_mut()
            .entity_mut(person)
            .insert(Commuting::Outbound);
        let labels = sim.action_queue_of(person.index_u32());
        assert_eq!(labels.len(), 3, "a commute interrupts the snack too");
        assert_eq!(labels[0], "Going to work");
        assert!(labels[1].starts_with("Grab a snack: "));
        assert!(labels[2].starts_with("Grab a snack: "));

        sim.world_mut()
            .entity_mut(person)
            .remove::<Commuting>()
            .insert(AtWork { remaining_ticks: 1 });
        let labels = sim.action_queue_of(person.index_u32());
        assert_eq!(labels.len(), 3, "a shift interrupts the snack too");
        assert_eq!(labels[0], "At work");
        assert!(labels[1].starts_with("Grab a snack: "));
    }
}
