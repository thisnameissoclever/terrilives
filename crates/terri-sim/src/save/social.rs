//! Capture and transactional restoration of social episode continuations.
use super::SaveError;
use crate::{
    social_episode::{CommunalEpisode, SocialEpisodes, Topic},
    Content, Sim,
};
use bevy_ecs::prelude::World;
use std::collections::{BTreeMap, BTreeSet};
use terri_core::{save_v9::*, FnvHasher, SavedTarget, SimId, Socialising, Target};

pub(super) fn capture(world: &World) -> SavedSocialEpisodes {
    let state = world.resource::<SocialEpisodes>();
    let mut saved = SavedSocialEpisodes {
        rendezvous: state
            .rendezvous
            .iter()
            .map(|(r, i)| (r.index_u32(), i.index_u32()))
            .collect(),
        topics: state
            .topics
            .iter()
            .map(|(i, t)| SavedTopic {
                initiator: i.index_u32(),
                code: t.code,
                tag: t.tag.clone(),
                initiator_preference: t.initiator_preference,
                listener_preference: t.listener_preference,
            })
            .collect(),
        communal: state
            .communal
            .iter()
            .map(|(owner, c)| SavedCommunalEpisode {
                owner: owner.index_u32(),
                target: SavedTarget {
                    object: c.target.object.index_u32(),
                    interaction: c.target.interaction,
                },
                extensions: c.extensions,
                participants: c.participants.iter().map(|p| p.index_u32()).collect(),
                remaining: c.remaining,
                completed_novelty: c.completed_novelty,
            })
            .collect(),
    };
    saved.rendezvous.sort_unstable();
    saved.topics.sort_by_key(|t| t.initiator);
    saved.communal.sort_by_key(|c| c.owner);
    for episode in &mut saved.communal {
        episode.participants.sort_unstable();
    }
    saved
}

impl Sim {
    /// Frozen published social envelope; use V10 for current character persistence.
    pub fn save_snapshot_v9(&self) -> SaveSnapshotV9 {
        SaveSnapshotV9 {
            legacy: self.save_snapshot_v6(),
            social: capture(&self.world),
        }
    }

    pub fn load_snapshot_v9(&mut self, snapshot: SaveSnapshotV9) -> Result<(), SaveError> {
        let content = self.world.resource::<Content>().0;
        let portals = self
            .world
            .get_resource::<crate::portals::ActivePortals>()
            .copied();
        let candidate =
            super::v6::restore_with_social(snapshot.legacy, snapshot.social, content, portals)?;
        self.adopt_current(candidate);
        Ok(())
    }
}

