//! A read-only mood projection derived from the world the save already owns.
//!
//! Mood has no stored component. The HUD and the once-per-tick satisfaction
//! contribution share the same projection of needs, conditions, relationships,
//! grief and occupied-item waiting. Only the satisfaction ledger accumulates.

use bevy_ecs::prelude::*;
use terri_core::{
    Agent, Habituation, NeedId, Needs, ObjectDefId, Position, Relationships, SimId, SimName,
    SmartObject, Traits,
};
use terri_data::{CompiledTraitKind, ContentPack, Tuning};

use crate::{Content, Sim};

/// One active reason the derived overall mood moved.
#[derive(Debug, Clone, PartialEq)]
pub struct Moodlet {
    pub label: String,
    pub score: f32,
}

/// One sim's current derived mood and its ordered causes.
#[derive(Debug, Clone, PartialEq)]
pub struct MoodSnapshot {
    pub overall_score: f32,
    pub overall_label: &'static str,
    pub moodlets: Vec<Moodlet>,
}

impl Sim {
    /// Derives the current mood of one live sim without changing the world.
    ///
    /// A raw entity index is all the boundary owns. Requiring `Agent`,
    /// `Needs` and `Position` makes this return `None` for furniture, stale
    /// indices and incomplete non-sim fixtures. Traits and relationships are
    /// optional because their absence is neutral.
    pub fn mood_of(&self, index: u32) -> Option<MoodSnapshot> {
        derive_mood(&self.world, index)
    }
}

/// Board decisions hold the chore resource outside the world while updating it.
/// Borrow that current state so their mood includes the same causes as the HUD.
pub(crate) fn score(
    world: &World,
    index: u32,
    chores: &terri_core::chores::SavedChores,
) -> Option<f32> {
    derive_mood_with_chores(world, index, Some(chores)).map(|m| m.overall_score)
}

fn derive_mood(world: &World, index: u32) -> Option<MoodSnapshot> {
    derive_mood_with_chores(
        world,
        index,
        world.get_resource::<terri_core::chores::SavedChores>(),
    )
}

fn derive_mood_with_chores(
    world: &World,
    index: u32,
    chores: Option<&terri_core::chores::SavedChores>,
) -> Option<MoodSnapshot> {
    let pack = world.get_resource::<Content>()?.0;
    let mut subject_query = world.try_query_filtered::<(
        Entity,
        &Needs,
        &Position,
        Option<&Traits>,
        Option<&Relationships>,
        Option<&Habituation>,
    ), With<Agent>>()?;
    let (subject, needs, position, traits, relationships, habituation) = subject_query
        .iter(world)
        .find(|(entity, ..)| entity.index_u32() == index)?;

    let mut moodlets = Vec::new();
    if let Some(chores) = chores {
        moodlets.extend(crate::chores::moodlets_in(world, subject, chores));
    }
    for need in NeedId::ALL {
        let level = needs.get(need);
        let (low_label, critical_label) = need_labels(need);
        if level <= pack.tuning.mood_critical_need_level {
            moodlets.push(Moodlet {
                label: critical_label.to_string(),
                score: -pack.tuning.mood_critical_need_penalty,
            });
        } else if level <= pack.tuning.mood_low_need_level {
            moodlets.push(Moodlet {
                label: low_label.to_string(),
                score: -pack.tuning.mood_low_need_penalty,
            });
        }
    }

    if NeedId::ALL
        .into_iter()
        .all(|need| needs.get(need) >= pack.tuning.mood_needs_met_level)
    {
        moodlets.push(Moodlet {
            label: "Needs met".to_string(),
            score: pack.tuning.mood_needs_met_bonus,
        });
    }

    if let Some(traits) = traits {
        for &(trait_index, severity) in traits.entries() {
            if severity.partial_cmp(&pack.tuning.mood_condition_min_severity)
                != Some(std::cmp::Ordering::Greater)
            {
                continue;
            }
            let Some(definition) = pack.traits.get(trait_index as usize) else {
                continue;
            };
            if matches!(&definition.kind, CompiledTraitKind::Condition { .. }) {
                moodlets.push(Moodlet {
                    label: definition.label.clone(),
                    score: -pack.tuning.mood_condition_penalty * severity,
                });
            }
        }
    }

    let mut nearby = Vec::new();
    if let Some(relationships) = relationships {
        let mut people_query =
            world.try_query_filtered::<(Entity, &SimId, &SimName, &Position), With<Agent>>()?;
        for (other, sim_id, name, other_position) in people_query.iter(world) {
            if other == subject {
                continue;
            }
            let feeling = relationships.feeling(*sim_id);
            if !feeling.is_finite() || feeling.abs() < pack.tuning.mood_relationship_min_affinity {
                continue;
            }
            let dx = other_position.x - position.x;
            let dy = other_position.y - position.y;
            let distance = (dx * dx + dy * dy).sqrt();
            if !distance.is_finite() || distance >= pack.tuning.mood_relationship_radius {
                continue;
            }
            nearby.push((
                sim_id.0,
                other.index_u32(),
                name.0.as_str(),
                feeling,
                distance,
            ));
        }
    }
    // SimId is the contract. Entity index is only a deterministic tie
    // breaker for an invalid world containing duplicate stable ids.
    nearby.sort_unstable_by_key(|(sim_id, entity_index, ..)| (*sim_id, *entity_index));
    for (_, _, name, feeling, distance) in nearby {
        moodlets.push(Moodlet {
            label: if feeling.is_sign_positive() {
                format!("Comforted by {name}")
            } else {
                format!("Uneasy around {name}")
            },
            score: pack.tuning.mood_relationship_strength
                * feeling
                * (1.0 - distance / pack.tuning.mood_relationship_radius),
        });
    }

    if world.get::<SimId>(subject).is_some() && has_bed_shortage(world) {
        moodlets.push(Moodlet {
            label: "Not enough beds".to_string(),
            score: -20.0,
        });
    }

    let now = world.resource::<terri_core::SimClock>().tick;
    let subject_id = world.get::<SimId>(subject);
    for death in world
        .resource::<terri_core::save::SavedMortality>()
        .deaths
        .as_slice()
    {
        if subject_id.is_none_or(|id| id.0 >= death.issued_sim_ids) {
            continue;
        }
        let feeling = relationships.map_or(0.0, |r| r.feeling(SimId(death.sim_id)));
        if feeling <= pack.tuning.grief_hated_affinity {
            continue;
        }
        let closeness = feeling.max(0.0);
        let duration = (f64::from(pack.tuning.grief_min_ticks)
            + f64::from(pack.tuning.grief_ticks - pack.tuning.grief_min_ticks)
                * f64::from(closeness))
        .round() as u64;
        let elapsed = now.saturating_sub(death.tick);
        if elapsed >= duration {
            continue;
        }
        let strength = if feeling < 0.0 {
            pack.tuning.grief_min_score * (1.0 - feeling / pack.tuning.grief_hated_affinity)
        } else {
            pack.tuning.grief_min_score
                + (pack.tuning.grief_max_score - pack.tuning.grief_min_score) * closeness
        };
        moodlets.push(Moodlet {
            label: format!("Grieving {}", death.name),
            score: -strength * (1.0 - elapsed as f32 / duration as f32),
        });
    }

    if let Some(penalty) = crate::waiting::penalty(world, subject, needs) {
        moodlets.push(Moodlet {
            label: "Waiting for an item".into(),
            score: -penalty,
        });
    }

    if let Some(penalty) = crate::domestic::mood_penalty(world, subject) {
        moodlets.push(Moodlet {
            label: "Dirty dishes".into(),
            score: -penalty,
        });
    }
    moodlets.extend(overdoing_moodlets(pack, habituation));
    moodlets.extend(crate::affinity::presence_moodlets(world, pack, subject));
    moodlets.extend(crate::affinity::use_moodlets(world, pack, subject));
    let overall_score = moodlets
        .iter()
        .map(|moodlet| moodlet.score)
        .sum::<f32>()
        .clamp(-100.0, 100.0);
    Some(MoodSnapshot {
        overall_score,
        overall_label: overall_label(overall_score),
        moodlets,
    })
}

