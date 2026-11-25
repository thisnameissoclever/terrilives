//! Produce ordinary baths long enough to watch a complete toy-play cycle.
use std::{fs, path::PathBuf};
use terri_core::{
    appearance::CharacterAppearanceV1, CommandQueue, Facing, NeedId, Needs, ObjectFacing, Position,
    SimCommand, SimName, TileGrid, SAVE_MAGIC, SAVE_SCHEMA_VERSION,
};
use terri_sim::{Content, Sim};
use terri_wasm::SimHandle;

fn main() {
    let folder = PathBuf::from(std::env::args().nth(1).expect("output directory required"));
    fs::create_dir(&folder).expect("use a new output directory");
    let mut records = Vec::new();
    for facing in Facing::ALL {
        let mut sim = Sim::new_with_lot(12, 12);
        let pack = sim.world().resource::<Content>().0;
        let definition = pack.find("bathtub").unwrap();
        let footprint = pack
            .object(definition)
            .footprint_at(pack.object(definition).base_facing);
        let tub = sim.spawn_object(Position { x: 4., y: 4. }, definition);
        for y in 4..4 + footprint.depth as usize {
            for x in 4..4 + footprint.width as usize {
                sim.world_mut()
                    .resource_mut::<TileGrid>()
                    .set_blocked(x, y, true);
            }
        }
        sim.world_mut()
            .resource_mut::<CommandQueue>()
            .push(SimCommand::PlaceObject {
                object: tub.index_u32(),
                x: 4,
                y: 4,
                facing,
            });
        sim.flush_commands();
        assert_eq!(sim.world().get::<ObjectFacing>(tub).unwrap().0, facing);
        let actor = sim.spawn_agent(Position { x: 3., y: 4. }, 70.);
        let appearance = CharacterAppearanceV1 {
            presentation: "feminine".into(),
            ..Default::default()
        };
        sim.world_mut()
            .entity_mut(actor)
            .insert((appearance, SimName("Alex".into())));
        let mut seen = [false; 4];
        for _ in 0..64 {
            sim.world_mut()
                .resource_mut::<CommandQueue>()
                .push(SimCommand::CancelIntents {
                    agent: actor.index_u32(),
                });
            sim.flush_commands();
            let mut needs = Needs::all_at(70.);
            needs.set(NeedId::Hygiene, 10.);
            sim.world_mut().entity_mut(actor).insert(needs);
            sim.world_mut()
                .resource_mut::<CommandQueue>()
                .push(SimCommand::UseObjectFirst {
                    agent: actor.index_u32(),
                    object: tub.index_u32(),
                    interaction: 0,
                });
            sim.world_mut()
                .resource_mut::<CommandQueue>()
                .push(SimCommand::Select(Some(actor.index_u32())));
            sim.flush_commands();
            for _ in 0..160 {
                sim.tick();
                if !sim.save_snapshot_v32().baths.is_empty() {
                    break;
                }
            }
            let snapshot = sim
                .try_save_snapshot_v32()
                .expect("valid bath review state");
            let episode = snapshot
                .baths
                .iter()
                .find(|row| row.actor == actor.index_u32())
                .expect("bath must begin");
            let toy = usize::from(episode.toy);
            assert!((1..=3).contains(&toy));
            assert!(
                episode.total - episode.elapsed >= 36,
                "bath must cover a complete toy loop"
            );
            if !seen[toy] {
                let name = format!(
                    "bath-f{}-long-{}",
                    facing.code(),
                    ["", "duck", "boat", "submarine"][toy]
                );
                let mut bytes = SAVE_MAGIC.to_vec();
                bytes.extend(SAVE_SCHEMA_VERSION.to_le_bytes());
                bytes.extend(postcard::to_allocvec(&snapshot).unwrap());
                let mut check = SimHandle::new(12, 12);
                assert!(check.load_bytes(&bytes), "public loader must accept {name}");
                assert_eq!(
                    check.save_bytes(),
                    bytes,
                    "public roundtrip must preserve {name}"
                );
                fs::write(folder.join(format!("{name}.bin")), &bytes).unwrap();
                records.push(format!("{{\"file\":\"{name}.bin\",\"toy\":{toy},\"elapsed\":{},\"total\":{},\"bytes\":{}}}", episode.elapsed, episode.total, bytes.len()));
                seen[toy] = true;
            }
            if seen[1..].iter().all(|value| *value) {
                break;
            }
        }
        assert!(
            seen[1..].iter().all(|value| *value),
            "all three native toy choices must occur"
        );
    }
    fs::write(
        folder.join("manifest.json"),
        format!(
            "{{\"schema\":{},\"nativeToySelection\":true,\"files\":[{}]}}\n",
            SAVE_SCHEMA_VERSION,
            records.join(",")
        ),
    )
    .unwrap();
    println!("Wrote {} public-loader-verified bath saves", records.len());
}
