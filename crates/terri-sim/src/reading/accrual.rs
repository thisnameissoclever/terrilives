//! Retain the factors that actually applied before an in-session edit.
use super::*;
use terri_data::CompiledTraitKind;

pub(super) fn record(world: &mut World, person: Entity, target: Target, work: f32) {
    let pack = world.resource::<Content>().0;
    let model = world.get::<SmartObject>(target.object).unwrap().0;
    let disposition = world
        .get::<Personality>(person)
        .map_or(1.0, |p| p.disposition(model, target.interaction));
    let tags = &action(world, target).unwrap().tags;
    let mut traits: Vec<_> = world
        .get::<Traits>(person)
        .into_iter()
        .flat_map(|t| t.entries())
        .filter_map(|(index, _)| {
            let def = &pack.traits[*index as usize];
            (tags.contains(&def.tag) && matches!(def.kind, CompiledTraitKind::Disposition { .. }))
                .then(|| def.id.clone())
        })
        .collect();
    traits.sort();
    let mut journey = world.get_mut::<ReadingJourney>(person).unwrap();
    let end_tick = journey.elapsed + 1;
    let end_work = journey.work + work;
    if let Some(last) = journey.reward_contexts.last_mut() {
        if last.disposition.to_bits() == disposition.to_bits() && last.traits == traits {
            last.end_tick = end_tick;
            last.end_work = end_work;
            return;
        }
    }
    let context = ReadingRewardContext {
        start_tick: journey.elapsed,
        end_tick,
        start_work: journey.work,
        end_work,
        disposition,
        traits,
    };
    journey.reward_contexts.push(context);
}

fn rounded_upper(value: f64, terms: u32) -> f64 {
    let rounded = value as f32;
    if !rounded.is_finite() {
        return f64::INFINITY;
    }
    value + f64::from(terms) * (f64::from(rounded.next_up()) - f64::from(rounded))
}

pub(super) fn reward_upper(world: &World, person: Entity, journey: &ReadingJourney) -> Option<f64> {
    if journey.reward_contexts.len() > journey.elapsed as usize {
        return None;
    }
    let pack = world.resource::<Content>().0;
    let target = *world.get::<Target>(person)?;
    let action = action(world, target)?;
    let id = *world.get::<SimId>(person)?;
    let library = world.resource::<BookLibrary>();
    let title = &library.copy(journey.copy)?.title_id;
    let book = pack.books.iter().find(|b| b.id == *title)?;
    let affinity = crate::books::title_affinity(library.state().taste_seed, id, &book.genre, title);
    let novelty = if journey.work == 0.0 {
        1.0
    } else {
        library.memory(id, title)?.pass_novelty?
    };
    let hobby = crate::systems::satisfaction::hobby_payout(
        1.0,
        &action.tags,
        world.get::<Hobbies>(person),
        pack.tuning.hobby_multiplier,
    );
    let tuning = pack.reading.as_ref()?;
    let mut end_tick = 0;
    let mut end_work = 0.0f32;
    let mut total = 0.0;
    let mut previous: Option<&ReadingRewardContext> = None;
    for context in &journey.reward_contexts {
        if context.start_tick != end_tick
            || context.start_work.to_bits() != end_work.to_bits()
            || context.end_tick <= context.start_tick
            || context.end_tick > journey.elapsed
            || !context.end_work.is_finite()
            || context.end_work <= context.start_work
            || !context.disposition.is_finite()
            || context.disposition < 0.0
            || context.traits.windows(2).any(|pair| pair[0] >= pair[1])
            || previous.is_some_and(|p| {
                p.disposition.to_bits() == context.disposition.to_bits()
                    && p.traits == context.traits
            })
        {
            return None;
        }
        // Resolve stable IDs, then multiply in authored order like the runtime.
        let mut indices = Vec::new();
        for id in &context.traits {
            let index = pack.traits.iter().position(|t| t.id == *id)?;
            let def = &pack.traits[index];
            if !action.tags.contains(&def.tag)
                || !matches!(def.kind, CompiledTraitKind::Disposition { .. })
            {
                return None;
            }
            indices.push(index);
        }
        indices.sort_unstable();
        let mut trait_scale = 1.0f32;
        for index in indices {
            if let CompiledTraitKind::Disposition { score_multiplier } = pack.traits[index].kind {
                trait_scale *= score_multiplier;
            }
        }
        let taste = affinity * context.disposition * trait_scale;
        let ticks = context.end_tick - context.start_tick;
        // Work accumulates in f32 before a context closes. Bound that rounding
        // at the cumulative magnitude, then each reward multiplication/addition.
        let work_error =
            rounded_upper(f64::from(context.end_work), ticks) - f64::from(context.end_work);
        let mut upper = f64::from(context.end_work) - f64::from(context.start_work) + work_error;
        for factor in [
            1.0 / f64::from(terri_data::books::READING_REFERENCE_TICKS),
            f64::from(novelty),
            f64::from(tuning.satisfaction_per_session),
            f64::from(taste),
            f64::from(hobby),
        ] {
            if !factor.is_finite() || factor < 0.0 {
                return None;
            }
            upper = rounded_upper(upper * factor, ticks);
        }
        total += upper;
        end_tick = context.end_tick;
        end_work = context.end_work;
        previous = Some(context);
    }
    if end_tick != journey.elapsed || end_work.to_bits() != journey.work.to_bits() {
        return None;
    }
    Some(
        if matches!(journey.outcome, Some(ReadingOutcome::Fumbled(_))) {
            0.0
        } else {
            rounded_upper(total, journey.elapsed)
        },
    )
}
