//! Ordinary company and shared activities, distinct from one-time incidents.
use crate::compatibility::Preferences;
use crate::relationship_effects::{RelationshipCause, RelationshipDiagnostics, RelationshipEffect};
use crate::{compatibility, room_regions::RoomRegions, Content};
use bevy_ecs::prelude::*;
use terri_core::{
    Agent, AtWork, Commuting, Eating, Hobbies, NeedId, Needs, Personality, Position, Relationships,
    SimClock, SimId, SmartObject, Socialising, Target, Traits,
};

#[derive(Resource, Default)]
#[doc(hidden)]
pub struct RelationshipContext(pub(crate) std::collections::BTreeMap<Entity, Preferences>);

/// Rebuild unsaved preferences before selection, including the first restored tick.
pub(crate) fn refresh_profiles(world: &mut World) {
    let pack = world.resource::<Content>().0;
    let people: Vec<_> = world
        .query_filtered::<Entity, With<Agent>>()
        .iter(world)
        .collect();
    let profiles = people
        .into_iter()
        .map(|person| {
            (
                person,
                compatibility::preferences(
                    pack,
                    world.get::<Personality>(person),
                    world.get::<Traits>(person),
                    world.get::<Hobbies>(person),
                ),
            )
        })
        .collect();
    world.insert_resource(RelationshipContext(profiles));
}

pub(crate) fn positive_allowed(
    subject: &Needs,
    other: &Needs,
    helped: &[(u8, f32)],
    tuning: &terri_data::Tuning,
) -> bool {
    other.get(NeedId::Hygiene) > tuning.mood_low_need_level
        && NeedId::ALL.into_iter().all(|need| {
            subject.get(need) > tuning.mood_critical_need_level
                || helped
                    .iter()
                    .any(|&(index, delta)| index as usize == need.index() && delta > 0.0)
        })
}

pub(crate) fn positive_scale(score: f32) -> f32 {
    (1.0 + score).clamp(0.25, 2.0)
}

/// A completed chat can establish friendship even when loneliness is critical.
/// Its positive Social advertisement exempts loneliness for relationship growth;
/// actual meter delivery still requires a positive feeling toward the partner.
pub(crate) fn conversation_positive_allowed(
    subject: &Needs,
    other: &Needs,
    advertisements: &[(u8, f32)],
    tuning: &terri_data::Tuning,
) -> bool {
    positive_allowed(subject, other, advertisements, tuning)
}

struct Contact {
    entity: Entity,
    id: SimId,
    position: Position,
    room: Option<u32>,
    needs: Needs,
    preferences: Preferences,
    helped: Vec<(u8, f32)>,
    activity: Option<crate::social_company::Communal>,
}

/// Whether a person who hates a housemate still gains from their shared
/// activity this minute: a seeded roll against `hated_communal_chance`.
///
/// `stream` is a digest of the saved simulation generator, so the roll
/// differs between games and between saves without consuming a draw; the
/// tick and both people then separate every pair and every minute. A roll
/// is therefore a pure function of saved state, and a replay or a reload
/// rolls the same way. At chance 1 every draw passes, because `next_f32`
/// never reaches 1; at chance 0 none does.
pub(crate) fn hated_communal_gain(
    tuning: &terri_data::Tuning,
    stream: u64,
    tick: u64,
    subject: SimId,
    other: SimId,
) -> bool {
    let mut hash = terri_core::FnvHasher::default();
    hash.write_u64(stream);
    hash.write_u64(tick);
    hash.write_u64(u64::from(subject.0));
    hash.write_u64(u64::from(other.0));
    terri_core::SimRng::from_seed(hash.finish()).next_f32() < tuning.hated_communal_chance
}

/// The digest `hated_communal_gain` takes: the generator's exact state,
/// read without advancing it.
fn stream_digest(world: &World) -> u64 {
    let mut hash = terri_core::FnvHasher::default();
    world.resource::<terri_core::SimRng>().hash_into(&mut hash);
    hash.finish()
}

