//! Explicit offline conversion for unpublished chore-preview saves.
//! Run with an input save path and a new output path. Never use this decoder
//! as a fallback for the published format: both formats share a fingerprint.

use std::{
    fs::File,
    io::{Read, Write},
    path::Path,
};
use terri_core::{
    legacy_chores_preview::PreviewSnapshotV5, SaveSnapshotV5, SAVE_MAGIC, SAVE_SCHEMA_VERSION,
};
use terri_sim::Sim;

const PREVIEW_FINGERPRINT: u64 = 0xcf78_7472_e9e8_38f5;
const HEADER_BYTES: usize = SAVE_MAGIC.len() + std::mem::size_of::<u16>();
const MAX_SAVE_BYTES: usize = 16_777_216;

fn decode_preview(bytes: &[u8]) -> Result<PreviewSnapshotV5, String> {
    if !(HEADER_BYTES..=MAX_SAVE_BYTES).contains(&bytes.len()) {
        return Err("preview save length is outside the accepted range".into());
    }
    if bytes[..SAVE_MAGIC.len()] != SAVE_MAGIC || bytes[8..HEADER_BYTES] != 5u16.to_le_bytes() {
        return Err("expected a TERRISAV schema V5 preview save".into());
    }
    let payload = &bytes[HEADER_BYTES..];
    let (snapshot, rest) = postcard::take_from_bytes::<PreviewSnapshotV5>(payload)
        .map_err(|error| format!("complete preview V5 decoding failed: {error}"))?;
    if !rest.is_empty() || postcard::to_allocvec(&snapshot).map_err(|e| e.to_string())? != payload {
        return Err("preview payload has trailing bytes or noncanonical encoding".into());
    }
    if snapshot.world.content_fingerprint != PREVIEW_FINGERPRINT
        || snapshot.sleeping_places.is_none()
    {
        return Err("save is not the complete supported chore-preview format".into());
    }
    Ok(snapshot)
}

fn encode_current(snapshot: &SaveSnapshotV5) -> Result<Vec<u8>, String> {
    let mut bytes = SAVE_MAGIC.to_vec();
    bytes.extend_from_slice(&SAVE_SCHEMA_VERSION.to_le_bytes());
    bytes.extend(postcard::to_allocvec(snapshot).map_err(|e| e.to_string())?);
    Ok(bytes)
}

fn migrate(bytes: &[u8]) -> Result<(Vec<u8>, u64, u64), String> {
    let snapshot: SaveSnapshotV5 = decode_preview(bytes)?.into();
    let tick = snapshot.world.tick;
    let mut sim = Sim::new_from_shipped_lot();
    sim.load_snapshot_v5(snapshot.clone())
        .map_err(|error| format!("converted preview snapshot failed validation: {error:?}"))?;
    let hash = sim.world_hash();
    // Capture after adoption so newly introduced skill state is persisted once.
    let current = sim.save_snapshot_v5();
    let mut retained = current.clone();
    retained.skills = None;
    if retained != snapshot {
        return Err("adoption changed retained preview state; output was not written".into());
    }
    let migrated = encode_current(&current)?;
    Ok((migrated, tick, hash))
}

fn migrate_file(input: &Path, output: &Path) -> Result<(), String> {
    let mut bytes = Vec::new();
    File::open(input)
        .map_err(|e| format!("cannot read input: {e}"))?
        .take(MAX_SAVE_BYTES as u64 + 1)
        .read_to_end(&mut bytes)
        .map_err(|e| format!("cannot read input: {e}"))?;
    let (migrated, tick, hash) = migrate(&bytes)?;
    // Preserve the input and refuse to overwrite an earlier migration or backup.
    let mut destination = File::options()
        .write(true)
        .create_new(true)
        .open(output)
        .map_err(|e| format!("cannot create new output: {e}"))?;
    destination
        .write_all(&migrated)
        .and_then(|()| destination.sync_all())
        .map_err(|e| format!("cannot write output: {e}"))?;
    println!(
        "Migrated {} bytes to {} bytes; tick {tick}; world hash {hash}.",
        bytes.len(),
        migrated.len()
    );
    Ok(())
}