pub(super) fn restore_into(
    candidate: &mut Sim,
    social: SavedSocialEpisodes,
    saved_people: BTreeMap<u32, u32>,
    source_targets: BTreeMap<u32, SavedTarget>,
) -> Result<(), SaveError> {
    let content = candidate.world.resource::<Content>().0;
    let identities: BTreeMap<_, _> = candidate
        .world
        .query::<(terri_core::Entity, &SimId)>()
        .iter(&candidate.world)
        .map(|(entity, id)| (id.0, entity))
        .collect();
    let mut people = BTreeMap::new();
    for (old, id) in saved_people {
        let entity = identities
            .get(&id)
            .copied()
            .ok_or(SaveError::InvalidEntityReference)?;
        people.insert(old, entity);
    }
    let person = |index: &u32| {
        people
            .get(index)
            .copied()
            .ok_or(SaveError::InvalidEntityReference)
    };
    let mut state = SocialEpisodes::default();
    if social.rendezvous.len() > super::MAX_ENTITIES
        || social.topics.len() > super::MAX_ENTITIES
        || social.communal.len() > super::MAX_ENTITIES
    {
        return Err(SaveError::TooManyEntities);
    }
    let mut initiators = BTreeSet::new();
    for (r, i) in social.rendezvous {
        let (r, i) = (person(&r)?, person(&i)?);
        if r == i || state.rendezvous.insert(r, i).is_some() || !initiators.insert(i) {
            return Err(SaveError::InvalidValue);
        }
        if candidate
            .world
            .get::<Target>(i)
            .is_none_or(|t| t.object != r)
        {
            return Err(SaveError::InvalidEntityReference);
        }
    }
    let mut checked = BTreeSet::new();
    for recipient in state.rendezvous.keys() {
        let mut visited = BTreeSet::new();
        let mut current = *recipient;
        while let Some(initiator) = state.rendezvous.get(&current) {
            if checked.contains(&current) {
                break;
            }
            if !visited.insert(current) {
                return Err(SaveError::InvalidValue);
            }
            current = *initiator;
        }
        checked.extend(visited);
    }
    for t in social.topics {
        let i = person(&t.initiator)?;
        if candidate
            .world
            .get::<Socialising>(i)
            .is_none_or(|s| s.partner == i || candidate.world.get::<SimId>(s.partner).is_none())
        {
            return Err(SaveError::InvalidEntityReference);
        }
        // Fights (issue 248): a fight carries exactly a fight topic, with
        // both preferences at -1; a chat never does.
        let fighting = candidate
            .world
            .get::<Socialising>(i)
            .and_then(|s| content.social.get(s.interaction as usize))
            .is_some_and(crate::fights::is_fight);
        let fight_topic = crate::fights::Reason::from_tag(&t.tag);
        if fighting != fight_topic.is_some() {
            return Err(SaveError::InvalidValue);
        }
        if let Some(reason) = fight_topic {
            if t.code != crate::fights::Reason::code(reason)
                || t.initiator_preference != -1.0
                || t.listener_preference != -1.0
            {
                return Err(SaveError::InvalidValue);
            }
            if state
                .topics
                .insert(
                    i,
                    Topic {
                        code: t.code,
                        tag: t.tag,
                        initiator_preference: -1.0,
                        listener_preference: -1.0,
                    },
                )
                .is_some()
            {
                return Err(SaveError::InvalidValue);
            }
            continue;
        }
        if !(3..=23).contains(&t.code)
            || t.code == 6
            || t.tag.is_empty()
            || t.tag.len() > super::MAX_TEXT_BYTES
            || (t.tag != "smalltalk" && t.code != crate::social_episode::tag_code(&t.tag))
            || (t.tag == "smalltalk"
                && (t.code != 4 || t.initiator_preference != 0.0 || t.listener_preference != 0.0))
            || !t.initiator_preference.is_finite()
            || !t.listener_preference.is_finite()
            || !(-1.0..=1.0).contains(&t.initiator_preference)
            || !(-1.0..=1.0).contains(&t.listener_preference)
            || (t.initiator_preference <= 0.0
                && !(t.initiator_preference == 0.0
                    && t.code == 4
                    && t.tag == "smalltalk"
                    && t.listener_preference == 0.0))
            || candidate.world.get::<Socialising>(i).is_none()
        {
            return Err(SaveError::InvalidValue);
        }
        if state
            .topics
            .insert(
                i,
                Topic {
                    code: t.code,
                    tag: t.tag,
                    initiator_preference: t.initiator_preference,
                    listener_preference: t.listener_preference,
                },
            )
            .is_some()
        {
            return Err(SaveError::InvalidValue);
        }
    }
    for c in social.communal {
        let owner = person(&c.owner)?;
        if source_targets.get(&c.owner) != Some(&c.target) {
            return Err(SaveError::InvalidEntityReference);
        }
        if c.extensions > 2 || c.participants.len() > super::MAX_ENTITIES {
            return Err(SaveError::InvalidValue);
        }
        if c.completed_novelty
            .is_some_and(|value| !value.is_finite() || !(0.0..=1.0).contains(&value))
        {
            return Err(SaveError::InvalidValue);
        }
        let mapped_target = candidate
            .world
            .get::<crate::reading::ReadingJourney>(owner)
            .map(|journey| journey.origin)
            .or_else(|| candidate.world.get::<Target>(owner).copied())
            .ok_or(SaveError::InvalidEntityReference)?;
        let object = mapped_target.object;
        let reading_owner = candidate
            .world
            .get::<crate::reading::ReadingJourney>(owner)
            .is_some_and(|journey| {
                journey.origin.object == object
                    && journey.origin.interaction == mapped_target.interaction
                    && (journey.stage == terri_core::save_v6::ReadingStage::Read
                        || c.extensions > 0
                        || c.completed_novelty.is_some()
                        || content
                            .reading
                            .as_ref()
                            .is_some_and(|tuning| journey.elapsed >= tuning.session_ticks))
            });
        let ordinary_owner = !candidate.world.get::<Target>(owner).is_none_or(|target| {
            target.object != object || target.interaction != mapped_target.interaction
        }) && (candidate.world.get::<terri_core::Eating>(owner).is_some()
            || candidate.world.get::<terri_core::StepWork>(owner).is_some());
        if !(reading_owner || ordinary_owner) {
            return Err(SaveError::InvalidValue);
        }
        if !reading_owner && (c.remaining != 0 || c.completed_novelty.is_some()) {
            return Err(SaveError::InvalidValue);
        }
        let model = candidate
            .world
            .get::<terri_core::SmartObject>(object)
            .ok_or(SaveError::InvalidEntityReference)?;
        let meal_sentinel = mapped_target.interaction == crate::systems::chain::CHAIN_STEP
            && candidate.world.get::<terri_core::StepWork>(owner).is_some()
            && candidate
                .world
                .get::<terri_core::ChainState>(owner)
                .is_some()
            && crate::dining::terminal(&candidate.world, owner);
        if !meal_sentinel
            && content
                .objects
                .get(model.0 .0 as usize)
                .is_none_or(|o| mapped_target.interaction as usize >= o.interactions.len())
        {
            return Err(SaveError::InvalidContentReference);
        }
        let mut participants = BTreeSet::new();
        for p in c.participants {
            let peer = person(&p)?;
            if peer == owner || !participants.insert(peer) {
                return Err(SaveError::InvalidValue);
            }
        }
        if state
            .communal
            .insert(
                owner,
                CommunalEpisode {
                    target: mapped_target,
                    extensions: c.extensions,
                    participants,
                    remaining: c.remaining,
                    completed_novelty: c.completed_novelty,
                },
            )
            .is_some()
        {
            return Err(SaveError::InvalidValue);
        }
    }
    candidate.world.insert_resource(state);
    Ok(())
}

