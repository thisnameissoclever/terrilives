//! Read-only personal factors and recent activity repetition for the Sim sheet.

use bevy_ecs::prelude::*;
use terri_core::{Agent, Habituation, ObjectDefId, Personality, NEED_COUNT};
use terri_data::{CompiledChain, CompiledInteraction, ContentPack};

use crate::{Content, Sim};

#[derive(Debug, Clone, PartialEq)]
pub struct RepeatedActivity {
    pub object: u32,
    pub interaction: u32,
    pub object_label: &'static str,
    pub activity_label: &'static str,
    /// Recent repetition in 0..=1, shared by objects of the same definition.
    /// Habituation above 1 is overdoing ([OD-model]), which this meter does
    /// not show, so it reads 1.
    pub repetition: f32,
}

#[derive(Debug, Clone, PartialEq)]
pub struct SimDetails {
    pub drain: [f32; NEED_COUNT],
    pub refill: [f32; NEED_COUNT],
    pub sleep_offset_ticks: i32,
    pub repeated: Vec<RepeatedActivity>,
}

impl Sim {
    /// Personal factors are not effective rates: work, sleep and traits can
    /// modify outcomes too. Activity repetition changes appeal, not refill.
    pub fn details_of(&self, index: u32) -> Option<SimDetails> {
        let world = self.world();
        let (_, _, personality, repetition) = world
            .try_query::<(Entity, &Agent, &Personality, Option<&Habituation>)>()?
            .iter(world)
            .find(|(entity, ..)| entity.index_u32() == index)?;
        let pack = world.resource::<Content>().0;
        let repeated = repetition
            .into_iter()
            .flat_map(Habituation::entries)
            .filter(|(_, _, value)| *value > 0.0)
            .filter_map(|&(object, interaction, repetition)| {
                let (object_label, activity_label) = activity_labels(pack, object, interaction)?;
                Some(RepeatedActivity {
                    object: object.0,
                    interaction,
                    object_label,
                    activity_label,
                    repetition: repetition.min(1.0),
                })
            })
            .collect();
        Some(SimDetails {
            drain: personality.drain,
            refill: personality.satisfaction,
            sleep_offset_ticks: personality.chronotype_offset_ticks,
            repeated,
        })
    }
}

/// What one flyout row of an object definition names: one of the object's
/// own interactions, or, for a row past them, one of the chains the object
/// advertises, counted in pack order. Habituation keys address activities
/// by flyout row, a fourth index space ([L65] in `docs/lessons-learned.md`),
/// so the Sim details rows and the overdoing moodlets resolve a row here and
/// cannot disagree about what it is called or what it is good for.
#[derive(Debug, Clone, Copy)]
pub(crate) enum FlyoutRow<'a> {
    Interaction(&'a CompiledInteraction),
    Chain(&'a CompiledChain),
}

impl<'a> FlyoutRow<'a> {
    /// The row's label, as the flyout and the Sim details show it.
    pub(crate) fn label(self) -> &'a str {
        match self {
            FlyoutRow::Interaction(interaction) => interaction.label.as_str(),
            FlyoutRow::Chain(chain) => chain.label.as_str(),
        }
    }

    /// The (need index, delta) pairs the row advertises.
    pub(crate) fn advertises(self) -> &'a [(u8, f32)] {
        match self {
            FlyoutRow::Interaction(interaction) => &interaction.advertises,
            FlyoutRow::Chain(chain) => &chain.advertises,
        }
    }
}

/// Resolves `row` of `object`, or `None` when the definition or the row
/// does not exist in `pack`.
pub(crate) fn flyout_row(
    pack: &ContentPack,
    object: ObjectDefId,
    row: u32,
) -> Option<FlyoutRow<'_>> {
    let definition = pack.objects.get(object.0 as usize)?;
    if let Some(interaction) = definition.interactions.get(row as usize) {
        return Some(FlyoutRow::Interaction(interaction));
    }
    let chain_slot = (row as usize).checked_sub(definition.interactions.len())?;
    pack.chains
        .iter()
        .filter(|chain| chain.advertised_by == object)
        .nth(chain_slot)
        .map(FlyoutRow::Chain)
}

/// The (object label, activity label) the Sim details show for one
/// habituation row, or `None` when the row does not resolve.
pub(crate) fn activity_labels(
    pack: &ContentPack,
    object: ObjectDefId,
    row: u32,
) -> Option<(&str, &str)> {
    let definition = pack.objects.get(object.0 as usize)?;
    Some((
        definition.display_name(),
        flyout_row(pack, object, row)?.label(),
    ))
}

#[cfg(test)]
mod tests {
    use super::*;
    use terri_core::ObjectDefId;

    #[test]
    fn details_preserve_asymmetric_effects_and_saved_sleep_offset_without_writes() {
        let mut sim = Sim::new_from_shipped_lot();
        let entity = sim
            .world_mut()
            .query_filtered::<Entity, With<Agent>>()
            .iter(sim.world())
            .next()
            .unwrap();
        let mut personality = Personality::neutral();
        personality.drain = [0.5, 0.6, 0.7, 0.8, 0.9, 1.1, 1.2];
        personality.satisfaction = [1.3, 1.4, 1.5, 1.6, 1.7, 1.8, 1.9];
        personality.chronotype_offset_ticks = -137;
        sim.world_mut()
            .entity_mut(entity)
            .insert(personality.clone());
        let before = sim.save_snapshot_v5();
        let details = sim.details_of(entity.index_u32()).unwrap();
        assert_eq!(details.drain, personality.drain);
        assert_eq!(details.refill, personality.satisfaction);
        assert_eq!(details.sleep_offset_ticks, -137);
        assert!(details.repeated.is_empty());
        assert_eq!(sim.save_snapshot_v5(), before);
        sim.world_mut()
            .get_mut::<Personality>(entity)
            .unwrap()
            .chronotype_offset_ticks = 0;
        assert_eq!(
            sim.details_of(entity.index_u32())
                .unwrap()
                .sleep_offset_ticks,
            0
        );
        sim.world_mut()
            .get_mut::<Personality>(entity)
            .unwrap()
            .chronotype_offset_ticks = 181;
        assert_eq!(
            sim.details_of(entity.index_u32())
                .unwrap()
                .sleep_offset_ticks,
            181
        );
    }

