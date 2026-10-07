//! Resolve each saved numeric action space by stable authored identity.

use super::{SaveError, CHAIN_STEP};
use std::collections::{BTreeMap, BTreeSet};
use terri_core::{save_v6::*, FnvHasher, SaveSnapshotV5, SavedCommand};
use terri_data::{CompiledObject, CompiledTraitKind, ContentPack};

fn text(hash: &mut FnvHasher, value: &str) {
    hash.write_u64(value.len() as u64);
    hash.write_bytes(value.as_bytes());
}

pub(super) fn object_structure(object: &CompiledObject, current: bool) -> u64 {
    let mut hash = FnvHasher::default();
    hash.write_u64(object.footprint.width as u64);
    hash.write_u64(object.footprint.depth as u64);
    hash.write_u64(object.base_facing.code() as u64);
    hash.write_u64(object.sleep_places.len() as u64);
    for place in &object.sleep_places {
        text(&mut hash, &place.id);
        let mut approaches = place.approaches.clone();
        approaches.sort();
        hash.write_u64(approaches.len() as u64);
        for (x, y) in approaches {
            hash.write_bytes(&x.to_le_bytes());
            hash.write_bytes(&y.to_le_bytes());
        }
    }
    if current {
        hash.write_u64(object.cooking_front.is_some().into());
        if let Some((x, y)) = object.cooking_front {
            hash.write_bytes(&x.to_le_bytes());
            hash.write_bytes(&y.to_le_bytes());
        }
    }
    hash.finish()
}

fn chain_structure(index: usize, pack: &ContentPack) -> u64 {
    let mut hash = FnvHasher::default();
    let chain = &pack.chains[index];
    text(&mut hash, &pack.object(chain.advertised_by).id);
    hash.write_u64(chain.steps.len() as u64);
    let item = |hash: &mut FnvHasher, value: Option<u32>| {
        hash.write_u64(value.is_some() as u64);
        if let Some(value) = value {
            text(hash, &pack.item_kinds[value as usize]);
        }
    };
    for step in &chain.steps {
        text(&mut hash, &pack.roles[step.role as usize]);
        item(&mut hash, step.yields);
        hash.write_u64(step.transforms.is_some() as u64);
        if let Some((from, to)) = step.transforms {
            text(&mut hash, &pack.item_kinds[from as usize]);
            text(&mut hash, &pack.item_kinds[to as usize]);
        }
        item(&mut hash, step.consumes);
    }
    hash.finish()
}

fn portal_structure(pack: &ContentPack) -> u64 {
    let mut hash = FnvHasher::default();
    hash.write_u64(pack.lot.front_door.is_some() as u64);
    if let Some((x, y)) = pack.lot.front_door {
        hash.write_u64(x as u64);
        hash.write_u64(y as u64);
    }
    let mut portals: Vec<_> = pack
        .portals
        .iter()
        .map(|p| (p.position, p.inward))
        .collect();
    portals.sort();
    hash.write_u64(portals.len() as u64);
    for ((x, y), (ix, iy)) in portals {
        for value in [x, y, ix, iy] {
            hash.write_u64(value as u64);
        }
    }
    hash.finish()
}

fn trait_kind(kind: &CompiledTraitKind) -> u8 {
    match kind {
        CompiledTraitKind::Disposition { .. } => 0,
        CompiledTraitKind::Capability { .. } => 1,
        CompiledTraitKind::Condition { .. } => 2,
    }
}

fn referenced_models(snapshot: &SaveSnapshotV5) -> BTreeSet<String> {
    let mut models = BTreeSet::new();
    for entity in &snapshot.world.entities {
        models.extend(entity.smart_object.iter().cloned());
        if let Some(eating) = &entity.eating {
            models.insert(eating.object.clone());
        }
        for entry in entity
            .habituation
            .iter()
            .flatten()
            .chain(entity.personality.iter().flat_map(|p| &p.dispositions))
        {
            models.insert(entry.object.clone());
        }
    }
    for command in &snapshot.world.queued_commands {
        if let SavedCommand::BuyObject { definition, .. }
        | SavedCommand::BuyObjectInColourway { definition, .. } = command
        {
            models.extend(definition.iter().cloned());
        }
    }
    models
}

