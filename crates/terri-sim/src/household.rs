//! Household members: the shipped household spawned from content, and a new
//! housemate moving in during play - [CS-command] and [CS-arrival] in
//! `docs/specs/2026-09-22-create-a-sim.md`.

use bevy_ecs::prelude::*;
use terri_core::{Agent, Path, Position, SimId, TileGrid, NEED_COUNT, NEED_MAX};

use crate::placement::LotEditState;
use crate::Content;

/// Everything one household member is spawned from.
pub(crate) struct Member<'a> {
    pub name: String,
    pub personality: u32,
    pub position: Position,
    pub needs: [f32; NEED_COUNT],
    pub hobbies: Vec<String>,
    pub traits: &'a [u32],
    pub career: Option<u32>,
}

/// Spawns one household member with a freshly issued sim id and returns it.
/// The shipped household and a new housemate are made the same way, so a
/// newcomer is a member like the rest.
pub(crate) fn spawn_member(
    world: &mut World,
    personalities: &[terri_data::CompiledPersonality],
    traits: &[terri_data::CompiledTrait],
    member: Member,
) -> Entity {
    let sim_id = world.resource_mut::<terri_core::SimIdAllocator>().issue();
    let compiled = &personalities[member.personality as usize];
    let personality = terri_core::Personality::with_dispositions(
        compiled.drain,
        compiled.satisfaction,
        compiled.dispositions.clone(),
    );
    let mut needs = terri_core::Needs::all_at(NEED_MAX);
    for id in terri_core::NeedId::ALL {
        needs.set(id, member.needs[id.index()]);
    }
    let mut spawned = world.spawn((
        Agent,
        member.position,
        needs,
        sim_id,
        terri_core::SimName(member.name),
        personality,
        // The second axis starts at zero - a life is judged from
        // move-in day - and the hobbies ride as spawned content
        // ([E1]/[E2]). Household sims carry both; bare test
        // agents carry neither, and every consumer treats the
        // absences as "no hobbies, no ledger", which is what
        // keeps the pre-M2e golden vectors still.
        terri_core::Satisfaction::default(),
        terri_core::Hobbies(member.hobbies),
        // Worn traits open at their content-defined states: a
        // capability at its start_level, a condition at its
        // start_severity, a disposition stateless at 0 ([E3]).
        terri_core::Traits::from_entries(
            member
                .traits
                .iter()
                .map(|&index| {
                    let state = match traits[index as usize].kind {
                        terri_data::CompiledTraitKind::Capability { start_level, .. } => {
                            start_level
                        }
                        terri_data::CompiledTraitKind::Condition { start_severity, .. } => {
                            start_severity
                        }
                        terri_data::CompiledTraitKind::Disposition { .. } => 0.0,
                    };
                    (index, state)
                })
                .collect(),
        ),
    ));
    // The job rides only on the employed, the SpriteVariant
    // pattern: every jobless sim - and every fixture - has no
    // component rather than a sentinel ([E4]).
    if let Some(career) = member.career {
        spawned.insert(terri_core::Career(career));
    }
    spawned.id()
}

/// Why a move-in was refused - [CS-command]. Stable codes the shell words.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[repr(u8)]
pub enum HousemateRefusal {
    /// The household already has the most members it may have.
    HouseholdFull = 1,
    /// The name is empty once trimmed, or longer than the tuned limit.
    BadName = 2,
    /// The pack has no personality with that index.
    UnknownPersonality = 3,
    /// More traits than the tuned limit.
    TooManyTraits = 4,
    /// A trait index the pack has no trait for.
    UnknownTrait = 5,
    /// The same trait twice.
    RepeatedTrait = 6,
    /// No open floor for the newcomer to arrive on.
    NoWayIn = 7,
}

/// What the drain did with the most recent move-in.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct HousemateResult {
    /// The newcomer's entity index, when one moved in.
    pub sim: Option<u32>,
    pub reason: Option<HousemateRefusal>,
}

/// The most people a household may have, the ceiling content enforces for
/// `household.toml` and a move-in enforces at the drain.
pub const MAX_HOUSEHOLD_SIZE: usize = terri_data::MAX_HOUSEHOLD_SIZE;

/// The household's size: every person with a sim id.
pub fn household_size(world: &World) -> usize {
    world
        .try_query::<(&Agent, &SimId)>()
        .map_or(0, |mut query| query.iter(world).count())
}