    #[test]
    fn repeated_rows_include_chains_and_unplaced_definitions_in_key_order() {
        let mut sim = Sim::new_from_shipped_lot();
        let entity = sim
            .world_mut()
            .query_filtered::<Entity, With<Agent>>()
            .iter(sim.world())
            .next()
            .unwrap();
        let mut pack = sim.world().resource::<Content>().0.clone();
        let object = pack.chains[0].advertised_by.0 as usize;
        let expected_chain_label = pack.chains[0].label.clone();
        let mut unrelated = pack.chains[0].clone();
        unrelated.advertised_by = ObjectDefId(((object + 1) % pack.objects.len()) as u32);
        unrelated.label = "Unrelated chain".into();
        pack.chains.insert(0, unrelated);
        let pack = Box::leak(Box::new(pack));
        sim.world_mut().insert_resource(Content(pack));
        let definition = &pack.objects[object];
        let chain_row = definition.interactions.len() as u32;
        let mut habits = Habituation::default();
        let cap = pack.tuning.habituation_max;
        habits.bump(ObjectDefId(object as u32), chain_row, 0.62, cap);
        habits.bump(ObjectDefId(object as u32), 0, 0.34, cap);
        sim.world_mut().entity_mut(entity).insert(habits);
        // Reading history needs a definition, not a surviving placed instance.
        let placed = sim
            .world_mut()
            .query::<(Entity, &terri_core::SmartObject)>()
            .iter(sim.world())
            .filter_map(|(entity, placed)| (placed.0 .0 == object as u32).then_some(entity))
            .collect::<Vec<_>>();
        for placed in placed {
            sim.world_mut().despawn(placed);
        }
        let rows = sim.details_of(entity.index_u32()).unwrap().repeated;
        assert_eq!(rows.len(), 2);
        assert_eq!(
            (rows[0].object, rows[0].interaction, rows[0].repetition),
            (object as u32, 0, 0.34)
        );
        assert_eq!(rows[0].activity_label, definition.interactions[0].label);
        assert_eq!(rows[0].object_label, definition.display_name());
        assert_eq!(
            (rows[1].object, rows[1].interaction, rows[1].repetition),
            (object as u32, chain_row, 0.62)
        );
        assert_eq!(rows[1].activity_label, expected_chain_label);
    }

    #[test]
    fn absent_personality_nonpeople_and_retired_indices_have_no_details() {
        let mut sim = Sim::new_from_shipped_lot();
        let impostor = sim.world_mut().spawn(Personality::neutral()).id();
        let bare = sim.world_mut().spawn(Agent).id();
        assert_eq!(sim.details_of(impostor.index_u32()), None);
        assert_eq!(sim.details_of(bare.index_u32()), None);
        let person = sim.world_mut().spawn((Agent, Personality::neutral())).id();
        assert!(sim
            .details_of(person.index_u32())
            .unwrap()
            .repeated
            .is_empty());
        sim.world_mut().despawn(person);
        assert_eq!(sim.details_of(person.index_u32()), None);
        assert_eq!(sim.details_of(u32::MAX), None);
    }

    #[test]
    fn zero_repetition_and_missing_content_rows_are_omitted_without_hiding_valid_history() {
        let mut sim = Sim::new_from_shipped_lot();
        let cap = sim.world().resource::<Content>().0.tuning.habituation_max;
        let mut habits = Habituation::default();
        habits.bump(ObjectDefId(2), 0, 0.0, cap);
        habits.bump(ObjectDefId(3), 0, 0.25, cap);
        habits.bump(ObjectDefId(3), u32::MAX, 0.5, cap);
        habits.bump(ObjectDefId(u32::MAX), 0, 0.5, cap);
        let person = sim
            .world_mut()
            .spawn((Agent, Personality::neutral(), habits))
            .id();
        let rows = sim.details_of(person.index_u32()).unwrap().repeated;
        assert_eq!(rows.len(), 1);
        assert_eq!(
            (rows[0].object, rows[0].interaction, rows[0].repetition),
            (3, 0, 0.25)
        );
    }

    /// [OD-model]: the repetition meter reads at most 100%. Habituation
    /// above 1 is overdoing, which the meter does not show.
    #[test]
    fn repetition_above_one_reports_a_full_meter() {
        let mut sim = Sim::new_from_shipped_lot();
        let cap = sim.world().resource::<Content>().0.tuning.habituation_max;
        assert!(cap >= 2.0, "the fixture needs room for 2.0");
        let mut habits = Habituation::default();
        habits.bump(ObjectDefId(3), 0, 2.0, cap);
        assert_eq!(habits.get(ObjectDefId(3), 0), 2.0);
        let person = sim
            .world_mut()
            .spawn((Agent, Personality::neutral(), habits))
            .id();
        let rows = sim.details_of(person.index_u32()).unwrap().repeated;
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].repetition, 1.0);
    }
}