pub(super) fn capture(snapshot: &SaveSnapshotV5, pack: &ContentPack) -> SavedActionManifest {
    capture_origins(snapshot, pack, &[])
}

pub(super) fn capture_origins(
    snapshot: &SaveSnapshotV5,
    pack: &ContentPack,
    origins: &[SavedChainOrigin],
) -> SavedActionManifest {
    let mut models = referenced_models(snapshot);
    models.extend(origins.iter().filter_map(|o| match &o.origin {
        ChainOrigin::Action { model, .. } => Some(model.clone()),
        _ => None,
    }));
    let active: BTreeSet<_> = snapshot
        .world
        .entities
        .iter()
        .filter_map(|e| e.chain.as_ref().map(|c| c.chain.as_str()))
        .collect();
    let used_traits: BTreeSet<_> = snapshot
        .world
        .entities
        .iter()
        .flat_map(|e| e.traits.iter().flatten().map(|t| t.id.as_str()))
        .collect();
    SavedActionManifest {
        objects: models
            .into_iter()
            .map(|model| {
                let id = pack.find(&model).expect("live model identity");
                let object = pack.object(id);
                SavedObjectActions {
                    model,
                    structure: object_structure(object, !terri_data::is_pre_books_pack(pack)),
                    required_roles: object
                        .roles
                        .iter()
                        .map(|&i| pack.roles[i as usize].clone())
                        .collect(),
                    interactions: {
                        let mut rows: Vec<_> =
                            object.interactions.iter().map(|a| a.id.clone()).collect();
                        if terri_data::is_latest_pre_books_pack(pack) && object.id == "dining_table"
                        {
                            rows.push("take_prepared_food".into());
                        }
                        rows
                    },
                    advertised_chains: crate::action_rows::aliases(pack, id)
                        .map(|(_, c)| c.id.clone())
                        .collect(),
                }
            })
            .collect(),
        social: pack.social.iter().map(|a| a.id.clone()).collect(),
        chains: pack
            .chains
            .iter()
            .enumerate()
            .map(|(i, c)| SavedChainActions {
                id: c.id.clone(),
                structure: active
                    .contains(c.id.as_str())
                    .then(|| chain_structure(i, pack)),
            })
            .collect(),
        voices: if snapshot
            .world
            .entities
            .iter()
            .any(|e| e.conversation_voice.is_some())
        {
            pack.voice_clips
                .iter()
                .map(|v| (v.id.clone(), v.duration_ticks))
                .collect()
        } else {
            Vec::new()
        },
        traits: pack
            .traits
            .iter()
            .filter(|t| used_traits.contains(t.id.as_str()))
            .map(|t| (t.id.clone(), trait_kind(&t.kind)))
            .collect(),
        portal_structure: portal_structure(pack),
    }
}

fn unique<'a>(values: impl IntoIterator<Item = &'a str>) -> Result<(), SaveError> {
    let mut seen = BTreeSet::new();
    for value in values {
        if value.is_empty() || !seen.insert(value) {
            return Err(SaveError::InvalidContentReference);
        }
    }
    Ok(())
}

struct ModelRows {
    interactions: Vec<u32>,
    flyout: Vec<u32>,
}

