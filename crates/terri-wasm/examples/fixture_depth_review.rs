//! Empty, validated native scenes for registered fixture-depth measurements.
use terri_core::{Facing, Position, SAVE_MAGIC, SAVE_SCHEMA_VERSION};
use terri_sim::{apply_object_placement, Sim};

fn main() {
    let directory = std::path::PathBuf::from(std::env::args().nth(1).expect("output directory"));
    std::fs::create_dir_all(&directory).unwrap();
    for model in ["counter", "kitchen_sink", "stove", "dining_table"] {
        for (index, facing) in [
            Facing::SouthEast,
            Facing::SouthWest,
            Facing::NorthWest,
            Facing::NorthEast,
        ]
        .into_iter()
        .enumerate()
        {
            let mut sim = Sim::new_with_lot(20, 16);
            let pack = sim.world().resource::<terri_sim::Content>().0;
            let definition = pack.find(model).unwrap();
            let position = Position { x: 6., y: 4. };
            let fixture = sim.spawn_object(position, definition);
            apply_object_placement(
                sim.world_mut(),
                fixture,
                pack.object(definition),
                position,
                facing,
            );
            let snapshot = sim.save_snapshot_v10();
            let mut loaded = Sim::new_with_lot(1, 1);
            loaded.load_snapshot_v10(snapshot.clone()).unwrap();
            assert_eq!(snapshot, loaded.save_snapshot_v10());
            let mut bytes = SAVE_MAGIC.to_vec();
            bytes.extend(SAVE_SCHEMA_VERSION.to_le_bytes());
            bytes.extend(postcard::to_allocvec(&snapshot).unwrap());
            std::fs::write(directory.join(format!("{model}-{index}.sav")), bytes).unwrap();
        }
    }
}
