//! The activity log's boundary ([AL-bridge] in
//! docs/specs/2026-10-18-activity-log.md): a take moves staged records into
//! an export buffer the shell reads through one pointer, the label table
//! crosses once as one string, and the disabled baseline stages nothing.

use super::*;
use terri_sim::activity_log::{ActivityLog, LogKind, LogRecord, ACTIONS, RECORD_WORDS};

/// The words a take left in the export buffer, read through the pointer
/// exactly as JavaScript reads them.
fn exported(handle: &SimHandle, count: u32) -> Vec<u32> {
    let words = count as usize * RECORD_WORDS;
    if words == 0 {
        return Vec::new();
    }
    // SAFETY: the pointer addresses the export buffer, which holds exactly
    // `count` records after the take that returned `count`, and nothing
    // mutates the handle while this slice is alive.
    unsafe { std::slice::from_raw_parts(handle.activity_log_ptr(), words) }.to_vec()
}

fn stage(handle: &mut SimHandle, tick: u64) -> u32 {
    handle
        .sim
        .world_mut()
        .resource_mut::<ActivityLog>()
        .push(LogRecord::new(LogKind::ActionDone, ACTIONS, tick, 7))
}

/// Ticks the shipped household until a take returns records, and returns
/// them as words. Gives up after `limit` ticks.
fn tick_until_records(handle: &mut SimHandle, limit: u32) -> Vec<u32> {
    for _ in 0..limit {
        handle.tick();
        let count = handle.activity_log_take();
        if count > 0 {
            return exported(handle, count);
        }
    }
    Vec::new()
}

#[test]
fn activity_log_take_returns_records_in_sequence_and_empties_staging() {
    let mut handle = SimHandle::from_lot();
    let staged: Vec<u32> = (0..3).map(|tick| stage(&mut handle, 100 + tick)).collect();
    assert_eq!(staged, vec![1, 2, 3]);

    let count = handle.activity_log_take();
    assert_eq!(count, 3);
    let words = exported(&handle, count);
    for (index, record) in words.chunks_exact(RECORD_WORDS).enumerate() {
        assert_eq!(record[0], index as u32 + 1, "seq");
        assert_eq!(record[1], 100 + index as u32, "tick");
        assert_eq!(record[2] & 0xff, LogKind::ActionDone as u32, "kind");
        assert_eq!((record[2] >> 8) & 0xff, ACTIONS, "triggers");
        assert_eq!(record[3], 7, "actor");
    }
    assert_eq!(handle.activity_log_take(), 0, "a take empties staging");
    assert_eq!(handle.activity_log_dropped(), 0);

    // The household's own events continue the sequence.
    let words = tick_until_records(&mut handle, 1_440);
    assert!(!words.is_empty(), "the shipped household logs within a day");
    let seqs: Vec<u32> = words.chunks_exact(RECORD_WORDS).map(|r| r[0]).collect();
    let expected: Vec<u32> = (4..4 + seqs.len() as u32).collect();
    assert_eq!(seqs, expected);
}

#[test]
fn activity_log_disabled_emits_nothing() {
    let mut handle = SimHandle::from_lot();
    handle.set_activity_log_enabled(false);
    assert_eq!(stage(&mut handle, 1), 0, "a disabled log stages nothing");
    assert!(tick_until_records(&mut handle, 1_440).is_empty());
    assert_eq!(handle.activity_log_dropped(), 0);

    // The choice survives a Load, which otherwise starts an empty log.
    let saved = handle.save_bytes();
    assert!(handle.load_bytes(&saved));
    assert!(tick_until_records(&mut handle, 720).is_empty());

    handle.set_activity_log_enabled(true);
    assert_eq!(stage(&mut handle, 2), 1, "the fresh world starts at seq 1");
    assert_eq!(handle.activity_log_take(), 1);
}

