//! A full household with an explicitly dirtied, empty counter for renderer inspection.
use terri_core::{
    chores::SavedChores, CommandQueue, Entity, SimCommand, SmartObject, SAVE_MAGIC,
    SAVE_SCHEMA_VERSION,
};
use terri_sim::Sim;

const _: () = assert!(SAVE_SCHEMA_VERSION == 16);

fn main() {
    let output = std::env::args().nth(1).expect("output save path");
    let mut sim = Sim::new_from_shipped_lot();
    sim.world_mut()
        .resource_mut::<CommandQueue>()
        .push(SimCommand::SetChoreBoard { enabled: false });
    sim.flush_commands();
    let pack = sim.world().resource::<terri_sim::Content>().0;
    let counter = sim
        .world_mut()
        .query::<(Entity, &SmartObject)>()
        .iter(sim.world())
        .find(|(_, object)| pack.objects[object.0 .0 as usize].id == "counter")
        .expect("shipped counter")
        .0
        .index_u32();
    {
        let mut chores = sim.world_mut().resource_mut::<SavedChores>();
        chores.surfaces = vec![(counter, 1000)];
        chores.board_enabled = false;
    }
    let snapshot = sim.save_snapshot_v16();
    let mut loaded = Sim::new_from_shipped_lot();
    loaded
        .load_snapshot_v16(snapshot.clone())
        .expect("valid review fixture");
    assert_eq!(snapshot, loaded.save_snapshot_v16());
    let mut bytes = SAVE_MAGIC.to_vec();
    bytes.extend(SAVE_SCHEMA_VERSION.to_le_bytes());
    bytes.extend(postcard::to_allocvec(&snapshot).unwrap());
    std::fs::write(output, bytes).expect("write review fixture");
    println!("Validated schema {SAVE_SCHEMA_VERSION} fixture; dirty counter entity {counter}");
}
