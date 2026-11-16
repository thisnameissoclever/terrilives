//! Current browser-review inputs. The V14 projection is a comparison, not an original-producer fixture.
use std::{fs, path::Path};
use terri_core::{
    Blocked, CommandQueue, Entity, NeedId, Needs, Path as Route, Position, SelfPreservation,
    SimCommand, SimId, SimRng,
};
use terri_sim::{Content, Sim};

const _: () = assert!(terri_core::save::SAVE_SCHEMA_VERSION == 22);

fn write(path: &Path, version: u16, payload: Vec<u8>) {
    let mut bytes = terri_core::save::SAVE_MAGIC.to_vec();
    bytes.extend(version.to_le_bytes());
    bytes.extend(payload);
    fs::write(path, bytes).expect("write review input");
}
fn write_current(path: &Path, sim: &Sim) {
    let snapshot = sim.save_snapshot_v22();
    let mut restored = Sim::new_with_lot_and_content(1, 1, *sim.world().resource::<Content>());
    restored
        .load_snapshot_v22(snapshot.clone())
        .expect("valid current review input");
    assert_eq!(restored.save_snapshot_v22(), snapshot);
    write(
        path,
        terri_core::save::SAVE_SCHEMA_VERSION,
        postcard::to_allocvec(&snapshot).unwrap(),
    );
}
fn main() {
    let output = std::env::args()
        .nth(1)
        .expect("pass a task-owned review directory");
    let output = Path::new(&output);
    fs::create_dir_all(output).expect("create review directory");
    let mut sim = Sim::new_from_shipped_lot_with_seed(42);
    let people: Vec<_> = sim
        .world_mut()
        .query::<(Entity, &SimId)>()
        .iter(sim.world())
        .map(|(e, id)| (id.0, e))
        .collect();
    let tim = people.iter().find(|(id, _)| *id == 0).unwrap().1;
    let bill = people.iter().find(|(id, _)| *id == 1).unwrap().1;
    for (_, person) in &people {
        sim.world_mut()
            .entity_mut(*person)
            .insert((Needs::all_at(65.), SelfPreservation(50)));
    }
    let mut needs = Needs::all_at(65.);
    needs.set(NeedId::Hunger, 10.);
    needs.set(NeedId::Social, 0.);
    needs.set(NeedId::Fun, 0.);
    needs.set(NeedId::Energy, 35.);
    sim.world_mut().entity_mut(tim).insert(needs);
    sim.world_mut().insert_resource(SimRng::from_seed(42));
    sim.world_mut()
        .resource_mut::<CommandQueue>()
        .push(SimCommand::Select(Some(tim.index_u32())));
    sim.flush_commands();
    write(
        &output.join("critical-before-tick-v14.sav"),
        14,
        postcard::to_allocvec(
            &sim.try_save_snapshot_v14()
                .expect("the historical review control must be representable in V14"),
        )
        .unwrap(),
    );
    write_current(&output.join("critical-before-tick-v17.sav"), &sim);
    let pack = sim.world().resource::<Content>().0;
    let toilet = sim
        .world_mut()
        .query::<(Entity, &terri_core::SmartObject)>()
        .iter(sim.world())
        .find(|(_, object)| pack.object(object.0).id == "toilet")
        .unwrap()
        .0;
    sim.world_mut()
        .get_mut::<Needs>(bill)
        .unwrap()
        .set(NeedId::Bladder, 5.);
    sim.world_mut()
        .resource_mut::<CommandQueue>()
        .push(SimCommand::UseObject {
            agent: bill.index_u32(),
            object: toilet.index_u32(),
            interaction: 0,
        });
    sim.world_mut()
        .resource_mut::<CommandQueue>()
        .push(SimCommand::TalkTo {
            agent: tim.index_u32(),
            target: bill.index_u32(),
            interaction: 0,
        });
    sim.tick();
    if let Some(waiting) = sim
        .world()
        .get::<Route>(tim)
        .and_then(|p| p.steps.last().copied())
    {
        sim.world_mut().entity_mut(tim).remove::<Route>().insert((
            Position {
                x: waiting.0 as f32,
                y: waiting.1 as f32,
            },
            Blocked,
        ));
    }
    write_current(&output.join("waiting-for-care-v17.sav"), &sim);
    println!(
        "Wrote historical/current critical scenarios and an arrived care waiter to {}",
        output.display()
    );
}