/// The fixed label of the food-repetition moodlet, [OD-moodlets] in
/// `docs/specs/2026-10-06-overdoing-it.md`.
const FEELING_SICK: &str = "Feeling sick";

/// The mood one habituation value costs, [OD-moodlets] item 1: zero at
/// `overdoing_threshold`, the whole `overdoing_penalty` at
/// `habituation_max`, and linear between. A function rather than inline
/// arithmetic so golden values can pin it ([L55]). It does not gate:
/// `overdoing_moodlets` adds the moodlet only for a value strictly above
/// the threshold.
pub(crate) fn overdoing_score(value: f32, tuning: &Tuning) -> f32 {
    -tuning.overdoing_penalty * (value - tuning.overdoing_threshold)
        / (tuning.habituation_max - tuning.overdoing_threshold)
}

/// The moodlets repetition costs, [OD-moodlets]: one `Overdoing {activity}`
/// for every habituation entry above `overdoing_threshold`, in the entries'
/// (object, row) order, then at most one `Feeling sick` when any food row
/// is at or above `sick_threshold`. Derived from habituation alone, which
/// is already saved, so nothing new is stored; decay is the timer that
/// clears both. A row the content cannot resolve has no label and is
/// skipped, as the Sim details skip it.
fn overdoing_moodlets(pack: &ContentPack, habituation: Option<&Habituation>) -> Vec<Moodlet> {
    let tuning = &pack.tuning;
    let mut moodlets = Vec::new();
    let mut sick = false;
    for &(object, row, value) in habituation.into_iter().flat_map(Habituation::entries) {
        let Some((_, activity)) = crate::details::activity_labels(pack, object, row) else {
            continue;
        };
        if value > tuning.overdoing_threshold {
            moodlets.push(Moodlet {
                label: format!("Overdoing {activity}"),
                score: overdoing_score(value, tuning),
            });
        }
        if value >= tuning.sick_threshold && is_food(pack, object, row) {
            sick = true;
        }
    }
    if sick {
        moodlets.push(Moodlet {
            label: FEELING_SICK.to_string(),
            score: -tuning.sick_penalty,
        });
    }
    moodlets
}

/// Whether a habituation row is food: the interaction or chain it names
/// advertises a positive Hunger delta. A row that does not resolve is not.
pub(crate) fn is_food(pack: &ContentPack, object: ObjectDefId, row: u32) -> bool {
    crate::details::flyout_row(pack, object, row).is_some_and(|row| {
        row.advertises()
            .iter()
            .any(|&(need, delta)| usize::from(need) == NeedId::Hunger.index() && delta > 0.0)
    })
}

/// Integrates current mood once per simulation tick. A neutral band prevents
/// small fluctuations from accumulating; the ledger preserves sustained effects.
pub(crate) fn accrue_satisfaction(world: &mut World) {
    let tuning = world.resource::<Content>().0.tuning;
    let people: Vec<_> = world
        .query_filtered::<Entity, (With<Agent>, With<terri_core::Satisfaction>)>()
        .iter(world)
        .collect();
    let changes: Vec<_> = people
        .into_iter()
        .filter_map(|person| {
            let mood = derive_mood(world, person.index_u32())?;
            let delta = satisfaction_change(mood.overall_score, &tuning);
            Some((person, delta))
        })
        .collect();
    for (person, delta) in changes {
        world
            .get_mut::<terri_core::Satisfaction>(person)
            .unwrap()
            .add(delta);
    }
}

fn satisfaction_change(score: f32, tuning: &terri_data::Tuning) -> f32 {
    let excess = (score.abs() - tuning.satisfaction_mood_neutral_band).max(0.0);
    score.signum() * excess / (100.0 - tuning.satisfaction_mood_neutral_band)
        * tuning.satisfaction_mood_per_tick
}

/// Count usable sleep places, including occupied beds and people away at work.
fn has_bed_shortage(world: &World) -> bool {
    let pack = world.resource::<Content>().0;
    if pack.sleep_tag.is_empty() {
        return false;
    }
    let people = world
        .try_query_filtered::<&SimId, With<Agent>>()
        .map_or(0, |mut q| q.iter(world).count());
    let beds: usize = world.try_query::<&SmartObject>().map_or(0, |mut q| {
        q.iter(world)
            .map(|object| {
                pack.objects
                    .get(object.0 .0 as usize)
                    .map_or(0, |definition| {
                        usize::from(crate::beds::capacity(pack, definition))
                    })
            })
            .sum()
    });
    people > beds
}

fn need_labels(need: NeedId) -> (&'static str, &'static str) {
    match need {
        NeedId::Hunger => ("Hungry", "Starving"),
        NeedId::Energy => ("Tired", "Exhausted"),
        NeedId::Hygiene => ("Needs a wash", "Very dirty"),
        NeedId::Bladder => ("Needs the toilet", "Desperate for the toilet"),
        NeedId::Social => ("Lonely", "Very lonely"),
        NeedId::Fun => ("Bored", "Very bored"),
        NeedId::Comfort => ("Uncomfortable", "Very uncomfortable"),
    }
}