#[test]
fn activity_log_labels_cross_as_one_line_each() {
    let handle = SimHandle::from_lot();
    let names = handle.sim.activity_log_labels();
    assert!(names.iter().all(|name| !name.contains('\n')));
    let text = handle.activity_log_labels();
    let lines: Vec<&str> = text.split('\n').collect();
    assert_eq!(lines, names.iter().map(String::as_str).collect::<Vec<_>>());
}

#[test]
fn a_load_starts_the_next_take_at_seq_one() {
    let mut handle = SimHandle::from_lot();
    stage(&mut handle, 1);
    stage(&mut handle, 2);
    let saved = handle.save_bytes();
    assert!(handle.load_bytes(&saved));
    assert_eq!(
        handle.activity_log_take(),
        0,
        "staged records do not survive"
    );
    assert_eq!(stage(&mut handle, 3), 1);
    let count = handle.activity_log_take();
    assert_eq!(exported(&handle, count)[0], 1);
}

#[test]
fn reaction_bands_are_the_likes_and_dislikes_edges() {
    let handle = SimHandle::from_lot();
    let tuning = &handle.sim.world().resource::<Content>().0.tuning;
    assert_eq!(
        handle.activity_log_reaction_bands(),
        vec![tuning.affinity_band_loves, tuning.affinity_band_likes]
    );
}

#[test]
fn conversation_topic_table_crosses_as_one_tab_separated_line_per_row() {
    let handle = SimHandle::from_lot();
    let rows = &handle.sim.world().resource::<terri_sim::Content>().0.topics;
    let text = handle.conversation_topic_table();
    let lines: Vec<&str> = text.split('\n').collect();
    assert_eq!(lines.len(), rows.len());
    for (line, row) in lines.iter().zip(rows) {
        let fields: Vec<&str> = line.split('\t').collect();
        assert_eq!(
            fields,
            [row.kind.name(), row.icon.as_str(), row.label.as_str()]
        );
    }
    assert!(lines.iter().any(|line| line.starts_with("subject\t")));
}

#[test]
fn activity_log_topic_rows_name_a_topic_value_for_each_label() {
    let handle = SimHandle::from_lot();
    let names = handle.sim.activity_log_labels();
    let values = handle.activity_log_topic_rows();
    assert_eq!(values.len(), names.len(), "one value per label");
    let value_of = |label: &str| {
        let at = names.iter().position(|name| name == label).unwrap();
        values[at]
    };
    let rows = &handle.sim.world().resource::<terri_sim::Content>().0.topics;
    let row_of = |value: u32| &rows[((value & 0xffff) - 1) as usize].id;
    assert_eq!(row_of(value_of("reading")), "reading");
    assert_eq!(row_of(value_of("food")), "eating");
    assert_eq!(row_of(value_of("fight-privacy")), "fight-privacy");
    let random = value_of("fight-random-12");
    assert_eq!(row_of(random), "showers");
    assert_eq!(
        random & (1 << 16),
        1 << 16,
        "a random fight carries the fight bit"
    );
    assert_eq!(value_of("food") & (1 << 16), 0);
    assert_eq!(value_of("cause:nuisance"), 0, "a cause is not a topic");
    assert!(values.contains(&0));
}

/// One finished chat about a subject: what the log recorded and the topic
/// value the render column carried while the two people talked.
struct SubjectChat {
    handle: SimHandle,
    record: [u32; RECORD_WORDS],
    drawn: u32,
}

