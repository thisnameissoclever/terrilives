//! Generate ordinary, native-owned pool continuations for displayed review.
use std::{fs, path::PathBuf};
use terri_core::{
    appearance::CharacterAppearanceV1, CommandQueue, Facing, Needs, ObjectFacing, Position,
    SimCommand, SimName, TileGrid, SAVE_MAGIC, SAVE_SCHEMA_VERSION,
};
use terri_sim::{Content, Sim};
use terri_wasm::SimHandle;

fn write(sim: &Sim, folder: &std::path::Path, name: &str, actor: u32, pool: u32) -> String {
    let snapshot = sim.save_snapshot_v23();
    let episode = snapshot.pools.iter().find(|p| p.actor == actor);
    let mut bytes = SAVE_MAGIC.to_vec();
    bytes.extend(SAVE_SCHEMA_VERSION.to_le_bytes());
    bytes.extend(postcard::to_allocvec(&snapshot).unwrap());
    let mut check = SimHandle::new(12, 12);
    assert!(check.load_bytes(&bytes), "public loader refused {name}");
    assert_eq!(check.save_bytes(), bytes, "public roundtrip changed {name}");
    fs::write(folder.join(format!("{name}.bin")), &bytes).unwrap();
    let (entity, _, facing) = terri_sim::placement::object_definition(sim.world(), pool).unwrap();
    let position = sim.world().get::<Position>(entity).unwrap();
    let offset = match facing {
        Facing::SouthEast => (-1, 0),
        Facing::SouthWest => (0, 2),
        Facing::NorthWest => (2, 1),
        Facing::NorthEast => (1, -1),
    };
    format!("{{\"file\":\"{name}.bin\",\"actor\":{actor},\"pool\":{pool},\"hasEpisode\":{},\"phase\":{},\"elapsed\":{},\"exitOrigin\":{},\"facing\":{},\"poolOrigin\":[{},{}],\"approach\":[{},{}],\"bytes\":{}}}",
        episode.is_some(),episode.map_or(0,|e|e.phase),episode.map_or(0,|e|e.elapsed),episode.map_or(0,|e|e.exit_origin),facing.code(),
        position.x,position.y,position.x as i32+offset.0,position.y as i32+offset.1,bytes.len())
}
fn main() {
    let args: Vec<_> = std::env::args().collect();
    let folder = PathBuf::from(args.get(1).expect("output directory required"));
    fs::create_dir_all(&folder).unwrap();
    if let Some(path) = args.get(2) {
        let bytes = fs::read(path).unwrap();
        assert_eq!(
            &bytes[8..10],
            &21u16.to_le_bytes(),
            "expected retained V21 input"
        );
        let mut handle = SimHandle::new(12, 12);
        assert!(handle.load_bytes(&bytes), "retained V21 save refused");
        println!("Retained V21 file accepted unchanged as input: {path}, {} bytes, tick={}, dayTicks={}, fundsCents={}",bytes.len(),handle.sim_tick(),handle.day_ticks(),handle.funds_cents());
    }
    let mut receipts = Vec::new();
    for two_people in [false, true] {
        let mut sim = Sim::new_with_lot(12, 12);
        let pack = sim.world().resource::<Content>().0;
        let pool = sim.spawn_object(Position { x: 4., y: 4. }, pack.find("pool").unwrap());
        let second = two_people
            .then(|| sim.spawn_object(Position { x: 8., y: 4. }, pack.find("pool").unwrap()));
        let toilet = sim.spawn_object(Position { x: 2., y: 8. }, pack.find("toilet").unwrap());
        for origin in [(4, 4), (8, 4)]
            .into_iter()
            .take(if two_people { 2 } else { 1 })
        {
            for y in origin.1..origin.1 + 2 {
                for x in origin.0..origin.0 + 2 {
                    sim.world_mut()
                        .resource_mut::<TileGrid>()
                        .set_blocked(x, y, true);
                }
            }
        }
        sim.world_mut()
            .resource_mut::<TileGrid>()
            .set_blocked(2, 8, true);
        let mut actors = Vec::new();
        for (name, presentation, x) in [("Alex", "masculine", 1.), ("Morgan", "feminine", 7.)]
            .into_iter()
            .take(if two_people { 2 } else { 1 })
        {
            let actor = sim.spawn_agent(Position { x, y: 2. }, 70.);
            let mut appearance = CharacterAppearanceV1::default();
            appearance.presentation = presentation.into();
            appearance.colors.shirt = [120, 35, 155];
            appearance.colors.trousers = [20, 70, 140];
            sim.world_mut().entity_mut(actor).insert((
                appearance,
                SimName(name.into()),
                Needs::all_at(70.),
            ));
            actors.push((actor.index_u32(), name, presentation, x));
        }
        sim.world_mut()
            .resource_mut::<CommandQueue>()
            .push(SimCommand::Select(Some(actors[0].0)));
        sim.flush_commands();
        let name = if two_people {
            "pool-two-people-two-pools-idle"
        } else {
            "pool-idle-approach"
        };
        let mut receipt = write(&sim, &folder, name, actors[0].0, pool.index_u32());
        receipt.pop();
        receipt.push_str(&format!(",\"secondPool\":{},\"nextObject\":{},\"actors\":[{}]}}",
            second.map_or("null".into(),|e|e.index_u32().to_string()),toilet.index_u32(),
            actors.iter().map(|(id,name,presentation,x)|format!("{{\"id\":{id},\"name\":\"{name}\",\"presentation\":\"{presentation}\",\"position\":[{x},2]}}" )).collect::<Vec<_>>().join(",")));
        receipts.push(receipt);
    }
    for facing in Facing::ALL {
        for (preset, presentation, height, build, shirt, trousers) in [
            ("neutral", "masculine", 50, 50, [170, 30, 80], [20, 70, 140]),
            (
                "short-wide",
                "feminine",
                0,
                100,
                [120, 35, 155],
                [30, 130, 90],
            ),
            (
                "tall-narrow",
                "masculine",
                100,
                0,
                [190, 80, 20],
                [90, 35, 140],
            ),
            (
                "tall-wide",
                "feminine",
                100,
                100,
                [15, 140, 160],
                [160, 50, 30],
            ),
        ] {
            let mut sim = Sim::new_with_lot(12, 12);
            let definition = sim.world().resource::<Content>().0.find("pool").unwrap();
            let pool = sim.spawn_object(Position { x: 4., y: 4. }, definition);
            for y in 4..6 {
                for x in 4..6 {
                    sim.world_mut()
                        .resource_mut::<TileGrid>()
                        .set_blocked(x, y, true);
                }
            }
            sim.world_mut()
                .resource_mut::<CommandQueue>()
                .push(SimCommand::PlaceObject {
                    object: pool.index_u32(),
                    x: 4,
                    y: 4,
                    facing,
                });
            sim.flush_commands();
            assert_eq!(sim.world().get::<ObjectFacing>(pool).unwrap().0, facing);
            let (x, y) = match facing {
                Facing::SouthEast => (3., 4.),
                Facing::SouthWest => (4., 6.),
                Facing::NorthWest => (6., 5.),
                Facing::NorthEast => (5., 3.),
            };
            let actor = sim.spawn_agent(Position { x, y }, 70.);
            let mut appearance = CharacterAppearanceV1::default();
            appearance.presentation = presentation.into();
            appearance.body.height = height;
            appearance.body.build = build;
            appearance.body.shoulders = build;
            appearance.body.hips = build;
            appearance.body.torso = height;
            appearance.colors.shirt = shirt;
            appearance.colors.trousers = trousers;
            sim.world_mut().entity_mut(actor).insert((
                appearance,
                SimName("Pool review".into()),
                Needs::all_at(70.),
            ));
            sim.world_mut()
                .resource_mut::<CommandQueue>()
                .push(SimCommand::UseObjectFirst {
                    agent: actor.index_u32(),
                    object: pool.index_u32(),
                    interaction: 0,
                });
            sim.world_mut()
                .resource_mut::<CommandQueue>()
                .push(SimCommand::Select(Some(actor.index_u32())));
            sim.flush_commands();
            for _ in 0..100 {
                sim.tick();
                if sim
                    .save_snapshot_v23()
                    .pools
                    .iter()
                    .any(|p| p.actor == actor.index_u32() && p.phase == 1)
                {
                    break;
                }
            }
            let baseline = sim.save_snapshot_v23();
            let prefix = format!("pool-f{}-{presentation}-{preset}", facing.code());
            for (label, ticks, cancel) in [
                ("entry", 0, false),
                ("entry-step", 7, false),
                ("swim", 37, false),
                ("exit", 88, false),
                ("cancel-entry", 7, true),
                ("cancel-swim", 37, true),
            ] {
                if label != "entry"
                    && !(facing == Facing::SouthEast
                        && (preset == "neutral"
                            || preset == "short-wide" && ["swim", "exit"].contains(&label)))
                {
                    continue;
                }
                sim.load_snapshot_v23(baseline.clone()).unwrap();
                for _ in 0..ticks {
                    sim.tick();
                }
                if cancel {
                    sim.world_mut().resource_mut::<CommandQueue>().push(
                        SimCommand::CancelIntents {
                            agent: actor.index_u32(),
                        },
                    );
                    sim.flush_commands();
                }
                receipts.push(write(
                    &sim,
                    &folder,
                    &format!("{prefix}-{label}"),
                    actor.index_u32(),
                    pool.index_u32(),
                ));
            }
        }
    }
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
        let mut appearance = CharacterAppearanceV1::default();
        appearance.presentation = "feminine".into();
        sim.world_mut().entity_mut(actor).insert((
            appearance,
            SimName("Bath review".into()),
            Needs::all_at(70.),
        ));
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
        for _ in 0..100 {
            sim.tick();
            if sim.world().get::<terri_core::Eating>(actor).is_some() {
                break;
            }
        }
        let remaining = sim
            .world()
            .get::<terri_core::Eating>(actor)
            .expect("ordinary bath begins")
            .remaining_ticks;
        let snapshot = sim.save_snapshot_v23();
        assert!(snapshot.pools.is_empty());
        let mut bytes = SAVE_MAGIC.to_vec();
        bytes.extend(SAVE_SCHEMA_VERSION.to_le_bytes());
        bytes.extend(postcard::to_allocvec(&snapshot).unwrap());
        let mut check = SimHandle::new(12, 12);
        assert!(check.load_bytes(&bytes));
        assert_eq!(check.save_bytes(), bytes);
        let name = format!("bath-f{}-feminine-neutral", facing.code());
        fs::write(folder.join(format!("{name}.bin")), &bytes).unwrap();
        receipts.push(format!("{{\"file\":\"{name}.bin\",\"actor\":{},\"target\":{},\"fixtureModel\":\"bathtub\",\"facing\":{},\"activity\":20,\"remaining\":{remaining},\"bytes\":{}}}",actor.index_u32(),tub.index_u32(),facing.code(),bytes.len()));
    }
    fs::write(folder.join("manifest.json"),format!("{{\"schema\":23,\"entryMinutes\":20,\"swimMinutes\":60,\"exitMinutes\":20,\"files\":[{}]}}\n",receipts.join(","))).unwrap();
    println!(
        "Wrote {} public-loader-verified pool and bath fixtures to {}",
        receipts.len(),
        folder.display()
    );
}
