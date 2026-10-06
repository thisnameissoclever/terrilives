//! Contextual need effects and the matching benefits used by decisions.
#[cfg(test)]
mod tests;
use crate::Content;
use bevy_ecs::prelude::*;
use terri_core::{
    Agent, Carrying, ChainState, Eating, NeedId, Needs, Path, Personality, Relationships, StepWork,
    Target,
};

pub(crate) fn cap_delta(
    pack: &terri_data::ContentPack,
    act: &terri_data::CompiledInteraction,
    needs: &Needs,
    need: u8,
    delta: f32,
) -> f32 {
    if delta > 0.
        && need as usize == NeedId::Hygiene.index()
        && act.activity == Some(terri_data::CompiledActivity::WashingHands)
    {
        delta.min(
            (pack.tuning.need_interactions.handwashing_hygiene_ceiling
                - needs.get(NeedId::Hygiene))
            .max(0.),
        )
    } else {
        delta
    }
}

/// Sparse benefits at a planned or occupied place; costs remain intact.
pub(crate) fn benefits(
    pack: &terri_data::ContentPack,
    act: &terri_data::CompiledInteraction,
    needs: &Needs,
    social: bool,
    seat_rate: f32,
    shared: bool,
) -> Vec<(u8, f32)> {
    let mut effects: Vec<_> = act
        .advertises
        .iter()
        .copied()
        .filter(|&(n, d)| crate::social_company::effective_delta(n, d, social))
        .filter(|&(n, d)| cap_delta(pack, act, needs, n, d) != 0.)
        .collect();
    for (need, delta) in [
        (NeedId::Comfort, seat_rate * act.duration_ticks as f32),
        (
            NeedId::Social,
            if shared
                && !act
                    .advertises
                    .iter()
                    .any(|(n, d)| *n as usize == NeedId::Social.index() && *d > 0.)
            {
                pack.tuning.need_interactions.shared_social_per_tick * act.duration_ticks as f32
            } else {
                0.
            },
        ),
    ] {
        if delta > 0. {
            if let Some((_, existing)) = effects
                .iter_mut()
                .find(|(n, _)| *n as usize == need.index())
            {
                *existing += delta;
            } else {
                effects.push((need.index() as u8, delta));
            }
        }
    }
    effects.sort_by_key(|(n, _)| *n);
    effects
}

pub(crate) fn meal_active(world: &World, person: Entity) -> bool {
    if world.get::<Path>(person).is_some()
        || world.get::<Eating>(person).is_some()
        || world.get::<terri_core::AtWork>(person).is_some()
        || world.get::<terri_core::Commuting>(person).is_some()
        || world.get::<terri_core::Socialising>(person).is_some()
    {
        return false;
    }
    let Some(state) = world.get::<ChainState>(person) else {
        return false;
    };
    let pack = world.resource::<Content>().0;
    let Some(chain) = pack.chains.get(state.chain as usize) else {
        return false;
    };
    let Some(food) = chain
        .steps
        .get(state.step as usize)
        .and_then(|s| s.consumes)
    else {
        return false;
    };
    world
        .get::<StepWork>(person)
        .is_some_and(|w| w.remaining_ticks > 0)
        && world
            .get::<Carrying>(person)
            .is_some_and(|held| held.0 == food)
        && world
            .get::<Target>(person)
            .is_some_and(|t| t.interaction == crate::systems::chain::CHAIN_STEP)
        && !world
            .get_resource::<terri_core::save::SavedDomestic>()
            .is_some_and(|d| {
                world
                    .get::<terri_core::SimId>(person)
                    .is_some_and(|id| crate::domestic::gathering(d, *id, &chain.id, state.step))
            })
}

