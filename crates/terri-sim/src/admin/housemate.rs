//! The Housemate tab's edits ([AP-e-housemate]): needs, life satisfaction,
//! repetition, timed moodlets, affinities, skills and traits. A person is
//! named by `SimId` and must be a living member of the household
//! ([`AdminRefusal::NotAPerson`]). The career edits are in `career.rs`.
use super::edits::Touched;
use super::AdminRefusal;
use crate::burnt_meals::BurntMeals;
use crate::careers::Careers;
use crate::fights::Fights;
use crate::moodlet_timers::MoodletTimers;
use crate::skills::Ladder;
use crate::{edit, save, Content};
use bevy_ecs::prelude::*;
use terri_core::admin::AdminEdit;
use terri_core::{
    Affinities, Habituation, NeedId, Needs, Satisfaction, SimClock, SimId, Skills, Traits,
};
use terri_data::{CompiledTraitKind, ObjectDefId};

/// The living person with this `SimId`.
pub(super) fn person(world: &World, sim: u32) -> Result<Entity, AdminRefusal> {
    edit::living_entity(world, sim).ok_or(AdminRefusal::NotAPerson)
}

/// The tick now: a timed moodlet is running while it has not yet ended.
fn now(world: &World) -> u64 {
    world.resource::<SimClock>().tick
}

/// Whether timer `timer` ([`terri_core::admin::ADMIN_TIMER_COUNT`] lists them)
/// is running for `sim` now.
fn timer_running(world: &World, sim: SimId, timer: u8) -> bool {
    let now = now(world);
    let active = |timers: &MoodletTimers| timers.active(sim, now);
    match timer {
        0 => world
            .get_resource::<BurntMeals>()
            .is_some_and(|t| active(&t.0)),
        1 => world
            .get_resource::<Fights>()
            .is_some_and(|t| active(&t.timers)),
        2 => world
            .get_resource::<Careers>()
            .is_some_and(|c| active(&c.promoted)),
        3 => world
            .get_resource::<Careers>()
            .is_some_and(|c| active(&c.raised)),
        4 => world
            .get_resource::<Careers>()
            .is_some_and(|c| active(&c.demoted)),
        _ => world
            .get_resource::<Careers>()
            .is_some_and(|c| active(&c.fired)),
    }
}

/// Drops the person's row from timer `timer`, as the moodlet's own end does.
fn end_timer(world: &mut World, sim: SimId, timer: u8) {
    match timer {
        0 => {
            if let Some(mut timers) = world.get_resource_mut::<BurntMeals>() {
                timers.forget(sim);
            }
        }
        1 => {
            if let Some(mut fights) = world.get_resource_mut::<Fights>() {
                fights.timers.forget(sim);
            }
        }
        _ => {
            if let Some(mut careers) = world.get_resource_mut::<Careers>() {
                match timer {
                    2 => careers.promoted.forget(sim),
                    3 => careers.raised.forget(sim),
                    4 => careers.demoted.forget(sim),
                    _ => careers.fired.forget(sim),
                }
            }
        }
    }
}

pub(super) fn validate(world: &World, change: &AdminEdit) -> Result<(), AdminRefusal> {
    let pack = world.resource::<Content>().0;
    match *change {
        AdminEdit::SetNeed { sim, .. } | AdminEdit::SetSatisfaction { sim, .. } => {
            person(world, sim).map(|_| ())
        }
        AdminEdit::SetRepetition {
            sim,
            object,
            row,
            value,
        } => {
            let entity = person(world, sim)?;
            // The row is checked as the loader checks a saved one: the object
            // must exist and the row must be one of its flyout rows.
            if object as usize >= pack.objects.len()
                || row as usize >= crate::action_rows::rows(pack, ObjectDefId(object)).len()
            {
                return Err(AdminRefusal::UnknownContent);
            }
            if value > pack.tuning.habituation_max {
                return Err(AdminRefusal::OutOfRange);
            }
            let held = world.get::<Habituation>(entity).is_some_and(|held| {
                held.entries()
                    .iter()
                    .any(|(held_object, held_row, _)| held_object.0 == object && *held_row == row)
            });
            if held {
                Ok(())
            } else {
                Err(AdminRefusal::NotFound)
            }
        }
        AdminEdit::EndTimedMoodlet { sim, timer } => {
            person(world, sim)?;
            if timer_running(world, SimId(sim), timer) {
                Ok(())
            } else {
                Err(AdminRefusal::NotFound)
            }
        }
        AdminEdit::SetAffinity { sim, kind, .. } => {
            person(world, sim)?;
            if (kind as usize) < pack.affinities.len() {
                Ok(())
            } else {
                Err(AdminRefusal::UnknownContent)
            }
        }
        AdminEdit::SetSkillPractice {
            sim,
            skill,
            practice,
        } => {
            person(world, sim)?;
            let definition = pack
                .skills
                .get(skill as usize)
                .ok_or(AdminRefusal::UnknownContent)?;
            let top = Ladder::from_tuning(&pack.tuning).max_practice(definition.levels);
            if practice > top {
                Err(AdminRefusal::OutOfRange)
            } else {
                Ok(())
            }
        }
        AdminEdit::SetTraitState {
            sim, trait_index, ..
        } => {
            let entity = person(world, sim)?;
            let definition = pack
                .traits
                .get(trait_index as usize)
                .ok_or(AdminRefusal::UnknownContent)?;
            if world
                .get::<Traits>(entity)
                .and_then(|worn| worn.state(trait_index))
                .is_none()
            {
                return Err(AdminRefusal::NotWorn);
            }
            if matches!(definition.kind, CompiledTraitKind::Disposition { .. }) {
                return Err(AdminRefusal::NoValue);
            }
            Ok(())
        }
        AdminEdit::AddTrait { sim, trait_index } => {
            let entity = person(world, sim)?;
            if trait_index as usize >= pack.traits.len() {
                return Err(AdminRefusal::UnknownContent);
            }
            let worn = world.get::<Traits>(entity);
            if worn.is_some_and(|worn| worn.state(trait_index).is_some()) {
                return Err(AdminRefusal::AlreadyWorn);
            }
            let count = worn.map_or(0, |worn| worn.entries().len());
            if count >= pack.tuning.housemate_max_traits as usize {
                return Err(AdminRefusal::TooManyTraits);
            }
            Ok(())
        }
        AdminEdit::RemoveTrait { sim, trait_index } => {
            let entity = person(world, sim)?;
            if trait_index as usize >= pack.traits.len() {
                return Err(AdminRefusal::UnknownContent);
            }
            if world
                .get::<Traits>(entity)
                .and_then(|worn| worn.state(trait_index))
                .is_none()
            {
                return Err(AdminRefusal::NotWorn);
            }
            Ok(())
        }
        _ => unreachable!("routed to the housemate edits by `group`"),
    }
}