pub(crate) fn tick(world: &mut World) {
    crate::social_company::refresh(world);
    let pack = world.resource::<Content>().0;
    let tuning = pack.tuning;
    let rates = tuning.relationships;
    let rooms = RoomRegions::from_world(world);
    let conversations: Vec<_> = world
        .query::<(Entity, &Socialising)>()
        .iter(world)
        .filter(|(_, talk)| {
            world.get::<Agent>(talk.partner).is_some()
                && world.get::<terri_core::Reserved>(talk.partner).is_some()
                && world.get::<Target>(talk.partner).is_none()
        })
        .map(|(e, talk)| (e, *talk))
        .collect();
    let talks: std::collections::BTreeSet<_> = conversations
        .iter()
        .flat_map(|(a, talk)| [(*a, talk.partner), (talk.partner, *a)])
        .collect();
    let mut profiles = std::collections::BTreeMap::new();
    let mut contacts: Vec<_> = world
        .query_filtered::<(Entity, &SimId, &Position, &Needs), With<Agent>>()
        .iter(world)
        .filter_map(|(entity, &id, &position, needs)| {
            let preferences = compatibility::preferences(
                pack,
                world.get::<Personality>(entity),
                world.get::<Traits>(entity),
                world.get::<Hobbies>(entity),
            );
            profiles.insert(entity, preferences.clone());
            let eating = world.get::<Eating>(entity);
            if world.get::<AtWork>(entity).is_some()
                || world.get::<Commuting>(entity).is_some()
                || crate::systems::circadian::is_asleep(pack, eating)
            {
                return None;
            }
            let act = eating.and_then(|e| {
                let target = world.get::<Target>(entity)?;
                let object = world.get::<SmartObject>(target.object)?;
                if object.0 != e.object || target.interaction != e.interaction {
                    return None;
                }
                Some((
                    target.object,
                    pack.object(e.object)
                        .interactions
                        .get(e.interaction as usize)?,
                ))
            });
            let act = act.or_else(|| {
                let journey = world.get::<crate::reading::ReadingJourney>(entity)?;
                if journey.stage != terri_core::save_v6::ReadingStage::Read {
                    return None;
                }
                let target = *world.get::<Target>(entity)?;
                crate::reading::action(world, target).map(|a| (target.object, a))
            });
            if act.is_some_and(|(_, a)| {
                a.tags
                    .iter()
                    .any(|tag| tag == crate::systems::interpersonal::PRIVATE_USE_TAG)
            }) {
                return None;
            }
            Some(Contact {
                entity,
                id,
                position,
                room: rooms.at((position.x.round() as i32, position.y.round() as i32)),
                needs: *needs,
                preferences,
                helped: if let Some((_, talk)) = conversations
                    .iter()
                    .find(|(a, talk)| *a == entity || talk.partner == entity)
                {
                    pack.social[talk.interaction as usize].advertises.clone()
                } else {
                    crate::need_interactions::active_benefits(world, entity)
                },
                activity: world
                    .resource::<crate::social_company::SocialCompany>()
                    .communal_activity(entity),
            })
        })
        .collect();
    contacts.sort_by_key(|p| p.entity.index());
    world.resource_mut::<RelationshipContext>().0 = profiles;
    let tick = world.resource::<SimClock>().tick;
    let stream = stream_digest(world);
    for subject in &contacts {
        for other in &contacts {
            if subject.entity == other.entity
                || subject.room.is_none()
                || subject.room != other.room
                || (subject.position.x - other.position.x)
                    .hypot(subject.position.y - other.position.y)
                    > rates.contact_radius
            {
                continue;
            }
            world
                .resource_mut::<RelationshipDiagnostics>()
                .contacts
                .push((subject.id, other.id));
            if talks.contains(&(subject.entity, other.entity)) {
                continue;
            }
            let score = compatibility::between(&subject.preferences, &other.preferences);
            // Participation already excludes anyone who dislikes a shared
            // group and anyone whose attempt failed, so a pair of
            // participants needs no further acceptance check here.
            let shared = subject
                .activity
                .as_ref()
                .zip(other.activity.as_ref())
                .is_some_and(|(mine, theirs)| mine.pairs_with(theirs));
            let before = world
                .get::<Relationships>(subject.entity)
                .map_or(0.0, |r| r.feeling(other.id));
            // A person who already hates the other participant (the same
            // cutoff grief uses for a hated person) earns the communal rate
            // only on the minutes the roll allows. A refused minute pays
            // the ordinary proximity rate and still suspends friction, so
            // hatred slows recovery without ever blocking it.
            let refused = shared
                && before <= tuning.grief_hated_affinity
                && !hated_communal_gain(&tuning, stream, tick, subject.id, other.id);
            let (cause, requested) = if shared && !refused {
                (
                    RelationshipCause::SharedActivity,
                    rates.proximity_per_hour
                        * rates.shared_activity_multiplier
                        * positive_scale(score)
                        / 60.0,
                )
            } else if refused {
                (
                    RelationshipCause::Proximity,
                    rates.proximity_per_hour / 60.0,
                )
            } else if score < rates.incompatible_below {
                (
                    RelationshipCause::Incompatibility,
                    -rates.friction_per_hour * (rates.incompatible_below - score)
                        / (1.0 + rates.incompatible_below)
                        / 60.0,
                )
            } else {
                (
                    RelationshipCause::Proximity,
                    rates.proximity_per_hour / 60.0,
                )
            };
            if requested == 0.0
                || (requested > 0.0
                    && !positive_allowed(&subject.needs, &other.needs, &subject.helped, &tuning))
            {
                continue;
            }
            let mut feelings = world
                .get::<Relationships>(subject.entity)
                .cloned()
                .unwrap_or_default();
            feelings.bump(other.id, requested);
            let actual = feelings.feeling(other.id) - before;
            world.entity_mut(subject.entity).insert(feelings);
            world
                .resource_mut::<RelationshipDiagnostics>()
                .effects
                .push(RelationshipEffect {
                    tick,
                    event: 0,
                    cause,
                    responsible: other.id,
                    affected: subject.id,
                    requested,
                    actual,
                    emergency: false,
                    directed: false,
                });
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{Content, Sim};
    use terri_core::{Agent, Eating, NeedId, Needs, Position, Relationships, SimId, Target};

    fn pair() -> (Sim, Entity, Entity) {
        let mut sim = Sim::new_with_lot(8, 8);
        let mut pack = sim.world().resource::<Content>().0.clone();
        pack.tuning.relationships.proximity_per_hour = 0.002;
        sim.world_mut()
            .insert_resource(Content(Box::leak(Box::new(pack))));
        let a = sim
            .world_mut()
            .spawn((
                Agent,
                SimId(0),
                Position { x: 2.0, y: 2.0 },
                Needs::all_at(100.0),
            ))
            .id();
        let b = sim
            .world_mut()
            .spawn((
                Agent,
                SimId(1),
                Position { x: 3.0, y: 2.0 },
                Needs::all_at(100.0),
            ))
            .id();
        crate::test_content::enclose(&mut sim);
        (sim, a, b)
    }
    fn feeling(sim: &Sim, entity: Entity, other: SimId) -> f32 {
        sim.world()
            .get::<Relationships>(entity)
            .map_or(0.0, |r| r.feeling(other))
    }
    #[test]
    fn proximity_recovers_existing_dislike_but_smell_and_critical_needs_block_positive_gain() {
        let (mut sim, a, b) = pair();
        let mut feelings = Relationships::default();
        feelings.bump(SimId(1), -0.7);
        sim.world_mut().entity_mut(a).insert(feelings);
        tick(sim.world_mut());
        assert!(feeling(&sim, a, SimId(1)) > -0.7);
        let before = feeling(&sim, a, SimId(1));
        sim.world_mut()
            .get_mut::<Needs>(b)
            .unwrap()
            .set(NeedId::Hygiene, 40.0);
        tick(sim.world_mut());
        assert_eq!(feeling(&sim, a, SimId(1)), before);
        sim.world_mut()
            .get_mut::<Needs>(b)
            .unwrap()
            .set(NeedId::Hygiene, 100.0);
        sim.world_mut()
            .get_mut::<Needs>(a)
            .unwrap()
            .set(NeedId::Bladder, 20.0);
        tick(sim.world_mut());
        assert_eq!(feeling(&sim, a, SimId(1)), before);
    }
    #[test]
    fn a_redirected_conversation_partner_cannot_claim_social_help_from_the_old_talk() {
        let (mut sim, a, b) = pair();
        let c = sim
            .world_mut()
            .spawn((
                Agent,
                SimId(2),
                Position { x: 2.0, y: 3.0 },
                Needs::all_at(100.0),
            ))
            .id();
        let pack = sim.world().resource::<Content>().0;
        let def = pack.find("bookshelf").unwrap();
        let object = sim.spawn_object(Position { x: 1.0, y: 2.0 }, def);
        sim.world_mut()
            .get_mut::<Needs>(a)
            .unwrap()
            .set(NeedId::Social, 10.0);
        sim.world_mut().entity_mut(c).insert(Socialising {
            partner: a,
            interaction: 0,
            remaining_ticks: 20,
        });
        sim.world_mut().entity_mut(a).insert((
            terri_core::Reserved,
            Target {
                object,
                interaction: 0,
            },
            Eating {
                object: def,
                interaction: 0,
                remaining_ticks: 20,
            },
        ));
        tick(sim.world_mut());
        assert_eq!(feeling(&sim, a, SimId(1)), 0.0);
        assert!(feeling(&sim, b, SimId(0)) > 0.0);
    }

    #[test]
    fn critical_needs_helped_by_active_chains_or_either_conversation_role_allow_proximity() {
        for case in ["chain", "initiator", "partner"] {
            let (mut sim, a, b) = pair();
            let pack = sim.world().resource::<Content>().0;
            let need = if case == "chain" {
                NeedId::Hunger
            } else {
                NeedId::Social
            };
            sim.world_mut().get_mut::<Needs>(a).unwrap().set(need, 10.0);
            if case == "chain" {
                let chain = pack
                    .chains
                    .iter()
                    .position(|c| {
                        c.advertises
                            .iter()
                            .any(|&(n, d)| n as usize == need.index() && d > 0.0)
                    })
                    .unwrap();
                sim.world_mut().entity_mut(a).insert((
                    terri_core::ChainState::begin(chain as u32),
                    terri_core::StepWork {
                        remaining_ticks: 20,
                    },
                ));
            } else {
                let c = sim
                    .world_mut()
                    .spawn((
                        Agent,
                        SimId(2),
                        Position { x: 2.0, y: 3.0 },
                        Needs::all_at(100.0),
                    ))
                    .id();
                let (initiator, partner) = if case == "initiator" { (a, c) } else { (c, a) };
                sim.world_mut()
                    .entity_mut(partner)
                    .insert(terri_core::Reserved);
                let interaction = pack
                    .social
                    .iter()
                    .position(|act| {
                        act.advertises
                            .iter()
                            .any(|&(n, d)| n as usize == need.index() && d > 0.0)
                    })
                    .unwrap() as u32;
                sim.world_mut().entity_mut(initiator).insert(Socialising {
                    interaction,
                    partner,
                    remaining_ticks: 20,
                });
            }
            tick(sim.world_mut());
            assert!(feeling(&sim, a, SimId(1)) > 0.0, "{case}");
            assert_eq!(
                feeling(&sim, a, SimId(2)),
                0.0,
                "conversation pair must not double count"
            );
            assert!(feeling(&sim, b, SimId(0)) > 0.0);
        }
    }

    #[test]
    fn shared_reading_pays_ten_times_proximity_and_does_not_also_pay_proximity() {
        let (mut sim, a, b) = pair();
        let pack = sim.world().resource::<Content>().0;
        for (e, id, x) in [(a, "bookshelf", 1.0), (b, "reading_chair", 4.0)] {
            let definition = pack.find(id).unwrap();
            let object = sim.spawn_object(Position { x, y: 2.0 }, definition);
            sim.world_mut().entity_mut(e).insert((
                Target {
                    object,
                    interaction: 0,
                },
                Eating {
                    object: definition,
                    interaction: 0,
                    remaining_ticks: 30,
                },
            ));
        }
        tick(sim.world_mut());
        assert!((feeling(&sim, a, SimId(1)) - 0.02 / 60.0).abs() < 0.0000001);
        let events = sim.relationship_effects();
        assert_eq!(events.len(), 2);
        assert!(events
            .iter()
            .all(|e| e.cause == crate::relationship_effects::RelationshipCause::SharedActivity));
    }

    /// Two people, each with a running television interaction on `device`,
    /// standing where the lot admits them as viewers.
    fn watching_together(sim: &mut Sim, a: Entity, b: Entity) -> Entity {
        let pack = sim.world().resource::<Content>().0;
        let television = pack.find("television").unwrap();
        let device = sim.spawn_object(Position { x: 2.0, y: 3.0 }, television);
        crate::apply_object_placement(
            sim.world_mut(),
            device,
            pack.object(television),
            Position { x: 2.0, y: 3.0 },
            terri_core::Facing::SouthEast,
        );
        for (entity, y) in [(a, 3.0), (b, 4.0)] {
            sim.world_mut().entity_mut(entity).insert((
                Position { x: 3.0, y },
                Target {
                    object: device,
                    interaction: 0,
                },
                Eating {
                    object: television,
                    interaction: 0,
                    remaining_ticks: 30,
                },
            ));
        }
        device
    }

    #[test]
    fn watching_one_television_together_pays_the_shared_activity_rate() {
        let (mut sim, a, b) = pair();
        let device = watching_together(&mut sim, a, b);
        tick(sim.world_mut());
        assert!((feeling(&sim, a, SimId(1)) - 0.02 / 60.0).abs() < 0.0000001);
        assert!((feeling(&sim, b, SimId(0)) - 0.02 / 60.0).abs() < 0.0000001);
        let events = sim.relationship_effects();
        assert_eq!(events.len(), 2);
        assert!(events
            .iter()
            .all(|e| e.cause == crate::relationship_effects::RelationshipCause::SharedActivity));

        // A second television beside the first is a different device, so
        // the pair falls back to ordinary proximity.
        let pack = sim.world().resource::<Content>().0;
        let television = pack.find("television").unwrap();
        let second = sim.spawn_object(Position { x: 5.0, y: 3.0 }, television);
        crate::apply_object_placement(
            sim.world_mut(),
            second,
            pack.object(television),
            Position { x: 5.0, y: 3.0 },
            terri_core::Facing::SouthEast,
        );
        assert_ne!(device, second);
        sim.world_mut().entity_mut(b).insert(Target {
            object: second,
            interaction: 0,
        });
        sim.world_mut()
            .entity_mut(a)
            .insert(Relationships::default());
        sim.world_mut()
            .entity_mut(b)
            .insert(Relationships::default());
        crate::relationship_effects::reset(sim.world_mut());
        tick(sim.world_mut());
        assert!((feeling(&sim, a, SimId(1)) - 0.002 / 60.0).abs() < 0.0000001);
        assert_eq!(sim.relationship_effects().len(), 2);
        assert!(sim
            .relationship_effects()
            .iter()
            .all(|e| e.cause == crate::relationship_effects::RelationshipCause::Proximity));
    }

    /// What one watcher's minute toward the other paid: the communal rate,
    /// ordinary proximity, or nothing.
    fn minute_cause(
        sim: &mut Sim,
        subject: Entity,
        feeling_toward_other: f32,
        minute: u64,
    ) -> Option<RelationshipCause> {
        let mut feelings = Relationships::default();
        feelings.bump(SimId(1), feeling_toward_other);
        sim.world_mut().entity_mut(subject).insert(feelings);
        sim.world_mut().resource_mut::<SimClock>().tick = minute;
        crate::relationship_effects::reset(sim.world_mut());
        tick(sim.world_mut());
        sim.relationship_effects()
            .iter()
            .find(|e| e.affected == SimId(0) && e.responsible == SimId(1))
            .map(|e| e.cause)
    }

    fn watching_with_chance(chance: f32) -> (Sim, Entity, Entity) {
        let (mut sim, a, b) = pair();
        let mut pack = sim.world().resource::<Content>().0.clone();
        pack.tuning.hated_communal_chance = chance;
        sim.world_mut()
            .insert_resource(Content(Box::leak(Box::new(pack))));
        watching_together(&mut sim, a, b);
        (sim, a, b)
    }

    /// Hatred does not block a communal gain outright: the tuned chance
    /// decides each contact minute, and a minute the roll refuses still
    /// pays ordinary proximity. The cutoff is the one grief uses for a
    /// hated person, and only the hater's own minutes are rolled.
    #[test]
    fn a_hated_viewer_still_warms_on_the_tuned_fraction_of_minutes() {
        let shipped = terri_data::pack().tuning;
        assert_eq!(shipped.hated_communal_chance, 0.35);
        let hates = shipped.grief_hated_affinity;
        assert_eq!(hates, -0.5);
        let causes = |chance: f32, feeling: f32, minutes: u64| -> Vec<RelationshipCause> {
            let (mut sim, a, _) = watching_with_chance(chance);
            (0..minutes)
                .map(|minute| minute_cause(&mut sim, a, feeling, minute).expect("a→b effect"))
                .collect()
        };
        let communal = |causes: &[RelationshipCause]| {
            causes
                .iter()
                .filter(|&&c| c == RelationshipCause::SharedActivity)
                .count()
        };
        let at_shipped = causes(0.35, hates, 400);
        let warmed = communal(&at_shipped);
        assert!(
            (100..=180).contains(&warmed),
            "about 35% of 400 minutes should pay the communal rate, not {warmed}"
        );
        assert!(
            at_shipped
                .iter()
                .all(|&c| c == RelationshipCause::SharedActivity
                    || c == RelationshipCause::Proximity),
            "a refused minute still pays proximity"
        );
        assert!(
            at_shipped.contains(&RelationshipCause::Proximity),
            "some minutes are refused"
        );
        for feeling in [hates, -1.0] {
            assert_eq!(
                communal(&causes(0.0, feeling, 60)),
                0,
                "0 refuses every minute at {feeling}"
            );
            assert_eq!(
                communal(&causes(1.0, feeling, 60)),
                60,
                "1 refuses none at {feeling}"
            );
        }
        // Just above the cutoff the chance no longer applies.
        assert_eq!(communal(&causes(0.0, hates + 0.01, 60)), 60);
        // The other watcher does not hate anybody, so their minutes are
        // never rolled.
        let (mut sim, a, _) = watching_with_chance(0.0);
        minute_cause(&mut sim, a, hates, 7);
        assert!(sim
            .relationship_effects()
            .iter()
            .any(|e| e.affected == SimId(1)
                && e.responsible == SimId(0)
                && e.cause == RelationshipCause::SharedActivity));
    }

    /// Two games with different saved generator states roll different
    /// minutes, so the pattern is not a fixed property of the tick alone;
    /// the same state always rolls the same way.
    #[test]
    fn the_hated_roll_follows_the_saved_generator_without_consuming_it() {
        let pattern = |seed: u64| -> Vec<bool> {
            let (mut sim, a, _) = watching_with_chance(0.35);
            sim.world_mut()
                .insert_resource(terri_core::SimRng::from_seed(seed));
            let before = sim.world().resource::<terri_core::SimRng>().clone();
            let pattern = (0..120)
                .map(|minute| {
                    minute_cause(&mut sim, a, -0.5, minute)
                        == Some(RelationshipCause::SharedActivity)
                })
                .collect();
            assert_eq!(
                *sim.world().resource::<terri_core::SimRng>(),
                before,
                "the roll draws nothing from the shared stream"
            );
            pattern
        };
        assert_eq!(pattern(5), pattern(5));
        assert_ne!(pattern(5), pattern(6));
    }

    /// A refused minute is ordinary company at the proximity rate, not a
    /// friction minute: the shared activity still suspends incompatibility
    /// for a hated, incompatible pair.
    #[test]
    fn a_refused_minute_pays_proximity_and_keeps_friction_suspended() {
        let (mut sim, a, b) = watching_with_chance(0.0);
        let pack = sim.world().resource::<Content>().0;
        let reading = pack.find("bookshelf").unwrap();
        let exercise = pack.find("moving_box").unwrap();
        for (entity, weight) in [(a, 2.0), (b, 0.0)] {
            sim.world_mut()
                .entity_mut(entity)
                .insert(Personality::with_dispositions(
                    [1.0; 7],
                    [1.0; 7],
                    vec![(exercise, 0, weight), (reading, 0, 1.0)],
                ));
        }
        let score = sim.compatibility(SimId(0), SimId(1)).unwrap();
        let rates = pack.tuning.relationships;
        assert!(
            score < rates.incompatible_below,
            "the pair is incompatible: {score}"
        );
        for minute in 0..30 {
            assert_eq!(
                minute_cause(&mut sim, a, pack.tuning.grief_hated_affinity, minute),
                Some(RelationshipCause::Proximity)
            );
            assert!(
                (feeling(&sim, a, SimId(1))
                    - (pack.tuning.grief_hated_affinity + rates.proximity_per_hour / 60.0))
                    .abs()
                    < 1e-7
            );
        }
        // The same pair, not hated, is a plain friction case once the
        // television is gone: nothing here has changed the ordinary rule.
        sim.world_mut()
            .entity_mut(a)
            .remove::<Target>()
            .remove::<Eating>();
        sim.world_mut()
            .entity_mut(b)
            .remove::<Target>()
            .remove::<Eating>();
        assert_eq!(
            minute_cause(&mut sim, a, 0.0, 31),
            Some(RelationshipCause::Incompatibility)
        );
    }

    #[test]
    fn contact_excludes_walls_distance_sleep_private_use_commutes_and_conversations() {
        for case in [
            "wall", "distance", "sleep", "private", "commute", "work", "talk",
        ] {
            let (mut sim, a, b) = pair();
            let pack = sim.world().resource::<Content>().0;
            match case {
                "wall" => {
                    use terri_core::layout::{EdgeAxis, SavedLayout, WallEdge};
                    sim.world_mut().insert_resource(SavedLayout::EdgeWallsV1 {
                        edges: (0..8)
                            .map(|y| WallEdge {
                                axis: EdgeAxis::Vertical,
                                x: 3,
                                y,
                                doorway: false,
                            })
                            .collect(),
                    });
                    crate::test_content::enclose(&mut sim);
                    assert_eq!(
                        sim.world()
                            .resource::<crate::rooms::RoomMap>()
                            .topology
                            .components
                            .len(),
                        2
                    );
                }
                "distance" => {
                    sim.world_mut().get_mut::<Position>(b).unwrap().x = 7.0;
                }
                "commute" => {
                    sim.world_mut().entity_mut(b).insert(Commuting::Outbound);
                }
                "work" => {
                    sim.world_mut().entity_mut(b).insert(AtWork {
                        remaining_ticks: 20,
                    });
                }
                "talk" => {
                    sim.world_mut().entity_mut(b).insert(terri_core::Reserved);
                    sim.world_mut().entity_mut(a).insert(Socialising {
                        interaction: 0,
                        partner: b,
                        remaining_ticks: 20,
                    });
                }
                _ => {
                    let def = if case == "sleep" {
                        pack.objects
                            .iter()
                            .position(|o| {
                                o.interactions
                                    .iter()
                                    .any(|a| a.tags.iter().any(|t| t == &pack.sleep_tag))
                            })
                            .unwrap()
                    } else {
                        pack.find("toilet").unwrap().0 as usize
                    };
                    let object = sim.spawn_object(
                        Position { x: 5.0, y: 5.0 },
                        terri_core::ObjectDefId(def as u32),
                    );
                    sim.world_mut().entity_mut(a).insert((
                        Target {
                            object,
                            interaction: 0,
                        },
                        Eating {
                            object: terri_core::ObjectDefId(def as u32),
                            interaction: 0,
                            remaining_ticks: 20,
                        },
                    ));
                }
            }
            tick(sim.world_mut());
            assert_eq!(feeling(&sim, a, SimId(1)), 0.0, "{case}");
            assert_eq!(feeling(&sim, b, SimId(0)), 0.0, "{case}");
        }
    }

    #[test]
    fn shared_activity_suspends_friction_but_failed_or_disliked_activity_does_not() {
        for (failed, disliked) in [(false, false), (true, false), (false, true)] {
            let (mut sim, a, b) = pair();
            let pack = sim.world().resource::<Content>().0;
            let reading = pack.find("bookshelf").unwrap();
            let exercise = pack.find("moving_box").unwrap();
            for (entity, weight, x) in [(a, 2.0, 1.0), (b, 0.0, 4.0)] {
                let personality = Personality::with_dispositions(
                    [1.0; 7],
                    [1.0; 7],
                    vec![
                        (exercise, 0, weight),
                        (reading, 0, if disliked && entity == a { 0.0 } else { 1.0 }),
                    ],
                );
                let object = sim.spawn_object(Position { x, y: 3.0 }, reading);
                sim.world_mut().entity_mut(entity).insert((
                    personality,
                    Target {
                        object,
                        interaction: 0,
                    },
                    Eating {
                        object: reading,
                        interaction: 0,
                        remaining_ticks: 20,
                    },
                ));
            }
            if failed {
                sim.world_mut()
                    .entity_mut(a)
                    .insert(terri_core::Fumbled { delta_scale: 0.5 });
            }
            tick(sim.world_mut());
            if failed || disliked {
                assert!(feeling(&sim, a, SimId(1)) < 0.0);
            } else {
                assert!((feeling(&sim, a, SimId(1)) - 0.02 / 60.0 * 0.25).abs() < 1e-8);
            }
        }
    }
}