pub(crate) fn seat_rate(world: &World, person: Entity) -> f32 {
    if world.get::<terri_core::AtWork>(person).is_some()
        || world.get::<terri_core::Commuting>(person).is_some()
        || world.get::<terri_core::Socialising>(person).is_some()
    {
        return 0.;
    }
    let Some(lease) = crate::seating::claim(world, person.index_u32()) else {
        return 0.;
    };
    let valid = match crate::seating::kind(world, lease) {
        Some(crate::seating::UseKind::Meal) => {
            meal_active(world, person) && crate::dining::seated_at_table(world, person)
        }
        Some(crate::seating::UseKind::Media) => {
            crate::media::valid_lease(world, lease)
                && crate::media::projection(world, person).is_some()
                && world
                    .get::<Eating>(person)
                    .is_some_and(|e| e.remaining_ticks > 0)
        }
        _ => false,
    };
    if !valid {
        return 0.;
    }
    lease
        .chair
        .and_then(|id| crate::dining::entity(world, id))
        .and_then(|chair| world.get::<terri_core::SmartObject>(chair))
        .map_or(0., |o| {
            world
                .resource::<Content>()
                .0
                .object(o.0)
                .seat_comfort_rate()
        })
}

/// Decision-time benefits use the goal's real destination and held seat.
pub(crate) fn goal_benefits(world: &World, person: Entity, target: Target) -> Vec<(u8, f32)> {
    let pack = world.resource::<Content>().0;
    let Some(needs) = world.get::<Needs>(person) else {
        return vec![];
    };
    let Some(object) = world.get::<terri_core::SmartObject>(target.object) else {
        return vec![];
    };
    let Some(act) = pack
        .object(object.0)
        .interactions
        .get(target.interaction as usize)
    else {
        return world
            .get::<ChainState>(person)
            .map_or_else(Vec::new, |state| {
                pack.chains[state.chain as usize]
                    .advertises
                    .iter()
                    .copied()
                    .filter(|&(n, d)| {
                        crate::social_company::effective_delta(
                            n,
                            d,
                            world
                                .resource::<crate::social_company::SocialCompany>()
                                .active_allowed(
                                    person,
                                    &world
                                        .get::<Relationships>(person)
                                        .cloned()
                                        .unwrap_or_default(),
                                ),
                        )
                    })
                    .collect()
            });
    };
    let destination = world
        .get::<Path>(person)
        .and_then(|p| p.steps.last().copied())
        .or_else(|| {
            world
                .get::<terri_core::Position>(person)
                .map(|p| (p.x.round() as i32, p.y.round() as i32))
        });
    let feelings = world
        .get::<Relationships>(person)
        .cloned()
        .unwrap_or_default();
    let company = world.resource::<crate::social_company::SocialCompany>();
    let shared = destination.is_some_and(|end| {
        company.shared_allowed(person, target.object, target.interaction, &feelings, end)
    });
    let seat = crate::seating::claim(world, person.index_u32())
        .filter(|lease| {
            crate::seating::kind(world, lease) == Some(crate::seating::UseKind::Media)
                && crate::media::valid_lease(world, lease)
        })
        .and_then(|lease| lease.chair)
        .and_then(|id| crate::dining::entity(world, id))
        .and_then(|chair| world.get::<terri_core::SmartObject>(chair))
        .map_or(0., |o| pack.object(o.0).seat_comfort_rate());
    benefits(
        pack,
        act,
        needs,
        company.media_allowed(person, target.object, target.interaction, &feelings) || shared,
        seat,
        shared,
    )
}