pub(super) fn apply(world: &mut World, change: &AdminEdit) {
    match *change {
        AdminEdit::SetNeed { sim, need, value } => {
            let entity = person(world, sim).expect("validated");
            world
                .get_mut::<Needs>(entity)
                .expect("a person has needs")
                .set(NeedId::ALL[usize::from(need)], value);
        }
        AdminEdit::SetSatisfaction { sim, value } => {
            let entity = person(world, sim).expect("validated");
            *world
                .get_mut::<Satisfaction>(entity)
                .expect("a person has satisfaction") = Satisfaction::from_value(value);
        }
        AdminEdit::SetRepetition {
            sim,
            object,
            row,
            value,
        } => {
            let entity = person(world, sim).expect("validated");
            world
                .get_mut::<Habituation>(entity)
                .expect("validated: the entry exists")
                .set(ObjectDefId(object), row, value);
        }
        AdminEdit::EndTimedMoodlet { sim, timer } => end_timer(world, SimId(sim), timer),
        AdminEdit::SetAffinity { sim, kind, value } => {
            let entity = person(world, sim).expect("validated");
            let kinds = world.resource::<Content>().0.affinities.len();
            let mut values = world
                .get::<Affinities>(entity)
                .map(|held| held.values().to_vec())
                .unwrap_or_default();
            values.resize(kinds, 0.0);
            values[kind as usize] = value;
            world
                .entity_mut(entity)
                .insert(Affinities::from_values(values));
        }
        AdminEdit::SetSkillPractice {
            sim,
            skill,
            practice,
        } => {
            let entity = person(world, sim).expect("validated");
            let mut skills = world.get::<Skills>(entity).cloned().unwrap_or_default();
            skills.set_practice(skill, practice);
            world.entity_mut(entity).insert(skills);
        }
        AdminEdit::SetTraitState {
            sim,
            trait_index,
            state,
        } => {
            let entity = person(world, sim).expect("validated");
            world
                .get_mut::<Traits>(entity)
                .expect("validated: the trait is worn")
                .set_state(trait_index, state);
        }
        AdminEdit::AddTrait { sim, trait_index } => {
            let entity = person(world, sim).expect("validated");
            let mut worn: Vec<u32> = world
                .get::<Traits>(entity)
                .map(|worn| worn.entries().iter().map(|&(index, _)| index).collect())
                .unwrap_or_default();
            worn.push(trait_index);
            edit::apply_traits(world, entity, &worn);
            moved_traits(world);
        }
        AdminEdit::RemoveTrait { sim, trait_index } => {
            let entity = person(world, sim).expect("validated");
            let worn: Vec<u32> = world
                .get::<Traits>(entity)
                .map(|worn| {
                    worn.entries()
                        .iter()
                        .map(|&(index, _)| index)
                        .filter(|&index| index != trait_index)
                        .collect()
                })
                .unwrap_or_default();
            edit::apply_traits(world, entity, &worn);
            moved_traits(world);
        }
        _ => unreachable!("routed to the housemate edits by `group`"),
    }
}

