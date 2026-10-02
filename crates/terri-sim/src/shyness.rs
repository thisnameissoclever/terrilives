use bevy_ecs::prelude::*;
use terri_core::{Agent, Shyness, SimId};

pub(crate) fn of(world: &World, entity: Entity) -> Shyness {
    world.get::<Shyness>(entity).copied().unwrap_or_else(|| {
        world
            .get::<SimId>(entity)
            .copied()
            .map_or(Shyness::new(50).unwrap(), Shyness::initial)
    })
}

pub(crate) fn deviations(world: &World) -> Vec<(u32, u8)> {
    let mut values = world
        .try_query_filtered::<(&SimId, &Shyness), With<Agent>>()
        .map(|mut q| {
            q.iter(world)
                .filter(|(id, value)| **value != Shyness::initial(**id))
                .map(|(id, value)| (id.0, value.value()))
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();
    values.sort_unstable();
    values
}

pub(crate) fn restore(world: &mut World, values: Vec<(u32, u8)>) -> Result<(), crate::SaveError> {
    if values.windows(2).any(|p| p[0].0 >= p[1].0) {
        return Err(crate::SaveError::InvalidValue);
    }
    let people: Vec<_> = world
        .query_filtered::<(Entity, &SimId), With<Agent>>()
        .iter(world)
        .map(|(e, id)| (e, id.0))
        .collect();
    if values.len() > people.len() {
        return Err(crate::SaveError::InvalidValue);
    }
    for (id, value) in values {
        let value = Shyness::new(value).ok_or(crate::SaveError::InvalidValue)?;
        let entity = people
            .iter()
            .find(|(_, known)| *known == id)
            .map(|(e, _)| *e)
            .ok_or(crate::SaveError::InvalidEntityReference)?;
        world.entity_mut(entity).insert(value);
    }
    Ok(())
}