/// Available help during the current activity, including physical effects.
pub(crate) fn active_benefits(world: &World, person: Entity) -> Vec<(u8, f32)> {
    let pack = world.resource::<Content>().0;
    let Some(needs) = world.get::<Needs>(person) else {
        return vec![];
    };
    let company = world.resource::<crate::social_company::SocialCompany>();
    let feelings = world
        .get::<Relationships>(person)
        .cloned()
        .unwrap_or_default();
    let social = company.active_allowed(person, &feelings);
    let personality = world.get::<Personality>(person);
    let scale = |n: u8| personality.map_or(1., |p| p.satisfaction[n as usize]);
    let mut effects = vec![];
    if let Some(eating) = world
        .get::<Eating>(person)
        .filter(|e| e.remaining_ticks > 0)
    {
        let act = &pack.object(eating.object).interactions[eating.interaction as usize];
        let failure = world
            .get::<terri_core::Fumbled>(person)
            .map_or(1., |f| f.delta_scale);
        effects = act
            .advertises
            .iter()
            .copied()
            .filter(|&(n, d)| crate::social_company::effective_delta(n, d, social))
            .map(|(n, d)| {
                (
                    n,
                    cap_delta(
                        pack,
                        act,
                        needs,
                        n,
                        crate::systems::advertise::scaled_delta(d, scale(n) * failure)
                            / act.duration_ticks as f32,
                    ),
                )
            })
            .filter(|(_, d)| *d != 0.)
            .collect();
        if company.active_shared_allowed(person, &feelings)
            && !act
                .advertises
                .iter()
                .any(|(n, d)| *n as usize == NeedId::Social.index() && *d > 0.)
        {
            effects.push((
                NeedId::Social.index() as u8,
                pack.tuning.need_interactions.shared_social_per_tick
                    * scale(NeedId::Social.index() as u8),
            ));
        }
    } else if let Some(state) = world
        .get::<ChainState>(person)
        .filter(|_| world.get::<StepWork>(person).is_some())
    {
        effects = pack.chains[state.chain as usize]
            .advertises
            .iter()
            .copied()
            .filter(|&(n, d)| crate::social_company::effective_delta(n, d, social))
            .map(|(n, d)| {
                (
                    n,
                    crate::systems::advertise::scaled_delta(
                        d,
                        scale(n)
                            * if n as usize == NeedId::Social.index() {
                                1.
                            } else {
                                state.fumble_scale
                            },
                    ),
                )
            })
            .collect();
    }
    let seat = seat_rate(world, person);
    if seat > 0. {
        effects.push((
            NeedId::Comfort.index() as u8,
            seat * scale(NeedId::Comfort.index() as u8),
        ));
    }
    effects
}

/// Pay only while physically using a seat, eating food, or sharing an activity.
pub(crate) fn tick(world: &mut World) {
    let pack = world.resource::<Content>().0;
    let people: Vec<_> = world
        .query_filtered::<Entity, With<Agent>>()
        .iter(world)
        .collect();
    let payments: Vec<_> = people
        .into_iter()
        .map(|person| {
            let comfort =
                if meal_active(world, person) && !crate::dining::seated_at_table(world, person) {
                    -pack
                        .tuning
                        .need_interactions
                        .standing_meal_comfort_cost_per_tick
                } else {
                    seat_rate(world, person)
                };
            let feelings = world
                .get::<Relationships>(person)
                .cloned()
                .unwrap_or_default();
            let authored_social = world
                .get::<Eating>(person)
                .and_then(|e| {
                    pack.object(e.object)
                        .interactions
                        .get(e.interaction as usize)
                })
                .is_some_and(|a| {
                    a.advertises
                        .iter()
                        .any(|(n, d)| *n as usize == NeedId::Social.index() && *d > 0.)
                });
            let social = if !authored_social
                && world
                    .resource::<crate::social_company::SocialCompany>()
                    .active_shared_allowed(person, &feelings)
            {
                pack.tuning.need_interactions.shared_social_per_tick
            } else {
                0.
            };
            let personality = world.get::<Personality>(person);
            (
                person,
                if comfort > 0. {
                    comfort * personality.map_or(1., |p| p.satisfaction[NeedId::Comfort.index()])
                } else {
                    comfort
                },
                social * personality.map_or(1., |p| p.satisfaction[NeedId::Social.index()]),
            )
        })
        .collect();
    for (person, comfort, social) in payments {
        if let Some(mut needs) = world.get_mut::<Needs>(person) {
            if comfort != 0. {
                needs.fill(NeedId::Comfort, comfort);
            }
            if social != 0. {
                needs.fill(NeedId::Social, social);
            }
        }
    }
}