/// Orders person 0 to chat with person 1 in worlds of different seeds until a
/// chat finishes about a subject. The subject a chat draws depends on the
/// seed, so one seed in a few is enough.
fn first_subject_chat() -> SubjectChat {
    for seed in 0..60 {
        let mut handle = SimHandle::from_lot_with_seed(seed, 0);
        let chat = handle
            .sim
            .world()
            .resource::<Content>()
            .0
            .social
            .iter()
            .position(|action| action.id == "chat")
            .expect("the shipped pack has a chat") as u32;
        let people: Vec<_> = handle
            .sim
            .world_mut()
            .query::<(terri_core::Entity, &terri_core::SimId)>()
            .iter(handle.sim.world())
            .map(|(entity, id)| (id.0, entity.index_u32()))
            .collect();
        let find = |sim| people.iter().find(|(id, _)| *id == sim).unwrap().1;
        let (speaker, listener) = (find(0), find(1));
        handle
            .sim
            .world_mut()
            .resource_mut::<terri_core::CommandQueue>()
            .push(terri_core::SimCommand::TalkTo {
                agent: speaker,
                target: listener,
                interaction: chat,
            });
        let mut drawn = 0;
        for _ in 0..400 {
            handle.tick();
            drawn = handle
                .sim
                .render_buffer()
                .conversation_topics
                .iter()
                .copied()
                .find(|&value| value != 0)
                .unwrap_or(drawn);
            let count = handle.activity_log_take();
            let names = handle.sim.activity_log_labels();
            for record in exported(&handle, count).chunks_exact(RECORD_WORDS) {
                let topic = record[6] as usize;
                if record[2] & 0xff == LogKind::ChatDone as u32
                    && names
                        .get(topic)
                        .is_some_and(|name| name.starts_with("subject:"))
                {
                    let record = record.try_into().unwrap();
                    return SubjectChat {
                        handle,
                        record,
                        drawn,
                    };
                }
            }
        }
    }
    panic!("no chat in sixty worlds was about a subject");
}

#[test]
fn a_subject_chat_crosses_the_activity_log_with_its_row() {
    let chat = first_subject_chat();
    let handle = &chat.handle;
    let names = handle.sim.activity_log_labels();
    let label = chat.record[6] as usize;
    let id = names[label].strip_prefix("subject:").unwrap();
    let rows = &handle.sim.world().resource::<Content>().0.topics;
    // The log label resolves to the subject's own row, with its bubble value.
    let value = handle.activity_log_topic_rows()[label];
    let row = &rows[((value & 0xffff) - 1) as usize];
    assert_eq!((row.id.as_str(), row.kind.name()), (id, "subject"));
    assert_eq!(value & (1 << 16), 0, "a subject is not a random fight");
    // The shell reads that row's word from the table the simulation sends.
    let table = handle.conversation_topic_table();
    let line = table
        .split('\n')
        .nth((value & 0xffff) as usize - 1)
        .unwrap();
    assert_eq!(line, format!("subject\t{}\t{}", row.icon, row.label));
    assert!(!row.label.is_empty());
    // The people's bubbles carried the same row while they talked.
    assert_eq!(chat.drawn, value);
    // The initiator liked the subject, so their reaction is positive.
    let (initiator, _) = terri_sim::activity_log::unpack_pair(chat.record[8] as i32);
    assert!(initiator > 0, "the speaker likes what they bring up");
}

#[test]
fn subject_words_and_labels_cross_the_boundary_aligned() {
    let handle = SimHandle::from_lot();
    let labels = handle.subject_labels();
    assert_eq!(
        labels,
        ["trains", "bicycling", "gardening", "the weather", "work"]
    );
    let mut employed = 0;
    let people: Vec<u32> = handle
        .sim
        .world()
        .try_query::<(terri_core::Entity, &terri_core::Agent)>()
        .map(|mut q| {
            q.iter(handle.sim.world())
                .map(|(e, _)| e.index_u32())
                .collect()
        })
        .unwrap_or_default();
    assert!(!people.is_empty());
    for person in people {
        let words = handle.subject_words_of(person);
        assert_eq!(words.len(), labels.len());
        let known = ["Loves", "Likes", "Indifferent", "Dislikes", "Hates"];
        // Only Work can read empty, and only without a job.
        for (label, word) in labels.iter().zip(&words) {
            if label != "work" {
                assert!(known.contains(&word.as_str()), "{label}: {word}");
            }
        }
        let has_job = !handle.career_of(person).is_empty();
        assert_eq!(words[4].is_empty(), !has_job);
        employed += usize::from(has_job);
    }
    assert!(employed > 0, "someone in the shipped household has a job");
    assert!(handle.subject_words_of(u32::MAX).is_empty());
}
