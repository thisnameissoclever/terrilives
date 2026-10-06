use super::*;
use crate::render_buffer::{NO_SLEEPING_BED, NO_SLEEPING_PLACE};
use terri_core::{AtWork, Commuting, Eating, Path, Socialising, StepWork};

fn sleep(sim: &mut Sim, person: Entity, bed: Entity, ordinal: u8) {
    sim.world_mut().entity_mut(person).insert((
        Eating {
            object: ObjectDefId(0),
            interaction: 0,
            remaining_ticks: 30,
        },
        Target {
            object: bed,
            interaction: 0,
        },
        SleepPlace(ordinal),
    ));
}

fn projected(sim: &mut Sim, person: Entity) -> (u32, u32) {
    sim.sync_render_buffer_after_commands();
    let buffer = sim.render_buffer();
    assert_eq!(buffer.sleeping_beds.len(), buffer.count);
    assert_eq!(buffer.sleeping_places.len(), buffer.count);
    let row = buffer
        .ids
        .iter()
        .position(|id| *id == person.index_u32())
        .unwrap();
    (buffer.sleeping_beds[row], buffer.sleeping_places[row])
}

#[test]
fn sleeping_projection_keeps_exact_places_without_requiring_body_art() {
    let (mut sim, bed, [first, second, spare]) = fixture();
    sleep(&mut sim, first, bed, 1);
    sleep(&mut sim, second, bed, 0);
    sim.world_mut()
        .entity_mut(first)
        .insert(terri_core::ChainState::begin(0));
    sim.world_mut()
        .entity_mut(first)
        .get_mut::<Eating>()
        .unwrap()
        .interaction = 1;
    sim.world_mut()
        .entity_mut(first)
        .get_mut::<Target>()
        .unwrap()
        .interaction = 1;
    // Alternate one-slot nap still shares the bed's two physical places.
    let other_bed = sim
        .world_mut()
        .spawn((SmartObject(ObjectDefId(0)), Position { x: 9.0, y: 9.0 }))
        .id();
    sim.world_mut().despawn(spare);
    assert_eq!(projected(&mut sim, first), (bed.index_u32(), 1));
    assert_eq!(projected(&mut sim, second), (bed.index_u32(), 0));
    assert_eq!(
        projected(&mut sim, bed),
        (NO_SLEEPING_BED, NO_SLEEPING_PLACE)
    );
    assert!(sim
        .render_buffer()
        .interaction_targets
        .iter()
        .all(|id| *id == u32::MAX));
    assert!(sim
        .render_buffer()
        .visual_actions
        .iter()
        .all(|action| *action == 0));
    let hash = sim.world_hash();
    projected(&mut sim, first);
    assert_eq!(
        sim.world_hash(),
        hash,
        "projection must not change simulation state"
    );
    sim.world_mut().entity_mut(first).remove::<Eating>();
    assert_eq!(
        projected(&mut sim, first),
        (NO_SLEEPING_BED, NO_SLEEPING_PLACE)
    );
    assert_eq!(projected(&mut sim, second), (bed.index_u32(), 0));
    sim.world_mut()
        .entity_mut(second)
        .get_mut::<Target>()
        .unwrap()
        .object = other_bed;
    sim.world_mut()
        .entity_mut(second)
        .get_mut::<Eating>()
        .unwrap()
        .remaining_ticks = 0;
    assert_eq!(projected(&mut sim, second), (other_bed.index_u32(), 0));
    let row = sim
        .render_buffer()
        .ids
        .iter()
        .position(|id| *id == other_bed.index_u32())
        .unwrap();
    assert_ne!(
        row as u32,
        other_bed.index_u32(),
        "the second bed must follow an entity hole"
    );
}

#[test]
fn sleeping_projection_rejects_inactive_and_invalid_claims() {
    for (case, name) in [
        "no running action",
        "no lease",
        "out-of-range place",
        "no target",
        "interaction mismatch",
        "definition mismatch",
        "commuting",
        "at work",
        "active chain work",
        "walking",
        "unpositioned bed",
        "non-sleep action",
        "despawned bed",
        "non-agent",
        "conversation initiator",
        "conversation receiver",
        "reused bed index",
    ]
    .iter()
    .enumerate()
    {
        let (mut sim, bed, [person, partner, _]) = fixture();
        sleep(&mut sim, person, bed, 0);
        match case {
            0 => {
                sim.world_mut().entity_mut(person).remove::<Eating>();
            }
            1 => {
                sim.world_mut().entity_mut(person).remove::<SleepPlace>();
            }
            2 => {
                sim.world_mut().entity_mut(person).insert(SleepPlace(2));
            }
            3 => {
                sim.world_mut().entity_mut(person).remove::<Target>();
            }
            4 => {
                sim.world_mut()
                    .entity_mut(person)
                    .get_mut::<Target>()
                    .unwrap()
                    .interaction = 1;
            }
            5 => {
                sim.world_mut()
                    .entity_mut(person)
                    .get_mut::<Eating>()
                    .unwrap()
                    .object = ObjectDefId(999);
            }
            6 => {
                sim.world_mut()
                    .entity_mut(person)
                    .insert(Commuting::Outbound);
            }
            7 => {
                sim.world_mut()
                    .entity_mut(person)
                    .insert(AtWork { remaining_ticks: 5 });
            }
            8 => {
                sim.world_mut()
                    .entity_mut(person)
                    .insert(StepWork { remaining_ticks: 5 });
            }
            9 => {
                sim.world_mut().entity_mut(person).insert(Path {
                    steps: vec![(1, 1)],
                    cursor: 0,
                });
            }
            10 => {
                sim.world_mut().entity_mut(bed).remove::<Position>();
            }
            11 => {
                sim.world_mut()
                    .entity_mut(person)
                    .get_mut::<Eating>()
                    .unwrap()
                    .interaction = 2;
                sim.world_mut()
                    .entity_mut(person)
                    .get_mut::<Target>()
                    .unwrap()
                    .interaction = 2;
            }
            12 => {
                sim.world_mut().despawn(bed);
            }
            13 => {
                sim.world_mut().entity_mut(person).remove::<Agent>();
            }
            14 => {
                sim.world_mut().entity_mut(person).insert(Socialising {
                    interaction: 0,
                    partner,
                    remaining_ticks: 5,
                });
            }
            15 => {
                sim.world_mut().entity_mut(partner).insert(Socialising {
                    interaction: 0,
                    partner: person,
                    remaining_ticks: 5,
                });
            }
            16 => {
                sim.world_mut().despawn(bed);
                let replacement = sim
                    .world_mut()
                    .spawn((SmartObject(ObjectDefId(0)), Position { x: 7.0, y: 7.0 }))
                    .id();
                assert_eq!(replacement.index_u32(), bed.index_u32());
                assert_ne!(replacement, bed);
            }
            _ => unreachable!(),
        }
        assert_eq!(
            projected(&mut sim, person),
            (NO_SLEEPING_BED, NO_SLEEPING_PLACE),
            "{name}"
        );
    }
}