/// Validate source identities and structure before changing any saved ordinal.
pub(super) fn remap(
    snapshot: &mut SaveSnapshotV5,
    manifest: &SavedActionManifest,
    pack: &ContentPack,
    origins: &[SavedChainOrigin],
    migration: bool,
) -> Result<(), SaveError> {
    let invalid = SaveError::InvalidContentReference;
    unique(manifest.objects.iter().map(|o| o.model.as_str()))?;
    unique(manifest.social.iter().map(String::as_str))?;
    unique(manifest.chains.iter().map(|c| c.id.as_str()))?;
    unique(manifest.traits.iter().map(|t| t.0.as_str()))?;
    if manifest.portal_structure != portal_structure(pack) {
        return Err(SaveError::IncompatibleContent);
    }
    let mut models = referenced_models(snapshot);
    if !migration {
        models.extend(origins.iter().filter_map(|o| match &o.origin {
            ChainOrigin::Action { model, .. } => Some(model.clone()),
            _ => None,
        }));
    }
    if models != manifest.objects.iter().map(|o| o.model.clone()).collect() {
        return Err(invalid);
    }
    let mut rows = BTreeMap::new();
    for source in &manifest.objects {
        let definition = pack.find(&source.model).ok_or(invalid)?;
        let object = pack.object(definition);
        if source.structure != object_structure(object, !migration) {
            return Err(SaveError::IncompatibleContent);
        }
        unique(source.required_roles.iter().map(String::as_str))?;
        if source.required_roles.iter().any(|role| {
            !object
                .roles
                .iter()
                .any(|&i| pack.roles[i as usize] == *role)
        }) {
            return Err(SaveError::IncompatibleContent);
        }
        unique(source.interactions.iter().map(String::as_str))?;
        unique(source.advertised_chains.iter().map(String::as_str))?;
        let interactions: Vec<u32> = source
            .interactions
            .iter()
            .map(|id| {
                object
                    .interactions
                    .iter()
                    .position(|a| a.id == *id)
                    .map(|i| i as u32)
                    .ok_or(invalid)
            })
            .collect::<Result<_, _>>()?;
        let advertised: Vec<_> = crate::action_rows::aliases(pack, definition)
            .map(|(_, c)| c)
            .collect();
        let mut flyout = interactions.clone();
        for id in &source.advertised_chains {
            if migration
                && ((source.model == "fridge" && id == "cook_dinner")
                    || (source.model == "kitchen_sink" && id == "clean_dishes"))
            {
                flyout.push(
                    object
                        .interactions
                        .iter()
                        .position(|a| {
                            a.id == *id && a.recipe.as_ref().is_some_and(|b| b.recipe == *id)
                        })
                        .ok_or(invalid)? as u32,
                );
                continue;
            }
            flyout.push(
                (object.interactions.len()
                    + advertised.iter().position(|c| c.id == *id).ok_or(invalid)?)
                    as u32,
            );
        }
        rows.insert(
            source.model.as_str(),
            ModelRows {
                interactions,
                flyout,
            },
        );
    }
    let social: Vec<u32> = manifest
        .social
        .iter()
        .map(|id| {
            pack.social
                .iter()
                .position(|a| a.id == *id)
                .map(|i| i as u32)
                .ok_or(invalid)
        })
        .collect::<Result<_, _>>()?;
    let chains: Vec<u32> = manifest
        .chains
        .iter()
        .map(|source| {
            let index = pack
                .chains
                .iter()
                .position(|c| c.id == source.id)
                .ok_or(invalid)?;
            if source
                .structure
                .is_some_and(|shape| shape != chain_structure(index, pack))
            {
                return Err(SaveError::IncompatibleContent);
            }
            Ok(index as u32)
        })
        .collect::<Result<_, _>>()?;
    let active: BTreeSet<_> = snapshot
        .world
        .entities
        .iter()
        .filter_map(|e| e.chain.as_ref().map(|c| c.chain.as_str()))
        .collect();
    let declared: BTreeSet<_> = manifest
        .chains
        .iter()
        .filter(|c| c.structure.is_some())
        .map(|c| c.id.as_str())
        .collect();
    if active != declared {
        return Err(invalid);
    }
    let voice_used = snapshot
        .world
        .entities
        .iter()
        .any(|e| e.conversation_voice.is_some());
    if voice_used {
        if manifest.voices.is_empty()
            || manifest.voices.iter().enumerate().any(|(i, (id, ticks))| {
                pack.voice_clips
                    .get(i)
                    .is_none_or(|v| v.id != *id || v.duration_ticks != *ticks)
            })
        {
            return Err(SaveError::IncompatibleContent);
        }
        for entity in &snapshot.world.entities {
            if let Some(voice) = entity.conversation_voice {
                if [voice.first, voice.second]
                    .iter()
                    .any(|&v| v as usize >= manifest.voices.len())
                {
                    return Err(invalid);
                }
            }
        }
    } else if !manifest.voices.is_empty() {
        return Err(invalid);
    }
    let used_traits: BTreeSet<_> = snapshot
        .world
        .entities
        .iter()
        .flat_map(|e| e.traits.iter().flatten().map(|t| t.id.as_str()))
        .collect();
    if used_traits != manifest.traits.iter().map(|t| t.0.as_str()).collect() {
        return Err(invalid);
    }
    for (id, kind) in &manifest.traits {
        if pack
            .traits
            .iter()
            .find(|t| t.id == *id)
            .is_none_or(|t| trait_kind(&t.kind) != *kind)
        {
            return Err(SaveError::IncompatibleContent);
        }
    }
    let entities: BTreeMap<_, _> = snapshot
        .world
        .entities
        .iter()
        .map(|e| (e.index, e.smart_object.clone()))
        .collect();
    let map_model = |model: &str, row: &mut u32, flyout: bool| -> Result<(), SaveError> {
        let model = rows.get(model).ok_or(invalid)?;
        *row = *(if flyout {
            &model.flyout
        } else {
            &model.interactions
        })
        .get(*row as usize)
        .ok_or(invalid)?;
        Ok(())
    };
    let map_entity = |index: u32, row: &mut u32, flyout: bool| -> Result<(), SaveError> {
        match entities
            .get(&index)
            .ok_or(SaveError::InvalidEntityReference)?
        {
            Some(_) if !flyout && *row == CHAIN_STEP => Ok(()),
            Some(model) => map_model(model, row, flyout),
            None => {
                *row = *social.get(*row as usize).ok_or(invalid)?;
                Ok(())
            }
        }
    };
    for entity in &mut snapshot.world.entities {
        if let Some(target) = &mut entity.target {
            map_entity(target.object, &mut target.interaction, false)?;
        }
        if let Some(eating) = &mut entity.eating {
            map_model(&eating.object, &mut eating.interaction, false)?;
        }
        for intent in entity.intents.iter_mut().flatten() {
            map_entity(intent.object, &mut intent.interaction, true)?;
        }
        for entry in entity.habituation.iter_mut().flatten().chain(
            entity
                .personality
                .iter_mut()
                .flat_map(|p| &mut p.dispositions),
        ) {
            map_model(&entry.object, &mut entry.interaction, true)?;
        }
        if let Some(socialising) = &mut entity.socialising {
            socialising.interaction = *social
                .get(socialising.interaction as usize)
                .ok_or(invalid)?;
        }
    }
    for command in &mut snapshot.world.queued_commands {
        match command {
            SavedCommand::UseObject {
                object,
                interaction,
                ..
            }
            | SavedCommand::UseObjectFirst {
                object,
                interaction,
                ..
            } => map_entity(*object, interaction, true)?,
            SavedCommand::TalkTo { interaction, .. }
            | SavedCommand::TalkToFirst { interaction, .. } => {
                *interaction = *social.get(*interaction as usize).ok_or(invalid)?;
            }
            _ => (),
        }
    }
    for boundary in &mut snapshot.boundaries {
        if let Some((object, row)) = &mut boundary.goal {
            map_entity(*object, row, false)?;
        }
        if let Some(chain) = &mut boundary.directed_chain {
            *chain = *chains.get(*chain as usize).ok_or(invalid)?;
        }
    }
    // This is valid only after all ordinal spaces and retained structures pass.
    snapshot.world.content_fingerprint = terri_data::content_fingerprint(pack);
    Ok(())
}