pub(crate) fn hash(world: &World, hash: &mut FnvHasher) {
    let saved = capture(world);
    if saved.rendezvous.is_empty() && saved.topics.is_empty() && saved.communal.is_empty() {
        return;
    }
    hash.write_bytes(b"social-episodes-v1");
    hash.write_u64(saved.rendezvous.len() as u64);
    for (r, i) in saved.rendezvous {
        hash.write_u64(r.into());
        hash.write_u64(i.into());
    }
    hash.write_u64(saved.topics.len() as u64);
    for t in saved.topics {
        hash.write_u64(t.initiator.into());
        hash.write_u64(t.code.into());
        hash.write_u64(t.tag.len() as u64);
        hash.write_bytes(t.tag.as_bytes());
        hash.write_f32(t.initiator_preference);
        hash.write_f32(t.listener_preference);
    }
    hash.write_u64(saved.communal.len() as u64);
    for c in saved.communal {
        hash.write_u64(c.owner.into());
        hash.write_u64(c.target.object.into());
        hash.write_u64(c.target.interaction.into());
        hash.write_u64(c.extensions.into());
        hash.write_u64(c.remaining.into());
        hash.write_u64(u64::from(c.completed_novelty.is_some()));
        if let Some(novelty) = c.completed_novelty {
            hash.write_f32(novelty);
        }
        hash.write_u64(c.participants.len() as u64);
        for p in c.participants {
            hash.write_u64(p.into());
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn populated() -> Sim {
        let mut sim = Sim::new_from_shipped_lot();
        let people: Vec<_> = sim
            .world
            .query::<(terri_core::Entity, &SimId)>()
            .iter(&sim.world)
            .map(|(e, _)| e)
            .collect();
        let (a, b, c) = (people[0], people[1], people[2]);
        fn contact(
            sim: &Sim,
            object: terri_core::Entity,
            footprint: terri_core::Footprint,
        ) -> terri_core::Position {
            let at = sim.world.get::<terri_core::Position>(object).unwrap();
            let grid = sim.world.resource::<terri_core::TileGrid>();
            let tile = (0..grid.height())
                .flat_map(|y| (0..grid.width()).map(move |x| (x as i32, y as i32)))
                .find(|tile| {
                    grid.is_walkable(tile.0, tile.1)
                        && grid.can_interact_with_rect(
                            *tile,
                            (at.x.round() as i32, at.y.round() as i32),
                            footprint,
                        )
                })
                .unwrap();
            terri_core::Position {
                x: tile.0 as f32,
                y: tile.1 as f32,
            }
        }
        let adjacent = contact(&sim, b, terri_core::Footprint { width: 1, depth: 1 });
        sim.world.entity_mut(a).insert(adjacent);
        sim.world.entity_mut(a).insert((
            Target {
                object: b,
                interaction: 0,
            },
            Socialising {
                partner: b,
                interaction: 0,
                remaining_ticks: 30,
            },
        ));
        let content = sim.world.resource::<Content>().0;
        let bike = content.find("moving_box").unwrap();
        let footprint = crate::placed_footprint(content, bike, None);
        let grid = sim.world.resource::<terri_core::TileGrid>();
        let tile = (0..grid.height())
            .flat_map(|y| (0..grid.width()).map(move |x| (x, y)))
            .find(|&(x, y)| {
                (0..footprint.depth).all(|dy| {
                    (0..footprint.width).all(|dx| {
                        grid.is_walkable((x + dx as usize) as i32, (y + dy as usize) as i32)
                    })
                })
            })
            .unwrap();
        let target = sim.spawn_object(
            terri_core::Position {
                x: tile.0 as f32,
                y: tile.1 as f32,
            },
            bike,
        );
        let model = sim.world.get::<terri_core::SmartObject>(target).unwrap().0;
        let footprint = crate::placed_footprint(
            content,
            model,
            sim.world.get::<terri_core::ObjectFacing>(target),
        );
        let adjacent = contact(&sim, target, footprint);
        sim.world.entity_mut(c).insert((
            adjacent,
            Target {
                object: target,
                interaction: 0,
            },
            terri_core::Eating {
                object: model,
                interaction: 0,
                remaining_ticks: 17,
            },
        ));
        {
            let mut state = sim.world.resource_mut::<SocialEpisodes>();
            state.rendezvous.insert(b, a);
            state.topics.insert(
                a,
                Topic {
                    code: 7,
                    tag: "unknown-authored-topic".into(),
                    initiator_preference: 0.8,
                    listener_preference: -0.2,
                },
            );
            state.communal.insert(
                c,
                CommunalEpisode {
                    target: Target {
                        object: target,
                        interaction: 0,
                    },
                    extensions: 2,
                    participants: BTreeSet::from([a]),
                    remaining: 0,
                    completed_novelty: None,
                },
            );
        }
        sim
    }

    #[test]
    fn active_conversation_can_have_an_inbound_waiter_without_a_claim_cycle() {
        let mut source = populated();
        let (recipient, initiator) = source
            .world
            .resource::<SocialEpisodes>()
            .rendezvous
            .iter()
            .next()
            .map(|(r, i)| (*r, *i))
            .unwrap();
        let waiter = source
            .world
            .query::<(terri_core::Entity, &SimId)>()
            .iter(&source.world)
            .map(|(e, _)| e)
            .find(|e| *e != recipient && *e != initiator)
            .unwrap();
        source
            .world
            .resource_mut::<SocialEpisodes>()
            .communal
            .remove(&waiter);
        source
            .world
            .entity_mut(waiter)
            .remove::<terri_core::Eating>()
            .insert(Target {
                object: initiator,
                interaction: 0,
            });
        source
            .world
            .resource_mut::<SocialEpisodes>()
            .rendezvous
            .insert(initiator, waiter);
        let saved = source.save_snapshot_v10();
        let mut restored = Sim::new_from_shipped_lot();
        restored.load_snapshot_v10(saved.clone()).unwrap();
        assert_eq!(restored.save_snapshot_v10(), saved);
        let mut cyclic = saved;
        cyclic
            .social
            .rendezvous
            .push((waiter.index_u32(), recipient.index_u32()));
        let row = cyclic
            .legacy
            .legacy
            .world
            .entities
            .iter_mut()
            .find(|row| row.index == recipient.index_u32())
            .unwrap();
        row.target = Some(SavedTarget {
            object: waiter.index_u32(),
            interaction: 0,
        });
        assert!(restored.load_snapshot_v10(cyclic).is_err());
    }

    /// Fights (issue 248): a fight's topic is one of the three fight tags
    /// with its code and both preferences at -1, and only a fight carries
    /// one; a chat topic on a fight, or a fight topic on a chat, refuses
    /// the load.
    #[test]
    fn a_fight_topic_loads_only_on_a_fight() {
        let pack = terri_data::pack();
        let fight = crate::fights::fight_index(pack).expect("the shipped pack has a fight");
        let mut source = populated();
        let initiator = *source
            .world
            .resource::<SocialEpisodes>()
            .topics
            .keys()
            .next()
            .unwrap();
        source
            .world
            .get_mut::<Socialising>(initiator)
            .unwrap()
            .interaction = fight;
        source.world.resource_mut::<SocialEpisodes>().topics.insert(
            initiator,
            Topic {
                code: 26,
                tag: "fight".into(),
                initiator_preference: -1.0,
                listener_preference: -1.0,
            },
        );
        let saved = source.save_snapshot_v10();
        let mut restored = Sim::new_from_shipped_lot();
        restored.load_snapshot_v10(saved.clone()).unwrap();
        assert_eq!(restored.save_snapshot_v10(), saved);
        let row = saved
            .social
            .topics
            .iter()
            .position(|t| t.initiator == initiator.index_u32())
            .unwrap();
        let refuse = |case: &str, change: &dyn Fn(&mut terri_core::SaveSnapshotV10)| {
            let mut invalid = saved.clone();
            change(&mut invalid);
            let mut live = Sim::new_from_shipped_lot();
            let before = live.world_hash();
            assert!(live.load_snapshot_v10(invalid).is_err(), "{case}");
            assert_eq!(live.world_hash(), before, "{case}");
        };
        refuse("a chat topic on a fight", &|s| {
            s.social.topics[row].code = 8;
            s.social.topics[row].tag = "reading".into();
            s.social.topics[row].initiator_preference = 0.5;
        });
        refuse("the wrong code for the tag", &|s| {
            s.social.topics[row].code = 25;
        });
        refuse("a preference that is not -1", &|s| {
            s.social.topics[row].listener_preference = 0.0;
        });
        refuse("a fight topic on a chat", &|s| {
            s.legacy
                .legacy
                .world
                .entities
                .iter_mut()
                .find(|r| r.index == initiator.index_u32())
                .unwrap()
                .socialising
                .as_mut()
                .unwrap()
                .interaction = 0;
        });
    }

    #[test]
    fn current_social_records_round_trip_without_drawing_rng() {
        let source = populated();
        let saved = source.save_snapshot_v10();
        let mut restored = Sim::new_from_shipped_lot();
        restored.load_snapshot_v10(saved.clone()).unwrap();
        assert_eq!(restored.save_snapshot_v10(), saved);
    }

    #[test]
    fn combined_save_keeps_active_social_episodes_appearance_and_queued_character_edits() {
        let mut source = populated();
        let entity = crate::edit::living_entity(source.world(), 0).unwrap();
        let mut appearance = terri_core::appearance::CharacterAppearanceV1::default();
        appearance.body.height = 83;
        source.world_mut().entity_mut(entity).insert((
            appearance,
            terri_core::character::CharacterPronouns("they/them".into()),
        ));
        source
            .world_mut()
            .resource_mut::<terri_core::CommandQueue>()
            .push(terri_core::SimCommand::Character(Box::new(
                terri_core::command::CharacterCommand::Edit {
                    request: 77,
                    sim: 0,
                    patch: terri_core::character::CharacterPatchV1 {
                        name: Some("Ann".into()),
                        ..Default::default()
                    },
                },
            )));
        let saved = source.save_snapshot_v10();
        assert!(!saved.social.topics.is_empty());
        assert!(!saved.social.communal.is_empty());
        assert!(!saved.social.rendezvous.is_empty());
        let mut restored = Sim::new_from_shipped_lot();
        restored.load_snapshot_v10(saved.clone()).unwrap();
        assert_eq!(restored.save_snapshot_v10(), saved);
        source.flush_commands();
        restored.flush_commands();
        assert_eq!(restored.save_snapshot_v10(), source.save_snapshot_v10());
        for _ in 0..40 {
            source.tick();
            restored.tick();
        }
        assert_eq!(restored.save_snapshot_v10(), source.save_snapshot_v10());
    }

    #[test]
    fn invalid_social_records_leave_live_world_unchanged() {
        let source = populated();
        let original = source.save_snapshot_v10();
        let mut live = Sim::new_from_shipped_lot();
        let before = live.save_snapshot_v10();
        for mode in 0..6 {
            let mut invalid = original.clone();
            match mode {
                0 => invalid.social.topics[0].initiator_preference = f32::NAN,
                1 => invalid.social.topics[0].code = 2,
                2 => invalid.social.topics[0].initiator_preference = 0.0,
                3 => invalid.social.communal[0].extensions = 3,
                4 => {
                    let duplicate = invalid.social.communal[0].participants[0];
                    invalid.social.communal[0].participants.push(duplicate);
                }
                _ => invalid.social.rendezvous.push(invalid.social.rendezvous[0]),
            }
            assert!(live.load_snapshot_v10(invalid).is_err());
            assert_eq!(live.save_snapshot_v10(), before);
        }
    }

    fn isolated_hash_sample() -> (World, [terri_core::Entity; 4]) {
        let mut world = World::new();
        let entities = std::array::from_fn(|_| world.spawn_empty().id());
        assert_eq!(entities.map(|entity| entity.index_u32()), [0, 1, 2, 3]);
        world.insert_resource(SocialEpisodes {
            rendezvous: BTreeMap::from([(entities[1], entities[0])]),
            topics: BTreeMap::from([(
                entities[0],
                Topic {
                    code: 8,
                    tag: "reading".into(),
                    initiator_preference: 0.75,
                    listener_preference: -0.5,
                },
            )]),
            communal: BTreeMap::from([(
                entities[2],
                CommunalEpisode {
                    target: Target {
                        object: entities[3],
                        interaction: 1,
                    },
                    extensions: 1,
                    participants: BTreeSet::from([entities[0], entities[1]]),
                    remaining: 17,
                    completed_novelty: Some(0.25),
                },
            )]),
        });
        (world, entities)
    }

    fn isolated_digest(world: &World) -> u64 {
        let mut digest = FnvHasher::default();
        hash(world, &mut digest);
        digest.finish()
    }

    fn assert_social_hash_change(
        change: impl FnOnce(&mut SocialEpisodes, [terri_core::Entity; 4]),
    ) {
        let (mut world, entities) = isolated_hash_sample();
        let before = isolated_digest(&world);
        change(&mut world.resource_mut::<SocialEpisodes>(), entities);
        assert_ne!(
            isolated_digest(&world),
            before,
            "the changed social field was omitted"
        );
    }

    #[test]
    fn hash_stream_matches_independent_vector() {
        let (world, _) = isolated_hash_sample();
        // Independently calculated FNV-1a over the 185-byte social stream.
        // This pins domain, vector lengths and optional-value presence.
        assert_eq!(isolated_digest(&world), 0xd36a_f8ef_82e0_2352);
    }

    macro_rules! social_hash_case {
        ($name:ident, $change:expr) => {
            #[test]
            fn $name() {
                assert_social_hash_change($change);
            }
        };
    }

    social_hash_case!(hash_rendezvous_count, |s, e| {
        s.rendezvous.remove(&e[1]);
    });
    social_hash_case!(hash_rendezvous_recipient, |s, e| {
        let i = s.rendezvous.remove(&e[1]).unwrap();
        s.rendezvous.insert(e[3], i);
    });
    social_hash_case!(hash_rendezvous_initiator, |s, e| {
        s.rendezvous.insert(e[1], e[2]);
    });
    social_hash_case!(hash_topic_count, |s, e| {
        s.topics.remove(&e[0]);
    });
    social_hash_case!(hash_topic_initiator, |s, e| {
        let t = s.topics.remove(&e[0]).unwrap();
        s.topics.insert(e[2], t);
    });
    social_hash_case!(hash_topic_code, |s, e| {
        s.topics.get_mut(&e[0]).unwrap().code = 9;
    });
    social_hash_case!(hash_topic_tag_length, |s, e| {
        s.topics.get_mut(&e[0]).unwrap().tag = "reading-long".into();
    });
    social_hash_case!(hash_topic_tag_bytes, |s, e| {
        s.topics.get_mut(&e[0]).unwrap().tag = "cooking".into();
    });
    social_hash_case!(hash_topic_initiator_preference, |s, e| {
        s.topics.get_mut(&e[0]).unwrap().initiator_preference = 0.5;
    });
    social_hash_case!(hash_topic_listener_preference, |s, e| {
        s.topics.get_mut(&e[0]).unwrap().listener_preference = -0.25;
    });
    social_hash_case!(hash_communal_count, |s, e| {
        s.communal.remove(&e[2]);
    });
    social_hash_case!(hash_communal_owner, |s, e| {
        let c = s.communal.remove(&e[2]).unwrap();
        s.communal.insert(e[0], c);
    });
    social_hash_case!(hash_communal_target_object, |s, e| {
        s.communal.get_mut(&e[2]).unwrap().target.object = e[1];
    });
    social_hash_case!(hash_communal_target_interaction, |s, e| {
        s.communal.get_mut(&e[2]).unwrap().target.interaction = 2;
    });
    social_hash_case!(hash_communal_extensions, |s, e| {
        s.communal.get_mut(&e[2]).unwrap().extensions = 2;
    });
    social_hash_case!(hash_communal_remaining, |s, e| {
        s.communal.get_mut(&e[2]).unwrap().remaining = 18;
    });
    social_hash_case!(hash_completed_novelty_presence, |s, e| {
        s.communal.get_mut(&e[2]).unwrap().completed_novelty = None;
    });
    social_hash_case!(hash_completed_novelty_value, |s, e| {
        s.communal.get_mut(&e[2]).unwrap().completed_novelty = Some(0.5);
    });
    social_hash_case!(hash_participant_count, |s, e| {
        s.communal
            .get_mut(&e[2])
            .unwrap()
            .participants
            .remove(&e[1]);
    });
    social_hash_case!(hash_participant_identity, |s, e| {
        let p = &mut s.communal.get_mut(&e[2]).unwrap().participants;
        p.remove(&e[1]);
        p.insert(e[3]);
    });

    #[test]
    fn empty_social_state_preserves_the_legacy_digest() {
        let mut world = World::new();
        world.insert_resource(SocialEpisodes::default());
        assert_eq!(isolated_digest(&world), FnvHasher::default().finish());
    }

    fn assert_invalid_social_change(
        change: impl FnOnce(&mut terri_core::save_v9::SavedSocialEpisodes),
    ) {
        let source = populated();
        let mut invalid = source.save_snapshot_v10();
        change(&mut invalid.social);
        let mut live = Sim::new_from_shipped_lot();
        let before = live.save_snapshot_v10();
        assert!(
            live.load_snapshot_v10(invalid).is_err(),
            "invalid social state was accepted"
        );
        assert_eq!(
            live.save_snapshot_v10(),
            before,
            "failed restore changed the live world"
        );
    }

    macro_rules! invalid_social_case {
        ($name:ident, $change:expr) => {
            #[test]
            fn $name() {
                assert_invalid_social_change($change);
            }
        };
    }

    invalid_social_case!(invalid_rendezvous_recipient_is_rejected, |s| {
        s.rendezvous[0].0 = u32::MAX;
    });
    invalid_social_case!(invalid_rendezvous_initiator_is_rejected, |s| {
        s.rendezvous[0].1 = u32::MAX;
    });
    invalid_social_case!(invalid_topic_initiator_is_rejected, |s| {
        s.topics[0].initiator = u32::MAX;
    });
    invalid_social_case!(invalid_topic_code_is_rejected, |s| {
        s.topics[0].code = 6;
    });
    invalid_social_case!(invalid_topic_tag_is_rejected, |s| {
        s.topics[0].tag = "x".repeat(super::super::MAX_TEXT_BYTES + 1);
    });
    invalid_social_case!(invalid_topic_initiator_preference_is_rejected, |s| {
        s.topics[0].initiator_preference = f32::NAN;
    });
    invalid_social_case!(invalid_topic_listener_preference_is_rejected, |s| {
        s.topics[0].listener_preference = 1.01;
    });
    invalid_social_case!(invalid_communal_owner_is_rejected, |s| {
        s.communal[0].owner = u32::MAX;
    });
    invalid_social_case!(invalid_communal_target_object_is_rejected, |s| {
        s.communal[0].target.object = u32::MAX;
    });
    invalid_social_case!(invalid_communal_target_interaction_is_rejected, |s| {
        s.communal[0].target.interaction = u32::MAX;
    });
    invalid_social_case!(invalid_communal_extensions_are_rejected, |s| {
        s.communal[0].extensions = 3;
    });
    invalid_social_case!(ordinary_communal_remaining_is_rejected, |s| {
        s.communal[0].remaining = 1;
    });
    invalid_social_case!(ordinary_completed_novelty_is_rejected, |s| {
        s.communal[0].completed_novelty = Some(0.5);
    });
    invalid_social_case!(invalid_participant_identity_is_rejected, |s| {
        s.communal[0].participants[0] = u32::MAX;
    });
    invalid_social_case!(duplicate_participant_is_rejected, |s| {
        let peer = s.communal[0].participants[0];
        s.communal[0].participants.push(peer);
    });
    invalid_social_case!(owner_as_participant_is_rejected, |s| {
        let owner = s.communal[0].owner;
        s.communal[0].participants[0] = owner;
    });
}
