//! Counts the topics of finished chats and fights over a run of game days, for
//! the frequency check in [RT-tests] of `docs/specs/2026-11-22-richer-topics.md`.
//! It starts each world as `conversation_households` does and reads the
//! topic of every finished chat from the activity log.
//!
//!     cargo run --release -p terri-sim --example topic_frequencies -- 1 3 20
//!
//! The three numbers are the first seed, the last seed and the game days.
//! Output is one `seed,kind,topic,count` line per topic that appeared, then a
//! `seed,summary,...` line with the chat total and the share about a subject.
use std::collections::BTreeMap;
use terri_core::{chores::SavedChores, save::SavedMortality, SimRng};
use terri_sim::activity_log::{LogKind, NONE, RECORD_WORDS};
use terri_sim::{Content, Sim};

const KIND: usize = 2;
const LABEL2: usize = 6;
const SUBJECT_PREFIX: &str = "subject:";

fn main() {
    let args: Vec<_> = std::env::args().collect();
    let first: u64 = args.get(1).map_or(1, |s| s.parse().expect("first seed"));
    let last: u64 = args.get(2).map_or(3, |s| s.parse().expect("last seed"));
    let days: u64 = args.get(3).map_or(20, |s| s.parse().expect("game days"));
    assert!(first <= last && days > 0);
    println!("seed,kind,topic,count");
    for seed in first..=last {
        let mut sim = Sim::new_from_shipped_lot();
        sim.world_mut().insert_resource(SimRng::from_seed(seed));
        if let Some(mut chores) = sim.world_mut().get_resource_mut::<SavedChores>() {
            chores.rng = Some(SimRng::from_seed(seed ^ 0x4348_4f52_4553));
        }
        sim.world_mut().resource_mut::<SavedMortality>().enabled = true;
        let day = u64::from(sim.world().resource::<Content>().0.tuning.day_ticks);
        let names: Vec<String> = sim.activity_log_labels().to_vec();
        let mut counts: BTreeMap<(&'static str, String), u64> = BTreeMap::new();
        for _ in 1..=day * days {
            sim.tick();
            sim.take_activity_log_export();
            for record in sim.activity_log_export().chunks_exact(RECORD_WORDS) {
                let kind = match LogKind::from_code((record[KIND] & 0xff) as u8) {
                    Some(LogKind::ChatDone) => "chat",
                    Some(LogKind::FightDone) => "fight",
                    _ => continue,
                };
                let topic = match record[LABEL2] {
                    NONE => "(none)".to_string(),
                    at => names[at as usize].clone(),
                };
                *counts.entry((kind, topic)).or_default() += 1;
            }
        }
        let mut chats = 0;
        let mut subjects = 0;
        for ((kind, topic), count) in &counts {
            println!("{seed},{kind},{topic},{count}");
            if *kind == "chat" {
                chats += count;
                if topic.starts_with(SUBJECT_PREFIX) {
                    subjects += count;
                }
            }
        }
        let share = if chats == 0 {
            0.0
        } else {
            100.0 * subjects as f64 / chats as f64
        };
        println!("{seed},summary,chats={chats} subject_chats={subjects},{share:.1}");
    }
}
