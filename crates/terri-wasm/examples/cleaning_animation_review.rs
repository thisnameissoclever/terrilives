//! Isolated furniture-contact fixtures; ordinary needs and chore durations apply.
use terri_core::{
    chores::{ChoreKey, ChoreKind},
    Agent, CommandQueue, Position, SimClock, SimCommand, SAVE_MAGIC, SAVE_SCHEMA_VERSION,
};
use terri_sim::Sim;

fn main() {
    let directory = std::path::PathBuf::from(std::env::args().nth(1).expect("output directory"));
    std::fs::create_dir_all(&directory).unwrap();
    for (name, kind, action) in [
        ("counter", ChoreKind::Surfaces, 15),
        ("dining_table", ChoreKind::Surfaces, 16),
        ("trashcan", ChoreKind::Bins, 17),
    ] {
        for facing in 1..=4 {
            let mut sim = Sim::new_with_lot(20, 16);
            let pack = sim.world().resource::<terri_sim::Content>().0;
            let def = pack.objects.iter().position(|o| o.id == name).unwrap();
            let footprint = pack.objects[def].footprint;
            let object = sim.spawn_object(
                Position { x: 6.0, y: 4.0 },
                terri_core::ObjectDefId(def as u32),
            );
            let pos = match facing {
                1 => (5.0, 4.0),
                2 => (6.0 + footprint.width as f32, 4.0),
                3 => (6.0, 3.0),
                _ => (6.0, 4.0 + footprint.depth as f32),
            };
            let mut member = pack.household[0].clone();
            member.x = pos.0;
            member.y = pos.1;
            member.needs = [80.0; terri_core::NEED_COUNT];
            member.career = None;
            sim.spawn_household(&pack.personalities, &[member], &pack.traits);
            let person = sim
                .world_mut()
                .query::<(terri_core::Entity, &Agent)>()
                .iter(sim.world())
                .next()
                .unwrap()
                .0;
            sim.world_mut()
                .entity_mut(person)
                .insert(terri_core::Selected);
            sim.world_mut().resource_mut::<SimClock>().tick = 660;
            sim.tick();
            sim.world_mut()
                .entity_mut(person)
                .insert(Position { x: pos.0, y: pos.1 });
            let mut saved = sim.save_snapshot_v5();
            let chores = saved.chores.as_mut().unwrap();
            chores.board_enabled = false;
            if kind == ChoreKind::Bins {
                chores.bins = vec![(object.index_u32(), 1000)];
            } else {
                chores.surfaces = vec![(object.index_u32(), 1000)];
            }
            sim.load_snapshot_v5(saved).unwrap();
            let mut bytes = SAVE_MAGIC.to_vec();
            bytes.extend(SAVE_SCHEMA_VERSION.to_le_bytes());
            bytes.extend(postcard::to_allocvec(&sim.save_snapshot_v5()).unwrap());
            std::fs::write(
                directory.join(format!("cleaning-{name}-{facing}.sav")),
                bytes,
            )
            .unwrap();
            sim.world_mut()
                .resource_mut::<CommandQueue>()
                .push(SimCommand::CleanChoreFirst {
                    agent: person.index_u32(),
                    key: ChoreKey {
                        kind,
                        target: object.index_u32(),
                    },
                });
            for _ in 0..100 {
                sim.tick();
                sim.sync_render_buffer();
                if sim.render_buffer().visual_actions.contains(&action) {
                    break;
                }
            }
            assert!(
                sim.render_buffer().visual_actions.contains(&action),
                "{name} {facing} never started"
            );
            assert_eq!(
                sim.render_buffer().facings[sim
                    .render_buffer()
                    .ids
                    .iter()
                    .position(|id| *id == person.index_u32())
                    .unwrap()],
                facing
            );
        }
    }
}