fn overall_label(score: f32) -> &'static str {
    if score <= -50.0 {
        "Miserable"
    } else if score <= -15.0 {
        "Low"
    } else if score < 15.0 {
        "Okay"
    } else if score < 50.0 {
        "Good"
    } else {
        "Great"
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_content;
    use terri_core::{SmartObject, NEED_MAX};
    use terri_data::{CompiledTrait, ContentPack};

    /// A condition's label is projected as a moodlet, in the same list as
    /// the need moodlets. A trait called "Lonely" would put two rows reading
    /// "Lonely" in one person's Mood panel, with different scores and no way
    /// to tell them apart. Every trait is checked and not only conditions,
    /// because the Traits panel and the Mood panel sit in the same sheet.
    #[test]
    fn no_trait_label_repeats_a_need_moodlet() {
        let mut taken: Vec<&str> = vec!["Needs met", FEELING_SICK];
        for need in NeedId::ALL {
            let (low, critical) = need_labels(need);
            taken.extend([low, critical]);
        }
        assert_eq!(
            taken.len(),
            16,
            "seven needs, two labels each, the all-clear and feeling sick"
        );
        for trait_def in &terri_data::pack().traits {
            assert!(
                !taken
                    .iter()
                    .any(|label| label.eq_ignore_ascii_case(trait_def.label.trim())),
                "trait '{}' is labelled '{}', which the Mood panel already uses for a need",
                trait_def.id,
                trait_def.label
            );
        }
    }

    #[test]
    fn mood_contribution_has_a_neutral_band_and_a_signed_linear_rate() {
        let tuning = terri_data::Tuning {
            satisfaction_mood_per_tick: 0.025,
            ..test_content::tuning()
        };
        for score in [-15.0, -10.0, 0.0, 10.0, 15.0] {
            assert_eq!(satisfaction_change(score, &tuning), 0.0);
        }
        for (score, expected) in [
            (-100.0, -0.025),
            (-57.5, -0.0125),
            (57.5, 0.0125),
            (100.0, 0.025),
        ] {
            assert_eq!(satisfaction_change(score, &tuning), expected);
        }
    }

    #[test]
    fn mood_reads_and_paused_commands_do_not_accrue_satisfaction() {
        let mut sim = Sim::new_from_shipped_lot();
        let before = sim.world_hash();
        let people: Vec<_> = sim
            .world_mut()
            .query_filtered::<Entity, With<Agent>>()
            .iter(sim.world())
            .collect();
        for _ in 0..20 {
            for person in &people {
                assert!(sim.mood_of(person.index_u32()).is_some());
            }
            sim.flush_commands();
        }
        assert_eq!(sim.world_hash(), before);
    }

    #[test]
    fn the_full_tick_applies_mood_after_death_and_never_to_the_dead() {
        let mut sim = Sim::new_with_lot(8, 8);
        let bed = terri_data::pack()
            .objects
            .iter()
            .position(|object| object.id == "double_bed")
            .unwrap();
        sim.world_mut()
            .spawn(SmartObject(terri_core::ObjectDefId(bed as u32)));
        let victim = sim
            .world_mut()
            .spawn((
                Agent,
                SimId(0),
                SimName("Alex".into()),
                Position { x: 1.0, y: 1.0 },
                Needs::all_at(100.0),
            ))
            .id();
        sim.world_mut()
            .get_mut::<Needs>(victim)
            .unwrap()
            .set(NeedId::Hunger, 0.0);
        let mut ledger = terri_core::Satisfaction::from_value(0.0);
        ledger.add(50.0);
        let mut feelings = Relationships::default();
        feelings.bump(SimId(0), 1.0);
        let survivor = sim
            .world_mut()
            .spawn((
                Agent,
                SimId(1),
                SimName("Jo".into()),
                Position { x: 2.0, y: 1.0 },
                Needs::all_at(100.0),
                ledger,
                feelings,
            ))
            .id();
        sim.world_mut()
            .insert_resource(terri_core::SimIdAllocator::resumed(2));
        let threshold = sim.world().resource::<Content>().0.tuning.death_after_ticks;
        sim.world_mut()
            .resource_mut::<terri_core::save::SavedMortality>()
            .counts = vec![(victim.index_u32(), threshold - 1)];
        sim.tick();
        assert!(sim.world().get_entity(victim).is_err());
        assert!(sim
            .mood_of(survivor.index_u32())
            .unwrap()
            .moodlets
            .iter()
            .any(|m| m.label == "Grieving Alex"));
        assert_eq!(
            sim.world()
                .get::<terri_core::Satisfaction>(survivor)
                .unwrap()
                .value(),
            50.0
        );
        // Without grief this same comfortable survivor gains satisfaction.
        sim.world_mut()
            .resource_mut::<terri_core::save::SavedMortality>()
            .deaths
            .clear();
        sim.tick();
        assert!(
            sim.world()
                .get::<terri_core::Satisfaction>(survivor)
                .unwrap()
                .value()
                > 50.0
        );
    }

    #[test]
    fn sustained_mood_changes_satisfaction_in_both_directions() {
        let mut sim = Sim::new();
        let happy = subject(&mut sim, Needs::all_at(100.0));
        let sad = subject(&mut sim, Needs::all_at(25.0));
        let neutral = subject(&mut sim, Needs::all_at(55.0));
        for person in [happy, sad, neutral] {
            let mut ledger = terri_core::Satisfaction::from_value(0.0);
            ledger.add(50.0);
            sim.world_mut().entity_mut(person).insert(ledger);
        }
        // Fixed needs isolate mood from neglect, decay, work and hobbies.
        super::accrue_satisfaction(sim.world_mut());
        let read = |sim: &Sim, person| {
            sim.world()
                .get::<terri_core::Satisfaction>(person)
                .unwrap()
                .value()
        };
        let first_happy = read(&sim, happy);
        let first_sad = read(&sim, sad);
        assert!(first_happy > 50.0 && first_happy < 50.01);
        assert!(first_sad < 50.0 && first_sad > 49.99);
        for _ in 1..1440 {
            super::accrue_satisfaction(sim.world_mut());
        }
        assert!(read(&sim, happy) > first_happy + 0.03);
        assert!(read(&sim, sad) < first_sad - 0.1);
        assert_eq!(read(&sim, neutral), 50.0);
    }

    #[test]
    fn shipped_rates_move_extreme_mood_over_months_and_ordinary_mood_over_years() {
        let tuning = &terri_data::pack().tuning;
        for score in [-100.0, 100.0] {
            let mut ledger = terri_core::Satisfaction::default();
            let change = super::satisfaction_change(score, tuning);
            for _ in 0..30 * 1440 {
                ledger.add(change);
            }
            assert!((ledger.value() - 50.0).abs() > 16.0);
            assert!((ledger.value() - 50.0).abs() < 18.0);
            for _ in 30 * 1440..100 * 1440 {
                ledger.add(change);
            }
            assert_eq!(ledger.value(), if score > 0.0 { 100.0 } else { 0.0 });
        }
        let mut ordinary = terri_core::Satisfaction::default();
        for _ in 0..365 * 1440 {
            ordinary.add(super::satisfaction_change(20.0, tuning));
        }
        assert!((60.0..64.0).contains(&ordinary.value()));
        let mut at_ceiling = terri_core::Satisfaction::from_value(100.0);
        at_ceiling.add(-tuning.neglect_bleed_per_tick);
        assert!(
            at_ceiling.value() < 100.0,
            "neglect must survive f32 rounding at the ceiling"
        );
    }

    fn subject(sim: &mut Sim, needs: Needs) -> Entity {
        sim.world_mut()
            .spawn((Agent, Position { x: 1.0, y: 1.0 }, needs))
            .id()
    }

    fn mood(sim: &Sim, entity: Entity) -> MoodSnapshot {
        sim.mood_of(entity.index_u32())
            .expect("the fixture entity is a live sim")
    }

    #[test]
    fn bed_shortage_counts_sleep_slots_and_clears_when_capacity_returns() {
        let mut sim = Sim::new_from_shipped_lot();
        let people: Vec<Entity> = sim
            .world_mut()
            .query_filtered::<Entity, With<Agent>>()
            .iter(sim.world())
            .collect();
        let beds: Vec<Entity> = sim
            .world_mut()
            .query::<(Entity, &SmartObject)>()
            .iter(sim.world())
            .filter(|(_, o)| {
                terri_data::pack()
                    .object(o.0)
                    .interactions
                    .iter()
                    .any(|i| i.tags.contains(&terri_data::pack().sleep_tag))
            })
            .map(|(e, _)| e)
            .collect();
        for bed in beds {
            sim.world_mut().despawn(bed);
        }
        for person in &people {
            let mood = sim.mood_of(person.index_u32()).unwrap();
            assert!(mood
                .moodlets
                .iter()
                .any(|m| m.label == "Not enough beds" && m.score == -20.0));
        }
        let pack = terri_data::pack();
        let double = pack
            .objects
            .iter()
            .position(|o| o.id == "double_bed")
            .unwrap();
        let one = sim
            .world_mut()
            .spawn(SmartObject(terri_core::ObjectDefId(double as u32)))
            .id();
        assert!(
            has_bed_shortage(sim.world()),
            "one double bed cannot sleep three people"
        );
        sim.world_mut()
            .spawn(SmartObject(terri_core::ObjectDefId(double as u32)));
        assert!(
            !has_bed_shortage(sim.world()),
            "two double beds provide four places"
        );
        for person in &people {
            assert!(!sim
                .mood_of(person.index_u32())
                .unwrap()
                .moodlets
                .iter()
                .any(|m| m.label == "Not enough beds"));
        }
        sim.world_mut().despawn(one);
        assert!(has_bed_shortage(sim.world()));
        sim.world_mut().despawn(people[0]);
        assert!(
            !has_bed_shortage(sim.world()),
            "only living household members need beds"
        );
    }

    fn condition(label: &str) -> CompiledTrait {
        CompiledTrait {
            starting_satisfaction_offset: 0.0,
            id: label.to_lowercase().replace(' ', "_"),
            label: label.to_string(),
            tag: "resting".to_string(),
            kind: CompiledTraitKind::Condition {
                accrual_scale: 0.5,
                manage_per_completion: 0.01,
                start_severity: 0.5,
            },
            description: String::new(),
        }
    }

    fn capability(label: &str) -> CompiledTrait {
        CompiledTrait {
            starting_satisfaction_offset: 0.0,
            id: label.to_lowercase().replace(' ', "_"),
            label: label.to_string(),
            tag: "cooking".to_string(),
            kind: CompiledTraitKind::Capability {
                start_level: 0.25,
                fail_delta_scale: 0.0,
            },
            description: String::new(),
        }
    }

    fn disposition(label: &str) -> CompiledTrait {
        CompiledTrait {
            starting_satisfaction_offset: 0.0,
            id: label.to_lowercase().replace(' ', "_"),
            label: label.to_string(),
            tag: "reading".to_string(),
            kind: CompiledTraitKind::Disposition {
                score_multiplier: 1.5,
            },
            description: String::new(),
        }
    }

    fn pack_with_traits(traits: Vec<CompiledTrait>) -> &'static ContentPack {
        let base = test_content::pack(Vec::new());
        Box::leak(Box::new(ContentPack {
            traits,
            ..base.clone()
        }))
    }

    #[test]
    fn need_thresholds_use_the_exact_plain_labels_and_scores() {
        let pack = test_content::pack(Vec::new());
        let mut sim = test_content::sim_with(8, 8, pack);
        let subject = subject(&mut sim, Needs::all_at(NEED_MAX));
        let labels = [
            ("Hungry", "Starving"),
            ("Tired", "Exhausted"),
            ("Needs a wash", "Very dirty"),
            ("Needs the toilet", "Desperate for the toilet"),
            ("Lonely", "Very lonely"),
            ("Bored", "Very bored"),
            ("Uncomfortable", "Very uncomfortable"),
        ];

        for (need, (low, critical)) in NeedId::ALL.into_iter().zip(labels) {
            for (level, expected_label, expected_score) in [
                (20.0, critical, -25.0),
                (20.001, low, -12.0),
                (40.0, low, -12.0),
            ] {
                let mut needs = Needs::all_at(NEED_MAX);
                needs.set(need, level);
                sim.world_mut().entity_mut(subject).insert(needs);
                let snapshot = mood(&sim, subject);
                assert_eq!(
                    snapshot.moodlets,
                    vec![Moodlet {
                        label: expected_label.to_string(),
                        score: expected_score,
                    }],
                    "{} at {level} must use its own threshold label",
                    need.as_str()
                );
            }

            let mut needs = Needs::all_at(NEED_MAX);
            needs.set(need, 40.001);
            sim.world_mut().entity_mut(subject).insert(needs);
            assert!(
                mood(&sim, subject).moodlets.is_empty(),
                "{} just above the low boundary must be inactive",
                need.as_str()
            );
        }
    }

    #[test]
    fn need_moodlets_follow_need_id_order_and_needs_met_includes_seventy() {
        let pack = test_content::pack(Vec::new());
        let mut sim = test_content::sim_with(8, 8, pack);
        let mut needs = Needs::all_at(NEED_MAX);
        for (offset, need) in NeedId::ALL.into_iter().enumerate() {
            needs.set(need, if offset % 2 == 0 { 20.0 } else { 40.0 });
        }
        let subject = subject(&mut sim, needs);
        let snapshot = mood(&sim, subject);
        assert_eq!(
            snapshot
                .moodlets
                .iter()
                .map(|moodlet| moodlet.label.as_str())
                .collect::<Vec<_>>(),
            vec![
                "Starving",
                "Tired",
                "Very dirty",
                "Needs the toilet",
                "Very lonely",
                "Bored",
                "Very uncomfortable",
            ]
        );
        assert_eq!(
            snapshot
                .moodlets
                .iter()
                .map(|moodlet| moodlet.score)
                .collect::<Vec<_>>(),
            vec![-25.0, -12.0, -25.0, -12.0, -25.0, -12.0, -25.0]
        );
        assert_eq!(snapshot.overall_score, -100.0, "the sum clamps at -100");

        sim.world_mut()
            .entity_mut(subject)
            .insert(Needs::all_at(70.0));
        assert_eq!(
            mood(&sim, subject).moodlets,
            vec![Moodlet {
                label: "Needs met".to_string(),
                score: 20.0,
            }]
        );
        let mut almost = Needs::all_at(70.0);
        almost.set(NeedId::Comfort, 69.999);
        sim.world_mut().entity_mut(subject).insert(almost);
        assert!(mood(&sim, subject).moodlets.is_empty());
    }

    #[test]
    fn overall_labels_include_each_exact_boundary() {
        assert_eq!(overall_label(-50.0), "Miserable");
        assert_eq!(overall_label(-49.999), "Low");
        assert_eq!(overall_label(-15.0), "Low");
        assert_eq!(overall_label(-14.999), "Okay");
        assert_eq!(overall_label(14.999), "Okay");
        assert_eq!(overall_label(15.0), "Good");
        assert_eq!(overall_label(49.999), "Good");
        assert_eq!(overall_label(50.0), "Great");
    }

    #[test]
    fn every_generic_condition_contributes_in_trait_index_order_above_the_cutoff() {
        let pack = pack_with_traits(vec![
            condition("Paperwork allergy"),
            disposition("Night owl"),
            condition("Jet lag"),
            capability("Learning to cook"),
            condition("Barely present"),
        ]);
        let mut sim = test_content::sim_with(8, 8, pack);
        let subject = subject(&mut sim, Needs::all_at(50.0));
        sim.world_mut()
            .entity_mut(subject)
            .insert(Traits::from_entries(vec![
                (4, 0.05),
                (3, 0.9),
                (2, 0.2),
                (1, 0.8),
                (0, 0.5),
            ]));

        let snapshot = mood(&sim, subject);
        assert_eq!(
            snapshot.moodlets,
            vec![
                Moodlet {
                    label: "Paperwork allergy".to_string(),
                    score: -15.0,
                },
                Moodlet {
                    label: "Jet lag".to_string(),
                    score: -6.0,
                },
            ],
            "condition kind and content label drive mood; ids and other kinds do not"
        );
        assert_eq!(snapshot.overall_score, -21.0);
        assert_eq!(snapshot.overall_label, "Low");
    }

    #[test]
    fn relationship_moodlets_are_directional_proximity_bounded_and_sim_id_sorted() {
        let pack = test_content::pack(Vec::new());
        let mut sim = test_content::sim_with(12, 12, pack);
        let subject = sim
            .world_mut()
            .spawn((
                Agent,
                SimId(50),
                SimName("Subject".to_string()),
                Position { x: 1.0, y: 1.0 },
                Needs::all_at(50.0),
                Relationships::default(),
            ))
            .id();

        let people = [
            (7, "Close friend", 1.0, 1.0),
            (2, "Awkward neighbour", 3.0, 1.0),
            (5, "Distant friend", 4.0, 1.0),
            (3, "At the boundary", 5.0, 1.0),
            (4, "Near stranger", 1.0, 2.0),
            (8, "Exactly known", 1.0, 2.0),
        ];
        let mut entities = Vec::new();
        for (sim_id, name, x, y) in people {
            entities.push(
                sim.world_mut()
                    .spawn((
                        Agent,
                        SimId(sim_id),
                        SimName(name.to_string()),
                        Position { x, y },
                        Needs::all_at(50.0),
                        Relationships::default(),
                    ))
                    .id(),
            );
        }
        // Named but not an Agent, and an Agent without a name, are not
        // live named sims for this projection.
        sim.world_mut().spawn((
            SimId(1),
            SimName("A labelled chair".to_string()),
            Position { x: 1.0, y: 1.0 },
        ));
        sim.world_mut().spawn((
            Agent,
            SimId(6),
            Position { x: 1.0, y: 1.0 },
            Needs::all_at(50.0),
        ));

        {
            let mut relationships = sim
                .world_mut()
                .get_mut::<Relationships>(subject)
                .expect("subject carries the directional map");
            relationships.bump(SimId(7), 1.0);
            relationships.bump(SimId(2), -0.8);
            relationships.bump(SimId(5), 0.5);
            relationships.bump(SimId(3), 1.0);
            relationships.bump(SimId(4), 0.099);
            relationships.bump(SimId(8), 0.1);
            relationships.bump(SimId(1), 1.0);
            relationships.bump(SimId(6), 1.0);
        }
        // Reciprocal feelings are deliberately opposite. Only Subject's map
        // may contribute.
        for (entity, reciprocal) in entities.into_iter().zip([-1.0, 1.0, -1.0, -1.0, 1.0, -1.0]) {
            sim.world_mut()
                .get_mut::<Relationships>(entity)
                .expect("other carries a map")
                .bump(SimId(50), reciprocal);
        }

        let snapshot = mood(&sim, subject);
        assert_eq!(
            snapshot
                .moodlets
                .iter()
                .map(|moodlet| moodlet.label.as_str())
                .collect::<Vec<_>>(),
            vec![
                "Uneasy around Awkward neighbour",
                "Comforted by Distant friend",
                "Comforted by Close friend",
                "Comforted by Exactly known",
                "Not enough beds",
            ],
            "query and spawn order must collapse to stable SimId order"
        );
        let scores = snapshot
            .moodlets
            .iter()
            .map(|moodlet| moodlet.score)
            .collect::<Vec<_>>();
        assert!((scores[0] - -6.0).abs() < 1e-6);
        assert!((scores[1] - 1.875).abs() < 1e-6);
        assert!((scores[2] - 15.0).abs() < 1e-6);
        assert!((scores[3] - 1.125).abs() < 1e-6);
        assert_eq!(scores[4], -20.0);
        assert!((snapshot.overall_score - -8.0).abs() < 1e-6);
    }

    #[test]
    fn missing_stale_and_non_sim_indices_return_none_and_the_read_is_pure() {
        let pack = test_content::pack(vec![test_content::object(
            "chair",
            &[(NeedId::Comfort, 10.0)],
            5,
        )]);
        let mut sim = test_content::sim_with(8, 8, pack);
        let subject = subject(&mut sim, Needs::all_at(NEED_MAX));
        let object = sim
            .world_mut()
            .spawn((
                Position { x: 2.0, y: 2.0 },
                SmartObject(terri_core::ObjectDefId(0)),
            ))
            .id();
        let stale = sim
            .world_mut()
            .spawn((Agent, Position { x: 3.0, y: 3.0 }, Needs::all_at(50.0)))
            .id();
        let stale_index = stale.index_u32();
        assert!(sim.world_mut().despawn(stale));
        let before = sim.save_snapshot();

        assert!(sim.mood_of(u32::MAX).is_none());
        assert!(sim.mood_of(stale_index).is_none());
        assert!(sim.mood_of(object.index_u32()).is_none());
        assert!(sim.mood_of(subject.index_u32()).is_some());
        assert_eq!(
            sim.save_snapshot(),
            before,
            "a projection read must not create state that Save V1 could persist"
        );
    }

    /// Tim from the shipped household, on the shipped lot.
    fn shipped_tim() -> (Sim, Entity) {
        let mut sim = Sim::new_from_shipped_lot();
        let tim = person_named(&mut sim, "Tim");
        (sim, tim)
    }

    fn person_named(sim: &mut Sim, name: &str) -> Entity {
        sim.world_mut()
            .query::<(Entity, &SimName)>()
            .iter(sim.world())
            .find(|(_, person)| person.0 == name)
            .unwrap_or_else(|| panic!("{name} is in the shipped household"))
            .0
    }

    /// The shipped (definition, flyout row) of one object's own interaction.
    fn shipped_row(object: &str, interaction: &str) -> (ObjectDefId, u32) {
        let pack = terri_data::pack();
        let id = pack.find(object).expect("a shipped object");
        let row = pack
            .object(id)
            .interactions
            .iter()
            .position(|candidate| candidate.id == interaction)
            .expect("a shipped interaction");
        (id, row as u32)
    }

    /// Current public recipe actions carry their own stable row.
    fn shipped_chain_row(object: &str, chain: &str) -> (ObjectDefId, u32) {
        let pack = terri_data::pack();
        let id = pack.find(object).expect("a shipped object");
        let row = crate::action_rows::rows(pack, id)
            .into_iter()
            .find(|row| row.public && row.recipe.is_some_and(|(_, c)| c.id == chain))
            .expect("the object offers this recipe")
            .row;
        (id, row)
    }

    /// Replaces a person's habituation with exactly these values.
    fn set_habituation(sim: &mut Sim, person: Entity, rows: &[(ObjectDefId, u32, f32)]) {
        let cap = sim.world().resource::<Content>().0.tuning.habituation_max;
        let mut habits = Habituation::default();
        for &(object, row, value) in rows {
            habits.bump(object, row, value, cap);
        }
        for &(object, row, value) in rows {
            assert_eq!(
                habits.get(object, row),
                value,
                "the fixture sets exact values"
            );
        }
        sim.world_mut().entity_mut(person).insert(habits);
    }

    /// The moodlets [OD-moodlets] adds, in the order mood lists them.
    fn repetition_moodlets(snapshot: &MoodSnapshot) -> Vec<Moodlet> {
        snapshot
            .moodlets
            .iter()
            .filter(|moodlet| {
                moodlet.label.starts_with("Overdoing ") || moodlet.label == FEELING_SICK
            })
            .cloned()
            .collect()
    }

    fn next_above(value: f32) -> f32 {
        assert!(value > 0.0 && value.is_finite());
        f32::from_bits(value.to_bits() + 1)
    }

    fn next_below(value: f32) -> f32 {
        assert!(value > 0.0 && value.is_finite());
        f32::from_bits(value.to_bits() - 1)
    }

    /// [OD-moodlets] item 1: only a value strictly above
    /// `overdoing_threshold` costs mood, and the cost starts at zero.
    #[test]
    fn exactly_at_the_threshold_is_not_overdoing() {
        let (mut sim, tim) = shipped_tim();
        let tuning = terri_data::pack().tuning;
        let (television, watch) = shipped_row("television", "watch_tv");
        set_habituation(
            &mut sim,
            tim,
            &[(television, watch, tuning.overdoing_threshold)],
        );
        assert_eq!(
            repetition_moodlets(&mood(&sim, tim)),
            Vec::new(),
            "a value exactly at the threshold is not overdoing"
        );

        let above = next_above(tuning.overdoing_threshold);
        set_habituation(&mut sim, tim, &[(television, watch, above)]);
        let moodlets = repetition_moodlets(&mood(&sim, tim));
        assert_eq!(moodlets.len(), 1, "{moodlets:?}");
        assert_eq!(moodlets[0].label, "Overdoing Watch TV");
        assert!(
            moodlets[0].score < 0.0 && moodlets[0].score > -1e-4,
            "one f32 step above the threshold costs almost nothing: {}",
            moodlets[0].score
        );
    }

    /// [OD-moodlets] item 1 and [L55]: the score is linear from zero at the
    /// threshold to the whole penalty at the cap, and the label is the one
    /// the Sim details repetition row shows, for an interaction row and for
    /// a chain row alike.
    #[test]
    fn overdoing_score_grows_linearly_to_the_penalty_at_the_cap() {
        let shipped = terri_data::pack().tuning;
        assert_eq!(
            (
                shipped.habituation_max,
                shipped.overdoing_threshold,
                shipped.overdoing_penalty
            ),
            (3.0, 1.0, 20.0),
            "the golden values below are for the shipped tuning"
        );
        assert_eq!(overdoing_score(1.0, &shipped), 0.0);
        assert_eq!(overdoing_score(1.5, &shipped), -5.0);
        assert_eq!(overdoing_score(2.0, &shipped), -10.0);
        assert_eq!(overdoing_score(3.0, &shipped), -20.0);
        // Distinct values for every knob, so swapping any two of them in
        // the formula moves a result.
        let other = terri_data::Tuning {
            habituation_max: 5.0,
            overdoing_threshold: 2.0,
            overdoing_penalty: 30.0,
            ..shipped
        };
        assert_eq!(overdoing_score(2.0, &other), 0.0);
        assert_eq!(overdoing_score(3.5, &other), -15.0);
        assert_eq!(overdoing_score(5.0, &other), -30.0);

        let (mut sim, tim) = shipped_tim();
        let (television, watch) = shipped_row("television", "watch_tv");
        let (fridge, dinner) = shipped_chain_row("fridge", "cook_dinner");
        let midpoint = (shipped.overdoing_threshold + shipped.habituation_max) / 2.0;
        assert!(
            midpoint < shipped.sick_threshold,
            "Cook dinner is food; below the sick threshold it shows overdoing only"
        );
        set_habituation(
            &mut sim,
            tim,
            &[
                (television, watch, shipped.habituation_max),
                (fridge, dinner, midpoint),
            ],
        );
        let moodlets = repetition_moodlets(&mood(&sim, tim));
        let details = sim.details_of(tim.index_u32()).unwrap().repeated;
        let label_of = |object: ObjectDefId, row: u32| {
            let detail = details
                .iter()
                .find(|detail| detail.object == object.0 && detail.interaction == row)
                .expect("the details list the row");
            format!("Overdoing {}", detail.activity_label)
        };
        let score_of = |label: &str| {
            moodlets
                .iter()
                .find(|moodlet| moodlet.label == label)
                .unwrap_or_else(|| panic!("no '{label}' in {moodlets:?}"))
                .score
        };
        assert_eq!(moodlets.len(), 2, "{moodlets:?}");
        assert_eq!(label_of(television, watch), "Overdoing Watch TV");
        assert_eq!(label_of(fridge, dinner), "Overdoing Cook dinner");
        assert!((score_of("Overdoing Watch TV") - -shipped.overdoing_penalty).abs() < 1e-4);
        assert!(
            (score_of("Overdoing Cook dinner") - -shipped.overdoing_penalty / 2.0).abs() < 1e-4
        );
    }

    /// [OD-moodlets] item 2: one `Feeling sick` per person however many
    /// food rows qualify, from exactly `sick_threshold`, and never for an
    /// activity that does not feed.
    #[test]
    fn feeling_sick_appears_once_per_person_and_only_for_food() {
        let pack = terri_data::pack();
        let tuning = pack.tuning;
        let (fridge, snack) = shipped_row("fridge", "grab_snack");
        let (_, dinner) = shipped_chain_row("fridge", "cook_dinner");
        let (television, watch) = shipped_row("television", "watch_tv");
        let (sink, clean_dishes) = shipped_chain_row("kitchen_sink", "clean_dishes");
        // Food is a positive Hunger delta on the row, whether the row is an
        // interaction or a chain.
        assert!(is_food(pack, fridge, snack));
        assert!(is_food(pack, fridge, dinner));
        assert!(!is_food(pack, television, watch));
        assert!(
            !is_food(pack, sink, clean_dishes),
            "a chain that feeds nobody"
        );
        assert!(
            !is_food(pack, fridge, u32::MAX),
            "a row that does not exist"
        );
        let custom = test_content::pack(vec![
            test_content::object(
                "diet_pill",
                &[(NeedId::Hunger, -5.0), (NeedId::Fun, 10.0)],
                5,
            ),
            test_content::object("biscuit", &[(NeedId::Hunger, 5.0)], 5),
        ]);
        assert!(
            !is_food(custom, ObjectDefId(0), 0),
            "a row that costs hunger does not feed"
        );
        assert!(is_food(custom, ObjectDefId(1), 0));

        let (mut sim, tim) = shipped_tim();
        set_habituation(
            &mut sim,
            tim,
            &[
                (fridge, snack, tuning.sick_threshold),
                (fridge, dinner, tuning.sick_threshold),
            ],
        );
        let moodlets = repetition_moodlets(&mood(&sim, tim));
        assert_eq!(
            moodlets
                .iter()
                .map(|moodlet| moodlet.label.as_str())
                .collect::<Vec<_>>(),
            vec![
                "Overdoing Grab a snack",
                "Overdoing Cook dinner",
                "Feeling sick"
            ],
            "two food rows at the threshold make one person sick once"
        );
        assert_eq!(moodlets[2].score, -tuning.sick_penalty);

        let below = next_below(tuning.sick_threshold);
        set_habituation(
            &mut sim,
            tim,
            &[(fridge, snack, below), (fridge, dinner, below)],
        );
        assert!(
            !repetition_moodlets(&mood(&sim, tim))
                .iter()
                .any(|moodlet| moodlet.label == FEELING_SICK),
            "just below the threshold is not sick"
        );

        set_habituation(
            &mut sim,
            tim,
            &[(television, watch, tuning.habituation_max)],
        );
        assert_eq!(
            repetition_moodlets(&mood(&sim, tim)),
            vec![Moodlet {
                label: "Overdoing Watch TV".to_string(),
                score: -tuning.overdoing_penalty,
            }],
            "an activity that does not feed never makes anyone sick"
        );

        // Per person: Bill's food rows make Bill sick and leave Tim alone.
        let bill = person_named(&mut sim, "Bill");
        set_habituation(&mut sim, bill, &[(fridge, snack, tuning.habituation_max)]);
        assert!(!mood(&sim, tim)
            .moodlets
            .iter()
            .any(|moodlet| moodlet.label == FEELING_SICK));
        assert_eq!(
            mood(&sim, bill)
                .moodlets
                .iter()
                .filter(|moodlet| moodlet.label == FEELING_SICK)
                .count(),
            1
        );
    }

    /// [OD-moodlets]: the new moodlets come after every existing one, the
    /// overdoing rows in habituation order (object, then row) and then
    /// `Feeling sick`, so the existing exact-list tests keep their order.
    #[test]
    fn new_moodlets_come_after_every_existing_one_in_habituation_order() {
        let (mut sim, tim) = shipped_tim();
        let pack = terri_data::pack();
        let tuning = pack.tuning;
        let (fridge, snack) = shipped_row("fridge", "grab_snack");
        let (television, watch) = shipped_row("television", "watch_tv");
        assert!(
            fridge.0 < television.0,
            "the sick food row sorts first, so Feeling sick must wait for the TV row"
        );

        // A condition above the cutoff.
        let condition = pack
            .traits
            .iter()
            .position(|definition| matches!(definition.kind, CompiledTraitKind::Condition { .. }))
            .expect("the shipped pack has a condition");
        sim.world_mut()
            .entity_mut(tim)
            .insert(Traits::from_entries(vec![(condition as u32, 0.5)]));

        // Bill beside Tim, both at the fridge, with a pile of Bill's dishes
        // on the fridge.
        let bill = person_named(&mut sim, "Bill");
        let bill_id = *sim.world().get::<SimId>(bill).unwrap();
        let fridge_entity = sim
            .world_mut()
            .query::<(Entity, &SmartObject)>()
            .iter(sim.world())
            .find(|(_, object)| object.0 == fridge)
            .expect("the shipped lot has a fridge")
            .0;
        let at_fridge = *sim.world().get::<Position>(fridge_entity).unwrap();
        for person in [tim, bill] {
            *sim.world_mut().get_mut::<Position>(person).unwrap() = at_fridge;
        }
        let mut feelings = Relationships::default();
        feelings.bump(bill_id, 1.0);
        sim.world_mut().entity_mut(tim).insert(feelings);
        {
            sim.world_mut()
                .init_resource::<terri_core::save::SavedDomestic>();
            let mut domestic = sim
                .world_mut()
                .resource_mut::<terri_core::save::SavedDomestic>();
            let id = domestic.next_dish;
            domestic.next_dish += 1;
            domestic.dishes.push(terri_core::save::SavedDishes {
                id,
                surface: fridge_entity.index_u32(),
                owner: bill_id.0,
                units: 3,
            });
        }

        // Set in the reverse of habituation order.
        set_habituation(
            &mut sim,
            tim,
            &[
                (television, watch, 2.0),
                (fridge, snack, tuning.habituation_max),
            ],
        );
        let labels: Vec<String> = mood(&sim, tim)
            .moodlets
            .into_iter()
            .map(|moodlet| moodlet.label)
            .collect();
        let position = |label: &str| {
            labels
                .iter()
                .position(|candidate| candidate == label)
                .unwrap_or_else(|| panic!("no '{label}' in {labels:?}"))
        };
        let condition_at = position(&pack.traits[condition].label);
        let bill_at = position("Comforted by Bill");
        let dishes_at = position("Dirty dishes");
        assert!(
            condition_at < bill_at && bill_at < dishes_at,
            "the existing order is unchanged: {labels:?}"
        );
        assert_eq!(
            labels[dishes_at + 1..],
            [
                "Overdoing Grab a snack".to_string(),
                "Overdoing Watch TV".to_string(),
                FEELING_SICK.to_string(),
            ],
            "the new moodlets come last, in habituation order, then Feeling sick"
        );
    }

    /// [OD-evidence] item 3, played on the shipped lot: Tim is ordered to
    /// grab a snack again and again. After every completion his mood shows
    /// `Overdoing Grab a snack` exactly when the snack row is above the
    /// threshold, with the score the formula gives and a penalty that grows
    /// with each use, and `Feeling sick` exactly when the row is at or above
    /// the sick threshold. While both stand his satisfaction falls; with no
    /// further snack use, decay removes both within the tick count the tuning
    /// implies. Every snack fills hunger by the same amount, because need
    /// delivery never reads repetition.
    #[test]
    fn repeated_snacks_make_a_person_sick_and_decay_heals_them() {
        use terri_core::{Career, ChainState, CommandQueue, Satisfaction, SimClock, SimCommand};

        let (mut sim, tim) = shipped_tim();
        let pack = sim.world().resource::<Content>().0;
        let tuning = pack.tuning;
        let decay = tuning.habituation_decay_per_tick;
        // No shift to leave for, and no drain, so hunger moves only when a
        // snack delivers. Tim can cook, so no snack is fumbled.
        sim.world_mut().entity_mut(tim).remove::<Career>();
        sim.world_mut()
            .get_mut::<terri_core::Personality>(tim)
            .expect("Tim has a personality")
            .drain = [0.0; terri_core::NEED_COUNT];
        let fridge = sim
            .world_mut()
            .query::<(Entity, &SmartObject)>()
            .iter(sim.world())
            .find(|(_, object)| pack.object(object.0).id == "fridge")
            .expect("the shipped lot has a fridge")
            .0;
        let (fridge_def, row) = shipped_row("fridge", "grab_snack");
        let snack_chain = pack
            .chains
            .iter()
            .position(|chain| chain.id == crate::domestic::SNACK)
            .expect("the snack chain") as u32;
        let value = |sim: &Sim| {
            sim.world()
                .get::<Habituation>(tim)
                .map_or(0.0, |h| h.get(fridge_def, row))
        };
        let clock = |sim: &Sim| sim.world().resource::<SimClock>().tick;
        let overdoing = |snapshot: &MoodSnapshot| {
            snapshot
                .moodlets
                .iter()
                .find(|moodlet| moodlet.label == "Overdoing Grab a snack")
                .map(|moodlet| moodlet.score)
        };
        let sick = |snapshot: &MoodSnapshot| {
            snapshot
                .moodlets
                .iter()
                .filter(|moodlet| moodlet.label == FEELING_SICK)
                .count()
        };

        const HUNGER: f32 = 30.0;
        let mut refills = Vec::new();
        let mut first_overdoing = None;
        let mut first_sick = None;
        let mut previous_score = 0.0_f32;
        let mut capped = false;
        for snack in 1..=16_u32 {
            sim.world_mut()
                .get_mut::<Needs>(tim)
                .unwrap()
                .set(NeedId::Hunger, HUNGER);
            let before = value(&sim);
            sim.world_mut()
                .resource_mut::<CommandQueue>()
                .push(SimCommand::UseObjectFirst {
                    agent: tim.index_u32(),
                    object: fridge.index_u32(),
                    interaction: row,
                });
            let start = clock(&sim);
            let mut ticks = 0_u64;
            let mut began = false;
            let mut finished = false;
            for _ in 0..2000 {
                sim.tick();
                ticks += 1;
                let running = sim
                    .world()
                    .get::<ChainState>(tim)
                    .is_some_and(|state| state.chain == snack_chain);
                began |= running;
                if began && !running {
                    finished = true;
                    break;
                }
            }
            assert!(finished, "snack {snack} must finish within the bound");
            assert_eq!(
                clock(&sim),
                start + ticks,
                "snack {snack}: one clock tick per loop tick"
            );
            let now = value(&sim);
            assert!(
                now > before - decay * ticks as f32,
                "snack {snack} completed"
            );
            refills.push(sim.world().get::<Needs>(tim).unwrap().get(NeedId::Hunger) - HUNGER);

            let snapshot = mood(&sim, tim);
            match overdoing(&snapshot) {
                Some(score) => {
                    assert!(now > tuning.overdoing_threshold, "snack {snack}: {now}");
                    assert!((score - overdoing_score(now, &tuning)).abs() < 1e-6);
                    assert!(
                        score < previous_score,
                        "snack {snack}: the penalty grows with each use, {score} after \
                         {previous_score}"
                    );
                    previous_score = score;
                    first_overdoing.get_or_insert(snack);
                }
                None => assert!(now <= tuning.overdoing_threshold, "snack {snack}: {now}"),
            }
            assert_eq!(
                sick(&snapshot),
                usize::from(now >= tuning.sick_threshold),
                "snack {snack}: {now}"
            );
            if now >= tuning.sick_threshold {
                first_sick.get_or_insert(snack);
            }
            if now >= tuning.habituation_max - decay * 2.0 {
                capped = true;
                break;
            }
        }
        let first_overdoing = first_overdoing.expect("snacking reaches overdoing");
        let first_sick = first_sick.expect("snacking makes Tim sick");
        assert!(capped, "snacking reaches the cap within the bound");
        // The sim is deterministic, so the counts are exact: back-to-back
        // snacks net about 0.25 each because decay runs during each chain.
        // The chains' lengths come from the world generator, so the exact
        // snack that crosses the sick line moves with the draws taken
        // before it. Empty bookcases now exclude reading choices, moving the
        // shared draws and sampled snack lengths; the threshold itself is
        // checked against actual repetition after every completion above.
        assert_eq!(
            first_overdoing, 4,
            "three snacks in a row are not overdoing; the fourth is"
        );
        assert_eq!(first_sick, 10, "the tenth snack in a row makes Tim sick");
        assert!(refills[0] > 0.0, "a snack must fill hunger: {refills:?}");
        assert!(
            refills.iter().all(|refill| *refill == refills[0]),
            "every snack fills hunger the same: {refills:?}"
        );

        // While both stand, satisfaction falls. Without them his mood
        // would sit inside the neutral band, which costs nothing, so the
        // fall is theirs.
        const STRETCH: u64 = 200;
        let band = tuning.satisfaction_mood_neutral_band;
        let satisfaction = |sim: &Sim| sim.world().get::<Satisfaction>(tim).unwrap().value();
        let start = clock(&sim);
        let satisfied_before = satisfaction(&sim);
        for _ in 0..STRETCH {
            sim.tick();
            let snapshot = mood(&sim, tim);
            let overdone = overdoing(&snapshot).expect("Overdoing stands");
            assert_eq!(sick(&snapshot), 1, "Feeling sick stands");
            let without = snapshot.overall_score - overdone + tuning.sick_penalty;
            assert!(
                snapshot.overall_score < -band && without.abs() < band,
                "{} with the two moodlets, {without} without",
                snapshot.overall_score
            );
        }
        assert_eq!(clock(&sim), start + STRETCH);
        assert!(
            satisfaction(&sim) < satisfied_before,
            "{} after {satisfied_before}",
            satisfaction(&sim)
        );

        // Recovery measures decay with no further snack use. An empty order
        // queue still permits exploratory snacks, even at full hunger. Rest
        // through normal bed orders and cancel any snack already under way.
        let bed = sim
            .world_mut()
            .query::<(Entity, &SmartObject)>()
            .iter(sim.world())
            .find(|(_, object)| pack.object(object.0).id == "bed")
            .expect("the shipped lot has a bed")
            .0;
        let (_, sleep) = shipped_row("bed", "sleep");
        if sim
            .world()
            .get::<ChainState>(tim)
            .is_some_and(|state| state.chain == snack_chain)
        {
            sim.world_mut()
                .resource_mut::<CommandQueue>()
                .push(SimCommand::CancelIntents {
                    agent: tim.index_u32(),
                });
            sim.flush_commands();
        }
        assert!(sim
            .world()
            .get::<ChainState>(tim)
            .is_none_or(|state| state.chain != snack_chain));
        // From at most the cap, no further use reaches the threshold within
        // this many ticks. Check every tick for a renewed use as well.
        let heal =
            ((tuning.habituation_max - tuning.overdoing_threshold) / decay).ceil() as u64 + 1;
        let start = clock(&sim);
        for _ in 0..heal {
            if sim
                .world()
                .get::<terri_core::IntentQueue>(tim)
                .is_none_or(|queue| queue.is_empty())
            {
                sim.world_mut()
                    .resource_mut::<CommandQueue>()
                    .push(SimCommand::UseObjectFirst {
                        agent: tim.index_u32(),
                        object: bed.index_u32(),
                        interaction: sleep,
                    });
            }
            let before = value(&sim);
            sim.tick();
            let after = value(&sim);
            assert!(
                after <= before,
                "healing restarted snack use at tick {}: {before} to {after}; chain {:?}; hunger {}",
                clock(&sim),
                sim.world().get::<ChainState>(tim),
                sim.world().get::<Needs>(tim).unwrap().get(NeedId::Hunger)
            );
        }
        assert_eq!(clock(&sim), start + heal);
        let snapshot = mood(&sim, tim);
        assert!(value(&sim) <= tuning.overdoing_threshold, "{}", value(&sim));
        assert_eq!(overdoing(&snapshot), None, "{:?}", snapshot.moodlets);
        assert_eq!(sick(&snapshot), 0, "{:?}", snapshot.moodlets);
    }
}