/// A trait change moves the lot edit revision so the shell's trait caches
/// refresh, as an Edit Sims change does ([AP-e-tadd]).
fn moved_traits(world: &mut World) {
    if let Some(mut state) = world.get_resource_mut::<crate::placement::LotEditState>() {
        state.revision = state.revision.saturating_add(1);
    }
}

/// [AP-cmd-post]: the loader's own checks on each person the change touched,
/// and on the timed moodlets when one ended.
pub(super) fn post_condition(world: &World, touched: &Touched) -> Result<(), ()> {
    let pack = world.resource::<Content>().0;
    let ladder = Ladder::from_tuning(&pack.tuning);
    for &sim in &touched.people {
        let entity = edit::living_entity(world, sim).ok_or(())?;
        save::validate_person_state(world.entity(entity), pack).map_err(|_| ())?;
        if let Some(affinities) = world.get::<Affinities>(entity) {
            if affinities.values().len() > pack.affinities.len()
                || !affinities
                    .values()
                    .iter()
                    .all(|&value| save::affinities::valid_value(value))
            {
                return Err(());
            }
        }
        if let Some(skills) = world.get::<Skills>(entity) {
            for &(skill, practice) in skills.entries() {
                let definition = pack.skills.get(skill as usize).ok_or(())?;
                if practice != 0.0
                    && !(save::skills::valid_row_practice(practice)
                        && practice <= ladder.max_practice(definition.levels))
                {
                    return Err(());
                }
            }
        }
    }
    if touched.timers {
        timer_rows_valid(world)?;
    }
    Ok(())
}

/// The rows of every timed moodlet keep the shape the loader requires
/// ([`save::v11`]): strictly ascending by person, each a living person. Ending
/// a moodlet only removes a row, so the end ticks are not rechecked.
fn timer_rows_valid(world: &World) -> Result<(), ()> {
    let valid = |timers: &MoodletTimers| {
        timers
            .entries()
            .windows(2)
            .all(|pair| pair[0].0 < pair[1].0)
            && timers
                .entries()
                .iter()
                .all(|&(sim, _)| edit::living_entity(world, sim.0).is_some())
    };
    let burnt = world
        .get_resource::<BurntMeals>()
        .is_none_or(|t| valid(&t.0));
    let fights = world
        .get_resource::<Fights>()
        .is_none_or(|t| valid(&t.timers));
    let careers = world.get_resource::<Careers>().is_none_or(|c| {
        [&c.promoted, &c.raised, &c.demoted, &c.fired]
            .into_iter()
            .all(valid)
    });
    if burnt && fights && careers {
        Ok(())
    } else {
        Err(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::admin_test_support::{entity_of, people};
    use crate::Sim;
    use terri_data::ContentPack;

    fn pack() -> &'static ContentPack {
        terri_data::pack()
    }

    fn touched(sim: u32) -> Touched {
        Touched {
            people: [sim].into(),
            ..Touched::default()
        }
    }

    /// [AP-cmd-post]: the post-condition is the loader's own rule, so state
    /// the edits' validation never lets through is refused here too: it is
    /// what stands between a bug and a save that would not load.
    #[test]
    fn the_post_condition_refuses_state_the_loader_would_refuse() {
        let mut sim = Sim::new_from_shipped_lot();
        let first = people(&mut sim)[0];
        let entity = entity_of(&sim, first);
        assert_eq!(post_condition(sim.world(), &touched(first)), Ok(()));
        let (object, row) = (0, 0);
        let mut repeated = Habituation::default();
        repeated.set(
            ObjectDefId(object),
            row,
            pack().tuning.habituation_max * 2.0,
        );
        sim.world_mut().entity_mut(entity).insert(repeated);
        assert_eq!(
            post_condition(sim.world(), &touched(first)),
            Err(()),
            "repetition above the tuned maximum"
        );
        sim.world_mut()
            .entity_mut(entity)
            .insert(Habituation::default());
        assert_eq!(post_condition(sim.world(), &touched(first)), Ok(()));
        let definition = &pack().skills[0];
        let top = Ladder::from_tuning(&pack().tuning).max_practice(definition.levels);
        sim.world_mut()
            .entity_mut(entity)
            .insert(Skills::from_entries(vec![(0, top * 2.0)]));
        assert_eq!(
            post_condition(sim.world(), &touched(first)),
            Err(()),
            "practice above the top of the ladder"
        );
        sim.world_mut().entity_mut(entity).insert(Skills::default());
        sim.world_mut()
            .entity_mut(entity)
            .insert(Traits::from_entries(vec![(0, 2.0)]));
        assert_eq!(
            post_condition(sim.world(), &touched(first)),
            Err(()),
            "a trait state above 1"
        );
        sim.world_mut()
            .entity_mut(entity)
            .insert(Traits::from_entries(vec![(0, 0.5)]));
        sim.world_mut()
            .entity_mut(entity)
            .insert(Affinities::from_values(vec![
                0.0;
                pack().affinities.len() + 1
            ]));
        assert_eq!(
            post_condition(sim.world(), &touched(first)),
            Err(()),
            "an affinity for a kind the pack lacks"
        );
    }
}