/// Checks a move-in whole, in [CS-command]'s order, and returns the trimmed
/// name. Writes nothing and draws nothing.
pub fn validate_housemate(
    world: &World,
    name: &str,
    personality: u32,
    traits: &[u32],
) -> Result<String, HousemateRefusal> {
    use HousemateRefusal::*;
    let content = world.resource::<Content>().0;
    if household_size(world) >= MAX_HOUSEHOLD_SIZE {
        return Err(HouseholdFull);
    }
    let name = name.trim();
    if name.is_empty() || name.chars().count() > content.tuning.housemate_name_max_chars as usize {
        return Err(BadName);
    }
    if personality as usize >= content.personalities.len() {
        return Err(UnknownPersonality);
    }
    if traits.len() > content.tuning.housemate_max_traits as usize {
        return Err(TooManyTraits);
    }
    if traits
        .iter()
        .any(|&index| index as usize >= content.traits.len())
    {
        return Err(UnknownTrait);
    }
    if traits
        .iter()
        .enumerate()
        .any(|(at, index)| traits[..at].contains(index))
    {
        return Err(RepeatedTrait);
    }
    Ok(name.to_string())
}

/// [CS-arrival]: where the newcomer appears and the walk it starts on. The
/// street's exit when it is open floor the landing can be reached from, else
/// the front door's tile; a lot with no front door, the first open tile and
/// no walk.
fn arrival(world: &World) -> Result<(Position, Vec<(i32, i32)>), HousemateRefusal> {
    let content = world.resource::<Content>().0;
    let grid = world.resource::<TileGrid>();
    let at = |(x, y): (i32, i32)| Position {
        x: x as f32,
        y: y as f32,
    };
    let portal = content.lot.front_door.and_then(|door| {
        content
            .portals
            .iter()
            .find(|portal| portal.position == door)
    });
    let Some(portal) = portal else {
        return (0..grid.height() as i32)
            .flat_map(|y| (0..grid.width() as i32).map(move |x| (x, y)))
            .find(|&(x, y)| grid.is_walkable(x, y))
            .map(|tile| (at(tile), Vec::new()))
            .ok_or(HousemateRefusal::NoWayIn);
    };
    let landing = (portal.inward.0 as i32, portal.inward.1 as i32);
    let door = (portal.position.0 as i32, portal.position.1 as i32);
    crate::portals::street_exit(content, grid.width() as u32)
        .map(|(x, y)| (x as i32, y as i32))
        .into_iter()
        .chain([door])
        .filter(|&(x, y)| grid.is_walkable(x, y))
        .find_map(|from| grid.find_path(from, landing).map(|steps| (at(from), steps)))
        .ok_or(HousemateRefusal::NoWayIn)
}

/// Revalidates and moves the newcomer in, in one exclusive command drain,
/// then records what happened for the shell.
pub(crate) fn commit(world: &mut World, name: &str, personality: u32, traits: &[u32]) {
    let checked = validate_housemate(world, name, personality, traits)
        .and_then(|name| arrival(world).map(|arrival| (name, arrival)));
    let result = match checked {
        Ok((name, (position, steps))) => {
            let content = world.resource::<Content>().0;
            let entity = spawn_member(
                world,
                &content.personalities,
                &content.traits,
                Member {
                    name,
                    personality,
                    position,
                    needs: [NEED_MAX; NEED_COUNT],
                    hobbies: Vec::new(),
                    traits,
                    career: None,
                },
            );
            if !steps.is_empty() {
                world.entity_mut(entity).insert(Path { steps, cursor: 0 });
            }
            HousemateResult {
                sim: Some(entity.index_u32()),
                reason: None,
            }
        }
        Err(reason) => HousemateResult {
            sim: None,
            reason: Some(reason),
        },
    };
    world.resource_mut::<LotEditState>().last_housemate_result = Some(result);
}

/// A personality's name as the form shows it: its content id in words, "the
/// correspondent" as "The correspondent", until the owner names them.
pub fn personality_label(id: &str) -> String {
    let words = id.replace('_', " ");
    let mut chars = words.chars();
    chars
        .next()
        .map(|first| first.to_uppercase().chain(chars).collect())
        .unwrap_or_default()
}

#[cfg(test)]
#[path = "household_tests.rs"]
mod tests;