fn main() -> std::process::ExitCode {
    let paths: Vec<_> = std::env::args_os().skip(1).collect();
    let result = match paths.as_slice() {
        [input, output] => migrate_file(Path::new(input), Path::new(output)),
        _ => Err("usage: cargo run -p terri-wasm --example migrate_chores_preview -- INPUT.sav OUTPUT.sav".into()),
    };
    match result {
        Ok(()) => std::process::ExitCode::SUCCESS,
        Err(error) => {
            eprintln!("Migration failed: {error}");
            std::process::ExitCode::FAILURE
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use terri_core::{
        chores::{ChoreKey, ChoreKind},
        legacy_chores_preview::{PreviewCommand, PreviewWorld},
        SavedCommand,
    };

    fn preview_from_current(s: SaveSnapshotV5) -> PreviewSnapshotV5 {
        let w = s.world;
        assert!(w.queued_commands.is_empty());
        PreviewSnapshotV5 {
            world: PreviewWorld {
                content_fingerprint: w.content_fingerprint,
                tick: w.tick,
                rng: w.rng,
                funds: w.funds,
                issued_sim_ids: w.issued_sim_ids,
                grid_width: w.grid_width,
                grid_height: w.grid_height,
                blocked_tiles: w.blocked_tiles,
                entities: w.entities,
                queued_commands: vec![],
                sleep_pressure: w.sleep_pressure,
            },
            layout: s.layout,
            object_facings: s.object_facings,
            retired_indices: s.retired_indices,
            object_colourways: s.object_colourways,
            floors: s.floors,
            family_by_index: s.family_by_index,
            family: s.family,
            mortality: s.mortality,
            death_default_applied: s.death_default_applied,
            waiting_needs: s.waiting_needs,
            self_preservation: s.self_preservation,
            chronotype_offsets: s.chronotype_offsets,
            domestic: s.domestic,
            sleeping_places: s.sleeping_places,
            shyness: s.shyness,
            boundaries: s.boundaries,
            dining: s.dining,
            targeted_cleanup: s.targeted_cleanup,
            chores: s.chores,
            grime: s.grime,
        }
    }

    fn encode_preview(snapshot: &PreviewSnapshotV5) -> Vec<u8> {
        let mut bytes = SAVE_MAGIC.to_vec();
        bytes.extend_from_slice(&5u16.to_le_bytes());
        bytes.extend(postcard::to_allocvec(snapshot).unwrap());
        bytes
    }

    fn fixture() -> PreviewSnapshotV5 {
        let mut sim = Sim::new_from_shipped_lot();
        for _ in 0..80 {
            sim.tick();
        }
        preview_from_current(sim.save_snapshot_v5())
    }

    #[test]
    fn six_preview_command_tags_convert_by_meaning() {
        let key = ChoreKey {
            kind: ChoreKind::Floors,
            target: 37,
        };
        let cases = [
            (
                PreviewCommand::CleanDishes {
                    agent: 8,
                    surface: 9,
                    dishes: Some(vec![11, 16]),
                },
                SavedCommand::CleanDishes {
                    agent: 8,
                    surface: 9,
                    dishes: Some(vec![11, 16]),
                },
            ),
            (
                PreviewCommand::CleanDishesFirst {
                    agent: 8,
                    surface: 9,
                    dishes: None,
                },
                SavedCommand::CleanDishesFirst {
                    agent: 8,
                    surface: 9,
                    dishes: None,
                },
            ),
            (
                PreviewCommand::CleanChore { agent: 8, key },
                SavedCommand::CleanChore { agent: 8, key },
            ),
            (
                PreviewCommand::CleanChoreFirst { agent: 8, key },
                SavedCommand::CleanChoreFirst { agent: 8, key },
            ),
            (
                PreviewCommand::SetChoreProfile {
                    agent: 8,
                    responsibility: 87,
                    preferences: [-100, 0, 50, 100],
                },
                SavedCommand::SetChoreProfile {
                    agent: 8,
                    responsibility: 87,
                    preferences: [-100, 0, 50, 100],
                },
            ),
            (
                PreviewCommand::SetChoreBoard { enabled: true },
                SavedCommand::SetChoreBoard { enabled: true },
            ),
        ];
        for (i, (old, expected)) in cases.into_iter().enumerate() {
            let old_bytes = postcard::to_allocvec(&old).unwrap();
            assert_eq!(old_bytes[0], 22 + i as u8);
            let decoded: PreviewCommand = postcard::from_bytes(&old_bytes).unwrap();
            let mapped = SavedCommand::from(decoded);
            assert_eq!(mapped, expected);
            let new_bytes = postcard::to_allocvec(&mapped).unwrap();
            assert_eq!(new_bytes[0], 23 + i as u8);
            assert_eq!(&old_bytes[1..], &new_bytes[1..]);
        }
    }

    #[test]
    fn conversion_preserves_state_and_continues_after_resave() {
        let mut old = fixture();
        old.world.queued_commands = vec![PreviewCommand::SetChoreBoard { enabled: false }];
        verify_retention_and_continuation(old);
    }

    fn verify_retention_and_continuation(old: PreviewSnapshotV5) {
        let expected: SaveSnapshotV5 = old.clone().into();
        assert!(expected.skills.is_none());
        let bytes = encode_preview(&old);
        assert_eq!(decode_preview(&bytes).unwrap(), old);
        let (migrated, tick, hash) = migrate(&bytes).unwrap();
        assert_eq!(tick, expected.world.tick);
        let (saved, rest) =
            postcard::take_from_bytes::<SaveSnapshotV5>(&migrated[HEADER_BYTES..]).unwrap();
        assert!(rest.is_empty());
        let mut retained = saved.clone();
        retained.skills = None;
        assert_eq!(retained, expected);
        let mut direct = Sim::new_from_shipped_lot();
        direct.load_snapshot_v5(expected).unwrap();
        let mut restored = Sim::new_from_shipped_lot();
        restored.load_snapshot_v5(saved).unwrap();
        assert_eq!(restored.world_hash(), hash);
        assert_eq!(
            encode_current(&restored.save_snapshot_v5()).unwrap(),
            migrated
        );
        for _ in 0..240 {
            direct.tick();
            restored.tick();
            assert_eq!(direct.world_hash(), restored.world_hash());
        }
        assert_eq!(direct.save_snapshot_v5(), restored.save_snapshot_v5());
    }

    #[test]
    #[ignore = "requires an explicitly supplied private save path"]
    fn supplied_private_preview_preserves_state_and_continues_after_resave() {
        let path = std::env::var_os("TERRI_PRIVATE_PREVIEW_SAVE")
            .expect("set TERRI_PRIVATE_PREVIEW_SAVE to the retained preview save");
        let bytes = std::fs::read(path).unwrap();
        verify_retention_and_continuation(decode_preview(&bytes).unwrap());
    }

    #[test]
    fn complete_preview_requires_canonical_bytes_and_exact_header() {
        let old = fixture();
        let bytes = encode_preview(&old);
        for end in 0..bytes.len() {
            assert!(
                decode_preview(&bytes[..end]).is_err(),
                "accepted cut at {end}"
            );
        }
        let mut trailing = bytes.clone();
        trailing.push(0);
        assert!(decode_preview(&trailing).is_err());
        let mut magic = bytes.clone();
        magic[0] ^= 1;
        assert!(decode_preview(&magic).is_err());
        let mut version = bytes.clone();
        version[8] = 4;
        assert!(decode_preview(&version).is_err());
        let mut wrong = old.clone();
        wrong.world.content_fingerprint ^= 1;
        assert!(decode_preview(&encode_preview(&wrong)).is_err());
        let mut missing_sleep = old.clone();
        missing_sleep.sleeping_places = None;
        assert!(decode_preview(&encode_preview(&missing_sleep)).is_err());
        // Postcard reads an overlong tick, but it cannot survive canonical re-encoding.
        let mut zero_tick = old;
        zero_tick.world.tick = 0;
        let mut noncanonical = encode_preview(&zero_tick);
        let (_, rest) = postcard::take_from_bytes::<u64>(&noncanonical[HEADER_BYTES..]).unwrap();
        let tick_offset = noncanonical.len() - rest.len();
        noncanonical.splice(tick_offset..tick_offset + 1, [0x80, 0]);
        assert!(decode_preview(&noncanonical).is_err());
    }

    #[test]
    fn conversion_rejects_semantically_invalid_preview() {
        let mut old = fixture();
        old.chores.as_mut().unwrap().profiles[0].responsibility = 101;
        assert!(migrate(&encode_preview(&old))
            .unwrap_err()
            .contains("failed validation"));
    }
}
